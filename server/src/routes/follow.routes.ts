import express from "express";
import {
  toggleFollowUser,
  getFollowers,
  getFollowing,
} from "../controllers/follow.controllers";
import { protect, optionalAuth } from "../middlewares/auth.middleware";
import { interactionLimiter } from "../middlewares/ratelimit.middleware";
import { cacheMiddleware } from "../middlewares/cache.middleware";

const router = express.Router();

router.post("/:userId", protect, interactionLimiter, toggleFollowUser);
// Cache GET endpoints for better performance
router.get("/:userId/followers", optionalAuth, cacheMiddleware({ ttl: 120 }), getFollowers);
router.get("/:userId/following", optionalAuth, cacheMiddleware({ ttl: 120 }), getFollowing);

export { router as followRoutes };
