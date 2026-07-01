// Reusable, dependency-free PNG toolkit (built-in zlib only): a tiny RGBA canvas + an 8-bit PNG
// encoder. Shared by scripts/gen_icons.mjs (brand icons) and scripts/gen_og_cards.mjs (per-area OG
// cards). Supersample by constructing at scale S and calling toPNG(S) to box-downsample for clean edges.
import { deflateSync } from "node:zlib";
import { drawText, textWidth } from "./font5x7.mjs";

const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// encode raw RGBA bytes (w*h*4) -> PNG Buffer.
export function encodePng(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

export class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.buf = new Uint8Array(w * h * 4); }
  set(x, y, [r, g, b, a = 255]) {
    x = x | 0; y = y | 0; if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 4;
    if (a >= 255) { this.buf[o] = r; this.buf[o + 1] = g; this.buf[o + 2] = b; this.buf[o + 3] = 255; return; }
    const ia = 255 - a; // simple src-over onto opaque bg
    this.buf[o] = (r * a + this.buf[o] * ia) / 255; this.buf[o + 1] = (g * a + this.buf[o + 1] * ia) / 255; this.buf[o + 2] = (b * a + this.buf[o + 2] * ia) / 255; this.buf[o + 3] = 255;
  }
  fillRect(x, y, w, h, color) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, color); }
  fillCircle(cx, cy, r, color) { for (let j = cy - r; j <= cy + r; j++) for (let i = cx - r; i <= cx + r; i++) if ((i - cx) ** 2 + (j - cy) ** 2 <= r * r) this.set(i, j, color); }
  // even-odd polygon fill; poly = [[x,y],...] in pixels.
  fillPolygon(poly, color) {
    let minY = Infinity, maxY = -Infinity;
    for (const [, py] of poly) { minY = Math.min(minY, py); maxY = Math.max(maxY, py); }
    for (let y = Math.max(0, minY | 0); y <= Math.min(this.h - 1, maxY | 0); y++) {
      const xs = [];
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y)) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) this.set(x, y, color);
    }
  }
  text(x, y, str, scale, color) { return drawText((px, py, c) => this.set(px, py, c), x, y, str, scale, color); }
  textWidth(str, scale) { return textWidth(str, scale); }
  // box-downsample by factor S -> new RGBA bytes at (w/S, h/S).
  toPNG(S = 1) {
    if (S === 1) return encodePng(this.w, this.h, this.buf);
    const w = Math.floor(this.w / S), h = Math.floor(this.h / S), out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) { const o = ((y * S + sy) * this.w + (x * S + sx)) * 4; r += this.buf[o]; g += this.buf[o + 1]; b += this.buf[o + 2]; a += this.buf[o + 3]; }
      const n = S * S, o = (y * w + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
    return encodePng(w, h, out);
  }
}
