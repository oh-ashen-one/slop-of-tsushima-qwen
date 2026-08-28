/**
 * RoninRig — US-007 hero swap.
 *
 * Loads the rigged ronin at public/assets/ronin.glb (1.78 m, 24-bone
 * Mixamo-convention skeleton; clips: idle / walk / mount / ride) and exposes
 * it as a parent-ready THREE.Group. It supersedes the procedural cowboy in
 * HumanRig.js / SkinBuilder.js once Player parents root at its character
 * pivot; the movement code in Player.js stays untouched and keeps driving the
 * same transform it always drove on the cowboy.
 *
 * Wiring for Player.js — smallest possible diff, lands next iteration because
 * this agent's snapshot did not include the lines of Player.js (101 KB):
 *   1. import { RoninRig } from './rig/RoninRig.js';
 *   2. Player.init(): this.ronin = new RoninRig(ctx); await this.ronin.load();
 *      add this.ronin.root at the character pivot, and stop adding the cowboy
 *      body mesh (keep any bone sockets Weapon still references).
 *   3. Wherever Player writes the cowboy transform per frame, write it to
 *      this.ronin.root instead and call this.ronin.update(dt).
 *
 * Scope note: US-007 is render + position only. The clip table built in
 * _absorb() is the seam for US-008, which installs the AnimationMixer and
 * the idle / walk / mount / ride crossfade state machine on top of it.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Hero asset, staged under public/ so it ships at the site root. */
export const RONIN_URL = '/assets/ronin.glb';

/** Canonical hero height in metres (see assets/ASSET-MANIFEST.md). */
export const RONIN_HEIGHT = 1.78;

/** Orientation fix-up if the pipeline exported a non-standard facing: after
 *  wiring, check player_third_person once and flip this (Math.PI / 2 etc.)
 *  if the hero looks turned away from the camera. */
const FACING_YAW = 0;

/** Material slots carrying textures that need explicit release in dispose(). */
const TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];

/** Module-scratch, kept out of the per-instance hot path. */
const _box = new THREE.Box3();
const _size = new THREE.Vector3();

export class RoninRig {
  constructor(ctx) {
    this.ctx = ctx;

    /** Parent this at the player's character pivot. Local origin is between
     *  the feet on the body midline, +Y up; rotate .y with the player yaw. */
    this.root = new THREE.Group();
    this.root.name = 'ronin';

    /** The loaded GLB scene, normalised and centred (child of root). */
    this.scene = null;

    /** Normalised clip table built in _absorb(): lower-cased track name ->
     *  AnimationClip. Expected keys per the manifest: idle, walk, mount, ride;
     *  unnamed tracks fall back to clip_N. */
    this.clips = {};

    /** US-008 — one mixer over the GLB scene; null until load (forever if it
     *  failed) so update() can no-op cheaply. */
    this.mixer = null;

    /** US-008 — name -> AnimationAction for each canonical clip that exists
     *  (idle / walk / mount / ride), all reset to time 0, weight 0. */
    this.actions = {};

    // US-008 state-machine scratch (private to the rig).
    this._cur = null;            // action last targeted by _setAction (dominant)
    this._moving = false;        // hysteresised "on foot and moving" flag
    this._mounted = false;       // last frame's mount reading (edge detection)
    this._mountFinished = false; // 'finished' fired for the one-shot since start
    this._mountAt = 0;           // mixer.time when the one-shot 'mount' started
    this._lastPos = null;        // anchor for the position-delta speed fallback

    this.loaded = false;
    this.failed = false;
  }

  /** Fetch + normalise the GLB. Always resolves, never rejects: a missing or
   *  corrupt asset sets failed=true and root stays empty instead of throwing
   *  through Player.init() or logging to the console (zero-error law). */
  load() {
    if (this.pending) return this.pending;
    this.pending = new Promise((resolve) => {
      const loader = new GLTFLoader();
      loader.setCrossOrigin('anonymous');
      loader.load(
        RONIN_URL,
        (gltf) => {
          try { this._absorb(gltf); } catch (e) { this.failed = true; }
          resolve();
        },
        undefined,
        () => { this.failed = true; resolve(); },
      );
    });
    return this.pending;
  }

