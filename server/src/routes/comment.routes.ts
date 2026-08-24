import express from "express";
import {
  getComment,
  getAllComments,
  getAllCommentsForPost,
  getCommentReplies,
  addComment,
  updateComment,
  deleteComment,
  forwardComment,
} from "../controllers/comment.controllers";
import { toggleCommentReaction } from "../controllers/commentReaction.controllers";
import { protect, optionalAuth } from "../middlewares/auth.middleware";
import { commentLimiter } from "../middlewares/ratelimit.middleware";

const router = express.Router();

// NOTE: no cacheMiddleware here on purpose. The cacheMiddleware caches under
// `api:<userId>:<routerRelativePath>:<query>` — for this router the path is
// `/<postId>` which is indistinguishable from other routes' keys, so the
// invalidation patterns in clearCommentsCache() can never reliably clear it.
// That caused freshly added comments/replies to stay invisible (empty drawer)
// for up to the middleware TTL. The controllers below already have their own
// per-viewer Redis cache (`comments:*` keys) which IS invalidated on every
// add/update/delete via clearCommentsCache(postId), so caching + freshness are
// both preserved without the un-invalidatable middleware layer.
router.get("/", optionalAuth, getAllComments);
router.get("/replies/:commentId", optionalAuth, getCommentReplies);
router.get("/:postId", optionalAuth, getComment);
router.get("/:postId/all", optionalAuth, getAllCommentsForPost);

// Comment CRUD operations
router.post("/:postId", protect, commentLimiter, addComment);
router.put("/:commentId", protect, commentLimiter, updateComment);
router.delete("/:commentId", protect, commentLimiter, deleteComment);

// Comment reactions
router.post("/:commentId/reactions", protect, commentLimiter, toggleCommentReaction);

// Comment share / forward
router.post("/:commentId/forward", protect, commentLimiter, forwardComment);

export { router as commentRoutes };
