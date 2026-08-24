import mongoose from "mongoose";

const collectionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Collection name is required!"],
      trim: true,
      maxlength: [100, "Collection name cannot exceed 100 characters!"],
    },
    posts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Post",
      },
    ],
  },
  { timestamps: true }
);

collectionSchema.index({ user: 1, name: 1 });
collectionSchema.index({ user: 1, createdAt: -1 });

const Collection = mongoose.model("Collection", collectionSchema);
export default Collection;
