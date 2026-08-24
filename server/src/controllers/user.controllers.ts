import type { Request, Response } from "express";
import mongoose from "mongoose";
import { User } from "../models/user.model";
import { areMutuallyBlocked, getBlockedUserIds } from "../utilities/blockCheck";
import {
	deleteAccountSchema,
	updateProfileSchema,
} from "../schemas/user.schema";
import cloudinary from "../configs/cloudinary";
import { sendDeletionMail } from "../configs/nodeMailer";	import {
	getCache,
	setCache,
	clearUsersCache,
	clearUserByUsernameCache,
	deleteCache,
	clearUserByIdCache,
	clearFeedCache,
	clearByPattern,
	clearUserPostsCache,

} from "../configs/cache";
import { clearMemUserCache } from "../middlewares/auth.middleware";
		import Post from "../models/post.model";
import Comment from "../models/comment.model";
import Like from "../models/like.model";
import Follow from "../models/follow.model";
import FollowRequest from "../models/followRequest.model";
import Save from "../models/saves.model";
import Repost from "../models/repost.model";
import { Conversation } from "../models/conversation.model";
import { Message } from "../models/message.model";
import { env } from "../configs/env";
import { cookieOptions } from "../configs/cookie";
import { logger } from "../utilities/logger";
import {
	AppError,
	BadRequestError,
	NotFoundError,
	UnauthorizedError,
	ForbiddenError,
} from "../utilities/errors";
import { emitUserView, emitUserShare, emitUserUpdated, emitAccountDeleted, emitPostPin, emitPostUnpin, emitFollowUser } from "../configs/socket";
import { progressMission } from "../services/dailyMissionService";
import { checkBadgesAndNotify } from "../services/badgeService";
import { cleanupMedia } from "../services/mediaCleanupService";
import { invalidateFeedCache } from "../services/feedService";
import {
	getUserSuggestions,
	dismissSuggestion as dismissSuggestionForUser,
	getSimilarCreators as getSimilarCreatorsForUser,
} from "../services/recommendationService";
import { deliverForwardToChat } from "../services/chatForwardService";
import { addUserStatusToPosts } from "../utilities/postStatus";
import { createNotification, deleteInteractionNotification } from "../utilities/notification";

type Params = {
	userId: string;
};

/**
 * Strip personally-identifying fields before a user doc leaves the API.
 * The `email` (and OAuth linkage) is only exposed when the viewer IS the
 * owner — public profiles must never leak contact info to scrapers.
 * NOTE: this runs at response time because the `user:*` cache holds the raw
 * doc and is shared across viewers (owner + strangers).
 */
function publicUser(
	user: Record<string, unknown>,
	isOwner: boolean,
): Record<string, unknown> {
	const copy = { ...user };
	if (!isOwner) {
		delete copy.email;
		delete copy.oauthId;
		delete copy.oauthProvider;
		delete copy.knownDevices;
		delete copy.permissionPrefs;
		delete copy.permissionOnboardingCompleted;
		delete copy.permissionOnboardingCompletedAt;
		delete copy.closeFriends;
		delete copy.mutedUsers;
		delete copy.hiddenPosts;
		delete copy.hiddenExternalPosts;
		delete copy.mutedCommunities;
		delete copy.mutedConversations;
		delete copy.communityRoomReads;
		delete copy.affinityScores;
		delete copy.contentAffinity;
		delete copy.seenPosts;
		delete copy.dismissedSuggestionIds;
		delete copy.followRequests;
		delete copy.isAdmin;
	}
	return copy;
}

// get user by id
export const getUserById = async (
	req: Request<{ userId: string }>,
	res: Response,
) => {
	const { userId } = req.params;
	const currentUserId = req.user?._id;
	try {
		if (!mongoose.Types.ObjectId.isValid(userId)) {
			throw new BadRequestError("Invalid user id!");
		}

		const cacheKey = `user:${userId}`;
		let user: unknown = null;

		try {
			const cached = await getCache(cacheKey);
			if (cached) user = cached;
		} catch (e) {
			logger.error(`Cache get error in getUserById!`, { error: e });
		}

		if (!user) {
			user = await User.findById(userId)
				.select("-password -otp -otpExpiry")
				.lean();

			if (!user) {
				throw new NotFoundError("User not found!");
			}

			try {
				await setCache(cacheKey, user, 60 * 30);
			} catch (e) {
				logger.error(`Cache set error in getUserById!`, { error: e });
			}
		}

		// Blocked users must not exist for each other — hide profile entirely
		if (currentUserId && currentUserId.toString() !== userId) {
			if (await areMutuallyBlocked(currentUserId.toString(), userId)) {
				throw new NotFoundError("User not found!");
			}
		}

		let isFollowing = false;
		let followRequestedByMe = false;
		if (currentUserId) {
			const [existingFollow, pendingRequest] = await Promise.all([
				Follow.findOne({
					follower: currentUserId,
					following: userId,
				}).lean(),
				FollowRequest.exists({
					sender: currentUserId,
					recipient: userId,
				}),
			]);
			isFollowing = !!existingFollow;
			followRequestedByMe = !!pendingRequest;
		}

		const isOwner =
			!!currentUserId && currentUserId.toString() === userId;
		const responseData = {
			success: true,
			message: "User fetched successfully!",
			user: {
				...publicUser(user as unknown as Record<string, unknown>, isOwner),
				followingByMe: isFollowing,
				followRequestedByMe,
				pinnedPosts: (user as any).pinnedPosts || [],
			},
		};

		return res.status(200).json(responseData);
	} catch (err: any) {
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in getUserById controller!`, {
			error: err.message,
		});
		throw new AppError("Internal server error!");
	}
};

// get all users
export const getAll = async (req: Request, res: Response) => {
	const currentUserId = req.user?._id;
	try {
		// pagination
		const limit = Math.min(Number(req.query.limit) || 20, 50);
		const cursor = req.query.cursor as string;

		// query
		const query: any = {};

		// if cursor exists fetch older user
		if (cursor) {
			query._id = { $lt: cursor };
		}

		// Blocked users must never appear in any user listing — filter in
		// EITHER block direction (mutual enforcement, WhatsApp-style).
		if (currentUserId) {
			const blockedIds = await getBlockedUserIds(
				currentUserId.toString(),
			);
			if (blockedIds.length > 0) {
				query._id = {
					...(typeof query._id === "object" ? query._id : {}),
					$nin: blockedIds,
				};
			}
		}

		// fetch all users
		const users = await User.find(query)
			.select("-password -otp -otpExpiry")
			.sort({ _id: -1 })
			.limit(limit + 1)
			.lean();

		// check more user exits if limit is applied
		const hasMore = users.length > limit;
		if (hasMore) {
			users.pop();
		}

		// check empty list (user)
		if (users.length === 0) {
			return res.status(200).json({
				success: true,
				message: "No users found!",
				users: [],
				nextCursor: null,
				hasMore: false,
			});
		}

		// get following status for each user
		const followingSet = new Set<string>();
		if (currentUserId && users.length > 0) {
			const userIds = users.map((u) => u._id);
			const existingFollows = await Follow.find({
				follower: currentUserId,
				following: { $in: userIds },
			}).lean();

			existingFollows.forEach((follow) => {
				followingSet.add(follow.following.toString());
			});
		}

		// add followingByMe to each user — public listing never exposes emails
		const usersWithStatus = users.map((user) => ({
			...publicUser(user as unknown as Record<string, unknown>, false),
			followingByMe: followingSet.has(user._id.toString()),
		}));

		// next cursor
		const nextCursor = hasMore ? users.slice(-1).shift()?._id : null;

		// prepare response
		const responseData = {
			success: true,
			message: "All users fetched successfully!",
			users: usersWithStatus,
			nextCursor,
			hasMore,
		};

		// cache the full user list (60s — users list changes infrequently)
		try {
			await setCache(`users:all:${currentUserId?.toString() || "anon"}:${cursor || "first"}:${limit}`, responseData, 60);
		} catch (err: any) {
			logger.error(`Cache set error in getAll users!`, { error: err.message });
		}

		return res.status(200).json(responseData);
	} catch (err: any) {
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in the getAll users controller!`, {
			error: err.message,
		});
		throw new AppError("Internal server error!");
	}
};

