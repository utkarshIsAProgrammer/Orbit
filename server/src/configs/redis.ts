import { Redis } from "@upstash/redis";
import { env } from "./env";
import { logger } from "../utilities/logger";

/**
 * Upstash Redis client for caching.
 *
 * Uses HTTPS REST API (not TCP). When credentials are empty
 * (e.g. in development without Upstash), the client is a no-op
 * that gracefully catches all errors — cache ops silently fall
 * through so the server can run without external Redis.
 */
function createRedisClient(): Redis {
  // Trim aggressively: Render/panel pastes often smuggle in surrounding
  // quotes, trailing newlines or spaces ("https://...upstash.io\n" was a real
  // production crash). A malformed URL must NEVER take the server down — it
  // falls through to the no-op proxy below so boot always succeeds.
  const url = (env.UPSTASH_REDIS_REST_URL || "").trim().replace(/^"|"$/g, "");
  const token = (env.UPSTASH_REDIS_REST_TOKEN || "").trim().replace(/^"|"$/g, "");

  const noopClient = (): Redis => {
    logger.info(
      "Upstash Redis not configured — caching will be disabled. " +
      "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to enable."
    );

    // Genuine no-op client: cache methods resolve instantly instead of
    // hanging on network timeouts against a placeholder URL. This keeps
    // dev/test environments and deployments without Redis snappy.
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, prop: string | symbol) => {
        const name = String(prop);
        // scan() must return [cursor, keys] — cursor "0" ends the loop
        if (name === "scan") {
          return async () => ["0", []] as [string, string[]];
        }
        // set/del return strings
        if (name === "set" || name === "del") {
          return async () => "OK";
        }
        // Everything else (get, hget, etc.) resolves to null
        return async () => null;
      },
    }) as unknown as Redis;
  };

  if (!url || !token) return noopClient();

  // URL must actually look like an https URL — catches stray quotes/newlines
  // that survived trimming and would throw UrlError at construction.
  if (!/^https?:\/\//i.test(url)) {
    logger.warn(
      "Upstash Redis URL is invalid — caching will be disabled. " +
        `Received: ${JSON.stringify(url)}`,
    );
    return noopClient();
  }

  try {
    return new Redis({ url, token });
  } catch (err: any) {
    logger.warn(
      "Upstash Redis client failed to initialize — caching disabled. " +
        `Error: ${err?.message || err}`,
    );
    return noopClient();
  }
}

export const redis = createRedisClient();
