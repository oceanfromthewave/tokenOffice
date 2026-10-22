import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const host = '127.0.0.1';
const port = Number(process.env.TOKEN_OFFICE_PORT || 47821);
const agents = new Map();
const activity = [];
let hookSeen = false;
let eventCount = 0;
let toolCount = 0;
let turnCount = 0;

const safeText = (value, max = 80) => typeof value === 'string' ? value.slice(0, max) : '';
const sessionKey = (sessionId, agentId = '') => `${sessionId}:${agentId || 'main'}`;

function appendActivity(agent, event, toolName = '') {
  const labels = {
    SessionStart: '세션 시작',
    UserPromptSubmit: '새 작업 시작',
    PreToolUse: `${toolName || '도구'} 사용 시작`,
    PostToolUse: `${toolName || '도구'} 사용 완료`,
    Notification: '사용자 확인 대기',
    PermissionRequest: '권한 확인 대기',
    SubagentStart: `${agent.agentType || '서브에이전트'} 시작`,
    SubagentStop: `${agent.agentType || '서브에이전트'} 완료`,
    TeammateIdle: `${agent.name} 대기 중`,
    Stop: '응답 완료',
    StopFailure: '실행 중 오류',
    SessionEnd: '세션 종료',
  };
  activity.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: Date.now(),
    agent: agent.name,
    project: agent.project,
    text: labels[event] || '상태 업데이트',
    tool: toolName,
  });
  if (activity.length > 16) activity.length = 16;
}

function handleClaudeEvent(data) {
  const event = safeText(data.event, 48);
  const sessionId = safeText(data.sessionId, 100);
  const agentId = safeText(data.agentId, 100);
  if (!event || !sessionId) return false;

  hookSeen = true;
  eventCount += 1;
  const isSubagent = Boolean(agentId);
  const key = sessionKey(sessionId, agentId);
  const toolName = safeText(data.toolName, 60);

  if (event === 'SessionEnd' && !agentId) {
    for (const [id, agent] of agents) {
      if (agent.sessionId === sessionId) {
        appendActivity(agent, event);
        agents.delete(id);
      }
    }
    return true;
  }

  const previous = agents.get(key);
  const name = isSubagent
    ? safeText(data.agentType, 32) || safeText(data.teammateName, 32) || 'Claude subagent'
    : safeText(data.project, 48) || 'Claude Code';
  const agent = {
    id: key,
    sessionId,
    agentId,
    name,
    project: safeText(data.project, 48) || 'Claude Code',
    agentType: safeText(data.agentType, 32),
    state: previous?.state || 'break',
    tool: previous?.tool || '',
    isSubagent,
    startedAt: previous?.startedAt || Date.now(),
    updatedAt: Date.now(),
  };

  switch (event) {
    case 'SessionStart':
      agent.state = 'break';
      agent.tool = '';
      break;
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PostToolUse':
      agent.state = 'working';
      agent.tool = toolName || (event === 'UserPromptSubmit' ? '작업 준비 중' : agent.tool);
      if (event === 'PreToolUse') toolCount += 1;
      break;
    case 'Notification':
      if (data.notificationType === 'permission_prompt' || data.notificationType === 'elicitation_dialog') {
        agent.state = 'waiting';
      }
      break;
    case 'PermissionRequest':
      agent.state = 'waiting';
      break;
    case 'SubagentStart':
      agent.state = 'working';
      agent.agentType = safeText(data.agentType, 32);
      break;
    case 'SubagentStop':
      agent.state = 'done';
      agent.tool = '';
      break;
    case 'TeammateIdle':
      agent.state = 'break';
      break;
    case 'Stop':
      agent.state = 'break';
      agent.tool = '';
      if (!isSubagent) turnCount += 1;
      break;
    case 'StopFailure':
      agent.state = 'error';
      agent.tool = '';
      break;
  }

  agents.set(key, agent);
  appendActivity(agent, event, toolName);
  return true;
}

function cleanStaleAgents() {
  const now = Date.now();
  const cutoff = now - 4 * 60 * 60 * 1000;
  for (const [id, agent] of agents) {
    if (agent.updatedAt < cutoff || (agent.isSubagent && agent.state === 'done' && agent.updatedAt < now - 20_000)) {
      agents.delete(id);
    }
  }
}

function json(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

function isLoopbackRequest(request) {
  const address = request.socket.remoteAddress || '';
  const hostHeader = (request.headers.host || '').toLowerCase();
  const origin = request.headers.origin;
  const localAddress = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
  const localHost = hostHeader === `127.0.0.1:${port}` || hostHeader === `localhost:${port}`;
  const localOrigin = !origin || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
  return localAddress && localHost && localOrigin;
}

async function readJson(request, limit = 24_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('payload too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (request, response) => {
  if (!isLoopbackRequest(request)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Local requests only');
    return;
  }

  const url = new URL(request.url || '/', `http://${host}:${port}`);
  if (request.method === 'GET' && url.pathname === '/api/state') {
    cleanStaleAgents();
    const currentAgents = [...agents.values()].sort((a, b) => a.startedAt - b.startedAt);
    json(response, 200, {
      connected: hookSeen,
      agents: currentAgents,
      activity: activity.slice(0, 8),
      metrics: { events: eventCount, tools: toolCount, turns: turnCount },
      updatedAt: Date.now(),
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/hooks/claude') {
    try {
      const data = await readJson(request);
      if (!handleClaudeEvent(data)) {
        json(response, 400, { error: 'Invalid Claude Code hook event' });
        return;
      }
      json(response, 202, { accepted: true });
    } catch {
      json(response, 400, { error: 'Invalid or oversized request' });
    }
    return;
  }

  const staticFiles = {
    '/': ['index.html', 'text/html'],
    '/index.html': ['index.html', 'text/html'],
    '/styles.css': ['styles.css', 'text/css'],
    '/sprites.css': ['sprites.css', 'text/css'],
    '/app.js': ['app.js', 'text/javascript'],
  };
  if (request.method === 'GET' && url.pathname === '/fonts/Galmuri14.woff2') {
    try {
      const font = await readFile(join(root, 'fonts', 'Galmuri14.woff2'));
      response.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'max-age=86400', 'X-Content-Type-Options': 'nosniff' });
      response.end(font);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
    return;
  }

  if (request.method === 'GET' && staticFiles[url.pathname]) {
    const [file, type] = staticFiles[url.pathname];
    try {
      const html = await readFile(join(root, file));
      response.writeHead(200, {
        'Content-Type': `${type}; charset=utf-8`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(html);
    } catch {
      response.writeHead(500);
      response.end('Could not load tokenOffice');
    }
    return;
  }

  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Not found');
});

server.listen(port, host, () => {
  console.log(`tokenOffice is running at http://${host}:${port}`);
  console.log('Claude Code hook events stay on this computer and are held in memory.');
});

server.on('error', error => {
  console.error(`tokenOffice could not start: ${error.message}`);
  process.exitCode = 1;
});
