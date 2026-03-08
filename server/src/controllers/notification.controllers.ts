import type { Request, Response } from "express";
import mongoose from "mongoose";
import Notification from "../models/notification.model";
import { getCache, setCache, deleteCache, clearByPattern } from "../configs/cache";
import { logger } from "../utilities/logger";
import {
	AppError,
	BadRequestError,
	UnauthorizedError,
	NotFoundError,
} from "../utilities/errors";

const encodeNotificationCursor = (
	createdAt: Date,
	id: mongoose.Types.ObjectId,
) => `${createdAt.getTime()}_${id.toString()}`;

const decodeNotificationCursor = (cursor: string) => {
	const separatorIndex = cursor.indexOf("_");
	if (separatorIndex === -1) return null;

	const timestamp = Number(cursor.slice(0, separatorIndex));
	const id = cursor.slice(separatorIndex + 1);

	if (!Number.isFinite(timestamp) || !mongoose.Types.ObjectId.isValid(id)) {
		return null;
	}

	return { createdAt: new Date(timestamp), id };
};

// ─── Instagram-style notification grouping ─────────────────────────────
// Interaction notifications (likes, comments, reposts, saves, reactions,
// poll votes, mentions) that target the SAME entity within a short window
// collapse into ONE row: "Rahul and 12 others liked your post" instead of
// 13 identical rows flooding the bell. WhatsApp/Instagram both do this.
//
// Implementation: group at read time (no schema change, no write-path
// complexity). The newest notification in each group becomes the display
// row (carrying its populated sender + target), with group metadata
// attached so the client can render the count and the API can read/delete
// the whole group in one call via the member ids.

// Types that make sense to group. Follows, follow requests, calls, shares
// and system messages stay individual (each is a distinct event the user
// must see on its own).
const GROUPABLE_TYPES = new Set([
	"like",
	"comment",
	"repost",
	"save",
	"reaction",
	"post_reaction",
	"poll_vote",
	"mention",
	"glimpse_reaction",
	"glimpse_reply",
	"community_message",
]);

// How recent a group member must be to merge with the newest one. A like on
// an old post from a week ago shouldn't join a group from today — it gets
// its own row. 24h is the same window WhatsApp uses for message grouping.
const GROUP_WINDOW_MS = 24 * 60 * 60 * 1000;

// The entity a notification is "about" — two notifications group only when
// they share the same type AND the same target (post, comment, glimpse,
// community, etc.).
const notificationTargetKey = (n: any): string | null => {
	for (const field of [
		"post",
		"comment",
		"glimpse",
		"community",
		"user",
		"collection",
		"message",
	]) {
		const v = n?.[field];
		if (!v) continue;
		return `${field}:${v._id || v}`;
	}
	return null;
};

/**
 * Collapse a page of notifications (newest-first) into display rows.
 * Returns the same array when there's nothing to group, so callers treat
 * the result uniformly. Exported for unit tests.
 */
