import express from "express";
import { searchUsers, searchPosts } from "../controllers/search.controllers";
import { optionalAuth } from "../middlewares/auth.middleware";
import { searchLimiter } from "../middlewares/ratelimit.middleware";

const router = express.Router();

// Search endpoints. NOTE: no route-level cacheMiddleware here — the
// controllers already cache via getCache/setCache (which has a zero-latency
// in-memory first layer), so a second Upstash round-trip per request was
// pure redundancy that roughly doubled search latency on the free tier.
router.get("/users", optionalAuth, searchLimiter, searchUsers);
router.get("/posts", optionalAuth, searchLimiter, searchPosts);

export { router as searchRoutes };
