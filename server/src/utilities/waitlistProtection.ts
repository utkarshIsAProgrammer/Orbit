/**
 * @file waitlistProtection.ts
 * @description Anti-spam / anti-bot guards for the PUBLIC waitlist form.
 *
 * The waitlist is a wide-open funnel by design (anyone may reserve a seat),
 * so we layer cheap, dependency-free checks to keep junk out and only let
 * real humans with real, deliverable email addresses through:
 *
 *   1. Honeypot  — a hidden field bots love to fill. Humans never see it.
 *   2. Form timer — the form must have existed for >= MIN_FORM_MS before a
 *      submission is credible. Direct scripted POSTs (curl, bots) either
 *      omit the field or fail the window.
 *   3. Disposable-email blocklist — temp-mail style domains are junk leads.
 *   4. MX-record check — the email domain must be able to RECEIVE mail
 *      (node:dns, cached per domain). Kills `user@totally-fake-domain.xyz`.
 *   5. Cloudflare Turnstile (optional) — when TURNSTILE_SECRET_KEY is set,
 *      a valid widget token is REQUIRED (fail-closed). When unset, skipped.
 *
 * All heavy/network checks only run in production (NODE_ENV=production),
 * so local dev and the jest suite are unaffected.
 */

import { promises as dns } from "node:dns";
import { env } from "../configs/env";
import { logger } from "./logger";

/** How fast (ms) a human could realistically fill the form. */
export const MIN_FORM_MS = 2000;

/** How long to cache a POSITIVE MX verdict (1h). */
const MX_CACHE_TTL_MS = 60 * 60 * 1000;

/** How long to cache a NEGATIVE (no-MX) verdict (2 min). */
const MX_FAIL_TTL_MS = 2 * 60 * 1000;

/** Upper bound on the in-memory MX cache (oldest entries evicted). */
const MX_CACHE_MAX = 2000;

/** DNS lookups must resolve within this window or the domain is rejected. */
const DNS_TIMEOUT_MS = 4000;

/**
 * Known disposable / throwaway email domains. Matching is on the full
 * lowercase domain of the submitted email.
 *
 * The comprehensive blocklist (src/data/disposableDomains.ts, ~8.2k domains
 * from the community-maintained disposable-email-domains list) catches the
 * dominant temp-mail services; the extra `+` below keeps a small set of
 * additional domains blocked even before that list is refreshed, and
 * WAITLIST_EXTRA_BLOCKED_DOMAINS lets ops add more via env without a deploy.
 */
import { DISPOSABLE_EMAIL_DOMAINS } from "../data/disposableDomains";

const CURATED_EXTRA = new Set([
  "guerrillamailblock.com",
  "whyyoulose.club",
]);

const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  ...DISPOSABLE_EMAIL_DOMAINS,
  ...CURATED_EXTRA,
]);

/** Extra domains from env (WAITLIST_EXTRA_BLOCKED_DOMAINS, comma-separated). */
const extraBlocked = (env.WAITLIST_EXTRA_BLOCKED_DOMAINS || "")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

/** True when the email's domain is on the disposable blocklist. */
export const isDisposableEmail = (email: string): boolean => {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return DISPOSABLE_DOMAINS.has(domain) || extraBlocked.includes(domain);
};

/**
 * Verdict for the anti-bot timer check.
 *
 * Only rejects IMPLAUSIBLY-FAST submissions (0 <= elapsed < MIN_FORM_MS)
 * in production. Missing formStart is NOT rejected on purpose:
 *  - the currently-live landing page build predates this field, so a hard
 *    requirement would break every join the moment the backend goes live;
 *  - the honeypot + disposable + MX + Turnstile layers still guard the
 *    direct-POST path.
 * Negative elapsed (client clock ahead of server — common on Windows) is
 * also allowed through so real users are never false-rejected.
 */
export const isSubmissionTooFast = (formStart?: number): boolean => {
  // Read NODE_ENV at call time (not the frozen env snapshot) so test
  // suites can flip to production mode without module-cache ordering
  // deciding the result — same convention as waitlistGate.
  if (process.env.NODE_ENV !== "production") return false;
  if (typeof formStart !== "number" || !Number.isFinite(formStart)) {
    return false;
  }
  const elapsed = Date.now() - formStart;
  return elapsed >= 0 && elapsed < MIN_FORM_MS;
};

/* ── MX record check (production only, node:dns, cached) ──────────── */

const mxCache = new Map<string, { ok: boolean; at: number }>();

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("dns timeout")), ms)
    ),
  ]);

/**
 * Does the domain have real MX records (i.e. can it receive email)?
 * Cached per-domain for 1h. Skipped entirely when WAITLIST_SKIP_DNS=true
 * (tests / offline dev) or outside production.
 */
export const hasMailExchange = async (domain: string): Promise<boolean> => {
  if (env.WAITLIST_SKIP_DNS === "true" || env.NODE_ENV !== "production") {
    return true;
  }
  const key = domain.trim().toLowerCase().replace(/\.$/, "");
  if (!key) return false;

  const cached = mxCache.get(key);
  if (cached) {
    const ttl = cached.ok ? MX_CACHE_TTL_MS : MX_FAIL_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.ok;
  }

  const cacheResult = (ok: boolean) => {
    // Bound the cache: evict the oldest entry when over the cap.
    if (mxCache.size >= MX_CACHE_MAX) {
      const oldest = mxCache.keys().next().value;
      if (oldest !== undefined) mxCache.delete(oldest);
    }
    mxCache.set(key, { ok, at: Date.now() });
  };

  try {
    const mx = await withTimeout(dns.resolveMx(key), DNS_TIMEOUT_MS);
    const ok = Array.isArray(mx) && mx.length > 0;
    cacheResult(ok);
    return ok;
  } catch {
    // No MX — the domain cannot receive mail. (A domain with no MX and no
    // A/AAAA is doubly dead; we don't need the extra lookup to reject it.)
    // Short-TTL so a transient DNS hiccup can't lock a domain out for long.
    cacheResult(false);
    return false;
  }
};

/**
 * In-memory cache size guard — exposed so tests can reset state. The
 * cache is also self-bounding (see cacheResult above), so this is only
 * needed for deterministic tests / diagnostics.
 */
export const clearMxCache = (): void => {
  mxCache.clear();
};

/* ── Cloudflare Turnstile (optional, fail-closed when configured) ─── */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verify a Turnstile widget token against Cloudflare.
 * - No secret configured → skipped (returns true).
 * - Secret configured → token REQUIRED and must verify (fail-closed).
 * Note: no `remoteip` is sent — Cloudflare's docs recommend omitting it
 * (the token already encodes the client context), and a mismatched IP
 * behind a proxy misconfiguration would false-reject real users.
 */
export const verifyTurnstileToken = async (
  token?: string
): Promise<boolean> => {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // not configured — honeypot/timer/MX still apply
  if (!token || typeof token !== "string" || token.length > 2048) return false;

  try {
    const body = new URLSearchParams({ secret, response: token });

    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err: any) {
    logger.warn("Turnstile verification failed", { error: err?.message });
    return false; // fail closed — spam protection wins over availability
  }
};
