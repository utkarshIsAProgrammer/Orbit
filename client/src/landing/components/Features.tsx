import { ArrowUpRight } from "lucide-react";
import { Reveal } from "./Reveal";
import { SectionTitle } from "./SectionTitle";

interface Service {
  n: string;
  title: string;
  label: string;
  desc: string;
  chips: string[];
}

/* Every feature family in the app — from the real FEATURES.md catalog. */
const SERVICES: Service[] = [
  {
    n: "01",
    title: "Glances",
    label: "( 24-hour stories )",
    desc: "Share a moment, draw on it, let it go at midnight. The memory stays, the noise doesn't.",
    chips: [
      "photo & video",
      "text & finger drawing",
      "zoom & reposition",
      "close-friends audience",
      "emoji reactions",
      "viewers list",
      "reply → DM",
      "24h auto-expiry",
    ],
  },
  {
    n: "02",
    title: "Posts & Polls",
    label: "( rich publishing )",
    desc: "Publish your way — text, media, polls, scheduled, drafted. Hashtags and mentions find their people.",
    chips: [
      "up to 10 images",
      "video posts",
      "polls with expiry",
      "hashtags & mentions",
      "quote reposts",
      "scheduling & drafts",
      "public / close-friends audience",
      "pinned posts & edit history",
    ],
  },
  {
    n: "03",
    title: "Live Chat",
    label: "( real-time & typing )",
    desc: "Messaging that feels alive — typing, presence, voice notes and reactions before you finish your coffee.",
    chips: [
      "typing & presence",
      "voice notes",
      "GIFs & camera",
      "files & images",
      "reply, pin & react",
      "edit / undo send",
      "mute & block",
      "message search",
      "read receipts",
    ],
  },
  {
    n: "04",
    title: "Communities",
    label: "( your rooms )",
    desc: "Invite-only rooms for your people — same chat, calls and pins, with you in charge.",
    chips: [
      "invite-only rooms",
      "group messaging",
      "group voice & video calls",
      "voice notes",
      "pins & reactions",
      "member list",
      "mute & leave",
      "real-time sync",
    ],
  },
  {
    n: "05",
    title: "Audio & Video Calls",
    label: "( 1-on-1 or group )",
    desc: "Crystal-clear rooms that feel like being in the room — without leaving the app.",
    chips: [
      "1-on-1 audio",
      "1-on-1 video",
      "group call floor",
      "incoming-call UI",
      "call state handling",
      "socket call alerts",
    ],
  },
  {
    n: "06",
    title: "A Feed For You",
    label: "( discovery, without the algorithm trap )",
    desc: "Ranked and For-You feeds, explore, trending and search — everything worth seeing, nothing engineered to trap you.",
    chips: [
      "ranked home feed",
      "For-You feed",
      "explore & trending",
      "infinite scroll",
      "pull-to-refresh",
      "swipe to like/repost",
      "deep search",
      "real-time updates",
    ],
  },
  {
    n: "07",
    title: "Close Friends & Privacy",
    label: "( quiet by default )",
    desc: "Close friends, private accounts, blocks, mutes and moderation — calm isn't a setting, it's the default.",
    chips: [
      "close-friends lists",
      "close-friends posts & glances",
      "private accounts",
      "block & mute",
      "reports & moderation",
      "invite codes",
      "profile share & forward",
      "collections",
    ],
  },
  {
    n: "08",
    title: "Streaks & Missions",
    label: "( make it a ritual )",
    desc: "XP, daily missions, streaks and leaderboards that keep your world warm — not hooked.",
    chips: [
      "XP & levels",
      "daily missions",
      "streaks & rewards",
      "leaderboards",
      "reputation badges",
    ],
  },
  {
    n: "09",
    title: "Works Anywhere",
    label: "( offline · translated · notified )",
    desc: "Everything reads offline and syncs back. One tap speaks any language. Your people find you, even asleep.",
    chips: [
      "offline-first reading",
      "sync queue",
      "one-tap translation",
      "link previews",
      "push notifications",
      "PWA installable",
      "image optimization",
      "cached & fast",
    ],
  },
  {
    n: "10",
    title: "The Open Web",
    label: "( fediverse-ready )",
    desc: "Follow the whole web, not just Orbit. Posts from Bluesky, Mastodon and Lemmy flow straight into your feed — read and engage without leaving the app.",
    chips: [
      "bluesky feed",
      "mastodon feed",
      "lemmy feed",
      "dedicated web tab",
      "open-web search",
      "infinite scroll",
      "open the original",
    ],
  },
];

const MARQUEE = [
  "GLANCES",
  "LIVE CHAT",
  "VOICE & VIDEO",
  "COMMUNITIES",
  "POSTS & POLLS",
  "OFFLINE-FIRST",
  "XP & STREAKS",
  "TRANSLATION",
  "CLOSE FRIENDS",
  "SCHEDULING",
  "PUSH",
  "REACTIONS",
  "OPEN WEB",
  "MASTODON",
  "BLUESKY",
  "FEDIVERSE",
];

/** The full feature catalog — every family with its chips always visible. */
export function Features() {
  return (
    <section id="features" className="relative px-5 py-28 sm:px-10 sm:py-36">
      {/* marquee strip */}
      <div className="pointer-events-none relative mb-20 overflow-hidden">
        <div className="flex w-max animate-marquee gap-12 whitespace-nowrap py-2">
          {[...MARQUEE, ...MARQUEE].map((m, i) => (
            <span key={i} className="u-label text-[11px] text-white/45">
              {m}
              <span className="ml-12 text-white/15">·</span>
            </span>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-void to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-void to-transparent" />
      </div>

      <div className="mx-auto max-w-6xl">
        <SectionTitle
          index="01"
          eyebrow="everything social"
          title="Every feature."
          italic="Zero noise."
          sub="The whole app, listed honestly — no vaporware, no soon™. Glances, chats, calls, communities, the open web and developer tools, all built and waiting for you."
          className="mx-auto mb-20 max-w-2xl"
        />

        <div className="hairline-t">
          {SERVICES.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.04}>
              <div className="group relative border-b border-white/[0.08]">
                <div className="flex items-start justify-between gap-6 px-2 py-7 transition-colors duration-500 group-hover:bg-white/[0.035] sm:px-6 sm:py-9">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-5 sm:gap-8">
                      <span className="u-label hidden shrink-0 text-[11px] text-white/45 sm:block">
                        {s.n}
                      </span>
                      <h3 className="headline whitespace-nowrap text-3xl text-white transition-transform duration-500 group-hover:translate-x-3 sm:text-5xl">
                        {s.title}
                      </h3>
                    </div>
                    <p className="mt-2 max-w-xl pl-0 text-[13px] leading-relaxed text-mist sm:pl-[4.5rem]">
                      {s.desc}
                    </p>
                    {/* the real feature list — always visible, no hover needed */}
                    <div className="mt-4 flex max-w-2xl flex-wrap gap-2 pl-0 sm:pl-[4.5rem]">
                      {s.chips.map((chip) => (
                        <span
                          key={chip}
                          className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70 transition-colors duration-300 group-hover:border-amber/30 group-hover:text-amber/90"
                        >
                          {chip}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-6 pt-1">
                    <span className="u-label hidden text-[11px] text-white/55 lg:block">
                      {s.label}
                    </span>
                    <span className="flex h-9 items-center justify-center rounded-full border border-white/15 px-3.5 text-white/60 transition-all duration-300 group-hover:rotate-45 group-hover:border-white group-hover:bg-white group-hover:text-black">
                      <ArrowUpRight className="h-4 w-4" />
                    </span>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