// Shared cascade used by the user's own "delete account" flow and by the
// admin panel's delete-user action — both paths clean up exactly the same
// data (media, counts, follows, chats, caches, sockets).
export const deleteUserAndData = async (user: any): Promise<void> => {
	// delete profile pic and banner image from cloudinary
	if (user.profilePic?.public_id) {
		try {
			await cloudinary.uploader.destroy(user.profilePic.public_id);
		} catch (e) {
			logger.error("Cloudinary deletion failed", { error: e });
		}
	}
	if (user.bannerImage?.public_id) {
		try {
			await cloudinary.uploader.destroy(user.bannerImage.public_id);
		} catch (e) {
			logger.error("Cloudinary deletion failed", { error: e });
		}
	}

	// handle orphaned cloudinary images from posts
	const userPosts = await Post.find({ author: (user as any)._id }).select(
		"image images",
	);
	const imageDeletions = userPosts.flatMap((post) => {
		const promises = [];
		if (post.image?.public_id) {
			promises.push(
				cloudinary.uploader.destroy(post.image.public_id),
			);
		}
		if (post.images && Array.isArray(post.images)) {
			for (const img of post.images) {
				if (img.public_id) {
					promises.push(
						cloudinary.uploader.destroy(img.public_id),
					);
				}
			}
		}
		return promises;
	});

	await Promise.allSettled(imageDeletions).then((results) => {
		results.forEach((result) => {
			if (result.status === "rejected") {
				logger.error("Cloudinary deletion failed for post image", {
					error: result.reason,
				});
			}
		});
	});

	// ── Clean up follow relationships and fix counts on other users ──
	// 1. Users that the deleted user was FOLLOWING → decrement their followersCount
	const usersBeingFollowed = await Follow.find({
		follower: (user as any)._id,
	}).select("following");
	if (usersBeingFollowed.length > 0) {
		const followingIds = usersBeingFollowed.map((f) => f.following);
		await User.updateMany(
			{ _id: { $in: followingIds } },
			{ $inc: { followersCount: -1 } },
		);
	}

	// 2. Users who were FOLLOWING the deleted user → decrement their followingCount
	const usersFollowingDeleted = await Follow.find({
		following: (user as any)._id,
	}).select("follower");
	if (usersFollowingDeleted.length > 0) {
		const followerIds = usersFollowingDeleted.map((f) => f.follower);
		await User.updateMany(
			{ _id: { $in: followerIds } },
			{ $inc: { followingCount: -1 } },
		);
	}

	// 3. Prevent negative counts (safety clamp)
	await User.updateMany(
		{ followersCount: { $lt: 0 } },
		{ $set: { followersCount: 0 } },
	);
	await User.updateMany(
		{ followingCount: { $lt: 0 } },
		{ $set: { followingCount: 0 } },
	);

	// 4. Update Post counts for deleted interactions
	const userComments = await Comment.aggregate([
		{
			$match: {
				author: (user as any)._id,
			},
		},
		{ $group: { _id: "$post", count: { $sum: 1 } } },
	]);
	for (const stat of userComments) {
		await Post.updateOne(
			{ _id: stat._id },
			{ $inc: { commentsCount: -stat.count } },
		);
	}

	const userLikes = await Like.aggregate([
		{
			$match: {
				author: (user as any)._id,
				post: { $ne: null },
			},
		},
		{ $group: { _id: "$post", count: { $sum: 1 } } },
	]);
	for (const stat of userLikes) {
		await Post.updateOne(
			{ _id: stat._id },
			{ $inc: { likesCount: -stat.count } },
		);
	}

	const userSaves = await Save.aggregate([
		{ $match: { user: (user as any)._id } },
		{ $group: { _id: "$post", count: { $sum: 1 } } },
	]);
	for (const stat of userSaves) {
		await Post.updateOne(
			{ _id: stat._id },
			{ $inc: { savesCount: -stat.count } },
		);
	}

	const userReposts = await Repost.aggregate([
		{ $match: { user: (user as any)._id } },
		{ $group: { _id: "$post", count: { $sum: 1 } } },
	]);
	for (const stat of userReposts) {
		await Post.updateOne(
			{ _id: stat._id },
			{ $inc: { repostsCount: -stat.count } },
		);
	}

	// Safety clamp for post counts
	const postNegativeFields = [
		"commentsCount",
		"likesCount",
		"savesCount",
		"repostsCount",
	];
	for (const field of postNegativeFields) {
		await Post.updateMany(
			{ [field]: { $lt: 0 } },
			{ $set: { [field]: 0 } },
		);
	}

	// Delete orphaned data
	await Post.deleteMany({ author: (user as any)._id });
	await Comment.deleteMany({ author: (user as any)._id });
	await Like.deleteMany({ author: (user as any)._id });
	await Save.deleteMany({ user: (user as any)._id });
	await Repost.deleteMany({ user: (user as any)._id });
	await Follow.deleteMany({
		$or: [{ follower: (user as any)._id }, { following: (user as any)._id }],
	});

	// Clean up direct chat data (Conversations, Messages, and attachments)
	const userConversations = await Conversation.find({
		participants: (user as any)._id,
	});
	const userConversationIds = userConversations.map((c) => c._id);

	if (userConversationIds.length > 0) {
		// Find messages with attachments to delete them from Cloudinary
		const messagesWithAttachments = await Message.find({
			conversation: { $in: userConversationIds },
			"attachments.0": { $exists: true },
		})
			.select("attachments")
			.lean();

		const chatCloudinaryDeletions = messagesWithAttachments.flatMap(
			(msg) =>
				(msg.attachments || [])
					.map((att) => att.public_id)
					.filter(Boolean)
					.map((pubId) => cloudinary.uploader.destroy(pubId)),
		);

		await Promise.allSettled(chatCloudinaryDeletions).then(
			(results) => {
				results.forEach((res) => {
					if (res.status === "rejected") {
						logger.error(
							"Cloudinary deletion failed for chat message attachment",
							{
								error: res.reason,
							},
						);
					}
				});
			},
		);

		// Delete messages and conversations
		await Message.deleteMany({
			conversation: { $in: userConversationIds },
		});
		await Conversation.deleteMany({
			_id: { $in: userConversationIds },
		});
	}

	await User.findByIdAndDelete(user._id);

	// clear users and session cache
	await clearUsersCache();
	await deleteCache(`auth:user:${user._id}`);
	clearMemUserCache(String(user._id));
	await deleteCache(`presence:user:${user._id}`);
	// Clear all user-related caches
	await deleteCache(`user:${user._id}`);
	await deleteCache(`posts:author:${user._id}`);
	await deleteCache(`saves:user:${user._id}`);
	await deleteCache(`user:username:${user.username}`);

	// Emit account deletion event so connected clients can clean up in real-time
	emitAccountDeleted(user._id.toString());
};

