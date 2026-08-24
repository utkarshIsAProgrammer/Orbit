import UserMission, { DAILY_MISSIONS } from "../models/dailyMission.model";
import { awardXPInline } from "./xpService";
import { checkBadgesAndNotify } from "./badgeService";
import { logger } from "../utilities/logger";

/**
 * Get the current date as YYYY-MM-DD.
 */
function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Initialize missions for today for a user if not already initialized.
 */
async function initTodayMissions(userId: string) {
  const today = getToday();
  let record = await UserMission.findOne({ userId, date: today });
  if (!record) {
    record = await UserMission.create({
      userId,
      date: today,
      missions: DAILY_MISSIONS.map((m) => ({
        type: m.type,
        current: 0,
        target: m.target,
        completed: false,
        claimed: false,
      })),
    });
  }
  return record;
}

/**
 * Progress a mission type for a user — the actual implementation, run by the
 * BullMQ gamification worker or as the inline fallback.
 */
export async function progressMissionInline(userId: string, type: string, amount: number = 1) {
  try {
    const record = await initTodayMissions(userId);
    const mission = record.missions.find((m) => m.type === type);
    if (!mission || mission.completed) return;

    mission.current = Math.min(mission.current + amount, mission.target);
    if (mission.current >= mission.target) {
      mission.completed = true;
    }

    // Check if all missions are completed
    record.allCompleted = record.missions.every((m) => m.completed);

    await record.save();
  } catch (err) {
    logger.error("Failed to progress mission", { userId, type, error: (err as Error).message });
  }
}

/**
 * Progress a mission type for a user.
 *
 * Prefers BullMQ (the find-or-create + upsert runs on a worker); falls back
 * to the inline implementation when BullMQ isn't configured.
 */
export async function progressMission(userId: string, type: string, amount: number = 1) {
  try {
    const { enqueueGamification } = await import("../configs/queue");
    const queued = await enqueueGamification("progress_mission", {
      userId,
      type,
      amount,
    });
    if (queued) return;
  } catch (err: any) {
    logger.error("Mission progress enqueue failed — running inline", {
      userId,
      type,
      error: err.message,
    });
  }
  await progressMissionInline(userId, type, amount);
}

/**
 * Claim rewards for a completed mission.
 */
export async function claimMissionReward(userId: string, missionType: string) {
  try {
    const today = getToday();
    const record = await UserMission.findOne({ userId, date: today });
    if (!record) return { success: false, message: "No missions found for today" };

    const mission = record.missions.find((m) => m.type === missionType);
    if (!mission) return { success: false, message: "Mission not found" };
    if (!mission.completed) return { success: false, message: "Mission not completed yet" };
    if (mission.claimed) return { success: false, message: "Reward already claimed" };

    // Atomic update to prevent duplicate XP claim race conditions
    const updatedRecord = await UserMission.findOneAndUpdate(
      {
        _id: record._id,
        "missions.type": missionType,
        "missions.claimed": false,
      },
      {
        $set: { "missions.$.claimed": true },
      },
      { new: true }
    );

    if (!updatedRecord) {
      return { success: false, message: "Reward already claimed" };
    }

    // Check if all claimed and update flag
    if (updatedRecord.missions.every((m) => m.claimed)) {
      await UserMission.findByIdAndUpdate(record._id, { $set: { allClaimed: true } });
    }

    // Award XP equal to the mission's actual xpReward (per-mission amounts
    // differ: 25/20/15/15/20/10), not the flat COMPLETE_MISSION value — so
    // the "Claimed X XP!" message matches what the user actually receives.
    const missionDef = DAILY_MISSIONS.find((m) => m.type === missionType);
    const missionXP = missionDef?.xpReward || 25;
    // Claim is an explicit user action whose response shows the XP gained —
    // run inline (awardXP would queue it and return undefined).
    const xpResult = await awardXPInline(userId, "COMPLETE_MISSION", undefined, missionXP);
    // Achievement badges (fire-and-forget)
    checkBadgesAndNotify(userId, "mission").catch(() => {});

    return {
      success: true,
      message: `Claimed ${missionXP} XP!`,
      xp: xpResult,
    };
  } catch (err) {
    logger.error("Failed to claim mission reward", { userId, missionType, error: (err as Error).message });
    return { success: false, message: "Failed to claim reward" };
  }
}

/**
 * Get today's missions for a user.
 */
export async function getTodayMissions(userId: string) {
  try {
    const record = await initTodayMissions(userId);
    return {
      date: record.date,
      missions: record.missions,
      allCompleted: record.allCompleted,
      allClaimed: record.allClaimed,
    };
  } catch (err) {
    logger.error("Failed to get missions", { userId, error: (err as Error).message });
    return { date: getToday(), missions: DAILY_MISSIONS.map((m) => ({ ...m, current: 0, completed: false, claimed: false })), allCompleted: false, allClaimed: false };
  }
}
