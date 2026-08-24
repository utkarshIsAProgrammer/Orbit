/**
 * Shared scroll-lock helper. The page scrolls through Lenis (virtual
 * smooth scroll), so `overflow: hidden` on body alone does NOT stop it.
 * Components that overlay the page (mobile nav menu) call lock()/unlock()
 * to stop and resume the smooth scroller + native scroll.
 */

type LenisLike = { stop: () => void; start: () => void };

let lenis: LenisLike | null = null;

/** Register the app's Lenis instance (called once by App). */
export const setLenis = (instance: LenisLike | null): void => {
  lenis = instance;
};

/** Stop all page scrolling (Lenis + native fallbacks). */
export const lockScroll = (): void => {
  lenis?.stop();
  document.body.style.overflow = "hidden";
  document.documentElement.style.overflow = "hidden";
};

/** Resume page scrolling. */
export const unlockScroll = (): void => {
  lenis?.start();
  // The landing (logged-out shell) restores document scrolling by setting
  // html/body overflow to "visible" inline (the app shell's stylesheet
  // overflow-x clip/hidden locks window scroll on mobile browsers). An
  // empty-string reset here would wipe that fix and re-lock the page the
  // first time the nav menu opens and closes. When the landing is mounted,
  // restore "visible" instead of clearing. lock() still sets "hidden"
  // while the menu is open, so the background can't scroll behind it.
  const isLanding = !!document.querySelector(".landing-shell");
  document.body.style.overflow = isLanding ? "visible" : "";
  document.documentElement.style.overflow = isLanding ? "visible" : "";
};
