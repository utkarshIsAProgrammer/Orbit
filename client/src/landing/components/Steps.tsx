import { UserPlus, Users, LogIn } from "lucide-react";
import { Reveal } from "./Reveal";
import { SectionTitle } from "./SectionTitle";
import { TiltCard } from "./TiltCard";

const STEPS = [
  {
    n: "01",
    icon: UserPlus,
    title: "Create your account",
    desc: "Your email, a username, done. No setup rituals — your profile is ready the moment you sign up.",
  },
  {
    n: "02",
    icon: Users,
    title: "Find your inner circle",
    desc: "Follow friends, join communities, start chatting. The people who matter are already here.",
  },
  {
    n: "03",
    icon: LogIn,
    title: "Make it yours",
    desc: "Posts, glances, voice rooms, streaks — Orbit is yours the minute you walk in. Free, no ads, no noise.",
  },
];

export function Steps() {
  return (
    <section id="steps" className="relative px-5 py-28 sm:px-10 sm:py-36">
      <div className="mx-auto max-w-6xl">
        <SectionTitle
          index="04"
          eyebrow="how joining works"
          title="Three steps."
          italic="Inside in a minute."
          sub="No setup rituals, no follower farming. Create your account and your inner circle is one tap away."
        />

        <div className="relative mt-16 grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* connecting hairline across the icon row (desktop) */}
          <div className="pointer-events-none absolute inset-x-[16%] top-[52px] hidden h-px bg-gradient-to-r from-transparent via-white/12 to-transparent opacity-40 md:block" />

          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.12}>
              <div className="group relative z-10 h-full transition-transform duration-500 hover:-translate-y-1.5">
                <TiltCard className="flex h-full flex-col rounded-3xl glass p-8 transition-colors duration-500 group-hover:border-white/30 group-hover:shadow-[0_30px_80px_-24px_rgba(255,255,255,0.16)]">
                  <div className="flex items-center justify-between">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/20 bg-white/[0.06] text-white transition-transform duration-500 group-hover:scale-110 group-hover:rotate-6">
                      <s.icon className="h-5 w-5" />
                    </span>
                    <span className="headline text-outline text-6xl leading-none">{s.n}</span>
                  </div>
                  <h3 className="headline mt-7 text-3xl text-ink">{s.title}</h3>
                  <p className="mt-3 text-[13px] leading-relaxed text-mist">{s.desc}</p>
                </TiltCard>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
