/** "95" → "1m 35s" · "3725" → "1h 02m" · "45" → "45s" · "0" → "0s" */
export const formatCallDuration = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
};
