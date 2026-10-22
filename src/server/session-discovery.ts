// Finds CLI sessions that were already open before tokenOffice started.
// Only local process and session metadata is read; conversation bodies are never opened.
import { execFile as execFileCallback } from 'node:child_process';
import type { Dirent } from 'node:fs';
import { readdir, readFile, stat, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { AgentState, Provider } from '../shared/types.ts';

const execFile = promisify(execFileCallback);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODEX_MATCH_WINDOW_MS = 2 * 60 * 1000;
const CODEX_HEADER_BYTES = 64 * 1024;
const MAX_OPEN_SESSIONS = 100;

export interface DiscoveredSession {
  provider: Provider;
  sessionId: string;
  cwd: string;
  project: string;
  projectParent: string;
  projectId: string;
  state: AgentState;
  startedAt: number;
  updatedAt: number;
}

interface RunningProcess { pid: number; name: string; startMs: number; startFileTime: string }
interface CodexFile { path: string; rolloutId: string; at: number }

async function runningProcesses(): Promise<RunningProcess[]> {
  if (process.platform !== 'win32') return [];
  // Get-Process exposes only the PID and start time needed to match active CLI runs.
  const script = "$ErrorActionPreference='Stop'; $items=@(Get-Process -Name 'claude*','codex' -ErrorAction SilentlyContinue | ForEach-Object { try { [pscustomobject]@{ pid=$_.Id; name=$_.ProcessName; startTime=$_.StartTime.ToString('o'); startFileTime=$_.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() } } catch {} }); ConvertTo-Json -InputObject $items -Compress";
  try {
    const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 5000, windowsHide: true });
    const parsed = JSON.parse(String(stdout).trim()) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.flatMap((value): RunningProcess[] => {
      if (!value || typeof value !== 'object') return [];
      const row = value as Record<string, unknown>;
      const pid = Number(row.pid);
      const startMs = typeof row.startTime === 'string' ? Date.parse(row.startTime) : NaN;
      if (!Number.isInteger(pid) || pid < 1 || !Number.isFinite(startMs)) return [];
      return [{ pid, name: typeof row.name === 'string' ? row.name.toLowerCase() : '', startMs,
        startFileTime: typeof row.startFileTime === 'string' ? row.startFileTime : '' }];
    });
  } catch {
    return [];
  }
}

function details(provider: Provider, sessionId: string, cwd: string, state: AgentState, startedAt: number, updatedAt: number): DiscoveredSession | undefined {
  if (!UUID.test(sessionId) || !cwd || !Number.isFinite(updatedAt)) return undefined;
  const normalized = resolve(cwd);
  const project = basename(normalized).slice(0, 48) || (provider === 'codex' ? 'Codex' : 'Claude Code');
  const projectParent = basename(dirname(normalized)).slice(0, 48);
  const projectId = createHash('sha256')
    .update(process.platform === 'win32' ? normalized.toLowerCase() : normalized)
    .digest('hex').slice(0, 10);
  return { provider, sessionId, cwd: normalized, project, projectParent, projectId, state,
    startedAt: Number.isFinite(startedAt) ? startedAt : updatedAt, updatedAt };
}

async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

async function discoverClaude(processes: RunningProcess[]): Promise<DiscoveredSession[]> {
  const byPid = new Map(processes.filter(item => item.name.startsWith('claude')).map(item => [item.pid, item]));
  if (!byPid.size) return [];
  const directory = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'sessions');
  let entries: Dirent[];
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return []; }
  const result: DiscoveredSession[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^\d+\.json$/i.test(entry.name)) continue;
    try {
      const record = JSON.parse(await readFile(join(directory, entry.name), 'utf8')) as Record<string, unknown>;
      const pid = Number(record.pid);
      const processInfo = byPid.get(pid);
      if (!processInfo || !processInfo.startFileTime || String(record.procStart) !== processInfo.startFileTime) continue;
      const cwd = typeof record.cwd === 'string' ? record.cwd : '';
      if (!(await isDirectory(cwd))) continue;
      const updatedAt = Number(record.statusUpdatedAt ?? record.updatedAt);
      const stateText = typeof record.status === 'string' ? record.status.toLowerCase() : '';
      const state: AgentState = /wait|permission/.test(stateText) ? 'waiting' : /busy|work|run/.test(stateText) ? 'working' : 'break';
      const session = details('claude', typeof record.sessionId === 'string' ? record.sessionId : '', cwd, state,
        Number(record.startedAt), Number.isFinite(updatedAt) ? updatedAt : processInfo.startMs);
      if (session) result.push(session);
    } catch { /* stale or partially-written session metadata */ }
  }
  return result;
}

