import * as THREE from 'three';
import { rng } from '../../core/Context.js';

/**
 * ============================================================================
 *  PETAL DRIFT — falling petals and leaves (US-006)
 * ============================================================================
 *  The golden-field signature from the reference frames: a steady, slow snow
 *  of warm petals drifting through the light around the player.
 *
 *  Built on the same strategy as Particles' FIELDS: a stateless, analytic
 *  field of instanced quads. Each petal's position and attitude is a pure
 *  function of its seed and the clock, wrapped into a box that follows the
 *  camera — so the air is full on frame one (the capture harness allows no
 *  warm-up), the CPU touches nothing per petal, and a whole flight costs one
 *  draw call.
 *
 *  Lighting rides Particles' shared sun/sky uniforms, so the petals take the
 *  same golden-hour key light and cool ground bounce as everything else, plus
 *  a tight forward lobe so they flash when backlit — which is the moment the
 *  reference frames are made of.
 */

const VERT = `
attribute vec4 aSeed;
attribute vec3 aTint;

uniform float uTime;
uniform vec3  uCamXZ;
uniform float uGroundY;
uniform vec3  uWind;
uniform vec3  uBox;
uniform vec3  uSunDir;

varying vec2 vUv;
varying vec3 vTint;
varying vec3 vViewPos;
varying vec3 vNrmV;
varying vec3 vLv;

mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.,0.,0.,  0.,c,-s,  0.,s,c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c,0.,s,  0.,1.,0., -s,0.,c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c,-s,0.,  s,c,0.,  0.,0.,1.); }

void main() {
  vUv = uv;
  float s1 = aSeed.x, s2 = aSeed.y, s3 = aSeed.z, s4 = aSeed.w;

  /* one fall is one wrap of the box height: ~0.35-0.7 m/s, slow and unhurried */
  float h = mix(0.14, uBox.y, fract(s1 - uTime * (0.05 + s2 * 0.045)));

  /* horizontal: per-petal slot, advected by the wind and wrapped */
  vec2 hxz = uBox.xz;
  vec2 w = mod(vec2(s2, s3) + uTime * (0.5 * uWind.xz / hxz), 1.0);
  vec2 p = (w * 2.0 - 1.0) * hxz;
  p += vec2(
      sin(uTime * (0.4 + s3 * 0.7) + s4 * 6.2831),
      cos(uTime * (0.3 + s1 * 0.6) + s4 * 5.9)) * (0.5 + s4);

  vec3 wp = vec3(uCamXZ.x + p.x, uGroundY + h, uCamXZ.y + p.y);

  /* slow tumble on two axes, a quick flap on the third */
  float ph = s4 * 6.2831;
  mat3 R = rotY(ph * 1.7 + uTime * (0.25 + s3 * 0.8))
         * rotX(ph     + uTime * (0.45 + s1 * 0.9) + sin(uTime * (2.4 + s2 * 2.6) + ph) * 0.8)
         * rotZ(ph * 2.3 + uTime * (0.5 + s2 * 1.1));

  float sz = 0.05 + s3 * 0.06;
  vec3 q = R * (position * vec3(sz, sz * 1.5, 0.0));

  vTint = aTint;
  vec4 mv = viewMatrix * vec4(wp + q, 1.0);
  vViewPos = mv.xyz;
  vNrmV = (viewMatrix * vec4(R * vec3(0.0, 0.0, 1.0), 0.0)).xyz;
  vLv = (viewMatrix * vec4(uSunDir, 0.0)).xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = `
uniform sampler2D uMap;
uniform vec3  uSunCol;
uniform vec3  uSkyCol;
uniform vec3  uGroundCol;
uniform float uFade;

varying vec2 vUv;
varying vec3 vTint;
varying vec3 vViewPos;
varying vec3 vNrmV;
varying vec3 vLv;

