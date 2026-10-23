import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Crowd, type OfficeAgent } from './crowd.ts';
import { cellOf, DESKS, LOUNGE, walkGrid } from './layout.ts';

const people: OfficeAgent[] = ['momo', 'lumi', 'tori', 'koko'].map(id => ({ id, name: id, look: id as OfficeAgent['look'], state: 'working', tool: 'Edit', isSubagent: false }));

/** Seat bands each person has sat in (per crowd), so the furniture check knows which chairs they may leave. */
const sat = new WeakMap<Crowd, Map<string, Set<number>>>();
function remember(crowd: Crowd) {
  const book = sat.get(crowd) ?? new Map<string, Set<number>>();
  sat.set(crowd, book);
  for (const w of crowd.walkers.values()) {
    if (!w.route.length && w.at && w.at.band >= 0) book.set(w.agent.id, (book.get(w.agent.id) ?? new Set<number>()).add(w.at.band));
  }
  return book;
}

/** Places everyone instantly (no walking) and remembers where they sit. */
function seat(crowd: Crowd, agents: OfficeAgent[]) {
  crowd.setAgents(agents, true);
  remember(crowd);
}

/**
 * Runs the crowd for `seconds` and checks every frame that nobody stands inside furniture.
 * A walker may only be inside seat bands it has sat in or is heading to; every other desk and chair stays closed.
 */
function run(crowd: Crowd, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 30) {
    crowd.update(1 / 30);
    const book = remember(crowd);
    for (const w of crowd.walkers.values()) {
      if (!w.route.length) continue;
      const bands = [...(book.get(w.agent.id) ?? []), w.desk, w.target?.band].filter((b): b is number => b !== undefined && b >= 0);
      const c = cellOf(w);
      assert.ok(!walkGrid(new Set(bands)).blocked(c.x, c.y), `${w.agent.id} walked into furniture at ${w.x.toFixed(1)},${w.y.toFixed(1)}`);
    }
  }
}

test('everyone walks from their desk to their own lounge spot and back, around the furniture', () => {
  const crowd = new Crowd();
  seat(crowd, people);
  people.forEach((p, i) => assert.equal(crowd.walkers.get(p.id)?.at, DESKS[i]));

  // resting people stop at the vending machine one at a time before settling in the lounge
  crowd.setAgents(people.map(p => ({ ...p, state: 'break' })));
  run(crowd, 90);
  const spots = people.map(p => crowd.walkers.get(p.id)!.at);
  assert.deepEqual(spots, LOUNGE.slice(0, 4));

  crowd.setAgents(people);
  run(crowd, 60);
  people.forEach((p, i) => assert.equal(crowd.walkers.get(p.id)?.at, DESKS[i], `${p.id} made it back`));
});

test('a helper robot walks in from the door, works, and leaves when it is removed', () => {
  const crowd = new Crowd();
  const helper: OfficeAgent = { id: 'bot', name: 'Explore', look: 'bot', state: 'working', tool: 'Grep', isSubagent: true };
  crowd.setAgents([helper]);
  run(crowd, 20);
  assert.equal(crowd.walkers.get('bot')?.at, DESKS[0]);
  crowd.setAgents([]);
  run(crowd, 20);
  assert.equal(crowd.walkers.size, 0);
});

test('a finished subagent walks out the door and does not hang around while the server still lists it', () => {
  const crowd = new Crowd();
  const helper: OfficeAgent = { id: 'bot', name: 'Explore', look: 'bot', state: 'working', tool: 'Grep', isSubagent: true };
  crowd.setAgents([helper]);
  run(crowd, 20);
  const done = { ...helper, state: 'done' as const };
  crowd.setAgents([done]);
  run(crowd, 20);
  assert.equal(crowd.walkers.size, 0, 'gone once it reached the door');
  crowd.setAgents([done]);
  assert.equal(crowd.walkers.size, 0, 'not brought back by the next poll');
  crowd.setAgents([{ ...helper, id: 'late', state: 'done' }]);
  assert.equal(crowd.walkers.size, 0, 'one that finished before we ever saw it never appears');
});

test('nobody ends up standing on top of anybody else', () => {
  const crowd = new Crowd();
  const six = Array.from({ length: 6 }, (_, i): OfficeAgent => ({ id: `a${i}`, name: `a${i}`, look: 'momo', state: 'working', tool: '', isSubagent: false }));
  seat(crowd, six);
  crowd.setAgents(six.map(a => ({ ...a, state: 'break' })));
  run(crowd, 120);
  const settled = [...crowd.walkers.values()];
  assert.ok(settled.every(w => w.at && !w.route.length), 'everyone arrived');
  for (const a of settled) for (const b of settled) {
    // the lounge has two rows (sofa, then armchairs behind it) that are 18px apart by design
    if (a !== b) assert.ok(Math.abs(a.x - b.x) >= 14 || Math.abs(a.y - b.y) >= 18, `${a.agent.id} and ${b.agent.id} overlap`);
  }
});

const many = (n: number) => Array.from({ length: n }, (_, i): OfficeAgent => ({ id: `w${i}`, name: `w${i}`, look: 'tori', state: 'working', tool: 'Edit', isSubagent: false }));

test('ten people: the extra four wait in the aisle, nobody overlaps or clips furniture', () => {
  const crowd = new Crowd();
  crowd.setAgents(many(10));
  run(crowd, 40);
  const all = [...crowd.walkers.values()];
  assert.ok(all.every(w => w.at && !w.route.length), 'everyone arrived');
  assert.equal(all.filter(w => w.at?.kind === 'stand').length, 4);
  for (const a of all) for (const b of all) {
    if (a !== b) assert.ok(!(Math.abs(a.x - b.x) < 14 && Math.abs(a.y - b.y) < 20), `${a.agent.id} and ${b.agent.id} overlap`);
  }
});

test('when desk holders leave, the people waiting take their desks', () => {
  const crowd = new Crowd();
  const eight = many(8);
  seat(crowd, eight);
  const waiting = eight.slice(6).map(a => crowd.walkers.get(a.id)!);
  assert.ok(waiting.every(w => w.desk === -1 && w.at?.kind === 'stand'));
  crowd.setAgents(eight.slice(2)); // w0 and w1 go home
  run(crowd, 30);
  assert.deepEqual(waiting.map(w => w.at), [DESKS[0], DESKS[1]]);
  assert.ok(waiting.every(w => w.spare === -1));
});
