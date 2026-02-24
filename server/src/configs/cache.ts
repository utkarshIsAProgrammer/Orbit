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
// chat hot path (chat.controllers uses getMemCache/setMemCache directly), so
// feed / notifications / users / posts get the identical treatment here.
const MEM_TTL_SECONDS = 10;

// ── Helpers ────────────────────────────────────────────────────────────

const del = async (...keys: string[]) => {
  if (keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch (err: any) {
    logger.error("Error deleting cache keys", { keys, error: err.message });
  }
};

// SCAN-based pattern deletion — expensive (3-5+ Redis commands per call).
// Only use when you genuinely don't know the keys. Prefer direct del().
export const clearByPattern = async (pattern: string) => {
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

// ── Core cache operations ──────────────────────────────────────────────

export const getCache = async <T>(key: string): Promise<T | null> => {
  const mem = getMemCache<T>(key);
  if (mem !== null) return mem;
  try {
    const data = await redis.get<T>(key);
    if (data !== null) {
      setMemCache(key, data, MEM_TTL_SECONDS);
    }
    return data ?? null;
  } catch (err: any) {
    logger.error("Error getting cache", { key, error: err.message });
    return null;
  }
};

export const setCache = async (
  key: string,
  value: unknown,
  ttl: number = 1800,
) => {
  setMemCache(key, value, Math.min(ttl, MEM_TTL_SECONDS));
  try {
    await redis.set(key, value, { ex: ttl });
  } catch (err: any) {
    logger.error("Error setting cache", { key, error: err.message });
  }
};

export const deleteCache = async (key: string) => {
  deleteMemCache(key);
  clearMemCacheByPrefix(key + ":");
  try {
    await redis.del(key);
  } catch (err: any) {
    logger.error("Error deleting cache", { key, error: err.message });
  }
};

// ── Feed cache ─────────────────────────────────────────────────────────
// Called on EVERY post mutation (like, save, repost, comment, etc.).
// Previously used 3 SCAN loops (posts:*, api:*:*posts*) = ~15 Redis cmds.
// Now: 2 direct deletes + 1 short SCAN = ~3-5 cmds total.
export const clearFeedCache = async () => {
  await del("posts:feed", "posts:trending");
  // Only scan for user-specific post caches (unknown keys)
  await clearByPattern("posts:author:*");
};

// ── Comments cache ─────────────────────────────────────────────────────
// Previously used 5+ SCAN loops per call. Now: 3 direct deletes.
export const clearCommentsCache = async (postId: string) => {
  await del(
    `comments:${postId}:top`,
    `comments:${postId}:latest`,
    `comments:all:${postId}`,
    `comments:replies:${postId}`,
  );
};

// ── Follow cache ───────────────────────────────────────────────────────
export const clearFollowCache = async (userId: string, followerId: string) => {
  await del(
    `followers:${userId}`,
    `following:${followerId}`,
  );
  // Pattern clear only for paginated follow lists (unknown keys)
  await clearByPattern(`followers:${userId}:page:*`);
  await clearByPattern(`following:${followerId}:page:*`);
};

// ── Saves cache ────────────────────────────────────────────────────────
export const clearSavesCache = async (userId: string) => {
  await del(`saves:${userId}`);
  await clearByPattern(`saves:${userId}:page:*`);
};

// ── Drafts cache ───────────────────────────────────────────────────────
export const clearDraftsCache = async (userId: string) => {
  await del(`drafts:${userId}`);
  await clearByPattern(`drafts:${userId}:page:*`);
};

// ── User posts cache ───────────────────────────────────────────────────
export const clearUserPostsCache = async (userId: string) => {
  await del(`user:${userId}:posts`);
  await clearByPattern(`user:${userId}:posts:page:*`);
};

// ── User by username cache ─────────────────────────────────────────────
export const clearUserByUsernameCache = async (username: string) => {
  await del(`user:username:${username}`);
};

// ── User by id cache ───────────────────────────────────────────────────
export const clearUserByIdCache = async (userId: string) => {
  await del(`user:${userId}`);
};

// ── Hashtag cache ──────────────────────────────────────────────────────
export const clearHashtagCache = async () => {
  await clearByPattern("hashtag:*");
};

// ── Users list cache ───────────────────────────────────────────────────
export const clearUsersCache = async () => {
  await clearByPattern("users:all:*");
};

// ── Chat cache (already optimized with direct deletes) ─────────────────
export const clearChatCache = async (conversationId: string, participantIds: string[]) => {
  clearMemCacheByPrefix(`chat:conv:${conversationId}`);
  await del(`chat:conv:${conversationId}`);
  const participantKeys: string[] = [];
  for (const userId of participantIds) {
    clearMemCacheByPrefix(`chat:conversations:${userId}`);
    participantKeys.push(`chat:conversations:${userId}`);
  }
  if (participantKeys.length > 0) {
    await del(...participantKeys);
  }
};

// ETag: SHA-1 of public_id + version; clients revalidate with If-None-Match

// pipe invalidations: MDEL for post, feed:userId, feed:public in single round-trip
