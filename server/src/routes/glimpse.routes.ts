import express from "express";
import {
  getGlimpseFeed,
  getUserGlimpses,
  createGlimpse,
  viewGlimpse,
  getGlimpse,
  deleteGlimpse,
  reactToGlimpse,
  replyToGlimpse,
  forwardGlimpse,
} from "../controllers/glimpse.controllers";
import { protect } from "../middlewares/auth.middleware";
import { uploadGlimpseMedia } from "../middlewares/upload.middleware";

const router = express.Router();

// Get glimpse feed
router.get("/feed", protect, getGlimpseFeed);

// Get a single user's glimpses (story ring for their profile)
router.get("/user/:userId", protect, getUserGlimpses);

// Create a glimpse (with image upload)
router.post("/", protect, uploadGlimpseMedia.single("media"), createGlimpse);

// View a glimpse (mark as viewed)
router.post("/:glimpseId/view", protect, viewGlimpse);

// React to a glimpse (add/remove emoji reaction)
router.post("/:glimpseId/reactions", protect, reactToGlimpse);

// Reply to a glimpse (opens DM with author)
router.post("/:glimpseId/reply", protect, replyToGlimpse);

// Forward a glimpse to another user
router.post("/:glimpseId/forward", protect, forwardGlimpse);

// Get single glimpse
router.get("/:glimpseId", protect, getGlimpse);

// Delete a glimpse
router.delete("/:glimpseId", protect, deleteGlimpse);

export { router as glimpseRoutes };