  /** Scale to the canonical height, recenter onto the foot midline, opt into
   *  shadows. After this runs, root is parent-ready and render-safe. */
  _absorb(gltf) {
    const scene = gltf.scene;

    // Unit-proof the height: whatever scale the pipeline exported, the hero
    // stands exactly RONIN_HEIGHT metres tall so CameraRig framing stays
    // honest and the pampas grass reads waist-high on him.
    scene.updateMatrixWorld(true);
    _box.setFromObject(scene);
    if (isFinite(_box.min.x) && isFinite(_box.max.y)) {
      _box.getSize(_size);
      if (_size.y > 1e-3) scene.scale.multiplyScalar(RONIN_HEIGHT / _size.y);
    }

    // Recenter: origin between the feet on the body midline, so a .y
    // rotation spins about the spine exactly like the procedural rig did.
    scene.updateMatrixWorld(true);
    _box.setFromObject(scene);
    if (isFinite(_box.min.x) && isFinite(_box.max.z)) {
      scene.position.set(
        -(_box.min.x + _box.max.x) / 2,
        -_box.min.y,
        -(_box.min.z + _box.max.z) / 2,
      );
    }

    scene.rotation.y = FACING_YAW;
    this.root.add(scene);
    this.scene = scene;

    // The character must throw the long golden-hour shadow like everything
    // else in the field; requestShadowCaster is the lighting contract.
    scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const L = this.ctx && typeof this.ctx.get === 'function' ? this.ctx.get('lighting') : null;
    if (L && typeof L.requestShadowCaster === 'function') L.requestShadowCaster(this.root);

    // Clip table for US-008. Manifest names arrive lower-case; the indexed
    // fallback keeps unnamed tracks reachable without inventing semantics.
    gltf.animations.forEach((clip, i) => {
      const k = String(clip.name || '').trim().toLowerCase();
      this.clips[k !== '' && this.clips[k] === undefined ? k : ('clip_' + i)] = clip;
    });

    /* US-008 — one mixer over the normalised scene, an action per canonical
     * clip. The unnamed-clip fallback (clip_N) keeps a badly-named export from
     * leaving the hero T-posed; canonical names win when present. */
    this.mixer = new THREE.AnimationMixer(scene);
    const table = [
      ['idle', this.clips.idle || this.clips.clip_0],
      ['walk', this.clips.walk || this.clips.clip_1],
      ['mount', this.clips.mount || null],
      ['ride', this.clips.ride || this.clips.clip_3],
    ];
    for (let i = 0; i < table.length; i++) {
      const clip = table[i][1];
      if (!clip) continue;
      const a = this.mixer.clipAction(clip);
      a.reset(); // time 0, weight 0 — update() brings each in via _setAction
      this.actions[table[i][0]] = a;
    }

    const mountA = this.actions.mount;
    if (mountA) {
      // one-shot: play once, hold its final frame until 'ride' fades in.
      mountA.setLoop(THREE.LoopOnce, 1);
      mountA.clampWhenFinished = true;
      this.mixer.addEventListener('finished', (e) => {
        if (e.action === mountA) this._mountFinished = true;
      });
    }

    // At load the hero should already be breathing, not in a T-pose.
    if (this.actions.idle) {
      this._cur = this.actions.idle;
      this.actions.idle.reset().play();
    }

    this.loaded = true;
  }

