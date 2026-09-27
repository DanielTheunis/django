// Procedural textures for the camera model. Everything is drawn to canvas at
// load time, so the model ships without any image files of its own.
import * as THREE from 'three';

let anisotropy = 4;
export function setAnisotropy(value) { anisotropy = value; }

const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
const SANS = '"Instrument Sans", system-ui, sans-serif';
const SERIF = '"Bodoni Moda", "Didot", Georgia, serif';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(canvas, { color = true, repeat = null } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function rng(seed) {
  let s = seed % 2147483647;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// Turns a tileable height field into a tangent-space normal map.
function heightToNormal(h, w, hh, strength) {
  const [c, ctx] = makeCanvas(w, hh);
  const img = ctx.createImageData(w, hh);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const dx = h[y * w + ((x + 1) % w)] - h[y * w + ((x - 1 + w) % w)];
      const dy = h[((y + 1) % hh) * w + x] - h[((y - 1 + hh) % hh) * w + x];
      let nx = -dx * strength, ny = dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Pebbled leatherette: tileable cellular noise, raised cells with soft valleys.
export function leatherNormal(size = 256, cells = 26) {
  const r = rng(11);
  const pts = [];
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      pts.push([(i + 0.15 + r() * 0.7) / cells, (j + 0.15 + r() * 0.7) / cells]);
    }
  }
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const gi = Math.floor(u * cells), gj = Math.floor(v * cells);
      let f1 = 9, f2 = 9;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ci = (gi + di + cells) % cells, cj = (gj + dj + cells) % cells;
          const p = pts[cj * cells + ci];
          let dx = u - p[0]; dx -= Math.round(dx);
          let dy = v - p[1]; dy -= Math.round(dy);
          const d = Math.hypot(dx, dy) * cells;
          if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
        }
      }
      const e = Math.min(1, (f2 - f1) / 0.45);
      h[y * size + x] = Math.sqrt(e) + r() * 0.06;
    }
  }
  return toTexture(heightToNormal(h, size, size, 3.2), { color: false, repeat: [1, 1] });
}

// Very fine grain for the magnesium body panels.
export function grainNormal(size = 256) {
  const r = rng(5);
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = r();
  // one box blur pass so the grain reads as cast metal, not static
  const b = new Float32Array(h.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let s = 0;
      for (let k = -1; k <= 1; k++) for (let l = -1; l <= 1; l++) {
        s += h[((y + k + size) % size) * size + ((x + l + size) % size)];
      }
      b[y * size + x] = s / 9;
    }
  }
  return toTexture(heightToNormal(b, size, size, 1.4), { color: false, repeat: [3, 3] });
}

