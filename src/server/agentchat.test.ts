import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeMeetingArgs } from './agentchat.ts';

test('Claude meetings allow only the read-only project file tools', () => {
  const args = claudeMeetingArgs();
  const toolIndex = args.indexOf('--tools');
  assert.notEqual(toolIndex, -1);
  assert.equal(args[toolIndex + 1], 'Glob,Grep,Read,LS');
  assert.ok(args.includes('--no-session-persistence'));
  assert.ok(!args.includes('Bash'));
  assert.ok(!args.includes('Edit'));
  assert.ok(!args.includes('Write'));
});
