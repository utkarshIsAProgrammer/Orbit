import {
  Feather,
  Clock,
  CalendarClock,
  MessagesSquare,
  PhoneCall,
  Mic,
  UsersRound,
  ShieldCheck,
  Trophy,
  Globe,
  type LucideIcon,
} from "lucide-react";
import { Reveal } from "./Reveal";
import { LinesReveal } from "./LinesReveal";
import { Parallax } from "./Parallax";

interface ChapterFeature {
  icon: LucideIcon;
  label: string;
}

interface Chapter {
  id: string;
  eyebrow: string;
  title: string;
  titleItalic: string;
  body: string;
  features: ChapterFeature[];
  align: "left" | "right";
}

const CHAPTERS: Chapter[] = [
  {
    id: "01",
    eyebrow: "Share",
    title: "Share what",
    titleItalic: "matters.",
    body: "Drop a thought, run a poll, or capture a 24-hour Glance with your own words and drawings. Post it, and it's gone by midnight — no archive of awkward moments following you around.",
    features: [
      { icon: Feather, label: "Posts, media & polls" },
      { icon: Clock, label: "24-hour Glances — draw on them" },
      { icon: CalendarClock, label: "Schedule or draft, post later" },
    ],
    align: "left",
  },
  {
    id: "02",
    eyebrow: "Connect",
    title: "Conversations that",
    titleItalic: "feel alive.",
    body: "Chat that types, calls that connect in one tap, voice notes that sound like you. Every conversation stays between the people in it — never sold, never surfaced for engagement.",
    features: [
      { icon: MessagesSquare, label: "Real-time chat — typing & presence" },
      { icon: PhoneCall, label: "1-on-1 & group calls" },
      { icon: Mic, label: "Voice notes, GIFs & reactions" },
    ],
    align: "right",
  },
  {
    id: "03",
    eyebrow: "Belong",
    title: "Find your",
    titleItalic: "people.",
    body: "Invite-only communities, close-friends lists, and controls that keep the noise out. Read offline, translate any message in one tap, and let streaks keep your circle warm.",
    features: [
      { icon: UsersRound, label: "Communities & close friends" },
      { icon: Globe, label: "Follow the open web — Bluesky, Mastodon & more" },
      { icon: ShieldCheck, label: "Private by default — block, mute, report" },
      { icon: Trophy, label: "XP, streaks & daily missions" },
    ],
    align: "left",
  },
];

function ChapterBlock({ c }: { c: Chapter }) {
  const left = c.align === "left";
  return (
    // tall cinematic sections on desktop; compact on mobile (no dead gaps)
    <section className="relative min-h-[72vh] w-full overflow-hidden sm:min-h-[115vh]">
      {/* readability scrim on the text side */}
      {left ? (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-[52%] bg-gradient-to-r from-void via-void/85 to-transparent sm:w-[46%]" />
      ) : (
        <div className="pointer-events-none absolute inset-y-0 right-0 w-[52%] bg-gradient-to-l from-void via-void/85 to-transparent sm:w-[46%]" />
      )}

      {/* giant parallax chapter number — storytelling depth */}
      <Parallax speed={-0.3} className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className={`absolute top-1/2 -translate-y-1/2 ${left ? "right-[-3vw]" : "left-[-3vw]"}`}>
          <span className="headline text-outline text-[38vh] leading-none opacity-[0.11]">
            {c.id}
          </span>
        </div>
      </Parallax>

      <div className="relative z-10 mx-auto flex min-h-[72vh] w-full max-w-7xl items-center px-6 sm:min-h-[115vh] sm:px-10">
        <div
          data-parallax="1.2"
          className={`w-full max-w-xl ${left ? "" : "ml-auto text-right"}`}
        >
          <Reveal>
            <div
              className={`flex items-center gap-4 ${left ? "" : "flex-row-reverse"}`}
            >
              <span className="h-px w-10 bg-white/25" />
              <span className="u-label text-[11px] text-white/60">
                ( {c.id}_{c.eyebrow.toLowerCase()} )
              </span>
            </div>
          </Reveal>

          <div className="mt-6">
            <LinesReveal
              lines={[c.title, c.titleItalic]}
              italic={[1]}
              className="headline text-5xl text-white sm:text-6xl md:text-7xl"
            />
          </div>

          <Reveal delay={0.16}>
            <p className={`mt-6 max-w-md text-sm leading-relaxed text-mist ${left ? "" : "ml-auto"}`}>
              {c.body}
            </p>
          </Reveal>

          <div className={`mt-9 flex flex-col gap-3 ${left ? "" : "items-end"}`}>
            {c.features.map((f, i) => (
              <Reveal key={f.label} delay={0.22 + i * 0.08}>
                <div
                  className={`glass flex items-center gap-3 rounded-2xl px-4 py-3 transition-all duration-300 hover:border-amber/30 hover:bg-amber/[0.06] ${
                    left ? "" : "flex-row-reverse"
                  }`}
                >
                  <f.icon className="h-4 w-4 text-amber" />
                  <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/85">
                    {f.label}
                  </span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function Chapters() {
  return (
    <section id="story" className="relative">
      {CHAPTERS.map((c) => (
        <ChapterBlock key={c.id} c={c} />
      ))}
    </section>
  );
}
