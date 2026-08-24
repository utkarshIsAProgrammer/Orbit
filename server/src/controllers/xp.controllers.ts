import { Request, Response } from "express";
import { getXPInfo } from "../services/xpService";
import { computeAchievementProgress } from "../services/badgeService";
import {
  BADGE_CATALOG,
  THEME_UNLOCK_BADGES,
} from "../utilities/badgeCatalog";
import { logger } from "../utilities/logger";

/**
 * GET /api/xp
 */
export const getMyXP = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id?.toString();
    if (!userId) return res.status(401).json({ success: false, message: "Not authenticated" });
    const info = await getXPInfo(userId);
    return res.status(200).json({ success: true, ...info });
  } catch (err: any) {
    logger.error("Error getting XP info", { error: err.message });
    return res.status(500).json({ success: false, message: "Failed to get XP info" });
  }
};

/**
 * GET /api/xp/achievements
 * Returns the full badge catalog + the caller's earned badges + live
 * progress for every count-based metric (so the UI can render
 * "3/10" progress bars next to locked badges).
 */
export const getAchievements = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id?.toString();
    if (!userId) return res.status(401).json({ success: false, message: "Not authenticated" });

    const [xpInfo, progress] = await Promise.all([
      getXPInfo(userId),
      computeAchievementProgress(userId),
    ]);

    const earned: string[] = xpInfo.badges || [];
    // Themes the caller has unlocked by earning their badge (xlite is free).
    const unlockedThemes = (Object.keys(THEME_UNLOCK_BADGES) as string[]).filter(
      (theme) => earned.includes(THEME_UNLOCK_BADGES[theme] as string),
    );

    return res.status(200).json({
      success: true,
      catalog: BADGE_CATALOG,
      earned,
      level: xpInfo.level,
      totalXP: xpInfo.totalXP,
      progress,
      themeUnlocks: THEME_UNLOCK_BADGES,
      unlockedThemes,
    });
  } catch (err: any) {
    logger.error("Error getting achievements", { error: err.message });
    return res.status(500).json({ success: false, message: "Failed to get achievements" });
  }
};

/**
 * GET /api/xp/:userId
 */
export const getUserXP = async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId;
    if (!userId || Array.isArray(userId)) return res.status(400).json({ success: false, message: "User ID required" });
    const info = await getXPInfo(userId);
    return res.status(200).json({ success: true, ...info });
  } catch (err: any) {
    logger.error("Error getting user XP", { error: err.message });
    return res.status(500).json({ success: false, message: "Failed to get user XP" });
  }
};
