/**
 * queue.ts — BullMQ background jobs.
 *
 * Ten queues on a TCP Redis connection (BullMQ is incompatible with
 * Upstash's REST-only endpoint, so a dedicated `REDIS_URL` is required):
 *
 * NOTE: BullMQ forbids `:` in queue names (QueueBase throws), so the
 * namespacing prefix is a dash, not a colon.
 *
 *   1. `orbit-scheduled-posts` — publish a scheduled post at its exact
 *      scheduledAt time via a delayed job, instead of the 1-minute cron
 *      poll (which publishes up to 60s late and re-scans the whole table).
 *   2. `orbit-emails` — transactional email delivery with retries, so a
 *      slow/failing mail API never blocks the request that triggered it.
 *   3. `orbit-notifications` — notification create/delete fan-out (DB +
 *      socket + push) off the like/comment/follow request paths.
 *   4. `orbit-account-deletion` — the full account-data purge runs on a
 *      worker so the delete-account endpoint responds instantly.
 *   5. `orbit-webhooks` — outbound webhook HTTP delivery off the request
 *      path (each delivery can take up to 10s against a slow endpoint).
 *   6. `orbit-push` — on-device web-push delivery off the request path.
 *   7. `orbit-scheduled-maintenance` — repeatable maintenance jobs
 *      (affinity recompute, notification pruner, mission reset, streak
 *      breaker). Kept in Redis so cluster workers never double-run them.
 *   8. `orbit-gamification` — XP awards, daily-mission progress and badge
 *      checks (multi-query DB work fired from ~25 like/comment/post/etc.
 *      request paths).
 *   9. `orbit-media-cleanup` — Cloudinary destroys for deleted
 *      messages/posts/communities/glimpses (external HTTP per file).
 *   10. `orbit-chat-forward` — forwarded posts/profiles/comments/
 *      collections/glimpses land as chat messages on a worker (the message
 *      is still delivered to both sides over the socket).
 *
 * GRACEFUL FALLBACK: when `REDIS_URL` is empty (dev, or Render without the
 * Redis add-on), enqueue helpers return `false` and callers fall back to
 * their previous behavior (cron polling / direct send). The app NEVER
 * depends on BullMQ being configured.
 */

import { Queue, Worker } from "bullmq";
import { env } from "./env";
import { logger } from "../utilities/logger";

export enum QueueName {
  SCHEDULED_POSTS = "orbit-scheduled-posts",
  SCHEDULED_MESSAGES = "orbit-scheduled-messages",
  EMAILS = "orbit-emails",
  NOTIFICATIONS = "orbit-notifications",
  ACCOUNT_DELETION = "orbit-account-deletion",
  WEBHOOKS = "orbit-webhooks",
  PUSH = "orbit-push",
  MAINTENANCE = "orbit-scheduled-maintenance",
  GAMIFICATION = "orbit-gamification",
  MEDIA_CLEANUP = "orbit-media-cleanup",
  CHAT_FORWARD = "orbit-chat-forward",
}

// Trim aggressively — pasted env vars often carry trailing newlines/quotes.
// A malformed URL must disable the queues (graceful fallback), not crash.
const REDIS_URL = (env.REDIS_URL || "").trim().replace(/^"|"$/g, "");

// Must be a real redis:// or rediss:// URL AND ENABLE_BULLMQ=true,
// or the queues stay disabled. When disabled, all enqueue helpers
// return false and callers fall back to node-cron / inline execution —
// saving ~50K+ Redis commands/day from BullMQ's idle BRPOPLPUSH polling.
const isAvailable = (): boolean =>
  env.ENABLE_BULLMQ === "true" && Boolean(REDIS_URL) && /^rediss?:\/\//i.test(REDIS_URL);

