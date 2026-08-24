import { useCallback, useEffect, useState } from "react";

/**
 * Scroll-reveal — the landing page's signature animation, brought into the
 * app. Attach the returned ref to a container; every descendant marked with
 * `data-reveal` (optionally `data-reveal-delay="60ms"`) fades + rises in
 * the first time it enters the viewport.
 *
 * - Works inside the app's fixed-height scroll columns (IntersectionObserver
 *   uses the viewport, so elements scrolled into view still trigger).
 * - Robust to conditionally-mounted containers (callback ref re-runs the
 *   observer when the element appears) and live lists (a MutationObserver
 *   reveals rows added later, e.g. incoming notifications).
 * - Reduced-motion users see everything immediately — the CSS media query
 *   forces `[data-reveal]` visible, so no JS is needed there.
 */
export function useReveal<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const ref = useCallback((el: T | null) => setNode(el), []);

  useEffect(() => {
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let io: IntersectionObserver | null = null;
    const revealed = new WeakSet<Element>();

    const reveal = (el: HTMLElement) => {
      el.classList.add("reveal-in");
      revealed.add(el);
      io?.unobserve(el);
    };

    const watch = () => {
      node
        .querySelectorAll<HTMLElement>("[data-reveal]")
        .forEach((el) => {
          if (!revealed.has(el)) io?.observe(el);
        });
    };

    io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) reveal(entry.target as HTMLElement);
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -6% 0px" },
    );

    watch();
    const mo = new MutationObserver(watch);
    mo.observe(node, { childList: true, subtree: true });

    return () => {
      io?.disconnect();
      mo.disconnect();
    };
  }, [node]);

  return ref;
}
