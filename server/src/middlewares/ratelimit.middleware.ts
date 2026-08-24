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

const createRateLimiter = (
	prefixKey: string,
	maxRequests: number,
	windowMs: number,
	message: string,
	// When true, an Upstash/Redis outage REJECTS the request (503) instead of
	// letting it through unthrottled. Used on limiter-critical routes (auth,
	// OTP, uploads, waitlist) where fail-open would silently disable brute-force
	// and spam protection during an outage.
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

			// Test/load hook: RATELIMIT_KEY_OVERRIDE forces a fresh bucket (e.g.
			// the E2E script uses a per-run key so local re-runs don't exhaust
			// the shared per-IP allowance). Setting env vars implies server
			// control already, so this introduces no production risk.
			const identifier =
				process.env.RATELIMIT_KEY_OVERRIDE || getClientIp(req);
			const { success, reset, limit, remaining } =
				await ratelimit.limit(identifier);

			// Set standard rate limiting headers
			res.setHeader("X-RateLimit-Limit", limit.toString());
			res.setHeader("X-RateLimit-Remaining", remaining.toString());

			if (!success) {
				// Calculate retry-after time in seconds
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
					retryAfter, // Also include it in the response body for easier parsing
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
			// Fail closed ONLY when Redis is genuinely configured (i.e. this is a
			// real outage, not a Redis-less dev/test environment where the client
			// is a no-op proxy and the limiter never provided protection anyway).
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

// comments limiter
export const commentLimiter: RateLimiter = createRateLimiter(
	"comment",
	40,
	60 * 1000,
	"Too many comment requests. Please try after some time.",
);

// interaction limiter
export const interactionLimiter: RateLimiter = createRateLimiter(
	"interaction",
	80,
	60 * 1000,
	"Too many actions performed. Please try after some time.",
);

// ── Local in-memory limiter for the chat-send hot path ──────────────────
// Every Upstash REST round-trip costs ~100-300ms on the free tier, and the
// sender is already waiting on the send response — so the Redis limiter is
// the wrong tool for the single hottest route in the app. This sliding-window
// limiter lives entirely in process memory (~µs per check): chat sends get
// throttled with ZERO added latency. Trade-offs (per-instance state, resets
// on restart) are fine on a single free-tier instance; the fail-closed
// auth/OTP/upload limiters above keep their Redis behavior unchanged, and
// this limiter is purely a sanity guard on top of the per-user rate limits
// the server already enforces elsewhere.
const localWindows = new Map<string, number[]>();
const LOCAL_WINDOW_MS = 60_000;
const LOCAL_MAX = 80; // matches interactionLimiter's 80/60s

export const localInteractionLimiter = (
	req: Request,
	res: Response,
	next: NextFunction,
): void => {
	try {
		// Key by the authenticated user when present (chat-send routes sit
		// behind `protect`): an IP behind NAT/proxy is shared by many users,
		// so an IP-only budget lets one heavy sender throttle everyone on
		// the same egress IP. Per-user budgets also behave correctly if the
		// app ever runs multiple instances (each user keeps their own
		// budget per instance instead of fighting over one IP bucket).
		const userId =
			(req as any).user?._id?.toString?.() ||
			(req as any).user?.toString?.();
		const identifier =
			process.env.RATELIMIT_KEY_OVERRIDE ||
			(userId ? `user:${userId}` : getClientIp(req));
		const now = Date.now();
		const windowStart = now - LOCAL_WINDOW_MS;
		const hits = (localWindows.get(identifier) || []).filter(
			(t) => t > windowStart,
		);
		if (hits.length >= LOCAL_MAX) {
			res.setHeader("Retry-After", "60");
			res.status(429).json({
				success: false,
				message: "Too many actions performed. Please try after some time.",
				retryAfter: 60,
			});
			return;
		}
		hits.push(now);
		localWindows.set(identifier, hits);
		// Bound memory: drop identifiers idle for > 5 minutes.
		if (localWindows.size > 10_000) {
			for (const [key, arr] of localWindows) {
				if ((arr[arr.length - 1] ?? 0) < now - 5 * 60_000) {
					localWindows.delete(key);
				}
			}
		}
		next();
	} catch {
		// A limiter failure must never block sends.
		next();
	}
};

// notification read limiter
export const notificationLimiter: RateLimiter = createRateLimiter(
	"notification",
	80,
	60 * 1000,
	"Too many notification requests. Please try after some time.",
);

// general limiter for all other requests
// Uses in-memory sliding window instead of Redis to save Upstash commands.
// 1500 / 15 min ≈ 100/min sustained — far beyond any human browsing pace
// (the client is request-hungry: tab prefetch + cache refreshes + view
// tracking), yet still caps scripted floods from a single IP. Sensitive
// endpoints are protected further by the stricter route limiters above.
const generalWindows = new Map<string, number[]>();
const GENERAL_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const GENERAL_MAX = 1500;

export const generalLimiter = (
	req: Request,
	res: Response,
	next: NextFunction,
): void => {
	try {
		if (env.NODE_ENV === "development" || env.NODE_ENV === "test") {
			return next();
		}

		const identifier = process.env.RATELIMIT_KEY_OVERRIDE || getClientIp(req);
		const now = Date.now();
		const windowStart = now - GENERAL_WINDOW_MS;
		const hits = (generalWindows.get(identifier) || []).filter(
			(t) => t > windowStart,
		);

		if (hits.length >= GENERAL_MAX) {
			const oldest = hits[0] ?? now;
			const retryAfter = Math.ceil((oldest + GENERAL_WINDOW_MS - now) / 1000);
			res.setHeader("X-RateLimit-Limit", GENERAL_MAX.toString());
			res.setHeader("X-RateLimit-Remaining", "0");
			res.setHeader("Retry-After", retryAfter.toString());
			res.status(429).json({
				success: false,
				message: "Too many requests. Please try after some time.",
				retryAfter,
			});
			return;
		}

		hits.push(now);
		generalWindows.set(identifier, hits);
		res.setHeader("X-RateLimit-Limit", GENERAL_MAX.toString());
		res.setHeader("X-RateLimit-Remaining", String(GENERAL_MAX - hits.length));

		// Bound memory: drop identifiers idle for > 15 minutes.
		if (generalWindows.size > 10_000) {
			for (const [key, arr] of generalWindows) {
				if ((arr[arr.length - 1] ?? 0) < now - GENERAL_WINDOW_MS) {
					generalWindows.delete(key);
				}
			}
		}

		next();
	} catch {
		next();
	}
};

// search limiter — type-ahead search debounces ~300ms client-side, so a
// user actively typing fires roughly one request per second. 40/min meant a
// normal search session (type a name, correct it, re-type) exhausted the
// bucket and got "Too many search requests" — which the client surfaced as
// "no user found". 120/min still stops abuse (a scripted crawler doing
// thousands of queries) while never tripping a real person typing.
export const searchLimiter: RateLimiter = createRateLimiter(
	"search",
	120,
	60 * 1000,
	"Too many search requests. Please try after some time.",
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
