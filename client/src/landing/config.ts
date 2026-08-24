/**
 * Motion mode. Defaults to "full" — this page is an animation showcase and
 * runs its full choreography regardless of the OS "reduced motion" setting
 * (which would otherwise freeze every scroll/reveal/parallax animation).
 *
 * Set VITE_MOTION_MODE=gentle to respect the visitor's OS preference
 * (scales everything back to the accessible minimal experience).
 */
export const MOTION: "full" | "gentle" =
  (import.meta.env.VITE_MOTION_MODE as "full" | "gentle" | undefined) === "gentle"
    ? "gentle"
    : "full";

export const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "Why", href: "#why" },
  { label: "Devices", href: "#preview" },
  { label: "Sign In", href: "#auth-section" },
  { label: "Join", href: "#auth-section" },
];
