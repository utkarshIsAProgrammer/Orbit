import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { Waitlist } from "../models/waitlist.model";
import { User } from "../models/user.model";
import { joinWaitlistSchema } from "../schemas/waitlist.schema";
import { canonicalEmail } from "../utilities/waitlistGate";
import {
  isDisposableEmail,
  isSubmissionTooFast,
  hasMailExchange,
  verifyTurnstileToken,
} from "../utilities/waitlistProtection";
import { sendWaitlistConfirmationMail } from "../configs/nodeMailer";
import { env } from "../configs/env";
import { redis } from "../configs/redis";
import { AppError, BadRequestError, ForbiddenError } from "../utilities/errors";
import { logger } from "../utilities/logger";

/**
 * Daily budget guard for waitlist confirmation emails.
 *
 * Brevo's free tier allows ~300 emails/day TOTAL across the app (OTPs,
 * welcome, password resets, waitlist). A scripted waitlist flood (or even a
 * real viral spike) must never be able to spend the whole day's quota on
 * confirmation mails — that would silently break OTP/welcome delivery.
 * We cap waitlist confirmations at WAITLIST_EMAIL_DAILY_BUDGET per calendar
 * day; beyond that, joins still succeed (seat reserved) but no email is sent.
 */
const WAITLIST_EMAIL_DAILY_BUDGET = 200;
const EMAIL_QUOTA_KEY = "email:quota:waitlist:daily";

async function waitlistEmailBudgetAvailable(): Promise<boolean> {
  try {
    const count = await redis.incr(EMAIL_QUOTA_KEY);
    if (count === 1) {
      // First email of the day — set the key to expire at end of day.
      const msUntilMidnight =
        new Date(new Date().setHours(24, 0, 0, 0)).getTime() - Date.now();
      await redis.expire(EMAIL_QUOTA_KEY, Math.max(60, Math.floor(msUntilMidnight / 1000)));
    }
    return Number(count) <= WAITLIST_EMAIL_DAILY_BUDGET;
  } catch (err: any) {
    // Redis down → fail OPEN for sending (emails are fire-and-forget; the
    // per-IP waitlist limiter still throttles floods). Never block a join.
    logger.warn("Waitlist email budget check failed, allowing send", {
      error: err.message,
    });
    return true;
  }
}

/**
 * Send the confirmation email and mark the seat invited. Fire-and-forget:
 * never blocks the response, never fails the request if SMTP is down.
 */
const notifyWaitlist = (entry: {
  email: string;
  name?: string | null;
  position: number;
  unsubToken?: string | null;
}) => {
  // Opt-out link must point at the API itself. LANDING_PAGE_URL is NOT a
  // safe fallback — it's the Vercel origin (no /api there), so a link built
  // from it would 404. When PUBLIC_API_URL is unset, omit the link rather
  // than email a broken one.
  const apiBase = env.PUBLIC_API_URL.replace(/\/$/, "");
  const removeUrl = apiBase && entry.unsubToken
    ? `${apiBase}/api/waitlist/remove/${entry.unsubToken}`
    : null;
  if (!apiBase && entry.unsubToken && env.NODE_ENV === "production") {
    logger.warn(
      "PUBLIC_API_URL is not set — confirmation emails will not include an opt-out link."
    );
  }

  // Enforce the daily quota BEFORE sending — join still succeeds either way.
  void (async () => {
    if (!(await waitlistEmailBudgetAvailable())) {
      logger.warn("Waitlist confirmation email skipped — daily budget reached", {
        emailKey: canonicalEmail(entry.email),
      });
      return;
    }
    const sent = await sendWaitlistConfirmationMail({
      email: entry.email,
      username: entry.name || "there",
      position: entry.position,
      removeUrl,
    });
    if (!sent) return;
    await Waitlist.updateOne(
      { emailKey: canonicalEmail(entry.email) },
      { $set: { status: "invited", invitedAt: new Date() } }
    ).catch((err: any) =>
      logger.warn("Failed to mark waitlist record invited", { error: err.message })
    );
  })();
};

/** Minimum gap between confirmation emails for a re-joined pending seat. */
const RE_NOTIFY_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * POST /api/waitlist/join — Public. Add an email to the waitlist.
 * Idempotent: joining twice is a soft success, not an error.
 */
