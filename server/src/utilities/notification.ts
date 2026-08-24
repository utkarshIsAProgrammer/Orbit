import mongoose from "mongoose";
import Notification from "../models/notification.model";
import { User } from "../models/user.model";
import { BADGE_CATALOG } from "./badgeCatalog";
import { EmailPreference } from "../models/emailPreference.model";
import { sendNotification } from "../configs/socket";
import { clearByPattern, deleteCache } from "../configs/cache";
import { sendPushToUser, buildPushPayload } from "../services/pushService";
import { areMutuallyBlocked } from "./blockCheck";
import { logger } from "./logger";

// Tiny in-process cache for the push-badge unread count. A viral post can
// create 50 like-notifications in seconds; each used to run a full
// countDocuments on the Notification collection purely to stamp the device
// badge. The count is memoized for a few seconds per user, so a burst
// triggers ONE count, not 50. It self-corrects (short TTL, and the badge is
// always refreshed on the next app open), so no invalidation is needed.
const unreadCountCache = new Map<
  string,
  { count: number; expiresAt: number }
>();
const UNREAD_COUNT_CACHE_TTL_MS = 5_000;
// Hard cap on cache entries: a viral post can touch tens of thousands of
// users in minutes, and each needs a (TTL-bounded) entry. Past this, evict
// the oldest entries (Map preserves insertion order) — a badge stamp is
// best-effort and self-corrects on the next app open, so dropping a stale
// entry is harmless.
const UNREAD_COUNT_CACHE_MAX = 20_000;

const getUnreadCountForBadge = async (
  recipient: string | mongoose.Types.ObjectId,
): Promise<number> => {
  const uid = recipient.toString();
  const hit = unreadCountCache.get(uid);
  if (hit && hit.expiresAt > Date.now()) return hit.count;

  const count = await Notification.countDocuments({
    recipient,
    isRead: false,
  });
  unreadCountCache.set(uid, {
    count,
    expiresAt: Date.now() + UNREAD_COUNT_CACHE_TTL_MS,
  });
  // Bound memory: evict expired entries first, then oldest-inserted ones
  // when the map outgrows the cap.
  if (unreadCountCache.size > UNREAD_COUNT_CACHE_MAX) {
    const now = Date.now();
    for (const [key, entry] of unreadCountCache) {
      if (entry.expiresAt <= now) {
        unreadCountCache.delete(key);
      }
    }
    while (unreadCountCache.size > UNREAD_COUNT_CACHE_MAX) {
      const oldest = unreadCountCache.keys().next().value as
        | string
        | undefined;
      if (!oldest) break;
      unreadCountCache.delete(oldest);
    }
  }
  return count;
};

/**
 * Invalidate all cached notification data for a recipient.
 *
 * The notifications list (`getNotifications`) is cached under
 * `notifications:${userId}:*` and the unread badge count under
 * `notifications:unread:${userId}`. The route-level `cacheMiddleware`
 * additionally caches GET responses under `api:${userId}:*`.
 * Without this invalidation, a newly created notification (or a deletion)
 * would stay invisible for the full cache TTL, so the bell badge / list
 * would appear stale (e.g. "0 unread" even though a new message arrived).
 */
export const invalidateRecipientNotificationCaches = async (recipientId: string) => {
  try {
    await Promise.allSettled([
      // Controller-level caches: notifications list + unread badge count
      clearByPattern(`notifications:${recipientId}:*`),
      deleteCache(`notifications:unread:${recipientId}`),
      // Route-level cacheMiddleware keys (format: api:<userId>:<path>:<query>).
      // The notification router is mounted at /api/notifications, so real
      // keys are `api:<id>:/api/notifications:<query>` (list) and
      // `api:<id>:/api/notifications/unread-count:<query>` (badge). Match
      // ONLY those — do NOT clear `api:<id>:*` broadly: that would wipe the
      // user's entire API cache (posts, feed, conversations, communities) on
      // every notification create/delete.
      clearByPattern(`api:${recipientId}:/api/notifications/unread-count*`),
      clearByPattern(`api:${recipientId}:/api/notifications*`),
    ]);
  } catch (err: any) {
    logger.error("Error invalidating notification caches", { error: err?.message, recipientId });
  }
};

type NotificationType = "like" | "comment" | "follow" | "repost" | "save" | "mention" | "reaction" | "post_reaction" | "message" | "message_reply" | "glimpse_reaction" | "glimpse_reply" | "poll_vote" | "collab_invite" | "follow_request" | "daily_reward" | "streak_reminder" | "invite_accepted" | "profile_share" | "post_share" | "glimpse_share" | "comment_share" | "collection_share" | "badge_unlocked" | "call_missed" | "call_started" | "call_ended";

