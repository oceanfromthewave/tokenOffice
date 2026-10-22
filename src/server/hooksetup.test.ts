import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOOK_EVENTS, isConnected, withHooks, withoutHooks, type Settings } from './hooksetup.ts';

const other = { hooks: [{ type: 'command', command: 'echo hi' }] };
const existing: Settings = { model: 'sonnet', hooks: { Stop: [other], PreToolUse: [other] } };

test('connecting adds one entry per event and keeps everything else', () => {
  const next = withHooks(existing, 'C:\\Users\\me\\.claude\\hooks\\token-office.cjs');
  assert.equal(next.model, 'sonnet');
  assert.ok(isConnected(next));
  for (const event of HOOK_EVENTS) assert.equal(next.hooks?.[event]?.filter(g => g !== other).length, 1, event);
  assert.deepEqual(next.hooks?.Stop?.[0], other, 'the user\'s own Stop hook is untouched');
  assert.deepEqual(next.hooks?.PreToolUse?.[1]?.hooks?.[0]?.args, ['C:/Users/me/.claude/hooks/token-office.cjs']);
  assert.equal(next.hooks?.Notification?.[0]?.matcher, 'permission_prompt');
});

test('connecting twice does not duplicate', () => {
  const twice = withHooks(withHooks(existing, '/a/token-office.cjs'), '/b/token-office.cjs');
  assert.equal(twice.hooks?.SessionEnd?.length, 1);
  assert.deepEqual(twice.hooks?.SessionEnd?.[0]?.hooks?.[0]?.args, ['/b/token-office.cjs']);
});

test('disconnecting restores the original settings exactly', () => {
  const back = withoutHooks(withHooks(existing, '/a/token-office.cjs'));
  assert.deepEqual(back, existing);
  assert.equal(isConnected(back), false);
  assert.deepEqual(withoutHooks(withHooks({}, '/a/token-office.cjs')), {});
});
