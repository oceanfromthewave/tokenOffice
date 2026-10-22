// Generates sprites.css: 16x23 pixel-art office workers (people for sessions, a robot for subagents),
// two frames each (typing / walking), plus small desk and furniture props.
// Run: node tools/make-sprites.mjs
import { writeFileSync } from 'node:fs';

const W = 16, H = 23;
const OUTLINE = '#241c33';
const common = { k: '#241c33', b: '#f4f6ff', p: '#3b4272', z: '#1d2140', c: '#ff8f9c', q: '#b5524f', a: '#3a4a8a', E: '#2fc9b0' };

const people = {
  momo: { f: '#f1c6a0', g: '#d9a67e', h: '#5a3a24', l: '#7a5233', s: '#6f94ff', t: '#4c6fd6', style: 'short', acc: 'glasses' },
  lumi: { f: '#f6d3b8', g: '#dfb292', h: '#1f1a2e', l: '#3a3250', s: '#ff82a8', t: '#d95f85', style: 'long' },
  tori: { f: '#9a6440', g: '#7d4f31', h: '#2a1a14', l: '#43291d', s: '#3fc1ae', t: '#2a9988', style: 'bun', acc: 'phones' },
  koko: { f: '#f1c6a0', g: '#d9a67e', h: '#f2c14e', l: '#ffe08a', s: '#ffbf69', t: '#e09a3a', style: 'short', acc: 'cap', C: '#9b8cff', D: '#7766e0' },
};
const bot = { M: '#9aa3c8', N: '#6b7399', S: '#141a38', c: '#5fe3d0', r: '#ff6b6b', d: '#6b7399' };

const blank = () => Array.from({ length: H }, () => Array(W).fill('.'));
const tools = g => ({
  px: (x, y, c) => { g[y][x] = c; },
  rect: (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) g[y + j][x + i] = c; },
});
const near = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function outline(g) {
  const out = g.map(r => r.slice());
  g.forEach((row, y) => row.forEach((v, x) => {
    if (v === '.' && near.some(([dx, dy]) => (g[y + dy]?.[x + dx] ?? '.') !== '.')) out[y][x] = 'o';
  }));
  return out;
}

// shirt, arms, legs shared by every worker; hand colour differs
function body(g, [leftHand, rightHand], shirt, shade, hand, legs, shoes, trim) {
  const { px, rect } = tools(g);
  rect(4, 14, 8, 6, shirt); rect(11, 14, 1, 6, shade); rect(4, 19, 8, 1, shade);
  if (trim) { rect(6, 14, 4, 1, 'b'); px(9, 16, 'b'); px(9, 17, 'b'); }
  for (const [x, y] of [[3, leftHand], [12, rightHand]]) { rect(x, 15, 1, y - 15, shirt); px(x, y, hand); }
  rect(5, 20, 2, 2, legs); rect(9, 20, 2, 2, legs); rect(4, 22, 3, 1, shoes); rect(9, 22, 3, 1, shoes);
}

function person(c, hands) {
  const g = blank(); const { px, rect } = tools(g);
  if (c.style === 'long') rect(2, 3, 12, 11, 'h');
  if (c.style === 'bun') rect(6, 0, 4, 2, 'h');
  // face without its bottom corners
  rect(3, 4, 10, 9, 'f');
  for (const x of [3, 12]) px(x, 12, c.style === 'long' ? 'h' : '.');
  if (c.style !== 'long') { px(2, 8, 'f'); px(13, 8, 'f'); }
  rect(4, 12, 8, 1, 'g'); px(7, 13, 'g'); px(8, 13, 'g');
  // hair on top
  rect(3, 2, 10, 3, 'h'); rect(2, 3, 1, 3, 'h'); rect(13, 3, 1, 3, 'h');
  rect(3, 5, 2, 1, 'h'); rect(11, 5, 2, 1, 'h'); px(5, 3, 'l'); px(6, 3, 'l'); px(7, 3, 'l');
  // face
  for (const x of [5, 10]) { px(x, 8, 'k'); px(x, 9, 'k'); }
  px(4, 10, 'c'); px(11, 10, 'c'); px(7, 11, 'q'); px(8, 11, 'q');
  if (c.acc === 'glasses') {
    for (const x of [4, 9]) { rect(x, 7, 3, 1, 'a'); rect(x, 10, 3, 1, 'a'); px(x, 8, 'a'); px(x, 9, 'a'); px(x + 2, 8, 'a'); px(x + 2, 9, 'a'); }
    px(7, 8, 'a'); px(8, 8, 'a');
  }
  if (c.acc === 'phones') { rect(2, 1, 12, 1, 'E'); rect(2, 2, 1, 4, 'E'); rect(13, 2, 1, 4, 'E'); rect(1, 6, 2, 4, 'E'); rect(13, 6, 2, 4, 'E'); }
  if (c.acc === 'cap') { rect(2, 1, 12, 3, 'C'); rect(2, 4, 12, 1, 'D'); }
  body(g, hands, 's', 't', 'f', 'p', 'z', true);
  return outline(g);
}

