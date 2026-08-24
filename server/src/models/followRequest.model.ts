import mongoose from "mongoose";

/**
 * Stores pending follow requests for private accounts.
 *
 * Previously these were embedded as an unbounded ObjectId array inside
 * the User document. For popular private accounts this could grow to
 * thousands of entries, bloating the User document toward the 16 MB
 * BSON limit and degrading every query that touches the User document.
 *
 * By moving follow requests to their own collection, each request is a
 * lightweight indexed document that can be queried, paginated, and
 * deleted independently.
 */
const followRequestSchema = new mongoose.Schema(
  {
    // The user who sent the follow request
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // The private-account user who received the request
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

// Prevent duplicate pending requests from the same sender
followRequestSchema.index({ sender: 1, recipient: 1 }, { unique: true });

// Fast lookup: all pending requests for a recipient (newest first)
followRequestSchema.index({ recipient: 1, createdAt: -1 });

const FollowRequest = mongoose.model("FollowRequest", followRequestSchema);
export default FollowRequest;
