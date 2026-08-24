import mongoose from "mongoose";
import Post from "../models/post.model";
import Like from "../models/like.model";
import Comment from "../models/comment.model";
import Save from "../models/saves.model";
import Repost from "../models/repost.model";
import { Message } from "../models/message.model";
import Glimpse from "../models/glimpse.model";
import { Community } from "../models/community.model";
import UserMission from "../models/dailyMission.model";
import { User } from "../models/user.model";
import { awardBadge } from "./xpService";
import { logger } from "../utilities/logger";
import { notifyBadgeUnlock } from "../utilities/notification";

/**
 * Badge engine — count-based achievement awarding.
 *
 * Every badge in the catalog belongs to a "trigger": an event the user just
 * performed (posted, liked, commented, followed someone, joined a community,
 * sent a DM, ...). After the event the engine re-counts the relevant metric
 * and awards every tier the new count now satisfies (idempotent — awardBadge
 * already no-ops on duplicates). Newly unlocked badges are returned so the
 * caller can fire a celebration notification.
 *
 * All awarding is fire-and-forget: count queries are indexed and cheap, and
 * failures are logged but never break the action that triggered them.
 */

// ── Tier tables ─────────────────────────────────────────────────
const POST_TIERS = [
  { count: 1, badge: "post_1" },
  { count: 10, badge: "post_10" },
  { count: 50, badge: "post_50" },
  { count: 100, badge: "post_100" },
  { count: 500, badge: "post_500" },
  { count: 1000, badge: "post_1k" },
];
const VIDEO_TIERS = [
  { count: 1, badge: "video_1" },
  { count: 10, badge: "video_10" },
  { count: 25, badge: "video_25" },
];
const IMAGE_TIERS = [
  { count: 1, badge: "image_1" },
  { count: 25, badge: "image_25" },
  { count: 100, badge: "image_100" },
];
const GLANCE_TIERS = [
  { count: 1, badge: "glance_1" },
  { count: 10, badge: "glance_10" },
  { count: 50, badge: "glance_50" },
  { count: 100, badge: "glance_100" },
];
const LIKES_GIVEN_TIERS = [
  { count: 10, badge: "likes_given_10" },
  { count: 100, badge: "likes_given_100" },
  { count: 500, badge: "likes_given_500" },
  { count: 1000, badge: "likes_given_1k" },
];
const LIKES_RECEIVED_TIERS = [
  { count: 10, badge: "likes_received_10" },
  { count: 100, badge: "likes_received_100" },
  { count: 1000, badge: "likes_received_1k" },
  { count: 10000, badge: "likes_received_10k" },
  { count: 50000, badge: "likes_received_50k" },
  { count: 100000, badge: "likes_received_100k" },
];
const COMMENTS_MADE_TIERS = [
  { count: 10, badge: "comments_given_10" },
  { count: 50, badge: "comments_given_50" },
  { count: 200, badge: "comments_given_200" },
  { count: 500, badge: "comments_given_500" },
];
const COMMENTS_RECEIVED_TIERS = [
  { count: 10, badge: "comments_received_10" },
  { count: 100, badge: "comments_received_100" },
  { count: 500, badge: "comments_received_500" },
  { count: 1000, badge: "comments_received_1k" },
];
const SAVES_TIERS = [
  { count: 10, badge: "saves_10" },
  { count: 50, badge: "saves_50" },
  { count: 100, badge: "saves_100" },
];
const SHARES_TIERS = [
  { count: 10, badge: "shares_10" },
  { count: 50, badge: "shares_50" },
  { count: 200, badge: "shares_200" },
];
// Reposting is a zero-effort action (one click on someone else's post), so
// unlike first-content onboarding badges, the floor is meaningful: 5 reposts
// before the first badge, then a long tail up to 100.
const REPOST_TIERS = [
  { count: 5, badge: "repost_5" },
  { count: 25, badge: "repost_25" },
  { count: 100, badge: "repost_100" },
];
const FOLLOWERS_TIERS = [
  { count: 10, badge: "followers_10" },
  { count: 100, badge: "followers_100" },
  { count: 1000, badge: "followers_1k" },
  { count: 10000, badge: "followers_10k" },
  { count: 50000, badge: "followers_50k" },
  { count: 100000, badge: "followers_100k" },
];
const COMMUNITY_JOIN_TIERS = [
  { count: 1, badge: "community_1" },
  { count: 5, badge: "community_5" },
  { count: 10, badge: "community_10" },
  { count: 25, badge: "community_25" },
];
const COMMUNITY_ADMIN_TIERS = [
  { count: 1, badge: "community_admin" },
  { count: 2, badge: "community_admin_2" },
];
const MESSAGE_TIERS = [
  { count: 1, badge: "message_1" },
  { count: 100, badge: "message_100" },
  { count: 1000, badge: "message_1k" },
  { count: 5000, badge: "message_5k" },
];
const MISSION_TIERS = [
  { count: 1, badge: "mission_1" },
  { count: 20, badge: "mission_20" },
  { count: 50, badge: "mission_50" },
  { count: 100, badge: "mission_100" },
];

