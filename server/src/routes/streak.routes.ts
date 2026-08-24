import express from "express";
import {
  getMyStreaks,
  claimDailyReward,
  getRewardStatus,
} from "../controllers/streak.controllers";
import { protect } from "../middlewares/auth.middleware";
import { generalLimiter, interactionLimiter } from "../middlewares/ratelimit.middleware";

const router = express.Router();
router.use(protect);

router.get("/", generalLimiter, getMyStreaks);
router.get("/my", generalLimiter, getMyStreaks);
router.get("/reward", generalLimiter, getRewardStatus);
router.post("/reward/claim", interactionLimiter, claimDailyReward);
router.post("/claim", interactionLimiter, claimDailyReward);

export { router as streakRoutes };
