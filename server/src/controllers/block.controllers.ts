import { Request, Response } from "express";
import Block from "../models/block.model";
import Follow from "../models/follow.model";
import { User } from "../models/user.model";
import { Conversation } from "../models/conversation.model";
import { Message } from "../models/message.model";
import Notification from "../models/notification.model";
import { logger } from "../utilities/logger";
import { clearChatCache, clearByPattern, deleteCache } from "../configs/cache";
import { getIO } from "../configs/socket";

/**
 * Blocked users must not exist for each other — after a block (or unblock),
 * every viewer-sensitive cache for BOTH users must be wiped so a stale
 * pre-block response (profile, search, feed, trending, glances, followers,
 * notifications…) can never be served to the other party. Blocking is rare,
 * so clearing broadly is the correct trade-off vs. correctness.
 */// Optimized: direct deletes + reduced SCAN loops (saves ~50 Redis cmds per block).
// Block is rare, but SCAN loops are expensive. api: route cache has 60s TTL.
async function clearUserVisibilityCaches(userId: string) {
	if (!userId) return;
	// Direct deletes for known user-specific keys
	await Promise.all([
		deleteCache(`user:${userId}`),
		clearByPattern(`user:${userId}:posts:page:*`),
		clearByPattern(`users:suggested:${userId}:*`),
		clearByPattern(`feed:ranked:${userId}`),
		clearByPattern(`feed:for-you:${userId}:*`),
	]);
	// Global content caches — only clear what a block actually affects
	await Promise.all([
		clearByPattern("posts:feed"),
		clearByPattern("posts:trending"),
		clearByPattern("trending:*"),
	]);
}

/**
 * Block a user.
 * POST /api/blocks/:userId
 */
export const blockUser = async (req: Request, res: Response) => {
  try {
    const currentUserId = (req as any).user._id?.toString();
    const targetUserId = req.params.userId;

    if (currentUserId === targetUserId) {
      return res.status(400).json({ success: false, message: "Cannot block yourself" });
    }

    // Check if already blocked
    const existing = await Block.findOne({ blocker: currentUserId, blocked: targetUserId });
    if (existing) {
      return res.status(200).json({ success: true, message: "Already blocked", blocked: true });
    }

    await Block.create({ blocker: currentUserId as any, blocked: targetUserId as any });

    // Blocked users must not exist for each other — wipe every
    // viewer-sensitive cache for both users immediately, so neither party
    // can be served a stale pre-block response (profile, search, feed,
    // trending, glances, notifications) from Redis.
    try {
      const targetId = typeof targetUserId === "string" ? targetUserId : "";
      await Promise.all([
        clearUserVisibilityCaches(currentUserId),
        targetId ? clearUserVisibilityCaches(targetId) : Promise.resolve(),
      ]);
    } catch (cacheErr: any) {
      logger.error("Failed to clear visibility caches on block", {
        error: cacheErr.message,
      });
    }

    // Notify both users in realtime so their clients can evict local
    // caches (CacheStorage / IndexedDB) and refetch — a blocked user must
    // stop existing on the other user's device immediately, not after a
    // cache TTL or reload.
    try {
      const io = getIO();
      io.to(`user:${currentUserId}`).emit("user:blocked", {
        targetUserId,
        by: targetUserId,
      });
      if (targetUserId) {
        io.to(`user:${targetUserId}`).emit("user:blocked", {
          targetUserId: currentUserId,
          by: currentUserId,
        });
      }
    } catch (socketErr: any) {
      logger.error("Failed to emit user:blocked", { error: socketErr.message });
    }

    // Blocked users must not exist for each other — wipe the direct
    // conversation, all messages, and every notification between them.
    try {
      const conversation = await Conversation.findOneAndDelete({
        participants: { $all: [currentUserId, targetUserId] },
        type: { $ne: "group" },
      });
      if (conversation && targetUserId) {
        await Message.deleteMany({ conversation: conversation._id });
        await clearChatCache(conversation._id.toString(), [
          currentUserId.toString(),
          targetUserId,
        ]);

        // Remove both users' sockets from the conversation room and emit a
        // realtime "conversation:delete" to each of their personal rooms —
        // Chat.tsx listens for this and instantly drops the conversation from
        // the list + closes it if it's open. Without this, the other user's
        // UI keeps showing (and lets them keep typing into) a dead chat until
        // a reload.
        try {
          const io = getIO();
          io.in(`conversation:${conversation._id.toString()}`).socketsLeave(
            `conversation:${conversation._id.toString()}`,
          );
          io.to(`user:${currentUserId.toString()}`).emit(
            "conversation:delete",
            { conversationId: conversation._id.toString() },
          );
          io.to(`user:${targetUserId}`).emit("conversation:delete", {
            conversationId: conversation._id.toString(),
          });
        } catch (socketErr: any) {
          logger.error("Failed to emit conversation:delete on block", {
            error: socketErr.message,
          });
        }
      }
      // Also invalidate any route-level conversation-list caches for both users
      // (real keys are api:<uid>:/api/chats/conversations... — the chat router
      // is mounted at /api/chats)
      await clearByPattern(`api:${currentUserId}:/api/chats/conversations*`);
      if (targetUserId) {
        await clearByPattern(`api:${targetUserId}:/api/chats/conversations*`);
      }
      // getConversations actually caches under `chat:conversations:${userId}`
      // (30s TTL) — clear that exact key for both users so a stale cached
      // list can't resurrect the deleted conversation for up to 30 seconds.
      await clearByPattern(`chat:conversations:${currentUserId}*`);
      if (targetUserId) {
        await clearByPattern(`chat:conversations:${targetUserId}*`);
      }
      await Notification.deleteMany({
        $or: [
          { recipient: currentUserId, sender: targetUserId },
          { recipient: targetUserId, sender: currentUserId },
        ],
      });
    } catch { /* non-critical cleanup */ }

    // Unfollow if following (clean up follow relationships and update counters)
    try {
      const followA = await Follow.findOneAndDelete({ follower: currentUserId, following: targetUserId });
      if (followA) {
        await User.findByIdAndUpdate(currentUserId, { $inc: { followingCount: -1 } });
        await User.findByIdAndUpdate(targetUserId, { $inc: { followersCount: -1 } });
      }

      const followB = await Follow.findOneAndDelete({ follower: targetUserId, following: currentUserId });
      if (followB) {
        await User.findByIdAndUpdate(targetUserId, { $inc: { followingCount: -1 } });
        await User.findByIdAndUpdate(currentUserId, { $inc: { followersCount: -1 } });
      }
    } catch { /* non-critical */ }

    logger.info(`User ${currentUserId} blocked user ${targetUserId}`);
    return res.status(200).json({ success: true, message: "User blocked", blocked: true });
  } catch (err: any) {
    logger.error("Error in blockUser", { error: err.message });
    return res.status(500).json({ success: false, message: "Failed to block user" });
  }
};