type Tier = { count: number; badge: string };

/** Award every tier the count now satisfies; returns newly awarded badges. */
async function awardTiers(userId: string, count: number, tiers: Tier[]) {
  const awarded: string[] = [];
  for (const tier of tiers) {
    if (count >= tier.count) {
      const fresh = await awardBadge(userId, tier.badge);
      if (fresh) awarded.push(tier.badge);
    }
  }
  return awarded;
}

// ── Count helpers ───────────────────────────────────────────────
const countPostsByAuthor = (userId: string) =>
  Post.countDocuments({ author: userId, status: "published" });

const countVideosByAuthor = (userId: string) =>
  Post.countDocuments({
    author: userId,
    status: "published",
    "video.url": { $ne: "" },
  });

const countImagesByAuthor = (userId: string) =>
  Post.countDocuments({
    author: userId,
    status: "published",
    $or: [{ "image.url": { $ne: "" } }, { images: { $ne: [] } }],
  });

const countGlancesByAuthor = (userId: string) =>
  Glimpse.countDocuments({ author: userId });

const countLikesGiven = (userId: string) =>
  Like.countDocuments({ author: userId });

const countLikesReceived = async (userId: string) => {
  // Single aggregation instead of fetching every post id then a $in count —
  // the posts collection is indexed on author, so this stays cheap even for
  // power users with thousands of posts on a hot path.
  const [res] = await Like.aggregate<{ n: number }>([
    { $match: { author: { $ne: userId } } },
    {
      $lookup: {
        from: "posts",
        localField: "post",
        foreignField: "_id",
        as: "postDoc",
      },
    },
    { $unwind: "$postDoc" },
    { $match: { "postDoc.author": new mongoose.Types.ObjectId(userId) } },
    { $count: "n" },
  ]);
  return res?.n ?? 0;
};

const countCommentsMade = (userId: string) =>
  Comment.countDocuments({ author: userId });

const countCommentsReceived = async (userId: string) => {
  const [res] = await Comment.aggregate<{ n: number }>([
    { $match: { author: { $ne: userId } } },
    {
      $lookup: {
        from: "posts",
        localField: "post",
        foreignField: "_id",
        as: "postDoc",
      },
    },
    { $unwind: "$postDoc" },
    { $match: { "postDoc.author": new mongoose.Types.ObjectId(userId) } },
    { $count: "n" },
  ]);
  return res?.n ?? 0;
};

const countSaves = (userId: string) => Save.countDocuments({ user: userId });

const countReposts = (userId: string) =>
  Repost.countDocuments({ user: userId });

const countMessages = (userId: string) =>
  Message.countDocuments({ sender: userId, isDeleted: false });

const countCommunitiesJoined = (userId: string) =>
  Community.countDocuments({ "members.user": userId });

const countCommunitiesCreated = (userId: string) =>
  Community.countDocuments({ creator: userId });

const countCommunitiesAdmin = (userId: string) =>
  Community.countDocuments({
    $or: [
      { creator: userId },
      { admins: userId },
      { "members.user": userId, "members.role": { $in: ["admin", "moderator"] } },
    ],
  });

const countMissionsClaimed = async (userId: string) => {
  const res = await UserMission.aggregate<{ n: number }>([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    { $unwind: "$missions" },
    { $match: { "missions.claimed": true } },
    { $count: "n" },
  ]);
  return res[0]?.n ?? 0;
};

/**
 * Compute the current progress value for every metric the catalog tracks —
 * used by the achievements endpoint so the UI can show "3/10" style bars.
 */
