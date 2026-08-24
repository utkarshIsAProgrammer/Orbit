import { NAV_LINKS } from "../config";

export function Footer() {
  return (
    <footer className="hairline-t relative px-6 py-14 sm:px-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-10 md:flex-row md:items-start">
        <div className="flex flex-col items-center gap-2 md:items-start">
          <span className="flex items-center gap-2.5">
            <span className="script text-3xl text-white">Orbit</span>
            <span className="h-px w-6 bg-white/40" />
            <span className="u-label text-[11px] text-white/55">creative_social</span>
          </span>
          <p className="max-w-[240px] text-center text-[12px] leading-relaxed text-dim md:text-left">
            Every feature, zero noise. Join Orbit — your
            inner circle is waiting inside.
          </p>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-xs font-bold uppercase tracking-[0.2em] text-mist transition-colors hover:text-amber"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <a
          href="#top"
          className="u-label rounded-full border border-white/12 px-4 py-2 text-[11px] text-mist transition-all duration-300 hover:border-amber/50 hover:text-amber"
        >
          back to top ↑
        </a>
      </div>

      <div className="mx-auto mt-12 flex max-w-6xl flex-col items-center justify-between gap-3 border-t border-white/[0.07] pt-6 sm:flex-row">
        <span className="text-[11px] uppercase tracking-[0.25em] text-dim">
          © 2026 Orbit
        </span>
        <span className="text-[11px] uppercase tracking-[0.25em] text-dim">
          no ads · no noise · your inner circle
        </span>
      </div>
    </footer>
  );
}
