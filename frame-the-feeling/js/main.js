import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildCamera } from './camera-model.js';
import { Ocean } from './ocean.js';

// Where booking requests are addressed. Change these before going live.
const CONFIG = {
  email: 'hello@framethefeeling.com',
  instagram: 'https://www.instagram.com/framethefeeling',
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

const html = document.documentElement;
window.__ftf = true;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;

// ---------------------------------------------------------------------------
// Page chrome that works with or without WebGL
// ---------------------------------------------------------------------------

$$('[data-email]').forEach((el) => {
  el.textContent = CONFIG.email;
  if (el.tagName === 'A') el.href = `mailto:${CONFIG.email}`;
});
$$('[data-instagram]').forEach((el) => { el.href = CONFIG.instagram; });

const menuBtn = $('#menu-btn');
const topbar = $('.topbar');
menuBtn.addEventListener('click', () => {
  const open = topbar.classList.toggle('nav-open');
  menuBtn.setAttribute('aria-expanded', String(open));
});
$$('.nav a').forEach((a) => a.addEventListener('click', () => {
  topbar.classList.remove('nav-open');
  menuBtn.setAttribute('aria-expanded', 'false');
}));

// "Enquire" on a session pre-fills the booking form
$$('[data-session]').forEach((btn) => btn.addEventListener('click', () => {
  $('#f-session').value = btn.dataset.session;
  $('#book-form').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  setTimeout(() => $('#f-name').focus({ preventScroll: true }), reduceMotion ? 0 : 700);
}));

// ---------- booking form ----------
const form = $('#book-form');
const fields = {
  name: { el: $('#f-name'), check: (v) => (v.trim() ? '' : 'Add your name so we know who to reply to.') },
  email: {
    el: $('#f-email'),
    check: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? '' : 'Enter an email address like name@example.com.'),
  },
  message: {
    el: $('#f-message'),
    check: (v) => (v.trim().length >= 10 ? '' : 'Tell us a little about the session, even a sentence helps.'),
  },
};
function validate(key) {
  const f = fields[key];
  const msg = f.check(f.el.value);
  const err = $(`#${f.el.id}-err`);
  err.textContent = msg;
  f.el.setAttribute('aria-invalid', msg ? 'true' : 'false');
  return !msg;
}
Object.keys(fields).forEach((k) => fields[k].el.addEventListener('blur', () => {
  if (fields[k].el.value) validate(k);
}));
form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const ok = Object.keys(fields).map(validate).every(Boolean);
  if (!ok) {
    const first = Object.values(fields).find((f) => f.el.getAttribute('aria-invalid') === 'true');
    first?.el.focus();
    return;
  }
  const data = new FormData(form);
  const lines = [
    `Name: ${data.get('name')}`,
    `Email: ${data.get('email')}`,
    `Session: ${data.get('session')}`,
    data.get('date') ? `Preferred date: ${data.get('date')}` : '',
    data.get('where') ? `Location: ${data.get('where')}` : '',
    '',
    data.get('message'),
  ].filter((l, i) => l !== '' || i === 5);
  const body = lines.join('\n');
  const subject = `Session request: ${data.get('session')}`;
  $('#summary-text').textContent = body;
  const mailto = `mailto:${CONFIG.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  $('#summary-mail').href = mailto;
  form.hidden = true;
  const summary = $('#summary');
  summary.hidden = false;
  $('#summary-title').focus();
});
$('#summary-copy').addEventListener('click', async () => {
  const btn = $('#summary-copy');
  const text = `To: ${CONFIG.email}\n\n${$('#summary-text').textContent}`;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    const range = document.createRange();
    range.selectNodeContents($('#summary-text'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    btn.textContent = 'Selected, press Ctrl+C';
  }
  setTimeout(() => { btn.textContent = 'Copy message'; }, 2400);
});
$('#summary-edit').addEventListener('click', () => {
  $('#summary').hidden = true;
  form.hidden = false;
  $('#f-message').focus();
});

// ---------- sound ----------
let audio = null;
let soundOn = false;
const soundBtn = $('#sound');
soundBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  soundBtn.setAttribute('aria-pressed', String(soundOn));
  $('.sound-label', soundBtn).textContent = soundOn ? 'Sound on' : 'Sound off';
  if (soundOn) {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
    shutterSound(0.4);
  }
});

// A focal-plane shutter: first curtain, second curtain, a little body thump.
function shutterSound(volume = 1) {
  if (!soundOn || !audio) return;
  const now = audio.currentTime;
  const noise = audio.createBuffer(1, audio.sampleRate * 0.08, audio.sampleRate);
  const ch = noise.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  const click = (t, freq, gain, dur) => {
    const src = audio.createBufferSource();
    src.buffer = noise;
    const bp = audio.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 1.4;
    const g = audio.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain * volume, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(audio.destination);
    src.start(t);
    src.stop(t + dur + 0.02);
  };
  click(now, 3600, 0.6, 0.03);
  click(now + 0.065, 2100, 0.45, 0.05);
  const osc = audio.createOscillator();
  const og = audio.createGain();
  osc.frequency.setValueAtTime(140, now);
  osc.frequency.exponentialRampToValueAtTime(60, now + 0.08);
  og.gain.setValueAtTime(0.25 * volume, now);
  og.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
  osc.connect(og).connect(audio.destination);
  osc.start(now);
  osc.stop(now + 0.12);
}

// ---------- loader ----------
const loader = $('#loader');
const pctEl = $('#loader-pct');
let shownPct = 0;
let targetPct = 0;
function setProgress(p) { targetPct = Math.max(targetPct, p); }
(function tickLoader() {
  shownPct = Math.min(targetPct, shownPct + Math.max(1, (targetPct - shownPct) * 0.12));
  pctEl.textContent = String(Math.round(shownPct)).padStart(2, '0');
  loader.style.setProperty('--p', (shownPct / 100).toFixed(3));
  if (shownPct < 100 || !loader.classList.contains('ready')) requestAnimationFrame(tickLoader);
})();

function openLoader() {
  return new Promise((resolve) => {
    setProgress(100);
    loader.classList.add('ready');
    const wait = () => {
      if (shownPct < 99.5) return requestAnimationFrame(wait);
      loader.classList.add('open');
      setTimeout(() => { loader.hidden = true; resolve(); }, reduceMotion ? 50 : 1100);
      setTimeout(resolve, reduceMotion ? 0 : 450);
    };
    wait();
  });
}

// ---------------------------------------------------------------------------
// 3D stage
// ---------------------------------------------------------------------------

// A dark studio with a big overhead softbox and two strip lights, the way
// cameras are lit for product photos. Its reflections give the lens barrel
// and body edges long, clean highlights.
function studioEnvironment() {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(20, 12, 20),
    new THREE.MeshBasicMaterial({ color: 0x1d2a2b, side: THREE.BackSide }),
  );
  env.add(room);
  const panel = (w, h, pos, rot, strength, color = 0xffffff) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.material.color.multiplyScalar(strength);
    m.position.set(...pos);
    m.rotation.set(...rot);
    env.add(m);
  };
  panel(9, 6, [0, 5.9, 0], [Math.PI / 2, 0, 0], 4);                 // overhead softbox
  panel(1.4, 8, [-7, 1, 3], [0, Math.PI / 2.4, 0], 6);              // left strip
  panel(1.4, 8, [7, 1, 1], [0, -Math.PI / 2.2, 0], 3.5);            // right strip
  panel(6, 3, [0, 1.5, 9.9], [0, Math.PI, 0], 1.2);                 // soft front fill
  panel(20, 20, [0, -5.9, 0], [-Math.PI / 2, 0, 0], 0.55, 0x7fd8d2); // turquoise water below
  return env;
}

async function boot() {
  const started = performance.now();
  setProgress(8);

  const canvas = $('#stage');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (err) {
    html.classList.add('no-webgl');
    html.classList.remove('pre-snap');
    await openLoader();
    return;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  // glass refraction samples a lower-resolution copy of the scene on phones
  if ('transmissionResolutionScale' in renderer) renderer.transmissionResolutionScale = finePointer ? 1 : 0.5;

  const fontsReady = Promise.race([
    Promise.all([
      document.fonts.load('500 40px "IBM Plex Mono"'),
      document.fonts.load('600 40px "Instrument Sans"'),
      document.fonts.load('italic 500 40px "Bodoni Moda"'),
    ]),
    new Promise((r) => setTimeout(r, 2500)),
  ]).then(() => setProgress(40));

  const loadImage = (src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  const [wordmark, wallpaper] = await Promise.all([
    new THREE.TextureLoader().loadAsync('assets/wordmark-white.png').then((t) => { setProgress(60); return t; }),
    loadImage('assets/wallpaper.webp').then((i) => { setProgress(75); return i; }),
    fontsReady,
  ]);
  wordmark.colorSpace = THREE.SRGBColorSpace;
  wordmark.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 80);
  const CAM_Z = 9;
  camera.position.set(0, 0, CAM_Z);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(studioEnvironment(), 0.02).texture;
  scene.environmentIntensity = 1.35;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const ocean = new Ocean({ count: finePointer ? 1400 : 800 });
  scene.add(ocean.background, ocean.particles);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8fd3cf, 0.55));
  // sunlight through the surface: casts the caustics and the camera's own shadows
  const key = new THREE.SpotLight(0xfffbf2, 120, 0, 0.5, 0.75, 2);
  key.position.set(1.4, 7, 3.2);
  key.map = ocean.causticTexture;
  key.castShadow = true;
  key.shadow.mapSize.set(finePointer ? 2048 : 1024, finePointer ? 2048 : 1024);
  key.shadow.camera.near = 3;
  key.shadow.camera.far = 14;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0xe6fbf9, 1.3);
  rim.position.set(-4, 2.5, -5);
  const fill = new THREE.DirectionalLight(0xffffff, 0.75);
  fill.position.set(4, 0.5, 6);
  scene.add(rim, fill);

  const model = buildCamera({
    wordmark,
    screenImage: wallpaper,
    anisotropy: renderer.capabilities.getMaxAnisotropy(),
  });
  const rig = new THREE.Group();
  rig.rotation.order = 'ZXY';
  const recoil = new THREE.Group();
  recoil.add(model.root);
  rig.add(recoil);
  scene.add(rig);

  // -------------------------------------------------------------------------
  // Photographic finish (desktop): ambient occlusion darkens every seam and
  // crevice, bright glints bloom a little, and a lens pass adds faint colour
  // fringing and film grain. Phones render directly to stay cool and smooth.
  // -------------------------------------------------------------------------
  let composer = null, filmPass = null;
  if (finePointer) {
    composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 }));
    composer.addPass(new RenderPass(scene, camera));
    const gtao = new GTAOPass(scene, camera, 2, 2);
    gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1.2, scale: 1.1, samples: 16 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    gtao.blendIntensity = 1.0;
    // keep the background, glass and printed decals out of the occlusion pass
    const noAO = [ocean.background];
    model.root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some((m) => m.transparent || m.transmission > 0)) noAO.push(o);
    });
    const baseOverride = gtao._overrideVisibility.bind(gtao);
    gtao._overrideVisibility = () => {
      baseOverride();
      for (const o of noAO) if (o.visible) { o.visible = false; gtao._visibilityCache.push(o); }
    };
    composer.addPass(gtao);
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(2, 2), 0.2, 0.5, 1.05));
    filmPass = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
        float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        void main() {
          vec2 d = vUv - 0.5;
          vec2 off = d * dot(d, d) * 0.012;
          vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
          float g = hash(vUv * uRes + fract(uTime) * 97.0) - 0.5;
          col += g * 0.03 * (0.35 + sqrt(max(col.g, 0.0)));
          gl_FragColor = vec4(max(col, 0.0), 1.0);
        }`,
    });
    composer.addPass(filmPass);
    composer.addPass(new OutputPass());
    ocean.setLinearOutput(true);
  }
  setProgress(92);

  // -------------------------------------------------------------------------
  // Story: the page is split into chapters; s = chapter index + progress.
  // Each key sets explode (e), rotation [tilt, turn, roll], screen offset (p,
  // as a fraction of the view) and scale (k). P overrides for portrait screens,
  // where the exploded stack is stood upright so it fits.
  // -------------------------------------------------------------------------
  const TAU = Math.PI * 2;
  const KEYS = [
    // at rest the lens pokes out to the right, so nudge left to centre what you see
    { s: 0.0, e: 0, r: [0.16, 0.5, 0], p: [-0.042, 0], k: 1, P: { p: [-0.03, 0], r: [0.16, 0.5, 0], k: 1 } },
    { s: 0.5, e: 0, r: [0.16, 0.5, 0], p: [-0.042, 0], k: 1, P: { p: [-0.03, 0], r: [0.16, 0.5, 0], k: 1 } },
    { s: 1.0, e: 0.02, r: [0.14, 0.8, 0.01], p: [0, 0], k: 0.94 },
    { s: 1.3, e: 0.41, r: [0.18, 0.91, 0.17], p: [0, 0], k: 0.76, P: { r: [0.18, 1.25, 1.2], p: [0, 0.1], k: 0.56 } },
    { s: 1.72, e: 1, r: [0.24, 1.08, 0.42], p: [0, 0], k: 0.5, P: { r: [0.2, 1.45, 1.5], p: [0, 0.1], k: 0.6 } },
    { s: 2.0, e: 1, r: [0.28, 1.2, 0.46], p: [0, 0], k: 0.49, P: { r: [0.22, 1.5, 1.5], p: [0, 0.1], k: 0.58 } },
    { s: 2.35, e: 1, r: [0.3, 1.5, 1.25], p: [0, 0.02], k: 0.46, P: { r: [0.28, 1.65, 1.5], p: [0, -0.01], k: 0.5 } },
    { s: 2.7, e: 1, r: [0.36, 1.85, 1.35], p: [0, 0.02], k: 0.44, P: { r: [0.32, 1.9, 1.5], p: [0, -0.01], k: 0.5 } },
    { s: 3.3, e: 1, r: [0.44, 2.5, 1.2], p: [0, 0.22], k: 0.4, P: { r: [0.4, 2.45, 1.5], p: [0, 0.2], k: 0.46 } },
    { s: 4.2, e: 0.9, r: [0.3, 3.35, 0.15], p: [0, 0.12], k: 0.46, P: { r: [0.3, 3.3, 1.2], p: [0, 0.14], k: 0.58 } },
    { s: 5.0, e: 0.72, r: [0.2, 4.7, 0], p: [0, 0.02], k: 0.62, P: { r: [0.2, 4.7, 0.6], p: [0, 0.04], k: 0.72 } },
    { s: 5.38, e: 0, r: [0.08, TAU + 0.3, 0], p: [-0.02, 0.04], k: 0.9 },
    { s: 5.75, e: 0, r: [0.08, TAU + 0.3, 0], p: [-0.02, 0.04], k: 0.9 },
    { s: 6.25, e: 0, r: [0.14, TAU + 0.5, 0], p: [0, 0.06], k: 0.7, P: { r: [0.14, TAU + 0.5, 0], p: [0, 0.3], k: 0.56 } },
    { s: 99, e: 0, r: [0.14, TAU + 0.5, 0], p: [0, 0.06], k: 0.7, P: { r: [0.14, TAU + 0.5, 0], p: [0, 0.3], k: 0.56 } },
  ];
  const SNAP_AT = 5.5;
  const HUD = [
    ['1/250', 'ƒ2.8', 'ISO 100'],
    ['1/125', 'ƒ4', 'ISO 200'],
    ['1/500', 'ƒ2', 'ISO 100'],
    ['1/60', 'ƒ5.6', 'ISO 400'],
    ['1/200', 'ƒ2.8', 'ISO 160'],
    ['1/250', 'ƒ2.8', 'ISO 100'],
    ['1/250', 'ƒ2.8', 'ISO 100'],
  ];

  const sample = (s, portrait) => {
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].s <= s) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = smooth(clamp((s - a.s) / (b.s - a.s)));
    const A = portrait && a.P ? { ...a, ...a.P } : a;
    const B = portrait && b.P ? { ...b, ...b.P } : b;
    return {
      e: lerp(A.e, B.e, t),
      r: A.r.map((v, j) => lerp(v, B.r[j], t)),
      p: A.p.map((v, j) => lerp(v, B.p[j], t)),
      k: lerp(A.k, B.k, t),
    };
  };

  const chapters = $$('[data-chapter]');
  let layout = [];
  let docMax = 1;
  function measure() {
    const y = scrollY;
    layout = chapters.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top + y, height: Math.max(1, r.height) };
    });
    docMax = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  }
  const storyAt = (y) => {
    const c = y + innerHeight * 0.5;
    for (let i = layout.length - 1; i >= 0; i--) {
      if (c >= layout[i].top) return i + clamp((c - layout[i].top) / layout[i].height);
    }
    return 0;
  };
  new ResizeObserver(measure).observe(document.body);
  measure();

  // -------------------------------------------------------------------------
  // Sizing
  // -------------------------------------------------------------------------
  let W = 0, H = 0, visW = 1, visH = 1, baseScale = 1, apartScale = 1, portrait = false, dpr = 1, maxDpr = 2;
  function sizeComposer() {
    if (!composer) return;
    composer.setPixelRatio(dpr);
    composer.setSize(W, H);
    filmPass.uniforms.uRes.value.set(W * dpr, H * dpr);
  }
  function applyDpr() {
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    sizeComposer();
    ocean.particleUniforms.uPR.value = dpr;
  }
  function resize(initial = false) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!initial && w === W && Math.abs(h - H) < 2) return;
    W = w; H = h;
    // render above screen density on desktops (supersampling keeps edges and
    // lens print crisp); phones stay at up to 2x to protect battery and heat
    const native = window.devicePixelRatio || 1;
    // (the post-processing already antialiases with 4x MSAA, so it needs less)
    maxDpr = composer ? Math.min(Math.max(native, 1.25), 2) : finePointer ? Math.min(Math.max(native * 1.25, 1.5), 2.5) : Math.min(native, 2);
    if (initial) dpr = maxDpr;
    dpr = Math.min(dpr, maxDpr);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    sizeComposer();
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    visH = 2 * CAM_Z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    visW = visH * camera.aspect;
    portrait = camera.aspect < 0.85;
    // assembled size, and the (smaller) size the exploded views are framed for
    const fitW = portrait ? 0.95 : 0.53;
    const fitH = portrait ? 0.42 : W <= 1100 ? 0.5 : 0.63;
    baseScale = Math.min((visW * fitW) / 1.7, (visH * fitH) / 1.05);
    const apartW = portrait ? 0.82 : 0.42;
    const apartH = portrait ? 0.34 : W <= 1100 ? 0.4 : 0.5;
    apartScale = Math.min((visW * apartW) / 1.7, (visH * apartH) / 1.05);
    ocean.uniforms.uAspect.value = camera.aspect;
    ocean.particleUniforms.uPR.value = dpr;
    ocean.setSize(W, H, W > 1600 ? 0.4 : 0.5);
    measure();
  }
  addEventListener('resize', () => resize());

  // compile shaders before the curtain lifts, so the first frames don't hitch
  model.update(0, 0);
  resize(true);
  renderer.compile(scene, camera);
  setProgress(100);

  // -------------------------------------------------------------------------
  // Pointer: parallax, hover and click-to-shoot
  // -------------------------------------------------------------------------
  const pointer = { x: 0, y: 0, sx: 0, sy: 0, nx: 0, ny: 0 };
  const raycaster = new THREE.Raycaster();
  let lastHover = 0;
  const hitCamera = (clientX, clientY) => {
    const r = canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(v, camera);
    return raycaster.intersectObject(model.root, true).length > 0;
  };
  const interactive = 'a, button, input, select, textarea, label, figure, .note-card, .session, .step, form';
  addEventListener('pointermove', (e) => {
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = (e.clientY / innerHeight) * 2 - 1;
    if (!finePointer) return;
    const now = performance.now();
    if (now - lastHover < 90) return;
    lastHover = now;
    const over = !e.target.closest(interactive) && hitCamera(e.clientX, e.clientY);
    html.classList.toggle('over-camera', over);
  }, { passive: true });
  // Drag the camera to spin it: full turns left/right, tilt up/down.
  // It keeps a little momentum, then settles back into the scroll pose.
  const spin = { yaw: 0, pitch: 0, vy: 0, vp: 0, drag: false, moved: 0, idle: 9, x: 0, y: 0, touch: null };
  const spinBy = (dx, dy) => {
    const k = 0.009;
    spin.yaw += dx * k;
    spin.pitch = clamp(spin.pitch + dy * k * 0.7, -1.2, 1.2);
    spin.vy = dx * k;
    spin.vp = dy * k * 0.7;
    spin.moved += Math.abs(dx) + Math.abs(dy);
    spin.idle = 0;
  };
  addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0 || !intro.done) return;
    if (e.target.closest(interactive) || !hitCamera(e.clientX, e.clientY)) return;
    spin.drag = true;
    spin.moved = 0;
    spin.x = e.clientX;
    spin.y = e.clientY;
    html.classList.add('spinning');
    e.preventDefault();
  });
  addEventListener('pointermove', (e) => {
    if (!spin.drag) return;
    spinBy(e.clientX - spin.x, e.clientY - spin.y);
    spin.x = e.clientX;
    spin.y = e.clientY;
  });
  const endDrag = () => { spin.drag = false; html.classList.remove('spinning'); };
  addEventListener('pointerup', endDrag);
  addEventListener('pointercancel', endDrag);
  // touch: a sideways swipe that starts on the camera spins it; vertical swipes still scroll
  addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (e.touches.length !== 1 || !intro.done || e.target.closest(interactive) || !hitCamera(t.clientX, t.clientY)) { spin.touch = null; return; }
    spin.touch = { x: t.clientX, y: t.clientY, mode: null };
    spin.moved = 0;
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    const st = spin.touch;
    if (!st) return;
    const t = e.touches[0];
    const dx = t.clientX - st.x, dy = t.clientY - st.y;
    if (!st.mode && Math.hypot(dx, dy) > 8) st.mode = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'spin' : 'scroll';
    if (st.mode !== 'spin') return;
    e.preventDefault();
    spinBy(dx * 1.3, 0);
    st.x = t.clientX;
    st.y = t.clientY;
  }, { passive: false });
  addEventListener('touchend', () => { spin.touch = null; });

  addEventListener('click', (e) => {
    if (spin.moved > 6) { spin.moved = 0; return; }
    if (e.target.closest(interactive) || !intro.done) return;
    if (hitCamera(e.clientX, e.clientY)) {
      if (model.explode < 0.2) snap('click');
      else nudge = 1;
    }
  });
  let nudge = 0;

  // -------------------------------------------------------------------------
  // Shutter
  // -------------------------------------------------------------------------
  const flashEl = $('#flash');
  const af = $('#af');
  const frameEl = $('#ex-frame');
  const afLabel = $('#ex-af');
  let shots = 0;
  let snapT = -1;
  function snap(reason) {
    // ignore rapid repeat clicks, but never drop the intro or finale shot
    if (reason === 'click' && snapT >= 0 && snapT < 0.6) return;
    snapT = 0;
    shots++;
    frameEl.textContent = String(shots).padStart(2, '0');
    af.classList.remove('hunting');
    af.classList.add('locked');
    afLabel.classList.add('locked');
    setTimeout(() => {
      af.classList.remove('locked');
      afLabel.classList.remove('locked');
    }, 1400);
    shutterSound();
    if (reason === 'intro' || html.classList.contains('pre-snap')) html.classList.remove('pre-snap');
    if (reason === 'finale') {
      $('#book').classList.add('shot');
      $('#print-no').textContent = String(shots).padStart(2, '0');
      $('#snap-title').textContent = 'Got it.';
    }
  }
  const snapCurve = (t) => {
    const flash = t < 0.04 ? t / 0.04 : Math.exp(-(t - 0.04) * 5.5);
    const press = t < 0.05 ? t / 0.05 : clamp(1 - (t - 0.12) / 0.14);
    let iris = null;
    if (t < 0.05) iris = lerp(0.1, 0.018, t / 0.05);
    else if (t < 0.16) iris = 0.018;
    else if (t < 0.34) iris = lerp(0.018, 0.1, smooth((t - 0.16) / 0.18));
    return { flash, press, iris };
  };

  // -------------------------------------------------------------------------
  // Intro: fade up, come apart, come back together, focus, shoot.
  // -------------------------------------------------------------------------
  const intro = { t: 0, active: false, done: false, af: false, shot: false };
  const INTRO = { apart: [0.9, 2.3], back: [2.8, 4.3], focus: 4.35, shoot: 4.8, end: 5.1 };
  function introPose(t) {
    let e = 0;
    if (t >= INTRO.apart[0] && t < INTRO.apart[1]) e = 0.92 * easeInOut((t - INTRO.apart[0]) / (INTRO.apart[1] - INTRO.apart[0]));
    else if (t >= INTRO.apart[1] && t < INTRO.back[0]) e = 0.92;
    else if (t >= INTRO.back[0] && t < INTRO.back[1]) e = 0.92 * (1 - easeInOut((t - INTRO.back[0]) / (INTRO.back[1] - INTRO.back[0])));
    const settle = easeInOut(clamp(t / INTRO.back[1]));
    return {
      e,
      turn: -0.9 * (1 - settle),
      tilt: 0.12 * Math.sin(settle * Math.PI),
      // pull back while it is in pieces so nothing leaves the frame
      k: lerp(0.82, 1, easeInOut(clamp(t / 1.2))) * (1 - 0.42 * e),
    };
  }
  const skipIntro = () => {
    if (intro.active && intro.t < INTRO.back[1]) intro.t = INTRO.back[1] - 0.25;
  };
  addEventListener('wheel', skipIntro, { passive: true });
  addEventListener('touchmove', skipIntro, { passive: true });
  addEventListener('keydown', skipIntro);

  // -------------------------------------------------------------------------
  // Leader lines from the "inside" notes to the parts they describe
  // -------------------------------------------------------------------------
  const leaderLine = $('#leader-line');
  const leaderDot = $('#leader-dot');
  const leaderRing = $('#leader-ring');
  const leaders = $('#leaders');
  const notes = $$('.note').map((el) => ({ el, card: $('.note-card', el), part: el.dataset.part, side: el.dataset.side }));
  const tmp = new THREE.Vector3();
  function updateLeaders(s) {
    let best = null, bestD = Infinity;
    if (s > 1.05 && s < 2.05 && model.explode > 0.35) {
      for (const n of notes) {
        const r = n.card.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - innerHeight * 0.5);
        if (d < bestD) { bestD = d; best = { n, r }; }
      }
    }
    const vis = best ? clamp(1 - bestD / (innerHeight * 0.38)) * clamp((model.explode - 0.35) / 0.3) : 0;
    leaders.style.opacity = vis.toFixed(3);
    if (!best || vis <= 0.001) return;
    model.anchors[best.n.part].getWorldPosition(tmp).project(camera);
    const cr = canvas.getBoundingClientRect();
    const px = (tmp.x * 0.5 + 0.5) * cr.width + cr.left;
    const py = (-tmp.y * 0.5 + 0.5) * cr.height + cr.top;
    const r = best.r;
    let x1, y1;
    if (portrait || innerWidth < 820) { x1 = r.left + r.width / 2; y1 = r.top - 6; }
    else if (best.n.side === 'left') { x1 = r.right + 14; y1 = r.top + 34; }
    else { x1 = r.left - 14; y1 = r.top + 34; }
    leaderLine.setAttribute('x1', x1.toFixed(1));
    leaderLine.setAttribute('y1', y1.toFixed(1));
    leaderLine.setAttribute('x2', px.toFixed(1));
    leaderLine.setAttribute('y2', py.toFixed(1));
    leaderDot.setAttribute('cx', px.toFixed(1));
    leaderDot.setAttribute('cy', py.toFixed(1));
    leaderRing.setAttribute('cx', px.toFixed(1));
    leaderRing.setAttribute('cy', py.toFixed(1));
  }

  // -------------------------------------------------------------------------
  // Viewfinder readouts
  // -------------------------------------------------------------------------
  const exposureEl = $('.exposure');
  const hud = {
    shutter: $('#ex-shutter'), ap: $('#ex-ap'), iso: $('#ex-iso'), depth: $('#ex-depth'),
    gauge: $('#gauge-mark'), gaugeLabel: $('#gauge-label'),
  };
  let hudKey = '';
  function updateHud(s, scrollP) {
    const [sh, ap, iso] = HUD[clamp(Math.floor(s), 0, HUD.length - 1)];
    const depth = (s * 3.1).toFixed(1);
    const k = `${sh}|${ap}|${iso}|${depth}`;
    if (k !== hudKey) {
      hudKey = k;
      hud.shutter.textContent = sh;
      hud.ap.textContent = ap;
      hud.iso.textContent = iso;
      hud.depth.textContent = `${depth} m`;
      hud.gaugeLabel.textContent = `${depth} m`;
    }
    hud.gauge.style.transform = `translateY(${(scrollP * 100).toFixed(2)}%)`;
    exposureEl.classList.toggle('dim', s > 6.05);
  }

  // -------------------------------------------------------------------------
  // Frame loop
  // -------------------------------------------------------------------------
  const cur = { e: 0, r: [0.16, 0.5, 0], p: [-0.042, 0], k: 1, reveal: 0, px: 0, py: 0 };
  let finaleArmed = true;
  let last = performance.now();
  let time = 0;
  let frames = 0, frameAcc = 0, lastAdapt = 0;

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    time += dt;
    resize();

    const y = scrollY;
    const s = storyAt(y);
    const scrollP = clamp(y / docMax);
    const target = sample(s, portrait);

    // intro overrides the explode value and eases the camera into its hero pose
    let e = target.e;
    let turn = 0, tilt = 0, kMul = 1;
    if (intro.active) {
      intro.t += dt;
      const pose = introPose(intro.t);
      e = Math.max(pose.e, target.e);
      turn = pose.turn; tilt = pose.tilt; kMul = pose.k;
      if (!intro.af && intro.t >= INTRO.focus) { intro.af = true; af.classList.add('hunting'); }
      if (!intro.shot && intro.t >= INTRO.shoot) { intro.shot = true; snap('intro'); }
      if (intro.t >= INTRO.end) { intro.active = false; intro.done = true; }
    }

    // the finale shot fires when the story crosses the mark, and re-arms above it
    if (intro.done) {
      if (finaleArmed && s >= SNAP_AT && s < 6.4) {
        finaleArmed = false;
        af.classList.add('hunting');
        setTimeout(() => snap('finale'), reduceMotion ? 0 : 380);
      } else if (s < SNAP_AT - 0.2) finaleArmed = true;
    }

    const lam = intro.active ? 14 : reduceMotion ? 12 : 4.2;
    cur.e = damp(cur.e, e, lam, dt);
    for (let j = 0; j < 3; j++) cur.r[j] = damp(cur.r[j], target.r[j], intro.active ? 14 : 3.6, dt);
    for (let j = 0; j < 2; j++) cur.p[j] = damp(cur.p[j], target.p[j], 3.6, dt);
    cur.k = damp(cur.k, target.k * kMul, intro.active ? 14 : 3.6, dt);

    const lensOn = (intro.done || (intro.active && intro.shot)) && (s < 0.95 || (s > SNAP_AT - 0.02 && s < 6.35 && !finaleArmed));
    cur.reveal = damp(cur.reveal, lensOn ? 1 : 0, lensOn ? 1.5 : 6, dt);

    // pointer parallax (desktop) or a slow sway (touch)
    const drift = reduceMotion ? 0 : 1;
    cur.px = damp(cur.px, finePointer ? pointer.x : Math.sin(time * 0.3) * 0.3, 2.5, dt);
    cur.py = damp(cur.py, finePointer ? pointer.y : 0, 2.5, dt);

    // snap animation
    let irisOpen = null, flash = 0, press = 0;
    if (snapT >= 0) {
      snapT += dt;
      const c = snapCurve(snapT);
      irisOpen = c.iris; flash = c.flash; press = c.press;
      if (snapT > 1.4) snapT = -1;
    }
    const flashMax = reduceMotion ? 0.3 : 0.92;
    flashEl.style.opacity = (flash * flashMax).toFixed(3);
    ocean.uniforms.uFlash.value = flash * 0.6;
    key.intensity = 110 + flash * 400;
    model.shutterButton.position.y = 0.024 - 0.012 * press;
    recoil.rotation.x = snapT >= 0 ? -0.025 * Math.exp(-snapT * 7) * Math.sin(snapT * 34) : 0;
    nudge = damp(nudge, 0, 3, dt);
    recoil.rotation.z = Math.sin(time * 18) * 0.02 * nudge;

    model.update(cur.e, time, { aperture: irisOpen, reveal: cur.reveal });

    const float = Math.sin(time * 0.6) * 0.03 * drift;
    rig.position.set(cur.p[0] * visW, cur.p[1] * visH + float, 0);
    if (!spin.drag && !(spin.touch && spin.touch.mode === 'spin')) {
      spin.idle += dt;
      spin.yaw += spin.vy;
      spin.pitch = clamp(spin.pitch + spin.vp, -1.2, 1.2);
      const fric = Math.exp(-4 * dt);
      spin.vy *= fric;
      spin.vp *= fric;
      if (spin.idle > 2.5) {
        // settle on the nearest whole turn so it never unwinds backwards
        spin.yaw = damp(spin.yaw, Math.round(spin.yaw / TAU) * TAU, 2, dt);
        spin.pitch = damp(spin.pitch, 0, 2, dt);
      }
    }
    rig.rotation.set(
      cur.r[0] + tilt + spin.pitch + cur.py * 0.08 * drift,
      cur.r[1] + turn + spin.yaw + cur.px * 0.16 * drift,
      cur.r[2] + Math.sin(time * 0.45) * 0.012 * drift,
    );
    rig.scale.setScalar(lerp(baseScale, apartScale, smooth(clamp(cur.e))) * cur.k);

    ocean.uniforms.uDepth.value = damp(ocean.uniforms.uDepth.value, clamp(s / 6.5), 3, dt);
    ocean.uniforms.uMouse.value.set(cur.px, cur.py);
    ocean.particleUniforms.uScroll.value = scrollP * 3;
    ocean.particleUniforms.uOpacity.value = reduceMotion ? 0.5 : 1;
    ocean.update(renderer, reduceMotion ? 0 : time);

    if (composer) {
      filmPass.uniforms.uTime.value = time;
      composer.render(dt);
    } else {
      renderer.render(scene, camera);
    }
    updateLeaders(s);
    updateHud(s, scrollP);

    // keep the frame rate up by trading resolution on slower devices
    frames++;
    frameAcc += dt;
    if (frames >= 60) {
      const avg = frameAcc / frames;
      if (now - lastAdapt > 2000 && intro.done) {
        // only give up resolution when the page is genuinely struggling (<30fps),
        // never below native density on a desktop, and win it back when it recovers
        const floor = finePointer ? Math.min(window.devicePixelRatio || 1, maxDpr) : 1;
        if (avg > 0.034 && dpr > floor) { dpr = Math.max(floor, dpr - 0.25); applyDpr(); lastAdapt = now; }
        else if (avg < 0.02 && dpr < maxDpr) { dpr = Math.min(maxDpr, dpr + 0.25); applyDpr(); lastAdapt = now; }
      }
      frames = 0; frameAcc = 0;
    }
  }

  // hold the loader for a beat so the logo has time to draw in
  const minHold = reduceMotion ? 0 : 1400;
  await new Promise((r) => setTimeout(r, Math.max(0, minHold - (performance.now() - started))));

  renderer.setAnimationLoop(frame);
  await openLoader();
  if (reduceMotion || scrollY > innerHeight * 0.5) {
    intro.done = true;
    html.classList.remove('pre-snap');
    if (scrollY > innerHeight * 0.5) finaleArmed = storyAt(scrollY) < SNAP_AT;
  } else {
    intro.active = true;
  }
}

boot().catch((err) => {
  console.error(err);
  html.classList.add('no-webgl');
  html.classList.remove('pre-snap');
  loader.classList.add('ready', 'open');
  setTimeout(() => { loader.hidden = true; }, 600);
});
