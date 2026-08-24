import type { Request, Response } from "express";
import { User } from "../models/user.model";
import Post from "../models/post.model";
import { Message } from "../models/message.model";
import { AppError, UnauthorizedError } from "../utilities/errors";
import { logger } from "../utilities/logger";

/**
 * GET /api/export/posts — Download all posts as JSON.
 */
export const exportPosts = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");

    const posts = await Post.find({ author: currentUserId })
      .populate("author", "username fullName isVerified")
      .sort({ createdAt: -1 })
      .lean();

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="orbit-posts-${Date.now()}.json"`);
    return res.json({ exportedAt: new Date().toISOString(), count: posts.length, posts });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in exportPosts", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * GET /api/export/profile — Download profile data as JSON.
 */
export const exportProfile = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");

    const user = await User.findById(currentUserId)
      .select("-password -otp -otpExpiry -passwordHistory -loginAttempts -lockUntil")
      .lean();

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="orbit-profile-${Date.now()}.json"`);
    return res.json({ exportedAt: new Date().toISOString(), user });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in exportProfile", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * GET /api/export/messages — Download chat history as JSON.
 */
export const exportMessages = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");

    const messages = await Message.find({
      $or: [{ sender: currentUserId }, { recipient: currentUserId }],
      isDeleted: { $ne: true },
    })
      .populate("sender", "username")
      .populate("recipient", "username")
      .sort({ createdAt: -1 })
      .lean();

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="orbit-messages-${Date.now()}.json"`);
    return res.json({ exportedAt: new Date().toISOString(), count: messages.length, messages });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in exportMessages", { error: err.message });
    throw new AppError("Internal server error!");
  }
};
