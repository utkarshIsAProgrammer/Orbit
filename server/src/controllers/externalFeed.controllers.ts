import mongoose from "mongoose";
import type { Request, Response } from "express";
import ExternalPost from "../models/externalPost.model";
import Like from "../models/like.model";
import Save from "../models/saves.model";
import Repost from "../models/repost.model";
import Comment from "../models/comment.model";
import { User } from "../models/user.model";
import { runExternalSyncCycle } from "../services/externalSync";
import { clearByPattern } from "../configs/cache";
import { AppError, BadRequestError, NotFoundError, UnauthorizedError } from "../utilities/errors";
import { logger } from "../utilities/logger";
import { createNotification, extractMentions } from "../utilities/notification";
import { getBlockedUserIds } from "../utilities/blockCheck";

/** Invalidate the user's cached external feed so flags stay fresh. */
const clearUserExternalFeedCache = async (userId: string) => {
  await clearByPattern(`api:${userId}:/api/external/feed*`);
};

/**
 * Attach Orbit-native interaction flags (likedByMe / savedByMe) and filter
 * out posts the user dismissed, when a user is present (optionalAuth).
 */
const enrichWithUserState = async (
  posts: any[],
  userId?: string | mongoose.Types.ObjectId,
): Promise<any[]> => {
  if (!userId || posts.length === 0) return posts;

  const uid = userId.toString();
  const postIds = posts.map((p) => p._id);

  const [likes, saves, reposts, hiddenUser] = await Promise.all([
    Like.find({ author: uid, externalPost: { $in: postIds } })
      .select("externalPost")
      .lean(),
    Save.find({ user: uid, externalPost: { $in: postIds } })
      .select("externalPost")
      .lean(),
    Repost.find({ user: uid, externalPost: { $in: postIds } })
      .select("externalPost")
      .lean(),
    User.findById(uid).select("hiddenExternalPosts").lean(),
  ]);

  const likedSet = new Set(
    likes
      .filter((l) => l.externalPost)
      .map((l) => l.externalPost!.toString()),
  );
  const savedSet = new Set(
    saves
      .filter((s) => s.externalPost)
      .map((s) => s.externalPost!.toString()),
  );
  const repostedSet = new Set(
    reposts
      .filter((r) => r.externalPost)
      .map((r) => r.externalPost!.toString()),
  );
  const hiddenSet = new Set(
    (hiddenUser?.hiddenExternalPosts || []).map((id: any) => id.toString()),
  );

  return posts
    .filter((p) => !hiddenSet.has(p._id.toString()))
    .map((p) => ({
      ...p,
      likedByMe: likedSet.has(p._id.toString()),
      savedByMe: savedSet.has(p._id.toString()),
      repostedByMe: repostedSet.has(p._id.toString()),
    }));
};

/**
 * GET /api/external/feed?source=&cursor=&limit=
 *
 * Returns imported posts from the open social web (Bluesky/Mastodon/Lemmy),
 * newest first, cursor-paginated. Content is read-only syndicated copies —
 * engagement happens on the origin network via the "open original" link.
 * Authenticated users get Orbit-native likedByMe/savedByMe flags plus their
 * hidden-post preferences applied.
 */
