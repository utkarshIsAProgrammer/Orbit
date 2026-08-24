import cron from "node-cron";
import { registerMaintenanceJob } from "./queue";
import { User } from "../models/user.model";
import { UserStreak } from "../models/userStreak.model";
import Notification from "../models/notification.model";
import UserMission from "../models/dailyMission.model";
import Post from "../models/post.model";
import { recomputeAffinityScores } from "../services/affinityService";
import { sendPushToUser } from "../services/pushService";
import { clearFeedCache, clearUserPostsCache } from "../configs/cache";
import { emitPostCreated } from "../configs/socket";
import { deliverWebhookEvent } from "../controllers/webhook.controller";
import { addUserStatusToPosts } from "../utilities/postStatus";
import { invalidateFeedCache } from "../services/feedService";
import { logger } from "../utilities/logger";
import { CommunityMessage } from "../models/communityMessage.model";
import { Message } from "../models/message.model";

/** How many users to process per batch to avoid overwhelming the DB/CPU */
const BATCH_SIZE = 50;

/** Process at most this many batches per scheduled run */
const MAX_BATCHES = 20;

/**
 * Keep-alive pinger for free-tier hosting (e.g. Render free).
 *
 * Free platforms sleep the process after a period of inactivity and wake it
 * on the next request — causing ~30s cold-start delays for the first user.
 * To prevent that, we ping our own public /api/ping every 5 minutes, which
 * keeps the instance "active" so it never sleeps.
 *
 * Requires PUBLIC_API_URL to be set to the public URL of the API
 * (e.g. https://orbit-backend.onrender.com). No-ops in development or when
 * the URL is unset, so local dev is never affected.
 */
export function startKeepAlive(): void {
  const publicUrl = (process.env.PUBLIC_API_URL || "").trim();

  if (!publicUrl) {
    logger.info(
      "Keep-alive scheduler disabled — PUBLIC_API_URL not set (set it on your free-tier host to prevent sleeping)",
    );
    return;
  }
  if (process.env.NODE_ENV === "development") {
    logger.info("Keep-alive scheduler disabled in development");
    return;
  }

  // In cluster mode each worker would otherwise register its own cron and
  // ping N times per 5 minutes. Run it only from the primary process.
  const cluster = require("cluster") as { isPrimary?: boolean };
  if (cluster.isPrimary === false) {
    logger.info("Keep-alive scheduler skipped on cluster worker");
    return;
  }

  const target = publicUrl.replace(/\/$/, "") + "/api/ping";

  const ping = async () => {
    try {
      const res = await fetch(target, {
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        logger.info("Keep-alive ping OK", {
          status: res.status,
          target,
        });
      } else {
        logger.warn("Keep-alive ping returned non-OK status", {
          status: res.status,
          target,
        });
      }
    } catch (err: any) {
      logger.error("Keep-alive ping failed", {
        error: err?.message || String(err),
        target,
      });
    }
  };

  // Runs every 5 minutes: "*/5 * * * *"
  cron.schedule("*/5 * * * *", ping);

  // Ping immediately on boot too — otherwise the first ping waits up to 5
  // minutes, leaving the instance warmable-but-not-yet-warmed right after a
  // deploy/restart (exactly when the first login can 503).
  void ping();

  logger.info(`Keep-alive scheduler registered (pings ${target} every 5 minutes)`);
}

/**
 * One affinity-recompute pass — the task body run by either the BullMQ
 * maintenance worker or the node-cron fallback.
 */
async function runAffinityRecompute(): Promise<void> {
  logger.info("Affinity scheduler: starting batch recomputation");

  try {
    const fifteenMinutesAgo = new Date(
      Date.now() - 15 * 60 * 1000
    );

    // Find users whose affinity hasn't been computed recently
    const staleUsers = await User.find({
      $or: [
        { affinityUpdatedAt: null },
        { affinityUpdatedAt: { $lt: fifteenMinutesAgo } },
      ],
    })
      .select("_id")
      .limit(BATCH_SIZE * MAX_BATCHES)
      .lean();

    if (staleUsers.length === 0) {
      logger.info("Affinity scheduler: no stale users found");
      return;
    }

    logger.info("Affinity scheduler: processing users", {
      count: staleUsers.length,
    });

    // Process in batches
    let processed = 0;
    for (let i = 0; i < staleUsers.length && i < MAX_BATCHES * BATCH_SIZE; i += BATCH_SIZE) {
      const batch = staleUsers.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map((u) => recomputeAffinityScores(u._id.toString()))
      );
      processed += batch.length;
    }

    logger.info("Affinity scheduler: batch complete", { processed });
  } catch (err: any) {
    logger.error("Affinity scheduler: error", { error: err.message });
  }
}

