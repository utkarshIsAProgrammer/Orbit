// Trigger file change again
import express, { Request, Response, NextFunction } from "express";
import http from "http";
import "dotenv/config";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import compression from "compression";
import mongoose from "mongoose";
import { randomUUID } from "crypto";
import { validateEnv } from "./configs/env";
import { connectDB } from "./db/db";
import { initSocket, shutdownSocket } from "./configs/socket";
import { redis } from "./configs/redis";
import { authRoutes } from "./routes/auth.routes";
import { passwordRoutes } from "./routes/password.routes";
import { userRoutes } from "./routes/user.routes";
import { postRoutes } from "./routes/post.routes";
import { commentRoutes } from "./routes/comment.routes";
import { likeRoutes } from "./routes/like.routes";
import { followRoutes } from "./routes/follow.routes";
import { saveRoutes } from "./routes/saves.routes";
import { repostRoutes } from "./routes/repost.routes";
import { searchRoutes } from "./routes/search.routes";
import { notificationRoutes } from "./routes/notification.routes";
import { chatRoutes } from "./routes/chat.routes";
import { glimpseRoutes } from "./routes/glimpse.routes";
import { communityRoutes } from "./routes/community.routes";
import { collectionRoutes } from "./routes/collection.routes";
import { streakRoutes } from "./routes/streak.routes";
import { inviteRoutes } from "./routes/invite.routes";
import { reportRoutes } from "./routes/report.routes";
import { feedRoutes } from "./routes/feed.routes";
import { pushRoutes } from "./routes/push.routes";
import blockRoutes from "./routes/block.routes";
import missionRoutes from "./routes/dailyMission.routes";
import xpRoutes from "./routes/xp.routes";
import linkPreviewRoutes from "./routes/linkPreview.routes";
import translationRoutes from "./routes/translation.routes";
import leaderboardRoutes from "./routes/leaderboard.routes";
import { adminRoutes } from "./routes/admin.routes";

import { startAffinityScheduler, startNotificationPruner, startDailyMissionReset, startKeepAlive, startStreakBreakChecker, startScheduledPostPublisher, startScheduledMessagePublisher } from "./configs/scheduler";
import { startQueueWorkers } from "./configs/queue";
import trendRoutes from "./routes/trending.routes";
import { waitlistRoutes } from "./routes/waitlist.routes";
import feedForYouRoutes from "./routes/feedForYou.routes";
import moderationRoutes from "./routes/moderation.routes";
import dataExportRoutes from "./routes/dataExport.routes";
import fileRoutes from "./routes/file.routes";
import webhookRoutes from "./routes/webhook.routes";
import apiKeyRoutes from "./routes/apiKey.routes";
import permissionRoutes from "./routes/permission.routes";
import { externalFeedRoutes } from "./routes/externalFeed.routes";
import { startExternalSync } from "./services/externalSync";
import { startBotFarm } from "./services/bots";
import { oauthRoutes } from "./routes/oauth.routes";
import { AppError } from "./utilities/errors";
import { logger } from "./utilities/logger";
import { cookieOptions } from "./configs/cookie";
import { getTrustProxyConfig } from "./configs/trustProxy";
import { csrfProtection } from "./middlewares/csrf.middleware";
import { generalLimiter } from "./middlewares/ratelimit.middleware";
import { botBlocker } from "./middlewares/botBlocker.middleware";

// ─── Monitoring & Documentation ────────────────────────────────────
import { initSentry, sentryErrorHandler } from "./configs/sentry";
import { setupSwagger } from "./configs/swagger";

// ─── CLUSTERING (multi-core) ────────────────────────────────────
// Fork one worker per CPU core. Each worker shares the same port.
// If clustering is disabled or only 1 CPU, runs in single-process mode.
//
// The primary process forks workers and then exits without starting the server.
// Workers and single-process mode continue to the full app setup below.
import cluster from "cluster";
import os from "os";

// Cluster mode: ONLY in production, NEVER in development/dev mode.
// tsx --watch cannot fork workers (causes EPIPE crashes), and clustering
// adds unneeded complexity for local development.
const isClusterEnabled = process.env.NODE_ENV === "production" && process.env.CLUSTER_ENABLED !== "false";
const numCPUs = Math.min(os.cpus().length, parseInt(process.env.CLUSTER_MAX_WORKERS || "2", 10));

