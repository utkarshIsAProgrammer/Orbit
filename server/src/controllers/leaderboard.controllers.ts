import { Request, Response } from "express";
import { getLeaderboard } from "../services/leaderboardService";
import { getBlockedUserIds } from "../utilities/blockCheck";
import { logger } from "../utilities/logger";

export const leaderboard = async (req: Request, res: Response) => {
  try {
    const rawType = req.query.type as string;
    const validTypes = ["weekly", "monthly", "alltime"];
    const type = (validTypes.includes(rawType) ? rawType : "weekly") as "weekly" | "monthly" | "alltime";
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const scope = req.query.scope === "following" ? "following" : "global";

    // Blocked users must never appear on the viewer's leaderboard.
    let blockedIds: string[] = [];
    const currentUserId = (req as any).user?._id?.toString();
    if (currentUserId) {
      try {
        blockedIds = await getBlockedUserIds(currentUserId);
      } catch (blockErr: any) {
        logger.error("Blocked filter error in leaderboard", {
          error: blockErr.message,
        });
      }
    }

    const data = await getLeaderboard(type, limit, blockedIds, {
      scope,
      viewerId: currentUserId,
    });
    return res.status(200).json({ success: true, ...data });
  } catch (err: any) {
    logger.error("Leaderboard error", { error: err.message });
    return res.status(500).json({ success: false, message: "Failed to get leaderboard" });
  }
};
