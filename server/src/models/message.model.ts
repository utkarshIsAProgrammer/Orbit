import mongoose, { InferSchemaType, HydratedDocument } from "mongoose";

const reactionSchema = new mongoose.Schema({
  emoji: {
    type: String,
    required: true,
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const attachmentSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true,
  },
  public_id: {
    type: String,
    default: "",
  },
  type: {
    type: String,
    enum: ["image", "gif", "sticker", "meme", "voice_note", "video", "file"],
    required: true,
  },
  duration: {
    type: Number,
    default: 0,
  },
  // Original filename (e.g. "report.pdf") — used for the file card preview.
  name: {
    type: String,
    default: "",
  },
  // File size in bytes (0 for media where it isn't captured).
  size: {
    type: Number,
    default: 0,
  },
  // Original MIME type (e.g. "application/pdf") — used for preview icon.
  mimetype: {
    type: String,
    default: "",
  },
});

const messageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    text: {
      type: String,
      default: "",
      trim: true,
    },
    // System/event messages (e.g. "Voice call started/ended" like WhatsApp).
    // When set, the client renders a centered system chip instead of a bubble.
    system: {
      type: String,
      enum: ["call_started", "call_ended", "call_missed"],
      default: null,
    },
    // Call metadata for system call messages (audio vs video + duration).
    callType: {
      type: String,
      enum: ["audio", "video"],
      default: "audio",
    },
    callDuration: {
      type: Number,
      default: 0,
    },
    attachments: {
      type: [attachmentSchema],
      default: [],
    },
    reactions: {
      type: [reactionSchema],
      default: [],
    },
    seen: {
      type: Boolean,
      default: false,
    },
    seenAt: {
      type: Date,
      default: null,
    },
    // When the RECIPIENT's device first received the message (WhatsApp-style
    // "delivered"). Set idempotently on socket delivery (emitNewMessage) or
    // when the recipient opens the conversation (chat:join bulk mark). Drives
    // the "Message info" panel: Sent → Delivered → Read.
    deliveredAt: {
      type: Date,
      default: null,
    },
    isEdited: {
      type: Boolean,
      default: false,
    },
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    forwardedFrom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedFor: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    }],
    // Users who starred/saved this message (WhatsApp-style bookmarking).
    // Starred messages appear in the chat's "Starred" media-library tab.
    savedBy: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    }],
    // Scheduled-send: when set (future), the message is stored but NOT yet
    // delivered — the BullMQ delayed job (or the 1-min cron safety net)
    // clears it and emits at the scheduled time. The client renders a
    // "Scheduled" chip instead of sending immediately.
    scheduledAt: {
      type: Date,
      default: null,
    },
    // True when the sender scheduled this message (scheduledAt was set at
    // creation). Set once and never changed — scheduledAt is nulled at
    // delivery, so this is the only durable marker that the message's real
    // "send time" is its DELIVERY, not its createdAt. The edit/delete
    // 5-min window anchors on deliveredAt for these (a schedule set days
    // ago must be retractable for 5 minutes after it actually lands).
    wasScheduled: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Index for replyTo lookups
messageSchema.index({ replyTo: 1 });

// Indexes for optimal query performance
messageSchema.index({ conversation: 1, _id: -1 });
messageSchema.index({ conversation: 1, recipient: 1, seen: 1 });
messageSchema.index({ conversation: 1, createdAt: -1 });
// Scheduled-send lookups (due messages to deliver + per-conversation list)
messageSchema.index({ conversation: 1, scheduledAt: 1 });
messageSchema.index({ scheduledAt: 1 });
// Multikey media index — same pattern as the community one, so a personal
// chat media library (or any attachments.type query) is an index seek, not
// a scan. Multikey because attachments is an array.
messageSchema.index({ conversation: 1, "attachments.type": 1, createdAt: -1 });
messageSchema.index({ sender: 1, createdAt: -1 });
messageSchema.index({ recipient: 1, createdAt: -1 });
messageSchema.index({ conversation: 1, isDeleted: 1, createdAt: -1 });
messageSchema.index({ createdAt: -1 });
messageSchema.index({ sender: 1, recipient: 1, createdAt: -1 });

type MessageType = InferSchemaType<typeof messageSchema>;

// Populated reaction type with sender info
export interface PopulatedReaction {
  _id: string;
  emoji: string;
  sender: {
    _id: string;
    username: string;
    fullName: string;
    profilePic?: { url: string; public_id?: string };
  };
  createdAt: Date;
}

export type MessageDocument = HydratedDocument<MessageType>;

export const Message = mongoose.model<MessageDocument>("Message", messageSchema);
