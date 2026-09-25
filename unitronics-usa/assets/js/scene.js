/* ==========================================================================
   Unitronics USA — real-time 3D scenes (three.js, PBR + bloom)
   Every model is built procedurally in code, so there are no heavy assets
   to download: the page stays fast on mobile and desktop.

   Usage: <div class="hero__canvas" data-scene="chip|orb|rack|screen|network"></div>
   ========================================================================== */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const ACCENT = new THREE.Color(0x3ec8ff);
const VIOLET = new THREE.Color(0x7b61ff);
const coarse = matchMedia("(pointer: coarse)").matches;
const lowPower = coarse || (navigator.hardwareConcurrency || 8) <= 4;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

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

function canvasTexture(canvas, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function glowMat(color, intensity = 2.5, extra = {}) {
  return new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(intensity), toneMapped: false, ...extra });
}

const mats = {
  chrome: () => new THREE.MeshPhysicalMaterial({ color: 0xe6e9ee, metalness: 1, roughness: 0.08 }),
  brushed: (color = 0xc3c8d0, roughness = 0.28) => new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness }),
  gold: () => new THREE.MeshPhysicalMaterial({ color: 0xe3b65c, metalness: 1, roughness: 0.2 }),
  gloss: (color = 0x0c0d10) => new THREE.MeshPhysicalMaterial({ color, metalness: 0.3, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06 }),
};

function dotSprite() {
  const [c, x] = makeCanvas(64, 64);
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return canvasTexture(c);
}

function floorGlow(size = 10, y = -1.6, color = "62,200,255", alpha = 0.28) {
  const [c, x] = makeCanvas(256, 256);
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, `rgba(${color},${alpha})`);
  g.addColorStop(0.45, `rgba(${color},${alpha * 0.25})`);
  g.addColorStop(1, `rgba(${color},0)`);
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: canvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  m.rotation.x = -Math.PI / 2; m.position.y = y;
  return m;
}

function particles(count, radius, spread, color = ACCENT, size = 0.035) {
  const r = rng(99);
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2;
    const d = radius + r() * spread;
    const s = Math.sqrt(1 - u * u);
    pos.set([Math.cos(th) * s * d, u * d * 0.6, Math.sin(th) * s * d], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({
    size, map: dotSprite(), color: color.clone().multiplyScalar(1.6), transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 0.8,
  }));
}

/* ==========================================================================
   Scene: CHIP — a processor on a PCB with live data pulses along the traces
   ========================================================================== */
