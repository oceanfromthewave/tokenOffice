// Pixel art as data: every sprite is a grid of palette keys ('.' = transparent).
// Pure functions only, so the renderer (canvas) and the icon tool (PNG) share one source.

export type Grid = string[][];
export type Palette = Record<string, string>;
export interface Sprite { grid: Grid; palette: Palette }

export const LOOKS = ['momo', 'lumi', 'tori', 'koko', 'jun', 'mina', 'yuna', 'dami', 'seoa', 'harin', 'serin'] as const;
export type PersonLook = (typeof LOOKS)[number];
export type Look = PersonLook | 'bot';

export const SPRITE_W = 16;
export const SPRITE_H = 23;
const OUTLINE = '#241c33';

const common: Palette = { k: '#241c33', b: '#f4f6ff', p: '#3b4272', z: '#1d2140', c: '#ff8f9c', q: '#b5524f', a: '#3a4a8a', E: '#2fc9b0' };

interface Person { palette: Palette; style: 'short' | 'long' | 'bun' | 'twin' | 'bob'; acc?: 'glasses' | 'phones' | 'cap' | 'beard' | 'ribbon' | 'flower' }
const people: Record<PersonLook, Person> = {
  momo: { palette: { f: '#f1c6a0', g: '#d9a67e', h: '#5a3a24', l: '#7a5233', s: '#6f94ff', t: '#4c6fd6' }, style: 'short', acc: 'glasses' },
  lumi: { palette: { f: '#f6d3b8', g: '#dfb292', h: '#1f1a2e', l: '#3a3250', s: '#ff82a8', t: '#d95f85' }, style: 'long' },
  tori: { palette: { f: '#9a6440', g: '#7d4f31', h: '#2a1a14', l: '#43291d', s: '#3fc1ae', t: '#2a9988' }, style: 'bun', acc: 'phones' },
  koko: { palette: { f: '#f1c6a0', g: '#d9a67e', h: '#f2c14e', l: '#ffe08a', s: '#ffbf69', t: '#e09a3a', C: '#9b8cff', D: '#7766e0' }, style: 'short', acc: 'cap' },
  jun: { palette: { f: '#e8b48c', g: '#c99470', h: '#2b2420', l: '#4a3c34', s: '#e25555', t: '#b23c3c' }, style: 'short', acc: 'beard' },
  mina: { palette: { f: '#f6d3b8', g: '#dfb292', h: '#8a4f2c', l: '#a86a40', s: '#9b8cff', t: '#7766e0' }, style: 'long', acc: 'glasses' },
  yuna: { palette: { f: '#f1c6a0', g: '#d9a67e', h: '#f2d27a', l: '#fff0b0', s: '#4fbf6f', t: '#2f8f52' }, style: 'bun' },
  dami: { palette: { f: '#c98f62', g: '#a8744c', h: '#c9cde0', l: '#eef0f8', s: '#3a4a8a', t: '#2a3670', E: '#ff82a8' }, style: 'short', acc: 'phones' },
  seoa: { palette: { f: '#f7d5c2', g: '#dfad91', h: '#4b293d', l: '#87506a', s: '#ff9fbd', t: '#df6f96' }, style: 'long', acc: 'ribbon' },
  harin: { palette: { f: '#f5d2b5', g: '#d8a585', h: '#382747', l: '#76538d', s: '#66cdbf', t: '#399c98' }, style: 'twin', acc: 'ribbon' },
  serin: { palette: { f: '#f7d8bd', g: '#dfb18e', h: '#a9683e', l: '#e4ad68', s: '#a994ff', t: '#7866d8' }, style: 'bob', acc: 'flower' },
};
const botPalette: Palette = { M: '#9aa3c8', N: '#6b7399', S: '#141a38', c: '#5fe3d0', r: '#ff6b6b', d: '#6b7399' };

/** Shirt colour per look, used for sticky notes and accents outside the sprite. */
export function shirtColor(look: Look): string {
  return look === 'bot' ? botPalette.M! : people[look].palette.s!;
}

// ---------------- drawing helpers ----------------
function blank(w: number, h: number): Grid {
  return Array.from({ length: h }, () => Array<string>(w).fill('.'));
}
function painter(g: Grid) {
  const px = (x: number, y: number, c: string) => { const row = g[y]; if (row && x >= 0 && x < row.length) row[x] = c; };
  const rect = (x: number, y: number, w: number, h: number, c: string) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, c); };
  return { px, rect };
}
/** 1px outline around every opaque pixel (4-neighbourhood). */
export function outline(g: Grid): Grid {
  const out = g.map(row => row.slice());
  g.forEach((row, y) => row.forEach((v, x) => {
    if (v !== '.') return;
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (g[y + dy!]?.[x + dx!] ?? '.') !== '.');
    if (near) out[y]![x] = 'o';
  }));
  return out;
}