/**
 * Maps a notification type to its per-category preference key (see the
 * EmailPreference `notificationPrefs` object). System notifications
 * (daily rewards, streak reminders) are always delivered.
 */
const NOTIFICATION_CATEGORY: Record<NotificationType, string> = {
  like: "likes",
  comment: "comments",
  comment_share: "comments",
  follow: "follows",
  follow_request: "follows",
  invite_accepted: "follows",
  mention: "mentions",
  message: "messages",
  message_reply: "messages",
  reaction: "messages",
  call_missed: "messages",
  call_started: "messages",
  call_ended: "messages",
  post_reaction: "likes",
  repost: "reposts",
  post_share: "reposts",
  profile_share: "reposts",
  glimpse_share: "reposts",
  collection_share: "reposts",
  save: "saves",
  poll_vote: "polls",
  glimpse_reaction: "glances",
  glimpse_reply: "glances",
  collab_invite: "collabs",
  daily_reward: "system",
  streak_reminder: "system",
  badge_unlocked: "system",
};

/**
 * Whether a recipient has the category for this notification type enabled.
 * Missing preference documents default to enabled (all categories on), so
 * users who never touched the settings keep receiving everything.
 */
export const shouldNotifyCategory = async (
  recipientId: string,
  type: NotificationType,
): Promise<boolean> => {
  try {
    const category = NOTIFICATION_CATEGORY[type] || "system";
    if (category === "system") return true;
    const pref = await EmailPreference.findOne({ user: recipientId })
      .select("notificationPrefs")
      .lean();
    const np = pref?.notificationPrefs as
      | Record<string, boolean | undefined>
      | undefined;
    return np?.[category] !== false;
  } catch (err: any) {
    logger.error("shouldNotifyCategory check failed", {
      error: err?.message,
      recipientId,
    });
    return true;
  }
};

type NotificationParams = {
  recipient: string;
  sender: string;
  type: NotificationType;
  post?: string | null;
  comment?: string | null;
  glimpse?: string | null;
  user?: string | null;
  collection?: string | null;
  community?: string | null;
  message?: string | null;
  /** audio/video — only used for call_* notification types. */
  callType?: "audio" | "video";
  /** Seconds the call lasted — only used for type === "call_ended". */
  callDuration?: number;
};

type CreateNotificationParams = NotificationParams;
type DeleteNotificationParams = NotificationParams;

