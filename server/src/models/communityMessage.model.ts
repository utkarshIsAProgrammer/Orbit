import mongoose, { InferSchemaType, HydratedDocument } from "mongoose";

/**
 * Hard cap on the per-message `seenBy` array (the read-receipt user list).
 *
 * Every member who opens a community chat appends their id to EVERY unseen
 * message, so on a big community a single viral message's seenBy grows by
 * one entry per member read — unbounded. The blue tick only needs to know
 * whether ANYONE has seen the message, so keeping the most recent N readers
 * is more than enough; older ids are rotated out. Shared by the write path
 * (socket.ts) and the one-shot repair script (scripts/cap-seenby.ts).
 */
export const SEENBY_CAP = 200;

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

const communityMessageSchema = new mongoose.Schema(
  {
    community: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Community",
      required: true,
      index: true,
    },
    // Rooms — the channel this message belongs to. null = the default
    // "general" room (kept null for backward compatibility with messages
    // created before rooms existed).
    room: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    sender: {
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
    isEdited: {
      type: Boolean,
      default: false,
    },
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommunityMessage",
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
    // Messages hidden ENTIRELY for this user because they left the community
    // (per-user history clearing). Distinct from deletedFor (delete-for-me) —
    // delete-for-me messages are returned to the client with their deletedFor
    // array intact so the UI can render a "This message was deleted" placeholder.
    clearedFor: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    }],
    // Scheduled-send: when set (future), the message is stored but NOT yet
    // delivered — the BullMQ delayed job (or the 1-min cron safety net)
    // clears it and emits at the scheduled time.
    scheduledAt: {
      type: Date,
      default: null,
    },
    // True when the sender scheduled this message. scheduledAt is nulled at
    // delivery, so this durable flag is what tells the edit/delete window to
    // anchor on deliveredAt instead of createdAt (see chat.controllers.ts).
    wasScheduled: {
      type: Boolean,
      default: false,
    },
    // When the message was first DELIVERED to the community room (WhatsApp-
    // style "delivered" — the server broadcast it to members' sockets). Set
    // idempotently (deliveredAt: null filter) on broadcast. Drives the
    // community "Message info" panel: Sent → Delivered → Seen by N. For
    // scheduled messages this is stamped at delivery time, not send time.
    deliveredAt: {
      type: Date,
      default: null,
    },
    seenBy: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    }],
    // Users who starred/saved this message (WhatsApp-style bookmarking) —
    // shown in the community profile overlay's "Starred" media tab.
    savedBy: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    }],
    // Poll attached to the message (Discord/WhatsApp-style). When present,
    // the client renders a voting card instead of a plain bubble. Voters are
    // per-option so counts are exact; toggling re-votes in-place.
    poll: {
      question: {
        type: String,
        default: "",
        trim: true,
        maxlength: [200, "Poll question is too long!"],
      },
      options: [
        {
          text: {
            type: String,
            required: true,
            trim: true,
            maxlength: [100, "Poll option is too long!"],
          },
          voters: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
          }],
        },
      ],
      // Multi-select polls let a voter mark several options; single-choice
      // polls move the vote (remove from other options) when re-voting.
      allowMultiple: {
        type: Boolean,
        default: false,
      },
      endsAt: {
        type: Date,
        default: null,
      },
      // Poll result privacy (Discord/IG-style):
      //  - null (default): counts always visible to members.
      //  - "vote": counts hidden until the viewer casts their own vote.
      //  - "end": counts hidden until the poll's endsAt passes.
      hideResults: {
        type: String,
        enum: [null, "vote", "end"],
        default: null,
      },
    },
  },
  { timestamps: true }
);

// Indexes for optimal query performance
communityMessageSchema.index({ replyTo: 1 });
communityMessageSchema.index({ community: 1, createdAt: -1 });
communityMessageSchema.index({ community: 1, scheduledAt: 1 });
communityMessageSchema.index({ scheduledAt: 1 });
communityMessageSchema.index({ sender: 1, createdAt: -1 });
communityMessageSchema.index({ community: 1, isDeleted: 1, createdAt: -1 });
communityMessageSchema.index({ community: 1, room: 1, createdAt: -1 });
// Multikey media index — powers the community media library tabs
// (photos/videos/audio/docs). Without it, { community, "attachments.type" }
// forces a full scan of every message in the community; with it the query is
// an index seek. Multikey because attachments is an array.
communityMessageSchema.index({ community: 1, "attachments.type": 1, createdAt: -1 });

type CommunityMessageType = InferSchemaType<typeof communityMessageSchema>;

export interface PopulatedCommunityReaction {
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

export type CommunityMessageDocument = HydratedDocument<CommunityMessageType>;

export const CommunityMessage = mongoose.model<CommunityMessageDocument>("CommunityMessage", communityMessageSchema);
