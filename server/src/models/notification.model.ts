import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    type: {
      type: String,
      enum: ["like", "comment", "follow", "repost", "save", "mention", "reaction", "post_reaction", "message", "message_reply", "community_message", "glimpse_reaction", "glimpse_reply", "poll_vote", "collab_invite", "follow_request", "daily_reward", "streak_reminder", "invite_accepted", "profile_share", "post_share", "glimpse_share", "comment_share",            "collection_share", "badge_unlocked", "call_missed", "call_started", "call_ended"],
      required: true,
    },

    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      default: null,
    },

    comment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
    },

    glimpse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Glimpse",
      default: null,
    },

    // The profile that was shared with this recipient (profile_share type)
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // The collection shared with this recipient (collection_share type)
    collection: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Collection",
      default: null,
    },

    community: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Community",
      default: null,
    },

    message: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommunityMessage",
      default: null,
    },

    messageType: {
      type: String,
      enum: ["text", "photo", "video", "voice_note", "file", "gif", "sticker"],
      default: "text",
    },

    // audio/video — only meaningful for call_* notification types.
    callType: {
      type: String,
      enum: ["audio", "video"],
      default: "audio",
    },

    // Seconds the call lasted — only meaningful for type === "call_ended".
    callDuration: {
      type: Number,
      default: 0,
    },

    // Which achievement badge was unlocked (type === "badge_unlocked").
    badge: {
      type: String,
      default: "",
    },

    isRead: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    // `collection` (the shared Collection a notification references) is a
    // Mongoose-reserved pathname but is intentional here — silence the
    // boot-time warning. The field is used for collection_share types.
    suppressReservedKeysWarning: true,
  },
);

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ type: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, type: 1, createdAt: -1 });
notificationSchema.index({ type: 1, messageType: 1 });

const Notification = mongoose.model("Notification", notificationSchema);
export default Notification;

// index({ userId: 1, createdAt: -1, read: 1 }) covers list query

// index({ userId: 1, read: 1, createdAt: -1 }) for efficient unread count
