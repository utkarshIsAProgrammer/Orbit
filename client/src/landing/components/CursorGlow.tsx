import { useEffect, useRef, useState } from "react";

const COARSE =
  typeof window !== "undefined" &&
  window.matchMedia("(pointer: coarse)").matches;

/**
 * Ambient light that follows the pointer: a soft halo trails the mouse on
 * fine-pointer devices, and a warm glow follows the finger while touching on
 * mobile. The native cursor is left visible (no custom circle/ring cursor).
 *
 * On touch devices (phones/tablets) there is no cursor — instead a warm
 * glow follows the finger while the user touches and drags, so the page
 * still feels alive on mobile.
 */
export function CursorGlow() {
  const glow = useRef<HTMLDivElement>(null);
  // Touch state shared between the listener effect and the glow loop.
  const touch = useRef({ x: -1000, y: -1000, active: false });
  const rafRef = useRef(0);
  // Track a rendered flag so the touch glow only mounts after first touch
  const [touchActive, setTouchActive] = useState(false);

  // Fine-pointer glow (desktop / laptops with a mouse): the halo simply sits
  // under the cursor — no rAF loop needed since it follows instantly, so CPU
  // stays at zero while the pointer is still.
  useEffect(() => {
    if (COARSE) return;
    const g = glow.current;
    if (!g) return;

    const onMove = (e: PointerEvent) => {
      g.style.transform = `translate3d(${e.clientX - 320}px, ${e.clientY - 320}px, 0)`;
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  // Touch devices: attach listeners immediately (independent of render) so
  // the first touch is captured. The glow element + follow loop mount after
  // the first touchstart flips touchActive.
  useEffect(() => {
    if (!COARSE) return;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      touch.current.x = t.clientX;
      touch.current.y = t.clientY;
      touch.current.active = true;
      setTouchActive(true);
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      touch.current.x = t.clientX;
      touch.current.y = t.clientY;
    };
    const onTouchEnd = () => {
      // fade out quickly by resetting the transform target off-screen
      touch.current.x = -1000;
      touch.current.y = -1000;
      touch.current.active = false;
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // The follow loop lives in a callback ref so it starts exactly when the
  // glow element mounts (after the first touch) and stops if it unmounts.
  const setTouchGlow = (el: HTMLDivElement | null) => {
    if (!el) {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    let cx = touch.current.x;
    let cy = touch.current.y;
    const follow = () => {
      // Stop when the finger is lifted and the glow has settled — no
      // continuous rendering after the last touch.
      const settled = Math.abs(cx - touch.current.x) < 0.5 && Math.abs(cy - touch.current.y) < 0.5;
      if (!touch.current.active && settled) {
        rafRef.current = 0;
        return;
      }
      rafRef.current = requestAnimationFrame(follow);
      cx += (touch.current.x - cx) * 0.22;
      cy += (touch.current.y - cy) * 0.22;
      el.style.transform = `translate3d(${cx - 200}px, ${cy - 200}px, 0)`;
    };
    follow();
  };

  if (COARSE) {
    return touchActive ? (
      <div
        ref={setTouchGlow}
        className="pointer-events-none fixed left-0 top-0 z-[500] h-[400px] w-[400px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.04) 42%, transparent 66%)",
          transform: "translate3d(-1000px, -1000px, 0)",
        }}
      />
    ) : null;
  }

  return (
    <>
      {/* soft light halo — follows the cursor, native cursor stays visible */}
      <div
        ref={glow}
        className="pointer-events-none fixed left-0 top-0 z-[500] h-[640px] w-[640px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.05) 42%, transparent 66%)",
        }}
      />
    </>
  );
}
