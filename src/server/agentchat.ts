import { execFile as execFileCallback, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTPUT_LIMIT = 2_000_000;

interface Target { provider: 'claude' | 'codex'; sessionId: string; cwd?: string }
interface Executable { command: string; prefix: string[] }

async function executable(name: string): Promise<Executable> {
  if (process.platform !== 'win32') return { command: name, prefix: [] };
  let path: string;
  try {
    // Prefer the .cmd shim over a same-name .ps1 shim. Windows PowerShell pipes
    // strings to native programs using its default ASCII $OutputEncoding, which
    // turns Korean prompts into question marks in npm's generated .ps1 wrapper.
    // PowerShell emits the path as UTF-16 base64 so non-ASCII profile names survive.
    const script = `$ErrorActionPreference = 'Stop'; $command = Get-Command -Name '${name}.cmd' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1; if ($null -eq $command) { $command = Get-Command -Name '${name}' -CommandType Application -ErrorAction Stop | Select-Object -First 1 }; if ($null -eq $command -or -not $command.Source) { exit 2 }; [Console]::Write([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes([string]$command.Source)))`;
    const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 3000, windowsHide: true });
    path = Buffer.from(String(stdout).trim(), 'base64').toString('utf16le').trim();
  } catch {
    throw new Error(`${name} CLI를 찾지 못했어요. 먼저 해당 CLI를 설치하고 PATH에 등록해 주세요.`);
  }
  if (/\.(exe|com)$/i.test(path)) return { command: path, prefix: [] };
  if (/\.ps1$/i.test(path)) return {
    command: 'powershell.exe',
    prefix: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path],
  };
  if (/\.(cmd|bat)$/i.test(path)) return { command: 'cmd.exe', prefix: ['/d', '/s', '/c', `call "${path}"`] };
  throw new Error(`${name} CLI를 실행할 수 있는 Windows 실행 파일을 찾지 못했어요.`);
}

function codexFinalMessage(output: string): string {
  let final = '';
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string } };
      if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') final = event.item.text;
    } catch { /* ignore CLI progress lines that aren't JSON */ }
  }
  return final.trim();
}

/** Send a prompt without putting its text in process arguments. Meetings use a fresh, non-persistent context. */
export async function sendToAgent(target: Target, prompt: string, options: { freshSession?: boolean } = {}): Promise<string> {
  if (!target.cwd) throw new Error('프로젝트 경로를 받은 적이 없어 CLI를 시작할 수 없어요. 해당 CLI에서 세션을 한 번 더 실행해 주세요.');
  if (!options.freshSession && !UUID.test(target.sessionId)) throw new Error('세션 ID 형식이 올바르지 않아 재개할 수 없어요.');

  const name = target.provider === 'claude' ? 'claude' : 'codex';
  const cli = await executable(name);
  const args = target.provider === 'claude'
    ? options.freshSession
      ? ['--print', '--no-session-persistence', '--input-format', 'text', '--output-format', 'text', '--tools', '', '--strict-mcp-config']
      : ['--print', '--resume', target.sessionId, '--input-format', 'text', '--output-format', 'text']
    : options.freshSession
      ? ['exec', '--ephemeral', '--sandbox', 'read-only', '--json', '-']
      : ['exec', 'resume', target.sessionId, '-', '--json'];

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(cli.command, [...cli.prefix, ...args], {
      cwd: target.cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let finished = false;
    const timeout = setTimeout(() => {
      finished = true;
      child.kill();
      reject(new Error('응답이 10분 안에 끝나지 않아 중단했어요.'));
    }, 10 * 60 * 1000);
    const collect = (current: string, chunk: Buffer) => {
      const value = current + chunk.toString('utf8');
      if (value.length > OUTPUT_LIMIT) {
        finished = true;
        child.kill();
        clearTimeout(timeout);
        reject(new Error('CLI 응답이 너무 길어 중단했어요.'));
        return current;
      }
      return value;
    };
    child.stdout.on('data', (chunk: Buffer) => { stdout = collect(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = collect(stderr, chunk); });
    child.once('error', error => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      reject(new Error(`${name} CLI를 시작하지 못했어요: ${error.message}`));
    });
    child.once('close', code => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (code !== 0) {
        const detail = String(stderr).trim().slice(-500);
        reject(new Error(detail || `${name} CLI가 오류 코드 ${code ?? 'unknown'}로 끝났어요.`));
        return;
      }
      const answer = target.provider === 'codex' ? codexFinalMessage(stdout) : stdout.trim();
      resolve(answer || '응답은 끝났지만 표시할 텍스트가 없어요.');
    });
    child.stdin.once('error', () => {});
    child.stdin.end(prompt, 'utf8');
  });
}
