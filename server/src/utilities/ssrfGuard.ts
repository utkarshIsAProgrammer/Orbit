import { lookup } from "dns/promises";
import { env } from "../configs/env";

/**
 * SSRF guard for any server-side outbound fetch (webhooks, …).
 *
 * Rules:
 * - Only http(s) URLs. In production, https only.
 * - IP-literal hostnames: public IPs pass, private/reserved ranges rejected.
 * - Hostnames are DNS-resolved and EVERY resolved address must be public —
 *   also neutralizes simple DNS rebinding when the guard is re-run right
 *   before the fetch (the callers do this).
 * - IPv4-mapped IPv6 encodings of private addresses are caught in EVERY
 *   common form (`::ffff:127.0.0.1`, `::ffff:7f00:1`, `0:0:0:0:0:ffff:7f00:1`,
 *   `::0:0:0:0:ffff:127.0.0.1`, …) via full 8-group expansion.
 * - In dev/test, loopback + link-local are allowed for local tooling; every
 *   other private/reserved range is still blocked.
 */

// IPv4 ranges that must never be reachable from the API server.
const BLOCKED_IPV4: { start: number[]; end: number[] }[] = [
  { start: [0, 0, 0, 0], end: [0, 255, 255, 255] }, // 0.0.0.0/8 "this network"
  { start: [10, 0, 0, 0], end: [10, 255, 255, 255] }, // 10.0.0.0/8 private
  { start: [100, 64, 0, 0], end: [100, 127, 255, 255] }, // 100.64.0.0/10 CGNAT
  { start: [127, 0, 0, 0], end: [127, 255, 255, 255] }, // 127.0.0.0/8 loopback
  { start: [169, 254, 0, 0], end: [169, 254, 255, 255] }, // 169.254.0.0/16 link-local (cloud metadata)
  { start: [172, 16, 0, 0], end: [172, 31, 255, 255] }, // 172.16.0.0/12 private
  { start: [192, 0, 0, 0], end: [192, 0, 0, 255] }, // 192.0.0.0/24 IETF
  { start: [192, 0, 2, 0], end: [192, 0, 2, 255] }, // 192.0.2.0/24 TEST-NET-1
  { start: [192, 168, 0, 0], end: [192, 168, 255, 255] }, // 192.168.0.0/16 private
  { start: [198, 18, 0, 0], end: [198, 19, 255, 255] }, // 198.18.0.0/15 benchmarking
  { start: [198, 51, 100, 0], end: [198, 51, 100, 255] }, // 198.51.100.0/24 TEST-NET-2
  { start: [203, 0, 113, 0], end: [203, 0, 113, 255] }, // 203.0.113.0/24 TEST-NET-3
  { start: [224, 0, 0, 0], end: [239, 255, 255, 255] }, // 224.0.0.0/4 multicast
  { start: [240, 0, 0, 0], end: [255, 255, 255, 255] }, // 240.0.0.0/4 reserved + broadcast
];

const ipv4ToNum = (parts: number[]): number =>
  ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;

const blockedV4 = BLOCKED_IPV4.map((r) => ({
  start: ipv4ToNum(r.start),
  end: ipv4ToNum(r.end),
}));

const isLoopbackV4 = (num: number): boolean =>
  num >= ipv4ToNum([127, 0, 0, 0]) && num <= ipv4ToNum([127, 255, 255, 255]);

const isLinkLocalV4 = (num: number): boolean =>
  num >= ipv4ToNum([169, 254, 0, 0]) && num <= ipv4ToNum([169, 254, 255, 255]);

/**
 * Expands any valid IPv6 address (including dotted-quad mixed forms and
 * `::` compression) into its 8 canonical 16-bit groups (lowercase hex, no
 * padding). Returns null when the address is not a valid IPv6 address.
 */
