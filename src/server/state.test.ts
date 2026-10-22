import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OfficeState } from './state.ts';

test('a tool call puts the session to work and a stop sends it on a break', () => {
  const office = new OfficeState();
  assert.equal(office.handle({ event: 'PreToolUse', sessionId: 's1', project: 'demo', toolName: 'Bash' }, 1000), true);
  let [agent] = office.snapshot(1000).agents;
  assert.equal(agent?.state, 'working');
  assert.equal(agent?.tool, 'Bash');

  office.handle({ event: 'Stop', sessionId: 's1' }, 2000);
  [agent] = office.snapshot(2000).agents;
  assert.equal(agent?.state, 'break');
  assert.equal(office.snapshot(2000).metrics.turns, 1);
});

test('subagents are separate agents and leave 20s after they finish', () => {
  const office = new OfficeState();
  office.handle({ event: 'SubagentStart', sessionId: 's1', agentId: 'a1', agentType: 'Explore' }, 0);
  assert.equal(office.snapshot(0).agents[0]?.isSubagent, true);
  office.handle({ event: 'SubagentStop', sessionId: 's1', agentId: 'a1' }, 1000);
  assert.equal(office.snapshot(10_000).agents.length, 1);
  assert.equal(office.snapshot(30_000).agents.length, 0);
});

test('session end keeps the main agent seated and removes its subagents; junk is rejected', () => {
  const office = new OfficeState();
  office.handle({ event: 'PreToolUse', sessionId: 's1' }, 0);
  office.handle({ event: 'SubagentStart', sessionId: 's1', agentId: 'a1' }, 0);
  office.handle({ event: 'SessionEnd', sessionId: 's1' }, 0);
  const agents = office.snapshot(0).agents;
  assert.equal(agents.length, 1);
  assert.equal(agents[0]?.isSubagent, false);
  assert.equal(agents[0]?.state, 'break');
  assert.equal(office.handle({ event: 42, sessionId: 's1' }), false);
  assert.equal(office.handle({ event: 'Stop' }), false);
});
