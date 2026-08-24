import mongoose from "mongoose";
import slugify from "slugify";

// post schema
const postSchema = new mongoose.Schema(
  {
    // post title
    title: {
      type: String,
      default: "",
      maxlength: [500, "Title must be less than 500 characters!"],
    },

    // post slug
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },

    // post content
    content: {
      type: String,
      default: "",
      maxlength: [5000, "Content must be less than 5000 characters!"],
    },

    // hashtags
    hashtags: {
      type: [String],
      default: [],
      validate: {
        validator: function(v: string[]) {
          return v.length <= 10;
        },
        message: "Maximum 10 hashtags allowed!",
      },
    },

    // post image (single, kept for backward compat)
    image: {
      url: { type: String, default: "" },
      public_id: { type: String, default: "" },
    },

    // single video (optional)
    video: {
      url: { type: String, default: "" },
      public_id: { type: String, default: "" },
    },

    // multiple images support (new)
    images: {
      type: [{
        url: { type: String, required: true },
        public_id: { type: String, default: "" },
        alt: { type: String, default: "" },
      }],
      default: [],
      validate: {
        validator: function(v: any[]) { return v.length <= 10; },
        message: "Maximum 10 images allowed!",
      },
    },

    // repost count
    repostsCount: {
      type: Number,
      default: 0,
    },

    // post saves
    savesCount: {
      type: Number,
      default: 0,
    },

    // post likes
    likesCount: {
      type: Number,
      default: 0,
    },

    // comment count
    commentsCount: {
      type: Number,
      default: 0,
    },

    // shares count
    sharesCount: {
      type: Number,
      default: 0,
    },

    // views count
    viewsCount: {
      type: Number,
      default: 0,
    },

    // Emoji reactions (mirrors the comment/message reaction system —
    // one active emoji per user, replace-on-new, toggle-off on repeat)
    reactions: {
      type: [{
        emoji: { type: String, required: true },
        sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        createdAt: { type: Date, default: Date.now },
      }],
      default: [],
    },

    // mentions (@username references)
    mentions: {
      type: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      }],
      default: [],
    },

    // Poll
    poll: {
      type: {
        options: [{
          text: { type: String, required: true, maxlength: 100 },
          votes: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
          }],
        }],
        expiresAt: { type: Date, default: null },
        totalVotes: { type: Number, default: 0 },
      },
      default: null,
    },

    // Quote repost
    isQuoteRepost: {
      type: Boolean,
      default: false,
    },
    quoteContent: {
      type: String,
      default: "",
      maxlength: [1000, "Quote content must be less than 1000 characters!"],
    },

    // Edit tracking
    isEdited: {
      type: Boolean,
      default: false,
    },
    editHistory: {
      type: [{
        title: { type: String, default: "" },
        content: { type: String, default: "" },
        editedAt: { type: Date, default: Date.now },
      }],
      default: [],
    },

    // Collab post
    collaborator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    collabAccepted: {
      type: Boolean,
      default: false,
    },

    // Post status (draft / scheduled / published)
    status: {
      type: String,
      enum: ["draft", "scheduled", "published", "archived"],
      default: "published",
    },
    scheduledAt: {
      type: Date,
      default: null,
    },

    // Post visibility: public | closeFriends
    visibility: {
      type: String,
      enum: ["public", "closeFriends"],
      default: "public",
    },

    // post author
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },

  { timestamps: true },
);

// combined indexes for optimal query performance
postSchema.index({ title: "text", content: "text" });
// Case-insensitive prefix-search index for post TITLES (equality/range
// comparisons only — NB: MongoDB's $regex does NOT apply collation to
// matching, so search regexes carry $options:"i" instead; see
// search.controllers.ts searchPosts).
postSchema.index({ title: 1 }, { collation: { locale: "en", strength: 2 } });
postSchema.index({ visibility: 1 });
// Compound index for the feed's discovery query — the hottest read in the
// app (runs on EVERY feed load): { visibility: "public", status:
// "published", createdAt: { $gte: 3d } } sorted by likesCount. Without it
// Mongo scans posts by the standalone visibility index then sorts in memory.
postSchema.index({ visibility: 1, status: 1, createdAt: -1 });
postSchema.index({ author: 1, status: 1, createdAt: -1 });
postSchema.index({ author: 1, createdAt: -1 });
postSchema.index({ hashtags: 1, createdAt: -1 });
postSchema.index({ createdAt: -1 });
postSchema.index({ "images.public_id": 1 });
// slug already has unique: true declared in the field definition
postSchema.index({ author: 1, pinned: -1, createdAt: -1 });
postSchema.index({ likesCount: -1 });
// Compound for the feed's discovery query (sort by likes, then comments) —
// without it Mongo does an in-memory blocking sort of the whole recent
// public-post window on every cold feed build.
postSchema.index({ likesCount: -1, commentsCount: -1 });
postSchema.index({ savesCount: -1 });
postSchema.index({ repostsCount: -1 });
postSchema.index({ viewsCount: -1 });
postSchema.index({ status: 1, scheduledAt: 1 });
postSchema.index({ collaborator: 1, collabAccepted: 1 });
postSchema.index({ author: 1, createdAt: -1, _id: -1 });

// slug generation
postSchema.pre("validate", async function () {
  // Always regenerate the slug when the title changes OR when no slug exists
  // yet (e.g. quote reposts created without a title). Without this, new
  // posts without a title would fail validation because slug is required.
  if (!this.isModified("title") && this.slug) return;

  const title = this.title?.trim();
  const baseSlug = title
    ? slugify(title, { lower: true, strict: true })
    : `post-${Date.now()}`;
  let slug = baseSlug;
  let counter = 1;

  const Model = this.constructor as mongoose.Model<any>;

  while (
    await Model.findOne({
      slug,
      _id: { $ne: this._id },
    })
  ) {
    slug = `${baseSlug}-${counter++}`;
  }

  this.slug = slug;
});

// post model
const Post = mongoose.model("Post", postSchema);
export default Post;