if (isClusterEnabled && cluster.isPrimary && numCPUs > 1) {
  logger.info(`Primary process starting ${numCPUs} workers...`);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker, code, signal) => {
    logger.warn(`Worker ${worker.process.pid} died (code: ${code}, signal: ${signal}). Restarting...`);
    cluster.fork();
  });

  cluster.on("online", (worker) => {
    logger.info(`Worker ${worker.process.pid} is online`);
  });

  // Primary exits — workers handle their own graceful shutdown
  process.exit(0);
}

// ─── Worker or single-process mode starts here ───────────────────
if (!cluster.isPrimary) {
  logger.info(`Worker ${process.pid} started`);
}

// ─── Global process-level error handlers ──────────────────────────
process.on(
	"unhandledRejection",
	(reason: unknown, promise: Promise<unknown>) => {
		logger.error("Unhandled Promise Rejection", {
			error: reason instanceof Error ? reason.message : String(reason),
			stack: reason instanceof Error ? reason.stack : undefined,
		});
	},
);

process.on("uncaughtException", (error: Error) => {
	logger.error("Uncaught Exception", {
		error: error.message,
		stack: error.stack,
	});
	// Give logger time to flush, then exit
	setTimeout(() => process.exit(1), 1000);
});

const env = validateEnv();

const app = express();
const server = http.createServer(app);
const port = env.PORT;
// Secure-by-default client-IP trust. On directly-exposed hosts this ignores
// spoofed X-Forwarded-For (which would otherwise bypass every per-IP rate
// limiter). Behind a platform proxy, set TRUST_PROXY=1 (Render/Heroku/etc.
// rewrite the header with the real client IP).
const trustProxy = getTrustProxyConfig();
app.set("trust proxy", trustProxy.express);
logger.info(
  `trust proxy=${String(trustProxy.express)} (forwarded-headers=${trustProxy.trustForwarded}) — set TRUST_PROXY=1 behind a platform proxy`,
);

// ─── Sentry initialization (must be first) ─────────────────────────
initSentry();

// Compression: skip payloads under 1 KB (small responses don't benefit)
app.use(compression({ threshold: 1024 }));

// HTTP Keep-Alive tuning
server.keepAliveTimeout = 65000; // 65 seconds (default is 5s)
server.headersTimeout = 66000; // Slightly higher than keepAliveTimeout

