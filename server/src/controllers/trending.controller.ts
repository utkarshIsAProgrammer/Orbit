import type { Request, Response } from "express";
import { User } from "../models/user.model";
import Post from "../models/post.model";
import { AppError } from "../utilities/errors";
import { getCache, setCache } from "../configs/cache";
import { logger } from "../utilities/logger";
import { getBlockedUserIds } from "../utilities/blockCheck";

/**
 * GET /api/trending/users
 * Fastest-growing accounts by follower velocity in the last 7 days.
 */
export const getTrendingUsers = async (req: Request, res: Response) => {
  try {
    // Exclude anyone the current user has blocked (either direction),
    // so the cache key must include the user to avoid leaking blocked users.
    const currentUserId = req.user?._id?.toString();
    const cacheKey = `trending:users:${currentUserId || "anon"}`;
    const cached = await getCache(cacheKey);
    if (cached) return res.status(200).json(cached);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    let blockedIds: string[] = [];
    if (currentUserId) {
      blockedIds = await getBlockedUserIds(currentUserId);
    }
    const usersQuery: any = {
      createdAt: { $lte: sevenDaysAgo },
      followersCount: { $gte: 1 },
      // PRIVATE accounts don't surface in global trending user lists — they
      // are only discoverable via search / follow requests (Instagram-like).
      isPrivate: { $ne: true },
    };
    if (blockedIds.length > 0) {
      usersQuery._id = { $nin: blockedIds };
    }

    const users = await User.find(usersQuery)
      .select("username fullName profilePic bio followersCount createdAt waitlistPerk")
      .sort({ followersCount: -1, createdAt: -1 })
      .limit(20)
      .lean();

    const result = {
      success: true,
      users: users.map((u) => ({
        _id: u._id,
        username: u.username,
        fullName: u.fullName,
        profilePic: u.profilePic,
        bio: u.bio,
        followersCount: u.followersCount,
      })),
    };

    await setCache(cacheKey, result, 300);
    return res.status(200).json(result);
  } catch (err: any) {
    logger.error("Error in getTrendingUsers", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * GET /api/trending/topics
 * Topic clusters beyond hashtags — computed from post content co-occurrence.
 */
export const getTrendingTopics = async (req: Request, res: Response) => {
  try {
    const cacheKey = "trending:topics";
    const cached = await getCache(cacheKey);
    if (cached) return res.status(200).json(cached);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // PRIVATE accounts: a private user's posts must not fuel global trending
    // topics for people who don't follow them (Instagram keeps private content
    // out of all discovery surfaces).
    const privateAuthors = await User.find({ isPrivate: true })
      .select("_id")
      .lean();
    const privateAuthorIds = privateAuthors.map((u: any) => u._id);

    // Aggregate hashtags from recent PUBLIC posts only — closeFriends posts
    // must never surface their hashtags/topics to anyone outside the circle.
    const topics = await Post.aggregate([
      {
        $match: {
          createdAt: { $gte: sevenDaysAgo },
          hashtags: { $exists: true, $not: { $size: 0 } },
          status: "published",
          visibility: "public",
          ...(privateAuthorIds.length > 0 ? { author: { $nin: privateAuthorIds } } : {}),
        },
      },
      { $unwind: "$hashtags" },
      {
        $group: {
          _id: "$hashtags",
          count: { $sum: 1 },
          recentPosts: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 20 },
      {
        $project: {
          tag: "$_id",
          count: 1,
          _id: 0,
        },
      },
    ]);

    const result = {
      success: true,
      topics: topics.map((t) => ({
        tag: t.tag,
        postCount: t.count,
      })),
    };

    await setCache(cacheKey, result, 300);
    return res.status(200).json(result);
  } catch (err: any) {
    logger.error("Error in getTrendingTopics", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

// Redis cache key trending:hashtags with TTL 900s

// read from secondaries to reduce primary load

//  fallback for missing fields in aggregation
