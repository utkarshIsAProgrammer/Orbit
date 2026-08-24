import express from "express";
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  deleteNotification,
  clearAllNotifications,
} from "../controllers/notification.controllers";
import { protect, optionalAuth } from "../middlewares/auth.middleware";
import { notificationLimiter } from "../middlewares/ratelimit.middleware";
import { cacheMiddleware } from "../middlewares/cache.middleware";

const router = express.Router();

// Cache GET endpoints for better performance
router.get("/unread-count", optionalAuth, notificationLimiter, cacheMiddleware({ ttl: 30 }), getUnreadCount);
router.get("/", optionalAuth, notificationLimiter, cacheMiddleware({ ttl: 30 }), getNotifications);
router.delete("/clear-all", protect, notificationLimiter, clearAllNotifications);
router.delete("/", protect, notificationLimiter, clearAllNotifications); // Client alias
router.delete("/:notificationId", protect, notificationLimiter, deleteNotification);
router.put("/mark-as-read", protect, notificationLimiter, markAsRead);
router.put("/read", protect, notificationLimiter, markAsRead); // Client alias
router.put("/mark-as-read/:notificationId", protect, notificationLimiter, markAsRead);
router.put("/:notificationId/read", protect, notificationLimiter, markAsRead); // Client alias

// Email notification preferences
import { getEmailPreferences, updateEmailPreferences, triggerDigest } from "../controllers/emailPreference.controller";

router.get("/preferences", protect, notificationLimiter, getEmailPreferences);
router.put("/preferences", protect, notificationLimiter, updateEmailPreferences);
router.post("/digest", protect, notificationLimiter, triggerDigest);

export { router as notificationRoutes };
