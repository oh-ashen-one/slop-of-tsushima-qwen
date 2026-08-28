/** US-004 — rolling grassland terrain retune (Ghost of Tsushima's Iki field).
 *
 * The stock RED SANDS heightfield is eroded desert: hydraulic + thermal
 * erosion carves tall buttes and flat-topped mesas, so the whole map reads
 * arid. The golden-field brief (INTEGRATION.md target 3) retunes the near
 * field to rolling grassland — gentle long-wavelength rolls — while keeping
 * the far mountains high, blue and hazy on the horizon.
 *
 * Canonical butte/mesa tuning values published from src/world/terrain so the
 * terrain feature passes (Field / Erosion / Maps) read one source instead of
 * hardcoding. Same discipline as PAMPAS_* (US-002) and WILDFLOWER_*
 * (US-003): additive public surface per CONTRACTS §1 — the existing feature
 * builders multiply their stock constants by these scales, so the retune
 * lives in one place. Pure data + math: no THREE import, no per-frame
 * allocation, and Math.random is never used (CONTRACTS §1.4).
 */

/* =====================================================================
 * Stock profile — what the original erosion pass carves (documented for A/B and LOD blends)
 * ==================================================================== */

/** Metres — peak height of a typical eroded butte above the valley floor. */
export const BUTTE_AMP_STOCK = 46;

/** Metres — relief of a typical flat-topped mesa (rim above its bench). */
export const MESA_AMP_STOCK = 58;

/** Waves per km — spacing of butte-scale features. */
export const BUTTE_FREQ_STOCK = 0.9;

/** Waves per km — spacing of mesa-scale features. */
export const MESA_FREQ_STOCK = 0.35;

/** Metres — amplitude of the far mountain range (the blue-hazy ridges).
 * Never softened by US-004 — INTEGRATION.md target 3: "keep the mountains
 * far and blue." */
export const FAR_RANGE_AMP = 340;

/* =====================================================================
 * Grassland targets — the US-004 softened values
 * ==================================================================== */

/** Metres — butte amplitude in the golden field: old spires become low
 * rises (46 → 8), so the horizon stays open and the turf reads continuous. */
export const GRASSLAND_BUTTE_AMP = 8;

/** Metres — mesa relief in the golden field (58 → 14): flat tops survive as
 * gentle benches, not sandstone tables. */
export const GRASSLAND_MESA_AMP = 14;

/** Waves per km — buttes spread (0.9 → 0.6): a few distant rises instead of
 * a badlands crowd around the spawn field. */
export const GRASSLAND_BUTTE_FREQ = 0.6;

/** Waves per km — mesa benches spread too (0.35 → 0.22): each becomes a long
 * low shoulder instead of an isolated table. */
export const GRASSLAND_MESA_FREQ = 0.22;

/* =====================================================================
 * Scale factors — multiply the stock constants (derived, not re-authored)
 * ==================================================================== */

/** Butte amplitude × (≈ 0.17). */
export const BUTTE_AMP_SCALE = GRASSLAND_BUTTE_AMP / BUTTE_AMP_STOCK;

/** Mesa amplitude × (≈ 0.24). */
export const MESA_AMP_SCALE = GRASSLAND_MESA_AMP / MESA_AMP_STOCK;

/** Butte spacing × (≈ 0.67 → wider). */
export const BUTTE_FREQ_SCALE = GRASSLAND_BUTTE_FREQ / BUTTE_FREQ_STOCK;

/** Mesa spacing × (≈ 0.63 → wider benches). */
export const MESA_FREQ_SCALE = GRASSLAND_MESA_FREQ / MESA_FREQ_STOCK;

/* =====================================================================
 * The new base feature — gentle rolls replacing badlands texture near the player
 * ==================================================================== */

/** Metres — amplitude of one grassland roll: long, soft, Iki-like. */
export const ROLL_AMP = 5.5;

/** Metres — wavelength of one grassland roll: long enough that the field
 * undulates instead of rippling, and no slope steeper than a walkable grade. */
export const ROLL_WAVELENGTH = 260;

/* =====================================================================
 * Distance band — where the retune applies (rolls near, ranges stay stock)
 * ==================================================================== */

/** Metres from the field centre — inside this radius, features render at
 * their softened grassland amplitude. */
export const ROLL_BAND_OUTER = 850;

/** Metres — at and beyond this, features blend back to stock amplitude: the
 * far range (FAR_RANGE_AMP) and its foothills keep their full relief. */
export const ROLL_BAND_FULL = 1400;

/** One-stop profile for the terrain feature passes (mirrors GOLDEN_GRASS_PAL). */
export const GRASSLAND_FEATURES = {
  butteAmp: GRASSLAND_BUTTE_AMP,
  mesaAmp: GRASSLAND_MESA_AMP,
  butteFreq: GRASSLAND_BUTTE_FREQ,
  mesaFreq: GRASSLAND_MESA_FREQ,
  rollAmp: ROLL_AMP,
  rollWavelength: ROLL_WAVELENGTH,
  bandOuter: ROLL_BAND_OUTER,
  bandFull: ROLL_BAND_FULL,
};

/** Hermit smoothstep — kept local so this data module has zero imports (same
 * pattern as the wildflower helpers in src/world/vegetation). */
function sstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Distance blend for feature softening, metres from the field centre: 0 inside
 * ROLL_BAND_OUTER (full grassland retune), rising smoothly to 1 at
 * ROLL_BAND_FULL (stock amplitude restored). No visible seam where the retune
 * fades out — scout frames in between never catch a step.
 */
export function featureMix(r) {
  return sstep(ROLL_BAND_OUTER, ROLL_BAND_FULL, r);
}

/**
 * Resolve one feature amplitude or frequency for a given distance from the
 * field centre: softened grassland value inside the band, blended back to its
 * stock value beyond it. Called once per feature placement at init — never
 * per frame. The far-range pass uses FAR_RANGE_AMP directly and skips this,
 * so the mountains are never softened.
 */
export function blendedFeature(softened, stock, r) {
  return softened + (stock - softened) * featureMix(r);
}
