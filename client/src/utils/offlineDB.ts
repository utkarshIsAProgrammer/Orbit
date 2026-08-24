/**
 * offlineDB.ts — Dexie.js IndexedDB database for offline-first support.
 *
 * Provides structured offline storage for all major data types:
 * conversations, messages, communityMessages, posts, notifications, users.
 *
 * Also includes a syncQueue table for offline mutations that need
 * to be replayed when the network is restored.
 *
 * The CacheStorage API (apiCache.ts) continues to serve as a fast
 * response cache; this Dexie layer provides *queryable* offline access
 * so components can filter/search/sort data without hitting the network.
 */

import Dexie, { type EntityTable } from "dexie";
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

// ── Sync Queue Entry ──────────────────────────────────────────────────────
export interface SyncQueueEntry {
	id?: number; // auto-incremented primary key
	url: string; // the API endpoint to call (e.g. /api/chats/conversations/.../messages)
	method: "POST" | "PUT" | "DELETE";
	body?: string; // JSON-serialised request body
	headers?: Record<string, string>; // extra headers
	createdAt: number; // epoch timestamp
	retryCount: number; // how many times we've tried
	lastError?: string; // last error message
}

// Pagination state for a cached comment thread (the cursor/hasMore the feed
// needs to restore "load more" after an offline reload).
export interface CommentThreadMeta {
	postId: string; // primary key — the post this thread belongs to
	cursor: string | null;
	hasMore: boolean;
	updatedAt: number;
}

// A glance stamped with the strip it belongs to, so the offline fallback can
// serve the right rings per profile (and the home feed). ownerId is the
// profile id for `/api/glimpses/user/:id` and the sentinel "feed" for
// `/api/glimpses/feed`.
export interface CachedGlance extends Glance {
	ownerId: string;
}

// The payload of an UNSENT chat message, persisted so it survives reloads
// while offline. Shape mirrors Chat.tsx's `unsentPayloadsRef` entries.
// Blobs/File objects are structured-cloneable, so IndexedDB stores them
// natively — a voice note or photo queued offline can be rebuilt verbatim
// (including a fresh object URL) after a reload.
export interface PendingChatSendPayload {
	type: "message" | "voice_note";
	text?: string;
	files?: File[];
	previews?: string[];
	replyToId?: string | null;
	// True when image files were already downscaled at enqueue time — the
	// send executor skips its own re-encode so a large photo never blocks
	// other messages in the same conversation's send queue.
	fileDownscaled?: boolean;
	blob?: Blob;
	url?: string;
	duration?: number;
}

// A chat message that was sent optimistically but NOT yet confirmed by the
// server (still queued/in-flight). Persisted so an offline reload doesn't
// lose it — the thread rehydrates it and the send queue replays it in the
// exact order it was created (createdAt order = send order).
export interface PendingChatSend {
	localId: string; // the optimistic message's pendingId
	conversationId: string;
	payload: PendingChatSendPayload;
	createdAt: number;
}

// ── Dexie Database ────────────────────────────────────────────────────────
class OrbitDB extends Dexie {
	conversations!: EntityTable<Conversation, "_id">;
	messages!: EntityTable<Message, "_id">;
	communityMessages!: EntityTable<CommunityMessage, "_id">;
	posts!: EntityTable<Post, "_id">;
	notifications!: EntityTable<Notification, "_id">;
	users!: EntityTable<User, "_id">;
	comments!: EntityTable<Comment, "_id">;
	commentThreadMeta!: EntityTable<CommentThreadMeta, "postId">;
	glances!: EntityTable<CachedGlance, "_id">;
	communities!: EntityTable<Community, "_id">;
	pendingChatSends!: EntityTable<PendingChatSend, "localId">;
	syncQueue!: EntityTable<SyncQueueEntry, "id">;