export const extractMentions = async (
  text: string,
  opts?: { memberUserIds?: string[] },
): Promise<string[]> => {
  // Match @username ONLY when the @ begins a token (start of string or after
  // whitespace/paren). This deliberately excludes emails (`foo@bar.com` has a
  // word char right before @) and partial matches like `@gmail.com` where the
  // @ is mid-token — mentions must be real, whole usernames (Instagram/X-style).
  const mentionRegex = /(?:^|[\s(])@([A-Za-z0-9_]+)/g;
  const matches = [...text.matchAll(mentionRegex)];
  const usernames = matches
    .map((match) => match[1]?.toLowerCase() || "")
    .filter(Boolean);

  if (usernames.length === 0) return [];

  const users = await User.find({ username: { $in: usernames } })
    .select("_id")
    .lean();
  let ids = users.map((user: any) => user._id.toString());

  // Community scope — only community members can be mentioned (and thus
  // notified). Non-member usernames resolve to nothing in this context.
  if (opts?.memberUserIds?.length) {
    const memberSet = new Set(opts.memberUserIds);
    ids = ids.filter((id) => memberSet.has(id));
  }

  return ids;
};

/**
 * Queue-aware wrapper: when BullMQ is configured, the notification is
 * created on a worker (DB + socket + push all run off the request path),
 * so like/comment/follow/mention endpoints respond in ms instead of
 * waiting out ~5 DB round-trips. Falls back to running inline when the
 * queue is unavailable. Callers never use the return value, so a queued
 * call returning null immediately is safe.
 */
export const createNotification = async (
  params: CreateNotificationParams,
) => {
  try {
    const { enqueueNotificationCreate } = await import("../configs/queue");
    const queued = await enqueueNotificationCreate(params as any);
    if (queued) return null; // worker will create + deliver it
  } catch (err: any) {
    logger.error("createNotification enqueue failed", { error: err.message });
  }
  // No Redis / enqueue error → run inline (previous behavior).
  return createNotificationDirect(params);
};

/**
 * The actual notification creation + delivery logic. Exported so the
 * BullMQ worker can run it directly. Never called by controllers — they
 * go through `createNotification` (queue-aware).
 */
export const createNotificationDirect = async ({
  recipient,
  sender,
  type,
  post,
  comment,
  glimpse,
  user,
  collection,
  community,
  message,
  callType,
  callDuration,
}: CreateNotificationParams) => {
  try {
    // prevent self notifications
    if (recipient.toString() === sender.toString()) {
      return null;
    }

    // Blocked users must never surface to each other — no in-app
    // notification, no socket event, no device push (either direction).
    if (await areMutuallyBlocked(recipient.toString(), sender.toString())) {
      return null;
    }

    // Per-category preference toggle — when the recipient disabled this
    // category, skip the in-app notification AND the device push entirely.
    if (!(await shouldNotifyCategory(recipient.toString(), type))) {
      return null;
    }

    // notifications
    const notification = await Notification.create({
      recipient,
      sender,
      type,
      post: post || null,
      comment: comment || null,
      glimpse: glimpse || null,
      user: user || null,
      collection: collection || null,
      community: community || null,
      message: message || null,
      ...(callType && type.startsWith("call_") ? { callType } : {}),
      ...(callDuration && type === "call_ended" ? { callDuration } : {}),
    });

    // Invalidate the recipient's cached list + unread count so the badge
    // updates immediately instead of waiting for the cache TTL to expire.
    await invalidateRecipientNotificationCaches(recipient.toString());

    // populate notification for socket
    const populatedNotification = await Notification.findById(notification._id)
      .populate("sender", "fullName username profilePic isVerified statusText waitlistPerk")
      .populate("user", "fullName username profilePic isVerified statusText waitlistPerk")
      .populate("community", "name _id")
      .lean();

    if (populatedNotification) {
      sendNotification(recipient.toString(), populatedNotification);

      // Also send device push notification (fire-and-forget). The unread
      // count is included so the service worker can update the launcher
      // badge (Android) — like real social apps.
      let unreadCount = 0;
      try {
        unreadCount = await getUnreadCountForBadge(recipient);
      } catch (err: any) {
        logger.error("Failed to count unread notifications for push badge", {
          error: err.message,
        });
      }
      const pushPayload = buildPushPayload(populatedNotification, {
        unreadCount,
      });
      sendPushToUser(recipient.toString(), pushPayload);
    }

    return notification;
  } catch (err: any) {
    logger.error(`Error in createNotification utility!`, { error: err.message });

    return null;
  }
};

/**
 * Notify a user that they unlocked an achievement badge — a SELF
 * notification (recipient === sender) that createNotification deliberately
 * skips, so it's created directly here with full socket + push delivery.
 * Used by the badge engine (xpService milestones, badgeService count
 * triggers, streak/referral tiers). Fire-and-forget.
 */
export async function notifyBadgeUnlock(userId: string, badgeId: string) {
  try {
    const meta = BADGE_CATALOG[badgeId];
    if (!meta) return;

    const notification = await Notification.create({
      recipient: userId,
      sender: userId,
      type: "badge_unlocked",
      badge: badgeId,
    });

    await invalidateRecipientNotificationCaches(userId);

    const populatedNotification = await Notification.findById(notification._id)
      .populate("sender", "fullName username profilePic isVerified statusText waitlistPerk")
      .lean();

    if (populatedNotification) {
      sendNotification(userId, populatedNotification);
      const unreadCount = await getUnreadCountForBadge(userId).catch(() => 0);
      const pushPayload = buildPushPayload(populatedNotification, {
        unreadCount,
      });
      sendPushToUser(userId, pushPayload);
    }
  } catch (err: any) {
    logger.error("Failed to notify badge unlock", {
      userId,
      badgeId,
      error: err?.message,
    });
  }
}

/** Queue-aware wrapper (same pattern as createNotification). */
export const deleteInteractionNotification = async (
  params: DeleteNotificationParams,
) => {
  try {
    const { enqueueNotificationDelete } = await import("../configs/queue");
    const queued = await enqueueNotificationDelete(params as any);
    if (queued) return;
  } catch (err: any) {
    logger.error("deleteInteractionNotification enqueue failed", {
      error: err.message,
    });
  }
  return deleteInteractionNotificationDirect(params);
};

/** The actual delete logic — run by the BullMQ worker or inline fallback. */
export const deleteInteractionNotificationDirect = async ({
  recipient,
  sender,
  type,
  post,
  comment,
  glimpse,
  user,
}: DeleteNotificationParams) => {
  try {
    const filter: Record<string, unknown> = {
      recipient,
      sender,
      type,
    };

    if (post !== undefined) {
      filter.post = post;
    }

    if (comment !== undefined) {
      filter.comment = comment;
    }

    if (glimpse !== undefined) {
      filter.glimpse = glimpse;
    }

    if (user !== undefined) {
      filter.user = user;
    }

    await Notification.deleteMany(filter);

    // Invalidate the recipient's cached list + unread count so the badge
    // updates immediately after an interaction is undone (e.g. unlike).
    await invalidateRecipientNotificationCaches(recipient.toString());
  } catch (err: any) {
    logger.error(`Error in deleteInteractionNotification utility!`, { error: err.message });
  }
};
