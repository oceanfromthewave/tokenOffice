import { execFile as execFileCallback, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTPUT_LIMIT = 2_000_000;

interface Target { provider: 'claude' | 'codex'; sessionId: string; cwd?: string }
interface Executable { command: string; prefix: string[] }

export function claudeMeetingArgs(): string[] {
  return ['--print', '--no-session-persistence', '--input-format', 'text', '--output-format', 'text', '--tools', 'Glob,Grep,Read,LS', '--strict-mcp-config'];
}

function decodeOutput(chunks: Buffer[]): string {
  const output = Buffer.concat(chunks);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(output);
  } catch {
    // Some Windows CLI builds write localized text using the active Korean code page.
    if (process.platform === 'win32') {
      try { return new TextDecoder('windows-949', { fatal: true }).decode(output); } catch { /* use replacement decoding below */ }
    }
    return new TextDecoder('utf-8').decode(output);
  }
}

async function executable(name: string): Promise<Executable> {
  if (process.platform !== 'win32') return { command: name, prefix: [] };
  let path: string;
  try {
    // Prefer the .cmd shim over a same-name .ps1 shim. Windows PowerShell pipes
    // strings to native programs using its default ASCII $OutputEncoding, which
    // turns Korean prompts into question marks in npm's generated .ps1 wrapper.
    // PowerShell emits the path as UTF-16 base64 so non-ASCII profile names survive.
    const script = `$ErrorActionPreference = 'Stop'; $candidates = @(); foreach ($candidateName in @('${name}.cmd', '${name}.exe', '${name}')) { $found = @(Get-Command -Name $candidateName -CommandType Application -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Source }); $candidates += $found }; if ($env:APPDATA) { $npmCandidate = Join-Path $env:APPDATA 'npm\\${name}.cmd'; if (Test-Path -LiteralPath $npmCandidate -PathType Leaf) { $candidates += $npmCandidate } }; if ('${name}' -eq 'claude' -and $env:APPDATA) { $nativeClaude = Join-Path $env:APPDATA 'npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'; if (Test-Path -LiteralPath $nativeClaude -PathType Leaf) { $candidates = @($nativeClaude) + $candidates } }; if ('${name}' -eq 'codex' -and $env:LOCALAPPDATA) { $stableCodex = Join-Path $env:LOCALAPPDATA 'Programs\\OpenAI\\Codex\\bin\\codex.exe'; if (Test-Path -LiteralPath $stableCodex -PathType Leaf) { $candidates += $stableCodex }; $runtimeCodex = Join-Path $env:LOCALAPPDATA 'OpenAI\\Codex\\bin'; if (Test-Path -LiteralPath $runtimeCodex -PathType Container) { $candidates += @(Get-ChildItem -Path (Join-Path $runtimeCodex '*\\codex.exe') -File -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) } }; $candidates = @($candidates | Where-Object { $_ } | Select-Object -Unique); if ('${name}' -eq 'codex') { $ranked = foreach ($candidate in $candidates) { try { $versionText = (& $candidate --version 2>$null | Out-String); $match = [regex]::Match($versionText, 'codex-cli\\s+(\\d+)\\.(\\d+)\\.(\\d+)(?:-([0-9A-Za-z.-]+))?'); if ($match.Success) { [pscustomobject]@{ Source = $candidate; Major = [int]$match.Groups[1].Value; Minor = [int]$match.Groups[2].Value; Patch = [int]$match.Groups[3].Value; Prerelease = $match.Groups[4].Success } } } catch { } }; $selected = $ranked | Sort-Object @{Expression='Major';Descending=$true}, @{Expression='Minor';Descending=$true}, @{Expression='Patch';Descending=$true}, @{Expression='Prerelease';Descending=$false} | Select-Object -First 1; if ($null -eq $selected) { $selected = [pscustomobject]@{ Source = $candidates | Select-Object -First 1 } } } else { $selected = [pscustomobject]@{ Source = $candidates | Select-Object -First 1 } }; if ($null -eq $selected -or -not $selected.Source) { exit 2 }; [Console]::Write([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes([string]$selected.Source)))`;
    const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: name === 'codex' ? 15_000 : 3_000, windowsHide: true });
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

function codexFailureMessage(stdout: string, stderr: string): string {
  const messageFrom = (value: unknown, depth = 0): string => {
    if (depth > 5 || value == null) return '';
    if (typeof value === 'string') {
      try { return messageFrom(JSON.parse(value), depth + 1); } catch { return value.trim(); }
    }
    if (typeof value !== 'object') return '';
    const record = value as { message?: unknown; error?: unknown };
    return messageFrom(record.message, depth + 1) || messageFrom(record.error, depth + 1);
  };
  for (const line of stdout.split(/\r?\n/).reverse()) {
    try {
      const event = JSON.parse(line) as { type?: string; message?: unknown; error?: unknown };
      if (event.type === 'error' || event.type === 'turn.failed') {
        const message = messageFrom(event.message ?? event.error);
        if (message) return message;
      }
    } catch { /* ignore non-JSON progress lines */ }
  }
  return stderr.trim() || stdout.trim();
}

