import mongoose from "mongoose";
import type { Request, Response, NextFunction } from "express";
import { Community } from "../models/community.model";
import { CommunityMessage } from "../models/communityMessage.model";
import Notification from "../models/notification.model";
import { EmailPreference } from "../models/emailPreference.model";
import { User } from "../models/user.model";
import {
	BadRequestError,
	NotFoundError,
	UnauthorizedError,
	ForbiddenError,
	AppError,
} from "../utilities/errors";
import { logger } from "../utilities/logger";
import { extractMentions } from "../utilities/notification";
import { sanitizePlainText } from "../configs/sanitize";
import cloudinary from "../configs/cloudinary";	import {
	getIO,
	isUserOnline,
	emitCommunityPresence,
	logUserRealtimeEvent,
} from "../configs/socket";
import { deleteCache, getCache, setCache, clearByPattern } from "../configs/cache";
import { getMemCache, setMemCache } from "../utilities/chatCache";
import { getBlockedUserIds } from "../utilities/blockCheck";
import { invalidateRecipientNotificationCaches } from "../utilities/notification";
import { generateToken } from "../services/livekitService";
import { checkBadgesAndNotify } from "../services/badgeService";
import { sendPushToUser, attachmentPushLabel } from "../services/pushService";
import { cleanupMedia } from "../services/mediaCleanupService";
import {
	getSearchCache,
	setSearchCache,
	clearSearchCacheForTarget,
} from "../utilities/searchCache";
import { enqueueCommunityMessageNotifications } from "../configs/queue";
import { AdminAuditLog } from "../models/adminAuditLog.model";

type CommunityParams = {
	communityId: string;
};

type MessageParams = {
	messageId: string;
};

type RoomParams = {
	communityId: string;
	roomId: string;
};

/**
 * Shared helper — the current user's role in a community.
 *
 * Hierarchy: creator > admin > moderator > member. The creator's membership
 * entry carries role "creator". Legacy communities (created before roles
 * existed) may have an `admins` array whose ids aren't reflected in
 * members[].role — those are treated as "admin" for backward compatibility.
 */
const getMemberRole = (community: any, userId: string): string => {
	const uid = userId?.toString();
	if (!uid) return "member";
	if (community.creator?.toString() === uid) return "creator";
	const legacyAdmin = (community.admins || []).some(
		(a: any) => a.toString() === uid,
	);
	const entry = (community.members || []).find(
		(m: any) => m.user?.toString() === uid,
	);
	if (entry?.role) return entry.role;
	return legacyAdmin ? "admin" : "member";
};

/** creator + admins (community managers: settings, toggles, rooms, invites) */
const isCommunityManager = (community: any, userId: string): boolean =>
	["creator", "admin"].includes(getMemberRole(community, userId));

/** creator + admins + moderators (moderation powers: delete, kick, requests) */
const isCommunityModerator = (community: any, userId: string): boolean =>
	["creator", "admin", "moderator"].includes(
		getMemberRole(community, userId),
	);

/** Is the user a member at all? (fallback for communities without roles) */
const isCommunityMember = (community: any, userId: string): boolean =>
	community.members.some(
		(m: any) => m.user?.toString() === userId?.toString(),
	);

/**
 * Shared helper — hide a poll's vote counts from a viewer who isn't allowed
 * to see them yet (poll.hideResults):
 *   - "vote": counts stay hidden until THIS viewer casts their own vote.
 *   - "end": counts stay hidden until the poll's endsAt passes.
 * The voter arrays are zeroed but the option text stays — the client shows
 * "Vote to see results" / "Results after the poll ends" instead of counts.
 * Idempotent: applied on read responses AND on the broadcast emit, so a
 * viewer on another device never receives counts they shouldn't see.
 */
const maskPollForViewer = (message: any, viewerId?: string): void => {
	const poll = message?.poll;
	if (!poll || !poll.options || !poll.options.length) return;
	if (!poll.hideResults) return;

	const ended =
		!!poll.endsAt && new Date(poll.endsAt).getTime() < Date.now();
	if (poll.hideResults === "end" && !ended) {
		poll.options.forEach((o: any) => {
			o.voters = [];
		});
		return;
	}
	if (poll.hideResults === "vote" && !ended) {
		const viewerIdStr = viewerId?.toString();
		const hasVoted = poll.options.some((o: any) =>
			(o.voters || []).some((v: any) => v.toString() === viewerIdStr),
		);
		if (!hasVoted) {
			poll.options.forEach((o: any) => {
				o.voters = [];
			});
		}
	}
};

/**
 * Shared helper — is the current user a creator or admin of the community?
 * Used by room management (and consistent with removeMemberFromCommunity).
 */
const isCommunityAdmin = (community: any, userId: string): boolean =>
	isCommunityManager(community, userId);

/**
 * Shared helper — add a user to a community (used by joinCommunity for public
 * communities, approveJoinRequest, and joinViaInvite). Handles membership
 * push, count, cache invalidation, and the rejoin-history clear so every join
 * path behaves identically. Returns the saved community.
 */
const addMemberToCommunity = async (
	community: any,
	userId: any,
) => {
	const userIdStr = userId.toString();
	community.members.push({ user: userId, joinedAt: new Date(), role: "member" });
	community.memberCount = community.members.length;
	// Achievement badges (fire-and-forget)
	checkBadgesAndNotify(userIdStr, "community_join").catch(() => {});
	// A stale pending request (e.g. user requested, then joined via invite)
	// must not linger.
	community.joinRequests = (community.joinRequests || []).filter(
		(r: any) => r.user.toString() !== userIdStr,
	);
	await community.save();

	// Invalidate the socket presence membership cache so the user's newly
	// joined community is included in presence broadcasts immediately.
	deleteCache(`user:communities:${userIdStr}`).catch(() => {});
	// The user's browse-directory copy carries isMember/pendingRequest flags
	// — it must not serve a stale "Join" button right after joining.
	clearByPattern(`communities:browse:${userIdStr}:*`).catch(() => {});

	// ── Rejoin handling: only see messages sent after this join ──
	// If the user has left this community before (their ID exists in any
	// message's clearedFor from the leave-time bulk update), hide every
	// message created before now so they start with a clean chat history.
	const hasLeftBefore = await CommunityMessage.exists({
		community: community._id,
		$or: [{ clearedFor: userId }, { deletedFor: userId }],
	});
	if (hasLeftBefore) {
		await CommunityMessage.updateMany(
			{ community: community._id, createdAt: { $lt: new Date() } },
			{ $addToSet: { clearedFor: userId } },
		);
	}
	return community;
};

/**
 * Shared helper — resolve a pending join request (approve or reject).
 * Emits a socket event so requesters and admins update live.
 */
const resolveJoinRequest = (
	community: any,
	userIdStr: string,
	status: "approved" | "rejected",
) => {
	community.joinRequests = (community.joinRequests || []).filter(
		(r: any) => r.user.toString() !== userIdStr,
	) as any;
	const io = getIO();
	io.to(`community:${community._id}`).emit("community:join-request-resolved", {
		communityId: community._id,
		userId: userIdStr,
		status,
	});
};

/**
 * Shared helper — record a NON-message action on the community so the list
 * preview shows it (e.g. "Name pinned a message"). Only surfaces in the list
 * when there's no newer message; sendCommunityMessage resets it to null.
 */
const recordCommunityAction = async (
	communityId: string,
	action: {
		type: "reaction" | "pin" | "unpin" | "call" | "message_edit";
		emoji?: string;
		callType?: "audio" | "video";
		callStatus?: "started" | "ended";
		messageId?: mongoose.Types.ObjectId | string;
		messageSenderId?: mongoose.Types.ObjectId | string;
		actor?: { _id: string; fullName?: string; username?: string };
	},
) => {
	try {
		await Community.findByIdAndUpdate(communityId, {
			$set: {
				lastAction: {
					type: action.type,
					emoji: action.emoji || "",
					callType: action.callType || "",
					callStatus: action.callStatus || "",
					messageId: action.messageId || null,
					messageSenderId: action.messageSenderId || null,
					actor: action.actor || null,
					createdAt: new Date(),
				},
			},
		});
	} catch (err: any) {
		logger.error("Failed to record community lastAction", {
			error: err.message,
		});
	}
};

// ─── Communities ───────────────────────────────────────────────────

