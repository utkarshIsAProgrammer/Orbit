import type { Request, Response } from "express";
import mongoose from "mongoose";
import Repost from "../models/repost.model";
import Post from "../models/post.model";
import { User } from "../models/user.model";
import {
  createNotification,
  deleteInteractionNotification,
} from "../utilities/notification";
import { areMutuallyBlocked } from "../utilities/blockCheck";
import { emitPostRepost, emitPostUnrepost } from "../configs/socket";
import { getCache, setCache, clearByPattern, clearFeedCache } from "../configs/cache";
import { logger } from "../utilities/logger";
import { AppError, BadRequestError, NotFoundError, UnauthorizedError, ForbiddenError } from "../utilities/errors";
import { toggleRepostSchema } from "../schemas/interaction.schema";
import { checkBadgesAndNotify } from "../services/badgeService";
import { checkAllRounderBadge } from "../services/badgeService";
import { addUserStatusToPosts } from "../utilities/postStatus";
import { logInteraction } from "../services/affinityService";

type Params = {
  postId: string;
};

export const getRepostedPosts = async (req: Request, res: Response) => {
  const userId = req.user?._id;

  try {
    if (!userId) {
      throw new UnauthorizedError("Unauthorized!");
    }

    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const cursor = req.query.cursor as string;

    const query: any = {
      user: userId,
      // Native posts only — external-post reposts live in the same collection
      // but are surfaced on the imported cards, not in this native list.
      post: { $ne: null },
    };

    if (cursor) {
      query._id = { $lt: cursor };
    }

    // cache key
    const cacheKey = `reposts:${userId}:${cursor || "first"}:${limit}`;

    // try cache first
    try {
      const cached = await getCache(cacheKey);
      if (cached) return res.status(200).json(cached);
    } catch (err: any) {
      logger.error(`Cache error in getRepostedPosts!`, { error: err.message });
    }

    const repostedPosts = await Repost.find(query)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .populate({
        path: "post",		select:
			"content title slug image images video author savesCount repostsCount likesCount commentsCount createdAt viewsCount sharesCount visibility",
        populate: [
          {
            path: "author",
            select: "username fullName email profilePic waitlistPerk",
          },
        ],
      })
      .lean();

    // Filter out closeFriends posts the viewer can no longer see (e.g. the
    // author removed them from closeFriends after the repost). Defensive —
    // reposting itself is already guarded, but list reads must not leak
    // content that later became invisible.
    const currentUserIdStr = userId.toString();
    const cfPostIds = repostedPosts
      .map((r: any) => r.post)
      .filter((p: any) => p && (p as any).visibility === "closeFriends")
      .map((p: any) => p._id.toString());
    if (cfPostIds.length > 0) {
      const cfPosts = await Post.find({ _id: { $in: cfPostIds } })
        .select("_id author")
        .lean();
      const authorIds = [...new Set(cfPosts.map((p: any) => p.author.toString()))];
      const authors = await User.find({ _id: { $in: authorIds } })
        .select("closeFriends")
        .lean();
      const visibleCfIds = new Set<string>();
      for (const p of cfPosts) {
        const author = authors.find((a: any) => a._id.toString() === p.author.toString());
        const isAuthor = p.author.toString() === currentUserIdStr;
        const isCf = (author?.closeFriends || []).some(
          (id: any) => id.toString() === currentUserIdStr,
        );
        if (isAuthor || isCf) visibleCfIds.add(p._id.toString());
      }
      const before = repostedPosts.length;
      const filtered = (repostedPosts as any[]).filter(
        (r: any) =>
          !r.post ||
          (r.post as any).visibility !== "closeFriends" ||
          visibleCfIds.has(r.post._id.toString()),
      );
      if (filtered.length !== before) {
        repostedPosts.splice(0, repostedPosts.length, ...filtered);
      }
    }

    const mappedPosts = repostedPosts.map((repost) => ({
      ...repost.post,
      repostedByMe: true,
    }));

    const posts = await addUserStatusToPosts(mappedPosts, userId.toString());

    if (posts.length === 0) {
      // Cache the empty result too — users with no reposts shouldn't pay the
      // DB + Upstash cost on every visit (the list only changes via toggle).
      const emptyData = {
        success: true,
        message: "No reposted posts!",
        posts: [],
        nextCursor: null,
        hasMore: false,
      };
      try {
        await setCache(cacheKey, emptyData, 60);
      } catch (err: any) {
        logger.error(`Cache set error in getRepostedPosts (empty)!`, { error: err.message });
      }
      return res.status(200).json(emptyData);
    }

    const hasMore = posts.length > limit;

    if (hasMore) {
      posts.pop();
    }

    const nextCursor = repostedPosts.slice(-1).shift()?._id || null;

    const responseData = {
      success: true,
      message: "Reposted posts fetched successfully!",
      posts,
      nextCursor,
      hasMore,
    };

    // set cache (short TTL since reposts can change frequently)
    try {
      await setCache(cacheKey, responseData, 60);
    } catch (err: any) {
      logger.error(`Cache set error in getRepostedPosts!`, { error: err.message });
    }

    return res.status(200).json(responseData);
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in getRepostedPosts controller!`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

export const toggleRepost = async (req: Request<Params>, res: Response) => {
  const userId = req.user?._id;
  const { postId } = req.params;

  try {
    const parsed = toggleRepostSchema.safeParse({ postId });
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message || "Invalid input");
    }

    // auth check
    if (!userId) {
      throw new UnauthorizedError("Unauthorized!");
    }

    // find post
    const post = await Post.findById(postId).select("_id author visibility").lean();

    if (!post) {
      throw new NotFoundError("Post not found!");
    }

    // prevent self repost
    if (post.author.toString() === userId.toString()) {
      throw new BadRequestError("You cannot repost your own post!");
    }

    // Blocked users must not exist for each other — 404 so they can't detect
    // the post either
    if (await areMutuallyBlocked(userId.toString(), post.author.toString())) {
      throw new NotFoundError("Post not found!");
    }

    // check closeFriends permission — return 404 so outsiders can't even
    // detect that the closeFriends post exists
    if ((post as any).visibility === "closeFriends") {
      const authorUser = await User.findById(post.author).select("closeFriends").lean();
      const closeFriendsList = (authorUser as any)?.closeFriends || [];
      const isCloseFriend = closeFriendsList.some((id: any) => id.toString() === userId.toString());
      if (!isCloseFriend) {
        throw new NotFoundError("Post not found!");
      }
    }

    // check existing repost
    const existingRepost = await Repost.findOne({
      user: userId,
      post: postId,
    });

    // un-repost post
    if (existingRepost) {
      await existingRepost.deleteOne();

      await deleteInteractionNotification({
        recipient: post.author.toString(),
        sender: userId.toString(),
        type: "repost",
        post: postId,
      });

      // sync reposts count from Repost collection (authoritative)
      const actualRepostsCount = await Repost.countDocuments({ post: postId });
      const updatedPost = await Post.findByIdAndUpdate(
        postId,
        { $set: { repostsCount: actualRepostsCount } },
        { returnDocument: 'after' },
      );

      // Emit socket event
      if (updatedPost) {
        emitPostUnrepost(postId, userId.toString(), updatedPost.repostsCount);
      }

      // clear repost cache for this user
      clearByPattern(`reposts:${userId.toString()}:*`);
      await clearFeedCache();

      return res.status(200).json({
        success: true,
        message: "Repost removed!",
        reposted: false,
        repostedByMe: false,
        repostsCount: updatedPost?.repostsCount,
        post: updatedPost,
      });
    }

    // re-post post
    await Repost.create({
      user: userId,
      post: postId,
    });

    // Achievement badge (fire-and-forget)
    checkBadgesAndNotify(userId.toString(), "repost").catch(() => {});
      checkAllRounderBadge(userId.toString()).catch(() => {});

    // sync reposts count from Repost collection (authoritative)
    const actualRepostsCount = await Repost.countDocuments({ post: postId });
    const updatedPost = await Post.findByIdAndUpdate(
      postId,
      { $set: { repostsCount: actualRepostsCount } },
      { returnDocument: 'after' },
    );

    await createNotification({
      recipient: post.author.toString(),
      sender: userId.toString(),
      type: "repost",
      post: postId,
    });      // Log interaction for feed ranking
      if (post.author.toString() !== userId.toString()) {
        logInteraction(
          userId.toString(),
          post.author.toString(),
          postId,
          "share",
          (updatedPost as any)?.hashtags || []
        );
      }

      // Emit socket event
      if (updatedPost) {
        emitPostRepost(postId, userId.toString(), updatedPost.repostsCount);
      }

      // clear repost cache for this user
      clearByPattern(`reposts:${userId.toString()}:*`);
      await clearFeedCache();

      return res.status(201).json({
        success: true,
        message: "Repost created!",
        reposted: true,
        repostedByMe: true,
        repostsCount: updatedPost?.repostsCount,
        post: updatedPost,
      });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in toggleRepost controller!`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};