// delete account
export const deleteAccount = async (req: Request, res: Response) => {
	const result = deleteAccountSchema.safeParse(req.body);

	try {
		if (!result.success) {
			throw new BadRequestError(
				result.error.issues[0]?.message || "Invalid Data",
			);
		}

		// get user id from the auth middleware
		const userId = req.user?._id;

		// find user and verify credentials — must match authenticated user
		const user = await User.findById(userId);
		if (!user) {
			throw new NotFoundError("User not found!");
		}

		// enforce that submitted email matches the authenticated user
		if (user.email !== result.data.email) {
			throw new ForbiddenError("Email does not match your account!");
		}

		const isMatch = await user.comparePassword(result.data.password);
		if (!isMatch) {
			throw new BadRequestError("Invalid credentials!");
		}

		// Purge the account's data on a BullMQ worker when configured (the
		// wipe is seconds of Cloudinary destroys + ~15 collection deletes —
		// it used to block the response). Falls back to running inline when
		// REDIS_URL isn't set. The JWT cookie is cleared below either way,
		// so the user can't act during the background purge.
		const { enqueueAccountDeletion } = await import("../configs/queue");
		const queued = await enqueueAccountDeletion(user._id.toString());
		if (!queued) {
			await deleteUserAndData(user);
		}

		// send account deletion email
		sendDeletionMail({
			email: user.email,
			username: user.username,
		});

		// clear cookies
		res.clearCookie("jwt", { ...cookieOptions, path: "/" });
		res.clearCookie("csrf-token", { path: "/", secure: env.NODE_ENV === "production", sameSite: "lax" });

		res.status(200).json({
			success: true,
			message: "Account deleted successfully!",
		});
	} catch (err: any) {
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in the deleteAccount controller!`, {
			error: err.message,
		});
		throw new AppError("Internal server error!");
	}
};

// share profile
export const shareProfile = async (req: Request<Params>, res: Response) => {
	const { userId } = req.params;

	try {
		// validate id
		if (!mongoose.Types.ObjectId.isValid(userId)) {
			throw new BadRequestError("Invalid user id!");
		}

		// increment share count
		const user = await User.findByIdAndUpdate(
			userId,
			{
				$inc: { sharesCount: 1 },
			},
			{ returnDocument: 'after' },
		);
		if (!user) {
			throw new NotFoundError("User not found!");
		}

		// emit share socket event
		emitUserShare(userId, user.sharesCount);

		// generate url
		const shareUrl = `${env.CLIENT_URL}/user/${user.username}`;

		res.status(200).json({
			success: true,
			message: "Profile shared successfully!",
			shares: user.sharesCount,
			shareUrl,
		});
	} catch (err: any) {
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in the shareProfile controller!`, {
			error: err.message,
		});
		throw new AppError("Internal server error!");
	}
};