function chip(v) {
  const g = new THREE.Group();
  const r = rng(7);
  const N = 1024, lo = 0.27, hi = 0.73;

  // Trace paths in normalised board coordinates.
  const traces = [];
  const count = lowPower ? 130 : 190;
  for (let i = 0; i < count; i++) {
    const side = i % 4, t = lo + 0.03 + r() * (hi - lo - 0.06);
    const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][side];
    let [x, y] = [[t, lo], [hi, t], [t, hi], [lo, t]][side];
    const pts = [[x, y]];
    const l1 = 0.015 + r() * 0.07; x += dx * l1; y += dy * l1; pts.push([x, y]);
    const lat = r() < 0.5 ? -1 : 1, l2 = r() * 0.07;
    x += dx * l2 + (dy ? lat * l2 : 0); y += dy * l2 + (dx ? lat * l2 : 0); pts.push([x, y]);
    const end = 0.03 + r() * 0.2;
    if (dx) x = dx > 0 ? Math.max(x, 1 - end) : Math.min(x, end);
    else y = dy > 0 ? Math.max(y, 1 - end) : Math.min(y, end);
    pts.push([x, y]);
    traces.push({ pts, w: 1.6 + r() * 2.6 });
  }

  const drawTraces = (ctx, stroke, pad, hole) => {
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const tr of traces) {
      ctx.strokeStyle = stroke; ctx.lineWidth = tr.w;
      ctx.beginPath();
      tr.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * N, y * N) : ctx.moveTo(x * N, y * N)));
      ctx.stroke();
      const [ex, ey] = tr.pts[tr.pts.length - 1];
      ctx.fillStyle = pad; ctx.beginPath(); ctx.arc(ex * N, ey * N, tr.w + 3.5, 0, Math.PI * 2); ctx.fill();
      if (hole) { ctx.fillStyle = hole; ctx.beginPath(); ctx.arc(ex * N, ey * N, tr.w * 0.6, 0, Math.PI * 2); ctx.fill(); }
    }
  };

  // Albedo: solder mask, copper traces, silkscreen.
  const [cA, a] = makeCanvas(N, N);
  const bg = a.createLinearGradient(0, 0, N, N);
  bg.addColorStop(0, "#08140f"); bg.addColorStop(1, "#040a08");
  a.fillStyle = bg; a.fillRect(0, 0, N, N);
  for (let i = 0; i < 2400; i++) { // fibreglass weave noise
    a.fillStyle = `rgba(255,255,255,${r() * 0.018})`;
    a.fillRect(r() * N, r() * N, 1 + r() * 2, 1);
  }
  drawTraces(a, "rgba(196,154,72,0.9)", "#d7b265", "#0a0f0d");
  for (let i = 0; i < 90; i++) { // vias
    const x = r() * N, y = r() * N;
    if (x > lo * N - 20 && x < hi * N + 20 && y > lo * N - 20 && y < hi * N + 20) continue;
    a.fillStyle = "#c9a45a"; a.beginPath(); a.arc(x, y, 4, 0, 7); a.fill();
    a.fillStyle = "#050807"; a.beginPath(); a.arc(x, y, 1.8, 0, 7); a.fill();
  }
  a.strokeStyle = "rgba(220,226,232,0.55)"; a.lineWidth = 2;
  a.strokeRect(lo * N - 18, lo * N - 18, (hi - lo) * N + 36, (hi - lo) * N + 36);
  a.fillStyle = "rgba(220,226,232,0.6)";
  a.font = "600 22px Michroma, sans-serif";
  a.fillText("UNITRONICS USA", 40, N - 44);
  a.font = "16px Inter, sans-serif";
  a.fillText("UX-9 CORE  ·  REV 2.4  ·  POWERED BY INNOVATION", 40, N - 20);
  a.fillText("U1", lo * N - 14, lo * N - 26);

  // Emissive mask: the traces only.
  const [cE, e] = makeCanvas(N, N);
  e.fillStyle = "#000"; e.fillRect(0, 0, N, N);
  drawTraces(e, "#fff", "#fff", null);

  const U = v.uniforms;
  const pcbMat = new THREE.MeshPhysicalMaterial({
    map: canvasTexture(cA), emissiveMap: canvasTexture(cE), emissive: ACCENT, emissiveIntensity: 2.2,
    roughness: 0.55, metalness: 0.1, clearcoat: 0.45, clearcoatRoughness: 0.25, envMapIntensity: 0.55,
  });
  pcbMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uPulse = U.uPulse;
    sh.fragmentShader = "uniform float uTime;\nuniform float uPulse;\n" + sh.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
      float dd = distance(vEmissiveMapUv, vec2(0.5));
      float wave = pow(0.5 + 0.5 * sin(dd * 32.0 - uTime * 2.8), 10.0);
      float ring = uPulse * smoothstep(0.0, 1.0, 1.0 - abs(dd - (1.0 - uPulse) * 0.72) * 9.0);
      totalEmissiveRadiance *= 0.04 + wave * 1.2 + ring * 3.0;`
    );
  };

  const board = new THREE.Mesh(new RoundedBoxGeometry(4.4, 0.1, 4.4, 4, 0.05),
    new THREE.MeshPhysicalMaterial({ color: 0x0a1310, roughness: 0.55, clearcoat: 0.6 }));
  const top = new THREE.Mesh(new THREE.PlaneGeometry(4.34, 4.34), pcbMat);
  top.rotation.x = -Math.PI / 2; top.position.y = 0.0505;
  g.add(board, top);

  // Package, heat spreader and laser-etched lid.
  const baseY = 0.05;
  const pkg = new THREE.Mesh(new RoundedBoxGeometry(2.0, 0.2, 2.0, 4, 0.03),
    new THREE.MeshPhysicalMaterial({ color: 0x15171b, roughness: 0.4, metalness: 0.1, clearcoat: 0.35 }));
  pkg.position.y = baseY + 0.03 + 0.1;
  const lid = new THREE.Mesh(new RoundedBoxGeometry(1.46, 0.07, 1.46, 4, 0.025), mats.brushed(0x8d939c, 0.34));
  lid.position.y = pkg.position.y + 0.1 + 0.03;

  const [cL, l] = makeCanvas(1024, 1024);
  l.fillStyle = "#fff"; l.textAlign = "center";
  l.font = "400 104px Michroma, sans-serif"; l.fillText("UNITRONICS", 512, 470);
  l.font = "500 44px Inter, sans-serif"; l.fillText("UX-9  ·  NEURAL CORE", 512, 560);
  l.font = "400 30px Inter, sans-serif"; l.fillText("POWERED BY INNOVATION", 512, 620);
  l.beginPath(); l.moveTo(90, 90); l.lineTo(160, 90); l.lineTo(90, 160); l.fill();
  for (let i = 0; i < 14; i++) for (let j = 0; j < 14; j++) if (r() > 0.5 || i === 0 || j === 13) l.fillRect(770 + i * 12, 770 + j * 12, 11, 11);
  const etched = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 1.42), new THREE.MeshStandardMaterial({
    map: canvasTexture(cL), transparent: true, color: 0x4a4f57, metalness: 1, roughness: 0.62,
    polygonOffset: true, polygonOffsetFactor: -2,
  }));
  etched.rotation.x = -Math.PI / 2; etched.position.y = lid.position.y + 0.0351;
  g.add(pkg, lid, etched);

  // Gull-wing pins.
  const pinGeo = new THREE.BoxGeometry(0.045, 0.024, 0.26);
  const pins = new THREE.InstancedMesh(pinGeo, mats.gold(), 64);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1);
  let k = 0;
  for (let sd = 0; sd < 4; sd++) {
    for (let i = 0; i < 16; i++) {
      const o = -0.84 + (i / 15) * 1.68;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (sd * Math.PI) / 2);
      const p = new THREE.Vector3(o, baseY + 0.02, 1.08).applyQuaternion(q);
      pins.setMatrixAt(k++, m4.compose(p, q, s1));
    }
  }
  g.add(pins);

  // Discrete SMD parts and electrolytic capacitors.
  const smdCount = lowPower ? 60 : 110;
  const smd = new THREE.InstancedMesh(new RoundedBoxGeometry(0.14, 0.06, 0.07, 2, 0.01),
    new THREE.MeshPhysicalMaterial({ roughness: 0.45, clearcoat: 0.3 }), smdCount);
  const pal = [0x2a2b2e, 0x8b6b43, 0x1b1c1f, 0x6d5335];
  for (let i = 0; i < smdCount; i++) {
    let x, z;
    do { x = (r() * 2 - 1) * 1.95; z = (r() * 2 - 1) * 1.95; } while (Math.abs(x) < 1.4 && Math.abs(z) < 1.4);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() < 0.5 ? 0 : Math.PI / 2);
    smd.setMatrixAt(i, m4.compose(new THREE.Vector3(x, baseY + 0.03, z), q, s1));
    smd.setColorAt(i, new THREE.Color(pal[i % pal.length]));
  }
  g.add(smd);

  const capGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.34, 40);
  const capMat = mats.brushed(0xaab0b8, 0.3);
  const sleeve = new THREE.MeshPhysicalMaterial({ color: 0x101216, roughness: 0.35, clearcoat: 1 });
  [[-1.75, -1.75], [1.75, 1.75], [1.75, -1.75]].forEach(([x, z]) => {
    const c = new THREE.Mesh(capGeo, [sleeve, capMat, capMat]);
    c.position.set(x, baseY + 0.17, z);
    g.add(c);
  });
  const xtal = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.1, 0.18, 3, 0.04), mats.chrome());
  xtal.position.set(-1.7, baseY + 0.05, 1.6);
  g.add(xtal);

  // Holographic halo.
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.006, 8, 160), glowMat(ACCENT, 3));
  halo.rotation.x = Math.PI / 2; halo.position.y = 0.55;
  g.add(halo);

  const dust = particles(lowPower ? 140 : 260, 2.6, 2.4);
  v.scene.add(dust);
  v.scene.add(floorGlow(10, -0.6));

  return {
    object: g,
    camera: new THREE.Vector3(0, 5.2, 6.4),
    radius: 3.0,
    startRotation: -0.55,
    hover: [top, pkg, lid, etched],
    update(t) {
      halo.position.y = 0.55 + Math.sin(t * 1.2) * 0.08;
      halo.scale.setScalar(1 + U.uPulse.value * 0.35);
      dust.rotation.y = t * 0.03;
      g.position.y = Math.sin(t * 0.8) * 0.06;
    },
  };
}

/* ==========================================================================
   Scene: ORB — glass sphere with an energy core and orbiting chrome rings
   ========================================================================== */
function orb(v) {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.SphereGeometry(1.5, 96, 64), new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.03, transmission: 1, thickness: 1.4, ior: 1.5,
    iridescence: 0.35, iridescenceIOR: 1.3, clearcoat: 1, clearcoatRoughness: 0.02,
    attenuationColor: new THREE.Color(0x9fe6ff), attenuationDistance: 4, specularIntensity: 1,
  }));
  g.add(glass);

  const coreGeo = new THREE.IcosahedronGeometry(0.72, 1);
  const wire = new THREE.LineSegments(new THREE.EdgesGeometry(coreGeo), new THREE.LineBasicMaterial({
    color: ACCENT.clone().multiplyScalar(2.2), toneMapped: false, transparent: true, opacity: 0.9,
  }));
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 4), glowMat(new THREE.Color(0x5cc8ff), 1.25));
  const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 1), new THREE.MeshPhysicalMaterial({
    color: 0x0b0f18, metalness: 0.9, roughness: 0.25, flatShading: true, transparent: true, opacity: 0.55,
  }));
  g.add(core, inner, wire);

  const rings = [];
  [[2.05, 0.02, 0.3, 0], [2.35, 0.014, -0.5, 0.8], [2.7, 0.01, 1.1, -0.4]].forEach(([rad, tube, rx, rz], i) => {
    const pivot = new THREE.Group();
    pivot.rotation.set(rx + Math.PI / 2, 0, rz);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rad, tube, 16, 220), mats.chrome());
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.05 + i * 0.01, 24, 16), glowMat(i === 1 ? VIOLET : ACCENT, 3));
    bead.position.x = rad;
    const spinner = new THREE.Group();
    spinner.add(bead);
    pivot.add(ring, spinner);
    g.add(pivot);
    rings.push({ pivot, spinner, speed: 0.35 + i * 0.18 });
  });

  const light = new THREE.PointLight(ACCENT, 6, 0, 2);
  g.add(light);
  const dust = particles(lowPower ? 120 : 220, 3.0, 2.5, VIOLET, 0.03);
  v.scene.add(dust, floorGlow(9, -2.4, "123,97,255", 0.3));

  return {
    object: g,
    camera: new THREE.Vector3(0, 0.7, 8.4),
    radius: 2.9,
    startRotation: 0,
    hover: [glass],
    update(t, dt) {
      const p = v.uniforms.uPulse.value;
      wire.rotation.set(t * 0.3, t * 0.45, 0);
      inner.rotation.set(-t * 0.2, t * 0.25, 0);
      core.scale.setScalar(1 + Math.sin(t * 2.4) * 0.06 + p * 0.5);
      light.intensity = 6 + p * 30;
      rings.forEach((rg) => { rg.spinner.rotation.z += dt * rg.speed * (1 + p * 4); });
      dust.rotation.y = -t * 0.025;
      g.position.y = Math.sin(t * 0.7) * 0.08;
    },
  };
}

/* ==========================================================================
   Scene: RACK — controller / server stack with live status LEDs
   ========================================================================== */
function rack(v) {
  const g = new THREE.Group();
  const r = rng(21);
  const units = 5, uh = 0.42, gap = 0.08, W = 3.2, D = 2.1;
  const total = units * uh + (units - 1) * gap;

  const panel = (n) => {
    const [c, x] = makeCanvas(1024, 136);
    x.fillStyle = "#15181d"; x.fillRect(0, 0, 1024, 136);
    for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(255,255,255,${r() * 0.035})`; x.fillRect(0, r() * 136, 1024, 1); }
    x.fillStyle = "#050608";
    for (let i = 0; i < 18; i++) for (let j = 0; j < 4; j++) {
      x.beginPath(); x.roundRect(30 + i * 17, 26 + j * 22, 11, 16, 3); x.fill();
    }
    x.fillStyle = "#e7ebf0"; x.font = "400 24px Michroma, sans-serif"; x.fillText("UNITRONICS", 370, 64);
    x.fillStyle = "#7f8896"; x.font = "500 16px Inter, sans-serif"; x.fillText(`UX-R0${n}  ·  INDUSTRIAL CONTROLLER`, 370, 94);
    for (let i = 0; i < 3; i++) {
      x.fillStyle = "#0b0d11"; x.fillRect(640 + i * 92, 24, 82, 88);
      x.strokeStyle = "#2b3038"; x.lineWidth = 2; x.strokeRect(640 + i * 92, 24, 82, 88);
      x.fillStyle = "#262a31"; x.fillRect(650 + i * 92, 94, 62, 6);
    }
    return canvasTexture(c);
  };

  const body = new RoundedBoxGeometry(W, uh, D, 3, 0.03);
  const bodyMat = mats.brushed(0x2a2e35, 0.38);
  const ledsPer = 6;
  const leds = new THREE.InstancedMesh(new THREE.SphereGeometry(0.022, 16, 12),
    new THREE.MeshBasicMaterial({ toneMapped: false }), units * ledsPer);
  const m4 = new THREE.Matrix4();
  const onColors = [new THREE.Color(0x33ff99), ACCENT, new THREE.Color(0xffb020)].map((c) => c.clone().multiplyScalar(3));
  const off = new THREE.Color(0x06080a);
  const hover = [];

  for (let i = 0; i < units; i++) {
    const y = -total / 2 + uh / 2 + i * (uh + gap);
    const b = new THREE.Mesh(body, bodyMat); b.position.y = y;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, uh - 0.06),
      new THREE.MeshPhysicalMaterial({ map: panel(i + 1), metalness: 0.7, roughness: 0.42, clearcoat: 0.3 }));
    face.position.set(0, y, D / 2 + 0.001);
    g.add(b, face);
    hover.push(b, face);
    for (let j = 0; j < ledsPer; j++) {
      leds.setMatrixAt(i * ledsPer + j, m4.makeTranslation(1.2 + (j % 3) * 0.1, y + (j < 3 ? 0.07 : -0.07), D / 2 + 0.01));
      leds.setColorAt(i * ledsPer + j, onColors[j % 3]);
    }
  }
  g.add(leds);

  const postGeo = new THREE.BoxGeometry(0.1, total + 0.5, 0.1);
  const postMat = mats.brushed(0x8d939c, 0.3);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    const p = new THREE.Mesh(postGeo, postMat);
    p.position.set(sx * (W / 2 + 0.08), 0, sz * (D / 2 - 0.05));
    g.add(p);
  });
  const plate = new RoundedBoxGeometry(W + 0.4, 0.08, D + 0.1, 3, 0.03);
  const topP = new THREE.Mesh(plate, mats.gloss(0x0e1014)); topP.position.y = total / 2 + 0.25;
  const botP = new THREE.Mesh(plate, mats.gloss(0x0e1014)); botP.position.y = -total / 2 - 0.25;
  g.add(topP, botP);

  const strip = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.012, 0.012), glowMat(ACCENT, 3));
  strip.position.set(0, -total / 2 - 0.2, D / 2 + 0.06);
  g.add(strip);

  v.scene.add(floorGlow(9, -total / 2 - 0.3), particles(lowPower ? 100 : 180, 3, 2));

  let acc = 0;
  return {
    object: g,
    camera: new THREE.Vector3(3.6, 2.2, 7.2),
    radius: 2.7,
    startRotation: -0.35,
    hover,
    update(t, dt) {
      acc += dt;
      const p = v.uniforms.uPulse.value;
      if (acc > (p > 0.05 ? 0.03 : 0.12)) {
        acc = 0;
        for (let i = 0; i < units * ledsPer; i++) {
          if (r() < (p > 0.05 ? 0.6 : 0.18)) leds.setColorAt(i, r() < 0.2 ? off : onColors[Math.floor(r() * 3)]);
        }
        leds.instanceColor.needsUpdate = true;
      }
      strip.material.color.copy(ACCENT).multiplyScalar(2 + Math.sin(t * 2) * 0.8 + p * 6);
      g.position.y = Math.sin(t * 0.7) * 0.05;
    },
  };
}

