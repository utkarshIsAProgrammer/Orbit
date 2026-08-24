import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { Reveal } from "./Reveal";

gsap.registerPlugin(ScrollTrigger);

interface StatDef {
  /** Count-up target (numbers). Omit when using a static text like "∞". */
  value?: number;
  /** Static text rendered as-is (no count-up). */
  text?: string;
  suffix?: string;
  label: string;
  sub: string;
}

/* Numbers people actually care about — not API routes. */
const STATS: StatDef[] = [
  {
    value: 24,
    suffix: "h",
    label: "moments that vanish",
    sub: "Glances are here today, gone by midnight — the memory stays, the noise doesn't.",
  },
  {
    text: "0",
    suffix: " ads",
    label: "your feed, forever yours",
    sub: "Your attention isn't for sale. No sponsored posts, no promoted drama.",
  },
  {
    value: 1,
    suffix: " tap",
    label: "to speak any language",
    sub: "Posts, comments and chat — translated the moment you ask.",
  },
  {
    text: "∞",
    label: "conversations",
    sub: "Typed, voiced or face-to-face — every one of them yours.",
  },
];

function Stat({ stat, index }: { stat: StatDef; index: number }) {
  const numRef = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = numRef.current;
    if (!el) return;
    const suffix = stat.suffix ?? "";
    if (stat.text !== undefined) {
      el.textContent = `${stat.text}${suffix}`;
      return;
    }
    if (reduced) {
      el.textContent = `${stat.value ?? 0}${suffix}`;
      return;
    }
    const obj = { v: 0 };
    const tween = gsap.to(obj, {
      v: stat.value ?? 0,
      duration: 2,
      ease: "power2.out",
      scrollTrigger: { trigger: el, start: "top 88%", once: true },
      onUpdate: () => {
        el.textContent = `${Math.round(obj.v)}${suffix}`;
      },
    });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [stat.value, stat.suffix, stat.text, reduced]);

  return (
    <Reveal delay={index * 0.1}>
      <div className="group relative flex flex-col items-center px-4 py-10 text-center">
        <span className="pointer-events-none absolute inset-0 rounded-3xl bg-white/[0.03] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
        <span ref={numRef} className="font-mono text-6xl font-bold tabular-nums text-ink sm:text-7xl">
          0
        </span>
        <span className="u-label mt-3 text-[11px] text-white/70">
          {stat.label.replace(/\s+/g, "_")}
        </span>
        <span className="mt-2 max-w-[220px] text-[11px] leading-relaxed text-dim">
          {stat.sub}
        </span>
      </div>
    </Reveal>
  );
}

export function Stats() {
  return (
    <section id="stats" className="relative px-5 py-24 sm:px-10 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="hairline-t hairline-b grid grid-cols-2 gap-y-6 md:grid-cols-4">
          {STATS.map((s, i) => (
            <Stat key={s.label} stat={s} index={i} />
          ))}
        </div>

        {/* CTA strip — every section funnels back to the signup */}
        <Reveal delay={0.15}>
          <div className="mt-12 flex flex-col items-center justify-between gap-6 rounded-3xl border border-white/[0.08] bg-white/[0.03] px-8 py-7 text-center sm:flex-row sm:text-left">
            <div>
              <div className="headline text-2xl text-ink sm:text-3xl">
                Your inner circle — <span className="text-amber">is waiting.</span>
              </div>
              <p className="mt-1.5 text-[13px] text-mist">
                Create your account and walk straight in — no queue, no fanfare.
              </p>
            </div>
            <a href="#auth-section" className="btn btn-primary shrink-0">
              Create account
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
