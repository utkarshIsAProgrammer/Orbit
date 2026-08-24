import mongoose from "mongoose";
import { User } from "../models/user.model";
import Interaction from "../models/interaction.model";
import { logger } from "../utilities/logger";

// ─── Action weights (tuneable) ─────────────────────────────────────

/**
 * Each interaction type carries a different weight reflecting its
 * engagement depth. These weight the contribution to the per-author
 * affinity score.
 */
const ACTION_WEIGHTS: Record<string, number> = {
  /** Passive — lightweight signal */
  like: 1,
  /** Active — deeper interest */
  comment: 4,
  /** Strong — intentional curation signal */
  save: 3,
  /** Strong — endorsement / reach amplification */
  share: 5,
  /** Strongest — direct 1:1 communication */
  dm: 6,
  /** Moderate — browsing signal */
  profileVisit: 1.5,
  /** Light — passive consumption */
  storyView: 0.5,
} as const;

/** Default weight for unknown action types */
const DEFAULT_WEIGHT = 1;

/**
 * Time-decay factor: each day ago reduces contribution by 5%.
 * contribution = weight × (0.95 ^ daysAgo)
 */
const TIME_DECAY_RATE = 0.95;

/** How many days of interaction history to consider */
const LOOKBACK_DAYS = 90;

/** Minimum affinity score to keep in the map (prune noise) */
const MIN_AFFINITY_THRESHOLD = 0.01;

// ─── Per-Author Affinity ───────────────────────────────────────────

/**
 * Compute the affinity score between a user and each author they've
 * interacted with over the lookback window.
 *
 * Algorithm:
 *   For each interaction:
 *     actionWeight  = ACTION_WEIGHTS[type]
 *     timeDecay     = 0.95 ^ daysAgo
 *     contribution  = actionWeight × timeDecay
 *   Sum all contributions per author, then apply Math.log1p() to
 *   compress the scale (diminishing returns for very high counts).
 *
 * Returns a Map<authorId, score>.
 */
async function computePerAuthorAffinity(
  userId: string
): Promise<Map<string, number>> {
  const since = new Date(
    Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  );

  const interactions = await Interaction.find({
    userId,
    timestamp: { $gte: since },
  })
    .select("targetAuthorId type timestamp")
    .lean();

  // Accumulate raw contributions per author
  const rawScores = new Map<string, number>();

  for (const ix of interactions) {
    const authorId = ix.targetAuthorId.toString();
    const weight = ACTION_WEIGHTS[ix.type] ?? DEFAULT_WEIGHT;
    const daysAgo =
      (Date.now() - new Date(ix.timestamp).getTime()) /
      (24 * 60 * 60 * 1000);
    const timeDecay = Math.pow(TIME_DECAY_RATE, Math.max(0, daysAgo));
    const contribution = weight * timeDecay;

    rawScores.set(authorId, (rawScores.get(authorId) || 0) + contribution);
  }

  // Apply log1p compression and prune noise
  const compressed = new Map<string, number>();
  for (const [authorId, raw] of rawScores) {
    const score = Math.log1p(raw);
    if (score >= MIN_AFFINITY_THRESHOLD) {
      compressed.set(authorId, score);
    }
  }

  return compressed;
}

// ─── Content / Tag Affinity ────────────────────────────────────────

/**
 * Compute the user's affinity to specific hashtags / content types
 * based on the tags of posts they've interacted with.
 *
 * For each interaction with a post that has hashtags, the tag receives
 * a contribution weighted by the interaction type and time decay.
 */
async function computeContentAffinity(
  userId: string
): Promise<Map<string, number>> {
  const since = new Date(
    Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  );

  const interactions = await Interaction.find({
    userId,
    timestamp: { $gte: since },
    postId: { $ne: null },
  })
    .select("postId type timestamp")
    .lean();

  if (interactions.length === 0) return new Map();

  // Fetch the hashtags for all posts that were interacted with
  const postIds = [
    ...new Set(interactions.map((ix) => ix.postId?.toString()).filter(Boolean)),
  ];

  const Post = mongoose.model("Post");
  const posts = await Post.find({ _id: { $in: postIds } })
    .select("hashtags")
    .lean();

  const postTags = new Map<string, string[]>();
  for (const post of posts) {
    postTags.set(
      (post as any)._id.toString(),
      (post as any).hashtags || []
    );
  }

  // Accumulate tag scores
  const tagScores = new Map<string, number>();

  for (const ix of interactions) {
    const pid = ix.postId?.toString();
    if (!pid) continue;
    const tags = postTags.get(pid);
    if (!tags || tags.length === 0) continue;

    const weight = ACTION_WEIGHTS[ix.type] ?? DEFAULT_WEIGHT;
    const daysAgo =
      (Date.now() - new Date(ix.timestamp).getTime()) /
      (24 * 60 * 60 * 1000);
    const timeDecay = Math.pow(TIME_DECAY_RATE, Math.max(0, daysAgo));
    const contribution = (weight * timeDecay) / tags.length; // spread across tags

    for (const tag of tags) {
      tagScores.set(tag, (tagScores.get(tag) || 0) + contribution);
    }
  }

  // Compress and prune
  const compressed = new Map<string, number>();
  for (const [tag, raw] of tagScores) {
    const score = Math.log1p(raw);
    if (score >= MIN_AFFINITY_THRESHOLD) {
      compressed.set(tag, score);
    }
  }

  return compressed;
}

// ─── Recompute Affinity for a Single User ──────────────────────────

/**
 * Full affinity recomputation for one user.
 * Call this from the scheduled job or incrementally on new interactions.
 */