export const groupNotificationsForDisplay = (items: any[]): any[] => {
	if (items.length <= 1) return items;

	// key → newest member (the display anchor)
	const groups = new Map<string, any>();
	const order: string[] = [];

	for (const n of items) {
		const targetKey = notificationTargetKey(n);
		const groupable = GROUPABLE_TYPES.has(n.type) && targetKey !== null;

		if (!groupable) {
			// Non-groupable — emit as its own row, keyed by its unique id so it
			// never merges with anything.
			const selfKey = `self:${n._id}`;
			groups.set(selfKey, n);
			order.push(selfKey);
			continue;
		}

		const key = `${n.type}:${targetKey}`;
		const existing = groups.get(key);
		if (
			existing &&
			// Only merge when the new member is inside the window of the
			// group's NEWEST member (items arrive newest-first, so existing
			// is always >= n in time).
			new Date(existing.createdAt).getTime() -
				new Date(n.createdAt).getTime() <
				GROUP_WINDOW_MS
		) {
			// Extend the existing group with this member.
			existing.__groupMemberIds =
				existing.__groupMemberIds || [existing._id.toString()];
			existing.__groupMemberIds.push(n._id.toString());
			existing.__groupSenders = existing.__groupSenders || [
				existing.sender && {
					fullName: existing.sender.fullName,
					username: existing.sender.username,
					profilePic: existing.sender.profilePic,
				},
			];
			existing.__groupSenders.push(
				n.sender && {
					fullName: n.sender.fullName,
					username: n.sender.username,
					profilePic: n.sender.profilePic,
				},
			);
			// A group is unread if ANY member is unread.
			if (!n.isRead) existing.isRead = false;
		} else {
			// Outside the window (or the first member of this group): this item
			// gets its OWN row — it must never overwrite the existing group
			// (that would silently drop the earlier members). A unique key per
			// item keeps both rows.
			const selfKey = existing ? `${key}:${n._id}` : key;
			groups.set(selfKey, n);
			order.push(selfKey);
		}
	}

	return order
		.map((key) => {
			const n = groups.get(key)!;
			const memberIds = n.__groupMemberIds;
			if (!memberIds || memberIds.length <= 1) {
				// Single member — strip the scratch fields and return as-is.
				delete n.__groupMemberIds;
				delete n.__groupSenders;
				return n;
			}
			const senders = (n.__groupSenders || []).filter(Boolean);
			const result = {
				...n,
				groupCount: memberIds.length,
				groupMemberIds: memberIds,
				groupSenders: senders.slice(0, 5), // cap for the payload
			};
			delete result.__groupMemberIds;
			delete result.__groupSenders;
			return result;
		})
		.filter(Boolean);
};

