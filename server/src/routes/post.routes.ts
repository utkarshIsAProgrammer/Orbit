import express from "express";
import {
  getPost,
  getAllPosts,
  createPost,
  updatePost,
  deletePost,
  sharePost,
  forwardPost,
  forwardPostToCommunity,
  viewsCount,
  getPostBySlug,
  getPostsByHashtag,
  pinPost,
  unpinPost,
  hidePost,
  unhidePost,
  votePoll,
  inviteCollab,
  acceptCollab,
  publishDraft,
  quoteRepost,
  getTrendingHashtags,
} from "../controllers/post.controllers";
import {
  archivePost,
  unarchivePost,
  getArchivedPosts,
} from "../controllers/archive.controllers";
import { togglePostReaction } from "../controllers/postReaction.controllers";
import { protect, optionalAuth } from "../middlewares/auth.middleware";
import { protectViews } from "../middlewares/view.middleware";
import { uploadPostMedia } from "../middlewares/upload.middleware";
import { searchLimiter, interactionLimiter } from "../middlewares/ratelimit.middleware";
import { cacheMiddleware } from "../middlewares/cache.middleware";
import { getDrafts, createDraft, createScheduledPost } from "../controllers/draft.controller";

const router = express.Router();

// Specific routes (must be before /:postId routes to avoid matching as postId)

/**
 * @openapi
 * /api/posts/trending/hashtags:
 *   get:
 *     tags: [Posts]
 *     summary: Get trending hashtags
 *     description: Returns the most-used hashtags across all public posts.
 *     security: []
 *     responses:
 *       200:
 *         description: List of trending hashtags
 */
// NOTE: getTrendingHashtags, getPostBySlug, getPost and getAllPosts all cache
// their own responses in the controller (keyed `post:*` / `trending:hashtags`)
// and invalidate those keys on writes — the route-level cacheMiddleware is a
// redundant second cache layer that doubles Upstash latency on every miss.
// It is only kept on /hashtag/:hashtag, whose controller has no cache.
router.get("/trending/hashtags", optionalAuth, getTrendingHashtags);
router.get("/archived", protect, getArchivedPosts);
router.get("/hashtag/:hashtag", optionalAuth, searchLimiter, cacheMiddleware({ ttl: 300 }), getPostsByHashtag);
router.get("/slug/:slug", optionalAuth, getPostBySlug);
// IMPORTANT: /drafts MUST be declared BEFORE /:postId — otherwise
// "drafts" is matched as a postId and the endpoint is unreachable.
router.get("/drafts", protect, getDrafts);
router.get("/:postId", optionalAuth, getPost);

/**
 * @openapi
 * /api/posts:
 *   get:
 *     tags: [Posts]
 *     summary: Get all posts (paginated feed)
 *     description: Returns a paginated list of posts. Supports cursor-based pagination.
 *     security: []
 *     parameters:
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *         description: Cursor for pagination
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated list of posts
 *   post:
 *     tags: [Posts]
 *     summary: Create a new post
 *     description: Creates a post with optional images, video, and poll.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string, example: "My awesome post" }
 *               content: { type: string, example: "Check out this cool thing!" }
 *               images: { type: array, items: { type: string, format: binary } }
 *               image: { type: string, format: binary }
 *               video: { type: string, format: binary }
 *               hashtags: { type: string, example: "tech,design" }
 *     responses:
 *       201:
 *         description: Post created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 post: { $ref: '#/components/schemas/Post' }
 */
router.get("/", optionalAuth, getAllPosts);
router.post(
  "/",
  protect,
  uploadPostMedia.fields([
    { name: "images", maxCount: 10 },
    { name: "image", maxCount: 1 },
    { name: "video", maxCount: 1 },
  ]),
  createPost,
);
router.put(
  "/:postId",
  protect,
  uploadPostMedia.fields([
    { name: "images", maxCount: 10 },
    { name: "image", maxCount: 1 },
    { name: "video", maxCount: 1 },
  ]),
  updatePost,
);
router.delete("/:postId", protect, deletePost);

router.post("/:postId/view", protectViews, interactionLimiter, viewsCount);
router.post("/:postId/share", protect, interactionLimiter, sharePost);
router.post("/:postId/forward", protect, interactionLimiter, forwardPost);
router.post("/:postId/forward-community", protect, interactionLimiter, forwardPostToCommunity);
router.post("/:postId/pin", protect, pinPost);
router.post("/:postId/unpin", protect, unpinPost);
router.post("/:postId/archive", protect, interactionLimiter, archivePost);
router.post("/:postId/unarchive", protect, interactionLimiter, unarchivePost);

// Content preference — "Not interested" hides a post from the user's feeds
router.post("/:postId/hide", protect, interactionLimiter, hidePost);
router.delete("/:postId/hide", protect, interactionLimiter, unhidePost);

// Post emoji reactions
router.post("/:postId/reactions", protect, interactionLimiter, togglePostReaction);

// Poll voting
router.post("/:postId/vote", protect, interactionLimiter, votePoll);

// Collab invitations
router.post("/:postId/collab-invite", protect, interactionLimiter, inviteCollab);
router.post("/:postId/collab-accept", protect, interactionLimiter, acceptCollab);

// Post scheduling / draft publishing
router.post("/:postId/publish", protect, interactionLimiter, publishDraft);

// Quote repost (repost with commentary)
router.post("/:postId/quote-repost", protect, interactionLimiter, quoteRepost);

// Draft & scheduled post management
router.post(
  "/drafts",
  protect,
  uploadPostMedia.fields([{ name: "images", maxCount: 10 }, { name: "image", maxCount: 1 }, { name: "video", maxCount: 1 }]),
  createDraft
);
router.post("/schedule", protect, interactionLimiter, createScheduledPost);

export { router as postRoutes };


// enforce ceiling: Math.min(req.query.limit, 50)
