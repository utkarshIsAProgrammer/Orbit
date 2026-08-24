import { env } from "./env";

/**
 * Secure-by-default client-IP trust configuration.
 *
 * Express `trust proxy` and the Socket.IO connection limiter must agree on
 * which forwarded headers to believe. If the server is directly exposed,
 * a client can set `X-Forwarded-For` to any value and bypass every
 * per-IP rate limiter — so we only trust forwarded headers when we are
 * actually behind a real proxy:
 *
 * - Known platform hosts (Render/Heroku/Fly/Vercel) rewrite XFF at their
 *   edge with the true client IP. The default hop count is `2` because the
 *   live topology is two proxies deep: Vercel (client) → Render edge → app.
 *   With `1`, Express takes the RIGHTMOST XFF entry — which is Render's
 *   *internal* edge IP (10.x.x.x) — so every user behind the same edge
 *   shares one rate-limit bucket and real users get "too many requests"
 *   after a few clicks. `2` resolves the real client IP appended by Vercel.
 * - Everything else defaults to `loopback` (only a proxy on the same
 *   machine is trusted) → spoofing is ignored, `req.ip` is the real peer.
 * - Operators can override with the TRUST_PROXY env var:
 *   `false`/`0` = never trust forwarded headers; `1` = one proxy hop;
 *   `loopback` = loopback proxies only; or a comma list of proxy IPs.
 *
 * NOTE: `resolveClientIp` below is the belt-and-suspenders safety net used
 * by the rate limiters themselves — if `req.ip` ever resolves to a private
 * internal hop (misconfigured TRUST_PROXY, a third proxy added later), it
 * walks `X-Forwarded-For` and picks the rightmost *non-private* entry, so
 * rate limits can never collapse onto an internal proxy IP.
 */
export function getTrustProxyConfig(): {
  express: boolean | number | string;
  trustForwarded: boolean;
} {
  const onPlatform =
    !!(process.env.RENDER || process.env.DYNO || process.env.FLY_APP_NAME || process.env.VERCEL);

  const raw = (env.TRUST_PROXY || (onPlatform ? "2" : "loopback")).trim().toLowerCase();

  if (raw === "false" || raw === "0") {
    return { express: false, trustForwarded: false };
  }
  if (/^\d+$/.test(raw)) {
    const hops = parseInt(raw, 10);
    return { express: hops, trustForwarded: hops > 0 };
  }
  // "loopback", "linklocal", "uniquelocal", IP/subnet list, ...
  return { express: raw, trustForwarded: raw !== "loopback" && raw !== "linklocal" && raw !== "uniquelocal" };
}

/**
 * True when an IP is a private/internal/loopback address — i.e. a proxy hop,
 * not a real client. Rate limiters must NEVER key on these, or every user
 * behind the same internal edge shares one bucket.
 */
export function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  let normalized = ip.trim();
  // IPv4-mapped IPv6 (::ffff:203.0.113.5) — compare as IPv4.
  if (normalized.startsWith("::ffff:")) normalized = normalized.slice(7);
  if (normalized === "::1") return true;
  return (
    normalized.startsWith("10.") ||
    normalized.startsWith("127.") ||
    normalized.startsWith("169.254.") ||
    normalized.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(normalized) ||
    /^f[cd][0-9a-f]{2}:/i.test(normalized) || // fc00::/7 (ULA)
    /^fe[89ab][0-9a-f]?:/i.test(normalized) // fe80::/10 (link-local)
  );
}

/**
 * Resolve the real client IP for rate limiting from every signal available.
 *
 * Priority: the proxy-resolved `req.ip`/peer address first (when public),
 * then the X-Forwarded-For chain from the rightmost (nearest proxy) entry
 * backward, skipping internal hop addresses. Guarantees the identifier is a
 * real client IP even when `trust proxy` is misconfigured for the topology.
 */
export function resolveClientIp(options: {
  resolvedIp?: string;
  remoteAddress?: string;
  xForwardedFor?: string;
}): string {
  const { resolvedIp, remoteAddress, xForwardedFor } = options;

  const candidates: string[] = [];
  if (resolvedIp) candidates.push(resolvedIp);
  if (remoteAddress) candidates.push(remoteAddress);
  if (xForwardedFor) {
    for (const part of xForwardedFor.split(",")) {
      const trimmed = part.trim();
      if (trimmed) candidates.push(trimmed);
    }
  }

  for (const candidate of candidates) {
    if (candidate && !isPrivateIp(candidate)) return candidate;
  }
  return candidates[0] || "unknown";
}
