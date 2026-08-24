import type { Request, Response } from "express";
import mongoose from "mongoose";
import { User } from "../models/user.model";
import Post from "../models/post.model";
import Follow from "../models/follow.model";
import { AppError, UnauthorizedError } from "../utilities/errors";
import { getBlockedUserIds } from "../utilities/blockCheck";
import { addUserStatusToPosts } from "../utilities/postStatus";
import { getCache, setCache } from "../configs/cache";
import { logger } from "../utilities/logger";
import {
  computeScore,
  applyDiversityRanking,
  applyFreshnessGuarantee,
} from "../services/feedService";

/**
 * GET /api/feed/for-you
 * Personalized feed based on affinity scores + recency + diversity.
 */
export const getForYouFeed = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id?.toString();
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit as string) || 10));

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");

    const cacheKey = `feed:for-you:${currentUserId}:${page}:${limit}`;
    const cached = await getCache(cacheKey);
    if (cached) return res.status(200).json(cached);

    const user = await User.findById(currentUserId)
      .select("affinityScores contentAffinity seenPosts followingCount hiddenPosts mutedUsers")
      .lean();

    if (!user) throw new AppError("User not found!");

    const affinityScores = (user as any).affinityScores || {};
    const contentAffinity = (user as any).contentAffinity || {};
    const seenPosts: string[] = (user as any).seenPosts || [];

    // Blocked users must not exist in the feed (either direction)
    const blockedIds = await getBlockedUserIds(currentUserId);
    const blockedSet = new Set(blockedIds);

    // Muted users (30-day window) are also hidden from the For-You feed.
    const now = new Date();
    const mutedIds = (((user as any).mutedUsers || []) as any[])
      .filter((m: any) => m?.user && (!m.expiresAt || new Date(m.expiresAt) > now))
      .map((m: any) => m.user.toString());
    mutedIds.forEach((id) => blockedSet.add(id));

    // Combined exclusion list for query-level $nin filters
    const excludedAuthorIds = [...blockedIds, ...mutedIds];

    // Content preference: exclude posts the user marked "Not interested".
    const hiddenIds: string[] = ((user as any).hiddenPosts || []).map(
      (id: any) => id.toString(),
    );

    // Get author IDs with affinity scores sorted by score descending
    const authorEntries = Object.entries(affinityScores) as [string, number][];
    const weightedAuthors = authorEntries
      .sort(([, a], [, b]) => b - a)
      .slice(0, 50)
      .map(([id]) => new mongoose.Types.ObjectId(id));

    // Get hashtags the user engages with
    const tagEntries = Object.entries(contentAffinity) as [string, number][];
    const topTags = tagEntries
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([tag]) => tag);

    // Build query: posts from weighted authors OR with matching hashtags
    const query: any = {
      _id: { $nin: [
        ...seenPosts.map(id => {
          try { return new mongoose.Types.ObjectId(id); } catch { return id; }
        }),
        ...hiddenIds.map(id => {
          try { return new mongoose.Types.ObjectId(id); } catch { return id; }
        }),
      ] },
      status: "published",
    };
    if (excludedAuthorIds.length > 0) {
      query.author = { $nin: excludedAuthorIds };
    }

    const orConditions: any[] = [];
    if (weightedAuthors.length > 0) {
      const filteredAuthors = weightedAuthors.filter((id) => !blockedSet.has(id.toString()));
      if (filteredAuthors.length > 0) {
        orConditions.push({ author: { $in: filteredAuthors } });
      }
    }
    if (topTags.length > 0) {
      orConditions.push({ hashtags: { $in: topTags } });
    }
    if (orConditions.length > 0) {
      query.$or = orConditions;
    }

    // closeFriends posts must never appear for non-close-friends. Compute the
    // set of authors who have the viewer on their closeFriends list, then
    // require: visibility public OR (closeFriends AND author in that set).
    const closeFriendAuthors = await User.find({ closeFriends: currentUserId })
      .select("_id")
      .lean();
    const cfAuthorIds = closeFriendAuthors.map((u: any) => u._id);
    query.$and = [
      {
        $or: [
          { visibility: "public" },
          { visibility: "closeFriends", author: { $in: cfAuthorIds } },
        ],
      },
    ];

    // PRIVATE accounts: only approved followers may see a private user's
    // posts in the For-You feed (Instagram hides private content from
    // non-followers everywhere). Fetch the private author ids the viewer
    // does NOT follow and exclude their posts.
    const followedIds = await Follow.find({ follower: currentUserId })
      .select("following")
      .lean()
      .then((docs) => docs.map((d) => d.following.toString()));
    const followedSet = new Set(followedIds);
    const privateAuthors = await User.find({ isPrivate: true })
      .select("_id")
      .lean();
    const hiddenPrivateAuthorIds = privateAuthors
      .filter((u: any) => !followedSet.has(u._id.toString()))
      .map((u: any) => u._id);

    if (hiddenPrivateAuthorIds.length > 0) {
      query.author = {
        ...(typeof query.author === "object" && query.author ? query.author : {}),
        $nin: [...(query.author?.$nin || []), ...hiddenPrivateAuthorIds],
      };
    }

    // Fetch candidate posts
    const candidates = await Post.find(query)
      .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
      .sort({ createdAt: -1 })
      .limit(Math.min(page * limit * 3, 120))
      .lean();

    if (candidates.length === 0) {
      // Fallback: latest public posts (still private-gated)
      const fallbackQuery: any = { status: "published", visibility: "public" };
      if (excludedAuthorIds.length > 0) {
        fallbackQuery.author = { $nin: excludedAuthorIds };
      }
      if (hiddenPrivateAuthorIds.length > 0) {
        fallbackQuery.author = {
          ...(typeof fallbackQuery.author === "object" && fallbackQuery.author ? fallbackQuery.author : {}),
          $nin: [...(fallbackQuery.author?.$nin || []), ...hiddenPrivateAuthorIds],
        };
      }
      const fallback = await Post.find(fallbackQuery)
        .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      const withStatus = await addUserStatusToPosts(fallback, currentUserId);
      const result = { success: true, posts: withStatus, hasMore: false, source: "fallback" };
      await setCache(cacheKey, result, 60);
      return res.status(200).json(result);
    }

    // Referral reach boost: collect authors with an active boost so their
    // posts rank higher in the For-You feed while the boost is live.
    const authorIds = candidates
      .map((p: any) => p.author?._id?.toString())
      .filter((id): id is string => Boolean(id));
    const boostedAuthors = new Set<string>();
    if (authorIds.length > 0) {
      const boostedDocs = await User.find({
        _id: { $in: authorIds },
        reachBoostUntil: { $gt: new Date() },
      })
        .select("_id")
        .lean();
      boostedDocs.forEach((d: any) => boostedAuthors.add(d._id.toString()));
    }

    // Followed IDs for the follow-boost signal in the shared scorer
    const followedForYouIds = await Follow.find({ follower: currentUserId })
      .select("following")
      .lean()
      .then((docs) => docs.map((d: any) => d.following.toString()));
    const followedForYouSet = new Set(followedForYouIds);

    // ─── UNIFIED SCORING — identical algorithm to the ranked feed ───
    // (velocity + per-author affinity + content affinity + recency decay +
    //  follow boost + reach boost, then diversity re-rank + freshness
    //  guarantee). Both feeds now run the exact same engine.
    const affinityMap = new Map<string, number>(
      Object.entries(affinityScores)
    );
    const contentAffinityMap = new Map<string, number>(
      Object.entries(contentAffinity)
    );

    let scored = candidates.map((post: any) =>
      computeScore(
        post,
        affinityMap,
        contentAffinityMap,
        followedForYouSet,
        boostedAuthors
      )
    );

    // Sort by score descending (stable tiebreaker: post ID)
    scored.sort((a, b) => {
      const diff = b.score - a.score;
      if (Math.abs(diff) < 0.0001) {
        return (b.post as any)._id.toString().localeCompare((a.post as any)._id.toString());
      }
      return diff;
    });

    // Diversity re-rank + freshness guarantee (same as ranked feed)
    scored = applyDiversityRanking(scored);
    scored = applyFreshnessGuarantee(scored);

    // Real pagination: slice by (page - 1) * limit. The candidate pool is
    // sized to cover the requested page (up to a sane ceiling) so page > 1
    // actually returns different posts instead of repeating page 1.
    const startIdx = (page - 1) * limit;
    const posts = scored.slice(startIdx, startIdx + limit).map((s) => s.post);

    const withStatus = await addUserStatusToPosts(posts, currentUserId);
    const hasMore = startIdx + limit < scored.length;

    const result = {
      success: true,
      posts: withStatus,
      hasMore,
      score: true,
    };

    await setCache(cacheKey, result, 60); // 60 second cache
    return res.status(200).json(result);
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in getForYouFeed", { error: err.message });
    throw new AppError("Internal server error!");
  }
};
