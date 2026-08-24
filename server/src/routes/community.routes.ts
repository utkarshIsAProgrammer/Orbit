import express from "express";
import {
  createCommunity,
  updateCommunity,
  getCommunities,
  getCommunity,
  getMyCommunities,
  getCommunityMembers,
  joinCommunity,
  leaveCommunity,
  deleteCommunity,
  getCommunityMessages,
  searchCommunityMessages,
  sendCommunityMessage,
  editCommunityMessage,
  deleteCommunityMessage,
  deleteCommunityMessageForMe,
  toggleCommunityMessageReaction,
  pinCommunityMessage,
  unpinCommunityMessage,
  getPinnedMessages,
  removeMemberFromCommunity,
  toggleCommunityMessaging,
  toggleCommunityAudioCalls,
  toggleCommunityVideoCalls,
  clearCommunityChat,
  generateLiveKitToken,
  getCommunityMedia,
  muteCommunityNotifications,
  unmuteCommunityNotifications,
  getCommunityMutedStatus,
  createCommunityRoom,
  renameCommunityRoom,
  deleteCommunityRoom,
  getJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
  cancelJoinRequest,
  updateMemberRole,
  getInviteCode,
  createInviteCode,
  joinViaInvite,
  getRoomUnreadCounts,
  markRoomRead,
  banCommunityMember,
  unbanCommunityMember,
  voteCommunityPoll,
  toggleStarCommunityMessage,
  getCommunityMessageSeenBy,
  getStarredCommunityMessages,
} from "../controllers/community.controllers";
import { protect } from "../middlewares/auth.middleware";
import upload, { uploadChatMedia } from "../middlewares/upload.middleware";
import { generalLimiter, interactionLimiter } from "../middlewares/ratelimit.middleware";

const router = express.Router();

// Apply protect middleware to all community endpoints
router.use(protect);

// Community CRUD
router.post("/", generalLimiter, upload.single("image"), createCommunity);
router.get("/", generalLimiter, getCommunities);
router.get("/mine", generalLimiter, getMyCommunities);
router.get("/:communityId", generalLimiter, getCommunity);
router.put("/:communityId", generalLimiter, upload.single("image"), updateCommunity);
router.delete("/:communityId", generalLimiter, deleteCommunity);

// Members
router.get("/:communityId/members", generalLimiter, getCommunityMembers);

// Join/leave + invite links (invite works for public AND private communities)
router.post("/join/invite", generalLimiter, joinViaInvite);
router.post("/:communityId/join", generalLimiter, joinCommunity);
router.post("/:communityId/leave", generalLimiter, leaveCommunity);
router.get("/:communityId/invite", generalLimiter, getInviteCode);
router.post("/:communityId/invite", generalLimiter, createInviteCode);

// Community messages
router.get("/:communityId/messages", generalLimiter, getCommunityMessages);
router.get("/:communityId/messages/search", generalLimiter, searchCommunityMessages);
router.post(
  "/:communityId/messages",
  interactionLimiter,
  uploadChatMedia.array("files", 5),
  sendCommunityMessage
);

// Edit & delete messages
router.put("/messages/:messageId", interactionLimiter, editCommunityMessage);
router.delete("/messages/:messageId", interactionLimiter, deleteCommunityMessage);
router.delete("/messages/:messageId/delete-for-me", interactionLimiter, deleteCommunityMessageForMe);

// Message reactions
router.post("/messages/:messageId/reactions", interactionLimiter, toggleCommunityMessageReaction);

// Polls + starred messages
router.post("/messages/:messageId/vote", interactionLimiter, voteCommunityPoll);
router.post("/messages/:messageId/star", interactionLimiter, toggleStarCommunityMessage);
router.get("/messages/:messageId/seen-by", interactionLimiter, getCommunityMessageSeenBy);
router.get("/:communityId/starred", generalLimiter, getStarredCommunityMessages);

// Pinned messages
router.get("/:communityId/pinned-messages", generalLimiter, getPinnedMessages);
router.post("/messages/:messageId/pin", interactionLimiter, pinCommunityMessage);
router.post("/messages/:messageId/unpin", interactionLimiter, unpinCommunityMessage);

// Admin / Creator actions
router.post("/:communityId/remove-member", generalLimiter, removeMemberFromCommunity);
router.post("/:communityId/ban", generalLimiter, banCommunityMember);
router.post("/:communityId/unban", generalLimiter, unbanCommunityMember);
router.post("/:communityId/toggle-messaging", generalLimiter, toggleCommunityMessaging);
router.post("/:communityId/toggle-audio-calls", generalLimiter, toggleCommunityAudioCalls);
router.post("/:communityId/toggle-video-calls", generalLimiter, toggleCommunityVideoCalls);
router.post("/:communityId/clear-chat", generalLimiter, clearCommunityChat);

// Join requests (private communities) — moderators and above can manage
router.get("/:communityId/join-requests", generalLimiter, getJoinRequests);
router.post("/:communityId/join-requests/cancel", generalLimiter, cancelJoinRequest);
router.post(
  "/:communityId/join-requests/:userId/approve",
  generalLimiter,
  approveJoinRequest
);
router.post(
  "/:communityId/join-requests/:userId/reject",
  generalLimiter,
  rejectJoinRequest
);

// Member roles (promote/demote — creator manages admins, admins manage
// moderators/members)
router.post(
  "/:communityId/members/:memberId/role",
  generalLimiter,
  updateMemberRole
);

// Community media by type (images, videos, voice notes, files)
router.get("/:communityId/media", generalLimiter, getCommunityMedia);

// Rooms (channels) — Discord-style text channels inside a community
router.post("/:communityId/rooms", generalLimiter, createCommunityRoom);
router.put("/:communityId/rooms/:roomId", generalLimiter, renameCommunityRoom);
router.delete("/:communityId/rooms/:roomId", generalLimiter, deleteCommunityRoom);

// Per-channel unread badges + read pointers
router.get("/:communityId/unread", generalLimiter, getRoomUnreadCounts);
router.post("/:communityId/rooms/:roomId/read", generalLimiter, markRoomRead);

// LiveKit group call token
router.post("/:communityId/livekit-token", generalLimiter, generateLiveKitToken);

// Per-user notification mute settings (any member)
router.get("/:communityId/muted", generalLimiter, getCommunityMutedStatus);
router.post("/:communityId/mute", generalLimiter, muteCommunityNotifications);
router.post("/:communityId/unmute", generalLimiter, unmuteCommunityNotifications);

export { router as communityRoutes };
