// Connects tokenOffice to Codex through the user's ~/.codex/hooks.json.
// Only entries that invoke our hook are changed; other hook definitions are preserved.
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CODEX_HOOK_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest',
  'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt', 'SessionEnd',
] as const;

const SCRIPT = 'token-office.cjs';
const HOOK_SOURCE = fileURLToPath(new URL(`../../hook/${SCRIPT}`, import.meta.url));

interface HookHandler { type?: string; command?: string; async?: boolean; timeout?: number; [key: string]: unknown }
interface HookGroup { matcher?: string; hooks?: HookHandler[]; [key: string]: unknown }
export interface CodexSettings { hooks?: Record<string, HookGroup[] | undefined>; [key: string]: unknown }
export interface CodexSetupStatus { connected: boolean; node: boolean; settingsPath: string }

const codexDir = () => process.env.CODEX_HOME || join(homedir(), '.codex');
const settingsPath = () => join(codexDir(), 'hooks.json');
const scriptTarget = () => join(codexDir(), 'hooks', SCRIPT);
const ours = (group: HookGroup) => group.hooks?.some(h => h.command?.includes(SCRIPT)) ?? false;

/** Remove tokenOffice hook groups while preserving all other Codex settings. */
export function withoutCodexHooks(settings: CodexSettings): CodexSettings {
  const hooks: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    const kept = (groups ?? []).filter(group => !ours(group));
    if (kept.length) hooks[event] = kept;
  }
  const { hooks: _drop, ...rest } = settings;
  return Object.keys(hooks).length ? { ...rest, hooks } : rest;
}

/** Add one asynchronous tokenOffice command to each supported Codex lifecycle event. */
export function withCodexHooks(settings: CodexSettings, scriptPath: string): CodexSettings {
  const clean = withoutCodexHooks(settings);
  const hooks: Record<string, HookGroup[]> = { ...(clean.hooks as Record<string, HookGroup[]> | undefined) };
  const command = `node "${scriptPath.replaceAll('\\', '/')}" codex`;
  for (const event of CODEX_HOOK_EVENTS) {
    hooks[event] = [...(hooks[event] ?? []), { hooks: [{ type: 'command', command, async: true, timeout: 3 }] }];
  }
  return { ...clean, hooks };
}

export const isCodexConnected = (settings: CodexSettings) =>
  CODEX_HOOK_EVENTS.every(event => (settings.hooks?.[event] ?? []).some(ours));

async function readSettings(): Promise<CodexSettings> {
  let text: string;
  try {
    text = await readFile(settingsPath(), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as CodexSettings;
  } catch { /* report a helpful error below */ }
  throw new Error(`${settingsPath()} 파일이 올바른 JSON이 아니라서 건드리지 않았어요. 파일을 고친 뒤 다시 시도해 주세요.`);
}

async function writeSettings(settings: CodexSettings) {
  const file = settingsPath();
  await mkdir(codexDir(), { recursive: true });
  await copyFile(file, `${file}.tokenoffice-backup`).catch(() => {});
  const temp = `${file}.tokenoffice.tmp`;
  await writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  await rename(temp, file);
}

const hasNode = () => new Promise<boolean>(resolve => {
  execFile('node', ['--version'], { timeout: 3000, windowsHide: true }, error => resolve(!error));
});

export async function codexSetupStatus(): Promise<CodexSetupStatus> {
  const [settings, node] = await Promise.all([readSettings().catch(() => ({})), hasNode()]);
  return { connected: isCodexConnected(settings), node, settingsPath: settingsPath() };
}

export async function connectCodexHooks(): Promise<CodexSetupStatus> {
  const settings = await readSettings();
  await mkdir(join(codexDir(), 'hooks'), { recursive: true });
  // Read/write works when the hook source is inside the packaged app's asar archive.
  await writeFile(scriptTarget(), await readFile(HOOK_SOURCE));
  await writeSettings(withCodexHooks(settings, scriptTarget()));
  return codexSetupStatus();
}

export async function refreshCodexHookScript() {
  if (!isCodexConnected(await readSettings().catch(() => ({})))) return;
  await writeFile(scriptTarget(), await readFile(HOOK_SOURCE)).catch(() => {});
}

export async function disconnectCodexHooks(): Promise<CodexSetupStatus> {
  await writeSettings(withoutCodexHooks(await readSettings()));
  return codexSetupStatus();
}
