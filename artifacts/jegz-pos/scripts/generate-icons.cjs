const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const outDir = path.resolve(__dirname, '..', 'public');

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function roundedRectSDF(x, y, cx, cy, half, radius) {
  const dx = Math.abs(x - cx) - (half - radius);
  const dy = Math.abs(y - cy) - (half - radius);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(dx, dy), 0) - radius;
}

function renderIcon(size) {
  const SS = 4;
  const W = size * SS;
  const bg = [0xff, 0x3c, 0x00];
  const fg = [255, 255, 255];
  const canvas = new Float64Array(W * W * 3);

  const cx = W / 2, cy = W / 2;
  const rectHalf = W * 0.46;
  const radius = W * 0.19;

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const d = roundedRectSDF(x + 0.5, y + 0.5, cx, cy, rectHalf, radius);
      const alpha = Math.min(1, Math.max(0, 0.5 - d));
      if (alpha > 0) {
        const i = (y * W + x) * 3;
        canvas[i] += bg[0] * alpha;
        canvas[i + 1] += bg[1] * alpha;
        canvas[i + 2] += bg[2] * alpha;
      }
    }
  }

  // Draw a bold white "J"
  const stroke = W * 0.15;
  const stemX = cx - W * 0.10;
  const stemTop = cy - rectHalf + W * 0.16;
  const stemBottom = cy + rectHalf - W * 0.22;
  const hookCx = stemX - W * 0.18;
  const hookCy = stemBottom + W * 0.12;
  const hookR = W * 0.16;
  const hookWidth = stroke * 1.4;

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const px = x + 0.5, py = y + 0.5;
      let inShape = false;

      // vertical stem (rounded by stroke)
      const dxStem = Math.abs(px - stemX);
      const dyStem = py - stemTop;
      if (dxStem <= stroke / 2 && dyStem >= -stroke / 2 && py <= stemBottom + stroke / 2) inShape = true;
      // rounded caps of stem
      if (Math.hypot(px - stemX, py - stemTop) <= stroke / 2) inShape = true;
      if (Math.hypot(px - stemX, py - stemBottom) <= stroke / 2) inShape = true;

      // bottom hook: thick arc - approximate with ring around hookCx/cy and a horizontal floor
      const dHook = Math.hypot(px - hookCx, py - hookCy);
      if (dHook <= hookR && dHook >= hookR - hookWidth) inShape = true;
      // floor line from stem to hook
      if (py >= stemBottom - stroke * 0.1 && py <= stemBottom + stroke * 0.9 && px >= hookCx - hookWidth && px <= stemX + stroke / 2) inShape = true;

      if (inShape) {
        const i = (y * W + x) * 3;
        canvas[i] = canvas[i] * 0 + fg[0];
        canvas[i + 1] = canvas[i + 1] * 0 + fg[1];
        canvas[i + 2] = canvas[i + 2] * 0 + fg[2];
      }
    }
  }

  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (y * SS + sy) * W + (x * SS + sx);
          r += canvas[px * 3];
          g += canvas[px * 3 + 1];
          b += canvas[px * 3 + 2];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = 255;
    }
  }
  return out;
}

for (const size of [192, 512]) {
  const png = encodePNG(size, size, renderIcon(size));
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, png);
  console.log(`Wrote ${file} (${png.length} bytes)`);
}
{
  const size = 180;
  const png = encodePNG(size, size, renderIcon(size));
  const file = path.join(outDir, 'apple-touch-icon.png');
  fs.writeFileSync(file, png);
  console.log(`Wrote ${file} (${png.length} bytes)`);
}
console.log('Done.');
