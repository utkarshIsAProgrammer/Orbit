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
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
};
