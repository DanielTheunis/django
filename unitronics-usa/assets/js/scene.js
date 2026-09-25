/* ==========================================================================
   Unitronics USA — real-time 3D (three.js, physically based, no glow)

   One shared WebGL renderer draws every model on the page and copies each
   frame into that element's own 2D canvas. One GPU context keeps phones fast,
   and only models that are on screen are built and rendered.

   Usage: <div data-scene="chip|rack|gyro|display|totem|globe|ledwall|devboard|switch|cctv|spanner"></div>
   ========================================================================== */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const coarse = matchMedia("(pointer: coarse)").matches;
const lowPower = coarse || (navigator.hardwareConcurrency || 8) <= 4;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const DPR = Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2);
const SEG = lowPower ? 32 : 64;
const UP = new THREE.Vector3(0, 1, 0);

/* Helpers ---------------------------------------------------------------- */
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d")];
}
function tex(canvas, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const ease = (x) => x * x * (3 - 2 * x);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/* Fine surface detail so parts read as real materials, not smooth CG. */
let _brush, _grain;
function brushTex() {
  if (_brush) return _brush;
  const [c, x] = makeCanvas(512, 512), r = rng(11);
  x.fillStyle = "#c8c8c8"; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 5000; i++) {
    const v = 150 + r() * 105 | 0;
    x.fillStyle = `rgba(${v},${v},${v},${0.25 + r() * 0.4})`;
    x.fillRect(r() * 512, r() * 512, 20 + r() * 200, 1);
  }
  _brush = tex(c, false); _brush.wrapS = _brush.wrapT = THREE.RepeatWrapping; _brush.repeat.set(2, 2);
  return _brush;
}
function grainTex() {
  if (_grain) return _grain;
  const [c, x] = makeCanvas(256, 256), r = rng(13);
  const img = x.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) { const v = 200 + r() * 55 | 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  x.putImageData(img, 0, 0);
  _grain = tex(c, false); _grain.wrapS = _grain.wrapT = THREE.RepeatWrapping; _grain.repeat.set(4, 4);
  return _grain;
}

const M = {
  chrome: (c = 0xe9ecf0, r = 0.07) => new THREE.MeshPhysicalMaterial({ color: c, metalness: 1, roughness: r }),
  steel: (c = 0xb3b9c2, r = 0.3) => new THREE.MeshPhysicalMaterial({ color: c, metalness: 1, roughness: r * 1.15, roughnessMap: brushTex(), bumpMap: brushTex(), bumpScale: 0.35 }),
  gold: () => new THREE.MeshPhysicalMaterial({ color: 0xe0b45e, metalness: 1, roughness: 0.2 }),
  paint: (c, r = 0.32) => new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.05, roughness: r * 1.1, roughnessMap: grainTex(), bumpMap: grainTex(), bumpScale: 0.08, clearcoat: 0.4, clearcoatRoughness: 0.25 }),
  plastic: (c, r = 0.45) => new THREE.MeshPhysicalMaterial({ color: c, metalness: 0, roughness: r * 1.1, roughnessMap: grainTex(), bumpMap: grainTex(), bumpScale: 0.12 }),
  rubber: (c = 0x16181b) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.92 }),
  glass: (c = 0x07080a) => new THREE.MeshPhysicalMaterial({ color: c, metalness: 0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02 }),
  led: (c) => new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: c, emissiveIntensity: 1, roughness: 0.3 }),
};

function rbox(w, h, d, r = 0.03, seg = 3) { return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) * 0.999); }
function mesh(geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; }

/* Engraved / printed text on a transparent plane. */
function decal(lines, w, h, { color = 0x50555d, metal = 1, rough = 0.55, px = 1024, align = "center" } = {}) {
  const ph = Math.round(px * (h / w));
  const [c, x] = makeCanvas(px, ph);
  x.fillStyle = "#fff"; x.textAlign = align; x.textBaseline = "middle";
  lines.forEach(([text, size, font = "Michroma", weight = 400, yy = 0.5]) => {
    x.font = `${weight} ${size * ph}px ${font}, sans-serif`;
    x.fillText(text, align === "center" ? px / 2 : px * 0.04, ph * yy);
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({
    map: tex(c), transparent: true, color, metalness: metal, roughness: rough,
    polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false,
  }));
}

/* A printed circuit board texture: solder mask, copper traces, silkscreen. */
function pcbTexture(W, H, seed, traces, extra) {
  const r = rng(seed);
  const [c, a] = makeCanvas(W, H);
  const bg = a.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0b1a14"); bg.addColorStop(1, "#06100c");
  a.fillStyle = bg; a.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) { a.fillStyle = `rgba(255,255,255,${r() * 0.02})`; a.fillRect(r() * W, r() * H, 1 + r() * 2, 1); }
  a.lineCap = "round"; a.lineJoin = "round";
  for (const tr of traces) {
    a.strokeStyle = "rgba(190,150,74,0.85)"; a.lineWidth = tr.w;
    a.beginPath(); tr.pts.forEach(([x, y], i) => (i ? a.lineTo(x * W, y * H) : a.moveTo(x * W, y * H))); a.stroke();
    const [ex, ey] = tr.pts[tr.pts.length - 1];
    a.fillStyle = "#d4af62"; a.beginPath(); a.arc(ex * W, ey * H, tr.w + 3, 0, 7); a.fill();
    a.fillStyle = "#08100d"; a.beginPath(); a.arc(ex * W, ey * H, tr.w * 0.55, 0, 7); a.fill();
  }
  extra?.(a, W, H, r);
  return tex(c);
}

/* Emissive mask of the traces, driven by a shader so current visibly
   pulses outward from the chip, plus a ring on tap. */