/* ==========================================================================
   Scene: SCREEN — digital-signage totem playing live content
   ========================================================================== */
function screen(v) {
  const g = new THREE.Group();
  const H = 2.7, Wd = 1.3;
  const shell = new THREE.Mesh(new RoundedBoxGeometry(Wd, H, 0.16, 5, 0.05), mats.gloss(0x0b0c0f));
  g.add(shell);

  const [c, x] = makeCanvas(540, 960);
  const tex = canvasTexture(c);
  const disp = new THREE.Mesh(new THREE.PlaneGeometry(Wd - 0.12, (Wd - 0.12) * (960 / 540)),
    new THREE.MeshPhysicalMaterial({
      color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.35,
      roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02,
    }));
  const dispH = (Wd - 0.12) * (960 / 540);
  disp.position.set(0, H / 2 - 0.06 - dispH / 2, 0.081);
  g.add(disp);

  const [cb, b] = makeCanvas(512, 64);
  b.fillStyle = "#fff"; b.textAlign = "center"; b.font = "400 30px Michroma, sans-serif"; b.fillText("UNITRONICS", 256, 44);
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.1), new THREE.MeshStandardMaterial({
    map: canvasTexture(cb), transparent: true, color: 0xc8ccd2, metalness: 1, roughness: 0.25,
  }));
  badge.position.set(0, -H / 2 + 0.2, 0.081);
  g.add(badge);

  const base = new THREE.Mesh(new RoundedBoxGeometry(1.7, 0.08, 0.8, 4, 0.03), mats.brushed(0xb8bec7, 0.3));
  base.position.y = -H / 2 - 0.04;
  const edge = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.01, 0.01), glowMat(ACCENT, 3));
  edge.position.set(0, -H / 2 - 0.085, 0.36);
  g.add(base, edge);

  const slides = [
    ["DIGITAL", "SIGNAGE"],
    ["YOUR BRAND,", "LIVE."],
    ["UPDATE FROM", "ANYWHERE"],
  ];
  let acc = 1;
  const paint = (t) => {
    const w = 540, h = 960;
    const grd = x.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, `hsl(${200 + Math.sin(t * 0.3) * 18}, 85%, 13%)`);
    grd.addColorStop(1, `hsl(${255 + Math.sin(t * 0.25) * 14}, 70%, 7%)`);
    x.fillStyle = grd; x.fillRect(0, 0, w, h);

    const ox = w * (0.5 + Math.sin(t * 0.5) * 0.25), oy = h * (0.36 + Math.cos(t * 0.4) * 0.08);
    const og = x.createRadialGradient(ox, oy, 0, ox, oy, 320);
    og.addColorStop(0, "rgba(62,200,255,0.55)"); og.addColorStop(1, "rgba(62,200,255,0)");
    x.fillStyle = og; x.fillRect(0, 0, w, h);

    x.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      x.strokeStyle = `rgba(${i % 2 ? "123,97,255" : "62,200,255"},${0.25 + i * 0.08})`;
      x.beginPath();
      for (let px = 0; px <= w; px += 10) {
        const py = 700 + i * 18 + Math.sin(px * 0.012 + t * (1 + i * 0.2) + i) * (26 - i * 2);
        px ? x.lineTo(px, py) : x.moveTo(px, py);
      }
      x.stroke();
    }

    x.fillStyle = "rgba(255,255,255,0.85)"; x.font = "400 18px Michroma, sans-serif"; x.textAlign = "left";
    x.fillText("UNITRONICS", 36, 58);
    const now = new Date();
    x.textAlign = "right"; x.font = "500 20px Inter, sans-serif";
    x.fillText(now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), w - 36, 58);
    x.fillStyle = "rgba(255,255,255,0.15)"; x.fillRect(36, 78, w - 72, 1);

    const period = 4, idx = Math.floor(t / period) % slides.length, local = (t % period) / period;
    const alpha = Math.min(1, local * 6, (1 - local) * 6);
    const shift = (1 - Math.min(1, local * 5)) * 30;
    x.globalAlpha = alpha; x.textAlign = "left"; x.fillStyle = "#fff";
    x.font = "400 54px Michroma, sans-serif";
    x.fillText(slides[idx][0], 36, 330 + shift);
    x.fillStyle = "#8fe0ff";
    x.fillText(slides[idx][1], 36, 400 + shift);
    x.fillStyle = "rgba(255,255,255,0.7)"; x.font = "400 22px Inter, sans-serif";
    x.fillText("Cloud-managed screens, anywhere.", 36, 460 + shift);
    x.globalAlpha = 1;

    x.fillStyle = "rgba(255,255,255,0.8)"; x.font = "500 19px Inter, sans-serif"; x.textAlign = "left";
    x.fillText("unitronicsdigitalmedia.co.za", 36, h - 60);
    x.fillStyle = "rgba(255,255,255,0.15)"; x.fillRect(36, h - 40, w - 72, 4);
    x.fillStyle = "#3ec8ff"; x.fillRect(36, h - 40, (w - 72) * local, 4);
    tex.needsUpdate = true;
  };

  v.scene.add(floorGlow(8, -H / 2 - 0.08, "62,200,255", 0.4), particles(lowPower ? 90 : 160, 2.4, 2));

  return {
    object: g,
    camera: new THREE.Vector3(0.9, 0.5, 6.2),
    radius: 1.6,
    startRotation: -0.35,
    hover: [shell, disp],
    update(t, dt) {
      acc += dt;
      if (acc > 1 / 30) { acc = 0; paint(t); }
      edge.material.color.copy(ACCENT).multiplyScalar(2.5 + v.uniforms.uPulse.value * 6);
      disp.material.emissiveIntensity = 1.35 + v.uniforms.uPulse.value * 0.8;
      g.position.y = Math.sin(t * 0.8) * 0.04;
    },
  };
}

