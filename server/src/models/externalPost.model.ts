import mongoose from "mongoose";

/**
 * ExternalPost — imported content from the open social web.
 *
 * Each document is a normalized, deduplicated copy of a public post fetched
 * from Bluesky (AT Protocol), Mastodon, or Lemmy. Orbit never mutates the
 * original; these are read-only syndicated copies rendered in the "Web" tab.
 */
const externalPostSchema = new mongoose.Schema(
  {
    // Which network this came from
    source: {
      type: String,
      enum: ["bluesky", "mastodon", "lemmy"],
      required: true,
      index: true,
    },

    // Stable ID on the origin network (status id / post uri / lemmy post id)
    sourceId: {
      type: String,
      required: true,
    },
    // Globally unique (source + sourceId) for upsert-dedup
    dedupKey: {
      type: String,
      required: true,
      unique: true,
    },

    // Canonical URL back to the original post
    url: { type: String, default: "" },

    // Display content (HTML for mastodon, markdown for lemmy, text for bluesky)
    content: { type: String, default: "", maxlength: 20000 },

    // Author info copied from the origin network
    author: {
      handle: { type: String, default: "" }, // @user@instance / handle / actor name
      displayName: { type: String, default: "" },
      avatar: { type: String, default: "" },
      profileUrl: { type: String, default: "" },
    },

    // Media (images/videos) referenced from the origin network
    media: [
      {
        url: { type: String, default: "" },
        previewUrl: { type: String, default: "" },
        type: { type: String, default: "image" }, // image | video | gifv
      },
    ],

    // Origin-network engagement metrics (read-only snapshot)
    stats: {
      likes: { type: Number, default: 0 },
      reposts: { type: Number, default: 0 },
      replies: { type: Number, default: 0 },
    },

    // Orbit-native engagement — counted from the Like/Save collections
    // (keyed by externalPost), so imported posts behave exactly like native
    // posts everywhere in the app.
    orbitLikesCount: { type: Number, default: 0 },
    orbitSavesCount: { type: Number, default: 0 },
    // Orbit-native reposts (Repost collection keyed by externalPost) and
    // comments (Comment collection keyed by externalPost).
    orbitRepostsCount: { type: Number, default: 0 },
    orbitCommentsCount: { type: Number, default: 0 },

    // Original creation time on the origin network
    originalCreatedAt: { type: Date, required: true },
  },
  { timestamps: true, collection: "externalposts" }
);

externalPostSchema.index({ source: 1, originalCreatedAt: -1 });
externalPostSchema.index({ originalCreatedAt: -1 });

const ExternalPost = mongoose.model("ExternalPost", externalPostSchema);
export default ExternalPost;