function pulseBoard(map, W, H, traces, centre) {
  const [c, e] = makeCanvas(W, H);
  e.fillStyle = "#000"; e.fillRect(0, 0, W, H);
  e.lineCap = "round"; e.lineJoin = "round"; e.strokeStyle = "#fff"; e.fillStyle = "#fff";
  for (const tr of traces) {
    e.lineWidth = tr.w; e.beginPath();
    tr.pts.forEach(([x, y], i) => (i ? e.lineTo(x * W, y * H) : e.moveTo(x * W, y * H))); e.stroke();
    const [ex, ey] = tr.pts[tr.pts.length - 1];
    e.beginPath(); e.arc(ex * W, ey * H, tr.w + 3, 0, 7); e.fill();
  }
  const U = { uTime: { value: 0 }, uPulse: { value: 0 } };
  const mat = new THREE.MeshPhysicalMaterial({
    map, emissiveMap: tex(c), emissive: new THREE.Color(0x3ec8ff), emissiveIntensity: 1.6,
    roughness: 0.5, metalness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.25,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uPulse = U.uPulse;
    sh.fragmentShader = "uniform float uTime;\nuniform float uPulse;\n" + sh.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
      vec2 dv = (vEmissiveMapUv - vec2(${centre[0].toFixed(3)}, ${centre[1].toFixed(3)})) * vec2(${(W / H).toFixed(3)}, 1.0);
      float dd = length(dv);
      float wave = pow(0.5 + 0.5 * sin(dd * 32.0 - uTime * 2.8), 10.0);
      float ring = uPulse * smoothstep(0.0, 1.0, 1.0 - abs(dd - (1.0 - uPulse) * 0.8) * 9.0);
      totalEmissiveRadiance *= wave * 0.9 + ring * 2.2;`);
  };
  return { mat, U };
}

/* ==========================================================================
   MODELS — each returns { object, camera, radius, floorY, update(t, dt, pulse) }
   ========================================================================== */

/* CHIP — processor on a PCB (home hero) */
function chip() {
  const g = new THREE.Group();
  const r = rng(7);
  const lo = 0.27, hi = 0.73, traces = [];
  for (let i = 0; i < (lowPower ? 130 : 190); i++) {
    const side = i % 4, t = lo + 0.03 + r() * (hi - lo - 0.06);
    const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][side];
    let [x, y] = [[t, lo], [hi, t], [t, hi], [lo, t]][side];
    const pts = [[x, y]];
    const l1 = 0.015 + r() * 0.07; x += dx * l1; y += dy * l1; pts.push([x, y]);
    const lat = r() < 0.5 ? -1 : 1, l2 = r() * 0.07;
    x += dx * l2 + (dy ? lat * l2 : 0); y += dy * l2 + (dx ? lat * l2 : 0); pts.push([x, y]);
    const end = 0.03 + r() * 0.2;
    if (dx) x = dx > 0 ? Math.max(x, 1 - end) : Math.min(x, end); else y = dy > 0 ? Math.max(y, 1 - end) : Math.min(y, end);
    pts.push([x, y]);
    traces.push({ pts, w: 1.6 + r() * 2.6 });
  }
  const map = pcbTexture(1024, 1024, 7, traces, (a, W, H) => {
    a.strokeStyle = "rgba(220,226,232,0.55)"; a.lineWidth = 2;
    a.strokeRect(lo * W - 18, lo * H - 18, (hi - lo) * W + 36, (hi - lo) * H + 36);
    a.fillStyle = "rgba(220,226,232,0.6)";
    a.font = "400 22px Michroma, sans-serif"; a.fillText("UNITRONICS USA", 40, H - 44);
    a.font = "16px Inter, sans-serif"; a.fillText("UX-9 CORE  ·  REV 2.4  ·  POWERED BY INNOVATION", 40, H - 20);
  });
  const board = mesh(rbox(4.4, 0.1, 4.4, 0.05, 4), M.plastic(0x0a1310, 0.55));
  const pb = pulseBoard(map, 1024, 1024, traces, [0.5, 0.5]);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(4.34, 4.34), pb.mat);
  top.rotation.x = -Math.PI / 2; top.position.y = 0.0505;
  g.add(board, top);

  const chipG = new THREE.Group();
  const pkg = mesh(rbox(2.0, 0.2, 2.0, 0.03, 4), M.plastic(0x15171b, 0.4), 0, 0.18, 0);
  const lid = mesh(rbox(1.46, 0.07, 1.46, 0.025, 4), M.steel(0xaab0b9, 0.3), 0, 0.31, 0);
  const et = decal([["UNITRONICS", 0.11], ["UX-9  ·  NEURAL CORE", 0.045, "Inter", 500, 0.62], ["POWERED BY INNOVATION", 0.032, "Inter", 400, 0.7]], 1.42, 1.42);
  et.rotation.x = -Math.PI / 2; et.position.y = 0.3455;
  chipG.add(pkg, lid, et);
  g.add(chipG);

  const pins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.045, 0.024, 0.26), M.gold(), 64);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1);
  let k = 0;
  for (let sd = 0; sd < 4; sd++) for (let i = 0; i < 16; i++) {
    q.setFromAxisAngle(UP, (sd * Math.PI) / 2);
    pins.setMatrixAt(k++, m4.compose(new THREE.Vector3(-0.84 + (i / 15) * 1.68, 0.07, 1.08).applyQuaternion(q), q, s1));
  }
  g.add(pins);

  const n = lowPower ? 60 : 110;
  const smd = new THREE.InstancedMesh(rbox(0.14, 0.06, 0.07, 0.01, 2), M.plastic(0xffffff, 0.45), n);
  const pal = [0x2a2b2e, 0x8b6b43, 0x1b1c1f, 0x6d5335];
  for (let i = 0; i < n; i++) {
    let x, z;
    do { x = (r() * 2 - 1) * 1.95; z = (r() * 2 - 1) * 1.95; } while (Math.abs(x) < 1.4 && Math.abs(z) < 1.4);
    q.setFromAxisAngle(UP, r() < 0.5 ? 0 : Math.PI / 2);
    smd.setMatrixAt(i, m4.compose(new THREE.Vector3(x, 0.08, z), q, s1));
    smd.setColorAt(i, new THREE.Color(pal[i % 4]));
  }
  g.add(smd);
  const capGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.34, 40);
  const alu = M.steel(0xaab0b8, 0.3), sleeve = M.paint(0x101216, 0.35);
  [[-1.75, -1.75], [1.75, 1.75], [1.75, -1.75]].forEach(([x, z]) => g.add(mesh(capGeo, [sleeve, alu, alu], x, 0.22, z)));
  g.add(mesh(rbox(0.42, 0.1, 0.18, 0.04), M.chrome(), -1.7, 0.1, 1.6));

  return {
    object: g, camera: new THREE.Vector3(0, 5.2, 6.4), radius: 3.0, floorY: -0.06, startRotation: -0.55,
    update(t, dt, p) {
      pb.U.uTime.value = t; pb.U.uPulse.value = p;
      chipG.position.y = Math.sin(p * Math.PI) * 0.35;
      chipG.rotation.y = p * Math.PI * 0.5;
      g.position.y = Math.sin(t * 0.8) * 0.05;
    },
  };
}

/* LED WALL — die-cast LED tiles with individual RGB pixels; one tile slides into place (LED screens) */
function ledwall() {
  const g = new THREE.Group();
  const T = 1.0, gap = 0.01, cols = 2, rows = 2, px = 48;
  const PW = cols * px, PH = rows * px;
  const [cc, cx] = makeCanvas(PW, PH);
  const content = tex(cc);
  content.magFilter = content.minFilter = THREE.NearestFilter; content.generateMipmaps = false;

  // One LED package per pixel: a bright die in a black lens.
  const [mc, mx] = makeCanvas(32, 32);
  mx.fillStyle = "#000"; mx.fillRect(0, 0, 32, 32);
  const dg = mx.createRadialGradient(16, 16, 0, 16, 16, 12);
  dg.addColorStop(0, "#fff"); dg.addColorStop(0.55, "#bbb"); dg.addColorStop(1, "#000");
  mx.fillStyle = dg; mx.beginPath(); mx.arc(16, 16, 12, 0, 7); mx.fill();
  const mask = tex(mc, false); mask.wrapS = mask.wrapT = THREE.RepeatWrapping;

  const faceMat = () => {
    const m = new THREE.MeshPhysicalMaterial({ color: 0x0a0a0b, roughness: 0.6, emissive: 0xffffff, emissiveMap: content, emissiveIntensity: 1.5, clearcoat: 0.25, clearcoatRoughness: 0.4 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uMask = { value: mask }; sh.uniforms.uCells = { value: new THREE.Vector2(PW, PH) };
      sh.fragmentShader = "uniform sampler2D uMask;\nuniform vec2 uCells;\n" + sh.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        float led = texture2D(uMask, vEmissiveMapUv * uCells).r;
        totalEmissiveRadiance *= led * 1.5;
        diffuseColor.rgb += vec3(0.06) * led;`);
    };
    return m;
  };
  const staticMat = faceMat(), movingMat = faceMat();

  const cabMat = M.steel(0x5d636b, 0.5);
  const tiles = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const tile = new THREE.Group();
    tile.add(mesh(rbox(T - gap, T - gap, 0.085, 0.01, 2), cabMat, 0, 0, -0.045));
    const face = new THREE.PlaneGeometry(T - gap - 0.006, T - gap - 0.006);
    const uv = face.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (c + uv.getX(i)) / cols, (r + uv.getY(i)) / rows);
    const moving = r === rows - 1 && c === cols - 1;
    tile.add(mesh(face, moving ? movingMat : staticMat, 0, 0, 0.0005));
    // Rear: ribs, hub board, power/data connectors, handles.
    [-0.25, 0.25].forEach((o) => {
      tile.add(mesh(new THREE.BoxGeometry(T - 0.1, 0.05, 0.04), cabMat, 0, o, -0.105));
      tile.add(mesh(new THREE.BoxGeometry(0.05, T - 0.1, 0.04), cabMat, o, 0, -0.105));
    });
    tile.add(mesh(rbox(0.36, 0.22, 0.03, 0.01), M.plastic(0x0d3b22, 0.5), 0, 0, -0.14));
    [-0.12, 0.12].forEach((o) => {
      const con = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 20), M.plastic(0x18191c, 0.5), o, -0.3, -0.15); con.rotation.x = Math.PI / 2; tile.add(con);
    });
    const handle = mesh(new THREE.TorusGeometry(0.07, 0.012, 10, 24, Math.PI), M.steel(0x9aa1ab, 0.3), 0, 0.33, -0.13); handle.rotation.x = Math.PI / 2; tile.add(handle);
    const home = new THREE.Vector3((c - (cols - 1) / 2) * T, (r - (rows - 1) / 2) * T, 0);
    tile.position.copy(home);
    g.add(tile);
    tiles.push({ tile, home, moving });
  }
  // Stand.
  const legMat = M.steel(0x2e3238, 0.45);
  [-0.6, 0.6].forEach((x) => {
    g.add(mesh(new THREE.BoxGeometry(0.06, 2.1, 0.06), legMat, x, -0.05, -0.2));
    g.add(mesh(rbox(0.1, 0.05, 0.8, 0.01), legMat, x, -1.08, -0.2));
  });

  const word = "UNITRONICS";
  let acc = 1, pulseT = 0;
  const paint = (t, p) => {
    const hue = 200 + Math.sin(t * 0.4) * 20;
    const gr = cx.createLinearGradient(0, 0, PW, PH);
    gr.addColorStop(0, `hsl(${hue},85%,30%)`); gr.addColorStop(1, `hsl(${hue + 50},70%,14%)`);
    cx.fillStyle = gr; cx.fillRect(0, 0, PW, PH);
    for (let i = 0; i < 3; i++) {
      cx.strokeStyle = `rgba(255,255,255,${0.12 + i * 0.05})`; cx.lineWidth = 2; cx.beginPath();
      for (let x = 0; x <= PW; x += 3) { const y = PH * 0.78 + Math.sin(x * 0.08 + t * 2 + i) * 5 + i * 4; x ? cx.lineTo(x, y) : cx.moveTo(x, y); }
      cx.stroke();
    }
    cx.font = "400 26px Michroma, sans-serif"; cx.textBaseline = "middle"; cx.fillStyle = "#fff";
    const w = cx.measureText(word + "  ").width, off = -((t * 30) % w);
    for (let x = off; x < PW; x += w) cx.fillText(word, x, PH * 0.42);
    if (p > 0) {
      cx.strokeStyle = `rgba(255,255,255,${p})`; cx.lineWidth = 4;
      cx.beginPath(); cx.arc(PW / 2, PH / 2, (1 - p) * PW * 0.8, 0, 7); cx.stroke();
    }
    content.needsUpdate = true;
  };

  g.position.y = 0.05;
  return {
    object: g, camera: new THREE.Vector3(1.9, 0.5, 5.4), radius: 1.55, floorY: -1.08, startRotation: -0.35,
    update(t, dt, p) {
      acc += dt;
      if (acc > 1 / 20) { acc = 0; paint(t, p); }
      const cyc = (t % 7) / 7;
      const k = cyc < 0.25 ? 0 : cyc < 0.5 ? ease((cyc - 0.25) / 0.25) : cyc < 0.9 ? 1 : 1 - ease((cyc - 0.9) / 0.1);
      for (const tl of tiles) {
        if (!tl.moving) continue;
        const out = 1 - k;
        tl.tile.position.set(tl.home.x + out * 0.35, tl.home.y + out * 0.15, tl.home.z + out * 0.9);
        tl.tile.rotation.y = out * -0.7;
        movingMat.emissiveIntensity = k > 0.98 ? 1.5 : 0.0;
      }
    },
  };
}

