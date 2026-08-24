import mongoose, { InferSchemaType, HydratedDocument } from "mongoose";

const emailPreferenceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    digestFrequency: {
      type: String,
      enum: ["daily", "weekly", "never"],
      default: "daily",
    },
    pushNotifications: {
      type: Boolean,
      default: true,
    },
    // In-app notification chime. When true the client plays a subtle sound
    // for incoming notifications (respecting the per-category toggles).
    soundEnabled: {
      type: Boolean,
      default: true,
    },
    emailTypes: {
      type: [{
        type: String,
        enum: ["like", "comment", "follow", "mention", "message", "weekly_digest"],
      }],
      default: ["like", "comment", "follow", "mention", "message", "weekly_digest"],
    },
    // Per-category in-app + device notification toggles. Each defaults to
    // enabled; turning a category off suppresses BOTH the in-app bell
    // notification and the on-device push for that category (enforced in
    // `utilities/notification.ts` createNotification + chat/community push).
    notificationPrefs: {
      type: new mongoose.Schema(
        {
          likes: { type: Boolean, default: true },
          comments: { type: Boolean, default: true },
          follows: { type: Boolean, default: true },
          mentions: { type: Boolean, default: true },
          messages: { type: Boolean, default: true },
          reposts: { type: Boolean, default: true },
          saves: { type: Boolean, default: true },
          polls: { type: Boolean, default: true },
          glances: { type: Boolean, default: true },
          collabs: { type: Boolean, default: true },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    lastDigestSentAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

type EmailPreferenceType = InferSchemaType<typeof emailPreferenceSchema>;
export type EmailPreferenceDocument = HydratedDocument<EmailPreferenceType>;

export const EmailPreference = mongoose.model<EmailPreferenceDocument>("EmailPreference", emailPreferenceSchema);
