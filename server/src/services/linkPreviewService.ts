import dns from "dns/promises";
import net from "net";
import { logger } from "../utilities/logger";

interface LinkPreviewData {
  url: string;
  title: string;
  description: string;
  image: string;
  favicon: string;
  siteName: string;
}

const OG_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const cache = new Map<string, { data: LinkPreviewData; expires: number }>();

// Max response body we will read when fetching a preview (512 KB).
// Prevents a malicious/huge page from exhausting server memory.
const MAX_BODY_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

/** IPv4 private/loopback/link-local/reserved ranges (CIDR). */
const BLOCKED_IPV4_RANGES: Array<[number, number]> = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10.0.0.0/8
  [0x7f000000, 8], // 127.0.0.0/8 (loopback)
  [0x64400000, 10], // 100.64.0.0/10 (CGNAT)
  [0xa9fe0000, 16], // 169.254.0.0/16 (link-local, incl. cloud metadata)
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xc0000000, 24], // 192.0.0.0/24
  [0xc0000200, 24], // 192.0.2.0/24 (documentation)
  [0xc0586300, 24], // 192.88.99.0/24
  [0xc6336400, 24], // 198.51.100.0/24 (TEST-NET-2 documentation)
  [0xcb007100, 24], // 203.0.113.0/24 (documentation)
  [0xe0000000, 4], // 224.0.0.0/4 (multicast)
  [0xf0000000, 4], // 240.0.0.0/4 (reserved)
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return null;
  }
  return (
    ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0
  );
}

function isBlockedIpv4(ip: string): boolean {
  const int = ipv4ToInt(ip);
  if (int === null) return true; // malformed → treat as blocked
  return BLOCKED_IPV4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : 0xffffffff << (32 - bits);
    return (int & mask) === (base & mask);
  });
}

/**
 * Block IPv6 loopback, link-local, ULA (fc00::/7), multicast, and
 * IPv4-mapped private addresses (::ffff:a.b.c.d).
 */
function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) — check the embedded IPv4.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) {
    return isBlockedIpv4(mapped[1]);
  }

  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 ULA
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
    return true; // fe80::/10 link-local
  }
  if (lower.startsWith("ff")) return true; // ff00::/8 multicast
  if (lower.startsWith("::ffff:")) return true; // other v4-mapped
  if (lower.startsWith("2001:db8")) return true; // documentation range
  return false;
}

function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isBlockedIpv4(ip);
  if (net.isIPv6(ip)) return isBlockedIpv6(ip);
  return true; // unknown format
}

/**
 * Resolve a hostname (or literal IP) and reject it if ANY resolved address
 * is private/internal. This defeats DNS-rebinding: an attacker-controlled
 * domain that alternates between a public IP and 169.254.169.254 is caught
 * because we check every address the resolver returns.
 */
async function isBlockedHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  // Fast-path obvious internal hostnames (also avoids a DNS round-trip).
  if (
    host === "localhost" ||
    host === "localhost.localdomain" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa") ||
    host.endsWith(".lan") ||
    host.endsWith(".localdomain")
  ) {
    return true;
  }

  if (net.isIP(host)) {
    return isBlockedIp(host);
  }

  try {
    const addresses = await dns.lookup(host, { all: true, verbatim: true });
    if (addresses.length === 0) return true;
    return addresses.some((a) => isBlockedIp(a.address));
  } catch {
    // Resolution failure (NXDOMAIN etc.) — nothing safe to fetch.
    return true;
  }
}

function isBlockedUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return true;
    }
    return !!(parsed.username || parsed.password);
  } catch {
    return true;
  }
}

/**
 * Read up to MAX_BODY_BYTES from a fetch response body.
 */