// ---------------- workers ----------------
export type Pose = 'idle' | 'type1' | 'type2' | 'walk1' | 'walk2';
export type Facing = 'down' | 'up' | 'left' | 'right';
const HANDS: Record<Pose, [number, number]> = { idle: [19, 19], type1: [17, 16], type2: [16, 17], walk1: [19, 17], walk2: [17, 19] };
const LIFT: Partial<Record<Pose, 'L' | 'R'>> = { walk1: 'L', walk2: 'R' };

function body(g: Grid, pose: Pose, shirt: string, shade: string, hand: string, legs: string, trim: boolean) {
  const { px, rect } = painter(g);
  const [leftHand, rightHand] = HANDS[pose];
  rect(4, 14, 8, 6, shirt); rect(11, 14, 1, 6, shade); rect(4, 19, 8, 1, shade);
  if (trim) { rect(6, 14, 4, 1, 'b'); px(9, 16, 'b'); px(9, 17, 'b'); }
  for (const [x, y] of [[3, leftHand], [12, rightHand]] as const) { rect(x, 15, 1, y - 15, shirt); px(x, y, hand); }
  // a lifted leg is one row shorter, which is what makes the walk read as steps
  for (const [x, side] of [[5, 'L'], [9, 'R']] as const) {
    const up = LIFT[pose] === side;
    rect(x, 20, 2, up ? 1 : 2, legs);
    rect(x - 1, up ? 21 : 22, 3, 1, 'z');
  }
}

function personGrid(c: Person, pose: Pose, facing: Facing): Grid {
  const g = blank(SPRITE_W, SPRITE_H);
  const { px, rect } = painter(g);
  const back = facing === 'up';
  if (c.style === 'long') rect(2, 3, 12, back ? 12 : 11, 'h');
  if (c.style === 'bun') rect(6, 0, 4, 2, 'h');
  if (c.style === 'twin') {
    rect(1, 1, 3, back ? 12 : 10, 'h'); rect(12, 1, 3, back ? 12 : 10, 'h');
    px(1, 3, 'l'); px(14, 3, 'l');
  }
  if (c.style === 'bob') rect(2, 4, 12, back ? 8 : 9, 'h');
  rect(3, 4, 10, 9, 'f');
  for (const x of [3, 12]) px(x, 12, c.style === 'long' || c.style === 'bob' ? 'h' : '.');
  if (c.style !== 'long' && c.style !== 'bob') { px(2, 8, 'f'); px(13, 8, 'f'); }
  rect(4, 12, 8, 1, 'g'); px(7, 13, 'g'); px(8, 13, 'g');
  rect(3, 2, 10, 3, 'h'); rect(2, 3, 1, 3, 'h'); rect(13, 3, 1, 3, 'h');
  if (back) {
    rect(3, 4, 10, 8, 'h'); px(6, 3, 'l'); px(7, 3, 'l');
  } else {
    rect(3, 5, 2, 1, 'h'); rect(11, 5, 2, 1, 'h'); px(5, 3, 'l'); px(6, 3, 'l'); px(7, 3, 'l');
    for (const x of [5, 10]) { px(x, 8, 'k'); px(x, 9, 'k'); }
    px(4, 10, 'c'); px(11, 10, 'c'); px(7, 11, 'q'); px(8, 11, 'q');
    if (c.acc === 'glasses') {
      for (const x of [4, 9]) { rect(x, 7, 3, 1, 'a'); rect(x, 10, 3, 1, 'a'); px(x, 8, 'a'); px(x, 9, 'a'); px(x + 2, 8, 'a'); px(x + 2, 9, 'a'); }
      px(7, 8, 'a'); px(8, 8, 'a');
    }
  }
  if (!back && c.acc === 'ribbon') {
    px(10, 1, 'c'); px(11, 0, 'c'); px(12, 1, 'q'); px(11, 2, 'q');
  }
  if (!back && c.acc === 'flower') {
    px(11, 2, 'c'); px(12, 1, 'c'); px(13, 2, 'c'); px(12, 3, 'c'); px(12, 2, 'q');
  }
  if (c.style === 'bob') { rect(2, 8, 1, 4, 'h'); rect(13, 8, 1, 4, 'h'); }
  if (c.acc === 'phones') { rect(2, 1, 12, 1, 'E'); rect(2, 2, 1, 4, 'E'); rect(13, 2, 1, 4, 'E'); rect(1, 6, 2, 4, 'E'); rect(13, 6, 2, 4, 'E'); }
  if (c.acc === 'cap') { rect(2, 1, 12, 3, 'C'); rect(2, 4, 12, 1, 'D'); }
  if (c.acc === 'beard' && !back) { rect(3, 10, 2, 3, 'h'); rect(11, 10, 2, 3, 'h'); rect(4, 12, 8, 1, 'h'); }
  body(g, pose, 's', 't', 'f', 'p', !back);
  return outline(g);
}

