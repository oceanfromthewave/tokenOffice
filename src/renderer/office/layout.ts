// The office floor plan in art pixels (1 unit = 1 sprite pixel). Pure data + the walk grid; no drawing here.
import type { WalkGrid } from './path.ts';

export const WORLD_W = 320;
export const WORLD_H = 140;
export const FLOOR_Y = 44;
export const CELL = 2;
export const COLS = WORLD_W / CELL;
export const ROWS = WORLD_H / CELL;

export interface Point { x: number; y: number }
export type SpotKind = 'desk' | 'sofa' | 'stand' | 'meeting';
export interface Spot extends Point { kind: SpotKind; band: number }
interface Rect { x0: number; y0: number; x1: number; y1: number }

export const SOFA_BAND = 100;
export const LOUNGE_BAND = 101;
export const MEETING_BAND = 102;
export const DOOR: Point = { x: 157, y: 49 };
export const VENDING_SPOT: Spot = { x: 210, y: 84, kind: 'stand', band: -1 };

/** Seat positions are where a seated worker's feet are. Three columns, two rows. */
export const DESKS: Spot[] = [70, 114].flatMap((y, row) => [32, 84, 136].map((x, col) => ({ x, y, kind: 'desk' as const, band: row * 3 + col })));

export const SOFA = { x0: 178, x1: 228, seatY: 118 };
/** Six lounge seats: three on the sofa and three in the armchairs beside it. */
export const LOUNGE: Spot[] = [
  { x: 189, y: SOFA.seatY, kind: 'sofa', band: SOFA_BAND },
  { x: 203, y: SOFA.seatY, kind: 'sofa', band: SOFA_BAND },
  { x: 217, y: SOFA.seatY, kind: 'sofa', band: SOFA_BAND },
  { x: 184, y: 100, kind: 'sofa', band: LOUNGE_BAND },
  { x: 199, y: 100, kind: 'sofa', band: LOUNGE_BAND },
  { x: 214, y: 100, kind: 'sofa', band: LOUNGE_BAND },
];
/** Four chairs around the conference table in the room at the right of the office. */
export const MEETING_SEATS: Spot[] = [
  { x: 280, y: 99, kind: 'meeting', band: MEETING_BAND },
  { x: 262, y: 111, kind: 'meeting', band: MEETING_BAND },
  { x: 302, y: 111, kind: 'meeting', band: MEETING_BAND },
  { x: 280, y: 128, kind: 'meeting', band: MEETING_BAND },
];
/** Where people wait when every desk is taken: the bottom edge of the floor, far enough below the front desks not to cover anyone seated. */
export const OVERFLOW: Spot[] = [36, 56, 76, 96, 116, 136].map(x => ({ x, y: 136, kind: 'stand' as const, band: -1 }));

