import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockAngles } from './clock.ts';

test('clock hands point to the expected marks at 12:30', () => {
  const angles = clockAngles(new Date(2026, 0, 1, 12, 30, 0));
  assert.equal(angles.hour, Math.PI / 12);
  assert.equal(angles.minute, Math.PI);
  assert.equal(angles.second, 0);
});

test('hour and minute hands move continuously while the second hand ticks once per second', () => {
  const first = clockAngles(new Date(2026, 0, 1, 12, 30, 1, 100));
  const next = clockAngles(new Date(2026, 0, 1, 12, 30, 2, 100));
  const fraction = clockAngles(new Date(2026, 0, 1, 12, 30, 1, 900));
  assert.ok(next.hour > first.hour);
  assert.ok(next.minute > first.minute);
  assert.equal(next.second - first.second, Math.PI / 30);
  assert.ok(fraction.minute > first.minute);
  assert.equal(fraction.second, first.second);
});
