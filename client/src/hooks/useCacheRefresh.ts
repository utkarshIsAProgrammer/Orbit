import { useEffect, useRef } from "react";

type UrlMatcher = string | RegExp;

/**
 * Subscribe to `api:cache-refreshed` custom events dispatched by the
 * `refreshCache` function in `apiCache.ts`. When a URL matching `matcher`
 * is refreshed in the background, the provided `callback` is invoked.
 *
 * Events are debounced so rapid successive cache refreshes (e.g. during
 * initial warm-up or tab switches) only trigger one call to the callback.
 *
 * Uses a ref to hold the callback so the effect doesn't need to re-attach
 * the event listener on every render — the latest callback is always called.
 *
 * @param matcher   URL string (exact match) or RegExp (`.test()`).
 * @param callback  Function to call when a matching cache refresh event fires.
 * @param debounceMs  Debounce window in ms (default 500). Set to 0 to disable.
 *
 * @example
 * ```ts
 * useCacheRefresh("/api/posts", () => fetchPosts(true));
 * useCacheRefresh(/\/api\/users/, () => loadProfile(), 1000);
 * ```
 */
export function useCacheRefresh(
	matcher: UrlMatcher,
	callback: () => void,
	debounceMs = 500,
): void {
	// Store the latest callback in a ref so the effect closure is always fresh
	const callbackRef = useRef(callback);
	callbackRef.current = callback;

	// Ref for the debounce timer so we can cancel on cleanup or new events
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		const handler = (e: Event) => {
			const { url } = (e as CustomEvent).detail || {};
			if (!url) return;

			const matches =
				typeof matcher === "string"
					? url === matcher
					: matcher.test(url);

			if (!matches) return;

			// If debounce is disabled, fire immediately
			if (debounceMs <= 0) {
				callbackRef.current();
				return;
			}

			// Debounce: cancel any pending call and schedule a new one
			if (timerRef.current !== null) {
				clearTimeout(timerRef.current);
			}

			timerRef.current = setTimeout(() => {
				timerRef.current = null;
				callbackRef.current();
			}, debounceMs);
		};

		window.addEventListener("api:cache-refreshed", handler);

		return () => {
			window.removeEventListener("api:cache-refreshed", handler);
			// Cancel any pending debounced call on cleanup
			if (timerRef.current !== null) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
		};
	}, [matcher, debounceMs]);
}
