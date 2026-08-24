import express from "express";
import {
  getExternalFeed,
  refreshExternalFeed,
  toggleExternalPostLike,
  toggleExternalPostSave,
  toggleExternalPostRepost,
  getExternalPostComments,
  addExternalPostComment,
  hideExternalPost,
} from "../controllers/externalFeed.controllers";
import { protect, optionalAuth } from "../middlewares/auth.middleware";
import { generalLimiter, interactionLimiter } from "../middlewares/ratelimit.middleware";
import { cacheMiddleware } from "../middlewares/cache.middleware";

const router = express.Router();

// Public imported feed (anonymous-friendly, cached 60s). optionalAuth lets
// signed-in users get likedByMe/savedByMe flags + hidden-post preferences.
router.get(
  "/feed",
  generalLimiter,
  optionalAuth,
  cacheMiddleware({ ttl: 60 }),
  getExternalFeed,
);

// Orbit-native interactions on imported posts — like/save/hide behave
// exactly like they do on native posts.
router.post(
  "/posts/:postId/like",
  protect,
  interactionLimiter,
  toggleExternalPostLike,
);
router.post(
  "/posts/:postId/save",
  protect,
  interactionLimiter,
  toggleExternalPostSave,
);
router.post(
  "/posts/:postId/repost",
  protect,
  interactionLimiter,
  toggleExternalPostRepost,
);
router.post(
  "/posts/:postId/hide",
  protect,
  interactionLimiter,
  hideExternalPost,
);

// Orbit-native comments on imported posts — top-level list + create. Replies
// to those comments go through the native /api/comments/replies + POST flow.
router.get(
  "/posts/:postId/comments",
  optionalAuth,
  generalLimiter,
  getExternalPostComments,
);
router.post(
  "/posts/:postId/comments",
  protect,
  interactionLimiter,
  addExternalPostComment,
);

// Manual refresh — authenticated so unauthenticated visitors can't spam
// outbound API calls from the server.
router.post("/feed/refresh", protect, generalLimiter, refreshExternalFeed);

export const externalFeedRoutes = router;