/**
 * Start the affinity recomputation scheduler.
 *
 * Runs every 30 minutes — as a BullMQ repeatable job when REDIS_URL is
 * configured (deduped across cluster workers), node-cron otherwise. Each
 * run picks up the most recently active users (those whose
 * `affinityUpdatedAt` is null or older than 15 min) and recomputes their
 * affinity scores in batches.
 */
export async function startAffinityScheduler(): Promise<void> {
  if (await registerMaintenanceJob("affinity-recompute", "*/30 * * * *")) {
    logger.info(
      "Affinity scheduler registered as BullMQ repeatable job (every 30 minutes)",
    );
    return;
  }
  // Runs every 30 minutes: "*/30 * * * *"
  cron.schedule("*/30 * * * *", () => {
    void runAffinityRecompute();
  });

  logger.info(
    "Affinity scheduler registered (node-cron fallback — runs every 30 minutes)",
  );
}

/**
 * One notification-prune pass — the task body run by either the BullMQ
 * maintenance worker or the node-cron fallback.
 */
async function runNotificationPruner(): Promise<void> {
  logger.info("Notification pruner: starting cleanup");

  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const result = await Notification.deleteMany({
      isRead: true,
      createdAt: { $lt: thirtyDaysAgo },
    });

    logger.info("Notification pruner: cleanup complete", {
      deletedCount: result.deletedCount,
    });
  } catch (err: any) {
    logger.error("Notification pruner: error", { error: err.message });
  }
}

/**
 * Start the notification pruning scheduler.
 *
 * Runs daily at 3:00 AM — as a BullMQ repeatable job when REDIS_URL is
 * configured (deduped across cluster workers), node-cron otherwise. Deletes
 * read notifications that are older than 30 days to prevent unbounded
 * collection growth. Unread notifications are preserved indefinitely so
 * users never lose unseen alerts.
 */
export async function startNotificationPruner(): Promise<void> {
  if (await registerMaintenanceJob("notification-pruner", "0 3 * * *")) {
    logger.info(
      "Notification pruner registered as BullMQ repeatable job (daily at 3:00 AM)",
    );
    return;
  }
  // Runs at 3:00 AM every day: "0 3 * * *"
  cron.schedule("0 3 * * *", () => {
    void runNotificationPruner();
  });

  logger.info(
    "Notification pruner registered (node-cron fallback — runs daily at 3:00 AM)",
  );
}

/**
 * One daily-mission-reset pass — the task body run by either the BullMQ
 * maintenance worker or the node-cron fallback.
 */
async function runDailyMissionReset(): Promise<void> {
  logger.info("Daily mission reset: starting cleanup of old missions");

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Delete missions older than 7 days
    const result = await UserMission.deleteMany({
      date: { $lt: sevenDaysAgo.toISOString().slice(0, 10) },
    });

    logger.info("Daily mission reset: cleanup complete", {
      deletedCount: result.deletedCount,
    });
  } catch (err: any) {
    logger.error("Daily mission reset: error", { error: err.message });
  }
}

