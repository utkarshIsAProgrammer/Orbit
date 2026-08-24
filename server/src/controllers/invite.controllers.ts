import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import UserInvite from "../models/userInvite.model";
import { User } from "../models/user.model";
import XP from "../models/xp.model";
import {
  awardBadge,
  awardXPInline,
  REFERRAL_BADGE_TIERS,
} from "../services/xpService";
import {
  createNotification,
  notifyBadgeUnlock,
} from "../utilities/notification";
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  AppError,
} from "../utilities/errors";
import { logger } from "../utilities/logger";

// ─── Referral reward constants ─────────────────────────────────────
// Starter XP bundle granted to the REDEEMER when they accept an invite code
// (in addition to the inviter's reach boost + referral badges).
const REDEEMER_XP_REWARD = 50;

/** Days of reach boost granted per accepted invite (stacking). */
const BOOST_DAYS_PER_REFERRAL = 7;

/** Hard cap on total reach boost horizon (days). */
const MAX_BOOST_DAYS = 90;

export const generateInviteCode = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) return next(new UnauthorizedError("Unauthorized!"));

    const existing = await UserInvite.findOne({
      inviter: currentUserId,
      status: "pending",
    });

    if (existing) {
      return res.status(200).json({ success: true, inviteCode: existing.inviteCode });
    }

    const inviteCode = crypto.randomBytes(4).toString("hex").toUpperCase();
    const invite = new UserInvite({ inviter: currentUserId, inviteCode });
    await invite.save();

    return res.status(201).json({ success: true, inviteCode });
  } catch (err: any) {
    logger.error("Error generating invite code", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

export const getMyInvites = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) return next(new UnauthorizedError("Unauthorized!"));

    const invites = await UserInvite.find({ inviter: currentUserId })
      .populate("invitedUser", "username fullName profilePic createdAt waitlistPerk")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, invites });
  } catch (err: any) {
    logger.error("Error getting invites", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

export const redeemInviteCode = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const currentUserId = req.user?._id;
  const { code } = req.params;

  try {
    if (!currentUserId) return next(new UnauthorizedError("Unauthorized!"));
    if (!code || typeof code !== "string") return next(new BadRequestError("Invite code is required!"));

    const invite = await UserInvite.findOne({ inviteCode: code.toUpperCase(), status: "pending" });
    if (!invite) return next(new NotFoundError("Invalid or expired invite code!"));

    if (invite.inviter.toString() === currentUserId.toString()) {
      return next(new BadRequestError("You cannot use your own invite code!"));
    }

    invite.invitedUser = currentUserId as any;
    invite.status = "accepted";
    invite.acceptedAt = new Date();
    await invite.save();

    // ── Rewards for the inviter ────────────────────────────────────
    const inviterId = invite.inviter.toString();

    // 1) Reach boost: +7 days per accepted invite, stacking on top of any
    //    active boost (capped at 90 days total horizon). While active, the
    //    inviter's posts score higher in other users' feeds.
    let reachBoostUntil: Date | null = null;
    const inviter = await User.findById(inviterId).select("reachBoostUntil");
    if (inviter) {
      const now = new Date();
      const base =
        inviter.reachBoostUntil && inviter.reachBoostUntil > now
          ? inviter.reachBoostUntil
          : now;
      const extended = new Date(
        base.getTime() + BOOST_DAYS_PER_REFERRAL * 24 * 60 * 60 * 1000
      );
      const cap = new Date(
        now.getTime() + MAX_BOOST_DAYS * 24 * 60 * 60 * 1000
      );
      reachBoostUntil = extended > cap ? cap : extended;
      inviter.reachBoostUntil = reachBoostUntil;
      await inviter.save();
    }

    // Note: the reach boost changes OTHER users' feeds (where the inviter's
    // posts appear). Ranked feeds are cached per-viewer with a 5-min TTL and
    // For-You feeds with 60s, so the boost propagates to viewers within a
    // few minutes — intentional, avoids a cache-storm across all viewers.

    // 2) Tiered referral badges (earned at 1 / 5 / 10 / 25 accepted invites)
    const acceptedCount = await UserInvite.countDocuments({
      inviter: inviterId,
      status: "accepted",
    });
    const newBadges: string[] = [];
    for (const tier of REFERRAL_BADGE_TIERS) {
      if (acceptedCount >= tier.count) {
        const awarded = await awardBadge(inviterId, tier.badge);
        if (awarded) newBadges.push(tier.badge);
      }
    }

    // Celebrate newly unlocked referral badges (fire-and-forget).
    for (const badge of newBadges) {
      notifyBadgeUnlock(inviterId, badge).catch(() => {});
    }

    // 3) Notify the inviter (in-app notification + device push). The
    //    `invite_accepted` type already has push + notification text wiring.
    await createNotification({
      recipient: inviterId,
      sender: currentUserId.toString(),
      type: "invite_accepted",
    });

    // ── Rewards for the REDEEMER ─────────────────────────────────────
    // Dual-sided loop: the inviter gets reach + badges, the redeemer gets a
    // starter XP bundle + a one-time "founder" badge. Everyone walks away
    // with something, so the viral loop is honest on both ends. The redeem
    // card shows the awarded XP/badges in the response, so this runs inline
    // (awardXP would queue it and return undefined).
    const redeemXp = await awardXPInline(
      currentUserId.toString(),
      "COMPLETE_MISSION",
      { reason: "invite_redeemed" },
      REDEEMER_XP_REWARD,
    );
    const founderAwarded = await awardBadge(
      currentUserId.toString(),
      "founder",
    );
    if (founderAwarded) {
      notifyBadgeUnlock(currentUserId.toString(), "founder").catch(() => {});
    }

    return res.status(200).json({
      success: true,
      message: "Invite redeemed!",
      rewards: {
        inviterReachBoostUntil: reachBoostUntil,
        newBadges,
        // Redeemer-side rewards — surfaced by the client redeem card.
        redeemerXp: REDEEMER_XP_REWARD,
        redeemerBadgeAwarded: founderAwarded,
        redeemerNewBadges: redeemXp.newBadges,
        redeemerLeveledUp: redeemXp.leveledUp,
        redeemerLevel: redeemXp.level,
      },
    });
  } catch (err: any) {
    logger.error("Error redeeming invite code", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

export const getInviteStats = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) return next(new UnauthorizedError("Unauthorized!"));

    const [totalInvites, acceptedInvites, user, xpRecord] = await Promise.all([
      UserInvite.countDocuments({ inviter: currentUserId }),
      UserInvite.countDocuments({ inviter: currentUserId, status: "accepted" }),
      User.findById(currentUserId).select("reachBoostUntil").lean(),
      XP.findOne({ userId: currentUserId }).select("badges").lean(),
    ]);

    return res.status(200).json({
      success: true,
      stats: { totalInvites, acceptedInvites },
      reachBoostUntil: (user as any)?.reachBoostUntil || null,
      badges: (xpRecord as any)?.badges || [],
    });
  } catch (err: any) {
    logger.error("Error getting invite stats", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};
