// The office scene: a 240x140 pixel world drawn on a canvas and scaled up by whole numbers so it stays crisp.
// Everything that stands on the floor is depth-sorted by where its feet/base are, so people pass in front of
// and behind furniture correctly. People walk A* routes on a 2px grid and never cut through furniture.
import { iconForTool, shirtColor, type Pose, type PropName } from '../../shared/pixels.ts';
import { Crowd, type OfficeAgent, type Walker } from './crowd.ts';
import { DESKS, FLOOR_Y, LOUNGE, SOFA, WORLD_H, WORLD_W } from './layout.ts';
import { iconCanvas, propCanvas, workerCanvas } from './sprites.ts';

export type { OfficeAgent };

const DESK_PROPS: PropName[] = ['coffee', 'tea', 'boba', 'sprout', 'can', 'coffee'];
const SHELF_PROPS: PropName[] = ['sprout', 'books', 'bulb', 'check', 'note', 'books'];

/** The windows follow the local time of day. */
type Period = 'dawn' | 'day' | 'dusk' | 'night';
const periodOf = (hour: number): Period => (hour >= 5 && hour < 8 ? 'dawn' : hour >= 8 && hour < 17 ? 'day' : hour >= 17 && hour < 19 ? 'dusk' : 'night');
const SKIES: Record<Period, { bands: string[]; city: string; lit: number; light: string; orb: string; orbY: number; stars: boolean; clouds: boolean }> = {
  dawn: { bands: ['#3b3a78', '#6a5a9a', '#b07aa0', '#f0a080', '#ffd0a0'], city: '#2a2f60', lit: 0.15, light: '#ffd98a', orb: '#ffe08a', orbY: 14, stars: false, clouds: false },
  day: { bands: ['#4f94e0', '#64a6ec', '#7ab8f2', '#92caf6', '#acdcfa'], city: '#4a5a8a', lit: 0.08, light: '#bcd4f0', orb: '#fff3b0', orbY: 3, stars: false, clouds: true },
  dusk: { bands: ['#2c2f70', '#5a3f80', '#a04f78', '#e07a5a', '#ffb060'], city: '#22264f', lit: 0.3, light: '#ffd98a', orb: '#ffb060', orbY: 16, stars: false, clouds: false },
  night: { bands: ['#0c1030', '#121a48', '#1b2760', '#23317a', '#2c3b80'], city: '#141a48', lit: 0.45, light: '#ffd98a', orb: '#fff3cf', orbY: 3, stars: true, clouds: false },
};
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

type Ctx = CanvasRenderingContext2D;
const rect = (ctx: Ctx, x: number, y: number, w: number, h: number, color: string) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };

interface Drawable { key: number; draw: (ctx: Ctx) => void }

export class Office {
  private world = document.createElement('canvas');
  private wctx: Ctx;
  private background = document.createElement('canvas');
  private ctx: Ctx;
  private crowd = new Crowd(() => reducedMotion.matches);
  private furniture: Drawable[] = [];
  private scale = 1;
  private viewW = WORLD_W;
  private viewH = WORLD_H;
  /** where the 240x140 floor plan starts inside the (wider) view; the wall and floor continue on both sides */
  private lx = 0;
  private dpr = 1;
  private last = performance.now();
  private frame = 0;
  private printing = 0;
  private period: Period = periodOf(new Date().getHours());
  private selected = '';
  private observer: ResizeObserver;
  private canvas: HTMLCanvasElement;
  private onSelect: (id: string) => void;

  constructor(canvas: HTMLCanvasElement, onSelect: (id: string) => void) {
    this.canvas = canvas;
    this.onSelect = onSelect;
    this.wctx = this.world.getContext('2d')!;
    this.ctx = canvas.getContext('2d')!;
    this.furniture = this.buildFurniture();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    canvas.addEventListener('click', e => { const hit = this.hit(e); if (hit) this.onSelect(hit); });
    canvas.addEventListener('mousemove', e => { canvas.style.cursor = this.hit(e) ? 'pointer' : 'default'; });
    this.resize();
    this.frame = requestAnimationFrame(t => this.tick(t));
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
  }

