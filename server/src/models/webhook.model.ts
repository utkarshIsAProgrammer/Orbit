import mongoose, { InferSchemaType, HydratedDocument } from "mongoose";
import crypto from "crypto";

const webhookSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    url: {
      type: String,
      required: [true, "Webhook URL is required!"],
      trim: true,
    },
    events: [{
      type: String,
      enum: ["post.created", "post.liked", "post.commented", "user.followed", "comment.created"],
    }],
    secret: {
      type: String,
      default: () => crypto.randomBytes(32).toString("hex"),
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastTriggeredAt: {
      type: Date,
      default: null,
    },
    failureCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

webhookSchema.index({ user: 1, isActive: 1 });

type WebhookType = InferSchemaType<typeof webhookSchema>;
export type WebhookDocument = HydratedDocument<WebhookType>;

export const Webhook = mongoose.model<WebhookDocument>("Webhook", webhookSchema);
