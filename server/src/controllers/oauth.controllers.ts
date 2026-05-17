import { Request, Response } from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import jwt from "jsonwebtoken";
import crypto, { randomBytes } from "crypto";
import mongoose from "mongoose";
import { User } from "../models/user.model";
import { Waitlist } from "../models/waitlist.model";
import { env } from "../configs/env";
import { cookieOptions } from "../configs/cookie";
import { setCsrfCookie } from "../middlewares/csrf.middleware";
import { getCache, setCache, deleteCache } from "../configs/cache";
import { sendWelcomeMail, sendNewDeviceLoginMail } from "../configs/nodeMailer";
import { logger } from "../utilities/logger";
import { canonicalEmail } from "../utilities/waitlistGate";
import {
  decidePerkForNewAccount,
  reconcilePerk,
} from "../services/waitlistPerkService";

/**
 * Serialize user ID into the session (Passport session serialization).
 * Since we use JWT (not sessions), this is a no-op — we just pass through.
 */
passport.serializeUser((user: any, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await User.findById(id).select("-password");
    done(null, user as any);
  } catch (err) {
    done(err, null);
  }
});

/**
 * Google OAuth is OPTIONAL — the server must boot (and serve the waitlist)
 * even when no GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are configured. The
 * strategy is only registered when credentials exist; the routes below return
 * a 503 otherwise instead of crashing at startup.
 */
const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

if (googleConfigured) {
  /**
   * Configure the Google OAuth2.0 strategy.
   * If a user with the Google ID exists, log them in.
   * If a user with the same email exists, link the Google account.
   * Otherwise, create a new user.
   */
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        callbackURL: env.GOOGLE_CALLBACK_URL || `http://localhost:${env.PORT}/api/auth/google/callback`,
        scope: ["profile", "email"],
        proxy: true,
      },
      async (_accessToken, _refreshToken, profile, done) => {
      try {
        const googleId = profile.id;
        const email = profile.emails?.[0]?.value || "";
        const fullName = profile.displayName || "";
        const avatarUrl = profile.photos?.[0]?.value || "";

        // 1. Check if user exists with this Google ID
        let user = await User.findOne({ oauthProvider: "google", oauthId: googleId });

        if (user) {
          // Update avatar if they don't have one or it changed
          if (avatarUrl && (!user.profilePic?.url || user.profilePic.url !== avatarUrl)) {
            user.profilePic = { url: avatarUrl, public_id: "" };
            await user.save();
          }
          return done(null, user as any);
        }

        // 2. Check if a user with this email already exists
        if (email) {
          user = await User.findOne({ email });

          if (user) {
            // Link Google account to existing user
            user.oauthProvider = "google";
            user.oauthId = googleId;
            if (avatarUrl && !user.profilePic?.url) {
              user.profilePic = { url: avatarUrl, public_id: "" };
            }
            // Day One perk — reconcile (same rule as local login): grant
            // only to members who joined the waitlist before their first
            // account, revoke from anyone who joined after. Locked by an
            // account-creation stamp that survives deletion.
            if (email) {
              const eligible = await reconcilePerk(
                email,
                (user as any).createdAt || new Date(),
              );
              if (
                eligible !== null &&
                eligible !== !!(user as any).waitlistPerk
              ) {
                (user as any).waitlistPerk = eligible;
              }
            }
            await user.save();
            return done(null, user as any);
          }
        }

        // 3. Create a brand new user from Google profile
        // Generate a unique username from the email or display name
        let baseUsername = email.split("@")[0] || fullName.replace(/\s+/g, "").toLowerCase();
        // Remove special characters and ensure valid username
        baseUsername = baseUsername.replace(/[^a-zA-Z0-9_.]/g, "").toLowerCase();
        if (!baseUsername) baseUsername = `user${googleId.slice(-6)}`;

        // Ensure username is unique by appending numbers if needed
        let username = baseUsername;
        let counter = 1;
        while (await User.findOne({ username })) {
          username = `${baseUsername}${counter}`;
          counter++;
        }

        user = new User({
          username,
          fullName,
          email,
          oauthProvider: "google",
          oauthId: googleId,
          profilePic: avatarUrl ? { url: avatarUrl, public_id: "" } : { url: "", public_id: "" },
          isEmailVerified: true,
          // Generate a strong random password for OAuth users.
          // They'll never need this since they log in via Google,
          // but it satisfies the schema minlength:8 validator and
          // gets hashed by the pre-save hook.
          password: randomBytes(32).toString("hex"),
        });

        // Day One perk — same rule as local signup: only members who joined
        // the waitlist before their first-ever account qualify. Locked by an
        // account-creation stamp that survives deletion; best-effort — never
        // block OAuth over it.
        if (email) {
          user.waitlistPerk = await decidePerkForNewAccount(email);
        }

          await user.save();
          // Brand-new Google signups get the same welcome email as
          // email/password signups (fire-and-forget — mail must never
          // block the OAuth redirect).
          void sendWelcomeMail({
            email: user.email,
            username: user.username,
          });
          return done(null, user as any);
        } catch (err) {
          logger.error("Google OAuth error", { error: err });
          return done(err as Error, undefined);
        }
      },
    ),
  );
}

