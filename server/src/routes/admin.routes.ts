import express from "express";
import {
  createFeatureFlag,
  getFeatureFlags,
  updateFeatureFlag,
  getUserFlags,
  toggleUserMute,
  toggleUserBan,
  toggleUserVerify,
  getAdminStats,
  adminListUsers,
  adminDeleteUser,
  adminListPosts,
  adminDeletePost,
  adminListComments,
  adminDeleteComment,
  adminListGlances,
  adminDeleteGlimpse,
  adminListCommunities,
  adminDeleteCommunity,
  adminListReports,
  getAdminUserDetail,
  adminGodUpdateUser,
  adminImpersonateUser,
  adminResetPassword,
  createBroadcast,
  adminListBroadcasts,
  adminDeleteBroadcast,
  getActiveBroadcast,
  getAdminMonitoring,
  getAdminAudit,
  adminUpdatePost,
  adminUpdateComment,
  getKillSwitches,
  setKillSwitch,
  adminListBots,
  adminBotsStatus,
  adminSeedBots,
  adminStartBots,
  adminStopBots,
  adminUpdateBotsConfig,
  adminDeleteBot,
} from "../controllers/admin.controllers";
import { protect } from "../middlewares/auth.middleware";
import { generalLimiter } from "../middlewares/ratelimit.middleware";

const router = express.Router();

// User-facing: get my feature flags
router.get("/flags/mine", protect, generalLimiter, getUserFlags);

// Admin routes (protected by isAdmin check in controller)
router.get("/stats", protect, generalLimiter, getAdminStats);
router.get("/flags", protect, generalLimiter, getFeatureFlags);
router.post("/flags", protect, generalLimiter, createFeatureFlag);
router.put("/flags/:flagId", protect, generalLimiter, updateFeatureFlag);

// Admin user management
router.put("/users/:userId/mute", protect, generalLimiter, toggleUserMute);
router.put("/users/:userId/ban", protect, generalLimiter, toggleUserBan);
router.put("/users/:userId/verify", protect, generalLimiter, toggleUserVerify);

// ── Full-control ("god mode") endpoints ──────────────────────────────
// List / edit / delete any user
router.get("/users", protect, generalLimiter, adminListUsers);
router.get("/users/:userId/detail", protect, generalLimiter, getAdminUserDetail);
router.put("/users/:userId", protect, generalLimiter, adminGodUpdateUser);
router.delete("/users/:userId", protect, generalLimiter, adminDeleteUser);
router.post("/users/:userId/impersonate", protect, generalLimiter, adminImpersonateUser);
router.post("/users/:userId/reset-password", protect, generalLimiter, adminResetPassword);

// God mode — announcements + live monitoring
router.get("/broadcasts", protect, generalLimiter, adminListBroadcasts);
router.get("/broadcasts/active", protect, generalLimiter, getActiveBroadcast);
router.post("/broadcasts", protect, generalLimiter, createBroadcast);
router.delete("/broadcasts/:broadcastId", protect, generalLimiter, adminDeleteBroadcast);
router.get("/monitoring", protect, generalLimiter, getAdminMonitoring);
router.get("/audit", protect, generalLimiter, getAdminAudit);
router.get("/killswitches", protect, generalLimiter, getKillSwitches);
router.post("/killswitches", protect, generalLimiter, setKillSwitch);

// Content moderation — list & delete any post / comment / glimpse / community
router.get("/posts", protect, generalLimiter, adminListPosts);
router.put("/posts/:postId", protect, generalLimiter, adminUpdatePost);
router.delete("/posts/:postId", protect, generalLimiter, adminDeletePost);
router.get("/comments", protect, generalLimiter, adminListComments);
router.put("/comments/:commentId", protect, generalLimiter, adminUpdateComment);
router.delete("/comments/:commentId", protect, generalLimiter, adminDeleteComment);
router.get("/glances", protect, generalLimiter, adminListGlances);
router.delete("/glances/:glimpseId", protect, generalLimiter, adminDeleteGlimpse);
router.get("/communities", protect, generalLimiter, adminListCommunities);
router.delete("/communities/:communityId", protect, generalLimiter, adminDeleteCommunity);

// Full report queue (any status)
router.get("/reports", protect, generalLimiter, adminListReports);

// ── Bot farm (simulated human users) ──────────────────────────────────
router.get("/bots", protect, generalLimiter, adminListBots);
router.get("/bots/status", protect, generalLimiter, adminBotsStatus);
router.post("/bots/seed", protect, generalLimiter, adminSeedBots);
router.post("/bots/start", protect, generalLimiter, adminStartBots);
router.post("/bots/stop", protect, generalLimiter, adminStopBots);
router.put("/bots/config", protect, generalLimiter, adminUpdateBotsConfig);
router.delete("/bots/:botId", protect, generalLimiter, adminDeleteBot);

export { router as adminRoutes };

// broadcast message to all users via push notification

// POST /api/admin/retention - set auto-delete for posts older than N days

// POST /api/admin/users/lookup - accepts array of IDs, returns profiles

// GET /api/admin/audit/:userId - returns last 100 actions

// POST /api/admin/import/users - accept CSV, create accounts in batch

// admin can login as user for support; generates temp JWT
