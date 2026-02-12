import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { User } from "../models/user.model";
import { ApiKey } from "../models/apiKey.model";
import { env } from "../configs/env";
import { getCache, setCache } from "../configs/cache";
import { getErrorMessage } from "../types/global";

type JwtPayload = {
  userId: string;
};

/** Shape of the cached/returned user document (without password). */
interface SafeUser {
  _id: string;
  username: string;
  email: string;
  fullName: string;
  profilePic?: { url: string; public_id: string };
  isBanned?: boolean;
  [key: string]: unknown;
}

/**
 * In-memory user cache (process-local).
 *
 * Upstash Redis is an HTTPS REST round-trip (~100-200ms on free tier) and
 * resolveUser runs on EVERY protected request — so without this, every
 * API call (feed, chat, search, …) pays that latency. An in-memory Map
 * with a short TTL makes repeated requests from the same user resolve in
 * microseconds while staying fresher than the 5-minute Redis cache.
 */
const memUserCache = new Map<
  string,
  { user: SafeUser; expiresAt: number }
>();
const MEM_USER_CACHE_TTL_MS = 60_000; // 60s
const MEM_USER_CACHE_MAX = 500;

/**
 * Remove a user from the in-memory cache — call alongside the Redis
 * `auth:user:` invalidation whenever profile / logout / ban state changes
 * so the next request reflects the change immediately.
 */
export function clearMemUserCache(userId: string): void {
  memUserCache.delete(userId);
}

function setMemUser(userId: string, user: SafeUser): void {
  if (memUserCache.size >= MEM_USER_CACHE_MAX) {
    const oldest = memUserCache.keys().next().value;
    if (oldest !== undefined) memUserCache.delete(oldest);
  }
  memUserCache.set(userId, { user, expiresAt: Date.now() + MEM_USER_CACHE_TTL_MS });
}

/**
 * Resolve a user from in-memory cache → Redis cache → database.
 * Returns null if not found.
 */
async function resolveUser(userId: string): Promise<SafeUser | null> {
  // 1. In-memory (fastest) — avoids the Upstash HTTPS round trip entirely.
  const mem = memUserCache.get(userId);
  if (mem && Date.now() < mem.expiresAt) return mem.user;

  const cacheKey = `auth:user:${userId}`;

  // 2. Redis cache (shared across instances).
  const cached = await getCache<SafeUser>(cacheKey);
  if (cached) {
    setMemUser(userId, cached);
    return cached;
  }

  // 3. Database fallback.
  const user = await User.findById(userId).select("-password").lean();
  if (!user) return null;

  // Cache for 5 minutes in Redis + 60s in memory
  await setCache(cacheKey, user, 300);
  setMemUser(userId, user as unknown as SafeUser);
  return user as unknown as SafeUser;
}

/**
 * Extract JWT token from cookie or Authorization header.
 */
function extractToken(req: Request): string | null {
  const fromCookie = req.cookies?.jwt;
  if (fromCookie) return fromCookie;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.split(" ")[1] ?? null;
  }

  return null;
}

/**
 * Authenticate a request via the `X-Api-Key` header (developer API keys).
 * Keys are stored as SHA-256 hashes, scoped to the owning user, and only
 * carry read/write (never admin). Write mutations require the "write"
 * permission. Used as a fallback inside `protect` so a key can call the same
 * REST API as a logged-in session, mirroring the owner's own permissions.
 */
async function authenticateApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const rawKey = req.headers["x-api-key"];
  if (typeof rawKey !== "string" || rawKey.trim() === "") {
    res.status(401).json({ success: false, message: "Unauthorized - No token" });
    return;
  }

  const keyHash = crypto.createHash("sha256").update(rawKey.trim()).digest("hex");
  const keyRecord = await ApiKey.findOne({ keyHash }).lean();

  if (!keyRecord || !keyRecord.isActive) {
    res.status(401).json({ success: false, message: "Invalid API key" });
    return;
  }
  if (keyRecord.expiresAt && keyRecord.expiresAt.getTime() < Date.now()) {
    res.status(401).json({ success: false, message: "API key expired" });
    return;
  }

  // Permission enforcement: anything that mutates state needs "write".
  // Read-only keys can only issue GET requests.
  const perms = keyRecord.permissions || ["read"];
  if (req.method !== "GET" && !perms.includes("write")) {
    res.status(403).json({
      success: false,
      message: "API key does not have write permission",
    });
    return;
  }

  // Admin endpoints are gated on isAdmin inside their controllers — a
  // write-scoped key belonging to an admin owner would otherwise inherit
  // that authority. API keys are developer-scoped by design and must never
  // drive admin actions.
  const targetPath = `${req.baseUrl || ""}${req.path || ""}`;
  if (targetPath.startsWith("/api/admin")) {
    res.status(403).json({
      success: false,
      message: "API keys cannot access admin endpoints",
    });
    return;
  }

  // Scope the key away from bulk-personal-data surfaces. A leaked "read"
  // key must not be able to walk away with every conversation, message,
  // or a full data export (email/account dump) — those stay session-only.
  const SENSITIVE_KEY_PREFIXES = ["/api/export", "/api/chats"];
  if (
    SENSITIVE_KEY_PREFIXES.some((prefix) => targetPath.startsWith(prefix))
  ) {
    res.status(403).json({
      success: false,
      message:
        "API keys cannot access private data exports or chat data",
    });
    return;
  }

  const user = await resolveUser(keyRecord.user.toString());
  if (!user) {
    res.status(404).json({ success: false, message: "User not found!" });
    return;
  }
  if (user.isBanned) {
    res.status(403).json({
      success: false,
      message: "Your account has been banned!",
    });
    return;
  }

  // Touch lastUsedAt asynchronously — never block the request on it.
  ApiKey.findByIdAndUpdate(keyRecord._id, { lastUsedAt: new Date() }).catch(
    () => {},
  );

  req.user = user as any;
  next();
}

export const protect = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const token = extractToken(req);
    if (!token) {
      // No session token — fall back to developer API keys (X-Api-Key).
      // Requests with neither get the standard 401 from the key path.
      return await authenticateApiKey(req, res, next);
    }

    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "orbit",
      audience: "orbit-users",
    }) as JwtPayload;

    const user = await resolveUser(decoded.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found!",
      });
    }

    if (user.isBanned) {
      return res.status(403).json({
        success: false,
        message: "Your account has been banned!",
      });
    }

    req.user = user as any;
    next();
  } catch (err: any) {
    let message = "Invalid token!";
    if (err instanceof jwt.TokenExpiredError) {
      message = "Token expired!";
    } else if (err instanceof jwt.JsonWebTokenError) {
      message = getErrorMessage(err);
    }
    return res.status(401).json({
      success: false,
      message,
    });
  }
};

export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const token = extractToken(req);
    if (!token) return next();

    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "orbit",
      audience: "orbit-users",
    }) as JwtPayload;

    const user = await resolveUser(decoded.userId);
    if (user && !user.isBanned) {
      req.user = user as any;
    }

    next();
  } catch (err: any) {
    // Silently ignore token errors for optional auth
    next();
  }
};

// 5s max for DB fallback in resolveUser

// extracted verifyJwt() for reuse in websocket handshake auth
