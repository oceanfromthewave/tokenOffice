import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellOf, DESKS, DOOR, LOUNGE, MEETING_SEATS, OVERFLOW, VENDING_SPOT, walkGrid } from './layout.ts';
import { findPath } from './path.ts';

const allowed = (...spots: { band: number }[]) => new Set(spots.map(s => s.band).filter(b => b >= 0));

test('every desk and lounge spot can be reached from the door', () => {
  for (const spot of [...DESKS, ...LOUNGE, ...OVERFLOW]) {
    const path = findPath(walkGrid(allowed(spot)), cellOf(DOOR), cellOf(spot));
    assert.ok(path, `no route from the door to ${spot.kind} at ${spot.x},${spot.y}`);
  }
});

test('every spot someone can stand or sit at is a free cell, not one that furniture covers', () => {
  for (const spot of [...DESKS, ...LOUNGE, ...OVERFLOW, ...MEETING_SEATS, VENDING_SPOT]) {
    const c = cellOf(spot);
    assert.ok(!walkGrid(allowed(spot)).blocked(c.x, c.y), `${spot.kind} spot at ${spot.x},${spot.y} sits inside furniture`);
  }
});

test('the vending machine and the meeting room can be reached from the door', () => {
  for (const spot of [VENDING_SPOT, ...MEETING_SEATS]) {
    assert.ok(findPath(walkGrid(allowed(spot)), cellOf(DOOR), cellOf(spot)), `no route to ${spot.kind} at ${spot.x},${spot.y}`);
  }
});

test('every desk reaches its own lounge spot while other desks stay closed', () => {
  DESKS.forEach((desk, i) => {
    const spot = LOUNGE[i]!;
    // the grid only opens this desk's seat band (and the sofa's), so a route here can't cut through a colleague's chair
    const path = findPath(walkGrid(allowed(desk, spot)), cellOf(desk), cellOf(spot));
    assert.ok(path, `desk ${i} can't reach its lounge spot`);
    assert.ok(path.length < 200, `desk ${i} takes a ${path.length}-cell detour`);
  });
});

test('nobody can stand close enough beside furniture for their shoulders to clip it', () => {
  const grid = walkGrid(new Set());
  const blockedAt = (x: number, y: number) => { const c = cellOf({ x, y }); return grid.blocked(c.x, c.y); };
  assert.ok(blockedAt(167, 76), 'left of the water cooler');
  assert.ok(blockedAt(240 - 4, 76), 'right of the vending machine');
  assert.ok(blockedAt(174, 60), 'behind the water cooler');
  assert.ok(blockedAt(DESKS[0]!.x + 22, DESKS[0]!.y + 4), 'beside a desk');
  assert.ok(!blockedAt(DESKS[0]!.x + 26, DESKS[0]!.y + 4), 'the gap between desks stays open');
});

test('lounge seats are distinct: a body width apart along a row, and the armchair row sits a full step behind the sofa', () => {
  for (const a of LOUNGE) for (const b of LOUNGE) {
    if (a === b) continue;
    assert.ok(Math.abs(a.x - b.x) >= 14 || Math.abs(a.y - b.y) >= 18, `${a.x},${a.y} crowds ${b.x},${b.y}`);
  }
});
