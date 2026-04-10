// ── Request deduplication store (shares parsed JSON, not raw Response bodies) ──
interface FetchResult {
	ok: boolean;
	status: number;
	data: unknown;
}

const pendingRequests = new Map<string, Promise<FetchResult>>();

import {
	getCachedResponse,
	setCachedResponse,
	clearApiCache,
	addToRefreshSchedule,
	stopCacheRefreshTimer,
} from "./apiCache";

// Offline-first: Dexie structured storage + sync queue + bridge
import { clearOfflineDB, purgeOfflineDataForPath } from "./offlineDB";
import {
	cacheIntoDexie,
	getOfflineFallback,
} from "./dexieBridge";
import {
	addToSyncQueue,
} from "./syncQueue";
import { logger } from "./logger";

/**
 * Resolve the API origin used for full page navigations (Google OAuth) and
 * realtime socket connections. A trailing "/api" is a common copy-paste
 * mistake when copying a deploy dashboard value (Render shows the app root
 * as `.../api` in some fields) — callers here append "/api/auth/google"
 * themselves, so stripping it prevents "/api/api/..." double-prefix bugs.
 */
export function resolveApiBase(): string {
	const raw =
		(import.meta.env.VITE_API_URL as string) || window.location.origin;
	return raw.replace(/\/api\/?$/, "").replace(/\/+$/, "");
}

