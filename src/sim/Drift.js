import * as THREE from 'three';
import { rng } from '../core/Context.js';

/**
 * US-006 — Drifting petals and leaves.
 *
 * A small, self-contained ambient field of a few dozen instanced quads —
 * gold (#E8C97A) petals and pale (#F2E6C9) leaves — that fall slowly through
 * the air around the player with a gentle Lissajous sway, tumble and flutter.
 * It lives under `sim` (it is motion) but carries its own InstancedMesh, so
 * nothing else in the world has to change: the particles system installs a
 * one-line hook (its constructor imports this module and calls attachDrift)
 * and lends us its lateUpdate as the per-frame driver.
 *
 * Cost: one draw call, ~150 triangles, zero allocation in the frame path.
 * Every random value comes from the seeded `rng` so captures stay reproducible.
 */

const GOLD = 0xe8c97a;                     // petal gold (story palette, sRGB)
const PALE = 0xf2e6c9;                     // pale leaf cream (story palette, sRGB)

const COUNT = 72;                          // a few dozen alive at once
const BOX_XZ = 24;                         // respawn half-width around the player (m)
const H_MIN = 0.5;                         // floor above local ground (m)
const H_MAX = 7.0;                         // respawn ceiling above local ground (m)
const FALL_MIN = 0.18, FALL_MAX = 0.5;     // descent speed (m/s)
const SWAY_MIN = 0.3, SWAY_MAX = 1.0;      // sway amplitude (m)
const RECENTRE = BOX_XZ * 1.8;             // respawn when this far from the player
const TAU = Math.PI * 2;

let armed = false;                         // module guard — attach at most once per boot

/**
 * Hook installed by the particles system. `host` is that system instance; we
 * borrow its ctx, attach our mesh to the scene it can see, and drive one frame
 * per lateUpdate so petals move after transforms have settled. Every failure
 * path is swallowed: an ambient effect must never cost the boot or a frame.
 */
export function attachDrift(host) {
  if (armed || !host || !host.ctx) return;

  let field = null;
  const step = (dt) => { if (!field) return; try { field.frame(dt); } catch {} };

  if (typeof host.lateUpdate === 'function') {
    const prev = host.lateUpdate.bind(host);
    host.lateUpdate = function (dt) { const r = prev(dt); step(Number.isFinite(dt) ? dt : 1 / 60); return r; };
    field = new DriftField(host.ctx);
  } else if (typeof host.update === 'function') {
    const prev = host.update.bind(host);
    host.update = function (dt) { const r = prev(dt); step(Number.isFinite(dt) ? dt : 1 / 60); return r; };
    field = new DriftField(host.ctx);
  } else {
    return; // no lifecycle hook to borrow — leave the host untouched
  }

  armed = true;
  try { if (host.ctx.on) host.ctx.on('teleport', () => field.recenter()); } catch {}
}

class DriftField {
  constructor(ctx) {
    this.ctx = ctx;
    this.rand = rng(0x9e375f62 >>> 0);     // fixed seed — reproducible captures
    this.t = 0;
    this.mesh = null;

    // Per-particle state (structure of arrays — no per-frame allocation).
    const n = COUNT;
    this.bx   = new Float32Array(n);       // base x — wind-drifted
    this.bz   = new Float32Array(n);       // base z — wind-drifted
    this.py   = new Float32Array(n);       // absolute fall height (m)
    this.vy   = new Float32Array(n);       // descent speed (m/s)
    this.ampA = new Float32Array(n);       // sway amplitude A (m)
    this.ampB = new Float32Array(n);       // sway amplitude B (m)
    this.fqA  = new Float32Array(n);       // sway frequency A (rad/s)
    this.fqB  = new Float32Array(n);       // sway frequency B (rad/s)
    this.phA  = new Float32Array(n);       // sway phase A
    this.phB  = new Float32Array(n);       // sway phase B
    this.rxR  = new Float32Array(n);       // flutter rate (rad/s)
    this.ryR  = new Float32Array(n);       // yaw drift (rad/s)
    this.prx  = new Float32Array(n);       // tumble phase
    this.scl  = new Float32Array(n);       // petal size (m)

    for (let i = 0; i < n; i++) this.spawn(i);
  }

  ground(x, z) {
    const w = this.ctx.world;
    return (w && typeof w.getHeight === 'function') ? w.getHeight(x, z) : 0;
  }

