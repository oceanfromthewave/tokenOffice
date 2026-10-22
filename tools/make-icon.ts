// Writes build/icon.png (app + installer + tray) and public/favicon.png from the first worker's head.
// Run: npm run icon
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { workerSprite } from '../src/shared/pixels.ts';

const TILE = '#242a4a';
const { grid, palette } = workerSprite('momo', 'idle');
const head = grid.slice(0, 16);

function png(size: number): Buffer {
  const cell = size / 16;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const key = head[Math.floor(y / cell)]![Math.floor(x / cell)]!;
      raw.set([...rgb(key === '.' ? TILE : palette[key]!), 255], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf: Buffer) => { let c = ~0; for (const b of buf) c = crcTable[(c ^ b) & 255]! ^ (c >>> 8); return ~c >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync(new URL('../build/icon.png', import.meta.url), png(256));
writeFileSync(new URL('../public/favicon.png', import.meta.url), png(32));
console.log('build/icon.png, public/favicon.png');
