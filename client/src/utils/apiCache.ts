/**
 * apiCache.ts — Stale-while-revalidate caching layer for API responses.
 *
 * Uses the browser CacheStorage API (same storage used by service workers)
 * so cached responses survive tab closes, page refreshes, and partial offline.
 *
 * Only caches GET requests. POST / PUT / DELETE bypass caching entirely.
 *
 * ── Flow (on-demand) ──
 * 1. GET request → return cached data instantly (if exists)
 * 2. Fire background refresh → fetch from network → update cache + notify React
 * 3. If network fails → return stale cached data (graceful degradation)
 *
 * ── Flow (periodic timer) ──
 * Registered endpoints are automatically refreshed in the background
 * every N seconds based on their TTL, keeping the cache warm even
 * when the user hasn't navigated to that tab.
 */

const API_CACHE_NAME = "orbit-api-v1";

// Import lazily-cached Dexie bridge — populated on every background refresh
// so the structured offline database stays in sync with CacheStorage.
import { cacheIntoDexie } from "./dexieBridge";
import { purgeOfflineDataForPath } from "./offlineDB";

// ── Stale-While-Revalidate Timer ────────────────────────────────────────────
//
// Keeps frequently-used API endpoints fresh by periodically re-fetching them
// in the background. The timer auto-starts when the first URL is registered.
//

/** Registry entry for a URL in the periodic refresh schedule. */
interface RefreshEntry {
	ttl: number;          // milliseconds between refreshes
	lastRefreshed: number; // epoch timestamp of last successful refresh
}

const refreshRegistry = new Map<string, RefreshEntry>();

/** Default TTL for endpoints that don't match any specific pattern. */
const DEFAULT_TTL = 300_000; // 5 minutes (free-tier optimized)

/**
 * TTL by URL pattern — more dynamic content gets shorter TTLs.
 * Order matters: the FIRST matching pattern wins.
 *
 * NOTE: WebSockets handle ALL realtime updates (new messages, notifications,
 * presence, typing indicators), so the background timer is only a safety
 * net for missed events. Longer TTLs = less bandwidth + fewer Redis calls.
 */
const TTL_BY_PATTERN: [RegExp, number][] = [
	[/\/api\/chats\/conversations/, 120_000],         // 2m — WS handles new messages
	[/\/api\/posts/, 300_000],                         // 5m — feed refreshes via WS
	[/\/api\/notifications/, 300_000],                 // 5m — WS handles badge counts
	[/\/api\/saves/, 300_000],                         // 5m
	[/\/api\/reports/, 300_000],                       // 5m — admin dashboard
	[/\/api\/communities/, 300_000],                   // 5m
	[/\/api\/users/, 300_000],                         // 5m — profile, suggestions
	[/\/api\/reposts/, 300_000],                       // 5m
];

let refreshTimerId: ReturnType<typeof setInterval> | null = null;

/** Determine the TTL for a URL based on its path patterns. */
function resolveTtl(url: string): number {
	for (const [pattern, ttl] of TTL_BY_PATTERN) {
		if (pattern.test(url)) return ttl;
	}
	return DEFAULT_TTL;
}

/** Run one full sweep — refresh any entries whose TTL has expired. */
async function refreshStaleEntries(): Promise<void> {
	// When the browser tab is hidden, skip the sweep entirely.
	// The interval keeps ticking but does no actual work — this saves
	// battery and bandwidth without needing a visibilitychange listener.
	if (typeof document !== "undefined" && document.hidden) return;

	const now = Date.now();
	const promises: Promise<void>[] = [];

	for (const [url, entry] of refreshRegistry) {
		if (now - entry.lastRefreshed >= entry.ttl) {
			// Update timestamp optimistically to prevent re-triggering
			// while the network request is in flight
			entry.lastRefreshed = now;
			promises.push(
				refreshCache(url).catch(() => {
					// If the refresh fails, reset lastRefreshed so the next tick
					// will retry (don't wait a full TTL for a failed request)
					entry.lastRefreshed = 0;
				}),
			);
		}
	}

	if (promises.length > 0) {
		await Promise.allSettled(promises);
	}
}/**
 * Start the periodic background refresh timer.
 * Safe to call multiple times — subsequent calls are no-ops.
 *
 * The timer itself is always running while registered URLs exist, but
 * `refreshStaleEntries` checks `document.hidden` before making any
 * network requests — the sweep is effectively a no-op when the tab
 * is backgrounded, saving battery and bandwidth.
 *
 * @param intervalMs How often to check for stale entries (default 30s).
 *        Should be ≤ the shortest TTL (currently 30s for chat).
 */
