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
