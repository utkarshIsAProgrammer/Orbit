import type { Request, Response } from "express";
import mongoose from "mongoose";

import Post from "../models/post.model";
import Comment from "../models/comment.model";
import Like from "../models/like.model";
import {
  createNotification,
  deleteInteractionNotification,
} from "../utilities/notification";
import { areMutuallyBlocked } from "../utilities/blockCheck";
import {
  emitPostLike,
  emitPostUnlike,
  emitCommentLike,
  emitCommentUnlike
} from "../configs/socket";
import { logger } from "../utilities/logger";
import { AppError, BadRequestError, NotFoundError, UnauthorizedError, ForbiddenError } from "../utilities/errors";
import { canInteractWithPost } from "../utilities/postVisibility";
import { toggleLikeSchema, toggleCommentLikeSchema } from "../schemas/interaction.schema";
import { clearFeedCache, clearCommentsCache } from "../configs/cache";
import { logInteraction } from "../services/affinityService";
import { awardXP } from "../services/xpService";
import { checkBadgesAndNotify } from "../services/badgeService";
import { checkAllRounderBadge } from "../services/badgeService";
import { progressMission } from "../services/dailyMissionService";
import { deliverWebhookEvent } from "./webhook.controller";

type Params = {
  postId: string;
};

type CommentParams = {
  commentId: string;
};

