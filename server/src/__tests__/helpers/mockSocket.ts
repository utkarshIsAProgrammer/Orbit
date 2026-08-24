/**
 * Mock Socket.IO helpers for integration tests.
 *
 * In test mode, Socket.IO is never initialized (initSocket is never called),
 * so the real socket module's emit functions would crash on `io.to(...)`.
 * This mock replaces the real socket module with no-op versions of every
 * emit function so that controllers don't throw during tests.
 *
 * Usage (in jest.config.js setupFilesAfterSetup or in setup.ts):
 *   jest.mock("../configs/socket", () => require("./helpers/mockSocket"));
 */

// List of all emit functions from the real socket module
const emitFunctions = [
  "emitPostLike",
  "emitPostUnlike",
  "emitPostSave",
  "emitPostUnsave",
  "emitPostRepost",
  "emitPostUnrepost",
  "emitPostComment",
  "emitCommentReply",
  "emitCommentLike",
  "emitCommentUnlike",
  "emitPostCreated",
  "emitPostDeleted",
  "emitPostUpdated",
  "emitPollUpdated",
  "emitPostReaction",
  "emitCommentUpdated",
  "emitCommentDeleted",
  "emitFollowUser",
  "emitUnfollowUser",
  "emitPostShare",
  "emitUserShare",
  "emitCommentReaction",
  "emitMessageReaction",
  "emitPostView",
  "emitUserView",
  "emitPostPin",
  "emitPostUnpin",
  "emitMessagePin",
  "emitMessageUnpin",
  "emitNewMessage",
  "emitMessageEdit",
  "emitMessageDelete",
  "emitMessageDeleteForMe",
  "emitChatNotification",
  "emitCommunityPresence",
  "emitUserUpdated",
  "emitAccountDeleted",
  "sendNotification",
  "disconnectUserSockets",
  // Realtime backfill log — no-op in tests (no Redis).
  "logUserRealtimeEvent",
  "getRealtimeEventsSince",
];

const mock: Record<string, (...args: any[]) => void> = {};

for (const fn of emitFunctions) {
  mock[fn] = () => {};
}

// getIO returns a chainable stub so controllers that emit via `getIO().to(room).emit(...)`
// (chat messages, community join, notifications) don't throw in isolated test apps.
mock.getIO = () => ({
  to: () => ({
    emit: () => {},
    fetchSockets: async () => [],
  }),
  in: () => ({
    emit: () => {},
    disconnectSockets: () => {},
    fetchSockets: async () => [],
  }),
  emit: () => {},
});

// Presence helpers return offline by default
mock.isRecipientActiveInConversation = async () => false;
mock.getUserPresenceStatus = async () => "offline";
mock.getUserPresenceStatuses = async () => ({});
mock.getUserLastSeens = async () => ({});

// Presence counters (used by admin stats + community join/leave)
mock.isUserOnline = () => false;
mock.getOnlineUsersCount = () => 0;

// Socket init/shutdown are no-ops
mock.initSocket = async () => {};
mock.shutdownSocket = async () => {};

module.exports = mock;