  select(id: string) { this.selected = id; }
  /** The printer runs for a moment, e.g. when someone finishes a turn. */
  print() { this.printing = 2; }

  /** Syncs the office with the current agents. `instant` places everyone without walking (first paint). */
  setAgents(agents: OfficeAgent[], instant = false) { this.crowd.setAgents(agents, instant); }

  // ---------------- loop ----------------
  private tick(now: number) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(dt);
    this.render();
    this.frame = requestAnimationFrame(t => this.tick(t));
  }

  private update(dt: number) {
    this.printing = Math.max(0, this.printing - dt);
    this.crowd.update(dt);
  }

  // ---------------- drawing ----------------
  private resize() {
    this.dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * this.dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * this.dpr));
    this.canvas.width = w;
    this.canvas.height = h;
    // whole-number scale keeps every art pixel square; the view grows past the floor plan instead of letterboxing
    this.scale = Math.max(1, Math.floor(Math.min(w / WORLD_W, h / WORLD_H)));
    this.viewW = Math.ceil(w / this.scale);
    this.viewH = Math.ceil(h / this.scale);
    this.lx = Math.floor((this.viewW - WORLD_W) / 2);
    this.world.width = this.background.width = this.viewW;
    this.world.height = this.background.height = this.viewH;
    this.wctx.imageSmoothingEnabled = false;
    this.paintBackground(this.background.getContext('2d')!);
  }

  private render() {
    const g = this.wctx;
    const period = periodOf(new Date().getHours());
    if (period !== this.period) { this.period = period; this.paintBackground(this.background.getContext('2d')!); }
    g.drawImage(this.background, 0, 0);
    g.save();
    g.translate(this.lx, 0);
    this.drawWhiteboard(g);
    this.drawClock(g);
    const items: Drawable[] = [...this.furniture];
    for (const w of this.crowd.walkers.values()) items.push({ key: w.y + 0.25, draw: ctx => this.drawWalker(ctx, w) });
    items.sort((a, b) => a.key - b.key).forEach(d => d.draw(g));
    for (const w of this.crowd.walkers.values()) this.drawBubble(g, w);
    g.restore();

    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.world, 0, 0, this.viewW * this.scale, this.viewH * this.scale);
    this.drawLabels(ctx);
  }

  private drawWalker(g: Ctx, w: Walker) {
    const walking = w.route.length > 0;
    const seatedAtDesk = !walking && w.at?.kind === 'desk';
    let pose: Pose = 'idle';
    let bob = 0;
    if (walking) {
      const step = Math.floor(w.t * 8) % 2;
      pose = step ? 'walk1' : 'walk2';
      bob = step ? -1 : 0;
    } else if (seatedAtDesk && w.agent.state === 'working' && !reducedMotion.matches) {
      pose = Math.floor(w.t * 5) % 2 ? 'type1' : 'type2';
    }
    g.drawImage(workerCanvas(w.agent.look, pose, walking ? w.facing : 'down'), Math.round(w.x) - 8, Math.round(w.y) - 23 + bob);
  }

  private drawBubble(g: Ctx, w: Walker) {
    if (w.route.length || w.at?.kind !== 'desk') return;
    const { state, tool } = w.agent;
    const style = state === 'waiting' ? { bg: '#ffd166', ink: '#241c33', icon: 'alert' as const }
      : state === 'error' ? { bg: '#ff6b6b', ink: '#f4f6ff', icon: 'error' as const }
      : state === 'working' ? { bg: '#f4f6ff', ink: '#241c33', icon: iconForTool(tool) }
      : null;
    if (!style) return;
    // beside the head, clear of the centred name tag
    const x = Math.round(w.x) + 12;
    const y = Math.round(w.y) - 36 - (state === 'waiting' && Math.floor(w.t * 3) % 2 ? 1 : 0);
    rect(g, x, y, 11, 10, '#241c33');
    rect(g, x + 1, y + 1, 9, 8, style.bg);
    rect(g, x + 1, y + 10, 2, 1, '#241c33'); rect(g, x, y + 11, 1, 1, '#241c33');
    g.drawImage(iconCanvas(style.icon, style.ink), x + 2, y + 2);
  }

  /** Text is drawn on the screen canvas at native resolution so it stays sharp. */
  private drawLabels(ctx: Ctx) {
    const s = this.scale;
    // Galmuri is drawn for 14px; keep it at whole multiples of that on high-DPI screens
    const size = (s >= 3 ? 14 : 12) * Math.max(1, Math.round(this.dpr));
    ctx.font = `${size}px Galmuri14, 'Malgun Gothic', sans-serif`;
    ctx.textBaseline = 'middle';
    const label = (text: string, wx: number, wy: number, border: string) => {
      const width = Math.ceil(ctx.measureText(text).width) + 10;
      const height = size + 6;
      const x = Math.round((this.lx + wx) * s - width / 2);
      const y = Math.round(wy * s - height);
      rect(ctx, x + 2, y + 2, width, height, '#05071a');
      rect(ctx, x, y, width, height, border);
      rect(ctx, x + 1, y + 1, width - 2, height - 2, '#0d1020');
      ctx.fillStyle = '#f1f2fb';
      ctx.fillText(text, x + 5, y + height / 2 + 1);
    };
    label('휴게실', 182, 104, '#5a4d92');
    for (const w of this.crowd.walkers.values()) {
      // the middle sofa seat lifts its tag so three people sitting together stay readable
      const lift = w.at === LOUNGE[1] && !w.route.length ? 4 : 0;
      label(w.agent.name, w.x, w.y - 25 - lift, w.agent.id === this.selected ? '#ffbf69' : '#3a4272');
    }
  }

  private hit(e: MouseEvent): string {
    const box = this.canvas.getBoundingClientRect();
    const wx = ((e.clientX - box.left) * this.dpr) / this.scale - this.lx;
    const wy = ((e.clientY - box.top) * this.dpr) / this.scale;
    const hits = [...this.crowd.walkers.values()].filter(w => Math.abs(wx - w.x) <= 8 && wy >= w.y - 23 && wy <= w.y);
    return hits.sort((a, b) => b.y - a.y)[0]?.agent.id ?? '';
  }

  // ---------------- the room ----------------
  private paintBackground(g: Ctx) {
    const { viewW, viewH, lx } = this;
    // wall in three bands, ceiling lights, skirting — across the whole view
    rect(g, 0, 0, viewW, 15, '#2b3256'); rect(g, 0, 15, viewW, 15, '#303860'); rect(g, 0, 30, viewW, 12, '#363e68');
    for (let x = (lx + 24) % 80 - 80; x < viewW; x += 80) rect(g, x, 0, 36, 2, '#f4f6ff');
    rect(g, 0, 42, viewW, 2, '#22284a'); rect(g, 0, FLOOR_Y, viewW, 1, '#566090');
    // carpet tiles, aligned to the floor plan
    for (let y = FLOOR_Y + 1; y < viewH; y += 8) for (let x = (lx % 8) - 8; x < viewW; x += 8) {
      rect(g, x, y, 8, 8, ((x - lx + y + 800) / 8) % 2 < 1 ? '#3a4262' : '#3e4668');
      rect(g, x, y, 8, 1, '#353d5c');
    }
    // more windows where the view runs past the floor plan
    for (let x = lx - 88; x > -86; x -= 88) this.paintWindow(g, x, 8, 82, 28, 11 + x);
    for (let x = lx + 244; x < viewW; x += 88) this.paintWindow(g, x, 8, 82, 28, 13 + x);
    g.save();
    g.translate(lx, 0);
    this.paintWindow(g, 6, 8, 82, 28, 7);
    this.paintWindow(g, 190, 8, 46, 28, 3);
    // a small landscape painting by the lounge
    rect(g, 170, 12, 16, 16, '#8b6a4a'); rect(g, 171, 13, 14, 14, '#9ad0f8'); rect(g, 171, 21, 14, 6, '#4fbf6f');
    rect(g, 174, 19, 5, 2, '#4fbf6f'); rect(g, 180, 15, 3, 3, '#ffd166'); rect(g, 171, 25, 14, 2, '#2f8f52');
    // door to the hallway, where new helpers come in, with an exit sign and a doormat
    rect(g, 148, 16, 17, 28, '#2a3160'); rect(g, 150, 18, 13, 26, '#4a5488'); rect(g, 152, 20, 9, 6, '#8fd6e0'); rect(g, 160, 31, 2, 2, '#ffd166');
    rect(g, 151, 14, 11, 2, '#1d4b3a'); rect(g, 152, 14, 9, 1, '#5fe39a');
    rect(g, 149, 45, 15, 3, '#7a4a3a'); rect(g, 150, 46, 13, 1, '#a86a4a');
    // lounge rug
    rect(g, 168, 95, 70, 44, '#5a4d92');
    for (let y = 96; y < 138; y += 4) for (let x = 169; x < 237; x += 4) rect(g, x, y, 4, 4, ((x + y) / 4) % 2 < 1 ? '#3e3566' : '#463c74');
    g.restore();
  }

  private paintWindow(g: Ctx, x: number, y: number, w: number, h: number, seed: number) {
    let s = Math.abs(Math.floor(seed)) + 1;
    const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const sky = SKIES[this.period];
    rect(g, x, y, w, h, '#566090');
    sky.bands.forEach((c, i) => rect(g, x + 2, y + 2 + Math.floor(((h - 4) * i) / sky.bands.length), w - 4, Math.ceil((h - 4) / sky.bands.length), c));
    if (sky.stars) for (let i = 0; i < w / 10; i++) rect(g, x + 3 + Math.floor(rand() * (w - 6)), y + 3 + Math.floor(rand() * 8), 1, 1, '#ffffff');
    if (sky.clouds) for (let i = 0; i < w / 30; i++) { const cx = x + 4 + Math.floor(rand() * (w - 16)), cy = y + 4 + Math.floor(rand() * 6); rect(g, cx, cy, 9, 2, '#f4f8ff'); rect(g, cx + 2, cy - 1, 4, 1, '#f4f8ff'); }
    rect(g, x + w - 12, y + 2 + sky.orbY, 4, 4, sky.orb);
    for (let bx = x + 2; bx < x + w - 2;) {
      const bw = Math.min(4 + Math.floor(rand() * 6), x + w - 2 - bx);
      const bh = 6 + Math.floor(rand() * (h - 12));
      const top = y + h - 2 - bh;
      rect(g, bx, top, bw, bh, sky.city);
      for (let wy = top + 2; wy < y + h - 3; wy += 3) for (let wx = bx + 1; wx < bx + bw - 1; wx += 2) if (rand() < sky.lit) rect(g, wx, wy, 1, 1, sky.light);
      bx += bw + (rand() < 0.3 ? 1 : 0);
    }
    for (let i = 1; i < 3; i++) rect(g, x + Math.round((w * i) / 3), y, 1, h, '#566090');
  }

  private drawWhiteboard(g: Ctx) {
    rect(g, 96, 8, 47, 29, '#8b93b4'); rect(g, 97, 9, 45, 27, '#eef0f8'); rect(g, 98, 37, 43, 1, '#8b93b4');
    const columns = [{ x: 99, color: '#5fe3d0' }, { x: 114, color: '#ffd166' }, { x: 129, color: '#b4a8ff' }];
    columns.forEach(c => rect(g, c.x, 11, 12, 2, c.color));
    const counts = [0, 0, 0];
    for (const w of this.crowd.walkers.values()) {
      if (w.leaving) continue;
      const { state, look } = w.agent;
      const col = state === 'working' ? 0 : state === 'waiting' || state === 'error' ? 1 : 2;
      const n = counts[col]!;
      counts[col] = n + 1;
      if (n >= 6) continue;
      const x = columns[col]!.x + (n % 2) * 6, y = 15 + Math.floor(n / 2) * 6;
      rect(g, x, y, 5, 5, state === 'error' ? '#ff6b6b' : shirtColor(look));
      rect(g, x, y + 4, 5, 1, '#00000033');
    }
  }

  private drawClock(g: Ctx) {
    rect(g, 150, 3, 13, 11, '#8b93b4'); rect(g, 151, 4, 11, 9, '#f4f6ff');
    const now = new Date();
    const hand = (angle: number, length: number) => {
      for (let i = 1; i <= length; i++) rect(g, Math.round(156 + Math.sin(angle) * i), Math.round(8 - Math.cos(angle) * i), 1, 1, '#1c2140');
    };
    hand(((now.getHours() % 12) + now.getMinutes() / 60) * (Math.PI / 6), 2);
    hand(now.getMinutes() * (Math.PI / 30), 4);
    rect(g, 156, 8, 1, 1, '#ff6b6b');
  }

  private buildFurniture(): Drawable[] {
    const items: Drawable[] = [];
    const add = (key: number, draw: (g: Ctx) => void) => items.push({ key, draw });
    DESKS.forEach((d, i) => {
      const { x, y } = d;
      add(y - 4.5, g => { // partition, with something personal on top
        rect(g, x - 17, y - 17, 35, 13, '#3b4472'); rect(g, x - 17, y - 17, 35, 2, '#6a77b4'); rect(g, x + 16, y - 15, 2, 11, '#323a68');
        const item = propCanvas(SHELF_PROPS[i]!);
        g.drawImage(item, x - 16, y - 17 - item.height);
      });
      add(y - 0.5, g => { // chair back
        rect(g, x - 8, y - 16, 17, 10, '#2a3060'); rect(g, x - 8, y - 16, 17, 1, '#4a5488'); rect(g, x + 6, y - 15, 3, 9, '#20264a');
      });
      add(y + 6, g => { // desk, monitor, mug
        const occupant = this.crowd.occupant(d);
        const lit = occupant?.agent.state === 'working';
        rect(g, x + 8, y - 17, 8, 11, '#1d2244'); rect(g, x + 9, y - 16, 6, 9, lit ? '#2c6f73' : '#2a3158');
        if (lit) rect(g, x + 8, y - 16, 1, 9, '#5fe3d0');
        rect(g, x + 11, y - 7, 3, 1, '#1d2244');
        rect(g, x - 17, y - 6, 35, 2, '#dfe3f4'); rect(g, x - 17, y - 4, 35, 7, '#bcc3df'); rect(g, x - 17, y + 3, 35, 1, '#8089ad');
        rect(g, x - 16, y + 4, 2, 2, '#565d7d'); rect(g, x + 15, y + 4, 2, 2, '#565d7d');
        const mug = propCanvas(DESK_PROPS[i]!);
        g.drawImage(mug, x - 16, y - 6 - mug.height);
      });
    });
    add(62, g => { // filing cabinet with the printer on top
      rect(g, 1, 44, 12, 18, '#a2abc9'); rect(g, 1, 50, 12, 1, '#6f789c'); rect(g, 1, 56, 12, 1, '#6f789c'); rect(g, 12, 44, 1, 18, '#6f789c');
      for (const hy of [47, 53, 59]) rect(g, 6, hy, 3, 1, '#5d6690');
      rect(g, 1, 38, 12, 6, '#aab3d0'); rect(g, 1, 38, 12, 1, '#c9cfe6'); rect(g, 3, 42, 8, 1, '#241c33');
      const paper = this.printing > 0 ? 3 + Math.floor((2 - this.printing) * 2) % 4 : 3;
      rect(g, 4, 38 - paper, 6, paper, '#f4f6ff');
    });
    add(78, g => { // water cooler
      rect(g, 171, 52, 7, 7, '#8fd6e0'); rect(g, 172, 53, 1, 4, '#d7f4f7');
      rect(g, 170, 59, 9, 19, '#b9c9ee'); rect(g, 177, 59, 2, 19, '#8d9dcc'); rect(g, 173, 64, 3, 2, '#5367a0');
    });
    add(78, g => { // vending machine
      rect(g, 222, 52, 15, 26, '#2a3160'); rect(g, 223, 53, 13, 24, '#5b6fb5');
      rect(g, 224, 54, 9, 13, '#1d2140');
      ['#e25555', '#ffd166', '#5fe3d0'].forEach((c, i) => { for (let r = 0; r < 3; r++) rect(g, 225 + i * 3, 55 + r * 4, 2, 3, c); });
      const blink = Math.floor(performance.now() / 700) % 2;
      rect(g, 234, 56, 1, 1, blink ? '#ffd166' : '#8a6a2a'); rect(g, 234, 58, 1, 1, '#5fe3d0'); rect(g, 225, 70, 8, 4, '#1d2140');
    });
    add(SOFA.seatY - 3, g => { // sofa back
      rect(g, 180, 101, 46, 13, '#5a63a8'); rect(g, 180, 101, 46, 2, '#8a95dc'); rect(g, 222, 103, 4, 11, '#444c8a');
    });
    add(SOFA.seatY + 5, g => { // sofa seat and arms, in front of whoever sits there
      rect(g, 178, 113, 50, 9, '#7480c8'); rect(g, 178, 113, 50, 1, '#98a3e6');
      rect(g, 178, 107, 5, 15, '#4a5494'); rect(g, 223, 107, 5, 15, '#4a5494'); rect(g, 178, 122, 50, 1, '#2a3060');
    });
    add(131, g => { // coffee table
      rect(g, 194, 125, 20, 2, '#a98568'); rect(g, 194, 127, 20, 3, '#8a6850'); rect(g, 195, 130, 2, 2, '#624837'); rect(g, 211, 130, 2, 2, '#624837');
      g.drawImage(propCanvas('coffee'), 196, 117); g.drawImage(propCanvas('note'), 205, 118);
      // steam drifting up from the cup
      for (let i = 0; i < 2; i++) {
        const f = (performance.now() / 1400 + i / 2) % 1;
        g.globalAlpha = 1 - f;
        rect(g, 199 + i * 2 + (f > 0.5 ? 1 : 0), Math.round(116 - f * 7), 1, 1, '#f4f6ff');
      }
      g.globalAlpha = 1;
    });
    add(60, g => { // bookshelf against the wall
      rect(g, 15, 34, 14, 26, '#5d4234'); rect(g, 16, 35, 12, 24, '#3a2a24');
      const spines = ['#e25555', '#5fe3d0', '#ffd166', '#9b8cff', '#6f94ff', '#4fbf6f'];
      for (let shelf = 0; shelf < 3; shelf++) {
        const sy = 35 + shelf * 8;
        for (let b = 0; b < 5; b++) rect(g, 17 + b * 2, sy + 1 + (b % 3 === 0 ? 1 : 0), 2, 6 - (b % 3 === 0 ? 1 : 0), spines[(b + shelf * 2) % spines.length]!);
        rect(g, 16, sy + 7, 12, 1, '#5d4234');
      }
    });
    add(112, g => { // floor lamp behind the sofa
      rect(g, 176, 91, 1, 21, '#8b93b4'); rect(g, 174, 111, 5, 1, '#8b93b4');
      rect(g, 173, 86, 7, 5, '#ffd166'); rect(g, 173, 86, 7, 1, '#fff3b0'); rect(g, 174, 91, 5, 1, '#d9a63c');
    });
    add(138, g => g.drawImage(propCanvas('fern'), 2, 118));
    add(138, g => g.drawImage(propCanvas('plant'), 224, 118));
    return items;
  }
}
