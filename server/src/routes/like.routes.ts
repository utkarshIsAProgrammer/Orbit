import express from "express";
import { protect } from "../middlewares/auth.middleware";
import { interactionLimiter } from "../middlewares/ratelimit.middleware";
import {
  togglePostLikes,
  toggleCommentLikes,
} from "../controllers/like.controllers";

const router = express.Router();

router.post("/post/:postId", protect, interactionLimiter, togglePostLikes);
router.post(
  "/comment/:commentId",
  protect,
  interactionLimiter,
  toggleCommentLikes,
);

export { router as likeRoutes };