	constructor() {
		super("OrbitDB");

		this.version(1).stores({
			// Conversations: primary key _id, index on updatedAt for sorting
			conversations: "_id, updatedAt",
			// Messages: primary key _id, index on conversation for filtering by chat,
			//          compound index on conversation+createdAt for chronological order
			messages: "_id, conversation, [conversation+createdAt], createdAt",
			// Community messages: primary key _id, index on community
			communityMessages: "_id, community, [community+createdAt], createdAt",
			// Posts: primary key _id, index on createdAt for feed sorting
			posts: "_id, createdAt, author._id",
			// Notifications: primary key _id, index on recipient+createdAt.
			// NOTE: a standalone createdAt index is REQUIRED — pruneOldData() and
			// the offline fallback both do orderBy("createdAt") / where("createdAt").
			// Without it Dexie throws "KeyPath createdAt not indexed" at runtime.
			notifications: "_id, recipient, createdAt, [recipient+createdAt]",
			// Users: primary key _id, index on username for search
			users: "_id, username",
			// Sync queue: auto-increment primary key, index on createdAt
			syncQueue: "++id, createdAt, retryCount",
		});

		// v2 — added the standalone createdAt index on notifications (v1 schema
		// lacked it, which made offline notification queries throw). Dexie
		// auto-migrates existing v1 databases; no data-loss upgrade fn needed.
		this.version(2).stores({
			conversations: "_id, updatedAt",
			messages: "_id, conversation, [conversation+createdAt], createdAt",
			communityMessages: "_id, community, [community+createdAt], createdAt",
			posts: "_id, createdAt, author._id",
			notifications: "_id, recipient, createdAt, [recipient+createdAt]",
			users: "_id, username",
			syncQueue: "++id, createdAt, retryCount",
		});

		// v3 — comment threads + their pagination meta, so opened comment
		// drawers survive offline reloads (IndexedDB is far more durable than
		// the CacheStorage layer the browser can evict).
		this.version(3).stores({
			conversations: "_id, updatedAt",
			messages: "_id, conversation, [conversation+createdAt], createdAt",
			communityMessages: "_id, community, [community+createdAt], createdAt",
			posts: "_id, createdAt, author._id",
			notifications: "_id, recipient, createdAt, [recipient+createdAt]",
			users: "_id, username",
			comments: "_id, post, [post+createdAt], createdAt",
			commentThreadMeta: "postId, updatedAt",
			syncQueue: "++id, createdAt, retryCount",
		});

		// v4 — glance strips (per profile, ownerId-scoped) and the community
		// list, so the rings and community tabs survive offline reloads too.
		this.version(4).stores({
			conversations: "_id, updatedAt",
			messages: "_id, conversation, [conversation+createdAt], createdAt",
			communityMessages: "_id, community, [community+createdAt], createdAt",
			posts: "_id, createdAt, author._id",
			notifications: "_id, recipient, createdAt, [recipient+createdAt]",
			users: "_id, username",
			comments: "_id, post, [post+createdAt], createdAt",
			commentThreadMeta: "postId, updatedAt",
			glances: "_id, ownerId, [ownerId+createdAt], createdAt",
			communities: "_id, updatedAt",
			syncQueue: "++id, createdAt, retryCount",
		});

		// v5 — syncQueue gains a url index so the offline queue can dedupe
		// by endpoint (addToSyncQueue does where("url").equals() to coalesce
		// duplicate/toggle mutations queued while offline).
		this.version(5).stores({
			conversations: "_id, updatedAt",
			messages: "_id, conversation, [conversation+createdAt], createdAt",
			communityMessages: "_id, community, [community+createdAt], createdAt",
			posts: "_id, createdAt, author._id",
			notifications: "_id, recipient, createdAt, [recipient+createdAt]",
			users: "_id, username",
			comments: "_id, post, [post+createdAt], createdAt",
			commentThreadMeta: "postId, updatedAt",
			glances: "_id, ownerId, [ownerId+createdAt], createdAt",
			communities: "_id, updatedAt",
			syncQueue: "++id, url, createdAt, retryCount",
		});

		// v6 — pendingChatSends: unsent chat messages (optimistic placeholders
		// whose POST hasn't confirmed) persisted so an offline reload keeps
		// them visible in the thread and replays them in send order when
		// connectivity returns. Blobs (media/voice) are structured-cloneable
		// so the full payload survives reloads.
		this.version(6).stores({
			conversations: "_id, updatedAt",
			messages: "_id, conversation, [conversation+createdAt], createdAt",
			communityMessages: "_id, community, [community+createdAt], createdAt",
			posts: "_id, createdAt, author._id",
			notifications: "_id, recipient, createdAt, [recipient+createdAt]",
			users: "_id, username",
			comments: "_id, post, [post+createdAt], createdAt",
			commentThreadMeta: "postId, updatedAt",
			glances: "_id, ownerId, [ownerId+createdAt], createdAt",
			communities: "_id, updatedAt",
			pendingChatSends: "localId, conversationId, createdAt",
			syncQueue: "++id, url, createdAt, retryCount",
		});
	}
}

