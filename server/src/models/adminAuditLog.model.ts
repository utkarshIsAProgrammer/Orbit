import mongoose from "mongoose";

/**
 * AdminAuditLog — records every god-mode action so the admin has a full,
 * reviewable trail of who did what to whom (impersonations, bans, edits,
 * deletes, broadcasts, kill-switch flips).
 */
const adminAuditLogSchema = new mongoose.Schema(
  {
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    actorName: { type: String, default: "" }, // denormalized username for fast lists
    action: { type: String, required: true, index: true }, // e.g. "impersonate", "ban_user"
    targetType: {
      type: String,
      enum: ["user", "post", "comment", "glimpse", "community", "broadcast", "flag", "system"],
      default: "system",
    },
    targetId: { type: String, default: "" },
    targetName: { type: String, default: "" },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

adminAuditLogSchema.index({ createdAt: -1 });

export const AdminAuditLog = mongoose.model("AdminAuditLog", adminAuditLogSchema);