function expandV6(addr: string): string[] | null {
  let a = addr.split("%")[0]!.toLowerCase(); // strip zone id

  // Split a mixed dotted-quad tail (e.g. ::ffff:127.0.0.1 → ::ffff + 127.0.0.1)
  let v4tail: number[] | null = null;
  const mixed = a.match(/^(.*):(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mixed) {
    a = mixed[1]!;
    const parts = mixed[2]!.split(".").map(Number);
    if (parts.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
    v4tail = parts;
  }

  const hasCompression = a.includes("::");
  // A dotted-quad tail occupies TWO 16-bit group slots in the address.
  const v4Slots = v4tail ? 2 : 0;

  let groups: string[] = [];
  if (hasCompression) {
    const parts = a.split("::");
    if (parts.length > 2) return null; // "::" may appear at most once
    const before = parts[0] ? parts[0].split(":") : [];
    const after = parts[1] ? parts[1].split(":") : [];
    const needed = 8 - before.length - after.length - v4Slots;
    if (needed < 1) return null;
    groups = [...before, ...Array(needed).fill("0"), ...after];
  } else {
    const rawGroups = a.split(":");
    if (rawGroups.length !== 8 - v4Slots) return null;
    groups = rawGroups;
  }

  if (v4tail) {
    const hi = (v4tail[0]! << 8) | v4tail[1]!;
    const lo = (v4tail[2]! << 8) | v4tail[3]!;
    groups = [...groups, hi.toString(16), lo.toString(16)];
  }

  if (
    groups.length !== 8 ||
    groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))
  ) {
    return null;
  }
  return groups;
}

/**
 * If the 8 groups form an IPv4-mapped address (::ffff:0:0/96), return the
 * embedded IPv4 dotted quad; otherwise null.
 */
function v4FromMapped(groups: string[]): string | null {
  for (let i = 0; i < 5; i++) {
    if (groups[i] !== "0") return null;
  }
  if (groups[5] !== "ffff") return null;
  const hi = parseInt(groups[6]!, 16);
  const lo = parseInt(groups[7]!, 16);
  return [
    (hi >> 8) & 0xff,
    hi & 0xff,
    (lo >> 8) & 0xff,
    lo & 0xff,
  ].join(".");
}

/** True when `ip` is in a range that must never be fetched from the server. */
export function isBlockedIp(ip: string, allowLocal: boolean): boolean {
  const clean = ip.replace(/^\[|\]$/g, "").toLowerCase();

  if (clean.includes(":")) {
    const groups = expandV6(clean);
    if (!groups) return true; // unparseable IPv6 → fail closed

    const mappedV4 = v4FromMapped(groups);
    if (mappedV4) return isBlockedIp(mappedV4, allowLocal);

    const g0 = groups[0]!;
    if (clean === "::" || clean === "::1") return !allowLocal; // unspecified + loopback
    if (/^f[cd]/.test(g0)) return true; // fc00::/7 unique local
    if (/^fe[89ab]/.test(g0)) return true; // fe80::/10 link-local
    if (/^ff/.test(g0)) return true; // ff00::/8 multicast
    if (g0 === "2001" && groups[1] === "db8") return true; // 2001:db8::/32 docs
    return false;
  }

  const parts = clean.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) {
    return true; // malformed → block
  }
  const num = ipv4ToNum(parts);
  if (isLoopbackV4(num) || isLinkLocalV4(num)) return !allowLocal;
  return blockedV4.some((r) => num >= r.start && num <= r.end);
}

const isIpLiteral = (host: string): boolean => {
  if (host.includes(":")) return true; // IPv6 literal
  const parts = host.split(".");
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p));
};

export type OutboundUrlCheck = { ok: true } | { ok: false; reason: string };

/**
 * Validates a URL before the server performs an outbound fetch.
 * Call this again immediately before `fetch()` to keep DNS-rebinding
 * defenses effective.
 */
export async function assertSafeOutboundUrl(
  rawUrl: string,
): Promise<OutboundUrlCheck> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "Only http(s) URLs are allowed" };
  }

  const isProduction = env.NODE_ENV === "production";
  if (isProduction && parsed.protocol === "http:") {
    return { ok: false, reason: "Only https URLs are allowed in production" };
  }

  const hostname = parsed.hostname.toLowerCase();
  const allowLocal = !isProduction; // dev/test tooling may hit localhost

  if (isIpLiteral(hostname)) {
    return isBlockedIp(hostname, allowLocal)
      ? { ok: false, reason: "URL points to a private or reserved address" }
      : { ok: true };
  }

  let addresses: string[] = [];
  try {
    const resolved = await lookup(hostname, { all: true });
    addresses = resolved.map((a) => a.address);
  } catch {
    return { ok: false, reason: "Could not resolve host" };
  }

  if (addresses.length === 0) {
    return { ok: false, reason: "Could not resolve host" };
  }

  for (const addr of addresses) {
    if (isBlockedIp(addr, allowLocal)) {
      return {
        ok: false,
        reason: `URL resolves to a private or reserved address (${addr})`,
      };
    }
  }

  return { ok: true };
}