// ─── Graceful Shutdown ────────────────────────────────────────────
async function gracefulShutdown(signal: string) {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  // Stop accepting new connections — the rest of the teardown runs inside
  // this callback so nothing new can arrive while we drain.
  server.close(async () => {
    logger.info("HTTP server closed.");

    // Close BullMQ workers + queues (stop fetching, finish in-flight jobs,
    // close their Redis connections cleanly so there's no EPIPE on exit).
    try {
      const { closeQueues } = await import("./configs/queue");
      await closeQueues();
      logger.info("BullMQ queues closed.");
    } catch (err: any) {
      logger.error("Queue shutdown error", { error: err.message });
    }

    // Disconnect Socket.IO
    try {
      await shutdownSocket();
    } catch (err: any) {
      logger.error("Socket shutdown error", { error: err.message });
    }

    // Disconnect MongoDB
    try {
      await mongoose.disconnect();
      logger.info("MongoDB disconnected.");
    } catch (err: any) {
      logger.error("MongoDB disconnect error", { error: err.message });
    }

    logger.info("Graceful shutdown complete. Exiting.");
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    logger.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 30000); // 30 second timeout
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

app.use(
	cors({
		origin: (
			origin: string | undefined,
			callback: (err: Error | null, allow?: boolean) => void,
		) => {
			// Allow requests with no origin (like direct GET requests, health checks, or curl)
			if (!origin) {
				callback(null, true);
				return;
			}

			const originWithoutSlash = origin.replace(/\/$/, "");

			// Standalone landing page (waitlist form) — only when configured
			if (
				env.LANDING_PAGE_URL &&
				originWithoutSlash === env.LANDING_PAGE_URL.replace(/\/$/, "")
			) {
				callback(null, true);
				return;
			}

			// In development, allow any localhost origin (Vite can pick any port)
			if (env.NODE_ENV === "development") {
				const isLocalhost =
					originWithoutSlash.startsWith("http://localhost:") ||
					originWithoutSlash.startsWith("http://127.0.0.1:") ||
					originWithoutSlash.startsWith("https://localhost:") ||
					originWithoutSlash.startsWith("https://127.0.0.1:");
				if (isLocalhost) {
					callback(null, true);
					return;
				}
			}

			// Also check the configured CLIENT_URL explicitly
			if (originWithoutSlash === env.CLIENT_URL.replace(/\/$/, "")) {
				callback(null, true);
				return;
			}

			// Log rejected origin for debugging, then deny
			logger.warn("CORS blocked origin", { origin: originWithoutSlash });
			callback(new Error("Not allowed by CORS"));
		},
		credentials: true,
		maxAge: 86400, // cache pre-flight for 24 hours
	}),
);

// Reject known crawler/scanner user-agents BEFORE any route runs — crawlers
// are the #1 bandwidth burn on a free-tier API with no real users (Render
// bills outbound bandwidth). A blocked bot pays for a 403, not a full
// API/Socket.IO round-trip. Mounted before body parsers so they never parse.
app.use(botBlocker);

app.use(
	helmet({
		crossOriginResourcePolicy: { policy: "cross-origin" },
		contentSecurityPolicy: {
			directives: {
				defaultSrc: ["'self'"],
				scriptSrc: ["'self'"],
				styleSrc: [
					"'self'",
					"'unsafe-inline'",
					"https://fonts.googleapis.com",
				],
				fontSrc: ["'self'", "https://fonts.gstatic.com"],
				imgSrc: [
					"'self'",
					"data:",
					"blob:",
					"https://res.cloudinary.com",
					"https://images.unsplash.com",
					// Bot avatars/banners/glance media: real portraits, illustrated
					// characters, animated GIFs, and seeded photos.
					"https://randomuser.me",
					"https://api.dicebear.com",
					"https://media.giphy.com",
					"https://picsum.photos",
				],
				connectSrc: [
					"'self'",
					"https://res.cloudinary.com",
					env.CLIENT_URL,
				],
				// WebSocket connections to the server are implicitly allowed via "'self'"
				// Bot video posts/glances play from these free public CDNs.
				mediaSrc: [
					"'self'",
					"blob:",
					"data:",
					"https://interactive-examples.mdn.mozilla.net",
					"https://media.w3.org",
					"https://test-videos.co.uk",
				],
				frameAncestors: ["'none'"],
				formAction: ["'self'"],
				objectSrc: ["'none'"],
				baseUri: ["'self'"],
			},
		},
		hsts: {
			maxAge: 31536000,
			includeSubDomains: true,
			preload: true,
		},
		noSniff: true,
		referrerPolicy: { policy: "strict-origin-when-cross-origin" },
	}),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(cookieParser());

// Request ID Middleware — must run before timeout & logging middlewares
app.use((req: Request, res: Response, next: NextFunction) => {
	req.requestId = randomUUID();
	next();
});

// Minimal Request Logging Middleware — only logs errors (4xx/5xx) and slow requests
app.use((req: Request, res: Response, next: NextFunction) => {
	const start = Date.now();
	res.on("finish", () => {
		const duration = Date.now() - start;
		const statusCode = res.statusCode;
		// Only log on server errors (5xx), client errors (4xx), or requests over 5 seconds
		if (statusCode >= 400 || duration > 5000) {
			logger.warn(`${req.method} ${req.path} ${statusCode} ${duration}ms`, {
				requestId: req.requestId,
				method: req.method,
				path: req.path,
				statusCode,
				durationMs: duration,
				// User-agent on error/slow lines so you can see WHO is hitting
				// the API (crawler spam shows up here as 4xx floods).
				userAgent: req.headers["user-agent"] || null,
			});
		}
	});
	next();
});

// API GET responses: short-lived browser caching + stale-while-revalidate.
// The client already runs cache-first reads with background refresh (SWR),
// so a small max-age lets browsers and the service worker short-circuit
// repeat GETs (snappier tab switches / back-forward) while `private` keeps
// authenticated per-user data out of shared caches. The window is short, so
// nothing serves stale for long, and `stale-while-revalidate` lets the
// browser reuse the stale copy while revalidating in the background.
//
// Headers are applied only to 2xx GET responses and cover EVERY writer the
// routes use — res.json (all API JSON), res.send (Swagger HTML, misc), and
// res.sendFile (Swagger's static JS/CSS/fonts). Rules:
//  - error bodies (4xx/5xx) are never cached;
//  - responses that already set Cache-Control (e.g. the file-download proxy)
//    are left untouched;
//  - one-time private downloads (data exports with Content-Disposition) get
//    `private, no-store` — unique per-user payloads must not be reused;
//  - EVERYTHING ELSE gets `private, no-store`. The app already runs its own
//    stale-while-revalidate on top (CacheStorage + Dexie + a 30s background
//    refresh timer + a NetworkFirst service worker), and those layers CAN be
//    purged from JS on every mutation. The browser's native HTTP cache is the
//    ONE layer nothing in the app can evict — a `max-age`/`swr` window there
//    served stale bodies on reload for up to 150s after a mutation, which is
//    exactly the "I deleted it, reload, it's back, then it fixes itself" bug.
//    `no-store` makes the HTTP cache a pure pass-through: every reload hits
//    the app's own (purgeable) layers, so reload can never resurrect old data.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method !== "GET" || !req.path.startsWith("/api/")) return next();

  // Private app behind a waitlist — nothing on the API should ever be
  // indexed. Tells well-behaved crawlers to back off on every response.
  res.setHeader("X-Robots-Tag", "noindex, nofollow");

  const applyCacheControl = () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    if (res.getHeader("Cache-Control")) return; // controller set its own
    if (res.getHeader("Content-Disposition")) {
      res.setHeader("Cache-Control", "private, no-store");
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
  };

  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    applyCacheControl();
    return originalJson(body);
  }) as typeof res.json;

  const originalSend = res.send.bind(res);
  res.send = ((body: unknown) => {
    applyCacheControl();
    return originalSend(body);
  }) as typeof res.send;

  const originalSendFile = res.sendFile.bind(res);
  res.sendFile = ((path: string, options?: object, callback?: () => void) => {
    applyCacheControl();
    if (typeof options === "function") {
      return (originalSendFile as any)(path, options as any);
    }
    return (originalSendFile as any)(path, options, callback);
  }) as typeof res.sendFile;

  next();
});

