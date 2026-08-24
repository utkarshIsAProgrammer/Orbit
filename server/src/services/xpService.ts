import XP, { calculateLevel, LEVEL_THRESHOLDS } from "../models/xp.model";
import { logger } from "../utilities/logger";
import { notifyBadgeUnlock } from "../utilities/notification";

const XP_REWARDS = {
  CREATE_POST: 10,
  COMMENT: 3,
  LIKE: 1,
  RECEIVE_LIKE: 2,
  DAILY_LOGIN: 5,
  SHARE_POST: 3,
  SAVE_POST: 1,
  FOLLOW: 2,
  COMPLETE_MISSION: 25,
  STREAK_BONUS: 15,
};

/**
 * Referral badge tiers — the inviter earns these when their invite code is
 * redeemed. Tiers are checked from lowest to highest so every milestone is
 * awarded as the accepted-invite count grows.
 */
export const REFERRAL_BADGE_TIERS: { count: number; badge: string }[] = [
  { count: 1, badge: "referral_1" },
  { count: 5, badge: "referral_5" },
  { count: 10, badge: "referral_10" },
  { count: 25, badge: "referral_25" },
  { count: 50, badge: "referral_50" },
  { count: 100, badge: "referral_100" },
];

/**
 * Add a single badge to a user's XP record without changing XP totals.
 * Returns true only when the badge was newly awarded (idempotent).
 */
export async function awardBadge(
  userId: string,
  badge: string
): Promise<boolean> {
  try {
    let xpRecord = await XP.findOne({ userId });
    if (!xpRecord) {
      xpRecord = await XP.create({ userId, totalXP: 0, level: 1 });
    }

    const oldBadges = xpRecord.badges || [];
    if (oldBadges.includes(badge)) return false;

    xpRecord.badges = [...oldBadges, badge];
    // Record when it was earned — powers the "latest achievement" display on
    // profiles (badgeHistory is kept in award order, newest last).
    xpRecord.badgeHistory = [
      ...(xpRecord.badgeHistory || []),
      { badge, earnedAt: new Date() },
    ];
    xpRecord.lastActivity = new Date();
    await xpRecord.save();
    return true;
  } catch (err) {
    logger.error("Failed to award badge", {
      userId,
      badge,
      error: (err as Error).message,
    });
    return false;
  }
}

/**
 * Award XP to a user for an action — the actual implementation, run by the
 * BullMQ gamification worker or as the inline fallback.
 */
export async function awardXPInline(
  userId: string,
  action: keyof typeof XP_REWARDS,
  metadata?: Record<string, any>,
  amountOverride?: number
): Promise<{ totalXP: number; level: number; leveledUp: boolean; newBadges: string[] }> {
  try {
    const amount = amountOverride ?? XP_REWARDS[action] ?? 0;
    if (amount === 0) return { totalXP: 0, level: 1, leveledUp: false, newBadges: [] };

    let xpRecord = await XP.findOne({ userId });
    if (!xpRecord) {
      xpRecord = await XP.create({ userId, totalXP: 0, level: 1 });
    }

    // Anti-farm: when the caller supplies a dedupeKey (e.g. `like:<postId>`),
    // skip the award if the same key was already awarded within the TTL. This
    // stops toggle-cycling (like→unlike→like, save→unsave→save) from farming
    // XP while leaving legitimate distinct actions untouched.
    // NOTE: best-effort — the read-modify-write is not atomic, so two racing
    // calls could both pass the window. Awards are fire-and-forget at 1-3 XP,
    // so this is an accepted tradeoff (an atomic rewrite is possible later).
    const dedupeKey = metadata?.dedupeKey as string | undefined;
    if (dedupeKey) {
      const dedupeTtlMs =
        (metadata?.dedupeTtlMs as number | undefined) ?? 15 * 60 * 1000;
      const now = Date.now();
      const window = (xpRecord.recentAwards || []).filter(
        (e) => now - e.at < dedupeTtlMs,
      );
      if (window.some((e) => e.key === dedupeKey)) {
        return {
          totalXP: xpRecord.totalXP,
          level: xpRecord.level,
          leveledUp: false,
          newBadges: [],
        };
      }
      window.push({ key: dedupeKey, at: now });
      xpRecord.recentAwards = window.slice(-30);
    }

    const oldLevel = xpRecord.level;
    const newTotal = xpRecord.totalXP + amount;
    const newLevel = calculateLevel(newTotal);

    const oldBadges = xpRecord.badges || [];
    const newBadges: string[] = [];

    // Check for milestone badges
    if (newTotal >= 100 && !oldBadges.includes("first_100")) newBadges.push("first_100");
    if (newTotal >= 1000 && !oldBadges.includes("first_1k")) newBadges.push("first_1k");
    if (newTotal >= 5000 && !oldBadges.includes("xp_5k")) newBadges.push("xp_5k");
    if (newTotal >= 10000 && !oldBadges.includes("first_10k")) newBadges.push("first_10k");
    if (newTotal >= 25000 && !oldBadges.includes("xp_25k")) newBadges.push("xp_25k");
    if (newTotal >= 50000 && !oldBadges.includes("xp_50k")) newBadges.push("xp_50k");
    if (newTotal >= 100000 && !oldBadges.includes("xp_100k")) newBadges.push("xp_100k");
    if (newTotal >= 200000 && !oldBadges.includes("xp_200k")) newBadges.push("xp_200k");
    if (newTotal >= 500000 && !oldBadges.includes("xp_500k")) newBadges.push("xp_500k");
    if (newTotal >= 1000000 && !oldBadges.includes("xp_1m")) newBadges.push("xp_1m");
    if (newLevel >= 5 && !oldBadges.includes("level_5")) newBadges.push("level_5");
    if (newLevel >= 10 && !oldBadges.includes("level_10")) newBadges.push("level_10");
    if (newLevel >= 15 && !oldBadges.includes("level_15")) newBadges.push("level_15");
    if (newLevel >= 20 && !oldBadges.includes("level_20")) newBadges.push("level_20");
    if (newLevel >= 25 && !oldBadges.includes("level_25")) newBadges.push("level_25");
    if (newLevel >= 30 && !oldBadges.includes("level_30")) newBadges.push("level_30");
    if (newLevel >= 40 && !oldBadges.includes("level_40")) newBadges.push("level_40");
    if (newLevel >= 50 && !oldBadges.includes("level_50")) newBadges.push("level_50");

    xpRecord.totalXP = newTotal;
    xpRecord.level = newLevel;
    xpRecord.lastActivity = new Date();
    if (newBadges.length > 0) {
      xpRecord.badges = [...oldBadges, ...newBadges];
    }
    await xpRecord.save();

    // Celebrate milestone unlocks (fire-and-forget). awardBadge already
    // guards against double-awarding, and awardXP is called from many hot
    // paths, so keep the notification async + non-blocking.
    if (newBadges.length > 0) {
      for (const badge of newBadges) {
        notifyBadgeUnlock(userId, badge).catch(() => {});
      }
    }

    return {
      totalXP: newTotal,
      level: newLevel,
      leveledUp: newLevel > oldLevel,
      newBadges,
    };
  } catch (err) {
    logger.error("Failed to award XP", { userId, action, error: (err as Error).message });
    return { totalXP: 0, level: 1, leveledUp: false, newBadges: [] };
  }
}

