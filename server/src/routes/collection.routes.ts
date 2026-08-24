import express from "express";
import {
  createCollection,
  getCollections,
  addPostToCollection,
  removePostFromCollection,
  deleteCollection,
  getCollectionPosts,
  getSharedCollection,
  forwardCollection,
  forwardCollectionToCommunity,
} from "../controllers/collection.controllers";
import { protect } from "../middlewares/auth.middleware";
import { generalLimiter, interactionLimiter } from "../middlewares/ratelimit.middleware";

const router = express.Router();
router.use(protect);

router.post("/", generalLimiter, createCollection);
router.get("/", generalLimiter, getCollections);
router.get("/:collectionId", generalLimiter, getCollectionPosts);
router.post("/:collectionId/posts/:postId", interactionLimiter, addPostToCollection);
router.delete("/:collectionId/posts/:postId", interactionLimiter, removePostFromCollection);
router.delete("/:collectionId", generalLimiter, deleteCollection);

// Sharing (read-only shared view + DM/community forwards)
router.get("/shared/:collectionId", generalLimiter, getSharedCollection);
router.post("/:collectionId/forward", interactionLimiter, forwardCollection);
router.post("/:collectionId/forward-community", interactionLimiter, forwardCollectionToCommunity);

export { router as collectionRoutes };
