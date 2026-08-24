import mongoose from "mongoose";

const glimpseSchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Media URL and Cloudinary public_id (supports both images and videos)
    media: {
      url: { type: String, default: "" },
      public_id: { type: String, default: "" },
    },

    // Type of media: "image" or "video"
    mediaType: {
      type: String,
      enum: ["image", "video"],
      default: "image",
    },

    viewers: {
      type: [
        {
          user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
          },
          viewedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },

    // Total number of unique viewers — the display count. The `viewers` array
    // above is capped on write (recent N only) so a viral glance can never
    // balloon its document; this counter stays exact no matter how many views
    // the glance gets.
    viewerCount: {
      type: Number,
      default: 0,
    },

    reactions: {
      type: [
        {
          user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
          },
          emoji: {
            type: String,
            required: true,
          },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },

    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 12 * 60 * 60 * 1000), // 12 hours
    },

    // Visibility: public | closeFriends
    visibility: {
      type: String,
      enum: ["public", "closeFriends"],
      default: "public",
      index: true,
    },

  },
  { timestamps: true, collection: "glances" }
);

// TTL index — MongoDB auto-deletes documents after expiresAt
glimpseSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
glimpseSchema.index({ author: 1, createdAt: -1 });
glimpseSchema.index({ createdAt: -1 });

const Glimpse = mongoose.model("Glimpse", glimpseSchema);
export default Glimpse;