/* ==========================================================================
   Scene: NETWORK — connected globe with live data arcs
   ========================================================================== */
function network(v) {
  const g = new THREE.Group();
  const r = rng(5);
  const R = 1.35;
  g.add(new THREE.Mesh(new THREE.SphereGeometry(R - 0.04, 96, 64), new THREE.MeshPhysicalMaterial({
    color: 0x070a10, metalness: 0.6, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 0.35,
  })));

  const n = lowPower ? 900 : 1600;
  const pts = [];
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2, rad = Math.sqrt(1 - y * y), th = golden * i;
    const p = new THREE.Vector3(Math.cos(th) * rad, y, Math.sin(th) * rad).multiplyScalar(R);
    pts.push(p); pos.set([p.x, p.y, p.z], i * 3);
    const c = ACCENT.clone().lerp(VIOLET, r() * 0.8).multiplyScalar(0.8 + r() * 1.2);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  pg.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const dots = new THREE.Points(pg, new THREE.PointsMaterial({
    size: 0.03, map: dotSprite(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  g.add(dots);

  const arcs = [];
  const arcMat = new THREE.LineBasicMaterial({ color: ACCENT.clone().multiplyScalar(1.6), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const moverGeo = new THREE.SphereGeometry(0.028, 12, 8);
  const moverMat = glowMat(new THREE.Color(0xbdf0ff), 3.5);
  for (let i = 0; i < 18; i++) {
    const a = pts[Math.floor(r() * n)], b = pts[Math.floor(r() * n)];
    const d = a.distanceTo(b);
    if (d < 0.6) { i--; continue; }
    const mid = a.clone().add(b).normalize().multiplyScalar(R + d * 0.45);
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(64)), arcMat));
    const mover = new THREE.Mesh(moverGeo, moverMat);
    g.add(mover);
    arcs.push({ curve, mover, off: r(), speed: 0.15 + r() * 0.25 });
  }

  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.012, 12, 220), mats.chrome());
  ring.rotation.set(Math.PI / 2 + 0.35, 0, 0.2);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.25, 0.004, 8, 220), glowMat(VIOLET, 2.5));
  ring2.rotation.set(Math.PI / 2 - 0.25, 0, -0.3);
  g.add(ring, ring2);

  v.scene.add(floorGlow(9, -2.2), particles(lowPower ? 120 : 220, 2.8, 2.4));

  return {
    object: g,
    camera: new THREE.Vector3(0, 0.6, 7.4),
    radius: 2.35,
    startRotation: 0,
    hover: [g.children[0]],
    update(t) {
      const p = v.uniforms.uPulse.value;
      arcs.forEach((a) => a.mover.position.copy(a.curve.getPoint((t * a.speed * (1 + p * 3) + a.off) % 1)));
      arcMat.opacity = 0.5 + p * 0.5;
      dots.material.size = 0.03 + p * 0.03;
      ring.rotation.z = t * 0.1;
      ring2.rotation.z = -t * 0.14;
    },
  };
}

