import { useEffect, useState } from "react";
import { MOTION } from "../config";

/**
 * Whether to scale animations back to the accessible minimum.
 *
 * The landing page defaults to MOTION === "full" — it is an animation
 * showcase and keeps its full choreography even when the OS reports
 * `prefers-reduced-motion: reduce` (otherwise the page would appear
 * completely static). The OS preference is only honored when the site
 * is built with VITE_MOTION_MODE=gentle.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined"
      ? MOTION === "gentle" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );

  useEffect(() => {
    if (MOTION !== "gentle") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