void main() {
  vec4 tx = texture2D(uMap, vUv);
  float a = tx.a * uFade;
  if (a < 0.02) discard;

  vec3 Nv = normalize(vNrmV);
  if (!gl_FrontFacing) Nv = -Nv;
  vec3 Lv = normalize(vLv);

  float dif = clamp(dot(Nv, Lv) * 0.5 + 0.55, 0.0, 1.2);
  vec3 col = vTint * (uSunCol * dif + uSkyCol * 0.5 + uGroundCol * max(0.0, -Nv.y) * 0.3);

  /* tight forward lobe: petals flash gold when they turn their face away
     from you toward the low sun — the reference money shot */
  vec3 V = normalize(-vViewPos);
  float rim = pow(clamp(dot(V, Lv), 0.0, 1.0), 24.0);
  col += uSunCol * rim * (0.7 + tx.r * 0.5);

  float fog = smoothstep(34.0, 120.0, length(vViewPos));
  col = mix(col, uSkyCol * 0.85 + uSunCol * 0.12, fog);

  gl_FragColor = vec4(col * a, a);   // premultiplied (One / OneMinusSrcAlpha)
}
`;

export class PetalDrift {
  constructor(ctx, shared) {
    this.ctx = ctx;
    this._t = 0;

    const q = ctx.quality || {};
    const budget = Math.max(600, q.particleBudget || 6000);
    const COUNT = Math.max(30, Math.min(64, Math.round(budget * 0.01)));
    this.count = COUNT;

    const rand = rng((ctx.seed ^ 0x9e3779b9) >>> 0);

    /* one quad, per-instance seed + tint */
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(
      [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(
      [0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);

    const seeds = new Float32Array(COUNT * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));

    /* two petal families — the brief's exact palette: gold and pale */
    const GOLD = new THREE.Color(0xE8C97A);
    const PALE = new THREE.Color(0xF2E6C9);
    const tints = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      const c = rand() < 0.58 ? GOLD : PALE;
      const b = 0.88 + rand() * 0.30;
      tints[i * 3]     = Math.min(1, c.r * b);
      tints[i * 3 + 1] = Math.min(1, c.g * b);
      tints[i * 3 + 2] = Math.min(1, c.b * b);
    }
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
    geo.instanceCount = COUNT;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    this.map = makePetalTexture(96, rand);

    this.uniforms = {
      uTime: { value: 0 },
      uCamXZ: { value: new THREE.Vector3() },
      uGroundY: { value: 0 },
      uWind: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(16, 7.5, 16) },
      uFade: { value: 0 },
      uMap: { value: this.map },
      /* shared lighting — Particles.lateUpdate() fills these every frame */
      uSunDir: shared.uSunDir,
      uSunCol: shared.uSunCol,
      uSkyCol: shared.uSkyCol,
      uGroundCol: shared.uGroundCol,
    };

    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      /* premultiplied "over", same convention as every other particle layer */
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });

    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3015;
    mesh.name = 'petalDrift';
    mesh.matrixAutoUpdate = false;
    mesh.userData.rsNoAerial = true;      // we apply the haze ourselves, in-shader
    mesh.userData.rsNoGroundFX = true;
    this.mat.userData.rsNoAerial = true;
    this.mat.userData.rsNoGroundFX = true;
    this.mesh = mesh;
    ctx.scene.add(mesh);

    /* box floor starts at the eye-line estimate so frame one is already right */
    this._gy = ctx.camera.position.y - 1.8;
  }

  update(dt) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this._t += dt;
    const ctx = this.ctx;
    const env = ctx.env || {};
    const cam = ctx.camera;
    const u = this.uniforms;

    let gy;
    const w = ctx.world;
    if (w && w.ready && w.getHeight) {
      try { gy = w.getHeight(cam.position.x, cam.position.z); } catch (e) { gy = null; }
    }
    if (gy == null || !isFinite(gy)) gy = cam.position.y - 1.8;
    /* ease the datum so climbing a slope never pops the whole field vertically */
    this._gy += (gy - this._gy) * Math.min(1, dt * 3);

    u.uTime.value = this._t;
    u.uCamXZ.value.set(cam.position.x, cam.position.z);
    u.uGroundY.value = this._gy;
    const wv = env.windVector;
    u.uWind.value.set(wv ? wv.x : 0, 0, wv ? wv.z : 0);

    /* present at golden hour and full day, gone in rain and deep night */
    const day = env.daylight == null ? 1 : clamp01(env.daylight);
    const rain = clamp01(env.rainIntensity || 0);
    u.uFade.value = smoothstep(0.02, 0.3, day) * (1 - clamp01(rain * 1.5));
  }

  dispose() {
    const ctx = this.ctx;
    if (this.mesh) { ctx.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
    if (this.mat) this.mat.dispose();
    if (this.map) this.map.dispose();
  }
}

/* -------------------------------------------------------------------------- */

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
function smoothstep(a, b, x) {
  const t = clamp01((x - a) / Math.max(b - a, 1e-6));
  return t * t * (3 - 2 * t);
}

/**
 * Pointed-ellipse petal: white RGB with a faint midrib and tip light, alpha
 * carrying the shape — so per-instance tinting stays clean. Generated at boot,
 * no files anywhere in this project.
 */
function makePetalTexture(size, rand) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size - 0.5;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size - 0.5;
      const tip = Math.pow(Math.max(1e-4, 1 - 2 * Math.abs(v)), 0.62);
      const halfW = 0.47 * tip + 0.015;
      const e = Math.abs(u) / halfW;                     // 0 midrib .. >1 edge
      let a = (1 - smoothstep(0.5, 1.0, e)) * (0.92 + rand() * 0.16);
      const vein = Math.exp(-Math.pow(u / 0.05, 2)) * (1 - smoothstep(0.3, 1.1, Math.abs(v) * 2));
      let sh = 1.0 - vein * 0.22 + (1 - Math.abs(v) * 2) * 0.08;
      sh = Math.max(0, Math.min(1, sh));
      const o = (y * size + x) * 4;
      data[o] = Math.round(sh * 255);
      data[o + 1] = Math.round(sh * 255);
      data[o + 2] = Math.round(sh * 255);
      data[o + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;   // shape + shading data, not colour
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
