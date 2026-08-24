import type { Request, Response } from "express";
import mongoose from "mongoose";
import crypto from "crypto";
import { ApiKey } from "../models/apiKey.model";
import { AppError, BadRequestError, NotFoundError, UnauthorizedError } from "../utilities/errors";
import { logger } from "../utilities/logger";

/**
 * POST /api/developer/keys — Generate a new API key.
 */
export const generateApiKey = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id;
  const name = typeof req.body.name === "string" ? req.body.name : "";
  const permissions = req.body.permissions;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");
    if (!name || !name.trim()) throw new BadRequestError("Key name is required!");

    const rawKey = `orb_${crypto.randomBytes(24).toString("hex")}`;
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.substring(0, 8);

    // "admin" is intentionally NOT offerable — a user must never be able to
    // mint an admin-scoped key (privilege escalation). Keys only carry read/
    // write, which mirror the owner's own permissions.
    const validPermissions = ["read", "write"];
    const perms = Array.isArray(permissions)
      ? permissions.filter((p: string) => validPermissions.includes(p))
      : ["read"];

    if (perms.length === 0) perms.push("read");

    const apiKey = new ApiKey({
      user: currentUserId,
      name: name.trim(),
      keyHash,
      keyPrefix,
      permissions: perms,
    });

    await apiKey.save();

    return res.status(201).json({
      success: true,
      message: "API key generated! Save it now — it won't be shown again.",
      apiKey: {
        _id: apiKey._id,
        name: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
        permissions: apiKey.permissions,
        rawKey, // Only shown once
        createdAt: apiKey.createdAt,
      },
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in generateApiKey", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * GET /api/developer/keys — List API keys.
 */
export const getApiKeys = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");

    const keys = await ApiKey.find({ user: currentUserId })
      .select("name keyPrefix permissions isActive lastUsedAt createdAt")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, keys });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in getApiKeys", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * DELETE /api/developer/keys/:keyId — Revoke an API key.
 */
export const revokeApiKey = async (req: Request, res: Response) => {
  const keyId: string = req.params.keyId as string;
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");
    if (!mongoose.Types.ObjectId.isValid(keyId)) throw new BadRequestError("Invalid key ID!");

    const key = await ApiKey.findOneAndUpdate(
      { _id: keyId, user: currentUserId },
      { isActive: false },
      { new: true },
    );

    if (!key) throw new NotFoundError("API key not found!");

    return res.status(200).json({ success: true, message: "API key revoked!" });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in revokeApiKey", { error: err.message });
    throw new AppError("Internal server error!");
  }
};