/**
 * Initiate Google OAuth login.
 * GET /api/auth/google
 */
export const googleAuth = (req: Request, res: Response) => {
  if (!googleConfigured) {
    return res.status(503).json({
      success: false,
      message: "Google sign-in is not configured on this server yet.",
    });
  }

  // Anti-CSRF state: a random token tied to this browser, verified on the
  // callback. Without it, an attacker could complete their own Google login
  // in a victim's browser (login CSRF) or poison the email-linking step that
  // attaches a Google ID to an existing account.
  //
  // The state is stored SERVER-SIDE (Redis) as the authoritative check, and
  // ALSO set as a cookie for defense-in-depth. The cookie alone is NOT
  // reliable: it is set inside a 302 redirect, and mobile browsers (iOS
  // Safari ITP, Chrome third-party-cookie blocking, in-app browsers) drop or
  // cap cookies set in redirect chains — which made the callback's state
  // check fail on touch devices ("Google Sign-In failed") even though the
  // exact same flow worked on desktop. Verifying against Redis makes the
  // check cookie-independent, so the callback completes regardless.
  const state = randomBytes(32).toString("hex");
  void setCache(`oauth:state:${state}`, { valid: true }, 600).catch(() => {});
  res.cookie("oauth_state", state, {
    ...cookieOptions,
    maxAge: 10 * 60 * 1000,
    path: "/",
  });

  // Carry the browser's device identity through the redirect so the callback
  // can run the same new-device security email as the local login flow. The
  // client appends ?deviceId=&deviceLabel= when opening the Google URL.
  const deviceId =
    typeof req.query.deviceId === "string" ? req.query.deviceId.slice(0, 200) : "";
  const deviceLabel =
    typeof req.query.deviceLabel === "string" ? req.query.deviceLabel.slice(0, 200) : "";
  if (deviceId) {
    res.cookie("oauth_device", JSON.stringify({ deviceId, deviceLabel }), {
      ...cookieOptions,
      maxAge: 10 * 60 * 1000,
      path: "/",
    });
  }

  return passport.authenticate("google", {
    session: false,
    scope: ["profile", "email"],
    state,
  })(req, res);
};

/**
 * Constant-time comparison for the OAuth state (same-length strings).
 */
function statesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Exchange a one-time OAuth code for a session.
 * POST /api/auth/oauth-exchange
 *
 * Body: { code }
 *
 * Sets the JWT + CSRF cookies in an XHR response — the exact channel the
 * normal login flow uses, which works reliably on mobile (the redirect-set
 * cookies from the callback may be dropped by ITP/third-party-cookie
 * blocking). Falls back to the already-valid jwt cookie when the code
 * lookup misses (dev/test with no Redis, or a desktop where the callback's
 * redirect cookie survived).
 */
