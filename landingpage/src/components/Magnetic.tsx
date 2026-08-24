import { useRef, type ReactNode } from "react";
import { useMagnetic } from "../hooks/useTilt";

/** Wraps a button in a magnetic field — it leans toward the cursor. */
export function Magnetic({
  children,
  strength = 0.3,
  className = "",
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useMagnetic(ref, strength);

  return (
    <div
      ref={ref}
      className={`inline-block ${className}`}
      style={{ transition: "transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
    >
      {children}
    </div>
  );
}
