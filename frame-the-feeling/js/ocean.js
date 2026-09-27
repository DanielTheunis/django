// The water: a full-screen watercolour gradient with light shafts and
// caustics, drifting particles, and a small caustic render target that a
// spotlight projects onto the camera.
import * as THREE from 'three';

const NOISE = /* glsl */`
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }
  // Caustic web: the thin bright seams between moving Voronoi cells.
  float caustic(vec2 uv, float t) {
    vec2 g = floor(uv), f = fract(uv);
    float d1 = 8.0, d2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 h = hash2(g + o);
      vec2 r = o + 0.5 + 0.42 * sin(t * 0.55 + 6.2831 * h) - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
    float e = sqrt(d2) - sqrt(d1);
    return pow(1.0 - smoothstep(0.0, 0.2, e), 3.0);
  }
`;

const BG_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform float uTime, uDepth, uAspect, uFlash;
  uniform vec2 uMouse;
  ${NOISE}
  void main() {
    vec2 uv = vUv;
    vec2 p = vec2((uv.x - 0.5) * uAspect, uv.y);
    float d = clamp(uDepth, 0.0, 1.0);

    vec3 foam    = vec3(0.965, 0.992, 0.992);
    vec3 shallow = vec3(0.80, 0.952, 0.945);
    vec3 turq    = vec3(0.52, 0.875, 0.86);
    vec3 lagoon  = vec3(0.25, 0.72, 0.72);

    vec3 top = mix(foam, mix(shallow, turq, 0.35), d);
    vec3 bot = mix(shallow, lagoon, 0.25 + 0.75 * d);
    vec3 col = mix(bot, top, smoothstep(-0.15, 1.05, uv.y + (fbm(p * 1.3 + uTime * 0.01) - 0.5) * 0.25));

    // pigment pooling, like wet-on-wet watercolour
    float w = fbm(p * 1.7 + vec2(0.0, uTime * 0.012) + d * 3.0);
    float w2 = fbm(p * 5.0 - vec2(uTime * 0.008, 0.0) + 7.0);
    col = mix(col, col * vec3(0.9, 0.99, 1.01), smoothstep(0.5, 0.78, w) * 0.55);
    col += (w2 - 0.5) * 0.03;
    // a hard pigment edge where pools dry
    float edge = smoothstep(0.012, 0.0, abs(w - 0.6)) * 0.035;
    col -= edge * vec3(0.4, 0.15, 0.1);

    // light shafts from the surface, leaning toward the pointer
    vec2 src = vec2(uMouse.x * 0.2, 1.4);
    vec2 rv = p - src;
    float ang = atan(rv.x, -rv.y);
    float rays = (sin(ang * 17.0 + uTime * 0.3) * 0.5 + 0.5) * (sin(ang * 29.0 - uTime * 0.21 + 1.7) * 0.5 + 0.5);
    rays = pow(rays, 1.8) * smoothstep(1.9, 0.25, length(rv)) * (1.0 - d * 0.5);
    col = mix(col, foam, rays * 0.4);

    // caustics near the surface
    vec2 cp = p * 3.0 + vec2(fbm(p * 2.0 + uTime * 0.04), fbm(p * 2.0 - uTime * 0.03)) * 0.8;
    float c = caustic(cp, uTime) * 0.6 + caustic(cp * 1.7 + 3.1, uTime * 1.3) * 0.4;
    col += c * smoothstep(0.2, 1.0, uv.y) * (1.0 - d * 0.55) * 0.12;

    // soft vignette (grain and flash are added at full resolution)
    float vig = smoothstep(1.3, 0.3, length((uv - 0.5) * vec2(uAspect * 0.8, 1.0)));
    col *= mix(0.93, 1.0, vig);

    gl_FragColor = vec4(col, 1.0);
  }
`;

// Full-resolution pass: upsample the watercolour, add paper grain and the flash.
const COMPOSITE_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tWater;
  uniform float uTime, uFlash;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  void main() {
    vec3 col = texture2D(tWater, vUv).rgb;
    col += (hash(gl_FragCoord.xy * 0.37 + fract(uTime * 0.37) * 91.0) - 0.5) * 0.018;
    gl_FragColor = vec4(mix(col, vec3(1.0), uFlash), 1.0);
  }
`;

const CAUSTIC_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  ${NOISE}
  void main() {
    vec2 p = vUv * 4.0;
    p += vec2(fbm(p + uTime * 0.05), fbm(p - uTime * 0.04)) * 0.9;
    float c = caustic(p, uTime * 1.2) * 0.65 + caustic(p * 1.6 + 2.0, uTime * 1.5) * 0.35;
    float fall = smoothstep(0.75, 0.2, length(vUv - 0.5));
    gl_FragColor = vec4(vec3(0.45 + c * 1.9) * fall, 1.0);
  }