// Singleton — one DB instance for the whole app
export const db = new OrbitDB();

// ── Bulk upsert helpers ──────────────────────────────────────────────────

/** Upsert conversations into local DB. */
export async function cacheConversations(
	convs: Conversation[],
): Promise<void> {
	await db.conversations.bulkPut(convs);
}

/** Upsert messages for a conversation. */
export async function cacheMessages(msgs: Message[]): Promise<void> {
	await db.messages.bulkPut(msgs);
}

/** Upsert a single message (used by real-time socket events). */
export async function cacheSingleMessage(msg: Message): Promise<void> {
	await db.messages.put(msg);
}

// ── Pending chat send helpers ────────────────────────────────────────────

/**
 * Persist an unsent (optimistic) chat message so it survives reloads and can
 * be replayed in order. Idempotent per localId.
 */
export async function putPendingChatSend(entry: PendingChatSend): Promise<void> {
	await db.pendingChatSends.put(entry);
}

/**
 * All unsent chat messages, oldest first (createdAt order = the order they
 * were sent = the order they must be replayed in).
 */
export async function getPendingChatSends(): Promise<PendingChatSend[]> {
	return db.pendingChatSends.orderBy("createdAt").toArray();
}

/** Remove a pending send once its POST confirms (or it's cancelled). */
export async function deletePendingChatSend(localId: string): Promise<void> {
	await db.pendingChatSends.delete(localId);
}

/** Upsert community messages. */
export async function cacheCommunityMessages(
	msgs: CommunityMessage[],
): Promise<void> {
	await db.communityMessages.bulkPut(msgs);
}

/** Upsert posts (feed, profile, etc.). */
export async function cachePosts(posts: Post[]): Promise<void> {
	await db.posts.bulkPut(posts);
}

/** Upsert notifications. */
export async function cacheNotifications(
	notifs: Notification[],
): Promise<void> {
	await db.notifications.bulkPut(notifs);
}

/** Upsert user profiles. */
export async function cacheUsers(users: User[]): Promise<void> {
	await db.users.bulkPut(users);
}

// ── Query helpers ─────────────────────────────────────────────────────────

/** Get cached messages for a conversation, newest first. */
export async function getCachedConversationMessages(
	conversationId: string,
	limit = 50,
): Promise<Message[]> {
	return db.messages
		.where({ conversation: conversationId })
		.reverse()
		.limit(limit)
		.toArray();
}

/** Get cached community messages, newest first. */
export async function getCachedCommunityMessages(
	communityId: string,
	limit = 50,
): Promise<CommunityMessage[]> {
	return db.communityMessages
		.where({ community: communityId })
		.reverse()
		.limit(limit)
		.toArray();
}

/** Search cached messages by text content. */
export async function searchCachedMessages(
	conversationId: string,
	query: string,
): Promise<Message[]> {
	const all = await db.messages
		.where({ conversation: conversationId })
		.toArray();
	const lower = query.toLowerCase();
	return all.filter(
		(m) =>
			!m.isDeleted && m.text && m.text.toLowerCase().includes(lower),
	);
}

