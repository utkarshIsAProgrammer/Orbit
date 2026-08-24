/**
 * primeCache.ts — Warms the offline caches the MOMENT a user joins, so the
 * app is fully offline-capable from the very first session instead of only
 * caching whatever happens to get browsed.
 *
 * It force-fetches every core data endpoint with bypassCache: true. Those
 * requests flow through apiFetch → CacheStorage (apiCache.ts) + Dexie
 * (dexieBridge.cacheIntoDexie), using EXACTLY the same URLs the components
 * hit at runtime, so every later cache lookup keys on a hit — the home
 * feed, for-you feed, notifications, chats (incl. their messages),
 * communities, glances, streaks, XP, blocks, close friends, follow
 * requests, collections and drafts all become readable offline.
 *
 * Deliberately fire-and-forget: never awaited by callers, never blocks the
 * UI, every failure swallowed (the app degrades to normal online behavior).
 */

import { apiFetch } from "./api";
import { logger } from "./logger";

// Core list endpoints — exact runtime URLs so cache keys match.
const CORE_ENDPOINTS = (userId: string): string[] => [
	"/api/posts?limit=10", // home feed
	"/api/feed/for-you?limit=10&page=1", // for-you feed
	"/api/notifications",
	"/api/chats/conversations", // conversation list (messages primed after)
	"/api/communities?limit=50",
	"/api/communities/mine",
	"/api/glimpses",
	"/api/streaks/my",
	"/api/xp/achievements",
	`/api/xp/${userId}`,
	"/api/blocks",
	"/api/users/close-friends",
	"/api/users/follow-requests",
	"/api/collections",
	"/api/posts/drafts",
	"/api/posts/trending/hashtags",
	`/api/users/${userId}/pinned`,
	`/api/follows/${userId}/following?limit=100`,
];

// How many recent conversations to pull messages for. Uses the EXACT URL
// Chat.tsx requests on open (?limit=20) — the cache key includes the query
// string, so priming the query-less variant would never hit at open time.
const MESSAGE_PRIME_CONVERSATIONS = 5;

// Max parallel requests — enough to finish fast, low enough to never starve
// the user's real interaction traffic right after login.
const CONCURRENCY = 4;

// Run once per page load — a reload restores the session and re-primes with
// fresh data (Dexie persists across reloads, so nothing is lost either way).
let primedThisSession = false;

async function runBatch<T>(items: T[], worker: (item: T) => Promise<unknown>) {
	let index = 0;
	const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
		while (index < items.length) {
			const item = items[index++];
			try {
				await worker(item);
			} catch {
				/* swallow — priming is best-effort */
			}
		}
	});
	await Promise.all(runners);
}

/**
 * Prime the offline caches for `userId`. Safe to call anywhere — it no-ops
 * when offline (nothing to fetch from), when the user is anonymous, or when
 * it already ran this page load.
 */
export async function primeOfflineCache(userId?: string): Promise<void> {
	if (!userId) return;
	if (!navigator.onLine) return;
	if (primedThisSession) return;
	primedThisSession = true;

	const endpoints = CORE_ENDPOINTS(userId);
	let ok = 0;

	// 1) All core list endpoints.
	await runBatch(endpoints, async (url) => {
		const res = await apiFetch(url, { bypassCache: true });
		if (res.ok) ok++;
	});

	// 2) Messages for the most recent conversations, so chats are readable
	// offline from day one. Pull the conversation list from the cache we just
	// primed (fast, no network round-trip).
	let conversations: { _id: string }[] = [];
	try {
		const res = await apiFetch("/api/chats/conversations", { bypassCache: true });
		const data = await res.json();
		conversations = (data.conversations || []).slice(0, MESSAGE_PRIME_CONVERSATIONS);
	} catch {
		/* ignore */
	}
	if (conversations.length > 0) {
		await runBatch(conversations, async (conv) => {
			// ?limit=20 MUST match Chat.tsx's open-conversation fetch — the
			// CacheStorage key includes the query string, so without it the
			// primed messages would never hit at open time.
			const res = await apiFetch(
				`/api/chats/conversations/${conv._id}/messages?limit=20`,
				{ bypassCache: true },
			);
			if (res.ok) ok++;
		});
	}

	logger.info(`primeCache: primed ${ok}/${endpoints.length + conversations.length} endpoints for @${userId}`);
}
