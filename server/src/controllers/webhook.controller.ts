import type { Request, Response } from "express";
import mongoose from "mongoose";
import crypto from "crypto";
import { Webhook } from "../models/webhook.model";
import { AppError, BadRequestError, NotFoundError, UnauthorizedError } from "../utilities/errors";
import { logger } from "../utilities/logger";
import { assertSafeOutboundUrl } from "../utilities/ssrfGuard";

/**
 * POST /api/webhooks — Register a new webhook.
 */
export const createWebhook = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id;
  const url = typeof req.body.url === "string" ? req.body.url : "";
  const events = req.body.events as string[] | undefined;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");
    if (!url || !url.trim()) throw new BadRequestError("URL is required!");

    // SSRF guard: webhook URLs must be public https endpoints. Resolves the
    // host and rejects private/loopback/link-local ranges (incl. cloud
    // metadata 169.254.169.254). Re-checked again before every delivery.
    const safe = await assertSafeOutboundUrl(url.trim());
    if (!safe.ok) {
      throw new BadRequestError(`Unsafe webhook URL: ${safe.reason}`);
    }

    if (!events || !Array.isArray(events) || events.length === 0) {
      throw new BadRequestError("At least one event is required!");
    }

    const validEvents = ["post.created", "post.liked", "post.commented", "user.followed", "comment.created"];
    const invalidEvents = events.filter((e: string) => !validEvents.includes(e));
    if (invalidEvents.length > 0) {
      throw new BadRequestError(`Invalid events: ${invalidEvents.join(", ")}`);
    }

    const webhook = new Webhook({
      user: currentUserId,
      url: url.trim(),
      events,
    });

    await webhook.save();

    return res.status(201).json({
      success: true,
      message: "Webhook created! Save the secret — it won't be shown again.",
      webhook: {
        _id: webhook._id,
        url: webhook.url,
        events: webhook.events,
        secret: webhook.secret,
        isActive: webhook.isActive,
      },
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in createWebhook", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * GET /api/webhooks — List webhooks for the current user.
 */
export const getWebhooks = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");

    const webhooks = await Webhook.find({ user: currentUserId })
      .select("-secret")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, webhooks });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in getWebhooks", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * DELETE /api/webhooks/:webhookId — Delete a webhook.
 */
export const deleteWebhook = async (req: Request, res: Response) => {
  const webhookId = req.params.webhookId as string;
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");
    if (!mongoose.Types.ObjectId.isValid(webhookId)) throw new BadRequestError("Invalid webhook ID!");

    const webhook = await Webhook.findOneAndDelete({ _id: webhookId, user: currentUserId });
    if (!webhook) throw new NotFoundError("Webhook not found!");

    return res.status(200).json({ success: true, message: "Webhook deleted!" });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in deleteWebhook", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * POST /api/webhooks/:webhookId/test — Send a test payload.
 */
export const testWebhook = async (req: Request, res: Response) => {
  const { webhookId } = req.params;
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");

    const webhook = await Webhook.findOne({ _id: webhookId, user: currentUserId });
    if (!webhook) throw new NotFoundError("Webhook not found!");

    const payload = {
      event: "test",
      timestamp: new Date().toISOString(),
      data: { message: "This is a test webhook payload from ORBIT" },
    };

    const signature = crypto
      .createHmac("sha256", webhook.secret)
      .update(JSON.stringify(payload))
      .digest("hex");

    // Re-validate at delivery time too (defends against DNS rebinding — the
    // host may resolve to a public IP now but a private one later).
    const safe = await assertSafeOutboundUrl(webhook.url);
    if (!safe.ok) {
      throw new BadRequestError(`Webhook URL is no longer safe: ${safe.reason}`);
    }

    // Fire-and-forget: send the test payload. redirect: "manual" stops the
    // fetch from following a redirect to an internal address (SSRF — the URL
    // was validated, the redirect target was not). Bounded by a timeout so a
    // hanging endpoint can't wedge the request handler.
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      WEBHOOK_DELIVERY_TIMEOUT_MS,
    );
    fetch(webhook.url, {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-Event": "test",
      },
      body: JSON.stringify(payload),
    })
      .catch((err) =>
        logger.error("Test webhook delivery failed", {
          error: err?.message || String(err),
        }),
      )
      .finally(() => clearTimeout(timeout));

    return res.status(200).json({ success: true, message: "Test payload sent!" });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in testWebhook", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