export function startCacheRefreshTimer(intervalMs = 300_000): void {
	if (refreshTimerId !== null) return; // already running
	refreshTimerId = setInterval(() => {
		void refreshStaleEntries();
	}, intervalMs);
}

/**
 * Stop the periodic background refresh timer.
 * Clears all registered URLs from the schedule as well.
 */
export function stopCacheRefreshTimer(): void {
	if (refreshTimerId !== null) {
		clearInterval(refreshTimerId);
		refreshTimerId = null;
	}
	refreshRegistry.clear();
}

/**
 * Register a URL for periodic background refreshes.
 * Auto-starts the timer if this is the first registration.
 *
 * @param url   The API endpoint to keep fresh.
 * @param ttl   Optional custom TTL in ms. If omitted, TTL is chosen
 *              based on the URL pattern.
 */
export function addToRefreshSchedule(url: string, ttl?: number): void {
	// Auto-start the timer on first registration
	if (refreshRegistry.size === 0) {
		startCacheRefreshTimer();
	}

	const resolvedTtl = ttl ?? resolveTtl(url);

	// If a registration already exists with a shorter (more aggressive) TTL,
	// keep the shorter one — we never want to refresh LESS often.
	const existing = refreshRegistry.get(url);
	if (existing && existing.ttl <= resolvedTtl) return;

	refreshRegistry.set(url, { ttl: resolvedTtl, lastRefreshed: 0 });
}

/**
 * Remove a URL from the periodic refresh schedule.
 */
export function removeFromRefreshSchedule(url: string): void {
	refreshRegistry.delete(url);
}

/**
 * Get the number of URLs currently registered for periodic refresh.
 */