function codexFileTime(name: string): number | undefined {
  const match = name.match(/^rollout-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-([0-9a-f-]{36})\.jsonl$/i);
  if (!match || !UUID.test(match[5]!)) return undefined;
  const [year, month, day] = match[1]!.split('-').map(Number);
  // Codex rollout filenames use local wall time; compare with Get-Process' local StartTime.
  const time = new Date(year!, month! - 1, day!, Number(match[2]), Number(match[3]), Number(match[4])).getTime();
  return Number.isFinite(time) ? time : undefined;
}

async function findCodexFiles(directory: string, depth: number, result: CodexFile[], processTimes: number[]): Promise<void> {
  let entries: Dirent[];
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
  await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && depth < 4) {
      await findCodexFiles(path, depth + 1, result, processTimes);
      return;
    }
    if (!entry.isFile()) return;
    const at = codexFileTime(entry.name);
    if (at === undefined || !processTimes.some(processAt => Math.abs(processAt - at) <= CODEX_MATCH_WINDOW_MS)) return;
    result.push({ path, rolloutId: entry.name.slice(-42, -6), at });
  }));
}

async function readCodexHeader(path: string): Promise<{ rolloutId: string; sessionId: string; cwd: string } | undefined> {
  let file;
  try { file = await open(path, 'r'); } catch { return undefined; }
  try {
    // The metadata record can include long runtime instructions, so allow up to
    // 64 KiB for the first line while never opening the conversation records below it.
    const buffer = Buffer.alloc(CODEX_HEADER_BYTES);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const line = buffer.subarray(0, bytesRead).toString('utf8').split(/\r?\n/, 1)[0];
    if (!line) return undefined;
    const event = JSON.parse(line) as { payload?: { session_id?: unknown; id?: unknown; cwd?: unknown } };
    const payload = event.payload;
    if (!payload) return undefined;
    const rolloutId = typeof payload.id === 'string' ? payload.id : '';
    const sessionId = typeof payload.session_id === 'string' ? payload.session_id : rolloutId;
    const cwd = typeof payload.cwd === 'string' ? payload.cwd : '';
    return rolloutId && sessionId && cwd ? { rolloutId, sessionId, cwd } : undefined;
  } catch {
    return undefined;
  } finally {
    await file.close().catch(() => {});
  }
}

async function discoverCodex(processes: RunningProcess[]): Promise<DiscoveredSession[]> {
  const processTimes = processes.filter(item => item.name === 'codex').map(item => item.startMs);
  if (!processTimes.length) return [];
  const root = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
  const files: CodexFile[] = [];
  await findCodexFiles(root, 0, files, processTimes);
  const sessions = new Map<string, DiscoveredSession>();
  for (const file of files) {
    const header = await readCodexHeader(file.path);
    // A rollout filename tracks payload.id, while payload.session_id can point to
    // the parent thread when Codex creates a follow-up rollout.
    if (!header || header.rolloutId !== file.rolloutId || !(await isDirectory(header.cwd))) continue;
    let updatedAt = file.at;
    try { updatedAt = (await stat(file.path)).mtimeMs; } catch { /* keep filename timestamp */ }
    const session = details('codex', header.sessionId, header.cwd, 'break', file.at, updatedAt);
    if (session) sessions.set(session.sessionId, session);
  }
  return [...sessions.values()];
}

export async function discoverOpenSessions(): Promise<DiscoveredSession[]> {
  const processes = await runningProcesses();
  if (!processes.length) return [];
  const [claude, codex] = await Promise.all([discoverClaude(processes), discoverCodex(processes)]);
  return [...claude, ...codex].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_OPEN_SESSIONS);
}
