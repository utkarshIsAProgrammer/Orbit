import express from "express";
import {
  toggleSavePost,
  getSavedPosts,
  updateSaveFolder,
  getSaveFolders,
} from "../controllers/saves.controllers";
import { protect } from "../middlewares/auth.middleware";
import { interactionLimiter } from "../middlewares/ratelimit.middleware";

const router = express.Router();

// The controllers cache these lists themselves (getSavedPosts: 60s,
// getSaveFolders: 300s, keyed `saves:<userId>:*`) and invalidate on save
// toggles — the route-level cacheMiddleware was redundant, doubled Upstash
// latency on cache misses, and served stale lists after a save toggle
// (its `api:*` keys are never invalidated).
router.get("/folders", protect, getSaveFolders);
router.post("/:postId", protect, interactionLimiter, toggleSavePost);
router.patch("/:postId/folder", protect, updateSaveFolder);
router.get("/", protect, getSavedPosts);

export { router as saveRoutes };
