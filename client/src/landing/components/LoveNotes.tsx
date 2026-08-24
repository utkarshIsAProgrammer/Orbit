import { Reveal } from "./Reveal";
import { SectionTitle } from "./SectionTitle";
import { TiltCard } from "./TiltCard";

interface Note {
  title: string;
  tag: string;
  quote: string;
}

/* No invented reviews, no fake seat numbers — each card is a promise Orbit
 * already keeps. Honest reasons to join the founding circle. */
const NOTES: Note[] = [
  {
    title: "quiet",
    tag: "the feed",
    quote: "Zero ads, zero noise, zero algorithm traps — just your people.",
  },
  {
    title: "moments",
    tag: "glances · 24h",
    quote: "Share a moment, draw on it, let it go at midnight. The memory stays, the noise doesn't.",
  },
  {
    title: "voices",
    tag: "chat · 1-tap",
    quote: "One tap speaks any language. Your words reach your people, theirs reach you.",
  },
  {
    title: "privacy",
    tag: "by default",
    quote: "Close friends, private accounts, block and mute — calm is the default, not a setting.",
  },
];

function Initial({ name }: { name: string }) {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-[13px] font-black text-white">
      {name[0].toUpperCase()}
    </span>
  );
}

export function LoveNotes() {
  return (
    <section id="love" className="relative px-5 py-28 sm:px-10 sm:py-36">
      <div className="mx-auto max-w-6xl">
        <SectionTitle
          index="03"
          eyebrow="the feeling"
          title="Your people are"
          italic="waiting here."
          sub="The feeling we're building for — every line is a promise Orbit already keeps."
        />

        <div className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {NOTES.map((n, i) => (
            <Reveal key={n.title} delay={i * 0.09}>
              <div className={i === 0 || i === 3 ? "h-full lg:translate-y-6" : "h-full"}>
                <div className="group h-full transition-transform duration-500 hover:-translate-y-1.5">
                  <TiltCard className="glass relative flex h-full flex-col justify-between rounded-3xl p-7 transition-colors duration-500 group-hover:border-white/30 group-hover:shadow-[0_30px_80px_-24px_rgba(255,255,255,0.16)]">
                    <span className="headline pointer-events-none absolute right-5 top-2 text-7xl leading-none text-white/[0.07] transition-colors duration-500 group-hover:text-white/25">
                      &ldquo;
                    </span>
                    <blockquote className="relative text-[15px] leading-relaxed text-white/90">
                      {n.quote}
                    </blockquote>
                    <figcaption className="mt-7 flex items-center gap-3">
                      <Initial name={n.title} />
                      <div>
                        <div className="text-[12px] font-bold text-white">{n.title}</div>
                        <div className="text-[11px] uppercase tracking-[0.18em] text-mist">{n.tag}</div>
                      </div>
                    </figcaption>
                  </TiltCard>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.2}>
          <p className="mt-16 flex flex-col items-center gap-4 text-center">
            <span className="u-label text-[11px] text-white/50">
              ( founding circle · free forever · no ads )
            </span>
            <a href="#auth-section" className="script text-3xl text-white/85 transition-colors duration-300 hover:text-amber">
              be one of them
            </a>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
