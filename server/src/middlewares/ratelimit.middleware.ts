import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "../configs/redis";
import { logger } from "../utilities/logger";
import { env } from "../configs/env";
import { resolveClientIp } from "../configs/trustProxy";
import type { Request, Response, NextFunction } from "express";

type RateLimiter = ReturnType<typeof createRateLimiter>;

const getClientIp = (req: Request): string => {
	// Prefers Express's trust-proxy-resolved req.ip when it's a real client
	// address, and falls back to walking X-Forwarded-For for the rightmost
	// NON-PRIVATE entry when req.ip collapsed to an internal hop (e.g.
	// Render's 10.x edge IP under a Vercel→Render topology with the wrong
	// TRUST_PROXY). Without this, every user behind one internal edge IP
	// shares a single rate-limit bucket and real users hit 429 quickly.
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
// Zero Redis commands. Per-instance state, resets on restart. Fine for a
// single free-tier instance where Redis should only be used for things
// that genuinely need cross-instance coordination (auth brute-force,
// OTP, uploads).
const memWindows = new Map<string, number[]>();

const createInMemoryLimiter = (
	prefixKey: string,
	maxRequests: number,
	windowMs: number,
	message: string,
) => {
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

// ── Redis-based limiters (security-critical only) ──────────────────────
// These MUST use Redis — brute-force protection requires persistence
// across restarts and (eventually) across instances.

const createRateLimiter = (
	prefixKey: string,
	maxRequests: number,
	windowMs: number,
	message: string,
	failClosed = false,
) => {
	const ratelimit = new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(maxRequests, `${windowMs}ms`),
		prefix: `ratelimit:${prefixKey}`,
	});

	return async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (env.NODE_ENV === "development" || env.NODE_ENV === "test") {
				return next();
			}

			const identifier =
				process.env.RATELIMIT_KEY_OVERRIDE || getClientIp(req);
			const { success, reset, limit, remaining } =
				await ratelimit.limit(identifier);

			res.setHeader("X-RateLimit-Limit", limit.toString());
			res.setHeader("X-RateLimit-Remaining", remaining.toString());

			if (!success) {
				const retryAfter = Math.ceil((reset - Date.now()) / 1000);
				res.setHeader("Retry-After", retryAfter.toString());

				logger.warn(
					`Rate limit exceeded for ${identifier} on ${req.method} ${req.path}`,
					{
						identifier,
						method: req.method,
						path: req.path,
						limit,
						reset,
					},
				);

				return res.status(429).json({
					success: false,
					message,
					retryAfter,
				});
			}

			next();
		} catch (error) {
			logger.warn(
				`Rate limiting unavailable due to Redis error — ${
					failClosed ? "rejecting request" : "allowing request through"
				}`,
				{
					error:
						error instanceof Error ? error.message : String(error),
				},
			);
			const redisConfigured =
				!!env.UPSTASH_REDIS_REST_URL && !!env.UPSTASH_REDIS_REST_TOKEN;
			if (failClosed && redisConfigured) {
				res.setHeader("Retry-After", "60");
				return res.status(503).json({
					success: false,
					message:
						"Rate limiter temporarily unavailable — please try again shortly.",
					retryAfter: 60,
				});
			}
			next();
		}
	};
};

// ── SECURITY-CRITICAL: Redis-based (brute-force protection) ────────────

// auth limiter — fail-closed: an outage must never disable brute-force protection
export const authLimiter: RateLimiter = createRateLimiter(
	"auth",
	20,
	15 * 60 * 1000,
	"Too many login/signup attempts. Please try after some time.",
	true,
);

// otp limiter — fail-closed: OTP verify/resend is a primary brute-force target
export const otpLimiter: RateLimiter = createRateLimiter(
	"otp",
	5,
	10 * 60 * 1000,
	"Too many OTP requests. Please try after some time.",
	true,
);

// upload limiter — fail-closed: uploads are a classic abuse vector
export const uploadLimiter: RateLimiter = createRateLimiter(
	"upload",
	15,
	60 * 1000,
	"Too many upload requests. Please try after some time.",
	true,
);

// waitlist limiter — fail-closed: the public form must not be spammable
export const waitlistLimiter: RateLimiter = createRateLimiter(
	"waitlist",
	5,
	10 * 60 * 1000,
	"Too many waitlist requests. Please try again in a few minutes.",
	true,
);

// ── NON-CRITICAL: In-memory (saves ~4 Redis commands per request) ──────
// These are sanity guards — the app already enforces per-user limits
// elsewhere. In-memory is fine on a single free-tier instance.

// comments limiter — 40/min
export const commentLimiter = createInMemoryLimiter(
	"comment",
	40,
	60 * 1000,
	"Too many comment requests. Please try after some time.",
);

// interaction limiter — 80/min (likes, reposts, follows, saves, blocks)
export const interactionLimiter = createInMemoryLimiter(
	"interaction",
	80,
	60 * 1000,
	"Too many actions performed. Please try after some time.",
);

// notification read limiter — 80/min
export const notificationLimiter = createInMemoryLimiter(
	"notification",
	80,
	60 * 1000,
	"Too many notification requests. Please try after some time.",
);

// search limiter — 120/min (type-ahead debounce)
export const searchLimiter = createInMemoryLimiter(
	"search",
	120,
	60 * 1000,
	"Too many search requests. Please try after some time.",
);

// general limiter — 1500/15min
export const generalLimiter = createInMemoryLimiter(
	"general",
	1500,
	15 * 60 * 1000,
	"Too many requests. Please try after some time.",
);

// chat-send limiter — 80/min (reuses interaction limits)
export const localInteractionLimiter = createInMemoryLimiter(
	"chat",
	80,
	60 * 1000,
	"Too many actions performed. Please try after some time.",
);
