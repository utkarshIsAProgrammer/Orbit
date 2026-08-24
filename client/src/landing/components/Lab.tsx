import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  Plus,
  Sparkles,
  Smile,
  Music2,
  Camera,
  HeartHandshake,
  MessagesSquare,
  PartyPopper,
} from "lucide-react";
import { SplitWords } from "./SplitWords";
import { useReducedMotion } from "../hooks/useReducedMotion";

gsap.registerPlugin(ScrollTrigger);

const MAX_MEMBERS = 6; // the circle can grow to six friends
const START_MEMBERS = 3;

// SVG stage geometry (viewBox 0 0 800 600)
const CX = 400;
const CY = 300;
const RX = 250; // ellipse radii — slightly flattened for a hint of depth
const RY = 150;

// each friend wears a little symbol of their vibe — smile, music, photos,
// a warm hello — used only as a fallback while their real photo loads
const VIBES = [Smile, Music2, Camera, HeartHandshake, MessagesSquare, PartyPopper];

// Real profile photos — drop your own at public/screenshots/avatars/
// (avatar-aria.png etc.). Rendered as clean circular photos, no tile.
const AVATARS = [
  "/screenshots/avatars/avatar-aria.png",
  "/screenshots/avatars/avatar-kai.png",
  "/screenshots/avatars/avatar-nova.png",
  "/screenshots/avatars/avatar-leo.png",
  "/screenshots/avatars/avatar-5.png",
  "/screenshots/avatars/avatar-6.png",
];

/** Renders a lucide icon inside the 20×20 SVG box of an avatar tile. */
function VibeIcon({ i }: { i: number }) {
  const Icon = VIBES[i % VIBES.length];
  return (
    <Icon size={20} strokeWidth={2} className="vibe-icon" aria-hidden />
  );
}

/** Point on the ellipse for an angle (radians). */
const pos = (angle: number) => ({
  x: CX + Math.cos(angle) * RX,
  y: CY + Math.sin(angle) * RY,
});

/* ────────────────────────── the 2D community ──────────────────────── */

/**
 * A living community made of light and type: a constellation of avatar
 * tiles on a dashed conversation-ring around a warm core. Click to invite
 * someone new — the ring makes room, a pulse travels to them, and they
 * grow in. Scroll turns the circle, the mouse leans it. Pure SVG + GSAP —
 * no 3D.
 */
