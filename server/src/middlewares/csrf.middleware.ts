import type { Request, Response, NextFunction } from "express";
import { randomBytes } from "crypto";
import { env } from "../configs/env";

const CSRF_COOKIE_NAME = "csrf-token";
const CSRF_HEADER_NAME = "x-csrf-token";

// Methods that are considered "state-changing" and need CSRF protection
const STATE_CHANGING_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

// Safe origins that are allowed to make state-changing requests
const getTrustedOrigins = (): string[] => {
	const origins = [env.CLIENT_URL.replace(/\/$/, "")];
	if (env.LANDING_PAGE_URL) {
		origins.push(env.LANDING_PAGE_URL.replace(/\/$/, ""));
	}
	if (env.NODE_ENV === "development") {
		origins.push("http://localhost:5173", "http://localhost:5174");
	}
	return origins;
};

/**
 * Middleware that generates a CSRF token and sets it as a cookie.
 * Should be called once on login/session creation.
 */
export const setCsrfCookie = (res: Response) => {
	const token = randomBytes(32).toString("hex");
	res.cookie(CSRF_COOKIE_NAME, token, {
		httpOnly: false, // client JS needs to read it
		secure: env.NODE_ENV === "production",
		sameSite: "lax",
		path: "/",
		maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (matching JWT cookie maxAge)
	});
	return token;
};

/**
 * Middleware that validates CSRF token on state-changing requests.
 * Uses the double-submit cookie pattern: the client reads the CSRF
 * cookie and sends it back as a header. The server compares both.
 */
export const csrfProtection = (
	req: Request,
	res: Response,
	next: NextFunction,
) => {
	// Only protect state-changing methods
	if (!STATE_CHANGING_METHODS.includes(req.method)) {
		return next();
	}

	// Exclude public authentication and password reset endpoints
	const publicPaths = [
		"/api/auth/signup",
		"/api/auth/login",
		"/api/auth/logout", // idempotent cookie-clear; must work even with a torn-down session
		"/api/auth/oauth-exchange", // authenticated by the one-time code itself (bound to the OAuth state)
		"/api/password/request-otp",
		"/api/password/forgot",
		"/api/password/verify-and-forgot-password",
		"/api/password/reset",
		"/api/waitlist/join", // public landing-page form, like signup
	];

	if (publicPaths.includes(req.path)) {
		return next();
	}

	// Normalize an Origin header: strip trailing slash + default port so the
	// comparison is exact. Prefix matching (origin.startsWith(trusted)) is a
	// known bypass — http://localhost:5173.evil.com would pass it.
	const normalizeOrigin = (o: string) => {
		let clean = o.trim().replace(/\/$/, "");
		try {
			const url = new URL(clean);
			const explicitPort = url.port ? `:${url.port}` : "";
			clean = `${url.protocol}//${url.hostname}${explicitPort}`;
		} catch {
			/* keep raw string */
		}
		return clean;
	};

	// Origin check (defense-in-depth): when the browser sends an Origin
	// header on a state-changing request, it must exactly match a trusted
	// origin. Cross-site HTML forms always send an Origin — this stops them
	// even before the token comparison. Non-browser clients (mobile, tests)
	// that omit Origin are unaffected; the token check still applies.
	const originHeader = req.headers.origin;
	if (originHeader) {
		const trusted = getTrustedOrigins().map(normalizeOrigin);
		if (!trusted.includes(normalizeOrigin(originHeader))) {
			return res.status(403).json({
				success: false,
				message: "Cross-origin request blocked — security check failed.",
			});
		}
	}

	// In development, allow same-origin requests from the trusted dev servers
	// without the token round-trip (tokens are still validated elsewhere).
	if (env.NODE_ENV === "development") {
		const origin = req.headers.origin || "";
		const trustedOrigins = getTrustedOrigins().map(normalizeOrigin);
		if (trustedOrigins.includes(normalizeOrigin(origin))) {
			return next();
		}
	}

	const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
	const headerToken = req.headers[CSRF_HEADER_NAME] as string | undefined;

	if (!cookieToken || !headerToken) {
		return res.status(403).json({
			success: false,
			message: "CSRF token missing — security check failed.",
		});
	}

	if (cookieToken !== headerToken) {
		return res.status(403).json({
			success: false,
			message: "CSRF token mismatch — security check failed.",
		});
	}

	next();
};

// skip CSRF check for preflight - CORS handles it

// validate double-submit cookie on all POST/PUT/DELETE routes