// robots.txt — the API is a private app behind a waitlist; there is nothing
// to index and every crawl burns free-tier bandwidth. Compliant crawlers
// (Googlebot, Bingbot, and most AI crawlers) fetch this before crawling and
// back off. The non-compliant ones are handled by botBlocker above.
app.get("/robots.txt", (_req: Request, res: Response) => {
	res.setHeader("Content-Type", "text/plain");
	return res.send(
		[
			"# Orbit is a private, invite-only app \u2014 there is nothing to index.",
			"# Crawling it only burns the free-tier API bandwidth.",
			"User-agent: *",
			"Disallow: /",
			"",
			"# AI crawlers \u2014 explicit, in case they mishandle wildcards",
			"User-agent: GPTBot",
			"Disallow: /",
			"User-agent: ClaudeBot",
			"Disallow: /",
			"User-agent: PerplexityBot",
			"Disallow: /",
			"User-agent: Bytespider",
			"Disallow: /",
			"User-agent: Amazonbot",
			"Disallow: /",
			"User-agent: CCBot",
			"Disallow: /",
			"User-agent: Meta-ExternalAgent",
			"Disallow: /",
			"User-agent: Google-Extended",
			"Disallow: /",
			"User-agent: Applebot-Extended",
			"Disallow: /",
			"User-agent: AhrefsBot",
			"Disallow: /",
			"User-agent: SemrushBot",
			"Disallow: /",
			"User-agent: MJ12bot",
			"Disallow: /",
		].join("\n"),
	);
});

// Lightweight liveness probe — intentionally skips DB/Redis checks so it
// returns 200 instantly regardless of dependency state. Used by the internal
// keep-alive pinger (and can be wired to external uptime monitors).
app.get("/api/ping", (_req: Request, res: Response) => {
	return res.status(200).json({
		success: true,
		message: "pong",
		timestamp: new Date().toISOString(),
	});
});

