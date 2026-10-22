// Turns pixel grids into canvases (for the office) and data URLs (for DOM avatars), cached by key.
import { ICONS, PROPS, workerSprite, type Facing, type IconName, type Look, type Pose, type PropName, type Sprite } from '../../shared/pixels.ts';

const cache = new Map<string, HTMLCanvasElement>();

function paint(sprite: Sprite): HTMLCanvasElement {
  const { grid, palette } = sprite;
  const canvas = document.createElement('canvas');
  canvas.width = grid[0]?.length ?? 0;
  canvas.height = grid.length;
  const ctx = canvas.getContext('2d')!;
  grid.forEach((row, y) => row.forEach((key, x) => {
    const color = palette[key];
    if (key === '.' || !color) return;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  }));
  return canvas;
}

function cached(key: string, make: () => Sprite): HTMLCanvasElement {
  let canvas = cache.get(key);
  if (!canvas) cache.set(key, (canvas = paint(make())));
  return canvas;
}

export const workerCanvas = (look: Look, pose: Pose, facing: Facing) => cached(`w:${look}:${pose}:${facing}`, () => workerSprite(look, pose, facing));
export const propCanvas = (name: PropName) => cached(`p:${name}`, () => PROPS[name]);
export const iconCanvas = (name: IconName, ink: string) => cached(`i:${name}:${ink}`, () => ({ grid: ICONS[name], palette: { k: ink } }));

/** Scaled-up PNG of a canvas region, for <img>/CSS backgrounds in the sidebar. */
function dataUrl(source: HTMLCanvasElement, scale: number, crop = { x: 0, y: 0, w: source.width, h: source.height }): string {
  const out = document.createElement('canvas');
  out.width = crop.w * scale;
  out.height = crop.h * scale;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

const urls = new Map<string, string>();
const memo = (key: string, make: () => string) => urls.get(key) ?? (urls.set(key, make()), urls.get(key)!);
/** Head-and-shoulders portrait (16x16 sprite pixels). */
export const headUrl = (look: Look, scale = 2) => memo(`h:${look}:${scale}`, () => dataUrl(workerCanvas(look, 'idle', 'down'), scale, { x: 0, y: 0, w: 16, h: 16 }));
export const propUrl = (name: PropName, scale = 3) => memo(`p:${name}:${scale}`, () => dataUrl(propCanvas(name), scale));
