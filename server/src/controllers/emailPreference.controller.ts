import type { Request, Response } from "express";
import { EmailPreference } from "../models/emailPreference.model";
import { AppError, UnauthorizedError } from "../utilities/errors";
import { logger } from "../utilities/logger";

/**
 * GET /api/notifications/preferences — Get email notification preferences.
 */
export const getEmailPreferences = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");

    let prefs = await EmailPreference.findOne({ user: currentUserId }).lean();

    if (!prefs) {
      // Create default preferences
      prefs = await EmailPreference.create({
        user: currentUserId,
        digestFrequency: "daily",
        pushNotifications: true,
        emailTypes: ["like", "comment", "follow", "mention", "message", "weekly_digest"],
      });
    }

    return res.status(200).json({ success: true, preferences: prefs });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in getEmailPreferences", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * PUT /api/notifications/preferences — Update email notification preferences.
 */
export const updateEmailPreferences = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");

    const updateData: any = {};
    if (req.body.digestFrequency !== undefined) {
      updateData.digestFrequency = req.body.digestFrequency;
    }
    if (req.body.pushNotifications !== undefined) {
      updateData.pushNotifications = req.body.pushNotifications;
    }
    if (req.body.soundEnabled !== undefined) {
      updateData.soundEnabled = !!req.body.soundEnabled;
    }
    if (req.body.emailTypes !== undefined) {
      updateData.emailTypes = req.body.emailTypes;
    }
    // Per-category toggles (likes/comments/follows/mentions/messages/…).
    // Only whitelisted keys with boolean values are accepted.
    if (req.body.notificationPrefs !== undefined) {
      const allowed = [
        "likes", "comments", "follows", "mentions", "messages",
        "reposts", "saves", "polls", "glances", "collabs",
      ];
      const np: Record<string, boolean> = {};
      for (const key of allowed) {
        if (typeof req.body.notificationPrefs[key] === "boolean") {
          np[key] = req.body.notificationPrefs[key];
        }
      }
      if (Object.keys(np).length > 0) {
        updateData.notificationPrefs = np;
      }
    }

    const prefs = await EmailPreference.findOneAndUpdate(
      { user: currentUserId },
      { $set: updateData },
      { upsert: true, new: true },
    ).lean();

    // The master push toggle gates every device push via a short-TTL cache
    // (pushService.isPushEnabledForUser). Bust that cache so a flip takes
    // effect immediately instead of after up to 60s.
    if (req.body.pushNotifications !== undefined) {
      try {
        const { invalidatePushEnabledCache } = await import(
          "../services/pushService"
        );
        await invalidatePushEnabledCache(currentUserId.toString());
      } catch (err: any) {
        logger.error("Failed to invalidate push-enabled cache", {
          error: err.message,
        });
      }
    }

    return res.status(200).json({ success: true, message: "Preferences updated!", preferences: prefs });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in updateEmailPreferences", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * POST /api/notifications/digest — Trigger a manual digest.
 */
export const triggerDigest = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");

    await EmailPreference.findOneAndUpdate(
      { user: currentUserId },
      { lastDigestSentAt: new Date() },
      { upsert: true },
    );

    return res.status(200).json({ success: true, message: "Digest triggered!" });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in triggerDigest", { error: err.message });
    throw new AppError("Internal server error!");
  }
};