function robot(hands) {
  const g = blank(); const { px, rect } = tools(g);
  rect(7, 0, 2, 1, 'r'); rect(7, 1, 2, 2, 'N');
  rect(2, 3, 12, 9, 'M'); rect(3, 11, 10, 1, 'N'); rect(1, 6, 1, 3, 'N'); rect(14, 6, 1, 3, 'N');
  rect(3, 5, 10, 5, 'S'); rect(5, 6, 2, 2, 'c'); rect(9, 6, 2, 2, 'c'); rect(6, 9, 4, 1, 'c');
  rect(6, 12, 4, 2, 'N');
  body(g, hands, 'M', 'N', 'd', 'N', 'z', false);
  rect(6, 16, 4, 2, 'c');
  return outline(g);
}

function toPaths(rows, colors, w, xOffset = 0) {
  const paths = {};
  rows.forEach((row, y) => {
    for (let x = 0; x < w;) {
      const c = row[x];
      if (c === '.') { x++; continue; }
      let run = 1;
      while (x + run < w && row[x + run] === c) run++;
      (paths[c] ||= []).push(`M${x + xOffset} ${y}h${run}v1h-${run}z`);
      x += run;
    }
  });
  return Object.entries(paths).map(([c, d]) => `<path fill='${colors[c] ?? '#f0f'}' d='${d.join('')}'/>`).join('');
}
const dataUri = svg => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
const svgOf = (w, h, inner) => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}' shape-rendering='crispEdges'>${inner}</svg>`;

function sheet(look) {
  const make = look === 'bot' ? hands => robot(hands) : hands => person(people[look], hands);
  const colors = { ...common, ...(look === 'bot' ? bot : people[look]), o: OUTLINE };
  const inner = toPaths(make([19, 18]), colors, W, 0) + toPaths(make([18, 19]), colors, W, W);
  return `[data-look="${look}"] { --sprite: ${dataUri(svgOf(W * 2, H, inner))}; }`;
}

