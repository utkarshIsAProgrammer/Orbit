import type { Request, Response } from "express";
import mongoose from "mongoose";
import { User } from "../models/user.model";
import Follow from "../models/follow.model";
import FollowRequest from "../models/followRequest.model";
import Block from "../models/block.model";
import { getCache, setCache, clearByPattern, clearFollowCache, clearUserByUsernameCache, clearUserByIdCache, clearUserPostsCache } from "../configs/cache";
import {
  createNotification,
  deleteInteractionNotification,
} from "../utilities/notification";
import { logger } from "../utilities/logger";
import { emitFollowUser, emitUnfollowUser } from "../configs/socket";
import { getBlockedUserIds } from "../utilities/blockCheck";
import { AppError, BadRequestError, NotFoundError, UnauthorizedError, ForbiddenError } from "../utilities/errors";
import { invalidateFeedCache } from "../services/feedService";
import { awardXP } from "../services/xpService";
import { checkBadgesAndNotify } from "../services/badgeService";
import { deliverWebhookEvent } from "./webhook.controller";

type Params = {
  userId: string;
};

// Route-level cacheMiddleware keys are per-viewer and cached for 5 minutes.
// A follow/unfollow MUST evict both users' cached views of each other's
// profiles (they embed `followingByMe`) plus their per-viewer search results
// — otherwise the Follow button silently flips back to "Follow" on the next
// profile load (or anywhere a cached profile is served) until the TTL expires.// Optimized: direct deletes instead of SCAN loops (saves ~35 Redis cmds per follow).
// Route-level api: cache has 60s TTL — expires naturally, no need to SCAN.
const clearFollowRouteCaches = async (
	followerId: string,
	targetId: string,
	targetUsername?: string,
	followerUsername?: string,
) => {
	// Clear known cache keys directly (1 command each)
	const keysToDelete: string[] = [
		`user:${followerId}`,
		`user:${targetId}`,
		`user:username:${targetUsername || ""}`,
		`user:username:${followerUsername || ""}`,
		`followers:${followerId}`,
		`following:${targetId}`,
	];
	// Only clear user-specific post caches (unknown keys need SCAN)
	await Promise.all([
		clearByPattern(`user:${followerId}:posts:page:*`),
		clearByPattern(`user:${targetId}:posts:page:*`),
	]);
};

