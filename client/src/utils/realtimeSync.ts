/**
 * realtimeSync.ts — universal realtime event persistence.
 *
 * Every realtime socket event (message, post, comment, community,
 * notification, follow…) is funneled through `applyRealtimeEvent`, which:
 *   1. Upserts the entity into Dexie — so it survives reload AND offline,
 *      not just the current in-memory React state.
 *   2. Evicts the affected CacheStorage URLs — so the next apiFetch for
 *      that resource revalidates from the network instead of serving a
 *      stale cached copy.
 *
 * This is the "push the data, persist it everywhere" half of the realtime
 * architecture. The other half (server-side `events:sync` replay) feeds
 * the SAME events through this function on reconnect, so missed events
 * are persisted exactly like live ones.
 */

import { db } from "./offlineDB";
import { evictCachedResponse } from "./apiCache";
import type { Post, Comment, Community, Message, Notification, User } from "../types";

// Mirror of the server's SEENBY_CAP — never let a read-receipt array grow
// past this in Dexie either, so a stale oversized seenBy (e.g. one persisted
// before the server-side rotation shipped) gets trimmed on the next event.
const SEENBY_CAP = 200;

/** Extract a stable id from a sender/author that may be a string or object. */
function entityId(v: unknown): string | null {
	if (!v) return null;
	if (typeof v === "string") return v;
	if (typeof v === "object") {
		const o = v as { _id?: unknown; id?: unknown };
		const id = o._id ?? o.id;
		return typeof id === "string" ? id : null;
	}
	return null;
}

/**
 * Upsert a single entity into Dexie + evict the matching cache keys.
 * Fails silently — realtime persistence must never break the UI.
 */
