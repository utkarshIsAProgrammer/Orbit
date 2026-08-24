import express from "express";
import {
  getAll,
  deleteAccount,
  shareProfile,
  forwardProfile,
  viewsCount,
  updateProfile,
  getUserByUsername,
  getUserPosts,
  getUserById,
  getSuggestedUsers,
  dismissSuggestion,
  getSimilarCreators,
  pinPost,
  unpinPost,
  getPinnedPosts,
  sendFollowRequest,
  approveFollowRequest,
  declineFollowRequest,
  getPendingFollowRequests,
} from "../controllers/user.controllers";
import {
  addCloseFriend,
  removeCloseFriend,
  getCloseFriends,
  checkCloseFriend,
} from "../controllers/closeFriends.controllers";
import upload from "../middlewares/upload.middleware";
import { protect, optionalAuth } from "../middlewares/auth.middleware";
import { protectViews } from "../middlewares/view.middleware";
import { interactionLimiter, authLimiter } from "../middlewares/ratelimit.middleware";
import { updatePassword } from "../controllers/password.controllers";
import { cacheMiddleware } from "../middlewares/cache.middleware";

const router = express.Router();

// Literal-path endpoints that must be registered BEFORE /:userId routes —
// otherwise "/close-friends" or "/follow-requests" is captured by the
// :userId param and fails ObjectId validation with a 400 ("Invalid user id!").
router.get("/close-friends", protect, getCloseFriends);
router.get("/close-friends/:userId/check", protect, checkCloseFriend);
router.post("/close-friends/:userId", protect, interactionLimiter, addCloseFriend);
router.delete("/close-friends/:userId", protect, interactionLimiter, removeCloseFriend);
router.get("/follow-requests", protect, getPendingFollowRequests);

// Cache GET endpoints for better performance
router.get("/", optionalAuth, cacheMiddleware({ ttl: 60 }), getAll);
router.get("/suggestions", protect, cacheMiddleware({ ttl: 120 }), getSuggestedUsers);
router.post("/suggestions/dismiss", protect, interactionLimiter, dismissSuggestion);
router.get("/:userId/similar-creators", protect, cacheMiddleware({ ttl: 300 }), getSimilarCreators);
router.get("/username/:username", optionalAuth, cacheMiddleware({ ttl: 300 }), getUserByUsername);
router.get("/:userId", optionalAuth, cacheMiddleware({ ttl: 300 }), getUserById);
router.get("/:userId/posts", optionalAuth, cacheMiddleware({ ttl: 60 }), getUserPosts);
router.get("/:userId/pinned", optionalAuth, cacheMiddleware({ ttl: 300 }), getPinnedPosts);
router.delete("/delete-account", protect, deleteAccount);
router.post("/:userId/share", protect, interactionLimiter, shareProfile);
router.post("/:userId/forward", protect, interactionLimiter, forwardProfile);
router.post("/:userId/pin", protect, pinPost);
router.post("/:userId/unpin", protect, unpinPost);

// Private account follow requests
router.post("/:userId/follow-request", protect, interactionLimiter, sendFollowRequest);
router.post("/:userId/approve-request", protect, interactionLimiter, approveFollowRequest);
router.post("/:userId/decline-request", protect, interactionLimiter, declineFollowRequest);

router.post("/:userId/view", protectViews, interactionLimiter, viewsCount);
router.put("/update-password", protect, authLimiter, updatePassword); // Client alias
router.put(
  "/update-profile",
  protect,
  upload.fields([
    { name: "profilePic", maxCount: 1 },
    { name: "bannerImage", maxCount: 1 },
  ]),
  updateProfile,
);

export { router as userRoutes };

