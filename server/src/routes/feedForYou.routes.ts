import { Router } from "express";
import { protect } from "../middlewares/auth.middleware";
import { generalLimiter } from "../middlewares/ratelimit.middleware";
import { getForYouFeed } from "../controllers/feedForYou.controller";

const router = Router();
router.use(protect, generalLimiter);
router.get("/for-you", getForYouFeed);

export default router;
