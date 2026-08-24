import type { Request, Response } from "express";
import mongoose from "mongoose";
import { ModerationItem } from "../models/moderationItem.model";
import { User } from "../models/user.model";
import Post from "../models/post.model";
import Comment from "../models/comment.model";
import { AppError, BadRequestError, NotFoundError, UnauthorizedError, ForbiddenError } from "../utilities/errors";
import { logger } from "../utilities/logger";

/**
 * POST /api/moderation/flag — Flag content for review.
 */
export const flagContent = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id;
  const { targetType, targetId, reason } = req.body;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");
    if (!targetType || !["post", "comment", "user"].includes(targetType)) {
      throw new BadRequestError("Valid targetType (post/comment/user) is required!");
    }
    if (!targetId) throw new BadRequestError("targetId is required!");
    if (!reason || !reason.trim()) throw new BadRequestError("Reason is required!");

    // Check for existing flag by same user on same target
    const existing = await ModerationItem.findOne({
      flaggedBy: currentUserId,
      targetType,
      targetId: new mongoose.Types.ObjectId(targetId),
    });

    if (existing) {
      return res.status(200).json({ success: true, message: "Already flagged!" });
    }

    // Check if this target has been flagged before
    const previousFlags = await ModerationItem.find({
      targetType,
      targetId: new mongoose.Types.ObjectId(targetId),
    });

    const item = new ModerationItem({
      targetType,
      targetId: new mongoose.Types.ObjectId(targetId),
      reason: reason.trim(),
      flaggedBy: currentUserId,
      flagCount: previousFlags.length + 1,
    });

    await item.save();

    // Auto-hide if threshold reached (3+ unique flags)
    if (item.flagCount >= 3) {
      if (targetType === "post") {
        await Post.findByIdAndUpdate(targetId, { status: "archived" });
      } else if (targetType === "comment") {
        await Comment.findByIdAndUpdate(targetId, { isDeleted: true });
      }
    }

    return res.status(201).json({
      success: true,
      message: item.flagCount >= 3 ? "Content auto-hidden after 3 flags" : "Content flagged for review!",
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in flagContent", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * GET /api/moderation/queue — Get moderation queue (admin only).
 */
export const getModerationQueue = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id;
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit as string) || 10));
  const cursor = req.query.cursor as string | undefined;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");

    const user = await User.findById(currentUserId).select("isAdmin").lean();
    if (!user || !(user as any).isAdmin) throw new ForbiddenError("Admin access required!");

    const query: any = { status: "pending" };
    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      query._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const items = await ModerationItem.find(query)
      .populate("flaggedBy", "username fullName isVerified")
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = items.length > limit;
    if (hasMore) {
      items.pop();
    }
    const nextCursor = items.slice(-1).shift()?._id || null;

    return res.status(200).json({ success: true, items, hasMore, nextCursor });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in getModerationQueue", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * PUT /api/moderation/:id/approve — Approve content (admin).
 */
export const approveContent = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id;
  const { id } = req.params;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");
    const user = await User.findById(currentUserId).select("isAdmin").lean();
    if (!user || !(user as any).isAdmin) throw new ForbiddenError("Admin access required!");

    const item = await ModerationItem.findByIdAndUpdate(id, {
      status: "approved",
      reviewedBy: currentUserId,
      reviewedAt: new Date(),
    });

    if (!item) throw new NotFoundError("Moderation item not found!");

    return res.status(200).json({ success: true, message: "Content approved!" });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in approveContent", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * PUT /api/moderation/:id/reject — Reject content + warn user (admin).
 */
export const rejectContent = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id;
  const { id } = req.params;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");
    const user = await User.findById(currentUserId).select("isAdmin").lean();
    if (!user || !(user as any).isAdmin) throw new ForbiddenError("Admin access required!");

    const item = await ModerationItem.findByIdAndUpdate(id, {
      status: "rejected",
      reviewedBy: currentUserId,
      reviewedAt: new Date(),
    });

    if (!item) throw new NotFoundError("Moderation item not found!");

    // Auto-remove/hide content
    if (item.targetType === "post") {
      await Post.findByIdAndUpdate(item.targetId, { status: "archived" });
    } else if (item.targetType === "comment") {
      await Comment.findByIdAndUpdate(item.targetId, { isDeleted: true });
    }

    return res.status(200).json({ success: true, message: "Content rejected and removed!" });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in rejectContent", { error: err.message });
    throw new AppError("Internal server error!");
  }
};
