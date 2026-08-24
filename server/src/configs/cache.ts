import { redis } from "./redis";
import { logger } from "../utilities/logger";
import {
  getMemCache,
  setMemCache,
  deleteMemCache,
  clearMemCacheByPrefix,
  clearMemCacheByPattern,
} from "../utilities/chatCache";

// In-memory layer in front of the Redis cache. Every read pays an Upstash
// HTTPS round-trip (~100-200ms on the free tier); serving repeat reads from
// process memory cuts that to ~1ms. The same shared store already backs the
// chat hot path (chat.controllers uses getMemCache/setMemCache directly),
// so feed / notifications / users / posts get the identical treatment here.
//
// Safety: entries live in memory for only a few seconds (short TTL), so even
// if an eviction were missed, stale data can never be served for long. Writes
// go to BOTH layers; every delete/pattern-clear purges BOTH layers so the
// zero-latency reads can't go stale. Per-instance by design — degrades
// gracefully on horizontally-scaled deployments (Redis remains authoritative).
const MEM_TTL_SECONDS = 10;

// SCAN-based pattern deletion — avoids O(N) blocking of KEYS
export const clearByPattern = async (pattern: string) => {
  // Purge matching in-memory entries first — zero-latency reads must not
  // serve data we just invalidated in Redis.
  clearMemCacheByPattern(pattern);
  try {
    let cursor: string | number = 0;
    const batchSize = 100;
    do {
      const result: [string, string[]] = await redis.scan(cursor, { match: pattern, count: batchSize });
      cursor = result[0];
      const keys = result[1];
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
  } catch (err: any) {
    logger.error("Error clearing cache by pattern", { pattern, error: err.message });
  }
};

// get data from cache
export const getCache = async <T>(key: string): Promise<T | null> => {
  // 1) In-memory first — zero-latency repeat reads within the TTL window
  const mem = getMemCache<T>(key);
  if (mem !== null) return mem;
  try {
    const data = await redis.get<T>(key);
    // 2) On a Redis hit, warm the in-memory layer for the next N seconds
    if (data !== null) {
      setMemCache(key, data, MEM_TTL_SECONDS);
    }
    return data ?? null;
  } catch (err: any) {
    logger.error("Error getting cache", { key, error: err.message });
    return null;
  }
};

// store data in cache
export const setCache = async (
  key: string,
  value: unknown,
  ttl: number = 1800,
) => {
  // Write through to both layers — memory TTL is capped short so the fast
  // copy can never outlive the authoritative Redis TTL by much.
  setMemCache(key, value, Math.min(ttl, MEM_TTL_SECONDS));
  try {
    await redis.set(key, value, {
      ex: ttl,
    });
  } catch (err: any) {
    logger.error("Error setting cache", { key, error: err.message });
  }
};

// delete single item from cache
export const deleteCache = async (key: string) => {
  // Exact-key purge from memory (never a prefix over-delete)
  deleteMemCache(key);
  // Also purge any entries that were namespaced UNDER this key (e.g.
  // "user:<id>" alongside "user:<id>:posts") so a parent delete can't
  // leave stale children behind.
  clearMemCacheByPrefix(key + ":");
  try {
    await redis.del(key);
  } catch (err: any) {
    logger.error("Error deleting cache", { key, error: err.message });
  }
};

// clear posts list cache
export const clearFeedCache = async () => {
  await clearByPattern("posts:*");
  await clearByPattern("api:*:*posts*");
};

// clear users list cache
export const clearUsersCache = async () => {
  await clearByPattern("users:*");
  await clearByPattern("api:*:*users*");
};

// clear comments list cache for a post
export const clearCommentsCache = async (postId: string) => {
  // Top-level paginated comment lists (controller-level keys)
  await clearByPattern(`comments:${postId}:*`);
  // Per-post ALL-comments cache is keyed `comments:all:<postId>:<userId>`
  // (note the trailing `:${userId}` — an exact delete never matched it)
  await clearByPattern(`comments:all:${postId}:*`);
  // Reply threads for any comment on this post (controller-level keys)
  await clearByPattern("comments:replies:*");

  // NOTE on the route-level cacheMiddleware (`api:<userId>:<path>:<query>`):
  // it was removed from the comment routes in comment.routes.ts because the
  // router-relative path here is `/<postId>` — indistinguishable from other
  // routes' keys, so no pattern could ever reliably clear it. That un-cleared
  // layer is exactly what served stale (empty) comment lists for up to 60s.
  // The patterns below only clear the replies middleware keys (`/replies/<id>`
  // is a unique router-relative prefix) plus any legacy keys.
  await clearByPattern("api:*:/replies*");
  await clearByPattern("api:*:*comments*"); // legacy keys (if any)
};

// clear followers and following list cache
export const clearFollowCache = async (userId: string, followerId: string) => {
  await clearByPattern(`followers:${userId}:*`);
  await clearByPattern(`following:${followerId}:*`);
};

// clear saved posts list cache
export const clearSavesCache = async (userId: string) => {
  await clearByPattern(`saves:${userId}:*`);
};

export const clearDraftsCache = async (userId: string) => {
  await clearByPattern(`drafts:${userId}:*`);
};

// clear user posts cache
export const clearUserPostsCache = async (userId: string) => {
  await clearByPattern(`user:${userId}:posts:*`);
};

// clear user by username cache
export const clearUserByUsernameCache = async (username: string) => {
  await clearByPattern(`user:username:${username}`);
};

// clear user by id cache
export const clearUserByIdCache = async (userId: string) => {
  await clearByPattern(`user:${userId}`);
};

// clear hashtag cache
export const clearHashtagCache = async () => {
  await clearByPattern("hashtag:*");
};

// clear chat conversations and messages list cache
export const clearChatCache = async (conversationId: string, participantIds: string[]) => {
  // Purge the in-memory layer first (zero-latency reads must not go stale).
  // Thread + media caches live under one per-conversation prefix
  // (`chat:conv:<id>:*`) so a single SCAN+DEL evicts both — one fewer
  // Upstash round-trip per send on the free tier.
  clearMemCacheByPrefix(`chat:conv:${conversationId}`);
  await clearByPattern(`chat:conv:${conversationId}:*`);
  for (const userId of participantIds) {
    clearMemCacheByPrefix(`chat:conversations:${userId}`);
    await deleteCache(`chat:conversations:${userId}`);
    // Also invalidate the route-level cacheMiddleware keys
    // (format: `api:{userId}:{path}:{query}`) so the conversations list
    // and message lists never serve stale unread counts after a message
    // mutation. Without this, the cached GET /api/chats/conversations
    // response shows outdated unreadCounts for up to 30s, causing the
    // "badge shows wrong count" + "notification badge missing" bugs.
    await clearByPattern(`api:${userId}:/api/chats/conversations*`);
  }
};
