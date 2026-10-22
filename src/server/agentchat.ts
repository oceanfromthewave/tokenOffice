import { execFile as execFileCallback, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTPUT_LIMIT = 2_000_000;

interface Target { provider: 'claude' | 'codex'; sessionId: string; cwd?: string }
interface Executable { command: string; prefix: string[] }

async function executable(name: string): Promise<Executable> {
  if (process.platform !== 'win32') return { command: name, prefix: [] };
  let paths: string[];
  try {
    const { stdout } = await execFile('where.exe', [name], { timeout: 3000, windowsHide: true });
    paths = String(stdout).split(/\r?\n/).map(path => path.trim()).filter(Boolean);
  } catch {
    throw new Error(`${name} CLI를 찾지 못했어요. 먼저 해당 CLI를 설치하고 PATH에 등록해 주세요.`);
  }
  const native = paths.find(path => /\.(exe|com)$/i.test(path));
  if (native) return { command: native, prefix: [] };
  const powershellScript = paths.find(path => /\.ps1$/i.test(path));
  if (powershellScript) return {
    command: 'powershell.exe',
    prefix: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', powershellScript],
  };
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

/** Continue an idle Claude Code or Codex CLI session without placing the prompt in process arguments. */
export async function sendToAgent(target: Target, prompt: string): Promise<string> {
  if (!target.cwd) throw new Error('프로젝트 경로를 받은 적이 없어 이 세션을 재개할 수 없어요. 해당 CLI에서 세션을 한 번 더 실행해 주세요.');
  if (!UUID.test(target.sessionId)) throw new Error('세션 ID 형식이 올바르지 않아 재개할 수 없어요.');

  const name = target.provider === 'claude' ? 'claude' : 'codex';
  const cli = await executable(name);
  const args = target.provider === 'claude'
    ? ['--print', '--resume', target.sessionId, '--input-format', 'text', '--output-format', 'text']
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
