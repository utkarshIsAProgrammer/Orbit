import type { Request, Response, NextFunction } from "express";
import { User } from "../models/user.model";
import { BadRequestError, UnauthorizedError, AppError } from "../utilities/errors";
import { logger } from "../utilities/logger";

const VALID_STATES = ["default", "granted", "denied", "unsupported"] as const;
type PermissionState = (typeof VALID_STATES)[number];

function sanitizeState(value: unknown): PermissionState {
  return typeof value === "string" && (VALID_STATES as readonly string[]).includes(value)
    ? (value as PermissionState)
    : "default";
}

/**
 * GET /api/permissions — return the user's persisted device-permission
 * preferences (notifications / camera / microphone) + onboarding-completed
 * flag. The client uses this to decide whether to show the one-time
 * permission onboarding (new signups AND existing users who never did it).
 */
export const getPermissions = async (req: Request, res: Response, next: NextFunction) => {
  const currentUserId = req.user?._id;
  try {
    if (!currentUserId) return next(new UnauthorizedError("Unauthorized!"));

    const user = await User.findById(currentUserId).select("permissionPrefs permissionOnboardingCompleted").lean();
    if (!user) return next(new BadRequestError("User not found!"));

    const prefs = user.permissionPrefs || {};
    return res.status(200).json({
      success: true,
      permissions: {
        notifications: prefs.notifications || "default",
        camera: prefs.camera || "default",
        microphone: prefs.microphone || "default",
      },
      onboardingCompleted: !!user.permissionOnboardingCompleted,
    });
  } catch (err: any) {
    logger.error("Error in getPermissions controller", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * PUT /api/permissions — persist the user's device-permission choices.
 * Body: { permissions?: { notifications?, camera?, microphone? },
 *         onboardingCompleted?: boolean }
 *
 * Marking onboardingCompleted=true is permanent — the first-run screen is
 * never shown again (even if the user skipped individual prompts; the
 * Settings → Permissions page remains the place to enable things later).
 */
export const updatePermissions = async (req: Request, res: Response, next: NextFunction) => {
  const currentUserId = req.user?._id;
  try {
    if (!currentUserId) return next(new UnauthorizedError("Unauthorized!"));

    const body = req.body || {};
    const nextPrefs = body.permissions || {};

    // Only touch the fields the client actually sent — leave the rest as-is.
    // Build dotted $set keys conditionally: never write `undefined` into the
    // update object (some drivers throw on that, and it would clobber state).
    const update: any = {};
    for (const key of ["notifications", "camera", "microphone"] as const) {
      if (nextPrefs[key] !== undefined) {
        update[`permissionPrefs.${key}`] = sanitizeState(nextPrefs[key]);
      }
    }
    if (body.onboardingCompleted === true) {
      update.permissionOnboardingCompleted = true;
      update.permissionOnboardingCompletedAt = new Date();
    }

    if (Object.keys(update).length === 0) {
      return res.status(200).json({ success: true, message: "Nothing to update." });
    }

    await User.findByIdAndUpdate(currentUserId, { $set: update });

    return res.status(200).json({ success: true, message: "Permissions updated!" });
  } catch (err: any) {
    logger.error("Error in updatePermissions controller", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};