// Enhanced Health Check with detailed system metrics
app.get("/api/health", async (req: Request, res: Response) => {
	const start = Date.now();
	try {
		let dbStatus = "disconnected";
		let dbState = mongoose.connection.readyState;
		const stateMap: Record<number, string> = {
			0: "disconnected",
			1: "connected",
			2: "connecting",
			3: "disconnecting",
		};
		dbStatus = stateMap[dbState] || "unknown";

		let redisStatus = "disconnected";
		let redisLatencyMs = -1;
		try {
			const redisStart = Date.now();
			await redis.ping();
			redisLatencyMs = Date.now() - redisStart;
			redisStatus = "connected";
		} catch {
			redisStatus = "disconnected";
		}

		const allHealthy = dbState === 1 && redisStatus === "connected";
		const memoryUsage = process.memoryUsage();

		return res.status(allHealthy ? 200 : 503).json({
			success: allHealthy,
			message: allHealthy ? "Server is healthy!" : "Server is unhealthy!",
			timestamp: new Date().toISOString(),
			requestId: req.requestId,
			uptime: process.uptime(),
			checks: {
				database: {
					status: dbStatus,
					state: dbState,
				},
				redis: {
					status: redisStatus,
					latencyMs: redisLatencyMs,
				},
			},
			memory: {
				rss: Math.round(memoryUsage.rss / 1024 / 1024) + "MB",
				heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + "MB",
				heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + "MB",
			},
			responseTimeMs: Date.now() - start,
		});
	} catch (err: any) {
		logger.error("Health check failed", { error: err.message });
		return res.status(503).json({
			success: false,
			message: "Server is unhealthy!",
			timestamp: new Date().toISOString(),
			requestId: req.requestId,
		});
	}
});

// Global rate limiter — baseline protection for all API routes
// Individual route limiters (authLimiter, etc.) apply stricter limits on top
app.use("/api", generalLimiter);

// Socket.IO's HTTP polling endpoint was previously unlimited — crawlers
// could spam /socket.io handshakes all day (the in-socket 60/min connection
// cap only fires after a handshake starts). 1500/15min ≈ 100/min sustained
// is far beyond any real client (a long-polling browser does ~3/min) while
// capping scripted floods from a single IP.
app.use("/socket.io", generalLimiter);

// CSRF protection — double-submit cookie pattern for state-changing requests
// API routes (mounted after CSRF middleware so they inherit the protection)
app.use(csrfProtection);

