import Lenis from "lenis";
import { useEffect, type RefObject } from "react";

export interface LenisScrollOptions {
  /**
   * Scroll responsiveness. Lower = snappier glide. Default 0.08.
   */
  lerp?: number;
  /**
   * When true (default), wheel/touch over a NESTED scrollable (modals,
   * the composer textarea, glance strips, the right rail…) scrolls that
   * element natively instead of the Lenis wrapper — so inner panes keep
   * working while the main column glides.
   */
  allowNestedScroll?: boolean;
}

/**
 * Attach a Lenis smooth-scroll instance to an element. Works with the app's
 * fixed-height inner scroll columns (it animates `wrapper.scrollTop` — no
 * layout-breaking CSS transforms, so the h-dvh shell stays intact).
 *
 * - `autoRaf` runs Lenis's own rAF loop — no manual loop needed.
 * - Lenis's own ResizeObserver only watches the wrapper box (which is
 *   fixed-height here), so a second ResizeObserver + child watcher re-measure
 *   when the CONTENT grows or the first child is swapped (infinite scroll,
 *   new chat messages, tab switches). Without this, Lenis would clamp wheel
 *   scrolling at a stale limit and infinite scroll would stall.
 *
 * Returns a cleanup that disconnects everything.
 */
export function attachLenis(
  el: HTMLElement,
  { lerp = 0.08, allowNestedScroll = true }: LenisScrollOptions = {},
): () => void {
  const lenis = new Lenis({
    wrapper: el,
    content: (el.firstElementChild as HTMLElement | null) ?? el,
    autoRaf: true,
    allowNestedScroll,
    lerp,
  });

  let contentEl = el.firstElementChild as HTMLElement | null;
  const ro = new ResizeObserver(() => lenis.resize());
  if (contentEl) ro.observe(contentEl);
  const childWatcher = new MutationObserver(() => {
    const next = el.firstElementChild as HTMLElement | null;
    if (next === contentEl) return;
    if (contentEl) ro.unobserve(contentEl);
    contentEl = next;
    if (contentEl) ro.observe(contentEl);
    lenis.resize();
  });
  childWatcher.observe(el, { childList: true });

  return () => {
    childWatcher.disconnect();
    ro.disconnect();
    lenis.destroy();
  };
}

/**
 * React hook — attach Lenis to a ref'd scroll container.
 *
 * Pass `deps` to re-attach when the container's identity changes (e.g. the
 * active chat conversation, whose message pane mounts/unmounts) or when a
 * container becomes available later (login, tab switch).
 */
export function useLenisScroll<T extends HTMLElement>(
  ref: RefObject<T | null>,
  options?: LenisScrollOptions,
  deps: ReadonlyArray<unknown> = [],
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return attachLenis(el, options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...deps]);
}
