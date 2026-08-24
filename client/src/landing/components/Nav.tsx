import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { NAV_LINKS } from "../config";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { lockScroll, unlockScroll } from "../scrollLock";

/** Minimal top bar with the Orbit wordmark + mono nav links. On mobile the
 * links collapse into a liquid-glass full-screen menu. */
export function Nav() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced) {
      gsap.set(el, { y: 0, opacity: 1 });
      return;
    }
    gsap.fromTo(
      el,
      { y: -28, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.7, delay: 0.5, ease: "power3.out" },
    );
  }, [reduced]);

  // Lock page scroll while the mobile menu is open — Lenis-aware, so the
  // background can't scroll behind the menu on touch or wheel.
  useEffect(() => {
    if (open) lockScroll();
    else unlockScroll();
    return () => unlockScroll();
  }, [open]);

  // If the viewport grows to desktop width while the menu is open, the menu
  // becomes hidden (sm:hidden) but scroll would stay locked — unlock it so
  // a resized/rotated visitor is never trapped.
  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia("(min-width: 768px)"); // md — where the burger disappears
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [open]);


  // Escape closes the menu too
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <header
        ref={ref}
        className={`fixed inset-x-0 top-0 z-[400] flex items-center justify-between px-5 py-5 sm:px-10 ${
          open ? "pointer-events-none" : "pointer-events-auto"
        }`}
      >
        <a href="#top" className="flex items-baseline gap-2.5" onClick={close}>
          <span className="script text-3xl text-white">Orbit</span>
          <span className="u-label hidden text-xs text-white/55 sm:block">
            creative_social
          </span>
        </a>

        <nav className="flex items-center gap-7 sm:gap-9">
          {/* desktop links */}
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="u-label hidden text-sm font-semibold text-mist transition-colors duration-300 hover:text-white md:block"
            >
              {l.label}
            </a>
          ))}

          <a
            href="#auth-section"
            className="btn btn-primary hidden! whitespace-nowrap py-2.5! px-5! text-xs! tracking-[0.16em]! md:flex!"
          >
            Join Orbit
            <ArrowUpRight className="h-4 w-4 shrink-0" />
          </a>

        {/* phone hamburger — below md the navbar shows NOTHING else: no
            links, no CTA. All nav items live in the glass menu only. */}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className={`glass-strong flex h-10 w-10 items-center justify-center rounded-full text-white transition-colors duration-300 hover:text-amber md:hidden ${
            open ? "pointer-events-none opacity-0" : ""
          }`}
        >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </nav>
      </header>

      {/* mobile full-screen menu — a sibling of the header so it can never be
          trapped behind it. Liquid-glass: strong blur + a warm dark base so
          page text never bleeds into the nav items. Tapping the empty glass
          backdrop closes it; the content panel below stops propagation. */}
      {open && (
        <div
          className="nav-menu-glass fixed inset-0 z-[390] overflow-y-auto md:hidden"
          onClick={close}
        >
          {/* content panel — interactive taps stop propagation so links and
              the close button work; taps on the empty glass bubble up and
              close the menu */}
          <div className="pointer-events-none relative flex min-h-full flex-col">
            {/* explicit close button — always visible, always works */}
            <div className="pointer-events-auto flex shrink-0 items-center justify-end border-b border-white/[0.07] px-5 py-4" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={close}
                aria-label="Close menu"
                className="glass-strong flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors duration-300 hover:text-amber"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* nav items start right below the navbar — no dead space */}
            <div className="pointer-events-auto flex flex-1 flex-col px-6 pb-10 pt-7" onClick={(e) => e.stopPropagation()}>
              <span className="u-label mb-5 text-[11px] tracking-[0.22em] text-white/55">
                ( navigate )
              </span>

              <nav className="flex flex-col gap-0.5">
                {NAV_LINKS.map((l, i) => (
                  <a
                    key={l.href}
                    href={l.href}
                    onClick={close}
                    className="group flex items-baseline gap-4 border-b border-white/[0.06] py-3 text-left"
                    style={{ transitionDelay: `${i * 40}ms` }}
                  >
                    <span className="u-label w-6 shrink-0 text-[11px] text-amber/60">
                      0{i + 1}
                    </span>
                    <span className="u-label text-lg font-bold uppercase tracking-[0.14em] text-white transition-colors duration-300 group-hover:text-amber">
                      {l.label}
                    </span>
                    <ArrowUpRight className="ml-auto h-4 w-4 shrink-0 text-white/25 transition-all duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-amber" />
                  </a>
                ))}
              </nav>

              <a
                href="#auth-section"
                onClick={close}
                className="btn btn-primary mt-7 w-full justify-center py-3! text-xs! tracking-[0.16em]!"
              >
                Join Orbit
                <ArrowUpRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
