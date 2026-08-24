import mongoose, { InferSchemaType, HydratedDocument } from "mongoose";

const conversationSchema = new mongoose.Schema(
  {
    participants: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      ],
      required: true,
      validate: {
        validator: function (val: any[]) {
          return val.length === 2;
        },
        message: "A 1-on-1 conversation must have exactly 2 participants!",
      },
    },
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    // Last NON-message action in the conversation (e.g. a reaction). Used by
    // the chat list to show "reacted ❤️ to your message" instead of the stale
    // last message. Reset to null whenever a new message is sent.
    lastAction: {
      type: {
        type: String,
        enum: ["reaction"],
        default: null,
      },
      emoji: { type: String, default: "" },
      messageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Message",
        default: null,
      },
      messageSenderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      actor: {
        _id: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
        fullName: { type: String, default: "" },
        username: { type: String, default: "" },
      },
      createdAt: { type: Date, default: null },
    },
    // Last missed call in this conversation — the red missed-call badge on the
    // callee's chat list (WhatsApp-style). `for` = the user who missed it,
    // `by` = the caller. Cleared the moment the callee opens the conversation.
    missedCall: {
      type: {
        for: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
        by: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
        callType: {
          type: String,
          enum: ["audio", "video"],
          default: "audio",
        },
        createdAt: { type: Date, default: null },
      },
      default: null,
    },
    unreadCounts: {
      type: Map,
      of: Number,
      default: {},
    },
    pinnedMessages: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    }],
    // Users who archived this conversation (WhatsApp-style). Archived chats
    // drop out of the default list but stay intact — a new message un-archives
    // it back into the main list.
    archivedBy: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    }],
  },
  { timestamps: true }
);

// Indexes for optimal query performance
// Unique compound index on the sorted participants elements to enforce a single conversation between the same two users
// Note: To make this work correctly, participant IDs MUST be sorted alphabetically/lexicographically before saving.
conversationSchema.index({ "participants.0": 1, "participants.1": 1 }, { unique: true });
conversationSchema.index({ participants: 1 });
conversationSchema.index({ updatedAt: -1 });
conversationSchema.index({ lastMessage: 1 });
conversationSchema.index({ participants: 1, updatedAt: -1 });

type ConversationType = InferSchemaType<typeof conversationSchema>;
export type ConversationDocument = HydratedDocument<ConversationType>;

export const Conversation = mongoose.model<ConversationDocument>("Conversation", conversationSchema);
