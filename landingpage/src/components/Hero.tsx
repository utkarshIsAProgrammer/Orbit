import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowRight, ArrowDown } from "lucide-react";
import { Magnetic } from "./Magnetic";
import { SplitWords } from "./SplitWords";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { WAITLIST_API_URL } from "../config";

gsap.registerPlugin(ScrollTrigger);

const CATS = [
  "( 24-hour glances )",
  "( zero ads )",
  "( live chat & calls )",
  "( close friends only )",
];

const STATS = [
  { icon: "24h", label: "glances" },
  { icon: "0", label: "ads" },
  { icon: "1-tap", label: "translation" },
  { icon: "∞", label: "conversations" },
];

/**
 * Hero — straight to the point. Giant display headline, a parenthesized
 * category grid, underscore stats, and a single call to action. No door,
 * no intro sequence — the content is right there.
 */
export function Hero() {
  const rootRef = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();

  // Real social proof only — the live waitlist count from the server, never
  // a fabricated number.
  const [waitlistCount, setWaitlistCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${WAITLIST_API_URL}/waitlist/count`)
      .then((r) => r.json())
      .then((d) => {
        if (alive && typeof d?.count === "number") setWaitlistCount(d.count);
      })
      .catch(() => {
        /* server not up — the line stays hidden */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Entrance choreography — the hero assembles itself the moment the page
  // opens: a warm bloom breathes in behind the headline, the category grid
  // drops in, the words rise (SplitWords), a gold light sweeps across, then
  // the stats, buttons and cue join in a staggered cascade.
  useEffect(() => {
    if (reduced) return;
    const root = rootRef.current;
    if (!root) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.fromTo("[data-hero-cats]", { y: -14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7 }, 0.15);
      tl.fromTo(
        "[data-hero-bloom] > div",
        { scale: 0.7, opacity: 0 },
        { scale: 1, opacity: 1, duration: 1.4, ease: "power2.out" },
        0.2,
      );
      tl.fromTo(
        "[data-hero-sweep] > div",
        { xPercent: -140, opacity: 1 },
        // fade out as it crosses so no band is left parked on wide screens
        { xPercent: 380, opacity: 0, duration: 1.6, ease: "power2.inOut" },
        0.55,
      );
      tl.fromTo(
        "[data-hero-stats] > *",
        { y: 16, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.55, stagger: 0.07 },
        0.9,
      );
      tl.fromTo(
        "[data-hero-sub]",
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.6 },
        0.78,
      );
      tl.fromTo(
        "[data-hero-cta]",
        { y: 18, opacity: 0, scale: 0.97 },
        { y: 0, opacity: 1, scale: 1, duration: 0.65 },
        1.1,
      );
      tl.fromTo("[data-hero-people]", { opacity: 0 }, { opacity: 1, duration: 0.5 }, 1.25);
      tl.fromTo("[data-hero-cue]", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.6 }, 1.35);
    }, root);
    return () => ctx.revert();
  }, [reduced]);

  // Storytelling scroll layers: the content fades and drifts away as you
  // scroll, while the category grid parallaxes at a different rate.
  useEffect(() => {
    if (reduced) return;
    const root = rootRef.current;
    if (!root) return;
    const ctx = gsap.context(() => {
      // main content scrolls out (storytelling exit)
      gsap.to("[data-hero-fade]", {
        yPercent: -16,
        opacity: 0.1,
        ease: "none",
        scrollTrigger: { trigger: root, start: "top top", end: "bottom top", scrub: 0.7 },
      });
      // category grid drifts slower (depth)
      gsap.to("[data-hero-slow]", {
        yPercent: 60,
        ease: "none",
        scrollTrigger: { trigger: root, start: "top bottom", end: "bottom top", scrub: 1 },
      });
      // scroll cue fades fast
      gsap.to("[data-hero-cue]", {
        opacity: 0,
        ease: "none",
        scrollTrigger: { trigger: root, start: "top top", end: "25% top", scrub: true },
      });

      // ── word-by-word split exit ───────────────────────────────
      // Each headline word detaches from its siblings and drifts away
      // individually (staggered up/down + sideways + a tilt) as the hero
      // scrolls out. The reveal masks are opened the moment the scrub
      // starts moving so the words can scatter freely, unclipped.
      const words = gsap.utils.toArray<HTMLElement>("[data-hero-fade] [data-w]");
      const masks = words.map((w) => w.parentElement as HTMLElement | null);
      let freed = false;
      words.forEach((w, i) => {
        const dir = i % 2 === 0 ? 1 : -1;
        gsap.fromTo(
          w,
          { yPercent: 0, x: 0, rotation: 0 },
          {
            yPercent: dir * (8 + (i % 3) * 6),
            x: dir * 18,
            rotation: dir * 2.2,
            ease: "none",
            immediateRender: false,
            scrollTrigger: {
              trigger: root,
              start: "top top",
              end: "bottom top",
              scrub: 0.6,
              onUpdate: (self) => {
                if (!freed && self.progress > 0.001) {
                  freed = true;
                  // open every reveal mask once the scatter begins so no
                  // word gets clipped while drifting (gsap.set so context
                  // revert restores them)
                  masks.forEach((m) => m && gsap.set(m, { overflow: "visible" }));
                }
              },
            },
          },
        );
      });
    }, root);
    return () => ctx.revert();
  }, [reduced]);

  // Mouse parallax: the headline block leans toward the cursor — depth on
  // the hero that responds to every pointer move.
  useEffect(() => {
    if (reduced) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const root = rootRef.current;
    if (!root) return;
    const qx = gsap.quickTo("[data-hero-parallax]", "x", { duration: 0.7, ease: "power3.out" });
    const qy = gsap.quickTo("[data-hero-parallax]", "y", { duration: 0.7, ease: "power3.out" });
    const onMove = (e: PointerEvent) => {
      const nx = e.clientX / window.innerWidth - 0.5;
      const ny = e.clientY / window.innerHeight - 0.5;
      qx(nx * 30);
      qy(ny * 20);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [reduced]);

  return (
    <section id="top" ref={rootRef} className="relative flex h-[100dvh] min-h-[640px] w-full flex-col items-center justify-center overflow-hidden px-6 text-center">
      {/* readability scrims */}
      <div className="pointer-events-none absolute inset-0 z-[1]">
        <div className="absolute inset-0 halo" />
        <div className="absolute inset-0 vignette" />
      </div>

      {/* warm bloom that breathes in behind the headline on open */}
      <div data-hero-bloom className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center">
        <div
          className="h-[75vh] w-[75vw] rounded-full opacity-0"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(212,175,55,0.14) 0%, rgba(212,175,55,0.05) 45%, transparent 70%)",
          }}
        />
      </div>

      {/* one gold light sweep across the hero on open */}
      <div data-hero-sweep className="pointer-events-none absolute inset-0 z-[6] overflow-hidden">
        <div
          className="absolute top-0 h-full w-40 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent blur-2xl"
          style={{ left: "-15%" }}
        />
      </div>

      {/* parenthesized category grid */}
      <div data-hero-slow data-hero-cats className="absolute inset-x-6 top-20 z-10 grid grid-cols-2 gap-x-8 gap-y-2 sm:inset-x-10 sm:top-24 md:grid-cols-4">
        {CATS.map((c) => (
          <span key={c} className="u-label text-[11px] text-white/55">
            {c}
          </span>
        ))}
      </div>

      <div data-hero-fade className="relative z-10 flex flex-col items-center">
        <div data-hero-parallax className="will-change-transform">
        <h1 className="headline text-[9.5vw] leading-[0.9] text-white sm:text-7xl md:text-8xl">
          <SplitWords as="span" text="YOUR INNER CIRCLE" mixOutline scroll={false} delay={0.3} />
          <br />
          <SplitWords as="span" text="ZERO NOISE" mixOutline scroll={false} delay={0.45} />
        </h1>

        <p data-hero-sub className="mx-auto mt-7 max-w-md text-sm leading-relaxed text-mist sm:text-base">
          Orbit is the quiet corner of the internet — 24-hour glances, live
          chat, voice & video calls and a feed with zero ads. Just your
          people, exactly as they are.
        </p>

        <div data-hero-stats className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 sm:gap-x-8">
          {STATS.map((s) => (
            <span
              key={s.label}
              className="flex items-baseline gap-1.5 whitespace-nowrap font-mono text-[11px] tracking-[0.12em] text-mist sm:text-[11px]"
            >
              <b className="font-bold tabular-nums text-white/90">{s.icon}</b>
              <span className="text-white/45">{s.label}</span>
            </span>
          ))}
        </div>

        <div data-hero-cta className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Magnetic>
            <a href="#waitlist" className="btn btn-primary">
              Join the waitlist
              <ArrowRight className="h-4 w-4" />
            </a>
          </Magnetic>
          <Magnetic strength={0.22}>
            <a href="#features" className="btn btn-ghost">
              Explore all features
            </a>
          </Magnetic>
        </div>

        {waitlistCount !== null && (
          <span data-hero-people className="u-label mt-8 text-[11px] text-white/55">
            {waitlistCount.toLocaleString("en-US")}_PEOPLE_ON_THE_WAITLIST
          </span>
        )}
        </div>
      </div>

      <div data-hero-cue className="absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2 text-white/50">
        <span className="u-label text-[11px]">down</span>
        <ArrowDown className="h-4 w-4 animate-bounce" />
      </div>
    </section>
  );
}
