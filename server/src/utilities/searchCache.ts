/**
 * searchCache.ts — Tiny in-memory cache for message-search results.
 *
 * WHY: Free-tier databases (shared MongoDB Atlas clusters) take 200-400ms
 * per regex query. Debounced chat search fires a request per keystroke,
 * and users naturally repeat/backspace queries — so without caching every
 * search is a full slow DB round-trip and the UI feels sluggish.
 *
 * This cache stores the final JSON payload for (conversation|community, query)
 * with a short TTL (15s). Repeat searches within the TTL resolve in ~1ms.
 * The TTL is short enough that new messages show up on the next search soon
 * after, and sending a message evicts the target's entries immediately.
 *
 * NOTE: per-instance memory. On a single free-tier instance that covers all
 * users; on a horizontally-scaled deployment it degrades gracefully (each
 * instance caches independently).
 */

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const TTL_MS = 15_000;
const MAX_ENTRIES = 400;

const store = new Map<string, CacheEntry>();

/** Read a cached search payload for a key, or null if absent/expired. */
export function getSearchCache<T = unknown>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

/** Store a search payload under a key with the shared TTL. */
export function setSearchCache(key: string, value: unknown): void {
  // Keep the map bounded — evict the oldest entry when full (Map preserves
  // insertion order, so the first key is the oldest).
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expiresAt: Date.now() + TTL_MS });
}

/**
 * Evict every cached entry for a search target (a conversation or a
 * community). Called when a new message is sent/edited/deleted so the very
 * next search reflects the change instead of waiting for the TTL.
 *
 * @param prefix  e.g. "chat:<conversationId>" or "comm:<communityId>"
 */
export function clearSearchCacheForTarget(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix + ":")) {
      store.delete(key);
    }
  }
}
