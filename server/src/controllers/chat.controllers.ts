import mongoose from "mongoose";
import type { Request, Response, NextFunction } from "express";
import { Conversation } from "../models/conversation.model";
import { Message } from "../models/message.model";
import { User } from "../models/user.model";
import Block from "../models/block.model";
import Notification from "../models/notification.model";
import { getBlockedUserIds } from "../utilities/blockCheck";
import { sendMessageSchema, editMessageSchema } from "../schemas/chat.schema";
import {
	BadRequestError,
	NotFoundError,
	UnauthorizedError,
	ForbiddenError,
	AppError,
} from "../utilities/errors";
import { logger } from "../utilities/logger";
import {
	createNotification,
	extractMentions,
	shouldNotifyCategory,
} from "../utilities/notification";
import { sendPushToUser, attachmentPushLabel } from "../services/pushService";
import { checkBadgesAndNotify } from "../services/badgeService";
import { cleanupMedia } from "../services/mediaCleanupService";
import { deleteCache, getCache, setCache, clearChatCache } from "../configs/cache";
import {
	getMemCache,
	setMemCache,
	clearMemCacheByPrefix,
} from "../utilities/chatCache";
import { sanitizePlainText } from "../configs/sanitize";
import cloudinary from "../configs/cloudinary";
import { imagekit } from "../configs/imagekit";
import { clearSearchCacheForTarget } from "../utilities/searchCache";
import {
	isRecipientActiveInConversation,
	getUserPresenceStatus,
	getUserPresenceStatuses,
	getUserLastSeens,
	emitNewMessage,
	emitMessageEdit,
	emitMessageDelete,
	emitMessageDeleteForMe,
	emitMessagePin,
	emitMessageUnpin,
	emitChatNotification,
	getIO,
} from "../configs/socket";

type ConversationParams = {
	conversationId: string;
};

type MessageParams = {
	messageId: string;
};

type UserParams = {
	userId: string;
};

// ─── Conversations ───────────────────────────────────────────────────

/**
 * Create or fetch a 1-on-1 conversation with another user.
 */
