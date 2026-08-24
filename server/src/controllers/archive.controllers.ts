import { Request, Response } from "express";
import mongoose from "mongoose";
import Post from "../models/post.model";
import { logger } from "../utilities/logger";
import { AppError, BadRequestError, NotFoundError, UnauthorizedError } from "../utilities/errors";

/**
 * Archive a post (hide from profile without deleting).
 * POST /api/posts/:postId/archive
 */
export const archivePost = async (req: Request, res: Response) => {
  try {
    const postId = req.params.postId as string;
    const userId = (req as any).user._id?.toString();
    if (!userId) throw new UnauthorizedError("Unauthorized!");
    if (!mongoose.Types.ObjectId.isValid(postId)) throw new BadRequestError("Invalid post ID!");

    const post = await Post.findById(postId);
    if (!post) throw new NotFoundError("Post not found!");
    if (post.author.toString() !== userId) throw new BadRequestError("Cannot archive another user's post!");

    post.status = "archived";
    await post.save();

    return res.status(200).json({ success: true, message: "Post archived" });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Archive error", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * Unarchive a post (restore to profile).
 * POST /api/posts/:postId/unarchive
 */
export const unarchivePost = async (req: Request, res: Response) => {
  try {
    const postId = req.params.postId as string;
    const userId = (req as any).user._id?.toString();
    if (!userId) throw new UnauthorizedError("Unauthorized!");
    if (!mongoose.Types.ObjectId.isValid(postId)) throw new BadRequestError("Invalid post ID!");

    const post = await Post.findById(postId);
    if (!post) throw new NotFoundError("Post not found!");
    if (post.author.toString() !== userId) throw new BadRequestError("Cannot unarchive another user's post!");

    post.status = "published";
    await post.save();

    return res.status(200).json({ success: true, message: "Post unarchived" });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Unarchive error", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * Get archived posts for current user.
 * GET /api/users/archived-posts
 */
export const getArchivedPosts = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id?.toString();
    if (!userId) throw new UnauthorizedError("Unauthorized!");

    const posts = await Post.find({ author: userId, status: "archived" } as any)
      .sort({ updatedAt: -1 })
      .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    return res.status(200).json({ success: true, posts });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Get archived posts error", { error: err.message });
    throw new AppError("Internal server error!");
  }
};