export async function computeAchievementProgress(userId: string) {
  const [posts, videos, images, glances, likesGiven, likesReceived, commentsMade, commentsReceived, saves, reposts, messages, communitiesJoined, communitiesCreated, communitiesAdmin, missions] =
    await Promise.all([
      countPostsByAuthor(userId),
      countVideosByAuthor(userId),
      countImagesByAuthor(userId),
      countGlancesByAuthor(userId),
      countLikesGiven(userId),
      countLikesReceived(userId),
      countCommentsMade(userId),
      countCommentsReceived(userId),
      countSaves(userId),
      countReposts(userId),
      countMessages(userId),
      countCommunitiesJoined(userId),
      countCommunitiesCreated(userId),
      countCommunitiesAdmin(userId),
      countMissionsClaimed(userId),
    ]);

  const user = await User.findById(userId).select("followersCount sharesCount").lean();

  return {
    postCount: posts,
    videoCount: videos,
    imageCount: images,
    glanceCount: glances,
    likesGiven,
    likesReceived,
    commentsMade,
    commentsReceived,
    saves,
    shares: user?.sharesCount ?? 0,
    reposts,
    followers: user?.followersCount ?? 0,
    communitiesJoined,
    communitiesCreated,
    communitiesAdmin,
    messages,
    missionsCompleted: missions,
  };
}

/**
 * Time-based creator badges — Night Owl (post 12am–5am) and Early Riser
 * (post 5am–8am). Awarded at post-creation time from the post's own
 * createdAt so it reflects the user's actual posting habits, not the
 * server's clock when the request lands. Fire-and-forget.
 */
export async function awardTimeOfDayBadges(userId: string, createdAt?: Date) {
  const hour = createdAt ? createdAt.getHours() : new Date().getHours();
  const uid = userId.toString();
  try {
    if (hour >= 0 && hour < 5) {
      if (await awardBadge(uid, "night_owl")) {
        notifyBadgeUnlock(uid, "night_owl").catch(() => {});
      }
    } else if (hour >= 5 && hour < 8) {
      if (await awardBadge(uid, "early_bird")) {
        notifyBadgeUnlock(uid, "early_bird").catch(() => {});
      }
    }
  } catch (err: any) {
    logger.error("Failed to award time-of-day badge", {
      userId: uid,
      error: err?.message,
    });
  }
}

/**
 * The actual badge-check implementation, run by the BullMQ gamification
 * worker or as the inline fallback: re-counts the metric tied to the
 * trigger, awards newly-satisfied badges AND notifies the user about them.
 * Safe to call from hot paths (errors are swallowed + logged).
 */
export async function checkBadgesAndNotifyInline(
  userId: string,
  trigger: Parameters<typeof checkAndAwardBadges>[1],
) {
  const awarded = await checkAndAwardBadges(userId, trigger);
  for (const badge of awarded) {
    notifyBadgeUnlock(userId, badge).catch(() => {});
  }
  return awarded;
}

/**
 * Fire-and-forget convenience wrapper: re-counts the metric tied to the
 * trigger, awards newly-satisfied badges AND notifies the user about them.
 * Prefers BullMQ (the count queries + award upserts run on a worker); falls
 * back to the inline check when BullMQ isn't configured. Errors are
 * swallowed + logged.
 */
export async function checkBadgesAndNotify(
  userId: string,
  trigger: Parameters<typeof checkAndAwardBadges>[1],
): Promise<string[]> {
  try {
    const { enqueueGamification } = await import("../configs/queue");
    const queued = await enqueueGamification("check_badge", {
      userId,
      trigger,
    });
    if (queued) return [];
  } catch (err: any) {
    logger.error("Badge check enqueue failed — running inline", {
      userId,
      trigger,
      error: err.message,
    });
  }
  return checkBadgesAndNotifyInline(userId, trigger);
}

/**
 * The actual all-rounder check, run by the BullMQ gamification worker or as
 * the inline fallback.
 */
export async function checkAllRounderBadgeInline(userId: string): Promise<void> {
  const awarded = await checkAndAwardBadges(userId, "all_rounder");
  for (const badge of awarded) {
    notifyBadgeUnlock(userId, badge).catch(() => {});
  }
}

/**
 * One-time "Omnivore" badge — liked, commented, saved AND shared/reposted at
 * least once each. Checked after any of those four actions (cheap: the mix
 * only flips once, then the idempotent awardBadge guards it). Prefers
 * BullMQ; falls back to the inline check when BullMQ isn't configured.
 * Fire-and-forget.
 */
export async function checkAllRounderBadge(userId: string): Promise<void> {
  try {
    const { enqueueGamification } = await import("../configs/queue");
    const queued = await enqueueGamification("check_all_rounder", { userId });
    if (queued) return;
  } catch (err: any) {
    logger.error("All-rounder check enqueue failed — running inline", {
      userId,
      error: err.message,
    });
  }
  await checkAllRounderBadgeInline(userId);
}

/**
 * Entry point called after a user action. Re-counts the metric tied to the
 * trigger and awards any newly-satisfied badges, returning the new ids.
 */
