import { lazy, Suspense, useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

// WebGL world — lazy so the three.js chunk is fetched only when this
// page actually renders it (still code-split, but shown on every device).
const WorldCanvas = lazy(() =>
  import("./world/WorldCanvas").then((m) => ({ default: m.WorldCanvas })),
);
import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { Chapters } from "./components/Chapters";
import { Features } from "./components/Features";
import { WhyOrbit } from "./components/WhyOrbit";
import { Stats } from "./components/Stats";
import { LoveNotes } from "./components/LoveNotes";
import { Steps } from "./components/Steps";
import { Reveal } from "./components/Reveal";
import Showcase from "./components/Showcase";
import { CTA } from "./components/CTA";
import { Waitlist } from "./components/Waitlist";
import { AuthSection } from "./components/AuthSection";
import { Footer } from "./components/Footer";
import { CursorGlow } from "./components/CursorGlow";
import { NoiseOverlay } from "./components/NoiseOverlay";
import { ScrollIndex } from "./components/ScrollIndex";
import { Lab } from "./components/Lab";
import { MOTION } from "./config";
import { world } from "./store";
import { setLenis } from "./scrollLock";

gsap.registerPlugin(ScrollTrigger);

export default function App() {
  const progressRef = useRef<HTMLDivElement>(null);

  // Lenis smooth scrolling, kept in perfect sync with every ScrollTrigger
  useEffect(() => {
    if (MOTION !== "full") return; // native scrolling only in gentle mode

    const lenis = new Lenis({ lerp: 0.08, wheelMultiplier: 1 });
    setLenis(lenis);
    lenis.on("scroll", ScrollTrigger.update);
    const onTick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(onTick);
    gsap.ticker.lagSmoothing(0);

    // Smooth anchor navigation for nav / footer hash links
    const onClick = (e: MouseEvent) => {
      // respect modifier keys, middle/right clicks, and other handlers
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.(
        'a[href^="#"]',
      ) as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href === "#") return;
      const target = document.querySelector<HTMLElement>(href);
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target, { duration: 1.4 });
    };
    document.addEventListener("click", onClick);

    return () => {
      document.removeEventListener("click", onClick);
      gsap.ticker.remove(onTick);
      lenis.destroy();
      setLenis(null);
    };
  }, []);

  // Top scroll-progress bar + scroll velocity feeding the 3D background
  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, window.scrollY / max) : 0;
      if (progressRef.current) {
        progressRef.current.style.transform = `scaleX(${p.toFixed(4)})`;
      }
      // surge the aurora with scroll speed
      const dy = Math.abs(window.scrollY - lastY);
      lastY = window.scrollY;
      world.scrollVel = Math.min(1, dy / 36);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    // Generic scroll parallax for [data-parallax] elements (speed = 0.7–1.6)
    const tweens = gsap.utils.toArray<HTMLElement>("[data-parallax]").map((el) => {
      const speed = parseFloat(el.dataset.parallax || "1");
      const amp = 22 * speed;
      return gsap.fromTo(
        el,
        { yPercent: amp },
        {
          yPercent: -amp,
          ease: "none",
          scrollTrigger: {
            trigger: el,
            start: "top bottom",
            end: "bottom top",
            scrub: 0.7,
          },
        },
      );
    });

    return () => {
      tweens.forEach((t) => {
        t.scrollTrigger?.kill();
        t.kill();
      });
    };
  }, []);

  return (
    <div className="relative min-h-screen bg-void">
      {/* The fixed, continuous warm light-field behind everything — 3D on
          every device (mobile/tablet included), lazy-loaded three.js */}
      <div className="fixed inset-0 z-0">
        <Suspense fallback={<div className="h-full w-full bg-void" />}>
          <WorldCanvas />
        </Suspense>
      </div>

      <NoiseOverlay />
      <CursorGlow />

      {/* scroll progress */}
      <div className="fixed inset-x-0 top-0 z-[60] h-[2px] bg-white/[0.06]">
        <div
          ref={progressRef}
          className="h-full origin-left scale-x-0 bg-gradient-to-r from-amber via-rose to-violet"
        />
      </div>

      <Nav />
      <ScrollIndex />

      <main className="relative z-10">
        <Hero />
        <Chapters />
        <Reveal>
          <Features />
        </Reveal>
        <Reveal>
          <WhyOrbit />
        </Reveal>
        <Reveal>
          <Stats />
        </Reveal>
        <Reveal>
          <LoveNotes />
        </Reveal>
        <Reveal>
          <Steps />
        </Reveal>
        <Reveal>
          <Waitlist />
        </Reveal>
        <Reveal>
          <AuthSection />
        </Reveal>
        <Reveal>
          <Showcase />
        </Reveal>
        <Lab />
        <Reveal>
          <CTA />
        </Reveal>
        <Footer />
      </main>
    </div>
  );
}
