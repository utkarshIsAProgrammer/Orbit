/**
 * In-Memory Caching Middleware for API Responses
 *
 * Uses the same in-memory LRU cache that backs the chat hot path
 * (chatCache.ts / getMemCache / setMemCache). This avoids Upstash Redis
 * round-trips on every GET request — the in-memory layer serves repeat
 * reads in ~1µs instead of ~100-200ms per REST call.
 *
 * NOTE: This replaced the previous Redis-based cacheMiddleware to reduce
 * Upstash command usage on the free tier. The in-memory cache is per-process
 * and clears on server restart, which is fine for a single-instance free-tier
 * deployment.
 */

import { Request, Response, NextFunction } from 'express';
import {
  getMemCache,
  setMemCache,
  clearMemCacheByPattern,
} from '../utilities/chatCache';
import { logger } from '../utilities/logger';

interface CacheOptions {
  ttl?: number; // Time to live in seconds (default: 300 = 5 min)
  keyPrefix?: string;
  skipCache?: boolean;
}

/**
 * Generate a unique cache key from the FULL request path + query + user ID.
 */
const generateCacheKey = (req: Request, prefix: string = ''): string => {
  const userId = req.user?._id?.toString() || (req.user as any)?.id || 'anonymous';
  const fullPath =
    `${req.baseUrl || ''}${req.path}` || req.originalUrl.split('?')[0];
  const query = JSON.stringify(req.query);
  return `${prefix}:${userId}:${fullPath}:${query}`;
};

/**
 * Cache middleware factory.
 * Intercepts GET responses and caches them in-memory (no Redis).
 */
export const cacheMiddleware = (options: CacheOptions = {}) => {
  const { ttl = 300, keyPrefix = 'api', skipCache = false } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    // Only cache GET requests
    if (req.method !== 'GET' || skipCache) {
      return next();
    }

    try {
      const cacheKey = generateCacheKey(req, keyPrefix);

      // Try in-memory cache first (zero-latency)
      const cached = getMemCache<string>(cacheKey);

      if (cached) {
        const raw = typeof cached === 'string' ? JSON.parse(cached) : cached;
        if (
          raw &&
          typeof raw === 'object' &&
          typeof raw.statusCode === 'number' &&
          'data' in raw
        ) {
          return res.status(raw.statusCode).json(raw.data);
        }
        return res.json(raw);
      }

      // Intercept res.json() to capture and cache the response.
      const originalJson = res.json.bind(res);

      res.json = function(data: any) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // Cache in-memory only (no Redis round-trip)
          setMemCache(cacheKey, JSON.stringify({ statusCode: res.statusCode, data }), ttl);
        }

        return originalJson(data);
      };

      next();
    } catch (error: any) {
      logger.error('Cache middleware error', { error: error?.message });
      next();
    }
  };
};

/**
 * Invalidate in-memory cache entries matching a prefix pattern.
 */
export const invalidateCache = async (pattern: string): Promise<void> => {
  try {
    clearMemCacheByPattern(pattern);
  } catch (error: any) {
    logger.error('Cache invalidation error', { pattern, error: error?.message });
  }
};
