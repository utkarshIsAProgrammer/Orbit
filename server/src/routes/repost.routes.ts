import express from "express";
import { protect } from "../middlewares/auth.middleware";
import { toggleRepost, getRepostedPosts } from "../controllers/repost.controllers";
import { interactionLimiter } from "../middlewares/ratelimit.middleware";

const router = express.Router();

router.post("/:postId", protect, interactionLimiter, toggleRepost);
// The controller caches the list itself (60s TTL, key `reposts:<userId>:*`)
// and invalidates on toggle — a route-level cacheMiddleware was redundant,
// doubled Upstash latency on every cache miss, and served stale lists after
// a repost toggle (its `api:*` keys are never invalidated).
router.get("/", protect, getRepostedPosts);

export { router as repostRoutes };