// forward a profile to another user — notifies the recipient in-app
// (notification center + badge) and via device push.
export const forwardProfile = async (req: Request<Params>, res: Response) => {
	const { userId } = req.params;
	const senderId = req.user?._id;
	const { recipientId } = req.body || {};

	try {
		if (!senderId) {
			throw new UnauthorizedError("Unauthorized!");
		}

		if (!mongoose.Types.ObjectId.isValid(userId)) {
			throw new BadRequestError("Invalid user id!");
		}

		if (!recipientId || !mongoose.Types.ObjectId.isValid(recipientId)) {
			throw new BadRequestError("Invalid recipient!");
		}

		if (senderId.toString() === recipientId) {
			throw new BadRequestError("Cannot forward a profile to yourself!");
		}

		// the shared profile must exist
		const sharedUser = await User.findById(userId)
			.select("_id username fullName profilePic waitlistPerk")
			.lean();
		if (!sharedUser) {
			throw new NotFoundError("User not found!");
		}

		// the recipient must exist
		const recipient = await User.findById(recipientId).select("_id").lean();
		if (!recipient) {
			throw new BadRequestError("Recipient not found!");
		}

		// count the forward as a share
		const updated = await User.findByIdAndUpdate(
			userId,
			{ $inc: { sharesCount: 1 } },
			{ returnDocument: "after" },
		);

		// emit realtime share-count update (same as shareProfile)
		if (updated?.sharesCount !== undefined) {
			emitUserShare(userId, updated.sharesCount);
		}

		// Notify the recipient. createNotification internally drops the
		// notification if the sharer and recipient are mutually blocked.
		// Additionally skip it when the recipient is mutually blocked with
		// the SHARED profile's owner — otherwise they'd get a dead-end
		// notification pointing at a profile that 404s for them.
		if (!(await areMutuallyBlocked(recipientId, userId))) {
			await createNotification({
				recipient: recipientId,
				sender: senderId.toString(),
				type: "profile_share",
				user: userId,
			});
		}

		// WhatsApp/Instagram behavior: the forward ALSO lands as a real chat
		// message in the 1:1 conversation (created if needed), so the
		// recipient sees it in their chat and the sender sees the
		// conversation in their chat list.
		if (!(await areMutuallyBlocked(recipientId, userId))) {
			const link = `${env.CLIENT_URL}/user/${sharedUser.username}`;
			const displayName = sharedUser.fullName || `@${sharedUser.username}`;
			await deliverForwardToChat({
				senderId: senderId.toString(),
				recipientId: recipientId.toString(),
				text: `Shared a profile: ${displayName}\n${link}`,
				attachment: sharedUser.profilePic?.url
					? { url: sharedUser.profilePic.url, type: "image" }
					: undefined,
			});
		}

		res.status(200).json({
			success: true,
			message: "Profile forwarded successfully!",
			shares: updated?.sharesCount,
		});
	} catch (err: any) {
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in the forwardProfile controller!`, {
			error: err.message,
		});
		throw new AppError("Internal server error!");
	}
};

export const viewsCount = async (req: Request<Params>, res: Response) => {
	const { userId } = req.params;
	const currentUser = req.user?._id;

	try {
		// validate post
		if (!mongoose.Types.ObjectId.isValid(userId)) {
			throw new BadRequestError("Invalid user Id!");
		}

		// check post exists
		const profile = await User.findById(userId)
			.select("_id viewsCount")
			.lean();
		if (!profile) {
			throw new NotFoundError("Profile not found!");
		}

		// check self view
		if (currentUser && profile._id.toString() === currentUser.toString()) {
			return res.status(200).json({
				success: true,
				message: "Own profile view ignored!",
				views: profile.viewsCount,
			});
		}

		// increment profile views count
		const updatedProfile = await User.findByIdAndUpdate(
			userId,
			{
				$inc: { viewsCount: 1 },
			},
			{ returnDocument: 'after' },
		);    // Progress profile_view mission (fire-and-forget)
    if (currentUser) {
      progressMission(currentUser.toString(), "profile_view").catch(() => {});
    }

    // emit real-time view update
    if (updatedProfile?.viewsCount) {
      emitUserView(userId, updatedProfile.viewsCount);
    }

    return res.status(200).json({
      success: true,
      message: "View counted successfully!",
			views: updatedProfile?.viewsCount,
		});
	} catch (err: any) {
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in the viewsCount controller!`, {
			error: err.message,
		});
		throw new AppError("Internal server error!");
	}
};