/** Get cached notifications for a user, newest first. */
export async function getCachedNotifications(
	userId: string,
	limit = 30,
): Promise<Notification[]> {
	if (!userId) {
		// When called without a userId (e.g. from offline fallback),
		// return the most recent notifications across all users.
		return db.notifications
			.orderBy("createdAt")
			.reverse()
			.limit(limit)
			.toArray();
	}
	return db.notifications
		.where({ recipient: userId })
		.reverse()
		.limit(limit)
		.toArray();
}

/** Get cached posts, newest first. */
export async function getCachedPosts(limit = 20): Promise<Post[]> {
	return db.posts.orderBy("createdAt").reverse().limit(limit).toArray();
}

/** Get a single cached post by id. */
export async function getCachedSinglePost(
	postId: string,
): Promise<Post | undefined> {
	return db.posts.get(postId);
}

/** Get a single cached post by slug (deep-link view). */
export async function getCachedPostBySlug(
	slug: string,
): Promise<Post | undefined> {
	const all = await db.posts.toArray();
	return all.find((p) => p.slug === slug);
}

/** Get cached posts authored by a specific user (profile grid). */
export async function getCachedUserPosts(
	userId: string,
	limit = 20,
): Promise<Post[]> {
	return db.posts
		.where("author._id")
		.equals(userId)
		.reverse()
		.limit(limit)
		.toArray();
}

/** Get cached conversations, most recently active first. */
export async function getCachedConversations(
	limit = 50,
): Promise<Conversation[]> {
	return db.conversations
		.orderBy("updatedAt")
		.reverse()
		.limit(limit)
		.toArray();
}

/** Get a cached user by username (unique index). */
export async function getCachedUserByUsername(
	username: string,
): Promise<User | undefined> {
	return db.users.where("username").equals(username).first();
}

/**
 * Lightweight full-text-ish search over cached post titles/content.
 * Scans at most the newest 200 cached posts so it stays fast even
 * when the local DB has grown large.
 */
export async function searchCachedPosts(
	query: string,
	limit = 20,
): Promise<Post[]> {
	const q = query.toLowerCase().trim();
	if (!q) return [];
	const recent = await db.posts
		.orderBy("createdAt")
		.reverse()
		.limit(200)
		.toArray();
	return recent
		.filter(
			(p) =>
				(p.title || "").toLowerCase().includes(q) ||
				(p.content || "").toLowerCase().includes(q),
		)
		.slice(0, limit);
}

// ── Comment thread helpers ────────────────────────────────────────────────

/**
 * Upsert a post's comment thread (+ its pagination meta) into the offline
 * store. Idempotent — safe to call on every successful comments GET and on
 * socket-driven comment events.
 */
export async function cacheCommentThread(
	postId: string,
	comments: Comment[],
	meta?: { cursor?: string | null; hasMore?: boolean },
): Promise<void> {
	if (comments.length > 0) {
		await db.comments.bulkPut(comments);
	}
	await db.commentThreadMeta.put({
		postId,
		cursor: meta?.cursor ?? null,
		hasMore: meta?.hasMore ?? false,
		updatedAt: Date.now(),
	});
}

/** Get cached comments for a post, newest first (same _id-desc order as the feed). */
export async function getCachedComments(
	postId: string,
	limit = 50,
): Promise<Comment[]> {
	return db.comments
		.where({ post: postId })
		.reverse()
		.limit(limit)
		.toArray();
}

/** Get the cached pagination state for a post's thread. */
export async function getCachedCommentThreadMeta(
	postId: string,
): Promise<CommentThreadMeta | undefined> {
	return db.commentThreadMeta.get(postId);
}

// ── Glance helpers ────────────────────────────────────────────────────────