function robotGrid(pose: Pose, facing: Facing): Grid {
  const g = blank(SPRITE_W, SPRITE_H);
  const { rect } = painter(g);
  rect(7, 0, 2, 1, 'r'); rect(7, 1, 2, 2, 'N');
  rect(2, 3, 12, 9, 'M'); rect(3, 11, 10, 1, 'N'); rect(1, 6, 1, 3, 'N'); rect(14, 6, 1, 3, 'N');
  if (facing === 'down') { rect(3, 5, 10, 5, 'S'); rect(5, 6, 2, 2, 'c'); rect(9, 6, 2, 2, 'c'); rect(6, 9, 4, 1, 'c'); }
  else rect(4, 5, 8, 4, 'N');
  rect(6, 12, 4, 2, 'N');
  body(g, pose, 'M', 'N', 'd', 'N', false);
  if (facing === 'down') rect(6, 16, 4, 2, 'c');
  return outline(g);
}

// ---------------- side view (drawn facing right; left is the mirror) ----------------
function sideLegsAndArm(g: Grid, pose: Pose, sleeve: string, hand: string, legs: string) {
  const { px, rect } = painter(g);
  if (pose === 'walk1') { // stride: front leg out, back leg behind, arm forward
    rect(8, 20, 2, 1, legs); rect(9, 21, 2, 1, legs); rect(9, 22, 3, 1, 'z');
    rect(5, 20, 2, 1, legs); rect(4, 21, 2, 1, legs); rect(3, 22, 3, 1, 'z');
    rect(8, 15, 1, 3, sleeve); px(9, 18, hand);
  } else if (pose === 'walk2') { // passing: legs together, arm back
    rect(7, 20, 2, 2, legs); rect(7, 22, 3, 1, 'z');
    rect(7, 15, 1, 3, sleeve); px(6, 18, hand);
  } else {
    rect(6, 20, 2, 2, legs); rect(8, 20, 2, 2, legs); rect(6, 22, 5, 1, 'z');
    rect(8, 15, 1, 4, sleeve); px(8, 19, hand);
  }
}

function personSide(c: Person, pose: Pose): Grid {
  const g = blank(SPRITE_W, SPRITE_H);
  const { px, rect } = painter(g);
  if (c.style === 'long') rect(2, 4, 4, 10, 'h');
  if (c.style === 'bun') rect(2, 1, 3, 3, 'h');
  if (c.style === 'twin') { rect(1, 2, 3, 9, 'h'); rect(2, 1, 2, 2, 'q'); }
  if (c.style === 'bob') rect(2, 4, 4, 9, 'h');
  rect(4, 4, 9, 9, 'f'); px(12, 12, '.');
  rect(3, 2, 9, 3, 'h'); rect(3, 4, 3, 6, 'h'); rect(10, 4, 3, 1, 'h'); px(5, 3, 'l'); px(6, 3, 'l');
  px(6, 8, 'g'); px(6, 9, 'g');
  px(10, 8, 'k'); px(10, 9, 'k'); px(13, 9, 'f'); px(9, 10, 'c'); px(11, 11, 'q');
  rect(5, 12, 7, 1, 'g'); px(7, 13, 'g'); px(8, 13, 'g');
  if (c.acc === 'glasses') { rect(9, 7, 3, 1, 'a'); rect(9, 10, 3, 1, 'a'); px(9, 8, 'a'); px(9, 9, 'a'); px(11, 8, 'a'); px(11, 9, 'a'); rect(6, 7, 3, 1, 'a'); }
  if (c.acc === 'ribbon') { rect(2, 1, 2, 1, 'c'); px(1, 0, 'q'); px(4, 0, 'q'); }
  if (c.acc === 'flower') { px(3, 2, 'c'); px(4, 1, 'c'); px(5, 2, 'c'); px(4, 3, 'c'); px(4, 2, 'q'); }
  if (c.acc === 'phones') { rect(4, 1, 7, 1, 'E'); rect(5, 6, 3, 4, 'E'); }
  if (c.acc === 'cap') { rect(3, 1, 9, 3, 'C'); rect(10, 4, 4, 1, 'D'); }
  if (c.acc === 'beard') { rect(7, 10, 2, 3, 'h'); rect(9, 12, 4, 1, 'h'); }
  rect(5, 14, 6, 6, 's'); rect(5, 19, 6, 1, 't'); px(9, 14, 'b'); px(10, 14, 'b');
  sideLegsAndArm(g, pose, 't', 'f', 'p');
  return outline(g);
}

