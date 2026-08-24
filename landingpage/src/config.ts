/**
 * The live app — where a successful login/signup from this landing page
 * redirects. Override at build time with VITE_APP_URL
 * (e.g. https://orbit-your-inner-circle.vercel.app).
 */
export const APP_URL: string =
  (import.meta.env.VITE_APP_URL as string | undefined) ??
  "https://orbit-your-inner-circle.vercel.app";

/**
 * Base URL of the ORBIT API — used by the waitlist form AND the
 * login/signup forms on this page. Defaults to the same origin (`/api`):
 * in dev the Vite proxy forwards it to the local backend, and when the
 * server serves this page it is already same-origin. Override at build
 * time with VITE_WAITLIST_API_URL (e.g. https://orbit-backend.onrender.com/api).
 */
export const WAITLIST_API_URL =
  (import.meta.env.VITE_WAITLIST_API_URL as string | undefined) ?? "/api";

/**
 * Cloudflare Turnstile site key (optional). When set, the waitlist form
 * renders a human-check widget and only submits with a valid token. The
 * backend must have the matching TURNSTILE_SECRET_KEY for the token to
 * verify. Set VITE_TURNSTILE_SITE_KEY at build time.
 * Get free keys: https://dash.cloudflare.com → Turnstile.
 */
export const TURNSTILE_SITE_KEY: string | undefined =
  import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

/** Turnstile widget API types (loaded dynamically from Cloudflare CDN). */
declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement | null,
        opts: {
          sitekey: string;
          theme?: string;
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        }
      ) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

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
  { label: "Sign In", href: "#auth" },
  { label: "Join", href: "#waitlist" },
];
