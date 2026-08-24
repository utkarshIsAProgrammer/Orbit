import webPush from "web-push";
import { env } from "../configs/env";
import { logger } from "../utilities/logger";
import { BADGE_CATALOG } from "../utilities/badgeCatalog";
import DeviceSubscription from "../models/deviceSubscription.model";
import { EmailPreference } from "../models/emailPreference.model";
import { getCache, setCache } from "../configs/cache";

// TTL for the cached push-enabled flag. Pushes are high-volume (one per
// chat/community message), so avoid a DB round-trip per send; the flag only
// changes when the user flips the master toggle in settings.
const PUSH_ENABLED_CACHE_TTL = 60; // seconds

/**
 * Whether this user has device pushes enabled (the global master toggle in
 * NotificationSettings). Cached briefly to avoid a DB hit per push. A user
 * with no EmailPreference document defaults to ENABLED (never opt-out by
 * absence), matching the per-category defaults.
 */
const isPushEnabledForUser = async (userId: string): Promise<boolean> => {
  const cacheKey = `push:enabled:${userId}`;
  try {
    const cached = await getCache<boolean>(cacheKey);
    if (cached !== null && cached !== undefined) return cached;
  } catch (err: any) {
    logger.error("push:enabled cache read failed", { error: err.message });
  }

  let enabled = true;
  try {
    const pref = await EmailPreference.findOne({ user: userId })
      .select("pushNotifications")
      .lean();
    enabled = pref?.pushNotifications !== false;
  } catch (err: any) {
    logger.error("push:enabled preference read failed", {
      error: err.message,
      userId,
    });
  }

  try {
    await setCache(cacheKey, enabled, PUSH_ENABLED_CACHE_TTL);
  } catch (err: any) {
    logger.error("push:enabled cache write failed", { error: err.message });
  }
  return enabled;
};

/**
 * Invalidate the cached push-enabled flag after the user flips the master
 * toggle, so the new setting takes effect immediately (not after the TTL).
 */
export const invalidatePushEnabledCache = async (userId: string) => {
  try {
    const { deleteCache } = await import("../configs/cache");
    await deleteCache(`push:enabled:${userId}`);
  } catch (err: any) {
    logger.error("push:enabled cache invalidation failed", {
      error: err?.message,
    });
  }
};

// ─── VAPID keys are generated once and configured via env vars ─────

const vapidSubject = env.VAPID_SUBJECT || "mailto:orbit@example.com";
const vapidPublicKey = env.VAPID_PUBLIC_KEY || "";
const vapidPrivateKey = env.VAPID_PRIVATE_KEY || "";

if (vapidPublicKey && vapidPrivateKey) {
  webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

/**
 * Send a push notification to all devices registered for a user, inline
 * (used by the BullMQ push worker and as the fallback when BullMQ isn't
 * configured). Fires in a fire-and-forget manner — failures are logged but
 * never thrown.
 */
export async function sendPushToUserInline(
  userId: string,
  payload: {
    title: string;
    body: string;
    icon?: string;
    badge?: string;
    image?: string;
    data?: Record<string, unknown>;
    tag?: string;
    requireInteraction?: boolean;
    timestamp?: string;
  }
): Promise<void> {
  if (!vapidPublicKey || !vapidPrivateKey) {
    logger.warn("Push notifications not configured — missing VAPID keys");
    return;
  }

  // Global master toggle — the "Push notifications" switch in settings.
  // When off, no device push goes out for ANY event type (chat, community,
  // likes, calls, streaks). This is the single gate every push path flows
  // through (the BullMQ push worker + the inline fallback both call here),
  // so checking once covers all call sites.
  if (!(await isPushEnabledForUser(userId))) {
    return;
  }

  try {
    const subscriptions = await DeviceSubscription.find({ user: userId })
      .select("subscription")
      .lean();

    if (subscriptions.length === 0) return;

    const pushPayload = JSON.stringify(payload);
    const staleEndpoints: string[] = [];

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        const s = sub.subscription as webPush.PushSubscription;
        try {
          await webPush.sendNotification(s, pushPayload);
        } catch (err: any) {
          // 410 Gone / 404 Not Found — the subscription is expired or invalid
          if (err.statusCode === 410 || err.statusCode === 404) {
            staleEndpoints.push((s as any).endpoint);
          } else {
            logger.error("Failed to send push notification", {
              error: err.message,
              endpoint: (s as any).endpoint?.substring(0, 50),
            });
          }
        }
      })
    );

    // Clean up stale subscriptions
    if (staleEndpoints.length > 0) {
      await DeviceSubscription.deleteMany({
        user: userId,
        "subscription.endpoint": { $in: staleEndpoints },
      });
      logger.info("Cleaned up stale push subscriptions", {
        userId,
        count: staleEndpoints.length,
      });
    }
  } catch (err: any) {
    logger.error("Error in sendPushToUserInline", { error: err.message, userId });
  }
}