// get user by username
export const getUserByUsername = async (
	req: Request<{ username: string }>,
	res: Response,
) => {
	const { username } = req.params;
	const currentUserId = req.user?._id;
	try {
		const cacheKey = `user:username:${username}`;
		let user: unknown = null;
		let fromCache = false;

		try {
			const cached = await getCache(cacheKey);
			if (cached) {
				user = cached;
				fromCache = true;
			}
		} catch (e) {
			logger.error(`Cache get error in getUserByUsername!`, { error: e });
		}

		if (!user) {
			user = await User.findOne({ username })
				.select("-password -otp -otpExpiry")
				.lean();

			if (!user) {
				throw new NotFoundError("User not found!");
			}

			try {
				await setCache(cacheKey, user, 60 * 30);
			} catch (e) {
				logger.error(`Cache set error in getUserByUsername!`, { error: e });
			}
		}

		// Run every remaining lookup in parallel — the block check, the follow
		// status and both count queries share no dependencies, so batching them
		// collapses ~4 sequential DB round-trips into one. This is the hot path
		// for every profile view, so it matters for perceived load speed.
		const targetId = (user as any)._id;
		const isSelf =
			currentUserId && targetId?.toString() === currentUserId.toString();

		const [mutuallyBlocked, existingFollow, pendingRequest, actualFollowers, actualFollowing] =
			await Promise.all([
				!isSelf && currentUserId
					? areMutuallyBlocked(currentUserId.toString(), targetId?.toString())
					: Promise.resolve(false),
				currentUserId
					? Follow.findOne({ follower: currentUserId, following: targetId }).lean()
					: Promise.resolve(null),
				currentUserId
					? FollowRequest.exists({ sender: currentUserId, recipient: targetId })
					: Promise.resolve(false),
				Follow.countDocuments({ following: targetId }),
				Follow.countDocuments({ follower: targetId }),
			]);

		// Blocked users must not exist for each other — hide profile entirely
		if (mutuallyBlocked) {
			throw new NotFoundError("User not found!");
		}

		const isFollowing = !!existingFollow;

		const responseData = {
			success: true,
			message: "User fetched successfully!",
			user: {
				...publicUser(
					user as unknown as Record<string, unknown>,
					!!currentUserId &&
						targetId?.toString() === currentUserId.toString(),
				),
				followersCount: actualFollowers,
				followingCount: actualFollowing,
				followingByMe: isFollowing,
				followRequestedByMe: !!pendingRequest,
				pinnedPosts: (user as any).pinnedPosts || [],
			},
		};

		return res.status(200).json(responseData);
	} catch (err: any) {
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in getUserByUsername controller!`, {
			error: err.message,
		});
		throw new AppError("Internal server error!");
	}
};

// get user's posts
export const getUserPosts = async (
	req: Request<{ userId: string }>,
	res: Response,
) => {
	const { userId } = req.params;
	try {
		const limit = Math.min(Number(req.query.limit) || 10, 20);
		const cursor = req.query.cursor as string;
		const currentUserId = req.user?._id?.toString();
		// The cache is shared across users but the post list differs per viewer:
		// closeFriends posts are only visible to the author + their close friends,
		// and blocked users must see nothing. Include the viewer in the key so a
		// warm cache can never leak a closer view to an outsider / blocked user.
		const cacheKey = `user:${userId}:posts:${cursor || "first"}:${limit}:${currentUserId || "anon"}`;


		let postsData: any = null;

		try {
			const cached = await getCache(cacheKey);
			if (cached) postsData = cached;
		} catch (err: any) {
			logger.error(`Cache error in getUserPosts!`, {
				error: err.message,
			});
		}

		if (!postsData) {
			if (!mongoose.Types.ObjectId.isValid(userId)) {
				throw new BadRequestError("Invalid user id!");
			}

		const query: any = { author: userId, status: "published" };
		if (cursor) {
			query._id = { $lt: cursor };
		}

		// Blocked users must not exist for each other, and closeFriends posts
		// are hidden from everyone else — run all pre-checks in parallel so
		// the posts query isn't delayed by sequential lookups. PRIVATE accounts
		// are also gated: only approved followers (and the author) can see the
		// post list, exactly like Instagram.
		const [mutuallyBlocked, authorUser] = await Promise.all([
			currentUserId && currentUserId !== userId
				? areMutuallyBlocked(currentUserId, userId)
				: Promise.resolve(false),
			currentUserId !== userId
				? User.findById(userId).select("closeFriends isPrivate").lean()
				: Promise.resolve(null),
		]);

		if (mutuallyBlocked) {
			return res.status(200).json({
				success: true,
				posts: [],
				nextCursor: null,
				hasMore: false,
			});
		}

		// Private account → non-followers get an empty (locked) grid. The
		// client renders the Instagram-style "This account is private" screen
		// from the profile payload; this is the server-side hard gate.
		const isSelfView = !currentUserId || currentUserId === userId;
		if ((authorUser as any)?.isPrivate && !isSelfView) {
			const isFollower = await Follow.exists({
				follower: currentUserId,
				following: userId,
			});
			if (!isFollower) {
				return res.status(200).json({
					success: true,
					posts: [],
					nextCursor: null,
					hasMore: false,
					isPrivateLocked: true,
				});
			}
		}

		// Enforce closeFriends privacy when viewed by non-owners
			const closeFriendsList = (authorUser as any)?.closeFriends || [];
			const isCloseFriend = currentUserId
				? closeFriendsList.some((id: any) => id.toString() === currentUserId)
				: false;

			if (!isCloseFriend) {
				query.visibility = "public";
			}

			const posts = await Post.find(query)
				.sort({ _id: -1 })
				.limit(limit + 1)
				.populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
				.lean();

			const hasMore = posts.length > limit;
			if (hasMore) {
				posts.pop();
			}

			const nextCursor = posts.slice(-1).shift()?._id || null;

			postsData = {
				posts,
				nextCursor,
				hasMore,
			};

			try {
				await setCache(cacheKey, postsData, 60 * 30);
			} catch (err: any) {
				logger.error(`Cache set error in getUserPosts!`, {
					error: err.message,
				});
			}
		}

		// Add user status to posts AFTER cache retrieval
		const postsWithStatus = await addUserStatusToPosts(
			postsData.posts,
			currentUserId,
		);

		const responseData = {
			success: true,
			message: postsWithStatus.length
				? "User posts fetched successfully!"
				: "No posts yet!",
			posts: postsWithStatus,
			nextCursor: postsData.nextCursor,
			hasMore: postsData.hasMore,
		};

		return res.status(200).json(responseData);
	} catch (err: any) {
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in getUserPosts controller!`, {
			error: err.message,
		});
		throw new AppError("Internal server error!");
	}
};

// ─── Hybrid recommendation engine (who to follow) ─────────────────
// Powered by recommendationService: friend-of-friend graph + interaction
// affinity + creator quality + recency, with a cold-start fallback and a
// skip/dismiss feedback loop. Each entry carries a `reason` and a
// `mutualFollowersCount` so the UI can explain the recommendation.
export const getSuggestedUsers = async (req: Request, res: Response) => {
	const currentUserId = req.user?._id;

	try {
		const limit = Math.min(Number(req.query.limit) || 5, 10);

		if (!currentUserId) {
			throw new UnauthorizedError("Unauthorized!");
		}

		const suggestions = await getUserSuggestions(
			currentUserId.toString(),
			limit
		);

		return res.status(200).json({
			success: true,
			users: suggestions,
		});
	} catch (err: any) {
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in getSuggestedUsers controller!`, {
			error: err.message,
		});
		throw new AppError("Internal server error!");
	}
};

// ─── Skip / dismiss a suggestion (feedback loop) ──────────────────
export const dismissSuggestion = async (req: Request, res: Response) => {
	const currentUserId = req.user?._id;
	const { userId } = req.body as { userId?: string };

	try {
		if (!currentUserId) {
			throw new UnauthorizedError("Unauthorized!");
		}
		if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
			throw new BadRequestError("Invalid user id!");
		}

		await dismissSuggestionForUser(currentUserId.toString(), userId);

		// Also invalidate the route-level cache middleware entries for this
		// viewer's /suggestions responses.
		await clearByPattern(`api:${currentUserId.toString()}:/suggestions`);

		return res.status(200).json({
			success: true,
			message: "Suggestion dismissed!",
		});
	} catch (err: any) {
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in dismissSuggestion controller!`, {
			error: err.message,
		});
		throw new AppError("Internal server error!");
	}
};