/* DEVBOARD — microcontroller board with Wi-Fi module and headers (electronics) */
function devboard() {
  const g = new THREE.Group();
  const W = 3.4, D = 1.9;
  const mcu = [0.43, 0.52], ms = 0.13;
  const traces = [], r = rng(3);
  for (let i = 0; i < 20; i++) {
    for (const top of [true, false]) {
      const px = 0.08 + (i / 19) * 0.84, py = top ? 0.08 : 0.92;
      const side = top ? mcu[1] - ms : mcu[1] + ms;
      const tx = mcu[0] - ms + 0.02 + (i / 19) * (2 * ms - 0.04);
      const midY = top ? 0.2 + r() * 0.08 : 0.8 - r() * 0.08;
      traces.push({ pts: [[px, py], [px, midY], [tx, top ? side - 0.06 : side + 0.06], [tx, side]], w: 2.2 });
    }
  }
  const map = pcbTexture(1024, 572, 3, traces, (a, w, h) => {
    a.strokeStyle = "rgba(200,160,80,0.9)"; a.lineWidth = 5;
    a.beginPath(); let x = 0.86 * w; a.moveTo(x, 0.3 * h);
    for (let i = 0; i < 4; i++) { a.lineTo(x, 0.7 * h); x += 14; a.lineTo(x, 0.7 * h); a.lineTo(x, 0.3 * h); x += 14; a.lineTo(x, 0.3 * h); }
    a.stroke();
    a.fillStyle = "rgba(225,230,236,0.75)"; a.font = "400 20px Michroma, sans-serif"; a.fillText("UNITRONICS  UX-32 DEV", 0.08 * w, 0.66 * h);
    a.font = "14px Inter, sans-serif"; a.fillText("POWERED BY INNOVATION", 0.08 * w, 0.71 * h);
  });
  g.add(mesh(rbox(W, 0.08, D, 0.04), M.plastic(0x0a1310, 0.55)));
  const pb = pulseBoard(map, 1024, 572, traces, [mcu[0], 1 - mcu[1]]);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.04, D - 0.04), pb.mat);
  top.rotation.x = -Math.PI / 2; top.position.y = 0.0405; g.add(top);

  const cx = (mcu[0] - 0.5) * W, cz = (mcu[1] - 0.5) * D;
  g.add(mesh(rbox(0.72, 0.1, 0.72, 0.02), M.plastic(0x141619, 0.4), cx, 0.09, cz));
  const lbl = decal([["UNITRONICS", 0.16], ["UX32-S3", 0.1, "Inter", 500, 0.72]], 0.6, 0.6, { color: 0x6a7079, metal: 0.2, rough: 0.6 });
  lbl.rotation.x = -Math.PI / 2; lbl.position.set(cx, 0.141, cz); g.add(lbl);

  // Shielded Wi-Fi module.
  g.add(mesh(rbox(0.9, 0.1, 0.7, 0.015), M.steel(0xc4c9d0, 0.28), 0.62, 0.1, 0));
  const sl = decal([["UNITRONICS", 0.16], ["WIFI · BT 5.0", 0.1, "Inter", 500, 0.72]], 0.8, 0.6, { color: 0x6c727b });
  sl.rotation.x = -Math.PI / 2; sl.position.set(0.62, 0.151, 0); g.add(sl);

  // Pin headers.
  const pins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, 0.36, 0.035), M.gold(), 40);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 20; i++) {
    const x = (0.08 + (i / 19) * 0.84 - 0.5) * W;
    pins.setMatrixAt(i, m4.makeTranslation(x, 0.2, (0.08 - 0.5) * D));
    pins.setMatrixAt(20 + i, m4.makeTranslation(x, 0.2, (0.92 - 0.5) * D));
  }
  g.add(pins);
  [0.08, 0.92].forEach((z) => g.add(mesh(new THREE.BoxGeometry(W * 0.87, 0.1, 0.1), M.plastic(0x101114, 0.5), 0, 0.09, (z - 0.5) * D)));

  // USB-C, buttons, LEDs, crystal, passives.
  g.add(mesh(rbox(0.32, 0.12, 0.3, 0.05), M.chrome(0xd8dce2, 0.15), -W / 2 + 0.12, 0.1, 0));
  g.add(mesh(rbox(0.26, 0.06, 0.22, 0.03), M.plastic(0x0a0a0a, 0.3), -W / 2 + 0.03, 0.1, 0));
  [-0.45, 0.45].forEach((z) => {
    g.add(mesh(rbox(0.22, 0.07, 0.22, 0.01), M.steel(0xb9bfc8, 0.3), -1.1, 0.08, z));
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 20), M.plastic(0x15171a, 0.4), -1.1, 0.14, z));
  });
  const ledA = mesh(rbox(0.08, 0.04, 0.05, 0.01), M.led(0x22ff88), -0.6, 0.06, 0.55);
  const ledB = mesh(rbox(0.08, 0.04, 0.05, 0.01), M.led(0x2aa8ff), -0.45, 0.06, 0.55);
  g.add(ledA, ledB, mesh(rbox(0.3, 0.08, 0.12, 0.04), M.chrome(), -0.1, 0.08, -0.5));
  const smd = new THREE.InstancedMesh(rbox(0.1, 0.05, 0.05, 0.01, 2), M.plastic(0x8b6b43, 0.45), 16);
  for (let i = 0; i < 16; i++) smd.setMatrixAt(i, m4.makeTranslation(-0.95 + (i % 8) * 0.12, 0.06, i < 8 ? -0.3 : 0.3));
  g.add(smd);

  return {
    object: g, camera: new THREE.Vector3(0, 3.6, 4.6), radius: 1.75, floorY: -0.45, startRotation: -0.35,
    update(t, dt, p) {
      pb.U.uTime.value = t; pb.U.uPulse.value = p;
      ledA.material.emissiveIntensity = Math.sin(t * 6) > 0 ? 1.2 : 0.05;
      ledB.material.emissiveIntensity = (Math.sin(t * 2.3) > 0.4 || p > 0.1) ? 1.2 : 0.05;
      g.position.y = Math.sin(t * 0.9) * 0.06 + Math.sin(p * Math.PI) * 0.3;
      g.rotation.x = Math.sin(p * Math.PI) * 0.25;
    },
  };
}

