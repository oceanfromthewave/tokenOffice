// Who is where, and how they get around. No drawing here, so it runs (and is tested) without a browser.
import type { Facing, Look } from '../../shared/pixels.ts';
import type { AgentState } from '../../shared/types.ts';
import { BODY_HALF, CELL, cellOf, DESKS, DOOR, LOUNGE, OVERFLOW, pointOf, SOFA_BAND, walkGrid, type Point, type Spot } from './layout.ts';
import { corners, findPath, type WalkGrid } from './path.ts';

export interface OfficeAgent {
  id: string;
  name: string;
  look: Look;
  state: AgentState;
  tool: string;
  isSubagent: boolean;
}

export interface Walker {
  agent: OfficeAgent;
  x: number;
  y: number;
  route: Point[];
  target: Spot | null; // null = heading for the door
  at: Spot | null; // where they are settled, if anywhere
  facing: Facing;
  desk: number; // -1 when every desk is taken
  spare: number; // overflow spot while waiting for a desk, else -1
  leaving: boolean;
  t: number;
  waited: number; // seconds spent letting someone pass
}

export const WALK_SPEED = 40; // art pixels per second
const MAX_WAIT = 0.8;

export class Crowd {
  readonly walkers = new Map<string, Walker>();
  /** Finished subagents that already walked out; the server keeps reporting them for a while, so don't bring them back. */
  private departed = new Set<string>();
  /** When true, people appear at their destination instead of walking (reduced motion). */
  instant: () => boolean;

  constructor(instant: () => boolean = () => false) {
    this.instant = instant;
  }

  /** Syncs with the current agents. `instant` places everyone without walking (first paint). */
  setAgents(agents: OfficeAgent[], instant = false) {
    const ids = new Set(agents.map(a => a.id));
    const finished = (a: OfficeAgent) => a.isSubagent && a.state === 'done';
    for (const id of this.departed) if (!agents.some(a => a.id === id && finished(a))) this.departed.delete(id);
    for (const w of this.walkers.values()) {
      if (!ids.has(w.agent.id) && !w.leaving) { w.leaving = true; this.send(w, null, instant); }
    }
    // a desk (or overflow spot) is free once nobody who is staying holds it
    const staying = [...this.walkers.values()].filter(w => !w.leaving);
    const desks = new Set(staying.map(w => w.desk));
    const spares = new Set(staying.map(w => w.spare));
    const free = (spots: Spot[], taken: Set<number>) => spots.findIndex((_, i) => !taken.has(i));
    for (const agent of agents) {
      let w = this.walkers.get(agent.id);
      if (!w && (this.departed.has(agent.id) || finished(agent))) { this.departed.add(agent.id); continue; } // already gone, or done before we ever saw it
      if (!w) {
        const desk = free(DESKS, desks);
        const spare = desk < 0 ? free(OVERFLOW, spares) : -1;
        desks.add(desk); spares.add(spare);
        w = { agent, x: DOOR.x, y: DOOR.y, route: [], target: null, at: null, facing: 'down', desk, spare, leaving: false, t: Math.random() * 10, waited: 0 };
        this.walkers.set(agent.id, w);
      } else if (w.desk < 0 && !w.leaving) {
        // someone waiting in the aisle moves up to a desk as soon as one frees
        const desk = free(DESKS, desks);
        if (desk >= 0) { desks.add(desk); spares.delete(w.spare); w.desk = desk; w.spare = -1; }
      }
      w.agent = agent;
      if (w.leaving) continue;
      const goal = this.goalFor(w);
      if (goal !== w.target || (!w.route.length && w.at !== goal)) this.send(w, goal, instant);
    }
  }

  /** The person settled at a desk, if any. */
  occupant(desk: Spot): Walker | undefined {
    for (const w of this.walkers.values()) if (w.at === desk && !w.route.length) return w;
    return undefined;
  }

  update(dt: number) {
    for (const w of this.walkers.values()) {
      w.t += dt;
      if (w.route.length && w.waited < MAX_WAIT && this.blockedAhead(w)) { w.waited += dt; continue; }
      if (!this.blockedAhead(w)) w.waited = 0;
      let step = WALK_SPEED * dt;
      while (step > 0 && w.route.length) {
        const next = w.route[0]!;
        const dx = next.x - w.x, dy = next.y - w.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.01) w.facing = Math.abs(dy) > Math.abs(dx) ? (dy < 0 ? 'up' : 'down') : dx < 0 ? 'left' : 'right';
        if (dist <= step) {
          w.x = next.x; w.y = next.y; w.route.shift(); step -= dist;
          if (!w.route.length) this.arrive(w);
        } else {
          w.x += (dx / dist) * step; w.y += (dy / dist) * step; step = 0;
        }
      }
    }
  }

  private goalFor(w: Walker): Spot | null {
    const { state, isSubagent } = w.agent;
    if (isSubagent && state === 'done') return null; // finished helpers head out
    if (w.desk < 0) return OVERFLOW[w.spare] ?? OVERFLOW[OVERFLOW.length - 1]!; // ponytail: >12 agents share the last spot
    const atDesk = state === 'working' || state === 'waiting' || state === 'error';
    return atDesk ? DESKS[w.desk]! : LOUNGE[w.desk]!;
  }

  private send(w: Walker, goal: Spot | null, instant: boolean) {
    w.target = goal;
    const end: Point = goal ?? DOOR;
    const place = () => { w.x = end.x; w.y = end.y; w.route = []; this.arrive(w); };
    if (instant || this.instant()) return place();
    const bands = new Set<number>();
    if (w.desk >= 0) bands.add(w.desk);
    if (goal?.band === SOFA_BAND || w.at?.band === SOFA_BAND) bands.add(SOFA_BAND);
    const path = findPath(this.gridAround(w, bands), cellOf(w), cellOf(end));
    w.at = null;
    if (!path) return place();
    w.route = [...corners(path).slice(1).map(pointOf), end];
  }

  /** The floor grid, plus a body-sized patch around everyone standing still, so routes go around them. */
  private gridAround(self: Walker, bands: Set<number>): WalkGrid {
    const base = walkGrid(bands);
    const people = [...this.walkers.values()].filter(o => o !== self && !o.route.length && o.at?.kind === 'stand');
    return {
      ...base,
      blocked: (x, y) => base.blocked(x, y) || people.some(o => Math.abs(x * CELL + 1 - o.x) <= BODY_HALF * 2 && Math.abs(y * CELL + 1 - o.y) <= 3),
    };
  }

  private arrive(w: Walker) {
    w.facing = 'down';
    // reaching the door means leaving: either the agent is gone, or it's a finished subagent heading out
    if (w.leaving || !w.target) {
      this.walkers.delete(w.agent.id);
      if (!w.leaving) this.departed.add(w.agent.id);
      return;
    }
    w.at = w.target;
  }

  /** Someone right in front of w, in the direction w is heading; w waits a moment to let them pass. */
  private blockedAhead(w: Walker): boolean {
    const next = w.route[0];
    if (!next) return false;
    const dx = Math.sign(next.x - w.x), dy = Math.sign(next.y - w.y);
    for (const o of this.walkers.values()) {
      if (o === w || o.at?.kind === 'desk' || o.at?.kind === 'sofa') continue;
      const ax = o.x - w.x, ay = o.y - w.y;
      if (ax * dx + ay * dy > 0 && Math.abs(ax) < 13 && Math.abs(ay) < 5) return true;
    }
    return false;
  }
}
