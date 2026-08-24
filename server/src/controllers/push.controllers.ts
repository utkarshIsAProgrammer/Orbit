import type { Request, Response } from "express";
import DeviceSubscription from "../models/deviceSubscription.model";
import { validateEnv } from "../configs/env";
import { AppError, BadRequestError, UnauthorizedError } from "../utilities/errors";
import { logger } from "../utilities/logger";

/**
 * POST /api/push/subscribe
 *
 * Register a new push subscription for the current user.
 * Body: { subscription: PushSubscriptionJSON, userAgent?: string }
 */
export const subscribe = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");

    const { subscription, userAgent } = req.body;

    if (!subscription || !subscription.endpoint) {
      throw new BadRequestError("Valid push subscription object is required!");
    }

    if (!subscription.keys?.p256dh || !subscription.keys?.auth) {
      throw new BadRequestError("Subscription must include p256dh and auth keys!");
    }

    // Upsert: update existing subscription or create a new one
    await DeviceSubscription.findOneAndUpdate(
      {
        user: currentUserId,
        "subscription.endpoint": subscription.endpoint,
      },
      {
        $set: {
          user: currentUserId,
          subscription,
          userAgent: userAgent || "",
        },
      },
      { upsert: true, new: true }
    );

    logger.info("Push subscription registered", {
      userId: currentUserId.toString(),
      endpoint: subscription.endpoint.substring(0, 50),
    });

    return res.status(200).json({
      success: true,
      message: "Push subscription registered!",
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error registering push subscription", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * POST /api/push/unsubscribe
 *
 * Remove a push subscription for the current user.
 * Body: { endpoint: string }
 */
export const unsubscribe = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");

    const { endpoint } = req.body;

    if (!endpoint) {
      throw new BadRequestError("Endpoint is required!");
    }

    await DeviceSubscription.deleteOne({
      user: currentUserId,
      "subscription.endpoint": endpoint,
    });

    logger.info("Push subscription removed", {
      userId: currentUserId.toString(),
    });

    return res.status(200).json({
      success: true,
      message: "Push subscription removed!",
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error removing push subscription", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * GET /api/push/vapid-key
 *
 * Returns the VAPID public key so the frontend can subscribe.
 */
export const getVapidKey = async (_req: Request, res: Response) => {
  try {
    const env = validateEnv();
    return res.status(200).json({
      success: true,
      publicKey: env.VAPID_PUBLIC_KEY || "",
    });
  } catch (err: any) {
    logger.error("Error getting VAPID key", { error: err.message });
    throw new AppError("Internal server error!");
  }
};