/**
 * Send a push notification to all devices registered for a user.
 *
 * Prefers BullMQ: the web-push HTTP calls (one per device subscription,
 * plus stale-endpoint cleanup) run on a worker instead of the
 * chat/community/notification paths. When BullMQ isn't configured, falls
 * back to the inline send so behavior is unchanged. Fire-and-forget —
 * failures are logged but never thrown.
 */
export async function sendPushToUser(
  userId: string,
  payload: {
    title: string;
    body: string;
    icon?: string;
    badge?: string;
    image?: string;
    data?: Record<string, unknown>;
    tag?: string;
    requireInteraction?: boolean;
    timestamp?: string;
  }
): Promise<void> {
  try {
    const { enqueuePushNotification } = await import("../configs/queue");
    const queued = await enqueuePushNotification(userId, payload as any);
    if (queued) return;
  } catch (err: any) {
    logger.error("Push enqueue failed — sending inline", {
      userId,
      error: err.message,
    });
  }
  await sendPushToUserInline(userId, payload);
}

/**
 * Plain-text label for a chat/community message with no text body.
 * Matches the in-app convention ("Photo", "Voice note", "Video", "File")
 * and deliberately avoids emoji characters in push bodies.
 */
/** "95" → "1m 35s" · "3725" → "1h 02m" · "45" → "45s" */
const formatCallDurationForPush = (seconds?: number): string => {
  const s = Math.max(0, Math.floor(seconds || 0));
  if (s < 60) return s === 0 ? "Call ended" : `Call ended · ${s}s`;
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `Call ended · ${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `Call ended · ${m}m ${String(s % 60).padStart(2, "0")}s`;
};

export function attachmentPushLabel(
  attachments?: Array<{ type?: string }> | null,
  text?: string | null,
): string {
  if (text && text.trim()) return text.trim().slice(0, 120);
  const type = attachments?.[0]?.type;
  switch (type) {
    case "voice_note":
      return "Voice note";
    case "image":
      return "Photo";
    case "video":
      return "Video";
    case "gif":
      return "GIF";
    case "sticker":
      return "Sticker";
    case "meme":
      return "Meme";
    case "file":
      return "File";
    default:
      return "New message";
  }
}

/**
 * Build a notification payload from an in-app notification document.
 */
export function buildPushPayload(
  notification: any,
  extra?: { unreadCount?: number }
): {
  title: string;
  body: string;
  icon?: string;
  data?: Record<string, unknown>;
  tag: string;
  requireInteraction: boolean;
  timestamp?: string;
} {
  const senderName = notification.sender?.fullName || notification.sender?.username || "Someone";
  const senderPic = notification.sender?.profilePic?.url || "/icon-192.png";

  const typeConfig: Record<string, { title: string; body: string }> = {
    like: { title: senderName, body: "liked your post" },
    comment: { title: senderName, body: "commented on your post" },
    follow: { title: senderName, body: "started following you" },
    repost: { title: senderName, body: "reposted your post" },
    save: { title: senderName, body: "saved your post" },
    mention: {
      title: senderName,
      body: notification.community
        ? "mentioned you in a community"
        : "mentioned you",
    },
    reaction: { title: senderName, body: "reacted to your message" },
    post_reaction: { title: senderName, body: "reacted to your post" },
    message_reply: { title: senderName, body: "replied to your message" },
    glimpse_reaction: { title: senderName, body: "reacted to your glance" },
    glimpse_reply: { title: senderName, body: "replied to your glance" },
    poll_vote: { title: senderName, body: "voted in your poll" },
    collab_invite: { title: senderName, body: "invited you to collaborate" },
    follow_request: { title: senderName, body: "wants to follow you" },
    daily_reward: { title: "Daily Reward", body: "Your daily reward is ready!" },
    streak_reminder: { title: "Streak Reminder", body: "Don't lose your streak!" },
    invite_accepted: { title: senderName, body: "accepted your invite code!" },
    profile_share: { title: senderName, body: "shared a profile with you" },
    post_share: { title: senderName, body: "shared a post with you" },
    glimpse_share: { title: senderName, body: "shared a glance with you" },
    collection_share: { title: senderName, body: "shared a collection with you" },
    comment_share: { title: senderName, body: "shared a comment with you" },
    call_missed: {
      title: senderName,
      body:
        notification.callType === "video"
          ? "Missed video call"
          : "Missed voice call",
    },
    call_started: {
      title: senderName,
      body: notification.community
        ? notification.callType === "video"
          ? "started a video call in a community"
          : "started a voice call in a community"
        : notification.callType === "video"
          ? "called you (video)"
          : "called you",
    },
    call_ended: {
      title: senderName,
      body: formatCallDurationForPush(notification.callDuration),
    },
    badge_unlocked: {
      title: "🏆 Achievement Unlocked",
      body: notification.badge
        ? `You earned a new badge: ${notification.badge.replace(/_/g, " ")}`
        : "You earned a new badge!",
    },
  };

  const config = typeConfig[notification.type] || {
    title: "Orbit",
    body: "You have a new notification",
  };

  // Badge unlocks read nicer with the real catalog label (e.g. "First Steps")
  // than the raw badge id ("first 100"). badgeCatalog is a leaf module, so
  // importing it here can't create a cycle. The perk title is appended so
  // the device notification celebrates the reward the user just earned
  // (e.g. "Unlocked: Aurora Theme").
  if (
    notification.type === "badge_unlocked" &&
    notification.badge &&
    BADGE_CATALOG[notification.badge]
  ) {
    const meta = BADGE_CATALOG[notification.badge];
    const label = meta?.label ?? notification.badge;
    const perkTitle = meta?.perk?.title;
    config.title = `🏆 ${label}`;
    config.body = perkTitle
      ? `Achievement unlocked! New perk: ${perkTitle}`
      : `Achievement unlocked: ${label}`;
  }

  return {
    title: config.title,
    body: config.body,
    icon: senderPic,
    tag: `orbit-${notification._id || notification.type}`,
    requireInteraction:
      notification.type === "follow_request" ||
      notification.type === "collab_invite" ||
      notification.type === "badge_unlocked",
    timestamp: notification.createdAt
      ? new Date(notification.createdAt).toISOString()
      : new Date().toISOString(),
    data: {
      url:
        notification.type === "call_missed" ||
        notification.type === "call_started" ||
        notification.type === "call_ended"
          ? notification.community
            ? `/communities?open=${
                typeof notification.community === "string"
                  ? notification.community
                  : notification.community._id
              }`
            : "/chat"
          : notification.post?.slug
            ? `/post/${notification.post.slug}`
            : notification.post?.toString()
              ? `/post/${notification.post.toString()}`
              : notification.community
                ? `/communities?open=${
                    typeof notification.community === "string"
                      ? notification.community
                      : notification.community._id
                  }`
                : notification.type === "follow"
                  ? `/u/${notification.sender?.username}`
                  : "/notifications",
      type: notification.type,
      notificationId: notification._id,
      unreadCount: extra?.unreadCount ?? 0,
    },
  };
}