// BullMQ's ConnectionOptions accepts { url, maxRetriesPerRequest }. Only
// constructed when REDIS_URL is set (guarded by isAvailable() everywhere),
// so the non-null assertion is safe.
const connection = (isAvailable()
  ? { url: REDIS_URL, maxRetriesPerRequest: null }
  : undefined) as any;

// ── Lazy queue singletons ────────────────────────────────────────────────

let scheduledPostsQueue: Queue | null = null;
let scheduledMessagesQueue: Queue | null = null;
let emailsQueue: Queue | null = null;
let notificationsQueue: Queue | null = null;
let accountDeletionQueue: Queue | null = null;
let webhooksQueue: Queue | null = null;
let pushQueue: Queue | null = null;
let maintenanceQueue: Queue | null = null;
let gamificationQueue: Queue | null = null;
let mediaCleanupQueue: Queue | null = null;
let chatForwardQueue: Queue | null = null;

const getScheduledPostsQueue = (): Queue | null => {
  if (!isAvailable()) return null;
  if (!scheduledPostsQueue) {
    scheduledPostsQueue = new Queue(QueueName.SCHEDULED_POSTS, {
      connection,
    });
  }
  return scheduledPostsQueue;
};

const getScheduledMessagesQueue = (): Queue | null => {
  if (!isAvailable()) return null;
  if (!scheduledMessagesQueue) {
    scheduledMessagesQueue = new Queue(QueueName.SCHEDULED_MESSAGES, {
      connection,
    });
  }
  return scheduledMessagesQueue;
};

const getEmailsQueue = (): Queue | null => {
  if (!isAvailable()) return null;
  if (!emailsQueue) {
    emailsQueue = new Queue(QueueName.EMAILS, { connection });
  }
  return emailsQueue;
};

const getNotificationsQueue = (): Queue | null => {
  if (!isAvailable()) return null;
  if (!notificationsQueue) {
    notificationsQueue = new Queue(QueueName.NOTIFICATIONS, {
      connection,
    });
  }
  return notificationsQueue;
};

const getAccountDeletionQueue = (): Queue | null => {
  if (!isAvailable()) return null;
  if (!accountDeletionQueue) {
    accountDeletionQueue = new Queue(QueueName.ACCOUNT_DELETION, {
      connection,
    });
  }
  return accountDeletionQueue;
};

const getWebhooksQueue = (): Queue | null => {
  if (!isAvailable()) return null;
  if (!webhooksQueue) {
    webhooksQueue = new Queue(QueueName.WEBHOOKS, { connection });
  }
  return webhooksQueue;
};

const getPushQueue = (): Queue | null => {
  if (!isAvailable()) return null;
  if (!pushQueue) {
    pushQueue = new Queue(QueueName.PUSH, { connection });
  }
  return pushQueue;
};

const getMaintenanceQueue = (): Queue | null => {
  if (!isAvailable()) return null;
  if (!maintenanceQueue) {
    maintenanceQueue = new Queue(QueueName.MAINTENANCE, { connection });
  }
  return maintenanceQueue;
};

const getGamificationQueue = (): Queue | null => {
  if (!isAvailable()) return null;
  if (!gamificationQueue) {
    gamificationQueue = new Queue(QueueName.GAMIFICATION, { connection });
  }
  return gamificationQueue;
};

const getMediaCleanupQueue = (): Queue | null => {
  if (!isAvailable()) return null;
  if (!mediaCleanupQueue) {
    mediaCleanupQueue = new Queue(QueueName.MEDIA_CLEANUP, { connection });
  }
  return mediaCleanupQueue;
};

const getChatForwardQueue = (): Queue | null => {
  if (!isAvailable()) return null;
  if (!chatForwardQueue) {
    chatForwardQueue = new Queue(QueueName.CHAT_FORWARD, { connection });
  }
  return chatForwardQueue;
};

// ── Enqueue helpers ──────────────────────────────────────────────────────

/**
 * Schedule a post to be published at its exact scheduledAt time.
 * Returns true if the delayed job was enqueued, false if BullMQ is not
 * configured (caller keeps the cron poll as fallback).
 */