  /** Per-frame hook — Player.js calls it after writing the hero transform.
   *  Reads the shared movement state (CONTRACTS §3: ctx.player) and drives
   *  the AnimationMixer: idle / walk on foot, 'mount' one-shot into 'ride'
   *  when mounted. A no-op until the asset is loaded (and forever if it
   *  failed), so an early frame can never throw. */
  update(dt) {
    if (!this.loaded || !this.mixer) return;

    // Clamp: a tab-restore or dropped frame must not jump the clips.
    const d = (typeof dt === 'number' && isFinite(dt)) ? Math.min(Math.max(dt, 0), 0.1) : (1 / 60);

    const P = this.ctx && this.ctx.player;
    if (!P) { this.mixer.update(d); return; }

    // Mounted? (ctx.player.horse object present, or a mode string that says
    // ride — the frozen contract fields, read defensively.)
    const mounted = !!P.horse || (typeof P.mode === 'string' && P.mode.indexOf('ride') !== -1);

    // On foot, moving? ctx.player.speed01 when finite (normalised 0..1), else
    // a per-frame position delta in m/s. Hysteresis (MOVE_ON / MOVE_OFF) keeps
    // the hero from flickering between idle and walk at a standstill.
    if (!mounted) {
      let s = (typeof P.speed01 === 'number' && isFinite(P.speed01)) ? P.speed01 : NaN;
      if (!isFinite(s) && P.position && typeof P.position.distanceToSquared === 'function') {
        if (this._lastPos) {
          s = Math.sqrt(P.position.distanceToSquared(this._lastPos)) / Math.max(d, 1e-4);
          this._lastPos.copy(P.position);
        } else {
          this._lastPos = P.position.clone();
        }
      } else if (isFinite(s)) {
        this._lastPos = null; // rearm the fallback if it was used before
      }
      if (isFinite(s)) this._moving = s > (this._moving ? MOVE_OFF : MOVE_ON);
    } else {
      this._lastPos = null;   // rearm the fallback for the next on-foot stretch
    }

    /* Pick this frame's dominant clip. */
    const hasRide = !!this.actions.ride;
    let target;
    if (mounted) {
      const mountA = this.actions.mount;
      const holdingMount = !!(mountA && this._cur === mountA)
        && !(this._mountFinished || (this.mixer.time - this._mountAt) > MOUNT_FALLBACK_S);
      if (!hasRide) {
        target = this.actions.idle || null;  // degenerate export: no ride clip
      } else if (holdingMount) {
        target = mountA;                     // one-shot still playing: hold it
      } else if (!this._mounted) {           // rising edge (was on foot last frame)
        this._mounted = true;
        target = mountA || this.actions.ride; // bridge with the one-shot, or ride straight in
      } else {
        target = this.actions.ride;          // steady mounted (covers the mount->ride handoff)
      }
    } else {
      this._mounted = false;                 // falling edge: back to on-foot states
      target = this._moving ? (this.actions.walk || this.actions.idle) : this.actions.idle;
    }

    if (target && target !== this._cur) {
      if (target === this.actions.mount) this._mountFinished = false; // (re)start the one-shot
      this._setAction(target);
      if (target === this.actions.mount) this._mountAt = this.mixer.time;
    }

    this.mixer.update(d);
  }

  /** Crossfade action `a` to dominance on the shared mixer clock: ramp its
   * weight 0 -> 1 while the outgoing one ramps to 0 over FADE_S, so total
   * weight stays ~1 and no pose pops. Documented mixer API only. */
  _setAction(a) {
    if (!a || this._cur === a) return;
    const from = this._cur;
    a.reset();      // restart the loop phase, clear any stale fade schedule
    a.fadeIn(FADE_S);
    a.play();       // fadeIn schedules the ramp; play activates the action
    if (from) from.fadeOut(FADE_S);
    this._cur = a;
  }

  /** Release the GLB's resources + animation state; call from Player.dispose(). */
  dispose() {
    if (!this.scene) return;
    if (this.mixer && this.scene) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.scene);
    }
    this.mixer = null;
    this.scene.traverse((o) => {
      if (!o.isMesh) return;
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (let i = 0; i < mats.length; i++) {
        const m = mats[i];
        for (let j = 0; j < TEX_SLOTS.length; j++) {
          const t = m[TEX_SLOTS[j]];
          if (t && t.dispose) t.dispose();
        }
        m.dispose();
      }
    });
    this.root.remove(this.scene);
    this.scene = null;
  }
}
