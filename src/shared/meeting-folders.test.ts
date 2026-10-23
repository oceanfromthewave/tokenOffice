import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meetingFoldersDiffer, normalizeMeetingFolder } from './meeting-folders.ts';

test('meeting folder comparison ignores path case, slash style, and trailing separators', () => {
  assert.equal(normalizeMeetingFolder('C:/dev/TokenOffice/'), normalizeMeetingFolder('c:\\DEV\\tokenoffice'));
  assert.equal(meetingFoldersDiffer([
    { name: '누리', cwd: 'C:/dev/TokenOffice/' },
    { name: '솔이', cwd: 'c:\\DEV\\tokenoffice' },
  ]), false);
});

test('meeting folder comparison detects sessions from different workspaces', () => {
  assert.equal(meetingFoldersDiffer([
    { name: '누리', cwd: 'C:\\dev\\tokenOffice' },
    { name: '삐삐', cwd: 'C:\\dev\\pkg2_term' },
  ]), true);
});

test('meeting folder comparison ignores missing paths while comparing known paths', () => {
  assert.equal(meetingFoldersDiffer([
    { name: '누리' },
    { name: '솔이', cwd: 'C:\\dev\\tokenOffice' },
  ]), false);
});