// toggle like for a post
export const togglePostLikes = async (req: Request<Params>, res: Response) => {
  const author = req.user?._id;
  const { postId } = req.params;

  try {
    // validate input
    const parsed = toggleLikeSchema.safeParse({ postId });
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message || "Invalid input");
    }

    // check user auth
    if (!author) {
      throw new UnauthorizedError("Unauthorized access!");
    }

    // find post
    const post = await Post.findById(postId).select("_id author visibility").lean();

    if (!post) {
      throw new NotFoundError("Post not found!");
    }

    // closeFriends posts can only be liked by the author / their close friends
    const { allowed } = await canInteractWithPost(postId, author.toString());
    if (!allowed) {
      throw new NotFoundError("Post not found!");
    }

    // Blocked users must not exist for each other — no likes on a
    // blocked user's posts.
    if (post.author.toString() !== author.toString()) {
      if (await areMutuallyBlocked(author.toString(), post.author.toString())) {
        throw new ForbiddenError("Cannot interact with this post!");
      }
    }

    // check if already liked
    const existingLike = await Like.findOne({
      author,
      post: postId,
    });

    if (!existingLike) {
      // like post
      await Like.create({
        author,
        post: postId,
      });

      // increment likes count
      const updatedPost = await Post.findByIdAndUpdate(
        postId,
        { $inc: { likesCount: 1 } },
        { returnDocument: 'after' },
      );

      // create notification (skip self-notification)
      if (post.author.toString() !== author.toString()) {
        await createNotification({
          recipient: post.author.toString(),
          sender: author.toString(),
          type: "like",
          post: postId,
        });
      }

      // Log interaction for feed ranking
      if (post.author.toString() !== author.toString()) {
        logInteraction(
          author.toString(),
          post.author.toString(),
          postId,
          "like",
          (updatedPost as any)?.hashtags || []
        );
      }

      // Emit socket event
      if (updatedPost) {
        emitPostLike(postId, author.toString(), updatedPost.likesCount);
      }

      await clearFeedCache();

      // Award XP and progress mission (fire-and-forget). Self-likes award
      // nothing — otherwise like→unlike→like cycling on your OWN post would
      // farm XP + daily-mission progress. The dedupe key also blocks rapid
      // re-likes of the same post.
      if (post.author.toString() !== author.toString()) {
        awardXP(author.toString(), "LIKE", {
          dedupeKey: `like:${postId}`,
        }).catch(() => {});
        progressMission(author.toString(), "like").catch(() => {});

        // Award the post author XP for receiving a like
        awardXP(post.author.toString(), "RECEIVE_LIKE").catch(() => {});

        // Achievement badges (fire-and-forget): liker + post author
        checkBadgesAndNotify(author.toString(), "like_given").catch(() => {});
        checkBadgesAndNotify(post.author.toString(), "like_received").catch(() => {});
      checkAllRounderBadge(author.toString()).catch(() => {});

        // Notify the post author's webhooks that their post was liked
        deliverWebhookEvent(
          "post.liked",
          {
            postId,
            likerId: author.toString(),
            postAuthorId: post.author.toString(),
          },
          post.author.toString(),
        ).catch(() => {});
      }

      return res.status(201).json({
        success: true,
        message: "Post liked successfully!",
        liked: true,
        likesCount: updatedPost?.likesCount,
        post: updatedPost,
      });
    }

    await existingLike.deleteOne();

    await deleteInteractionNotification({
      recipient: post.author.toString(),
      sender: author.toString(),
      type: "like",
      post: postId,
      comment: null,
    });

    // decrement likes count
    const updatedPost = await Post.findByIdAndUpdate(
      postId,
      { $inc: { likesCount: -1 } },
      { returnDocument: 'after' },
    );

    // Emit socket event
    if (updatedPost) {
      emitPostUnlike(postId, author.toString(), updatedPost.likesCount);
    }

    await clearFeedCache();

    return res.status(200).json({
      success: true,
      message: "Post disliked successfully!",
      liked: false,
      likesCount: updatedPost?.likesCount,
      post: updatedPost,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in togglePostLikes controller!`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

// toggle like for a comment
export const toggleCommentLikes = async (
  req: Request<CommentParams>,
  res: Response,
) => {
  const author = req.user?._id;
  const { commentId } = req.params;

  try {
    // validate input
    const parsed = toggleCommentLikeSchema.safeParse({ commentId });
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message || "Invalid input");
    }

    // check user auth
    if (!author) {
      throw new UnauthorizedError("Unauthorized access!");
    }

    // find comment
    const comment = await Comment.findById(commentId)
      .select("_id author post")
      .lean();

    if (!comment) {
      throw new NotFoundError("Comment not found!");
    }

    // closeFriends posts' comment threads are invisible to non-close-friends
    if (comment.post) {
      const { allowed } = await canInteractWithPost(comment.post.toString(), author.toString());
      if (!allowed) {
        throw new NotFoundError("Comment not found!");
      }
    }

    // check if already liked
    const existingLike = await Like.findOne({
      author,
      comment: commentId,
    });

    if (!existingLike) {
      // like comment
      await Like.create({
        author,
        comment: commentId,
      });

      // increment likes count
      const updatedComment = await Comment.findByIdAndUpdate(
        commentId,
        { $inc: { likesCount: 1 } },
        { returnDocument: 'after' },
      );

      // create notification (skip self-notification; external comments have
      // no native post, so skip the post-scoped notification entirely)
      if (comment.author.toString() !== author.toString() && comment.post) {
        await createNotification({
          recipient: comment.author.toString(),
          sender: author.toString(),
          type: "like",
          post: comment.post.toString(),
          comment: commentId,
        });
      }		// Emit socket event
		if (updatedComment) {
			emitCommentLike(commentId, author.toString(), updatedComment.likesCount);
		}

		// Comments lists are Redis-cached — invalidate so the new likesCount
		// shows up on refresh instead of the stale cached value.
		if (comment.post) await clearCommentsCache(comment.post.toString());

		return res.status(201).json({
			success: true,
			message: "Comment liked successfully!",
        liked: true,
        likesCount: updatedComment?.likesCount,
        comment: updatedComment,
      });
    }

    await existingLike.deleteOne();

    if (comment.post) {
      await deleteInteractionNotification({
        recipient: comment.author.toString(),
        sender: author.toString(),
        type: "like",
        post: comment.post.toString(),
        comment: commentId,
      });
    }

    const updatedComment = await Comment.findByIdAndUpdate(
      commentId,
      { $inc: { likesCount: -1 } },
      { returnDocument: 'after' },
    );		// Emit socket event
		if (updatedComment) {
			emitCommentUnlike(commentId, author.toString(), updatedComment.likesCount);
		}

		// Invalidate the cached comments lists so the decremented likesCount
		// is reflected on refresh too.
		if (comment.post) await clearCommentsCache(comment.post.toString());

		return res.status(200).json({
			success: true,
			message: "Comment disliked successfully!",
      liked: false,
      likesCount: updatedComment?.likesCount,
      comment: updatedComment,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in toggleCommentLikes controller!`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

// use findOneAndUpdate with upsert to prevent duplicate like documents

// read-modify-write uses Mongoose optimistic locking (__v check)

// atomic toggle with findOneAndUpdate prevents duplicate like documents
