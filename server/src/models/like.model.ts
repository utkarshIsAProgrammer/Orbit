import mongoose from "mongoose";

// like schema
const likeSchema = new mongoose.Schema(
  {
    // like author
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // liked post
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      default: null,
    },

    // liked comment
    comment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
    },

    // liked imported open-web post (external posts are a separate collection)
    externalPost: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExternalPost",
      default: null,
    },
  },
  { timestamps: true },
);

// unique like indexes (only store document when post/comment/external exists)
// ($type required: $ne/$not are rejected in partial index filters)
likeSchema.index(
  { author: 1, post: 1 },
  {
    unique: true,
    partialFilterExpression: { post: { $type: "objectId" } },
  },
);

likeSchema.index(
  { author: 1, comment: 1 },
  {
    unique: true,
    partialFilterExpression: { comment: { $type: "objectId" } },
  },
);

likeSchema.index(
  { author: 1, externalPost: 1 },
  {
    unique: true,
    partialFilterExpression: { externalPost: { $type: "objectId" } },
  },
);
// like model
const Like = mongoose.model("Like", likeSchema);
export default Like;