export const joinWaitlist = async (req: Request, res: Response) => {
  try {
    const result = joinWaitlistSchema.safeParse(req.body);
    if (!result.success) {
      throw new BadRequestError(
        result.error.issues[0]?.message || "Invalid data"
      );
    }
    const { email, name, source, website, formStart, turnstileToken } =
      result.data;

    // ── Anti-bot / anti-spam layers ─────────────────────────────────
    // 1. Honeypot: bots fill the hidden `website` field; humans never see
    //    it. Pretend success (identical shape to a real join) so bots move
    //    on — nothing is stored, nothing is emailed.
    if (website && website.length > 0) {
      return res.status(201).json({
        success: true,
        alreadyJoined: false,
        message: "You're in — see you on launch day.",
        position: null,
      });
    }

    // 2. Form timer (production only): the submission must have come from
    //    the real form, rendered >= MIN_FORM_MS ago. Direct scripted POSTs
    //    are rejected.
    if (isSubmissionTooFast(formStart)) {
      throw new BadRequestError(
        "That was too quick — take a moment and try again."
      );
    }

    // 3. Disposable-email blocklist (always on) — temp-mail addresses are
    //    junk leads, not real users.
    if (isDisposableEmail(email)) {
      throw new BadRequestError(
        "Please use a permanent email address — temporary inboxes don't qualify."
      );
    }

    // 4. MX check (production only): the domain must be able to receive
    //    mail, so `user@totally-fake-domain.xyz` can't sneak in.
    const at = email.lastIndexOf("@");
    const domain = at > 0 ? email.slice(at + 1) : "";
    if (domain && !(await hasMailExchange(domain))) {
      throw new BadRequestError(
        "That email address doesn't look real — please double-check it."
      );
    }

    // 5. Cloudflare Turnstile (only when TURNSTILE_SECRET_KEY is set):
    //    verify the widget token, fail-closed.
    const okTurnstile = await verifyTurnstileToken(turnstileToken);
    if (!okTurnstile) {
      throw new BadRequestError(
        "Please complete the human check before reserving your seat."
      );
    }

    const emailKey = canonicalEmail(email);

    // Dedupe on the canonical form — `User.Name+ads@Gmail.com` and
    // `username@gmail.com` resolve to the same seat, so no double-joining.
    const existing = await Waitlist.findOne({ emailKey }).lean();
    if (existing) {
      const position = await Waitlist.countDocuments({
        createdAt: { $lte: existing.createdAt },
      });
      // Re-joiner who never received the confirmation yet? Send it now —
      // but never more than once per 10 minutes, so a pending address can't
      // be email-bombed by repeated submissions.
      const cooldownPassed =
        !existing.invitedAt ||
        Date.now() - new Date(existing.invitedAt).getTime() >
          RE_NOTIFY_COOLDOWN_MS;
      if (existing.status === "pending" && cooldownPassed) {
        notifyWaitlist({
          email: existing.email,
          name: existing.name,
          position,
          unsubToken: existing.unsubToken,
        });
      }
      return res.status(200).json({
        success: true,
        alreadyJoined: true,
        message: "You're already on the list — we've kept your seat warm.",
        position,
        // the exact address on file — signup must use this exact address
        email: existing.email,
      });
    }

    const entry = await Waitlist.create({
      email,
      emailKey,
      name: name || null,
      source: source || null,
      status: "pending",
      unsubToken: crypto.randomBytes(24).toString("hex"),
    });

    const position = await Waitlist.countDocuments({
      createdAt: { $lte: entry.createdAt },
    });

    logger.info(`New waitlist signup`, {
      email,
      position,
      source: source || null,
    });

    // Confirmation email with their seat number (fire-and-forget).
    notifyWaitlist({ email, name, position, unsubToken: entry.unsubToken });

    return res.status(201).json({
      success: true,
      alreadyJoined: false,
      message: "You're in — see you on launch day.",
      position,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in joinWaitlist", { error: err.message });
    throw new AppError("Could not join the waitlist right now. Please try again.");
  }
};

/**
 * GET /api/waitlist/remove/:token — Public. One-click opt-out from the
 * confirmation email. Deletes the record so the email is fully off the list.
 */
export const removeFromWaitlist = async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    if (!token || typeof token !== "string" || token.length > 128) {
      throw new BadRequestError("Invalid link.");
    }

    const removed = await Waitlist.findOneAndDelete({ unsubToken: token });
    if (!removed) {
      // Token unknown or already removed — treat as success (idempotent)
      // so re-clicking the link never looks broken.
      return res
        .status(200)
        .type("html")
        .send(
          "<html><body style='font-family:sans-serif;background:#0a0a0c;color:#e4e4e7;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'><div style='text-align:center'><h1 style='font-weight:600'>You're all set.</h1><p style='color:#a1a1aa'>That email is no longer on the ORBIT waitlist.</p></div></body></html>"
        );
    }

    logger.info("Waitlist entry removed via opt-out link", {
      emailKey: removed.emailKey,
    });
    return res
      .status(200)
      .type("html")
      .send(
        "<html><body style='font-family:sans-serif;background:#0a0a0c;color:#e4e4e7;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'><div style='text-align:center'><h1 style='font-weight:600'>You've been removed.</h1><p style='color:#a1a1aa'>This email is no longer on the ORBIT waitlist. Sorry to see you go — the door stays open if you change your mind.</p></div></body></html>"
      );
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in removeFromWaitlist", { error: err.message });
    throw new AppError("Could not process that link. Please try again.");
  }
};

/**
 * GET /api/waitlist/count — Public. Total people already on the list.
 * Feeds the "already in line" social-proof counter on the landing page.
 */
export const getWaitlistCount = async (_req: Request, res: Response) => {
  try {
    const count = await Waitlist.countDocuments();
    return res.status(200).json({ success: true, count });
  } catch (err: any) {
    logger.error("Error in getWaitlistCount", { error: err.message });
    throw new AppError("Could not load the waitlist count.");
  }
};

/**
 * GET /api/waitlist — Admin only. Paginated list of everyone on the list.
 */
export const listWaitlist = async (
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  try {
    const admin = await User.findById(req.user?._id).select("isAdmin").lean();
    if (!admin || !(admin as any).isAdmin) {
      throw new ForbiddenError("Admin access required!");
    }

    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50)
    );

    const [entries, total] = await Promise.all([
      Waitlist.find()
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Waitlist.countDocuments(),
    ]);

    return res.status(200).json({
      success: true,
      entries,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Error in listWaitlist", { error: err.message });
    throw new AppError("Could not load the waitlist.");
  }
};


