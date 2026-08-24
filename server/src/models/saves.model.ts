import mongoose from "mongoose";

// save schema
const saveSchema = new mongoose.Schema(
  {
    // user who saved
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // saved post (native Orbit post)
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      default: null,
      index: true,
    },

    // saved imported open-web post (external posts are a separate collection)
    externalPost: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExternalPost",
      default: null,
      index: true,
    },

    // folder/category for organizing saves
    folder: {
      type: String,
      default: "General",
      maxlength: [50, "Folder name must be less than 50 characters!"],
      trim: true,
    },

    // note on the saved post
    note: {
      type: String,
      default: "",
      maxlength: [200, "Note must be less than 200 characters!"],
    },
  },

  { timestamps: true },
);

// unique save indexes — partial so native and external saves never collide
// ($type required: $ne/$not are rejected in partial index filters)
//
// EXPLICIT names: a legacy non-partial `user_1_post_1` unique index (created
// before external posts existed) sits in the DB under the auto-generated name.
// MongoDB refuses to build a DIFFERENT index (partial) under the same name, so
// the schema indexes get distinct names and scripts/sync-indexes.ts drops the
// stale legacy ones. The legacy index is harmful: its non-partial uniqueness
// lets a user save only ONE external post (post: null) ever.
saveSchema.index(
  { user: 1, post: 1 },
  {
    name: "user_1_post_1_partial",
    unique: true,
    partialFilterExpression: { post: { $type: "objectId" } },
  },
);
saveSchema.index(
  { user: 1, externalPost: 1 },
  {
    name: "user_1_externalPost_1_partial",
    unique: true,
    partialFilterExpression: { externalPost: { $type: "objectId" } },
  },
);
saveSchema.index({ user: 1, folder: 1 });
saveSchema.index({ user: 1, createdAt: -1 });
saveSchema.index({ post: 1, createdAt: -1 });

// save model
const Save = mongoose.model("Save", saveSchema);
export default Save;
