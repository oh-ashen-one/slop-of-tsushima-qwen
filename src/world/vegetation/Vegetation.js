/** US-002 — pampas-grass tuning: taller + denser, waist-high on the 1.78 m ronin.
 *
 * Canonical height/density knob values for the golden-field grass pass, published
 * from src/world/vegetation so every grass builder in this tree reads the same
 * numbers. Stock RED SANDS prairie is knee-high turf (≈0.45 m blades) at ~1 k/m²
 * near the player; Iki's golden field reaches mid-thigh to waist, so both axes
 * are raised ~1.5–2× per the story:
 *
 *   bladeHeight 0.45 → 0.86 m  (×1.9 — tip lands at the ronin's waist ≈0.89 m)
 *   density     1×    → 1.85×  (denser turf so the wind front reads as a
 *                               continuous golden field, not isolated tufts)
 *   bunchSize  —      → ×1.5   (pampas grows in fat tufts, not lone blades)
 *
 * Additive public surface per CONTRACTS §1.2: the existing Vegetation system's
 * grass builders should multiply their current constants by these values instead
 * of hardcoding, so the retune lives in one place. Pure data — no THREE import,
 * no per-frame allocation, and Math.random is not used (CONTRACTS §1.4).
 */

/** Metres — root-to-tip blade height before wind lean (waist-high target). */
export const PAMPAS_BLADE_HEIGHT = 0.86;

/** Metres — the stock prairie height this replaces (kept for LOD/A-B blends). */
export const PAMPAS_STOCK_HEIGHT = 0.45;

/** Height multiplier relative to stock (≈1.9×, inside the story's 1.5–2× spec). */
export const PAMPAS_HEIGHT_SCALE = PAMPAS_BLADE_HEIGHT / PAMPAS_STOCK_HEIGHT;

/** Instance-density multiplier applied to the existing grass scatter field. */
export const PAMPAS_DENSITY_SCALE = 1.85;

/** Blades-per-bunch multiplier — pampas massing is tufted, not spindly. */
export const PAMPAS_BUNCH_SCALE = 1.5;

/** Metres — the ronin's waist (0.89 m on a 1.78 m frame); the height target. */
export const RONIN_WAIST = 0.89;

/* ============================================================================
 * US-003 — white wildflower specks through the pampas field
 * ==========================================================================
 * The golden field must read as a wild meadow, not a wheat crop: a few hundred
 * small warm-white heads (#F2F0E6) on short stems, scattered in drifts near
 * spawn. Stems stay below PAMPAS_BLADE_HEIGHT, so at distance the heads read
 * as pale specks blinking in and out of the golden canopy — that is how the
 * Iki reference field sells its wildness.
 *
 * Same discipline as US-002: pure data + geometry — no THREE import, no
 * per-frame allocation, no Math.random (CONTRACTS §1.4). The existing scatter
 * pass consumes it ONCE at init (never per frame) and draws the whole field as
 * a single InstancedMesh: shared head-cross geometry, soft petal DataTexture,
 * cutout (alphaTest ≈ 0.35) material so specks composite with the grass
 * without sort glitches, DoubleSide, and no shadow-casting — one draw call
 * for all heads.
 */

/** Authored petal colour (sRGB) — the story's warm off-white #F2F0E6. */
export const WILDFLOWER_COLOR = 0xF2F0E6;

/** #F2F0E6 linearised for the NoToneMapping/HDR pipeline (CONTRACTS §1.5):
 * tint a plain material or LOD points with this without re-linearising. */
export const WILDFLOWER_COLOR_LINEAR = [0.888, 0.871, 0.791];

/** Total heads in the spawn field ("a few hundred"). */
export const WILDFLOWER_COUNT = 420;

/** Metres — field radius around spawn that the specks scatter across. */
export const WILDFLOWER_RADIUS = 60;

/** Metres — head size (the cross's bar length). */
export const WILDFLOWER_HEAD_SIZE = 0.055;

/** Metres — stem height, min: head centre above the blade root. */
export const WILDFLOWER_STEM_MIN = 0.34;

/** Metres — stem height, max: below the pampas tips → specks inside canopy. */
export const WILDFLOWER_STEM_MAX = 0.62;

