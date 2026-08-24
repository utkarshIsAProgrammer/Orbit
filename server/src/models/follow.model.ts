import mongoose from "mongoose";

// follow schema
const followSchema = new mongoose.Schema(
	{
		// user who follows
		follower: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},

		// user being followed
		following: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
	},

	{ timestamps: true },
);

// unique follow index
followSchema.index({ follower: 1, following: 1 }, { unique: true });
followSchema.index({ follower: 1, createdAt: -1 });
followSchema.index({ following: 1, createdAt: -1 });

// follow model
const Follow = mongoose.model("Follow", followSchema);
export default Follow;