// Vertical ridges for zoom/focus rings and dial edges (u runs around the ring).
export function ribNormal(ribs = 90, sharp = 0.5) {
  const w = 1024, hh = 4;
  const h = new Float32Array(w * hh);
  for (let x = 0; x < w; x++) {
    const v = Math.pow(Math.abs(Math.sin((x / w) * Math.PI * ribs)), sharp);
    for (let y = 0; y < hh; y++) h[y * w + x] = v;
  }
  const t = toTexture(heightToNormal(h, w, hh, 2.5), { color: false });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function trackText(ctx, text, x, y, tracking) {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
  return cx - x;
}

function measureTracked(ctx, text, tracking) {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + tracking;
  return w - tracking;
}

// Printed band that wraps around a lens barrel.
export function barrelBand(items, { w = 2048, h = 96, color = '#e9f2f2', accent = '#f08a6e', size = 38 } = {}) {
  const [c, ctx] = makeCanvas(w, h);
  ctx.textBaseline = 'middle';
  const step = w / items.length;
  items.forEach((item, i) => {
    const text = typeof item === 'string' ? item : item.text;
    ctx.fillStyle = typeof item === 'string' ? color : item.color || accent;
    ctx.font = `500 ${size}px ${MONO}`;
    const tw = measureTracked(ctx, text, 6);
    trackText(ctx, text, i * step + (step - tw) / 2, h / 2 + 2, 6);
  });
  const t = toTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// Focal-length scale on the zoom ring.
export function zoomScale({ w = 2048, h = 128 } = {}) {
  const [c, ctx] = makeCanvas(w, h);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e9f2f2';
  ctx.font = `600 44px ${MONO}`;
  const marks = ['28', '35', '50', '70'];
  marks.forEach((m, i) => {
    const x = w * 0.08 + i * 118;
    ctx.fillText(m, x, h / 2);
  });
  const t = toTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// Text set on a circle, for the front bezel of the lens.
export function ringText(text, { size = 1024, radius = 0.4, color = '#e9f2f2', font = 34 } = {}) {
  const [c, ctx] = makeCanvas(size, size);
  ctx.translate(size / 2, size / 2);
  ctx.fillStyle = color;
  ctx.font = `500 ${font}px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const r = radius * size;
  const chars = [...text];
  const total = chars.reduce((s, ch) => s + ctx.measureText(ch).width + 5, 0);
  let a = -Math.PI / 2 - (total / r) / 2;
  for (const ch of chars) {
    const cw = ctx.measureText(ch).width + 5;
    a += cw / 2 / r;
    ctx.save();
    ctx.rotate(a);
    ctx.translate(0, -r);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    a += cw / 2 / r;
  }
  return toTexture(c);
}

// Top face of a mode or exposure dial.
export function dialFace(labels, { size = 512, accent = null } = {}) {
  const [c, ctx] = makeCanvas(size, size);
  ctx.fillStyle = '#16191b';
  ctx.fillRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  // machined concentric texture
  for (let r = 8; r < size / 2; r += 3) {
    ctx.strokeStyle = `rgba(255,255,255,${0.012 + (r % 9 === 0 ? 0.02 : 0)})`;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#e9f2f2';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const n = labels.length;
  labels.forEach((label, i) => {
    const a = (i / n) * Math.PI * 2;
    ctx.save();
    ctx.rotate(a);
    ctx.font = `600 ${label.length > 2 ? 30 : 40}px ${SANS}`;
    ctx.fillStyle = accent && i === 0 ? accent : '#e9f2f2';
    ctx.fillText(label, 0, -size * 0.36);
    ctx.fillRect(-1.5, -size * 0.47, 3, 16);
    ctx.restore();
  });
  return toTexture(c);
}

// Circuit board with gold traces on a deep teal solder mask.
export function pcb({ w = 1024, h = 680 } = {}) {
  const [c, ctx] = makeCanvas(w, h);
  const r = rng(21);
  ctx.fillStyle = '#0b3b3e';
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = 'round';
  for (let i = 0; i < 180; i++) {
    let x = r() * w, y = r() * h;
    ctx.strokeStyle = `rgba(214,176,98,${0.35 + r() * 0.4})`;
    ctx.lineWidth = 1.5 + r() * 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 3; k++) {
      if (r() > 0.5) x += (r() - 0.5) * 260; else y += (r() - 0.5) * 200;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#d8b56a';
    ctx.beginPath();
    ctx.arc(x, y, 3 + r() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const chips = [[380, 250, 190, 190], [640, 120, 140, 90], [150, 420, 120, 120], [700, 420, 160, 110], [120, 110, 90, 60]];
  for (const [x, y, cw, chh] of chips) {
    ctx.fillStyle = '#0a0d0e';
    ctx.fillRect(x, y, cw, chh);
    ctx.strokeStyle = '#c9a45a';
    ctx.lineWidth = 3;
    for (let k = 6; k < cw - 4; k += 10) {
      ctx.beginPath(); ctx.moveTo(x + k, y - 8); ctx.lineTo(x + k, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + k, y + chh); ctx.lineTo(x + k, y + chh + 8); ctx.stroke();
    }
  }
  ctx.fillStyle = 'rgba(233,242,242,.8)';
  ctx.font = `500 22px ${MONO}`;
  ctx.fillText('FTF-MAIN  REV 2026', 400, 480);
  ctx.fillText('FTF-IMG', 420, 350);
  return toTexture(c);
}

// Battery and memory card labels.
export function label(lines, { w = 512, h = 256, bg = '#111416', fg = '#e9f2f2', accent = '#36c5bf' } = {}) {
  const [c, ctx] = makeCanvas(w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = accent;
  ctx.fillRect(0, h - 26, w, 26);
  ctx.fillStyle = fg;
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => {
    ctx.font = i === 0 ? `600 54px ${SANS}` : `500 26px ${MONO}`;
    ctx.fillText(line, 28, 26 + (i === 0 ? 0 : 70 + (i - 1) * 36));
  });
  return toTexture(c);
}

// Small serif badge for the body front, where a model name would sit.
export function badge(text, { w = 256, h = 128 } = {}) {
  const [c, ctx] = makeCanvas(w, h);
  ctx.fillStyle = '#e9f2f2';
  ctx.textBaseline = 'middle';
  ctx.font = `italic 500 86px ${SERIF}`;
  ctx.fillText('ƒ', 20, h / 2);
  ctx.font = `500 40px ${MONO}`;
  ctx.fillText(text, 86, h / 2 + 10);
  return toTexture(c);
}

// The rear LCD: live view of the brand artwork with a camera overlay.
export function screen(img, { w = 1200, h = 800 } = {}) {
  const [c, ctx] = makeCanvas(w, h);
  ctx.fillStyle = '#082024';
  ctx.fillRect(0, 0, w, h);
  if (img) {
    const ir = img.width / img.height, cr = w / h;
    const sw = ir > cr ? img.height * cr : img.width;
    const sh = ir > cr ? img.height : img.width / cr;
    ctx.drawImage(img, (img.width - sw) / 2, img.height * 0.52 - sh / 2, sw, sh, 0, 0, w, h);
  }
  ctx.fillStyle = 'rgba(4,20,24,.55)';
  ctx.fillRect(0, h - 78, w, 78);
  ctx.fillRect(0, 0, w, 64);
  ctx.fillStyle = '#ffffff';
  ctx.font = `500 34px ${MONO}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('M', 30, h - 39);
  ctx.fillText('1/250', 110, h - 39);
  ctx.fillText('F2.8', 300, h - 39);
  ctx.fillText('ISO 100', 460, h - 39);
  ctx.fillText('±0.0', 690, h - 39);
  ctx.fillText('RAW', 30, 32);
  ctx.fillText('4K', 140, 32);
  ctx.fillStyle = '#36c5bf';
  ctx.fillText('● AF-C', 230, 32);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('36', w - 90, 32);
  // battery glyph
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.strokeRect(w - 190, 18, 60, 28);
  ctx.fillRect(w - 186, 22, 42, 20);
  ctx.fillRect(w - 130, 26, 5, 12);
  // focus brackets
  ctx.strokeStyle = '#36c5bf';
  ctx.lineWidth = 4;
  const fx = w * 0.5, fy = h * 0.46, fs = 70;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.beginPath();
    ctx.moveTo(fx + sx * fs, fy + sy * (fs - 26));
    ctx.lineTo(fx + sx * fs, fy + sy * fs);
    ctx.lineTo(fx + sx * (fs - 26), fy + sy * fs);
    ctx.stroke();
  }
  // histogram
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  for (let i = 0; i < 64; i++) {
    const v = Math.exp(-((i - 40) ** 2) / 160) * 60 + Math.exp(-((i - 18) ** 2) / 60) * 26 + 4;
    ctx.fillRect(w - 250 + i * 3, h - 100 - v, 2, v);
  }
  return toTexture(c);
}