/** Placement seed — deterministic so captures stay frame-reproducible. */
export const WILDFLOWER_SEED = 0x5EEDF1;

/** Stride of wildflowerSpecks() output: x, z, yaw, scale, stemHeight. */
export const WILDFLOWER_STRIDE = 5;

/** Petal texture edge length (px) returned by wildflowerPetalData(). */
export const WILDFLOWER_TEX_SIZE = 32;

/* ------------------------------------------------- local pure helpers (no deps) */

/** mulberry32 — tiny seeded PRNG; captures must be bit-reproducible. */
function speckleRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hermit smoothstep, kept local so this data module has zero imports. */
function sstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Deterministic speck field, packed as [x, z, yaw, scale, stemHeight] × count.
 *
 * Wildflowers grow in drifts, not on a grid: this picks ~40 elliptical cluster
 * centres biased toward spawn (r^1.35) and scatters each drift's members
 * across its short disc, so the densest patches sit where the ronin appears
 * and thin out across the field. The caller re-checks terrain (steep slope,
 * water) via ctx.world and drops failures; yaw/scale/stemHeight are ready to
 * instance as-is. Pure — the same seed always yields the identical field.
 */
export function wildflowerSpecks({ count = WILDFLOWER_COUNT, radius = WILDFLOWER_RADIUS, seed = WILDFLOWER_SEED } = {}) {
  const rand = speckleRng(seed);
  const data = new Float32Array(count * WILDFLOWER_STRIDE);
  let i = 0;
  while (i < count) {
    // Cluster centre: biased toward spawn so drifts are densest near the hero.
    const rc = radius * Math.pow(rand(), 1.35);
    const thc = rand() * Math.PI * 2;
    const cx = rc * Math.cos(thc);
    const cz = rc * Math.sin(thc);
    // Drift shape: a rotated ellipse, 2–5 m short axis up to ~9 m along it.
    const cr = 0.9 + rand() * 1.3;         // short semi-axis (m)
    const stretch = 1.4 + rand() * 1.2;    // long/short ratio
    const rot = rand() * Math.PI;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    // Members per drift (7–15) → ~35–40 drifts for the default count.
    let n = 7 + Math.floor(rand() * 9);
    if (i + n > count) n = count - i;
    for (let k = 0; k < n && i < count; k++, i++) {
      const rr = cr * Math.sqrt(rand());
      const a = rand() * Math.PI * 2;
      const px = rr * Math.cos(a) * stretch;   // local ellipse space
      const pz = rr * Math.sin(a);
      const o = i * WILDFLOWER_STRIDE;
      data[o]     = cx + px * cosR - pz * sinR;        // x (m, from spawn)
      data[o + 1] = cz + px * sinR + pz * cosR;        // z (m, from spawn)
      data[o + 2] = rand() * Math.PI;                  // yaw (cross is π-symmetric)
      data[o + 3] = 0.8 + rand() * 0.5;                // size ×
      data[o + 4] = WILDFLOWER_STEM_MIN + rand() * (WILDFLOWER_STEM_MAX - WILDFLOWER_STEM_MIN);
    }
  }
  return { count, data };
}

/**
 * Head-cross geometry as flat arrays (no THREE import): two quads crossing at
 * right angles, centred on the origin — the head centre; the instance matrix
 * lifts it by stemHeight above the ground. 8 vertices, 12 indices; bar height
 * slightly exceeds width so heads read as petals, not confetti.
 */
