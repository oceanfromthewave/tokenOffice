// A* over a walk grid, 4 directions, with a small cost per turn so routes are a few straight legs, not staircases.

export interface Cell { x: number; y: number }

export interface WalkGrid {
  cols: number;
  rows: number;
  /** true where nobody may stand */
  blocked: (x: number, y: number) => boolean;
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const TURN_COST = 0.6;

/** Minimal binary heap keyed by f-score. */
class Heap {
  private items: { key: number; f: number }[] = [];
  get size() { return this.items.length; }
  push(key: number, f: number) {
    const a = this.items;
    a.push({ key, f });
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (a[p]!.f <= a[i]!.f) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0]!.key;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.f < a[m]!.f) m = l;
        if (r < a.length && a[r]!.f < a[m]!.f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

/** Cells from start to goal inclusive, or null when the goal can't be reached. Start and goal may sit on blocked cells. */
export function findPath(grid: WalkGrid, start: Cell, goal: Cell): Cell[] | null {
  const { cols, rows } = grid;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows;
  if (!inside(start.x, start.y) || !inside(goal.x, goal.y)) return null;
  if (start.x === goal.x && start.y === goal.y) return [start];

  // state = cell * 5 + arrival direction (4 = none, used only for the start)
  const stateOf = (x: number, y: number, d: number) => (y * cols + x) * 5 + d;
  const cost = new Map<number, number>();
  const from = new Map<number, number>();
  const open = new Heap();
  const h = (x: number, y: number) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
  const startState = stateOf(start.x, start.y, 4);
  cost.set(startState, 0);
  open.push(startState, h(start.x, start.y));

  while (open.size) {
    const state = open.pop();
    const d = state % 5;
    const cell = (state - d) / 5;
    const x = cell % cols, y = (cell - x) / cols;
    if (x === goal.x && y === goal.y) {
      const path: Cell[] = [];
      for (let s: number | undefined = state; s !== undefined; s = from.get(s)) {
        const c = (s - (s % 5)) / 5;
        path.push({ x: c % cols, y: Math.floor(c / cols) });
      }
      return path.reverse();
    }
    const g = cost.get(state)!;
    DIRS.forEach(([dx, dy], nd) => {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny)) return;
      const isGoal = nx === goal.x && ny === goal.y;
      if (!isGoal && grid.blocked(nx, ny)) return;
      const next = stateOf(nx, ny, nd);
      const ng = g + 1 + (d !== 4 && d !== nd ? TURN_COST : 0);
      if (ng >= (cost.get(next) ?? Infinity)) return;
      cost.set(next, ng);
      from.set(next, state);
      open.push(next, ng + h(nx, ny));
    });
  }
  return null;
}

/** Drops the cells in the middle of straight runs, leaving only the corners. */
export function corners(path: Cell[]): Cell[] {
  return path.filter((c, i) => {
    const prev = path[i - 1], next = path[i + 1];
    if (!prev || !next) return true;
    return (prev.x - c.x) * (next.y - c.y) !== (prev.y - c.y) * (next.x - c.x);
  });
}
