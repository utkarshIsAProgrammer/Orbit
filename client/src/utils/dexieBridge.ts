/**
 * dexieBridge.ts — Connects the API layer to the Dexie offline database.
 *
 * Two jobs:
 * 1. `cacheIntoDexie(url, data)` — upsert API responses into structured
 *    IndexedDB tables so offline queries can serve them.
 * 2. `getOfflineFallback(url)` — when offline (and CacheStorage missed),
 *    serve structured data from IndexedDB for every major view: feed,
 *    saves, reposts, single post, conversations, messages, community
 *    messages, notifications, users, and search.
 *
 * CRITICAL FIX vs. the old inline implementation: API responses are
 * OBJECT-shaped (`{ success: true, posts: [...] }`), not arrays. The old
 * code guarded every branch with `Array.isArray(data)` — which never
 * matched — so the Dexie tables were NEVER populated and offline viewing
 * silently returned empty data for posts, notifications, and conversations.
 */

import {
	cachePosts,
	cacheNotifications,
	cacheConversations,
	cacheMessages,
	cacheCommunityMessages,
	cacheUsers,
	getCachedConversations,
	getCachedConversationMessages,
	getCachedCommunityMessages,
	getCachedNotifications,
	getCachedPosts,
	getCachedSinglePost,
	getCachedPostBySlug,
	getCachedUserPosts,
	getCachedUserByUsername,
	searchCachedPosts,
	cacheCommentThread,
	getCachedComments,
	getCachedCommentThreadMeta,
	cacheGlances,
	getCachedGlances,
	cacheCommunities,
	getCachedCommunities,
} from "./offlineDB";
import type {
	Conversation,
	Message,
	CommunityMessage,
	Post,
	Notification,
	User,
	Comment,
	Glance,
	Community,
} from "../types";

/**
 * Extract the list for a given key from a response that may be either
 * a bare array or an object-wrapped shape (`{ success, <key>: [...] }`).
 */
function extractList(
	data: unknown,
	key: string,
): Record<string, unknown>[] | null {
	if (Array.isArray(data)) return data as Record<string, unknown>[];
	const obj = data as Record<string, unknown> | null;
	const value = obj?.[key];
	return Array.isArray(value) ? (value as Record<string, unknown>[]) : null;
}

