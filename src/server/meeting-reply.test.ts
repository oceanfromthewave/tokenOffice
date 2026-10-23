import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMeetingReply } from './meeting-reply.ts';

test('removes Claude tool-call markup while preserving the spoken reply', () => {
  const reply = '확인해보겠습니다.\n<invoke name="Glob"><parameter name="pattern">*</parameter></invoke>\n다음 의견입니다.';
  assert.equal(cleanMeetingReply('claude', reply), '확인해보겠습니다.\n\n다음 의견입니다.');
});

test('removes a wrapped Claude function-call block', () => {
  const reply = '앞 문장\n<function_calls><invoke name="Glob">**</invoke></function_calls>\n뒷 문장';
  assert.equal(cleanMeetingReply('claude', reply), '앞 문장\n\n뒷 문장');
});

test('leaves non-Claude replies intact apart from surrounding whitespace', () => {
  const reply = '  <invoke name="Glob">*</invoke>  ';
  assert.equal(cleanMeetingReply('codex', reply), '<invoke name="Glob">*</invoke>');
});
