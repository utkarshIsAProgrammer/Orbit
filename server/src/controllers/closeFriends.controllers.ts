import { Request, Response } from "express";
import mongoose from "mongoose";
import { User } from "../models/user.model";
import { logger } from "../utilities/logger";
import { getBlockedUserIds } from "../utilities/blockCheck";
import { clearUserPostsCache, clearFeedCache, clearByPattern } from "../configs/cache";

/**
 * Invalidate the ranked + for-you feed caches of ONE viewer whose
 * close-friend status just changed.
 *
 * The ranked feed is cached per-user at `feed:ranked:{userId}` (5 min TTL)
 * and the for-you feed at `feed:for-you:{userId}:*` (60s TTL). When a user
 * is added to / removed from the author's closeFriends list, their cached
 * feed would keep hiding (add) or showing (remove) the author's
 * closeFriends-only posts until the TTL expires — a real privacy leak on
 * removal. `clearFeedCache()` only clears `posts:*` / `api:*:*posts*`, not
 * these per-user feed keys, so we must clear them explicitly here.
 */
const invalidateViewerFeedCaches = async (viewerId: string) => {
  await Promise.allSettled([
    clearByPattern(`feed:ranked:${viewerId}`),
    clearByPattern(`feed:for-you:${viewerId}:*`),
  ]);
};

/**
 * Add a user to close friends list.
 * POST /api/users/close-friends/:userId
 */
export const addCloseFriend = async (req: Request, res: Response) => {
  try {
    const currentUserId = (req as any).user._id?.toString();
    const targetUserId = req.params.userId as string;

    if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    if (currentUserId === targetUserId) {
      return res.status(400).json({ success: false, message: "Cannot add yourself as a close friend" });
    }

    const targetUser = await User.findById(targetUserId).select("_id").lean();
    if (!targetUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    await User.findByIdAndUpdate(currentUserId, {
      $addToSet: { closeFriends: targetUserId },
    });

    // The per-viewer profile cache encodes visibility at write time — a
    // newly-added friend must see the author's closeFriends posts, so drop
    // the cached profile lists + feeds for this author immediately.
    await clearUserPostsCache(currentUserId);
    await clearFeedCache();
    // The newly-added friend must see the author's existing closeFriends
    // posts NOW (not after their ranked/for-you cache TTL expires).
    await invalidateViewerFeedCaches(targetUserId);

    return res.status(200).json({ success: true, message: "Added to close friends" });
  } catch (err: any) {
    logger.error("Error in addCloseFriend", { error: err.message });
    return res.status(500).json({ success: false, message: "Failed to add close friend" });
  }
};

/**
 * Remove a user from close friends list.
 * DELETE /api/users/close-friends/:userId
 */
export const removeCloseFriend = async (req: Request, res: Response) => {
  try {
    const currentUserId = (req as any).user._id?.toString();
    const targetUserId = req.params.userId as string;

    await User.findByIdAndUpdate(currentUserId, {
      $pull: { closeFriends: targetUserId },
    });

    // Privacy-critical: a removed close friend must immediately stop seeing
    // the author's closeFriends posts (including from the per-viewer profile
    // cache, which is valid for up to 30 min). Drop the cached lists now.
    await clearUserPostsCache(currentUserId);
    await clearFeedCache();
    // Privacy-critical (removal): the removed friend's cached ranked feed
    // (5 min TTL) would otherwise keep showing the author's closeFriends
    // posts. Invalidate their per-viewer feeds immediately.
    await invalidateViewerFeedCaches(targetUserId);

    return res.status(200).json({ success: true, message: "Removed from close friends" });
  } catch (err: any) {
    logger.error("Error in removeCloseFriend", { error: err.message });
    return res.status(500).json({ success: false, message: "Failed to remove close friend" });
  }
};

/**
 * Get close friends list.
 * GET /api/users/close-friends
 */
export const getCloseFriends = async (req: Request, res: Response) => {
  try {
    const currentUserId = (req as any).user._id?.toString();

    const user = await User.findById(currentUserId)
      .populate("closeFriends", "_id username fullName profilePic waitlistPerk")
      .lean();

    // Blocked users must not exist for each other — drop any close friend
    // with a mutual block relationship (either direction) from the list.
    let closeFriends = user?.closeFriends || [];
    try {
      const blockedIds = new Set(await getBlockedUserIds(currentUserId));
      if (blockedIds.size > 0) {
        closeFriends = closeFriends.filter((cf: any) => {
          const cfId =
            typeof cf === "object"
              ? cf?._id?.toString?.()
              : cf?.toString?.();
          return cfId ? !blockedIds.has(cfId) : true;
        });
      }
    } catch (blockErr: any) {
      logger.error("Blocked-close-friend filter error in getCloseFriends", {
        error: blockErr.message,
      });
    }

    return res.status(200).json({
      success: true,
      closeFriends,
    });
  } catch (err: any) {
    logger.error("Error in getCloseFriends", { error: err.message });
    return res.status(500).json({ success: false, message: "Failed to get close friends" });
  }
};

/**
 * Check if a user is a close friend.
 * GET /api/users/close-friends/:userId/check
 */
export const checkCloseFriend = async (req: Request, res: Response) => {
  try {
    const currentUserId = (req as any).user._id?.toString();
    const targetUserId = req.params.userId;

    const user = await User.findById(currentUserId).select("closeFriends").lean();
    const isCloseFriend = (user?.closeFriends || []).some(
      (id) => id.toString() === targetUserId
    );

    return res.status(200).json({ success: true, isCloseFriend });
  } catch (err: any) {
    logger.error("Error in checkCloseFriend", { error: err.message });
    return res.status(500).json({ success: false, message: "Failed to check close friend status" });
  }
};
