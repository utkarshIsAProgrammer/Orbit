import mongoose from "mongoose";

/**
 * Broadcast — the "god mode" announcement system.
 * A single active broadcast at a time: the admin composes a message and
 * every user in the app sees it (socket-pushed instantly, fetched on
 * boot/reload, dismissible in the UI).
 */
const broadcastSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    // "banner" | "notice" — banner shows a dismissible top banner; notice is
    // a one-time toast-style notification.
    type: { type: String, enum: ["banner", "notice"], default: "banner" },
    // Optional auto-expiry; null = until the admin removes it.
    expiresAt: { type: Date, default: null },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

export const Broadcast = mongoose.model("Broadcast", broadcastSchema);
