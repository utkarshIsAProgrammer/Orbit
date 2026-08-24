import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  Heart,
  MessageCircle,
  Repeat2,
  Bookmark,
  Plus,
  Mic,
  Send,
  Eye,
  Grid,
  MoreHorizontal,
  Star,
  Camera,
} from "lucide-react";
import { useTilt } from "../hooks/useTilt";
import { useIsDesktop } from "../hooks/useIsDesktop";
import { SectionTitle } from "./SectionTitle";

gsap.registerPlugin(ScrollTrigger);

/* ────────────────────────── media helpers ────────────────────────── */

function MediaBlock({ name, className = "" }: { name: string; className?: string }) {
  const [err, setErr] = useState(false);
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-700 via-zinc-800 to-zinc-950" />
      <div
        className="absolute inset-0 opacity-35"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, rgba(255,255,255,0.06) 0 2px, transparent 2px 16px)",
        }}
      />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15 p-3">
        <Camera className="h-4 w-4 text-white/45" />
      </div>
      {!err && (
        <img
          src={`/screenshots/${name}.png`}
          alt=""
          loading="lazy"
          onError={() => setErr(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );
}

/** Full-bleed background image; falls back to the surface it sits on. */
function BgImage({ name, className = "absolute inset-0 h-full w-full object-cover" }: { name?: string; className?: string }) {
  const [err, setErr] = useState(false);
  if (!name) return null;
  return (
    <img
      src={`/screenshots/${name}.png`}
      alt=""
      loading="lazy"
      onError={() => setErr(true)}
      className={`${className} ${err ? "hidden" : ""}`}
    />
  );
}

/**
 * Whole-screen capture mode: when a real full screenshot of the app screen
 * exists (screen-<name>.png) it covers the entire phone screen, replacing
 * the recreated mockup. Falls back invisibly when the file is missing.
 */
function ScreenShot({ name, onLoaded }: { name?: string; onLoaded?: (v: boolean) => void }) {
  const [err, setErr] = useState(false);
  if (!name) return null;
  return (
    <img
      src={`/screenshots/${name}.png`}
      alt=""
      loading="lazy"
      onLoad={() => onLoaded?.(true)}
      onError={() => setErr(true)}
      className={`absolute inset-0 z-20 h-full w-full object-cover ${err ? "hidden" : ""}`}
    />
  );
}

/* ────────────────────────── device shell ─────────────────────────── */

const HoverCtx = createContext(false);
const useDeviceHover = () => useContext(HoverCtx);

/** Hover-less pointers (phones, tablets) have no hover — devices run live instead. */
const COARSE =
  typeof window !== "undefined" &&
  window.matchMedia("(hover: none), (pointer: coarse)").matches;

function Avatar({ name, className = "h-9 w-9 text-[11px]" }: { name: string; className?: string }) {
  const [err, setErr] = useState(false);
  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-white/10 font-black text-white ${className}`}
    >
      {/* real avatar image when provided (avatar-<name>.png) */}
      {!err && (
        <img
          src={`/screenshots/avatar-${name.toLowerCase()}.png`}
          alt=""
          loading="lazy"
          onError={() => setErr(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {name[0]}
    </span>
  );
}

function RingAvatar({ name, active = false }: { name: string; active?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`rounded-full bg-gradient-to-b p-[2px] ${
          active ? "from-amber to-amber" : "from-zinc-500 to-zinc-700"
        }`}
      >
        <div className="rounded-full bg-[#070708] p-[2.5px]">
          <Avatar name={name} className="h-9 w-9 text-[11px]" />
        </div>
      </div>
      <span className="text-[8px] font-bold uppercase tracking-wider text-white/45">
        {name.toLowerCase()}
      </span>
    </div>
  );
}

interface DeviceShellProps {
  title: string;
  hint: string;
  children: ReactNode;
  tilt?: number;
  rot?: string;
  delay?: string;
  /** optional whole-screen capture name (screen-<name>.png) */
  screen?: string;
}

/** A phone frame: floats, tilts toward the cursor, comes alive on hover. */
function DeviceShell({ title, hint, children, tilt = 9, rot = "0deg", delay = "0s", screen }: DeviceShellProps) {
  const tiltRef = useRef<HTMLDivElement>(null);
  // Touch devices: no hover to trigger the "alive" state, so devices are
  // live from the start — the feed scrolls, chat types, glances advance.
  const [hovered, setHovered] = useState(COARSE);
  const [shot, setShot] = useState(false);
  useTilt(tiltRef, tilt);

  return (
    <HoverCtx.Provider value={hovered}>
      <div className="group/device flex flex-col items-center gap-4">
        <div className="relative">
          <div
            className={`pointer-events-none absolute -inset-8 rounded-full bg-white/[0.05] blur-3xl transition-opacity duration-700 ${
              COARSE ? "opacity-100" : "opacity-0 group-hover/device:opacity-100"
            }`}
          />
          <div className="animate-float" style={{ "--float-rot": rot, animationDelay: delay } as CSSProperties}>
            <div
              ref={tiltRef}
              data-cursor-text="LIVE"
              // touch fires pointerleave on every tap — never attach the
              // enter/leave handlers on coarse pointers so the live state
              // survives interaction (devices stay alive on mobile)
              onPointerEnter={COARSE ? undefined : () => setHovered(true)}
              onPointerLeave={COARSE ? undefined : () => setHovered(false)}
              className="relative h-[560px] w-[272px] rounded-[3rem] border border-white/15 bg-[#0b0b0e]/95 p-[10px] shadow-[0_60px_120px_-40px_rgba(0,0,0,0.95)] backdrop-blur-xl"
            >
              <div className="absolute left-1/2 top-[13px] z-30 h-[20px] w-[92px] -translate-x-1/2 rounded-full bg-black" />
              <div className="relative h-full w-full overflow-hidden rounded-[2.4rem] bg-[#070708]">
                {children}
                {/* whole-screen capture replaces the mockup when present */}
                <ScreenShot name={screen} onLoaded={setShot} />
              </div>
              <div
                className={`absolute left-1/2 top-[54px] z-20 -translate-x-1/2 whitespace-nowrap rounded-full border border-amber/30 bg-black/75 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-white/85 backdrop-blur-md transition-opacity duration-300 ${
                  !COARSE && hovered ? "opacity-0" : "opacity-100"
                }`}
              >
                {shot ? "real capture" : hovered ? `live · ${hint}` : `hover → ${hint}`}
              </div>
            </div>
          </div>
        </div>
        <span className="eyebrow text-amber">{title}</span>
      </div>
    </HoverCtx.Provider>
  );
}

/* ────────────────────────── auto-scroll hook ──────────────────────── */

function useAutoScroll(ref: React.RefObject<HTMLDivElement | null>, speedRef: { current: number }) {
  const y = useRef(0);
  useEffect(() => {
    let id = 0;
    const loop = () => {
      id = requestAnimationFrame(loop);
      const el = ref.current;
      if (!el) return;
      const parent = el.parentElement;
      if (!parent) return;
      const max = Math.max(0, el.scrollHeight - parent.clientHeight);
      y.current -= speedRef.current;
      if (y.current <= -max) y.current = 0;
      el.style.transform = `translateY(${y.current.toFixed(1)}px)`;
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [ref, speedRef]);
}

/* ────────────────────────── FEED screen ───────────────────────────── */

interface Post {
  user: string;
  time: string;
  text: string;
  img?: string;
  poll?: { q: string; options: [string, string]; voted: string };
  likes: string;
  comments: string;
  reposts: string;
  views: string;
}

const POSTS: Post[] = [
  {
    user: "aria",
    time: "2h",
    text: "the night-walk playlist is done — link in bio 🌙",
    img: "feed-1",
    likes: "128",
    comments: "14",
    reposts: "6",
    views: "1.2k",
  },
  {
    user: "kai",
    time: "5h",
    text: "beach or mountains for the retreat? voting ends tonight.",
    poll: { q: "where should we go?", options: ["beach sunrise", "mountain lodge"], voted: "beach sunrise" },
    likes: "342",
    comments: "87",
    reposts: "21",
    views: "4.8k",
  },
  {
    user: "nova",
    time: "8h",
    text: "shot on the new glance cam — 24 hours only 📸",
    img: "feed-2",
    likes: "209",
    comments: "33",
    reposts: "12",
    views: "2.9k",
  },
  {
    user: "leo",
    time: "11h",
    text: "quiet post, loud thoughts. the feed is what you make of it.",
    likes: "87",
    comments: "9",
    reposts: "3",
    views: "940",
  },
];

function FeedScreen() {
  const hovered = useDeviceHover();
  const speed = useRef(0.22);
  const listRef = useRef<HTMLDivElement>(null);
  useAutoScroll(listRef, speed);

  useEffect(() => {
    speed.current = hovered ? 1.35 : 0.2;
  }, [hovered]);

  return (
    <div className="flex h-full flex-col">
      <div className="relative z-10 border-b border-white/[0.07] px-4 pb-2.5 pt-12">
        <div className="flex items-center justify-between">
          <span className="script text-xl text-white">Orbit</span>
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/15 text-white/70">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </span>
        </div>
        <div className="mt-2.5 flex gap-5 text-[11px] font-black uppercase tracking-[0.18em]">
          <span className="text-white">Home</span>
          <span className="text-white/35">For You</span>
        </div>
      </div>

      <div className="z-10 flex gap-3 overflow-hidden px-4 pb-3 pt-2.5">
        <div className="flex flex-col items-center gap-1">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-white/30 text-white/60">
            <Plus className="h-4 w-4" />
          </div>
          <span className="text-[8px] font-bold uppercase tracking-wider text-white/45">add</span>
        </div>
        <RingAvatar name="aria" active />
        <RingAvatar name="kai" />
        <RingAvatar name="nova" />
        <RingAvatar name="leo" />
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div ref={listRef} className="will-change-transform px-3 pb-6">
          {POSTS.map((p, i) => (
            <article key={i} className="mb-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center gap-2.5">
                <Avatar name={p.user} />
                <div className="flex-1">
                  <div className="text-[12px] font-bold text-white">{p.user}</div>
                  <div className="text-[11px] text-white/40">{p.time}</div>
                </div>
                <MoreHorizontal className="h-3.5 w-3.5 text-white/35" />
              </div>

              <p className="mt-2.5 text-[12px] leading-relaxed text-white/85">{p.text}</p>

              {p.img && <MediaBlock name={p.img} className="mt-3 h-36 rounded-xl" />}

              {p.poll && (
                <div className="mt-3 space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-widest text-white/55">
                    {p.poll.q}
                  </div>
                  {p.poll.options.map((o) => {
                    const voted = o === p.poll!.voted;
                    return (
                      <div key={o} className="relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2">
                        <div
                          className={`absolute inset-y-0 left-0 ${voted ? "w-[72%] bg-amber" : "w-[38%] bg-white/20"}`}
                        />
                        <span
                          className={`relative text-[11px] font-semibold ${
                            voted ? "text-black" : "text-white/80"
                          }`}
                        >
                          {o} {voted && "· voted"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5 text-white/55">
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5" />{p.likes}</span>
                  <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" />{p.comments}</span>
                  <span className="flex items-center gap-1"><Repeat2 className="h-3.5 w-3.5" />{p.reposts}</span>
                </div>
                <span className="flex items-center gap-1 text-[11px]">
                  <Eye className="h-3.5 w-3.5" /> {p.views}
                </span>
              </div>
            </article>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#070708] to-transparent" />
      </div>
    </div>
  );
}

/* ────────────────────────── CHAT screen ───────────────────────────── */

interface Msg {
  from: "me" | "them";
  kind?: "text" | "voice";
  text?: string;
  dur?: string;
}

const SCRIPT: Msg[] = [
  { from: "them", text: "did you see the new glance?" },
  { from: "me", text: "yes!! the drawing on it 🤍" },
  { from: "them", text: "wanna jump on a quick call?" },
  { from: "me", text: "give me two minutes" },
  { from: "them", kind: "voice", dur: "0:14" },
  { from: "me", text: "on my way 💨" },
  { from: "them", text: "brilliant — same energy as the feed 😌" },
];

function ChatScreen() {
  const hovered = useDeviceHover();
  const [visible, setVisible] = useState(2);
  const [typing, setTyping] = useState(false);
  const idx = useRef(2);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hovered) {
      setTyping(false);
      return;
    }
    let iv: number | undefined;
    let t: number | undefined;
    const tick = () => {
      if (idx.current >= SCRIPT.length) idx.current = 2;
      const next = idx.current;
      setTyping(true);
      t = window.setTimeout(() => {
        setVisible(next + 1);
        setTyping(false);
        idx.current = next + 1;
      }, 950);
      iv = window.setTimeout(tick, 2700);
    };
    iv = window.setTimeout(tick, 700);
    return () => {
      window.clearTimeout(iv);
      if (t) window.clearTimeout(t);
      setTyping(false);
    };
  }, [hovered]);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible, typing]);

  const msgs = SCRIPT.slice(0, visible);

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-[#0d0d11] to-black">
      <div className="relative z-10 overflow-hidden border-b border-white/[0.07] px-4 pb-3 pt-12">
        {/* real community cover when provided */}
        <BgImage name="community-1" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/70 via-black/25 to-[#0d0d11]/85" />
        <div className="relative flex items-center gap-2.5">
          <Avatar name="nova" />
          <div className="flex-1">
            <div className="text-[12px] font-bold text-white">nova</div>
            <div className="flex items-center gap-1 text-[11px] text-white/50">
              <span className="h-1.5 w-1.5 animate-pulse-soft bg-amber" />
              online now
            </div>
          </div>
          <MoreHorizontal className="h-4 w-4 text-white/40" />
        </div>
      </div>

      <div ref={boxRef} className="flex-1 overflow-y-auto px-3.5 py-3">
        <div className="flex flex-col gap-2.5">
          {msgs.map((m, i) =>
            m.kind === "voice" ? (
              <div key={i} className="flex items-center gap-2 self-end rounded-2xl rounded-br-md bg-white/[0.12] px-3.5 py-2.5">
                <Mic className="h-3.5 w-3.5 text-white/80" />
                <div className="flex h-4 items-end gap-[3px]">
                  {[0.6, 0.95, 0.5, 1, 0.7, 0.4, 0.85].map((h, k) => (
                    <span
                      key={k}
                      className="w-[3px] origin-bottom animate-wave rounded-sm bg-amber"
                      style={{ height: `${h * 100}%`, animationDelay: `${k * 0.08}s`, animationDuration: `${0.9 + (k % 3) * 0.16}s` }}
                    />
                  ))}
                </div>
                <span className="ml-1 text-[11px] text-white/60">{m.dur}</span>
              </div>
            ) : (
              <div
                key={i}
                className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[12px] leading-snug ${
                  m.from === "me"
                    ? "ml-auto rounded-br-md bg-white text-black"
                    : "self-start rounded-bl-md bg-white/[0.08] text-white/85"
                }`}
              >
                {m.text}
              </div>
            ),
          )}
          {typing && (
            <div className="flex w-max items-center gap-[3px] rounded-2xl rounded-bl-md bg-white/[0.08] px-3.5 py-3">
              {[0, 1, 2].map((k) => (
                <span
                  key={k}
                  className="h-3 w-[3px] origin-bottom animate-wave rounded-sm bg-amber"
                  style={{ animationDelay: `${k * 0.15}s` }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="z-10 border-t border-white/[0.07] px-3.5 py-3">
        <div className="glass flex items-center gap-2 rounded-full px-4 py-2.5">
          <span className="flex-1 text-[12px] text-white/45">message…</span>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber text-black">
            <Send className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────── GLANCE screen ─────────────────────────── */

interface Slide {
  bg: string;
  dark: boolean;
  big: string;
  sub: string;
  script: boolean;
  /** optional real glance background image (glance-1/2/3.png) */
  img?: string;
}

const SLIDES: Slide[] = [
  { bg: "bg-gradient-to-b from-zinc-200 via-zinc-300 to-zinc-400", dark: true, big: "good morning", sub: "aria · 2h", script: true, img: "glance-1" },
  { bg: "bg-gradient-to-b from-zinc-700 via-zinc-800 to-black", dark: false, big: "mood: monochrome", sub: "aria · 1h", script: false, img: "glance-2" },
  { bg: "bg-gradient-to-b from-black via-zinc-900 to-zinc-800", dark: false, big: "24h", sub: "fades at midnight", script: false, img: "glance-3" },
];

function GlanceScreen() {
  const hovered = useDeviceHover();
  const boxRef = useRef<HTMLDivElement>(null);
  const locked = useRef(false);
  const resumeTimer = useRef<number | undefined>(undefined);

  // When the device is alive (desktop hover, or always-on touch) gently
  // cruise through the glances so it feels real. The moment the visitor
  // wheels or touches, control is handed back; after a short idle pause
  // the cruise quietly resumes. The stack stays fully scrollable (the
  // scrollbar is hidden, not removed) so every glance is reachable.
  useEffect(() => {
    if (!hovered) return;
    locked.current = false;
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const el = boxRef.current;
      if (!el || locked.current) return;
      // frame-rate independent: ~17px/s on any display
      if (last) el.scrollTop += 0.28 * ((now - last) / 16.667);
      last = now;
      if (el.scrollTop >= el.scrollHeight - el.clientHeight - 1) el.scrollTop = 0;
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(resumeTimer.current);
    };
  }, [hovered]);

  // Hand scroll control back to the visitor; hand it back to the
  // auto-cruise once they go idle (touch devices have no hover, so this
  // is how the glance keeps feeling alive on phones).
  const handBack = () => {
    locked.current = true;
    window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => {
      locked.current = false;
    }, 1600);
  };

  return (
    <div
      ref={boxRef}
      onWheel={handBack}
      onTouchStart={handBack}
      onTouchMove={handBack}
      onTouchEnd={handBack}
      onPointerDown={handBack}
      className="no-scrollbar h-full w-full overflow-y-auto overscroll-contain"
    >
      {SLIDES.map((s, i) => (
        <div key={i} className={`relative min-h-full w-full ${s.bg}`}>
          {/* real glance background when provided */}
          <BgImage name={s.img} />
          {s.dark && <div className="pointer-events-none absolute inset-0 bg-black/10" />}

          {/* glance indicator — how many glances are in the stack */}
          <div className="absolute inset-x-4 top-12 z-10 flex gap-1.5">
            {SLIDES.map((_, k) => (
              <span
                key={k}
                className={`h-[3px] flex-1 rounded-full ${k <= i ? "bg-white/90" : "bg-white/25"}`}
              />
            ))}
          </div>

          <div className="absolute left-4 top-20 z-10 flex items-center gap-2">
            <Avatar name="aria" className="h-7 w-7 text-[11px]" />
            <span className={`text-[11px] font-bold tracking-wide ${s.dark ? "text-black/80" : "text-white/90"}`}>
              aria <span className={s.dark ? "text-black/50" : "text-white/50"}>· {i + 1}/{SLIDES.length}</span>
            </span>
          </div>

          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-8 text-center">
            <div className={`headline ${s.script ? "italic" : ""} text-4xl ${s.dark ? "text-black/90" : "text-white/90"}`}>
              {s.big}
            </div>
            <div className={`mx-auto mt-3 h-px w-16 ${s.dark ? "bg-black/30" : "bg-white/30"}`} />
            <div className={`mt-2 text-[11px] ${s.dark ? "text-black/60" : "text-white/55"}`}>{s.sub}</div>
          </div>

          {i === 0 && (
            <svg className="absolute inset-0 h-full w-full opacity-60" viewBox="0 0 272 560" fill="none">
              <path d="M40 430 Q 90 370 140 410 T 235 395" stroke="black" strokeWidth="2.5" strokeLinecap="round" opacity="0.55" />
              <circle cx="200" cy="130" r="28" stroke="black" strokeWidth="1.5" opacity="0.4" />
            </svg>
          )}

          {/* soft fade into the next glance */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/25 to-transparent" />

          <div className="absolute inset-x-4 bottom-5 z-10 flex items-center justify-between">
            <div className={`rounded-full px-3.5 py-2 text-[11px] font-semibold ${s.dark ? "bg-black/10 text-black/70 backdrop-blur-md" : "bg-white/10 text-white/80 backdrop-blur-md"}`}>
              reply privately…
            </div>
            <span className={`flex h-9 w-9 items-center justify-center rounded-full ${s.dark ? "bg-black text-white" : "bg-amber text-black"}`}>
              <Send className="h-4 w-4" />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────── PROFILE screen ────────────────────────── */

// Doubled so the grid overflows the screen — that's what makes the
// profile "browse" (auto-scroll) instead of sitting static.
const TILES: { img?: string; icon?: ReactNode }[] = [
  { img: "profile-1" },
  { icon: <Star className="h-4 w-4 text-white/60" /> },
  { icon: <Heart className="h-4 w-4 text-white/60" /> },
  { icon: <Bookmark className="h-4 w-4 text-white/60" /> },
  { img: "profile-2" },
  { icon: <Grid className="h-4 w-4 text-white/60" /> },
  { icon: <Star className="h-4 w-4 text-white/60" /> },
  { img: "profile-3" },
  { icon: <Heart className="h-4 w-4 text-white/60" /> },
  { icon: <Bookmark className="h-4 w-4 text-white/60" /> },
  { img: "profile-1" },
  { icon: <Grid className="h-4 w-4 text-white/60" /> },
  { icon: <Star className="h-4 w-4 text-white/60" /> },
  { icon: <Heart className="h-4 w-4 text-white/60" /> },
  { img: "profile-2" },
  { icon: <Bookmark className="h-4 w-4 text-white/60" /> },
  { icon: <Grid className="h-4 w-4 text-white/60" /> },
  { img: "profile-3" },
];

function ProfileScreen() {
  const hovered = useDeviceHover();
  const speed = useRef(0.18);
  const gridRef = useRef<HTMLDivElement>(null);
  useAutoScroll(gridRef, speed);

  useEffect(() => {
    speed.current = hovered ? 1.1 : 0.15;
  }, [hovered]);

  return (
    <div className="flex h-full flex-col bg-[#070708]">
      <div className="relative z-10 pt-12">
        <div className="h-24 bg-gradient-to-br from-zinc-700 via-zinc-800 to-zinc-950">
          <MediaBlock name="banner" className="h-full w-full" />
        </div>
      </div>

      <div className="z-10 -mt-9 px-4">
        <div className="flex items-end justify-between">
          <div className="rounded-full border-[3px] border-[#070708]">
            <Avatar name="aria" className="h-16 w-16 text-lg" />
          </div>
          <div className="mb-1 flex gap-2">
            <span className="glass rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-white/80">Edit</span>
            <span className="glass rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-white/80">Share</span>
          </div>
        </div>
        <div className="mt-2.5">
          <div className="text-[14px] font-black text-white">Aria Chen</div>
          <div className="text-[11px] text-white/40">@aria · writer of quiet posts</div>
        </div>
        <div className="mt-2.5 flex gap-4 text-[11px] text-white/60">
          <span><b className="text-white">12</b> posts</span>
          <span><b className="text-white">1.4k</b> followers</span>
          <span><b className="text-white">89</b> following</span>
        </div>
      </div>

      <div className="z-10 mt-4 grid grid-cols-3 border-b border-white/[0.08] text-center text-[11px] font-black uppercase tracking-[0.16em]">
        <span className="border-b-2 border-amber pb-2 text-white">Posts</span>
        <span className="pb-2 text-white/35">Saved</span>
        <span className="pb-2 text-white/35">Reposts</span>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div ref={gridRef} className="grid grid-cols-3 gap-1 px-1 pt-1 will-change-transform">
          {TILES.map((t, i) => (
            <div key={i} className="relative aspect-square overflow-hidden rounded-md bg-zinc-900">
              {t.img ? (
                <MediaBlock name={t.img} className="h-full w-full" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-950">
                  {t.icon}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#070708] to-transparent" />
      </div>
    </div>
  );
}

/* ────────────────────────── MAIN SHOWCASE ─────────────────────────── */

export default function Showcase() {
  const isDesktop = useIsDesktop(768);
  const pinRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Pinned horizontal gallery (desktop): scroll → devices glide sideways
  useEffect(() => {
    if (!isDesktop) return;
    const track = trackRef.current;
    const section = pinRef.current;
    if (!track || !section) return;
    const dist = () => track.scrollWidth - window.innerWidth;
    const tween = gsap.to(track, {
      x: () => -dist(),
      ease: "none",
      scrollTrigger: {
        trigger: section,
        start: "top top",
        end: () => "+=" + dist(),
        scrub: 1,
        pin: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          if (barRef.current) barRef.current.style.transform = `scaleX(${self.progress})`;
        },
      },
    });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [isDesktop]);

  const device = (title: string, hint: string, rot: string, delay: string, tilt: number, screen: string, el: ReactNode) => (
    <div className={isDesktop ? "flex w-[34vw] max-w-[560px] min-w-[340px] shrink-0 justify-center" : "flex justify-center"}>
      <DeviceShell title={title} hint={hint} rot={rot} delay={delay} tilt={tilt} screen={screen}>
        {el}
      </DeviceShell>
    </div>
  );

  return (
    <section id="preview" className="relative overflow-hidden pt-28 sm:pt-36">
      <div className="pointer-events-none absolute left-1/2 top-32 h-[600px] w-[900px] -translate-x-1/2 rounded-full halo blur-2xl" />

      <div className="mx-auto max-w-6xl px-5 sm:px-10">
        <SectionTitle
          index="05"
          eyebrow="the devices"
          title="See it live,"
          italic="on your screen."
          sub="Real Orbit, in the phone and desktop you already own — hover and watch the feed scroll, the chat type and the glances slide."
        />
      </div>

      <div
        ref={pinRef}
        className={
          isDesktop ? "relative mt-14 flex h-screen items-center overflow-hidden" : "relative mt-14"
        }
      >
        <div
          ref={trackRef}
          className={
            isDesktop
              ? "flex items-center gap-10 pl-[6vw] pr-[12vw] will-change-transform"
              : "flex flex-col items-center gap-16 px-6"
          }
        >
          {isDesktop && (
            <div className="w-[26vw] shrink-0 pr-4">
              <span className="eyebrow text-amber">01 — four screens</span>
              <h3 className="headline mt-4 text-4xl text-ink sm:text-5xl">one calm home.</h3>
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-mist">
                The real Orbit screens, recreated pixel by pixel. Hover — they come alive.
              </p>
            </div>
          )}

          {device("Live Feed", "the feed scrolls", "-2deg", "0s", 9, "screen-feed", <FeedScreen />)}
          {device("Direct Chat", "messages appear", "1.5deg", "-2.4s", 11, "screen-chat", <ChatScreen />)}
          {device("Glances", "scroll for more", "-1deg", "-5s", 9, "screen-glance", <GlanceScreen />)}
          {device("Profile", "profile browses", "2deg", "-1.2s", 12, "screen-profile", <ProfileScreen />)}
        </div>

        {isDesktop && (
          <div className="absolute inset-x-[6vw] bottom-12 h-px bg-white/10">
            <div ref={barRef} className="h-full origin-left scale-x-0 bg-gradient-to-r from-amber via-rose to-violet" />
          </div>
        )}
      </div>

    </section>
  );
}