/**
 * Create a new community.
 * POST /api/communities
 */	export const createCommunity = async (
	req: Request,
	res: Response,
	next: NextFunction,
) => {
	const {
		name,
		description,
		allowAudioCalls,
		allowVideoCalls,
		messagingEnabled,
		privacy,
	} = req.body;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		if (!name || typeof name !== "string" || !name.trim()) {
			return next(new BadRequestError("Community name is required!"));
		}

		if (name.trim().length > 50) {
			return next(new BadRequestError("Community name cannot exceed 50 characters!"));
		}

		// Handle optional image upload
		let image = { url: "", public_id: "" };
		if (req.file) {
			image = {
				url: (req.file as any).path,
				public_id: (req.file as any).filename,
			};
		}

		// Privacy chosen by the creator at creation time (public = anyone joins
		// instantly, private = invite link or admin-approved join request).
		const communityPrivacy =
			privacy === "private" ? "private" : "public";

		const community = new Community({
			name: name.trim(),
			description: description?.trim() || "",
			image,
			creator: currentUserId,
			privacy: communityPrivacy,
			members: [
				{ user: currentUserId, joinedAt: new Date(), role: "creator" },
			],
			memberCount: 1,
			// Every community starts with the default "general" channel.
			rooms: [{ name: "general", createdBy: currentUserId }],
			// Respect explicit call/messaging preferences from the client
			// (the settings page toggles these after creation, and the create
			// form may pass them too). Falls back to schema defaults otherwise.
			audioCallEnabled:
				typeof allowAudioCalls === "boolean"
					? allowAudioCalls
					: undefined,
			videoCallEnabled:
				typeof allowVideoCalls === "boolean"
					? allowVideoCalls
					: undefined,
			messagingEnabled:
				typeof messagingEnabled === "boolean"
					? messagingEnabled
					: undefined,
		});

		await community.save();

		// A new community changes the discover directory + the creator's list
		// — never serve the pre-create cached copies.
		clearByPattern("communities:browse:*").catch(() => {});
		deleteCache(`user:communities:${currentUserId.toString()}`).catch(() => {});

	// Achievement badges (fire-and-forget): creator badge
	checkBadgesAndNotify(currentUserId.toString(), "community_created").catch(() => {});

		const populated = await Community.findById(community._id)
			.populate("creator", "username fullName profilePic isVerified statusText waitlistPerk")
			.populate("members.user", "username fullName profilePic isVerified statusText waitlistPerk")
			.lean();

		// Real-time propagation: the creator's OTHER devices (same account,
		// separate sessions) must see the new community in "My Communities"
		// instantly — not after a reload or the 30s refresh. Public
		// communities also broadcast to everyone so the discover directory
		// updates live on every device.
		const io = getIO();
		io.to(`user:${currentUserId.toString()}`).emit("community:created", {
			community: { ...populated, isMember: true },
		});
		// Backfill log for the creator's other devices — a community created
		// while the phone tab was backgrounded must appear on reconnect.
		void logUserRealtimeEvent(currentUserId.toString(), "community:created", {
			community: { ...populated, isMember: true },
		});
		if (communityPrivacy === "public") {
			io.emit("community:created", {
				community: { ...populated, isMember: false },
			});
		}

		return res.status(201).json({
			success: true,
			message: "Community created successfully!",
			community: { ...populated, isMember: true },
		});
	} catch (err: any) {
		logger.error("Error in createCommunity controller", {
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
 * Fetch a community's pinned messages scoped to ONE room (null = general).
 *
 * Pins are stored per-community in `community.pinnedMessages` (a flat array
 * of message ids), but each pinned message belongs to exactly one room via
 * its `room` field. Without this filter every room showed every pin — a pin
 * made in #gaming leaked into #general. Returns newest-pin-first order.
 */
const getRoomPinnedMessages = async (
	community: any,
	room: string | null,
	currentUserId: string,
) => {
	const roomStr = room ? String(room) : null;
	const pinnedMessages = await CommunityMessage.find({
		_id: { $in: community.pinnedMessages || [] },
		isDeleted: { $ne: true },
		clearedFor: { $nin: [currentUserId] },
	})
		.populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
		.populate({
			path: "replyTo",
			select: "sender text attachments createdAt",
			populate: {
				path: "sender",
				select: "username fullName profilePic isVerified statusText waitlistPerk",
			},
		})
		.lean();

	// Only pins whose message belongs to the requested room (general = null).
	const scoped = pinnedMessages.filter((m: any) => {
		const mRoom = m.room ? m.room.toString() : null;
		return mRoom === roomStr;
	});

	// Order by PIN TIME — newest pin is last in the stored array, first shown.
	const pinOrder = (community.pinnedMessages || []).map((p: any) =>
		p.toString(),
	);
	scoped.sort(
		(a: any, b: any) =>
			pinOrder.indexOf(b._id.toString()) -
			pinOrder.indexOf(a._id.toString()),
	);
	return scoped;
};

export const pinCommunityMessage = async (
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

		const message = await CommunityMessage.findById(messageId);
		if (!message) {
			return next(new NotFoundError("Message not found!"));
		}

		if (message.isDeleted) {
			return next(new BadRequestError("Cannot pin a deleted message!"));
		}

		const communityId = message.community.toString();
		const community = await Community.findById(communityId);
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}

		// Any member may pin (matches the client UI, which offers Pin to all
		// members — previously only the creator could pin, so every other
		// member's pin silently 403'd).
		const userIdStr = currentUserId.toString();
		const isMember = community.members.some(
			(m) => m.user?.toString() === userIdStr,
		);
		if (!isMember) {
			return next(
				new ForbiddenError("Only community members can pin messages!"),
			);
		}

		// Check if already pinned
		const alreadyPinned = community.pinnedMessages.some(
			(p) => p.toString() === messageId,
		);
		if (alreadyPinned) {
			return res.status(200).json({
				success: true,
				message: "Message is already pinned!",
			});
		}

		// The room this message belongs to (null = general) — pins are scoped
		// per room, so the 5-pin limit applies per room, not per community.
		const messageRoom = message.room ? message.room.toString() : null;
		const roomPinned = await CommunityMessage.find({
			_id: { $in: community.pinnedMessages },
		})
			.select("room")
			.lean();
		const sameRoomPinIds = new Set(
			roomPinned
				.filter((m: any) => {
					const mRoom = m.room ? m.room.toString() : null;
					return mRoom === messageRoom;
				})
				.map((m: any) => m._id.toString()),
		);
		// Limit 5 pins per room — evict the OLDEST pin in THIS room.
		if (sameRoomPinIds.size >= 5) {
			const oldestInRoom = community.pinnedMessages.find((p: any) =>
				sameRoomPinIds.has(p.toString()),
			);
			if (oldestInRoom) {
				community.pinnedMessages = community.pinnedMessages.filter(
					(p: any) => p.toString() !== oldestInRoom.toString(),
				);
			}
		}

		community.pinnedMessages.push(message._id);
		await community.save();

		// Record the pin as the community's last action so the list preview
		// shows "Name pinned a message" until the next message arrives.
		await recordCommunityAction(communityId, {
			type: "pin",
			messageId: message._id,
			messageSenderId: message.sender,
			actor: {
				_id: currentUserId.toString(),
				fullName: (req.user as any)?.fullName || "",
				username: (req.user as any)?.username || "",
			},
		});

		// Room-scoped pinned list — only pins from THIS room (the leak fix).
		const pinnedMessages = await getRoomPinnedMessages(
			community,
			messageRoom,
			currentUserId.toString(),
		);

		const io = getIO();
		io.to(`community:${communityId}`).emit("community:message:pinned", {
			communityId,
			messageId,
			room: messageRoom,
			messageSenderId: message.sender,
			actor: {
				_id: currentUserId,
				fullName: (req.user as any)?.fullName || "",
				username: (req.user as any)?.username || "",
			},
			pinnedMessages,
		});

		return res.status(200).json({
			success: true,
			message: "Message pinned!",
			room: messageRoom,
			pinnedMessages,
		});
	} catch (err: any) {
		logger.error("Error in pinCommunityMessage controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

export const unpinCommunityMessage = async (
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

		// Determine which room the pinned message belongs to (null = general)
		// so the returned list is scoped to that room.
		const pinnedMessage = await CommunityMessage.findById(messageId)
			.select("room")
			.lean();
		const messageRoom = pinnedMessage?.room
			? pinnedMessage.room.toString()
			: null;

		const community = await Community.findOne({
			pinnedMessages: messageId,
		});
		if (!community) {
			return next(new NotFoundError("Community with pinned message not found!"));
		}

		// Any member may unpin (mirrors pinCommunityMessage — the creator-only
		// restriction made unpinning impossible for everyone but the creator).
		const userIdStr = currentUserId.toString();
		const isMember = community.members.some(
			(m) => m.user?.toString() === userIdStr,
		);
		if (!isMember) {
			return next(
				new ForbiddenError("Only community members can unpin messages!"),
			);
		}

		community.pinnedMessages = community.pinnedMessages.filter(
			(p) => p.toString() !== messageId,
		);
		await community.save();

		const communityId = community._id.toString();

		// Record the unpin so the list preview shows "Name unpinned a message".
		await recordCommunityAction(communityId, {
			type: "unpin",
			messageId,
			actor: {
				_id: currentUserId.toString(),
				fullName: (req.user as any)?.fullName || "",
				username: (req.user as any)?.username || "",
			},
		});

		// Room-scoped pinned list — only pins from THIS room (the leak fix).
		const pinnedMessages = await getRoomPinnedMessages(
			community,
			messageRoom,
			currentUserId.toString(),
		);

		const io = getIO();
		io.to(`community:${communityId}`).emit("community:message:unpinned", {
			communityId,
			messageId,
			room: messageRoom,
			actor: {
				_id: currentUserId,
				fullName: (req.user as any)?.fullName || "",
				username: (req.user as any)?.username || "",
			},
			pinnedMessages,
		});

		return res.status(200).json({
			success: true,
			message: "Message unpinned!",
			room: messageRoom,
			pinnedMessages,
		});
	} catch (err: any) {
		logger.error("Error in unpinCommunityMessage controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

export const getPinnedMessages = async (
	req: Request<CommunityParams>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}

		const community = await Community.findById(communityId);
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}

		// Privacy gate — mirrors the community messaging endpoints: only
		// members may read the pinned list (it exposes message text + sender
		// info). Non-members get 403 instead of the pinned content.
		const isMember = (community.members || []).some(
			(m: any) =>
				m.user && m.user.toString() === currentUserId.toString(),
		);
		if (!isMember) {
			return next(new ForbiddenError("You must be a member to view pinned messages!"));
		}

		// Room filter — ?room=<id> shows only that room's pins (empty/absent =
		// the general room). Pins are per-community but each belongs to one
		// room, so without this every room showed every pin.
		const roomParam = req.query.room ? String(req.query.room) : null;

		if (community.pinnedMessages.length === 0) {
			return res.status(200).json({
				success: true,
				room: roomParam,
				pinnedMessages: [],
			});
		}

		const pinnedMessages = await getRoomPinnedMessages(
			community,
			roomParam,
			currentUserId.toString(),
		);

		return res.status(200).json({
			success: true,
			room: roomParam,
			pinnedMessages,
		});
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

export const getCommunities = async (
	req: Request,
	res: Response,
	next: NextFunction,
) => {
	const currentUserId = req.user?._id;
	const page = Math.max(1, parseInt(req.query.page as string) || 1);
	const limit = Math.min(20, Math.max(1, parseInt(req.query.limit as string) || 10));
	const skip = (page - 1) * limit;		try {
		// Private communities are invisible to non-members in the public
		// directory — they can only be found via an invite link or a direct
		// id lookup (getCommunity). Members still see them here.
		const userIdStr = currentUserId?.toString();
		const filter: any = userIdStr
			? {
					$or: [
						{ privacy: { $ne: "private" } },
						{ "members.user": currentUserId },
					],
				}
			: { privacy: { $ne: "private" } };

		// Per-user (membership flags in the payload) + per-page cache. Same
		// mem-first/Redis-second pattern as the chat hot path; evicted by
		// community create/update/delete (clearByPattern below).
		const cacheKey = `communities:browse:${userIdStr || "anon"}:${page}:${limit}`;
		const memCachedBrowse = getMemCache(cacheKey);
		if (memCachedBrowse) {
			return res.status(200).json(memCachedBrowse);
		}
		const cachedBrowse = await getCache<{
			success: boolean;
			communities: any[];
			total: number;
			page: number;
			totalPages: number;
		}>(cacheKey);
		if (cachedBrowse) {
			return res.status(200).json(cachedBrowse);
		}

		// NO members.user populate — the directory cards only need the creator
		// + memberCount, and populating every member of every listed community
		// (tens of thousands of user docs on a busy instance) made this
		// endpoint the slowest in the app. Membership is computed from the raw
		// ObjectIds, and the arrays are stripped from the payload below.
		const communities = await Community.find(filter)
			.populate("creator", "username fullName profilePic isVerified statusText waitlistPerk")
			.sort({ createdAt: -1 })
			.skip(skip)
			.limit(limit)
			.lean();

		const total = await Community.countDocuments(filter);

		// For each community, check if the current user is a member
		const communitiesWithMembership = communities.map((c: any) => {
			const isMember = currentUserId
				? (c.members || []).some(
					(m: any) =>
						m?.user?.toString?.() === currentUserId.toString(),
				)
				: false;
			const pendingRequest = currentUserId
				? (c.joinRequests || []).some(
						(r: any) => r?.user?.toString?.() === userIdStr,
					)
				: false;
			// Keep raw join requests + member ObjectIds out of directory
			// payloads — the list UI only needs memberCount, and shipping every
			// member id of every community is what made this endpoint heavy.
			const { joinRequests, members, ...rest } = c;
			return { ...rest, isMember, pendingRequest };
		});

		const responseData = {
			success: true,
			communities: communitiesWithMembership,
			total,
			page,
			totalPages: Math.ceil(total / limit),
		};

		setMemCache(cacheKey, responseData, 8);
		try {
			await setCache(cacheKey, responseData, 30);
		} catch (err: any) {
			logger.error(`Cache set error in getCommunities!`, { error: err.message });
		}

		return res.status(200).json(responseData);
	} catch (err: any) {
		logger.error("Error in getCommunities controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

export const getCommunity = async (
	req: Request<CommunityParams>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}

		const community = await Community.findById(communityId)
			.populate("creator", "username fullName profilePic isVerified statusText waitlistPerk")
			.populate("members.user", "username fullName profilePic isVerified statusText waitlistPerk")
			.lean();

		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}

		const isMember = currentUserId
			? (community as any).members?.some(
				(m: any) => m.user?._id?.toString() === currentUserId.toString(),
			) || false
			: false;

		const userIdStr = currentUserId?.toString();
		const pendingRequest = userIdStr
			? (community as any).joinRequests?.some(
					(r: any) => r.user?._id?.toString() === userIdStr ||
						r.user?.toString?.() === userIdStr,
				) || false
			: false;
		const userRole = isMember && userIdStr
			? getMemberRole(community as any, userIdStr)
			: null;

		// Non-managers shouldn't receive the raw join-request list.
		const communityOut = {
			...(community as any),
			isMember,
			pendingRequest,
			userRole,
		};
		if (
			!userIdStr ||
			!isCommunityManager(community as any, userIdStr)
		) {
			communityOut.joinRequests = undefined;
		}

		return res.status(200).json({
			success: true,
			community: communityOut,
		});
	} catch (err: any) {
		logger.error("Error in getCommunity controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

export const getMyCommunities = async (
	req: Request,
	res: Response,
	next: NextFunction,
) => {
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		// Fast in-memory layer in front of Redis — the list is re-fetched on
		// every tab switch / reload, and each miss runs a shared-Atlas query.
		// Key matches the existing invalidation (join/leave call
		// deleteCache(`user:communities:${userId}`)). Join/leave also emits a
		// socket member-count event the client applies live, so the short TTL
		// can never serve stale membership for long.
		const cacheKey = `user:communities:${currentUserId.toString()}`;
		const memCached = getMemCache(cacheKey);
		if (memCached) {
			return res.status(200).json(memCached);
		}
		const cached = await getCache<{
			success: boolean;
			communities: any[];
		}>(cacheKey);
		if (cached) {
			return res.status(200).json(cached);
		}

		const communities = await Community.find({ 'members.user': currentUserId })
			.populate("creator", "username fullName profilePic isVerified statusText waitlistPerk")
			.sort({ updatedAt: -1 })
			.lean();

		// Attach the per-user muted flag so the "My Communities" list can show
		// a muted indicator without an extra round-trip per community.
		let mutedCommunityIds = new Set<string>();
		try {
			const mutedDocs = await User.findById(currentUserId)
				.select("mutedCommunities")
				.lean();
			(mutedDocs?.mutedCommunities || []).forEach((m: any) =>
				mutedCommunityIds.add(m.community.toString()),
			);
		} catch (muteErr: any) {
			logger.error("Muted-community fetch error in getMyCommunities", {
				error: muteErr.message,
			});
		}

		const responseData = {
			success: true,
			communities: communities.map((c: any) => {
				// Drop the raw membership + join-request arrays from the payload
				// — the list UI only needs memberCount, and shipping every
				// member ObjectId of every community is what made this endpoint
				// heavy (opening a community fetches the full doc separately).
				const { members, joinRequests, ...rest } = c;
				return {
					...rest,
					isMember: true,
					muted: mutedCommunityIds.has(c._id.toString()),
				};
			}),
		};

		setMemCache(cacheKey, responseData, 8);
		try {
			await setCache(cacheKey, responseData, 30);
		} catch (err: any) {
			logger.error(`Cache set error in getMyCommunities!`, { error: err.message });
		}

		return res.status(200).json(responseData);
	} catch (err: any) {
		logger.error("Error in getMyCommunities controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

// ─── Get community members (with join dates) ──────────────────────

export const getCommunityMembers = async (
	req: Request<CommunityParams>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}

		const community = await Community.findById(communityId)
			.populate("members.user", "username fullName profilePic isVerified statusText waitlistPerk")
			.lean();

		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}

		// Verify user is a member
		const isMember = (community as any).members?.some(
			(m: any) => m.user?._id?.toString() === currentUserId.toString(),
		);

		if (!isMember) {
			return next(
				new ForbiddenError("You must be a member to see the member list!"),
			);
		}

		const members = (community as any).members || [];
		const currentUserIdStr = currentUserId?.toString();
		const isManager = isCommunityManager(community as any, currentUserIdStr || "");

		return res.status(200).json({
			success: true,
			members: members.map((m: any) => ({
				user: m.user,
				joinedAt: m.joinedAt,
				// The role is authoritative for creators/admins; legacy member
				// entries without a stored role report as "member".
				role: m.role ||
					(community.creator?._id?.toString() === m.user?._id?.toString()
						? "creator"
						: "member"),
			})),
			// Managers get the role map so the client can render badges and
			// decide what actions to show (promote/demote/kick).
			canManage: isManager,
		});
	} catch (err: any) {
		logger.error("Error in getCommunityMembers controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

export const joinCommunity = async (
	req: Request<CommunityParams>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}

		const community = await Community.findById(communityId);
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}

		const userIdStr = currentUserId.toString();

		// Banned users cannot (re-)join — even via invite link or after the
		// ban was issued while they were a member (they're removed from
		// `members` on ban, so the membership check below would pass them).
		if (
			(community.bannedUsers || []).some(
				(b: any) => b.user.toString() === userIdStr,
			)
		) {
			return next(
				new ForbiddenError(
					"You have been banned from this community!",
				),
			);
		}

		const alreadyMember = community.members.some(
			(m) => m.user.toString() === userIdStr,
		);

		if (alreadyMember) {
			return res.status(200).json({
				success: true,
				message: "You are already a member of this community!",
				isMember: true,
			});
		}

		// ── Private community: request-approval flow ──
		if (community.privacy === "private") {
			const alreadyRequested = (community.joinRequests || []).some(
				(r: any) => r.user.toString() === userIdStr,
			);
			if (alreadyRequested) {
				return res.status(200).json({
					success: true,
					message: "Join request already sent — waiting for approval!",
					pending: true,
				});
			}
			community.joinRequests.push({
				user: currentUserId,
				requestedAt: new Date(),
			});
			await community.save();
			const io = getIO();
			// Live badge for open admins (they filter by their own role).
			io.to(`community:${communityId}`).emit("community:join-request", {
				communityId,
				userId: userIdStr,
			});
			return res.status(200).json({
				success: true,
				message: "Join request sent — an admin will review it!",
				pending: true,
			});
		}

		// ── Public community: join instantly ──
		await addMemberToCommunity(community, currentUserId);

		// Join the socket room for real-time updates
		const io = getIO();
		io.to(`community:${communityId}`).emit("community:member-joined", {
			communityId,
			userId: userIdStr,
			memberCount: community.memberCount,
		});

		// Announce the new member's online status to the community room so
		// other members' green dots update immediately (they're already online).
		if (isUserOnline(userIdStr)) {
			emitCommunityPresence(communityId, userIdStr, "online");
		}

		return res.status(200).json({
			success: true,
			message: "Joined community successfully!",
			isMember: true,
			memberCount: community.memberCount,
		});
	} catch (err: any) {
		logger.error("Error in joinCommunity controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

export const leaveCommunity = async (
	req: Request<CommunityParams>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}

		const community = await Community.findById(communityId);
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}

		const userIdStr = currentUserId.toString();

		// Cannot leave if you're the creator (must delete the community instead)
		if (community.creator.toString() === userIdStr) {
			return next(
				new BadRequestError(
					"As the creator, you cannot leave the community. You can delete it instead.",
				),
			);
		}

		const wasMember = community.members.some(
			(m) => m.user.toString() === userIdStr,
		);

		if (!wasMember) {
			return res.status(200).json({
				success: true,
				message: "You are not a member of this community!",
				isMember: false,
			});
		}

		community.members = community.members.filter(
			(m) => m.user.toString() !== userIdStr,
		) as any;
		community.memberCount = community.members.length;
		await community.save();

		// Invalidate the socket presence membership cache so the left community
		// is removed from presence broadcasts immediately.
		deleteCache(`user:communities:${userIdStr}`).catch(() => {});
		// The user's browse-directory copy carries isMember/pendingRequest
		// flags — it must not serve a stale "Joined" state after leaving.
		clearByPattern(`communities:browse:${userIdStr}:*`).catch(() => {});

		// ── Clear the leaving user's chat history (per-user soft delete) ──
		// Every message in the community is marked clearedFor for this user so
		// they can no longer see any of it after leaving (or after rejoining).
		// Other members are completely unaffected — nothing is deleted globally.
		await CommunityMessage.updateMany(
			{ community: communityId },
			{ $addToSet: { clearedFor: currentUserId } },
		);

		const io = getIO();
		io.to(`community:${communityId}`).emit("community:member-left", {
			communityId,
			userId: userIdStr,
			memberCount: community.memberCount,
		});

		// Remove the leaving member from the community's online presence so
		// their green dot disappears from other members' open community chats.
		emitCommunityPresence(communityId, userIdStr, "offline");

		return res.status(200).json({
			success: true,
			message: "Left community successfully!",
			isMember: false,
			memberCount: community.memberCount,
		});
	} catch (err: any) {
		logger.error("Error in leaveCommunity controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

export const deleteCommunity = async (
	req: Request<CommunityParams>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}

		const community = await Community.findById(communityId);
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}

		if (community.creator.toString() !== currentUserId.toString()) {
			return next(
				new ForbiddenError(
					"Only the community creator can delete the community!",
				),
			);
		}

		// Delete all community messages
		await CommunityMessage.deleteMany({ community: communityId });

		// Delete the community
		await Community.findByIdAndDelete(communityId);

		// The discover directory + the creator's list must forget it.
		clearByPattern("communities:browse:*").catch(() => {});
		deleteCache(`user:communities:${currentUserId.toString()}`).catch(() => {});

		const io = getIO();
		io.to(`community:${communityId}`).emit("community:deleted", {
			communityId,
		});

		return res.status(200).json({
			success: true,
			message: "Community deleted successfully!",
		});
	} catch (err: any) {
		logger.error("Error in deleteCommunity controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

export const getCommunityMessages = async (
	req: Request<CommunityParams>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId } = req.params;
	const currentUserId = req.user?._id;
	const cursor = req.query.cursor as string;
	const limit = Math.min(Number(req.query.limit) || 30, 50);

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}

		// Verify user is a member
		const community = await Community.findById(communityId);
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}

		if (
			!community.members.some(
				(m) => m.user.toString() === currentUserId.toString(),
			)
		) {
			return next(
				new ForbiddenError(
					"You must be a member to view community messages!",
				),
			);
		}

		// Banned members are read-only — they were removed from `members` on
		// ban, but a stale session could still hold membership. Enforce here
		// so a banned user can't keep reading history.
		if (
			(community.bannedUsers || []).some(
				(b: any) => b.user.toString() === currentUserId.toString(),
			)
		) {
			return next(
				new ForbiddenError(
					"You have been banned from this community!",
				),
			);
		}

		// Build pagination query
		const query: any = {
			community: communityId,
			isDeleted: { $ne: true },
			// Hide messages the user cleared when they left the community
			// (per-user soft delete). Delete-for-me messages are returned intact
			// (with their deletedFor array) so the client can render the
			// "This message was deleted" placeholder for that user only.
			clearedFor: { $nin: [currentUserId] },
		};
		// Room (channel) scoping — a `room` query param filters to a specific
		// channel. When absent, the default "general" room is shown; its
		// messages are stored with room: null, which also covers legacy
		// messages created before rooms existed.
		const roomParam = req.query.room as string | undefined;
		if (roomParam && mongoose.Types.ObjectId.isValid(roomParam)) {
			query.room = new mongoose.Types.ObjectId(roomParam);
		} else {
			query.room = null;
		}
		if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
			query._id = { $lt: cursor };
		}

		// Fast cache layer in front of the Mongo query + blocked-list lookup —
		// the community thread is re-fetched constantly (tab switches, room
		// changes, socket-triggered refresh) and each miss costs a shared-Atlas
		// query PLUS a block-list round-trip. Mirrors the DM getMessages path;
		// mutations below evict via clearByPattern.
		const cacheKey = `community:conv:${communityId}:messages:${roomParam || "general"}:${cursor || "first"}:${limit}`;
		try {
			const cached = await getCache(cacheKey);
			if (cached) return res.status(200).json(cached);
		} catch (cacheErr: any) {
			logger.error("Cache error in getCommunityMessages", {
				error: cacheErr.message,
			});
		}

		// Blocked users must not exist for each other — exclude messages from
		// anyone with a mutual block relationship with the viewer (either
		// direction) at the QUERY level so pagination stays accurate.
		let blockedSet = new Set<string>();
		try {
			blockedSet = new Set(
				await getBlockedUserIds(currentUserId.toString()),
			);
			if (blockedSet.size > 0) {
				query.sender = { $nin: [...blockedSet] };
			}
		} catch (blockErr: any) {
			logger.error("Blocked-message filter error in getCommunityMessages", {
				error: blockErr.message,
			});
		}

		const messages = await CommunityMessage.find(query)
			.populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
			.populate({
				path: "replyTo",
				select: "sender text attachments createdAt",
				populate: { path: "sender", select: "username fullName profilePic isVerified statusText waitlistPerk" },
			})
			.sort({ _id: -1 })
			.limit(limit + 1)
			.lean();

		// Also strip replies that quote a blocked user's message — the quote
		// embeds the sender, so it must be removed even when the message
		// itself is from an allowed sender.
		for (const m of messages as any[]) {
			const replySenderId = m.replyTo?.sender?._id?.toString();
			if (replySenderId && blockedSet.has(replySenderId)) {
				m.replyTo = null;
			}
		}

		const hasMore = messages.length > limit;
		if (hasMore) {
			messages.pop();
		}

		messages.reverse();

		const nextCursor =
			hasMore && messages.length > 0 ? messages[0]!._id : null;

		// Poll privacy (hideResults): the cache is SHARED across viewers, so
		// mask per-viewer on a deep copy at response time — never before
		// caching (viewer B would inherit viewer A's masked counts).
		const maskedMessages = messages.map((m: any) => {
			if (!m?.poll?.hideResults) return m;
			const copy = JSON.parse(JSON.stringify(m));
			maskPollForViewer(copy, currentUserId?.toString());
			return copy;
		});

		const responseData = {
			success: true,
			messages: maskedMessages,
			nextCursor,
			hasMore,
		};

		// cache with short TTL (community chat changes frequently via socket)
		try {
			await setCache(cacheKey, responseData, 15);
		} catch (cacheErr: any) {
			logger.error("Cache set error in getCommunityMessages", {
				error: cacheErr.message,
			});
		}

		return res.status(200).json(responseData);
	} catch (err: any) {
		logger.error("Error in getCommunityMessages controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

export const sendCommunityMessage = async (
	req: Request<CommunityParams>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}

		// Verify user is a member
		const community = await Community.findById(communityId);
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}

		if (
			!community.members.some(
				(m) => m.user.toString() === currentUserId.toString(),
			)
		) {
			return next(
				new ForbiddenError(
					"You must be a member to send messages!",
				),
			);
		}

		// Banned members cannot send (they were also removed from `members` on
		// ban, but a stale socket/client could still try — enforce anyway).
		if (
			(community.bannedUsers || []).some(
				(b: any) => b.user.toString() === currentUserId.toString(),
			)
		) {
			return next(
				new ForbiddenError(
					"You have been banned from this community!",
				),
			);
		}

		// Check if messaging is enabled (creator can always send)
		const role = getMemberRole(community, currentUserId.toString());
		if (
			!community.messagingEnabled &&
			role !== "creator"
		) {
			return next(
				new ForbiddenError(
					"Messaging is currently disabled in this community!",
				),
			);
		}

		// Access control — who can post (creator + admins always pass):
		//   whoCanPost = "moderators" → only moderator/admin/creator
		//   whoCanPost = "admins"     → only admin/creator
		if (
			community.whoCanPost === "moderators" &&
			!isCommunityModerator(community, currentUserId.toString())
		) {
			return next(
				new ForbiddenError(
					"Only moderators and admins can send messages in this community!",
				),
			);
		}
		if (
			community.whoCanPost === "admins" &&
			!isCommunityManager(community, currentUserId.toString())
		) {
			return next(
				new ForbiddenError(
					"Only admins can send messages in this community!",
				),
			);
		}
		// Access control — who can upload media attachments (voice notes
		// count as media; the text itself is unaffected by this gate).
		if (
			community.whoCanUploadMedia &&
			community.whoCanUploadMedia !== "everyone" &&
			((req.files as any[]) || []).length > 0
		) {
			const mediaAllowed =
				community.whoCanUploadMedia === "moderators"
					? isCommunityModerator(community, currentUserId.toString())
					: isCommunityManager(community, currentUserId.toString());
			if (!mediaAllowed) {
				return next(
					new ForbiddenError(
						"You don't have permission to upload media in this community!",
					),
				);
			}
		}

		// Optional room (channel). Must belong to this community; when omitted
		// the message goes to the default "general" room (stored as null so
		// legacy messages and new general-room messages share one list).
		let room = null;
		const rawRoom = (req.body.room as string) || "";
		if (rawRoom) {
			if (!mongoose.Types.ObjectId.isValid(rawRoom)) {
				return next(new BadRequestError("Invalid room ID!"));
			}
			const roomExists = (community.rooms || []).some(
				(r: any) => r._id.toString() === rawRoom,
			);
			if (!roomExists) {
				return next(
					new BadRequestError("Room not found in this community!"),
				);
			}
			room = new mongoose.Types.ObjectId(rawRoom);
			// Announcement channels are 1-way: only moderators/admins/creator
			// can post (members are read-only). Enforced server-side — the
			// client disables the composer, but a crafted request must fail.
			const roomEntry = (community.rooms || []).find(
				(r: any) => r._id.toString() === rawRoom,
			);
			if (
				roomEntry?.type === "announcement" &&
				!isCommunityModerator(
					community,
					currentUserId.toString(),
				)
			) {
				return next(
					new ForbiddenError(
						"Only moderators and admins can post in announcement channels!",
					),
				);
			}
			// Discord-style slowmode — when the channel has slowModeSeconds > 0,
			// a member can only post once per that window. Checked against the
			// sender's most recent message in THIS room (per-user, so other
			// members aren't throttled by someone else's spam).
			const slowModeSeconds = roomEntry?.slowModeSeconds || 0;
			if (slowModeSeconds > 0) {
				const windowMs = slowModeSeconds * 1000;
				const cutoff = new Date(Date.now() - windowMs);
				const recent = await CommunityMessage.exists({
					community: communityId,
					room,
					sender: currentUserId,
					createdAt: { $gt: cutoff },
				});
				if (recent) {
					const err = new BadRequestError(
						`Slowmode is on — you can send another message in ${slowModeSeconds}s.`,
					) as any;
					// Structured retry time so the client can show a live countdown
					// and auto-retry instead of parsing the human message.
					err.retryAfterSeconds = slowModeSeconds;
					return next(err);
				}
			}
		}

		// Handle file uploads — upload to Cloudinary from memory buffer
		const uploadedFiles = (req.files as any[]) || [];
		const fileAttachments = await Promise.all(
			uploadedFiles.map(async (file) => {
				let type: "voice_note" | "image" | "gif" | "video" | "file" = "file";
				if (file.mimetype.startsWith("audio/")) {
					type = "voice_note";
				} else if (file.mimetype.startsWith("video/")) {
					type = "video";
				} else if (file.mimetype.startsWith("image/")) {
					type = file.mimetype === "image/gif" ? "gif" : "image";
				}

				// Upload to Cloudinary from buffer (memoryStorage does not provide file.path/file.filename)
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

				const attachment: any = {
					url: uploadRes.secure_url,
					public_id: uploadRes.public_id,
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

		// Parse external attachments
		let bodyAttachments: any[] = [];
		if (req.body.attachments) {
			try {
				bodyAttachments =
					typeof req.body.attachments === "string"
						? JSON.parse(req.body.attachments)
						: req.body.attachments;
			} catch {
				return next(new BadRequestError("Invalid attachments format."));
			}
		}

		const attachments = [...fileAttachments, ...bodyAttachments];

		// ── Optional poll attachment (Discord/WhatsApp-style) ───────────────
		// Users create polls from the composer. Validated strictly: 2–10
		// options, each 1–100 chars, question ≤ 200 chars, future optional
		// endsAt. Parsed BEFORE the text/attachment check below because a
		// poll-only message is a valid message (the card is the content).
		let pollData: any = null;
		if (req.body.poll) {
			let parsedPoll: any = req.body.poll;
			if (typeof parsedPoll === "string") {
				try {
					parsedPoll = JSON.parse(parsedPoll);
				} catch {
					return next(new BadRequestError("Invalid poll format!"));
				}
			}
			const question = String(parsedPoll?.question || "").trim();
			const options = Array.isArray(parsedPoll?.options)
				? parsedPoll.options
					.map((o: any) => String(o?.text ?? o ?? "").trim())
					.filter(Boolean)
				: [];
			if (!question || question.length > 200) {
				return next(
					new BadRequestError(
						"Poll question is required (max 200 characters)!",
					),
				);
			}
			if (options.length < 2 || options.length > 10) {
				return next(
					new BadRequestError(
						"A poll needs between 2 and 10 options!",
					),
				);
			}
			for (const opt of options) {
				if (opt.length > 100) {
					return next(
						new BadRequestError(
							"Poll options must be 100 characters or fewer!",
						),
					);
				}
			}
			let endsAt: Date | null = null;
			if (parsedPoll?.endsAt) {
				const parsedEnd = new Date(parsedPoll.endsAt);
				if (
					isNaN(parsedEnd.getTime()) ||
					parsedEnd.getTime() <= Date.now()
				) {
					return next(
						new BadRequestError(
							"Poll endsAt must be a future date/time!",
						),
					);
				}
				endsAt = parsedEnd;
			}
			const hideResults = ["vote", "end"].includes(
				parsedPoll?.hideResults,
			)
				? parsedPoll.hideResults
				: null;
			pollData = {
				question,
				options: options.map((text: string) => ({ text, voters: [] })),
				allowMultiple: !!parsedPoll?.allowMultiple,
				endsAt,
				hideResults,
			};
		}

		// Require text, attachments, or a poll (a poll-only message is a valid
		// Discord/WhatsApp-style message — the poll card is the content).
		if (
			(!req.body.text || !req.body.text.trim()) &&
			attachments.length === 0 &&
			!pollData
		) {
			return next(new BadRequestError("Message text or attachments are required!"));
		}

		const sanitizedText = req.body.text
			? sanitizePlainText(req.body.text)
			: "";

		// Optional scheduled send (WhatsApp/IG-style) — the message is stored
		// but NOT delivered until the future scheduledAt. No emits, no
		// notifications, no deliveredAt stamp now; the BullMQ delayed job (or
		// the 1-min cron safety net) runs deliverScheduledCommunityMessage at
		// the exact time, which does the real broadcast + fan-out.
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

		const message = new CommunityMessage({
			community: communityId,
			sender: currentUserId,
			text: sanitizedText,
			attachments,
			replyTo: req.body.replyTo || null,
			room,
			scheduledAt,
			wasScheduled: !!scheduledAt,
			poll: pollData,
		});

		await message.save();

		// ── Scheduled-send: store + return, deliver later ──────────────────
		// Persisted with scheduledAt; nothing is broadcast or notified now.
		// The BullMQ delayed job fires at scheduledAt and calls
		// deliverScheduledCommunityMessage (cron safety net as fallback).
		if (scheduledAt) {
			const { enqueueScheduledMessageDelivery } = await import(
				"../configs/queue"
			);
			void enqueueScheduledMessageDelivery(
				"community",
				message._id.toString(),
				scheduledAt,
			).catch(() => {});

			const scheduledPopulated = await CommunityMessage.findById(
				message._id,
			)
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

		// New message content changes what search would return for this
		// community — drop the cached results so the next search is fresh.
		clearSearchCacheForTarget(`comm:${communityId}`);

		// The thread cache must not serve stale history after a send — evict
		// this community's entries (mem layer clears synchronously; the Redis
		// SCAN runs in the background so the response isn't delayed).
		// Thread + media caches live under one per-community prefix — a single
		// SCAN+DEL evicts both (one fewer Upstash round-trip per send).
		clearByPattern(`community:conv:${communityId}:*`).catch(() => {});

		// Update community's updatedAt + lastMessage snapshot (so the community
		// list can show a live "last message" preview). lastAction is reset — a
		// fresh message supersedes any stale "reacted" preview.
		const firstAtt = attachments[0] || null;
		await Community.findByIdAndUpdate(communityId, {
			updatedAt: new Date(),
			lastMessage: {
				messageId: message._id,
				text: sanitizedText,
				attachmentType: firstAtt?.type || "",
				sender: {
					_id: currentUserId,
					fullName: (req.user as any)?.fullName || "",
					username: (req.user as any)?.username || "",
				},
				createdAt: new Date(),
				isDeleted: false,
			},
			lastAction: null,
		});

		// Populate sender info
		const populatedMessage = await CommunityMessage.findById(message._id)
			.populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
			.populate({
				path: "replyTo",
				select: "sender text attachments createdAt",
				populate: { path: "sender", select: "username fullName profilePic isVerified statusText waitlistPerk" },
			})
			.lean();

		// Blocked users must not exist for each other — deliver the new message
		// to each member's personal room (every authenticated socket is always
		// in their own `user:` room), skipping the sender and any member with a
		// mutual block relationship with the sender in EITHER direction. This
		// keeps blocked users from receiving each other's messages in realtime.
		const io = getIO();
		const senderIdStr = currentUserId.toString();
		let blockedForSender = new Set<string>();
		try {
			blockedForSender = new Set(
				await getBlockedUserIds(senderIdStr),
			);
		} catch (blockErr: any) {
			logger.error("Blocked-member filter error in sendCommunityMessage", {
				error: blockErr.message,
			});
		}
		// Deliver to every member's personal room — INCLUDING the sender so
		// their other devices/tabs stay in realtime sync (the client dedupes
		// by message _id, so the sending device won't show it twice). Anyone
		// with a mutual block relationship is never delivered the message.
		for (const member of community.members) {
			const memberId = member.user.toString();
			if (blockedForSender.has(memberId)) continue;
			io.to(`user:${memberId}`).emit(
				"community:message:new",
				populatedMessage,
			);
		}

		// Mark the message DELIVERED (the broadcast above is the community's
		// "delivered" — members' sockets received it). Idempotent via the
		// `deliveredAt: null` filter; drives the "Message info" panel's
		// Sent → Delivered transition. Fire-and-forget: the send path must not
		// wait on this write. Scheduled deliveries stamp it in
		// deliverScheduledCommunityMessage instead, at delivery time.
		void (async () => {
			try {
				const deliveredAt = new Date();
				const res = await CommunityMessage.updateOne(
					{ _id: message._id, deliveredAt: null },
					{ $set: { deliveredAt } },
				);
				if (res.modifiedCount > 0) {
					// Broadcast so live tabs flip the ✓ → ✓✓ transition without a
					// reload (the sender's own copy included).
					io.to(`community:${communityId}`).emit(
						"community:message:delivered",
						{
							communityId,
							messageId: message._id.toString(),
							deliveredAt,
						},
					);
				}
			} catch (markErr: any) {
				logger.error("Failed to mark community message delivered", {
					error: markErr.message,
					messageId: message._id?.toString(),
				});
			}
		})();

		// Determine message type from attachments for notification text
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

		// Members who muted this community must not receive notifications/push
		// for its messages (they still receive the message itself in the chat).
		const mutedForCommunity = new Set<string>();
		try {
			const mutedDocs = await User.find({
				"mutedCommunities.community": communityId,
			})
				.select("_id")
				.lean();
			mutedDocs.forEach((u) => mutedForCommunity.add(u._id.toString()));
		} catch (muteErr: any) {
			logger.error("Muted-member filter error in sendCommunityMessage", {
				error: muteErr.message,
			});
		}

		// @mentions — only community MEMBERS can be mentioned (Instagram/X-style).
		// Mentioned members get a specific "mention" notification instead of the
		// generic community_message one, so they're pinged for being called out
		// while everyone else gets the normal "new message" notification.
		const mentionMemberIds = community.members.map((m) => m.user.toString());
		let mentionedUserIds = sanitizedText.trim()
			? await extractMentions(sanitizedText, {
					memberUserIds: mentionMemberIds,
				}).catch(() => [] as string[])
			: [];
		// @everyone — a token-boundary @everyone pings ALL members (Discord/
		// Telegram style). It expands to the full member list so every member
		// gets the dedicated "mention" notification.
		// Token-boundary check (same rule as extractMentions) — @everyone only
		// counts at the start or after whitespace/paren, never inside an email.
		if (/(?:^|[\s(])@everyone(?:$|[^A-Za-z0-9_])/.test(sanitizedText)) {
			mentionedUserIds = [...new Set([...mentionedUserIds, ...mentionMemberIds])];
		}
		const mentionedSet = new Set(mentionedUserIds);

		// Create notifications for all other members (not the sender). Members
		// with a mutual block relationship or who muted this community are
		// excluded — they must not receive notifications, badges, or pushes.
		const otherMembers = community.members.filter(
			(m) =>
				m.user.toString() !== currentUserId.toString() &&
				!blockedForSender.has(m.user.toString()) &&
				!mutedForCommunity.has(m.user.toString())
		);

		// ── Notification fan-out (queue-first) ────────────────────────────
		// Every other member used to be looped INLINE here — each iteration
		// doing a preference check + Notification insert + cache eviction +
		// populate + socket emit + device push. In a big community that is
		// hundreds of sequential DB/HTTP operations on the send path. The
		// whole loop is now ONE job on the notifications queue and this
		// endpoint returns immediately. When BullMQ isn't configured the same
		// loop runs inline (fanoutCommunityMessageNotificationsInline) so
		// behavior is identical either way.
		const fanoutParams = {
			communityId,
			senderId: currentUserId.toString(),
			recipientIds: otherMembers.map((m) => m.user.toString()),
			mentionedUserIds: [...mentionedSet],
			messageType,
			attachments,
			sanitizedText,
			populatedMessage,
		};
		const queued = await enqueueCommunityMessageNotifications(fanoutParams);
		if (!queued) {
			// Fire-and-forget — per-recipient failures are logged inside the
			// loop and never affect the send response.
			void fanoutCommunityMessageNotificationsInline(fanoutParams);
		}

		return res.status(201).json({
			success: true,
			message: "Message sent successfully!",
			sentMessage: populatedMessage,
		});
	} catch (err: any) {
		logger.error("Error in sendCommunityMessage controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};	/**
	 * Inline community-message notification fan-out — the loop that used to
	 * run on the send request path (see sendCommunityMessage). It is ALSO the
	 * body the BullMQ notification worker executes for `community-fanout`
	 * jobs, so both paths behave identically. Per recipient: preference check,
	 * Notification insert ("mention" type when @mentioned), cache eviction,
	 * socket emit to their personal room, and a device push.
	 */
	export const fanoutCommunityMessageNotificationsInline = async (params: {
		communityId: string;
		senderId: string;
		recipientIds: string[];
		mentionedUserIds: string[];
		messageType: string;
		attachments: any[];
		sanitizedText: string;
		populatedMessage: any;
	}): Promise<void> => {
		const io = getIO();
		const {
			communityId,
			senderId,
			recipientIds,
			mentionedUserIds,
			messageType,
			attachments,
			sanitizedText,
			populatedMessage,
		} = params;
		const mentionedSet = new Set(mentionedUserIds);
		if (recipientIds.length === 0) return;

		// Batch the per-category preference lookup — ONE query for every
		// recipient instead of one findOne per member (the old loop hit the
		// DB once per user). Users without an EmailPreference doc default to
		// enabled, matching shouldNotifyCategory's semantics.
		let prefs = new Map<string, Record<string, boolean | undefined>>();
		try {
			const docs = await EmailPreference.find({ user: { $in: recipientIds } })
				.select("user notificationPrefs")
				.lean();
			for (const d of docs as any[]) {
				prefs.set(d.user.toString(), (d.notificationPrefs || {}) as Record<
					string,
					boolean | undefined
				>);
			}
		} catch (prefErr: any) {
			logger.error("Batched fan-out preference lookup failed", {
				error: prefErr.message,
			});
		}
		const CATEGORY_FOR: {
			mention: string;
			community_message: string;
		} = {
			mention: "mentions",
			community_message: "messages",
		};
		const recipientAllowed = (recipientId: string, isMentioned: boolean) =>
			prefs.get(recipientId)?.[
				CATEGORY_FOR[isMentioned ? "mention" : "community_message"]
			] !== false;

		// Sender info is already populated on the message — reuse it for every
		// socket payload + push, skipping the old findById+populate round-trip
		// per recipient.
		const senderInfo = (populatedMessage as any)?.sender || {};
		const senderName =
			senderInfo?.fullName || senderInfo?.username || "Someone";
		const senderIcon = senderInfo?.profilePic?.url || "/icon-192.png";

		for (const recipientId of recipientIds) {
			try {
				const isMentioned = mentionedSet.has(recipientId);
				// Per-category preference toggle — suppressed community messages
				// produce neither an in-app notification nor a device push.
				if (!recipientAllowed(recipientId, isMentioned)) {
					continue;
				}
				const notif = new Notification({
					recipient: recipientId,
					sender: senderId,
					type: isMentioned ? "mention" : "community_message",
					community: communityId,
					message: populatedMessage?._id,
					messageType,
				});
				await notif.save();

				// Drop the recipient's cached notifications list + unread badge
				// so the new notification appears instantly. Fire-and-forget
				// (the helper already allSettles internally) — the loop must not
				// serialize on Upstash SCAN sweeps.
				void invalidateRecipientNotificationCaches(recipientId);

				// Socket payload shaped exactly like a populated notification,
				// minus the DB round-trip.
				io.to(`user:${recipientId}`).emit("notification", {
					_id: notif._id,
					recipient: recipientId,
					sender: senderInfo,
					type: isMentioned ? "mention" : "community_message",
					community: communityId,
					message: populatedMessage?._id,
					messageType,
					createdAt: notif.createdAt,
					isRead: false,
				});

				// Send a real on-device push notification. Plain-text,
				// type-specific body ("Photo", "Voice note", "Video", "File") —
				// no emoji in push bodies. Mentioned members get a dedicated
				// "mentioned you" message instead of the generic one.
				const body = isMentioned
					? "mentioned you in a community"
					: attachmentPushLabel(attachments, sanitizedText);
				sendPushToUser(recipientId, {
					title: senderName,
					body,
					icon: senderIcon,
					tag: `orbit-community-${communityId}`,
					timestamp: new Date().toISOString(),
					data: {
						url: "/communities",
						type: isMentioned ? "mention" : "community_message",
						communityId,
						unreadCount: 0,
					},
				});
			} catch (err: any) {
				logger.error(
					"Failed to create community message notification",
					{
						error: err.message,
						recipientId,
					},
				);
			}
		}
	};

	export const editCommunityMessage = async (
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

		const { text } = req.body;
		if (!text || !text.trim()) {
			return next(new BadRequestError("Message text is required!"));
		}

		const message = await CommunityMessage.findById(messageId);
		if (!message) {
			return next(new NotFoundError("Message not found!"));
		}

		if (message.sender.toString() !== currentUserId.toString()) {
			return next(
				new ForbiddenError("You can only edit your own messages!"),
			);
		}

		// 5 minutes check. Scheduled messages anchor on their DELIVERY time
		// (deliveredAt) — the message only "exists" for members from delivery,
		// so that's when the retraction window starts.
		const editAnchor =
			message.wasScheduled && message.deliveredAt
				? message.deliveredAt
				: message.createdAt;
		const diffMs = Date.now() - editAnchor.getTime();
		const EDIT_TIME_LIMIT = 5 * 60 * 1000;
		if (diffMs > EDIT_TIME_LIMIT) {
			return next(
				new BadRequestError(
					"Message can only be edited within 5 minutes of sending!",
				),
			);
		}

		message.text = sanitizePlainText(text);
		message.isEdited = true;
		await message.save();        // The thread cache must not serve stale history after an edit.
        // Thread + media caches share one prefix — a single SCAN+DEL evicts both.
        clearByPattern(`community:conv:${message.community.toString()}:*`).catch(() => {});

		// Keep the community's last-message snapshot in sync if the edited
		// message is the one shown in the community list preview, and record
		// the edit as an action so the list shows "Name edited a message".
		try {
			const isLastMessage =
				(await Community.exists({
					_id: message.community,
					"lastMessage.messageId": message._id,
				})) !== null;
			if (isLastMessage) {
				await Community.updateOne(
					{
						_id: message.community,
						"lastMessage.messageId": message._id,
					},
					{
						$set: {
							"lastMessage.text": sanitizePlainText(text),
							"lastMessage.attachmentType":
								message.attachments?.[0]?.type || "",
						},
					},
				);
				await recordCommunityAction(message.community.toString(), {
					type: "message_edit",
					messageId: message._id,
					messageSenderId: message.sender,
					actor: {
						_id: currentUserId.toString(),
						fullName: (req.user as any)?.fullName || "",
						username: (req.user as any)?.username || "",
					},
				});
			}
		} catch (snapshotErr: any) {
			logger.error("Failed to update community lastMessage snapshot on edit", {
				error: snapshotErr.message,
			});
		}

		const populatedMessage = await CommunityMessage.findById(message._id)
			.populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
			.lean();

		const io = getIO();
		io.to(`community:${message.community.toString()}`).emit(
			"community:message:edit",
			populatedMessage,
		);

		return res.status(200).json({
			success: true,
			message: "Message edited successfully!",
			editedMessage: populatedMessage,
		});
	} catch (err: any) {
		logger.error("Error in editCommunityMessage controller", {
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
 * Deliver a scheduled community message — called by the BullMQ delayed job /
 * cron safety net at the message's scheduledAt time. The row exists with
 * scheduledAt set; this runs the same delivery as a normal send: update the
 * community's lastMessage snapshot, broadcast to the room + every member's
 * personal room (skipping blocked relationships), and clear caches.
 */
export const deliverScheduledCommunityMessage = async (
	messageId: string,
): Promise<void> => {
	try {
		const message = await CommunityMessage.findById(messageId).select(
			"_id community room sender text attachments",
		);
		if (!message || !message.community) return;

		const communityId = message.community.toString();
		const community = await Community.findById(communityId).select(
			"_id members",
		);
		if (!community) return;

		const populatedMessage = await CommunityMessage.findById(message._id)
			.populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
			.populate({
				path: "replyTo",
				select: "sender text attachments createdAt",
				populate: { path: "sender", select: "username fullName profilePic isVerified statusText waitlistPerk" },
			})
			.lean();

		// Stamp deliveredAt NOW (scheduled messages deliver later than their
		// createdAt — the panel's Delivered row must show delivery time).
		await CommunityMessage.updateOne(
			{ _id: message._id, deliveredAt: null },
			{ $set: { deliveredAt: new Date() } },
		);

		// lastMessage snapshot — same shape as sendCommunityMessage builds.
		const firstAtt = message.attachments?.[0] || null;
		await Community.findByIdAndUpdate(communityId, {
			updatedAt: new Date(),
			lastMessage: {
				messageId: message._id,
				text: message.text || "",
				attachmentType: firstAtt?.type || "",
				sender: {
					_id: message.sender,
					fullName: (message.sender as any)?.fullName || "",
					username: (message.sender as any)?.username || "",
				},
				createdAt: new Date(),
				isDeleted: false,
			},
			lastAction: null,
		});

		// Broadcast to the room + every member's personal room (blocked pairs
		// excluded), matching the live send path.
		const io = getIO();
		io.to(`community:${communityId}`).emit(
			"community:message:new",
			populatedMessage,
		);
		let blockedForSender = new Set<string>();
		try {
			blockedForSender = new Set(
				await getBlockedUserIds((message.sender as any)?.toString?.() || ""),
			);
		} catch (blockErr: any) {
			logger.error("Blocked-member filter error in deliverScheduledCommunityMessage", {
				error: blockErr.message,
			});
		}
		for (const member of community.members || []) {
			const memberId = member.user?.toString?.();
			if (!memberId || blockedForSender.has(memberId)) continue;
			io.to(`user:${memberId}`).emit(
				"community:message:new",
				populatedMessage,
			);
		}

		// Notifications + push: the schedule path skips the fan-out at
		// schedule time — it must happen at DELIVERY so members get the bell
		// row + device push exactly like a live message. Mirrors
		// sendCommunityMessage (mentions re-extracted at delivery, muted +
		// blocked members excluded, sender excluded).
		try {
			const senderIdStr = message.sender?.toString?.();

			// Members who muted this community never get notifications/push
			// for its messages (they still get the message in the chat).
			const mutedForCommunity = new Set<string>();
			try {
				const mutedDocs = await User.find({
					"mutedCommunities.community": communityId,
				})
					.select("_id")
					.lean();
				mutedDocs.forEach((u) => mutedForCommunity.add(u._id.toString()));
			} catch (muteErr: any) {
				logger.error(
					"Muted-member filter error in deliverScheduledCommunityMessage",
					{ error: muteErr.message },
				);
			}

			// @mentions re-resolved from the delivered text (only community
			// members can be mentioned; @everyone expands to all members).
			let mentionedUserIds: string[] = [];
			try {
				const memberIds = community.members.map((m: any) =>
					m.user.toString(),
				);
				mentionedUserIds = message.text?.trim()
					? await extractMentions(message.text, {
							memberUserIds: memberIds,
					  }).catch(() => [] as string[])
					: [];
				if (
					/(?:^|[\s(])@everyone(?:$|[^A-Za-z0-9_])/.test(
						message.text || "",
					)
				) {
					mentionedUserIds = [
						...new Set([
							...mentionedUserIds,
							...(community.members || []).map((m: any) =>
								m.user.toString(),
							),
						]),
					];
				}
			} catch (mentionErr: any) {
				logger.error(
					"Mention extraction failed in deliverScheduledCommunityMessage",
					{ error: mentionErr.message },
				);
			}

			const recipientIds = (community.members || [])
				.map((m: any) => m.user.toString())
				.filter(
					(id: string) =>
						id !== senderIdStr &&
						!blockedForSender.has(id) &&
						!mutedForCommunity.has(id),
				);

			if (recipientIds.length > 0) {
				// Same messageType mapping as the live send path.
				let messageType:
					| "text"
					| "photo"
					| "video"
					| "voice_note"
					| "file"
					| "gif"
					| "sticker" = "text";
				const firstAtt = (message.attachments || [])[0];
				if (firstAtt?.type === "image") messageType = "photo";
				else if (firstAtt?.type === "gif") messageType = "gif";
				else if (firstAtt?.type === "sticker") messageType = "sticker";
				else if (firstAtt?.type === "video") messageType = "video";
				else if (firstAtt?.type === "voice_note") messageType = "voice_note";
				else if (firstAtt?.type === "file") messageType = "file";

				const fanoutParams = {
					communityId,
					senderId: senderIdStr,
					recipientIds,
					mentionedUserIds: [...new Set(mentionedUserIds)],
					messageType,
					attachments: message.attachments || [],
					sanitizedText: message.text || "",
					populatedMessage,
				};
				const queued = await enqueueCommunityMessageNotifications(
					fanoutParams,
				);
				if (!queued) {
					void fanoutCommunityMessageNotificationsInline(fanoutParams);
				}
			}
		} catch (notifErr: any) {
			logger.error(
				"Scheduled community message fan-out failed",
				{ error: notifErr.message, communityId },
			);
		}

		// Caches: thread + media + search must not serve stale state.
		clearByPattern(`community:conv:${communityId}:*`).catch(() => {});
		clearSearchCacheForTarget(`comm:${communityId}`);
	} catch (err: any) {
		logger.error("Error in deliverScheduledCommunityMessage", {
			error: (err as Error).message,
		});
	}
};

export const deleteCommunityMessage = async (
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

		const message = await CommunityMessage.findById(messageId);
		if (!message) {
			return next(new NotFoundError("Message not found!"));
		}

		const community = await Community.findById(message.community);
		const isSender = message.sender.toString() === currentUserId.toString();
		// Moderators (and above) can delete ANY member's message — the
		// moderation power the creator previously held exclusively.
		const isModerator = community
			? isCommunityModerator(community, currentUserId.toString())
			: false;

		if (!isSender && !isModerator) {
			return next(
				new ForbiddenError(
					"You can only delete your own messages or messages in a community you moderate!",
				),
			);
		}

		// "Delete for everyone" is only available within 5 minutes of sending.
		// This applies to the sender deleting their OWN message — even if they
		// are also the community creator. Moderation deletes (admins/moderators
		// removing other members' messages) are unlimited.
		// Exception: a still-scheduled message (scheduledAt in the future) is a
		// cancel — no window limit.
		const isStillScheduled =
			message.scheduledAt &&
			message.scheduledAt.getTime() > Date.now();
		if (isSender && !isStillScheduled) {
			// Same delivery-anchor rule as the edit window: a delivered
			// scheduled message is retractable for 5 minutes from delivery.
			const deleteAnchor =
				message.wasScheduled && message.deliveredAt
					? message.deliveredAt
					: message.createdAt;
			const diffMs = Date.now() - deleteAnchor.getTime();
			const DELETE_TIME_LIMIT = 5 * 60 * 1000;
			if (diffMs > DELETE_TIME_LIMIT) {
				return next(
					new BadRequestError(
						"Message can only be deleted within 5 minutes of sending!",
					),
				);
			}
		}

		// Clean up Cloudinary attachments — offloaded to the BullMQ
		// media-cleanup worker when configured (inline otherwise).
		const oldAttachments = message.attachments || [];
		const deletedPublicIds = oldAttachments
			.map((att) => att.public_id)
			.filter(Boolean);
		void cleanupMedia(deletedPublicIds);

		message.isDeleted = true;
		message.text = "This message was deleted";
		message.attachments = [] as any;
		await message.save();        // The thread cache must not serve the deleted message on reload.
        // Thread + media caches share one prefix — a single SCAN+DEL evicts both.
        clearByPattern(`community:conv:${message.community.toString()}:*`).catch(() => {});

		// Keep the community list preview accurate: if the deleted message was
		// the last message, mark the snapshot as deleted. lastAction can only
		// ever point at the newest message, so unset it too.
		try {
			await Community.updateOne(
				{
					_id: message.community,
					"lastMessage.messageId": message._id,
				},
				{
					$set: {
						"lastMessage.text": "This message was deleted",
						"lastMessage.attachmentType": "",
						"lastMessage.isDeleted": true,
					},
					$unset: { lastAction: 1 },
				},
			);
		} catch (snapshotErr: any) {
			logger.error("Failed to update community lastMessage snapshot on delete", {
				error: snapshotErr.message,
			});
		}

		const io = getIO();
		io.to(`community:${message.community.toString()}`).emit(
			"community:message:delete",
			{ messageId: message._id.toString(), communityId: message.community.toString() },
		);

		return res.status(200).json({
			success: true,
			message: "Message deleted successfully!",
		});
	} catch (err: any) {
		logger.error("Error in deleteCommunityMessage controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

export const deleteCommunityMessageForMe = async (
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

		const message = await CommunityMessage.findById(messageId);
		if (!message) {
			return next(new NotFoundError("Message not found!"));
		}

		const userIdStr = currentUserId.toString();
		const alreadyDeleted = (message.deletedFor || []).some(
			(id) => id.toString() === userIdStr,
		);

		if (!alreadyDeleted) {
			message.deletedFor.push(new mongoose.Types.ObjectId(userIdStr));
			await message.save();
		}        // The thread cache must not resurrect a delete-for-me message.
        // Thread + media caches share one prefix — a single SCAN+DEL evicts both.
        clearByPattern(`community:conv:${message.community.toString()}:*`).catch(() => {});

		const io = getIO();
		io.to(`community:${message.community.toString()}`).emit(
			"community:message:delete-for-me",
			{ messageId: message._id.toString(), deletedByUserId: userIdStr },
		);

		return res.status(200).json({
			success: true,
			message: "Message deleted for you!",
		});
	} catch (err: any) {
		logger.error("Error in deleteCommunityMessageForMe controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};	/**
 * Update a community's name, description, and/or image.
 * Only the creator can update the community.
 * PUT /api/communities/:communityId
 */
export const updateCommunity = async (
	req: Request<CommunityParams>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}

		const community = await Community.findById(communityId);
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}

		// Only the creator can update
		if (community.creator.toString() !== currentUserId.toString()) {
			return next(
				new ForbiddenError(
					"Only the community creator can update the community!",
				),
			);
		}

		// Validate and update name
		const { name, description } = req.body;
		if (name !== undefined) {
			if (typeof name !== "string" || !name.trim()) {
				return next(new BadRequestError("Community name is required!"));
			}
			if (name.trim().length > 50) {
				return next(new BadRequestError("Community name cannot exceed 50 characters!"));
			}
			community.name = name.trim();
		}

		if (description !== undefined) {
			if (typeof description !== "string") {
				return next(new BadRequestError("Description must be a string!"));
			}
			if (description.length > 500) {
				return next(new BadRequestError("Description cannot exceed 500 characters!"));
			}
			community.description = description.trim();
		}

		// Handle optional image upload
		if (req.file) {
			// Delete old image from Cloudinary if it exists
			if (community.image?.public_id) {
				cloudinary.uploader
					.destroy(community.image.public_id)
					.catch((err) => {
						logger.error(
							"Failed to delete old community image from Cloudinary",
							{ error: err.message },
						);
					});
			}
			community.image = {
				url: (req.file as any).path,
				public_id: (req.file as any).filename,
			};
		}

		// Handle image removal (explicitly sent as empty string or null)
		if (req.body.removeImage === "true") {
			if (community.image?.public_id) {
				cloudinary.uploader
					.destroy(community.image.public_id)
					.catch((err) => {
						logger.error(
							"Failed to delete community image from Cloudinary",
							{ error: err.message },
						);
					});
			}
			community.image = { url: "", public_id: "" };
		}

		// Privacy + access control — settable by creator AND admins (unlike
		// name/description/image which stay creator-only). Privacy itself is
		// creator-only since it changes who can enter the community.
		if (req.body.privacy !== undefined) {
			if (!isCommunityManager(community, currentUserId.toString())) {
				return next(new ForbiddenError("Only admins can change privacy!"));
			}
			if (req.body.privacy !== "public" && req.body.privacy !== "private") {
				return next(new BadRequestError("Privacy must be public or private!"));
			}
			// Only the creator decides who can enter.
			if (community.creator.toString() !== currentUserId.toString()) {
				return next(
					new ForbiddenError(
						"Only the community creator can change privacy!",
					),
				);
			}
			community.privacy = req.body.privacy;
		}
		if (req.body.whoCanPost !== undefined) {
			if (!isCommunityManager(community, currentUserId.toString())) {
				return next(new ForbiddenError("Only admins can set post permissions!"));
			}
			if (!["everyone", "moderators", "admins"].includes(req.body.whoCanPost)) {
				return next(new BadRequestError("Invalid whoCanPost value!"));
			}
			community.whoCanPost = req.body.whoCanPost;
		}
		if (req.body.whoCanUploadMedia !== undefined) {
			if (!isCommunityManager(community, currentUserId.toString())) {
				return next(new ForbiddenError("Only admins can set media permissions!"));
			}
			if (
				!["everyone", "moderators", "admins"].includes(
					req.body.whoCanUploadMedia,
				)
			) {
				return next(new BadRequestError("Invalid whoCanUploadMedia value!"));
			}
			community.whoCanUploadMedia = req.body.whoCanUploadMedia;
		}

		// Welcome message — shown to newly-joined members (rules + intro).
		if (req.body.welcomeMessage !== undefined) {
			if (!isCommunityManager(community, currentUserId.toString())) {
				return next(
					new ForbiddenError(
						"Only admins can set the welcome message!",
					),
				);
			}
			const wm = String(req.body.welcomeMessage || "").trim();
			if (wm.length > 500) {
				return next(
					new BadRequestError(
						"Welcome message cannot exceed 500 characters!",
					),
				);
			}
			community.welcomeMessage = wm;
		}

		await community.save();

		// Name/description/image changes invalidate the discover directory.
		clearByPattern("communities:browse:*").catch(() => {});

		const populated = await Community.findById(community._id)
			.populate("creator", "username fullName profilePic isVerified statusText waitlistPerk")
			.populate("members.user", "username fullName profilePic isVerified statusText waitlistPerk")
			.lean();

		const io = getIO();
		io.to(`community:${communityId}`).emit("community:updated", {
			communityId,
			community: { ...populated, isMember: true } as any,
		});
		// The creator's other devices may not be inside the community room
		// (e.g. a settings page on the phone while the desktop tab sits on the
		// list) — push the update to the account so name/avatar/bio changes
		// propagate to every device without waiting out caches.
		io.to(`user:${currentUserId.toString()}`).emit("community:updated", {
			communityId,
			community: { ...populated, isMember: true } as any,
		});
		// Backfill log for the creator's other devices (same rationale as
		// community:created — a settings edit made elsewhere must replay).
		void logUserRealtimeEvent(currentUserId.toString(), "community:updated", {
			communityId,
			community: { ...populated, isMember: true } as any,
		});

		return res.status(200).json({
			success: true,
			message: "Community updated successfully!",
			community: { ...populated, isMember: true },
		});
	} catch (err: any) {
		logger.error("Error in updateCommunity controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

// ─── Search Community Messages ────────────────────────────────────
/**
 * Search messages within a community by text content.
 * GET /api/communities/:communityId/messages/search?q=...
 */
export const searchCommunityMessages = async (
	req: Request<CommunityParams>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId } = req.params;
	const currentUserId = req.user?._id;
	const q = (req.query.q as string || "").trim();
	const limit = Math.min(Number(req.query.limit) || 20, 50);

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}

		if (!q || q.length < 1) {
			return next(new BadRequestError("Search query is required!"));
		}

		// Verify user is a member
		const community = await Community.findById(communityId);
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}

		if (
			!community.members.some(
				(m) => m.user.toString() === currentUserId.toString(),
			)
		) {
			return next(
				new ForbiddenError(
					"You must be a member to search messages!",
				),
			);
		}

		// Escape regex special characters in the search query
		const escapedQ = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

		// Blocked users must not exist for each other — exclude messages from
		// anyone with a mutual block relationship with the searcher.
		const blockedIds = await getBlockedUserIds(currentUserId.toString());
		const searchQuery: any = {
			community: communityId,
			isDeleted: { $ne: true },
			clearedFor: { $nin: [currentUserId] },
			text: { $regex: escapedQ, $options: "i" },
		};
		// Optional room (channel) scoping — when the client searches from inside
		// a room, only that channel's messages match (mirrors getCommunityMessages).
		const searchRoom = req.query.room as string | undefined;
		if (searchRoom && mongoose.Types.ObjectId.isValid(searchRoom)) {
			searchQuery.room = new mongoose.Types.ObjectId(searchRoom);
		} else if (searchRoom) {
			// Invalid room id passed — fall back to the general room so the search
			// never returns messages from every channel unexpectedly.
			searchQuery.room = null;
		}
		if (blockedIds.length > 0) {
			searchQuery.sender = { $nin: blockedIds };
		}

		// Short-TTL in-memory cache: repeated/backspace queries resolve instantly
		// instead of hitting the (slow, free-tier) DB again.
		// NOTE: keyed per-user — the query excludes each searcher's blocked
		// users (`sender: { $nin: blockedIds }`), so a process-global key would
		// leak one user's filtered results to another. Per-user keys prevent
		// cross-user cache contamination.
		const cacheKey = `comm:${communityId}:${currentUserId}:${q}`;
		const cached = getSearchCache(cacheKey);
		if (cached) {
			return res.status(200).json(cached);
		}

		const messages = await CommunityMessage.find(searchQuery)
			.populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
			.populate({
				path: "replyTo",
				select: "sender text attachments createdAt",
				populate: { path: "sender", select: "username fullName profilePic isVerified statusText waitlistPerk" },
			})
			.sort({ createdAt: -1 })
			.limit(limit)
			.lean();

		const payload = {
			success: true,
			messages: messages.reverse(),
			total: messages.length,
		};
		setSearchCache(cacheKey, payload);

		return res.status(200).json(payload);
	} catch (err: any) {
		logger.error("Error in searchCommunityMessages controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

// ─── Admin / Creator Actions ────────────────────────────────────

/**
 * Remove a member from the community (creator/admins only).
 * POST /api/communities/:communityId/remove-member
 */
export const removeMemberFromCommunity = async (
  req: Request<CommunityParams>,
  res: Response,
  next: NextFunction,
) => {
  const { communityId } = req.params;
  const { memberId } = req.body;
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) {
      return next(new UnauthorizedError("Unauthorized!"));
    }

    if (!mongoose.Types.ObjectId.isValid(communityId)) {
      return next(new BadRequestError("Invalid community ID!"));
    }

    if (!memberId || !mongoose.Types.ObjectId.isValid(memberId)) {
      return next(new BadRequestError("Valid member ID is required!"));
    }

    const community = await Community.findById(communityId);
    if (!community) {
      return next(new NotFoundError("Community not found!"));
    }

    const userIdStr = currentUserId.toString();
    const memberIdStr = memberId.toString();

    // Role-based kick permission (hierarchy: creator > admin > moderator >
    // member). Anyone with a moderation role can kick members strictly below
    // them — you can never remove someone at or above your own level.
    const actorRole = getMemberRole(community, userIdStr);
    const targetRole = getMemberRole(community, memberIdStr);
    const ROLE_RANK: Record<string, number> = {
      member: 0,
      moderator: 1,
      admin: 2,
      creator: 3,
    };
    const actorRank = ROLE_RANK[actorRole] ?? 0;
    const targetRank = ROLE_RANK[targetRole] ?? 0;

    if (actorRank <= 0) {
      return next(
        new ForbiddenError("Only moderators can remove members!"),
      );
    }

    // Cannot remove the creator
    if (memberIdStr === community.creator.toString()) {
      return next(new BadRequestError("Cannot remove the community creator!"));
    }

    if (targetRank >= actorRank) {
      return next(
        new ForbiddenError(
          "You can't remove a member with equal or higher permissions!",
        ),
      );
    }

    // Check member exists
    const memberExists = community.members.some(
      (m) => m.user.toString() === memberIdStr,
    );

    if (!memberExists) {
      return next(new NotFoundError("Member not found in this community!"));
    }

    // Remove member (+ any legacy admins-array entry and pending request)
    community.members = community.members.filter(
      (m) => m.user.toString() !== memberIdStr,
    ) as any;
    community.admins = (community.admins || []).filter(
      (a: any) => a.toString() !== memberIdStr,
    );
    community.joinRequests = (community.joinRequests || []).filter(
      (r: any) => r.user.toString() !== memberIdStr,
    ) as any;
    community.memberCount = community.members.length;
    await community.save();

    // The kicked member's "My Communities" list must not serve the stale
    // cached copy (30s Redis TTL would otherwise hide the removal).
    deleteCache(`user:communities:${memberIdStr}`).catch(() => {});

    // Audit trail — the mod action log (who kicked whom, when).
    try {
      await AdminAuditLog.create({
        actor: currentUserId,
        actorName: (req.user as any)?.username || "",
        action: "community_kick_member",
        targetType: "community",
        targetId: communityId,
        targetName: community.name,
        details: { memberId: memberIdStr, communityId },
      });
    } catch (auditErr: any) {
      logger.error("Audit log write failed (community kick)", {
        error: auditErr.message,
      });
    }

    const io = getIO();
    io.to(`community:${communityId}`).emit("community:member-removed", {
      communityId,
      removedUserId: memberIdStr,
      memberCount: community.memberCount,
    });

    return res.status(200).json({
      success: true,
      message: "Member removed successfully!",
      memberCount: community.memberCount,
    });
  } catch (err: any) {
    logger.error("Error in removeMemberFromCommunity controller", {
      error: err.message,
    });
    return next(
      err instanceof AppError
        ? err
        : new AppError("Internal server error!"),
    );
  }
};

// ─── Join requests (private communities) ──────────────────────────

/**
 * List pending join requests (moderators and above).
 * GET /api/communities/:communityId/join-requests
 */
export const getJoinRequests = async (
	req: Request<CommunityParams>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}
		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}
		const community = await Community.findById(communityId)
			.populate(
				"joinRequests.user",
				"username fullName profilePic isVerified statusText waitlistPerk",
			)
			.lean();
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}
		if (!isCommunityModerator(community, currentUserId.toString())) {
			return next(
				new ForbiddenError(
					"Only moderators can view join requests!",
				),
			);
		}
		const requests = ((community as any).joinRequests || []).slice();
		return res.status(200).json({
			success: true,
			requests: requests.sort(
				(a: any, b: any) =>
					new Date(b.requestedAt).getTime() -
					new Date(a.requestedAt).getTime(),
			),
		});
	} catch (err: any) {
		logger.error("Error in getJoinRequests controller", {
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
 * Approve a join request (moderators and above).
 * POST /api/communities/:communityId/join-requests/:userId/approve
 */
export const approveJoinRequest = async (
	req: Request<CommunityParams & { userId: string }>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId, userId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}
		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}
		if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
			return next(new BadRequestError("Valid user ID is required!"));
		}
		const community = await Community.findById(communityId);
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}
		if (!isCommunityModerator(community, currentUserId.toString())) {
			return next(
				new ForbiddenError("Only moderators can approve join requests!"),
			);
		}
		const userIdStr = userId.toString();
		const requestExists = (community.joinRequests || []).some(
			(r: any) => r.user.toString() === userIdStr,
		);
		if (!requestExists) {
			return next(new NotFoundError("No pending request from this user!"));
		}
		if (isCommunityMember(community, userIdStr)) {
			// Already a member — just clean up the stale request.
			resolveJoinRequest(community, userIdStr, "approved");
			await community.save();
			return res.status(200).json({
				success: true,
				message: "User is already a member!",
			});
		}

		await addMemberToCommunity(
			community,
			new mongoose.Types.ObjectId(userIdStr),
		);
		resolveJoinRequest(community, userIdStr, "approved");
		await community.save();

		const io = getIO();
		io.to(`community:${communityId}`).emit("community:member-joined", {
			communityId,
			userId: userIdStr,
			memberCount: community.memberCount,
		});

		return res.status(200).json({
			success: true,
			message: "Join request approved!",
			memberCount: community.memberCount,
		});
	} catch (err: any) {
		logger.error("Error in approveJoinRequest controller", {
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
 * Reject a join request (moderators and above).
 * POST /api/communities/:communityId/join-requests/:userId/reject
 */
export const rejectJoinRequest = async (
	req: Request<CommunityParams & { userId: string }>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId, userId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}
		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}
		if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
			return next(new BadRequestError("Valid user ID is required!"));
		}
		const community = await Community.findById(communityId);
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}
		if (!isCommunityModerator(community, currentUserId.toString())) {
			return next(
				new ForbiddenError("Only moderators can reject join requests!"),
			);
		}
		const userIdStr = userId.toString();
		const requestExists = (community.joinRequests || []).some(
			(r: any) => r.user.toString() === userIdStr,
		);
		if (!requestExists) {
			return next(new NotFoundError("No pending request from this user!"));
		}
		resolveJoinRequest(community, userIdStr, "rejected");
		await community.save();
		return res.status(200).json({
			success: true,
			message: "Join request rejected!",
		});
	} catch (err: any) {
		logger.error("Error in rejectJoinRequest controller", {
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
 * Cancel your own pending join request.
 * POST /api/communities/:communityId/join-requests/cancel
 */
export const cancelJoinRequest = async (
	req: Request<CommunityParams>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}
		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}
		const community = await Community.findById(communityId);
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}
		const userIdStr = currentUserId.toString();
		const before = (community.joinRequests || []).length;
		community.joinRequests = (community.joinRequests || []).filter(
			(r: any) => r.user.toString() !== userIdStr,
		) as any;
		if (community.joinRequests.length === before) {
			return res.status(200).json({
				success: true,
				message: "No pending request to cancel.",
			});
		}
		await community.save();
		const io = getIO();
		io.to(`community:${communityId}`).emit("community:join-request-resolved", {
			communityId,
			userId: userIdStr,
			status: "cancelled",
		});
		return res.status(200).json({
			success: true,
			message: "Join request cancelled!",
		});
	} catch (err: any) {
		logger.error("Error in cancelJoinRequest controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

// ─── Member roles (creator > admin > moderator > member) ──────────

/**
 * Promote or demote a member's role.
 * POST /api/communities/:communityId/members/:memberId/role
 *
 * Rules:
 *  - creator can promote/demote anyone (except themselves)
 *  - admin can promote/demote moderators and members, never other admins
 *  - the creator's role can never be changed
 */
export const updateMemberRole = async (
	req: Request<CommunityParams & { memberId: string }>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId, memberId } = req.params;
	const currentUserId = req.user?._id;
	const { role } = req.body;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}
		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}
		if (!memberId || !mongoose.Types.ObjectId.isValid(memberId)) {
			return next(new BadRequestError("Valid member ID is required!"));
		}
		if (!["admin", "moderator", "member"].includes(role)) {
			return next(
				new BadRequestError("Role must be admin, moderator, or member!"),
			);
		}
		const community = await Community.findById(communityId);
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}

		const actorIdStr = currentUserId.toString();
		const memberIdStr = memberId.toString();
		const actorRole = getMemberRole(community, actorIdStr);
		const targetRole = getMemberRole(community, memberIdStr);

		if (actorRole === "member") {
			return next(
				new ForbiddenError("Only admins can change member roles!"),
			);
		}
		if (targetRole === "creator") {
			return next(
				new BadRequestError("The creator's role can't be changed!"),
			);
		}
		const memberEntry = community.members.find(
			(m: any) => m.user.toString() === memberIdStr,
		);
		if (!memberEntry) {
			return next(new NotFoundError("Member not found in this community!"));
		}

		// Permission matrix:
		//  - promoting/demoting to/from ADMIN requires the creator
		//  - admins may only touch moderators/members
		if (role === "admin" && actorRole !== "creator") {
			return next(
				new ForbiddenError("Only the creator can assign admins!"),
			);
		}
		if (targetRole === "admin" && actorRole !== "creator") {
			return next(
				new ForbiddenError("Only the creator can demote admins!"),
			);
		}
		if (actorRole === "admin" && targetRole === "admin") {
			return next(
				new ForbiddenError("Admins can't change other admins' roles!"),
			);
		}

		memberEntry.role = role;
		// Keep the legacy `admins` array in sync so room management and any
		// pre-roles code paths stay correct.
		community.admins = (community.admins || []).filter(
			(a: any) => a.toString() !== memberIdStr,
		);
		if (role === "admin") {
			community.admins.push(new mongoose.Types.ObjectId(memberIdStr));
		}
		await community.save();
	if (role === "admin" || role === "moderator") {
		checkBadgesAndNotify(memberIdStr, "community_admin").catch(() => {});
	}

		// Audit trail — who promoted/demoted whom.
		try {
			await AdminAuditLog.create({
			actor: currentUserId,
			actorName: (req.user as any)?.username || "",
			action: role === "member" ? "community_demote_member" : "community_promote_member",
			targetType: "community",
			targetId: communityId,
			targetName: community.name,
			details: { memberId: memberIdStr, role, communityId },
		});
	} catch (auditErr: any) {
		logger.error("Audit log write failed (community role change)", {
			error: auditErr.message,
		});
	}

		const io = getIO();
		io.to(`community:${communityId}`).emit("community:member-role-changed", {
			communityId,
			userId: memberIdStr,
			role,
		});

		return res.status(200).json({
			success: true,
			message:
				role === "member"
					? "Member demoted!"
					: `Member promoted to ${role}!`,
			role,
		});
	} catch (err: any) {
		logger.error("Error in updateMemberRole controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

// ─── Ban / unban ──────────────────────────────────────────────────

/**
 * Ban a member (moderators+). Banned users are removed from `members`
 * (so they can't send/read) and recorded in `bannedUsers` with the reason
 * (so the ban survives leave/rejoin and a later unban can restore access).
 * POST /api/communities/:communityId/ban  { memberId, reason? }
 */
export const banCommunityMember = async (
	req: Request<CommunityParams>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId } = req.params;
	const { memberId, reason } = req.body;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}
		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}
		if (!memberId || !mongoose.Types.ObjectId.isValid(memberId)) {
			return next(new BadRequestError("Valid member ID is required!"));
		}
		const community = await Community.findById(communityId);
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}

		const userIdStr = currentUserId.toString();
		const memberIdStr = memberId.toString();

		// Same role hierarchy as kick: moderators can ban members, admins can
		// ban moderators, only the creator can ban admins. Never the creator.
		const actorRole = getMemberRole(community, userIdStr);
		const targetRole = getMemberRole(community, memberIdStr);
		const ROLE_RANK: Record<string, number> = {
			member: 0,
			moderator: 1,
			admin: 2,
			creator: 3,
		};
		if ((ROLE_RANK[actorRole] ?? 0) <= 0) {
			return next(
				new ForbiddenError("Only moderators can ban members!"),
			);
		}
		if (memberIdStr === community.creator.toString()) {
			return next(
				new BadRequestError("Cannot ban the community creator!"),
			);
		}
		if ((ROLE_RANK[targetRole] ?? 0) >= (ROLE_RANK[actorRole] ?? 0)) {
			return next(
				new ForbiddenError(
					"You can't ban a member with equal or higher permissions!",
				),
			);
		}

		// Idempotent — re-banning a banned user just updates the reason.
		const existing = (community.bannedUsers || []).find(
			(b: any) => b.user.toString() === memberIdStr,
		);
		if (existing) {
			existing.reason = sanitizePlainText(reason || "");
			existing.bannedBy = currentUserId as any;
			existing.bannedAt = new Date();
		} else {
			community.bannedUsers.push({
				user: new mongoose.Types.ObjectId(memberIdStr),
				bannedBy: currentUserId,
				reason: sanitizePlainText(reason || ""),
				bannedAt: new Date(),
			});
		}

		// Remove from members (+ legacy admins array, pending requests) so the
		// ban is immediately enforced everywhere membership is checked.
		community.members = community.members.filter(
			(m) => m.user.toString() !== memberIdStr,
		) as any;
		community.admins = (community.admins || []).filter(
			(a: any) => a.toString() !== memberIdStr,
		);
		community.joinRequests = (community.joinRequests || []).filter(
			(r: any) => r.user.toString() !== memberIdStr,
		) as any;
		community.memberCount = community.members.length;
		await community.save();

		// Audit trail.
		try {
			await AdminAuditLog.create({
				actor: currentUserId,
				actorName: (req.user as any)?.username || "",
				action: "community_ban_member",
				targetType: "community",
				targetId: communityId,
				targetName: community.name,
				details: { memberId: memberIdStr, reason: reason || "", communityId },
			});
		} catch (auditErr: any) {
			logger.error("Audit log write failed (community ban)", {
				error: auditErr.message,
			});
		}

		const io = getIO();
		io.to(`community:${communityId}`).emit("community:member-removed", {
			communityId,
			removedUserId: memberIdStr,
			memberCount: community.memberCount,
		});
		// Tell the banned user's own devices (they're removed from the room
		// above, so their other tabs need a direct kick).
		io.to(`user:${memberIdStr}`).emit("community:banned", {
			communityId,
		});

		return res.status(200).json({
			success: true,
			message: "Member banned successfully!",
			memberCount: community.memberCount,
		});
	} catch (err: any) {
		logger.error("Error in banCommunityMember controller", {
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
 * Unban a user (moderators+). Restores nothing automatically — they can
 * re-join normally (joinCommunity rejects while the ban entry exists).
 * POST /api/communities/:communityId/unban  { memberId }
 */
export const unbanCommunityMember = async (
	req: Request<CommunityParams>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId } = req.params;
	const { memberId } = req.body;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}
		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}
		if (!memberId || !mongoose.Types.ObjectId.isValid(memberId)) {
			return next(new BadRequestError("Valid member ID is required!"));
		}
		const community = await Community.findById(communityId);
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}
		if (!isCommunityModerator(community, currentUserId.toString())) {
			return next(
				new ForbiddenError(
					"Only moderators and admins can unban members!",
				),
			);
		}

		const memberIdStr = memberId.toString();
		community.bannedUsers = (community.bannedUsers || []).filter(
			(b: any) => b.user.toString() !== memberIdStr,
		) as any;
		await community.save();

		try {
			await AdminAuditLog.create({
				actor: currentUserId,
				actorName: (req.user as any)?.username || "",
				action: "community_unban_member",
				targetType: "community",
				targetId: communityId,
				targetName: community.name,
				details: { memberId: memberIdStr, communityId },
			});
		} catch (auditErr: any) {
			logger.error("Audit log write failed (community unban)", {
				error: auditErr.message,
			});
		}

		return res.status(200).json({
			success: true,
			message: "Member unbanned successfully!",
		});
	} catch (err: any) {
		logger.error("Error in unbanCommunityMember controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

// ─── Polls ────────────────────────────────────────────────────────

/**
 * Vote (or un-vote) on a community message poll. Single-choice polls move
 * the vote (voting a new option removes the old one); multi-choice polls
 * toggle per option. Votes are idempotent — voting twice on the same option
 * removes the vote.
 * POST /api/communities/messages/:messageId/vote  { optionIndex }
 */
export const voteCommunityPoll = async (
	req: Request<MessageParams>,
	res: Response,
	next: NextFunction,
) => {
	const { messageId } = req.params;
	const { optionIndex } = req.body;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}
		if (!mongoose.Types.ObjectId.isValid(messageId)) {
			return next(new BadRequestError("Invalid message ID!"));
		}
		if (
			!Number.isInteger(optionIndex) ||
			optionIndex < 0
		) {
			return next(new BadRequestError("Valid optionIndex is required!"));
		}
		const message = await CommunityMessage.findById(messageId);
		if (!message) {
			return next(new NotFoundError("Message not found!"));
		}
		if (!message.poll || !message.poll.options || message.poll.options.length === 0) {
			return next(new BadRequestError("This message has no poll!"));
		}
		if (optionIndex >= message.poll.options.length) {
			return next(new BadRequestError("Invalid option index!"));
		}
		// Polls close at endsAt — voting after the deadline is rejected.
		if (message.poll.endsAt && new Date(message.poll.endsAt).getTime() < Date.now()) {
			return next(new BadRequestError("This poll has ended!"));
		}

		// Only community members can vote (the sender's own poll included).
		const community = await Community.findById(message.community);
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}
		if (
			!community.members.some(
				(m: any) => m.user.toString() === currentUserId.toString(),
			)
		) {
			return next(
				new ForbiddenError(
					"You must be a member to vote in this community!",
				),
			);
		}

		const userIdStr = currentUserId.toString();
		const poll = message.poll;
		const options: any[] = (poll as any).options || [];
		const target = options[optionIndex];
		const votedOnTarget = (target.voters || []).some(
			(v: any) => v.toString() === userIdStr,
		);

		// Atomic writes only — NO read-modify-write on the whole document.
		// Two concurrent voters used to read the same snapshot and save() it,
		// so the second save clobbered the first's vote (lost updates on a
		// hot poll). Each op below targets exactly the arrays it changes, and
		// each is atomic on its own, so concurrent votes never disappear.
		if (poll.allowMultiple) {
			// Toggle this option's vote.
			if (votedOnTarget) {
				await CommunityMessage.updateOne(
					{ _id: messageId },
					{
						$pull: {
							[`poll.options.${optionIndex}.voters`]: currentUserId,
						},
					},
				);
			} else {
				await CommunityMessage.updateOne(
					{ _id: messageId },
					{
						$addToSet: {
							[`poll.options.${optionIndex}.voters`]: currentUserId,
						},
					},
				);
			}
		} else {
			// Single choice — remove the user from EVERY option, then add to
			// the chosen one (voting the same option again = un-vote). The
			// remove is one atomic pipeline update; the add is a second atomic
			// op, so concurrent voters never lose each other's votes.
			await CommunityMessage.updateOne(
				{ _id: messageId },
				[
					{
						$set: {
							"poll.options": {
								$map: {
									input: "$poll.options",
									as: "opt",
									in: {
										$mergeObjects: [
											"$$opt",
											{
												voters: {
													$setDifference: [
														"$$opt.voters",
														[currentUserId],
													],
												},
											},
										],
									},
								},
							},
						},
					},
				],
				{ updatePipeline: true },
			);
			if (!votedOnTarget) {
				await CommunityMessage.updateOne(
					{ _id: messageId },
					{
						$addToSet: {
							[`poll.options.${optionIndex}.voters`]: currentUserId,
						},
					},
				);
			}
		}

		// Evict the thread cache so the updated counts reach other viewers on
		// their next fetch (the realtime socket emit below covers live tabs).
		clearByPattern(`community:conv:${message.community.toString()}:*`).catch(
			() => {},
		);

		// Broadcast the new counts to the whole community room — honoring poll
		// privacy on the wire. For "end" polls the counts stay masked until
		// endsAt passes (even the voter doesn't get early results). For "vote"
		// polls the room gets FULL counts and each client masks by its OWN
		// vote state (it knows whether it voted and applies votes
		// optimistically) — the server can't know per-socket who voted in a
		// room broadcast, and voters need live updates from other voters.
		const io = getIO();
		const pollPayload = {
			communityId: message.community.toString(),
			messageId: message._id.toString(),
			options: options.map((o: any) => ({
				text: o.text,
				voters: (o.voters || []).map((v: any) => v.toString()),
			})),
		};
		if (poll.hideResults === "end") {
			const ended =
				!!poll.endsAt && new Date(poll.endsAt).getTime() < Date.now();
			const masked = ended
				? pollPayload
				: {
						...pollPayload,
						options: pollPayload.options.map((o: any) => ({
							text: o.text,
							voters: [],
						})),
				  };
			io.to(`community:${message.community.toString()}`).emit(
				"community:poll:updated",
				masked,
			);
		} else {
			io.to(`community:${message.community.toString()}`).emit(
				"community:poll:updated",
				pollPayload,
			);
		}

		return res.status(200).json({
			success: true,
			message: votedOnTarget
				? "Vote removed!"
				: "Vote recorded!",
		});
	} catch (err: any) {
		logger.error("Error in voteCommunityPoll controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

// ─── Starred messages (community) ─────────────────────────────────

/**
 * Get the members who have seen a community message — the "Seen by" list
 * behind the Message info panel (WhatsApp-group style: names, not just a
 * count). The seenBy array is capped server-side; members are returned with
 * profile info so the client can render avatar + name rows.
 * GET /api/communities/messages/:messageId/seen-by
 */
export const getCommunityMessageSeenBy = async (
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

		const message = await CommunityMessage.findById(messageId)
			.select("community seenBy")
			.lean();
		if (!message) {
			return next(new NotFoundError("Message not found!"));
		}

		// Only members can see who read a community message (blocked/outsider
		// privacy — the same gate the message read path enforces).
		const community = await Community.findById(message.community)
			.select("members")
			.lean();
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}
		const isMember = (community as any).members?.some(
			(m: any) => m.user?.toString() === currentUserId.toString(),
		);
		if (!isMember) {
			return next(
				new ForbiddenError(
					"You must be a member to see read receipts!",
				),
			);
		}

		const seenByIds = (message as any).seenBy || [];
		const users = await User.find({ _id: { $in: seenByIds } })
			.select("username fullName profilePic isVerified statusText waitlistPerk")
			.lean();
		// Preserve the seenBy order (most-recent viewer last = most-recently
		// read at the bottom, WhatsApp-style) by mapping ids → docs.
		const byId = new Map(users.map((u: any) => [u._id.toString(), u]));
		const ordered = seenByIds
			.map((id: any) => byId.get(id.toString()))
			.filter(Boolean);

		return res.status(200).json({ success: true, seenBy: ordered });
	} catch (err: any) {
		logger.error("Error in getCommunityMessageSeenBy controller", {
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
 * Toggle star (save) on a community message for the current user.
 * POST /api/communities/messages/:messageId/star
 */
export const toggleStarCommunityMessage = async (
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
		const message = await CommunityMessage.findById(messageId);
		if (!message) {
			return next(new NotFoundError("Message not found!"));
		}
		// Only members can star (blocked/outsiders shouldn't be able to
		// bookmark messages they can't read).
		const community = await Community.findById(message.community).select("members").lean();
		if (!community || !(community as any).members.some(
			(m: any) => m.user.toString() === currentUserId.toString(),
		)) {
			return next(
				new ForbiddenError(
					"You must be a member to star messages in this community!",
				),
			);
		}

		const userIdStr = currentUserId.toString();
		const hasStarred = (message.savedBy || []).some(
			(s: any) => s.toString() === userIdStr,
		);
		if (hasStarred) {
			await CommunityMessage.updateOne(
				{ _id: message._id },
				{ $pull: { savedBy: currentUserId } },
			);
		} else {
			await CommunityMessage.updateOne(
				{ _id: message._id },
				{ $addToSet: { savedBy: currentUserId } },
			);
		}

		const io = getIO();
		io.to(`community:${message.community.toString()}`).emit(
			"community:message:starred",
			{
				communityId: message.community.toString(),
				messageId: message._id.toString(),
				starred: !hasStarred,
				userId: userIdStr,
			},
		);

		return res.status(200).json({
			success: true,
			starred: !hasStarred,
		});
	} catch (err: any) {
		logger.error("Error in toggleStarCommunityMessage controller", {
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
 * List the current user's starred messages in a community.
 * GET /api/communities/:communityId/starred
 */
export const getStarredCommunityMessages = async (
	req: Request<CommunityParams>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}
		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}

		const messages = await CommunityMessage.find({
			community: communityId,
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
		logger.error("Error in getStarredCommunityMessages controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

// ─── Invite links ─────────────────────────────────────────────────

const generateInviteCode = (): string =>
	// 16 hex chars — enough entropy that codes can't be guessed.
	require("crypto").randomBytes(8).toString("hex");

/**
 * Get the current invite code (or null if none was generated yet).
 * GET /api/communities/:communityId/invite
 */
export const getInviteCode = async (
	req: Request<CommunityParams>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}
		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}
		const community = await Community.findById(communityId).lean();
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}
		if (!isCommunityManager(community, currentUserId.toString())) {
			return next(
				new ForbiddenError("Only admins can view the invite link!"),
			);
		}
		return res.status(200).json({
			success: true,
			code: community.inviteCode || null,
		});
	} catch (err: any) {
		logger.error("Error in getInviteCode controller", {
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
 * Generate (or regenerate) the community's invite code.
 * POST /api/communities/:communityId/invite
 */
export const createInviteCode = async (
	req: Request<CommunityParams>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}
		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}
		const community = await Community.findById(communityId);
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}
		if (!isCommunityManager(community, currentUserId.toString())) {
			return next(
				new ForbiddenError("Only admins can generate invite links!"),
			);
		}
		const code = generateInviteCode();
		community.inviteCode = code;
		community.inviteCodeCreatedAt = new Date();
		await community.save();
		return res.status(200).json({
			success: true,
			message: "Invite link generated!",
			code,
		});
	} catch (err: any) {
		logger.error("Error in createInviteCode controller", {
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
 * Join a community via its invite code — works for public AND private
 * communities (bypasses the approval flow).
 * POST /api/communities/join/invite  { code }
 */
export const joinViaInvite = async (
	req: Request,
	res: Response,
	next: NextFunction,
) => {
	const currentUserId = req.user?._id;
	const { code } = req.body;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}
		if (!code || typeof code !== "string" || !code.trim()) {
			return next(new BadRequestError("Invite code is required!"));
		}
	const community = await Community.findOne({
		inviteCode: code.trim(),
	} as any);
		if (!community) {
			return next(new NotFoundError("Invalid invite code!"));
		}

		const userIdStr = currentUserId.toString();
		if (isCommunityMember(community, userIdStr)) {
			return res.status(200).json({
				success: true,
				message: "You are already a member!",
				isMember: true,
				communityId: community._id.toString(),
			});
		}

		await addMemberToCommunity(community, currentUserId);

		const io = getIO();
		io.to(`community:${community._id.toString()}`).emit(
			"community:member-joined",
			{
				communityId: community._id.toString(),
				userId: userIdStr,
				memberCount: community.memberCount,
			},
		);

		return res.status(200).json({
			success: true,
			message: "Joined community via invite!",
			isMember: true,
			communityId: community._id.toString(),
			memberCount: community.memberCount,
		});
	} catch (err: any) {
		logger.error("Error in joinViaInvite controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

// ─── Per-channel unread badges ───────────────────────────────────

/**
 * Per-channel unread counts for the current user.
 * GET /api/communities/:communityId/unread
 *
 * Returns [{ room, count }] where room is the channel id (null = general).
 * A message counts as unread when it's newer than the user's read pointer
 * for that channel (communityRoomReads) and wasn't sent by the user.
 */
export const getRoomUnreadCounts = async (
	req: Request<CommunityParams>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}
		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}
		const community = await Community.findById(communityId).lean();
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}
		if (!isCommunityMember(community, currentUserId.toString())) {
			return next(
				new ForbiddenError("You must be a member to view unread counts!"),
			);
		}

		const userIdStr = currentUserId.toString();
		const user = await User.findById(currentUserId)
			.select("communityRoomReads")
			.lean();
		const reads: any[] = (user as any)?.communityRoomReads || [];

		// Blocked senders are excluded so the badge matches what the user can
		// actually see in the message list.
		let blockedSet = new Set<string>();
		try {
			blockedSet = new Set(await getBlockedUserIds(userIdStr));
		} catch (blockErr: any) {
			logger.error("Blocked filter error in getRoomUnreadCounts", {
				error: (blockErr as any)?.message,
			});
		}

		const rooms = (community as any).rooms || [];
		const counts: { room: string | null; count: number }[] = [];

		const countFor = async (roomId: string | null, pointer: any) => {
			const query: any = {
				community: communityId,
				isDeleted: { $ne: true },
				clearedFor: { $nin: [currentUserId] },
				sender: { $ne: currentUserId },
				room: roomId ? new mongoose.Types.ObjectId(roomId) : null,
			};
			if (pointer) {
				query._id = { $gt: pointer };
			}
			if (blockedSet.size > 0) {
				query.sender = {
					$ne: currentUserId,
					$nin: [...blockedSet],
				};
			}
			return CommunityMessage.countDocuments(query);
		};

		// General channel (room: null)
		const generalRead = reads.find((r: any) => !r.room);
		counts.push({
			room: null,
			count: await countFor(null, generalRead?.lastReadMessageId || null),
		});

		// Every other channel
		for (const room of rooms.slice(1)) {
			const roomId = room._id.toString();
			const read = reads.find(
				(r: any) => r.room && r.room.toString() === roomId,
			);
			counts.push({
				room: roomId,
				count: await countFor(
					roomId,
					read?.lastReadMessageId || null,
				),
			});
		}

		return res.status(200).json({ success: true, counts });
	} catch (err: any) {
		logger.error("Error in getRoomUnreadCounts controller", {
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
 * Advance the user's read pointer for a channel.
 * POST /api/communities/:communityId/rooms/:roomId/read  { lastMessageId }
 * (roomId = "general" maps to the general channel / null room.)
 */
export const markRoomRead = async (
	req: Request<CommunityParams & { roomId: string }>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId, roomId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}
		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}

		const community = await Community.findById(communityId).lean();
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}
		if (!isCommunityMember(community, currentUserId.toString())) {
			return next(
				new ForbiddenError("You must be a member to mark channels read!"),
			);
		}

		const roomIdStr = roomId === "general" ? "" : roomId;
		const roomObjectId = roomIdStr
			? new mongoose.Types.ObjectId(roomIdStr)
			: null;
		if (roomIdStr && !mongoose.Types.ObjectId.isValid(roomIdStr)) {
			return next(new BadRequestError("Invalid room ID!"));
		}

		const lastReadMessageId = req.body.lastMessageId
			? new mongoose.Types.ObjectId(req.body.lastMessageId)
			: null;

		await User.updateOne(
			{
				_id: currentUserId,
				"communityRoomReads.community": communityId,
				"communityRoomReads.room": roomObjectId,
			},
			{
				$set: {
					"communityRoomReads.$.lastReadMessageId": lastReadMessageId,
					"communityRoomReads.$.updatedAt": new Date(),
				},
			},
		);

		// No existing pointer for this room → push one.
		const existing = await User.exists({
			_id: currentUserId,
			"communityRoomReads.community": communityId,
			"communityRoomReads.room": roomObjectId,
		});
		if (!existing) {
			await User.updateOne(
				{ _id: currentUserId },
				{
					$push: {
						communityRoomReads: {
							community: new mongoose.Types.ObjectId(communityId),
							room: roomObjectId,
							lastReadMessageId,
							updatedAt: new Date(),
						},
					},
				},
			);
		}

		return res.status(200).json({ success: true });
	} catch (err: any) {
		logger.error("Error in markRoomRead controller", {
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
 * Toggle messaging enabled/disabled for the community (creator only).
 * POST /api/communities/:communityId/toggle-messaging
 */
export const toggleCommunityMessaging = async (
  req: Request<CommunityParams>,
  res: Response,
  next: NextFunction,
) => {
  const { communityId } = req.params;
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) {
      return next(new UnauthorizedError("Unauthorized!"));
    }

    if (!mongoose.Types.ObjectId.isValid(communityId)) {
      return next(new BadRequestError("Invalid community ID!"));
    }

    const community = await Community.findById(communityId);
    if (!community) {
      return next(new NotFoundError("Community not found!"));
    }

    if (!isCommunityManager(community, currentUserId.toString())) {
      return next(
        new ForbiddenError("Only admins can toggle messaging!"),
      );
    }

    community.messagingEnabled = !community.messagingEnabled;
    await community.save();

    const io = getIO();
    io.to(`community:${communityId}`).emit("community:messaging-toggled", {
      communityId,
      messagingEnabled: community.messagingEnabled,
    });

    return res.status(200).json({
      success: true,
      message: community.messagingEnabled
        ? "Messaging enabled!"
        : "Messaging disabled!",
      messagingEnabled: community.messagingEnabled,
    });
  } catch (err: any) {
    logger.error("Error in toggleCommunityMessaging controller", {
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
 * Mute notifications for a community (any member, per-user setting).
 * POST /api/communities/:communityId/mute
 */
export const muteCommunityNotifications = async (
  req: Request<CommunityParams>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { communityId } = req.params;
    const currentUserId = (req.user as any)?._id;
    const userId = currentUserId?.toString();

    const community = await Community.findById(communityId);
    if (!community) {
      return next(new NotFoundError("Community not found."));
    }
    if (!community.members.some((m) => m.user.toString() === userId)) {
      return next(
        new ForbiddenError("Join the community to mute its notifications."),
      );
    }

    const user = await User.findById(userId);
    if (!user) {
      return next(new UnauthorizedError("User not found."));
    }
    const alreadyMuted = user.mutedCommunities?.some(
      (m) => m.community?.toString() === communityId,
    );
    if (!alreadyMuted) {
      user.mutedCommunities.push({
        community: new mongoose.Types.ObjectId(communityId) as any,
        mutedAt: new Date(),
      });
      await user.save();
    }

    return res.status(200).json({
      success: true,
      message: "Community notifications muted.",
      muted: true,
    });
  } catch (err: any) {
    logger.error("Error in muteCommunityNotifications controller", {
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
 * Unmute notifications for a community (any member, per-user setting).
 * POST /api/communities/:communityId/unmute
 */
export const unmuteCommunityNotifications = async (
  req: Request<CommunityParams>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { communityId } = req.params;
    const currentUserId = (req.user as any)?._id;
    const userId = currentUserId?.toString();

    const user = await User.findById(userId);
    if (!user) {
      return next(new UnauthorizedError("User not found."));
    }

    user.mutedCommunities = user.mutedCommunities.filter(
      (m) => m.community?.toString() !== communityId,
    ) as any;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Community notifications unmuted.",
      muted: false,
    });
  } catch (err: any) {
    logger.error("Error in unmuteCommunityNotifications controller", {
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
 * Get whether the current user muted a community's notifications.
 * GET /api/communities/:communityId/muted
 */
export const getCommunityMutedStatus = async (
  req: Request<CommunityParams>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { communityId } = req.params;
    const currentUserId = (req.user as any)?._id;
    const userId = currentUserId?.toString();

    const user = await User.findById(userId)
      .select("mutedCommunities")
      .lean();
    const muted =
      user?.mutedCommunities?.some(
        (m) => m.community?.toString() === communityId,
      ) ?? false;

    return res.status(200).json({ success: true, muted });
  } catch (err: any) {
    logger.error("Error in getCommunityMutedStatus controller", {
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
 * Toggle audio calls enabled/disabled for the community (creator only).
 * POST /api/communities/:communityId/toggle-audio-calls
 */
export const toggleCommunityAudioCalls = async (
  req: Request<CommunityParams>,
  res: Response,
  next: NextFunction,
) => {
  const { communityId } = req.params;
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) {
      return next(new UnauthorizedError("Unauthorized!"));
    }

    if (!mongoose.Types.ObjectId.isValid(communityId)) {
      return next(new BadRequestError("Invalid community ID!"));
    }

    const community = await Community.findById(communityId);
    if (!community) {
      return next(new NotFoundError("Community not found!"));
    }

    if (!isCommunityManager(community, currentUserId.toString())) {
      return next(
        new ForbiddenError("Only admins can toggle audio calls!"),
      );
    }

    community.audioCallEnabled = !community.audioCallEnabled;
    await community.save();

    const io = getIO();
    io.to(`community:${communityId}`).emit("community:calls-toggled", {
      communityId,
      audioCallEnabled: community.audioCallEnabled,
    });

    return res.status(200).json({
      success: true,
      message: community.audioCallEnabled
        ? "Audio calls enabled!"
        : "Audio calls disabled!",
      audioCallEnabled: community.audioCallEnabled,
    });
  } catch (err: any) {
    logger.error("Error in toggleCommunityAudioCalls controller", {
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
 * Toggle video calls enabled/disabled for the community (creator only).
 * POST /api/communities/:communityId/toggle-video-calls
 */
export const toggleCommunityVideoCalls = async (
  req: Request<CommunityParams>,
  res: Response,
  next: NextFunction,
) => {
  const { communityId } = req.params;
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) {
      return next(new UnauthorizedError("Unauthorized!"));
    }

    if (!mongoose.Types.ObjectId.isValid(communityId)) {
      return next(new BadRequestError("Invalid community ID!"));
    }

    const community = await Community.findById(communityId);
    if (!community) {
      return next(new NotFoundError("Community not found!"));
    }

    if (!isCommunityManager(community, currentUserId.toString())) {
      return next(
        new ForbiddenError("Only admins can toggle video calls!"),
      );
    }

    community.videoCallEnabled = !community.videoCallEnabled;
    await community.save();

    const io = getIO();
    io.to(`community:${communityId}`).emit("community:calls-toggled", {
      communityId,
      videoCallEnabled: community.videoCallEnabled,
    });

    return res.status(200).json({
      success: true,
      message: community.videoCallEnabled
        ? "Video calls enabled!"
        : "Video calls disabled!",
      videoCallEnabled: community.videoCallEnabled,
    });
  } catch (err: any) {
    logger.error("Error in toggleCommunityVideoCalls controller", {
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
 * Clear all messages in the community (creator only).
 * POST /api/communities/:communityId/clear-chat
 */
export const clearCommunityChat = async (
  req: Request<CommunityParams>,
  res: Response,
  next: NextFunction,
) => {
  const { communityId } = req.params;
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) {
      return next(new UnauthorizedError("Unauthorized!"));
    }

    if (!mongoose.Types.ObjectId.isValid(communityId)) {
      return next(new BadRequestError("Invalid community ID!"));
    }

    const community = await Community.findById(communityId);
    if (!community) {
      return next(new NotFoundError("Community not found!"));
    }

    if (community.creator.toString() !== currentUserId.toString()) {
      return next(
        new ForbiddenError("Only the community creator can clear the chat!"),
      );
    }

    // Soft-delete all messages
    await CommunityMessage.updateMany(
      { community: communityId },
      {
        $set: {
          isDeleted: true,
          text: "This message was deleted",
          attachments: [],
        },
      },
    );

    // Clear pinned messages since those are references
    community.pinnedMessages = [];
    await community.save();

    // Clear the list preview so it doesn't show a stale last message
    await Community.updateOne(
      { _id: communityId },
      { $unset: { lastMessage: 1, lastAction: 1 } },
    );

    const io = getIO();
    io.to(`community:${communityId}`).emit("community:chat-cleared", {
      communityId,
    });

    return res.status(200).json({
      success: true,
      message: "Chat cleared successfully!",
    });
  } catch (err: any) {
    logger.error("Error in clearCommunityChat controller", {
      error: err.message,
    });
    return next(
      err instanceof AppError
        ? err
        : new AppError("Internal server error!"),
    );
  }
};

// ─── Get community media by type ────────────────────────────────
/**
 * Get community messages filtered by attachment type (image, video, voice_note, file).
 * GET /api/communities/:communityId/media?type=image&limit=50
 */
export const getCommunityMedia = async (
	req: Request<CommunityParams>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId } = req.params;
	const currentUserId = req.user?._id;
	const mediaType = (req.query.type as string) || "";
	const limit = Math.min(Number(req.query.limit) || 50, 100);
	const skip = Math.max(0, Number(req.query.skip) || 0);

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		if (!mongoose.Types.ObjectId.isValid(communityId)) {
			return next(new BadRequestError("Invalid community ID!"));
		}

		const validTypes = ["image", "video", "voice_note", "file", "gif"];
		if (!mediaType || !validTypes.includes(mediaType)) {
			return next(new BadRequestError("Invalid media type! Must be one of: image, video, voice_note, file, gif"));
		}

		// Verify user is a member
		const community = await Community.findById(communityId);
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}

		const isMember = community.members.some(
			(m) => m.user.toString() === currentUserId.toString(),
		);
		if (!isMember) {
			return next(new ForbiddenError("You must be a member to view community media!"));
		}

		// Query messages with attachments matching the requested type.
		// Media is hidden for the user if they cleared the community history
		// (clearedFor) OR deleted the message for themselves (deletedFor).
		// Blocked users must not exist for each other — exclude media from
		// anyone with a mutual block relationship with the viewer.
		// Cache the tab payload — the library only changes when media is
		// sent/edited/deleted (which evicts below), so 60s TTL is plenty and
		// every tab switch is ~1ms instead of a DB query. Keyed per user
		// (clearedFor/deletedFor are per-user views).
		const cacheKey = `community:conv:${communityId}:media:${currentUserId}:${mediaType}:${limit}:${skip}`;
		try {
			const cached = await getCache(cacheKey);
			if (cached) return res.status(200).json(cached);
		} catch (err: any) {
			logger.error("Media cache read error", { error: err.message });
		}

		const blockedIds = await getBlockedUserIds(currentUserId.toString());
		const mediaQuery: any = {
			community: communityId,
			isDeleted: { $ne: true },
			"attachments.type": mediaType,
			// $ne per-field (NOT $nor) — $nor defeats index usage entirely;
			// with the new { community, attachments.type, createdAt } multikey
			// index, $ne lets Mongo seek instead of scanning the community.
			clearedFor: { $ne: currentUserId },
			deletedFor: { $ne: currentUserId },
		};
		if (blockedIds.length > 0) {
			mediaQuery.sender = { $nin: blockedIds };
		}

		const messages = await CommunityMessage.find(mediaQuery)
			.populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
			.sort({ createdAt: -1 })
			.skip(skip)
			.limit(limit)
			.lean();

		const payload = {
			success: true,
			messages,
			total: messages.length,
		};
		try {
			await setCache(cacheKey, payload, 60);
		} catch (err: any) {
			logger.error("Media cache write error", { error: err.message });
		}
		return res.status(200).json(payload);
	} catch (err: any) {
		logger.error("Error in getCommunityMedia controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

// ─── LiveKit Group Call Token ────────────────────────────────────
/**
 * Generate a LiveKit access token for a community group call.
 * Creates a LiveKit room for the community so all members can join.
 * POST /api/communities/:communityId/livekit-token
 */
export const generateLiveKitToken = async (
  req: Request<CommunityParams>,
  res: Response,
  next: NextFunction,
) => {
  const { communityId } = req.params;
  const currentUserId = req.user?._id;
  const { type } = (req.body || {}) as { type?: "audio" | "video" };
  const callType: "audio" | "video" = type === "video" ? "video" : "audio";

  try {
    if (!currentUserId) {
      return next(new UnauthorizedError("Unauthorized!"));
    }

    if (!mongoose.Types.ObjectId.isValid(communityId)) {
      return next(new BadRequestError("Invalid community ID!"));
    }

    // Verify user is a member
    const community = await Community.findById(communityId);
    if (!community) {
      return next(new NotFoundError("Community not found!"));
    }

    const isMember = community.members.some(
      (m) => m.user.toString() === currentUserId.toString(),
    );
    if (!isMember) {
      return next(new ForbiddenError("You must be a member to start a call!"));
    }

    // Check if calls are enabled
    if (!community.audioCallEnabled && !community.videoCallEnabled) {
      return next(new BadRequestError("Calls are disabled in this community!"));
    }

    // Validate the specific call type is enabled for this community
    if (callType === "audio" && !community.audioCallEnabled) {
      return next(new BadRequestError("Audio calls are disabled in this community!"));
    }
    if (callType === "video" && !community.videoCallEnabled) {
      return next(new BadRequestError("Video calls are disabled in this community!"));
    }

    // Stable room name per community — every member who requests a token
    // joins the SAME LiveKit room, so a real group call can form.
    const roomName = `community-${communityId}`;

    // Generate the LiveKit token — participant metadata carries the user's
    // avatar URL (+ username) so every tile in the room can render a real
    // profile picture instead of initials.
    const token = await generateToken(
      roomName,
      (req.user as any).fullName || "Unknown",
      currentUserId.toString(),
      true,
      true,
      JSON.stringify({
        avatar: ((req.user as any)?.profilePic?.url || "").trim(),
        username: (req.user as any)?.username || "",
      }),
    );

    if (!token) {
      return next(new AppError("LiveKit is not configured. Please set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET."));
    }

    return res.status(200).json({
      success: true,
      token,
      roomName,
      livekitUrl: process.env.LIVEKIT_URL || "",
      type: callType,
    });
  } catch (err: any) {
    logger.error("Error in generateLiveKitToken controller", {
      error: err.message,
    });
    return next(
      err instanceof AppError
        ? err
        : new AppError("Internal server error!"),
    );
  }
};

export const toggleCommunityMessageReaction = async (
	req: Request<MessageParams>,
	res: Response,
	next: NextFunction,
) => {
	const { messageId } = req.params;
	const { emoji } = req.body;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		if (!mongoose.Types.ObjectId.isValid(messageId)) {
			return next(new BadRequestError("Invalid message ID!"));
		}

		if (!emoji || typeof emoji !== "string") {
			return next(new BadRequestError("Emoji is required!"));
		}

		const message = await CommunityMessage.findById(messageId);
		if (!message) {
			return next(new NotFoundError("Message not found!"));
		}

		const userIdStr = currentUserId.toString();
		const trimmedEmoji = emoji.trim();

		// Check if user already reacted with this emoji
		const existingIndex = message.reactions.findIndex(
			(r) =>
				r.sender.toString() === userIdStr &&
				r.emoji === trimmedEmoji,
		);

		let type: "add" | "remove";

		if (existingIndex > -1) {
			// Toggle off — remove ALL of this user's reactions
			message.reactions = message.reactions.filter(
				(r) => r.sender.toString() !== userIdStr,
			) as any;
			type = "remove";
		} else {
			// Replace — remove any previous reaction by this user, then add the
			// new one (one reaction per user, exactly like personal chat and
			// comments — clicking 6 emojis shows ONE, the latest).
			message.reactions = message.reactions.filter(
				(r) => r.sender.toString() !== userIdStr,
			) as any;
			(message.reactions as any).push({
				emoji: trimmedEmoji,
				sender: currentUserId,
			});
			type = "add";
		}    await message.save();

    // ── Emit the socket event IMMEDIATELY ───────────────────────────────
    // The recipient's perceived latency is the time between this save and the
    // emit — nothing slow may run before it. The payload is lightweight
    // (messageId + reactions + actor) so the client merges reactions into its
    // existing message instead of waiting for a re-fetched populated copy.
    // The actor's profile is already on req.user — no DB round-trip needed.
    const actorUser = (req.user as any) || {};
    const io = getIO();
    io.to(`community:${message.community.toString()}`).emit(
      "community:message:reaction",
      {
        messageId: message._id.toString(),
        communityId: message.community.toString(),
        messageSenderId:
          (message.sender as any)?.toString?.() ||
          String(message.sender),
        reactions: (message.reactions || []).map((r: any) => {
          const senderId = r.sender?.toString?.() || r.sender;
          // Populate the actor's own reaction so the receiving client can
          // render its chip/avatar without a follow-up query; other senders
          // stay as ObjectIds (the client only needs emoji + count + id).
          if (senderId === currentUserId.toString()) {
            return {
              emoji: r.emoji,
              sender: {
                _id: currentUserId,
                username: actorUser.username || "",
                fullName: actorUser.fullName || "",
                profilePic: actorUser.profilePic || null,
              },
              createdAt: r.createdAt,
            };
          }
          return { emoji: r.emoji, sender: senderId, createdAt: r.createdAt };
        }),
        type,
        emoji: emoji.trim(),
        actor: {
          _id: currentUserId,
          fullName: actorUser.fullName || "",
          username: actorUser.username || "",
        },
      },
    );

    // ── After the emit: bookkeeping the recipient never waits on ────────
    // Record the last action on the community so the community list preview
    // shows "Name reacted ❤️ to your message" instead of the stale last
    // message. Only reactions on the community's NEWEST message are recorded
    // (mirrors the 1-on-1 chat behavior); removing the matching reaction
    // clears it again so a reload never shows a stale "reacted" preview.
    try {
      const community = await Community.findById(message.community).select(
        "lastMessage lastAction",
      );
      const reactedMessageIsLast =
        community?.lastMessage?.messageId?.toString() ===
        message._id.toString();
      const lastActionMatches =
        (community?.lastAction as any)?.messageId?.toString() ===
        message._id.toString();

      if (type === "add" && reactedMessageIsLast) {
        await Community.findByIdAndUpdate(message.community, {
          $set: {
            lastAction: {
              type: "reaction",
              emoji: emoji.trim(),
              messageId: message._id,
              messageSenderId: message.sender,
              actor: {
                _id: currentUserId,
                fullName: actorUser.fullName || "",
                username: actorUser.username || "",
              },
              createdAt: new Date(),
            },
          },
        });
      } else if (type === "remove" && lastActionMatches) {
        await Community.findByIdAndUpdate(message.community, {
          $set: { lastAction: null },
        });
      }
    } catch (lastActionErr: any) {
      logger.error("Failed to update community lastAction", {
        error: lastActionErr.message,
      });
    }

    // Populate sender for the response only (never delays the recipient).
    const populatedMessage = await CommunityMessage.findById(message._id)
      .populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
      .populate("reactions.sender", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    return res.status(200).json({
      success: true,
      message: type === "add" ? "Reaction added!" : "Reaction removed!",
      reactions: populatedMessage?.reactions || [],
      type,
    });
	} catch (err: any) {
		logger.error("Error in toggleCommunityMessageReaction controller", {
			error: err.message,
		});
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

// ─── Rooms (channels) — Discord-style text channels ──────────────────────

/**
 * POST /api/communities/:communityId/rooms — Create a room (admin/creator only).
 */
export const createCommunityRoom = async (
	req: Request<CommunityParams>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		const community = await Community.findById(communityId);
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}
		if (!isCommunityAdmin(community, currentUserId.toString())) {
			return next(
				new ForbiddenError("Only admins can create rooms!"),
			);
		}

		const name =
			typeof req.body.name === "string" ? req.body.name.trim() : "";
		if (!name) {
			return next(new BadRequestError("Room name is required!"));
		}
		if (name.length > 30) {
			return next(
				new BadRequestError(
					"Room name cannot exceed 30 characters!",
				),
			);
		}
		const icon =
			typeof req.body.icon === "string" ? req.body.icon.trim() : "";
		const topic =
			typeof req.body.topic === "string" ? req.body.topic.trim() : "";
		// Channel type — "text" (everyone posts) or "announcement" (mods only).
		const type =
			req.body.type === "announcement" ? "announcement" : "text";
		// Discord-style slowmode (0 = off; seconds between a member's posts in
		// this channel).
		const slowModeSeconds = Math.max(
			0,
			Math.min(3600, Number(req.body.slowModeSeconds) || 0),
		);
		if (icon.length > 8) {
			return next(new BadRequestError("Channel icon is too long!"));
		}
		if (topic.length > 140) {
			return next(
				new BadRequestError(
					"Channel topic cannot exceed 140 characters!",
				),
			);
		}
		if ((community.rooms || []).length >= 20) {
			return next(
				new BadRequestError(
					"This community already has the maximum number of rooms (20)!",
				),
			);
		}

		community.rooms.push({
			name,
			icon,
			topic,
			type,
			slowModeSeconds,
			createdBy: currentUserId,
		} as any);
		await community.save();

		const populated = await Community.findById(communityId)
			.populate("creator", "username fullName profilePic isVerified statusText waitlistPerk")
			.populate("members.user", "username fullName profilePic isVerified statusText waitlistPerk")
			.lean();

		const io = getIO();
		io.to(`community:${communityId}`).emit("community:rooms-updated", {
			communityId,
			community: populated,
		});

		return res.status(201).json({
			success: true,
			message: "Room created!",
			community: populated,
		});
	} catch (err: any) {
		logger.error("Error in createCommunityRoom", { error: err.message });
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

/**
 * PUT /api/communities/:communityId/rooms/:roomId — Rename a room (admin/creator).
 */
export const renameCommunityRoom = async (
	req: Request<RoomParams>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId, roomId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		const community = await Community.findById(communityId);
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}
		if (!isCommunityAdmin(community, currentUserId.toString())) {
			return next(
				new ForbiddenError("Only admins can rename rooms!"),
			);
		}

		const room = (community.rooms || []).find(
			(r: any) => r._id.toString() === roomId,
		);
		if (!room) {
			return next(new NotFoundError("Room not found!"));
		}

		// General channel (index 0) is protected: its name can't be changed
		// (icon/topic are still editable by admins).
		const isGeneral = room._id.toString() === (community.rooms || [])[0]?._id?.toString();

		// Update any of name / icon / topic that were provided (edit mode).
		if (req.body.name !== undefined) {
			const name =
				typeof req.body.name === "string" ? req.body.name.trim() : "";
			if (!name) {
				return next(new BadRequestError("Room name is required!"));
			}
			if (name.length > 30) {
				return next(
					new BadRequestError(
						"Room name cannot exceed 30 characters!",
					),
				);
			}
			if (isGeneral && name !== "general") {
				return next(
					new BadRequestError(
						"The general channel's name can't be changed!",
					),
				);
			}
			room.name = name;
		}
		if (req.body.icon !== undefined) {
			const icon =
				typeof req.body.icon === "string" ? req.body.icon.trim() : "";
			if (icon.length > 8) {
				return next(new BadRequestError("Channel icon is too long!"));
			}
			room.icon = icon;
		}
		if (req.body.topic !== undefined) {
			const topic =
				typeof req.body.topic === "string" ? req.body.topic.trim() : "";
			if (topic.length > 140) {
				return next(
					new BadRequestError(
						"Channel topic cannot exceed 140 characters!",
					),
				);
			}
			room.topic = topic;
		}
		// Admins can convert a channel between text and announcement at any
		// time (the general channel stays a text channel).
		if (req.body.type !== undefined) {
			if (isGeneral && req.body.type !== "text") {
				return next(
					new BadRequestError(
						"The general channel can't be an announcement channel!",
					),
				);
			}
			room.type =
				req.body.type === "announcement" ? "announcement" : "text";
		}
		// Slowmode is editable at any time (0 = off).
		if (req.body.slowModeSeconds !== undefined) {
			room.slowModeSeconds = Math.max(
				0,
				Math.min(3600, Number(req.body.slowModeSeconds) || 0),
			);
		}
		await community.save();

		const populated = await Community.findById(communityId)
			.populate("creator", "username fullName profilePic isVerified statusText waitlistPerk")
			.populate("members.user", "username fullName profilePic isVerified statusText waitlistPerk")
			.lean();

		const io = getIO();
		io.to(`community:${communityId}`).emit("community:rooms-updated", {
			communityId,
			community: populated,
		});

		return res.status(200).json({
			success: true,
			message: "Room renamed!",
			community: populated,
		});
	} catch (err: any) {
		logger.error("Error in renameCommunityRoom", { error: err.message });
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};

/**
 * DELETE /api/communities/:communityId/rooms/:roomId — Delete a room and its
 * messages (admin/creator only). The first room ("general") can never be
 * deleted — it's the fallback channel for room-less messages.
 */
export const deleteCommunityRoom = async (
	req: Request<RoomParams>,
	res: Response,
	next: NextFunction,
) => {
	const { communityId, roomId } = req.params;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			return next(new UnauthorizedError("Unauthorized!"));
		}

		const community = await Community.findById(communityId);
		if (!community) {
			return next(new NotFoundError("Community not found!"));
		}
		if (!isCommunityAdmin(community, currentUserId.toString())) {
			return next(
				new ForbiddenError("Only admins can delete rooms!"),
			);
		}

		const roomIdx = (community.rooms || []).findIndex(
			(r: any) => r._id.toString() === roomId,
		);
		if (roomIdx === -1) {
			return next(new NotFoundError("Room not found!"));
		}
		if (roomIdx === 0) {
			return next(
				new BadRequestError("The general room cannot be deleted!"),
			);
		}

		community.rooms.splice(roomIdx, 1);
		await community.save();

		// The room's messages die with it (mirrors Discord's channel delete).
		await CommunityMessage.deleteMany({
			community: communityId,
			room: roomId,
		});

		const populated = await Community.findById(communityId)
			.populate("creator", "username fullName profilePic isVerified statusText waitlistPerk")
			.populate("members.user", "username fullName profilePic isVerified statusText waitlistPerk")
			.lean();

		const io = getIO();
		io.to(`community:${communityId}`).emit("community:rooms-updated", {
			communityId,
			community: populated,
		});

		return res.status(200).json({
			success: true,
			message: "Room deleted!",
			community: populated,
		});
	} catch (err: any) {
		logger.error("Error in deleteCommunityRoom", { error: err.message });
		return next(
			err instanceof AppError
				? err
				: new AppError("Internal server error!"),
		);
	}
};


// run sanitizeHtml with empty allowedTags before save

// zod validation: z.string min 3 max 30 for community name

// use findOneAndUpdate with status check to prevent double approval

// convert to lowercase before uniqueness check in DB

// upsert RSVP with unique compound index on event+user
