// Local-only HTTP server: receives Claude Code hook events and serves the built dashboard.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  const server = createServer(async (request, response) => {
    if (!isLocal(request, port)) return send(response, 403, 'Local requests only', 'text/plain; charset=utf-8');
    const { pathname } = new URL(request.url ?? '/', `http://${HOST}:${port}`);

    if (request.method === 'GET' && pathname === '/api/state') return json(response, 200, office.snapshot());
    if (request.method === 'POST' && pathname === '/api/hooks/claude') {
      try {
        const data = await readJson(request);
        const ok = typeof data === 'object' && data !== null && office.handle(data);
        return ok ? json(response, 202, { accepted: true }) : json(response, 400, { error: 'Invalid Claude Code hook event' });
      } catch {
        return json(response, 400, { error: 'Invalid or oversized request' });
      }
    }
    if (request.method === 'GET') return serveStatic(pathname, response);
    send(response, 405, 'Method not allowed', 'text/plain; charset=utf-8');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      console.log(`tokenOffice is running at http://${HOST}:${port}`);
      console.log('Claude Code hook events stay on this computer and are held in memory.');
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
