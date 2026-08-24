import mongoose, { InferSchemaType, HydratedDocument } from "mongoose";

const moderationItemSchema = new mongoose.Schema(
  {
    targetType: {
      type: String,
      enum: ["post", "comment", "user"],
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "targetType",
    },
    reason: {
      type: String,
      required: [true, "Reason is required!"],
      maxlength: [500, "Reason cannot exceed 500 characters!"],
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    flaggedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    autoHideThreshold: {
      type: Number,
      default: 3, // Auto-hide after 3 unique flags
    },
    flagCount: {
      type: Number,
      default: 1,
    },
  },
  { timestamps: true }
);

moderationItemSchema.index({ status: 1, createdAt: -1 });
moderationItemSchema.index({ targetType: 1, targetId: 1 });
moderationItemSchema.index({ flaggedBy: 1 });

type ModerationItemType = InferSchemaType<typeof moderationItemSchema>;
export type ModerationItemDocument = HydratedDocument<ModerationItemType>;

export const ModerationItem = mongoose.model<ModerationItemDocument>("ModerationItem", moderationItemSchema);
