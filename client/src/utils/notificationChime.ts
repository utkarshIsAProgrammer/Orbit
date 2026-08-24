/**
 * In-app notification chime.
 *
 * A tiny WebAudio two-tone "pop" (no audio asset needed) played whenever a
 * realtime notification arrives while sound is enabled. The user's preference
 * lives in NotificationSettings and is mirrored to localStorage under
 * `orbit_notif_sound` so App.tsx can read it synchronously.
 *
 * Implementation notes:
 * - A SINGLE lazily-created AudioContext is reused across notifications
 *   (creating one per notification leaks and is wasteful).
 * - Browsers create AudioContexts in a "suspended" state until a user gesture
 *   occurs, so we resume it on the first pointerdown/keydown and also attempt
 *   an explicit resume() right before scheduling a chime.
 */

const STORAGE_KEY = "orbit_notif_sound";

/** Respect the user's sound preference (defaults to ON). */
export const isNotificationSoundEnabled = (): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
};

// Singleton context — reused so we don't leak a context per notification.
let sharedCtx: AudioContext | null = null;

const getContext = (): AudioContext | null => {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  if (!sharedCtx) {
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      sharedCtx = new Ctor();
    } catch {
      return null;
    }
  }
  return sharedCtx;
};

// Resume the shared context on the first real user gesture — required by the
// autoplay policy before any AudioContext can actually produce sound.
let gestureListenerAttached = false;
const attachGestureResume = () => {
  if (gestureListenerAttached) return;
  gestureListenerAttached = true;
  const resume = () => {
    if (sharedCtx && sharedCtx.state === "suspended") {
      void sharedCtx.resume().catch(() => {});
    }
  };
  window.addEventListener("pointerdown", resume, { passive: true });
  window.addEventListener("keydown", resume, { passive: true });
  window.addEventListener("touchstart", resume, { passive: true });
};

/**
 * Play the notification chime. Safe to call on every notification — respects
 * the pref, is a no-op if the tab is hidden (native push covers that), and
 * never throws (degraded environments simply stay silent).
 */
export function playNotificationChime(): void {
  if (!isNotificationSoundEnabled()) return;
  if (typeof document !== "undefined" && document.hidden) return;	const ctx = getContext();
	if (!ctx) return;
	attachGestureResume();

  // If the context is still suspended (no gesture yet), try once — some
  // browsers honor this inside an event handler; the gesture listener above
  // covers the rest.
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => {});
  }

  try {
    const now = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    master.connect(ctx.destination);

    // First note (soft high "pop")
    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, now);
    osc1.frequency.exponentialRampToValueAtTime(660, now + 0.18);
    osc1.connect(master);
    osc1.start(now);
    osc1.stop(now + 0.2);

    // Second note (bright low "ding" overlapping)
    const osc2 = ctx.createOscillator();
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(1174.66, now + 0.06);
    osc2.frequency.exponentialRampToValueAtTime(880, now + 0.3);
    osc2.connect(master);
    osc2.start(now + 0.06);
    osc2.stop(now + 0.4);
  } catch {
    // Audio unavailable (autoplay policy, insecure origin, etc.) — stay silent
  }
}