export async function recomputeAffinityScores(
  userId: string
): Promise<void> {
  try {
    const [authorAffinity, contentAffinity] = await Promise.all([
      computePerAuthorAffinity(userId),
      computeContentAffinity(userId),
    ]);

    await User.findByIdAndUpdate(userId, {
      $set: {
        affinityScores: Object.fromEntries(authorAffinity),
        contentAffinity: Object.fromEntries(contentAffinity),
        affinityUpdatedAt: new Date(),
      },
    });

    logger.info("Affinity scores recomputed", {
      userId,
      authors: authorAffinity.size,
      tags: contentAffinity.size,
    });
  } catch (err: any) {
    logger.error("Failed to recompute affinity scores", {
      userId,
      error: (err as Error).message,
    });
  }
}

// ─── Incremental Update on New Interaction ─────────────────────────

/**
 * Lightweight incremental update: add a single interaction's contribution
 * to the cached affinity score. Avoids a full recomputation for every
 * like/comment/save.
 *
 * Call this from the logInteraction() hook so scores stay warm between
 * scheduled recomputations.
 */
export async function incrementAffinity(
  userId: string,
  targetAuthorId: string,
  interactionType: string,
  timestamp: Date = new Date(),
  hashtags: string[] = []
): Promise<void> {
  try {
    const daysAgo =
      (Date.now() - timestamp.getTime()) / (24 * 60 * 60 * 1000);
    const timeDecay = Math.pow(TIME_DECAY_RATE, Math.max(0, daysAgo));
    const weight = ACTION_WEIGHTS[interactionType] ?? DEFAULT_WEIGHT;
    const contribution = weight * timeDecay;

    // Incremental author affinity (using $inc on a Map field)
    await User.updateOne(
      { _id: userId },
      {
        $inc: { [`affinityScores.${targetAuthorId}`]: contribution },
      }
    );

    // Incremental content affinity for each hashtag
    if (hashtags.length > 0) {
      const tagContribution = contribution / hashtags.length;
      const incObj: Record<string, number> = {};
      for (const tag of hashtags) {
        incObj[`contentAffinity.${tag}`] = tagContribution;
      }
      await User.updateOne({ _id: userId }, { $inc: incObj });
    }
  } catch (err: any) {
    logger.error("Failed to increment affinity", {
      userId,
      targetAuthorId,
      error: (err as Error).message,
    });
  }
}

// ─── Log Interaction (called from controllers) ─────────────────────

/**
 * Record an interaction in the Interaction collection AND update the
 * user's affinity incrementally — the actual implementation, run by the
 * BullMQ gamification worker or as the inline fallback.
 */
export async function logInteractionInline(
  userId: string,
  targetAuthorId: string,
  postId: string | null,
  type: string,
  hashtags: string[] = []
): Promise<void> {
  try {
    const timestamp = new Date();

    // Fire-and-forget: write the interaction document
    await Interaction.create({
      userId,
      targetAuthorId,
      postId,
      // type is a free string but always one of the schema enum values at runtime
      type: type as
        | "like"
        | "comment"
        | "save"
        | "share"
        | "dm"
        | "profileVisit"
        | "storyView",
      timestamp,
    }).catch((_err: unknown) => {
      logger.error("Failed to persist interaction", {
        error: (_err as Error).message,
        userId,
        type,
      });
    });

    // Incremental affinity update (also fire-and-forget)
    await incrementAffinity(userId, targetAuthorId, type, timestamp, hashtags);
  } catch (err: any) {
    // Silently fail — interactions should never block the main action
    logger.error("Error in logInteractionInline", {
      error: (err as any)?.message,
      userId,
      type,
    });
  }
}

/**
 * Record an interaction in the Interaction collection AND update the
 * user's affinity incrementally.
 *
 * Prefers BullMQ: the interaction insert + affinity $inc updates (2-3 DB
 * writes) run on the gamification worker instead of the like/comment/save/
 * share/repost request paths. Falls back to the inline implementation when
 * BullMQ isn't configured. Silently fails either way — interactions never
 * block the main action.
 */
export async function logInteraction(
  userId: string,
  targetAuthorId: string,
  postId: string | null,
  type: string,
  hashtags: string[] = []
): Promise<void> {
  try {
    const { enqueueGamification } = await import("../configs/queue");
    const queued = await enqueueGamification("log_interaction", {
      userId,
      targetAuthorId,
      postId,
      type,
      hashtags,
    });
    if (queued) return;
  } catch (err: any) {
    logger.error("Interaction enqueue failed — logging inline", {
      userId,
      type,
      error: err.message,
    });
  }
  await logInteractionInline(userId, targetAuthorId, postId, type, hashtags);
}

// ─── Track a Post View (for seenPosts dedup) ────────────────────────

/**
 * Add a post ID to the user's seenPosts set (capped at 500 entries).
 */
export async function markPostAsSeen(
  userId: string,
  postId: string
): Promise<void> {
  try {
    await User.updateOne(
      { _id: userId },
      {
        $push: {
          seenPosts: {
            $each: [postId],
            $slice: -500, // Keep only the most recent 500
          },
        },
      }
    );
  } catch (err: any) {
    logger.error("Failed to mark post as seen", {
      userId,
      postId,
      error: (err as Error).message,
    });
  }
}

/**
 * Add multiple post IDs to the user's seenPosts set in a single bulk operation (capped at 500).
 */
export async function markPostsAsSeen(
  userId: string,
  postIds: string[]
): Promise<void> {
  if (postIds.length === 0) return;
  try {
    await User.updateOne(
      { _id: userId },
      {
        $push: {
          seenPosts: {
            $each: postIds,
            $slice: -500, // Keep only the most recent 500
          },
        },
      }
    );
  } catch (err: any) {
    logger.error("Failed to mark posts as seen in batch", {
      userId,
      postIds,
      error: (err as Error).message,
    });
  }
}
