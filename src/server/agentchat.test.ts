import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeChatArgs, claudeMeetingArgs, codexChatArgs } from './agentchat.ts';

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

test('Claude agent chat allows file edits in the resumed project session', () => {
  const args = claudeChatArgs('session-id');
  assert.ok(args.includes('--permission-mode'));
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'acceptEdits');
  assert.ok(args.includes('--resume'));
  assert.ok(!args.includes('--dangerously-skip-permissions'));
});

test('Codex agent chat enables writes only in the session project workspace', () => {
  const args = codexChatArgs('session-id', 'C:\\dev\\tokenOffice');
  assert.ok(args.includes('--sandbox'));
  assert.equal(args[args.indexOf('--sandbox') + 1], 'workspace-write');
  assert.ok(args.includes('--cd'));
  assert.equal(args[args.indexOf('--cd') + 1], 'C:\\dev\\tokenOffice');
  assert.ok(args.includes('resume'));
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
});
