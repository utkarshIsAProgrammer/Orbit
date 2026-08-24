import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initSentry } from "./utils/sentry";

// ─── Pre-mount theme boot ───────────────────────────────────────────
// Apply the saved color theme (and the dark class) SYNCHRONOUSLY before
// React mounts so a reload never flashes the default Aurora theme. The
// same value App.tsx reads, kept in one place.
(function bootTheme() {
	try {
		const saved = localStorage.getItem("orbit_color_theme");
		document.documentElement.setAttribute(
			"data-theme",
			saved === "ember" ? "ember" : saved === "aurora" ? "aurora" : "xlite",
		);
		document.documentElement.classList.add("dark");
	} catch {
		// storage unavailable — default theme is fine
	}
})();
import { trackPageView } from "./utils/analytics";

// Initialize Sentry for error tracking
initSentry();

// Track initial page view
trackPageView("home");

// NOTE: Web Vitals reporting was removed deliberately. onCLS creates a
// PerformanceObserver for the "layout-shift" entry type, which browsers
// that don't support it (e.g. Firefox) log as "Ignoring unsupported
// entryTypes: layout-shift" in the console on every load. The metrics
// only fed Sentry breadcrumbs and aren't used anywhere else, so dropping
// them keeps the console completely clean.

// ─── Service worker registration (cache-busting) ──────────────────────
// Hand-rolled because the plugin's generated registerSW.js omitted
// `updateViaCache: "none"` — browsers may serve a STALE /sw.js from the
// HTTP cache for up to 24h, so a deploy's new code (and its new precache
// manifest) never reaches users until the browser happens to revalidate.
// With updateViaCache none + the SW's skipWaiting/clientsClaim, the new
// SW installs and takes over on the very next page load after a deploy.
// IMPORTANT: must NOT unregister any service worker here — /sw.js (workbox-
// based) is the push-capable worker; an earlier cleanup block that
// unregistered by scriptURL was silently breaking web-push notifications.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        // Deploys get picked up fast: check on EVERY app open, then poll
        // every 5 minutes and whenever the tab becomes visible. Each check
        // is a cheap byte-diff against /sw.js (Vercel serves it no-cache).
        const checkForUpdate = () => {
          reg.update().catch(() => {/* offline or blocked — retry later */});
        };
        // CRITICAL: browsers do NOT re-fetch the SW script on register()
        // alone (they rely on their own ~24h check), and the visibilitychange
        // event below has already fired by the time this handler runs on a
        // fresh launch. An installed PWA is usually opened briefly and
        // closed, so the 5-min interval may never fire either — meaning the
        // old build could stick around indefinitely. Checking right here
        // guarantees every app open picks up a pending deploy immediately.
        checkForUpdate();
        setInterval(checkForUpdate, 5 * 60 * 1000);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") checkForUpdate();
        });
        // pageshow also fires on bfcache restores (back/forward), where
        // visibilitychange may not — a returned-to tab updates too.
        window.addEventListener("pageshow", () => checkForUpdate());

        // Fallback for devices where the auto-reload chain silently fails
        // (iOS standalone-PWA / WebView quirks): if a new SW was found and
        // started installing but the page never got reloaded within a grace
        // period, show a small "update available" banner. Tapping it does a
        // PLAIN reload — localStorage/IndexedDB survive, so the user stays
        // logged in. Without this a user could sit on a stale build forever
        // with no way to know (the pain of "I had to clear site data").
        let bannerShown = false;
        const hideUpdateBanner = () => {
          try {
            document.getElementById("orbit-update-banner")?.remove();
          } catch {
            /* ignore */
          }
        };
        const showUpdateBanner = () => {
          if (bannerShown) return;
          bannerShown = true;
          try {
            const banner = document.createElement("div");
            banner.id = "orbit-update-banner";
            banner.textContent = "New version available — tap to refresh";
            Object.assign(banner.style, {
              position: "fixed",
              bottom: "16px",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: "99999",
              background: "#18181b",
              color: "#fafafa",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "9999px",
              padding: "10px 18px",
              fontSize: "13px",
              fontWeight: "600",
              fontFamily: "inherit",
              boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
              cursor: "pointer",
              maxWidth: "90vw",
            });
            banner.addEventListener("click", reloadOnce);
            document.body.appendChild(banner);
          } catch {
            /* banner injection failed — the check retries on next open */
          }
        };
        let updateTimer: number | null = null;

        // A new SW just activated (skipWaiting) and owns the caches —
        // reload once so this tab runs the fresh shell + current chunks
        // instead of a mix of old in-memory modules and new chunks.
        //
        // Two triggers, belt-and-braces: `controllerchange` (the standard
        // signal) AND the NEW_VERSION message the SW posts to every client
        // after claiming. Some iOS standalone-PWA / WebView engines are
        // unreliable at firing controllerchange — the message covers them so
        // users are never left on stale code until they manually reload.
        let reloaded = false;
        const reloadOnce = () => {
          if (reloaded) return;
          reloaded = true;
          if (updateTimer !== null) {
            window.clearTimeout(updateTimer);
            updateTimer = null;
          }
          hideUpdateBanner();
          // A plain reload — NEVER clears localStorage/IndexedDB, so the
          // user stays logged in. Only "clear site data" logs them out.
          window.location.reload();
        };
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          reloadOnce,
        );
        navigator.serviceWorker.addEventListener("message", (event) => {
          if (event.data && event.data.type === "NEW_VERSION") reloadOnce();
        });
        reg.addEventListener("updatefound", () => {
          // A new SW is installing. Normally the chain above reloads within
          // a second or two — the timer only fires if that chain breaks.
          const GRACE_MS = 12000;
          updateTimer = window.setTimeout(showUpdateBanner, GRACE_MS);
        });
      })
      .catch(() => {
        /* SW unsupported/blocked — the app works without it */
      });
  });
}

// ─── Stale-chunk self-heal ────────────────────────────────────────────
// After a deploy, a tab that's still running the OLD bundle can try to
// lazy-load a hashed chunk the new build no longer ships (and the updated
// service worker already purged from cache) → "error loading dynamically
// imported module" → React crashes → blank page with dead buttons until a
// manual reload. Recover automatically: reload once, and the fresh shell +
// current chunks load cleanly on the second attempt. The session guard
// stops a genuinely-missing chunk from looping forever.
const CHUNK_FAILURE = /dynamically imported module|Failed to fetch dynamically imported/i;
function reloadOnceOnStaleChunk() {
  try {
    if (sessionStorage.getItem("orbit_chunk_reload_attempt")) return;
    sessionStorage.setItem("orbit_chunk_reload_attempt", "1");
  } catch {
    /* storage unavailable — reload anyway */
  }
  window.location.reload();
}
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason as unknown;
  const message =
    (reason instanceof Error && reason.message) ||
    (typeof reason === "string" && reason) ||
    "";
  if (CHUNK_FAILURE.test(message)) reloadOnceOnStaleChunk();
});
window.addEventListener("error", (event) => {
  if (event.message && CHUNK_FAILURE.test(event.message)) reloadOnceOnStaleChunk();
});

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
