import mongoose from "mongoose";
import type { Request, Response, NextFunction } from "express";
import Post from "../models/post.model";
import { BadRequestError, NotFoundError } from "../utilities/errors";
import { canInteractWithPost } from "../utilities/postVisibility";
import { emitPostReaction } from "../configs/socket";
import { createNotification } from "../utilities/notification";
import { logger } from "../utilities/logger";

/**
 * Toggle an emoji reaction on a post (mirrors the comment/message reaction
 * system): one active emoji per user — reacting with a new emoji replaces the
 * old one, reacting with the same emoji toggles it off.
 */
export const togglePostReaction = async (
  req: Request<{ postId: string }>,
  res: Response,
  next: NextFunction,
) => {
  const { postId } = req.params;
  const { emoji } = req.body;
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) {
      return next(new BadRequestError("Unauthorized!"));
    }

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return next(new BadRequestError("Invalid post ID!"));
    }

    if (!emoji || typeof emoji !== "string" || emoji.trim().length === 0) {
      return next(new BadRequestError("Emoji is required!"));
    }

    const post = await Post.findById(postId);
    if (!post) {
      return next(new NotFoundError("Post not found!"));
    }

    // closeFriends posts are invisible to non-close-friends — their reactions
    // must be too. An outsider must not be able to react to (or even detect)
    // a closeFriends post.
    const { allowed } = await canInteractWithPost(postId, currentUserId.toString());
    if (!allowed) {
      return next(new NotFoundError("Post not found!"));
    }

    const userIdStr = currentUserId.toString();
    const existingIndex = (post.reactions || []).findIndex(
      (r) => (r.sender?._id || r.sender)?.toString() === userIdStr && r.emoji === emoji.trim(),
    );

    let type: "add" | "remove" = "add";

    if (existingIndex >= 0) {
      // Remove all existing reactions by this user (toggle off)
      post.reactions = post.reactions!.filter(
        (r) => (r.sender?._id || r.sender)?.toString() !== userIdStr
      ) as any;
      type = "remove";
    } else {
      // Remove any previous reaction by this user (replace), then add new one
      post.reactions = post.reactions!.filter(
        (r) => (r.sender?._id || r.sender)?.toString() !== userIdStr
      ) as any;
      post.reactions!.push({
        emoji: emoji.trim(),
        sender: currentUserId,
        createdAt: new Date(),
      });
    }

    await post.save();

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
    emitPostReaction(postId, {
      reaction: populatedReaction,
      type,
    });

    // Populate sender info for the response only
    const populatedPost = await Post.findById(post._id)
      .populate("reactions.sender", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    // Create notification when a reaction is added (skip self-reactions)
    if (type === "add" && post.author.toString() !== currentUserId.toString()) {
      const postAuthor = post.author.toString();
      await createNotification({
        recipient: postAuthor,
        sender: currentUserId.toString(),
        type: "post_reaction",
        post: postId,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Post reaction updated successfully!",
      reactions: populatedPost?.reactions || [],
    });
  } catch (err: any) {
    logger.error("Error in togglePostReaction controller", { error: err.message });
    return next(err);
  }
};