export const getExternalFeed = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const cursor = req.query.cursor as string | undefined;
    const source = req.query.source as string | undefined;

    const filter: Record<string, any> = {};
    if (source && ["bluesky", "mastodon", "lemmy"].includes(source)) {
      filter.source = source;
    } else {
      // PeerTube has been removed from the Web feed — keep hiding posts that
      // were synced before the removal so they never resurface.
      filter.source = { $ne: "peertube" };
    }

    // Cursor format: "<originalCreatedAt ISO>|<_id>" — the _id tiebreak keeps
    // pagination exact even when many synced posts share one timestamp.
    if (cursor) {
      const [datePart, idPart] = cursor.split("|");
      const cursorDate = new Date(datePart || "");
      if (Number.isNaN(cursorDate.getTime()) || !/^[a-f0-9]{24}$/.test(idPart || "")) {
        throw new BadRequestError("Invalid cursor!");
      }
      filter.$or = [
        { originalCreatedAt: { $lt: cursorDate } },
        {
          originalCreatedAt: cursorDate,
          _id: { $lt: new mongoose.Types.ObjectId(idPart) },
        },
      ];
    }

    const query = ExternalPost.find(filter).sort({ originalCreatedAt: -1, _id: -1 }).limit(limit);

    const rawPosts = await query.lean();

    let posts = await enrichWithUserState(rawPosts, req.user?._id);

    // If hidden posts were filtered out, fetch one more so the page stays full.
    if (req.user?._id && posts.length < rawPosts.length && posts.length < limit) {
      const extra = await ExternalPost.find(filter)
        .sort({ originalCreatedAt: -1, _id: -1 })
        .skip(limit)
        .limit(limit)
        .lean();
      const extraEnriched = await enrichWithUserState(extra, req.user?._id);
      posts = [...posts, ...extraEnriched].slice(0, limit);
    }

    let nextCursor: string | null = null;
    if (posts.length === limit) {
      const last = posts[posts.length - 1];
      nextCursor =
        last?.originalCreatedAt && last?._id
          ? `${last.originalCreatedAt.toISOString()}|${String(last._id)}`
          : null;
    }

    return res.status(200).json({
      success: true,
      posts,
      nextCursor,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in getExternalFeed!", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

type ExternalPostParams = { postId: string };

/** Shared guard — resolve an external post and check auth. */
const resolveExternalPost = async (req: Request<ExternalPostParams>) => {
  const userId = req.user?._id;
  if (!userId) throw new UnauthorizedError("Unauthorized!");

  const { postId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(postId)) {
    throw new BadRequestError("Invalid post ID!");
  }

  const post = await ExternalPost.findById(postId).select("_id").lean();
  if (!post) throw new NotFoundError("Post not found!");

  return { userId: userId.toString(), postId };
};

/**
 * POST /api/external/posts/:postId/like
 * Toggle an Orbit-native like on an imported open-web post.
 */
export const toggleExternalPostLike = async (req: Request<ExternalPostParams>, res: Response) => {
  try {
    const { userId, postId } = await resolveExternalPost(req);

    const existing = await Like.findOne({ author: userId, externalPost: postId });

    if (existing) {
      await existing.deleteOne();
      // Atomic clamp: $inc and $max can't share a field in one update, so use
      // an aggregation pipeline that decrements and floors at zero together.
      await ExternalPost.updateOne(
        { _id: postId },
        [
          {
            $set: {
              orbitLikesCount: {
                $max: [0, { $add: ["$orbitLikesCount", -1] }],
              },
            },
          },
        ],
        { updatePipeline: true } as any,
      );
      await clearUserExternalFeedCache(userId);
      return res.status(200).json({
        success: true,
        liked: false,
        likedByMe: false,
        orbitLikesCount: await ExternalPost.findById(postId).select("orbitLikesCount").lean().then((p) => p?.orbitLikesCount || 0),
      });
    }

    await Like.create({ author: userId, externalPost: postId });
    const updated = await ExternalPost.findByIdAndUpdate(
      postId,
      { $inc: { orbitLikesCount: 1 } },
      { new: true },
    );
    await clearUserExternalFeedCache(userId);
    return res.status(201).json({
      success: true,
      liked: true,
      likedByMe: true,
      orbitLikesCount: updated?.orbitLikesCount || 1,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error toggling external post like!", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * POST /api/external/posts/:postId/save
 * Toggle an Orbit-native save on an imported open-web post.
 */
export const toggleExternalPostSave = async (req: Request<ExternalPostParams>, res: Response) => {
  try {
    const { userId, postId } = await resolveExternalPost(req);

    const existing = await Save.findOne({ user: userId, externalPost: postId });

    if (existing) {
      await existing.deleteOne();
      await ExternalPost.updateOne(
        { _id: postId },
        [
          {
            $set: {
              orbitSavesCount: {
                $max: [0, { $add: ["$orbitSavesCount", -1] }],
              },
            },
          },
        ],
        { updatePipeline: true } as any,
      );
      await clearUserExternalFeedCache(userId);
      return res.status(200).json({
        success: true,
        saved: false,
        savedByMe: false,
        orbitSavesCount: await ExternalPost.findById(postId).select("orbitSavesCount").lean().then((p) => p?.orbitSavesCount || 0),
      });
    }

    await Save.create({ user: userId, externalPost: postId });
    const updated = await ExternalPost.findByIdAndUpdate(
      postId,
      { $inc: { orbitSavesCount: 1 } },
      { new: true },
    );
    await clearUserExternalFeedCache(userId);
    return res.status(201).json({
      success: true,
      saved: true,
      savedByMe: true,
      orbitSavesCount: updated?.orbitSavesCount || 1,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error toggling external post save!", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * POST /api/external/posts/:postId/hide
 * Content preference — "Not interested" hides an imported post from the
 * user's external feeds (home interleave + Explore Web tab).
 */
export const hideExternalPost = async (req: Request<ExternalPostParams>, res: Response) => {
  try {
    const { userId, postId } = await resolveExternalPost(req);

    await User.findByIdAndUpdate(userId, { $addToSet: { hiddenExternalPosts: postId } });
    await clearUserExternalFeedCache(userId);

    return res.status(200).json({
      success: true,
      message: "Post hidden — we'll show you less like this.",
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error hiding external post!", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * POST /api/external/feed/refresh
 * Manually triggers a sync cycle (rate-limited).
 */
export const refreshExternalFeed = async (_req: Request, res: Response) => {
  try {
    const inserted = await runExternalSyncCycle();
    return res.status(200).json({ success: true, inserted });
  } catch (err: any) {
    logger.error("Error in refreshExternalFeed!", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * POST /api/external/posts/:postId/repost
 * Toggle an Orbit-native repost on an imported open-web post. Mirrors the
 * native repost flow — the Repost collection stores the externalPost ref, so
 * counts stay authoritative and per-user state is a single indexed lookup.
 */
export const toggleExternalPostRepost = async (
  req: Request<ExternalPostParams>,
  res: Response,
) => {
  try {
    const { userId, postId } = await resolveExternalPost(req);

    const existing = await Repost.findOne({ user: userId, externalPost: postId });

    if (existing) {
      await existing.deleteOne();
      await ExternalPost.updateOne(
        { _id: postId },
        [
          {
            $set: {
              orbitRepostsCount: {
                $max: [0, { $add: ["$orbitRepostsCount", -1] }],
              },
            },
          },
        ],
        { updatePipeline: true } as any,
      );
      await clearUserExternalFeedCache(userId);
      return res.status(200).json({
        success: true,
        reposted: false,
        repostedByMe: false,
        orbitRepostsCount: await ExternalPost.findById(postId)
          .select("orbitRepostsCount")
          .lean()
          .then((p) => p?.orbitRepostsCount || 0),
      });
    }

    await Repost.create({ user: userId, externalPost: postId });
    const updated = await ExternalPost.findByIdAndUpdate(
      postId,
      { $inc: { orbitRepostsCount: 1 } },
      { new: true },
    );
    await clearUserExternalFeedCache(userId);
    return res.status(201).json({
      success: true,
      reposted: true,
      repostedByMe: true,
      orbitRepostsCount: updated?.orbitRepostsCount || 1,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error toggling external post repost!", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/** Attach per-viewer `likedByMe` to external comments (mirrors native). */
const attachCommentLikedByMe = async (
  currentUserId: string | undefined,
  comments: any[],
): Promise<any[]> => {
  if (!currentUserId || comments.length === 0) return comments;
  const ids = comments.map((c: any) => c._id);
  const likes = await Like.find({
    author: currentUserId,
    comment: { $in: ids },
  })
    .select("comment")
    .lean();
  const likedSet = new Set(likes.map((l: any) => l.comment.toString()));
  return comments.map((c: any) => ({
    ...c,
    likedByMe: likedSet.has(c._id.toString()),
  }));
};

/**
 * GET /api/external/posts/:postId/comments
 * Top-level comments on an imported open-web post (replies are fetched via
 * the native /api/comments/replies/:commentId endpoint, which is post-agnostic).
 */
export const getExternalPostComments = async (
  req: Request<ExternalPostParams>,
  res: Response,
) => {
  try {
    const { postId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new BadRequestError("Invalid post ID!");
    }
    const post = await ExternalPost.findById(postId).select("_id").lean();
    if (!post) throw new NotFoundError("Post not found!");

    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const cursor = req.query.cursor as string;
    const currentUserId = req.user?._id?.toString();
    const query: any = { externalPost: postId, parent: null };
    if (cursor) query._id = { $lt: cursor };

    // Blocked users must never surface — same parity as native comment lists.
    const blockedIds = currentUserId
      ? await getBlockedUserIds(currentUserId)
      : [];
    if (blockedIds.length > 0) {
      query.author = { $nin: blockedIds };
    }

    const comments = await Comment.find(query)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    const hasMore = comments.length > limit;
    if (hasMore) comments.pop();
    const nextCursor = comments.slice(-1).shift()?._id || null;

    return res.status(200).json({
      success: true,
      comments: await attachCommentLikedByMe(currentUserId, comments),
      nextCursor,
      hasMore,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in getExternalPostComments!", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * POST /api/external/posts/:postId/comments
 * Add a comment (or reply) to an imported open-web post. Mentions are
 * resolved and notified exactly like native comments; the imported post's
 * orbitCommentsCount is incremented (replies bump the parent's repliesCount).
 */
export const addExternalPostComment = async (
  req: Request<ExternalPostParams>,
  res: Response,
) => {
  try {
    const { userId, postId } = await resolveExternalPost(req);
    const content = String(req.body?.content || "").trim();
    const parent = req.body?.parent ? String(req.body.parent) : null;

    if (!content || content.length < 1 || content.length > 1000) {
      throw new BadRequestError(
        "Comment must be between 1 and 1000 characters!",
      );
    }

    // Parent must exist and belong to the SAME external post
    let parentComment: {
      author: mongoose.Types.ObjectId;
      externalPost?: mongoose.Types.ObjectId | null;
    } | null = null;
    if (parent) {
      parentComment = await Comment.findById(parent)
        .select("_id author externalPost")
        .lean();
      if (!parentComment) throw new NotFoundError("Parent comment not found!");
      if (
        !parentComment.externalPost ||
        parentComment.externalPost.toString() !== postId
      ) {
        throw new BadRequestError("Parent comment does not belong to this post!");
      }
    }

    const comment = await Comment.create({
      content,
      author: userId,
      externalPost: postId,
      post: null,
      parent: parent || null,
    });

    const populatedComment = await Comment.findById(comment._id)
      .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    // Increment counts — replies bump the parent's repliesCount
    if (parent) {
      await Comment.findByIdAndUpdate(parent, {
        $inc: { repliesCount: 1 },
      });
    }
    await ExternalPost.findByIdAndUpdate(postId, {
      $inc: { orbitCommentsCount: 1 },
    });

    // Notify mentioned Orbit users (the imported author isn't an Orbit user,
    // so there is no "post author" to notify).
    try {
      const mentionedUserIds = await extractMentions(content);
      for (const mentioned of mentionedUserIds) {
        if (mentioned === userId) continue;
        await createNotification({
          recipient: mentioned,
          sender: userId,
          type: "mention",
          comment: comment._id.toString(),
        });
      }
    } catch (mentionErr) {
      logger.error("Mention notification failed", {
        error: (mentionErr as Error).message,
      });
    }

    await clearUserExternalFeedCache(userId);
    await clearByPattern(`api:*:/api/external/feed*`);

    return res.status(201).json({
      success: true,
      message: "Comment added successfully!",
      comment: populatedComment,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in addExternalPostComment!", { error: err.message });
    throw new AppError("Internal server error!");
  }
};
