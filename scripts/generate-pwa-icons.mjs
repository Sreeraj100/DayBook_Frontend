import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function segmentDistance(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

function makePng(size) {
  const stride = size * 4 + 1;
  const pixels = Buffer.alloc(stride * size);
  const bg = [22, 60, 54, 255], ring = [145, 182, 165, 255], white = [246, 247, 244, 255];
  const points = [[0.31, 0.52], [0.44, 0.65], [0.70, 0.35]];
  const radius = size * 0.36, ringWidth = size * 0.023, checkWidth = size * 0.068;
  const samples = [0.2, 0.5, 0.8];
  for (let y = 0; y < size; y += 1) {
    const row = y * stride; pixels[row] = 0;
    for (let x = 0; x < size; x += 1) {
      let nRing = 0, nCheck = 0;
      for (const sy of samples) for (const sx of samples) {
        const px = x + sx, py = y + sy;
        if (Math.abs(Math.hypot(px - size / 2, py - size / 2) - radius) <= ringWidth / 2) nRing += 1;
        const nearCheck = segmentDistance(px / size, py / size, ...points[0], ...points[1]) <= checkWidth / size / 2
          || segmentDistance(px / size, py / size, ...points[1], ...points[2]) <= checkWidth / size / 2;
        if (nearCheck) nCheck += 1;
      }
      const color = nCheck ? white : nRing ? ring : bg;
      const offset = row + 1 + x * 4;
      pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2]; pixels[offset + 3] = color[3];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

for (const [name, size] of [['pwa-192.png', 192], ['pwa-512.png', 512], ['pwa-maskable-512.png', 512]]) {
  writeFileSync(new URL(`../public/${name}`, import.meta.url), makePng(size));
}
