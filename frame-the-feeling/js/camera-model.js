// A full-frame mirrorless camera built from primitives, in the spirit of the
// reference body the studio shoots with. Units are roughly 1 = 100 mm.
// The lens looks down +z; the grip sits on the camera's right (-x from the front).
//
// Every movable piece is registered as a Part with an exploded offset and a
// window of the 0..1 "explode" value in which it travels. Because the pose is a
// pure function of that value, scrolling back up puts the camera back together.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as TX from './textures.js';

const V2 = THREE.Vector2;
const V3 = THREE.Vector3;
const AX = 0.1, AY = -0.02;          // lens axis on the body front
const FRONT = 0.215, BACK = -0.213;   // body front and rear faces
const TOP = 0.38, BOTTOM = -0.4;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

class Part {
  constructor(obj, { off = [0, 0, 0], rot = [0, 0, 0], win = [0, 1], float = 1 } = {}) {
    this.obj = obj;
    this.base = obj.position.clone();
    this.baseRot = obj.rotation.clone();
    this.off = new V3(...off);
    this.rot = new V3(...rot);
    this.win = win;
    this.float = float;
    this.phase = Math.random() * Math.PI * 2;
  }

  apply(e, time) {
    const [a, b] = this.win;
    const t = easeInOut(clamp01((e - a) / (b - a)));
    const o = this.obj;
    o.position.copy(this.base).addScaledVector(this.off, t);
    // exploded pieces drift a little, like they are suspended in water
    const drift = Math.sin(time * 0.9 + this.phase) * 0.012 * t * this.float;
    o.position.y += drift;
    o.rotation.set(
      this.baseRot.x + this.rot.x * t + drift * 0.6,
      this.baseRot.y + this.rot.y * t,
      this.baseRot.z + this.rot.z * t,
    );
    return t;
  }
}

// LatheGeometry smooths normals across corners; nudging a point either side of
// each corner keeps machined edges crisp.
function crisp(points) {
  const out = [];
  const EPS = 0.0012;
  const toward = (p, q) => p.clone().add(q.clone().sub(p).normalize().multiplyScalar(EPS));
  points.forEach((p, i) => {
    if (i > 0) out.push(toward(p, points[i - 1]));
    out.push(p.clone());
    if (i < points.length - 1) out.push(toward(p, points[i + 1]));
  });
  return out;
}

function lathe(profile, segments = 128) {
  const g = new THREE.LatheGeometry(crisp(profile.map(([x, y]) => new V2(x, y))), segments);
  g.rotateX(Math.PI / 2); // lathe axis (y) becomes the optical axis (z)
  return g;
}

// A hollow ring along the optical axis, from z0 to z0 + len.
function tube(rO, rI, z0, len, ch = 0.006) {
  return lathe([
    [rI, z0], [rO - ch, z0], [rO, z0 + ch], [rO, z0 + len - ch],
    [rO - ch, z0 + len], [rI, z0 + len], [rI, z0],
  ]);
}

// Biconvex glass element centred at zc.
function glass(R, zc, thick, sagF, sagB) {
  const pts = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const r = (i / n) * R;
    pts.push([r, zc - thick / 2 - sagB * (1 - (r / R) ** 2)]);
  }
  for (let i = n; i >= 0; i--) {
    const r = (i / n) * R;
    pts.push([r, zc + thick / 2 + sagF * (1 - (r / R) ** 2)]);
  }
  const g = new THREE.LatheGeometry(pts.map(([x, y]) => new V2(x, y)), 96);
  g.rotateX(Math.PI / 2);
  return g;
}

// Thin band of print wrapped around a barrel.
function band(r, zc, len, texture) {
  const g = new THREE.CylinderGeometry(r, r, len, 160, 1, true);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, zc);
  const m = new THREE.MeshStandardMaterial({
    map: texture, transparent: true, roughness: 0.6, metalness: 0, depthWrite: false,
  });
  return new THREE.Mesh(g, m);
}

function roundedRect(w, h, r, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  const x = cx - w / 2, y = cy - h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  return s;
}

function extrude(shape, depth, bevel, curveSegments = 24) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 5, curveSegments,
  });
  g.translate(0, 0, bevel); // geometry now spans z 0 .. depth + 2*bevel
  return g;
}

