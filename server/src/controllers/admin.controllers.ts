import type { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { FeatureFlag } from "../models/featureFlag.model";
import { User } from "../models/user.model";
import Report from "../models/report.model";
import Post from "../models/post.model";
import Comment from "../models/comment.model";
import Glimpse from "../models/glimpse.model";
import ExternalPost from "../models/externalPost.model";
import Like from "../models/like.model";
import Notification from "../models/notification.model";
import { Community } from "../models/community.model";
import { CommunityMessage } from "../models/communityMessage.model";
import { ModerationItem } from "../models/moderationItem.model";
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  AppError,
} from "../utilities/errors";
import { logger } from "../utilities/logger";
import { deleteCache, clearCommentsCache } from "../configs/cache";
import { clearMemUserCache } from "../middlewares/auth.middleware";
import {
  disconnectUserSockets,
  getOnlineUsersCount,
  getIO,
} from "../configs/socket";
import { deletePostData } from "./post.controllers";
import { deleteUserAndData } from "./user.controllers";
import { deleteGlimpseAndCleanup } from "./glimpse.controllers";
import { collectDescendantCommentIds } from "./comment.controllers";
import { Broadcast } from "../models/broadcast.model";
import XP from "../models/xp.model";
import { UserStreak } from "../models/userStreak.model";
import { Conversation } from "../models/conversation.model";
import { Message } from "../models/message.model";
import { cookieOptions } from "../configs/cookie";

/**
 * GET /api/admin/stats — platform overview metrics (admin only).
 */
