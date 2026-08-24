import { useEffect, useRef, useState } from "react";

const COARSE =
  typeof window !== "undefined" &&
  window.matchMedia("(pointer: coarse)").matches;

/**
 * Premium custom cursor: a soft light halo, a crisp ring that scales on
 * interactive elements, and an optional label (data-cursor-text) — e.g.
 * "LIVE" when hovering a device. Native cursor hidden on fine pointers.
 *
 * On touch devices (phones/tablets) there is no cursor — instead a warm
 * glow follows the finger while the user touches and drags, so the page
 * still feels alive on mobile without a fake cursor.
 */
export function CursorGlow() {
  const glow = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  // Touch state shared between the listener effect and the glow loop.
  const touch = useRef({ x: -1000, y: -1000, active: false });
  const rafRef = useRef(0);
  // Track a rendered flag so the touch glow only mounts after first touch
  const [touchActive, setTouchActive] = useState(false);

  // Fine-pointer cursor (desktop / laptops with a mouse)
  useEffect(() => {
    if (COARSE) return;
    const g = glow.current;
    const r = ring.current;
    const l = label.current;
    if (!g || !r || !l) return;

    document.documentElement.classList.add("cursor-live");

    let mx = -400;
    let my = -400;
    let rx = mx;
    let ry = my;
    let raf = 0;
    let scale = 1;
    let targetScale = 1;
    let labelText = "";

    const onMove = (e: PointerEvent) => {
      mx = e.clientX;
      my = e.clientY;
    };

    const onOver = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      const labelled = t?.closest?.("[data-cursor-text]");
      const interactive = t?.closest?.("a, button, [role='button']");
      if (labelled) {
        targetScale = 3.2;
        labelText = labelled.getAttribute("data-cursor-text") ?? "";
      } else if (interactive) {
        targetScale = 2.1;
        labelText = "";
      } else {
        targetScale = 1;
        labelText = "";
      }
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      rx += (mx - rx) * 0.16;
      ry += (my - ry) * 0.16;
      scale += (targetScale - scale) * 0.18;

      g.style.transform = `translate3d(${mx - 320}px, ${my - 320}px, 0)`;
      r.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
      r.style.opacity = labelText ? "1" : "0.95";
      r.style.background = labelText ? "rgba(212,175,55,0.16)" : "rgba(212,175,55,0.05)";
      if (labelText !== l.dataset.cur) {
        l.dataset.cur = labelText;
        l.textContent = labelText;
      }
      l.style.opacity = labelText ? "1" : "0";
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerover", onOver, { passive: true });
    raf = requestAnimationFrame(loop);
    return () => {
      document.documentElement.classList.remove("cursor-live");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerover", onOver);
      cancelAnimationFrame(raf);
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
            "radial-gradient(circle, rgba(212,175,55,0.10) 0%, rgba(212,175,55,0.035) 42%, transparent 66%)",
          transform: "translate3d(-1000px, -1000px, 0)",
        }}
      />
    ) : null;
  }

  return (
    <>
      {/* soft light halo — larger and brighter */}
      <div
        ref={glow}
        className="pointer-events-none fixed left-0 top-0 z-[500] h-[640px] w-[640px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(212,175,55,0.12) 0%, rgba(212,175,55,0.045) 42%, transparent 66%)",
        }}
      />
      {/* crisp ring — fills with gold over interactive elements */}
      <div
        ref={ring}
        className="pointer-events-none fixed left-0 top-0 z-[600] flex h-10 w-10 items-center justify-center rounded-full border border-amber/80 shadow-[0_0_24px_rgba(212,175,55,0.35)]"
      >
        <span
          ref={label}
          data-cur=""
          className="text-[8px] font-black uppercase tracking-[0.2em] text-amber opacity-0 transition-opacity duration-200"
        >
          live
        </span>
      </div>
    </>
  );
}