// ─── Similar creators ("More creators like this" on profiles) ─────
export const getSimilarCreators = async (
	req: Request<{ userId: string }>,
	res: Response
) => {
	const currentUserId = req.user?._id;
	const targetUserId = req.params.userId;

	try {
		if (!currentUserId) {
			throw new UnauthorizedError("Unauthorized!");
		}
		if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
			throw new BadRequestError("Invalid user id!");
		}

		const limit = Math.min(Number(req.query.limit) || 6, 10);
		const creators = await getSimilarCreatorsForUser(
			currentUserId.toString(),
			targetUserId,
			limit
		);

		return res.status(200).json({
			success: true,
			users: creators,
		});
	} catch (err: any) {
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in getSimilarCreators controller!`, {
			error: err.message,
		});
		throw new AppError("Internal server error!");
	}
};

// pin a post to profile
export const pinPost = async (req: Request<Params>, res: Response) => {
	const { userId } = req.params;
	const { postId } = req.body;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			throw new UnauthorizedError("Unauthorized!");
		}

		// only allow pinning own profile
		if (currentUserId.toString() !== userId) {
			throw new ForbiddenError("Forbidden!");
		}

		if (!mongoose.Types.ObjectId.isValid(postId)) {
			throw new BadRequestError("Invalid post ID!");
		}

		// verify post exists and belongs to user
		const post = await Post.findById(postId).select("author").lean();
		if (!post) {
			throw new NotFoundError("Post not found!");
		}
		if (post.author.toString() !== userId) {
			throw new BadRequestError("Cannot pin another user's post!");
		}

		const user = await User.findById(userId);
		if (!user) {
			throw new NotFoundError("User not found!");
		}

		const pinned = (user as any).pinnedPosts || [];

		// check if already pinned
		if (pinned.some((id: any) => id.toString() === postId)) {
			throw new BadRequestError("Post already pinned!");
		}

		if (pinned.length >= 3) {
			throw new BadRequestError("Maximum 3 pinned posts allowed!");
		}

		// Append the new post ID — previously this assigned the unchanged old
		// array, so pinning silently did nothing.
		const nextPinned = [...pinned, new mongoose.Types.ObjectId(postId)];
		user.pinnedPosts = nextPinned;
		await user.save();

		// Invalidate caches so the PINNED badge, the three-dot menu label and the
		// posts grid reflect the change immediately (previously getPinnedPosts's
		// `user:${userId}:pinned` cache (300s) and the route-level api:* caches
		// served stale pinned state — and a second click errored "already pinned"
		// even though the pin had succeeded).
		await Promise.all([
			clearByPattern(`user:${userId}:pinned`),
			clearUserPostsCache(userId),
			clearByPattern(`api:*${userId}*pinned*`),
			clearByPattern(`api:*${userId}*posts*`),
		]);

		// Emit real-time pin event
		emitPostPin(postId, userId);

		return res.status(200).json({
			success: true,
			message: "Post pinned successfully!",
			pinnedPosts: user.pinnedPosts,
		});
	} catch (err: any) {
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in pinPost controller!`, { error: err.message });
		throw new AppError("Internal server error!");
	}
};

// unpin a post from profile
export const unpinPost = async (req: Request<Params>, res: Response) => {
	const { userId } = req.params;
	const { postId } = req.body;
	const currentUserId = req.user?._id;

	try {
		if (!currentUserId) {
			throw new UnauthorizedError("Unauthorized!");
		}

		if (currentUserId.toString() !== userId) {
			throw new ForbiddenError("Forbidden!");
		}

		if (!mongoose.Types.ObjectId.isValid(postId)) {
			throw new BadRequestError("Invalid post ID!");
		}

		const user = await User.findById(userId);
		if (!user) {
			throw new NotFoundError("User not found!");
		}

		const pinned = (user as any).pinnedPosts || [];
		const filtered = pinned.filter((id: any) => id.toString() !== postId);

		if (filtered.length === pinned.length) {
			throw new BadRequestError("Post is not pinned!");
		}

		(user as any).pinnedPosts = filtered;
		await user.save();

		// Invalidate caches so the PINNED badge, the three-dot menu label and the
		// posts grid drop the pin immediately. Without this, getPinnedPosts served
		// the stale `user:${userId}:pinned` cache (300s TTL) — the badge and menu
		// still said "pinned" after reload, and a second click errored with
		// "Post is not pinned!" even though the DB row was already unpinned.
		await Promise.all([
			clearByPattern(`user:${userId}:pinned`),
			clearUserPostsCache(userId),
			clearByPattern(`api:*${userId}*pinned*`),
			clearByPattern(`api:*${userId}*posts*`),
		]);

		// Emit real-time unpin event
		emitPostUnpin(postId, userId);

		return res.status(200).json({
			success: true,
			message: "Post unpinned successfully!",
			pinnedPosts: user.pinnedPosts,
		});
	} catch (err: any) {
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in unpinPost controller!`, { error: err.message });
		throw new AppError("Internal server error!");
	}
};

// get pinned posts for a user
export const getPinnedPosts = async (req: Request<Params>, res: Response) => {
	const { userId } = req.params;
	const currentUserId = req.user?._id?.toString();

	try {
		if (!mongoose.Types.ObjectId.isValid(userId)) {
			throw new BadRequestError("Invalid user ID!");
		}

		// PRIVATE accounts: non-followers must not see pinned posts either —
		// the pinned grid is part of the private profile surface (Instagram
		// hides the whole grid behind the follow gate). This gate runs BEFORE
		// the cache read because the `user:${userId}:pinned` cache is shared
		// across viewers — a follower's warm entry would otherwise leak the
		// private grid to an outsider until the TTL expired.
		const pinnedOwner = await User.findById(userId)
			.select("isPrivate")
			.lean();
		if (!pinnedOwner) {
			throw new NotFoundError("User not found!");
		}
		if (
			currentUserId &&
			currentUserId !== userId &&
			(pinnedOwner as any)?.isPrivate
		) {
			const isFollower = await Follow.exists({
				follower: currentUserId,
				following: userId,
			});
			if (!isFollower) {
				return res.status(200).json({ success: true, posts: [] });
			}
		}

		// cache key
		const cacheKey = `user:${userId}:pinned`;
		try {
			const cached = await getCache(cacheKey);
			if (cached) return res.status(200).json(cached);
		} catch (err: any) {
			logger.error(`Cache error in getPinnedPosts!`, { error: err.message });
		}

		const user = await User.findById(userId).select("pinnedPosts").lean();
		if (!user) {
			throw new NotFoundError("User not found!");
		}

		const pinnedIds = (user as any).pinnedPosts || [];
		if (pinnedIds.length === 0) {
			return res.status(200).json({ success: true, posts: [] });
		}

		const posts = await Post.find({ _id: { $in: pinnedIds } })
			.populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
			.lean();

		const postsWithStatus = await addUserStatusToPosts(
			posts,
			currentUserId,
		);

		// preserve pinned order and add pinnedByMe flag
		const orderedPosts = pinnedIds
			.map((id: any) =>
				postsWithStatus.find((p) => p._id.toString() === id.toString()),
			)
			.filter(Boolean)
			.map((post: any) => ({
				...post,
				pinnedByMe: true,
			}));

		const responseData = {
			success: true,
			posts: orderedPosts,
		};

		// set cache (5 min — pinned posts rarely change)
		try {
			await setCache(cacheKey, responseData, 300);
		} catch (err: any) {
			logger.error(`Cache set error in getPinnedPosts!`, { error: err.message });
		}

		return res.status(200).json(responseData);
	} catch (err: any) {
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in getPinnedPosts controller!`, {
			error: err.message,
		});
		throw new AppError("Internal server error!");
	}
};