export const getOrCreateConversation = async (
	req: Request,
	res: Response,
	next: NextFunction,
) => {
	const { recipientId } = req.body;

	try {
		if (!recipientId || !mongoose.Types.ObjectId.isValid(recipientId)) {
			return next(
				new BadRequestError("Invalid or missing recipient ID!"),
			);
		}

		const currentUserId = req.user?._id;
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		// WhatsApp-style "Message yourself" chat: a conversation with yourself
		// acts as a private notes/links box. The schema requires exactly 2
		// participants, so a self-chat stores [me, me] — the unique sorted-
		// participants index still holds, and every send/read path treats the
		// recipient as "me" (see sendMessage's isSelfChat handling).
		const isSelfChat = currentUserId.toString() === recipientId.toString();

		// Verify recipient exists
		const recipient = await User.findById(recipientId).select(
			"username fullName profilePic isVerified statusText waitlistPerk",
		);
		if (!recipient) {
			return next(new NotFoundError("Recipient user not found!"));
		}

		// Check if blocked
		const isBlocked = await Block.findOne({
			$or: [
				{ blocker: currentUserId, blocked: recipientId },
				{ blocker: recipientId, blocked: currentUserId },
			],
		});
		if (isBlocked) {
			return next(new ForbiddenError("Cannot communicate with a blocked user!"));
		}

		// Sort participant IDs lexicographically and cast to ObjectIds to satisfy unique index
		const sortedStr = [
			currentUserId.toString(),
			recipientId.toString(),
		].sort();
		const participants = sortedStr.map(
			(id) => new mongoose.Types.ObjectId(id),
		);

		const idA = new mongoose.Types.ObjectId(currentUserId.toString());
		const idB = new mongoose.Types.ObjectId(recipientId.toString());

		// Look up existing conversation. IMPORTANT: for a SELF-chat (idA ===
		// idB), `participants: { $all: [me, me] }` would collapse to a single
		// condition and match ANY conversation the user is in — the $all
		// operator treats duplicate values as one. Self-chats must match by
		// exact [me, me] array identity instead.
		let conversation =
			idA.toString() === idB.toString()
				? await Conversation.findOne({
						participants: [idA, idA],
				  })
				: await Conversation.findOne({
						participants: { $all: [idA, idB] },
				  });
		let created = false;

		if (!conversation) {
			conversation = new Conversation({
				participants,
				unreadCounts: {
					[currentUserId.toString()]: 0,
					[recipientId.toString()]: 0,
				},
			});
			await conversation.save();
			created = true;

			// A brand-new conversation must appear in both users' conversation
			// lists immediately — evict the cached lists (8s mem TTL would
			// otherwise hide it).
			await clearChatCache(conversation._id.toString(), [
				currentUserId.toString(),
				recipientId.toString(),
			]);
		}

		// Populate participants info
		const populatedConversation = await Conversation.findById(
			conversation._id,
		)
			.populate("participants", "username fullName profilePic isVerified statusText waitlistPerk")
			.populate({
				path: "lastMessage",
				populate: {
					path: "sender",
					select: "username fullName profilePic isVerified statusText waitlistPerk",
				},
			})
			.lean();

		// Fetch real-time presence for the other participant + their last-seen
		// stamp (for "last seen Xm ago" when offline). For a self-chat the
		// partner is yourself — always online, no lookup needed.
		const otherParticipantId = recipientId.toString();
		const isSelf = isSelfChat || currentUserId.toString() === recipientId.toString();
		const [presence, lastSeens] = isSelf
			? (["online", {}] as const)
			: await Promise.all([
					getUserPresenceStatus(otherParticipantId),
					getUserLastSeens([otherParticipantId]),
				]);

		return res.status(created ? 201 : 200).json({
			success: true,
			message: "Conversation retrieved successfully!",
			conversation: {
				...populatedConversation,
				presence,
				lastSeenAt: isSelf ? Date.now() : lastSeens[otherParticipantId] || 0,
				isSelfChat: isSelf,
			},
		});
	} catch (err: any) {
		logger.error("Error in getOrCreateConversation controller", {
			error: err.message,
			stack: err.stack,
		});
		// Handle MongoDB duplicate key (conversation already exists) gracefully
		if (
			(err.name === "MongoServerError" || err.name === "MongoError") &&
			err.code === 11000
		) {
			// Race condition: conversation was inserted between our findOne and save — retry the find
			try {
				const idA = new mongoose.Types.ObjectId(
					req.user?._id?.toString(),
				);
				const idB = new mongoose.Types.ObjectId(recipientId);
				// Same self-chat caveat as the main lookup: exact array match for
				// [me, me], $all otherwise.
				const existing =
					idA.toString() === idB.toString()
						? await Conversation.findOne({
								participants: [idA, idA],
						  })
						: await Conversation.findOne({
								participants: { $all: [idA, idB] },
						  })
					.populate("participants", "username fullName profilePic isVerified statusText waitlistPerk")
					.populate({
						path: "lastMessage",
						populate: {
							path: "sender",
							select: "username fullName profilePic isVerified statusText waitlistPerk",
						},
					})
					.lean();
				if (existing) {
					const [retryPresence, retryLastSeens] = await Promise.all([
						getUserPresenceStatus(recipientId),
						getUserLastSeens([recipientId]),
					]);
					return res.status(200).json({
						success: true,
						message: "Conversation retrieved successfully!",
						conversation: {
							...existing,
							presence: retryPresence,
							lastSeenAt: retryLastSeens[recipientId] || 0,
						},
					});
				}
			} catch (retryErr) {
				return next(new AppError("Internal server error!"));
			}
		}
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

/**
 * Get all conversations for the authenticated user, populated with presence status.
 */
export const getConversations = async (
	req: Request,
	res: Response,
	next: NextFunction,
) => {		const currentUserId = req.user?._id;

		try {
			if (!currentUserId) {
				return next(new UnauthorizedError("Unauthorized!"));
			}

			// Fast in-memory layer in front of Redis/Atlas — presence included in
			// the payload may be up to 8s stale, which socket events keep fresh
			// live anyway; the win is a ~1ms repeat load instead of ~1s.
			const conversationsCacheKey = `chat:conversations:${currentUserId.toString()}`;
			const memCachedConversations = getMemCache(conversationsCacheKey);
			if (memCachedConversations) {
				return res.status(200).json(memCachedConversations);
			}

			const conversations = await Conversation.find({
			participants: currentUserId,
			// Archived chats drop out of the default list (WhatsApp behavior) —
			// they resurface via the dedicated archived list + a new message
			// un-archives them (see sendMessage).
			archivedBy: { $nin: [currentUserId] },
		})
			.populate("participants", "username fullName profilePic isVerified statusText waitlistPerk")
			.populate({
				path: "lastMessage",
				populate: {
					path: "sender",
					select: "username fullName profilePic isVerified statusText waitlistPerk",
				},
			})
			.sort({ updatedAt: -1 })
			.lean();

		// Blocked users must not exist for each other — drop any conversation
		// whose partner shares a block relationship (either direction). This is
		// a safety net for edge cases where a block happened but the
		// conversation wasn't deleted (legacy data, groups, races).
		const blockedIds = await getBlockedUserIds(currentUserId.toString());
		const blockedSet = new Set(blockedIds);

		// Extract all other participants to do a single batch query for presence
		const otherParticipantIds: string[] = [];
		const preparedConversations = conversations
			.filter((conv: any) => {
				const otherParticipant = (conv.participants || []).find(
					(p: any) =>
						p?._id && p._id.toString() !== currentUserId.toString(),
				);
				return !(
					otherParticipant &&
					blockedSet.has(otherParticipant._id.toString())
				);
			})
			.map((conv: any) => {
				const activeParticipants = (conv.participants || []).filter(
					(p: any) => p != null,
				);
				const otherParticipant = activeParticipants.find(
					(p: any) =>
						p._id && p._id.toString() !== currentUserId.toString(),
				);
				// Self-chat ("Message yourself"): both participants are me — there
				// is no "other" participant. Flag it so the client renders the
				// WhatsApp-style "Message yourself" header instead of a partner.
				const isSelfChat = activeParticipants.length === 2
					? activeParticipants.every(
							(p: any) =>
								p._id &&
								p._id.toString() === currentUserId.toString(),
						)
					: false;
				if (otherParticipant) {
					otherParticipantIds.push(otherParticipant._id.toString());
				}
				return {
					...conv,
					activeParticipants,
					otherParticipantId: otherParticipant?._id?.toString() || null,
					isSelfChat,
				};
			});

		// Batch query presence statuses + last-seen stamps in one HTTP
		// roundtrip each via MGET (parallel). lastSeenAt powers the
		// WhatsApp-style "last seen Xm ago" line when the partner is offline.
		const uniqueOtherIds = [...new Set(otherParticipantIds)];
		const [presenceMap, lastSeenMap] = await Promise.all([
			getUserPresenceStatuses(uniqueOtherIds),
			getUserLastSeens(uniqueOtherIds),
		]);

		const conversationsWithPresence = preparedConversations.map((item: any) => {
			// Self-chat is always "online" (it's you) — presence/lastSeen lookups
			// are skipped since otherParticipantId is null.
			const presence = item.isSelfChat
				? "online"
				: item.otherParticipantId
					? (presenceMap[item.otherParticipantId] || "offline")
					: "offline";
			const lastSeenAt = item.isSelfChat
				? Date.now()
				: item.otherParticipantId
					? (lastSeenMap[item.otherParticipantId] || 0)
					: 0;
			
			// Destructure to remove temp key before sending response
			const { activeParticipants, otherParticipantId, isSelfChat, ...originalConv } = item;
			return {
				...originalConv,
				participants: activeParticipants,
				presence,
				lastSeenAt,
				isSelfChat: !!isSelfChat,
			};
		});

		// Attach the per-user muted flag so the chat list can show a muted
		// indicator without an extra round-trip per conversation.
		let mutedConvIds = new Set<string>();
		try {
			const mutedDocs = await User.findById(currentUserId)
				.select("mutedConversations")
				.lean();
			(mutedDocs?.mutedConversations || []).forEach((m: any) =>
				mutedConvIds.add(m.conversation.toString()),
			);
		} catch (muteErr: any) {
			logger.error("Muted-conversation fetch error in getConversations", {
				error: muteErr.message,
			});
		}
		const conversationsWithMute = conversationsWithPresence.map((c: any) => ({
			...c,
			muted: mutedConvIds.has(c._id.toString()),
			// Per-user archived flag so the client can render/restore without
			// a second round-trip.
			archived: (c.archivedBy || []).some(
				(a: any) => a.toString() === currentUserId.toString(),
			),
		}));

		const responseData = {
			success: true,
			message: conversationsWithMute.length
				? "Conversations fetched successfully!"
				: "No conversations yet!",
			conversations: conversationsWithMute,
		};

		// cache conversations per user — the client refetches this on EVERY
		// chat-tab entry (fetchConversations bypass=true), so each miss costs a
		// shared-Atlas query + a presence MGET round-trip. Socket events keep
		// the live list fresh between fetches and every mutation evicts the
		// cache, so a longer TTL only skips redundant recomputes.
		setMemCache(`chat:conversations:${currentUserId.toString()}`, responseData, 20);
		try {
			await setCache(`chat:conversations:${currentUserId.toString()}`, responseData, 60);
		} catch (err: any) {
			logger.error(`Cache set error in getConversations!`, { error: err.message });
		}

		return res.status(200).json(responseData);
	} catch (err: any) {
		logger.error("Error in getConversations controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

/**
 * Mute notifications for a direct-message conversation (any participant).
 * POST /api/chats/conversations/:conversationId/mute
 */
export const muteConversation = async (
	req: Request<{ conversationId: string }>,
	res: Response,
	next: NextFunction,
) => {
	try {
		const { conversationId } = req.params;
		const currentUserId = req.user?._id;
		const userId = currentUserId?.toString();

		const conversation = await Conversation.findById(conversationId);
		if (!conversation) {
			return next(new NotFoundError("Conversation not found."));
		}
		if (!conversation.participants.some((p) => p.toString() === userId)) {
			return next(
				new ForbiddenError("You can only mute your own conversations."),
			);
		}

		const user = await User.findById(userId);
		if (!user) {
			return next(new UnauthorizedError("User not found."));
		}

		const alreadyMuted = user.mutedConversations?.some(
			(m) => m.conversation?.toString() === conversationId,
		);
		if (!alreadyMuted) {
			user.mutedConversations.push({
				conversation: conversationId as any,
				mutedAt: new Date(),
			});
			await user.save();
		}

		// Refresh the cached conversations list so the muted flag shows instantly
		// (fire-and-forget — the response must not wait on Upstash eviction).
		const muteParticipants: string[] = [];
		for (const p of conversation.participants) {
			if (p) muteParticipants.push(p.toString());
		}
		void clearChatCache(conversationId, muteParticipants).catch(() => {});

		return res.status(200).json({
			success: true,
			message: "Chat muted. You won't get notifications from this chat.",
			muted: true,
		});
	} catch (err: any) {
		logger.error("Error in muteConversation controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

/**
 * Unmute notifications for a direct-message conversation (any participant).
 * POST /api/chats/conversations/:conversationId/unmute
 */
export const unmuteConversation = async (
	req: Request<{ conversationId: string }>,
	res: Response,
	next: NextFunction,
) => {		try {
			const { conversationId } = req.params;
			const currentUserId = req.user?._id;
			const userId = currentUserId?.toString() ?? "";

			const user = await User.findById(userId);
			if (!user) {
				return next(new UnauthorizedError("User not found."));
			}

			const conv = await Conversation.findById(conversationId);
			const participantIds: string[] = [userId];
		if (conv) {
			for (const p of conv.participants) {
				if (p) participantIds.push(p.toString());
			}
		}

		user.mutedConversations = user.mutedConversations.filter(
			(m) => m.conversation?.toString() !== conversationId,
		) as any;
		await user.save();

		void clearChatCache(conversationId, participantIds).catch(() => {});

		return res.status(200).json({
			success: true,
			message: "Chat unmuted. You'll get notifications again.",
			muted: false,
		});
	} catch (err: any) {
		logger.error("Error in unmuteConversation controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

// ─── Archive / unarchive ──────────────────────────────────────────────

/**
 * Archive or unarchive a conversation for the current user (WhatsApp-style).
 * Archived chats drop out of the default list but stay fully intact; a new
 * incoming message un-archives them automatically (see sendMessage).
 * POST /api/chats/conversations/:conversationId/archive  { archived: boolean }
 */
export const archiveConversation = async (
	req: Request<{ conversationId: string }>,
	res: Response,
	next: NextFunction,
) => {
	try {
		const { conversationId } = req.params;
		const currentUserId = req.user?._id;
		const userId = currentUserId?.toString();
		const { archived } = req.body;

		// Strict boolean — a string like "false" is truthy and would archive
		// when the client meant to unarchive.
		if (typeof archived !== "boolean") {
			return next(
				new BadRequestError("archived must be a boolean!"),
			);
		}

		const conversation = await Conversation.findById(conversationId);
		if (!conversation) {
			return next(new NotFoundError("Conversation not found."));
		}
		if (
			!conversation.participants.some(
				(p) => p.toString() === userId,
			)
		) {
			return next(
				new ForbiddenError(
					"You can only archive your own conversations.",
				),
			);
		}

		if (archived) {
			await Conversation.updateOne(
				{ _id: conversationId },
				{ $addToSet: { archivedBy: currentUserId } },
			);
		} else {
			await Conversation.updateOne(
				{ _id: conversationId },
				{ $pull: { archivedBy: currentUserId } },
			);
		}

		// Refresh the cached conversation list so the chat moves between the
		// main list and the archived section instantly.
		const participantIds: string[] = [];
		for (const p of conversation.participants) {
			if (p) participantIds.push(p.toString());
		}
		void clearChatCache(conversationId, participantIds).catch(() => {});

		return res.status(200).json({
			success: true,
			message: archived
				? "Chat archived."
				: "Chat unarchived.",
			archived: Boolean(archived),
		});
	} catch (err: any) {
		logger.error("Error in archiveConversation controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

/**
 * List ONLY the current user's archived conversations (the default list
 * excludes them). Same shape as getConversations so the client reuses the
 * same rendering.
 * GET /api/chats/conversations/archived
 */
export const getArchivedConversations = async (
	req: Request,
	res: Response,
	next: NextFunction,
) => {
	try {
		const currentUserId = req.user?._id;
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		const conversations = await Conversation.find({
			participants: currentUserId,
			archivedBy: currentUserId,
		})
			.populate(
				"participants",
				"username fullName profilePic isVerified statusText waitlistPerk",
			)
			.populate({
				path: "lastMessage",
				populate: {
					path: "sender",
					select:
						"username fullName profilePic isVerified statusText waitlistPerk",
				},
			})
			.sort({ updatedAt: -1 })
			.lean();

		// Presence + last-seen batch (same pattern as getConversations).
		const otherParticipantIds: string[] = [];
		const prepared = conversations.map((conv: any) => {
			const other = (conv.participants || []).find(
				(p: any) =>
					p?._id && p._id.toString() !== currentUserId.toString(),
			);
			if (other) otherParticipantIds.push(other._id.toString());
			return {
				...conv,
				activeParticipants: (conv.participants || []).filter(
					(p: any) => p != null,
				),
				otherParticipantId: other?._id?.toString() || null,
			};
		});
		const [presenceMap, lastSeenMap] = await Promise.all([
			getUserPresenceStatuses([...new Set(otherParticipantIds)]),
			getUserLastSeens([...new Set(otherParticipantIds)]),
		]);

		const result = prepared.map((item: any) => {
			const presence = item.otherParticipantId
				? presenceMap[item.otherParticipantId] || "offline"
				: "offline";
			const lastSeenAt = item.otherParticipantId
				? lastSeenMap[item.otherParticipantId] || 0
				: 0;
			const { activeParticipants, otherParticipantId, ...rest } = item;
			return {
				...rest,
				participants: activeParticipants,
				presence,
				lastSeenAt,
				archived: true,
			};
		});

		return res.status(200).json({
			success: true,
			conversations: result,
		});
	} catch (err: any) {
		logger.error("Error in getArchivedConversations controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

// ─── Starred messages (1-on-1) ────────────────────────────────────────

/**
 * Toggle star (save) on a personal-chat message for the current user.
 * POST /api/chats/messages/:messageId/star
 */
export const toggleStarMessage = async (
	req: Request<{ messageId: string }>,
	res: Response,
	next: NextFunction,
) => {
	try {
		const { messageId } = req.params;
		const currentUserId = req.user?._id;
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}
		if (!mongoose.Types.ObjectId.isValid(messageId)) {
			return next(new BadRequestError("Invalid message ID!"));
		}

		const message = await Message.findById(messageId);
		if (!message) {
			return next(new NotFoundError("Message not found!"));
		}
		// Only participants may star a message in the conversation.
		const isParticipant = await Conversation.exists({
			_id: message.conversation,
			participants: currentUserId,
		});
		if (!isParticipant) {
			return next(
				new ForbiddenError(
					"You can only star messages in your own conversations!",
				),
			);
		}

		const userIdStr = currentUserId.toString();
		const hasStarred = (message.savedBy || []).some(
			(s: any) => s.toString() === userIdStr,
		);
		if (hasStarred) {
			await Message.updateOne(
				{ _id: messageId },
				{ $pull: { savedBy: currentUserId } },
			);
		} else {
			await Message.updateOne(
				{ _id: messageId },
				{ $addToSet: { savedBy: currentUserId } },
			);
		}

		// Realtime sync for the sender's other devices.
		const io = getIO();
		io.to(`conversation:${message.conversation.toString()}`).emit(
			"message:starred",
			{
				conversationId: message.conversation.toString(),
				messageId,
				starred: !hasStarred,
				userId: userIdStr,
			},
		);

		return res.status(200).json({
			success: true,
			starred: !hasStarred,
		});
	} catch (err: any) {
		logger.error("Error in toggleStarMessage controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

/**
 * List the current user's starred messages in one conversation (the chat
 * media library's "Starred" tab).
 * GET /api/chats/conversations/:conversationId/starred
 */
export const getStarredMessages = async (
	req: Request<{ conversationId: string }>,
	res: Response,
	next: NextFunction,
) => {
	try {
		const { conversationId } = req.params;
		const currentUserId = req.user?._id;
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}
		if (!mongoose.Types.ObjectId.isValid(conversationId)) {
			return next(new BadRequestError("Invalid conversation ID!"));
		}

		const isParticipant = await Conversation.exists({
			_id: conversationId,
			participants: currentUserId,
		});
		if (!isParticipant) {
			return next(
				new ForbiddenError(
					"You can only view your own conversations!",
				),
			);
		}

		const messages = await Message.find({
			conversation: conversationId,
			savedBy: currentUserId,
			isDeleted: { $ne: true },
		})
			.populate(
				"sender",
				"username fullName profilePic isVerified statusText waitlistPerk",
			)
			.sort({ createdAt: -1 })
			.limit(200)
			.lean();

		return res.status(200).json({ success: true, messages });
	} catch (err: any) {
		logger.error("Error in getStarredMessages controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

// ─── 1-on-1 media library ─────────────────────────────────────────────

/**
 * Media library for a 1-on-1 conversation (mirrors getCommunityMedia):
 * photos / videos / audio / files, filtered by the same attachments.type
 * taxonomy the community overlay uses. Index-backed
 * ({ conversation, "attachments.type", createdAt }) and cached 60s per
 * user+conversation+type; evicted on every media mutation (send/edit/
 * delete), so tab switches are ~1ms after the first load.
 * GET /api/chats/conversations/:conversationId/media?type=image
 */
export const getConversationMedia = async (
	req: Request<{ conversationId: string }>,
	res: Response,
	next: NextFunction,
) => {
	try {
		const { conversationId } = req.params;
		const currentUserId = req.user?._id;
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}
		if (!mongoose.Types.ObjectId.isValid(conversationId)) {
			return next(new BadRequestError("Invalid conversation ID!"));
		}

		// Map UI tabs to attachment types (same mapping as the community
		// media library).
		const mediaType = (req.query.type as string) || "image";
		const typeMap: Record<string, string[]> = {
			image: ["image", "gif", "sticker", "meme"],
			video: ["video"],
			audio: ["voice_note"],
			file: ["file"],
		};
		const types = (typeMap[mediaType] || typeMap.image) as any;

		const isParticipant = await Conversation.exists({
			_id: conversationId,
			participants: currentUserId,
		});
		if (!isParticipant) {
			return next(
				new ForbiddenError(
					"You can only view your own conversations!",
				),
			);
		}

		// Per-user cache (60s) — the library is opened on every chat visit and
		// each tab switch used to re-query Atlas.
		const cacheKey = `chat:conv:${conversationId}:media:${currentUserId.toString()}:${mediaType}`;
		try {
			const cached = await getCache(cacheKey);
			if (cached) return res.status(200).json(cached);
		} catch (cacheErr: any) {
			logger.error("Cache error in getConversationMedia", {
				error: cacheErr.message,
			});
		}

		const messages = await Message.find({
			conversation: conversationId,
			"attachments.type": { $in: types },
			isDeleted: { $ne: true },
			deletedFor: { $nin: [currentUserId] },
		})
			.select(
				"attachments text sender createdAt system callType callDuration",
			)
			.populate(
				"sender",
				"username fullName profilePic isVerified statusText waitlistPerk",
			)
			.sort({ createdAt: -1 })
			.limit(200)
			.lean();

		const responseData = { success: true, messages };
		try {
			await setCache(cacheKey, responseData, 60);
		} catch (cacheErr: any) {
			logger.error("Cache set error in getConversationMedia", {
				error: cacheErr.message,
			});
		}

		return res.status(200).json(responseData);
	} catch (err: any) {
		logger.error("Error in getConversationMedia controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

/**
 * Get whether the current user muted a conversation.
 * GET /api/chats/conversations/:conversationId/muted
 */
export const getConversationMutedStatus = async (
	req: Request<{ conversationId: string }>,
	res: Response,
	next: NextFunction,
) => {
	try {
		const { conversationId } = req.params;
		const currentUserId = req.user?._id;
		const userId = currentUserId?.toString();

		const user = await User.findById(userId)
			.select("mutedConversations")
			.lean();
		const muted =
			user?.mutedConversations?.some(
				(m) => m.conversation?.toString() === conversationId,
			) ?? false;

		return res.status(200).json({ success: true, muted });
	} catch (err: any) {
		logger.error("Error in getConversationMutedStatus controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

// ─── Messages ────────────────────────────────────────────────────────

/**
 * Get paginated messages for a specific conversation using cursor-based pagination.
 */
export const getMessages = async (
	req: Request<ConversationParams>,
	res: Response,
	next: NextFunction,
) => {
	const { conversationId } = req.params;
	const currentUserId = req.user?._id;
	const cursor = req.query.cursor as string;
	const limit = Math.min(Number(req.query.limit) || 20, 50);

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		if (!mongoose.Types.ObjectId.isValid(conversationId)) {
			return next(new BadRequestError("Invalid conversation ID!"));
		}

		// Verify conversation exists and user is a participant
		const conversation = await Conversation.findById(conversationId);
		if (!conversation) {
			return next(new NotFoundError("Conversation not found!"));
		}

		if (
			!conversation.participants
				.map((id) => id.toString())
				.includes(currentUserId.toString())
		) {
			return next(
				new ForbiddenError(
					"You are not authorized to access this conversation!",
				),
			);
		}

		// cache key
		const cacheKey = `chat:conv:${conversationId}:messages:${cursor || "first"}:${limit}`;

		// Fast in-memory layer in front of the Redis round-trip — the message
		// history is re-fetched on every conversation open / pagination.
		const memCachedMessages = getMemCache(cacheKey);
		if (memCachedMessages) return res.status(200).json(memCachedMessages);

		try {
			const cached = await getCache(cacheKey);
			if (cached) return res.status(200).json(cached);
		} catch (err: any) {
			logger.error(`Cache error in getMessages!`, { error: err.message });
		}

		// Build pagination query
		const query: any = { conversation: conversationId };
		if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
			query._id = { $lt: cursor };
		}

		// Fetch messages (limit + 1 to check for hasMore)
		const messages = await Message.find(query)
			.populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
			.populate({
				path: "replyTo",
				select: "sender text attachments createdAt",
				populate: { path: "sender", select: "username fullName profilePic isVerified statusText waitlistPerk" },
			})
			.sort({ _id: -1 })
			.limit(limit + 1)
			.lean();

		const hasMore = messages.length > limit;
		if (hasMore) {
			messages.pop(); // Remove the extra record used for checking
		}

		// Reverse messages to present them in chronological order to the client
		messages.reverse();

		const nextCursor =
			hasMore && messages.length > 0 ? messages[0]!._id : null;

		const responseData = {
			success: true,
			message: messages.length
				? "Messages fetched successfully!"
				: "No messages yet!",
			messages,
			nextCursor,
			hasMore,
		};

		// cache messages per conversation — in-memory (10s) + Redis (30s)
		setMemCache(cacheKey, responseData, 10);
		try {
			await setCache(cacheKey, responseData, 30);
		} catch (err: any) {
			logger.error(`Cache set error in getMessages!`, { error: err.message });
		}

		return res.status(200).json(responseData);
	} catch (err: any) {
		logger.error("Error in getMessages controller", { error: err.message });
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

/**
 * Send a message with text and/or file uploads.
 */
export const sendMessage = async (
	req: Request<ConversationParams>,
	res: Response,
	next: NextFunction,
) => {
	const { conversationId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		if (!mongoose.Types.ObjectId.isValid(conversationId)) {
			return next(new BadRequestError("Invalid conversation ID!"));
		}

		// Verify conversation and participation
		const conversation = await Conversation.findById(conversationId);
		if (!conversation) {
			return next(new NotFoundError("Conversation not found!"));
		}

		const participantsStr = conversation.participants.map((id) =>
			id.toString(),
		);
		if (!participantsStr.includes(currentUserId.toString())) {
			return next(
				new ForbiddenError(
					"You are not a participant in this conversation!",
				),
			);
		}

		// Self-chat ("Message yourself"): both participants are me, so the
		// recipient IS the sender. Everything downstream (unread badge, seen
		// receipt, notification, push) is skipped — a note to yourself is
		// always read the instant it's sent.
		const isSelfChat = participantsStr.every(
			(id) => id === currentUserId.toString(),
		);
		const recipientId = isSelfChat
			? currentUserId.toString()
			: participantsStr.find((id) => id !== currentUserId.toString());
		if (!recipientId) {
			return next(
				new AppError(
					"Recipient not found in conversation participants list!",
				),
			);
		}

		// Block check + recipient-activity check + muted check run in PARALLEL
		// — independent DB lookups, no reason to serialize them. Self-chat:
		// never blocked, always "active" (you're reading your own note the
		// moment it's sent → instant blue tick), never muted.
		const [isBlocked, isRecipientActive, mutedByRecipient] = isSelfChat
			? [null, true, null]
			: await Promise.all([
					Block.findOne({
						$or: [
							{ blocker: currentUserId, blocked: recipientId },
							{ blocker: recipientId, blocked: currentUserId },
						],
					}),
					isRecipientActiveInConversation(conversationId, recipientId),
					// Muted check — read once up front so BOTH the unread-badge
					// increment and the notification/push suppression below use it
					// (WhatsApp: a muted chat delivers the message but never bumps
					// a badge count or fires a notification).
					User.findOne({
						_id: recipientId,
						"mutedConversations.conversation": conversationId,
					})
						.select("_id")
						.lean(),
				]);
		if (isBlocked) {
			return next(new ForbiddenError("Cannot communicate with a blocked user!"));
		}
		const isChatMuted = !!mutedByRecipient;

		// Map files uploaded via Multer and upload to ImageKit (fallback to Cloudinary if keys aren't configured)
		const uploadedFiles = (req.files as any[]) || [];
		const fileAttachments = await Promise.all(
			uploadedFiles.map(async (file) => {
				let type: "voice_note" | "image" | "gif" | "video" | "file" = "file";
				if (file.mimetype.startsWith("audio/")) {
					type = "voice_note";
				} else if (file.mimetype.startsWith("video/")) {
					type = "video";
				} else if (file.mimetype.startsWith("image/")) {
					if (file.mimetype === "image/gif") {
						type = "gif";
					} else {
						type = "image";
					}
				}

				let url = "";
				let public_id = "";

				if (imagekit) {
					try {
						// Upload to ImageKit
						const uploadRes = await imagekit.upload({
							file: file.buffer,
							fileName: `${Date.now()}-${file.originalname}`,
							folder: type === "voice_note" ? "/orbit/chats/voice_notes" : "/orbit/chats/media",
						});
						url = uploadRes.url;
						public_id = uploadRes.fileId;
					} catch (ikErr) {
						logger.error("Failed to upload to ImageKit, falling back to Cloudinary", { error: (ikErr as Error).message });
					}
				}

				// Fallback to Cloudinary if ImageKit is disabled or failed
				if (!url) {
					const cloudinaryUpload = (): Promise<any> => {
						return new Promise((resolve, reject) => {
							const stream = cloudinary.uploader.upload_stream(
								{
									folder: type === "voice_note" ? "orbit/chats/voice_notes" : "orbit/chats/media",
									resource_type: "auto",
								},
								(error, result) => {
									if (error || !result) {
										reject(error || new Error("Cloudinary upload failed"));
									} else {
										resolve(result);
									}
								}
							);
							stream.end(file.buffer);
						});
					};
					const uploadRes = await cloudinaryUpload();
					url = uploadRes.secure_url;
					public_id = uploadRes.public_id;
				}

				const attachment: any = {
					url,
					public_id,
					type,
					name: file.originalname || "",
					size: file.size || 0,
					mimetype: file.mimetype || "",
				};
				if (type === "voice_note") {
					const duration = req.body.duration ? Number(req.body.duration) : 0;
					if (duration > 0) {
						attachment.duration = duration;
					}
				}
				return attachment;
			})
		);

		// Parse external attachments (e.g. external gifs, memes)
		let bodyAttachments: any[] = [];
		if (req.body.attachments) {
			try {
				bodyAttachments =
					typeof req.body.attachments === "string"
						? JSON.parse(req.body.attachments)
						: req.body.attachments;
			} catch (parseErr) {
				return next(new BadRequestError("Invalid attachments format."));
			}
		}

		const attachments = [...fileAttachments, ...bodyAttachments];

		// Validate request contents using Zod
		const validation = sendMessageSchema.safeParse({
			text: req.body.text,
			attachments: attachments.length > 0 ? attachments : undefined,
			replyTo: req.body.replyTo,
		});

		if (!validation.success) {
			return next(
				new BadRequestError(
					validation.error.issues[0]?.message || "Validation failed",
				),
			);
		}

		const sanitizedText = validation.data.text
			? sanitizePlainText(validation.data.text)
			: "";

		// The reply target must belong to THIS conversation. A stale or crafted
		// replyTo id would otherwise quote a message from another chat (the
		// client clears reply state on conversation switch, but the server
		// must enforce it too). Indexed lookup — cheap, reply-sends only.
		if (validation.data.replyTo) {
			const replied = await Message.exists({
				_id: validation.data.replyTo,
				conversation: conversationId,
			});
			if (!replied) {
				return next(
					new BadRequestError(
						"Replied-to message not found in this conversation!",
					),
				);
			}
		}

		// Optional scheduled send (WhatsApp/IG-style). When the client passes a
		// future scheduledAt, the message is STORED but not delivered yet — the
		// sender sees a "Scheduled" bubble; the BullMQ delayed job (or the 1-min
		// cron safety net) delivers it at the exact time via
		// deliverScheduledDm. No emits, no unread, no notifications now.
		let scheduledAt: Date | null = null;
		if (req.body.scheduledAt) {
			const parsed = new Date(req.body.scheduledAt);
			if (isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
				return next(
					new BadRequestError(
						"scheduledAt must be a future date/time!",
					),
				);
			}
			scheduledAt = parsed;
		}

		// Create the message
		const message = new Message({
			conversation: conversationId,
			sender: currentUserId,
			recipient: recipientId,
			text: sanitizedText,
			attachments,
			replyTo: validation.data.replyTo || null,
			forwardedFrom: req.body.forwardedFrom || null,
			seen: isRecipientActive,
			seenAt: isRecipientActive ? new Date() : null,
			scheduledAt,
			// Durable marker that this message was scheduled — the edit/delete
			// window anchors on deliveredAt (not createdAt) for these, so a
			// schedule set days ago is retractable for 5 minutes after it
			// actually lands.
			wasScheduled: !!scheduledAt,
		});

		await message.save();

		// ── Scheduled-send: store + return, deliver later ──────────────────
		// The row is persisted with scheduledAt; nothing is broadcast or
		// notified now. The BullMQ delayed job fires at scheduledAt and calls
		// deliverScheduledDm (the 1-min cron in scheduler.ts is the fallback
		// when BullMQ isn't configured). Fire-and-forget — the response must
		// not wait on Redis.
		if (scheduledAt) {
			const { enqueueScheduledMessageDelivery } = await import(
				"../configs/queue"
			);
			void enqueueScheduledMessageDelivery(
				"dm",
				message._id.toString(),
				scheduledAt,
			).catch(() => {});

			const scheduledPopulated = await Message.findById(message._id)
				.populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
				.populate({
					path: "replyTo",
					select: "sender text attachments createdAt",
					populate: { path: "sender", select: "username fullName profilePic isVerified statusText waitlistPerk" },
				})
				.lean();

			return res.status(201).json({
				success: true,
				message: "Message scheduled!",
				sentMessage: scheduledPopulated,
			});
		}

		// The recipient is ACTIVELY viewing this conversation — broadcast the
		// seen receipt the moment the message is persisted so the sender's blue
		// tick flips over the socket immediately, instead of waiting for this
		// (potentially slow) HTTP response or the recipient's next chat:join.
		// Fire-and-forget; harmless when it races the chat:join emit — the
		// client treats repeated messages:seen events as idempotent.
		if (isRecipientActive) {
			getIO().to(`conversation:${conversationId}`).emit("messages:seen", {
				conversationId,
				seenBy: recipientId,
				seenAt: message.seenAt || new Date(),
			});
		}

		// Populate sender info for the client response and socket emits
		const populatedMessage = await Message.findById(message._id)
			.populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
			.populate({
				path: "replyTo",
				select: "sender text attachments createdAt",
				populate: { path: "sender", select: "username fullName profilePic isVerified statusText waitlistPerk" },
			})
			.lean();

		// Emit real-time message event to conversation room (active viewers)
		emitNewMessage(conversationId, populatedMessage);

		// Update conversation properties — lastAction is reset to null (a fresh
		// message supersedes any stale "reacted" preview). Feeds the unread
		// count used in the recipient notification payload below, so it stays
		// in the request path.
		const updateObj: any = { lastMessage: message._id, lastAction: null };
		if (!isRecipientActive && !isSelfChat && !isChatMuted) {
			// Increment unread count for recipient if they are not active in the
			// chatbox AND the chat isn't muted (WhatsApp: muted chats deliver
			// the message but never bump a badge count).
			updateObj.$inc = { [`unreadCounts.${recipientId}`]: 1 };
		}
		// WhatsApp behavior: a new incoming message un-archives the chat for the
		// RECIPIENT (so it resurfaces in the main list with its badge). The
		// sender's own archive state is untouched — they just sent, they know
		// it's there.
		updateObj.$pull = { archivedBy: recipientId };
		const updatedConversation = await Conversation.findByIdAndUpdate(
			conversationId,
			updateObj,
			{ returnDocument: 'after' },
		);

		// ── Cache eviction + mention/reply notifications run fire-and-forget ──
		// Upstash REST SCAN+DEL round-trips are the single biggest latency source
		// in this endpoint on the free tier (~8-10 sequential calls per send);
		// the sender must never wait on them. Live UI is served by the socket
		// emits below, so a few ms of eviction delay is imperceptible — while
		// removing ~1-2s from the send path.
		void (async () => {
			try {
				// New message content changes what search would return for this
				// conversation — drop the cached results so the next search is fresh.
				clearSearchCacheForTarget(`chat:${conversationId}`);

				// Clear chat cache (in-memory + Upstash pattern sweeps).
				await clearChatCache(conversationId, [
					currentUserId.toString(),
					recipientId.toString(),
				]);

				// @mentions in DM chats — if the sender mentioned a participant
				// other than the direct recipient, ping them explicitly so they
				// see "X mentioned you" in-app + on device. 1:1 chats have no
				// extra participant, so this is future-proofing for groups.
				if (sanitizedText.trim()) {
					try {
						const mentionedUserIds = await extractMentions(sanitizedText);
						const otherParticipantId = conversation.participants
							.map((p: any) => p.toString())
							.find(
								(pid: string) =>
									pid !== currentUserId.toString() &&
									pid !== recipientId.toString(),
							);
						for (const mentionedId of mentionedUserIds) {
							if (
								mentionedId === currentUserId.toString() ||
								mentionedId === recipientId.toString()
							) {
								continue;
							}
							// Only notify participants of this conversation
							if (otherParticipantId && mentionedId === otherParticipantId) {
								await createNotification({
									recipient: mentionedId,
									sender: currentUserId.toString(),
									type: "mention",
								});
							}
						}
					} catch (mentionErr) {
						logger.error("Failed to process chat mentions", {
							error: (mentionErr as Error).message,
						});
					}
				}

				// If this is a reply, create a notification for the original message's sender
				if (validation.data.replyTo) {
					try {
						const repliedMessage = await Message.findById(validation.data.replyTo).select("sender").lean();
						if (repliedMessage && repliedMessage.sender) {
							const senderField = repliedMessage.sender as any;
							const originalSenderId = senderField._id
								? senderField._id.toString()
								: senderField.toString();

							if (
								originalSenderId !== currentUserId.toString() &&
								(await shouldNotifyCategory(
									originalSenderId,
									"message_reply",
								))
							) {
								await createNotification({
									recipient: originalSenderId,
									sender: currentUserId.toString(),
									type: "message_reply",
								});
							}
						}
					} catch (notifErr) {
						logger.error("Failed to create message_reply notification", { error: (notifErr as Error).message });
					}
				}

			} catch (bgErr: any) {
				logger.error("Background chat-send bookkeeping failed", {
					error: bgErr.message,
					conversationId,
				});
			}
		})();

		// If recipient is not actively in the chatbox, emit to their personal
		// room so they still get the message data in real-time (even on other
		// tabs) and send a badge/toast notification + device push. This block
		// stays in the request path: the in-app "message" notification drives
		// the recipient's bell badge and must be persisted before the send
		// response returns. Self-chat: recipient === sender, so there's nobody
		// to notify — skip the whole block (the message was already broadcast
		// to the conversation room by emitNewMessage above).
		if (!isRecipientActive && !isSelfChat) {
					// Emit to personal room — the Chat.tsx handler appends to messages
					// if viewing this conversation, otherwise updates the conversations list
					getIO().to(`user:${recipientId}`).emit("message:new", populatedMessage);

					const recipientUnreadCount =
						updatedConversation?.unreadCounts?.get(recipientId) || 1;

					// Fetch the full populated conversation (for the notification the
					// recipient can add to their list). The muted flag was already
					// read up front (mutedByRecipient) — no need to re-query it.
					const populatedConversation = await Conversation.findById(
						conversationId,
					)
						.populate("participants", "username fullName profilePic isVerified statusText waitlistPerk")
						.populate({
							path: "lastMessage",
							populate: {
								path: "sender",
								select: "username fullName profilePic isVerified statusText waitlistPerk",
							},
						})
						.lean();

					emitChatNotification(recipientId, {
						conversationId,
						message: populatedMessage,
						unreadCount: recipientUnreadCount,
						conversation: populatedConversation,
					});

					// Muted chats: suppress the in-app bell notification AND the push
					// AND the chat-tab badge increment (isChatMuted gates the
					// unreadCounts.$inc up in the updateObj) — the message itself
					// still arrives. WhatsApp behavior.
					// Create an in-app notification so the notifications bell badge
					// reflects new messages too. Dedupe per sender while unread.
					if (!isChatMuted) {
						try {
							// Determine message type from attachments for the notification display
							let messageType: "text" | "photo" | "video" | "voice_note" | "file" | "gif" | "sticker" = "text";
							if (attachments.length > 0) {
								const firstAttach = attachments[0];
								if (firstAttach.type === "image") messageType = "photo";
								else if (firstAttach.type === "gif") messageType = "gif";
								else if (firstAttach.type === "sticker") messageType = "sticker";
								else if (firstAttach.type === "video") messageType = "video";
								else if (firstAttach.type === "voice_note") messageType = "voice_note";
								else if (firstAttach.type === "file") messageType = "file";
							}

							// Upsert-style: reuse an existing unread notification from the
							// same sender (touched so it bubbles to the top) instead of
							// flooding the notifications list with one row per message.
							const populatedNotif = await Notification.findOneAndUpdate(
								{
									recipient: recipientId,
									sender: currentUserId,
									type: "message",
									isRead: false,
								},
								{
									$set: { messageType, createdAt: new Date() },
									$setOnInsert: {
										recipient: recipientId,
										sender: currentUserId,
										type: "message",
									},
								},
								{ upsert: true, returnDocument: "after" },
							)
								.populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
								.lean();

							if (populatedNotif) {
								getIO().to(`user:${recipientId}`).emit("notification", populatedNotif);
							}
						} catch (notifErr) {
							logger.error("Failed to create chat message notification", {
								error: (notifErr as Error).message,
								recipientId,
							});
						}
					}

					// Send a real on-device push notification for the new message
					if (
						!isChatMuted &&
						(await shouldNotifyCategory(recipientId, "message"))
					) {
						try {
							const senderInfo = (populatedMessage as any)?.sender || {};
							const senderName =
								senderInfo?.fullName || senderInfo?.username || "Someone";
							// Plain-text, type-specific body ("Photo", "Voice note",
							// "Video", "File") — no emoji in push bodies.
							const messageText = attachmentPushLabel(
								(populatedMessage as any)?.attachments,
								(populatedMessage as any)?.text,
							);
							sendPushToUser(recipientId, {
								title: senderName,
								body: messageText,
								icon: senderInfo?.profilePic?.url || "/icon-192.png",
								tag: `orbit-chat-${conversationId}`,
								timestamp: new Date().toISOString(),
								data: {
									url: "/chat",
									type: "message",
									conversationId,
									unreadCount: recipientUnreadCount || 0,
								},
							});
						} catch (pushErr) {
							logger.warn("Failed to send chat push notification", {
								error: (pushErr as Error).message,
							});
						}
					}
		}

		// Achievement badges (fire-and-forget)
		checkBadgesAndNotify(currentUserId.toString(), "message").catch(() => {});

		return res.status(201).json({
			success: true,
			message: "Message sent successfully!",
			sentMessage: populatedMessage,
		});
	} catch (err: any) {
		logger.error("Error in sendMessage controller", { error: err.message });
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

/**
 * Deliver a scheduled DM — called by the BullMQ delayed job / cron safety
 * net at the message's scheduledAt time. The row already exists with
 * scheduledAt set (and was returned to the sender as a "Scheduled" bubble);
 * this runs the SAME delivery the send path would: emit to the conversation
 * room + recipient's personal room, update lastMessage, unread, caches,
 * AND the in-app notification + device push the live send path creates
 * (a scheduled message must reach an offline recipient like any other).
 */
export const deliverScheduledDm = async (
	conversationId: string,
	messageId: string,
): Promise<void> => {
	try {
		const message = await Message.findById(messageId).populate(
			"sender",
			"username fullName profilePic isVerified statusText waitlistPerk",
		);
		if (!message) return;

		const populated = await Message.findById(message._id)
			.populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
			.populate({
				path: "replyTo",
				select: "sender text attachments createdAt",
				populate: { path: "sender", select: "username fullName profilePic isVerified statusText waitlistPerk" },
			})
			.lean();

		// Active viewers + the recipient's personal room get it in realtime.
		emitNewMessage(conversationId, populated);
		const recipientId = message.recipient?.toString();
		if (recipientId) {
			getIO().to(`user:${recipientId}`).emit("message:new", populated);
		}

		// Conversation snapshot + unread (only when the recipient isn't viewing
		// AND hasn't muted the chat — muted chats never bump a badge count).
		const isRecipientActive = recipientId
			? await isRecipientActiveInConversation(conversationId, recipientId)
			: false;
		const isMuted = recipientId
			? await User.exists({
					_id: recipientId,
					"mutedConversations.conversation": conversationId,
				})
			: false;
		const updateObj: any = { lastMessage: message._id, lastAction: null };
		if (!isRecipientActive && recipientId && !isMuted) {
			updateObj.$inc = { [`unreadCounts.${recipientId}`]: 1 };
		}
		if (recipientId) {
			updateObj.$pull = { archivedBy: recipientId };
		}
		await Conversation.findByIdAndUpdate(conversationId, updateObj);

		// Notifications + push: the realtime emits above cover an open tab;
		// this covers the bell badge + device push when the recipient ISN'T
		// viewing the chat (and hasn't muted it). Self-chat (recipient ===
		// sender) has nobody to notify — it's your own note.
		const senderIdStr =
			message.sender?._id?.toString?.() || message.sender?.toString?.();
		if (recipientId && !isRecipientActive && senderIdStr !== recipientId) {
			try {
				// Muted chats deliver the message but never notify (the badge
				// increment above is gated the same way).
				if (!isMuted) {
					// Same messageType mapping as the live send path.
					let messageType:
						| "text"
						| "photo"
						| "video"
						| "voice_note"
						| "file"
						| "gif"
						| "sticker" = "text";
					const firstAttach = (message.attachments || [])[0];
					if (firstAttach?.type === "image") messageType = "photo";
					else if (firstAttach?.type === "gif") messageType = "gif";
					else if (firstAttach?.type === "sticker") messageType = "sticker";
					else if (firstAttach?.type === "video") messageType = "video";
					else if (firstAttach?.type === "voice_note") messageType = "voice_note";
					else if (firstAttach?.type === "file") messageType = "file";

					// Upsert-style: reuse an unread notification from the same
					// sender (touched to the top) instead of one row per message.
					const populatedNotif = await Notification.findOneAndUpdate(
						{
							recipient: recipientId,
							sender: message.sender?._id,
							type: "message",
							isRead: false,
						},
						{
							$set: { messageType, createdAt: new Date() },
							$setOnInsert: {
								recipient: recipientId,
								sender: message.sender?._id,
								type: "message",
							},
						},
						{ upsert: true, returnDocument: "after" },
					)
						.populate(
							"sender",
							"username fullName profilePic isVerified statusText waitlistPerk",
						)
						.lean();

					if (populatedNotif) {
						getIO()
							.to(`user:${recipientId}`)
							.emit("notification", populatedNotif);
					}

					// Device push (respecting the per-category preference).
					if (await shouldNotifyCategory(recipientId, "message")) {
						try {
							const senderInfo = (populated as any)?.sender || {};
							const senderName =
								senderInfo?.fullName || senderInfo?.username || "Someone";
							const messageText = attachmentPushLabel(
								(populated as any)?.attachments,
								(populated as any)?.text,
							);
							sendPushToUser(recipientId, {
								title: senderName,
								body: messageText,
								icon:
									senderInfo?.profilePic?.url || "/icon-192.png",
								tag: `orbit-chat-${conversationId}`,
								timestamp: new Date().toISOString(),
								data: {
									url: "/chat",
									type: "message",
									conversationId,
									unreadCount: 0,
								},
							});
						} catch (pushErr) {
							logger.warn("Failed to send scheduled-message push", {
								error: (pushErr as Error).message,
							});
						}
					}
				}
			} catch (notifErr: any) {
				logger.error(
					"Failed to create scheduled-message notification",
					{
						error: notifErr.message,
						recipientId,
					},
				);
			}
		}

		// Caches: search + thread + list must not serve stale state.
		void (async () => {
			try {
				clearSearchCacheForTarget(`chat:${conversationId}`);
				await clearChatCache(conversationId, [
					message.sender?.toString() || "",
					recipientId || "",
				]);
			} catch (bgErr: any) {
				logger.error("Scheduled DM cache eviction failed", {
					error: bgErr.message,
				});
			}
		})();
	} catch (err: any) {
		logger.error("Error in deliverScheduledDm", { error: err.message });
	}
};

/**
 * Edit a message within 5 minutes of sending.
 */
export const editMessage = async (
	req: Request<MessageParams>,
	res: Response,
	next: NextFunction,
) => {
	const { messageId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		if (!mongoose.Types.ObjectId.isValid(messageId)) {
			return next(new BadRequestError("Invalid message ID!"));
		}

		const validation = editMessageSchema.safeParse(req.body);
		if (!validation.success) {
			return next(
				new BadRequestError(
					validation.error.issues[0]?.message || "Validation failed",
				),
			);
		}

		const message = await Message.findById(messageId);
		if (!message) {
			return next(new NotFoundError("Message not found!"));
		}

		// Ownership check
		if (message.sender.toString() !== currentUserId.toString()) {
			return next(
				new ForbiddenError("You can only edit your own messages!"),
			);
		}

		// 5 minutes check. Scheduled messages anchor on their DELIVERY time
		// (deliveredAt) — the schedule was created whenever the user picked,
		// but the message only "exists" for the other side from delivery, so
		// that's when the retraction window should start. Unscheduled
		// messages keep the createdAt anchor.
		const editAnchor =
			message.wasScheduled && message.deliveredAt
				? message.deliveredAt
				: message.createdAt;
		const diffMs = Date.now() - editAnchor.getTime();
		const EDIT_TIME_LIMIT = 5 * 60 * 1000; // 5 minutes
		if (diffMs > EDIT_TIME_LIMIT) {
			return next(
				new BadRequestError(
					"Message can only be edited within 5 minutes of sending!",
				),
			);
		}

		const sanitizedText = sanitizePlainText(validation.data.text);
		message.text = sanitizedText;
		message.isEdited = true;
		await message.save();

		// Clear chat cache (fire-and-forget — never make the editor wait on it)
		const conversation = await Conversation.findById(message.conversation);
		if (conversation) {
			void clearChatCache(message.conversation.toString(), conversation.participants.map(p => p.toString())).catch(() => {});
		}

		const populatedMessage = await Message.findById(message._id)
			.populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
			.lean();

		// Emit live update to conversation room and each participant's personal room
		const convEditParticipantIds = conversation?.participants?.map((p: any) => p.toString()) || [];
		emitMessageEdit(
			message.conversation.toString(),
			populatedMessage,
			convEditParticipantIds,
		);

		return res.status(200).json({
			success: true,
			message: "Message edited successfully!",
			editedMessage: populatedMessage,
		});
	} catch (err: any) {
		logger.error("Error in editMessage controller", { error: err.message });
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

/**
 * Delete a message (mark as deleted) within 5 minutes of sending.
 */
export const deleteMessage = async (
	req: Request<MessageParams>,
	res: Response,
	next: NextFunction,
) => {
	const { messageId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		if (!mongoose.Types.ObjectId.isValid(messageId)) {
			return next(new BadRequestError("Invalid message ID!"));
		}

		const message = await Message.findById(messageId);
		if (!message) {
			return next(new NotFoundError("Message not found!"));
		}

		// Ownership check
		if (message.sender.toString() !== currentUserId.toString()) {
			return next(
				new ForbiddenError("You can only delete your own messages!"),
			);
		}

		// 5 minutes check — UNLESS the message is still scheduled (scheduledAt
		// set, delivery pending): canceling a scheduled message is deleting
		// before it was ever sent, so there's no window limit. The sender must
		// be able to cancel a schedule set hours ago.
		const isStillScheduled =
			message.scheduledAt &&
			message.scheduledAt.getTime() > Date.now();
		if (!isStillScheduled) {
			// Same delivery-anchor rule as the edit window: a delivered
			// scheduled message is retractable for 5 minutes from delivery,
			// not from whenever it was scheduled.
			const deleteAnchor =
				message.wasScheduled && message.deliveredAt
					? message.deliveredAt
					: message.createdAt;
			const diffMs = Date.now() - deleteAnchor.getTime();
			const DELETE_TIME_LIMIT = 5 * 60 * 1000; // 5 minutes
			if (diffMs > DELETE_TIME_LIMIT) {
				return next(
					new BadRequestError(
						"Message can only be deleted within 5 minutes of sending!",
					),
				);
			}
		}

		// Cloudinary cleanup of attachments — offloaded to the BullMQ
		// media-cleanup worker when configured (inline otherwise).
		const oldAttachments = message.attachments || [];
		const deletedPublicIds = oldAttachments
			.map((att) => att.public_id)
			.filter(Boolean);
		void cleanupMedia(deletedPublicIds);

		// Mark as deleted, replace text, and clear attachments list
		message.isDeleted = true;
		message.text = "This message was deleted";
		message.attachments = [] as any;
		await message.save();

		// Clear chat cache (fire-and-forget — never make the deleter wait on it)
		const conversation = await Conversation.findById(message.conversation);
		if (conversation) {
			void clearChatCache(message.conversation.toString(), conversation.participants.map(p => p.toString())).catch(() => {});
		}

		// Emit live deletion — includes participant IDs so personal rooms get the update
		const convParticipants = conversation?.participants?.map((p: any) => p.toString()) || [];
		emitMessageDelete(
			message.conversation.toString(),
			message._id.toString(),
			convParticipants,
		);

		return res.status(200).json({
			success: true,
			message: "Message deleted successfully!",
		});
	} catch (err: any) {
		logger.error("Error in deleteMessage controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

/**
 * Delete a message for the current user only (no time limit).
 * The message remains visible to other participants.
 */
export const deleteMessageForMe = async (
	req: Request<MessageParams>,
	res: Response,
	next: NextFunction,
) => {
	const { messageId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		if (!mongoose.Types.ObjectId.isValid(messageId)) {
			return next(new BadRequestError("Invalid message ID!"));
		}

		const message = await Message.findById(messageId);
		if (!message) {
			return next(new NotFoundError("Message not found!"));
		}

		// Verify the user is a participant in the conversation (can always delete for themselves)
		const conversation = await Conversation.findById(message.conversation);
		if (!conversation) {
			return next(new NotFoundError("Conversation not found!"));
		}

		const participantsStr = conversation.participants.map((id) => id.toString());
		if (!participantsStr.includes(currentUserId.toString())) {
			return next(new ForbiddenError("You are not a participant in this conversation!"));
		}

		// Add current user to deletedFor array if not already there
		const userIdStr = currentUserId.toString();
		const alreadyDeleted = (message.deletedFor || []).some(
			(id) => id.toString() === userIdStr
		);

		if (!alreadyDeleted) {
			message.deletedFor.push(new mongoose.Types.ObjectId(userIdStr));
			await message.save();
		}

		// Clear chat cache (fire-and-forget)
		void clearChatCache(message.conversation.toString(), participantsStr).catch(() => {});

		// Emit to conversation room so the deleting user's client hides the message
		emitMessageDeleteForMe(
			message.conversation.toString(),
			message._id.toString(),
			userIdStr,
		);

		return res.status(200).json({
			success: true,
			message: "Message deleted for you!",
		});
	} catch (err: any) {
		logger.error("Error in deleteMessageForMe controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

/**
 * Delete an entire conversation and its messages.
 */
export const deleteConversation = async (
	req: Request<ConversationParams>,
	res: Response,
	next: NextFunction,
) => {
	const { conversationId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		if (!mongoose.Types.ObjectId.isValid(conversationId)) {
			return next(new BadRequestError("Invalid conversation ID!"));
		}

		// Verify conversation exists and user is a participant
		const conversation = await Conversation.findById(conversationId);
		if (!conversation) {
			return next(new NotFoundError("Conversation not found!"));
		}

		if (
			!conversation.participants
				.map((id) => id.toString())
				.includes(currentUserId.toString())
		) {
			return next(
				new ForbiddenError(
					"You are not authorized to delete this conversation!",
				),
			);
		}

		// Find all messages in this conversation to clear their cloudinary attachments
		const messages = await Message.find({ conversation: conversationId });
		const allPublicIds: string[] = [];
		for (const msg of messages) {
			if (msg.attachments && msg.attachments.length > 0) {
				msg.attachments.forEach((att) => {
					if (att.public_id) {
						allPublicIds.push(att.public_id);
					}
				});
			}
		}

		// Destroy Cloudinary attachments — offloaded to the BullMQ
		// media-cleanup worker when configured (inline otherwise).
		void cleanupMedia(allPublicIds);

		// Delete all messages in the conversation
		await Message.deleteMany({ conversation: conversationId });

		// Delete the conversation document itself
		await Conversation.findByIdAndDelete(conversationId);

		// Clear chat cache (fire-and-forget)
		const participants = conversation.participants.map((p) => p.toString());
		void clearChatCache(conversationId, participants).catch(() => {});

		// Emit live socket events to individual user rooms to ensure sidebar updating
		const io = getIO();
		participants.forEach((pId) => {
			io.to(`user:${pId}`).emit("conversation:delete", {
				conversationId,
			});
		});

		return res.status(200).json({
			success: true,
			message: "Conversation deleted successfully!",
		});
	} catch (err: any) {
		logger.error("Error in deleteConversation controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

/**
 * Clear all messages in a conversation.
 */
export const clearConversationMessages = async (
	req: Request<ConversationParams>,
	res: Response,
	next: NextFunction,
) => {
	const { conversationId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		if (!mongoose.Types.ObjectId.isValid(conversationId)) {
			return next(new BadRequestError("Invalid conversation ID!"));
		}

		// Verify conversation exists and user is a participant
		const conversation = await Conversation.findById(conversationId);
		if (!conversation) {
			return next(new NotFoundError("Conversation not found!"));
		}

		if (
			!conversation.participants
				.map((id) => id.toString())
				.includes(currentUserId.toString())
		) {
			return next(
				new ForbiddenError(
					"You are not authorized to clear this conversation!",
				),
			);
		}

		// Find all messages in this conversation to clear their cloudinary attachments
		const messages = await Message.find({ conversation: conversationId });
		const allPublicIds: string[] = [];
		for (const msg of messages) {
			if (msg.attachments && msg.attachments.length > 0) {
				msg.attachments.forEach((att) => {
					if (att.public_id) {
						allPublicIds.push(att.public_id);
					}
				});
			}
		}

		// Destroy Cloudinary attachments — offloaded to the BullMQ
		// media-cleanup worker when configured (inline otherwise).
		void cleanupMedia(allPublicIds);

		// Delete all messages in the conversation
		await Message.deleteMany({ conversation: conversationId });

		// Reset conversation metadata
		conversation.lastMessage = undefined;
		conversation.lastAction = null;
		// Reset unread counts
		const participants = conversation.participants.map((p) => p.toString());
		participants.forEach((pId) => {
			conversation.unreadCounts.set(pId, 0);
		});
		await conversation.save();

		// Clear chat cache (fire-and-forget)
		void clearChatCache(conversationId, participants).catch(() => {});

		// Emit live socket event to conversation room and individual user rooms
		const io = getIO();
		io.to(`conversation:${conversationId}`).emit("conversation:clear", {
			conversationId,
		});
		participants.forEach((pId) => {
			io.to(`user:${pId}`).emit("conversation:cleared", {
				conversationId,
			});
		});

		return res.status(200).json({
			success: true,
			message: "Conversation messages cleared successfully!",
		});
	} catch (err: any) {
		logger.error("Error in clearConversationMessages controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

/**
 * Fetch direct presence status of a user.
 */
export const getUserPresence = async (
	req: Request<UserParams>,
	res: Response,
	next: NextFunction,
) => {
	const { userId } = req.params;

	try {
		if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
			return next(new BadRequestError("Invalid or missing user ID!"));
		}

		const presence = await getUserPresenceStatus(userId);

		return res.status(200).json({
			success: true,
			userId,
			presence,
		});
	} catch (err: any) {
		logger.error("Error in getUserPresence controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

// ─── Pin / Unpin Messages ───────────────────────────────────────────────

/**
 * Pin a message in a 1-on-1 conversation. Each participant can pin up to 5 messages.
 */
export const pinMessage = async (
	req: Request<MessageParams>,
	res: Response,
	next: NextFunction,
) => {
	const { messageId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		if (!mongoose.Types.ObjectId.isValid(messageId)) {
			return next(new BadRequestError("Invalid message ID!"));
		}

		// Find the message to get its conversation
		const message = await Message.findById(messageId).lean();
		if (!message) {
			return next(new NotFoundError("Message not found!"));
		}

		const conversation = await Conversation.findById(message.conversation);
		if (!conversation) {
			return next(new NotFoundError("Conversation not found!"));
		}

		// Verify the user is a participant
		const convParticipants = conversation.participants.map((p) => p.toString());
		if (!convParticipants.includes(currentUserId.toString())) {
			return next(new ForbiddenError("You are not a participant in this conversation!"));
		}

		// Check if already pinned
		const alreadyPinned = (conversation.pinnedMessages || []).some(
			(p) => p.toString() === messageId,
		);
		if (alreadyPinned) {
			return res.status(200).json({
				success: true,
				message: "Message is already pinned!",
			});
		}

		// Limit to 5 pinned messages — remove oldest if at limit
		if (conversation.pinnedMessages && conversation.pinnedMessages.length >= 5) {
			conversation.pinnedMessages.shift();
		}

		if (!conversation.pinnedMessages) {
			conversation.pinnedMessages = [];
		}
		conversation.pinnedMessages.push(message._id);
		await conversation.save();

		// The pinned banner cache must not serve the pre-pin list.
		const convIdForPins = message.conversation.toString();
		clearMemCacheByPrefix(`chat:pinned:${convIdForPins}`);
		void deleteCache(`chat:pinned:${convIdForPins}`).catch(() => {});

		// Fetch populated pinned messages, ordered by pin time (the
		// pinnedMessages array records pin order — newest pin is LAST in the
		// array, so it must be FIRST in the banner).
		const pinnedMessages = await Message.find({
			_id: { $in: conversation.pinnedMessages },
		})
			.populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
			.lean();
		const pinOrder = (conversation.pinnedMessages || []).map((p) =>
			p.toString(),
		);
		pinnedMessages.sort(
			(a, b) =>
				pinOrder.indexOf(b._id.toString()) -
				pinOrder.indexOf(a._id.toString()),
		);

		// Clear chat cache (fire-and-forget)
		void clearChatCache(message.conversation.toString(), convParticipants).catch(() => {});

		// Emit to conversation room and personal rooms
		emitMessagePin(
			message.conversation.toString(),
			message._id.toString(),
			convParticipants,
			pinnedMessages,
		);

		return res.status(200).json({
			success: true,
			message: "Message pinned!",
			conversationId: message.conversation.toString(),
			pinnedMessages,
		});
	} catch (err: any) {
		logger.error("Error in pinMessage controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

/**
 * Unpin a message from a 1-on-1 conversation.
 */
export const unpinMessage = async (
	req: Request<MessageParams>,
	res: Response,
	next: NextFunction,
) => {
	const { messageId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		if (!mongoose.Types.ObjectId.isValid(messageId)) {
			return next(new BadRequestError("Invalid message ID!"));
		}

		// Find conversation that has this message pinned
		const conversation = await Conversation.findOne({
			pinnedMessages: messageId,
		});
		if (!conversation) {
			return next(new NotFoundError("Message is not pinned in any conversation!"));
		}

		// Verify the user is a participant
		const convParticipants = conversation.participants.map((p) => p.toString());
		if (!convParticipants.includes(currentUserId.toString())) {
			return next(new ForbiddenError("You are not a participant in this conversation!"));
		}

		// Remove the message from pinnedMessages
		conversation.pinnedMessages = (conversation.pinnedMessages || []).filter(
			(p) => p.toString() !== messageId,
		);
		await conversation.save();

		// The pinned banner cache must not serve the pre-unpin list.
		clearMemCacheByPrefix(`chat:pinned:${conversation._id.toString()}`);
		void deleteCache(`chat:pinned:${conversation._id.toString()}`).catch(() => {});

		// Fetch remaining pinned messages
		// Order by pin time — newest pin is LAST in the array, FIRST in the banner.
		const pinnedMessages =
			conversation.pinnedMessages.length > 0
				? await Message.find({
						_id: { $in: conversation.pinnedMessages },
					})
						.populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
						.lean()
				: [];
		const pinOrder = (conversation.pinnedMessages || []).map((p) =>
			p.toString(),
		);
		pinnedMessages.sort(
			(a, b) =>
				pinOrder.indexOf(b._id.toString()) -
				pinOrder.indexOf(a._id.toString()),
		);

		// Clear chat cache (fire-and-forget)
		void clearChatCache(conversation._id.toString(), convParticipants).catch(() => {});

		// Emit to conversation room and personal rooms
		emitMessageUnpin(
			conversation._id.toString(),
			messageId,
			convParticipants,
			pinnedMessages,
		);

		return res.status(200).json({
			success: true,
			message: "Message unpinned!",
			conversationId: conversation._id.toString(),
			pinnedMessages,
		});
	} catch (err: any) {
		logger.error("Error in unpinMessage controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

/**
 * Get pinned messages for a conversation.
 */
export const getPinnedMessages = async (
	req: Request<ConversationParams>,
	res: Response,
	next: NextFunction,
) => {
	const { conversationId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		if (!mongoose.Types.ObjectId.isValid(conversationId)) {
			return next(new BadRequestError("Invalid conversation ID!"));
		}

		const conversation = await Conversation.findById(conversationId);
		if (!conversation) {
			return next(new NotFoundError("Conversation not found!"));
		}

		// Privacy gate — mirrors getMessages: only conversation participants
		// may read the pinned list (it exposes message text + sender info).
		if (
			!conversation.participants
				.map((id: any) => id.toString())
				.includes(currentUserId.toString())
		) {
			return next(
				new ForbiddenError(
					"You are not authorized to access this conversation!",
				),
			);
		}		const pinnedMsgIds = conversation.pinnedMessages || [];

		// Short-lived cache (60s) — the pinned banner is fetched on every
		// conversation open; caching the (usually empty) list skips the DB
		// round trip. Evicted by pin/unpin below, and a stale entry can never
		// outlive the TTL anyway.
		const cacheKey = `chat:pinned:${conversationId}`;
		const memPinned = getMemCache(cacheKey);
		if (memPinned) return res.status(200).json(memPinned);
		try {
			const cached = await getCache(cacheKey);
			if (cached) return res.status(200).json(cached);
		} catch (err: any) {
			logger.error("Cache error in getPinnedMessages", {
				error: err.message,
			});
		}

		// Order by pin time — newest pin is LAST in the array, FIRST in the banner.
		let pinnedMessages: any[] = [];
		if (pinnedMsgIds.length > 0) {
			pinnedMessages = await Message.find({
				_id: { $in: pinnedMsgIds },
				isDeleted: { $ne: true },
				deletedFor: { $nin: [currentUserId] },
			})
				.populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
				.lean();
			const pinOrder = (pinnedMsgIds || []).map((p) => p.toString());
			pinnedMessages.sort(
				(a, b) =>
					pinOrder.indexOf(b._id.toString()) -
					pinOrder.indexOf(a._id.toString()),
			);
		}

		const responseData = {
			success: true,
			message: "No pinned messages!",
			pinnedMessages,
		};
		setMemCache(cacheKey, responseData, 8);
		try {
			await setCache(cacheKey, responseData, 60);
		} catch (cacheErr: any) {
			logger.error("Cache set error in getPinnedMessages", {
				error: cacheErr.message,
			});
		}
		return res.status(200).json(responseData);
	} catch (err: any) {
		logger.error("Error in getPinnedMessages controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};
