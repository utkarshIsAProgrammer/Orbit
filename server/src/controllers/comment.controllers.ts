import type { Request, Response } from "express";
import mongoose from "mongoose";
import Comment from "../models/comment.model";
import Post from "../models/post.model";
import ExternalPost from "../models/externalPost.model";
import { env } from "../configs/env";
import Like from "../models/like.model";
import Notification from "../models/notification.model";
import { User } from "../models/user.model";
import {
  addCommentSchema,
  updateCommentSchema,
} from "../schemas/comment.schema";
import { getCache, setCache, clearCommentsCache, clearByPattern } from "../configs/cache";
import { createNotification, extractMentions } from "../utilities/notification";
import { areMutuallyBlocked, getBlockedUserIds } from "../utilities/blockCheck";
import { sanitizePlainText } from "../configs/sanitize";
import { emitPostComment, emitCommentReply, emitCommentDeleted, emitCommentUpdated } from "../configs/socket";
import { logInteraction } from "../services/affinityService";
import { awardXP } from "../services/xpService";
import { checkBadgesAndNotify } from "../services/badgeService";
import { checkAllRounderBadge } from "../services/badgeService";
import { progressMission } from "../services/dailyMissionService";
import { deliverForwardToChat } from "../services/chatForwardService";
import { deliverWebhookEvent } from "./webhook.controller";
import { logger } from "../utilities/logger";
import { AppError, BadRequestError, NotFoundError, UnauthorizedError, ForbiddenError } from "../utilities/errors";
import { canInteractWithPost } from "../utilities/postVisibility";

type Params = {
  postId: string;
};

type CommentParams = {
  commentId: string;
};