// ---- props: desk items and furniture, same 1px outline ----
const propColors = { o: OUTLINE, w: '#f4f6ff', d: '#9aa3c8', b: '#6b3f22', r: '#e25555', g: '#4fbf6f', G: '#2f8f52', y: '#ffd166', Y: '#d9a63c', p: '#c0714a', P: '#8f4f30', c: '#5fe3d0', k: '#241c33', m: '#f49ac2' };
function prop(name, w, h, draw) {
  const g = Array.from({ length: h }, () => Array(w).fill('.'));
  draw((x, y, c) => { if (g[y]?.[x] !== undefined) g[y][x] = c; }, (x, y, rw, rh, c) => { for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) if (g[y + j]?.[x + i] !== undefined) g[y + j][x + i] = c; });
  return { v: `  --px-${name}: ${dataUri(svgOf(w, h, toPaths(outline(g), propColors, w)))};`, r: `.px-${name} { background-image: var(--px-${name}); background-size: 100% 100%; background-repeat: no-repeat; image-rendering: pixelated; }` };
}
const cup = (liquid, glass) => (px, rect) => { px(2, 0, 'd'); px(4, 0, 'd'); rect(1, 2, 6, 5, glass); rect(1, 2, 6, 1, liquid); px(7, 3, glass); px(8, 3, glass); px(8, 4, glass); px(7, 5, glass); };
const leaves = (rect, shape) => shape.forEach(([x, y, w, h]) => rect(x, y, w, h, 'g'));
const pot = rect => { rect(3, 13, 8, 7, 'p'); rect(2, 12, 10, 2, 'P'); rect(3, 18, 8, 2, 'P'); };
const props = [
  prop('coffee', 9, 8, cup('b', 'w')),
  prop('tea', 9, 8, cup('g', 'w')),
  prop('boba', 8, 10, (px, rect) => { rect(4, 0, 1, 3, 'r'); rect(1, 2, 6, 1, 'w'); rect(1, 3, 6, 6, 'm'); rect(1, 7, 6, 2, 'k'); px(3, 5, 'w'); }),
  prop('sprout', 8, 8, (px, rect) => { rect(3, 0, 2, 4, 'g'); px(2, 1, 'g'); px(5, 1, 'g'); px(1, 2, 'G'); px(6, 2, 'G'); rect(2, 4, 4, 4, 'p'); rect(2, 4, 4, 1, 'P'); }),
  prop('note', 8, 8, (px, rect) => { rect(1, 1, 6, 6, 'y'); rect(2, 3, 4, 1, 'Y'); rect(2, 5, 3, 1, 'Y'); }),
  prop('books', 9, 8, (px, rect) => { rect(0, 5, 9, 3, 'g'); rect(1, 2, 7, 3, 'r'); rect(2, 0, 5, 2, 'c'); rect(3, 6, 4, 1, 'G'); }),
  prop('bulb', 7, 9, (px, rect) => { rect(1, 0, 5, 5, 'y'); rect(2, 1, 1, 2, 'w'); rect(2, 5, 3, 2, 'd'); rect(2, 7, 3, 1, 'k'); }),
  prop('check', 8, 8, (px, rect) => { rect(0, 0, 8, 8, 'g'); for (const [x, y] of [[1, 4], [2, 5], [3, 6], [4, 5], [5, 4], [6, 3], [6, 2]]) px(x, y, 'w'); }),
  prop('can', 6, 9, (px, rect) => { rect(1, 0, 4, 1, 'd'); rect(1, 1, 4, 7, 'r'); rect(1, 3, 4, 2, 'w'); rect(1, 8, 4, 1, 'd'); }),
  prop('plant', 14, 20, (px, rect) => { rect(6, 7, 2, 6, 'G'); leaves(rect, [[5, 0, 4, 3], [2, 3, 4, 3], [8, 3, 4, 3], [1, 7, 4, 3], [9, 7, 4, 3], [5, 4, 4, 3]]); rect(3, 4, 1, 1, 'G'); rect(10, 4, 1, 1, 'G'); pot(rect); }),
  prop('fern', 14, 20, (px, rect) => { for (let i = 0; i < 5; i++) rect(5 + i, 3 + i * 2, 2, 2, 'G'); leaves(rect, [[0, 6, 5, 2], [2, 3, 4, 2], [9, 6, 5, 2], [8, 3, 4, 2], [5, 0, 4, 3], [1, 9, 5, 2], [8, 9, 5, 2]]); pot(rect); }),
  prop('house', 12, 11, (px, rect) => { for (let i = 0; i < 5; i++) rect(5 - i, i, 2 + i * 2, 1, 'r'); rect(1, 5, 10, 6, 'w'); rect(5, 7, 2, 4, 'p'); rect(2, 6, 2, 2, 'c'); rect(8, 6, 2, 2, 'c'); }),
];

const looks = [...Object.keys(people), 'bot'];
const css = [
  '/* generated by tools/make-sprites.mjs — do not edit by hand */',
  ...looks.map(sheet),
  `:root {\n${props.map(p => p.v).join('\n')}\n}`,
  ...props.map(p => p.r),
].join('\n') + '\n';
writeFileSync(new URL('../sprites.css', import.meta.url), css);
console.log(`sprites.css ${css.length} bytes`);
