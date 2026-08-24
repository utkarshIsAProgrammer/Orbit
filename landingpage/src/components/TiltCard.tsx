import { useRef, type ReactNode } from "react";
import { useTilt } from "../hooks/useTilt";

/**
 * Wraps content in a true 3D tilt — the card leans toward the cursor with
 * perspective, giving cards a physical presence. Pair with a parent that
 * handles hover lift/translate (the tilt owns the transform on itself).
 */
export function TiltCard({
  children,
  className = "",
  maxDeg = 8,
}: {
  children: ReactNode;
  className?: string;
  maxDeg?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useTilt(ref, maxDeg);

  return (
    <div ref={ref} className={className} style={{ transformStyle: "preserve-3d", willChange: "transform" }}>
      {children}
    </div>
  );
}
