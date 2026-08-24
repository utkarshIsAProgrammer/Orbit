/**
 * chatCache.ts — Tiny in-memory cache for the personal-chat hot path
 * (conversation list + message history).
 *
 * WHY: The free-tier stack pays ~100-200ms per Upstash Redis HTTPS round-trip
 * and ~200-400ms per shared-Atlas query. The conversations list and message
 * history are re-fetched constantly (tab switches, socket-triggered refresh,
 * app opens), so serving repeat loads straight from process memory cuts
 * perceived latency from hundreds of milliseconds to ~1ms.
 *
 * Eviction: every chat mutation (send / edit / delete / delete-for-me /
 * pin / unpin / reaction) already calls clearChatCache() with the affected
 * conversation + participants — that function now also purges the matching
 * in-memory entries, so the cache never goes stale on writes.
 *
 * NOTE: per-instance memory. On a single free-tier instance that covers all
 * users; on a horizontally-scaled deployment it degrades gracefully (each
 * instance caches independently, and the Redis layer still works).
 */

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

// Shared store: chat hot path + the general Redis-backed cache (configs/
// cache.ts) both read/write through here, so budget more room than chat alone.
const MAX_ENTRIES = 2000;

const store = new Map<string, CacheEntry>();

/** Read a cached payload for a key, or null if absent/expired. */
export function getMemCache<T = unknown>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

/** Store a payload under a key with the given TTL (seconds). */
export function setMemCache(key: string, value: unknown, ttlSeconds = 10): void {
  // Keep the map bounded — evict the oldest entry when full (Map preserves
  // insertion order, so the first key is the oldest).
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/**
 * Evict every cached entry whose key starts with `prefix`. Called on chat
 * mutations so the very next read reflects the change instead of waiting
 * for the TTL.
 *
 * @param prefix  e.g. "chat:messages:<conversationId>" or
 *                "chat:conversations:<userId>"
 */
export function clearMemCacheByPrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}

/** Delete a single cached entry by exact key (no prefix over-delete). */
export function deleteMemCache(key: string): void {
  store.delete(key);
}

/**
 * Evict every cached entry whose key matches a Redis-style glob pattern
 * (only `*` wildcards — the only form used by configs/cache.ts patterns).
 * Fast path: a trailing `:*` becomes a prefix scan.
 */
export function clearMemCacheByPattern(pattern: string): void {
  if (pattern.endsWith(":*")) {
    clearMemCacheByPrefix(pattern.slice(0, -1));
    return;
  }
  const regex = new RegExp(
    "^" +
      pattern
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      "$",
  );
  for (const key of store.keys()) {
    if (regex.test(key)) store.delete(key);
  }
}
