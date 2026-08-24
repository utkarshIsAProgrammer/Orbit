import { useEffect, useState } from "react";

const SECTIONS = [
  { id: "top", label: "intro" },
  { id: "story", label: "inside" },
  { id: "features", label: "features" },
  { id: "why", label: "why" },
  { id: "love", label: "love" },
  { id: "steps", label: "join" },
  { id: "preview", label: "devices" },
];

/**
 * Fixed storytelling chapter counter — `01 / 07 — story` — the nudot
 * "01 // 05" pattern. Tracks which section is currently in view.
 */
export function ScrollIndex() {
  const [cur, setCur] = useState(0);

  useEffect(() => {
    // cache elements once — avoid layout reads on every scroll frame
    const els = SECTIONS.map((s) => document.getElementById(s.id));
    const onScroll = () => {
      const vh = window.innerHeight;
      let idx = 0;
      for (let i = 0; i < els.length; i++) {
        if (els[i] && els[i]!.getBoundingClientRect().top < vh * 0.5) idx = i;
      }
      setCur(idx);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[70] hidden flex-col items-end gap-1.5 lg:flex">
      <span className="font-mono text-[11px] tracking-[0.14em] text-white/50">
        {String(cur + 1).padStart(2, "0")}
        <span className="text-white/25"> / {String(SECTIONS.length).padStart(2, "0")}</span>
      </span>
      <span className="u-label text-[11px] uppercase text-white/45">{SECTIONS[cur].label}</span>
    </div>
  );
}
