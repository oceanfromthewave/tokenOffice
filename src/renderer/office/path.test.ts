import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corners, findPath, type WalkGrid } from './path.ts';

// 10x6 room with a wall at x = 5 that has a gap only at y = 5
const wall: WalkGrid = { cols: 10, rows: 6, blocked: (x, y) => x === 5 && y !== 5 };

test('routes around a wall through the only gap', () => {
  const path = findPath(wall, { x: 0, y: 0 }, { x: 9, y: 0 });
  assert.ok(path);
  assert.ok(path.some(c => c.x === 5 && c.y === 5), 'goes through the gap');
  assert.ok(path.every(c => !(c.x === 5 && c.y !== 5)), 'never enters the wall');
  for (let i = 1; i < path.length; i++) {
    const step = Math.abs(path[i]!.x - path[i - 1]!.x) + Math.abs(path[i]!.y - path[i - 1]!.y);
    assert.equal(step, 1, 'moves one cell at a time, no diagonals');
  }
});

test('prefers few turns: open floor gives an L, not a staircase', () => {
  const open: WalkGrid = { cols: 20, rows: 20, blocked: () => false };
  const path = findPath(open, { x: 0, y: 0 }, { x: 12, y: 9 });
  assert.ok(path);
  assert.equal(path.length, 22);
  assert.equal(corners(path).length, 3);
});

test('unreachable goal returns null; blocked start and goal are allowed', () => {
  const sealed: WalkGrid = { cols: 10, rows: 6, blocked: x => x === 5 };
  assert.equal(findPath(sealed, { x: 0, y: 0 }, { x: 9, y: 0 }), null);
  const desk: WalkGrid = { cols: 5, rows: 1, blocked: x => x === 0 || x === 4 };
  assert.equal(findPath(desk, { x: 0, y: 0 }, { x: 4, y: 0 })?.length, 5);
});