/* SWITCH — network switch with a Cat6 cable that plugs in and out (networking & IT) */
function netswitch() {
  const g = new THREE.Group();
  const W = 3.2, H = 0.46, D = 1.7;
  g.add(mesh(rbox(W, H, D, 0.03), M.steel(0x2d3239, 0.4)));
  const face = decal([["UNITRONICS", 0.3, "Michroma", 400, 0.42], ["UX-SW8  GIGABIT", 0.16, "Inter", 500, 0.75]], 0.8, 0.22, { color: 0xd9dde3, metal: 0.4, rough: 0.35, align: "left" });
  face.position.set(-W / 2 + 0.5, 0.02, D / 2 + 0.002); g.add(face);

  const ports = 8, pw = 0.2, ph = 0.17, x0 = -0.35, gap = 0.25;
  const shieldMat = M.steel(0xc5cad1, 0.3), holeMat = M.plastic(0x050506, 0.9);
  const leds = [];
  const portX = (i) => x0 + i * gap;
  for (let i = 0; i < ports; i++) {
    const x = portX(i);
    g.add(mesh(new THREE.BoxGeometry(pw + 0.03, ph + 0.03, 0.02), shieldMat, x, -0.04, D / 2 + 0.005));
    g.add(mesh(new THREE.BoxGeometry(pw, ph, 0.03), holeMat, x, -0.04, D / 2 + 0.008));
    const la = mesh(new THREE.BoxGeometry(0.05, 0.025, 0.01), M.led(0x22ff88), x - 0.05, 0.12, D / 2 + 0.006);
    const lb = mesh(new THREE.BoxGeometry(0.05, 0.025, 0.01), M.led(0xffae1a), x + 0.05, 0.12, D / 2 + 0.006);
    g.add(la, lb); leds.push([la, lb]);
  }

  const makeCable = (color, curvePts) => {
    const c = new THREE.Group();
    const clear = new THREE.MeshPhysicalMaterial({ color: 0xe6eef3, roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.45, depthWrite: false });
    c.add(mesh(new THREE.BoxGeometry(0.19, 0.155, 0.42), clear, 0, 0, 0.21));
    [0xf2b36b, 0xe07b1a, 0xe9f2ea, 0x2c73d2, 0xeaf1f9, 0x3aa35a, 0xf1ece4, 0x7a4b28]
      .forEach((wc, j) => c.add(mesh(new THREE.BoxGeometry(0.014, 0.014, 0.34), M.plastic(wc, 0.5), -0.07 + j * 0.02, -0.02, 0.24)));
    for (let j = 0; j < 8; j++) c.add(mesh(new THREE.BoxGeometry(0.01, 0.02, 0.1), M.gold(), -0.07 + j * 0.02, 0.06, 0.06));
    const latch = mesh(new THREE.BoxGeometry(0.1, 0.02, 0.3), clear, 0, 0.1, 0.22); latch.rotation.x = -0.25; c.add(latch);
    const jacket = M.plastic(color, 0.42);
    const boot = mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.36, 24), jacket, 0, -0.01, 0.58); boot.rotation.x = Math.PI / 2; c.add(boot);
    const curve = new THREE.CatmullRomCurve3(curvePts.map((p) => new THREE.Vector3(...p)));
    c.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.06, 14), jacket));
    return c;
  };
  const fl = -H / 2 + 0.06 + 0.04;
  const path = (dx) => [[0, 0, 0.7], [0, -0.03, 1.0], [0, fl + 0.02, 1.45], [dx * 0.3, fl, 2.1], [dx, fl, 2.9], [dx * 1.8, fl, 4.2]];
  const livePort = 3;
  const inZ = D / 2 - 0.26, outZ = inZ + 0.75;
  const live = makeCable(0x1b86cf, path(0.5)); live.position.set(portX(livePort), -0.04, inZ); g.add(live);
  const c2 = makeCable(0xd9dce1, path(-1.2)); c2.position.set(portX(0), -0.04, inZ); g.add(c2);
  const c3 = makeCable(0xe9c43a, path(1.5)); c3.position.set(portX(6), -0.04, inZ); g.add(c3);

  let acc = 0;
  const r = rng(9);
  return {
    object: g, camera: new THREE.Vector3(2.4, 2.4, 5.6), radius: 2.3, floorY: -H / 2, startRotation: -0.3,
    update(t, dt, p) {
      const cyc = (t % 6) / 6;
      let k = cyc < 0.2 ? ease(cyc / 0.2) : cyc < 0.75 ? 1 : 1 - ease((cyc - 0.75) / 0.25);
      if (p > 0) k = 1;
      live.position.z = outZ + (inZ - outZ) * k;
      const connected = k > 0.99;
      acc += dt;
      if (acc > 0.08) {
        acc = 0;
        leds.forEach(([a, b], i) => {
          const on = i === 0 || i === 6 || (i === livePort && connected);
          a.material.emissiveIntensity = on ? (r() < 0.75 ? 1.1 : 0.1) : 0.03;
          b.material.emissiveIntensity = on ? 0.9 : 0.03;
        });
      }
    },
  };
}

