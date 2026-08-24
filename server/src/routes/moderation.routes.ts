import { Router } from "express";
import { protect } from "../middlewares/auth.middleware";
import { generalLimiter, interactionLimiter } from "../middlewares/ratelimit.middleware";
import { flagContent, getModerationQueue, approveContent, rejectContent } from "../controllers/moderation.controller";

const router = Router();
router.use(protect, generalLimiter);
router.post("/flag", interactionLimiter, flagContent);
router.get("/queue", getModerationQueue);
router.put("/:id/approve", approveContent);
router.put("/:id/reject", rejectContent);

export default router;