/** Extract a single object for a key from a response object. */
function extractOne(
	data: unknown,
	key: string,
): Record<string, unknown> | null {
	if (!data || typeof data !== "object") return null;
	const value = (data as Record<string, unknown>)[key];
	return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * Upsert API response data into Dexie based on the URL pattern.
 * Safe to call on every successful GET / background refresh — writes
 * are idempotent and failures are silently ignored.
 */
export async function cacheIntoDexie(
	url: string,
	data: unknown,
): Promise<void> {
	try {
		const path = url.split("?")[0];

		// ── Comment threads: /api/comments/:postId (top-level page, NOT the
		// /all variant and NOT reply threads) ────────────────────────────
		const commentsMatch = path.match(/^\/api\/comments\/([^/]+)$/);
		if (commentsMatch) {
			const comments = extractList(data, "comments");
			if (comments) {
				await cacheCommentThread(
					commentsMatch[1],
					comments as unknown as Comment[],
					{
						cursor: (data as Record<string, unknown>).nextCursor as
							| string
							| null
							| undefined,
						hasMore: !!(data as Record<string, unknown>).hasMore,
					},
				);
			}
			return;
		}

		// ── Posts / feed / saves / reposts lists ────────────────────────
		// /api/posts, /api/posts?limit=…, /api/saves, /api/reposts,
		// /api/feed, /api/posts/trending (hashtag lists carry no posts),
		// and /api/users/:id/posts (profile grids — the substring
		// "/api/posts" does NOT appear in that URL, so it needs its own match)
		if (
			path.includes("/api/posts") ||
			path.includes("/api/feed") ||
			/\/api\/users\/[^/]+\/posts/.test(path)
		) {
			const posts = extractList(data, "posts");
			if (posts && posts.length) {
				await cachePosts(posts as unknown as Post[]);
			}
			// Single post endpoint: /api/posts/:id, /api/posts/slug/:slug
			const single = extractOne(data, "post");
			if (single && (single as { _id?: string })._id) {
				await cachePosts([single as unknown as Post]);
			}
			return;
		}

		// ── Notifications ───────────────────────────────────────────────
		if (path.includes("/api/notifications")) {
			const notifs = extractList(data, "notifications");
			if (notifs && notifs.length) {
				await cacheNotifications(notifs as unknown as Notification[]);
			}
			return;
		}

		// ── Conversation list ───────────────────────────────────────────
		if (path.includes("/api/chats/conversations")) {
			// .../conversations  → list of conversations
			const convs = extractList(data, "conversations");
			if (convs && convs.length) {
				await cacheConversations(convs as unknown as Conversation[]);
			}
			// .../conversations/:id/messages → messages
			if (path.includes("/messages")) {
				const msgs = extractList(data, "messages");
				if (msgs && msgs.length) {
					await cacheMessages(msgs as unknown as Message[]);
				}
			}
			return;
		}

		// ── Community messages ──────────────────────────────────────────
		const commMsgMatch = path.match(/\/api\/communities\/([^/]+)\/messages/);
		if (commMsgMatch) {
			const msgs = extractList(data, "messages");
			if (msgs && msgs.length) {
				await cacheCommunityMessages(msgs as unknown as CommunityMessage[]);
			}
			return;
		}

		// ── Community list ──────────────────────────────────────────────
		// /api/communities and /api/communities/mine (NOT the /messages
		// variant handled above). Mine is a subset of all — both are cached
		// into the same table, and the fallback returns the full list.
		if (path === "/api/communities" || path === "/api/communities/mine") {
			const comms = extractList(data, "communities");
			if (comms && comms.length) {
				await cacheCommunities(comms as unknown as Community[]);
			}
			return;
		}

		// ── Glance strips: /api/glimpses/feed and /api/glimpses/user/:id ─
		const glimpsesMatch = path.match(/^\/api\/glimpses\/user\/([^/]+)$/);
		if (glimpsesMatch) {
			const glimpses = extractList(data, "glimpses");
			if (glimpses && glimpses.length) {
				await cacheGlances(
					glimpses as unknown as Glance[],
					glimpsesMatch[1],
				);
			}
			return;
		}
		if (path === "/api/glimpses/feed") {
			const glimpses = extractList(data, "glimpses");
			if (glimpses && glimpses.length) {
				await cacheGlances(glimpses as unknown as Glance[], "feed");
			}
			return;
		}

		// ── Users ───────────────────────────────────────────────────────
		if (path.includes("/api/users") || path.includes("/api/search/users")) {
			const users = extractList(data, "users");
			if (users && users.length) {
				await cacheUsers(users as unknown as User[]);
			}
			const single = extractOne(data, "user");
			if (single && (single as { _id?: string })._id) {
				await cacheUsers([single as unknown as User]);
			}
			return;
		}
	} catch {
		// Non-critical — silently ignore Dexie cache errors
	}
}

/**
 * Serve structured data from Dexie when the device is offline and the
 * CacheStorage layer had no hit for this exact URL.
 *
 * Returns the SAME response shape the endpoint would return online so
 * callers need zero offline-awareness.
 */
export async function getOfflineFallback(
	url: string,
): Promise<unknown> {
	try {
		const path = url.split("?")[0];
		const urlObj = new URL(url, window.location.origin);
		const limit = parseInt(urlObj.searchParams.get("limit") || "20", 10);

		// ── Messages for a conversation ─────────────────────────────────
		const msgMatch = path.match(/\/api\/chats\/conversations\/([^/]+)\/messages/);
		if (msgMatch) {
			const convId = msgMatch[1];
			const messages = await getCachedConversationMessages(convId, limit);
			return { success: true, messages };
		}

		// ── Conversation list ───────────────────────────────────────────
		if (path.includes("/api/chats/conversations")) {
			const conversations = await getCachedConversations(limit);
			return { success: true, conversations };
		}

		// ── Community messages ──────────────────────────────────────────
		const commMsgMatch = path.match(/\/api\/communities\/([^/]+)\/messages/);
		if (commMsgMatch) {
			const commId = commMsgMatch[1];
			const messages = await getCachedCommunityMessages(commId, limit);
			return { success: true, messages };
		}

		// ── Notifications ───────────────────────────────────────────────
		if (path.includes("/api/notifications")) {
			const notifications = await getCachedNotifications("", limit);
			return { success: true, notifications };
		}

		// ── Glance strips: /api/glimpses/feed and /api/glimpses/user/:id ─
		const glimpseUserMatch = path.match(/^\/api\/glimpses\/user\/([^/]+)$/);
		if (glimpseUserMatch) {
			const glimpses = await getCachedGlances(glimpseUserMatch[1], limit);
			return { success: true, glimpses };
		}
		if (path === "/api/glimpses/feed") {
			const glimpses = await getCachedGlances("feed", limit);
			return { success: true, glimpses };
		}

		// ── Community list ──────────────────────────────────────────────
		if (path === "/api/communities" || path === "/api/communities/mine") {
			const communities = await getCachedCommunities(limit);
			return { success: true, communities };
		}

		// ── Comment thread: /api/comments/:postId (top-level page) ───────
		const commentsMatch = path.match(/^\/api\/comments\/([^/]+)$/);
		if (commentsMatch) {
			const postId = commentsMatch[1];
			const comments = await getCachedComments(postId, limit);
			if (comments.length > 0) {
				const meta = await getCachedCommentThreadMeta(postId);
				return {
					success: true,
					comments,
					nextCursor: meta?.cursor ?? null,
					hasMore: meta?.hasMore ?? false,
				};
			}
			return null;
		}

		// ── Single post by slug (deep-link view): /api/posts/slug/:slug ──
		const slugMatch = path.match(/^\/api\/posts\/slug\/([^/]+)$/);
		if (slugMatch) {
			const post = await getCachedPostBySlug(slugMatch[1]);
			return post ? { success: true, post } : null;
		}

		// ── Single post: /api/posts/:id (not slug, not a list) ──────────
		const singlePostMatch = path.match(/^\/api\/posts\/([^/]+)$/);
		if (singlePostMatch) {
			const post = await getCachedSinglePost(singlePostMatch[1]);
			return post ? { success: true, post } : null;
		}

		// ── User's post grid: /api/users/:id/posts ──────────────────────
		const userPostsMatch = path.match(/\/api\/users\/([^/]+)\/posts/);
		if (userPostsMatch) {
			const posts = await getCachedUserPosts(userPostsMatch[1], limit);
			return { success: true, posts };
		}

		// ── Single user profile ─────────────────────────────────────────
		const userMatch = path.match(/^\/api\/users\/username\/([^/]+)$/);
		if (userMatch) {
			const user = await getCachedUserByUsername(userMatch[1]);
			return user ? { success: true, user } : null;
		}

		// ── Post search ─────────────────────────────────────────────────
		if (path.includes("/api/search/posts")) {
			const q = urlObj.searchParams.get("q") || "";
			const posts = await searchCachedPosts(q, limit);
			return { success: true, posts };
		}

		// ── Posts / Saves / Reposts lists ───────────────────────────────
		if (/^\/api\/posts$|^\/api\/posts\?|^\/api\/saves|^\/api\/reposts/.test(path)) {
			let posts = await getCachedPosts(limit);
			// Saves list → only posts the user saved; Reposts → only reposted.
			// Keeps the offline lists honest so an unsaved post doesn't appear
			// in the user's Saved tab when offline.
			if (path.includes("/api/saves")) {
				posts = posts.filter((p) => p.savedByMe);
			} else if (path.includes("/api/reposts")) {
				posts = posts.filter((p) => p.repostedByMe);
			}
			return { success: true, posts };
		}

		return null;
	} catch {
		return null;
	}
}