async function readLimitedBody(response: Response): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > MAX_BODY_BYTES) {
        // Keep only the first MAX_BODY_BYTES, then stop reading.
        const keep = value.byteLength - (received - MAX_BODY_BYTES);
        chunks.push(value.subarray(0, Math.max(0, keep)));
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

/**
 * Fetch a URL with redirect re-validation. Every hop (initial + redirects)
 * must pass the same private-host check so a public URL can never redirect
 * us into the internal network.
 */
async function safeFetch(
  urlStr: string,
  redirectsLeft: number,
): Promise<Response | null> {
  if (await isBlockedHost(new URL(urlStr).hostname)) {
    logger.warn("Blocked SSRF attempt in link preview", { url: urlStr });
    return null;
  }

  const response = await fetch(urlStr, {
    headers: {
      "User-Agent": "Orbit/1.0 (Link Preview Bot)",
      Accept: "text/html",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(6000),
  });

  if (
    response.status >= 300 &&
    response.status < 400 &&
    response.headers.get("location")
  ) {
    const location = response.headers.get("location")!;
    const nextUrl = new URL(location, urlStr).href;
    if (redirectsLeft <= 0 || isBlockedUrl(nextUrl)) {
      return null;
    }
    return safeFetch(nextUrl, redirectsLeft - 1);
  }

  return response;
}

/**
 * Fetch OG metadata from a URL.
 */
export async function fetchLinkPreview(url: string): Promise<LinkPreviewData | null> {
  try {
    if (isBlockedUrl(url)) {
      logger.warn("Blocked SSRF attempt in link preview", { url });
      return null;
    }

    // Check cache first
    const cached = cache.get(url);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    const response = await safeFetch(url, MAX_REDIRECTS);
    if (!response) return null;
    if (!response.ok) return null;

    const html = await readLimitedBody(response);
    const preview = parseOGMetadata(html, url);

    // Cache the result
    if (preview.title || preview.description || preview.image) {
      cache.set(url, { data: preview, expires: Date.now() + OG_CACHE_TTL });
    }

    return preview;
  } catch (err) {
    logger.warn("Failed to fetch link preview", { url, error: (err as Error).message });
    return null;
  }
}

/**
 * Parse OG metadata from HTML content.
 */
function parseOGMetadata(html: string, originalUrl: string): LinkPreviewData {
  const getMeta = (property: string): string => {
    const patterns = [
      new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, "i"),
      new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`, "i"),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return match[1];
    }
    return "";
  };

  const getTitle = (): string => {
    // Try og:title first
    const og = getMeta("og:title");
    if (og) return og;
    // Try twitter:title
    const tw = getMeta("twitter:title");
    if (tw) return tw;
    // Fallback to <title>
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    return titleMatch?.[1]?.trim() || "";
  };

  const getDescription = (): string => {
    const og = getMeta("og:description");
    if (og) return og;
    const tw = getMeta("twitter:description");
    if (tw) return tw;
    const desc = getMeta("description");
    return desc;
  };

  const getImage = (): string => {
    const og = getMeta("og:image");
    if (og) return makeAbsolute(og, originalUrl);
    const tw = getMeta("twitter:image");
    if (tw) return makeAbsolute(tw, originalUrl);
    // Try to find the first large image
    const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
    if (imgMatch?.[1]) return makeAbsolute(imgMatch[1], originalUrl);
    return "";
  };

  const getFavicon = (): string => {
    const iconMatch = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i);
    if (iconMatch?.[1]) return makeAbsolute(iconMatch[1], originalUrl);
    return `${new URL(originalUrl).origin}/favicon.ico`;
  };

  const getSiteName = (): string => {
    const og = getMeta("og:site_name");
    if (og) return og;
    return new URL(originalUrl).hostname.replace("www.", "");
  };

  return {
    url: originalUrl,
    title: getTitle(),
    description: getDescription(),
    image: getImage(),
    favicon: getFavicon(),
    siteName: getSiteName(),
  };
}

/**
 * Make a relative URL absolute.
 */
function makeAbsolute(src: string, base: string): string {
  if (src.startsWith("http://") || src.startsWith("https://")) return src;
  if (src.startsWith("//")) return `https:${src}`;
  return new URL(src, base).href;
}