function robotSide(pose: Pose): Grid {
  const g = blank(SPRITE_W, SPRITE_H);
  const { rect } = painter(g);
  rect(7, 0, 2, 1, 'r'); rect(7, 1, 2, 2, 'N');
  rect(4, 3, 9, 9, 'M'); rect(9, 5, 4, 4, 'S'); rect(11, 6, 1, 2, 'c'); rect(5, 6, 1, 3, 'N'); rect(5, 11, 7, 1, 'N');
  rect(7, 12, 2, 2, 'N');
  rect(5, 14, 6, 6, 'M'); rect(5, 19, 6, 1, 'N');
  sideLegsAndArm(g, pose, 'N', 'd', 'N');
  return outline(g);
}

const mirror = (g: Grid): Grid => g.map(row => [...row].reverse());

export function workerSprite(look: Look, pose: Pose, facing: Facing = 'down'): Sprite {
  const side = facing === 'left' || facing === 'right';
  const flip = (g: Grid) => (facing === 'left' ? mirror(g) : g);
  if (look === 'bot') {
    const grid = side ? flip(robotSide(pose)) : robotGrid(pose, facing);
    return { grid, palette: { ...common, ...botPalette, o: OUTLINE } };
  }
  const person = people[look];
  const grid = side ? flip(personSide(person, pose)) : personGrid(person, pose, facing);
  return { grid, palette: { ...common, ...person.palette, o: OUTLINE } };
}

// ---------------- props ----------------
const propPalette: Palette = { o: OUTLINE, w: '#f4f6ff', d: '#9aa3c8', b: '#6b3f22', r: '#e25555', g: '#4fbf6f', G: '#2f8f52', y: '#ffd166', Y: '#d9a63c', p: '#c0714a', P: '#8f4f30', c: '#5fe3d0', k: '#241c33', m: '#f49ac2' };
type Draw = (px: (x: number, y: number, c: string) => void, rect: (x: number, y: number, w: number, h: number, c: string) => void) => void;
function prop(w: number, h: number, draw: Draw): Sprite {
  const g = blank(w, h);
  const { px, rect } = painter(g);
  draw(px, rect);
  return { grid: outline(g), palette: propPalette };
}
const cup = (liquid: string): Draw => (px, rect) => { px(2, 0, 'd'); px(4, 0, 'd'); rect(1, 2, 6, 5, 'w'); rect(1, 2, 6, 1, liquid); px(7, 3, 'w'); px(8, 3, 'w'); px(8, 4, 'w'); px(7, 5, 'w'); };
const pot: Draw = (_px, rect) => { rect(3, 13, 8, 7, 'p'); rect(2, 12, 10, 2, 'P'); rect(3, 18, 8, 2, 'P'); };