// ─── Private account: follow request / approve / decline ───────────
// List pending follow requests sent TO the current user (the owner of a
// private account). Used by the Instagram-style requests inbox on the
// profile. Newest first.
export const getPendingFollowRequests = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");

    const requests = await FollowRequest.find({ recipient: currentUserId })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("sender", "_id username fullName profilePic bio followersCount followingCount waitlistPerk")
      .lean();

    return res.status(200).json({
      success: true,
      requests: requests.map((r: any) => ({
        _id: r._id,
        createdAt: r.createdAt,
        sender: r.sender,
      })),
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in getPendingFollowRequests controller!`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

export const sendFollowRequest = async (req: Request<Params>, res: Response) => {
  const currentUserId = req.user?._id;
  const { userId } = req.params;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");
    if (!mongoose.Types.ObjectId.isValid(userId)) throw new BadRequestError("Invalid user ID!");
    if (currentUserId.toString() === userId) throw new BadRequestError("Cannot follow yourself!");

    const targetUser = await User.findById(userId).select("isPrivate").lean();
    if (!targetUser) throw new NotFoundError("User not found!");

    if ((targetUser as any).isPrivate) {
      // Check for existing pending request in the FollowRequest collection
      const alreadyRequested = await FollowRequest.exists({
        sender: currentUserId,
        recipient: userId,
      });

      if (alreadyRequested) {
        return res.status(200).json({ success: true, message: "Follow request already sent!" });
      }

      await FollowRequest.create({
        sender: currentUserId,
        recipient: userId,
      });

      await createNotification({
        recipient: userId,
        sender: currentUserId.toString(),
        type: "follow_request",
      });

      return res.status(200).json({ success: true, message: "Follow request sent!", isPrivate: true });
    } else {
      // Public account — fall through to existing toggleFollowUser logic
      // This endpoint is only for private accounts; public accounts use the regular follow
      return res.status(200).json({ success: true, message: "User account is public, use the follow button!", isPrivate: false });
    }
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in sendFollowRequest controller!`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

export const approveFollowRequest = async (req: Request<Params>, res: Response) => {
  const currentUserId = req.user?._id;
  const { userId } = req.params;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");
    if (!mongoose.Types.ObjectId.isValid(userId)) throw new BadRequestError("Invalid user ID!");

    // Check that the current user has a pending request from userId
    const pendingRequest = await FollowRequest.findOneAndDelete({
      sender: userId,
      recipient: currentUserId,
    });

    if (!pendingRequest) throw new BadRequestError("No pending follow request from this user!");

    // Create the follow relationship
    await Follow.create({ follower: userId, following: currentUserId });

    // Update counts
    const [targetFollowers, followerFollowing] = await Promise.all([
      Follow.countDocuments({ following: currentUserId }),
      Follow.countDocuments({ follower: userId }),
    ]);

    await User.findByIdAndUpdate(currentUserId, { $set: { followersCount: targetFollowers } });
    await User.findByIdAndUpdate(userId, { $set: { followingCount: followerFollowing } });

    // Notify the requester that they were approved
    await createNotification({
      recipient: userId,
      sender: currentUserId.toString(),
      type: "follow",
    });

    // Remove the stale "wants to follow you" notification + caches so the
    // approved follower's feed picks up the private account's posts and both
    // profiles show correct follow state immediately.
    await deleteInteractionNotification({
      recipient: currentUserId.toString(),
      sender: userId,
      type: "follow_request",
    });
    await Promise.all([
      invalidateFeedCache(userId.toString()),
      clearUserByIdCache(currentUserId.toString()),
      clearUserByUsernameCache(userId),
      clearUserByIdCache(userId),
      clearByPattern(`api:${userId}:/api/users/*`),
      clearByPattern(`api:${currentUserId.toString()}:/api/users/*`),
    ]);

    // Emit follow event so the requester's UI updates in real-time
    const owner = await User.findById(currentUserId).select("followersCount").lean();
    if (owner) {
      emitFollowUser(
        currentUserId.toString(),
        userId,
        owner.followersCount || 0,
        followerFollowing,
      );
    }

    return res.status(200).json({ success: true, message: "Follow request approved!" });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in approveFollowRequest controller!`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

export const declineFollowRequest = async (req: Request<Params>, res: Response) => {
  const currentUserId = req.user?._id;
  const { userId } = req.params;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");
    if (!mongoose.Types.ObjectId.isValid(userId)) throw new BadRequestError("Invalid user ID!");

    const deleted = await FollowRequest.findOneAndDelete({
      sender: userId,
      recipient: currentUserId,
    });

    if (!deleted) throw new BadRequestError("No pending follow request from this user!");

    // Remove the stale "wants to follow you" notification + profile caches.
    await deleteInteractionNotification({
      recipient: currentUserId.toString(),
      sender: userId,
      type: "follow_request",
    });
    await Promise.all([
      clearUserByIdCache(currentUserId.toString()),
      clearByPattern(`api:${currentUserId.toString()}:/api/users/*`),
    ]);

    return res.status(200).json({ success: true, message: "Follow request declined!" });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in declineFollowRequest controller!`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

// update profile
export const updateProfile = async (req: Request, res: Response) => {
	const result = updateProfileSchema.safeParse(req.body);

	const cleanupFiles = async (filesObj: any) => {
		if (!filesObj) return;
		const files = filesObj as { [fieldname: string]: any[] };
		const pPic = files.profilePic?.[0];
		const bImg = files.bannerImage?.[0];

		if (pPic?.filename) {
			try {
				await cloudinary.uploader.destroy(pPic.filename);
			} catch (e) {
				logger.error("Cloudinary deletion failed", { error: e });
			}
		}
		if (bImg?.filename) {
			try {
				await cloudinary.uploader.destroy(bImg.filename);
			} catch (e) {
				logger.error("Cloudinary deletion failed", { error: e });
			}
		}
	};

	try {
		if (!result.success) {
			await cleanupFiles(req.files);
			throw new BadRequestError(
				result.error.issues[0]?.message || "Invalid data",
			);
		}

		const userId = req.user?._id;
		const user = await User.findById(userId);

		if (!user) {
			await cleanupFiles(req.files);
			throw new NotFoundError("User not found!");
		}

		// check if username exists
		if (result.data.username && result.data.username !== user.username) {
			const userExists = await User.findOne({
				username: result.data.username,
			});
			if (userExists) {
				await cleanupFiles(req.files);
				throw new BadRequestError("Username already exists!");
			}
		}

		// Check explicit deletion flags first
		const updateData: any = { ...result.data };
		delete updateData.removeProfilePic;
		delete updateData.removeBannerImage;

		// Cloudinary deletes are external HTTP — they must never block the
		// profile-save response. Old media cleanup is fire-and-forget, via the
		// BullMQ media-cleanup worker when configured (inline otherwise).
		const fireForgetDestroy = (publicId: string | undefined) => {
			if (!publicId) return;
			void cleanupMedia([publicId]);
		};

		// Remove profile pic
		if (result.data.removeProfilePic) {
			fireForgetDestroy(user.profilePic?.public_id);
			updateData.profilePic = { url: "", public_id: "" };
		}

		// Remove banner image
		if (result.data.removeBannerImage) {
			fireForgetDestroy(user.bannerImage?.public_id);
			updateData.bannerImage = { url: "", public_id: "" };
		}

		if (req.files) {
			const files = req.files as { [fieldname: string]: any[] };
			const newProfilePic = files.profilePic?.[0];
			const newBannerImg = files.bannerImage?.[0];

			if (newProfilePic) {
				// The old pic is replaced — delete it in the background, never
				// block the save on it.
				fireForgetDestroy(user.profilePic?.public_id);
				updateData.profilePic = {
					url: newProfilePic.path,
					public_id: newProfilePic.filename,
				};
			}

			if (newBannerImg) {
				fireForgetDestroy(user.bannerImage?.public_id);
				updateData.bannerImage = {
					url: newBannerImg.path,
					public_id: newBannerImg.filename,
				};
			}
		}

		const updatedUser = await User.findByIdAndUpdate(user._id, updateData, {
			returnDocument: 'after',
		});
	// Achievement badges (fire-and-forget): complete-profile check
	if (updatedUser) {
		checkBadgesAndNotify(userId?.toString() || "", "profile").catch(() => {});
	}

		// update cache — every entry is independent, so evict them in ONE
		// parallel batch instead of ~6 sequential Redis round-trips. allSettled
		// keeps a cache hiccup from 500-ing a save that already succeeded.
		clearMemUserCache(String(user._id));
		const cacheTasks: Promise<any>[] = [
			clearUsersCache(),
			clearFeedCache(),
			deleteCache(`auth:user:${user._id}`),
			clearUserByIdCache(user._id.toString()),
		];
		if (user.username) {
			cacheTasks.push(clearUserByUsernameCache(user.username));
		}
		if (updatedUser?.username && updatedUser.username !== user.username) {
			cacheTasks.push(clearUserByUsernameCache(updatedUser.username));
		}
		await Promise.allSettled(cacheTasks);

		// Emit real-time profile update event so other users see changes instantly
		// (incl. isPrivate — the privacy toggle in Settings must propagate to
		// the owner's own client without a reload).
		if (updatedUser) {
			emitUserUpdated({
				_id: updatedUser._id,
				fullName: updatedUser.fullName,
				username: updatedUser.username,
				email: updatedUser.email,
				gender: updatedUser.gender,
				bio: updatedUser.bio,
				profilePic: updatedUser.profilePic,
				bannerImage: updatedUser.bannerImage,
				isPrivate: updatedUser.isPrivate,
				isOnboarded: updatedUser.isOnboarded,
				notificationsEnabled: updatedUser.notificationsEnabled,
			});
		}

		return res.status(200).json({
			success: true,
			message: "Profile updated successfully!",
			user: {
				_id: updatedUser?._id,
				fullName: updatedUser?.fullName,
				username: updatedUser?.username,
				email: updatedUser?.email,
				gender: updatedUser?.gender,
				bio: updatedUser?.bio,
				profilePic: updatedUser?.profilePic,
				bannerImage: updatedUser?.bannerImage,
			},
		});
	} catch (err: any) {
		await cleanupFiles(req.files);
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in the updateProfile controller!`, {
			error: err.message,
		});
		throw new AppError("Internal server error!");
	}
};