/**
 * Upsert a profile's glance strip (or the home feed's, ownerId="feed") into
 * the offline store. Idempotent — safe on every successful glances GET and
 * on socket-driven glance events.
 */
export async function cacheGlances(
	glimpses: Glance[],
	ownerId: string,
): Promise<void> {
	if (glimpses.length === 0) return;
	const stamped = glimpses.map((g) => ({ ...g, ownerId }));
	await db.glances.bulkPut(stamped);
}

/** Get the cached glance strip for a profile (or "feed" for the home feed). */
export async function getCachedGlances(
	ownerId: string,
	limit = 50,
): Promise<Glance[]> {
	return db.glances
		.where({ ownerId })
		.reverse()
		.limit(limit)
		.toArray();
}

// ── Community helpers ─────────────────────────────────────────────────────

/** Upsert the community list (all + mine). */
export async function cacheCommunities(
	communities: Community[],
): Promise<void> {
	if (communities.length === 0) return;
	await db.communities.bulkPut(communities);
}

/** Get cached communities, most recently updated first. */
export async function getCachedCommunities(
	limit = 50,
): Promise<Community[]> {
	return db.communities
		.orderBy("updatedAt")
		.reverse()
		.limit(limit)
		.toArray();
}

// ── Clear helpers ─────────────────────────────────────────────────────────

/**
 * Purge Dexie rows affected by a mutation at the given API pathname.
 *
 * THE MISSING PIECE of the offline-first cache invalidation:
 * evictAffectedCaches (api.ts) sweeps CacheStorage + the service-worker
 * runtime caches, but NEVER the Dexie structured layer. Every component
 * falls back to getOfflineFallback() when CacheStorage misses, so a stale
 * Dexie copy (written before a mutation completed) resurrects deleted
 * items / reverted flags on the next reload or tab remount — the
 * "I deleted it, reload, it's back, then it vanishes 30s later" bug that
 * showed up on almost every screen.
 *
 * This maps API pathnames to the tables that store that data and purges
 * exactly the rows that can be stale. Table clears are safe here: this is
 * the current user's single-device offline cache, and the rows are
 * repopulated on the next successful fetch.
 *
 * @param path  URL pathname (e.g. "/api/notifications"), query stripped.
 */
