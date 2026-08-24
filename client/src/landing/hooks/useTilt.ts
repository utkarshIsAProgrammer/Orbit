import { useEffect, useRef, type RefObject } from "react";

/**
 * 3D tilt that follows the pointer — used on the device frames.
 * Damped toward the pointer target each frame for buttery motion.
 */
export function useTilt(ref: RefObject<HTMLDivElement | null>, maxDeg = 9) {
  const state = useRef({ rx: 0, ry: 0, tx: 0, ty: 0 });

  useEffect(() => {
    // touch has no hover — tilt would fight native scrolling
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const el = ref.current;
    if (!el) return;

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      state.current.tx = (e.clientX - r.left) / r.width - 0.5;
      state.current.ty = (e.clientY - r.top) / r.height - 0.5;
    };
    const onLeave = () => {
      state.current.tx = 0;
      state.current.ty = 0;
    };

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const s = state.current;
      s.ry += (s.tx * maxDeg - s.ry) * 0.09;
      s.rx += (-s.ty * maxDeg - s.rx) * 0.09;
      el.style.transform = `perspective(1100px) rotateY(${s.ry.toFixed(2)}deg) rotateX(${s.rx.toFixed(2)}deg)`;
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(loop);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, [maxDeg, ref]);
}

/** Magnetic pull — the element leans toward the cursor while hovered. */
export function useMagnetic(ref: RefObject<HTMLDivElement | null>, strength = 0.3) {
  useEffect(() => {
    // touch has no hover — magnetic pull would fight native scrolling
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const el = ref.current;
    if (!el) return;

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      el.style.transform = `translate(${(dx * strength).toFixed(1)}px, ${(dy * strength).toFixed(1)}px)`;
    };
    const onLeave = () => {
      el.style.transform = "";
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [strength, ref]);
}
