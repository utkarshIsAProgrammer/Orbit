import mongoose from "mongoose";
import type { Request, Response, NextFunction } from "express";
import Report from "../models/report.model";
import {
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  AppError,
} from "../utilities/errors";
import { logger } from "../utilities/logger";

export const createReport = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const currentUserId = req.user?._id;
  const { contentType, contentId, reason, description } = req.body;

  try {
    if (!currentUserId) return next(new UnauthorizedError("Unauthorized!"));

    if (!contentType || !contentId || !reason) {
      return next(new BadRequestError("Content type, content ID, and reason are required!"));
    }

    const validTypes = ["post", "comment", "user", "message"];
    if (!validTypes.includes(contentType)) {
      return next(new BadRequestError("Invalid content type!"));
    }

    const validReasons = ["spam", "harassment", "nudity", "violence", "hate_speech", "misinformation", "copyright", "other"];
    if (!validReasons.includes(reason)) {
      return next(new BadRequestError("Invalid reason!"));
    }

    const report = new Report({
      reporter: currentUserId,
      contentType,
      contentId,
      reason,
      description: description?.trim() || "",
    });

    await report.save();

    return res.status(201).json({ success: true, message: "Report submitted!" });
  } catch (err: any) {
    logger.error("Error creating report", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

export const getReports = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) return next(new UnauthorizedError("Unauthorized!"));

    // Check if user has admin role (simplified: check user object for admin flag)
    const user = req.user as any;
    if (!user.isAdmin) {
      return next(new ForbiddenError("Admin access required!"));
    }

    const status = req.query.status as string || "pending";
    const limit = Math.min(50, parseInt(req.query.limit as string) || 10);
    const cursor = req.query.cursor as string | undefined;

    const query: any = {};
    if (status !== "all") query.status = status;
    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      query._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const reports = await Report.find(query)
      .populate("reporter", "username fullName profilePic isVerified statusText waitlistPerk")
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = reports.length > limit;
    if (hasMore) {
      reports.pop();
    }
    const nextCursor = reports.slice(-1).shift()?._id || null;

    return res.status(200).json({
      success: true,
      reports,
      hasMore,
      nextCursor,
    });
  } catch (err: any) {
    logger.error("Error getting reports", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

export const reviewReport = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const currentUserId = req.user?._id;
  const { reportId } = req.params;
  const { status, action } = req.body;

  try {
    if (!currentUserId) return next(new UnauthorizedError("Unauthorized!"));
    const user = req.user as any;
    if (!user.isAdmin) return next(new ForbiddenError("Admin access required!"));

    const report = await Report.findById(reportId);
    if (!report) return next(new BadRequestError("Report not found!"));

    // Validate against the schema enums — invalid values would otherwise
    // blow up as a 500 on save instead of a clean 400.
    const VALID_STATUS = ["pending", "reviewed", "dismissed", "action_taken"];
    const VALID_ACTION = ["none", "warning", "mute", "ban", "delete"];
    if (status && !VALID_STATUS.includes(status)) {
      return next(new BadRequestError("Invalid report status!"));
    }
    if (action && !VALID_ACTION.includes(action)) {
      return next(new BadRequestError("Invalid report action!"));
    }

    if (status) report.status = status;
    if (action) report.action = action;
    report.reviewedBy = currentUserId as any;
    report.reviewedAt = new Date();

    await report.save();

    return res.status(200).json({ success: true, report });
  } catch (err: any) {
    logger.error("Error reviewing report", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};
