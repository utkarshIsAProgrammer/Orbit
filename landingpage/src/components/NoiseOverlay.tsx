/** Cinematic film grain over everything (very subtle). */
export function NoiseOverlay() {
  return (
    <div className="noise-layer pointer-events-none fixed inset-0 z-[90] opacity-[0.05]" />
  );
}
