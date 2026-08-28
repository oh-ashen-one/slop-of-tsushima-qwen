/** US-001 — golden-field grass palette (Ghost-of-Tsushima gold-green retune).
 *  base #7A8B3C · tip #C9B458 · dry #D9C07A. Canonical gold-green values
 *  published from the terrain side of src/world so vegetation and ground
 *  paint share one source (replaces the dusty-brown family). */
export const GOLDEN_GRASS_PAL = { base: 0x7A8B3C, tip: 0xC9B458, dry: 0xD9C07A };

export class Terrain {
  static id = 'terrain';
  async init() {}
  update() {}
  lateUpdate() {}
  resize() {}
  dispose() {}
}