export async function purgeOfflineDataForPath(path: string): Promise<void> {
	try {
		// ── Notifications (list, single, read-all, unread-count) ────────
		if (path.includes("/api/notifications")) {
			await db.notifications.clear();
			return;
		}

		// ── Chats: conversation list + messages ─────────────────────────
		if (path.includes("/api/chats/conversations")) {
			// Conversation-list mutations (badge counts, lastMessage,
			// missed-call flags) stale the whole list — clear it.
			await db.conversations.clear();
			// Message send/delete for a specific conversation: purge just
			// that conversation's messages so an old thread can't resurface.
			const convMsgMatch = path.match(
				/\/api\/chats\/conversations\/([^/]+)\/messages/,
			);
			if (convMsgMatch) {
				await clearConversationMessages(convMsgMatch[1]);
			}
			return;
		}
		if (path.includes("/api/chats/messages")) {
			// Single message delete / delete-for-me — purge that message.
			const idMatch = path.match(/\/api\/chats\/messages\/([^/]+)/);
			if (idMatch) {
				await db.messages.delete(idMatch[1]);
			}
			return;
		}

		// ── Communities: list + messages ────────────────────────────────
		if (path.includes("/api/communities")) {
			const msgMatch = path.match(
				/\/api\/communities\/([^/]+)\/messages/,
			);
			if (msgMatch) {
				await db.communityMessages
					.where({ community: msgMatch[1] })
					.delete();
			} else {
				// List/settings/membership mutations change the list.
				await db.communities.clear();
			}
			return;
		}

		// ── Comments: thread rows + pagination meta ─────────────────────
		if (path.includes("/api/comments")) {
			const postMatch = path.match(/\/api\/comments\/([^/]+)/);
			if (postMatch && postMatch[1] !== "all") {
				await db.comments.where({ post: postMatch[1] }).delete();
				await db.commentThreadMeta.delete(postMatch[1]);
			} else {
				await db.comments.clear();
				await db.commentThreadMeta.clear();
			}
			return;
		}

		// ── Posts / feeds / saves / reposts / likes / search ────────────
		// Post rows embed interaction state (likedByMe, savedByMe,
		// repostedByMe, counts) — a like/save/repost/delete must purge the
		// affected rows so the offline fallback can't serve old flags.
		if (
			path.includes("/api/posts") ||
			path.includes("/api/feed") ||
			path.includes("/api/saves") ||
			path.includes("/api/reposts") ||
			path.includes("/api/likes") ||
			path.includes("/api/search/posts")
		) {
			// Single-post mutation → purge just that post row (and its
			// comment thread), keeping the rest of the offline feed intact.
			const singlePost = path.match(
				/^\/api\/posts\/([^/]+)(?:\/|$)/,
			);
			const slugPost = path.match(/^\/api\/posts\/slug\/([^/]+)/);
			const likePost = path.match(/^\/api\/likes\/post\/([^/]+)/);
			const savePost = path.match(
				/^\/api\/saves\/([^/]+)/,
			);
			const repostPost = path.match(
				/^\/api\/reposts\/([^/]+)/,
			);
			if (slugPost) {
				const hit = await db.posts.toArray();
				const found = hit.find((p) => p.slug === slugPost[1]);
				if (found) await db.posts.delete(found._id);
				return;
			}
			const postId =
				singlePost?.[1] &&
				singlePost[1] !== "archived" &&
				singlePost[1] !== "drafts" &&
				singlePost[1] !== "trending" &&
				singlePost[1] !== "explore"
					? singlePost[1]
					: likePost?.[1] || savePost?.[1] || repostPost?.[1];
			if (postId) {
				await db.posts.delete(postId);
				return;
			}
			// Collection-level mutation (feed, create, search, saves list…)
			// — the whole list can be stale, clear it.
			await db.posts.clear();
			return;
		}

		// ── Users / follows / search-users ───────────────────────────────
		// Profile rows embed follow state + counts; suggestions/search rows
		// embed isFollowing — all stale after follow/unfollow/profile edits.
		if (
			path.includes("/api/users") ||
			path.includes("/api/follows") ||
			path.includes("/api/search/users")
		) {
			await db.users.clear();
			return;
		}

		// ── Glances ─────────────────────────────────────────────────────
		if (path.includes("/api/glimpses")) {
			await db.glances.clear();
			return;
		}
	} catch {
		// A purge failure must never break a mutation — best-effort only.
	}
}

/** Clear all cached data (used on logout). */
/**
 * Prune data older than N days to prevent unbounded IndexedDB growth.
 * Uses ISO date string comparison so Dexie sorts lexicographically correctly.
 */
export async function pruneOldData(maxAgeDays = 7): Promise<void> {
	const cutoff = new Date(
		Date.now() - maxAgeDays * 24 * 60 * 60 * 1000,
	).toISOString();
	await Promise.all([
		db.notifications.where("createdAt").below(cutoff).delete(),
	]);
}

/** Clear all cached data (used on logout). */
export async function clearOfflineDB(): Promise<void> {
	await Promise.all([
		db.conversations.clear(),
		db.messages.clear(),
		db.communityMessages.clear(),
		db.posts.clear(),
		db.notifications.clear(),
		db.users.clear(),
		db.comments.clear(),
		db.commentThreadMeta.clear(),
		db.glances.clear(),
		db.communities.clear(),
		db.pendingChatSends.clear(),
		db.syncQueue.clear(),
	]);
}

/** Delete messages for a specific conversation (used on clear chat). */
export async function clearConversationMessages(
	conversationId: string,
): Promise<void> {
	await db.messages
		.where({ conversation: conversationId })
		.delete();
}
