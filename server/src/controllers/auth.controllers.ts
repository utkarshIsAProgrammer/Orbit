import type { Request, Response } from "express";
import { User } from "../models/user.model";
import { Waitlist } from "../models/waitlist.model";
import { signupSchema, loginSchema } from "../schemas/user.schema";
import { sendWelcomeMail, sendNewDeviceLoginMail } from "../configs/nodeMailer";
import jwt from "jsonwebtoken";
import { cookieOptions } from "../configs/cookie";
import { setCsrfCookie } from "../middlewares/csrf.middleware";

import { deleteCache, getCache, setCache } from "../configs/cache";
import { clearMemUserCache } from "../middlewares/auth.middleware";
import cloudinary from "../configs/cloudinary";
import { env } from "../configs/env";
import { logger } from "../utilities/logger";
import { canonicalEmail } from "../utilities/waitlistGate";
import {
  decidePerkForNewAccount,
  reconcilePerk,
} from "../services/waitlistPerkService";
import {
  isDisposableEmail,
  hasMailExchange,
} from "../utilities/waitlistProtection";
import { AppError, BadRequestError, NotFoundError, UnauthorizedError, ConflictError, ForbiddenError } from "../utilities/errors";

// signup
export const signup = async (req: Request, res: Response) => {
  const result = signupSchema.safeParse(req.body);

  const cleanupFiles = async (filesObj: any) => {
    if (!filesObj) return;
    const files = filesObj as { [fieldname: string]: any[] };
    const pPic = files.profilePic?.[0];
    const bImg = files.bannerImage?.[0];

    if (pPic?.filename) {
      try { await cloudinary.uploader.destroy(pPic.filename); } catch (e) { logger.error("Cloudinary deletion failed", { error: e }); }
    }
    if (bImg?.filename) {
      try { await cloudinary.uploader.destroy(bImg.filename); } catch (e) { logger.error("Cloudinary deletion failed", { error: e }); }
    }
  };

  try {
    if (!result.success) {
      await cleanupFiles(req.files);
      throw new BadRequestError(result.error.issues[0]?.message || "Invalid data");
    }

    const files = req.files as { [fieldname: string]: any[] } | undefined;
    const profilePic = files?.profilePic?.[0];
    const bannerImage = files?.bannerImage?.[0];

    // Real-email enforcement: temp-mail / disposable addresses are never
    // allowed to create an account, gated or not. This runs before any
    // waitlist lookup so a fake address is rejected with a clear message.
    if (isDisposableEmail(result.data.email)) {
      await cleanupFiles(req.files);
      throw new BadRequestError(
        "Please use a real email address — temporary inboxes can't sign up."
      );
    }

    // MX check (production only): the domain must actually be able to
    // receive mail, so `user@totally-fake-domain.xyz` can't register.
    const atIndex = result.data.email.lastIndexOf("@");
    const signupDomain =
      atIndex > 0 ? result.data.email.slice(atIndex + 1) : "";
    if (signupDomain && !(await hasMailExchange(signupDomain))) {
      await cleanupFiles(req.files);
      throw new BadRequestError(
        "That email address doesn't look real — please double-check it."
      );
    }

    // check user exists — BEFORE the launch gate so a personal access
    // token is never consumed by a signup that is going to fail (e.g. the
    // email already has an account: those users just log in — their link
    // stays intact, and the seat never shows "joined" without a user).
    const userExists = await User.findOne({
      $or: [{ email: result.data.email }, { username: result.data.username }],
    });

    if (userExists) {
      await cleanupFiles(req.files);
      if (userExists.email === result.data.email) {
        throw new ConflictError("Email already exists!");
      }
      throw new ConflictError("Username already exists!");
    }

    // Strip confirmPassword (validated via schema refine) before spreading
    // into the user document — it may never leak into stored user data.
    const { confirmPassword, ...validData } = result.data;
    // confirmPassword is intentionally excluded — it's used only for schema-level password match validation
    void confirmPassword;
    const userData: any = {
      ...validData,
      // Full name is optional at signup now — fall back to the username so
      // no blank display names appear anywhere in the app. Users complete
      // their name/bio later from Settings → Edit Profile.
      fullName: validData.fullName?.trim() || validData.username,
      isEmailVerified: true,
    };

    if (profilePic) {
      userData.profilePic = {
        url: profilePic.path,
        public_id: profilePic.filename,
      };
    }

    if (bannerImage) {
      userData.bannerImage = {
        url: bannerImage.path,
        public_id: bannerImage.filename,
      };
    }

    // Day One perk: only members who joined the waitlist BEFORE their
    // first-ever account get the exclusive Aurum theme + Day One flair +
    // First Orbit ring (visual-only rewards). The decision is locked by an
    // account-creation stamp that survives deletion, so signing up first and
    // joining the waitlist later (with or without deleting the account) can
    // never unlock it. Best-effort — a ledger hiccup never blocks signup.
    userData.waitlistPerk = await decidePerkForNewAccount(
      result.data.email,
    );

    // create and save new user
    const user = new User(userData);
    await user.save();

    // Close the waitlist loop: mark the waitlist record as joined so
    // launch-day sign-ins with the same email get their seat. Matches on the
    // canonical key, falling back to the raw email for legacy records that
    // predate the emailKey field. Fire-and-forget — never let a waitlist
    // bookkeeping failure break signup.
    void Waitlist.findOneAndUpdate(
      {
        $or: [{ emailKey: canonicalEmail(user.email) }, { email: user.email }],
      },
      { $set: { status: "joined", joinedAt: new Date() } }
    ).catch((err) =>
      logger.warn("Failed to link waitlist record on signup", {
        error: err.message,
      })
    );

    // generate jwt and set cookie
    const token = user?.signToken();
    res.cookie("jwt", token, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: "/",
    });

    // Set CSRF protection cookie
    setCsrfCookie(res);

    void sendWelcomeMail({
      email: user.email,
      username: user.username,
    });

    return res.status(201).json({
      success: true,
      message: "User created successfully!",
      token,
      user: {
        _id: user._id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        gender: user.gender,
        bio: user.bio,
        profilePic: user.profilePic,
        bannerImage: user.bannerImage,
        followersCount: user.followersCount,
        followingCount: user.followingCount,
        createdAt: user.createdAt,
        permissionPrefs: user.permissionPrefs || {},
        permissionOnboardingCompleted: !!user.permissionOnboardingCompleted,
        waitlistPerk: !!user.waitlistPerk,
      },
    });
  } catch (err: any) {
    await cleanupFiles(req.files);
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in the signup controller!`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

const MAX_LOGIN_ATTEMPTS = 7;
const LOCK_TIME_MS = 5 * 60 * 1000; // 5 minutes
const ACCOUNT_LOCKOUT_DURATION = 5 * 60 * 1000; // 5 minutes

// login
export const login = async (req: Request, res: Response) => {
  const result = loginSchema.safeParse(req.body);

  try {
    // validate input
    if (!result.success) {
      throw new BadRequestError(result.error.issues[0]?.message || "Invalid data");
    }

    // check existing jwt cookie
    const existingToken = req.cookies?.jwt;

    if (existingToken) {
      let isAlreadyLoggedIn = false;
      try {
        jwt.verify(existingToken, env.JWT_SECRET, {
          issuer: "orbit",
          audience: "orbit-users",
        });
        isAlreadyLoggedIn = true;
      } catch (err: any) {
        logger.info(`Invalid/expired token!`, { error: err.message });
        res.clearCookie("jwt", { ...cookieOptions, path: "/" });
      }

      if (isAlreadyLoggedIn) {
        throw new BadRequestError("You are already logged in!");
      }
    }

    // find user by email OR username
    const user = await User.findOne({
      $or: [
        { email: result.data.usernameOrEmail },
        { username: result.data.usernameOrEmail }
      ]
    });

    if (!user) {
      // Uniform message with the wrong-password case — never reveal whether
      // an email/username is registered (user enumeration).
      throw new UnauthorizedError("Invalid credentials!");
    }

    // check if account is currently locked out
    if (user.lockUntil && user.lockUntil.getTime() > Date.now()) {
      const remainingMinutes = Math.ceil((user.lockUntil.getTime() - Date.now()) / (60 * 1000));
      throw new BadRequestError(
        `Account locked due to too many failed attempts. Please try again in ${remainingMinutes} minute(s).`
      );
    }

    // verify password
    const isMatch = await user.comparePassword(result.data.password);

    if (!isMatch) {
      logger.warn(`Failed login attempt`, { userId: user._id });

      const attempts = (user.loginAttempts || 0) + 1;
      user.loginAttempts = attempts;
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        user.lockUntil = new Date(Date.now() + LOCK_TIME_MS);
      }
      await user.save();

      throw new UnauthorizedError("Invalid credentials!");
    }

    // Reset failed login attempts on successful login
    if (user.loginAttempts !== 0 || user.lockUntil !== null) {
      user.loginAttempts = 0;
      user.lockUntil = null;
      await user.save();
    }

    // ── New-device detection ──────────────────────────────────────────
    // If the client sent a deviceId and this account has never seen it,
    // record the device and email the owner a security alert (fire-and-
    // forget — a slow mailer must never delay the login response). The
    // device list is capped server-side by the model, so this stays cheap.
    // The whole block is best-effort: a device-tracking hiccup must never
    // turn a valid login into a 500, so any error is logged and swallowed.
    const deviceId = result.data.deviceId;
    if (deviceId) {
      try {
        const knownDevices = (user as any).knownDevices || [];
        const known = knownDevices.some((d: any) => d.deviceId === deviceId);
        if (!known) {
          const device = {
            deviceId,
            label: result.data.deviceLabel || "",
            ip: req.ip || "",
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
          };
          (user as any).knownDevices = [...knownDevices.slice(-9), device];
          await user.save();
          void sendNewDeviceLoginMail({
            email: user.email,
            username: user.username,
            deviceLabel: result.data.deviceLabel || "",
            ip: req.ip || "",
          });
        } else {
          // Refresh lastSeenAt so the list reflects real activity (no email).
          const idx = knownDevices.findIndex((d: any) => d.deviceId === deviceId);
          if (idx >= 0 && knownDevices[idx]) {
            knownDevices[idx].lastSeenAt = new Date();
            await user.save();
          }
        }
      } catch (err: any) {
        logger.warn("Failed to record login device", {
          userId: user._id,
          error: err.message,
        });
      }
    }

    // Day One perk — reconcile on every sign-in. Grants founding-member
    // status to genuine waitlist members (joined before their first account)
    // and revokes it from anyone who joined the waitlist after creating an
    // account. Locked by an account-creation stamp that survives deletion,
    // so this can never be gamed. Cheap, best-effort — never block login.
    try {
      const eligible = await reconcilePerk(
        user.email,
        user.createdAt || new Date(),
      );
      if (eligible !== null && eligible !== !!(user as any).waitlistPerk) {
        (user as any).waitlistPerk = eligible;
        await user.save();
      }
    } catch (err: any) {
      logger.warn("Failed to reconcile Day One perk on login", {
        error: err.message,
      });
    }

    // generate jwt
    const token = user.signToken();

    // set cookie
    res.cookie("jwt", token, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    // Set CSRF protection cookie
    setCsrfCookie(res);

    // response
    return res.status(200).json({
      success: true,
      message: "User logged in successfully!",
      token,
      user: {
        _id: user._id,
        fullName: user.fullName,
        username: user.username,
        email: user.email,
        gender: user.gender,
        bio: user.bio,
        profilePic: user.profilePic,
        bannerImage: user.bannerImage,
        followersCount: user.followersCount,
        followingCount: user.followingCount,
        isPrivate: user.isPrivate,
        isOnboarded: user.isOnboarded,
        notificationsEnabled: user.notificationsEnabled,
        isAdmin: user.isAdmin,
        permissionPrefs: user.permissionPrefs || {},
        permissionOnboardingCompleted: !!user.permissionOnboardingCompleted,
        waitlistPerk: !!user.waitlistPerk,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in the login controller!`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

// get current user (me)
export const getCurrentUser = async (req: Request, res: Response) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      throw new UnauthorizedError("Unauthorized access!");
    }

    // Fast path: this endpoint fires on EVERY app open/reload. The auth
    // middleware already caches the user 3-tier (memory → Redis → DB) under
    // `auth:user:` and every mutation (profile edit, logout, ban, admin
    // changes) invalidates that key — so reuse it instead of paying a raw
    // Atlas query each time. Only the whitelisted fields below are returned,
    // so the cached raw doc never leaks otp/password.
    const cacheKey = `auth:user:${userId.toString()}`;
    let user: any = null;
    try {
      user = await getCache(cacheKey);
    } catch (e) {
      logger.error(`Cache get error in getCurrentUser!`, { error: e });
    }
    if (!user) {
      user = await User.findById(userId).select("-password -otp -otpExpiry").lean();
      if (!user) {
        throw new NotFoundError("User not found!");
      }
      try {
        await setCache(cacheKey, user, 300);
      } catch (e) {
        logger.error(`Cache set error in getCurrentUser!`, { error: e });
      }
    }

    const token = req.cookies?.jwt;
    return res.status(200).json({
      success: true,
      token,
      user: {
        _id: user._id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        gender: user.gender,
        bio: user.bio,
        profilePic: user.profilePic,
        bannerImage: user.bannerImage,
        followersCount: user.followersCount,
        followingCount: user.followingCount,
        isPrivate: user.isPrivate,
        isOnboarded: user.isOnboarded,
        notificationsEnabled: user.notificationsEnabled,
        isAdmin: user.isAdmin,
        permissionPrefs: user.permissionPrefs || {},
        permissionOnboardingCompleted: !!user.permissionOnboardingCompleted,
        waitlistPerk: !!user.waitlistPerk,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in the getCurrentUser controller!`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

// logout
export const logout = async (req: Request, res: Response) => {
  try {
    const currentUserId = req.user?._id;
    if (currentUserId) {
      await deleteCache(`auth:user:${currentUserId.toString()}`);
      clearMemUserCache(currentUserId.toString());
    }

    // clear cookies
    res.clearCookie("jwt", { ...cookieOptions, path: "/" });
    res.clearCookie("csrf-token", { path: "/", secure: env.NODE_ENV === "production", sameSite: "lax" });
    res.status(200).json({
      success: true,
      message: "User logged out successfully!",
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in the logout controller!`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

// always return success regardless of email existence (timing-safe)

// catch MongoServerError code 11000 return friendly username taken message