/* CCTV — bullet camera on a wall bracket, panning (security) */
function cctv() {
  const g = new THREE.Group();
  const white = M.paint(0xf1f2f4, 0.3), dark = M.paint(0x1b1d21, 0.35);
  g.add(mesh(rbox(0.5, 0.7, 0.08, 0.04), white, 0, 0, -1.2));
  g.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.65, 32), M.steel(0x8f969f, 0.35), 0, -0.47, -1.33));
  g.add(mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.06, 40), M.steel(0x8f969f, 0.35), 0, -1.27, -1.33));
  [[-0.16, 0.25], [0.16, 0.25], [-0.16, -0.25], [0.16, -0.25]].forEach(([x, y]) => g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 16), M.chrome(), x, y, -1.15).rotateX(Math.PI / 2)));
  const arm = mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.7, 32), white, 0, 0, -0.85); arm.rotation.x = Math.PI / 2; g.add(arm);
  g.add(mesh(new THREE.SphereGeometry(0.15, 32, 24), M.steel(0xcfd3d9, 0.25), 0, 0, -0.48));

  const pan = new THREE.Group(); pan.position.set(0, 0, -0.48); g.add(pan);
  const tilt = new THREE.Group(); pan.add(tilt);
  tilt.add(mesh(rbox(0.12, 0.3, 0.2, 0.03), white, 0, 0.16, 0.05));
  const head = new THREE.Group(); head.position.set(0, 0.34, 0.3); tilt.add(head);

  const body = mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.4, SEG), white); body.rotation.x = Math.PI / 2; head.add(body);
  const back = mesh(new THREE.SphereGeometry(0.3, SEG, 24, 0, Math.PI * 2, 0, Math.PI / 2), white, 0, 0, -0.7);
  back.rotation.x = -Math.PI / 2; back.scale.set(1, 0.35, 1); head.add(back);
  const bezel = mesh(new THREE.CylinderGeometry(0.305, 0.305, 0.1, SEG), dark, 0, 0, 0.72); bezel.rotation.x = Math.PI / 2; head.add(bezel);
  head.add(mesh(new THREE.CircleGeometry(0.27, SEG), M.glass(0x050608), 0, 0, 0.771));
  head.add(mesh(new THREE.TorusGeometry(0.12, 0.018, 16, SEG), M.chrome(), 0, 0.02, 0.77));
  const lens = mesh(new THREE.SphereGeometry(0.11, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.glass(0x0a1020), 0, 0.02, 0.74);
  lens.rotation.x = Math.PI / 2; lens.scale.set(1, 0.4, 1); head.add(lens);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    head.add(mesh(new THREE.SphereGeometry(0.022, 12, 8), M.plastic(0x3a0a0e, 0.2), Math.cos(a) * 0.205, 0.02 + Math.sin(a) * 0.205, 0.772));
  }
  const rec = mesh(new THREE.SphereGeometry(0.015, 12, 8), M.led(0xff2a2a), 0.16, -0.17, 0.772); head.add(rec);
  const shieldM = M.paint(0xf1f2f4, 0.3); shieldM.side = THREE.DoubleSide;
  const shield = mesh(new THREE.CylinderGeometry(0.36, 0.36, 1.62, SEG, 1, true, -Math.PI * 0.42, Math.PI * 0.84), shieldM, 0, 0.02, 0.1);
  shield.rotation.x = Math.PI / 2; head.add(shield);
  const brand = decal([["UNITRONICS", 0.6]], 0.7, 0.1, { color: 0x1b86cf, metal: 0, rough: 0.4 });
  brand.position.set(0.302, -0.02, 0); brand.rotation.y = Math.PI / 2; head.add(brand);

  g.position.set(0, 0.1, 0.5);
  return {
    object: g, camera: new THREE.Vector3(3.4, 1.3, 4.6), radius: 1.6, floorY: -1.2, startRotation: 0.35,
    update(t, dt, p) {
      const look = clamp01(p * 1.5);
      pan.rotation.y = 0.55 * Math.sin(t * 0.45) * (1 - look) + 0.5 * look;
      tilt.rotation.x = (0.18 + 0.06 * Math.sin(t * 0.33)) * (1 - look);
      rec.material.emissiveIntensity = Math.sin(t * 4) > 0 ? 1.4 : 0.05;
    },
  };
}

/* SPANNER — combination spanner turning a hex bolt (support & maintenance) */
function spanner() {
  const g = new THREE.Group();
  g.add(mesh(rbox(3.6, 0.14, 2.2, 0.04), M.steel(0x4a5058, 0.45), 0, -0.07, 0));
  const boltHead = (x, z) => {
    const b = new THREE.Group();
    b.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 40), M.steel(0xc7ccd3, 0.25), 0, 0.02, 0));
    b.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.18, 6), M.steel(0xb7bdc5, 0.22), 0, 0.13, 0));
    b.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 24), M.steel(0x9da3ac, 0.3), 0, 0.25, 0));
    b.position.set(x, 0, z);
    g.add(b);
    return b;
  };
  const main = boltHead(-0.9, 0);
  [[1.4, 0.75], [1.4, -0.75], [-1.5, 0.8]].forEach(([x, z]) => { boltHead(x, z).rotation.y = x; });

  // Spanner outline: ring end (hex bore) + tapered handle + open jaw.
  const L = 2.6, ringR = 0.34, hexR = 0.235;
  const ring = new THREE.Shape(); ring.absarc(0, 0, ringR, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    i ? hole.lineTo(Math.cos(a) * hexR, Math.sin(a) * hexR) : hole.moveTo(Math.cos(a) * hexR, Math.sin(a) * hexR);
  }
  ring.holes.push(hole);
  const handle = new THREE.Shape();
  handle.moveTo(0.28, -0.13); handle.lineTo(L - 0.3, -0.1); handle.lineTo(L - 0.3, 0.1); handle.lineTo(0.28, 0.13); handle.closePath();
  const jawR = 0.36, s = 0.2, a0 = Math.asin(s / jawR);
  const jaw = new THREE.Shape();
  jaw.moveTo(L + Math.cos(a0) * jawR, s);
  jaw.absarc(L, 0, jawR, a0, Math.PI * 2 - a0, false);
  jaw.lineTo(L - 0.05, -s); jaw.lineTo(L - 0.05, s); jaw.closePath();
  const bevel = { bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 3, curveSegments: 48 };
  const chromeMat = M.chrome(0xdfe3e8, 0.14);
  const tool = new THREE.Group();
  const add = (shape, depth, y) => { const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth, ...bevel }), chromeMat); m.rotation.x = -Math.PI / 2; m.position.y = y; tool.add(m); };
  add(ring, 0.12, 0.0); add(handle, 0.07, 0.025); add(jaw, 0.1, 0.01);
  const et = decal([["UNITRONICS", 0.5], ["CR-V  ·  13 MM", 0.24, "Inter", 600, 0.84]], 1.4, 0.16, { color: 0x6c727b, rough: 0.5 });
  et.rotation.x = -Math.PI / 2; et.position.set(1.3, 0.127, 0); tool.add(et);
  const pivot = new THREE.Group(); pivot.position.set(-0.9, 0.12, 0); pivot.add(tool); g.add(pivot);

  let boltAngle = 0, prev = 0;
  return {
    object: g, camera: new THREE.Vector3(0.6, 4.2, 4.2), radius: 1.9, floorY: -0.14, startRotation: -0.25,
    update(t, dt, p) {
      const cyc = (t * 0.45 * (1 + p * 4)) % 1;
      const fwd = cyc < 0.6;
      const k = fwd ? ease(cyc / 0.6) : 1 - ease((cyc - 0.6) / 0.4);
      const ang = -0.7 + k * 1.4;
      tool.position.y = fwd ? 0 : Math.sin(((cyc - 0.6) / 0.4) * Math.PI) * 0.22;
      pivot.rotation.y = -ang;
      if (fwd) boltAngle += Math.max(0, ang - prev);
      prev = ang;
      main.rotation.y = -boltAngle;
    },
  };
}