/**
 * Start the daily missions reset scheduler.
 *
 * Runs at midnight (00:00) every day — as a BullMQ repeatable job when
 * REDIS_URL is configured (deduped across cluster workers), node-cron
 * otherwise. Deletes all UserMission records from the previous day so fresh
 * missions are generated on next user visit. Old records older than 7 days
 * are hard-deleted to keep the collection lean.
 */
export async function startDailyMissionReset(): Promise<void> {
  if (await registerMaintenanceJob("daily-mission-reset", "0 0 * * *")) {
    logger.info(
      "Daily mission reset registered as BullMQ repeatable job (daily at midnight)",
    );
    return;
  }
  // Runs at midnight every day: "0 0 * * *"
  cron.schedule("0 0 * * *", () => {
    void runDailyMissionReset();
  });

  logger.info(
    "Daily mission reset registered (node-cron fallback — runs daily at midnight)",
  );
}

/**
 * One streak-break-check pass — the task body run by either the BullMQ
 * maintenance worker or the node-cron fallback.
 */
async function runStreakBreakChecker(): Promise<void> {
  logger.info("Streak break checker: starting");

  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Find users with active streaks but lastActiveDate is older than yesterday
    // (i.e. they missed at least one full day after yesterday)
    const brokenStreaks = await UserStreak.find({
      currentStreak: { $gt: 0 },
      lastActiveDate: { $ne: null, $lt: yesterday },
      streakBreakNotified: { $ne: true },
    })
      .select("user currentStreak longestStreak lastActiveDate")
      .limit(BATCH_SIZE * MAX_BATCHES)
      .lean();

    if (brokenStreaks.length === 0) {
      logger.info("Streak break checker: no broken streaks found");
      return;
    }

    logger.info("Streak break checker: processing broken streaks", {
      count: brokenStreaks.length,
    });

    for (const record of brokenStreaks) {
      try {
        // Reset streak to 0
        await UserStreak.updateOne(
          { _id: record._id },
          {
            $set: {
              currentStreak: 0,
              streakBreakNotified: true,
            },
          }
        );

        // Create an in-app notification
        await Notification.create({
          recipient: record.user,
          type: "streak_reminder",
          message: `Your ${record.currentStreak}-day streak has been broken! Start a new streak today.`,
          isRead: false,
        });

        // Send push notification
        await sendPushToUser(record.user.toString(), {
          title: "Streak Broken 💔",
          body: `Your ${record.currentStreak}-day streak has been broken! Start a new streak today to keep the flame alive.`,
          tag: "streak-broken",
          requireInteraction: false,
          data: { url: "/profile" },
        });
      } catch (err: any) {
        logger.error("Streak break checker: failed to process streak", {
          userId: record.user,
          error: err.message,
        });
      }
    }

    logger.info("Streak break checker: batch complete", {
      processed: brokenStreaks.length,
    });
  } catch (err: any) {
    logger.error("Streak break checker: error", { error: err.message });
  }
}

/**
 * Start the streak break checker scheduler.
 *
 * Runs every hour — as a BullMQ repeatable job when REDIS_URL is configured
 * (deduped across cluster workers), node-cron otherwise. Detects users whose
 * streak has been broken (lastActiveDate is older than yesterday), resets
 * their streak to 0, and sends a push notification alerting them.
 */
export async function startStreakBreakChecker(): Promise<void> {
  if (await registerMaintenanceJob("streak-break-checker", "0 * * * *")) {
    logger.info(
      "Streak break checker registered as BullMQ repeatable job (every hour)",
    );
    return;
  }
  // Runs every hour: "0 * * * *"
  cron.schedule("0 * * * *", () => {
    void runStreakBreakChecker();
  });

  logger.info(
    "Streak break checker registered (node-cron fallback — runs every hour)",
  );
}

/**
 * Start the scheduled post publisher.
 *
 * Runs every minute. Finds posts whose `status` is "scheduled" and whose
 * `scheduledAt` has passed, flips them to "published", clears the feed
 * caches, and broadcasts a `post:created` event so they appear in feeds
 * in realtime — exactly as if the author had posted them manually.
 */