function toJsonResponse(result: FetchResult): Response {
	return new Response(JSON.stringify(result.data), {
		status: result.status,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Read the CSRF token from the non-httpOnly cookie set by the server.
 */
function getCsrfToken(): string | null {
	const match = document.cookie.match(/(?:^|;\s*)csrf-token=([^;]*)/);
	return match ? match[1]! : null;
}

/**
 * Evict cache entries that may have been invalidated by a mutation.
 * Called automatically after successful POST/PUT/PATCH/DELETE.
 */
function evictAffectedCaches(url: string): void {
	// Normalise the URL to an absolute URL with origin so it matches
	// how the browser stores cached requests (always with origin).
	// The `url` parameter here comes from a mutation (POST/PUT/DELETE)
	// and may be a relative path like "/api/chats/conversations/abc/messages"
	// while cached GET requests are stored with full origin like
	// "http://localhost:5173/api/chats/conversations/abc/messages?limit=20".
	const cacheKey = new URL(url, window.location.origin).pathname;

	// Special-case: community-mutating mutations (create, update, delete, join,
	// leave, and the settings toggles for messaging / audio calls / video calls)
	// invalidate the "/api/communities/mine" list.
	// Without this:
	//  - a stale cached list (without the new membership) was served, so newly
	//    joined communities didn't appear in "My Communities".
	//  - after toggling "Audio/Video Calls" in community settings, the cached
	//    list still held the OLD flag values, so reopening the community from
	//    the list served the stale settings and the toggle appeared to revert.
	// NOTE: deliberately narrow — message/media sub-resource mutations
	// (e.g. POST /api/communities/:id/messages) do NOT affect membership or
	// settings, so they must NOT evict the "mine" list on every message sent.
	const segments = cacheKey.split("/").filter(Boolean); // e.g. ["api","communities","<id>","join"]
	// Mutations that change the community LIST data (membership or settings
	// flags like audio/video calls + messaging) must invalidate cached lists.
	const isCommunityListMutation =
		(segments.length === 2 && segments[0] === "api" && segments[1] === "communities") ||
		(segments.length === 3 && segments[0] === "api" && segments[1] === "communities") ||
		(segments.length === 4 &&
			segments[0] === "api" &&
			segments[1] === "communities" &&
			(segments[3] === "join" ||
				segments[3] === "leave" ||
				segments[3] === "toggle-audio-calls" ||
				segments[3] === "toggle-video-calls" ||
				segments[3] === "toggle-messaging"));

	// Post-interaction mutations (like / save / repost / share / view) change
	// the interaction flags (likedByMe / savedByMe / repostedByMe / counts)
	// embedded INSIDE every cached post object — so they must invalidate the
	// feed/list caches too, not just their own path. Without this, a stale
	// cached /api/posts response (with likedByMe:false) is served after a
	// page refresh, making the like/save/repost appear to "revert".
	// NOTE: deliberately excludes the `view` mutation — views increment on
	// EVERY post open, so evicting all cached feeds on each view would
	// defeat cache-first entirely. Views are low-stakes for staleness.
	const isPostInteractionMutation =
		(segments[0] === "api" && segments[1] === "likes" && segments[2] === "post") ||
		(segments[0] === "api" && segments[1] === "saves") ||
		(segments[0] === "api" && segments[1] === "reposts") ||
		(segments[0] === "api" && segments[1] === "posts" && segments.length >= 4 &&
			(segments[3] === "like" || segments[3] === "unlike" || segments[3] === "share" ||
				segments[3] === "quote-repost" || segments[3] === "vote"));

	// A cached URL is a post list/feed/single-post that embeds interaction state.
	const isPostCache = (cachedPath: string) =>
		cachedPath === "/api/posts" ||
		cachedPath.startsWith("/api/posts/") ||
		cachedPath.startsWith("/api/feed") ||
		cachedPath === "/api/saves" ||
		cachedPath.startsWith("/api/saves/") ||
		cachedPath === "/api/reposts" ||
		cachedPath.startsWith("/api/reposts/") ||
		cachedPath.startsWith("/api/search/posts");

	// Chat message mutations (send/delete/clear) change lastMessage + unreadCounts,
	// so the cached conversation LIST must be invalidated too — otherwise a stale
	// list (with outdated unread badge counts) is served on the next read, causing
	// the "unread count is off by one" / "badge doesn't show" bugs.
	// Covers both POST/DELETE /api/chats/conversations/:id/messages (send/clear)
	// AND DELETE /api/chats/messages/:id and /messages/:id/delete-for-me.
	const isChatMessageMutation =
		segments[0] === "api" &&
		segments[1] === "chats" &&
		((segments[2] === "conversations" &&
			segments.length >= 5 &&
			segments[4] === "messages") ||
			(segments[2] === "messages" && segments.length >= 4));

	// Streak/XP mutations (claim daily reward, partner streaks) change the
	// cached streak + achievement state — evict them so the next read is
	// fresh (no "I had to reload to see my streak update").
	const isStreakMutation =
		segments[0] === "api" && segments[1] === "streaks";
	const isStreakAffectedCache = (cachedPath: string) =>
		cachedPath.startsWith("/api/streaks/") ||
		cachedPath.startsWith("/api/xp/") ||
		cachedPath === "/api/streaks";

	// A cached URL that embeds conversation unread badge state.
	const isConversationCache = (cachedPath: string) =>
		cachedPath === "/api/chats/conversations";

	// Mutations that change the CURRENT USER's account-level flags must evict
	// the cached /api/auth/me response. CacheStorage survives reloads, so a
	// stale cached user (e.g. with permissionOnboardingCompleted:false BEFORE
	// the one-time onboarding was completed) would otherwise be served on the
	// next reload — re-opening the permission onboarding forever. The session
	// check intentionally stays cache-first for OFFLINE session restore; this
	// eviction keeps the cache honest whenever the underlying data changes.
	const isUserAccountMutation =
		(segments[0] === "api" && segments[1] === "permissions") ||
		(segments[0] === "api" &&
			segments[1] === "users" &&
			(segments[2] === "update-profile" || segments[2] === "update-password"));

	// Follow/unfollow mutations (POST /api/follows/:userId) change follow state
	// embedded EVERYWHERE in the cache:
	//  - profiles (/api/users/username/:x, /api/users/:id) embed followingByMe
	//    + followersCount,
	//  - suggestions + search users embed isFollowing,
	//  - followers/following lists embed per-row isFollowing,
	//  - the cached current user (/api/auth/me) embeds followingCount,
	//  - feed lists change too (following/unfollowing adds/removes posts).
	// Without evicting all of these, the next cache-first read serves STALE
	// state: Follow buttons "revert", an unfollowed user reappears as
	// "Following" after reload, and counts stay frozen at their old values.
	const isFollowMutation =
		segments[0] === "api" && segments[1] === "follows";

	// A cached path whose data is affected by a follow/unfollow.
	const isFollowAffectedCache = (cachedPath: string) =>
		cachedPath === "/api/auth/me" ||
		cachedPath === "/api/auth/me/" ||
		cachedPath.startsWith("/api/users/") ||
		cachedPath.startsWith("/api/follows/") ||
		cachedPath.startsWith("/api/search/users") ||
		cachedPath === "/api/posts" ||
		cachedPath.startsWith("/api/feed");

	// Fire-and-forget: clear caches that might be stale
	Promise.resolve().then(async () => {
		const cache = await caches.open("orbit-api-v1");
		const requests = await cache.keys();

		// A cached URL matches the mutation if it's the same path, a parent
		// collection of it, or a child resource of it. Pure pathname comparison
		// (query strings stripped) so query-string variants are covered too.
		// e.g. POST /api/posts → evict GET /api/posts and /api/posts?page=2
		// e.g. DELETE /api/posts/abc → evict /api/posts/abc and /api/posts (list)
		const isAffectedPath = (cachedPath: string) =>
			cachedPath === cacheKey ||
			cachedPath.startsWith(cacheKey + "/") ||
			cacheKey.startsWith(cachedPath + "/") ||
			// Community list mutations always invalidate the "mine" list
			(isCommunityListMutation && cachedPath === "/api/communities/mine") ||
			// Post interactions (like/save/repost/share) invalidate ALL cached
			// post lists/feeds because they embed interaction state
			(isPostInteractionMutation && isPostCache(cachedPath)) ||
			// Chat message mutations invalidate the cached conversation list
			(isChatMessageMutation && isConversationCache(cachedPath)) ||
			// Streak/XP mutations (claim daily reward, partner streaks)
			// invalidate cached streak + achievement data
			(isStreakMutation && isStreakAffectedCache(cachedPath)) ||
			// Permission/profile mutations invalidate the cached current-user
			// (the session-restore / onboarding-flag source of truth)
			(isUserAccountMutation &&
				(cachedPath === "/api/auth/me" ||
					cachedPath === "/api/auth/me/" )) ||
			// Follow/unfollow invalidates every surface that embeds follow
			// state (profiles, suggestions, search, follows lists, current
			// user, feed lists) — see isFollowAffectedCache above.
			(isFollowMutation && isFollowAffectedCache(cachedPath));

		const urlsToDelete: Request[] = [];
		// Pathnames (query stripped) that must ALSO be purged from the Dexie
		// structured store — see purgeOfflineDataForPath in offlineDB.ts.
		const dexiePathsToPurge = new Set<string>();

		for (const req of requests) {
			// Strip origin + query params from the cached URL for comparison
			// e.g. "http://localhost:5173/api/chats/conversations/abc/messages?limit=20"
			//      → "/api/chats/conversations/abc/messages"
			const cachedPath = new URL(req.url).pathname;
			if (isAffectedPath(cachedPath)) {
				urlsToDelete.push(req);
				dexiePathsToPurge.add(cachedPath);
			}
		}

		// The mutation's own path is affected even if nothing matching was
		// cached in CacheStorage (e.g. first-ever mutation) — Dexie may still
		// hold rows from an earlier fetch, and they must not resurrect.
		dexiePathsToPurge.add(cacheKey);

		await Promise.all(urlsToDelete.map((r) => cache.delete(r)));

		// The service worker caches API GETs in its own runtime caches
		// (`orbit-api-cache` NetworkFirst, `orbit-chat-messages`) — stores
		// completely separate from the `orbit-api-v1` cache swept above. A stale
		// SW entry (written before a mutation completed) is served by NetworkFirst
		// when the backend is slow (its 5s network timeout kicks in), REVERTING
		// the optimistic UI update — e.g. "Mark all read" flips back to unread
		// moments later, reading as "the button doesn't work". Purge the same
		// URLs from the SW caches so fresh state sticks. This also covers the
		// stale /api/auth/me flag that re-opened the onboarding on cold starts.
		// Matching by PATHNAME (not exact URL) because the SW caches can hold
		// query-string variants that never landed in `orbit-api-v1`.
		try {
			const swCache = await caches.open("orbit-api-cache");
			const swRequests = await swCache.keys();
			await Promise.all(
				swRequests
					.filter((r) => isAffectedPath(new URL(r.url).pathname))
					.map((r) => swCache.delete(r)),
			);
			const chatCache = await caches.open("orbit-chat-messages");
			const chatRequests = await chatCache.keys();
			await Promise.all(
				chatRequests
					.filter((r) => isAffectedPath(new URL(r.url).pathname))
					.map((r) => chatCache.delete(r)),
			);
		} catch {
			// Best-effort — a cache hiccup must never break a mutation.
		}

		// THE FINAL STORE: Dexie (IndexedDB). Every component falls back to
		// getOfflineFallback() when CacheStorage misses, so a stale Dexie copy
		// written before the mutation resurrects deleted data / reverted flags
		// on the next reload or tab remount — the "deleted it, reload, it's
		// back, then it self-fixes ~30s later" bug that showed up on almost
		// every screen. Purging the same paths here closes that hole.
		try {
			await Promise.all(
				[...dexiePathsToPurge].map((p) =>
					purgeOfflineDataForPath(p),
				),
			);
		} catch {
			// Best-effort — a cache hiccup must never break a mutation.
		}
	});
}

// A stale EMPTY membership list is worse than a cache miss: it makes "My
// Communities" / the conversation list look permanently empty, because the
// SWR layer keeps re-serving the cached empty copy on every non-bypass fetch
// (background refreshes, tab opens) and nothing ever revalidates it. Never
// cache empty lists for these endpoints — a later fetch always hits the
// network instead of getting a wrong-but-cached answer.
const MEMBERSHIP_LIST_RE = /\/api\/(communities\/mine|chats\/conversations)(\?|$)/i;
const isEmptyMembershipList = (url: string, data: unknown): boolean => {
	if (!MEMBERSHIP_LIST_RE.test(url)) return false;
	const list = (data as any)?.communities ?? (data as any)?.conversations;
	return Array.isArray(list) && list.length === 0;
};

// Extended options: `bypassCache` forces a network fetch on GET requests,
// skipping the cache-first path. Used by hard refreshes (pull-to-refresh,
// tab switches, opening a single post) so fresh data is always shown.
export interface ApiFetchOptions extends RequestInit {
	bypassCache?: boolean;
}

export async function apiFetch(
	url: string,
	options: ApiFetchOptions = {},
): Promise<Response> {
	const method = (options.method || "GET").toUpperCase();

	const headers: Record<string, string> = {
		...(options.headers as Record<string, string>),
	};

	if (method !== "GET") {
		const csrfToken = getCsrfToken();
		if (csrfToken) {
			headers["x-csrf-token"] = csrfToken;
		}			try {
				// Clone Response to prevent "body already consumed" errors from multiple readers
				const res = await fetch(url, {
					...options,
					method,
					headers,
					credentials: "include",
				});

				if (res.status === 401) {
					window.dispatchEvent(new CustomEvent("auth:expired"));
				}

				if (res.ok) {
					// Evict caches on successful mutations
					evictAffectedCaches(url);

					// ── Mutation write-through ──
					// Persist the CONFIRMED entity into Dexie immediately so the
					// created/updated item survives a reload without waiting for
					// the next GET. The eviction above purged stale rows; this
					// re-seeds the fresh copy from the server's own response.
					// Fire-and-forget — never block the mutation on a cache write.
					void res
						.clone()
						.json()
						.then((data) => cacheIntoDexie(url, data))
						.catch(() => {
							// Non-JSON or non-cacheable response — ignore.
						});
				}

				return res.clone();
			} catch (err) {
			// Network error — queue the mutation for later if offline
			if (!navigator.onLine) {
				logger.warn("apiFetch: Offline, queueing mutation", { url, method });
				const body = options.body instanceof FormData
					? undefined  // FormData can't be easily queued
					: options.body instanceof ReadableStream
						? undefined
						: options.body as string | undefined;
				await addToSyncQueue(url, method as "POST" | "PUT" | "DELETE", body ? JSON.parse(body) : undefined, headers);
				// Return a fake success response so the UI doesn't break
				return new Response(JSON.stringify({ success: true, queued: true }), {
					status: 202,
					headers: { "Content-Type": "application/json" },
				});
			}
			throw err;
		}
	}

	// ── GET: stale-while-revalidate + deduplication ─────────────────

	// Live search queries (/search?q=… and /api/search/users|posts?q=…) are
	// ALWAYS fetched fresh from the network. Cached search results go stale
	// the instant new content arrives, and a stale empty result makes search
	// feel completely broken ("I searched but nothing shows"). This covers
	// every search endpoint in the app (message search in chats + communities,
	// user search, post search) without needing bypassCache at each call site.
	const isLiveSearch = /\/search[\/?]/.test(url);

	// `bypassCache` forces a network fetch (used for hard refreshes like
	// fetchPosts(true) and tab switches) so new data always shows up
	// immediately instead of serving a stale cached response.
	const bypassCache = options.bypassCache === true || isLiveSearch;

	// 1. Check cache for instant response (CacheStorage first, then Dexie)
	let cachedData = bypassCache ? null : await getCachedResponse(url);

	// If offline and no CacheStorage hit, try Dexie for structured queries
	if (cachedData === null && !navigator.onLine) {
		cachedData = await getOfflineFallback(url);
	}

	// 2. Check if there's already an in-flight request
	const pending = pendingRequests.get(url);
	if (pending) {
		// If cached data exists, return it immediately — don't trigger an
		// additional background refresh here because the periodic timer
		// (every 30s) already handles stale-while-revalidate. Calling
		// refreshCache from this path creates a re-render cycle:
		//   apiFetch → refreshCache → dispatch event → useCacheRefresh callback → apiFetch → ...
		if (cachedData !== null && !bypassCache) {
			return toJsonResponse({ ok: true, status: 200, data: cachedData });
		}
		// No cache — wait for the in-flight request
		const result = await pending;
		return toJsonResponse(result);
	}

	// 3. If cached data exists, return instantly — periodic timer handles refresh
	if (cachedData !== null && !bypassCache) {
		return toJsonResponse({ ok: true, status: 200, data: cachedData });
	}

	// 4. First-time fetch — wait for network and cache the result
	const requestPromise = (async (): Promise<FetchResult> => {
		const res = await fetch(url, {
			...options,
			method: "GET",
			headers,
			credentials: "include",
		});
		if (res.status === 401) {
			window.dispatchEvent(new CustomEvent("auth:expired"));
		}

		let data: unknown = null;
		if (res.headers.get("content-type")?.includes("application/json")) {
			try {
				data = await res.json();
			} catch {
				data = null;
			}
		}

		return { ok: res.ok, status: res.status, data };
	})();

	pendingRequests.set(url, requestPromise);

	try {
		const result = await requestPromise;

		// Cache the result in both CacheStorage and Dexie — except empty
		// membership lists, which must never be cached (see
		// isEmptyMembershipList above): a cached empty "my communities" / chat
		// list is what made those screens look permanently empty.
		if (
			result.ok &&
			result.data !== null &&
			!isLiveSearch &&
			!isEmptyMembershipList(url, result.data)
		) {
			await setCachedResponse(url, result.data);
			// Also cache into Dexie for offline structured queries
			await cacheIntoDexie(url, result.data);
		}

		return toJsonResponse(result);
	} finally {
		pendingRequests.delete(url);
	}
}

/**
 * Clear all cached API data — useful after logout or when switching accounts.
 */
/**
 * Upload a FormData payload over XMLHttpRequest so we can report REAL upload
 * progress — fetch() does not expose upload progress. Mirrors apiFetch's
 * auth (cookies + CSRF header), 401 handling and mutation cache-eviction so
 * callers can swap it in for media sends without behavior changes.
 *
 * onProgress receives an integer 0–100. The returned Response resolves once
 * the request completes; aborting the passed signal aborts the upload.
 */
export function uploadWithProgress(
	url: string,
	options: {
		method?: string;
		body: FormData;
		signal?: AbortSignal;
		onProgress?: (percent: number) => void;
	},
): Promise<Response> {
	const { onProgress } = options;
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open(options.method || "POST", url, true);
		xhr.withCredentials = true;

		const csrfToken = getCsrfToken();
		if (csrfToken) {
			xhr.setRequestHeader("x-csrf-token", csrfToken);
		}

		const detachAbort = () => {
			if (options.signal) {
				options.signal.removeEventListener("abort", onSignalAbort);
			}
		};
		const onSignalAbort = () => xhr.abort();

		if (options.signal) {
			if (options.signal.aborted) {
				const abortErr: any = new Error("The user aborted a request.");
				abortErr.name = "AbortError";
				reject(abortErr);
				return;
			}
			options.signal.addEventListener("abort", onSignalAbort, {
				once: true,
			});
		}

		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable && onProgress) {
				onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
			}
		};

		xhr.onload = () => {
			detachAbort();
			// Guarantee a terminal 100% so the bar resolves even when the last
			// upload event didn't report the final byte count.
			onProgress?.(100);
			if (xhr.status === 401) {
				window.dispatchEvent(new CustomEvent("auth:expired"));
			}
			if (xhr.status >= 200 && xhr.status < 300) {
				evictAffectedCaches(url);
			}
			const res = new Response(xhr.responseText, {
				status: xhr.status,
				statusText: xhr.statusText,
				headers: {
					"Content-Type":
						xhr.getResponseHeader("Content-Type") ||
						"application/json",
				},
			});
			resolve(res);
		};

		xhr.onerror = () => {
			detachAbort();
			reject(new Error("Network request failed"));
		};
		xhr.onabort = () => {
			detachAbort();
			const abortErr: any = new Error("The user aborted a request.");
			abortErr.name = "AbortError";
			reject(abortErr);
		};

		xhr.send(options.body);
	});
}

