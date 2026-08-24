import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { User as UserType } from "../types";

// WebGL world — lazy so the three.js chunk is fetched only when this
// page actually renders it, AND deferred off first paint: it mounts on the
// user's first interaction (or a 2.5s idle timeout) and never for
// prefers-reduced-motion users, so the landing's critical content and
// every repeat visitor's first paint stay free of the ~300 KB gzip 3D stack.
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
import { Footer } from "./components/Footer";
import { CursorGlow } from "./components/CursorGlow";
import { NoiseOverlay } from "./components/NoiseOverlay";
import { ScrollIndex } from "./components/ScrollIndex";
import { Lab } from "./components/Lab";
import Auth from "../components/Auth";
import ForgotPassword from "../components/ForgotPassword";
import { MOTION } from "./config";
import { world } from "./store";
import { setLenis } from "./scrollLock";
import "./landing.css";

gsap.registerPlugin(ScrollTrigger);

export interface LandingRootProps {
  onAuthSuccess: (user: UserType, token?: string) => void;
  onForgotPasswordClick: () => void;
  onBackToLogin: () => void;
  initialShowSignup?: boolean;
  forgotPasswordOpen?: boolean;
}

/**
 * The app's logged-out landing — nav, hero, chapters, features, why, stats,
 * love notes, steps, showcase, lab, CTA, footer, all funnelling into the
 * app's real login/signup form (the #auth-section).
 */
export default function LandingRoot({
  onAuthSuccess,
  onForgotPasswordClick,
  onBackToLogin,
  initialShowSignup,
  forgotPasswordOpen,
}: LandingRootProps) {
  const progressRef = useRef<HTMLDivElement>(null);

  // The 3D light-field is DEFERRED off the first paint: the three.js chunk
  // (~300 KB gzip) only downloads once the user actually interacts with the
  // page (scroll/tap/pointer/key), or after a hard 2.5s timeout so passive
  // viewers still get it — and never for prefers-reduced-motion users (they
  // keep the calm static backdrop instead of the animated field). Before it
  // mounts, the page shows the plain bg-void fallback, so the landing's
  // critical content isn't blocked on the WebGL stack.
  const [showWorld, setShowWorld] = useState(false);
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ??
        false)
    ) {
      return;
    }
    let started = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      for (const ev of EVENTS) window.removeEventListener(ev, start);
      if (timer) clearTimeout(timer);
    };
    const start = () => {
      if (started) return;
      started = true;
      cleanup();
      setShowWorld(true);
    };
    // First interaction (scroll, tap, pointer move, key) boots the field
    // immediately so it never feels late for active users.
    const EVENTS = ["pointerdown", "touchstart", "scroll", "keydown"] as const;
    for (const ev of EVENTS)
      window.addEventListener(ev, start, { passive: true });
    // Guaranteed fallback for passive viewers — appears after the page's
    // critical content has had time to paint.
    timer = setTimeout(start, 2500);
    return cleanup;
  }, []);

  // The app shell's global `html { overflow-x: clip }` + `body { overflow-x:
  // hidden }` are fine for the logged-in app (internal scroll containers), but
  // they LOCK document scrolling on mobile browsers — the root becomes a
  // fixed-height clip container and window.scrollY can't move. The landing is
  // a normal scrolling page (Lenis animates the window, anchor buttons like
  // "Join Orbit" scroll to sections), so on mobile every nav/CTA button was
  // dead. Inline styles win over the stylesheet, and we restore the previous
  // values when the landing unmounts so the app shell keeps its own clipping.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const savedHtml = html.style.overflow;
    const savedBody = body.style.overflow;
    html.style.overflow = "visible";
    body.style.overflow = "visible";
    return () => {
      html.style.overflow = savedHtml;
      body.style.overflow = savedBody;
    };
  }, []);

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

  // Keep ScrollTrigger positions accurate. Images and lazy sections shift
  // the layout AFTER GSAP measured trigger positions on mount, which can
  // leave reveals below the fold with stale starts (sections stuck hidden).
  // Recompute on window load and whenever any image finishes loading
  // (debounced — img load events don't bubble but DO capture).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => ScrollTrigger.refresh(), 150);
    };
    window.addEventListener("load", debouncedRefresh);
    document.addEventListener("load", debouncedRefresh, true);
    return () => {
      window.removeEventListener("load", debouncedRefresh);
      document.removeEventListener("load", debouncedRefresh, true);
      if (timer) clearTimeout(timer);
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
      const dy = Math.abs(window.scrollY - lastY);
      lastY = window.scrollY;
      world.scrollVel = Math.min(1, dy / 36);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Generic scroll parallax for [data-parallax] elements (speed = 0.7–1.6)
  useEffect(() => {
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
          every device (mobile/tablet included). The chunk is deferred off
          first paint: it mounts on first interaction or after a 2.5s idle
          timeout (and never for reduced-motion users), so the landing's
          critical content isn't blocked on the WebGL stack. */}
      <div className="fixed inset-0 z-0">
        {showWorld && (
          <Suspense fallback={<div className="h-full w-full bg-void" />}>
            <WorldCanvas />
          </Suspense>
        )}
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

        {/* ── Auth — the waitlist form replaced with the real login/signup ── */}
        <section
          id="auth-section"
          className="relative overflow-hidden py-28 sm:py-36"
        >
          <div className="pointer-events-none absolute inset-0 halo" />
          <div className="relative z-10 mx-auto max-w-4xl px-6 text-center">
            <Reveal>
              <span className="u-label text-[11px] tracking-[0.22em] text-white/55">
                ( step_through_the_door )
              </span>
            </Reveal>
            <Reveal delay={0.08}>
              <span className="script mt-5 block text-4xl text-white/85 sm:text-5xl">
                {forgotPasswordOpen ? "reset your password" : "walk right in"}
              </span>
            </Reveal>
            <Reveal delay={0.18}>
              <div className="glass relative mx-auto mt-10 overflow-hidden rounded-2xl p-6 text-left sm:p-7">
                {forgotPasswordOpen ? (
                  <ForgotPassword
                    onBackToLogin={onBackToLogin}
                    onSuccess={() => {}}
                  />
                ) : (
                  <Auth
                    initialShowSignup={initialShowSignup}
                    onAuthSuccess={onAuthSuccess}
                    onForgotPasswordClick={onForgotPasswordClick}
                  />
                )}
              </div>
            </Reveal>
          </div>
        </section>

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