`;

const FULLSCREEN_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.999, 1.0); }
`;

const PARTICLE_VERT = /* glsl */`
  attribute float aSeed;
  attribute float aSize;
  attribute float aType;
  uniform float uTime, uPR, uScroll;
  varying float vAlpha;
  varying float vType;
  void main() {
    vec3 pos = position;
    float speed = aType > 0.5 ? (0.25 + aSeed * 0.35) : (0.04 + aSeed * 0.06);
    pos.y = mod(pos.y + uTime * speed + uScroll * (1.5 + aSeed) + 6.0, 12.0) - 6.0;
    pos.x += sin(uTime * 0.35 + aSeed * 40.0) * (aType > 0.5 ? 0.08 : 0.25);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPR * (7.0 / -mv.z);
    vAlpha = smoothstep(22.0, 9.0, -mv.z) * smoothstep(1.5, 4.0, -mv.z);
    vType = aType;
  }
`;

const PARTICLE_FRAG = /* glsl */`
  precision highp float;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vType;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    vec3 col;
    float a;
    if (vType > 0.5) {
      // bubble: bright rim, faint teal shadow, specular dot
      float rim = smoothstep(0.5, 0.43, r) * smoothstep(0.3, 0.44, r);
      float spec = smoothstep(0.14, 0.0, length(c - vec2(-0.14, 0.16)));
      col = mix(vec3(0.2, 0.55, 0.56), vec3(1.0), clamp(spec + 0.55, 0.0, 1.0));
      a = rim * 0.55 + spec * 0.9;
    } else {
      col = vec3(0.93, 1.0, 0.99);
      a = smoothstep(0.5, 0.0, r) * 0.55;
    }
    gl_FragColor = vec4(col, a * vAlpha * uOpacity);
  }
`;

export class Ocean {
  constructor({ count = 1400 } = {}) {
    this.uniforms = {
      uTime: { value: 0 },
      uDepth: { value: 0 },
      uAspect: { value: 1 },
      uFlash: { value: 0 },
      uMouse: { value: new THREE.Vector2() },
    };
    // The watercolour is soft, so it renders at a fraction of the screen
    // resolution and is upsampled; that keeps 4K and phone GPUs comfortable.
    this.waterTarget = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false });
    this.waterScene = new THREE.Scene();
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: BG_FRAG,
        depthTest: false,
        depthWrite: false,
      }),
    );
    water.frustumCulled = false;
    this.waterScene.add(water);

    this.background = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: {
          tWater: { value: this.waterTarget.texture },
          uTime: this.uniforms.uTime,
          uFlash: this.uniforms.uFlash,
        },
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: COMPOSITE_FRAG,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.background.frustumCulled = false;
    this.background.renderOrder = -100;

    // caustics projected by the key light
    this.causticTarget = new THREE.WebGLRenderTarget(256, 256, { depthBuffer: false });
    this.causticTarget.texture.wrapS = this.causticTarget.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.causticScene = new THREE.Scene();
    this.causticCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.causticUniforms = { uTime: { value: 0 } };
    const cq = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: this.causticUniforms,
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: CAUSTIC_FRAG,
        depthTest: false,
        depthWrite: false,
      }),
    );
    cq.frustumCulled = false;
    this.causticScene.add(cq);

    // marine snow and bubbles
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const size = new Float32Array(count);
    const type = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 16;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 12;
      pos[i * 3 + 2] = -14 + Math.random() * 16;
      seed[i] = Math.random();
      const bubble = Math.random() < 0.22;
      type[i] = bubble ? 1 : 0;
      size[i] = bubble ? 6 + Math.random() * 16 : 2 + Math.random() * 5;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aType', new THREE.BufferAttribute(type, 1));
    this.particleUniforms = {
      uTime: this.uniforms.uTime,
      uPR: { value: 1 },
      uScroll: { value: 0 },
      uOpacity: { value: 1 },
    };
    this.particles = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.particleUniforms,
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
    }));
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 5;
  }

  get causticTexture() { return this.causticTarget.texture; }

  setSize(cssWidth, cssHeight, scale = 0.5) {
    this.waterTarget.setSize(Math.max(2, Math.round(cssWidth * scale)), Math.max(2, Math.round(cssHeight * scale)));
  }

  update(renderer, time) {
    this.uniforms.uTime.value = time;
    this.causticUniforms.uTime.value = time;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.causticTarget);
    renderer.render(this.causticScene, this.causticCamera);
    renderer.setRenderTarget(this.waterTarget);
    renderer.render(this.waterScene, this.causticCamera);
    renderer.setRenderTarget(prev);
  }
}
