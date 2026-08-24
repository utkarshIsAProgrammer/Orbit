import mongoose, { InferSchemaType, HydratedDocument } from "mongoose";

const communitySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Community name is required!"],
      trim: true,
      maxlength: [50, "Community name cannot exceed 50 characters!"],
    },
    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: [500, "Description cannot exceed 500 characters!"],
    },
    // Who can join:
    //  - "public":  anyone joins instantly
    //  - "private": joining requires an invite link OR an admin-approved
    //               join request (pending requests live in `joinRequests`)
    privacy: {
      type: String,
      enum: ["public", "private"],
      default: "public",
    },
    // Access control for posting/uploading media (creator + admins always
    // pass every tier; the values here set the minimum role required):
    //  - "everyone":   any member
    //  - "moderators": moderator / admin / creator
    //  - "admins":     admin / creator
    whoCanPost: {
      type: String,
      enum: ["everyone", "moderators", "admins"],
      default: "everyone",
    },
    whoCanUploadMedia: {
      type: String,
      enum: ["everyone", "moderators", "admins"],
      default: "everyone",
    },
    // Pending join requests (private communities). Approved members are
    // moved into `members`; rejected/cancelled requests are removed.
    joinRequests: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        requestedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    // Single invite code — anyone holding it can join (even a private
    // community) without approval. Regenerated on demand by the creator/admin.
    inviteCode: {
      type: String,
      default: "",
    },
    inviteCodeCreatedAt: {
      type: Date,
      default: null,
    },
    image: {
      url: { type: String, default: "" },
      public_id: { type: String, default: "" },
    },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    members: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        joinedAt: {
          type: Date,
          default: Date.now,
        },
        // Role hierarchy: creator > admin > moderator > member.
        // The creator's own entry carries role "creator" so member lists can
        // render the hierarchy without special-casing the `creator` field.
        role: {
          type: String,
          enum: ["creator", "admin", "moderator", "member"],
          default: "member",
        },
      },
    ],
    memberCount: {
      type: Number,
      default: 1,
    },
    pinnedMessages: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "CommunityMessage",
      },
    ],
    // Admin features
    admins: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // Rooms (channels) — Discord-style text channels inside the community.
    // The first room is the default "general" channel; every community starts
    // with one. Messages in the general room are stored with `room: null`
    // (backwards-compatible with messages created before rooms existed), so a
    // room filter is only applied for non-general rooms.
    rooms: [
      {
        name: {
          type: String,
          required: [true, "Room name is required!"],
          trim: true,
          maxlength: [30, "Room name cannot exceed 30 characters!"],
        },
        // Channel type (Discord-style):
        //  - "text":        everyone posts (subject to community whoCanPost)
        //  - "announcement": 1-way — only moderators/admins/creator can post;
        //                   members read-only. Meant for news/updates with
        //                   @everyone pings.
        type: {
          type: String,
          enum: ["text", "announcement"],
          default: "text",
        },
        // Channel personality — an emoji shown on the pill ("🎮") and a short
        // topic line shown under the community name when the channel is open.
        icon: {
          type: String,
          default: "",
          maxlength: [8, "Channel icon is too long!"],
        },
        topic: {
          type: String,
          default: "",
          trim: true,
          maxlength: [140, "Channel topic cannot exceed 140 characters!"],
        },
        createdBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
        // Discord-style slowmode: when > 0, a member can only post once per
        // this many seconds in the channel (enforced in sendCommunityMessage).
        slowModeSeconds: {
          type: Number,
          default: 0,
          min: 0,
          max: 3600,
        },
      },
    ],
    messagingEnabled: {
      type: Boolean,
      default: true,
    },
    // Banned members — cannot send/read messages or re-join until a
    // moderator unbans them. Kept separate from `members` so bans survive
    // leave/rejoin and the reason stays visible to the banning moderator.
    bannedUsers: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        bannedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
        reason: {
          type: String,
          default: "",
          trim: true,
          maxlength: [300, "Ban reason is too long!"],
        },
        bannedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    // Welcome message shown to newly-joined members (rules + intro). The
    // client renders it as a card the first time a fresh member opens the
    // community.
    welcomeMessage: {
      type: String,
      default: "",
      trim: true,
      maxlength: [500, "Welcome message is too long!"],
    },
    audioCallEnabled: {
      type: Boolean,
      default: false,
    },
    videoCallEnabled: {
      type: Boolean,
      default: false,
    },
    // Snapshot of the community's last message — lets the community list show a
    // live "last message" preview without having to query the messages table.
    // Reset to null by clear-chat. Updated on every new/edited message.
    lastMessage: {
      messageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "CommunityMessage",
        default: null,
      },
      text: { type: String, default: "" },
      attachmentType: { type: String, default: "" },
      sender: {
        _id: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
        fullName: { type: String, default: "" },
        username: { type: String, default: "" },
      },
      createdAt: { type: Date, default: null },
      isDeleted: { type: Boolean, default: false },
    },
    // True when this community was created by a simulated user (bot). Real
    // users can browse/join/read the conversation like any public community;
    // the flag lets the UI show a subtle "Simulated" badge so nobody is
    // misled into thinking the members are real people.
    isSimulated: {
      type: Boolean,
      default: false,
    },
    // Interest topic the community is themed around (e.g. "fitness",
    // "music"). Set when a bot creates the community; lets bots that share
    // the interest keep chatting in it and join topic-matched communities
    // instead of random ones.
    topic: {
      type: String,
      default: "",
    },
    // Last NON-message action in the community (e.g. a reaction, pin, call).
    // Mirrors the 1-on-1 conversation model so the community list can show
    // "Name reacted ❤️ to your message", "Name pinned a message",
    // "Voice call ended" etc. instead of the stale last message. Reset to null
    // whenever a new message is sent.
    lastAction: {
      type: {
        type: String,
        enum: ["reaction", "pin", "unpin", "call", "message_edit"],
        default: null,
      },
      emoji: { type: String, default: "" },
      // For calls: "audio" | "video"
      callType: {
        type: String,
        enum: ["audio", "video", ""],
        default: "",
      },
      // For calls: "started" | "ended" — "ended" is what the list preview
      // shows ("Voice call ended"); "started" is only transient.
      callStatus: {
        type: String,
        enum: ["started", "ended", ""],
        default: "",
      },
      // For calls: duration in seconds (meaningful when callStatus is "ended").
      callDuration: { type: Number, default: 0 },
      messageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "CommunityMessage",
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
  },
  { timestamps: true }
);

// Indexes for optimal query performance
communitySchema.index({ name: 1 });
communitySchema.index({ "members.user": 1 });
communitySchema.index({ creator: 1 });
communitySchema.index({ createdAt: -1 });
communitySchema.index({ "members.user": 1, updatedAt: -1 });
communitySchema.index({ memberCount: -1 });

type CommunityType = InferSchemaType<typeof communitySchema>;
export type CommunityDocument = HydratedDocument<CommunityType>;

export const Community = mongoose.model<CommunityDocument>("Community", communitySchema);
