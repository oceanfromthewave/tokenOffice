// Connects tokenOffice to Claude Code by adding its hook to the user's ~/.claude/settings.json (and removing it again).
// Only entries that point at token-office.cjs are touched; every other setting and hook is kept as it was.
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOOK_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Notification',
  'SubagentStart', 'SubagentStop', 'TeammateIdle', 'Stop', 'StopFailure', 'SessionEnd',
] as const;
const SCRIPT = 'token-office.cjs';
const HOOK_SOURCE = fileURLToPath(new URL(`../../hook/${SCRIPT}`, import.meta.url));

interface HookCommand { type?: string; command?: string; args?: string[]; async?: boolean }
interface HookGroup { matcher?: string; hooks?: HookCommand[] }
export interface Settings { hooks?: Record<string, HookGroup[] | undefined>; [key: string]: unknown }
export interface SetupStatus { connected: boolean; node: boolean; settingsPath: string }

const ours = (group: HookGroup) => group.hooks?.some(h => h.command?.includes(SCRIPT) || h.args?.some(a => a.includes(SCRIPT))) ?? false;

/** Settings without any tokenOffice hook entries. Empty event lists (and an empty `hooks`) are dropped. */
export function withoutHooks(settings: Settings): Settings {
  const hooks: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    const kept = (groups ?? []).filter(g => !ours(g));
    if (kept.length) hooks[event] = kept;
  }
  const { hooks: _drop, ...rest } = settings;
  return Object.keys(hooks).length ? { ...rest, hooks } : rest;
}

/** Settings with exactly one tokenOffice hook per event, running the script at `scriptPath`. */
export function withHooks(settings: Settings, scriptPath: string): Settings {
  const clean = withoutHooks(settings);
  const hooks: Record<string, HookGroup[]> = { ...(clean.hooks as Record<string, HookGroup[]> | undefined) };
  const entry = (): HookGroup => ({ hooks: [{ type: 'command', command: 'node', args: [scriptPath.replaceAll('\\', '/')], async: true }] });
  for (const event of HOOK_EVENTS) {
    // only permission prompts matter among notifications
    const group = event === 'Notification' ? { matcher: 'permission_prompt', ...entry() } : entry();
    hooks[event] = [...(hooks[event] ?? []), group];
  }
  return { ...clean, hooks };
}

export const isConnected = (settings: Settings) => HOOK_EVENTS.every(event => (settings.hooks?.[event] ?? []).some(ours));

// ---------------- files ----------------
const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const settingsPath = () => join(claudeDir(), 'settings.json');
const scriptTarget = () => join(claudeDir(), 'hooks', SCRIPT);

async function readSettings(): Promise<Settings> {
  let text: string;
  try {
    text = await readFile(settingsPath(), 'utf8');
  } catch {
    return {}; // no settings yet
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Settings;
  } catch { /* fall through */ }
  throw new Error(`${settingsPath()} 파일이 올바른 JSON이 아니라서 건드리지 않았어요. 파일을 고친 뒤 다시 시도해 주세요.`);
}

/** Writes via a temp file so a crash can't leave half a settings file; keeps the previous version as a backup. */
async function writeSettings(settings: Settings) {
  const file = settingsPath();
  await mkdir(claudeDir(), { recursive: true });
  await copyFile(file, `${file}.tokenoffice-backup`).catch(() => {});
  await writeFile(`${file}.tmp`, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  await rename(`${file}.tmp`, file);
}

const hasNode = () => new Promise<boolean>(resolve => {
  execFile('node', ['--version'], { timeout: 3000, windowsHide: true }, error => resolve(!error));
});

export async function setupStatus(): Promise<SetupStatus> {
  const [settings, node] = await Promise.all([readSettings().catch(() => ({})), hasNode()]);
  return { connected: isConnected(settings), node, settingsPath: settingsPath() };
}

export async function connectHooks(): Promise<SetupStatus> {
  const settings = await readSettings();
  await mkdir(join(claudeDir(), 'hooks'), { recursive: true });
  // readFile + writeFile rather than copyFile: inside the packaged app the source lives in an asar archive
  await writeFile(scriptTarget(), await readFile(HOOK_SOURCE));
  await writeSettings(withHooks(settings, scriptTarget()));
  return setupStatus();
}

/** If we're connected, rewrite our copy of the hook script so fixes to it ship with app updates. */
export async function refreshHookScript() {
  if (!isConnected(await readSettings().catch(() => ({})))) return;
  await writeFile(scriptTarget(), await readFile(HOOK_SOURCE)).catch(() => {});
}

export async function disconnectHooks(): Promise<SetupStatus> {
  await writeSettings(withoutHooks(await readSettings()));
  return setupStatus();
}