const SCENES = { chip, orb, rack, screen, network };

/* ==========================================================================
   Viewer — renderer, layout, interaction, render loop
   ========================================================================== */
const viewers = [];

class Viewer {
  constructor(el) {
    this.el = el;
    this.hero = el.classList.contains("hero__canvas");
    this.uniforms = { uTime: { value: 0 }, uPulse: { value: 0 } };

    const renderer = (this.renderer = new THREE.WebGLRenderer({
      antialias: true, powerPreference: "high-performance", alpha: false, stencil: false,
    }));
    renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1.5 : 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true");

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(this.hero ? 0x050608 : 0x08090d);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    pmrem.dispose();

    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(4, 6, 5);
    const rim = new THREE.PointLight(ACCENT, 45, 0, 2); rim.position.set(-5, 1.5, -5);
    const fill = new THREE.PointLight(VIOLET, 18, 0, 2); fill.position.set(4.5, -1, -4);
    scene.add(key, rim, fill);

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    this.spin = new THREE.Group();
    this.root = new THREE.Group();
    this.root.add(this.spin);
    scene.add(this.root);

    this.def = SCENES[el.dataset.scene](this);
    this.spin.add(this.def.object);
    this.rotY = this.def.startRotation || 0;
    this.velY = 0;
    this.tilt = new THREE.Vector2();
    this.tiltTarget = new THREE.Vector2();

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), lowPower ? 0.55 : 0.7, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(9, 9);
    this.hovering = false;
    this.visible = false;
    this.bindEvents();
    new ResizeObserver(() => this.resize()).observe(el);
    new IntersectionObserver(([en]) => { this.visible = en.isIntersecting; }, { rootMargin: "80px" }).observe(el);
    this.resize();
  }

  /* Place the model on screen (right-hand side on desktop hero, top on mobile)
     using a camera view offset, and back the camera off just enough to fit. */
  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.bloom.resolution.set((w * pr) / 2, (h * pr) / 2);

    const portrait = w / h < 0.9;
    let cx = 0.5, cy = 0.5, margin = 1.08;
    if (this.hero) {
      if (innerWidth <= 700) { cx = 0.5; cy = 0.56; margin = 1.08; }
      else if (portrait) { cx = 0.5; cy = 0.3; margin = 1.12; }
      else { cx = w > 1100 ? 0.7 : 0.66; cy = 0.53; margin = 1.06; }
    }
    const fullW = w * 2 * Math.max(cx, 1 - cx), fullH = h * 2 * Math.max(cy, 1 - cy);
    const offX = cx >= 0.5 ? 0 : fullW - w, offY = cy >= 0.5 ? 0 : fullH - h;
    const cam = this.camera;
    cam.aspect = fullW / fullH;
    cam.setViewOffset(fullW, fullH, offX, offY, w, h);

    const fx = (Math.min(cx, 1 - cx) * w) / (fullW / 2);
    const fy = (Math.min(cy, 1 - cy) * h) / (fullH / 2);
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const tanH = tanV * cam.aspect;
    const R = this.def.radius * margin;
    const base = this.def.camera.length();
    this.distance = Math.max(base, R / (tanH * fx), R / (tanV * fy));
    this.camDir = this.def.camera.clone().normalize();
    cam.position.copy(this.camDir).multiplyScalar(this.distance);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
  }

  bindEvents() {
    const el = this.el;
    let drag = null;
    el.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, last: e.clientX, moved: 0, id: e.pointerId };
      this.velY = 0;
    });
    addEventListener("pointermove", (e) => {
      const rect = el.getBoundingClientRect();
      this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      if (e.pointerType === "mouse") {
        const inside = Math.abs(this.pointer.x) <= 1 && Math.abs(this.pointer.y) <= 1;
        this.tiltTarget.set(inside ? this.pointer.x : 0, inside ? this.pointer.y : 0);
      }
      if (drag && drag.id === e.pointerId) {
        const dx = e.clientX - drag.last;
        drag.last = e.clientX;
        drag.moved += Math.abs(dx) + Math.abs(e.movementY || 0);
        this.rotY += dx * 0.008;
        this.velY = dx * 0.008;
      }
    }, { passive: true });
    const end = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (drag.moved < 6 && e.type === "pointerup") {
        const rect = el.getBoundingClientRect();
        this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        if (this.hit()) this.pulse();
      }
      drag = null;
    };
    addEventListener("pointerup", end);
    addEventListener("pointercancel", end);
    el.addEventListener("pointerleave", () => { this.tiltTarget.set(0, 0); });
  }

  hit() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.def.hover, false).length > 0;
  }

  pulse() { this.uniforms.uPulse.value = 1; }

  frame(t, dt) {
    const u = this.uniforms;
    u.uTime.value = t;
    u.uPulse.value = Math.max(0, u.uPulse.value - dt * 0.9);

    // Inertia + idle auto-rotation.
    this.velY *= Math.pow(0.04, dt);
    this.rotY += this.velY * dt * 8;
    if (!reduceMotion) this.rotY += dt * 0.12;
    this.tilt.lerp(this.tiltTarget, 1 - Math.pow(0.001, dt));
    this.spin.rotation.y = this.rotY + this.tilt.x * 0.25;
    this.spin.rotation.x = -this.tilt.y * 0.12;
    const p = u.uPulse.value;
    this.spin.scale.setScalar(1 + Math.sin(p * Math.PI) * 0.04);

    // Hero: model drifts up and turns while the page scrolls away.
    if (this.hero) {
      const rect = this.el.getBoundingClientRect();
      const sp = THREE.MathUtils.clamp(-rect.top / rect.height, 0, 1);
      this.root.position.y = sp * this.def.radius * 0.6;
      this.root.rotation.x = sp * 0.35;
    }

    // Hover cursor feedback (desktop only).
    if (!coarse && (this.tiltTarget.x || this.tiltTarget.y)) {
      const h = this.hit();
      if (h !== this.hovering) { this.hovering = h; this.el.style.cursor = h ? "pointer" : ""; }
    }

    this.def.update(t, dt);
    this.composer.render(dt);
  }
}

/* Boot ------------------------------------------------------------------- */
function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGL2RenderingContext && c.getContext("webgl2"));
  } catch { return false; }
}

async function boot() {
  const els = document.querySelectorAll("[data-scene]");
  if (!els.length) return;
  if (!webglAvailable()) {
    els.forEach((el) => el.closest(".hero, .stage")?.classList.add("is-ready", "no-webgl"));
    return;
  }
  // Canvas-drawn labels use the web fonts, so wait briefly for them.
  await Promise.race([
    Promise.all([document.fonts.load("400 40px Michroma"), document.fonts.load("500 20px Inter")]),
    new Promise((res) => setTimeout(res, 1200)),
  ]).catch(() => {});

  els.forEach((el) => {
    try { viewers.push(new Viewer(el)); }
    catch (err) { console.warn("3D scene failed:", err); }
    el.closest(".hero, .stage")?.classList.add("is-ready");
  });

  const clock = new THREE.Clock();
  let t = 0;
  const loop = () => {
    const dt = Math.min(clock.getDelta(), 1 / 20);
    t += dt;
    for (const v of viewers) if (v.visible) v.frame(t, dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot();