// get unread notification count
export const getUnreadCount = async (req: Request, res: Response) => {
	try {
		const userId = req.user?._id;

		if (!userId) {
			// If no user, just return 0
			return res.status(200).json({
				success: true,
				unreadCount: 0,
			});
		}

		// cache key — 15s TTL is enough since notifications come via socket
		const cacheKey = `notifications:unread:${userId.toString()}`;
		try {
			const cached = await getCache<{ unreadCount: number }>(cacheKey);
			if (cached) return res.status(200).json(cached);
		} catch (err: any) {
			logger.error(`Cache error in getUnreadCount!`, { error: err.message });
		}

		const unreadCount = await Notification.countDocuments({
			recipient: userId,
			isRead: false,
		});

		const responseData = { success: true, unreadCount };

		try {
			await setCache(cacheKey, responseData, 15);
		} catch (err: any) {
			logger.error(`Cache set error in getUnreadCount!`, { error: err.message });
		}

		return res.status(200).json(responseData);
	} catch (err: any) {
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in getUnreadCount controller!`, {
			error: err.message,
		});
		throw new AppError("Internal server error!");
	}
};

// get all notifications
export const getNotifications = async (req: Request, res: Response) => {
	try {
		const userId = req.user?._id;

		if (!userId) {
			// If no user, return empty array
			return res.status(200).json({
				success: true,
				message: "Notifications fetched successfully!",
				notifications: [],
				hasMore: false,
				nextCursor: null,
			});
		}

		// pagination
		const limit = Math.min(Number(req.query.limit) || 20, 50);
		const cursor = req.query.cursor as string;

		// cache key
		const cacheKey = `notifications:${userId}:${cursor || "first"}:${limit}`;

		// try cache first
		try {
			const cached = await getCache(cacheKey);
			if (cached) return res.status(200).json(cached);
		} catch (err: any) {
			logger.error(`Cache error in getNotifications!`, { error: err.message });
		}

		const query: Record<string, unknown> = { recipient: userId };
		if (cursor) {
			const decoded = decodeNotificationCursor(cursor);
			if (decoded) {
				query.$or = [
					{ createdAt: { $lt: decoded.createdAt } },
					{ createdAt: decoded.createdAt, _id: { $lt: decoded.id } },
				];
			}
		}

		const notifications = await Notification.find(query)
			.sort({ createdAt: -1, _id: -1 })
			.limit(limit + 1)
			.populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
			.populate("post", "title slug")
			.populate({
				path: "comment",
				select: "content post",
				// allow comment_share notifications to open the post that holds
				// the shared comment
				populate: { path: "post", select: "slug" },
			})
			.populate({
				path: "glimpse",
				select: "author",
				// allow glimpse_share notifications to open the glance author
				populate: { path: "author", select: "username fullName isVerified" },
			})
			.populate("user", "username fullName profilePic isVerified statusText waitlistPerk")
			.populate("collection", "name")
			// Community mentions carry the community ref so the client can
			// deep-link straight into the community chat.
			.populate("community", "name avatar")
			.lean();

		const hasMore = notifications.length > limit;
		if (hasMore) {
			notifications.pop();
		}

		const last = notifications.slice(-1).shift();
		const nextCursor =
			last?.createdAt && last?._id
				? encodeNotificationCursor(last.createdAt, last._id)
				: null;

		// Instagram-style grouping: "Rahul and 12 others liked your post"
		// instead of 13 identical rows. Cursor/hasMore are computed on the
		// RAW rows above, so pagination is unaffected by collapsing.
		const grouped = groupNotificationsForDisplay(notifications);

		const responseData = {
			success: true,
			message: "Notifications fetched successfully!",
			notifications: grouped,
			hasMore,
			nextCursor,
		};

		// cache with short TTL (notifications change frequently)
		try {
			await setCache(cacheKey, responseData, 30);
		} catch (err: any) {
			logger.error(`Cache set error in getNotifications!`, { error: err.message });
		}

		return res.status(200).json(responseData);
	} catch (err: any) {
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in getNotifications controller!`, {
			error: err.message,
		});
		throw new AppError("Internal server error!");
	}
};	// mark notifications as read
/**
 * Invalidate every cache that embeds a user's notification state — the list
 * cache, the unread count cache (`notifications:unread:userId`), and the
 * route-level cacheMiddleware keys (`api:<userId>:/unread-count:<query>` and
 * `api:<userId>:/:<query>`). Without the middleware keys, the badge endpoint
 * keeps serving the pre-read count for up to its TTL, so the bell badge stays
 * stale after marking notifications read.
 *
 * All four runs in PARALLEL: `clearByPattern` is a SCAN loop over Upstash's
 * HTTP Redis — each iteration is a network round-trip, and doing them
 * sequentially added 8-20s to every "mark as read / clear all / delete"
 * click, which read as "buttons don't work".
 */
// Optimized: direct deletes instead of SCAN loops (saves ~12 Redis cmds).
// api: route cache has 60s TTL — expires naturally.
const invalidateNotificationCaches = async (uid: string) => {
	await deleteCache(`notifications:unread:${uid}`);
	await clearByPattern(`notifications:${uid}:*`);
};