/* DISPLAY — screen with UNITRONICS moving across it (signage). Portrait = totem. */
function display(portrait) {
  return () => {
    const g = new THREE.Group();
    const [cw, ch] = portrait ? [540, 960] : [1024, 576];
    const [c, x] = makeCanvas(cw, ch);
    const t2 = tex(c);
    const sw = portrait ? 1.18 : 3.1, sh = sw * (ch / cw);
    const H = portrait ? 2.7 : sh + 0.14;
    g.add(mesh(rbox(sw + 0.12, H, 0.14, 0.05, 5), M.paint(0x0c0d10, 0.25)));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshPhysicalMaterial({
      color: 0x000000, emissive: 0xffffff, emissiveMap: t2, emissiveIntensity: 1.15, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02,
    }));
    scr.position.set(0, portrait ? H / 2 - 0.06 - sh / 2 : 0, 0.0705); g.add(scr);

    let floorY;
    if (portrait) {
      const b = decal([["UNITRONICS", 0.5]], 0.8, 0.1, { color: 0xc8ccd2, rough: 0.25 });
      b.position.set(0, -H / 2 + 0.2, 0.0705); g.add(b);
      g.add(mesh(rbox(1.7, 0.08, 0.8, 0.03, 4), M.steel(0xb8bec7, 0.3), 0, -H / 2 - 0.04, 0));
      floorY = -H / 2 - 0.08;
    } else {
      g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.3, 32), M.steel(0xb8bec7, 0.25), 0, -H / 2 - 0.5, -0.14));
      g.add(mesh(rbox(0.5, 0.3, 0.06, 0.02), M.steel(0x3a3f47, 0.4), 0, 0, -0.1));
      g.add(mesh(new THREE.CylinderGeometry(0.6, 0.65, 0.05, SEG), M.steel(0xb8bec7, 0.3), 0, -H / 2 - 1.12, -0.14));
      floorY = -H / 2 - 1.15 + 0.55;
      g.position.y = 0.55;
    }

    const word = "UNITRONICS";
    let acc = 1;
    const paint = (t) => {
      const grd = x.createLinearGradient(0, 0, cw, ch);
      grd.addColorStop(0, "#0b1b2c"); grd.addColorStop(1, "#05070c");
      x.fillStyle = grd; x.fillRect(0, 0, cw, ch);
      x.strokeStyle = "rgba(120,190,255,0.08)"; x.lineWidth = 1;
      const step = 48, off = (t * 20) % step;
      for (let gx = -off; gx < cw; gx += step) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, ch); x.stroke(); }
      for (let gy = 0; gy < ch; gy += step) { x.beginPath(); x.moveTo(0, gy); x.lineTo(cw, gy); x.stroke(); }

      x.textBaseline = "alphabetic"; x.fillStyle = "rgba(255,255,255,0.85)";
      x.font = "500 22px Inter, sans-serif"; x.textAlign = "right";
      x.fillText(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), cw - 32, 50);
      x.textAlign = "left"; x.font = "400 16px Michroma, sans-serif"; x.fillText("DIGITAL MEDIA", 32, 50);
      x.fillStyle = "rgba(255,255,255,0.14)"; x.fillRect(32, 70, cw - 64, 1);

      // The moving UNITRONICS wordmark.
      x.font = "400 150px Michroma, sans-serif";
      const wWord = x.measureText(word + "   ").width;
      const pos = -((t * (portrait ? 140 : 180)) % wWord);
      const y = portrait ? ch * 0.44 : ch * 0.58;
      x.fillStyle = "#ffffff";
      for (let px = pos; px < cw; px += wWord) x.fillText(word, px, y);
      x.font = "400 26px Michroma, sans-serif"; x.fillStyle = "#3ec8ff";
      x.fillText("POWERED BY INNOVATION", 32, y + (portrait ? 70 : 60));

      if (portrait) {
        const msgs = ["YOUR BRAND, LIVE.", "UPDATE ANYWHERE", "CLOUD SCREENS"];
        const i = Math.floor(t / 3) % 3, local = (t % 3) / 3;
        x.globalAlpha = Math.min(1, local * 6, (1 - local) * 6);
        x.fillStyle = "#fff"; x.font = "400 30px Michroma, sans-serif";
        x.fillText(msgs[i], 32, ch * 0.68);
        x.globalAlpha = 1;
      }
      x.fillStyle = "rgba(255,255,255,0.75)"; x.font = "500 20px Inter, sans-serif";
      x.fillText("unitronicsdigitalmedia.co.za", 32, ch - 44);
      x.fillStyle = "rgba(255,255,255,0.14)"; x.fillRect(32, ch - 28, cw - 64, 4);
      x.fillStyle = "#3ec8ff"; x.fillRect(32, ch - 28, (cw - 64) * ((t % 4) / 4), 4);
      t2.needsUpdate = true;
    };

    return {
      object: g,
      camera: portrait ? new THREE.Vector3(0.9, 0.5, 6.2) : new THREE.Vector3(1.2, 0.6, 5.4),
      radius: portrait ? 1.6 : 1.9, floorY, startRotation: -0.3,
      update(t, dt, p) {
        acc += dt;
        if (acc > (lowPower ? 1 / 24 : 1 / 30)) { acc = 0; paint(t * (1 + p)); }
      },
    };
  };
}

