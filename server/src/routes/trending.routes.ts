import { Router } from "express";
import { optionalAuth } from "../middlewares/auth.middleware";
import { searchLimiter } from "../middlewares/ratelimit.middleware";
import { getTrendingUsers, getTrendingTopics } from "../controllers/trending.controller";

const router = Router();
router.use(optionalAuth, searchLimiter);
router.get("/users", getTrendingUsers);
router.get("/topics", getTrendingTopics);

export default router;