/**
 * Award XP to a user for an action.
 *
 * Prefers BullMQ: the multi-query read-modify-write (dedupe check, badge
 * milestones, notification fan-out) runs on a worker instead of the hot
 * request path. When BullMQ isn't configured, falls back to the inline
 * award. Returns the award result when it ran inline, or undefined when the
 * work was queued — callers that NEED the result (invite redeem, mission
 * claim) must call `awardXPInline` directly.
 */
export async function awardXP(
  userId: string,
  action: keyof typeof XP_REWARDS,
  metadata?: Record<string, any>,
  amountOverride?: number
): Promise<{ totalXP: number; level: number; leveledUp: boolean; newBadges: string[] } | undefined> {
  try {
    const { enqueueGamification } = await import("../configs/queue");
    const queued = await enqueueGamification("award_xp", {
      userId,
      action,
      metadata,
      amountOverride,
    });
    if (queued) return undefined;
  } catch (err: any) {
    logger.error("XP enqueue failed — awarding inline", {
      userId,
      action,
      error: err.message,
    });
  }
  return awardXPInline(userId, action, metadata, amountOverride);
}

/**
 * Get XP info for a user.
 */
export async function getXPInfo(userId: string) {
  const xpRecord = await XP.findOne({ userId });
  if (!xpRecord) {
    return { totalXP: 0, level: 1, badges: [], badgeHistory: [], nextLevelXP: LEVEL_THRESHOLDS[1] || 100, currentLevelXP: 0 };
  }

  const currentLevelIndex = xpRecord.level - 1;
  const nextLevelXP = LEVEL_THRESHOLDS[currentLevelIndex + 1] || LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
  const currentLevelMin = LEVEL_THRESHOLDS[currentLevelIndex] || 0;

  const badges = xpRecord.badges || [];
  // badgeHistory (newest FIRST). History is built from the FULL badges array
  // with badgeHistory used purely as a timestamp lookup — this handles three
  // cases uniformly: records with complete history, records created before
  // badgeHistory existed (all timestamps fall back to the record's creation
  // date), and PARTIAL records (some badges pre-history, some after — the
  // pre-history ones get the fallback timestamp, the rest keep their real
  // earnedAt). Without this, an existing user who earns a new badge after
  // deploy would only see the new badges on their profile.
  const historyMap = new Map(
    (xpRecord.badgeHistory || []).map((h) => [h.badge, h.earnedAt]),
  );
  const recordCreatedAt = (xpRecord as any).createdAt as Date | undefined;
  const badgeHistory = badges
    .map((badge) => ({
      badge,
      earnedAt: historyMap.get(badge) || recordCreatedAt || new Date(0),
    }))
    .sort(
      (a, b) =>
        new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime(),
    );

  return {
    totalXP: xpRecord.totalXP,
    level: xpRecord.level,
    badges,
    badgeHistory,
    nextLevelXP,
    currentLevelXP: xpRecord.totalXP - currentLevelMin,
    levelMinXP: currentLevelMin,
  };
}

export { XP_REWARDS };
