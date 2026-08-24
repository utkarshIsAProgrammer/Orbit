import mongoose from "mongoose";

/**
 * Tracks every meaningful user-to-author interaction for feed ranking.
 * Each document records one atomic action (like, comment, save, share, etc.)
 * so the affinity engine can aggregate and score them later.
 */
const interactionSchema = new mongoose.Schema(
  {
    // The user who performed the action
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // The author of the post that was acted upon
    targetAuthorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // The post that was interacted with (nullable for profile-visit / DM actions)
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      default: null,
    },

    // Type of interaction — used to weight the affinity contribution
    type: {
      type: String,
      enum: [
        "like",
        "comment",
        "save",
        "share",
        "dm",
        "profileVisit",
        "storyView",
      ],
      required: true,
    },

    // When the interaction occurred (defaults to now, can be overridden for backfill)
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

// ─── Indexes ───────────────────────────────────────────────────────

// Primary lookup: all interactions by a user (for affinity computation)
interactionSchema.index({ userId: 1, targetAuthorId: 1 });

// Time-bounded queries: "interactions in the last N days"
interactionSchema.index({ userId: 1, timestamp: -1 });

// Used when computing per-author aggregates
interactionSchema.index({ targetAuthorId: 1, timestamp: -1 });

// Fast dedup check and single-interaction lookup
interactionSchema.index({ userId: 1, postId: 1, type: 1 });

// TTL index: automatically remove interactions older than 90 days.
// This matches the affinity engine's LOOKBACK_DAYS (90) — interactions
// beyond this window are never queried and can be safely purged by MongoDB.
interactionSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

const Interaction = mongoose.model("Interaction", interactionSchema);
export default Interaction;
