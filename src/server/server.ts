// Local-only HTTP server: receives Claude Code and Codex hook events and serves the built dashboard.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sendToAgent } from './agentchat.ts';
import { connectHooks, disconnectHooks, setupStatus } from './hooksetup.ts';
import { codexSetupStatus, connectCodexHooks, disconnectCodexHooks } from './codex-hooksetup.ts';
import { OfficeState } from './state.ts';

export const HOST = '127.0.0.1';
export const DEFAULT_PORT = 47821;
const WEB_ROOT = fileURLToPath(new URL('../web/', import.meta.url));
const MAX_BODY = 24_000;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function send(response: ServerResponse, status: number, body: string | Buffer, type: string, cache = 'no-store') {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
  response.end(body);
}
const json = (response: ServerResponse, status: number, payload: unknown) => send(response, status, JSON.stringify(payload), 'application/json; charset=utf-8');

/** Only this computer, addressed by its loopback name, from our own page (or no page at all, like the hook). */
function isLocal(request: IncomingMessage, port: number): boolean {
  const address = request.socket.remoteAddress ?? '';
  const host = (request.headers.host ?? '').toLowerCase();
  const origin = request.headers.origin;
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)
    && allowedHosts.includes(host)
    && (!origin || allowedHosts.some(h => origin === `http://${h}`));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('payload too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function serveStatic(pathname: string, response: ServerResponse) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = normalize(join(WEB_ROOT, relative));
  const type = TYPES[extname(file)];
  if (!file.startsWith(WEB_ROOT.endsWith(sep) ? WEB_ROOT : WEB_ROOT + sep) || !type) return send(response, 404, 'Not found', 'text/plain; charset=utf-8');
  try {
    // Vite fingerprints everything under assets/, so those can be cached; the page itself must not be.
    const cache = relative.startsWith('assets/') || relative.startsWith('fonts/') ? 'public, max-age=31536000, immutable' : 'no-store';
    send(response, 200, await readFile(file), type, cache);
  } catch {
    send(response, 404, 'Not found', 'text/plain; charset=utf-8');
  }
}

export function startServer(port = Number(process.env.TOKEN_OFFICE_PORT) || DEFAULT_PORT): Promise<Server> {
  const office = new OfficeState();
  const pendingChats = new Set<string>();
  const server = createServer(async (request, response) => {
    if (!isLocal(request, port)) return send(response, 403, 'Local requests only', 'text/plain; charset=utf-8');
    const { pathname } = new URL(request.url ?? '/', `http://${HOST}:${port}`);

    if (request.method === 'GET' && pathname === '/api/state') return json(response, 200, office.snapshot());
    if (request.method === 'GET' && pathname === '/api/chat') {
      const agentId = new URL(request.url ?? '/', `http://${HOST}:${port}`).searchParams.get('agentId') ?? '';
      if (!office.chatTarget(agentId)) return json(response, 404, { error: '에이전트를 찾을 수 없어요.' });
      return json(response, 200, { messages: office.chatHistory(agentId) });
    }
    if (request.method === 'POST' && pathname === '/api/chat') {
      try {
        const payload = await readJson(request);
        if (!payload || typeof payload !== 'object') return json(response, 400, { error: '메시지 형식이 올바르지 않아요.' });
        const data = payload as { agentId?: unknown; text?: unknown };
        const agentId = typeof data.agentId === 'string' ? data.agentId.slice(0, 220) : '';
        const message = typeof data.text === 'string' ? data.text.trim() : '';
        if (!agentId || !message || message.length > 4000) return json(response, 400, { error: '메시지를 1~4000자 사이로 입력해 주세요.' });
        const target = office.chatTarget(agentId);
        if (!target) return json(response, 404, { error: '에이전트를 찾을 수 없어요.' });
        if (target.isSubagent) return json(response, 400, { error: '서브에이전트는 별도 세션으로 메시지를 보낼 수 없어요.' });
        if (target.state === 'working' || target.state === 'waiting') return json(response, 409, { error: '에이전트가 현재 작업 중이에요. 작업이 끝난 뒤 다시 보내 주세요.' });
        if (pendingChats.has(agentId)) return json(response, 409, { error: '이 에이전트가 이전 메시지에 답하는 중이에요.' });
        if (!target.cwd) return json(response, 409, { error: '프로젝트 경로를 몰라 세션을 재개할 수 없어요. CLI에서 세션을 한 번 더 실행해 주세요.' });

        const assistantId = office.startChat(agentId, message);
        pendingChats.add(agentId);
        void sendToAgent(target, message)
          .then(reply => office.finishChat(agentId, assistantId, reply))
          .catch(error => office.finishChat(agentId, assistantId, (error as Error).message, true))
          .finally(() => pendingChats.delete(agentId));
        return json(response, 202, { accepted: true, assistantId });
      } catch {
        return json(response, 400, { error: '메시지를 처리하지 못했어요.' });
      }
    }
    if (request.method === 'POST' && pathname === '/api/hooks/claude') {
      try {
        const data = await readJson(request);
        const ok = typeof data === 'object' && data !== null && office.handle(data);
        return ok ? json(response, 202, { accepted: true }) : json(response, 400, { error: 'Invalid Claude Code hook event' });
      } catch {
        return json(response, 400, { error: 'Invalid or oversized request' });
      }
    }
    if (request.method === 'POST' && pathname === '/api/hooks/codex') {
      try {
        const data = await readJson(request);
        const ok = typeof data === 'object' && data !== null && office.handle({ ...data, provider: 'codex' });
        return ok ? json(response, 202, { accepted: true }) : json(response, 400, { error: 'Invalid Codex hook event' });
      } catch {
        return json(response, 400, { error: 'Invalid or oversized request' });
      }
    }
    // Provider connection endpoints update only tokenOffice's entries in each tool's user settings.
    if (request.method === 'GET' && pathname === '/api/setup') return json(response, 200, await setupStatus());
    if (request.method === 'GET' && pathname === '/api/setup/codex') return json(response, 200, await codexSetupStatus());
    if (request.method === 'POST' && (pathname === '/api/setup/connect' || pathname === '/api/setup/disconnect')) {
      try {
        return json(response, 200, await (pathname.endsWith('/connect') ? connectHooks() : disconnectHooks()));
      } catch (error) {
        return json(response, 500, { error: (error as Error).message });
      }
    }
    if (request.method === 'POST' && (pathname === '/api/setup/codex/connect' || pathname === '/api/setup/codex/disconnect')) {
      try {
        return json(response, 200, await (pathname.endsWith('/connect') ? connectCodexHooks() : disconnectCodexHooks()));
      } catch (error) {
        return json(response, 500, { error: (error as Error).message });
      }
    }
    if (request.method === 'GET') return serveStatic(pathname, response);
    send(response, 405, 'Method not allowed', 'text/plain; charset=utf-8');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      console.log(`tokenOffice is running at http://${HOST}:${port}`);
      console.log('Claude Code and Codex hook events stay on this computer and are held in memory.');
      resolve(server);
    });
  });
}

// `node out/server/server.js` runs it standalone; Electron imports it instead.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((error: Error) => {
    console.error(`tokenOffice could not start: ${error.message}`);
    process.exitCode = 1;
  });
}