export const markAsRead = async (req: Request, res: Response) => {
	try {
		const userId = req.user?._id;
		const notificationId = req.params.notificationId as string | undefined;

		if (!userId) {
			throw new UnauthorizedError("Unauthorized access!");
		}

		// Grouped notifications carry `groupMemberIds` — the client sends them
		// back so one tap marks the whole "Rahul and 12 others" row read
		// (otherwise 13 unread rows would remain under one collapsed row).
		const groupIds: string[] = Array.isArray(req.body?.ids)
			? req.body.ids
					.filter((id: any) => typeof id === "string")
					.slice(0, 200)
			: [];
		if (groupIds.length > 0) {
			if (groupIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
				throw new BadRequestError("Invalid notification ID!");
			}
			await Notification.updateMany(
				{
					recipient: userId,
					_id: { $in: groupIds },
					isRead: false,
				},
				{ isRead: true },
			);
			void invalidateNotificationCaches(userId.toString()).catch((err) =>
				logger.error("Notification cache invalidation failed", {
					error: err.message,
				}),
			);
			return res.status(200).json({
				success: true,
				message: "Notifications marked as read!",
			});
		}

		// if notificationId is provided, mark only that single notification as read
		if (notificationId) {
			if (!mongoose.Types.ObjectId.isValid(notificationId)) {
				throw new BadRequestError("Invalid notification ID!");
			}

			const notification = await Notification.findOne({
				_id: notificationId,
				recipient: userId,
			});

			if (!notification) {
				throw new NotFoundError("Notification not found!");
			}

			if (!notification.isRead) {
				notification.isRead = true;
				await notification.save();
			}

			// invalidate caches (fire-and-forget — never block the click on
			// Redis SCAN round-trips)
			void invalidateNotificationCaches(userId.toString()).catch((err) =>
				logger.error("Notification cache invalidation failed", {
					error: err.message,
				}),
			);

			return res.status(200).json({
				success: true,
				message: "Notification marked as read!",
			});
		}

		// if no notificationId is provided, mark ALL as read
		await Notification.updateMany(
			{ recipient: userId, isRead: false },
			{ isRead: true },
		);

		// invalidate caches (fire-and-forget — never block the click on
		// Redis SCAN round-trips)
		void invalidateNotificationCaches(userId.toString()).catch((err) =>
			logger.error("Notification cache invalidation failed", {
				error: err.message,
			}),
		);

		return res.status(200).json({
			success: true,
			message: "All notifications marked as read!",
		});
	} catch (err: any) {
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in markAsRead controller!`, { error: err.message });
		throw new AppError("Internal server error!");
	}
};

// delete a single notification
export const deleteNotification = async (req: Request, res: Response) => {
	try {
		const userId = req.user?._id;
		const notificationId = req.params.notificationId;

		if (!userId) {
			throw new UnauthorizedError("Unauthorized access!");
		}

		// Grouped rows carry groupMemberIds — delete the whole "Rahul and 12
		// others" row in one call (the client sends them in the body).
		const groupIds: string[] = Array.isArray(req.body?.ids)
			? req.body.ids
					.filter((id: any) => typeof id === "string")
					.slice(0, 200)
			: [];
		if (groupIds.length > 0) {
			if (groupIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
				throw new BadRequestError("Invalid notification ID!");
			}
			await Notification.deleteMany({
				recipient: userId,
				_id: { $in: groupIds },
			});
			void invalidateNotificationCaches(userId.toString()).catch((err) =>
				logger.error("Notification cache invalidation failed", {
					error: err.message,
				}),
			);
			return res.status(200).json({
				success: true,
				message: "Notifications deleted successfully!",
			});
		}

		if (
			typeof notificationId !== "string" ||
			!mongoose.Types.ObjectId.isValid(notificationId)
		) {
			throw new BadRequestError("Invalid notification ID!");
		}

		const notification = await Notification.findOneAndDelete({
			_id: notificationId,
			recipient: userId,
		});

		if (!notification) {
			throw new NotFoundError("Notification not found!");
		}

		// invalidate caches (fire-and-forget)
		void invalidateNotificationCaches(userId.toString()).catch((err) =>
			logger.error("Notification cache invalidation failed", {
				error: err.message,
			}),
		);

		return res.status(200).json({
			success: true,
			message: "Notification deleted successfully!",
		});
	} catch (err: any) {
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in deleteNotification controller!`, {
			error: err.message,
		});
		throw new AppError("Internal server error!");
	}
};

// clear all notifications for the current user
export const clearAllNotifications = async (req: Request, res: Response) => {
	try {
		const userId = req.user?._id;

		if (!userId) {
			throw new UnauthorizedError("Unauthorized access!");
		}

		await Notification.deleteMany({ recipient: userId });

		// invalidate both caches (list + unread count) — fire-and-forget
		void invalidateNotificationCaches(userId.toString()).catch((err) =>
			logger.error("Notification cache invalidation failed", {
				error: err.message,
			}),
		);

		return res.status(200).json({
			success: true,
			message: "All notifications cleared successfully!",
		});
	} catch (err: any) {
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in clearAllNotifications controller!`, {
			error: err.message,
		});
		throw new AppError("Internal server error!");
	}
};

// guard: use default avatar if user.profilePic is null or undefined
