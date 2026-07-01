// Placeholder brand-asset generator — pure Node, ZERO dependencies (built-in zlib only).
// Rasterizes on-brand PWA icons + an OG banner as real PNGs so the app is installable and links
// unfurl TODAY, without pulling in sharp/imagemagick (keeps the repo dependency-free). These are
// intentionally simple placeholders — regenerate finals from the prompts in docs/BRAND.md and drop
// them in at the same paths. 4x supersampled + box-downsampled for clean edges.
//
//   node scripts/gen_icons.mjs      # writes icons/*.png + og/og-default.png
//
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { encodePng } from "./lib/png.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- palette (matches index.html :root) ---
const BG = [13, 17, 23];      // #0d1117
const DISC = [27, 34, 48];    // subtle depth disc behind the bolt
const ACC = [88, 166, 255];   // #58a6ff accent
const BAR = [63, 185, 80];    // #3fb950 ok-green accent bar (OG)

// classic non-self-intersecting lightning bolt in a 0..1 box (y down)
const BOLT = [
  [0.55, 0.05], [0.25, 0.55], [0.45, 0.55], [0.35, 0.95],
  [0.75, 0.40], [0.53, 0.40], [0.55, 0.05],
];

const pip = (px, py, poly) => {                 // even-odd point-in-polygon
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

// Render one image at (w,h). opts: {rounded, discR, boltBox:[cx,cy,scale], bottomBar}
// Returns a Uint8Array RGBA buffer (supersampled internally, box-downsampled to w,h).
function render(w, h, opts = {}) {
  const S = 4, W = w * S, H = h * S;
  const buf = new Uint8Array(W * H * 4);
  const set = (x, y, [r, g, b]) => { const o = (y * W + x) * 4; buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = 255; };

  // background (rounded-rect for app icons, full-bleed otherwise)
  const rad = opts.rounded ? Math.round(Math.min(W, H) * opts.rounded) : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let on = true;
    if (rad) {
      const cx = Math.min(x, W - 1 - x), cy = Math.min(y, H - 1 - y);
      if (cx < rad && cy < rad) on = (rad - cx) ** 2 + (rad - cy) ** 2 <= rad * rad;
    }
    if (on) set(x, y, BG);
  }

  // depth disc
  if (opts.disc) {
    const [dcx, dcy, dr] = opts.disc, cx = dcx * W, cy = dcy * H, r = dr * Math.min(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r && buf[(y * W + x) * 4 + 3]) set(x, y, DISC);
  }

  // bolt
  if (opts.bolt) {
    const [bcx, bcy, bs] = opts.bolt;                       // center + scale (fraction of min dim)
    const size = bs * Math.min(W, H), x0 = bcx * W - size / 2, y0 = bcy * H - size / 2;
    const [minX, maxX, minY, maxY] = [x0, x0 + size, y0, y0 + size];
    for (let y = Math.max(0, minY | 0); y < Math.min(H, maxY | 0); y++)
      for (let x = Math.max(0, minX | 0); x < Math.min(W, maxX | 0); x++) {
        const u = (x - x0) / size, v = (y - y0) / size;
        if (pip(u, v, BOLT) && buf[(y * W + x) * 4 + 3]) set(x, y, ACC);
      }
  }

  // bottom accent bar (OG)
  if (opts.bar) for (let y = H - Math.round(H * opts.bar); y < H; y++) for (let x = 0; x < W; x++) set(x, y, BAR);

  // box downsample S x S -> final
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const o = ((y * S + sy) * W + (x * S + sx)) * 4;
      r += buf[o]; g += buf[o + 1]; b += buf[o + 2]; a += buf[o + 3];
    }
    const n = S * S, o = (y * w + x) * 4;
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
  }
  return out;
}

// --- PNG output (encoder shared via scripts/lib/png.mjs) ---
const write = (rel, w, h, rgba) => { const p = join(ROOT, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, encodePng(w, h, rgba)); console.log("wrote", rel, `(${w}x${h})`); };

// --- emit the asset set ---
mkdirSync(join(ROOT, "icons"), { recursive: true });
const appIcon = (n) => render(n, n, { rounded: 0.22, disc: [0.5, 0.5, 0.34], bolt: [0.5, 0.5, 0.5] });
write("icons/icon-192.png", 192, 192, appIcon(192));
write("icons/icon-512.png", 512, 512, appIcon(512));
// maskable: full-bleed bg, bolt kept inside the ~80% safe zone
write("icons/icon-maskable-512.png", 512, 512, render(512, 512, { disc: [0.5, 0.5, 0.30], bolt: [0.5, 0.5, 0.40] }));
// iOS apple-touch-icon: opaque, no rounding (iOS masks it), 180x180
write("icons/apple-touch-icon.png", 180, 180, render(180, 180, { disc: [0.5, 0.5, 0.34], bolt: [0.5, 0.5, 0.5] }));
write("icons/favicon-32.png", 32, 32, render(32, 32, { disc: [0.5, 0.5, 0.36], bolt: [0.5, 0.5, 0.62] }));
// OG banner 1200x630: bolt on the left, accent bar at the bottom (final art with text comes from docs/BRAND.md)
write("og/og-default.png", 1200, 630, render(1200, 630, { disc: [0.22, 0.5, 0.30], bolt: [0.22, 0.5, 0.5], bar: 0.03 }));
console.log("done — placeholders generated. Regenerate finals from the prompts in docs/BRAND.md.");