export const PROPS = {
  coffee: prop(9, 8, cup('b')),
  tea: prop(9, 8, cup('g')),
  boba: prop(8, 10, (px, rect) => { rect(4, 0, 1, 3, 'r'); rect(1, 2, 6, 1, 'w'); rect(1, 3, 6, 6, 'm'); rect(1, 7, 6, 2, 'k'); px(3, 5, 'w'); }),
  sprout: prop(8, 8, (px, rect) => { rect(3, 0, 2, 4, 'g'); px(2, 1, 'g'); px(5, 1, 'g'); px(1, 2, 'G'); px(6, 2, 'G'); rect(2, 4, 4, 4, 'p'); rect(2, 4, 4, 1, 'P'); }),
  note: prop(8, 8, (_px, rect) => { rect(1, 1, 6, 6, 'y'); rect(2, 3, 4, 1, 'Y'); rect(2, 5, 3, 1, 'Y'); }),
  books: prop(9, 8, (_px, rect) => { rect(0, 5, 9, 3, 'g'); rect(1, 2, 7, 3, 'r'); rect(2, 0, 5, 2, 'c'); rect(3, 6, 4, 1, 'G'); }),
  bulb: prop(7, 9, (_px, rect) => { rect(1, 0, 5, 5, 'y'); rect(2, 1, 1, 2, 'w'); rect(2, 5, 3, 2, 'd'); rect(2, 7, 3, 1, 'k'); }),
  check: prop(8, 8, (px, rect) => { rect(0, 0, 8, 8, 'g'); for (const [x, y] of [[1, 4], [2, 5], [3, 6], [4, 5], [5, 4], [6, 3], [6, 2]] as const) px(x, y, 'w'); }),
  can: prop(6, 9, (_px, rect) => { rect(1, 0, 4, 1, 'd'); rect(1, 1, 4, 7, 'r'); rect(1, 3, 4, 2, 'w'); rect(1, 8, 4, 1, 'd'); }),
  plant: prop(14, 20, (px, rect) => {
    rect(6, 7, 2, 6, 'G');
    for (const [x, y, w, h] of [[5, 0, 4, 3], [2, 3, 4, 3], [8, 3, 4, 3], [1, 7, 4, 3], [9, 7, 4, 3], [5, 4, 4, 3]] as const) rect(x, y, w, h, 'g');
    rect(3, 4, 1, 1, 'G'); rect(10, 4, 1, 1, 'G'); pot(px, rect);
  }),
  fern: prop(14, 20, (px, rect) => {
    for (let i = 0; i < 5; i++) rect(5 + i, 3 + i * 2, 2, 2, 'G');
    for (const [x, y, w, h] of [[0, 6, 5, 2], [2, 3, 4, 2], [9, 6, 5, 2], [8, 3, 4, 2], [5, 0, 4, 3], [1, 9, 5, 2], [8, 9, 5, 2]] as const) rect(x, y, w, h, 'g');
    pot(px, rect);
  }),
  house: prop(12, 11, (_px, rect) => { for (let i = 0; i < 5; i++) rect(5 - i, i, 2 + i * 2, 1, 'r'); rect(1, 5, 10, 6, 'w'); rect(5, 7, 2, 4, 'p'); rect(2, 6, 2, 2, 'c'); rect(8, 6, 2, 2, 'c'); }),
} satisfies Record<string, Sprite>;
export type PropName = keyof typeof PROPS;

// ---------------- speech-bubble icons (7x7, 'k' = ink) ----------------
const icon = (rows: string[]): Grid => rows.map(r => r.split(''));
export const ICONS = {
  edit: icon(['.....kk', '....k.k', '...k.k.', '..k.k..', '.k.k...', 'kkk....', 'kk.....']),
  read: icon(['.kkk...', 'k...k..', 'k...k..', 'k...k..', '.kkkk..', '....kk.', '.....kk']),
  shell: icon(['kkkkkkk', 'k.....k', 'kk....k', 'k.k...k', 'kk.kk.k', 'k.....k', 'kkkkkkk']),
  web: icon(['..kkk..', '.k.k.k.', 'kkkkkkk', 'k..k..k', 'kkkkkkk', '.k.k.k.', '..kkk..']),
  team: icon(['.k...k.', 'kkk.kkk', '.k...k.', '.......', 'kk...kk', 'kkk.kkk', 'kkk.kkk']),
  tool: icon(['...k...', '.k.k.k.', '..kkk..', 'kkk.kkk', '..kkk..', '.k.k.k.', '...k...']),
  think: icon(['.......', '.......', '.......', 'k..k..k', '.......', '.......', '.......']),
  alert: icon(['...k...', '..kkk..', '..kkk..', '..kkk..', '...k...', '.......', '...k...']),
  error: icon(['k.....k', '.k...k.', '..k.k..', '...k...', '..k.k..', '.k...k.', 'k.....k']),
} satisfies Record<string, Grid>;
export type IconName = keyof typeof ICONS;

/** Which bubble icon fits a Claude Code tool name. */
export function iconForTool(tool: string): IconName {
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)) return 'edit';
  if (/^(Read|Grep|Glob|LS)$/.test(tool)) return 'read';
  if (/^(Bash|PowerShell|BashOutput|KillShell)$/.test(tool)) return 'shell';
  if (/^Web(Fetch|Search)$/.test(tool)) return 'web';
  if (/^(Task|Agent)$/.test(tool)) return 'team';
  return tool ? 'tool' : 'think';
}