export const oauthExchange = async (req: Request, res: Response) => {
  try {
    const code =
      typeof req.body?.code === "string" ? req.body.code.slice(0, 200) : "";
    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Missing exchange code.",
      });
    }

    let userId: string | null = null;
    try {
      const record = await getCache<{ userId: string }>(`oauth:exchange:${code}`);
      if (record?.userId) {
        userId = record.userId;
        // Single-use — delete so a captured code can't be replayed.
        await deleteCache(`oauth:exchange:${code}`);
      }
    } catch (err: any) {
      logger.warn("OAuth exchange Redis lookup failed", { error: err.message });
    }

    // Fallback: the callback's redirect cookie already authenticated the
    // browser (desktop / dev). Just reuse that session.
    if (!userId && req.cookies?.jwt) {
      try {
        const decoded = jwt.verify(req.cookies.jwt, env.JWT_SECRET, {
          algorithms: ["HS256"],
          issuer: "orbit",
          audience: "orbit-users",
        }) as { userId?: string };
        if (decoded?.userId) userId = decoded.userId;
      } catch {
        // invalid/expired cookie — fall through to the 401 below
      }
    }

    if (!userId || !mongoose.isValidObjectId(userId)) {
      return res.status(401).json({
        success: false,
        message: "Exchange code invalid or expired.",
      });
    }

    const user = await User.findById(userId).select("-password -otp -otpExpiry");
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Account no longer exists.",
      });
    }

    // Set the session the same way login/signup do — XHR response cookies.
    const token = user.signToken();
    res.cookie("jwt", token, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });
    setCsrfCookie(res);

    return res.status(200).json({
      success: true,
      token,
      user: {
        _id: user._id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        profilePic: user.profilePic,
        bannerImage: user.bannerImage,
        bio: user.bio,
        isAdmin: user.isAdmin,
        isVerified: user.isVerified,
        isMuted: user.isMuted,
        isEmailVerified: user.isEmailVerified,
        oauthProvider: user.oauthProvider,
        permissionOnboardingCompleted: user.permissionOnboardingCompleted,
      },
    });
  } catch (err: any) {
    logger.error("OAuth exchange handler error", { error: err.message });
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};

/**
 * Google OAuth callback.
 * GET /api/auth/google/callback
 *
 * On success, sets JWT cookie and CSRF cookie, then redirects to the frontend.
 * On failure, redirects to the frontend with an error query param.
 */
