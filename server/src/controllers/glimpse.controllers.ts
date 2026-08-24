import mongoose from "mongoose";
import type { Request, Response } from "express";
import Glimpse from "../models/glimpse.model";
import { env } from "../configs/env";
import cloudinary from "../configs/cloudinary";
import { AppError, BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from "../utilities/errors";
import { logger } from "../utilities/logger";
import { getIO } from "../configs/socket";
import { Conversation } from "../models/conversation.model";
import { Message } from "../models/message.model";
import { createNotification } from "../utilities/notification";
import { User } from "../models/user.model";
import Follow from "../models/follow.model";
import { areMutuallyBlocked, getBlockedUserIds } from "../utilities/blockCheck";
import { awardXP } from "../services/xpService";
import { checkBadgesAndNotify } from "../services/badgeService";
import { progressMission } from "../services/dailyMissionService";
import { deliverForwardToChat } from "../services/chatForwardService";
import { cleanupMedia } from "../services/mediaCleanupService";
import {
  getCache,
  setCache,
  deleteCache,
  clearByPattern,
  clearChatCache,
} from "../configs/cache";
import { getMemCache, setMemCache } from "../utilities/chatCache";

// The `viewers` array is capped on write (recent N only) so a viral glance's
// document stays small — the exact total lives in `viewerCount`. The "Viewed
// by" list (author-only, via getGlimpse) shows these most-recent viewers.
const VIEWERS_CAP = 500;

// Get glimpse feed for the current user
// Returns non-expired glimpses that still have remaining views
export const getGlimpseFeed = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id?.toString();

  try {
    if (!currentUserId) {
      throw new UnauthorizedError("Unauthorized!");
    }

    // Short-lived per-user cache — the strip is re-fetched on every home
    // render, tab visit and 30s cache refresh; each miss runs an Atlas query.
    // Views change viewerCount, but the author's own ring updates live via the
    // targeted socket emit and a stale count self-heals within the TTL.
    const feedCacheKey = `glimpse:feed:${currentUserId}`;
    const memCachedFeed = getMemCache(feedCacheKey);
    if (memCachedFeed) return res.status(200).json(memCachedFeed);
    try {
      const cachedFeed = await getCache(feedCacheKey);
      if (cachedFeed) return res.status(200).json(cachedFeed);
    } catch (err: any) {
      logger.error("Cache error in getGlimpseFeed", { error: err.message });
    }

    const now = new Date();
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const cursor = req.query.cursor as string | undefined;

    const query: any = { expiresAt: { $gt: now } };
    if (cursor) {
      query._id = { $lt: cursor };
    }

    // Blocked users must not exist for each other — exclude their glimpses
    const blockedIds = await getBlockedUserIds(currentUserId);
    if (blockedIds.length > 0) {
      query.author = { $nin: blockedIds };
    }

    // Fetch glimpses with cursor pagination. NOTE: we deliberately do NOT
    // populate `viewers.user` here — that would resolve a full user document
    // for EVERY viewer of EVERY glimpse (dozens of lookups per request) and is
    // the main reason the feed felt slow. The feed only needs `viewedByMe` and
    // a count; full viewer details are fetched lazily by the viewer via
    // GET /api/glimpses/:glimpseId when the author opens the "Viewed by" list.
    const glimpses = await Glimpse.find(query)
      .populate("author", "username fullName profilePic closeFriends isVerified statusText waitlistPerk")
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .lean({ virtuals: true });

    const hasMore = glimpses.length > limit;
    if (hasMore) {
      glimpses.pop();
    }
    const nextCursor = glimpses.slice(-1).shift()?._id || null;

    // PRIVATE accounts: a non-follower must not see a private user's glances
    // (Instagram hides the whole story row behind the follow gate). Collect the
    // private authors first, then batch-check follow status so the per-glimpse
    // filter stays O(1) after a single query.
    const glimpseAuthors = glimpses.map(
      (g: any) => g.author?._id?.toString() || g.author?.toString(),
    );
    const privateAuthorIds = await User.find({
      _id: { $in: glimpseAuthors },
      isPrivate: true,
    })
      .select("_id")
      .lean();
    const privateAuthorSet = new Set(
      privateAuthorIds.map((u: any) => u._id.toString()),
    );
    const followedPrivate = await Follow.find({
      follower: currentUserId,
      following: { $in: [...privateAuthorSet] },
    })
      .select("following")
      .lean();
    const followedPrivateSet = new Set(
      followedPrivate.map((f: any) => f.following.toString()),
    );

    // Enrich with per-user view status + filter closeFriends + private glimpses
    const enriched = glimpses
      .filter((g: any) => {
        const authorId = g.author?._id?.toString() || g.author?.toString();
        if (!authorId) return false;
        // Own glances always visible
        if (authorId === currentUserId) return true;
        // Private account → only approved followers see the glance
        if (privateAuthorSet.has(authorId) && !followedPrivateSet.has(authorId)) {
          return false;
        }
        // closeFriends → only listed close friends see it
        if (g.visibility === "closeFriends") {
          const authorCloseFriends: any[] = g.author?.closeFriends || [];
          return authorCloseFriends.some((id: any) => id.toString() === currentUserId);
        }
        return true;
      })
      .map((g) => {
        const author = g.author && typeof g.author === "object" ? g.author : g.author;
        // Privacy: don't leak every author's close-friends list to feed viewers.
        // The filtering above already ran server-side; the client only needs
        // `closeFriends` on the targeted socket payload, not on the feed.
        // Strip the raw `viewers` array from the payload — the feed only
        // needs the exact count (viewerCount) and viewedByMe. Shipping every
        // viewer id of every glimpse is what made the strip heavy on popular
        // content; the "Viewed by" names load lazily via getGlimpse.
        const { viewers, ...rest } = g;
        const viewedByMe = (viewers || []).some(
          (v: any) => v.user?.toString() === currentUserId,
        );
        const viewerCount = g.viewerCount ?? (viewers || []).length;
        if (author && typeof author === "object" && "closeFriends" in author) {
          const { closeFriends, ...restAuthor } = author as Record<
            string,
            unknown
          >;
          return {
            ...rest,
            author: restAuthor,
            viewedByMe,
            viewerCount,
          };
        }
        return {
          ...rest,
          viewedByMe,
          viewerCount,
        };
      });

    const responseData = {
      success: true,
      glimpses: enriched,
      hasMore,
      nextCursor,
    };
    setMemCache(feedCacheKey, responseData, 8);
    // TTL tuned to the client's background refresh cadence: the home feed
    // re-fetches /api/glimpses/feed roughly every 120s (DEFAULT_TTL in
    // apiCache.ts), so a 30s Redis TTL made EVERY background refresh miss
    // the cache and re-run the full Atlas query. 150s > 120s means the
    // periodic refreshes hit Redis (1 GET) instead of the DB; the mem layer
    // (8s) still absorbs rapid repeat visits, and create/delete/your-own-view
    // evict the per-user key so staleness is bounded by real mutations, not
    // time.
    try {
      await setCache(feedCacheKey, responseData, 150);
    } catch (cacheErr: any) {
      logger.error("Cache set error in getGlimpseFeed", {
        error: cacheErr.message,
      });
    }
    return res.status(200).json(responseData);
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in getGlimpseFeed controller!", { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

// Get a single user's glimpses (their story rings)
// for the profile page. Mirrors the feed's privacy rules: blocked users get
// nothing, private accounts are gated behind an approved follow, and
// closeFriends glimpses only reach listed close friends.
export const getUserGlimpses = async (req: Request, res: Response) => {
  const currentUserId = String(req.user?._id || "");
  const profileUserId = req.params.userId as string;

  try {
    if (!currentUserId) {
      throw new UnauthorizedError("Unauthorized!");
    }
    if (!mongoose.Types.ObjectId.isValid(profileUserId)) {
      throw new BadRequestError("Invalid user ID!");
    }

    const profileUser = await User.findById(profileUserId)
      .select("isPrivate closeFriends")
      .lean();
    if (!profileUser) {
      throw new NotFoundError("User not found!");
    }

    // Blocked users must not exist for each other — an empty strip (never a
    // 404) so the profile page renders normally without leaking existence.
    if (
      profileUserId !== currentUserId &&
      (await areMutuallyBlocked(currentUserId, profileUserId))
    ) {
      return res.status(200).json({ success: true, glimpses: [] });
    }

    // Private accounts: only approved followers see the strip (Instagram
    // hides the whole story row behind the follow gate).
    if (profileUserId !== currentUserId && profileUser.isPrivate) {
      const isFollower = !!(await Follow.findOne({
        follower: currentUserId,
        following: profileUserId,
      })
        .select("_id")
        .lean());
      if (!isFollower) {
        return res.status(200).json({ success: true, glimpses: [] });
      }
    }

    const now = new Date();
    // Active (unexpired) glimpses — the 12-hour story window. Cap the strip
    // so a heavy poster can't balloon the profile payload.
    const glimpses = await Glimpse.find({
      author: new mongoose.Types.ObjectId(profileUserId),
      expiresAt: { $gt: now },
    })
      .populate("author", "username fullName profilePic closeFriends isVerified statusText waitlistPerk")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean({ virtuals: true });

    // closeFriends glimpses are only for the author's listed close friends.
    // The author's own profile always sees them.
    const enriched = glimpses
      .filter((g: any) => {
        if (g.visibility === "closeFriends") {
          if (profileUserId === currentUserId) return true;
          const authorCloseFriends: any[] =
            (g.author as any)?.closeFriends || [];
          return authorCloseFriends.some(
            (id: any) => id.toString() === currentUserId,
          );
        }
        return true;
      })
      .map((g) => {
        const author =
          g.author && typeof g.author === "object" ? g.author : g.author;
        // Strip the raw viewers array (same as the feed — count + viewedByMe
        // only; names load lazily via getGlimpse) so a popular user's strip
        // stays light.
        const { viewers, ...rest } = g;
        const viewedByMe = (viewers || []).some(
          (v: any) => v.user?.toString() === currentUserId,
        );
        const viewerCount = g.viewerCount ?? (viewers || []).length;
        // Privacy: never leak the author's close-friends list outside the
        // targeted payload — filter server-side, strip before sending.
        if (author && typeof author === "object" && "closeFriends" in author) {
          const { closeFriends, ...restAuthor } = author as Record<
            string,
            unknown
          >;
          return {
            ...rest,
            author: restAuthor,
            viewedByMe,
            viewerCount,
          };
        }
        return {
          ...rest,
          viewedByMe,
          viewerCount,
        };
      });

    return res.status(200).json({
      success: true,
      glimpses: enriched,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in getUserGlimpses controller!", {
      error: err?.message,
    });
    throw new AppError("Internal server error!");
  }
};

// Create a new glimpse
export const createGlimpse = async (req: Request, res: Response) => {
  const author = req.user?._id;

  try {
    if (!author) {
      throw new UnauthorizedError("Unauthorized!");
    }

    const file = req.file;
    if (!file) {
      throw new BadRequestError("Media is required for a glimpse!");
    }

    const isVideo = file.mimetype.startsWith("video/");

    // Validate video duration from Cloudinary response
    if (isVideo && (file as any).duration) {
      const durationInSeconds = (file as any).duration;
      if (durationInSeconds > 60) {
        // Delete the uploaded file from Cloudinary
        cloudinary.uploader.destroy((file as any).filename, { resource_type: "video" }).catch(() => {});
        throw new BadRequestError("Video duration must not exceed 1 minute!");
      }
    }

    const visibility =
      (req.body as any)?.visibility === "closeFriends"
        ? "closeFriends"
        : "public";

    const glimpse = new Glimpse({
      author,
      media: {
        url: file.path,
        public_id: (file as any).filename,
      },
      mediaType: isVideo ? "video" : "image",
      visibility,
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
    });

    await glimpse.save();

    // A new glimpse changes everyone's feed — evict the per-user feed cache.
    void clearByPattern("glimpse:feed:*").catch(() => {});

    const populated = await Glimpse.findById(glimpse._id)
      .populate("author", "username fullName profilePic closeFriends isVerified statusText waitlistPerk")
      .populate("viewers.user", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean({ virtuals: true });

    const enrichedGlimpse = {
      ...populated,
      viewedByMe: false,
    };

    // Broadcast via socket — public glimpses go to everyone, but
    // closeFriends glimpses go ONLY to the author + their close friends.
    // (Without this, an io.emit leaked private glances into every user's
    // real-time feed even though the GET feed correctly filters them.)
    try {
      const io = getIO();
      if (visibility === "closeFriends") {
        const authorUser = await User.findById(author)
          .select("closeFriends")
          .lean();
        const closeFriendIds = (authorUser?.closeFriends || []).map((id: any) =>
          id.toString()
        );
        const recipients = new Set([
          author.toString(),
          ...closeFriendIds,
        ]);
        recipients.forEach((recipientId) => {
          io.to(`user:${recipientId}`).emit("glimpse:created", enrichedGlimpse);
        });
      } else {
        io.emit("glimpse:created", enrichedGlimpse);
      }
    } catch (socketErr) {
      logger.warn("Failed to broadcast glimpse:created via socket", {
        error: (socketErr as Error).message,
      });
    }

    // Award XP and progress mission (fire-and-forget)
    awardXP(author.toString(), "CREATE_POST").catch(() => {});
    progressMission(author.toString(), "story").catch(() => {});
    // Achievement badges (fire-and-forget)
    checkBadgesAndNotify(author.toString(), "glance").catch(() => {});

    return res.status(201).json({
      success: true,
      message: "Glimpse created successfully!",
      glimpse: enrichedGlimpse,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in createGlimpse controller!", { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

// Helper: delete a glimpse and clean up Cloudinary image (shared with the
// admin panel's delete-glimpse action)
export const deleteGlimpseAndCleanup = async (glimpse: any) => {
  if (glimpse?.media?.public_id) {
    const resourceType = glimpse.mediaType === "video" ? "video" : "image";
    void cleanupMedia([glimpse.media.public_id], resourceType);
  }
  await Glimpse.findByIdAndDelete(glimpse._id);
};

// Mark a glimpse as viewed by the current user
// Uses atomic findOneAndUpdate to prevent race conditions on the 2-viewer limit
export const viewGlimpse = async (req: Request, res: Response) => {
  const glimpseId = req.params.glimpseId as string;
  const currentUserId = String(req.user?._id || "");

  try {
    if (!currentUserId) {
      throw new UnauthorizedError("Unauthorized!");
    }

    if (!mongoose.Types.ObjectId.isValid(glimpseId)) {
      throw new BadRequestError("Invalid glimpse ID!");
    }

    // Check if already viewed (lightweight read-only check)
    const existingGlimpse = await Glimpse.findById(glimpseId).select("author viewers expiresAt media visibility");
    if (!existingGlimpse) {
      throw new NotFoundError("Glimpse not found!");
    }

    // closeFriends glimpses are only visible to the author's close friends
    await assertGlimpseAccess(existingGlimpse, currentUserId);

    if (existingGlimpse.expiresAt < new Date()) {
      await deleteGlimpseAndCleanup(existingGlimpse);
      try { getIO().emit("glimpse:expired", { glimpseId }); } catch {}
      throw new BadRequestError("Glimpse has expired!");
    }

    // Blocked users must not exist for each other
    if (
      existingGlimpse.author?.toString() !== currentUserId &&
      (await areMutuallyBlocked(currentUserId, existingGlimpse.author?.toString()))
    ) {
      throw new NotFoundError("Glimpse not found!");
    }

    // Prevent the author from being recorded as a viewer of their own glance
    const isAuthorViewing = existingGlimpse.author?.toString() === currentUserId;
    if (isAuthorViewing) {
      return res.status(200).json({
        success: true,
        message: "Authors cannot view their own glance!",
        isAuthor: true,
      });
    }

    const alreadyViewed = existingGlimpse.viewers.some(
      (v: any) => v.user?.toString() === currentUserId
    );
    if (alreadyViewed) {
      return res.status(200).json({
        success: true,
        message: "Already viewed!",
        alreadyViewed: true,
      });
    }

    // Add viewer in ONE atomic update: the $ne guard dedups, $slice caps the
    // array to the most-recent VIEWERS_CAP, and $inc keeps the exact total
    // even after old viewers are sliced off. (A viewer who viewed before the
    // cap trimmed them out may re-count on a re-view — bounded, rare, and
    // far cheaper than an unbounded array on every feed read.)
    const updatedGlimpse = (await Glimpse.findOneAndUpdate(
      {
        _id: glimpseId,
        "viewers.user": { $ne: new mongoose.Types.ObjectId(String(currentUserId)) },
      },
      {
        $push: {
          viewers: {
            $each: [
              {
                user: new mongoose.Types.ObjectId(String(currentUserId)),
                viewedAt: new Date(),
              },
            ],
            $slice: -VIEWERS_CAP,
          },
        },
        $inc: { viewerCount: 1 },
      },
      { new: true }
    ).select("author viewers viewerCount expiresAt visibility")) ||
      (await Glimpse.findById(glimpseId).select(
        "author viewers viewerCount expiresAt visibility",
      ));

    if (!updatedGlimpse) {
      throw new NotFoundError("Glimpse not found!");
    }

    // Socket broadcast — author-only and lightweight. The full viewer list on
    // a global emit went to EVERY connected client on EVERY view (with a
    // payload that grew with the glance's popularity); the author's ring just
    // needs the new total, and the "Viewed by" names come from getGlimpse.
    try {
      const io = getIO();
      io.to(`user:${existingGlimpse.author.toString()}`).emit(
        "glimpse:viewed",
        {
          glimpseId,
          viewerCount:
            updatedGlimpse.viewerCount ?? updatedGlimpse.viewers.length,
        },
      );
    } catch (socketErr) {
      logger.warn("Failed to emit glimpse socket events", {
        error: (socketErr as Error).message,
      });
    }

    // The viewer's OWN feed copy caches `viewedByMe` per user — evict it so
    // a reload within the (now longer) feed TTL shows the ring as viewed,
    // not stale. One DEL, and it also keeps the raised 150s TTL safe.
    void deleteCache(`glimpse:feed:${currentUserId}`).catch(() => {});

    return res.status(200).json({
      success: true,
      message: "Glimpse viewed!",
      alreadyViewed: false,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in viewGlimpse controller!", { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

// Get a single glimpse by ID
export const getGlimpse = async (req: Request, res: Response) => {
  const glimpseId = req.params.glimpseId as string;
  const currentUserId = String(req.user?._id || "");

  try {
    if (!currentUserId) {
      throw new UnauthorizedError("Unauthorized!");
    }

    if (!mongoose.Types.ObjectId.isValid(glimpseId)) {
      throw new BadRequestError("Invalid glimpse ID!");
    }

    // Single glimpse — cheap enough to populate viewers here (the feed no
    // longer does). This powers the author's "Viewed by" popup.
    const glimpse = await Glimpse.findById(glimpseId)
      .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
      .populate("viewers.user", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean({ virtuals: true });

    if (!glimpse) {
      throw new NotFoundError("Glimpse not found!");
    }

    // Expired glimpses are gone — reject before the TTL sweep deletes them
    if (glimpse.expiresAt < new Date()) {
      throw new NotFoundError("Glimpse not found!");
    }

    // closeFriends + blocked access guard (404s so outsiders can't detect it)
    await assertGlimpseAccess(glimpse, currentUserId);

    const enriched = {
      ...glimpse,
      viewedByMe: (glimpse.viewers || []).some(
        (v: any) => v.user?.toString() === currentUserId
      ),
      // Use the exact counter — the `viewers` array is capped on write
      // (recent VIEWERS_CAP only), so `.length` would cap the "Viewed by"
      // count at 500 for a viral glance. Fall back to the array length for
      // legacy docs written before the counter existed.
      viewerCount: glimpse.viewerCount ?? (glimpse.viewers || []).length,
    };

    return res.status(200).json({
      success: true,
      glimpse: enriched,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in getGlimpse controller!", { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * Shared access guard for any interaction with a single glimpse
 * (view / react / reply). Enforces:
 *  - blocked users are completely invisible to each other (404),
 *  - closeFriends glimpses are only accessible to the author's close friends.
 * Throws a NotFoundError so non-authorized users cannot even detect the glimpse.
 */
async function assertGlimpseAccess(
  glimpse: any,
  currentUserId: string,
): Promise<void> {
  const authorId = glimpse.author?._id?.toString() || glimpse.author?.toString();
  if (!authorId || authorId === currentUserId) return;

  if (await areMutuallyBlocked(currentUserId, authorId)) {
    throw new NotFoundError("Glimpse not found!");
  }
  if (glimpse.visibility === "closeFriends") {
    const author = await User.findById(authorId).select("closeFriends").lean();
    const isCloseFriend = (author as any)?.closeFriends?.some(
      (id: any) => id.toString() === currentUserId,
    );
    if (!isCloseFriend) {
      throw new NotFoundError("Glimpse not found!");
    }
  }
}

// React to a glimpse (like/emoji reaction)
export const reactToGlimpse = async (req: Request, res: Response) => {
  const glimpseId = req.params.glimpseId as string;
  const currentUserId = String(req.user?._id || "");
  const { emoji } = req.body;

  try {
    if (!currentUserId) {
      throw new UnauthorizedError("Unauthorized!");
    }

    if (!mongoose.Types.ObjectId.isValid(glimpseId)) {
      throw new BadRequestError("Invalid glimpse ID!");
    }

    if (!emoji || typeof emoji !== "string") {
      throw new BadRequestError("Emoji is required!");
    }

    const glimpse = await Glimpse.findById(glimpseId);
    if (!glimpse) {
      throw new NotFoundError("Glimpse not found!");
    }

    // Expired glimpses can no longer be reacted to
    if (glimpse.expiresAt < new Date()) {
      throw new NotFoundError("Glimpse not found!");
    }

    // closeFriends glimpses are only visible to the author's close friends
    await assertGlimpseAccess(glimpse, currentUserId);

    // Check if user already reacted with this emoji
    const existingIdx = glimpse.reactions?.findIndex(
      (r) => r.user.toString() === currentUserId
    );

    let action: "added" | "removed";

    if (existingIdx !== undefined && existingIdx >= 0) {
      // Remove existing reaction (toggle off)
      glimpse.reactions!.splice(existingIdx, 1);
      action = "removed";
    } else {
      // Add new reaction
      glimpse.reactions!.push({
        user: new mongoose.Types.ObjectId(String(currentUserId)),
        emoji,
        createdAt: new Date(),
      } as any);
      action = "added";
    }

    await glimpse.save();

    // Broadcast via socket
    try {
      getIO().emit("glimpse:reacted", {
        glimpseId,
        userId: currentUserId,
        emoji,
        action,
        reactionsCount: glimpse.reactions?.length || 0,
      });
    } catch (socketErr) {
      logger.warn("Failed to emit glimpse:reacted socket event", { error: (socketErr as Error).message });
    }

    // Create notification for the author (only if reaction was added)
    try {
      const authorId = glimpse.author?.toString();
      if (authorId && action === "added" && authorId !== currentUserId) {
        await createNotification({
          recipient: authorId,
          sender: currentUserId,
          type: "glimpse_reaction",
          glimpse: glimpseId,
        });
      }
    } catch (notifErr) {
      logger.warn("Failed to create glimpse reaction notification", { error: (notifErr as Error).message });
    }

    return res.status(200).json({
      success: true,
      message: action === "added" ? "Reaction added!" : "Reaction removed!",
      action,
      reactionsCount: glimpse.reactions?.length || 0,
      reactions: glimpse.reactions,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in reactToGlimpse controller!", { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

// Reply to a glimpse (creates a conversation + sends a message with the glimpse as an attachment)
export const replyToGlimpse = async (req: Request, res: Response) => {
  const glimpseId = req.params.glimpseId as string;
  const currentUserId = String(req.user?._id || "");
  const { text } = req.body;

  try {
    if (!currentUserId) {
      throw new UnauthorizedError("Unauthorized!");
    }

    if (!mongoose.Types.ObjectId.isValid(glimpseId)) {
      throw new BadRequestError("Invalid glimpse ID!");
    }

    const glimpse = await Glimpse.findById(glimpseId)
      .populate("author", "_id username fullName profilePic waitlistPerk")
      .lean({ virtuals: true });
    if (!glimpse) {
      throw new NotFoundError("Glimpse not found!");
    }

    // Expired glimpses can no longer be replied to
    if (glimpse.expiresAt < new Date()) {
      throw new NotFoundError("Glimpse not found!");
    }

    // closeFriends + blocked access guard (404s so outsiders can't detect it)
    await assertGlimpseAccess(glimpse, currentUserId);

    const authorId = glimpse.author?._id?.toString();
    if (!authorId) {
      throw new BadRequestError("Glimpse author not found!");
    }

    // Don't allow replying to your own glimpse
    if (authorId === currentUserId) {
      throw new BadRequestError("Cannot reply to your own glimpse!");
    }

    // Find existing conversation between these two users, or create a new one
    let conversation = await Conversation.findOne({
      participants: { $all: [
        new mongoose.Types.ObjectId(String(currentUserId)),
        new mongoose.Types.ObjectId(authorId),
      ]},
      type: { $ne: "group" },
    });

    if (!conversation) {
      conversation = new Conversation({
        participants: [
          new mongoose.Types.ObjectId(String(currentUserId)),
          new mongoose.Types.ObjectId(authorId),
        ],
        unreadCounts: new Map(),
      });
      await conversation.save();
    }

    // Create a message with the glimpse attached
    const message = new Message({
      conversation: conversation._id,
      sender: new mongoose.Types.ObjectId(String(currentUserId)),
      recipient: new mongoose.Types.ObjectId(authorId),
      text: typeof text === "string" ? text : "",
      attachments: [{
        url: glimpse.media?.url || "",
        public_id: glimpse.media?.public_id || "",
        type: glimpse.mediaType === "video" ? "video" : "image",
      }],
      seen: false,
    });

    await message.save();

    const populatedMessage = await Message.findById(message._id)
      .populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    // Update conversation's lastMessage
    await Conversation.findByIdAndUpdate(conversation._id, {
      lastMessage: message._id,
      updatedAt: new Date(),
      $inc: { [`unreadCounts.${authorId}`]: 1 },
    });

    // The reply is a real chat message — evict the same caches a normal send
    // would, so neither participant's cached conversation list or message
    // thread can serve a stale copy missing this reply (up to the TTL).
    await clearChatCache(conversation._id.toString(), [
      currentUserId,
      authorId,
    ]).catch(() => {});

    // Author's true unread count (they may already have unread messages in
    // this conversation — don't overwrite it with a hardcoded 1 on their
    // client, mirror the regular message flow instead).
    const authorUnreadCount =
      ((conversation.unreadCounts as Map<string, number> | undefined)?.get(authorId) || 0) + 1;

    // Populate the full conversation (participants + lastMessage) so the
    // chat:notification payload lets BOTH sides' clients add this conversation
    // to their list instantly — even when it's brand-new (a first-ever reply
    // creates a conversation the replier has never seen in their chat list).
    const populatedConversation = await Conversation.findById(conversation._id)
      .populate("participants", "username fullName profilePic isVerified statusText waitlistPerk")
      .populate({
        path: "lastMessage",
        populate: { path: "sender", select: "username fullName profilePic isVerified statusText waitlistPerk" },
      })
      .lean();

    // Broadcast to conversation
    try {
      const io = getIO();
      io.to(`conversation:${conversation._id}`).emit("message:new", populatedMessage);

      // Notify the glance author (recipient) — unreadCount reflects their real count.
      io.to(`user:${authorId}`).emit("chat:notification", {
        conversationId: conversation._id,
        message: populatedMessage,
        unreadCount: authorUnreadCount,
        conversation: populatedConversation,
      });

      // Also notify the replier's OWN room (unreadCount 0 — they sent it) so
      // their chat list shows the new conversation without a page refresh.
      io.to(`user:${currentUserId}`).emit("chat:notification", {
        conversationId: conversation._id,
        message: populatedMessage,
        unreadCount: 0,
        conversation: populatedConversation,
      });
    } catch (socketErr) {
      logger.warn("Failed to emit glimpse reply socket events", { error: (socketErr as Error).message });
    }

    // Create notification for the author
    try {
      await createNotification({
        recipient: authorId,
        sender: currentUserId,
        type: "glimpse_reply",
        glimpse: glimpseId,
      });
    } catch (notifErr) {
      logger.warn("Failed to create glimpse reply notification", { error: (notifErr as Error).message });
    }

    return res.status(200).json({
      success: true,
      message: "Reply sent!",
      conversation,
      sentMessage: populatedMessage,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in replyToGlimpse controller!", { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

// Delete a glimpse (either by author, or because it has been fully viewed and closed)
export const deleteGlimpse = async (req: Request, res: Response) => {
  const glimpseId = req.params.glimpseId as string;
  const currentUserId = String(req.user?._id || "");

  try {
    if (!currentUserId) {
      throw new UnauthorizedError("Unauthorized!");
    }

    if (!mongoose.Types.ObjectId.isValid(glimpseId)) {
      throw new BadRequestError("Invalid glimpse ID!");
    }

    const glimpse = await Glimpse.findById(glimpseId);
    if (!glimpse) {
      throw new NotFoundError("Glimpse not found!");
    }

    const isAuthor = glimpse.author.toString() === currentUserId;
    // Only allow deletion if the requester is the author
    if (!isAuthor) {
      throw new ForbiddenError("You are not authorized to delete this glance!");
    }

    await deleteGlimpseAndCleanup(glimpse);

    // The glance is gone from every feed — evict the per-user feed cache.
    void clearByPattern("glimpse:feed:*").catch(() => {});

    // Broadcast socket event to all clients so they can animate deletion in real-time
    try {
      getIO().emit("glimpse:expired", { glimpseId });
    } catch (socketErr) {
      logger.warn("Failed to emit glimpse:expired socket event", { error: (socketErr as Error).message });
    }

    return res.status(200).json({
      success: true,
      message: "Glimpse deleted successfully!",
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in deleteGlimpse controller!", { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

// forward a glance to another user — notifies the recipient in-app
// (notification center + badge) and via device push.
export const forwardGlimpse = async (
  req: Request<{ glimpseId: string }>,
  res: Response,
) => {
  const { glimpseId } = req.params;
  const senderId = req.user?._id;
  const { recipientId } = req.body || {};

  try {
    if (!senderId) throw new UnauthorizedError("Unauthorized!");

    if (!mongoose.Types.ObjectId.isValid(glimpseId)) {
      throw new BadRequestError("Invalid glance ID!");
    }

    if (!recipientId || !mongoose.Types.ObjectId.isValid(recipientId)) {
      throw new BadRequestError("Invalid recipient!");
    }

    if (senderId.toString() === recipientId) {
      throw new BadRequestError("Cannot forward a glance to yourself!");
    }

    const glimpse = await Glimpse.findById(glimpseId)
      .select("_id author visibility expiresAt")
      .populate("author", "username fullName")
      .lean();
    if (!glimpse) {
      throw new NotFoundError("Glance not found!");
    }

    // Expired glances can no longer be forwarded (same guard as view/react/reply)
    if (glimpse.expiresAt < new Date()) {
      throw new NotFoundError("Glance not found!");
    }

    // The SENDER must be able to see this glance (author / close friend /
    // public) — otherwise a stranger who knows the ID could forward a
    // closeFriends glance as a side channel.
    await assertGlimpseAccess(glimpse, senderId.toString());

    const recipient = await User.findById(recipientId).select("_id").lean();
    if (!recipient) {
      throw new BadRequestError("Recipient not found!");
    }

    // The RECIPIENT must also be able to see the glance — a closeFriends
    // glance forwarded to an outsider would create a dead-end notification
    // pointing at content they can never open.
    let recipientCanSee = true;
    try {
      await assertGlimpseAccess(glimpse, recipientId);
    } catch {
      recipientCanSee = false;
    }

    // Author id works whether `author` is a raw ObjectId or (as populated
    // below for the preview text) a user object — `.toString()` on a
    // populated object would return "[object Object]" and silently break
    // the mutual-block check, so extract it explicitly.
    const glimpseAuthorId =
      (glimpse.author as any)?._id?.toString() ||
      (glimpse.author as any)?.toString?.();

    // Skipped when the recipient is mutually blocked with the glance author
    // or can't view the glance's audience.
    const canDeliver =
      recipientCanSee &&
      !(await areMutuallyBlocked(recipientId, glimpseAuthorId));

    if (canDeliver) {
      await createNotification({
        recipient: recipientId,
        sender: senderId.toString(),
        type: "glimpse_share",
        glimpse: glimpseId,
      });

      // WhatsApp/Instagram behavior: the forward ALSO lands as a real chat
      // message in the 1:1 conversation (created if needed), so the
      // recipient sees it in their chat and the sender sees the
      // conversation in their chat list.
      const authorName =
        (glimpse.author as any)?.fullName ||
        (glimpse.author as any)?.username ||
        "a friend";
      const authorUsername = (glimpse.author as any)?.username || "";
      const link = authorUsername
        ? `${env.CLIENT_URL}/user/${authorUsername}`
        : "";
      await deliverForwardToChat({
        senderId: senderId.toString(),
        recipientId: recipientId.toString(),
        text: `Shared a glance by ${authorName}${link ? `\n${link}` : ""}`,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Glance forwarded successfully!",
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in forwardGlimpse controller!", { error: err?.message });
    throw new AppError("Internal server error!");
  }
};