/**
 * Publish ONE scheduled post: flip status → published, clear caches,
 * broadcast to connected clients, fire the post.created webhook.
 *
 * Used BOTH by the 1-minute cron fallback (batch mode) and the BullMQ
 * delayed-job worker (exact-time mode). Idempotent — publishing an
 * already-published post is a no-op, so the two paths can never
 * double-publish.
 */
export async function publishScheduledPost(postId: string): Promise<void> {
  try {
    const post = await Post.findById(postId).select("_id author status").lean();
    if (!post || post.status !== "scheduled") return; // already published / deleted

    await Post.updateOne(
      { _id: post._id },
      { $set: { status: "published", scheduledAt: null } }
    );

    // Clear feed caches so the published post appears immediately
    await clearFeedCache();
    const authorId = post.author?.toString();
    if (authorId) {
      await clearUserPostsCache(authorId);
      await invalidateFeedCache(authorId).catch(() => {});
    }

    // Broadcast the newly-published post to connected clients
    const populated = await Post.findById(post._id)
      .populate("author", "username email fullName profilePic isVerified statusText waitlistPerk")
      .populate("collaborator", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();
    if (populated) {
      const postsWithStatus = await addUserStatusToPosts(
        [populated],
        populated.author?._id?.toString(),
      );
      emitPostCreated(postsWithStatus[0]);
      // Webhook: the author's endpoints learn their scheduled post went live
      if (authorId) {
        deliverWebhookEvent(
          "post.created",
          {
            postId: populated._id,
            authorId,
            visibility: populated.visibility,
          },
          authorId,
        ).catch(() => {});
      }
    }

    logger.info("Scheduled post published", { postId });
  } catch (err: any) {
    logger.error("Scheduled post publisher: publish failed", {
      postId,
      error: err.message,
    });
  }
}

/**
 * Deliver a scheduled DM or community message (WhatsApp/IG-style scheduled
 * send). The message row exists in Mongo with `scheduledAt` set but has NOT
 * been delivered yet — the client rendered a "Scheduled" chip instead of a
 * sent message. This clears scheduledAt and runs the normal emit path so it
 * appears in realtime exactly at its time.
 *
 * Called by the BullMQ delayed job (exact timing) AND the 1-min cron safety
 * net (catch anything a job missed). Idempotent: a message with
 * scheduledAt already null is skipped, so both paths can run at once.
 */
export async function deliverScheduledMessage(
  kind: "dm" | "community",
  messageId: string,
): Promise<void> {
  try {
    // Atomic claim: only ONE caller (the BullMQ delayed job OR the 1-min
    // cron safety net — they can fire in the same tick) may clear
    // scheduledAt. The filter ({ scheduledAt: { $ne: null, $lte: now } })
    // doubles as the due-time check, and the loser of the race matches
    // nothing and bails. Without the claim, a same-tick double fire would
    // emit the message twice and double-increment unread counts.
    if (kind === "dm") {
      const claimed = await Message.findOneAndUpdate(
        {
          _id: messageId,
          scheduledAt: { $ne: null, $lte: new Date() },
        },
        { $set: { scheduledAt: null } },
        { new: true },
      ).select("_id conversation");
      if (!claimed?.conversation) return; // already delivered/deleted, or not due

      // Deliver, then broadcast like a normal send. Reuse the send path's
      // helper so unread/lastMessage/cache behavior is identical.
      const { deliverScheduledDm } = await import(
        "../controllers/chat.controllers"
      );
      await deliverScheduledDm(
        claimed.conversation.toString(),
        claimed._id.toString(),
      );
      return;
    }

    const claimed = await CommunityMessage.findOneAndUpdate(
      {
        _id: messageId,
        scheduledAt: { $ne: null, $lte: new Date() },
      },
      { $set: { scheduledAt: null } },
      { new: true },
    ).select("_id");
    if (!claimed) return; // already delivered/deleted, or not due
    const { deliverScheduledCommunityMessage } = await import(
      "../controllers/community.controllers"
    );
    await deliverScheduledCommunityMessage(claimed._id.toString());
  } catch (err: any) {
    logger.error("Scheduled message delivery failed", {
      kind,
      messageId,
      error: err.message,
    });
  }
}

/**
 * Cron safety net for scheduled messages — the 1-min poll twin of the
 * scheduled-post publisher. When BullMQ is configured, delayed jobs fire at
 * the exact time and this poll finds nothing due; when it's not (no
 * REDIS_URL) this is the ONLY deliverer. Idempotent with the job path.
 */
export function startScheduledMessagePublisher(): void {
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();
      const [dueDms, dueCommunity] = await Promise.all([
        Message.find({
          scheduledAt: { $ne: null, $lte: now },
        })
          .select("_id")
          .limit(500)
          .lean(),
        CommunityMessage.find({
          scheduledAt: { $ne: null, $lte: now },
        })
          .select("_id")
          .limit(500)
          .lean(),
      ]);
      if (dueDms.length === 0 && dueCommunity.length === 0) return;

      logger.info("Scheduled message publisher: delivering due messages", {
        dms: dueDms.length,
        community: dueCommunity.length,
      });

      await Promise.all([
        ...dueDms.map((m) =>
          deliverScheduledMessage("dm", m._id.toString()),
        ),
        ...dueCommunity.map((m) =>
          deliverScheduledMessage("community", m._id.toString()),
        ),
      ]);

      logger.info("Scheduled message publisher: batch complete", {
        processed: dueDms.length + dueCommunity.length,
      });
    } catch (err: any) {
      logger.error("Scheduled message publisher: error", {
        error: err.message,
      });
    }
  });

  logger.info("Scheduled message publisher registered (runs every minute)");
}

