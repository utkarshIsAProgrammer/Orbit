import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useReducedMotion } from "../hooks/useReducedMotion";

gsap.registerPlugin(ScrollTrigger);

interface SplitWordsProps {
  text: string;
  as?: "h1" | "h2" | "h3" | "p" | "span";
  className?: string;
  /** Trailing italic word rendered as <em> and revealed with the others. */
  italic?: string;
  delay?: number;
  /** false = animate on mount (hero); true = animate on scroll into view. */
  scroll?: boolean;
  /** Alternate words rendered as outlined display text — the premium mix. */
  mixOutline?: boolean;
}

/**
 * Word-by-word masked reveal: each word sits in an overflow-hidden mask and
 * rises out of it with a stagger — the signature premium-heading animation.
 */
export function SplitWords({
  text,
  as: Tag = "h2",
  className = "",
  italic,
  delay = 0,
  scroll = true,
  mixOutline = false,
}: SplitWordsProps) {
  const ref = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const words = el.querySelectorAll<HTMLElement>("[data-w]");
    if (reduced) return; // words are visible by default

    const tween = gsap.fromTo(
      words,
      { yPercent: 118, opacity: 0, filter: "blur(10px)" },
      {
        yPercent: 0,
        opacity: 1,
        filter: "blur(0px)",
        duration: 0.9,
        stagger: 0.055,
        ease: "power4.out",
        delay,
        ...(scroll
          ? { scrollTrigger: { trigger: el, start: "top 85%", once: true } }
          : {}),
      },
    );
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [delay, reduced, scroll]);

  const words = text.split(" ");

  return (
    <Tag ref={ref as never} className={className} aria-label={text}>
      {words.map((w, i) => (
        <span key={i} className="inline-block overflow-hidden align-top">
          <span
            data-w
            className={`inline-block will-change-transform ${
              mixOutline && i % 2 === 1 ? "text-outline" : ""
            }`}
          >
            {w}
            {/* every word keeps its trailing space so headings never glue
                together (incl. before the trailing italic word or a
                sibling SplitWords on the same line) */}
            {i < words.length - 1 || italic ? "\u00A0" : ""}
          </span>
        </span>
      ))}
      {italic && (
        <span className="inline-block overflow-hidden align-top">
          <em data-w className="italic">
            {italic}
          </em>
        </span>
      )}
    </Tag>
  );
}