// Worn paint: where the surface curves sharply (edges, bevels, dial rims) and
// a chip-noise mask allows, the black finish is rubbed back to bare metal.
function addEdgeWear(material, { tint = 0x8b9196, amount = 0.6 } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWearTint = { value: new THREE.Color(tint) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWearPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWearPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWearPos;
        uniform vec3 uWearTint;
        float wHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float wNoise(vec3 x) {
          vec3 i = floor(x), f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(wHash(i), wHash(i + vec3(1, 0, 0)), f.x), mix(wHash(i + vec3(0, 1, 0)), wHash(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(wHash(i + vec3(0, 0, 1)), wHash(i + vec3(1, 0, 1)), f.x), mix(wHash(i + vec3(0, 1, 1)), wHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          vec3 wn = normalize(vNormal);
          float curv = length(fwidth(wn)) / max(length(fwidth(vViewPosition)), 1e-5);
          float chip = wNoise(vWearPos * 55.0) * 0.6 + wNoise(vWearPos * 160.0) * 0.4;
          float wear = smoothstep(8.0, 20.0, curv) * smoothstep(0.45, 0.62, chip) * ${amount.toFixed(2)};
          diffuseColor.rgb = mix(diffuseColor.rgb, uWearTint, wear);
          roughnessFactor = mix(roughnessFactor, 0.2, wear);
        }`);
  };
  material.customProgramCacheKey = () => 'edge-wear';
  return material;
}

function makeMaterials(tex) {
  return {
    body: new THREE.MeshPhysicalMaterial({
      // black anodised magnesium: properly metallic, with fine bead-blasted grain
      color: 0x3a3e42, roughness: 0.4, metalness: 1,
      normalMap: tex.grain, normalScale: new V2(0.35, 0.35), roughnessMap: tex.wear,
      clearcoat: 0.25, clearcoatRoughness: 0.3,
    }),
    leather: new THREE.MeshStandardMaterial({
      color: 0x141719, roughness: 0.9, metalness: 0, roughnessMap: tex.wear,
      normalMap: tex.leather, normalScale: new V2(0.85, 0.85),
    }),
    rubber: new THREE.MeshStandardMaterial({
      color: 0x121516, roughness: 0.78, metalness: 0,
      normalMap: tex.ribs, normalScale: new V2(1.2, 1.2),
    }),
    rubberFine: new THREE.MeshStandardMaterial({
      color: 0x141718, roughness: 0.74, metalness: 0,
      normalMap: tex.ribsFine, normalScale: new V2(0.9, 0.9),
    }),
    satin: new THREE.MeshPhysicalMaterial({
      color: 0x33373b, roughness: 0.3, metalness: 1, roughnessMap: tex.wear,
      normalMap: tex.grain, normalScale: new V2(0.2, 0.2),
    }),
    metal: new THREE.MeshPhysicalMaterial({
      color: 0xc3cacd, roughness: 0.3, metalness: 1, roughnessMap: tex.wear,
    }),
    metalDark: new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.28, metalness: 1 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xd9865a, roughness: 0.28, metalness: 1 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.92, metalness: 0 }),
    knurl: new THREE.MeshStandardMaterial({
      color: 0x3a3f43, roughness: 0.26, metalness: 1,
      normalMap: tex.knurl, normalScale: new V2(1.4, 1.4),
    }),
    // Real refracting glass: light bends through it and shows the barrel and
    // iris behind, with the green/magenta sheen of multi-coating on top.
    glassFront: new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.0, metalness: 0,
      transmission: 1, thickness: 0.09, ior: 1.6,
      attenuationColor: new THREE.Color(0x9fd6c8), attenuationDistance: 0.35,
      specularIntensity: 1, specularColor: new THREE.Color(0xffffff),
      iridescence: 1, iridescenceIOR: 1.38, iridescenceThicknessRange: [280, 420],
      envMapIntensity: 1.8,
    }),
    glassClear: new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.0, metalness: 0,
      transmission: 1, thickness: 0.05, ior: 1.52,
      attenuationColor: new THREE.Color(0xc4efe6), attenuationDistance: 0.6,
      iridescence: 0.7, iridescenceIOR: 1.33, iridescenceThicknessRange: [240, 380],
      envMapIntensity: 1.6, side: THREE.DoubleSide,
    }),
    blade: new THREE.MeshStandardMaterial({
      color: 0x0d1012, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide,
    }),
    sensor: new THREE.MeshPhysicalMaterial({
      color: 0x1d2a3a, roughness: 0.12, metalness: 0.7,
      iridescence: 1, iridescenceIOR: 2.0, iridescenceThicknessRange: [300, 800],
      clearcoat: 1, clearcoatRoughness: 0.05,
    }),
    gold: new THREE.MeshStandardMaterial({ color: 0xc9a45a, roughness: 0.3, metalness: 1 }),
    eyepiece: new THREE.MeshPhysicalMaterial({
      color: 0x050809, roughness: 0.05, metalness: 0, clearcoat: 1, envMapIntensity: 2,
    }),
    lamp: new THREE.MeshStandardMaterial({
      color: 0xf08a6e, emissive: 0xf08a6e, emissiveIntensity: 0.25, roughness: 0.3,
    }),
  };
}

// Nine-bladed iris. Each blade is the part of a half-plane (inner edge at
// distance rho from the axis) that lies inside the barrel, which together
// leave a regular nonagon open in the middle.
class Iris {
  constructor(material, count = 9, R = 0.235) {
    this.group = new THREE.Group();
    this.count = count;
    this.R = R;
    this.rho = -1;
    this.blades = [];
    for (let i = 0; i < count; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.z = (i / count) * Math.PI * 2;
      pivot.position.z = i * 0.0014;
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      pivot.add(mesh);
      this.group.add(pivot);
      this.blades.push({ pivot, mesh });
    }
    this.setOpening(0.16);
  }

  setOpening(rho) {
    if (Math.abs(rho - this.rho) < 0.0015) return;
    this.rho = rho;
    const R = this.R;
    const t0 = -(Math.tan(Math.PI / this.count) * rho + 0.012);
    const t1 = Math.sqrt(Math.max(R * R - rho * rho, 0));
    const s = new THREE.Shape();
    s.moveTo(t0, rho);
    s.lineTo(t1, rho);
    const a0 = Math.atan2(rho, t1);
    const a1 = Math.atan2(Math.sqrt(R * R - t0 * t0), t0);
    s.absarc(0, 0, R, a0, a1, false);
    s.lineTo(t0, rho);
    const geo = new THREE.ShapeGeometry(s, 24);
    for (const b of this.blades) {
      b.mesh.geometry.dispose();
      b.mesh.geometry = geo;
    }
  }

  // Blades bloom outward when the lens is taken apart.
  spread(t) {
    this.blades.forEach((b, i) => {
      b.mesh.position.set(0, 0.1 * t, i * 0.012 * t);
      // tilt each blade open like a petal so the iris reads from the side
      b.mesh.rotation.set(1.05 * t, 0, -0.35 * t);
    });
  }
}

export function buildCamera({ wordmark, screenImage, anisotropy = 8 }) {
  TX.setAnisotropy(anisotropy);
  const tex = {
    grain: TX.grainNormal(),
    wear: TX.wearRoughness(),
    leather: TX.leatherNormal(),
    ribs: TX.ribNormal(110, 0.35),
    ribsFine: TX.ribNormal(220, 0.6),
    knurl: TX.ribNormal(70, 0.4),
  };
  tex.leather.repeat.set(4, 4);
  const M = makeMaterials(tex);
  addEdgeWear(M.body);
  addEdgeWear(M.satin, { amount: 0.5 });
  addEdgeWear(M.knurl, { amount: 0.45, tint: 0x9aa0a4 });

  const root = new THREE.Group();   // centring shift is applied here
  const parts = [];
  const add = (parent, obj, opts) => {
    parent.add(obj);
    if (opts) parts.push(new Part(obj, opts));
    return obj;
  };
  const mesh = (geo, mat, pos = [0, 0, 0], rot = [0, 0, 0]) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.rotation.set(...rot);
    return m;
  };

  // ---------- body shells ----------
  const bevel = 0.022;
  const outline = () => roundedRect(1.26 - bevel * 2, 0.78 - bevel * 2, 0.06, 0, (TOP + BOTTOM) / 2);

  const frontShell = new THREE.Group();
  const frontShape = outline();
  const hole = new THREE.Path();
  hole.absarc(AX, AY, 0.255, 0, Math.PI * 2, true);
  frontShape.holes.push(hole);
  const frontGeo = extrude(frontShape, 0.194 - bevel * 2, bevel, 32);
  frontShell.add(mesh(frontGeo, M.body, [0, 0, FRONT - 0.194]));
  // leatherette on the front, right of the mount (camera's left side)
  const panel = roundedRect(0.2, 0.52, 0.03, 0.5, -0.05);
  const panelGeo = extrude(panel, 0.004, 0.003, 12);
  const panelMesh = mesh(panelGeo, M.leather, [0, 0, FRONT - 0.002]);
  frontShell.add(panelMesh);
  // mount flange
  frontShell.add(mesh(tube(0.29, 0.255, 0, 0.012), M.metal, [AX, AY, FRONT - 0.002]));
  // lens release button and the front command dial set into the grip
  frontShell.add(mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.016, 32), M.satin, [-0.23, -0.24, FRONT + 0.006], [Math.PI / 2, 0, 0]));
  frontShell.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 60), M.knurl, [-0.47, 0.3, 0.405], [0, 0, 0]));
  // grip
  const grip = mesh(new RoundedBoxGeometry(0.32, 0.74, 0.3, 6, 0.12), M.leather, [-0.47, -0.02, 0.26]);
  frontShell.add(grip);
  // AF assist lamp and the model badge
  frontShell.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.01, 32), M.lamp, [-0.24, 0.27, FRONT + 0.003], [Math.PI / 2, 0, 0]));
  const badge = mesh(new THREE.PlaneGeometry(0.16, 0.08), new THREE.MeshBasicMaterial({ map: TX.badge('26'), transparent: true }), [0.5, 0.29, FRONT + 0.002]);
  frontShell.add(badge);
  // strap lugs
  for (const sx of [-1, 1]) {
    frontShell.add(mesh(new THREE.TorusGeometry(0.032, 0.009, 12, 32), M.metal, [sx * 0.635, 0.27, 0.02], [0, Math.PI / 2, 0]));
  }
  add(root, frontShell, { off: [0, 0, 0.3], win: [0.38, 0.82], float: 0.6 });

  const rearShell = new THREE.Group();
  const rearGeo = extrude(outline(), 0.234 - bevel * 2, bevel, 32);
  rearShell.add(mesh(rearGeo, M.body, [0, 0, BACK]));
  // rear leather thumb rest and a control wheel
  rearShell.add(mesh(new RoundedBoxGeometry(0.2, 0.26, 0.04, 4, 0.02), M.leather, [-0.47, 0.14, BACK - 0.005]));
  const wheel = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 48), M.knurl, [-0.47, -0.16, BACK - 0.01], [Math.PI / 2, 0, 0]);
  rearShell.add(wheel);
  // rear controls: AF-ON, AEL, joystick, menu buttons, top rear dial
  const btn = (r, h, x, y, mat = M.satin) =>
    rearShell.add(mesh(new THREE.CylinderGeometry(r, r, h, 32), mat, [x, y, BACK - h / 2 + 0.002], [Math.PI / 2, 0, 0]));
  btn(0.034, 0.02, -0.33, 0.25);
  btn(0.03, 0.018, -0.2, 0.25);
  btn(0.022, 0.03, -0.3, 0.02, M.rubber);
  btn(0.024, 0.014, -0.52, -0.33);
  btn(0.024, 0.014, 0.52, 0.3);
  btn(0.024, 0.014, 0.44, 0.3);
  rearShell.add(mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.035, 60), M.knurl, [-0.52, TOP - 0.01, BACK + 0.04]));
  // memory card door on the grip side and a port cover on the other
  rearShell.add(mesh(new RoundedBoxGeometry(0.014, 0.3, 0.17, 3, 0.006), M.satin, [-0.633, 0.03, -0.1]));
  rearShell.add(mesh(new RoundedBoxGeometry(0.014, 0.44, 0.2, 3, 0.006), M.leather, [0.633, -0.04, -0.09]));
  add(root, rearShell, { off: [0, 0, -0.34], win: [0.4, 0.86], float: 0.6 });

  // ---------- internals (hidden until the shells separate) ----------
  const sensorModule = new THREE.Group();
  sensorModule.add(mesh(new RoundedBoxGeometry(0.5, 0.4, 0.03, 3, 0.012), M.metalDark, [AX, AY, 0.032]));
  sensorModule.add(mesh(new THREE.BoxGeometry(0.4, 0.28, 0.012), M.gold, [AX, AY, 0.05]));
  const die = mesh(new THREE.PlaneGeometry(0.36, 0.24), M.sensor, [AX, AY, 0.057]);
  sensorModule.add(die);
  add(root, sensorModule, { off: [0, 0.05, 0.14], win: [0.46, 0.9] });

  const board = mesh(new THREE.BoxGeometry(1.0, 0.64, 0.014), [
    M.gold, M.gold, M.gold, M.gold,
    new THREE.MeshStandardMaterial({ map: TX.pcb(), roughness: 0.55, metalness: 0.2 }),
    M.metalDark,
  ], [0.02, -0.02, -0.06]);
  add(root, board, { off: [0, 0.12, -0.14], win: [0.5, 0.95] });

  const battery = mesh(new RoundedBoxGeometry(0.16, 0.52, 0.3, 3, 0.02), [
    M.satin, M.satin, M.satin, M.satin,
    new THREE.MeshStandardMaterial({ map: TX.label(['FTF', 'Li-ion 7.2V', '2280mAh']), roughness: 0.5 }),
    M.satin,
  ], [-0.47, -0.1, 0.05]);
  add(root, battery, { off: [0, -1.0, 0.05], rot: [0, 0.5, 0], win: [0.52, 1] });

  const card = mesh(new THREE.BoxGeometry(0.02, 0.32, 0.24), [
    M.satin,
    new THREE.MeshStandardMaterial({ map: TX.label(['128', 'FTF  V90', 'UHS-II'], { bg: '#0e2a30' }), roughness: 0.5 }),
    M.satin, M.satin, M.satin, M.satin,
  ], [-0.58, 0.06, -0.09]);
  add(root, card, { off: [-0.66, 0.06, 0], rot: [0, 0, 0.2], win: [0.56, 1] });

  // screws come out of the base plate last
  [[-0.2, 0.08], [0.3, 0.08], [-0.2, -0.12], [0.3, -0.12]].forEach(([x, z], i) => {
    const screw = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.05, 16), M.metal, [x, BOTTOM + 0.02, z]);
    add(root, screw, { off: [0, -0.36 - i * 0.04, 0], rot: [0, 4, 0], win: [0.6 + i * 0.04, 1] });
  });

  // ---------- viewfinder hump, hot shoe, eyecup ----------
  const hump = new THREE.Group();
  const trap = new THREE.Shape();
  const hb = 0.26 - 0.02, ht = 0.15 - 0.02, hh = 0.21;
  trap.moveTo(AX - hb, TOP - 0.03);
  trap.lineTo(AX + hb, TOP - 0.03);
  trap.lineTo(AX + ht, TOP - 0.03 + hh);
  trap.lineTo(AX - ht, TOP - 0.03 + hh);
  trap.lineTo(AX - hb, TOP - 0.03);
  hump.add(mesh(extrude(trap, 0.33, 0.02, 8), M.body, [0, 0, -0.2]));
  const mark = new THREE.Mesh(
    new THREE.PlaneGeometry(0.27, 0.27 / 2.4),
    new THREE.MeshBasicMaterial({ map: wordmark, transparent: true, depthWrite: false, color: 0xe9f5f4 }),
  );
  mark.position.set(AX, TOP + 0.075, 0.1715);
  hump.add(mark);
  const shoe = new THREE.Group();
  shoe.add(mesh(new THREE.BoxGeometry(0.2, 0.016, 0.18), M.metal, [AX, 0, 0]));
  shoe.add(mesh(new THREE.BoxGeometry(0.14, 0.01, 0.16), M.interior, [AX, 0.01, 0]));
  shoe.position.set(0, TOP - 0.03 + hh + 0.028, -0.02);
  add(hump, shoe, { off: [0, 0.16, 0], win: [0.3, 0.72] });
  const eyecup = new THREE.Group();
  eyecup.add(mesh(new RoundedBoxGeometry(0.36, 0.25, 0.1, 4, 0.04), M.leather, [AX, TOP + 0.08, -0.25]));
  eyecup.add(mesh(new THREE.PlaneGeometry(0.2, 0.13), M.eyepiece, [AX, TOP + 0.08, -0.3005], [0, Math.PI, 0]));
  add(hump, eyecup, { off: [0, 0, -0.2], win: [0.32, 0.76] });
  add(root, hump, { off: [0, 0.42, -0.02], win: [0.24, 0.7] });

  // ---------- top controls ----------
  const dial = (r, h, labels, pos, accent) => {
    const g = new THREE.CylinderGeometry(r, r, h, 72);
    const face = new THREE.MeshStandardMaterial({ map: TX.dialFace(labels, { accent }), roughness: 0.42, metalness: 0.6 });
    return mesh(g, [M.knurl, face, M.metalDark], pos);
  };
  const modeDial = dial(0.1, 0.06, ['M', 'S', 'A', 'P', 'AUTO', '1', '2', '3'], [-0.2, TOP + 0.03, -0.08], '#f08a6e');
  add(root, modeDial, { off: [0, 0.55, 0], rot: [0, 2.2, 0], win: [0.18, 0.64] });
  const expDial = dial(0.09, 0.055, ['0', '+1', '+2', '+3', '-3', '-2', '-1'], [-0.45, TOP + 0.028, -0.12]);
  add(root, expDial, { off: [0, 0.46, 0], rot: [0, -2, 0], win: [0.2, 0.66] });

  const shutter = new THREE.Group();
  shutter.add(mesh(new THREE.CylinderGeometry(0.076, 0.08, 0.026, 48), M.satin, [0, 0, 0]));
  shutter.add(mesh(new THREE.BoxGeometry(0.05, 0.016, 0.04), M.satin, [0.075, 0, 0.03], [0, -0.6, 0]));
  const shutterButton = mesh(new THREE.CylinderGeometry(0.044, 0.046, 0.03, 48), M.metal, [0, 0.024, 0]);
  shutter.add(shutterButton);
  shutter.position.set(-0.46, TOP - 0.018, 0.25);
  shutter.rotation.x = 0.12;
  add(root, shutter, { off: [0, 0.6, 0.02], rot: [0, 1.2, 0], win: [0.16, 0.6] });

  for (const [x, z, i] of [[-0.27, 0.13, 0], [-0.13, 0.13, 1]]) {
    const b = mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.018, 32), M.satin, [x, TOP + 0.01, z]);
    add(root, b, { off: [0, 0.4 + i * 0.05, 0], win: [0.2, 0.62] });
  }

  // ---------- rear screen (tilts out on a hinge along its top edge) ----------
  const screenHinge = new THREE.Group();
  screenHinge.position.set(0.08, 0.17, BACK - 0.02);
  const screenFrame = mesh(new RoundedBoxGeometry(0.8, 0.54, 0.035, 3, 0.012), M.satin, [0, -0.27, 0]);
  screenHinge.add(screenFrame);
  const screenTex = TX.screen(screenImage);
  const lcd = mesh(new THREE.PlaneGeometry(0.72, 0.48), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }), [0, -0.27, -0.0185], [0, Math.PI, 0]);
  screenHinge.add(lcd);
  add(root, screenHinge, { off: [0, 0.05, -0.62], rot: [-0.55, 0, 0], win: [0.28, 0.76] });

  // ---------- lens ----------
  const lens = new THREE.Group();
  lens.position.set(AX, AY, FRONT);
  const L = 0.66; // how far the lens elements fan out
  const lensPart = (obj, off, win = [0.22, 0.8]) => add(lens, obj, { off: [0, 0, off * L], win });

  lensPart(mesh(tube(0.292, 0.262, 0, 0.02), M.copper), 0);
  const rearBarrel = new THREE.Group();
  rearBarrel.add(mesh(tube(0.283, 0.236, 0.02, 0.1), M.satin));
  rearBarrel.add(band(0.2845, 0.08, 0.045, TX.zoomScale()));
  lensPart(rearBarrel, 0.14);
  lensPart(mesh(glass(0.2, 0.065, 0.028, 0.012, 0.014), M.glassClear), 0.28);
  const zoomRing = mesh(tube(0.302, 0.262, 0.12, 0.25), M.rubber);
  tex.ribs.repeat.set(1, 1);
  lensPart(zoomRing, 0.42);
  lensPart(mesh(glass(0.21, 0.2, 0.034, 0.02, 0.01), M.glassClear), 0.54);

  const iris = new Iris(M.blade);
  iris.group.position.z = 0.29;
  lensPart(iris.group, 0.68);

  const midBarrel = new THREE.Group();
  midBarrel.add(mesh(tube(0.29, 0.25, 0.37, 0.1), M.satin));
  midBarrel.add(band(0.2915, 0.42, 0.036, TX.barrelBand([
    'FTF', '28–70mm', { text: '1:2.8', color: '#f08a6e' }, 'FRAME THE FEELING', 'Ø55',
  ])));
  lensPart(midBarrel, 0.86);
  lensPart(mesh(glass(0.225, 0.4, 0.05, 0.03, 0.022), M.glassClear), 1.0);
  lensPart(mesh(tube(0.3, 0.26, 0.47, 0.11), M.rubberFine), 1.16);
  lensPart(mesh(glass(0.21, 0.52, 0.036, 0.018, 0.02), M.glassClear), 1.3);

  const frontBarrel = new THREE.Group();
  frontBarrel.add(mesh(tube(0.292, 0.222, 0.58, 0.08), M.satin));
  // matte baffles inside the barrel give the glass some depth
  frontBarrel.add(mesh(tube(0.222, 0.205, 0.55, 0.012, 0.002), M.interior));
  frontBarrel.add(mesh(tube(0.222, 0.198, 0.5, 0.012, 0.002), M.interior));
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.226, 0.288, 128),
    new THREE.MeshBasicMaterial({
      map: TX.ringText('Ø55  ·  FRAME THE FEELING  ·  0.3m/0.99ft  ·  28–70mm', { radius: 0.445, font: 36 }),
      transparent: true, depthWrite: false, color: 0xd4e2e2,
    }),
  );
  // RingGeometry UVs are planar (uv = 0.5 + xy / 2r), so text drawn at 0.445 of
  // the canvas lands on the middle of the ring
  ring.position.z = 0.6605;
  frontBarrel.add(ring);
  lensPart(frontBarrel, 1.48);

  const frontGlass = new THREE.Group();
  frontGlass.add(mesh(glass(0.219, 0.604, 0.034, 0.034, 0.012), M.glassFront));
  // the wordmark that rises in the front element
  const lensTextMat = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: wordmark },
      uReveal: { value: 0 },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0xc8f7f3) },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map; uniform float uReveal; uniform float uTime; uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float a = texture2D(map, vUv).a;
        float edge = uReveal * 1.3 - 0.15;
        float shown = smoothstep(edge, edge - 0.15, vUv.y);
        float lead = exp(-pow((vUv.y - edge) * 14.0, 2.0)) * sin(uReveal * 3.14159);
        float shimmer = 0.86 + 0.14 * sin(uTime * 1.6 + vUv.x * 8.0 - vUv.y * 3.0);
        vec3 col = uColor * shimmer * shown + vec3(0.7, 1.0, 0.97) * lead * 1.4;
        gl_FragColor = vec4(col * a, 1.0);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const lensText = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34 / 2.4), lensTextMat);
  lensText.position.z = 0.657;
  lensText.renderOrder = 10;
  frontGlass.add(lensText);
  lensPart(frontGlass, 1.62);

  add(root, lens, { off: [0, 0, 0.36], win: [0.0, 0.5], float: 0.4 });

  // anchors the page uses to draw leader lines to parts
  const anchors = {
    glass: frontGlass,
    aperture: iris.group,
    sensor: die,
    body: hump,
  };

  // self-shadowing: every opaque part casts and receives
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const opaque = mats.every((m) => !m.transparent && !(m.transmission > 0));
    o.castShadow = opaque;
    o.receiveShadow = opaque;
  });

  let explode = 0;
  const state = {
    root, parts, iris, lensText, lensTextMat, shutterButton, anchors, screenTex,
    get explode() { return explode; },
    update(e, time, { aperture = null, reveal = 0 } = {}) {
      explode = e;
      for (const p of parts) p.apply(e, time);
      // keep the whole exploded stack centred on screen
      root.position.z = -0.72 * easeInOut(clamp01(e));
      const open = aperture ?? (0.1 + 0.07 * clamp01(e * 2));
      iris.setOpening(open);
      iris.spread(easeInOut(clamp01((e - 0.3) / 0.6)));
      lensTextMat.uniforms.uReveal.value = reveal;
      lensTextMat.uniforms.uTime.value = time;
      lensText.position.y = -0.03 * (1 - reveal);
      lensText.scale.setScalar(0.92 + 0.08 * reveal);
      lensText.visible = reveal > 0.001;
    },
  };
  return state;
}
