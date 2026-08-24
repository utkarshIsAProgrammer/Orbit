import express from "express";
import {
  getOrCreateConversation,
  getConversations,
  getMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  deleteMessageForMe,
  getUserPresence,
  deleteConversation,
  clearConversationMessages,
  muteConversation,
  unmuteConversation,
  getConversationMutedStatus,
  pinMessage,
  unpinMessage,
  getPinnedMessages,
  archiveConversation,
  getArchivedConversations,
  toggleStarMessage,
  getStarredMessages,
  getConversationMedia,
} from "../controllers/chat.controllers";
import { toggleReaction } from "../controllers/reaction.controllers";
import {
  searchMessages,
  searchAllMessages,
} from "../controllers/messageSearch.controllers";
import { protect } from "../middlewares/auth.middleware";
import { uploadChatMedia } from "../middlewares/upload.middleware";
import { generalLimiter, interactionLimiter, localInteractionLimiter } from "../middlewares/ratelimit.middleware";
import { cacheMiddleware } from "../middlewares/cache.middleware";

const router = express.Router();

// Apply protect middleware to all chat endpoints
router.use(protect);

// Conversations routes
router.post("/conversations", generalLimiter, getOrCreateConversation);
router.get("/conversations", generalLimiter, getConversations);
router.delete("/conversations/:conversationId", generalLimiter, deleteConversation);
router.delete("/conversations/:conversationId/messages", generalLimiter, clearConversationMessages);

// Per-user notification mute settings (any participant)
router.get("/conversations/:conversationId/muted", generalLimiter, getConversationMutedStatus);
router.post("/conversations/:conversationId/mute", generalLimiter, muteConversation);
router.post("/conversations/:conversationId/unmute", generalLimiter, unmuteConversation);

// Archive (WhatsApp-style) — archived chats drop out of the default list
router.post("/conversations/:conversationId/archive", generalLimiter, archiveConversation);
router.get("/conversations/archived", generalLimiter, getArchivedConversations);

// Media library + starred messages (1-on-1)
router.get("/conversations/:conversationId/media", generalLimiter, getConversationMedia);
router.get("/conversations/:conversationId/starred", generalLimiter, getStarredMessages);
router.post("/messages/:messageId/star", interactionLimiter, toggleStarMessage);

// Messages routes
router.get("/conversations/:conversationId/messages", generalLimiter, getMessages);
// The send route is the single hottest endpoint in the app and the sender is
// waiting on its response — use the in-memory limiter (zero Upstash
// round-trip) instead of the Redis one. Same 80/60s budget.
router.post(
  "/conversations/:conversationId/messages",
  localInteractionLimiter,
  uploadChatMedia.array("files", 5),
  sendMessage
);

// Edit & delete routes
router.put("/messages/:messageId", interactionLimiter, editMessage);
router.delete("/messages/:messageId", interactionLimiter, deleteMessage);
router.delete("/messages/:messageId/delete-for-me", interactionLimiter, deleteMessageForMe);

// Reaction route
router.post("/messages/:messageId/reactions", interactionLimiter, toggleReaction);

// Message search routes — per-conversation + across ALL conversations (the
// chat-list search box digs through every chat, WhatsApp-style).
router.get("/conversations/:conversationId/search", generalLimiter, searchMessages);
router.get("/search", generalLimiter, searchAllMessages);

// Pin / Unpin routes
router.post("/messages/:messageId/pin", interactionLimiter, pinMessage);
router.post("/messages/:messageId/unpin", interactionLimiter, unpinMessage);
router.get("/conversations/:conversationId/pinned-messages", generalLimiter, getPinnedMessages);

// Presence route
router.get("/users/:userId/presence", generalLimiter, cacheMiddleware({ ttl: 60 }), getUserPresence);

export { router as chatRoutes };
