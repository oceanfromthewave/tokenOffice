import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Crowd, type OfficeAgent } from './crowd.ts';
import { cellOf, DESKS, LOUNGE, SOFA_BAND, walkGrid } from './layout.ts';

const people: OfficeAgent[] = ['momo', 'lumi', 'tori', 'koko'].map(id => ({ id, name: id, look: id as OfficeAgent['look'], state: 'working', tool: 'Edit', isSubagent: false }));

/** Runs the crowd for `seconds` and checks every frame that nobody stands inside furniture. */
function run(crowd: Crowd, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 30) {
    crowd.update(1 / 30);
    for (const w of crowd.walkers.values()) {
      if (!w.route.length) continue;
      const grid = walkGrid(new Set([w.desk, SOFA_BAND]));
      const c = cellOf(w);
      assert.ok(!grid.blocked(c.x, c.y), `${w.agent.id} walked into furniture at ${w.x.toFixed(1)},${w.y.toFixed(1)}`);
    }
  }
}

test('everyone walks from their desk to their own lounge spot and back, around the furniture', () => {
  const crowd = new Crowd();
  crowd.setAgents(people, true);
  people.forEach((p, i) => assert.equal(crowd.walkers.get(p.id)?.at, DESKS[i]));

  crowd.setAgents(people.map(p => ({ ...p, state: 'break' })));
  run(crowd, 30);
  const spots = people.map(p => crowd.walkers.get(p.id)!.at);
  assert.deepEqual(spots, LOUNGE.slice(0, 4));

  crowd.setAgents(people);
  run(crowd, 30);
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

test('nobody ends up standing on top of anybody else', () => {
  const crowd = new Crowd();
  const six = Array.from({ length: 6 }, (_, i): OfficeAgent => ({ id: `a${i}`, name: `a${i}`, look: 'momo', state: 'working', tool: '', isSubagent: false }));
  crowd.setAgents(six, true);
  crowd.setAgents(six.map(a => ({ ...a, state: 'break' })));
  run(crowd, 40);
  const settled = [...crowd.walkers.values()];
  assert.ok(settled.every(w => w.at && !w.route.length), 'everyone arrived');
  for (const a of settled) for (const b of settled) {
    if (a !== b) assert.ok(Math.abs(a.x - b.x) >= 14 || Math.abs(a.y - b.y) >= 20, `${a.agent.id} and ${b.agent.id} overlap`);
  }
});