export function getRefreshScheduleSize(): number {
	return refreshRegistry.size;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildCacheKey(url: string): Request {
	return new Request(url, {
		method: "GET",
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Parse the JSON body from a cached Response.
 */
async function parseJson(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Retrieve cached data for a GET endpoint.
 * Returns `null` if no cache entry exists.
 */
export async function getCachedResponse<T = unknown>(
	url: string,
): Promise<T | null> {
	try {
		const cache = await caches.open(API_CACHE_NAME);
		const cached = await cache.match(buildCacheKey(url));
		if (!cached) return null;
		return (await parseJson(cached)) as T;
	} catch {
		return null;
	}
}

/**
 * Store a JSON-serialisable value in the API cache.
 */
export async function setCachedResponse(
	url: string,
	data: unknown,
): Promise<void> {
	try {
		const cache = await caches.open(API_CACHE_NAME);
		const body = JSON.stringify(data);
		const response = new Response(body, {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
		await cache.put(buildCacheKey(url), response);
	} catch {
		// Cache write failures are non-critical — silently ignore
	}
}

/**
 * Seed a newly created/published post into the cached main-feed list
 * (`/api/posts`, `/api/posts?limit=…`) so the home feed shows it
 * INSTANTLY on the next mount — before any network round-trip completes.
 *
 * Used by the publish-draft flow so a post published from the Profile tab
 * appears in the feed the moment the user navigates Home (the Feed
 * component is unmounted while on Profile, so it can't receive the
 * in-memory `newPostCreated` event there).
 *
 * NOTE: deliberately scoped to `/api/posts` ONLY — NOT `/api/saves` or
 * `/api/reposts`. A freshly published draft has not been saved or
 * reposted by the author, so seeding those lists would make the post
 * incorrectly appear in the Saved / Reposts tabs.
 *
 * Because the publish POST's cache eviction removes the `/api/posts` key
 * BEFORE this runs, a missing entry is CREATED as a minimal list so the
 * feed's mount-time cache read still finds the post instantly.
 */
export async function prependPostToCachedFeeds(
	post: Record<string, unknown>,
): Promise<void> {
	try {
		const id = (post as { _id?: string })._id;
		if (!id) return;

		const cache = await caches.open(API_CACHE_NAME);
		const requests = await cache.keys();

		await Promise.all(
			requests.map(async (req) => {
				const path = new URL(req.url).pathname;
				const isFeedList =
					path === "/api/posts" || path.startsWith("/api/posts?");
				if (!isFeedList) return;

				const cached = await cache.match(req);

				if (!cached) {
					// Eviction deleted this key (publish evicts /api/posts list).
					// Create a minimal entry so the feed cache-read shows the post.
					const body = JSON.stringify({
						success: true,
						posts: [post],
						hasMore: true,
						nextCursor: null,
					});
					await cache.put(
						req,
						new Response(body, {
							status: 200,
							headers: { "Content-Type": "application/json" },
						}),
					);
					return;
				}

				const data = (await cached.json()) as {
					posts?: unknown[];
					[key: string]: unknown;
				} | null;
				if (!data || !Array.isArray(data.posts)) return;
				if (data.posts.some((p) => (p as { _id?: string })?._id === id)) {
					return; // already present — don't duplicate
				}

				const body = JSON.stringify({ ...data, posts: [post, ...data.posts] });
				await cache.put(
					req,
					new Response(body, {
						status: 200,
						headers: { "Content-Type": "application/json" },
					}),
				);
			}),
		);
	} catch {
		// Cache seeding is non-critical — silently ignore failures
	}
}

/**
 * Remove a single cached endpoint — from CacheStorage AND the Dexie
 * structured layer. Components fall back to getOfflineFallback() when
 * CacheStorage misses, so purging only CacheStorage lets a stale Dexie
 * copy (e.g. an old unread-badge conversation list) resurrect on the next
 * reload. Manual evictions (chat:join, communities, follows, …) go through
 * this helper, so Dexie must be purged here too — otherwise the exact
 * "deleted it, reload, it's back, then it fixes itself 30s later" bug
 * resurfaces on every screen that evicts by hand.
 */
export async function evictCachedResponse(url: string): Promise<void> {
	try {
		const pathname = new URL(url, window.location.origin).pathname;
		// Evict the WHOLE URL family, not just the exact key. Cached entries
		// carry query strings (`/api/posts?limit=10`), so an exact-key delete
		// left every variant behind — the stale list then resurfaced on the
		// next read until the background timer overwrote it. Deleting every
		// entry whose pathname equals or descends from the target makes the
		// eviction complete: once a realtime event or mutation proves the
		// data changed, the next read MUST go to the network.
		const cache = await caches.open(API_CACHE_NAME);
		const requests = await cache.keys();
		const targets = requests.filter((req) => {
			const p = new URL(req.url).pathname;
			return p === pathname || p.startsWith(pathname + "/");
		});
		// Always attempt the exact key too (covers any non-conforming entry).
		await cache.delete(buildCacheKey(url));
		await Promise.all(targets.map((r) => cache.delete(r)));
		// Mirror the eviction into Dexie (structured offline store).
		await purgeOfflineDataForPath(pathname);
	} catch {
		// Non-critical
	}
}

/**
 * Clear all cached API responses.
 */
export async function clearApiCache(): Promise<void> {
	try {
		await caches.delete(API_CACHE_NAME);
	} catch {
		// Non-critical
	}
}

/**
 * Fire a background GET request and update the cache + notify listeners.
 * Swallows network errors so the UI isn't disrupted.
 */
export async function refreshCache(
	url: string,
	options: RequestInit = {},
): Promise<void> {
	try {
		const res = await fetch(url, {
			...options,
			method: "GET",
			credentials: "include",
		});

		if (!res.ok) return;

		let data: unknown = null;
		if (res.headers.get("content-type")?.includes("application/json")) {
			data = await res.json();
		}

		if (data !== null) {
			await setCachedResponse(url, data);
			// Keep the Dexie structured layer fresh too — otherwise offline
			// viewing would serve the very first fetch forever.
			await cacheIntoDexie(url, data);
			// Notify React so components can re-render with fresh data
			window.dispatchEvent(
				new CustomEvent("api:cache-refreshed", {
					detail: { url, data },
				}),
			);
		}
	} catch {
		// Network error during background refresh is non-critical
	}
}

/**
 * Check if the user is currently online (network available).
 */
export function isOnline(): boolean {
	return navigator.onLine;
}