export async function checkAndAwardBadges(
  userId: string,
  trigger:
    | "post_created"
    | "like_given"
    | "like_received"
    | "comment_made"
    | "comment_received"
    | "save"
    | "share"
    | "repost"
    | "follow"
    | "community_join"
    | "community_created"
    | "community_admin"
    | "message"
    | "glance"
    | "mission"
    | "profile"
    | "all_rounder",
): Promise<string[]> {
  const uid = userId.toString();
  const awarded: string[] = [];
  try {
    switch (trigger) {
      case "post_created": {
        awarded.push(
          ...(await awardTiers(uid, await countPostsByAuthor(uid), POST_TIERS)),
          ...(await awardTiers(uid, await countVideosByAuthor(uid), VIDEO_TIERS)),
          ...(await awardTiers(uid, await countImagesByAuthor(uid), IMAGE_TIERS)),
        );
        break;
      }
      case "glance":
        awarded.push(
          ...(await awardTiers(uid, await countGlancesByAuthor(uid), GLANCE_TIERS)),
        );
        break;
      case "like_given":
        awarded.push(
          ...(await awardTiers(uid, await countLikesGiven(uid), LIKES_GIVEN_TIERS)),
        );
        break;
      case "like_received":
        awarded.push(
          ...(await awardTiers(uid, await countLikesReceived(uid), LIKES_RECEIVED_TIERS)),
        );
        break;
      case "comment_made":
        awarded.push(
          ...(await awardTiers(uid, await countCommentsMade(uid), COMMENTS_MADE_TIERS)),
        );
        break;
      case "comment_received":
        awarded.push(
          ...(await awardTiers(uid, await countCommentsReceived(uid), COMMENTS_RECEIVED_TIERS)),
        );
        break;
      case "save":
        awarded.push(
          ...(await awardTiers(uid, await countSaves(uid), SAVES_TIERS)),
        );
        break;
      case "share": {
        const user = await User.findById(uid).select("sharesCount").lean();
        awarded.push(
          ...(await awardTiers(uid, user?.sharesCount ?? 0, SHARES_TIERS)),
        );
        break;
      }
      case "repost":
        awarded.push(
          ...(await awardTiers(uid, await countReposts(uid), REPOST_TIERS)),
        );
        break;
      case "follow": {
        const user = await User.findById(uid).select("followersCount").lean();
        awarded.push(
          ...(await awardTiers(uid, user?.followersCount ?? 0, FOLLOWERS_TIERS)),
        );
        break;
      }
      case "community_join":
        awarded.push(
          ...(await awardTiers(uid, await countCommunitiesJoined(uid), COMMUNITY_JOIN_TIERS)),
        );
        break;
      case "community_created":
        if ((await countCommunitiesCreated(uid)) >= 1) {
          const fresh = await awardBadge(uid, "community_created");
          if (fresh) awarded.push("community_created");
        }
        break;
      case "community_admin":
        awarded.push(
          ...(await awardTiers(uid, await countCommunitiesAdmin(uid), COMMUNITY_ADMIN_TIERS)),
        );
        break;
      case "message":
        awarded.push(
          ...(await awardTiers(uid, await countMessages(uid), MESSAGE_TIERS)),
        );
        break;
      case "mission":
        awarded.push(
          ...(await awardTiers(uid, await countMissionsClaimed(uid), MISSION_TIERS)),
        );
        break;
      case "all_rounder": {
        // Omnivore — engaged with content in every way at least once.
        const [likesGiven, commentsMade, saves, reposts, shares] =
          await Promise.all([
            countLikesGiven(uid),
            countCommentsMade(uid),
            countSaves(uid),
            countReposts(uid),
            User.findById(uid).select("sharesCount").lean(),
          ]);
        const shareCount =
          typeof shares === "number" ? shares : (shares as any)?.sharesCount ?? 0;
        // Omnivore — engaged with content in every way a MEANINGFUL number of
        // times. 10 each (not 1 each) so a 4-click participation trophy can't
        // be farmed in a single minute.
        if (
          likesGiven >= 10 &&
          commentsMade >= 10 &&
          saves >= 10 &&
          (shareCount >= 10 || reposts >= 10)
        ) {
          const fresh = await awardBadge(uid, "all_rounder");
          if (fresh) awarded.push("all_rounder");
        }
        break;
      }
      case "profile": {
        const user = await User.findById(uid)
          .select("bio profilePic")
          .lean();
        const complete =
          !!user?.bio?.trim() && !!user?.profilePic?.url;
        if (complete) {
          const fresh = await awardBadge(uid, "profile_complete");
          if (fresh) awarded.push("profile_complete");
        }
        break;
      }
    }
  } catch (err: any) {
    logger.error("Badge check failed", {
      userId: uid,
      trigger,
      error: err?.message,
    });
  }
  return awarded;
}
