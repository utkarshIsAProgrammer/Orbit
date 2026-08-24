import { useEffect, useRef } from "react";
import { useReducedMotion } from "../hooks/useReducedMotion";

const WORDS = [
  "FEED",
  "CHAT",
  "GLANCES",
  "COMMUNITIES",
  "CALLS",
  "STREAKS",
  "POLLS",
  "TRANSLATION",
];

/**
 * Nudot-style scroll-velocity marquee: the strip glides with your scroll
 * speed (and gently drifts when idle), while giant filled/outline words
 * stream past in a seamless loop.
 */
export function BigMarquee() {
  const trackRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const el = trackRef.current;
    if (!el) return;

    let half = el.scrollWidth / 2 || 1;
    let x = 0;
    let target = 0;
    let drift = 0.055; // idle drift direction flips with scroll direction
    let lastSign = 0;
    let lastY = window.scrollY;
    let raf = 0;

    const onScroll = () => {
      const dy = window.scrollY - lastY;
      lastY = window.scrollY;
      target -= dy * 0.6; // scroll down → words glide left
      const sign = dy > 0 ? 1 : dy < 0 ? -1 : 0;
      if (sign !== 0 && sign !== lastSign) {
        drift = -drift;
        lastSign = sign;
      }
    };
    const onResize = () => {
      half = el.scrollWidth / 2 || 1;
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      target -= drift; // gentle idle drift
      if (target <= -half) target += half;
      if (target > 0) target -= half;
      x += (target - x) * 0.12;
      el.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    raf = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, [reduced]);

  const items = [...WORDS, ...WORDS];

  return (
    <div className="relative select-none overflow-hidden py-8 sm:py-12">
      <div ref={trackRef} className="flex w-max will-change-transform">
        {items.map((w, i) => (
          <span key={i} className="flex items-center">
            <span
              className={`headline whitespace-nowrap text-[14vw] leading-none sm:text-[8.5vw] ${
                i % 2 === 0 ? "text-white/90" : "text-outline"
              }`}
            >
              {w}
            </span>
            <span className="mx-8 text-[2.5vw] text-white/30 sm:mx-14 sm:text-[1.6vw]">✦</span>
          </span>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-void to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-void to-transparent" />
    </div>
  );
}
