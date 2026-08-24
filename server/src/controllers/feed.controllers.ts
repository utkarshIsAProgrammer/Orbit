import type { Request, Response } from "express";
import { getRankedFeed } from "../services/feedService";
import { markPostsAsSeen } from "../services/affinityService";
import { AppError, UnauthorizedError } from "../utilities/errors";
import { logger } from "../utilities/logger";

/**
 * GET /api/feed
 *
 * Returns a ranked, paginated feed for the authenticated user.
 * Query params:
 *   - cursor: string (optional, post ID for cursor-based pagination)
 *   - limit: number (optional, default 20, max 50)
 */
export const getFeed = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id?.toString();

  try {
    if (!currentUserId) {
      throw new UnauthorizedError("Unauthorized!");
    }

    const cursor = req.query.cursor as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 20, 50);

    const { posts, nextCursor, hasMore } = await getRankedFeed(
      currentUserId,
      cursor || null,
      limit
    );

    // Fire-and-forget: mark returned posts as seen so they're excluded from
    // the next feed request's candidate pool.
    if (posts.length > 0 && !cursor) {
      // Only mark on the first page to avoid skewing pagination
      const postIds = posts.map((post) => post._id.toString());
      markPostsAsSeen(currentUserId, postIds);
    }

    return res.status(200).json({
      success: true,
      message: posts.length ? "Feed fetched successfully!" : "No more posts in your feed.",
      posts,
      nextCursor,
      hasMore,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in getFeed controller!", { error: err.message });
    throw new AppError("Internal server error!");
  }
};
