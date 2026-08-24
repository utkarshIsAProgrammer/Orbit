/**
 * Haptics — tiny vibration feedback for gesture-driven interactions.
 *
 * Wraps `navigator.vibrate()` with a graceful no-op on devices/browsers that
 * don't support it (desktop, iOS Safari, permission-blocked). Vibration is a
 * micro-interaction that makes taps, likes and gestures feel native on
 * Android, without ever blocking the main thread.
 *
 * Usage:
 *   hapticLight();    // like / react / send
 *   hapticSuccess();  // gesture completed (e.g. pull-to-refresh done)
 *   hapticError();    // action rejected
 */

const canVibrate = (): boolean =>
  typeof navigator !== "undefined" && "vibrate" in navigator;

/** Short tick (~10ms) — like, react, toggle, send. */
export const hapticLight = (): void => {
  if (!canVibrate()) return;
  try {
    navigator.vibrate(10);
  } catch {
    /* no-op */
  }
};

/** Medium pulse (~25ms) — gesture threshold reached / action completed. */
export const hapticSuccess = (): void => {
  if (!canVibrate()) return;
  try {
    navigator.vibrate(25);
  } catch {
    /* no-op */
  }
};

/** Double pulse — action rejected or failed. */
export const hapticError = (): void => {
  if (!canVibrate()) return;
  try {
    navigator.vibrate([30, 40, 30]);
  } catch {
    /* no-op */
  }
};

/** Cancel any in-flight vibration (e.g. on unmount). */
export const hapticCancel = (): void => {
  if (!canVibrate()) return;
  try {
    navigator.vibrate(0);
  } catch {
    /* no-op */
  }
};