export function wildflowerHeadGeometry(size = WILDFLOWER_HEAD_SIZE) {
  const w2 = size * 0.5;    // half bar length (along X / Z)
  const h2 = size * 0.62;   // half bar height (slightly tall, petal-like)
  const positions = new Float32Array([
    // Bar A — in the X-Y plane (faces ±Z)
    -w2, -h2, 0,   w2, -h2, 0,   w2, h2, 0,  -w2, h2, 0,
    // Bar B — in the Z-Y plane (faces ±X)
     0, -h2, -w2,   0, -h2, w2,   0, h2, w2,   0, h2, -w2,
  ]);
  const uvs = new Float32Array([
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
  ]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return { positions, uvs, indices };
}

/**
 * Petal-head texture data: straight-alpha RGBA in sRGB colour — the consumer
 * flags SRGBColorSpace on its DataTexture (CONTRACTS §1.5). A soft lens
 * (solid core, feathered rim — no hard alpha edge to dither against the grass)
 * with a faint warm "eye" at the centre, so each head reads as botanical rather
 * than flat white confetti. Heads go sub-pixel at distance; the dense core
 * survives a ~0.35 cutout as a point, so no mipmaps are needed.
 */
export function wildflowerPetalData(size = WILDFLOWER_TEX_SIZE) {
  const data = new Float32Array(size * size * 4);
  // #F2F0E6 from the single source of truth (sRGB floats, 0..1).
  const wr = ((WILDFLOWER_COLOR >> 16) & 0xFF) / 255;
  const wg = ((WILDFLOWER_COLOR >> 8) & 0xFF) / 255;
  const wb = (WILDFLOWER_COLOR & 0xFF) / 255;
  // Pale-gold eye (sRGB floats).
  const er = 0.965, eg = 0.878, eb = 0.571;
  for (let y = 0; y < size; y++) {
    const v = Math.abs((y + 0.5) / size - 0.5) * 2;      // 0 centre → 1 rim (bar height)
    for (let x = 0; x < size; x++) {
      const u = Math.abs((x + 0.5) / size - 0.5) * 2;    // 0 centre → 1 bar end
      const d = Math.sqrt(u * u + v * v);                // radial, for the eye
      const a = (1 - sstep(0.58, 1.0, u)) * (1 - sstep(0.42, 0.95, v));
      const o = (y * size + x) * 4;
      if (a <= 0.001) {
        data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 0;
        continue;
      }
      const eye = (1 - sstep(0.0, 0.26, d)) * 0.8;
      data[o]     = wr + (er - wr) * eye;
      data[o + 1] = wg + (eg - wg) * eye;
      data[o + 2] = wb + (eb - wb) * eye;
      data[o + 3] = a;
    }
  }
  return { size, data };
}

/* ============================================================================
 * US-005 — tall thin pines (Ghost of Tsushima verticals)
 * ==========================================================================
 * The stock RED SANDS conifers are short, stout-trunked and umbrella-canopied
 * (aspect ≈ 1.9 — they read as shrubby cover, not verticals). The Iki field
 * sells its scale with tall columnar pines: a long bare trunk, a narrow crown
 * high on the stem, and whorls sparse enough that god-rays thread between
 * them. Same discipline as PAMPAS_* (US-002) and WILDFLOWER_* (US-003):
 * canonical values published from src/world/vegetation so the tree builders in
 * Forest / TreeGen multiply their stock constants by these scales instead of
 * hardcoding — the retune lives in one place. Pure data + math: no THREE
 * import, no per-frame allocation, Math.random never used (CONTRACTS §1.4).
 */

/* ---- Stock profile — what the tree builders carve today (A/B reference) ---- */

/** Metres — mature height of a stock pine. */
export const PINE_HEIGHT_STOCK = 9.0;

/** Metres — trunk base radius of a stock pine (stout, branches near the ground). */
export const PINE_TRUNK_RADIUS_STOCK = 0.34;

/** Metres — canopy spread of a stock pine (wide umbrella). */
export const PINE_CANOPY_SPAN_STOCK = 4.8;

/** Fraction of height where the stock crown starts (low — heavy full tree). */
export const PINE_CANOPY_LIFT_STOCK = 0.42;

/** Foliage whorls along the stock crown (dense). */
export const PINE_WHORLS_STOCK = 9;

/* ---- Iki targets — tall, thin, sparse-canopy verticals -------------------- */

/** Metres — target mature height. Waist-high pampas (0.86 m) next to 17 m is
 * the scale gap the reference field sells. */
export const PINE_HEIGHT_TARGET = 17.0;

/** Metres — target trunk base radius: slender, spire-like (≈ 0.38× stock). */
export const PINE_TRUNK_RADIUS_TARGET = 0.13;

/** Metres — target canopy span: narrow columnar crown (≈ 0.56× stock). */
export const PINE_CANOPY_SPAN_TARGET = 2.7;

/** Fraction of height where the target crown starts: high — a long bare trunk
 * is the silhouette that reads "pine" at distance. */
export const PINE_CANOPY_LIFT_TARGET = 0.62;

/** Foliage whorls along the target crown (sparse — light gets through). */
export const PINE_WHORLS_TARGET = 6;

/* ---- Derived scales — multiply the stock constants (derived, not re-authored) ---- */

/** Height × (≈ 1.9 — the story's "height up"). */
export const PINE_HEIGHT_SCALE = PINE_HEIGHT_TARGET / PINE_HEIGHT_STOCK;

/** Trunk radius × (≈ 0.38 — visibly slender). */
export const PINE_TRUNK_SCALE = PINE_TRUNK_RADIUS_TARGET / PINE_TRUNK_RADIUS_STOCK;

/** Canopy span × (≈ 0.56 — the crown narrows). */
export const PINE_CANOPY_SCALE = PINE_CANOPY_SPAN_TARGET / PINE_CANOPY_SPAN_STOCK;

/** Crown lift × (≈ 1.48 — the canopy moves higher). */
export const PINE_LIFT_SCALE = PINE_CANOPY_LIFT_TARGET / PINE_CANOPY_LIFT_STOCK;

/** Foliage whorls × (≈ 0.67 — sparse canopy). */
export const PINE_FOLIAGE_SCALE = PINE_WHORLS_TARGET / PINE_WHORLS_STOCK;

/** Crown aspect (height : span) — stock ≈ 1.9 is an umbrella, target ≈ 6.3 a spire. */
export const PINE_ASPECT_STOCK = PINE_HEIGHT_STOCK / PINE_CANOPY_SPAN_STOCK;
export const PINE_ASPECT_TARGET = PINE_HEIGHT_TARGET / PINE_CANOPY_SPAN_TARGET;

/* ---- Per-tree variation — applied once at placement, seeded, never per frame ---- */

/** Height multipliers around PINE_HEIGHT_TARGET (young → old-growth). */
export const PINE_HEIGHT_JITTER = [0.8, 1.12];

/** Trunk-radius multipliers around PINE_TRUNK_RADIUS_TARGET (never stout again). */
export const PINE_TRUNK_JITTER = [0.85, 1.15];

/* ---- One-stop profile for the tree builders (mirrors GRASSLAND_FEATURES) --- */

export const PINE_PROFILE = {
  height: PINE_HEIGHT_TARGET,
  trunkRadius: PINE_TRUNK_RADIUS_TARGET,
  canopySpan: PINE_CANOPY_SPAN_TARGET,
  canopyLift: PINE_CANOPY_LIFT_TARGET,
  whorls: PINE_WHORLS_TARGET,
};

/**
 * Resolve one pine's authored parameters from two deterministic unit-rands
 * u0/u1 in [0, 1) (drawn from the seeded ctx rng — never Math.random). Called
 * once per tree at placement. Plain numbers ready for the trunk/cone builders:
 * height (m), trunk base radius (m) and canopy span (m) centred at
 * canopyLift × height, plus a whole whorl count. All variation bounds stay
 * inside the tall-thin envelope: even the shortest/fattest edge case (13.6 m
 * over 2.97 m) keeps an aspect ≈ 4.6, well above stock's 1.9.
 */
export function pineSample(u0 = 0, u1 = 0) {
  const [hMin, hMax] = PINE_HEIGHT_JITTER;
  const [tMin, tMax] = PINE_TRUNK_JITTER;
  const height = PINE_PROFILE.height * (hMin + u0 * (hMax - hMin));
  const trunkRadius = PINE_PROFILE.trunkRadius * (tMin + u1 * (tMax - tMin));
  const canopySpan = PINE_PROFILE.canopySpan * (0.9 + 0.2 * u0);
  const whorls = Math.max(3, Math.round(PINE_PROFILE.whorls * (0.85 + 0.3 * u1)));
  return { height, trunkRadius, canopySpan, canopyLift: PINE_PROFILE.canopyLift, whorls };
}
