import { Router } from "express";
import { protect } from "../middlewares/auth.middleware";
import { generalLimiter } from "../middlewares/ratelimit.middleware";
import { leaderboard } from "../controllers/leaderboard.controllers";

const router = Router();
router.use(protect, generalLimiter);
router.get("/", leaderboard);
export default router;
