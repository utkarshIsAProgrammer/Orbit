import type { Request, Response } from "express";
import mongoose from "mongoose";
import Post from "../models/post.model";
import { AppError, BadRequestError, UnauthorizedError } from "../utilities/errors";
import { sanitizePlainText } from "../configs/sanitize";
import { getCache, setCache, clearDraftsCache } from "../configs/cache";
import { logger } from "../utilities/logger";

/**
 * GET /api/posts/drafts — List all draft AND scheduled posts for the
 * current user (both are "unpublished" content the author manages).
 * Returns them as separate `drafts` and `scheduled` arrays.
 */
export const getDrafts = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");

    // Cache the (drafts + scheduled) list for this user — drafts are edited
    // rarely and any mutation clears the key below, so a short TTL keeps
    // repeated visits to the Drafts tab instant.
    const cacheKey = `drafts:${currentUserId.toString()}:all`;
    try {
      const cached = await getCache(cacheKey);
      if (cached) return res.status(200).json(cached);
    } catch (err: any) {
      logger.error(`Cache read error in getDrafts`, { error: err.message });
    }

    const posts = await Post.find({
      author: currentUserId,
      status: { $in: ["draft", "scheduled"] },
    })
      .select(
        "title content images image poll status scheduledAt hashtags createdAt updatedAt",
      )
      .sort({ updatedAt: -1 })
      .lean();

    const drafts = posts.filter((p) => p.status === "draft");
    const scheduled = posts.filter((p) => p.status === "scheduled");

    const responseData = { success: true, drafts, scheduled };
    try {
      await setCache(cacheKey, responseData, 60);
    } catch (err: any) {
      logger.error(`Cache write error in getDrafts`, { error: err.message });
    }

    return res.status(200).json(responseData);
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in getDrafts", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * POST /api/posts/drafts — Save a new draft post.
 */
export const createDraft = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");

    const { title = "", content = "" } = req.body;

    const images: { url: string; public_id: string }[] = [];
    const files = (req.files as any)?.images || [];
    files.forEach((file: any) => {
      images.push({ url: file.path, public_id: file.filename || "" });
    });

    const post = new Post({
      title: sanitizePlainText(title),
      content: sanitizePlainText(content),
      author: currentUserId,
      status: "draft",
      images: images.length > 0 ? images : undefined,
      hashtags: [],
    });

    await post.save();

    // A new draft must appear instantly in the Drafts tab
    await clearDraftsCache(currentUserId.toString());

    return res.status(201).json({ success: true, message: "Draft saved!", post });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in createDraft", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * POST /api/posts/schedule — Create a scheduled post.
 */
export const createScheduledPost = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");

    const { title = "", content = "", scheduledAt } = req.body;

    if (!scheduledAt) throw new BadRequestError("scheduledAt is required!");
    const scheduleDate = new Date(scheduledAt);
    if (scheduleDate <= new Date()) throw new BadRequestError("scheduledAt must be in the future!");

    const post = new Post({
      title: sanitizePlainText(title),
      content: sanitizePlainText(content),
      author: currentUserId,
      status: "scheduled",
      scheduledAt: scheduleDate,
      hashtags: [],
    });

    await post.save();

    // The scheduled post must appear instantly in the Scheduled section
    await clearDraftsCache(currentUserId.toString());

    return res.status(201).json({ success: true, message: "Post scheduled!", post });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in createScheduledPost", { error: err.message });
    throw new AppError("Internal server error!");
  }
};