/** Send a prompt without putting its text in process arguments. Meetings use a fresh, non-persistent context. */
export async function sendToAgent(target: Target, prompt: string, options: { freshSession?: boolean; codexModelFallback?: boolean } = {}): Promise<string> {
  if (!target.cwd) throw new Error('프로젝트 경로를 받은 적이 없어 CLI를 시작할 수 없어요. 해당 CLI에서 세션을 한 번 더 실행해 주세요.');
  if (!options.freshSession && !UUID.test(target.sessionId)) throw new Error('세션 ID 형식이 올바르지 않아 재개할 수 없어요.');

  const name = target.provider === 'claude' ? 'claude' : 'codex';
  const cli = await executable(name);
  const args = target.provider === 'claude'
    ? options.freshSession
      ? claudeMeetingArgs()
      : ['--print', '--resume', target.sessionId, '--input-format', 'text', '--output-format', 'text']
    : options.freshSession
      ? ['exec', '--ephemeral', '--sandbox', 'read-only', '--json', '-']
      : ['exec', 'resume', target.sessionId, '-', '--json'];
  if (target.provider === 'codex' && options.freshSession && options.codexModelFallback) args.splice(1, 0, '--model', 'gpt-5.6-terra');

  const cliEnvironment = process.platform === 'win32' && target.provider === 'claude'
    ? claudeEnvironment()
    : process.env;
  const env = { ...cliEnvironment, TOKEN_OFFICE_INTERNAL_CHAT: '1' };

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(cli.command, [...cli.prefix, ...args], {
      cwd: target.cwd,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    let finished = false;
    const timeout = setTimeout(() => {
      finished = true;
      child.kill();
      reject(new Error('응답이 10분 안에 끝나지 않아 중단했어요.'));
    }, 10 * 60 * 1000);
    const collect = (chunks: Buffer[], chunk: Buffer, currentSize: number, updateSize: (size: number) => void) => {
      const size = currentSize + chunk.length;
      if (size > OUTPUT_LIMIT) {
        finished = true;
        child.kill();
        clearTimeout(timeout);
        reject(new Error('CLI 응답이 너무 길어 중단했어요.'));
        return;
      }
      chunks.push(chunk);
      updateSize(size);
    };
    child.stdout.on('data', (chunk: Buffer) => { if (!finished) collect(stdoutChunks, chunk, stdoutSize, size => { stdoutSize = size; }); });
    child.stderr.on('data', (chunk: Buffer) => { if (!finished) collect(stderrChunks, chunk, stderrSize, size => { stderrSize = size; }); });
    child.once('error', error => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      reject(new Error(`${name} CLI를 시작하지 못했어요: ${error.message}`));
    });
    child.once('close', code => {
      if (finished) return;
      const stdout = decodeOutput(stdoutChunks);
      const stderr = decodeOutput(stderrChunks);
      finished = true;
      clearTimeout(timeout);
      if (code !== 0) {
        const detail = (target.provider === 'codex' ? codexFailureMessage(stdout, stderr) : (String(stderr).trim() || String(stdout).trim())).slice(-500);
        const allOutput = `${String(stderr)}\n${String(stdout)}`;
        if (target.provider === 'codex' && /missing field [`']base_instructions[`']/.test(allOutput)) {
          reject(new Error('Codex CLI가 공유 모델 캐시와 호환되지 않아요. 터미널에서 npm install -g @openai/codex@latest 를 실행해 CLI를 업데이트한 뒤 다시 시도해 주세요.'));
          return;
        }
        if (target.provider === 'codex' && options.freshSession && !options.codexModelFallback && /model[^\n]{0,180}not supported when using Codex with a ChatGPT account/i.test(detail)) {
          void sendToAgent(target, prompt, { ...options, codexModelFallback: true })
            .then(reply => resolve(`설정된 Codex 모델을 사용할 수 없어 GPT-5.6 Terra로 대신 답했어요.\n\n${reply}`))
            .catch(fallbackError => reject(new Error(`Codex 설정 모델을 사용할 수 없고 대체 모델도 실패했어요. Codex에서 /model을 열어 계정에서 사용할 수 있는 모델을 선택해 주세요.\n${(fallbackError as Error).message || detail}`)));
          return;
        }
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

function claudeEnvironment(): NodeJS.ProcessEnv {
  const configured = process.env.CLAUDE_CODE_GIT_BASH_PATH;
  const candidates = [
    configured,
    process.env.ProgramFiles ? `${process.env.ProgramFiles}\\Git\\bin\\bash.exe` : undefined,
    process.env['ProgramFiles(x86)'] ? `${process.env['ProgramFiles(x86)']}\\Git\\bin\\bash.exe` : undefined,
  ];
  const gitBash = candidates.find(candidate => candidate && existsSync(candidate));
  return gitBash ? { ...process.env, CLAUDE_CODE_GIT_BASH_PATH: gitBash } : process.env;
}
