import { X, Check } from "lucide-react";
import { Reveal } from "./Reveal";
import { SectionTitle } from "./SectionTitle";

const ROWS: { old: string; next: string }[] = [
  {
    old: "Feeds engineered to keep you scrolling",
    next: "A feed designed to let you breathe",
  },
  {
    old: "Ads sold against your attention",
    next: "Zero ads. Your feed stays yours.",
  },
  {
    old: "Followers you perform for",
    next: "Close friends who actually reply",
  },
  {
    old: "Noise that follows you home",
    next: "Quiet, by default",
  },
  {
    old: "Every moment saved forever",
    next: "Glances that live 24 hours — then let go",
  },
];

/**
 * The emotional heart of the page: the old way of social media, crossed
 * out, against the Orbit way. People remember contrast.
 */
export function WhyOrbit() {
  return (
    <section id="why" className="relative px-5 py-28 sm:px-10 sm:py-36">
      <div className="mx-auto max-w-5xl">
        <SectionTitle
          index="02"
          eyebrow="why orbit"
          title="The old way"
          italic="vs. the orbit way."
          sub="Social media forgot how to be quiet. Orbit is the quiet — your circle, not the crowd."
        />

        <div className="relative mt-16">
          {/* center divider + vs chip */}
          <div className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-px -translate-x-1/2 bg-white/10 md:block" />
          <div className="pointer-events-none absolute left-1/2 top-0 z-10 hidden -translate-x-1/2 md:block">
            <Reveal>
              <span className="glass-strong inline-block px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.3em] text-amber">
                vs
              </span>
            </Reveal>
          </div>

          <div className="grid grid-cols-1 gap-12 md:grid-cols-2 md:gap-0">
            {/* the old way */}
            <div className="md:pr-16">
              <Reveal>
                <span className="u-label text-[11px] text-white/55">( the_old_way )</span>
              </Reveal>
              <ul className="mt-7 space-y-5">
                {ROWS.map((r, i) => (
                  <Reveal key={i} delay={0.05 + i * 0.07}>
                    <li className="flex items-start gap-3.5 border-b border-white/[0.06] pb-5 text-sm leading-relaxed text-dim">
                      <X className="mt-0.5 h-4 w-4 shrink-0 text-white/25" />
                      <span>{r.old}</span>
                    </li>
                  </Reveal>
                ))}
              </ul>
            </div>

            {/* the orbit way */}
            <div className="md:pl-16">
              <Reveal>
                <span className="u-label text-[11px] text-white">( the_orbit_way )</span>
              </Reveal>
              <ul className="mt-7 space-y-5">
                {ROWS.map((r, i) => (
                  <Reveal key={i} delay={0.2 + i * 0.07}>
                    <li className="flex items-start gap-3.5 border-b border-white/[0.06] pb-5 text-sm font-semibold leading-relaxed text-white/95">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-amber" strokeWidth={3} />
                      <span>{r.next}</span>
                    </li>
                  </Reveal>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <Reveal delay={0.15}>
          <p className="mt-14 text-center">
            <span className="script text-3xl text-white/85 sm:text-4xl">
              you already know which one feels like home.
            </span>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