export function startScheduledPostPublisher(): void {
  // SAFETY NET (1-min poll). When BullMQ is configured, posts are published
  // at their exact scheduledAt via delayed jobs and this poll finds nothing
  // due; when it's not (no REDIS_URL), this remains the ONLY publisher —
  // it catches anything a BullMQ job could have missed (restart, Redis
  // blip, job lost). Idempotent with publishScheduledPost, so both paths
  // can run at once without double-publishing.
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();

      const duePosts = await Post.find({
        status: "scheduled",
        scheduledAt: { $lte: now },
      })
        .select("_id")
        .limit(500)
        .lean();

      if (duePosts.length === 0) return;

      logger.info("Scheduled post publisher: publishing due posts", {
        count: duePosts.length,
      });

      await Promise.all(duePosts.map((p) => publishScheduledPost(p._id.toString())));

      logger.info("Scheduled post publisher: batch complete", {
        processed: duePosts.length,
      });
    } catch (err: any) {
      logger.error("Scheduled post publisher: error", { error: err.message });
    }
  });

  logger.info("Scheduled post publisher registered (runs every minute)");
}

/**
 * Dispatch for the BullMQ maintenance worker (see configs/queue.ts). The
 * repeatable jobs carry `{ task }` in their data; this maps the task name to
 * the same functions the node-cron fallback runs, so both paths behave
 * identically.
 */
export async function runMaintenanceTask(task: string): Promise<void> {
  switch (task) {
    case "affinity-recompute":
      return runAffinityRecompute();
    case "notification-pruner":
      return runNotificationPruner();
    case "daily-mission-reset":
      return runDailyMissionReset();
    case "streak-break-checker":
      return runStreakBreakChecker();
    case "external-sync": {
      // Pull fresh public content from Bluesky/Mastodon/Lemmy
      // (registered as a repeatable job by startExternalSync).
      const { runExternalSyncCycle } = await import(
        "../services/externalSync"
      );
      await runExternalSyncCycle();
      return;
    }
    default:
      logger.warn("Unknown maintenance task", { task });
  }
}

