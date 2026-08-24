import { Request, Response } from "express";
import { getTodayMissions, claimMissionReward } from "../services/dailyMissionService";
import { logger } from "../utilities/logger";

/**
 * GET /api/missions/today
 */
export const getMissions = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id?.toString();
    const missions = await getTodayMissions(userId);
    return res.status(200).json({ success: true, ...missions });
  } catch (err: any) {
    logger.error("Error getting missions", { error: err.message });
    return res.status(500).json({ success: false, message: "Failed to get missions" });
  }
};

/**
 * POST /api/missions/claim
 */
export const claimMission = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id?.toString();
    const { type } = req.body;
    if (!type) {
      return res.status(400).json({ success: false, message: "Mission type is required" });
    }
    const result = await claimMissionReward(userId, type);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (err: any) {
    logger.error("Error claiming mission", { error: err.message });
    return res.status(500).json({ success: false, message: "Failed to claim mission" });
  }
};
