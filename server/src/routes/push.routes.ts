import express from "express";
import { subscribe, unsubscribe, getVapidKey } from "../controllers/push.controllers";
import { protect } from "../middlewares/auth.middleware";
import { generalLimiter } from "../middlewares/ratelimit.middleware";

const router = express.Router();

router.get("/vapid-key", getVapidKey);
router.post("/subscribe", protect, generalLimiter, subscribe);
router.post("/unsubscribe", protect, generalLimiter, unsubscribe);

export { router as pushRoutes };