/* RACK — controller stack with status LEDs (solutions hero) */
function rack() {
  const g = new THREE.Group();
  const r = rng(21);
  const units = 5, uh = 0.42, gap = 0.08, W = 3.2, D = 2.1, total = units * uh + (units - 1) * gap;
  const panel = (n) => {
    const [c, x] = makeCanvas(1024, 136);
    x.fillStyle = "#1a1d22"; x.fillRect(0, 0, 1024, 136);
    for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(255,255,255,${r() * 0.035})`; x.fillRect(0, r() * 136, 1024, 1); }
    x.fillStyle = "#060708";
    for (let i = 0; i < 18; i++) for (let j = 0; j < 4; j++) { x.beginPath(); x.roundRect(30 + i * 17, 26 + j * 22, 11, 16, 3); x.fill(); }
    x.fillStyle = "#e7ebf0"; x.font = "400 24px Michroma, sans-serif"; x.fillText("UNITRONICS", 370, 64);
    x.fillStyle = "#8a93a1"; x.font = "500 16px Inter, sans-serif"; x.fillText(`UX-R0${n}  ·  MEDIA SERVER`, 370, 94);
    for (let i = 0; i < 3; i++) { x.fillStyle = "#0b0d11"; x.fillRect(640 + i * 92, 24, 82, 88); x.strokeStyle = "#2f343c"; x.lineWidth = 2; x.strokeRect(640 + i * 92, 24, 82, 88); }
    return tex(c);
  };
  const body = rbox(W, uh, D, 0.03), bodyMat = M.steel(0x2f343b, 0.4);
  const on = [0x22ff88, 0x3ec8ff, 0xffae1a];
  const leds = [];
  for (let i = 0; i < units; i++) {
    const y = -total / 2 + uh / 2 + i * (uh + gap);
    g.add(mesh(body, bodyMat, 0, y, 0));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, uh - 0.06), new THREE.MeshPhysicalMaterial({ map: panel(i + 1), metalness: 0.6, roughness: 0.42 }));
    face.position.set(0, y, D / 2 + 0.001); g.add(face);
    for (let j = 0; j < 6; j++) {
      const l = mesh(new THREE.SphereGeometry(0.022, 12, 8), M.led(on[j % 3]), 1.2 + (j % 3) * 0.1, y + (j < 3 ? 0.07 : -0.07), D / 2 + 0.01);
      g.add(l); leds.push(l);
    }
  }
  const post = new THREE.BoxGeometry(0.1, total + 0.5, 0.1), postMat = M.steel(0x9aa1ab, 0.3);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => g.add(mesh(post, postMat, sx * (W / 2 + 0.08), 0, sz * (D / 2 - 0.05))));
  const plate = rbox(W + 0.4, 0.08, D + 0.1, 0.03);
  g.add(mesh(plate, M.paint(0x121418), 0, total / 2 + 0.25, 0), mesh(plate, M.paint(0x121418), 0, -total / 2 - 0.25, 0));
  let acc = 0;
  return {
    object: g, camera: new THREE.Vector3(3.6, 2.2, 7.2), radius: 2.7, floorY: -total / 2 - 0.29, startRotation: -0.35,
    update(t, dt, p) {
      acc += dt;
      if (acc > (p > 0.05 ? 0.03 : 0.12)) {
        acc = 0;
        leds.forEach((l) => { if (r() < (p > 0.05 ? 0.6 : 0.18)) l.material.emissiveIntensity = r() < 0.2 ? 0.02 : 1.1; });
      }
    },
  };
}

/* GYRO — polished core inside a glass shell with gimbal rings (about hero) */
function gyro() {
  const g = new THREE.Group();
  const coreMat = M.chrome(0xe8ebef, 0.06); coreMat.flatShading = true;
  const core = mesh(new THREE.IcosahedronGeometry(0.62, 0), coreMat);
  const inner = mesh(new THREE.IcosahedronGeometry(0.4, 2), M.paint(0x1b86cf, 0.2));
  g.add(core, inner);
  g.add(mesh(new THREE.SphereGeometry(1.25, SEG, SEG / 2), new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.16, clearcoat: 1, depthWrite: false, envMapIntensity: 1.6,
  })));
  const rings = [];
  [[1.55, 0.05], [1.8, 0.045], [2.05, 0.04]].forEach(([rad, tube], i) => {
    const gimbal = new THREE.Group();
    gimbal.add(mesh(new THREE.TorusGeometry(rad, tube, 20, 160), i === 1 ? M.steel(0xc5cad1, 0.25) : M.chrome()));
    [0, Math.PI].forEach((a) => gimbal.add(mesh(new THREE.SphereGeometry(tube * 2, 20, 16), M.paint(0x1b86cf, 0.2), Math.cos(a) * rad, Math.sin(a) * rad, 0)));
    g.add(gimbal);
    rings.push(gimbal);
  });
  rings[2].rotation.x = 0.4;
  return {
    object: g, camera: new THREE.Vector3(0, 0.8, 8.2), radius: 2.3, floorY: -2.5, startRotation: 0,
    update(t, dt, p) {
      const s = 1 + p * 5;
      core.rotation.set(t * 0.3, t * 0.4, 0);
      inner.rotation.set(-t * 0.2, t * 0.5, 0);
      rings[0].rotation.x += dt * 0.5 * s;
      rings[1].rotation.y += dt * 0.35 * s;
      rings[2].rotation.z += dt * 0.25 * s;
      g.position.y = Math.sin(t * 0.7) * 0.08;
    },
  };
}

/* GLOBE — connected network globe with data carriers (contact) */
function globe() {
  const g = new THREE.Group();
  const r = rng(5), R = 1.35;
  g.add(mesh(new THREE.SphereGeometry(R, SEG, SEG / 2), M.paint(0x0f1726, 0.35)));
  const n = lowPower ? 700 : 1300;
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.014, 6, 4), M.steel(0xd7dde5, 0.25), n);
  const pts = [], m4 = new THREE.Matrix4(), golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2, rad = Math.sqrt(1 - y * y), th = golden * i;
    const p = new THREE.Vector3(Math.cos(th) * rad, y, Math.sin(th) * rad).multiplyScalar(R + 0.005);
    pts.push(p); dots.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z));
  }
  g.add(dots);
  const arcMat = M.chrome(0xdfe4ea, 0.15), carrierMat = M.paint(0x3ec8ff, 0.2);
  const arcs = [];
  while (arcs.length < 12) {
    const a = pts[Math.floor(r() * n)], b = pts[Math.floor(r() * n)], d = a.distanceTo(b);
    if (d < 0.8) continue;
    const curve = new THREE.QuadraticBezierCurve3(a, a.clone().add(b).normalize().multiplyScalar(R + d * 0.45), b);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.008, 6), arcMat));
    const c = mesh(new THREE.SphereGeometry(0.035, 16, 12), carrierMat); g.add(c);
    arcs.push({ curve, c, off: r(), speed: 0.12 + r() * 0.2 });
  }
  const ring = mesh(new THREE.TorusGeometry(2.0, 0.025, 16, 180), M.chrome()); ring.rotation.set(Math.PI / 2 + 0.35, 0, 0.2);
  g.add(ring);
  return {
    object: g, camera: new THREE.Vector3(0, 0.6, 7.2), radius: 2.1, floorY: -2.2, startRotation: 0,
    update(t, dt, p) {
      arcs.forEach((a) => a.c.position.copy(a.curve.getPoint((t * a.speed * (1 + p * 3) + a.off) % 1)));
      ring.rotation.z = t * 0.1;
    },
  };
}

const SCENES = {
  chip, ledwall, devboard, switch: netswitch, cctv, spanner, rack, gyro, globe,
  display: display(false), totem: display(true),
};

/* ==========================================================================
   Shared renderer
   ========================================================================== */
let renderer, envMap, bufW = 0, bufH = 0;
function getRenderer() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, stencil: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setScissorTest(true);
  const pmrem = new THREE.PMREMGenerator(renderer);
  envMap = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  pmrem.dispose();
  return renderer;
}
function ensureBuffer(w, h) {
  if (w <= bufW && h <= bufH) return;
  bufW = Math.max(bufW, w); bufH = Math.max(bufH, h);
  renderer.setSize(bufW, bufH, false);
}

function floorMesh(radius, color) {
  const [c, x] = makeCanvas(256, 256);
  const gr = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, "#fff"); gr.addColorStop(0.55, "#777"); gr.addColorStop(1, "#000");
  x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
  const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), new THREE.MeshStandardMaterial({
    color, roughness: 0.7, metalness: 0.15, alphaMap: tex(c, false), transparent: true, depthWrite: false, envMapIntensity: 0.35,
  }));
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

/* ==========================================================================
   View — one model in one element
   ========================================================================== */
const views = [];

class View {
  constructor(el) {
    this.el = el;
    this.kind = el.dataset.scene;
    this.hero = el.classList.contains("hero__canvas");
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-hidden", "true");
    this.ctx = this.canvas.getContext("2d", { alpha: false });
    el.appendChild(this.canvas);
    this.visible = false;
    this.built = false;
    this.pulse = 0;
    this.skip = 0;
    new IntersectionObserver(([en]) => {
      this.visible = en.isIntersecting;
      if (this.visible && !this.built) this.build();
    }, { rootMargin: "250px 0px" }).observe(el);
    new ResizeObserver(() => this.built && this.resize()).observe(el);
  }

  build() {
    this.built = true;
    getRenderer();
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(this.hero ? 0x050608 : 0x0f1217);
    scene.environment = envMap;

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    this.root = new THREE.Group();
    this.spin = new THREE.Group();
    this.root.add(this.spin);
    scene.add(this.root);

    this.def = SCENES[this.kind]();
    this.spin.add(this.def.object);
    const R = this.def.radius;

    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(R * 1.1, R * 3.2, R * 1.8);
    key.castShadow = true;
    key.shadow.mapSize.set(lowPower ? 1024 : 2048, lowPower ? 1024 : 2048);
    Object.assign(key.shadow.camera, { left: -R * 1.7, right: R * 1.7, top: R * 1.7, bottom: -R * 1.7, near: 0.1, far: R * 10 });
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    const rim = new THREE.DirectionalLight(0xcfe9ff, 1.1); rim.position.set(-R * 2.2, R * 1.2, -R * 2);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x0b0c10, 0.35);
    scene.add(key, rim, hemi);

    const floor = floorMesh(R * 2.6, this.hero ? 0x15181e : 0x1b1f26);
    floor.position.y = this.def.floorY ?? -R;
    this.root.add(floor);

    this.def.object.traverse((o) => { if (o.isMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });

    this.rotY = this.def.startRotation || 0;
    this.velY = 0;
    this.tilt = new THREE.Vector2();
    this.tiltTarget = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(9, 9);
    this.bindEvents();
    this.resize();
    this.el.closest(".hero, .stage, .card__stage")?.classList.add("is-ready");
  }

  /* Position the model in frame (right side on desktop hero, centred elsewhere)
     with a camera view offset, then back off just enough for it to fit. */
  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.w = Math.round(w * DPR); this.h = Math.round(h * DPR);
    this.canvas.width = this.w; this.canvas.height = this.h;
    ensureBuffer(this.w, this.h);

    let cx = 0.5, cy = 0.5, margin = 1.1;
    if (this.hero) {
      if (innerWidth <= 700) { cy = 0.56; margin = 1.08; }
      else if (w / h < 0.9) { cy = 0.3; margin = 1.12; }
      else { cx = w > 1100 ? 0.7 : 0.66; cy = 0.53; margin = 1.06; }
    }
    const fullW = w * 2 * Math.max(cx, 1 - cx), fullH = h * 2 * Math.max(cy, 1 - cy);
    const cam = this.camera;
    cam.aspect = fullW / fullH;
    cam.setViewOffset(fullW, fullH, cx >= 0.5 ? 0 : fullW - w, cy >= 0.5 ? 0 : fullH - h, w, h);
    const fx = (Math.min(cx, 1 - cx) * w) / (fullW / 2), fy = (Math.min(cy, 1 - cy) * h) / (fullH / 2);
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)), tanH = tanV * cam.aspect;
    const R = this.def.radius * margin;
    const dist = Math.max(this.def.camera.length(), R / (tanH * fx), R / (tanV * fy));
    cam.position.copy(this.def.camera).normalize().multiplyScalar(dist);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
  }

  bindEvents() {
    const el = this.el;
    let drag = null;
    el.addEventListener("pointerdown", (e) => { drag = { last: e.clientX, moved: 0, id: e.pointerId }; this.velY = 0; });
    addEventListener("pointermove", (e) => {
      if (e.pointerType === "mouse" && this.visible) {
        const rect = el.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * 2 - 1, py = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const inside = Math.abs(px) <= 1 && Math.abs(py) <= 1;
        this.pointer.set(px, py);
        this.tiltTarget.set(inside || this.hero ? px : 0, inside || this.hero ? py : 0).clampScalar(-1, 1);
        this.hoverDirty = inside;
      }
      if (drag && drag.id === e.pointerId) {
        const dx = e.clientX - drag.last;
        drag.last = e.clientX; drag.moved += Math.abs(dx);
        this.rotY += dx * 0.008; this.velY = dx * 0.008;
      }
    }, { passive: true });
    const end = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (drag.moved < 6 && e.type === "pointerup") {
        const rect = el.getBoundingClientRect();
        this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        if (this.hit()) this.pulse = 1;
      }
      drag = null;
    };
    addEventListener("pointerup", end);
    addEventListener("pointercancel", end);
    el.addEventListener("pointerleave", () => { this.hoverDirty = false; if (this.hovering) { this.hovering = false; el.style.cursor = ""; } });
  }

  hit() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObject(this.def.object, true).length > 0;
  }

  frame(t, dt) {
    // Small views on phones render at 30 fps to save battery.
    if (lowPower && !this.hero) {
      this.skip = (this.skip + 1) % 2;
      if (this.skip) return;
      dt *= 2;
    }

    this.pulse = Math.max(0, this.pulse - dt * 0.6);
    this.velY *= Math.pow(0.04, dt);
    this.rotY += this.velY * dt * 8;
    if (!reduceMotion) this.rotY += dt * (this.hero ? 0.1 : 0.14);
    this.tilt.lerp(this.tiltTarget, 1 - Math.pow(0.001, dt));
    this.spin.rotation.y = this.rotY + this.tilt.x * 0.25;
    this.spin.rotation.x = -this.tilt.y * 0.1;

    if (this.hero) {
      const rect = this.el.getBoundingClientRect();
      const sp = THREE.MathUtils.clamp(-rect.top / rect.height, 0, 1);
      this.root.position.y = sp * this.def.radius * 0.6;
      this.root.rotation.x = sp * 0.3;
    }
    if (this.hoverDirty && !coarse) {
      this.hoverDirty = false;
      const h = this.hit();
      if (h !== this.hovering) { this.hovering = h; this.el.style.cursor = h ? "pointer" : ""; }
    }

    this.def.update(reduceMotion ? t * 0.4 : t, dt, this.pulse);

    const { w, h } = this;
    renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h);
    renderer.render(this.scene, this.camera);
    this.ctx.drawImage(renderer.domElement, 0, bufH - h, w, h, 0, 0, w, h);
  }
}

/* Boot ------------------------------------------------------------------- */
function webglAvailable() {
  try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; }
}

async function boot() {
  const els = document.querySelectorAll("[data-scene]");
  if (!els.length) return;
  if (!webglAvailable()) {
    els.forEach((el) => el.closest(".hero, .stage, .card__stage")?.classList.add("is-ready", "no-webgl"));
    return;
  }
  // Canvas-drawn labels use the web fonts, so wait briefly for them.
  await Promise.race([
    Promise.all([document.fonts.load("400 40px Michroma"), document.fonts.load("500 20px Inter")]),
    new Promise((res) => setTimeout(res, 1200)),
  ]).catch(() => {});

  els.forEach((el) => views.push(new View(el)));

  const clock = new THREE.Clock();
  let t = 0;
  const loop = () => {
    const dt = Math.min(clock.getDelta(), 1 / 20);
    t += dt;
    for (const v of views) {
      if (!v.visible || !v.built || !v.w) continue;
      try { v.frame(t, dt); } catch (err) { console.warn("3D view failed:", v.kind, err); v.visible = false; }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot();
