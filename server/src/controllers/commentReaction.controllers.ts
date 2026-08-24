import mongoose from "mongoose";
import type { Request, Response, NextFunction } from "express";
import Comment from "../models/comment.model";
import { BadRequestError, NotFoundError } from "../utilities/errors";
import { canInteractWithPost } from "../utilities/postVisibility";
import { emitCommentReaction } from "../configs/socket";
import { createNotification } from "../utilities/notification";
import { logger } from "../utilities/logger";

export const toggleCommentReaction = async (
  req: Request<{ commentId: string }>,
  res: Response,
  next: NextFunction,
) => {
  const { commentId } = req.params;
  const { emoji } = req.body;
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) {
      return next(new BadRequestError("Unauthorized!"));
    }

    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      return next(new BadRequestError("Invalid comment ID!"));
    }

    if (!emoji || typeof emoji !== "string" || emoji.trim().length === 0) {
      return next(new BadRequestError("Emoji is required!"));
    }

    const comment = await Comment.findById(commentId);
    if (!comment) {
      return next(new NotFoundError("Comment not found!"));
    }

    // closeFriends posts are invisible to non-close-friends — their comment
    // threads must be too. An outsider must not be able to react to (or even
    // detect) comments on a closeFriends post.
    const parentPostId = comment.post?.toString();
    if (parentPostId) {
      const { allowed } = await canInteractWithPost(parentPostId, currentUserId.toString());
      if (!allowed) {
        return next(new NotFoundError("Comment not found!"));
      }
    }

    const userIdStr = currentUserId.toString();
    const existingIndex = (comment.reactions || []).findIndex(
      (r) => (r.sender?._id || r.sender)?.toString() === userIdStr && r.emoji === emoji.trim(),
    );

    let type: "add" | "remove" = "add";

    if (existingIndex >= 0) {
      // Remove all existing reactions by this user (toggle off)
      comment.reactions = comment.reactions!.filter(
        (r) => (r.sender?._id || r.sender)?.toString() !== userIdStr
      ) as any;
      type = "remove";
    } else {
      // Remove any previous reaction by this user (replace), then add new one
      comment.reactions = comment.reactions!.filter(
        (r) => (r.sender?._id || r.sender)?.toString() !== userIdStr
      ) as any;
      comment.reactions!.push({
        emoji: emoji.trim(),
        sender: currentUserId,
        createdAt: new Date(),
      });
    }

    await comment.save();

    // ── Emit the socket event IMMEDIATELY ───────────────────────────────
    // The reaction payload is built from req.user (already loaded by auth —
    // no DB round-trip needed), so the emit happens right after save. The
    // response populate below is only for the sender's own confirmation and
    // never delays the recipients.
    const actorUser = (req.user as any) || {};
    const populatedReaction =
      type === "add"
        ? {
            emoji: emoji.trim(),
            sender: {
              _id: currentUserId,
              username: actorUser.username || "",
              fullName: actorUser.fullName || "",
              profilePic: actorUser.profilePic || null,
            },
            createdAt: new Date(),
          }
        : { emoji: emoji.trim(), sender: { _id: userIdStr } };
    emitCommentReaction(commentId, {
      reaction: populatedReaction,
      type,
    });

    // Populate sender info for the response only
    const populatedComment = await Comment.findById(comment._id)
      .populate("reactions.sender", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    // Create notification when a reaction is added (skip self-reactions)
    if (type === "add" && comment.author.toString() !== currentUserId.toString()) {
      const commentAuthor = comment.author.toString();
      const postId = comment.post ? comment.post.toString() : null;
      await createNotification({
        recipient: commentAuthor,
        sender: currentUserId.toString(),
        type: "reaction",
        post: postId,
        comment: commentId,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Comment reaction updated successfully!",
      reactions: populatedComment?.reactions || [],
    });
  } catch (err: any) {
    logger.error("Error in toggleCommentReaction controller", { error: err.message });
    return next(err);
  }
};
