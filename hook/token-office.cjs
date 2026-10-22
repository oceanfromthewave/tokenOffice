const path = require('node:path');

// Tool inputs (e.g. a Write of a big file) can be large; only a few small fields are forwarded, but the JSON must parse.
const MAX_INPUT = 8_000_000;
const chunks = [];
let size = 0;

process.stdin.on('data', chunk => {
  size += chunk.length;
  if (size > MAX_INPUT) process.exit(0);
  chunks.push(chunk);
});

process.stdin.on('end', async () => {
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const event = {
      event: input.hook_event_name,
      sessionId: input.session_id,
      project: input.cwd ? path.basename(input.cwd) : '',
      toolName: input.tool_name,
      agentId: input.agent_id,
      agentType: input.agent_type,
      teammateName: input.teammate_name,
      notificationType: input.notification_type,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 900);
    await fetch('http://127.0.0.1:47821/api/hooks/claude', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      signal: controller.signal,
    }).catch(() => {});
    clearTimeout(timeout);
  } catch {
    // Monitoring is best-effort and must never interrupt the Claude Code session.
  }
});