export async function applyRealtimeEvent(
	event: string,
	payload: any,
): Promise<void> {
	try {
		switch (event) {
			case "message:new": {
				// Direct messages — persist the message + force the
				// conversations list to revalidate (it embeds lastMessage).
				if (payload?._id) {
					await db.messages.put(payload as Message);
					await evictCachedResponse("/api/chats/conversations");
					// The messages list for this conversation too, so a reload
					// shows the new message immediately.
					const convId = payload.conversation?.toString?.();
					if (convId) {
						await evictCachedResponse(
							`/api/chats/conversations/${convId}/messages`,
						);
					}
				}
				return;
			}

			case "community:message:new": {
				if (payload?._id) {
					await db.communityMessages.put(payload);
					const communityId = payload.community?.toString?.();
					if (communityId) {
						await evictCachedResponse(
							`/api/communities/${communityId}/messages`,
						);
					}
				}
				return;
			}

			case "community:message:delivered": {
				// payload: { communityId, messageId, deliveredAt } — the server
				// broadcast the message to the room. Persist the deliveredAt stamp
				// into Dexie so the ✓✓ tick + "Message info" panel survive reloads.
				const communityId = payload?.communityId?.toString?.();
				const messageId = payload?.messageId?.toString?.();
				const deliveredAt = payload?.deliveredAt;
				if (communityId && messageId && deliveredAt) {
					await db.communityMessages
						.where("_id")
						.equals(messageId)
						.modify((msg) => {
							if (!msg.deliveredAt) msg.deliveredAt = deliveredAt;
						});
					await evictCachedResponse(
						`/api/communities/${communityId}/messages`,
					);
				}
				return;
			}

			case "community:seen-update": {
				// payload: { communityId, messageIds, seenByUserId } — read
				// receipts for community chat. Persist the seenBy addition into
				// Dexie and evict the messages cache so a reload (even offline)
				// shows the blue ticks, not the stale pre-read state.
				const communityId = payload?.communityId?.toString?.();
				const messageIds: string[] = Array.isArray(payload?.messageIds)
					? payload.messageIds
					: [];
				const seerId = payload?.seenByUserId;
				if (communityId && messageIds.length > 0 && seerId) {
					await db.communityMessages
						.where("_id")
						.anyOf(messageIds)
					.modify((msg) => {
						const seenBy = new Set<string>(msg.seenBy || []);
						seenBy.add(seerId);
						// Keep the newest SEENBY_CAP readers (same contract as the
						// server-side rotation) so the persisted array stays bounded.
						msg.seenBy = [...seenBy].slice(-SEENBY_CAP) as any;
					});
					await evictCachedResponse(
						`/api/communities/${communityId}/messages`,
					);
				}
				return;
			}

			case "post:created":
			case "post:updated": {
				if (payload?._id) {
					await db.posts.put(payload as Post);
					// Revalidate every feed/profile post list so the change
					// shows without waiting out the 30-60s background timer.
					await evictCachedResponse("/api/posts");
					await evictCachedResponse("/api/feed");
					const authorId = entityId(payload.author);
					if (authorId) {
						await evictCachedResponse(
							`/api/users/${authorId}/posts`,
						);
					}
				}
				return;
			}

			case "post:deleted": {
				const postId = typeof payload === "string" ? payload : payload?._id;
				if (postId) {
					await db.posts.delete(postId);
					await evictCachedResponse("/api/posts");
					await evictCachedResponse("/api/feed");
				}
				return;
			}

			case "post:comment":
			case "comment:reply": {
				// payload shape: { postId, comment|reply, userId, commentsCount }
				const comment = payload?.comment ?? payload?.reply;
				const postId = payload?.postId?.toString?.();
				if (comment?._id) {
					await db.comments.put(comment as Comment);
				}
				if (postId) {
					// The comment thread cache for this post must revalidate.
					await evictCachedResponse(`/api/comments/${postId}`);
				}
				return;
			}

			case "comment:updated": {
				if (payload?._id) {
					await db.comments.put(payload as Comment);
					const postId = payload.post?.toString?.() || payload.postId;
					if (postId) {
						await evictCachedResponse(`/api/comments/${postId}`);
					}
				}
				return;
			}

			case "comment:deleted": {
				// payload shape: { postId, commentId, commentsCount }
				const commentId = payload?.commentId;
				const postId = payload?.postId?.toString?.();
				if (commentId) {
					await db.comments.delete(commentId);
				}
				if (postId) {
					await evictCachedResponse(`/api/comments/${postId}`);
				}
				return;
			}

			case "community:created":
			case "community:updated": {
				const community = payload?.community ?? payload;
				if (community?._id) {
					await db.communities.put(community as Community);
					// Both the "all" and "mine" lists revalidate.
					await evictCachedResponse("/api/communities");
					await evictCachedResponse("/api/communities/mine");
				}
				return;
			}

			case "community:deleted": {
				const communityId =
					payload?.communityId?.toString?.() ||
					payload?.community?._id?.toString?.() ||
					(typeof payload === "string" ? payload : null);
				if (communityId) {
					await db.communities.delete(communityId);
					await evictCachedResponse("/api/communities");
					await evictCachedResponse("/api/communities/mine");
				}
				return;
			}

			case "notification": {
				if (payload?._id) {
					await db.notifications.put(payload as Notification);
					// The list must revalidate so the new item shows on reload.
					await evictCachedResponse("/api/notifications");
				}
				return;
			}

			case "user:follow":
			case "user:unfollow": {
				// payload: { targetUserId, followerId, followersCount, ... }
				const targetId = payload?.targetUserId?.toString?.();
				const followerId = payload?.followerId?.toString?.();
				if (targetId) await evictCachedResponse(`/api/users/${targetId}`);
				if (followerId) await evictCachedResponse(`/api/users/${followerId}`);
				await evictCachedResponse("/api/follows");
				return;
			}

			case "user:updated": {
				if (payload?._id) {
					await db.users.put(payload as User);
				}
				return;
			}

			default:
				// Unknown events are ignored — the switch only handles the
				// events that carry persistable entities.
				return;
		}
	} catch {
		// Non-critical — realtime persistence must never break the UI.
	}
}
