import type { Request, Response, NextFunction } from "express";
import { UserStreak } from "../models/userStreak.model";
import { DailyReward } from "../models/dailyReward.model";
import {
  BadRequestError,
  UnauthorizedError,
  AppError,
} from "../utilities/errors";
import { logger } from "../utilities/logger";
import { awardXP, awardBadge } from "../services/xpService";
import { notifyBadgeUnlock } from "../utilities/notification";

// ─── Streak milestone badges ───────────────────────────────────────
// Awarded the day the user's daily-reward streak reaches each tier.
const STREAK_BADGE_TIERS: { count: number; badge: string }[] = [
  { count: 3, badge: "streak_3" },
  { count: 7, badge: "streak_7" },
  { count: 30, badge: "streak_30" },
  { count: 100, badge: "streak_100" },
  { count: 150, badge: "streak_150" },
  { count: 200, badge: "streak_200" },
  { count: 365, badge: "streak_365" },
];

export const getMyStreaks = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) return next(new UnauthorizedError("Unauthorized!"));

    let streak = await UserStreak.findOne({ user: currentUserId });
    if (!streak) {
      streak = new UserStreak({ user: currentUserId });
      await streak.save();
    }

    // Daily reward status — claimable once every 24 hours (rolling cooldown).
    // `canClaim` + `nextClaimInMs` drive the client's claim button + countdown.
    let canClaim = true;
    let nextClaimInMs = 0;
    const reward = await DailyReward.findOne({ user: currentUserId });
    if (reward && reward.lastClaimedDate) {
      const msSinceLastClaim = Date.now() - new Date(reward.lastClaimedDate).getTime();
      if (msSinceLastClaim < 24 * 60 * 60 * 1000) {
        canClaim = false;
        nextClaimInMs = Math.round(24 * 60 * 60 * 1000 - msSinceLastClaim);
      }
    }

    // ── Streak break status ─────────────────────────────────────────
    // The streak survives while claims happen within 48 hours of each other
    // (24h cooldown + 24h grace). `timeLeftBeforeBreak` counts down (in
    // minutes) to the moment the current streak would be lost.
    const now = new Date();
    let streakBroken = false;
    let timeLeftBeforeBreak = 0;

    if (streak.lastActiveDate && streak.currentStreak > 0) {
      const msSinceLastActive = Date.now() - new Date(streak.lastActiveDate).getTime();
      const graceMs = 48 * 60 * 60 * 1000;
      if (msSinceLastActive >= graceMs) {
        streakBroken = true;
      } else {
        timeLeftBeforeBreak = Math.floor((graceMs - msSinceLastActive) / 60000);
      }
    }
    const timeLeftHours = Math.floor(timeLeftBeforeBreak / 60);
    const timeLeftMinutes = timeLeftBeforeBreak % 60;

    return res.status(200).json({
      success: true,
      streak: {
        ...(streak as any)._doc,
        dailyRewardClaimed: !canClaim,
        canClaim,
        nextClaimInMs,
        streakBroken,
        timeLeftBeforeBreak,
        timeLeftHours,
        timeLeftMinutes,
      },
    });
  } catch (err: any) {
    logger.error("Error getting streaks", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

export const claimDailyReward = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) return next(new UnauthorizedError("Unauthorized!"));

    const H24 = 24 * 60 * 60 * 1000;
    const H48 = 48 * 60 * 60 * 1000;

    // Ensure a reward doc exists (first claim). The unique `user` index makes
    // concurrent first-claims safe: the loser gets a duplicate-key error here.
    let reward = await DailyReward.findOne({ user: currentUserId });
    if (!reward) {
      try {
        reward = await DailyReward.create({ user: currentUserId });
      } catch (err: any) {
        if (err?.code !== 11000) throw err;
        reward = await DailyReward.findOne({ user: currentUserId });
      }
    }
    if (!reward) {
      throw new AppError("Could not load reward state!");
    }

    const now = new Date();
    const msSinceLastClaim = reward.lastClaimedDate
      ? now.getTime() - new Date(reward.lastClaimedDate).getTime()
      : Infinity;

    // Strict 24-hour rolling cooldown — the reward is claimable once every
    // 24 hours (not at calendar midnight), so users can actually claim it.
    if (msSinceLastClaim < H24) {
      return res.status(400).json({
        success: false,
        message: "You already claimed your reward!",
        nextClaimInMs: Math.round(H24 - msSinceLastClaim),
      });
    }

    // Update streak: consecutive if the previous claim was within the last
    // 48 hours (24h cooldown + 24h grace); otherwise the streak restarts.
    const currentStreak =
      Number.isFinite(msSinceLastClaim) && msSinceLastClaim < H48
        ? reward.currentStreak + 1
        : 1;
    const longestStreak = Math.max(reward.longestStreak, currentStreak);

    // Calculate points based on streak
    const streakMultiplier = Math.min(currentStreak, 30);
    const pointsEarned = 50 + (streakMultiplier - 1) * 10;
    const totalPoints = reward.totalPoints + pointsEarned;

    // Atomic conditional write — the filter only matches while the reward is
    // still claimable, so two parallel claims from different devices/tabs can
    // never double-award. The loser gets `null` and is rejected below.
    const reserved = await DailyReward.findOneAndUpdate(
      {
        user: currentUserId,
        $or: [
          { lastClaimedDate: null },
          { lastClaimedDate: { $lte: new Date(now.getTime() - H24) } },
        ],
      },
      {
        $set: {
          currentStreak,
          longestStreak,
          totalPoints,
          lastClaimedDate: now,
        },
      },
      { new: true }
    );

    if (!reserved) {
      const fresh = await DailyReward.findOne({ user: currentUserId })
        .select("lastClaimedDate")
        .lean();
      const msSince = fresh?.lastClaimedDate
        ? Date.now() - new Date(fresh.lastClaimedDate).getTime()
        : H24;
      return res.status(400).json({
        success: false,
        message: "You already claimed your reward!",
        nextClaimInMs: Math.round(Math.max(0, H24 - msSince)),
      });
    }

    // ── Streak milestone badges ─────────────────────────────────────
    // A claim advances the streak by exactly one, so it can cross AT MOST
    // one tier boundary — only that tier is ever checked. This skips the
    // 6+ wasted findOne calls per claim on already-earned badges (the old
    // loop re-checked every tier on every claim).
    const newBadges: string[] = [];
    for (const tier of STREAK_BADGE_TIERS) {
      if (tier.count <= currentStreak && tier.count > currentStreak - 1) {
        const awarded = await awardBadge(currentUserId.toString(), tier.badge);
        if (awarded) newBadges.push(tier.badge);
      }
    }
    // Celebrate newly unlocked streak badges (fire-and-forget).
    for (const badge of newBadges) {
      notifyBadgeUnlock(currentUserId.toString(), badge).catch(() => {});
    }

    // ── UserStreak: ONE read + ONE save ──────────────────────────────
    // Claiming today advances the personal streak (kept in sync with the
    // DailyReward counters so the UI has a single source of truth).
    let streak = await UserStreak.findOne({ user: currentUserId });
    if (!streak) {
      streak = new UserStreak({
        user: currentUserId,
        currentStreak,
        longestStreak,
        lastActiveDate: now,
      });
    } else {
      streak.currentStreak = currentStreak;
      streak.longestStreak = longestStreak;
      streak.lastActiveDate = now;
    }
    await streak.save();

    // Award XP for daily login streak bonus (fire-and-forget)
    awardXP(currentUserId.toString(), "STREAK_BONUS").catch(() => {});

    return res.status(200).json({
      success: true,
      reward: {
        pointsEarned,
        currentStreak,
        longestStreak,
        totalPoints,
        canClaim: false,
        nextClaimInMs: H24,
        newBadges,
      },
    });
  } catch (err: any) {
    logger.error("Error claiming daily reward", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

export const getRewardStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) return next(new UnauthorizedError("Unauthorized!"));

    let reward = await DailyReward.findOne({ user: currentUserId });
    if (!reward) {
      reward = new DailyReward({ user: currentUserId });
      await reward.save();
    }

    const now = new Date();
    const msSinceLastClaim = reward.lastClaimedDate
      ? now.getTime() - new Date(reward.lastClaimedDate).getTime()
      : Infinity;
    const canClaim = msSinceLastClaim >= 24 * 60 * 60 * 1000;
    const nextClaimInMs = canClaim
      ? 0
      : Math.round(24 * 60 * 60 * 1000 - msSinceLastClaim);

    // Preview for the NEXT claim: streak will be currentStreak + 1 (capped at
    // 30), so align with the claim math to avoid an off-by-10 at the cap.
    const nextRewardPoints = 50 + (Math.min(reward.currentStreak + 1, 30) - 1) * 10;

    return res.status(200).json({
      success: true,
      reward: {
        currentStreak: reward.currentStreak,
        longestStreak: reward.longestStreak,
        totalPoints: reward.totalPoints,
        claimedToday: !canClaim,
        canClaim,
        nextClaimInMs,
        nextRewardPoints,
      },
    });
  } catch (err: any) {
    logger.error("Error getting reward status", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};



// use MongoDB findOneAndUpdate with upsert for atomic streak increment
