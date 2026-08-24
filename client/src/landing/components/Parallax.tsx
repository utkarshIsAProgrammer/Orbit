import { useEffect, useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { useIsDesktop } from "../hooks/useIsDesktop";

gsap.registerPlugin(ScrollTrigger);

interface ParallaxProps {
  children: ReactNode;
  /** Positive = drifts down, negative = drifts up (background feel). */
  speed?: number;
  className?: string;
}

/**
 * Scrub-linked parallax: the element glides vertically while it crosses
 * the viewport, at a different rate than the page — depth, nudot-style.
 */
export function Parallax({ children, speed = -0.12, className = "" }: ParallaxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const isDesktop = useIsDesktop(768);

  useEffect(() => {
    if (reduced) return;
    if (!isDesktop) return; // skip parallax layers on mobile
    const el = ref.current;
    if (!el) return;
    const range = speed * 340;
    const tween = gsap.fromTo(
      el,
      { y: -range },
      {
        y: range,
        ease: "none",
        scrollTrigger: {
          trigger: el,
          start: "top bottom",
          end: "bottom top",
          scrub: 0.9,
        },
      },
    );
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [isDesktop, reduced, speed]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
