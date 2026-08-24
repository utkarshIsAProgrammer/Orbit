/**
 * BullMQ queue module — graceful fallback behavior.
 *
 * The queue must NEVER break the app when REDIS_URL is not configured:
 * enqueue helpers return false (callers fall back to cron/direct send)
 * and startQueueWorkers() is a no-op.
 */
import {
  enqueueScheduledPostPublish,
  enqueueEmail,
  enqueueNotificationCreate,
  enqueueNotificationDelete,
  enqueueAccountDeletion,
  enqueueWebhookDelivery,
  enqueuePushNotification,
  registerMaintenanceJob,
  enqueueGamification,
  enqueueMediaCleanup,
  enqueueChatForward,
  startQueueWorkers,
} from "../configs/queue";

describe("BullMQ queue fallback (no REDIS_URL)", () => {
  it("enqueueScheduledPostPublish returns false (caller keeps cron fallback)", async () => {
    const result = await enqueueScheduledPostPublish(
      new (require("mongoose").Types.ObjectId)().toString(),
      new Date(Date.now() + 60_000),
    );
    expect(result).toBe(false);
  });

  it("enqueueEmail returns false (caller sends directly)", async () => {
    const result = await enqueueEmail({
      to: "test@example.com",
      subject: "test",
      html: "<p>hi</p>",
    });
    expect(result).toBe(false);
  });

  it("enqueueNotificationCreate returns false (caller runs inline)", async () => {
    const result = await enqueueNotificationCreate({
      recipient: new (require("mongoose").Types.ObjectId)().toString(),
      sender: new (require("mongoose").Types.ObjectId)().toString(),
      type: "like",
    });
    expect(result).toBe(false);
  });

  it("enqueueNotificationDelete returns false (caller runs inline)", async () => {
    const result = await enqueueNotificationDelete({
      recipient: new (require("mongoose").Types.ObjectId)().toString(),
      sender: new (require("mongoose").Types.ObjectId)().toString(),
      type: "like",
    });
    expect(result).toBe(false);
  });

  it("enqueueAccountDeletion returns false (caller purges inline)", async () => {
    const result = await enqueueAccountDeletion(
      new (require("mongoose").Types.ObjectId)().toString(),
    );
    expect(result).toBe(false);
  });

  it("enqueueWebhookDelivery returns false (caller delivers inline)", async () => {
    const result = await enqueueWebhookDelivery(
      "post.liked",
      { postId: "abc" },
      new (require("mongoose").Types.ObjectId)().toString(),
    );
    expect(result).toBe(false);
  });

  it("enqueuePushNotification returns false (caller sends inline)", async () => {
    const result = await enqueuePushNotification(
      new (require("mongoose").Types.ObjectId)().toString(),
      { title: "test", body: "hi", tag: "t" },
    );
    expect(result).toBe(false);
  });

  it("registerMaintenanceJob returns false (caller keeps node-cron)", async () => {
    const result = await registerMaintenanceJob(
      "affinity-recompute",
      "*/30 * * * *",
    );
    expect(result).toBe(false);
  });

  it("enqueueGamification returns false (caller runs inline)", async () => {
    const result = await enqueueGamification("award_xp", {
      userId: new (require("mongoose").Types.ObjectId)().toString(),
      action: "LIKE",
    });
    expect(result).toBe(false);
  });

  it("enqueueMediaCleanup returns false (caller destroys inline)", async () => {
    const result = await enqueueMediaCleanup(["orbit/sample-public-id"]);
    expect(result).toBe(false);
  });

  it("enqueueChatForward returns false (caller delivers inline)", async () => {
    const result = await enqueueChatForward({
      senderId: new (require("mongoose").Types.ObjectId)().toString(),
      recipientId: new (require("mongoose").Types.ObjectId)().toString(),
      text: "Shared a post",
    });
    expect(result).toBe(false);
  });

  it("startQueueWorkers does not throw when Redis is unconfigured", () => {
    expect(() => startQueueWorkers()).not.toThrow();
  });
});
