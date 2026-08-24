/**
 * Mutable world state shared between the DOM layer (GSAP) and the WebGL
 * layer (R3F). The 3D camera damps toward these targets every frame —
 * calm, fixed, no door intro.
 */

export const world = {
  /** Camera z target — settled, looking over the warm light-field. */
  camTargetZ: 1.1,
  /** Warm aurora pulse (idle — kept for the light-field's gentle bloom). */
  doorFlash: 0,
  /** Gentle light bloom. */
  warp: 0,
  /** 0..1 scroll velocity — the light field surges while you scroll. */
  scrollVel: 0,
};