/**
 * Unblock a user.
 * DELETE /api/blocks/:userId
 */
export const unblockUser = async (req: Request, res: Response) => {
  try {
    const currentUserId = (req as any).user._id?.toString();
    const targetUserId = req.params.userId;

    await Block.findOneAndDelete({ blocker: currentUserId, blocked: targetUserId });

    // Wipe the visibility caches again so the previously-hidden content
    // becomes visible immediately (no stale "user not found" responses).
    try {
      const targetId = typeof targetUserId === "string" ? targetUserId : "";
      await Promise.all([
        clearUserVisibilityCaches(currentUserId),
        targetId ? clearUserVisibilityCaches(targetId) : Promise.resolve(),
      ]);
    } catch (cacheErr: any) {
      logger.error("Failed to clear visibility caches on unblock", {
        error: cacheErr.message,
      });
    }

    try {
      const io = getIO();
      io.to(`user:${currentUserId}`).emit("user:unblocked", { targetUserId });
      if (targetUserId) {
        io.to(`user:${targetUserId}`).emit("user:unblocked", {
          targetUserId: currentUserId,
        });
      }
    } catch (socketErr: any) {
      logger.error("Failed to emit user:unblocked", { error: socketErr.message });
    }

    logger.info(`User ${currentUserId} unblocked user ${targetUserId}`);
    return res.status(200).json({ success: true, message: "User unblocked", blocked: false });
  } catch (err: any) {
    logger.error("Error in unblockUser", { error: err.message });
    return res.status(500).json({ success: false, message: "Failed to unblock user" });
  }
};

/**
 * Get list of users blocked by the current user.
 * GET /api/blocks
 */
export const getBlockedUsers = async (req: Request, res: Response) => {
  try {
    const currentUserId = (req as any).user._id?.toString();

    const blocks = await Block.find({ blocker: currentUserId })
      .populate("blocked", "_id username fullName profilePic waitlistPerk")
      .sort({ createdAt: -1 });

    const users = blocks.map((b) => b.blocked);

    // Return under both keys for backward compatibility with older clients
    return res.status(200).json({ success: true, users, blockedUsers: users });
  } catch (err: any) {
    logger.error("Error in getBlockedUsers", { error: err.message });
    return res.status(500).json({ success: false, message: "Failed to get blocked users" });
  }
};

/**
 * Check if current user has blocked a specific user.
 * GET /api/blocks/:userId/check
 */
export const checkBlocked = async (req: Request, res: Response) => {
  try {
    const currentUserId = (req as any).user._id?.toString();
    const targetUserId = req.params.userId;

    const block = await Block.findOne({ blocker: currentUserId, blocked: targetUserId });
    const blockedByThem = await Block.findOne({ blocker: targetUserId, blocked: currentUserId });

    return res.status(200).json({
      success: true,
      iBlocked: !!block,
      blockedByThem: !!blockedByThem,
    });
  } catch (err: any) {
    logger.error("Error in checkBlocked", { error: err.message });
    return res.status(500).json({ success: false, message: "Failed to check block status" });
  }
};

/**
 * Mute a user for 30 days.
 * POST /api/blocks/:userId/mute
 */
export const muteUser = async (req: Request, res: Response) => {
  try {
    const currentUserId = (req as any).user._id?.toString();
    const targetUserId = req.params.userId;

    // First remove any existing mute for this user (prevent duplicates)
    await User.findByIdAndUpdate(currentUserId, {
      $pull: { mutedUsers: { user: targetUserId as any } },
    });
    // Then add new mute
    await User.findByIdAndUpdate(currentUserId, {
      $push: {
        mutedUsers: {
          user: targetUserId,
          mutedAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        },
      },
    });

    return res.status(200).json({ success: true, message: "User muted for 30 days", muted: true });
  } catch (err: any) {
    logger.error("Error in muteUser", { error: err.message });
    return res.status(500).json({ success: false, message: "Failed to mute user" });
  }
};

/**
 * Unmute a user.
 * DELETE /api/blocks/:userId/mute
 */
export const unmuteUser = async (req: Request, res: Response) => {
  try {
    const currentUserId = (req as any).user._id?.toString();
    const targetUserId = req.params.userId;

    await User.findByIdAndUpdate(currentUserId, {
      $pull: { mutedUsers: { user: targetUserId } },
    });

    return res.status(200).json({ success: true, message: "User unmuted", muted: false });
  } catch (err: any) {
    logger.error("Error in unmuteUser", { error: err.message });
    return res.status(500).json({ success: false, message: "Failed to unmute user" });
  }
};

// return 400 if userId equals targetUserId
