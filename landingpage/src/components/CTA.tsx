import { ArrowRight } from "lucide-react";
import { Reveal } from "./Reveal";
import { Magnetic } from "./Magnetic";
import { BigMarquee } from "./BigMarquee";
import { SplitWords } from "./SplitWords";
import { Parallax } from "./Parallax";

export function CTA() {
  return (
    <section className="relative overflow-hidden py-24 text-center sm:py-48">
      {/* giant watermark — parallaxes gently while scrolling */}
      <Parallax speed={0.06} className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden">
        <span className="headline text-outline select-none whitespace-nowrap text-[34vw] leading-none opacity-[0.16]">
          ORBIT
        </span>
      </Parallax>
      <div className="pointer-events-none absolute inset-0 halo" />

      {/* headline block */}
      <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-6">
        <Reveal>
          <span className="u-label text-[11px] text-white/55">( waitlist_is_open )</span>
        </Reveal>
        <Reveal delay={0.08}>
          <span className="script mt-5 text-4xl text-white/85 sm:text-5xl">
            be first inside
          </span>
        </Reveal>
        <SplitWords
          as="h2"
          text="Your seat"
          italic="is waiting."
          className="headline mt-4 text-6xl leading-[0.95] text-white sm:text-8xl"
        />
        <Reveal delay={0.18}>
          <p className="mt-6 max-w-sm text-sm leading-relaxed text-mist">
            Launch day opens for the waitlist first. Drop your email — we
            hold the door for you, and your inner circle walks in with you.
          </p>
        </Reveal>
      </div>

      {/* full-bleed scroll-linked marquee */}
      <div className="relative z-10 my-10">
        <BigMarquee />
      </div>

      {/* action block */}
      <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-6">
        <Reveal delay={0.26}>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Magnetic>
              <a href="#waitlist" className="btn btn-primary">
                Join the waitlist
                <ArrowRight className="h-4 w-4" />
              </a>
            </Magnetic>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
