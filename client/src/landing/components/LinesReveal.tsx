import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useReducedMotion } from "../hooks/useReducedMotion";

gsap.registerPlugin(ScrollTrigger);

interface LinesRevealProps {
  /** Each string is one masked line that rises into view. */
  lines: string[];
  /** Indexes of lines rendered as outlined display type. */
  outline?: number[];
  /** Indexes of lines rendered italic. */
  italic?: number[];
  className?: string;
  /** false = animate on mount (hero); true = on scroll into view. */
  scroll?: boolean;
  delay?: number;
  as?: "h1" | "h2" | "h3" | "p" | "div";
}

/**
 * The nudot `reveal-wrap → reveal-inner` pattern: every line sits in an
 * overflow-hidden mask and rises out of it with a stagger. Signature
 * storytelling title animation.
 */
export function LinesReveal({
  lines,
  outline = [],
  italic = [],
  className = "",
  scroll = true,
  delay = 0,
  as: Tag = "h2",
}: LinesRevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const inners = el.querySelectorAll<HTMLElement>("[data-lr]");
    if (reduced) return; // lines are visible by default

    const tween = gsap.fromTo(
      inners,
      { yPercent: 115 },
      {
        yPercent: 0,
        duration: 1.1,
        stagger: 0.12,
        ease: "power4.out",
        delay,
        ...(scroll
          ? { scrollTrigger: { trigger: el, start: "top 82%", once: true } }
          : {}),
      },
    );
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [delay, reduced, scroll]);

  return (
    <Tag ref={ref as never} aria-label={lines.join(" ")}>
      {lines.map((line, i) => (
        <span key={i} className="block overflow-hidden">
          <span
            data-lr
            className={`block will-change-transform ${outline.includes(i) ? "text-outline" : ""} ${italic.includes(i) ? "italic" : ""} ${className}`}
          >
            {line}
          </span>
        </span>
      ))}
    </Tag>
  );
}