export const getAdminStats = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = req.user as any;
    if (!user?.isAdmin) return next(new ForbiddenError("Admin access required!"));

    const [
      totalUsers,
      totalPosts,
      totalComments,
      totalGlances,
      totalCommunities,
      pendingReports,
      pendingModeration,
      mutedUsers,
      bannedUsers,
    ] = await Promise.all([
      User.countDocuments(),
      Post.countDocuments({ status: { $ne: "draft" } }),
      Comment.countDocuments(),
      Glimpse.countDocuments(),
      Community.countDocuments(),
      Report.countDocuments({ status: "pending" }),
      ModerationItem.countDocuments({ status: "pending" }),
      User.countDocuments({ isMuted: true }),
      User.countDocuments({ isBanned: true }),
    ]);

    // Authoritative "online now" count from in-memory socket presence.
    // (updatedAt is bumped by logins/profile edits, so a DB-based "active
    // in 24h" query would overcount — it always equalled totalUsers.)
    const onlineUsers = getOnlineUsersCount();

    return res.status(200).json({
      success: true,
      stats: {
        totalUsers,
        totalPosts,
        totalComments,
        totalGlances,
        totalCommunities,
        pendingReports,
        pendingModeration,
        activeUsers: onlineUsers,
        mutedUsers,
        bannedUsers,
      },
    });
  } catch (err: any) {
    logger.error("Error getting admin stats", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

export const createFeatureFlag = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = req.user as any;
    if (!user?.isAdmin) return next(new ForbiddenError("Admin access required!"));

    const { key, description, enabled, percentage } = req.body;
    if (!key) return next(new BadRequestError("Flag key is required!"));

    const existing = await FeatureFlag.findOne({ key });
    if (existing) return next(new BadRequestError("Flag with this key already exists!"));

    const flag = new FeatureFlag({ key, description, enabled, percentage });
    await flag.save();

    return res.status(201).json({ success: true, flag });
  } catch (err: any) {
    logger.error("Error creating feature flag", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

export const getFeatureFlags = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = req.user as any;
    if (!user?.isAdmin) return next(new ForbiddenError("Admin access required!"));

    const flags = await FeatureFlag.find().sort({ createdAt: -1 }).lean();
    return res.status(200).json({ success: true, flags });
  } catch (err: any) {
    logger.error("Error getting feature flags", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

export const updateFeatureFlag = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = req.user as any;
    if (!user?.isAdmin) return next(new ForbiddenError("Admin access required!"));

    const { flagId } = req.params;
    const updates = req.body;

    const flag = await FeatureFlag.findByIdAndUpdate(flagId, updates, { new: true });
    if (!flag) return next(new NotFoundError("Flag not found!"));

    return res.status(200).json({ success: true, flag });
  } catch (err: any) {
    logger.error("Error updating feature flag", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

export const getUserFlags = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) return next(new UnauthorizedError("Unauthorized!"));

    const flags = await FeatureFlag.find({ enabled: true }).lean();

    const userFlags: Record<string, boolean> = {};
    for (const flag of flags) {
      if (flag.adminOverride) {
        userFlags[flag.key] = true;
        continue;
      }
      if (flag.users.length > 0) {
        userFlags[flag.key] = flag.users.some((u) => u.toString() === currentUserId.toString());
        continue;
      }
      // Check by percentage
      if (flag.percentage >= 100) {
        userFlags[flag.key] = true;
      } else if (flag.percentage > 0) {
        const hash = (currentUserId.toString() + flag.key).split("").reduce((a, b) => {
          a = (a << 5) - a + b.charCodeAt(0);
          return a & a;
        }, 0);
        userFlags[flag.key] = Math.abs(hash) % 100 < flag.percentage;
      } else {
        userFlags[flag.key] = false;
      }
    }

    return res.status(200).json({ success: true, flags: userFlags });
  } catch (err: any) {
    logger.error("Error getting user flags", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

// Admin user management
export const toggleUserMute = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = req.user as any;
    if (!user?.isAdmin) return next(new ForbiddenError("Admin access required!"));

    const { userId } = req.params;
    const { muted } = req.body;

    const targetUser = await User.findByIdAndUpdate(
      userId,
      { $set: { isMuted: muted } },
      { new: true },
    );

    if (!targetUser) return next(new NotFoundError("User not found!"));

    await deleteCache(`auth:user:${userId}`);
    clearMemUserCache(String(userId));
    // Real-time: the target's muted state updates instantly (posting/comments
    // are blocked server-side, and their UI shows the muted notice).
    try {
      getIO().to(`user:${userId}`).emit("user:updated", { at: Date.now() });
    } catch (err: any) {
      logger.error("Failed to emit user:updated", { error: err.message });
    }

    return res.status(200).json({ success: true, message: muted ? "User muted" : "User unmuted" });
  } catch (err: any) {
    logger.error("Error toggling user mute", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

export const toggleUserVerify = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = req.user as any;
    if (!user?.isAdmin) return next(new ForbiddenError("Admin access required!"));

    const { userId } = req.params;
    const { verified } = req.body;

    if (typeof verified !== "boolean") {
      return next(new BadRequestError("verified must be a boolean!"));
    }

    const targetUser = await User.findByIdAndUpdate(
      userId,
      { $set: { isVerified: verified } },
      { new: true },
    );

    if (!targetUser) return next(new NotFoundError("User not found!"));

    await deleteCache(`auth:user:${userId}`);
    clearMemUserCache(String(userId));
    // Real-time: the verified badge on the target's profile + own UI
    // updates the moment the admin toggles it.
    try {
      getIO().to(`user:${userId}`).emit("user:updated", { at: Date.now() });
    } catch (err: any) {
      logger.error("Failed to emit user:updated", { error: err.message });
    }

    return res.status(200).json({
      success: true,
      message: verified ? "User verified" : "User unverified",
      isVerified: verified,
    });
  } catch (err: any) {
    logger.error("Error toggling user verification", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

export const toggleUserBan = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = req.user as any;
    if (!user?.isAdmin) return next(new ForbiddenError("Admin access required!"));

    const { userId } = req.params;
    const { banned } = req.body;

    const targetUser = await User.findByIdAndUpdate(
      userId,
      { $set: { isBanned: banned } },
      { new: true },
    );

    if (!targetUser) return next(new NotFoundError("User not found!"));

    await deleteCache(`auth:user:${userId}`);
    clearMemUserCache(String(userId));
    // Real-time: notify the target's open sessions BEFORE the ban disconnect
    // kicks them, so their other devices can react to the ban state.
    try {
      getIO().to(`user:${userId}`).emit("user:updated", { at: Date.now() });
    } catch (err: any) {
      logger.error("Failed to emit user:updated", { error: err.message });
    }

    if (banned && typeof userId === "string") {
      disconnectUserSockets(userId);
    }

    return res.status(200).json({ success: true, message: banned ? "User banned" : "User unbanned" });
  } catch (err: any) {
    logger.error("Error toggling user ban", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/* ─────────────────────────────────────────────────────────────────────
   FULL-CONTROL ENDPOINTS — the admin panel's "god mode".
   Every endpoint is guarded by the isAdmin check on the authenticated
   user. Admins can manage any user, any content (posts, comments,
   glances, communities), review every report, and monitor the platform.
   ─────────────────────────────────────────────────────────────────── */

const requireAdmin = (req: Request) => {
  const user = req.user as any;
  if (!user?.isAdmin) {
    throw new ForbiddenError("Admin access required!");
  }
};

const escapeRegex = (str: string) =>
  str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const pagination = (req: Request) => {
  const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
  const limit = Math.min(
    Math.max(1, parseInt(String(req.query.limit), 10) || 20),
    50,
  );
  return { page, limit, skip: (page - 1) * limit };
};

/**
 * GET /api/admin/users?q=&page=&limit= — list any user (search by
 * username / email / full name), with moderation + perk flags visible.
 */
export const adminListUsers = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const q = String(req.query.q || "").trim();
    const { page, limit, skip } = pagination(req);
    const query: any = {};
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      query.$or = [{ username: rx }, { email: rx }, { fullName: rx }];
    }
    const [users, total] = await Promise.all([
      User.find(query)
        .select("-password -otp -otpExpiry -knownDevices")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query),
    ]);
    return res.status(200).json({
      success: true,
      users,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error listing admin users", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

// Whitelisted fields an admin may change on ANY user.
const USER_EDITABLE_FIELDS = [
  "username",
  "fullName",
  "bio",
  "gender",
  "statusText",
  "isVerified",
  "isMuted",
  "isBanned",
  "isAdmin",
  "isPrivate",
  "notificationsEnabled",
  "waitlistPerk",
];

/**
 * PUT /api/admin/users/:userId — change any allowed field on any user
 * (admin/verify/mute/ban/perk flags, profile fields). Invalidates their
 * session cache and kicks sockets when banned.
 */
export const adminUpdateUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const userId = String(req.params.userId);
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return next(new BadRequestError("Invalid user ID!"));
    }
    const update: Record<string, unknown> = {};
    for (const field of USER_EDITABLE_FIELDS) {
      if (field in req.body) update[field] = req.body[field];
    }
    if (Object.keys(update).length === 0) {
      return next(new BadRequestError("No editable fields provided!"));
    }
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: update },
      { new: true },
    ).select("-password -otp -otpExpiry -knownDevices");
    if (!user) return next(new NotFoundError("User not found!"));
    await deleteCache(`auth:user:${userId}`);
    clearMemUserCache(String(userId));
    if (update.isBanned === true) {
      disconnectUserSockets(String(userId));
    }
    return res.status(200).json({ success: true, user, message: "User updated!" });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    if (err?.code === 11000) {
      return next(new BadRequestError("Username or email already in use!"));
    }
    logger.error("Error updating admin user", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * DELETE /api/admin/users/:userId — full account wipe. Runs the exact
 * same cascade as the user's own delete-account flow (media, counts,
 * follows, chats, caches) and disconnects their live sockets.
 */
export const adminDeleteUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const userId = String(req.params.userId);
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return next(new BadRequestError("Invalid user ID!"));
    }
    const actingUser = req.user as any;
    if (String(actingUser._id) === userId) {
      return next(new BadRequestError("You can't delete your own account from the admin panel!"));
    }
    const user = await User.findById(userId);
    if (!user) return next(new NotFoundError("User not found!"));
    await deleteUserAndData(user);
    disconnectUserSockets(String(userId));
    logAdminAction(req, "delete_user", {
      targetType: "user",
      targetId: userId,
      targetName: user.username,
    });
    return res.status(200).json({ success: true, message: "User deleted!" });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error deleting admin user", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * GET /api/admin/posts?q=&page=&limit= — list any post (search by
 * title / content / slug), newest first, with author info.
 */
export const adminListPosts = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const q = String(req.query.q || "").trim();
    const { page, limit, skip } = pagination(req);
    const query: any = { status: { $ne: "draft" } };
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      query.$or = [{ title: rx }, { content: rx }, { slug: rx }];
    }
    const [posts, total] = await Promise.all([
      Post.find(query)
        .populate("author", "username fullName profilePic")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Post.countDocuments(query),
    ]);
    return res.status(200).json({
      success: true,
      posts,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error listing admin posts", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * DELETE /api/admin/posts/:postId — remove any post with the full
 * cascade (comments, likes, reposts, saves, notifications, media).
 */
export const adminDeletePost = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const postId = String(req.params.postId);
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return next(new BadRequestError("Invalid post ID!"));
    }
    const post = await Post.findById(postId);
    if (!post) return next(new NotFoundError("Post not found!"));
    await deletePostData(post, String((req.user as any)?._id));
    logAdminAction(req, "delete_post", { targetType: "post", targetId: postId });
    return res.status(200).json({ success: true, message: "Post deleted!" });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error deleting admin post", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * GET /api/admin/comments?page=&limit= — list any comment, newest first.
 */
export const adminListComments = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const { page, limit, skip } = pagination(req);
    const [comments, total] = await Promise.all([
      Comment.find({})
        .populate("author", "username fullName profilePic")
        .populate("post", "slug title")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Comment.countDocuments({}),
    ]);
    return res.status(200).json({
      success: true,
      comments,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error listing admin comments", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * DELETE /api/admin/comments/:commentId — remove any comment and its
 * reply tree, decrement the parent post's count.
 */
export const adminDeleteComment = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const commentId = String(req.params.commentId);
    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      return next(new BadRequestError("Invalid comment ID!"));
    }
    const comment = await Comment.findById(commentId);
    if (!comment) return next(new NotFoundError("Comment not found!"));

    const commentIds = await collectDescendantCommentIds(commentId);
    await Promise.all([
      Comment.deleteMany({ _id: { $in: commentIds } }),
      Like.deleteMany({ comment: { $in: commentIds } }),
      Notification.deleteMany({ comment: { $in: commentIds } }),
    ]);
    if (comment.externalPost) {
      await ExternalPost.findByIdAndUpdate(comment.externalPost, {
        $inc: { orbitCommentsCount: -commentIds.length },
      });
    } else if (comment.post) {
      await Post.findByIdAndUpdate(comment.post, {
        $inc: { commentsCount: -commentIds.length },
      });
    }
    if (comment.parent) {
      await Comment.findByIdAndUpdate(comment.parent, {
        $inc: { repliesCount: -1 },
      });
    }
    if (comment.post) {
      await clearCommentsCache(String(comment.post));
    }
    logAdminAction(req, "delete_comment", { targetType: "comment", targetId: commentId });
    return res.status(200).json({ success: true, message: "Comment deleted!" });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error deleting admin comment", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * GET /api/admin/glances?page=&limit= — list any 24h glance.
 */
export const adminListGlances = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const { page, limit, skip } = pagination(req);
    const [glances, total] = await Promise.all([
      Glimpse.find({})
        .populate("author", "username fullName profilePic")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Glimpse.countDocuments({}),
    ]);
    return res.status(200).json({
      success: true,
      glances,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error listing admin glances", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * DELETE /api/admin/glances/:glimpseId — remove any glance + its media.
 */
export const adminDeleteGlimpse = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const glimpseId = String(req.params.glimpseId);
    if (!mongoose.Types.ObjectId.isValid(glimpseId)) {
      return next(new BadRequestError("Invalid glimpse ID!"));
    }
    const glimpse = await Glimpse.findById(glimpseId);
    if (!glimpse) return next(new NotFoundError("Glimpse not found!"));
    await deleteGlimpseAndCleanup(glimpse);
    logAdminAction(req, "delete_glimpse", { targetType: "glimpse", targetId: glimpseId });
    return res.status(200).json({ success: true, message: "Glimpse deleted!" });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error deleting admin glimpse", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * GET /api/admin/communities?page=&limit= — list any community.
 */
export const adminListCommunities = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const { page, limit, skip } = pagination(req);
    const [communities, total] = await Promise.all([
      Community.find({})
        .populate("creator", "username fullName profilePic")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Community.countDocuments({}),
    ]);
    return res.status(200).json({
      success: true,
      communities,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error listing admin communities", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * DELETE /api/admin/communities/:communityId — remove any community and
 * all of its messages, then notify connected members in real-time.
 */
export const adminDeleteCommunity = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const communityId = String(req.params.communityId);
    if (!mongoose.Types.ObjectId.isValid(communityId)) {
      return next(new BadRequestError("Invalid community ID!"));
    }
    const community = await Community.findById(communityId);
    if (!community) return next(new NotFoundError("Community not found!"));
    await CommunityMessage.deleteMany({ community: communityId });
    await Community.findByIdAndDelete(communityId);
    getIO().to(`community:${communityId}`).emit("community:deleted", {
      communityId,
    });
    logAdminAction(req, "delete_community", { targetType: "community", targetId: communityId });
    return res.status(200).json({ success: true, message: "Community deleted!" });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error deleting admin community", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * GET /api/admin/reports?status=&page=&limit= — full report queue, any
 * status (pending / action_taken / dismissed), not just pending.
 */
export const adminListReports = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const status = String(req.query.status || "");
    const { page, limit, skip } = pagination(req);
    const query: any = {};
    if (status && status !== "all") query.status = status;
    const [reports, total] = await Promise.all([
      Report.find(query)
        .populate("reporter", "username fullName profilePic")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Report.countDocuments(query),
    ]);
    return res.status(200).json({
      success: true,
      reports,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error listing admin reports", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};


/* ────────────────────────────────────────────────────────────────────────
 * GOD MODE — full-spectrum admin powers
 * ──────────────────────────────────────────────────────────────────────── */

const GOD_EDITABLE_FIELDS = [
  ...USER_EDITABLE_FIELDS,
  "email",
  "profilePic",
  "followersCount",
  "followingCount",
  "postsCount",
  "permissionOnboardingCompleted",
];

/**
 * GET /api/admin/users/:userId/detail — the god-eye view.
 * Everything about a user in one payload: full profile, counters, streaks,
 * XP, and their latest content so an admin can act instantly.
 */
export const getAdminUserDetail = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const userId = String(req.params.userId);
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return next(new BadRequestError("Invalid user ID!"));
    }

    const user = await User.findById(userId).select(
      "-password -otp -otpExpiry -knownDevices -passwordHistory",
    );
    if (!user) return next(new NotFoundError("User not found!"));

    const [posts, comments, glimpses, communities, xp, streak, convos, latestPosts, latestComments] =
      await Promise.all([
        Post.countDocuments({ author: userId }),
        Comment.countDocuments({ author: userId }),
        Glimpse.countDocuments({ author: userId }),
        Community.countDocuments({ creator: userId }),
        XP.findOne({ userId }).lean(),
        UserStreak.findOne({ user: userId }).lean(),
        Conversation.find({ participants: userId }).countDocuments(),
        Post.find({ author: userId, status: { $ne: "draft" } })
          .sort({ createdAt: -1 })
          .limit(10)
          .select("title content slug likesCount commentsCount createdAt status")
          .lean(),
        Comment.find({ author: userId })
          .sort({ createdAt: -1 })
          .limit(10)
          .select("content likesCount createdAt post")
          .populate("post", "title slug content")
          .lean(),
      ]);

    // Latest conversations with message previews (admin monitoring of chats)
    const convoDocs = await Conversation.find({ participants: userId })
      .sort({ updatedAt: -1 })
      .limit(10)
      .lean();
    const convoPreviews = await Promise.all(
      convoDocs.map(async (c) => {
        const lastMsg = await Message.findOne({ conversation: c._id })
          .sort({ createdAt: -1 })
          .select("content createdAt sender")
          .populate("sender", "username fullName profilePic")
          .lean();
        const count = await Message.countDocuments({ conversation: c._id });
        return {
          conversationId: c._id,
          count,
          lastMessage: lastMsg || null,
        };
      }),
    );

    return res.status(200).json({
      success: true,
      user,
      stats: {
        posts: posts,
        comments,
        glimpses,
        communitiesCreated: communities,
        conversations: convos,
        xp: xp?.totalXP || 0,
        xpLevel: xp?.level || 1,
        badges: xp?.badges || [],
        streak: streak?.currentStreak || 0,
        lastActiveDate: streak?.lastActiveDate || null,
      },
      latestPosts,
      latestComments,
      conversations: convoPreviews,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error fetching admin user detail", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * PUT /api/admin/users/:userId — GOD MODE version: any field, including
 * email, profile picture, and social counters. Keeps the same cache/socket
 * invalidation as before and re-syncs email canonicalization.
 */
export const adminGodUpdateUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const userId = String(req.params.userId);
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return next(new BadRequestError("Invalid user ID!"));
    }
    const update: Record<string, unknown> = {};
    for (const field of GOD_EDITABLE_FIELDS) {
      if (field in req.body) update[field] = req.body[field];
    }
    if (Object.keys(update).length === 0) {
      return next(new BadRequestError("No editable fields provided!"));
    }
    // Normalize email casing so auth lookups still match.
    if (typeof update.email === "string") update.email = update.email.trim().toLowerCase();
    if (update.profilePic && typeof update.profilePic === "string") {
      update.profilePic = { url: update.profilePic };
    }

    const user = await User.findByIdAndUpdate(userId, { $set: update }, { new: true }).select(
      "-password -otp -otpExpiry -knownDevices -passwordHistory",
    );
    if (!user) return next(new NotFoundError("User not found!"));
    await deleteCache(`auth:user:${userId}`);
    clearMemUserCache(String(userId));
    // Real-time: tell the target's open sessions their account changed
    // (isAdmin / verify / mute / ban) so the UI reflects it instantly — the
    // promoted admin's Admin tab, the verified badge, muted state. Emitted
    // BEFORE any disconnect below so the event reaches the target's sockets
    // (a banned user is kicked right after).
    try {
      getIO().to(`user:${userId}`).emit("user:updated", { at: Date.now() });
    } catch (err: any) {
      logger.error("Failed to emit user:updated", { error: err.message });
    }
    if (update.isBanned === true || update.isMuted === true) {
      disconnectUserSockets(String(userId));
    }
    logAdminAction(req, "edit_user", {
      targetType: "user",
      targetId: userId,
      targetName: (user as any)?.username,
      details: { fields: Object.keys(update) },
    });
    return res.status(200).json({ success: true, user, message: "User updated (god mode)!" });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    if (err?.code === 11000) {
      return next(new BadRequestError("Username or email already in use!"));
    }
    logger.error("Error in god-mode user update", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * POST /api/admin/users/:userId/impersonate — sign in AS the target user.
 * Sets the httpOnly jwt cookie exactly like a real login, so the next
 * client reload boots the session as that user. The admin can act as
 * anyone, see their view, and investigate anything first-hand. Logging out
 * (or re-login as admin) returns control.
 */
export const adminImpersonateUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const userId = String(req.params.userId);
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return next(new BadRequestError("Invalid user ID!"));
    }
    const actingUser = req.user as any;
    if (String(actingUser._id) === userId) {
      return next(new BadRequestError("You are already this user!"));
    }
    const target = await User.findById(userId);
    if (!target) return next(new NotFoundError("User not found!"));

    const token = target.signToken();
    logAdminAction(req, "impersonate", {
      targetType: "user",
      targetId: userId,
      targetName: target.username,
    });
    res.cookie("jwt", token, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: "/",
    });
    return res.status(200).json({
      success: true,
      message: `Now acting as @${target.username}`,
      user: {
        _id: target._id,
        username: target.username,
        fullName: target.fullName,
        isAdmin: target.isAdmin,
      },
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error impersonating user", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * POST /api/admin/users/:userId/reset-password — force a new password for
 * any account. Returns the generated temporary password so the admin can
 * hand it to the user (or use it to sign in as them).
 */
export const adminResetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const userId = String(req.params.userId);
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return next(new BadRequestError("Invalid user ID!"));
    }
    const user = await User.findById(userId);
    if (!user) return next(new NotFoundError("User not found!"));

    const temp = Array.from({ length: 12 }, () =>
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789".charAt(
        Math.floor(Math.random() * 56),
      ),
    ).join("");
    user.password = temp;
    await user.save();

    // Invalidate cached session + kick existing sockets so the old session dies.
    await deleteCache(`auth:user:${userId}`);
    clearMemUserCache(String(userId));
    disconnectUserSockets(String(userId));
    logAdminAction(req, "reset_password", {
      targetType: "user",
      targetId: userId,
      targetName: user.username,
    });

    return res.status(200).json({
      success: true,
      message: "Password reset!",
      tempPassword: temp,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error resetting user password", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * POST /api/admin/broadcast — send an announcement to every user in the app.
 * Deactivates any previous broadcast (only one active at a time), persists
 * the new one, and socket-pushes it to everyone online instantly. Offline
 * users pick it up on their next boot via /api/admin/broadcasts/active.
 */
export const createBroadcast = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const { title, message, type, expiresAt } = req.body as {
      title?: string;
      message?: string;
      type?: "banner" | "notice";
      expiresAt?: string | null;
    };
    if (!title || !title.trim() || !message || !message.trim()) {
      return next(new BadRequestError("Title and message are required!"));
    }

    await Broadcast.updateMany({}, { $set: { expiresAt: new Date(0) } });
    const broadcast = await Broadcast.create({
      title: title.trim(),
      message: message.trim(),
      type: type === "notice" ? "notice" : "banner",
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      createdBy: (req.user as any)._id,
    });

    // Push to everyone currently online — instant banner.
    try {
      getIO().emit("admin:broadcast", {
        _id: broadcast._id,
        title: broadcast.title,
        message: broadcast.message,
        type: broadcast.type,
        createdAt: broadcast.createdAt,
      });
    } catch (err: any) {
      logger.error("Failed to emit broadcast", { error: err.message });
    }
    logAdminAction(req, "broadcast", {
      targetType: "broadcast",
      targetId: String(broadcast._id),
      targetName: broadcast.title,
    });

    return res.status(201).json({ success: true, broadcast });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error creating broadcast", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/** GET /api/admin/broadcasts — list all broadcasts (newest first). */
export const adminListBroadcasts = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const broadcasts = await Broadcast.find()
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("createdBy", "username fullName")
      .lean();
    return res.status(200).json({ success: true, broadcasts });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error listing broadcasts", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/** DELETE /api/admin/broadcasts/:broadcastId — remove an announcement. */
export const adminDeleteBroadcast = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const broadcastId = String(req.params.broadcastId);
    await Broadcast.findByIdAndDelete(broadcastId);
    try {
      getIO().emit("admin:broadcast:clear", { broadcastId });
    } catch {
      /* ignore */
    }
    logAdminAction(req, "delete_broadcast", { targetType: "broadcast", targetId: broadcastId });
    return res.status(200).json({ success: true, message: "Broadcast deleted!" });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error deleting broadcast", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/** GET /api/admin/broadcasts/active — current active broadcast (any user). */
export const getActiveBroadcast = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?._id) return next(new UnauthorizedError("Unauthorized!"));
    const now = new Date();
    const broadcast = await Broadcast.findOne({
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    })
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json({ success: true, broadcast: broadcast || null });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error fetching active broadcast", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * GET /api/admin/monitoring — live platform vitals: who's online, socket
 * load, DB health, pending moderation, today's growth, process stats.
 */
export const getAdminMonitoring = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [onlineUsers, totalSockets, pendingReports, pendingModeration, todayUsers, todayPosts, totalUsers, totalPosts, activeFlags, dbState] =
      await Promise.all([
        getOnlineUsersCount(),
        (() => {
          try {
            return getIO().engine.clientsCount;
          } catch {
            return 0;
          }
        })(),
        Report.countDocuments({ status: "pending" }),
        ModerationItem.countDocuments({ status: "pending" }),
        User.countDocuments({ createdAt: { $gte: today } }),
        Post.countDocuments({ createdAt: { $gte: today }, status: { $ne: "draft" } }),
        User.countDocuments(),
        Post.countDocuments({ status: { $ne: "draft" } }),
        FeatureFlag.countDocuments({ enabled: true }),
        mongoose.connection.readyState, // 1 = connected
      ]);

    return res.status(200).json({
      success: true,
      monitoring: {
        onlineUsers,
        totalSockets,
        pendingReports,
        pendingModeration,
        todayUsers,
        todayPosts,
        totalUsers,
        totalPosts,
        activeFlags,
        dbState: dbState === 1 ? "connected" : "disconnected",
        uptimeSeconds: Math.round(process.uptime()),
        memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error fetching admin monitoring", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/* ────────────────────────────────────────────────────────────────────────
 * GOD MODE II — audit trail, content editing, kill switches
 * ──────────────────────────────────────────────────────────────────────── */

import { AdminAuditLog } from "../models/adminAuditLog.model";

/**
 * Fire-and-forget audit trail. Every god action calls this so there is a
 * complete, reviewable history in the admin panel.
 */
const logAdminAction = (
  req: Request,
  action: string,
  opts: {
    targetType?: "user" | "post" | "comment" | "glimpse" | "community" | "broadcast" | "flag" | "system";
    targetId?: string;
    targetName?: string;
    details?: Record<string, unknown>;
  } = {},
) => {
  const actor = req.user as any;
  AdminAuditLog.create({
    actor: actor?._id,
    actorName: actor?.username || "",
    action,
    targetType: opts.targetType || "system",
    targetId: opts.targetId || "",
    targetName: opts.targetName || "",
    details: opts.details || {},
  }).catch((err) => logger.error("Failed to write admin audit log", { error: err.message }));
};

/**
 * GET /api/admin/audit?action=&targetType=&page=&limit= — the god log.
 */
export const getAdminAudit = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const { action, targetType } = req.query;
    const { page, limit, skip } = pagination(req);
    const query: any = {};
    if (action) query.action = String(action);
    if (targetType) query.targetType = String(targetType);

    const [logs, total] = await Promise.all([
      AdminAuditLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AdminAuditLog.countDocuments(query),
    ]);
    return res.status(200).json({
      success: true,
      logs,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error listing admin audit log", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * PUT /api/admin/posts/:postId — rewrite any post's title/content/hashtags.
 */
export const adminUpdatePost = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const postId = String(req.params.postId);
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return next(new BadRequestError("Invalid post ID!"));
    }
    const update: Record<string, unknown> = {};
    if ("title" in req.body) update.title = req.body.title;
    if ("content" in req.body) update.content = req.body.content;
    if ("hashtags" in req.body) update.hashtags = Array.isArray(req.body.hashtags) ? req.body.hashtags : [];
    if (Object.keys(update).length === 0) {
      return next(new BadRequestError("Nothing to update!"));
    }
    const post = await Post.findByIdAndUpdate(postId, { $set: update }, { new: true })
      .select("title content hashtags slug author")
      .populate("author", "username fullName")
      .lean();
    if (!post) return next(new NotFoundError("Post not found!"));
    await deleteCache(`post:${postId}`);
    logAdminAction(req, "edit_post", { targetType: "post", targetId: postId, details: { fields: Object.keys(update) } });
    return res.status(200).json({ success: true, post, message: "Post updated!" });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error editing admin post", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * PUT /api/admin/comments/:commentId — rewrite any comment's content.
 */
export const adminUpdateComment = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const commentId = String(req.params.commentId);
    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      return next(new BadRequestError("Invalid comment ID!"));
    }
    if (typeof req.body.content !== "string" || !req.body.content.trim()) {
      return next(new BadRequestError("Content is required!"));
    }
    const comment = await Comment.findByIdAndUpdate(
      commentId,
      { $set: { content: req.body.content.trim() } },
      { new: true },
    ).select("content author");
    if (!comment) return next(new NotFoundError("Comment not found!"));
    await deleteCache(`comment:${commentId}`);
    logAdminAction(req, "edit_comment", { targetType: "comment", targetId: commentId });
    return res.status(200).json({ success: true, comment, message: "Comment updated!" });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error editing admin comment", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

// Well-known platform kill switches the admin can flip from the UI.
const KNOWN_KILL_SWITCHES: { key: string; description: string; defaultEnabled: boolean }[] = [
  { key: "maintenance_mode", description: "Shut the whole app down for everyone except admins.", defaultEnabled: false },
  { key: "signups_open", description: "Allow new account signups on the landing page.", defaultEnabled: true },
  { key: "posts_enabled", description: "Allow users to create new posts.", defaultEnabled: true },
  { key: "comments_enabled", description: "Allow users to post comments.", defaultEnabled: true },
  { key: "chats_enabled", description: "Allow 1-on-1 chatting.", defaultEnabled: true },
  { key: "glances_enabled", description: "Allow 24-hour glances.", defaultEnabled: true },
  { key: "communities_enabled", description: "Allow communities.", defaultEnabled: true },
  { key: "calls_enabled", description: "Allow voice/video calls.", defaultEnabled: true },
];

/**
 * GET /api/admin/killswitches — ensure every known switch exists (creating
 * missing ones with sensible defaults) and return them all.
 */
export const getKillSwitches = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    await Promise.all(
      KNOWN_KILL_SWITCHES.map((k) =>
        FeatureFlag.updateOne(
          { key: k.key },
          { $setOnInsert: { key: k.key, description: k.description, enabled: k.defaultEnabled, percentage: 100 } },
          { upsert: true },
        ),
      ),
    );
    const flags = await FeatureFlag.find({ key: { $in: KNOWN_KILL_SWITCHES.map((k) => k.key) } }).lean();
    const byKey = new Map(flags.map((f) => [f.key, f]));
    const list = KNOWN_KILL_SWITCHES.map((k) => ({
      key: k.key,
      description: k.description,
      enabled: byKey.get(k.key)?.enabled ?? k.defaultEnabled,
      _id: byKey.get(k.key)?._id,
    }));
    return res.status(200).json({ success: true, switches: list });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error fetching kill switches", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * POST /api/admin/killswitches — flip a well-known kill switch on/off.
 * Body: { key, enabled }. Upserts the flag (100% rollout).
 */
export const setKillSwitch = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    requireAdmin(req);
    const { key, enabled } = req.body as { key?: string; enabled?: boolean };
    const known = KNOWN_KILL_SWITCHES.find((k) => k.key === key);
    if (!known) return next(new BadRequestError("Unknown kill switch!"));
    const flag = await FeatureFlag.findOneAndUpdate(
      { key },
      { $set: { enabled: !!enabled, percentage: 100, description: known.description } },
      { upsert: true, new: true },
    );
    logAdminAction(req, enabled ? "killswitch_on" : "killswitch_off", {
      targetType: "flag",
      targetName: key,
      details: { enabled: !!enabled },
    });
    return res.status(200).json({ success: true, flag, message: `${key} is now ${enabled ? "ON" : "OFF"}` });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error setting kill switch", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/* ────────────────────────────────────────────────────────────────────────
 * BOT FARM — simulated human users (god panel control)
 * ──────────────────────────────────────────────────────────────────────── */

import {
  seedBots,
  startFarm,
  stopFarm,
  updateFarmConfig,
  listBots,
  deleteBot,
  getFarmStatus,
} from "../services/bots";

/**
 * GET /api/admin/bots — list all simulated users (paginated).
 */
export const adminListBots = async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit), 10) || 20));
    const data = await listBots(page, limit);
    return res.status(200).json(data);
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error listing bots", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * GET /api/admin/bots/status — farm config + bot count + recent activity.
 */
export const adminBotsStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
    const status = await getFarmStatus();
    return res.status(200).json({ success: true, ...status });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error getting bot status", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * POST /api/admin/bots/seed — create N simulated users with starter content.
 * Body: { count }
 */
export const adminSeedBots = async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
    const count = Math.min(50, Math.max(1, parseInt(String(req.body?.count), 10) || 10));
    const result = await seedBots(count);
    logAdminAction(req, "bots_seed", {
      targetType: "system",
      targetName: "bot-farm",
      details: { created: result.created.length, usernames: result.usernames },
    });
    return res.status(200).json({ success: true, ...result, message: `Created ${result.created.length} simulated users` });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error seeding bots", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * POST /api/admin/bots/start — enable the always-on farm. Body: { intensity? }
 */
export const adminStartBots = async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
    const intensity = req.body?.intensity ? parseInt(String(req.body.intensity), 10) : undefined;
    const status = await startFarm(intensity);
    logAdminAction(req, "bots_start", {
      targetType: "system",
      targetName: "bot-farm",
      details: { intensity: status.intensity },
    });
    return res.status(200).json({ success: true, message: "Bot farm started", ...status });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error starting bots", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * POST /api/admin/bots/stop — disable the farm.
 */
export const adminStopBots = async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
    const status = await stopFarm();
    logAdminAction(req, "bots_stop", { targetType: "system", targetName: "bot-farm" });
    return res.status(200).json({ success: true, message: "Bot farm stopped", ...status });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error stopping bots", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * PUT /api/admin/bots/config — update intensity/tick rate. Body: { intensity?, tickMs? }
 */
export const adminUpdateBotsConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
    const patch: { intensity?: number; tickMs?: number } = {};
    if (typeof req.body?.intensity === "number") patch.intensity = req.body.intensity;
    if (typeof req.body?.tickMs === "number") patch.tickMs = req.body.tickMs;
    const status = await updateFarmConfig(patch);
    logAdminAction(req, "bots_config", {
      targetType: "system",
      targetName: "bot-farm",
      details: patch,
    });
    return res.status(200).json({ success: true, message: "Bot config updated", ...status });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error updating bot config", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * DELETE /api/admin/bots/:botId — remove a simulated user + their content.
 */
export const adminDeleteBot = async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
    const botId = String(req.params.botId);
    const deleted = await deleteBot(botId);
    if (!deleted) return next(new NotFoundError("Bot not found!"));
    logAdminAction(req, "bot_delete", { targetType: "user", targetId: botId, targetName: botId });
    return res.status(200).json({ success: true, message: "Bot deleted" });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) return next(err);
    logger.error("Error deleting bot", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

// catch BulkWriteError and return partial success with failure details