export const googleAuthCallback = async (req: Request, res: Response) => {
  if (!googleConfigured) {
    return res.status(503).json({
      success: false,
      message: "Google sign-in is not configured on this server yet.",
    });
  }

  // Verify the anti-CSRF state: the value Google echoes back must be one we
  // issued. Authoritative check is the server-side store (Redis) — set when
  // the flow started and deleted after first use, so it can't be replayed.
  // The httpOnly cookie (set in the START redirect) is a fallback for
  // environments where Redis is unavailable (dev/test) — but it is NOT
  // relied upon, because mobile browsers drop redirect-set cookies.
  const receivedState =
    typeof req.query.state === "string" ? req.query.state : null;
  let stateValid = false;
  if (receivedState) {
    try {
      const stored = await getCache<{ valid: boolean }>(`oauth:state:${receivedState}`);
      if (stored?.valid) {
        stateValid = true;
        // One-time use — delete immediately so a stolen state can't replay.
        await deleteCache(`oauth:state:${receivedState}`);
      }
    } catch (err: any) {
      logger.warn("OAuth state Redis lookup failed", { error: err.message });
    }
    // Fallback for dev/test where Redis is a no-op: the cookie still works.
    const expectedState =
      typeof req.cookies?.oauth_state === "string"
        ? req.cookies.oauth_state
        : null;
    if (!stateValid && expectedState && statesMatch(expectedState, receivedState)) {
      stateValid = true;
    }
  }
  if (!stateValid) {
    logger.warn("OAuth callback state mismatch — rejecting", {
      ip: req.ip,
    });
    res.clearCookie("oauth_state", { ...cookieOptions, path: "/" });
    return res.redirect(`${env.CLIENT_URL.replace(/\/$/, "")}/?oauth_error=true`);
  }
  res.clearCookie("oauth_state", { ...cookieOptions, path: "/" });

  passport.authenticate("google", { session: false }, async (err: any, user: any) => {
    try {
      if (err || !user) {
        logger.error("Google OAuth callback error", { error: err });
        return res.redirect(`${env.CLIENT_URL.replace(/\/$/, "")}/?oauth_error=true`);
      }

      // ── New-device security email (same as local login) ─────────────
      // The browser's deviceId was stashed in a cookie when the flow
      // started; apply it now. Best-effort — never break the OAuth redirect
      // over device tracking.
      try {
        const rawDevice = req.cookies?.oauth_device;
        if (rawDevice && typeof rawDevice === "string") {
          let parsed: { deviceId?: string; deviceLabel?: string } = {};
          try { parsed = JSON.parse(rawDevice); } catch { parsed = {}; }
          const deviceId = parsed.deviceId;
          if (deviceId) {
            const knownDevices = (user as any).knownDevices || [];
            const known = knownDevices.some((d: any) => d.deviceId === deviceId);
            if (!known) {
              (user as any).knownDevices = [
                ...knownDevices.slice(-9),
                {
                  deviceId,
                  label: parsed.deviceLabel || "",
                  ip: req.ip || "",
                  firstSeenAt: new Date(),
                  lastSeenAt: new Date(),
                },
              ];
              await user.save();
              void sendNewDeviceLoginMail({
                email: user.email,
                username: user.username,
                deviceLabel: parsed.deviceLabel || "",
                ip: req.ip || "",
              });
            } else {
              const idx = knownDevices.findIndex((d: any) => d.deviceId === deviceId);
              if (idx >= 0 && knownDevices[idx]) {
                knownDevices[idx].lastSeenAt = new Date();
                await user.save();
              }
            }
          }
        }
      } catch (err: any) {
        logger.warn("Failed to record OAuth login device", {
          userId: user._id,
          error: err.message,
        });
      }
      res.clearCookie("oauth_device", { ...cookieOptions, path: "/" });

      // Generate JWT
      const token = user.signToken();

      // Set JWT cookie (best-effort — desktop keeps it; mobile privacy
      // features may drop redirect-set cookies, which is why the client
      // ALSO exchanges the one-time code below via a normal XHR).
      res.cookie("jwt", token, {
        ...cookieOptions,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: "/",
      });

      // Set CSRF cookie
      setCsrfCookie(res);

      // One-time exchange code: the client POSTs it to /api/auth/oauth-exchange
      // (a normal XHR, exactly like /api/auth/login) and receives the jwt +
      // csrf cookies in THAT response — the same channel that provably works
      // on mobile (plain login works everywhere). The code is single-use,
      // short-lived and bound to the user; it must not be the bearer of the
      // full JWT because it travels in the URL (history/logs/referrers).
      const exchangeCode = randomBytes(24).toString("hex");
      await setCache(
        `oauth:exchange:${exchangeCode}`,
        { userId: (user as any)._id.toString() },
        600,
      );

      // Redirect back to frontend with the code. Strip any trailing slash
      // from CLIENT_URL first — otherwise a value like
      // "https://...vercel.app/" produces "//?oauth_success=true", which the
      // service worker's navigation handler answers with a raw 503 page.
      return res.redirect(
        `${env.CLIENT_URL.replace(/\/$/, "")}/?oauth_code=${exchangeCode}`,
      );
    } catch (error) {
      logger.error("Google OAuth callback handler error", { error });
      return res.redirect(`${env.CLIENT_URL.replace(/\/$/, "")}/?oauth_error=true`);
    }
  })(req, res);
};

// strip zero-width characters from displayName before user lookup

// only allow configured callback URLs to prevent open redirect