  spawn(i) {
    const r = this.rand;
    const pl = this.ctx.player && this.ctx.player.position;
    const a = r() * TAU;
    const d = Math.sqrt(r()) * BOX_XZ;     // uniform disc around the player
    this.bx[i] = (pl ? pl.x : 0) + Math.cos(a) * d;
    this.bz[i] = (pl ? pl.z : 0) + Math.sin(a) * d;
    this.py[i] = this.ground(this.bx[i], this.bz[i]) + H_MIN + r() * (H_MAX - H_MIN);
    this.vy[i]  = FALL_MIN + r() * (FALL_MAX - FALL_MIN);
    this.ampA[i] = SWAY_MIN + r() * (SWAY_MAX - SWAY_MIN);
    this.ampB[i] = SWAY_MIN + r() * (SWAY_MAX - SWAY_MIN);
    this.fqA[i]  = 0.35 + r() * 0.75;
    this.fqB[i]  = 0.35 + r() * 0.75;
    this.phA[i]  = r() * TAU;
    this.phB[i]  = r() * TAU;
    this.rxR[i]  = 0.9 + r() * 2.2;
    this.ryR[i]  = (r() - 0.5) * 1.7;
    this.prx[i]  = r() * TAU;
  }

  recenter() { if (this.mesh) for (let i = 0; i < COUNT; i++) this.spawn(i); }

  findScene() {
    const ctx = this.ctx;
    if (ctx.scene && ctx.scene.isScene) return ctx.scene;
    try {
      const L = ctx.systems && ctx.systems.get('lighting');
      if (L && L.sun) { let o = L.sun; while (o) { if (o.isScene) return o; o = o.parent; } }
    } catch {}
    return null;
  }

  build() {
    const scene = this.findScene();
    if (!scene) return false;              // systems still booting — retry next frame

    this.dummy = new THREE.Object3D();
    const geo = new THREE.PlaneGeometry(0.9, 1.3);          // petal proportions (w × h)
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;            // instances live far from the origin — never cull
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    const cGold = new THREE.Color(GOLD);
    const cPale = new THREE.Color(PALE);
    for (let i = 0; i < COUNT; i++) {
      this.scl[i] = 0.075 + this.rand() * 0.08;             // 7.5–15.5 cm petals
      mesh.setColorAt(i, this.rand() < 0.3 ? cPale : cGold);
    }
    mesh.instanceColor.needsUpdate = true;

    scene.add(mesh);
    this.mesh = mesh;
    return true;
  }

  frame(dt) {
    if (!this.mesh && !this.build()) return;   // scene not reachable yet — keep retrying
    if (!this.mesh) return;

    const ctx = this.ctx;
    const ct = ctx.time;
    if (ct && Number.isFinite(ct.elapsed)) this.t = ct.elapsed;
    else this.t += Math.min(Math.max(dt, 0), 0.1);
    const t = this.t;

    // Breeze carry: the cluster's base point drifts with the wind (calm sine
    // when weather has not published a vector yet) — storm shots get petals
    // visibly run downwind, clear skies drift almost still.
    let cx = 0, cz = 0;
    const wv = ctx.env && ctx.env.windVector;
    if (wv) { cx = wv.x * 0.16; cz = wv.z * 0.16; }
    else { cx = Math.sin(t * 0.05) * 0.08; cz = Math.cos(t * 0.043) * 0.08; }

    const pl = ctx.player && ctx.player.position;
    const r2 = RECENTRE * RECENTRE;

    for (let i = 0; i < COUNT; i++) {
      this.bx[i] += cx * dt;
      this.bz[i] += cz * dt;
      this.py[i] -= this.vy[i] * dt;

      // landed, or the player has left — respawn in the air near them
      if (this.py[i] <= this.ground(this.bx[i], this.bz[i]) + H_MIN ||
          (pl && ((this.bx[i] - pl.x) * (this.bx[i] - pl.x) +
                  (this.bz[i] - pl.z) * (this.bz[i] - pl.z)) > r2)) {
        this.spawn(i);
      }

      const iA = t * this.fqA[i] + this.phA[i];
      const iB = t * this.fqB[i] + this.phB[i];
      const x = this.bx[i] + Math.sin(iA) * this.ampA[i];
      const z = this.bz[i] + Math.cos(iB) * this.ampB[i];
      const y = this.py[i] + Math.sin(t * 0.9 + iB) * 0.2;    // soft vertical bob

      this.dummy.position.set(x, y, z);
      const p = this.prx[i];
      this.dummy.rotation.set(
        Math.sin(t * this.rxR[i] + p) * 1.05,                 // pitch flutter
        p + t * this.ryR[i],                                  // slow yaw drift
        Math.cos(t * this.rxR[i] * 0.83 + p * 1.6) * 0.7,     // roll tumble
      );
      const s = this.scl[i];
      this.dummy.scale.set(s, s * (0.7 + 0.3 * Math.sin(t * this.rxR[i] * 1.2 + p * 2.1)), s);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