// Floor footprints: the strip each piece of furniture stands on. Walkers can't enter them.
// Things standing against the wall reach back to it, so nobody squeezes behind them.
const FOOTPRINTS: Rect[] = [
  ...DESKS.flatMap(d => [
    { x0: d.x - 17, y0: d.y - 6, x1: d.x + 18, y1: d.y - 4 }, // partition behind the chair
    { x0: d.x - 17, y0: d.y + 2, x1: d.x + 18, y1: d.y + 6 }, // desk in front
  ]),
  ...[178, 193, 208].map(x => ({ x0: x, y0: 85, x1: x + 12, y1: 98 })), // armchairs
  { x0: 245, y0: 82, x1: 319, y1: 86 }, // conference room top wall
  { x0: 245, y0: 86, x1: 249, y1: 98 }, // room divider above the doorway
  { x0: 245, y0: 116, x1: 249, y1: 136 }, // room divider below the doorway
  { x0: 245, y0: 136, x1: 319, y1: 140 }, // conference room bottom wall
  { x0: 316, y0: 82, x1: 320, y1: 140 }, // conference room right wall
  { x0: 270, y0: 103, x1: 294, y1: 121 }, // conference table
  { x0: 180, y0: 113, x1: 226, y1: 115 }, // sofa back
  { x0: 178, y0: 121, x1: 228, y1: 124 }, // sofa front
  { x0: 194, y0: 127, x1: 214, y1: 132 }, // coffee table
  { x0: 222, y0: FLOOR_Y, x1: 237, y1: 78 }, // vending machine
  { x0: 166, y0: FLOOR_Y, x1: 175, y1: 78 }, // water cooler
  { x0: 1, y0: FLOOR_Y, x1: 13, y1: 62 }, // cabinet + printer
  { x0: 15, y0: FLOOR_Y, x1: 29, y1: 60 }, // bookshelf
  { x0: 173, y0: 109, x1: 179, y1: 112 }, // floor lamp
  { x0: 3, y0: 134, x1: 15, y1: 138 }, // fern
  { x0: 225, y0: 134, x1: 237, y1: 138 }, // plant
];
// Seat bands: the gap between a partition and its desk (or the sofa back and front). Only their own users walk in.
const BANDS: (Rect & { band: number })[] = [
  ...DESKS.map(d => ({ x0: d.x - 17, y0: d.y - 4, x1: d.x + 18, y1: d.y + 2, band: d.band })),
  { x0: 180, y0: 115, x1: 226, y1: 121, band: SOFA_BAND },
  { x0: 177, y0: 98, x1: 222, y1: 102, band: LOUNGE_BAND },
  { x0: 268, y0: 94, x1: 292, y1: 102, band: MEETING_BAND }, // chair at the head of the table
  { x0: 258, y0: 103, x1: 266, y1: 119, band: MEETING_BAND }, // left chair
  { x0: 298, y0: 103, x1: 306, y1: 119, band: MEETING_BAND }, // right chair
  { x0: 268, y0: 124, x1: 292, y1: 132, band: MEETING_BAND }, // chair at the foot
];

const blocked = new Uint8Array(COLS * ROWS);
const bands = new Int16Array(COLS * ROWS).fill(-1);
/** Half a body width: a worker's feet are one point, but the sprite is 16px wide. */
export const BODY_HALF = 6;
const fill = (r: Rect, apply: (i: number) => void, pad = 0) => {
  for (let y = Math.max(0, Math.floor(r.y0 / CELL)); y < Math.min(ROWS, Math.ceil(r.y1 / CELL)); y++)
    for (let x = Math.max(0, Math.floor((r.x0 - pad) / CELL)); x < Math.min(COLS, Math.ceil((r.x1 + pad) / CELL)); x++) apply(y * COLS + x);
};
for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
  // feet stay on the floor (below the wall) and off the outer edge
  if (y * CELL < FLOOR_Y + 4 || x === 0 || x === COLS - 1 || y === ROWS - 1) blocked[y * COLS + x] = 1;
}
// footprints grow sideways by half a body so shoulders never clip furniture; seat bands are cut back out afterwards
FOOTPRINTS.forEach(r => fill(r, i => { blocked[i] = 1; }, BODY_HALF));
BANDS.forEach(r => fill(r, i => { bands[i] = r.band; blocked[i] = 0; }));

export const cellOf = (p: Point) => ({ x: Math.floor(p.x / CELL), y: Math.floor(p.y / CELL) });
export const pointOf = (c: { x: number; y: number }): Point => ({ x: c.x * CELL + CELL / 2, y: c.y * CELL + CELL / 2 });

/** Walk grid for one trip. Seat bands are off-limits except the ones listed (your own desk, the sofa if you're going there). */
export function walkGrid(allowedBands: ReadonlySet<number>): WalkGrid {
  return {
    cols: COLS,
    rows: ROWS,
    blocked: (x, y) => {
      const i = y * COLS + x;
      if (blocked[i]) return true;
      const band = bands[i]!;
      return band !== -1 && !allowedBands.has(band);
    },
  };
}
