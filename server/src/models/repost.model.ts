import mongoose from "mongoose";

// repost schema
const repostSchema = new mongoose.Schema(
  {
    // user who reposted
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // original native post
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      default: null,
    },

    // reposted imported open-web post (external posts are a separate collection)
    externalPost: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExternalPost",
      default: null,
    },
  },
  { timestamps: true },
);

// unique repost indexes (only store document when post and externalPost exists)
// NOTE: partialFilterExpression must use $type (not $ne) — MongoDB rejects
// $ne/$not in partial filter expressions, which silently prevented these
// unique indexes from being created.
//
// EXPLICIT names: a legacy non-partial `user_1_post_1` unique index sits in
// the DB under the auto-generated name. MongoDB refuses to build a DIFFERENT
// index (partial) under the same name, so these get distinct names and
// scripts/sync-indexes.ts drops the stale legacy ones. The legacy index is
// harmful: its non-partial uniqueness lets a user repost only ONE external
// post (post: null) ever.
repostSchema.index(
  { user: 1, post: 1 },
  {
    name: "user_1_post_1_partial",
    unique: true,
    partialFilterExpression: { post: { $type: "objectId" } },
  },
);

repostSchema.index(
  { user: 1, externalPost: 1 },
  {
    name: "user_1_externalPost_1_partial",
    unique: true,
    partialFilterExpression: { externalPost: { $type: "objectId" } },
  },
);

repostSchema.index({ user: 1, createdAt: -1 });
repostSchema.index({ post: 1, createdAt: -1 });
repostSchema.index({ externalPost: 1, createdAt: -1 });

// repost model
const Repost = mongoose.model("Repost", repostSchema);
export default Repost;