// forward a comment to another user — notifies the recipient in-app
// (notification center + badge) and via device push.
export const forwardComment = async (
  req: Request<CommentParams>,
  res: Response,
) => {
  const { commentId } = req.params;
  const senderId = req.user?._id;
  const { recipientId } = req.body || {};

  try {
    if (!senderId) throw new UnauthorizedError("Unauthorized!");

    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      throw new BadRequestError("Invalid comment ID!");
    }

    if (!recipientId || !mongoose.Types.ObjectId.isValid(recipientId)) {
      throw new BadRequestError("Invalid recipient!");
    }

    if (senderId.toString() === recipientId) {
      throw new BadRequestError("Cannot forward a comment to yourself!");
    }

    const comment = await Comment.findById(commentId)
      .select("_id author post content")
      .lean();
    if (!comment) {
      throw new NotFoundError("Comment not found!");
    }

    const recipient = await User.findById(recipientId).select("_id").lean();
    if (!recipient) {
      throw new BadRequestError("Recipient not found!");
    }

    // The RECIPIENT must be able to view the comment's parent post — a
    // closeFriends post's comment forwarded to an outsider would leak the
    // comment text into a notification AND point at content they can't open.
    let recipientCanView = true;
    if (comment.post) {
      const { allowed } = await canInteractWithPost(
        comment.post.toString(),
        recipientId,
      );
      recipientCanView = allowed;
    }

    // Skipped when the recipient is mutually blocked with the comment author
    if (
      recipientCanView &&
      !(await areMutuallyBlocked(recipientId, comment.author.toString()))
    ) {
      await createNotification({
        recipient: recipientId,
        sender: senderId.toString(),
        type: "comment_share",
        comment: commentId,
      });
    }

    // WhatsApp/Instagram behavior: the forward ALSO lands as a real chat
    // message in the 1:1 conversation (created if needed), so the recipient
    // sees it in their chat and the sender sees the conversation in their
    // chat list. Gated on the SAME combined condition as the notification
    // (recipient can view AND not mutually blocked with the comment author).
    if (
      recipientCanView &&
      !(await areMutuallyBlocked(recipientId, comment.author.toString()))
    ) {
      let postLink = "";
      if (comment.post) {
        const parentPost = await Post.findById(comment.post)
          .select("slug")
          .lean();
        if (parentPost?.slug) {
          postLink = `${env.CLIENT_URL}/post/${parentPost.slug}`;
        }
      }
      const snippet = ((comment as any).content || "Comment").slice(0, 120);
      await deliverForwardToChat({
        senderId: senderId.toString(),
        recipientId: recipientId.toString(),
        text: `Shared a comment: ${snippet}${postLink ? `\n${postLink}` : ""}`,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Comment forwarded successfully!",
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in forwardComment controller!`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

// Attach per-viewer `likedByMe` to a list of comments so the client can
// restore the liked (colored) heart state after a refresh. Like documents
// live in their own collection, so this is one batched lookup per request.
const attachLikedByMe = async (
  currentUserId: string | undefined,
  comments: any[],
): Promise<any[]> => {
  if (!currentUserId || comments.length === 0) return comments;
  const ids = comments.map((c: any) => c._id);
  const likes = await Like.find({ author: currentUserId, comment: { $in: ids } })
    .select("comment")
    .lean();
  const likedSet = new Set(likes.map((l: any) => l.comment.toString()));
  return comments.map((c: any) => ({
    ...c,
    likedByMe: likedSet.has(c._id.toString()),
  }));
};

// Get all comments for a specific post (including replies)
export const getAllCommentsForPost = async (req: Request<Params>, res: Response) => {
  const { postId } = req.params;

  try {
    // validate id
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new BadRequestError("Invalid post ID!");
    }

    // closeFriends posts are invisible to non-close-friends — their comment
    // threads must be too (404 so outsiders can't even detect the post). The
    // visibility check + block list are independent — run them CONCURRENTLY to
    // cut a Mongo round-trip off the cold-cache path.
    const currentUserId = req.user?._id?.toString();
    const [{ allowed }, blockedIds] = await Promise.all([
      canInteractWithPost(postId, currentUserId),
      currentUserId
        ? getBlockedUserIds(currentUserId)
        : Promise.resolve([] as string[]),
    ]);
    if (!allowed) {
      throw new NotFoundError("Post not found!");
    }

    // Blocked users must not exist — filter out comments from anyone blocked
    // in either direction. Because results are per-viewer, the cache key must
    // include the viewer's ID (otherwise one user's filtered list would be
    // served to another user).
    const cacheKey = `comments:all:${postId}:${currentUserId || "anon"}`;

    // get from cache
    try {
      const cachedComments = await getCache(cacheKey);
      if (cachedComments) return res.status(200).json(cachedComments);
    } catch (err: any) {
      logger.error(`Cache error in getAllCommentsForPost!`, { error: err.message });
    }

    let blockedCommentIds: string[] = [];
    if (blockedIds.length > 0) {
      const blockedComments = await Comment.find({ post: postId, author: { $in: blockedIds } })
        .select("_id")
        .lean();
      blockedCommentIds = blockedComments.map((c) => c._id.toString());
    }

    // fetch ALL comments for this post (including replies) with author info
    const comments = await Comment.find({ post: postId })
      .sort({ _id: -1 })
      .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    // Filter out comments (and their reply subtrees) from blocked users
    const blockedSet = new Set(blockedCommentIds);
    const isBlockedSubtree = (c: any): boolean => {
      if (blockedSet.has(c._id.toString())) return true;
      if (c.parent && blockedSet.has(c.parent.toString())) return true;
      return false;
    };
    const filteredComments = comments.filter((c) => !isBlockedSubtree(c));

    const responseData = {
      success: true,
      comments: await attachLikedByMe(currentUserId, filteredComments),
    };

    // set cache
    try {
      await setCache(cacheKey, responseData);
    } catch (err: any) {
      logger.error(`Cache set error in getAllCommentsForPost!`, { error: err.message });
    }

    return res.status(200).json(responseData);
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in getAllCommentsForPost:`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

// Get all comments for a specific post
export const getComment = async (req: Request<Params>, res: Response) => {
  const { postId } = req.params;

  try {
    // validate id
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new BadRequestError("Invalid post ID!");
    }

    // closeFriends posts are invisible to non-close-friends — hide their threads.
    // The post-visibility check and the viewer's block list are independent, so
    // they run CONCURRENTLY (cuts one Mongo round-trip off the cold-cache path).
    const currentUserId = req.user?._id?.toString();
    const [{ allowed }, blockedIds] = await Promise.all([
      canInteractWithPost(postId, currentUserId),
      currentUserId
        ? getBlockedUserIds(currentUserId)
        : Promise.resolve([] as string[]),
    ]);
    if (!allowed) {
      throw new NotFoundError("Post not found!");
    }
    // pagination
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const cursor = req.query.cursor as string;

    // query
    const query: any = {
      post: postId,
      parent: null,
    };

    // if cursor exists fetch older comments
    if (cursor) {
      query._id = { $lt: cursor };
    }

    // Blocked users must not exist — hide comments from anyone blocked in
    // either direction. Per-viewer result, so the cache key includes the viewer.
    if (blockedIds.length > 0) {
      query.author = { $nin: blockedIds };
    }

    // cache key
    const cacheKey = `comments:${postId}:${cursor || "first"}:${limit}:${currentUserId || "anon"}`;

    // get from cache
    try {
      const cachedComments = await getCache(cacheKey);
      if (cachedComments) return res.status(200).json(cachedComments);
    } catch (err: any) {
      logger.error(`Cache error in getComment!`, { error: err.message });
    }

    // fetch comments with author info
    const comments = await Comment.find(query)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    // check more comments exists
    const hasMore = comments.length > limit;

    // remove extra comments
    if (hasMore) {
      comments.pop();
    }

    // next cursor
    const nextCursor = comments.slice(-1).shift()?._id || null;

    const responseData = {
      success: true,
      comments: await attachLikedByMe(currentUserId, comments),
      nextCursor,
      hasMore,
    };

    // set cache
    try {
      await setCache(cacheKey, responseData);
    } catch (err: any) {
      logger.error(`Cache set error in getComment!`, { error: err.message });
    }

    return res.status(200).json(responseData);
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in getComment:`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

// Get all comments
export const getAllComments = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const cursor = req.query.cursor as string;

    // cache key (per-viewer: closeFriends visibility depends on who asks)
    const currentUserId = req.user?._id?.toString();
    const cacheKey = `comments:all:${cursor || "first"}:${limit}:${currentUserId || "anon"}`;
    try {
      const cached = await getCache(cacheKey);
      if (cached) return res.status(200).json(cached);
    } catch (err: any) {
      logger.error(`Cache error in getAllComments!`, { error: err.message });
    }

    const query: any = {
      externalPost: null,
    };
    if (cursor) {
      query._id = { $lt: cursor };
    }

    const comments = await Comment.find(query)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    // closeFriends posts are invisible to non-close-friends — never expose
    // their comment threads in the global list either.
    let visibleComments = comments;
    if (comments.length > 0) {
      const postIds = [...new Set(comments.map((c: any) => c.post?.toString()).filter(Boolean))];
      // N+1 → one batch: the per-post visibility checks are independent, so
      // awaiting them in a loop serialized up to ~50 Mongo round-trips.
      const results = await Promise.all(
        postIds.map((pid) => canInteractWithPost(pid, currentUserId)),
      );
      const visiblePostIds = new Set<string>();
      postIds.forEach((pid, i) => {
        if (results[i]?.allowed) visiblePostIds.add(pid);
      });
      visibleComments = comments.filter((c: any) =>
        !c.post || visiblePostIds.has(c.post.toString()),
      );
    }

    const hasMore = visibleComments.length > limit;
    if (hasMore) {
      visibleComments.pop();
    }

    const nextCursor = visibleComments.slice(-1).shift()?._id || null;

    const responseData = {
      success: true,
      comments: await attachLikedByMe(currentUserId, visibleComments),
      nextCursor,
      hasMore,
    };

    // set cache (2 min — global comments list is stable)
    try {
      await setCache(cacheKey, responseData, 120);
    } catch (err: any) {
      logger.error(`Cache set error in getAllComments!`, { error: err.message });
    }

    return res.status(200).json(responseData);
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in getAllComments:`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

// Get replies for a specific comment
export const getCommentReplies = async (
  req: Request<CommentParams>,
  res: Response,
) => {
  const { commentId } = req.params;

  try {
    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      throw new BadRequestError("Invalid comment ID!");
    }

    // Resolve the comment's parent post + the viewer's block list concurrently
    // (they're independent), then enforce closeFriends visibility. Saves a Mongo
    // round-trip on the cold-cache path.
    const currentUserId = req.user?._id?.toString();
    const [parentCommentDoc, blockedIds] = await Promise.all([
      Comment.findById(commentId).select("post").lean(),
      currentUserId
        ? getBlockedUserIds(currentUserId)
        : Promise.resolve([] as string[]),
    ]);
    if (parentCommentDoc?.post) {
      const { allowed } = await canInteractWithPost(parentCommentDoc.post.toString(), currentUserId);
      if (!allowed) {
        throw new NotFoundError("Comment not found!");
      }
    }

    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const cursor = req.query.cursor as string;

    const query: any = { parent: commentId };
    if (cursor) {
      query._id = { $lt: cursor };
    }

    // Blocked users must not exist — hide replies from blocked authors
    if (blockedIds.length > 0) {
      query.author = { $nin: blockedIds };
    }

    // cache key
    const cacheKey = `comments:replies:${commentId}:${cursor || "first"}:${limit}:${currentUserId || "anon"}`;
    try {
      const cached = await getCache(cacheKey);
      if (cached) return res.status(200).json(cached);
    } catch (err: any) {
      logger.error(`Cache error in getCommentReplies!`, { error: err.message });
    }

    const replies = await Comment.find(query)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    const hasMore = replies.length > limit;
    if (hasMore) {
      replies.pop();
    }

    const nextCursor = replies.slice(-1).shift()?._id || null;

    const responseData = {
      success: true,
      replies: await attachLikedByMe(currentUserId, replies),
      nextCursor,
      hasMore,
    };

    // set cache (2 min — replies are stable)
    try {
      await setCache(cacheKey, responseData, 120);
    } catch (err: any) {
      logger.error(`Cache set error in getCommentReplies!`, { error: err.message });
    }

    return res.status(200).json(responseData);
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in getCommentReplies:`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

// create a new comment or reply
export const addComment = async (req: Request<Params>, res: Response) => {
  const result = addCommentSchema.safeParse(req.body);
  const postId = req.params.postId;
  const author = req.user?._id;

  try {
    // check validation result
    if (!result.success) {
      throw new BadRequestError(result.error.issues[0]?.message || "Invalid Data!");
    }

    // check user auth
    if (!author) {
      throw new UnauthorizedError("Unauthorized access!");
    }

    // check for parent comment (is reply) + fetch the post author — these
    // are independent, so they run in ONE round-trip instead of two.
    const parent = result.data.parent;
    const [parentComment, postAuthorDoc] = await Promise.all([
      parent
        ? Comment.findById(parent)
            .select("_id author post")
            .lean()
        : Promise.resolve(null),
      Post.findById(postId).select("author visibility").lean(),
    ]);

    if (parent && !parentComment) {
      throw new NotFoundError("Parent comment not found!");
    }

    // ensure parent comment belongs to the same post
    if (parentComment && parentComment.post?.toString() !== postId) {
      throw new BadRequestError("Parent comment does not belong to this post!");
    }

    // Blocked users must not exist for each other — no commenting on a
    // blocked user's post, and no replies under a blocked user's comment.
    // All three checks are independent — run them in one round-trip.
    const [postAuthorBlocked, canInteract, parentAuthorBlocked] = await Promise.all([
      postAuthorDoc
        ? areMutuallyBlocked(author.toString(), postAuthorDoc.author.toString())
        : Promise.resolve(false),
      postAuthorDoc
        ? canInteractWithPost(postId, author.toString()).then((r) => r.allowed)
        : Promise.resolve(true),
      parentComment && parentComment.author?.toString() !== author.toString()
        ? areMutuallyBlocked(author.toString(), parentComment.author.toString())
        : Promise.resolve(false),
    ]);
    if (postAuthorBlocked) {
      throw new ForbiddenError("Cannot comment on this post!");
    }
    // closeFriends posts can only be commented on by the author / close friends
    if (!canInteract) {
      throw new NotFoundError("Post not found!");
    }
    if (parentAuthorBlocked) {
      throw new ForbiddenError("Cannot reply to this comment!");
    }

    // ensure post id
    if (!postId)
      throw new BadRequestError("Post ID required");

    const sanitizedContent = sanitizePlainText(result.data.content);

    // save comment
    const comment = new Comment({ ...result.data, content: sanitizedContent, author, post: postId });
    await comment.save();

    // populate comment for socket + increment the counts — all independent
    // after the save, so they run in ONE round-trip instead of three.
    const [populatedComment, updatedPost, updatedParentComment] = await Promise.all([
      Comment.findById(comment._id)
        .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
        .lean(),
      Post.findByIdAndUpdate(
        postId,
        { $inc: { commentsCount: 1 } },
        { returnDocument: "after" },
      ),
      parent
        ? Comment.findByIdAndUpdate(
            parent,
            { $inc: { repliesCount: 1 } },
            { returnDocument: "after" },
          )
        : Promise.resolve(null),
    ]);

    const notifyRecipients = new Set<string>();
    if (updatedPost) {
      notifyRecipients.add(updatedPost.author.toString());
    }
    if (parentComment) {
      notifyRecipients.add(parentComment.author.toString());
    }

    // handle mentions
    const mentionedUserIds = await extractMentions(sanitizedContent);
    mentionedUserIds.forEach(userId => notifyRecipients.add(userId));

    // Don't send notification to self
    notifyRecipients.delete(author.toString());

    // Deliver ALL notifications in parallel — each createNotification does
    // ~5 DB round-trips, so awaiting them one at a time serialized the whole
    // comment on multi-recipient posts. The cache clear is independent, so
    // it rides the same batch.
    const notifyTasks: Promise<any>[] = [...notifyRecipients].map((recipient) => {
      let notificationType: "comment" | "mention" = "comment";
      if (mentionedUserIds.includes(recipient)) {
        notificationType = "mention";
      }
      return createNotification({
        recipient,
        sender: author.toString(),
        type: notificationType,
        post: postId,
        comment: comment._id.toString(),
      });
    });
    notifyTasks.push(clearCommentsCache(postId));
    await Promise.all(notifyTasks);

    // Emit socket event
    if (populatedComment && updatedPost) {
      if (parent && updatedParentComment) {
        emitCommentReply(postId, parent, populatedComment, author.toString(), updatedPost.commentsCount, (updatedParentComment as any).repliesCount);
      } else if (parent) {
        emitCommentReply(postId, parent, populatedComment, author.toString(), updatedPost.commentsCount, 1);
      } else {
        emitPostComment(postId, populatedComment, author.toString(), updatedPost.commentsCount);
      }
    }

    // Webhooks — the post author hears their post was commented; the comment
    // author hears their comment was created.
    if (updatedPost) {
      deliverWebhookEvent(
        "post.commented",
        {
          postId,
          postAuthorId: updatedPost.author.toString(),
          commentId: comment._id.toString(),
          commenterId: author.toString(),
        },
        updatedPost.author.toString(),
      ).catch(() => {});
    }
    deliverWebhookEvent(
      "comment.created",
      {
        commentId: comment._id.toString(),
        authorId: author.toString(),
        postId,
      },
      author.toString(),
    ).catch(() => {});

    // Log interaction for feed ranking
    if (updatedPost && author.toString() !== updatedPost.author.toString()) {
      logInteraction(
        author.toString(),
        updatedPost.author.toString(),
        postId,
        "comment",
        (updatedPost as any)?.hashtags || []
      );
    }

    // Award XP and progress mission (fire-and-forget). The dedupe key caps
    // comment-farming (comment → delete → re-comment) at one award per post
    // per TTL while leaving distinct posts unaffected.
    awardXP(author.toString(), "COMMENT", {
      dedupeKey: `comment:${postId}`,
    }).catch(() => {});
    progressMission(author.toString(), "comment").catch(() => {});
    // Achievement badges (fire-and-forget): commenter + post author
    checkBadgesAndNotify(author.toString(), "comment_made").catch(() => {});
      checkAllRounderBadge(author.toString()).catch(() => {});
    if (updatedPost?.author && updatedPost.author.toString() !== author.toString()) {
      checkBadgesAndNotify(updatedPost.author.toString(), "comment_received").catch(() => {});
    }

    return res.status(201).json({
      success: true,
      message: "Comment added successfully!",
      comment: populatedComment,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in the addComment controller!`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

// update existing comment
export const updateComment = async (
  req: Request<CommentParams>,
  res: Response,
) => {
  const result = updateCommentSchema.safeParse(req.body);
  const author = req.user?._id;
  const { commentId } = req.params;

  try {
    // check validation result
    if (!result.success) {
      throw new BadRequestError(result.error.issues[0]?.message || "Invalid Data!");
    }

    // check user auth
    if (!author) {
      throw new UnauthorizedError("Unauthorized access!");
    }

    // find comment (exists)
    const comment = await Comment.findById(commentId)
      .select("_id author post")
      .lean();
    if (!comment) {
      throw new NotFoundError("Comment not found!");
    }

    // verify ownership
    if (comment.author.toString() !== author.toString()) {
      throw new ForbiddenError("Forbidden!");
    }

    // update and save with sanitization
    const sanitizedContent = sanitizePlainText(result.data.content);
    await Comment.findByIdAndUpdate(
      commentId,
      { content: sanitizedContent, isEdited: true },
      { returnDocument: 'after', runValidators: true },
    );

    const updatedComment = await Comment.findById(commentId)
      .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    // emit socket event for realtime update
    if (updatedComment) {
      emitCommentUpdated(updatedComment);
    }

    // clear cache
    if (comment.post) await clearCommentsCache(comment.post.toString());

    return res.status(200).json({
      success: true,
      message: "Comment updated successfully!",
      updatedComment,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in the updateComment controller!`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

// Shared with the admin panel's delete-comment action so both paths
// collect the exact same descendant (reply) tree.
export const collectDescendantCommentIds = async (
  commentId: string,
): Promise<string[]> => {
  const replies = await Comment.find({ parent: commentId })
    .select("_id")
    .lean();
  const ids = [commentId];

  for (const reply of replies) {
    ids.push(...(await collectDescendantCommentIds(reply._id.toString())));
  }

  return ids;
};

// delete comment
export const deleteComment = async (
  req: Request<CommentParams>,
  res: Response,
) => {
  const author = req.user?._id;
  const { commentId } = req.params;

  try {
    // check user auth
    if (!author) {
      throw new UnauthorizedError("Unauthorized access!");
    }

    // find comment (exists)
    const comment = await Comment.findById(commentId);
    if (!comment) {
      throw new NotFoundError("Comment not found!");
    }

    // verify ownership or post author status (external comments have no
    // native post — only the comment author can delete them)
    let isPostAuthor = false;
    if (comment.post) {
      const post = await Post.findById(comment.post).select("author").lean();
      isPostAuthor = post?.author?.toString() === author.toString();
    }
    const isCommentAuthor = comment.author.toString() === author.toString();

    if (!isCommentAuthor && !isPostAuthor) {
      throw new ForbiddenError("Forbidden!");
    }

    const commentIds = await collectDescendantCommentIds(commentId);

    await Promise.all([
      Comment.deleteMany({ _id: { $in: commentIds } }),
      Like.deleteMany({ comment: { $in: commentIds } }),
      Notification.deleteMany({ comment: { $in: commentIds } }),
    ]);

    // External comments decrement the imported post's native count instead
    // of a native post's commentsCount.
    let updatedPost: any = null;
    if (comment.externalPost) {
      updatedPost = await ExternalPost.findByIdAndUpdate(
        comment.externalPost,
        { $inc: { orbitCommentsCount: -commentIds.length } },
        { returnDocument: "after" },
      );
    } else if (comment.post) {
      updatedPost = await Post.findByIdAndUpdate(
        comment.post,
        { $inc: { commentsCount: -commentIds.length } },
        { returnDocument: "after" },
      );
    }
    
    // if this is a reply, decrement parent's repliesCount
    let updatedParentComment: unknown = null;
    if (comment.parent) {
      updatedParentComment = await Comment.findByIdAndUpdate(
        comment.parent,
        { $inc: { repliesCount: -1 } },      { returnDocument: 'after' });
    }

    // clear cache
    if (comment.post) await clearCommentsCache(comment.post.toString());
    if (comment.externalPost) {
      await clearByPattern(`api:*:/api/external/feed*`);
    }

    // emit comment deleted event
    if (comment.post && updatedPost) {
      emitCommentDeleted(comment.post.toString(), commentId, updatedPost.commentsCount);
    }

    return res.status(200).json({
      success: true,
      message: "Comment deleted successfully!",
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in the deleteComment controller!`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};