export async function clearAllCaches(): Promise<void> {
	await clearApiCache();
	await clearOfflineDB();
}

// Re-export cache lifecycle helpers so App.tsx can manage the refresh timer
export { stopCacheRefreshTimer };

/**
 * Tab-to-endpoint map for cache warming.
 * Each tab maps to the API endpoints that should be pre-fetched
 * so the user sees data INSTANTLY when they navigate there.
 */
const TAB_ENDPOINTS: Record<string, string[]> = {
	home: ["/api/posts", "/api/feed/for-you", "/api/glimpses/feed"],
	explore: ["/api/posts/trending/hashtags", "/api/posts?limit=5&sort=likesCount"],
	notifications: ["/api/notifications", "/api/notifications/unread-count"],
	chat: ["/api/chats/conversations"],
	communities: ["/api/communities?limit=50", "/api/communities/mine"],
	profile: [] as string[],
	settings: [] as string[],
	// NOTE: the ?limit=10 query strings MUST match what Profile.tsx actually
	// fetches — the client cache key includes the query string.
	saved: ["/api/saves?limit=10"],
	reposts: ["/api/reposts?limit=10"],
	admin: ["/api/reports?status=pending&limit=20", "/api/admin/flags"],
};

/**
 * Get the API endpoints to prefetch for a given tab.
 */
export function getEndpointsForTab(tabId: string): string[] {
	return TAB_ENDPOINTS[tabId] || [];
}

/**
 * Pre-fetch API data in the background to warm the cache.
 * Uses requestIdleCallback to avoid competing with critical rendering.
 * Fires-and-forgets — errors are silently ignored.
 */
// Offline-first Dexie helpers now live in ./dexieBridge (cacheIntoDexie,
// getOfflineFallback) — imported above.

export function warmCache(urls: string[], registerForRefresh = true): void {
	if (urls.length === 0) return;

	const doFetch = () => {
		urls.forEach((url) => {
			apiFetch(url).catch(() => {
				// Silently ignore — prefetching is non-critical
			});
			// Register each URL for periodic background refreshes
			// so the cache stays warm even without user navigation
			if (registerForRefresh) {
				addToRefreshSchedule(url);
			}
		});
	};

	if (
		typeof window !== "undefined" &&
		"requestIdleCallback" in window
	) {
		(window as any).requestIdleCallback(() => doFetch(), {
			timeout: 3000,
		});
	} else {
		setTimeout(doFetch, 500);
	}
}

// type-safe fetch wrappers for each endpoint with proper error handling