export async function enqueueScheduledPostPublish(
  postId: string,
  scheduledAt: Date,
): Promise<boolean> {
  try {
    const q = getScheduledPostsQueue();
    if (!q) return false;
    const delayMs = Math.max(0, scheduledAt.getTime() - Date.now());
    await q.add(
      "publish",
      { postId },
      {
        delay: delayMs,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
    return true;
  } catch (err: any) {
    logger.error("BullMQ: failed to enqueue scheduled post", {
      postId,
      error: err.message,
    });
    return false;
  }
}

/**
 * Schedule a DM or community message to be DELIVERED at its exact
 * scheduledAt time (WhatsApp/IG-style scheduled send). The message row
 * already exists in Mongo with scheduledAt set; this job only triggers the
 * delivery (clear scheduledAt + emit). Returns true if the delayed job was
 * enqueued, false if BullMQ is not configured — the caller then relies on
 * the 1-min cron safety net in scheduler.ts (startScheduledMessagePublisher).
 */
export async function enqueueScheduledMessageDelivery(
  kind: "dm" | "community",
  messageId: string,
  scheduledAt: Date,
): Promise<boolean> {
  try {
    const q = getScheduledMessagesQueue();
    if (!q) return false;
    const delayMs = Math.max(0, scheduledAt.getTime() - Date.now());
    await q.add(
      "deliver",
      { kind, messageId },
      {
        delay: delayMs,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
    return true;
  } catch (err: any) {
    logger.error("BullMQ: failed to enqueue scheduled message delivery", {
      kind,
      messageId,
      error: err.message,
    });
    return false;
  }
}

/**
 * Queue a transactional email for delivery (retried on failure).
 * Returns true if queued, false if BullMQ is not configured (caller
 * falls back to sending directly).
 */
export async function enqueueEmail(
  payload: { to: string; subject: string; text?: string; html: string },
): Promise<boolean> {
  try {
    const q = getEmailsQueue();
    if (!q) return false;
    await q.add(
      "send",
      payload,
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
    return true;
  } catch (err: any) {
    logger.error("BullMQ: failed to enqueue email", {
      to: payload.to,
      error: err.message,
    });
    return false;
  }
}

// ── Notification fan-out ────────────────────────────────────────────────

/**
 * Queue a notification CREATE. `createNotification` does ~5 DB round-trips
 * (block check, preference check, insert, cache eviction, populate) plus a
 * socket emit + device push — all awaited in like/comment/follow/mention
 * request paths, adding hundreds of ms to those endpoints. When BullMQ is
 * configured, the fan-out runs on a worker and the endpoint responds
 * instantly. Returns true if queued, false otherwise (caller runs inline).
 */
export async function enqueueNotificationCreate(
  params: Record<string, unknown>,
): Promise<boolean> {
  try {
    const q = getNotificationsQueue();
    if (!q) return false;
    await q.add(
      "create",
      { kind: "create", params },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
    return true;
  } catch (err: any) {
    logger.error("BullMQ: failed to enqueue notification create", {
      error: err.message,
    });
    return false;
  }
}

/** Same for notification DELETE (unlike/unfollow/comment-delete paths). */
export async function enqueueNotificationDelete(
  params: Record<string, unknown>,
): Promise<boolean> {
  try {
    const q = getNotificationsQueue();
    if (!q) return false;
    await q.add(
      "delete",
      { kind: "delete", params },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
    return true;
  } catch (err: any) {
    logger.error("BullMQ: failed to enqueue notification delete", {
      error: err.message,
    });
    return false;
  }
}

/**
 * Queue a COMMUNITY message notification fan-out as ONE job. Sending a
 * message in a big community used to loop every other member inline — each
 * iteration did a preference check, a Notification insert, cache eviction,
 * a populate, a socket emit AND a device push. That entire loop now runs on
 * the notification worker: the send endpoint returns as soon as the job is
 * queued. Returns true if queued, false otherwise (caller runs inline).
 */
export async function enqueueCommunityMessageNotifications(
  params: Record<string, unknown>,
): Promise<boolean> {
  try {
    const q = getNotificationsQueue();
    if (!q) return false;
    await q.add(
      "community-fanout",
      { kind: "community-fanout", params },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: { age: 24 * 3600, count: 500 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
    return true;
  } catch (err: any) {
    logger.error("BullMQ: failed to enqueue community message fan-out", {
      error: err.message,
    });
    return false;
  }
}

/**
 * Queue the full account-data purge (Cloudinary destroys + all content
 * collection wipes). The delete-account endpoint responds instantly and
 * the worker does the heavy cleanup in the background. Returns true if
 * queued, false otherwise (caller runs inline).
 */
export async function enqueueAccountDeletion(
  userId: string,
): Promise<boolean> {
  try {
    const q = getAccountDeletionQueue();
    if (!q) return false;
    await q.add(
      "purge",
      { userId },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
    return true;
  } catch (err: any) {
    logger.error("BullMQ: failed to enqueue account deletion", {
      userId,
      error: err.message,
    });
    return false;
  }
}

// ── Webhook delivery ────────────────────────────────────────────────────

/**
 * Queue a webhook event delivery. The worker looks up the owner's active
 * webhooks and POSTs each one (SSRF-guarded, bounded by a 10s timeout) —
 * external HTTP that used to run inline, fire-and-forget, on the
 * like/comment/post/follow request paths. Returns true if queued, false
 * otherwise (caller runs the delivery inline).
 */
export async function enqueueWebhookDelivery(
  event: string,
  data: Record<string, unknown>,
  ownerUserId: string,
): Promise<boolean> {
  try {
    const q = getWebhooksQueue();
    if (!q) return false;
    await q.add(
      "deliver",
      { event, data, ownerUserId },
      {
        attempts: 2,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
    return true;
  } catch (err: any) {
    logger.error("BullMQ: failed to enqueue webhook delivery", {
      event,
      error: err.message,
    });
    return false;
  }
}

// ── Push notifications ──────────────────────────────────────────────────

/**
 * Queue an on-device push notification. web-push does external HTTP per
 * device subscription (and cleans up stale 410/404 endpoints); moving it
 * off the chat/community/notification paths keeps those responses snappy.
 * Returns true if queued, false otherwise (caller sends inline).
 */
export async function enqueuePushNotification(
  userId: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    const q = getPushQueue();
    if (!q) return false;
    await q.add(
      "send",
      { userId, payload },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
    return true;
  } catch (err: any) {
    logger.error("BullMQ: failed to enqueue push notification", {
      userId,
      error: err.message,
    });
    return false;
  }
}

// ── Scheduled maintenance (repeatable jobs) ─────────────────────────────

/**
 * Register a repeatable maintenance job (affinity recompute, notification
 * pruner, mission reset, streak breaker). The schedule lives in Redis as a
 * BullMQ job scheduler, so in cluster mode every worker calls this with the
 * same task name and only ONE schedule exists — no double-running. Returns
 * true when registered (caller skips its node-cron fallback), false when
 * BullMQ is not configured or the upsert failed (caller keeps node-cron).
 */
export async function registerMaintenanceJob(
  task: string,
  cronPattern: string,
): Promise<boolean> {
  try {
    const q = getMaintenanceQueue();
    if (!q) return false;
    await q.upsertJobScheduler(
      task,
      { pattern: cronPattern },
      { name: "maintenance", data: { task } },
    );
    logger.info("BullMQ: maintenance job registered", { task, cronPattern });
    return true;
  } catch (err: any) {
    logger.error("BullMQ: failed to register maintenance job", {
      task,
      error: err.message,
    });
    return false;
  }
}

// ── Gamification fan-out ────────────────────────────────────────────────

/**
 * Queue one gamification task (XP award, mission progress, badge check,
 * all-rounder check). These do 3-6 DB queries each and are fired from ~25
 * request paths (like, comment, post, follow, save, share, chat, …) —
 * offloaded so a viral burst can't pile work onto the request event loop.
 * Returns true if queued, false otherwise (caller runs inline).
 */
export async function enqueueGamification(
  action: string,
  params: Record<string, unknown>,
): Promise<boolean> {
  try {
    const q = getGamificationQueue();
    if (!q) return false;
    await q.add(
      action,
      { action, params },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
    return true;
  } catch (err: any) {
    logger.error("BullMQ: failed to enqueue gamification task", {
      action,
      error: err.message,
    });
    return false;
  }
}

// ── Media cleanup ───────────────────────────────────────────────────────

/**
 * Queue Cloudinary destroys for deleted content (message/post/community
 * message/glimpse attachments). Each destroy is an external HTTP call;
 * offloaded off the delete request paths and retried on failure. Returns
 * true if queued, false otherwise (caller destroys inline).
 */
export async function enqueueMediaCleanup(
  publicIds: string[],
  resourceType?: "image" | "video",
): Promise<boolean> {
  try {
    const ids = (publicIds || []).filter(Boolean);
    if (ids.length === 0) return true; // nothing to do — treat as success
    const q = getMediaCleanupQueue();
    if (!q) return false;
    await q.add(
      "destroy",
      { publicIds: ids, resourceType: resourceType || "image" },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
    return true;
  } catch (err: any) {
    logger.error("BullMQ: failed to enqueue media cleanup", {
      error: err.message,
    });
    return false;
  }
}

// ── Chat forwarding ─────────────────────────────────────────────────────

/**
 * Queue a forwarded item (post / profile / comment / collection / glimpse)
 * for delivery as a real chat message. The worker creates/updates the 1:1
 * conversation, bumps unread counts and emits the same socket events as a
 * normal message — the recipient's UI updates in real time without the
 * forward request waiting on the DB + socket work. Returns true if queued,
 * false otherwise (caller delivers inline).
 */
export async function enqueueChatForward(opts: {
  senderId: string;
  recipientId: string;
  text: string;
  attachment?: { url: string; type: "image" | "video" | "file" };
}): Promise<boolean> {
  try {
    const q = getChatForwardQueue();
    if (!q) return false;
    await q.add(
      "forward",
      opts,
      {
        attempts: 2,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
    return true;
  } catch (err: any) {
    logger.error("BullMQ: failed to enqueue chat forward", {
      error: err.message,
    });
    return false;
  }
}

// ── Workers ──────────────────────────────────────────────────────────────

let workersStarted = false;
// Every worker constructed by startQueueWorkers — tracked so closeQueues()
// can shut them down gracefully. A Queue.close() does NOT stop its Worker:
// an unclosed Worker keeps its own Redis connection polling for jobs, and
// process.exit() then kills that socket mid-command — the `write EPIPE` /
// "Connection is closed" noise in the shutdown logs.
const workers: Worker[] = [];

/**
 * Start BullMQ workers. Called once at server boot. Never throws: if any
 * worker fails to construct (e.g. Redis unreachable, queue-name error),
 * the failure is logged and the boot continues — a queue problem must
 * never prevent `server.listen()` from running (that produced a live
 * process with no open port + a Render restart loop).
 */
export function startQueueWorkers(): void {
  if (!isAvailable()) {
    logger.info(
      "[BullMQ] Background queues disabled (ENABLE_BULLMQ=false or REDIS_URL missing). " +
        "Scheduled tasks use node-cron; emails/notifications/gamification run inline.",
    );
    return;
  }
  if (workersStarted) return;
  workersStarted = true;

  try {
    // ── Scheduled-post publisher worker ──
    const postWorker = new Worker(
    QueueName.SCHEDULED_POSTS,
    async (job) => {
      const { postId } = job.data as { postId: string };
      const { publishScheduledPost } = await import(
        "../configs/scheduler"
      );
      await publishScheduledPost(postId);
    },
    { connection, concurrency: 5 },
  );

  postWorker.on("failed", (job, err) => {
    logger.error("BullMQ: scheduled-post job failed", {
      jobId: job?.id,
      error: err.message,
    });
  });

  // ── Scheduled-message delivery worker ──
  // Delivers a DM or community message that was stored with a future
  // scheduledAt: clears the flag + emits, so it appears exactly on time.
  const scheduledMessageWorker = new Worker(
    QueueName.SCHEDULED_MESSAGES,
    async (job) => {
      const { kind, messageId } = job.data as {
        kind: "dm" | "community";
        messageId: string;
      };
      const { deliverScheduledMessage } = await import(
        "../configs/scheduler"
      );
      await deliverScheduledMessage(kind, messageId);
    },
    { connection, concurrency: 5 },
  );

  scheduledMessageWorker.on("failed", (job, err) => {
    logger.error("BullMQ: scheduled-message job failed", {
      jobId: job?.id,
      error: err.message,
    });
  });

  // ── Email worker ──
  const emailWorker = new Worker(
    QueueName.EMAILS,
    async (job) => {
      const { sendQueuedEmail } = await import("./nodeMailer");
      await sendQueuedEmail(job.data as {
        to: string;
        subject: string;
        text?: string;
        html: string;
      });
    },
    { connection, concurrency: 5 },
  );

  emailWorker.on("failed", (job, err) => {
    logger.error("BullMQ: email job failed", {
      jobId: job?.id,
      error: err.message,
    });
  });

  // ── Notification fan-out worker ──
  // createNotification/deleteInteractionNotification are called from ~18
  // request paths (like, comment, follow, mention, chat, glimpse…). Moving
  // the DB + socket + push work off those endpoints makes them respond in
  // ms. The worker lazily imports the utilities to avoid circular imports.
  const notificationWorker = new Worker(
    QueueName.NOTIFICATIONS,
    async (job) => {
      const { kind, params } = job.data as {
        kind: "create" | "delete" | "community-fanout";
        params: Record<string, unknown>;
      };
      if (kind === "create") {
        const { createNotificationDirect } = await import(
          "../utilities/notification"
        );
        await createNotificationDirect(params as any);
      } else if (kind === "delete") {
        const { deleteInteractionNotificationDirect } = await import(
          "../utilities/notification"
        );
        await deleteInteractionNotificationDirect(params as any);
      } else {
        // Community message fan-out — one job carries the whole member loop
        // (preference check, insert, cache eviction, emit, push).
        const { fanoutCommunityMessageNotificationsInline } = await import(
          "../controllers/community.controllers"
        );
        await fanoutCommunityMessageNotificationsInline(params as any);
      }
    },
    { connection, concurrency: 10 },
  );

  notificationWorker.on("failed", (job, err) => {
    logger.error("BullMQ: notification job failed", {
      jobId: job?.id,
      error: err.message,
    });
  });

  // ── Account-deletion worker ──
  // deleteUserAndData does Cloudinary destroys + ~15 collection wipes,
  // seconds of work that used to block the delete-account response.
  const accountWorker = new Worker(
    QueueName.ACCOUNT_DELETION,
    async (job) => {
      const { userId } = job.data as { userId: string };
      const { User } = await import("../models/user.model");
      const { deleteUserAndData } = await import(
        "../controllers/user.controllers"
      );
      const user = await User.findById(userId);
      if (!user) return; // already gone — nothing to purge
      await deleteUserAndData(user);
    },
    { connection, concurrency: 2 },
  );

  accountWorker.on("failed", (job, err) => {
    logger.error("BullMQ: account-deletion job failed", {
      jobId: job?.id,
      error: err.message,
    });
  });

  // ── Webhook delivery worker ──
  // deliverWebhookEvent POSTs to every active webhook of the owner — each
  // delivery is SSRF-checked and bounded by a 10s timeout, so a slow
  // endpoint used to occupy the event loop for seconds on like/comment
  // paths. Now it runs here; the inline path remains as fallback.
  const webhookWorker = new Worker(
    QueueName.WEBHOOKS,
    async (job) => {
      const { deliverWebhookEventInline } = await import(
        "../controllers/webhook.controller"
      );
      await deliverWebhookEventInline(
        job.data.event as string,
        job.data.data as Record<string, unknown>,
        job.data.ownerUserId as string,
      );
    },
    { connection, concurrency: 5 },
  );

  webhookWorker.on("failed", (job, err) => {
    logger.error("BullMQ: webhook delivery job failed", {
      jobId: job?.id,
      error: err.message,
    });
  });

  // ── Push notification worker ──
  // web-push performs one external HTTP call per device subscription (with
  // stale-endpoint cleanup) — offloaded from chat/community message paths.
  const pushWorker = new Worker(
    QueueName.PUSH,
    async (job) => {
      const { sendPushToUserInline } = await import("../services/pushService");
      await sendPushToUserInline(
        job.data.userId as string,
        job.data.payload as any,
      );
    },
    { connection, concurrency: 5 },
  );

  pushWorker.on("failed", (job, err) => {
    logger.error("BullMQ: push job failed", {
      jobId: job?.id,
      error: err.message,
    });
  });

  // ── Maintenance worker ──
  // Processes the repeatable maintenance jobs (affinity recompute,
  // notification pruner, mission reset, streak breaker). Concurrency 1:
  // each task is a bounded DB batch pass and runs are short.
  const maintenanceWorker = new Worker(
    QueueName.MAINTENANCE,
    async (job) => {
      const { runMaintenanceTask } = await import("../configs/scheduler");
      await runMaintenanceTask(job.data.task as string);
    },
    { connection, concurrency: 1 },
  );

  maintenanceWorker.on("failed", (job, err) => {
    logger.error("BullMQ: maintenance job failed", {
      jobId: job?.id,
      task: job?.data?.task,
      error: err.message,
    });
  });

  // ── Gamification worker ──
  // Dispatches XP awards, mission progress and badge checks to the same
  // inline implementations the callers used before (see xpService,
  // dailyMissionService, badgeService).
  const gamificationWorker = new Worker(
    QueueName.GAMIFICATION,
    async (job) => {
      const { action, params } = job.data as {
        action: string;
        params: Record<string, unknown>;
      };
      switch (action) {
        case "award_xp": {
          const { awardXPInline } = await import("../services/xpService");
          await awardXPInline(
            params.userId as string,
            params.action as any,
            params.metadata as Record<string, any> | undefined,
            params.amountOverride as number | undefined,
          );
          return;
        }
        case "progress_mission": {
          const { progressMissionInline } = await import(
            "../services/dailyMissionService"
          );
          await progressMissionInline(
            params.userId as string,
            params.type as string,
            (params.amount as number) ?? 1,
          );
          return;
        }
        case "check_badge": {
          const { checkBadgesAndNotifyInline } = await import(
            "../services/badgeService"
          );
          await checkBadgesAndNotifyInline(
            params.userId as string,
            params.trigger as any,
          );
          return;
        }
        case "check_all_rounder": {
          const { checkAllRounderBadgeInline } = await import(
            "../services/badgeService"
          );
          await checkAllRounderBadgeInline(params.userId as string);
          return;
        }
        case "log_interaction": {
          const { logInteractionInline } = await import(
            "../services/affinityService"
          );
          await logInteractionInline(
            params.userId as string,
            params.targetAuthorId as string,
            (params.postId as string) || null,
            params.type as string,
            (params.hashtags as string[]) || [],
          );
          return;
        }
        default:
          logger.warn("Unknown gamification action", { action });
      }
    },
    { connection, concurrency: 5 },
  );

  gamificationWorker.on("failed", (job, err) => {
    logger.error("BullMQ: gamification job failed", {
      jobId: job?.id,
      action: job?.data?.action,
      error: err.message,
    });
  });

  // ── Media-cleanup worker ──
  const mediaWorker = new Worker(
    QueueName.MEDIA_CLEANUP,
    async (job) => {
      const { cleanupMediaInline } = await import(
        "../services/mediaCleanupService"
      );
      await cleanupMediaInline(
        job.data.publicIds as string[],
        (job.data.resourceType as "image" | "video") || "image",
      );
    },
    { connection, concurrency: 5 },
  );

  mediaWorker.on("failed", (job, err) => {
    logger.error("BullMQ: media-cleanup job failed", {
      jobId: job?.id,
      error: err.message,
    });
  });

  // ── Chat-forward worker ──
  // Forwarded posts/profiles/comments/collections/glimpses become real chat
  // messages here. The socket emits (message:new + chat:notification) still
  // reach both sides, so the sender's/recipient's UIs update in real time
  // without the forward request awaiting the DB + socket work.
  const chatForwardWorker = new Worker(
    QueueName.CHAT_FORWARD,
    async (job) => {
      const { deliverForwardToChatInline } = await import(
        "../services/chatForwardService"
      );
      await deliverForwardToChatInline(job.data as any);
    },
    { connection, concurrency: 5 },
  );

  chatForwardWorker.on("failed", (job, err) => {
    logger.error("BullMQ: chat-forward job failed", {
      jobId: job?.id,
      error: err.message,
    });
  });

  workers.push(
    postWorker,
    emailWorker,
    notificationWorker,
    accountWorker,
    webhookWorker,
    pushWorker,
    maintenanceWorker,
    gamificationWorker,
    mediaWorker,
    chatForwardWorker,
  );

  logger.info(
    "[BullMQ] Workers started (scheduled-posts, emails, notifications, account-deletion, webhooks, push, maintenance, gamification, media-cleanup, chat-forward)",
  );
  } catch (err: any) {
    // Never crash the boot over a background queue: the enqueue helpers
    // already fall back to inline execution when a queue is unavailable.
    workersStarted = false; // allow a retry on a later restart
    logger.error(
      "[BullMQ] Failed to start workers — background queues disabled for this boot. " +
        "Callers fall back to inline execution.",
      { error: err?.message, stack: err?.stack },
    );
  }
}

/** Close all workers + queues (graceful shutdown). */
export async function closeQueues(): Promise<void> {
  const jobs: Promise<void>[] = [];
  // Workers first: close() stops the polling loop and waits for in-flight
  // jobs, so their Redis connections close cleanly (no EPIPE on exit).
  for (const w of workers) jobs.push(w.close());
  workers.length = 0;
  // Then the queue connections themselves.
  if (scheduledPostsQueue) jobs.push(scheduledPostsQueue.close());
  if (scheduledMessagesQueue) jobs.push(scheduledMessagesQueue.close());
  if (emailsQueue) jobs.push(emailsQueue.close());
  if (notificationsQueue) jobs.push(notificationsQueue.close());
  if (accountDeletionQueue) jobs.push(accountDeletionQueue.close());
  if (webhooksQueue) jobs.push(webhooksQueue.close());
  if (pushQueue) jobs.push(pushQueue.close());
  if (maintenanceQueue) jobs.push(maintenanceQueue.close());
  if (gamificationQueue) jobs.push(gamificationQueue.close());
  if (mediaCleanupQueue) jobs.push(mediaCleanupQueue.close());
  if (chatForwardQueue) jobs.push(chatForwardQueue.close());
  await Promise.allSettled(jobs);
}