export function Lab() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<SVGGElement>(null);
  const pulseRef = useRef<SVGGElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const outerRefs = useRef<(SVGGElement | null)[]>([]);
  const innerRefs = useRef<(SVGGElement | null)[]>([]);
  const flashRefs = useRef<(SVGCircleElement | null)[]>([]);
  const spokeRefs = useRef<(SVGLineElement | null)[]>([]);
  const angles = useRef<number[]>(
    Array.from(
      { length: MAX_MEMBERS },
      (_, i) => (i / START_MEMBERS) * Math.PI * 2 - Math.PI / 2,
    ),
  );

  const active = useRef(START_MEMBERS);
  const joined = useRef(0);
  const events = useRef(0);
  const consumed = useRef(0);
  const visible = useRef(true);
  const progress = useRef(0);
  const rotation = useRef(0);
  const leanX = useRef(0);
  const leanY = useRef(0);
  const pointer = useRef({ x: 0, y: 0 });

  const reduced = useReducedMotion();

  // Pause the animation entirely while the section is off-screen.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        visible.current = entry.isIntersecting;
      },
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Scroll-scrub → rotation progress + the gold hairline.
  useEffect(() => {
    if (reduced) return;
    const section = sectionRef.current;
    if (!section) return;
    const st = ScrollTrigger.create({
      trigger: section,
      start: "top top",
      end: "bottom bottom",
      scrub: 0.5,
      onUpdate: (self) => {
        progress.current = self.progress;
        if (barRef.current)
          barRef.current.style.transform = `scaleX(${self.progress.toFixed(4)})`;
      },
    });
    return () => st.kill();
  }, [reduced]);

  // Place every avatar + spoke (refs are assigned during render).
  const layout = (animate: boolean) => {
    for (let i = 0; i < MAX_MEMBERS; i++) {
      const outer = outerRefs.current[i];
      if (!outer) continue;
      const p = pos(angles.current[i]);
      if (animate) {
        gsap.to(outer, {
          x: p.x,
          y: p.y,
          duration: 0.9,
          ease: "power3.inOut",
          overwrite: "auto", // rapid invites: last reflow wins, no jitter
        });
      } else {
        gsap.set(outer, { x: p.x, y: p.y });
      }
      const spoke = spokeRefs.current[i];
      if (spoke) {
        const to = i < active.current ? p : { x: CX, y: CY };
        if (animate) {
          gsap.to(spoke, {
            attr: { x1: CX, y1: CY, x2: to.x, y2: to.y },
            duration: 0.9,
            ease: "power3.inOut",
            overwrite: "auto",
          });
        } else {
          gsap.set(spoke, { attr: { x1: CX, y1: CY, x2: to.x, y2: to.y } });
        }
      }
    }
  };

  // Initial placement + the opening grow-in + idle float.
  useEffect(() => {
    layout(false);
    if (reduced) return;
    const ctx = gsap.context(() => {
      for (let i = 0; i < START_MEMBERS; i++) {
        const inner = innerRefs.current[i];
        if (!inner) continue;
        gsap.fromTo(
          inner,
          { scale: 0 },
          { scale: 1, duration: 0.7, delay: 0.25 + i * 0.14, ease: "back.out(2.2)" },
        );
        gsap.to(inner, {
          y: 7,
          duration: 2.1 + (i % 3) * 0.6,
          yoyo: true,
          repeat: -1,
          ease: "sine.inOut",
          delay: i * 0.35,
        });
      }
    });
    return () => ctx.revert(); // StrictMode-safe: no orphaned infinite tweens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  // Send a pulse from the core to a member (invitation / wave).
  const firePulse = (toIdx: number) => {
    const p = pulseRef.current;
    if (!p) return;
    const target = pos(angles.current[toIdx] + (rotation.current * Math.PI) / 180);
    gsap.killTweensOf(p);
    gsap.set(p, { opacity: 1 });
    const state = { v: 0 };
    gsap.to(state, {
      v: 1,
      duration: 0.85,
      ease: "power2.inOut",
      onUpdate: () => {
        const t = state.v;
        const x = CX + (target.x - CX) * t;
        const y = CY + (target.y - CY) * t;
        const arc = Math.sin(t * Math.PI) * 34; // soft lift in the middle
        p.setAttribute(
          "transform",
          `translate(${x.toFixed(1)} ${(y - arc).toFixed(1)})`,
        );
        p.setAttribute("opacity", String(Math.sin(t * Math.PI) * 0.95));
      },
      onComplete: () => gsap.set(p, { opacity: 0 }),
    });
  };

  // Someone new grows into the circle.
  const growIn = (idx: number) => {
    const outer = outerRefs.current[idx];
    const inner = innerRefs.current[idx];
    const flash = flashRefs.current[idx];
    if (!outer || !inner || !flash) return;
    gsap.set(outer, { opacity: 1 });
    gsap.fromTo(
      inner,
      { scale: 0 },
      { scale: 1, duration: 0.75, ease: "back.out(2.2)" },
    );
    gsap.fromTo(
      flash,
      { opacity: 0.95, scale: 1 },
      { opacity: 0, scale: 1.55, duration: 0.9, ease: "power2.out" },
    );
  };

  // The master ticker: consume invites, spin with scroll, lean with mouse.
  useEffect(() => {
    if (reduced) return;
    const tick = () => {
      // consume invites/buttons — always, even as the section scrolls
      // off-screen, so queued invites are never lost
      while (consumed.current < events.current) {
        consumed.current++;
        joined.current++;
        if (active.current < MAX_MEMBERS) {
          const idx = active.current;
          active.current++;
          // make room — reflow to even spacing
          for (let i = 0; i < active.current; i++) {
            angles.current[i] = (i / active.current) * Math.PI * 2 - Math.PI / 2;
          }
          layout(true);
          growIn(idx);
          firePulse(idx);
        } else {
          firePulse((Math.random() * active.current) | 0);
        }
      }

      if (!visible.current) return; // paused off-screen (after consuming)

      const wrap = wrapRef.current;
      if (!wrap) return;
      // damp toward scroll progress + pointer lean
      const targetRot = progress.current * 360 + pointer.current.x * 16;
      const targetLeanX = pointer.current.x * 12;
      const targetLeanY = pointer.current.y * 8;
      rotation.current += (targetRot - rotation.current) * 0.06;
      leanX.current += (targetLeanX - leanX.current) * 0.07;
      leanY.current += (targetLeanY - leanY.current) * 0.07;
      wrap.setAttribute(
        "transform",
        `rotate(${rotation.current.toFixed(2)} ${CX} ${CY}) translate(${leanX.current.toFixed(1)} ${leanY.current.toFixed(1)})`,
      );
    };
    gsap.ticker.add(tick);
    return () => {
      gsap.ticker.remove(tick);
    };
  }, [reduced]);

  const handleStageDown = (e: React.PointerEvent) => {
    // mouse clicks on the community invite someone in; touch taps scroll
    // instead (the buttons below handle touch invites)
    if (e.pointerType === "mouse") events.current++;
  };
  const handleStageMove = (e: React.PointerEvent) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    pointer.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.current.y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
  };

  return (
    <section id="lab" ref={sectionRef} className="relative h-[170vh] md:h-[210vh]">
      <div className="sticky top-0 flex h-screen flex-col items-center justify-center overflow-hidden">
        {/* the community — pure SVG, no 3D. Hidden on mobile/tablet: the
            people-figure with real photos is a desktop treat, so small
            screens keep the copy, buttons and counters without the figure. */}
        <div
          ref={stageRef}
          onPointerDown={handleStageDown}
          onPointerMove={handleStageMove}
          className="absolute inset-0"
          data-cursor-text="invite"
        >
          {/* warm core light */}
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-[220px] w-[340px] -translate-x-1/2 -translate-y-1/2 animate-pulse-soft rounded-full blur-xl md:h-[300px] md:w-[460px] md:blur-2xl"
            style={{
              background:
                "radial-gradient(ellipse at center, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.08) 45%, transparent 72%)",
            }}
          />

          {/* the figure scales to fit small screens (mobile/tablet) and fills
              the stage on desktop — same smooth animation everywhere */}
          <svg
            viewBox="0 0 800 600"
            className="absolute inset-0 m-auto h-full max-h-full w-full max-w-[340px] sm:max-w-[440px] md:max-w-none"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <radialGradient id="lab-avatar-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(255,244,214,0.85)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0)" />
              </radialGradient>
              {/* circular crop mask for the real profile photos */}
              <clipPath id="lab-avatar-clip">
                <circle cx="0" cy="0" r="25" />
              </clipPath>
            </defs>

            {/* the conversation-ring — dashes flow around the circle */}
            <ellipse cx={CX} cy={CY} rx={RX} ry={RY} className="lab-ring" />

            {/* spokes — each person to the shared core */}
            {Array.from({ length: MAX_MEMBERS }, (_, i) => (
              <line
                key={`s${i}`}
                ref={(el) => {
                  spokeRefs.current[i] = el;
                }}
                x1={CX}
                y1={CY}
                x2={CX}
                y2={CY}
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="1.5"
              />
            ))}

            {/* traveling pulse — an invitation on its way */}
            <g ref={pulseRef} opacity="0">
              <rect
                x="-9"
                y="-9"
                width="18"
                height="18"
                rx="5"
                fill="#fff6e0"
                opacity="0.9"
              />
              <text
                x="0"
                y="4"
                textAnchor="middle"
                fontSize="11"
                fill="#0b0a06"
                fontWeight="800"
              >
                ✦
              </text>
            </g>

            {/* the friends — rotate with scroll, lean with the mouse */}
            <g ref={wrapRef} className="will-change-transform">
              {Array.from({ length: MAX_MEMBERS }, (_, i) => (
                <g
                  key={i}
                  ref={(el) => {
                    outerRefs.current[i] = el;
                  }}
                  opacity={i < START_MEMBERS ? 1 : 0}
                >
                  <g
                    ref={(el) => {
                      innerRefs.current[i] = el;
                    }}
                  >
                    {/* warm pool of light beneath */}
                    <ellipse
                      cx="0"
                      cy="34"
                      rx="24"
                      ry="7"
                      fill="url(#lab-avatar-glow)"
                      opacity="0.55"
                    />
                    {/* fallback disc + vibe icon — only visible while the
                        photo loads (or if a drop-in is missing) */}
                    <circle cx="0" cy="0" r="25" fill="#1c1c20" />
                    <g transform="translate(-10 -10)" color="#ffffff" opacity="0.85">
                      <VibeIcon i={i} />
                    </g>
                    {/* the real profile photo — plain, no container */}
                    <image
                      href={AVATARS[i % AVATARS.length]}
                      x="-25"
                      y="-25"
                      width="50"
                      height="50"
                      clipPath="url(#lab-avatar-clip)"
                      preserveAspectRatio="xMidYMid slice"
                    />
                  </g>
                  {/* join flash — a soft ring hugging the round photo */}
                  <circle
                    ref={(el) => {
                      flashRefs.current[i] = el;
                    }}
                    cx="0"
                    cy="0"
                    r="25"
                    fill="none"
                    stroke="#ffe9b0"
                    strokeWidth="2"
                    opacity="0"
                  />
                </g>
              ))}
            </g>
          </svg>
        </div>

        {/* readability vignette */}
        <div className="pointer-events-none absolute inset-0 vignette opacity-60" />

        {/* overlay UI */}
        <div className="pointer-events-none relative z-10 flex h-full w-full flex-col items-center justify-between px-6 py-12 sm:py-14">
          <span className="u-label text-[11px] text-white/45">( your_inner_circle )</span>

          <div className="flex flex-col items-center text-center">
            <h2 className="headline text-6xl leading-[0.95] text-white sm:text-8xl">
              <SplitWords as="span" text="YOUR PEOPLE" mixOutline />
              <SplitWords as="span" text="are already" italic="here." className="mt-2 block" />
            </h2>
            <p className="mt-6 max-w-sm text-sm leading-relaxed text-mist">
              A circle of friends around one warm light. Move your mouse —
              they lean in. Click — someone new joins the circle.
            </p>

            {/* the two action buttons sit right under the copy so they
                stay close to the content instead of floating far away */}
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => events.current++}
                className="glass-strong pointer-events-auto flex items-center gap-2 rounded-full px-5 py-2.5 text-[11px] font-black uppercase tracking-[0.2em] text-white transition-all duration-300 hover:border-amber/50 hover:bg-amber/10 hover:text-amber"
              >
                <Plus className="h-3.5 w-3.5" /> invite a friend
              </button>
              <button
                onClick={() => events.current++}
                className="glass-strong pointer-events-auto flex items-center gap-2 rounded-full px-5 py-2.5 text-[11px] font-black uppercase tracking-[0.2em] text-white transition-all duration-300 hover:border-amber/50 hover:bg-amber/10 hover:text-amber"
              >
                <Sparkles className="h-3.5 w-3.5" /> send a wave
              </button>
            </div>
          </div>

        </div>

        {/* scroll-scrub progress hairline */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[2px] bg-white/[0.07]">
          <div
            ref={barRef}
            className="h-full origin-left scale-x-0 bg-gradient-to-r from-amber via-rose to-white/70"
          />
        </div>
      </div>
    </section>
  );
}
