import mongoose from "mongoose";

const reactionSchema = new mongoose.Schema({
  emoji: {
    type: String,
    required: true,
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// comment schema
const commentSchema = new mongoose.Schema(
  {
    // comment content
    content: {
      type: String,
      required: [true, "Comment content is required!"],
      minlength: [1, "Comment must be at least 1 character long!"],
      maxlength: [1000, "Comment must be less than 1000 characters!"],
    },

    // comment author
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // related native post (external comments leave this null)
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      default: null,
    },

    // related imported open-web post (external posts are a separate collection)
    externalPost: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExternalPost",
      default: null,
    },

    // parent for replies
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
    },

    // likes count
    likesCount: {
      type: Number,
      default: 0,
    },
    
    // replies count
    repliesCount: {
      type: Number,
      default: 0,
    },

    // whether comment has been edited
    isEdited: {
      type: Boolean,
      default: false,
    },

    // emoji reactions
    reactions: {
      type: [reactionSchema],
      default: [],
    },
  },
  { timestamps: true },
);

// post index
commentSchema.index({ post: 1, parent: 1, _id: -1 });
commentSchema.index({ post: 1, createdAt: -1 });
commentSchema.index({ externalPost: 1, parent: 1, _id: -1 });
commentSchema.index({ externalPost: 1, createdAt: -1 });
commentSchema.index({ author: 1, createdAt: -1 });
commentSchema.index({ parent: 1 });

// comment model
const Comment = mongoose.model("Comment", commentSchema);
export default Comment;
