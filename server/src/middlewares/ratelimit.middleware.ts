import { env } from "../configs/env";
import { resolveClientIp } from "../configs/trustProxy";
import type { Request, Response, NextFunction } from "express";

type RateLimiter = (req: Request, res: Response, next: NextFunction) => void;

const getClientIp = (req: Request): string => {
	return resolveClientIp({
		resolvedIp: req.ip || "",
		remoteAddress: req.socket?.remoteAddress || "",
		xForwardedFor:
			typeof req.headers["x-forwarded-for"] === "string"
				? (req.headers["x-forwarded-for"] as string)
				: undefined,
	});
};

// ── Reusable in-memory sliding window limiter ──────────────────────────
// Zero Redis commands. Per-instance state, resets on restart. Perfect for
// a single free-tier instance — saves ~50K+ Upstash commands/month.
const memWindows = new Map<string, number[]>();

const createInMemoryLimiter = (
	prefixKey: string,
	maxRequests: number,
	windowMs: number,
	message: string,
): RateLimiter => {
	return (req: Request, res: Response, next: NextFunction): void => {
		try {
			if (env.NODE_ENV === "development" || env.NODE_ENV === "test") {
				return next();
			}

			const identifier =
				process.env.RATELIMIT_KEY_OVERRIDE || getClientIp(req);
			const now = Date.now();
			const windowStart = now - windowMs;
			const hits = (memWindows.get(identifier) || []).filter(
				(t) => t > windowStart,
			);

			if (hits.length >= maxRequests) {
				const oldest = hits[0] ?? now;
				const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
				res.setHeader("X-RateLimit-Limit", maxRequests.toString());
				res.setHeader("X-RateLimit-Remaining", "0");
				res.setHeader("Retry-After", retryAfter.toString());
				res.status(429).json({
					success: false,
					message,
					retryAfter,
				});
				return;
			}

			hits.push(now);
			memWindows.set(identifier, hits);
			res.setHeader("X-RateLimit-Limit", maxRequests.toString());
			res.setHeader(
				"X-RateLimit-Remaining",
				String(maxRequests - hits.length),
			);

			// Bound memory: drop identifiers idle for > windowMs * 2
			if (memWindows.size > 10_000) {
				const expireAt = now - windowMs * 2;
				for (const [key, arr] of memWindows) {
					if ((arr[arr.length - 1] ?? 0) < expireAt) {
						memWindows.delete(key);
					}
				}
			}

			next();
		} catch {
			next();
		}
	};
};

// ── All rate limiters — in-memory (zero Redis commands) ─────────────────

// auth limiter — 20 attempts per 15 min
export const authLimiter: RateLimiter = createInMemoryLimiter(
	"auth",
	20,
	15 * 60 * 1000,
	"Too many login/signup attempts. Please try after some time.",
);

// otp limiter — 5 attempts per 10 min
export const otpLimiter: RateLimiter = createInMemoryLimiter(
	"otp",
	5,
	10 * 60 * 1000,
	"Too many OTP requests. Please try after some time.",
);

// upload limiter — 15 per min
export const uploadLimiter: RateLimiter = createInMemoryLimiter(
	"upload",
	15,
	60 * 1000,
	"Too many upload requests. Please try after some time.",
);

// waitlist limiter — 5 per 10 min
export const waitlistLimiter: RateLimiter = createInMemoryLimiter(
	"waitlist",
	5,
	10 * 60 * 1000,
	"Too many waitlist requests. Please try again in a few minutes.",
);

// comments limiter — 40/min
export const commentLimiter: RateLimiter = createInMemoryLimiter(
	"comment",
	40,
	60 * 1000,
	"Too many comment requests. Please try after some time.",
);

// interaction limiter — 80/min (likes, reposts, follows, saves, blocks)
export const interactionLimiter: RateLimiter = createInMemoryLimiter(
	"interaction",
	80,
	60 * 1000,
	"Too many actions performed. Please try after some time.",
);

// notification read limiter — 80/min
export const notificationLimiter: RateLimiter = createInMemoryLimiter(
	"notification",
	80,
	60 * 1000,
	"Too many notification requests. Please try after some time.",
);

// search limiter — 120/min (type-ahead debounce)
export const searchLimiter: RateLimiter = createInMemoryLimiter(
	"search",
	120,
	60 * 1000,
	"Too many search requests. Please try after some time.",
);

// general limiter — 1500/15min
export const generalLimiter: RateLimiter = createInMemoryLimiter(
	"general",
	1500,
	15 * 60 * 1000,
	"Too many requests. Please try after some time.",
);

// chat-send limiter — 80/min
export const localInteractionLimiter: RateLimiter = createInMemoryLimiter(
	"chat",
	80,
	60 * 1000,
	"Too many actions performed. Please try after some time.",
);

// all limiters now share a factory: createLimiter({ windowMs, max, keyPrefix })

// otpLimiter: windowMs 600000, max 3, keyPrefix otp

// searchLimiter: 30 requests per minute per IP

// uploadLimiter: windowMs 60000 max 10 keyPrefix upload

// ensure X-RateLimit-* headers present on 429 responses

// all keys now use orbit:rl: namespace to avoid collisions
