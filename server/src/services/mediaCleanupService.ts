/**
 * mediaCleanupService.ts — Cloudinary destroy fan-out for deleted content.
 *
 * Every message/post/community-message/glimpse delete has to destroy its
 * uploaded media (external HTTP per file). This used to be fire-and-forget
 * `Promise.allSettled(cloudinary.uploader.destroy(...))` blocks scattered
 * across controllers, running on the request event loop with no retry.
 *
 * `cleanupMedia` prefers the BullMQ `orbit-media-cleanup` queue (retries +
 * off the request path) and falls back to `cleanupMediaInline` when BullMQ
 * isn't configured — so behavior is identical without REDIS_URL.
 */

import cloudinary from "../configs/cloudinary";
import { logger } from "../utilities/logger";

type ResourceType = "image" | "video";

/**
 * Destroy the given Cloudinary public IDs, logging per-failure (never
 * throwing). Used by the BullMQ media-cleanup worker and as the inline
 * fallback.
 */
export async function cleanupMediaInline(
  publicIds: string[],
  resourceType: ResourceType = "image",
): Promise<void> {
  const ids = (publicIds || []).filter(Boolean);
  if (ids.length === 0) return;

  const results = await Promise.allSettled(
    ids.map((pubId) =>
      cloudinary.uploader.destroy(pubId, { resource_type: resourceType }),
    ),
  );
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      logger.error("Cloudinary deletion failed", {
        publicId: ids[i],
        resourceType,
        error: result.reason,
      });
    }
  });
}

/**
 * Destroy the given Cloudinary public IDs — queued via BullMQ when
 * configured (retries + off the request path), inline otherwise. Fire and
 * forget: never throws.
 */
export async function cleanupMedia(
  publicIds: string[],
  resourceType: ResourceType = "image",
): Promise<void> {
  try {
    const { enqueueMediaCleanup } = await import("../configs/queue");
    const queued = await enqueueMediaCleanup(publicIds, resourceType);
    if (queued) return;
  } catch (err: any) {
    logger.error("Media cleanup enqueue failed — destroying inline", {
      error: err.message,
    });
  }
  await cleanupMediaInline(publicIds, resourceType);
}