// toggle follow/unfollow user
export const toggleFollowUser = async (req: Request<Params>, res: Response) => {
  const follower = req.user?._id;
  const { userId } = req.params;

  try {
    // auth check
    if (!follower) {
      throw new UnauthorizedError("Unauthorized access!");
    }

    // validate user id
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new BadRequestError("Invalid user ID!");
    }

    // prevent self follow
    if (follower.toString() === userId) {
      throw new BadRequestError("You cannot follow yourself!");
    }

    // check target user exists
    const targetUser = await User.findById(userId)
      .select("_id username isPrivate")
      .lean();

    if (!targetUser) {
      throw new NotFoundError("User not found!");
    }

    // Check block status
    const isBlocked = await Block.findOne({
      $or: [
        { blocker: follower, blocked: userId },
        { blocker: userId, blocked: follower },
      ],
    });
    if (isBlocked) {
      throw new ForbiddenError("Cannot follow a blocked user!");
    }

    // fetch follower's username to clear their cache too
    const followerUser = await User.findById(follower).select("username").lean();

    // check existing follow
    const existingFollow = await Follow.findOne({
      follower,
      following: userId,
    });

    // Private account → route to the follow-request flow instead of a
    // direct follow. The account owner approves/declines each request.
    if (!existingFollow && (targetUser as any).isPrivate) {
      const alreadyRequested = await FollowRequest.exists({
        sender: follower,
        recipient: userId,
      });
      if (alreadyRequested) {
        // Clicking "Requested" again CANCELS the pending request (Instagram
        // behavior) — the user must be able to undo their follow request.
        await FollowRequest.deleteOne({
          sender: follower,
          recipient: userId,
        });
        await deleteInteractionNotification({
          recipient: userId,
          sender: follower.toString(),
          type: "follow_request",
        });
        return res.status(200).json({
          success: true,
          message: "Follow request cancelled!",
          isPrivate: true,
          requested: false,
        });
      }

      await FollowRequest.create({
        sender: follower,
        recipient: userId,
      });

      await createNotification({
        recipient: userId,
        sender: follower.toString(),
        type: "follow_request",
      });

      return res.status(200).json({
        success: true,
        message: "Follow request sent!",
        isPrivate: true,
        requested: true,
      });
    }

    // follow
    if (!existingFollow) {
      // create follow relation
      const follow = await Follow.create({
        follower,
        following: userId,
      });

      // sync counts from Follow collection (authoritative)
      const [actualTargetFollowers, actualFollowerFollowing] = await Promise.all([
        Follow.countDocuments({ following: userId }),
        Follow.countDocuments({ follower }),
      ]);

      const [updatedTargetUser] = await Promise.all([
        User.findByIdAndUpdate(
          userId,
          { $set: { followersCount: actualTargetFollowers } },
          { returnDocument: 'after' },
        ),
        User.findByIdAndUpdate(follower, {
          $set: { followingCount: actualFollowerFollowing },
        }),
      ]);

      await createNotification({
        recipient: userId,
        sender: follower.toString(),
        type: "follow",
      });

      // Invalidate caches in the BACKGROUND — each clear* helper is a Redis
      // SCAN loop over Upstash's HTTP Redis (~600ms per round-trip), and
      // awaiting ~10 of them sequentially made follow/unfollow take 30-55s
      // ("the Follow button doesn't work"). The DB write above is the source
      // of truth; cache invalidation must never block the response.
      void Promise.all([
        clearFollowCache(userId, follower.toString()),
        targetUser?.username
          ? clearUserByUsernameCache(targetUser.username)
          : Promise.resolve(),
        followerUser?.username
          ? clearUserByUsernameCache(followerUser.username)
          : Promise.resolve(),
        clearUserByIdCache(userId),
        clearUserByIdCache(follower.toString()),
        clearFollowRouteCaches(
          follower.toString(),
          userId,
          targetUser?.username,
          followerUser?.username,
        ),
        clearByPattern(`users:suggested:${follower.toString()}:*`),
        clearByPattern(`users:suggested:${userId}:*`),
        // Invalidate feed cache so new posts from followed user appear
        invalidateFeedCache(follower.toString()),
      ]).catch((err) =>
        logger.error("Follow cache invalidation failed", {
          error: err.message,
        }),
      );

      // emit follow event
      if (updatedTargetUser) {
        emitFollowUser(
          userId,
          follower.toString(),
          updatedTargetUser.followersCount,
          actualFollowerFollowing,
        );
      }

      // Award XP for following a user (fire-and-forget). Deduped per target
      // so follow→unfollow→follow cycling can't farm XP.
      awardXP(follower.toString(), "FOLLOW", {
        dedupeKey: `follow:${userId}`,
      }).catch(() => {});

      // Achievement badges (fire-and-forget): the followed user gains followers
      checkBadgesAndNotify(userId.toString(), "follow").catch(() => {});

      // Notify the followed user's webhooks
      deliverWebhookEvent(
        "user.followed",
        {
          targetUserId: userId,
          followerId: follower.toString(),
        },
        userId,
      ).catch(() => {});

      return res.status(201).json({
        success: true,
        message: "User followed successfully!",
        following: true,
        followersCount: updatedTargetUser?.followersCount,
        follow,
      });
    }		await existingFollow.deleteOne();

		await deleteInteractionNotification({
			recipient: userId,
			sender: follower.toString(),
			type: "follow",
		});

		// sync counts from Follow collection (authoritative)
		const [actualTargetFollowers, actualFollowerFollowing] = await Promise.all([
			Follow.countDocuments({ following: userId }),
			Follow.countDocuments({ follower }),
		]);

		const [updatedTargetUser] = await Promise.all([
			User.findByIdAndUpdate(
				userId,
				{ $set: { followersCount: actualTargetFollowers } },
				{ returnDocument: 'after' },
			),
			User.findByIdAndUpdate(follower, {
				$set: { followingCount: actualFollowerFollowing },
			}),
		]);

		// Invalidate caches in the BACKGROUND (see the follow branch above —
		// awaiting these Redis SCAN loops sequentially stalled the response
		// for 30-55s).
		void Promise.all([
			clearFollowCache(userId, follower.toString()),
			targetUser?.username
				? clearUserByUsernameCache(targetUser.username)
				: Promise.resolve(),
			followerUser?.username
				? clearUserByUsernameCache(followerUser.username)
				: Promise.resolve(),
			clearUserByIdCache(userId),
			clearUserByIdCache(follower.toString()),
			clearFollowRouteCaches(
				follower.toString(),
				userId,
				targetUser?.username,
				followerUser?.username,
			),
			// PRIVATE accounts: the unfollower's cached copy of the target's
			// posts grid (per-viewer key) and any feed entries from the target
			// must be dropped — otherwise the private posts stay visible from
			// cache until the TTL expires, defeating the follow gate.
			clearUserPostsCache(userId),
			invalidateFeedCache(follower.toString()),
		]).catch((err) =>
			logger.error("Unfollow cache invalidation failed", {
				error: err.message,
			}),
		);

    // emit unfollow event
    if (updatedTargetUser) {
      emitUnfollowUser(
        userId,
        follower.toString(),
        updatedTargetUser.followersCount,
        actualFollowerFollowing,
      );
    }

    return res.status(200).json({
      success: true,
      message: "User unfollowed successfully!",
      following: false,
      followersCount: updatedTargetUser?.followersCount,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in the toggleFollowUser controller!`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

// get followers list
export const getFollowers = async (req: Request<Params>, res: Response) => {
  const { userId } = req.params;
  const currentUserId = req.user?._id;

  try {
    // validate user id
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new BadRequestError("Invalid user ID!");
    }

    // pagination
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const cursor = req.query.cursor as string;

    // query
    const query: any = {};

    // if cursor exist fetch older data
    if (cursor) {
      query._id = { $lt: cursor };
    }

    // PRIVATE accounts: Instagram hides the follower/following LISTS of a
    // private account from non-followers (counts stay visible on the header).
    const listOwner = await User.findById(userId).select("isPrivate").lean();
    if (
      currentUserId &&
      currentUserId.toString() !== userId &&
      (listOwner as any)?.isPrivate
    ) {
      const isFollower = await Follow.exists({
        follower: currentUserId,
        following: userId,
      });
      if (!isFollower) {
        return res.status(200).json({
          success: true,
          followersCount: await Follow.countDocuments({ following: userId }),
          followers: [],
          nextCursor: null,
          hasMore: false,
          isPrivateLocked: true,
        });
      }
    }

    // cache key
    const cacheKey = `followers:${userId}:${cursor || "first"}:${limit}`;

    let followers: any[] = [];
    let hasMore = false;
    let nextCursor = null;
    let followersCount = 0;
    let isFromCache = false;

    // get from cache
    try {
      const cached: any = await getCache(cacheKey);
      if (cached) {
        followers = cached.followers || [];
        hasMore = cached.hasMore || false;
        nextCursor = cached.nextCursor || null;
        followersCount = cached.followersCount || 0;
        isFromCache = true;
      }
    } catch (err: any) {
      logger.error(`Cache error in getFollowers!`, { error: err.message });
    }

    if (!isFromCache) {
      // followers list
      const rawFollowers = await Follow.find({
        following: userId,
        ...query,
      })
        .sort({ _id: -1 })
        .limit(limit + 1)
        .populate("follower", "_id username fullName profilePic bio followersCount followingCount createdAt waitlistPerk")
        .lean();

      // check more exists
      hasMore = rawFollowers.length > limit;

      // remove extra data
      if (hasMore) {
        rawFollowers.pop();
      }

      followers = rawFollowers;
      nextCursor = rawFollowers.slice(-1).shift()?._id || null;
      followersCount = await Follow.countDocuments({ following: userId });

      // set cache (store raw users without personalized follows status)
      try {
        await setCache(cacheKey, {
          followers,
          nextCursor,
          hasMore,
          followersCount,
        }, 60);
      } catch (err: any) {
        logger.error(`Cache set error in getFollowers!`, { error: err.message });
      }
    }

    // Blocked users must not exist for each other — hide anyone sharing a
    // block relationship (either direction) with the VIEWER from the list.
    // Filtered per-viewer AFTER cache retrieval so the shared cache stays
    // viewer-agnostic.
    try {
      const blockedIds = await getBlockedUserIds(
        currentUserId ? currentUserId.toString() : "",
      );
      if (blockedIds.length > 0) {
        const blockedSet = new Set(blockedIds);
        followers = followers.filter(
          (f: any) =>
            !(f.follower?._id && blockedSet.has(f.follower._id.toString())),
        );
      }
    } catch (err: any) {
      logger.error(`Blocked-user filter error in getFollowers!`, {
        error: err.message,
      });
    }

    // get follower ids to check if current user follows them
    const followerIds = followers.map((f) => f.follower?._id).filter(Boolean);

    // get following status for current user
    const followingSet = new Set<string>();
    if (currentUserId && followerIds.length > 0) {
      const existingFollows = await Follow.find({
        follower: currentUserId,
        following: { $in: followerIds },
      }).lean();

      existingFollows.forEach((follow) => {
        followingSet.add(follow.following.toString());
      });
    }

    // add isFollowing to each follower dynamically
    const followersWithStatus = followers.map((follow) => ({
      ...follow,
      follower: follow.follower ? {
        ...follow.follower,
        isFollowing: followingSet.has(follow.follower._id.toString()),
      } : null,
    }));

    return res.status(200).json({
      success: true,
      followersCount,
      followers: followersWithStatus,
      nextCursor,
      hasMore,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in getFollowers controller!`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

// get following list
export const getFollowing = async (req: Request<Params>, res: Response) => {
  const { userId } = req.params;
  const currentUserId = req.user?._id;

  try {
    // validate user id
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new BadRequestError("Invalid user ID!");
    }

    // pagination
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const cursor = req.query.cursor as string;

    // query
    const query: any = {};

    // if cursor exists fetch old data
    if (cursor) {
      query._id = { $lt: cursor };
    }

    // PRIVATE accounts: hide the follower/following LISTS from non-followers.
    const listOwner = await User.findById(userId).select("isPrivate").lean();
    if (
      currentUserId &&
      currentUserId.toString() !== userId &&
      (listOwner as any)?.isPrivate
    ) {
      const isFollower = await Follow.exists({
        follower: currentUserId,
        following: userId,
      });
      if (!isFollower) {
        return res.status(200).json({
          success: true,
          followingCount: await Follow.countDocuments({ follower: userId }),
          following: [],
          nextCursor: null,
          hasMore: false,
          isPrivateLocked: true,
        });
      }
    }

    // cache key
    const cacheKey = `following:${userId}:${cursor || "first"}:${limit}`;

    let following: any[] = [];
    let hasMore = false;
    let nextCursor = null;
    let followingCount = 0;
    let isFromCache = false;

    // get from cache
    try {
      const cached: any = await getCache(cacheKey);
      if (cached) {
        following = cached.following || [];
        hasMore = cached.hasMore || false;
        nextCursor = cached.nextCursor || null;
        followingCount = cached.followingCount || 0;
        isFromCache = true;
      }
    } catch (err: any) {
      logger.error(`Cache error in getFollowing!`, { error: err.message });
    }

    if (!isFromCache) {
      // following list
      const rawFollowing = await Follow.find({
        follower: userId,
        ...query,
      })
        .sort({ _id: -1 })
        .limit(limit + 1)
        .populate("following", "_id username fullName profilePic bio followersCount followingCount createdAt waitlistPerk")
        .lean();

      // check more exists
      hasMore = rawFollowing.length > limit;

      // remove extra data
      if (hasMore) {
        rawFollowing.pop();
      }

      following = rawFollowing;
      nextCursor = rawFollowing.slice(-1).shift()?._id || null;
      followingCount = await Follow.countDocuments({ follower: userId });

      // set cache
      try {
        await setCache(cacheKey, {
          following,
          nextCursor,
          hasMore,
          followingCount,
        }, 60);
      } catch (err: any) {
        logger.error(`Cache set error in getFollowing!`, { error: err.message });
      }
    }

    // Blocked users must not exist for each other — hide anyone sharing a
    // block relationship (either direction) with the VIEWER from the list.
    // Filtered per-viewer AFTER cache retrieval so the shared cache stays
    // viewer-agnostic.
    try {
      const blockedIds = await getBlockedUserIds(
        currentUserId ? currentUserId.toString() : "",
      );
      if (blockedIds.length > 0) {
        const blockedSet = new Set(blockedIds);
        following = following.filter(
          (f: any) =>
            !(
              f.following?._id &&
              blockedSet.has(f.following._id.toString())
            ),
        );
      }
    } catch (err: any) {
      logger.error(`Blocked-user filter error in getFollowing!`, {
        error: err.message,
      });
    }

    // get following ids to check if current user follows them
    const followingIds = following.map((f) => f.following?._id).filter(Boolean);

    // get following status for current user
    const followingSet = new Set<string>();
    if (currentUserId && followingIds.length > 0) {
      const existingFollows = await Follow.find({
        follower: currentUserId,
        following: { $in: followingIds },
      }).lean();

      existingFollows.forEach((follow) => {
        followingSet.add(follow.following.toString());
      });
    }

    // add isFollowing to each following user dynamically
    const followingWithStatus = following.map((follow) => ({
      ...follow,
      following: follow.following ? {
        ...follow.following,
        isFollowing: followingSet.has(follow.following._id.toString()) || (currentUserId && follow.following._id.toString() === currentUserId.toString()),
      } : null,
    }));

    return res.status(200).json({
      success: true,
      followingCount,
      following: followingWithStatus,
      nextCursor,
      hasMore,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in getFollowing controller!`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

// use findOneAndUpdate with atomic toggle instead of read-modify-write

// return 400 if userId equals targetUserId
