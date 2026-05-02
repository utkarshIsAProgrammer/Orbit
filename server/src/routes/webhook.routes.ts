import { Router } from "express";
import { protect } from "../middlewares/auth.middleware";
import { generalLimiter, interactionLimiter } from "../middlewares/ratelimit.middleware";
import { createWebhook, getWebhooks, deleteWebhook, testWebhook } from "../controllers/webhook.controller";

const router = Router();
router.use(protect, generalLimiter);
router.post("/", interactionLimiter, createWebhook);
router.get("/", getWebhooks);
router.delete("/:webhookId", deleteWebhook);
router.post("/:webhookId/test", interactionLimiter, testWebhook);

export default router;

// HMAC-SHA256 verify Upstash webhook signature header

// store delivery ID in Redis SET with 24h TTL; skip if already present

// retry failed webhooks: 1min, 5min, 30min, 2hr, 12hr

// store delivery history with status codes, timestamps, retry count

// failed deliveries queued to BullMQ with exponential backoff up to 24h

// reject payloads larger than 1MB with 413 before queuing

// idempotency key in Redis prevents processing same payload twice

// idempotency key in Redis prevents processing same payload twice

// webhooks can subscribe to specific event types only