// api routes
app.use("/api/auth", authRoutes);
app.use("/api/auth", oauthRoutes);
app.use("/api/password", passwordRoutes);
app.use("/api/users", userRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/comments", commentRoutes);
app.use("/api/likes", likeRoutes);
app.use("/api/follows", followRoutes);
app.use("/api/saves", saveRoutes);
app.use("/api/reposts", repostRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/chats", chatRoutes);
app.use("/api/glimpses", glimpseRoutes);
app.use("/api/communities", communityRoutes);
app.use("/api/collections", collectionRoutes);
app.use("/api/streaks", streakRoutes);
app.use("/api/invites", inviteRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/admin", adminRoutes);

// Feed routes (ranked, Instagram-style feed)
app.use("/api/feed", feedRoutes);

// Push notification subscription routes
app.use("/api/push", pushRoutes);
app.use("/api/blocks", blockRoutes);

// Daily Missions routes
app.use("/api/missions", missionRoutes);

// XP routes
app.use("/api/xp", xpRoutes);

// Link Preview routes
app.use("/api/link-preview", linkPreviewRoutes);

// Translation routes
app.use("/api/translate", translationRoutes);

// Leaderboard routes
app.use("/api/leaderboard", leaderboardRoutes);

// Trending routes (users + topics)
app.use("/api/trending", trendRoutes);

// For You feed (affinity-based) — route already includes /for-you
app.use("/api/feed", feedForYouRoutes);

// Moderation queue routes
app.use("/api/moderation", moderationRoutes);

// Data export routes
app.use("/api/export", dataExportRoutes);

// File/document download proxy (Cloudinary authenticated admin API — the
// standard delivery CDN 401s non-image originals on this account)
app.use("/api/files", fileRoutes);

// Webhook routes
app.use("/api/webhooks", webhookRoutes);

// Developer API key routes
app.use("/api/developer", apiKeyRoutes);

// Device permission preferences (first-run onboarding + Settings → Permissions)
app.use("/api/permissions", permissionRoutes);
app.use("/api/external", externalFeedRoutes);

// Waitlist routes (landing page)
app.use("/api/waitlist", waitlistRoutes);

// ─── Swagger API Documentation ───────────────────────────────────
// API explorer is a gift to attackers mapping the surface — only expose it
// outside production (dev/staging), never on the live server.
if (env.NODE_ENV !== "production") {
  setupSwagger(app);
}

// ─── Sentry Error Handler (before global handler) ────────────────
app.use(sentryErrorHandler as any);

// 404 Handler
app.use((req: Request, res: Response) => {
	return res.status(404).json({
		success: false,
		message: `Route ${req.originalUrl} not found!`,
		requestId: req.requestId,
	});
});

/** Error shape from known libraries */
interface ZodIssue {
	path: (string | number)[];
	message: string;
}

interface MongoError extends Error {
	code?: number;
	keyPattern?: Record<string, unknown>;
	issues?: ZodIssue[];
}

// Global Error Handler
app.use((err: MongoError, req: Request, res: Response, _next: NextFunction) => {
	const message = err.message || "Internal Server Error";
	logger.error(message, {
		requestId: req.requestId,
		stack: err.stack,
	});

	let statusCode = 500;
	let responseMessage = message;
	let errors: { field: string; message: string }[] = [];

	// Handle Zod errors specifically
	if (err.name === "ZodError" && err.issues) {
		statusCode = 400;
		errors = err.issues.map((issue) => ({
			field: issue.path.join("."),
			message: issue.message,
		}));
		responseMessage = errors[0]?.message || "Validation failed";
	} else if (err instanceof AppError) {
		statusCode = err.statusCode;
		responseMessage = err.message;
	} else if (err.name === "ValidationError") {
		statusCode = 400;
		// Sanitize mongoose validation — send only the first human-readable
		// reason, never the raw dump (which reveals the model name and the
		// full field list to the client).
		const firstReason = (
			(err as any).errors as
				| Record<string, { message?: string }>
				| undefined
		)?.[Object.keys((err as any).errors || {})[0] ?? ""];
		responseMessage = firstReason?.message || "Validation failed";
	} else if (
		(err.name === "MongoError" || err.name === "MongoServerError") &&
		err.code === 11000
	) {
		statusCode = 409;
		const field = err.keyPattern ? Object.keys(err.keyPattern)[0] : null;
		responseMessage = field ? `${field} already exists` : "Duplicate field value";
	} else {
		// Unexpected/internal error — never leak internals to the client.
		// The real message + stack are logged server-side above; the client
		// only ever sees a generic message.
		statusCode = 500;
		responseMessage = "Internal server error";
	}

	return res.status(statusCode).json({
		success: false,
		message: responseMessage,
		...(errors.length > 0 && { errors }),
		requestId: req.requestId,
		...(env.NODE_ENV === "development" && { stack: err.stack }),
		// Structured fields controllers attach to AppError (e.g. slowmode's
		// retryAfterSeconds) flow through to the client for countdown UI.
		...((err as any).retryAfterSeconds !== undefined && {
			retryAfterSeconds: (err as any).retryAfterSeconds,
		}),
	});
});

connectDB().then(async () => {
	await initSocket(server);

	// Bind the HTTP port BEFORE starting background services. If any of them
	// threw, the listen below would never run and the process would sit alive
	// without an open port (Render's port scan then flags the deploy and the
	// service enters a restart loop) — so the port comes first.
	server.listen(port, () => {
		logger.info(`Server is running on PORT: ${port}`);
	});

	// Start background affinity recomputation for feed ranking
	startAffinityScheduler();

	// Start daily pruner for read notifications older than 30 days
	startNotificationPruner();

	// Start daily mission reset (cleans up old records at midnight)
	startDailyMissionReset();

	// Keep free-tier hosting awake — pings /api/ping every 5 minutes
	startKeepAlive();

	// Check for broken streaks every hour
	startStreakBreakChecker();

	// Publish scheduled posts the moment they're due — exact-time BullMQ
	// delayed jobs when REDIS_URL is configured, 1-min cron poll otherwise.
	startScheduledPostPublisher();

	// Deliver scheduled DM/community messages at their exact time — BullMQ
	// delayed jobs when REDIS_URL is configured, 1-min cron safety net
	// otherwise. Idempotent with the job path, so both can run at once.
	startScheduledMessagePublisher();

	// BullMQ background workers (scheduled-post publishing + scheduled
	// message delivery + email delivery) — no-op when REDIS_URL isn't set.
	// Never throws; failures fall back to the inline/cron paths and are
	// logged.
	startQueueWorkers();

	// Pull fresh public content from Bluesky/Mastodon/Lemmy into the Web tab
	startExternalSync();

	// Bot farm heartbeat — simulated users keep the app alive (config-gated)
	startBotFarm();
});

// enable gzip compression for responses larger than 1KB

// all routes mounted under /api/v1/ for future v2 compatibility

// catch PayloadTooLargeError and return 413 with friendly message

// X-API-Version: v1 added to every response for client compatibility
