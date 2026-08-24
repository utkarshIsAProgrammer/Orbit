import { useEffect, useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useReducedMotion } from "../hooks/useReducedMotion";

gsap.registerPlugin(ScrollTrigger);

interface RevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  once?: boolean;
}

/** Scroll-triggered reveal: fade + rise + de-blur, orchestrated with GSAP. */
export function Reveal({ children, className, delay = 0, y = 44, once = true }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced) return; // already visible by default styles

    let revealed = false;
    let io: IntersectionObserver | null = null;

    const ctx = gsap.context(() => {
      const tween = gsap.fromTo(
        el,
        { opacity: 0, y, filter: "blur(10px)" },
        {
          opacity: 1,
          y: 0,
          filter: "blur(0px)",
          duration: 1.15,
          delay,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 84%", once },
        },
      );
      // Normal path: the real animation started — nothing else to do.
      tween.eventCallback("onStart", () => {
        revealed = true;
        io?.disconnect();
      });
    }, el);

    // Failsafe: ScrollTrigger positions can go stale (images loading late
    // shift the layout after GSAP measured it), which would leave this
    // section hidden at opacity 0 forever. Watch the element at the same
    // threshold as the trigger — whichever fires first reveals it, so the
    // content is NEVER stuck invisible.
    io = new IntersectionObserver(
      (entries) => {
        if (revealed || !entries.some((e) => e.isIntersecting)) return;
        revealed = true;
        io?.disconnect();
        gsap.to(el, {
          opacity: 1,
          y: 0,
          filter: "blur(0px)",
          duration: 0.7,
          ease: "power2.out",
          overwrite: "auto",
        });
      },
      { rootMargin: "0px 0px -16% 0px", threshold: 0 },
    );
    io.observe(el);

    return () => {
      io?.disconnect();
      ctx.revert();
    };
  }, [delay, once, reduced, y]);

  return (
    <div ref={ref} className={className} style={{ willChange: "transform, opacity" }}>
      {children}
    </div>
  );
}