// Abort delivery after this long so a slow/hung endpoint can't stall the
// event loop on the hot path.
const WEBHOOK_DELIVERY_TIMEOUT_MS = 10_000;
// Consecutive failures before a webhook is auto-deactivated.
const AUTO_DEACTIVATE_AFTER_FAILURES = 10;

/**
 * Deliver a webhook event to the OWNER of the activity, inline (used by the
 * BullMQ webhook worker and as the fallback when BullMQ isn't configured).
 *
 * SECURITY: webhooks are scoped to `user: ownerUserId` — a webhook must only
 * ever receive events about its owner's own content. The previous
 * implementation queried across ALL users, which would have leaked every
 * user's activity to every subscriber once wired up.
 */
export const deliverWebhookEventInline = async (
  event: string,
  data: any,
  ownerUserId: string,
) => {
  try {
    // events is a free string but matches the schema enum at runtime
    const webhooks = await Webhook.find({
      user: ownerUserId,
      events: event as
        | "post.created"
        | "post.liked"
        | "post.commented"
        | "user.followed"
        | "comment.created",
      isActive: true,
    }).lean();
    if (webhooks.length === 0) return;

    const payload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    const body = JSON.stringify(payload);

    for (const wh of webhooks) {
      const signature = crypto
        .createHmac("sha256", wh.secret)
        .update(body)
        .digest("hex");

      // Re-validate per delivery — a stored URL could have been DNS-rebound
      // to an internal address since it was registered.
      const safe = await assertSafeOutboundUrl(wh.url);
      if (!safe.ok) {
        logger.warn("Skipping webhook delivery — unsafe URL", {
          webhookId: String(wh._id),
          reason: safe.reason,
        });
        continue;
      }

      // Never follow redirects — the validated URL is the only allowed hop.
      // A timeout keeps a hanging endpoint from stalling the request path.
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        WEBHOOK_DELIVERY_TIMEOUT_MS,
      );
      try {
        const res = await fetch(wh.url, {
          method: "POST",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Signature": signature,
            "X-Webhook-Event": event,
          },
          body,
        });
        const failureCount = res.ok ? 0 : (wh.failureCount || 0) + 1;
        await Webhook.findByIdAndUpdate(wh._id, {
          lastTriggeredAt: new Date(),
          failureCount,
          ...(failureCount >= AUTO_DEACTIVATE_AFTER_FAILURES
            ? { isActive: false }
            : {}),
        });
      } catch (err: any) {
        // Network error or timeout
        const failureCount = (wh.failureCount || 0) + 1;
        logger.warn("Webhook delivery failed", {
          webhookId: String(wh._id),
          error: err?.message || String(err),
          failureCount,
        });
        await Webhook.findByIdAndUpdate(wh._id, {
          failureCount,
          ...(failureCount >= AUTO_DEACTIVATE_AFTER_FAILURES
            ? { isActive: false }
            : {}),
        });
      } finally {
        clearTimeout(timeout);
      }
    }
  } catch (err: any) {
    logger.error("Error delivering webhook event", { error: err.message, event });
  }
};

/**
 * Deliver a webhook event to the OWNER of the activity (called from
 * controllers after relevant actions).
 *
 * Prefers BullMQ: the delivery (SSRF check + outbound HTTP, up to 10s per
 * webhook) runs on a worker instead of the like/comment/post/follow request
 * path. When BullMQ isn't configured, falls back to the inline delivery so
 * behavior is unchanged.
 */
export const deliverWebhookEvent = async (
  event: string,
  data: any,
  ownerUserId: string,
): Promise<void> => {
  try {
    const { enqueueWebhookDelivery } = await import("../configs/queue");
    const queued = await enqueueWebhookDelivery(event, data, ownerUserId);
    if (queued) return;
  } catch (err: any) {
    logger.error("Webhook enqueue failed — delivering inline", {
      event,
      error: err.message,
    });
  }
  await deliverWebhookEventInline(event, data, ownerUserId);
};
