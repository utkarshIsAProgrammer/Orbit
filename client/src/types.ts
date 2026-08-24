export interface CloudinaryImage {
  url: string;
  public_id?: string;
}	export interface User {
  _id: string;
  username: string;
  fullName: string;
  email: string;
  gender?: "male" | "female" | "others";
  bio?: string;
  profilePic?: CloudinaryImage;
  bannerImage?: CloudinaryImage;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  viewsCount: number;
  sharesCount: number;
  createdAt: string;
  isPrivate?: boolean;
  isOnboarded?: boolean;
  notificationsEnabled?: boolean;
  isAdmin?: boolean;
  isVerified?: boolean;
  statusText?: string;
  /** Day One founding member — email was on the waitlist. Grants the
   *  exclusive Aurum theme, the Day One name flair and the First Orbit
   *  avatar ring (visual-only perks). */
  waitlistPerk?: boolean;
  /** Recommendation metadata — why this user was suggested */
  reason?: "mutual" | "affinity" | "popular" | "fresh";
  mutualFollowersCount?: number;
  score?: number;
}

export interface PostPollOption {
  text: string;
  votes: number;
  votedByMe?: boolean;
}

export interface PostPoll {
  options: PostPollOption[];
  expiresAt: string | null;
  totalVotes: number;
  expired?: boolean;
  myVote?: number | null;
}

export interface Post {
  _id: string;
  title: string;
  slug: string;
  content: string;
  image?: CloudinaryImage;
  images?: CloudinaryImage[];
  video?: CloudinaryImage;
  likesCount: number;
  commentsCount: number;
  savesCount: number;
  repostsCount: number;
  viewsCount: number;
  sharesCount: number;
  author: {
    _id: string;
    username: string;
    fullName: string;
    profilePic?: CloudinaryImage;
    isVerified?: boolean;
    statusText?: string;
  };
  collaborator?: {
    _id: string;
    username: string;
    fullName: string;
    profilePic?: CloudinaryImage;
    isVerified?: boolean;
  } | null;
  collabAccepted?: boolean;
  hashtags?: string[];
  mentions?: string[];
  poll?: PostPoll | null;
  isQuoteRepost?: boolean;
  quoteContent?: string;
  isEdited?: boolean;
  visibility?: "public" | "closeFriends";
  status?: "draft" | "scheduled" | "published";
  scheduledAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  likedByMe?: boolean;
  savedByMe?: boolean;
  repostedByMe?: boolean;
  pinnedByMe?: boolean;
  myVote?: string | null;
  reactions?: CommentReaction[];
}

export interface CommentReaction {
  _id: string;
  emoji: string;
  sender: {
    _id: string;
    username: string;
    fullName: string;
    profilePic?: CloudinaryImage;
    isVerified?: boolean;
  };
  createdAt: string;
}

export interface Comment {
  _id: string;
  content: string;
  author: {
    _id: string;
    username: string;
    fullName: string;
    profilePic?: CloudinaryImage;
    isVerified?: boolean;
  };
  /** Parent post id — null for comments on imported web posts. */
  post: string | null;
  parent?: string | null;
  likesCount: number;
  repliesCount?: number;
  createdAt: string;
  likedByMe?: boolean;
  isEdited?: boolean;
  reactions?: CommentReaction[];
}

export type NotificationType = "like" | "comment" | "follow" | "repost" | "save" | "mention" | "reaction" | "post_reaction" | "message" | "message_reply" | "community_message" | "glimpse_reaction" | "glimpse_reply" | "poll_vote" | "collab_invite" | "invite_accepted" | "follow_request" | "daily_reward" | "streak_reminder" | "profile_share" | "post_share" | "glimpse_share" | "comment_share" | "collection_share" | "badge_unlocked" | "call_missed" | "call_started" | "call_ended";

export interface Notification {
  _id: string;
  recipient: string;
  sender: {
    _id: string;
    username: string;
    fullName: string;
    profilePic?: CloudinaryImage;
    isVerified?: boolean;
  };
  type: NotificationType;
  /** Instagram-style grouping: set when this row represents several
   *  same-type-same-target notifications collapsed into one (e.g.
   *  "Rahul and 12 others liked your post"). groupMemberIds are the raw
   *  notification ids the group covers — sent back to mark-read/delete
   *  the whole group in one call. */
  groupCount?: number;
  groupMemberIds?: string[];
  groupSenders?: Array<{
    fullName?: string;
    username?: string;
    profilePic?: CloudinaryImage;
  }>;
  /** audio/video — only meaningful for call_* types. */
  callType?: "audio" | "video";
  /** Seconds the call lasted — only meaningful for type === "call_ended". */
  callDuration?: number;
  post?: {
    _id: string;
    title: string;
    slug: string;
  } | null;
  glimpse?: {
    _id: string;
    author?: {
      _id: string;
      username: string;
      fullName: string;
      profilePic?: CloudinaryImage;
    };
  } | null;
  /** The shared profile for profile_share notifications */
  user?: {
    _id: string;
    username: string;
    fullName: string;
    profilePic?: CloudinaryImage;
  } | null;
  /** The shared collection for collection_share notifications */
  collection?: {
    _id: string;
    name: string;
  } | null;
  comment?: {
    _id: string;
    content: string;
    post?: { _id?: string; slug?: string };
  } | null;
  room?: {
    _id: string;
    title: string;
  } | null;
  community?: {
    _id: string;
    name: string;
  } | null;
  message?: {
    _id: string;
    text: string;
  } | null;
  messageType?: "text" | "photo" | "video" | "voice_note" | "file" | "gif" | "sticker";
  /** Which achievement badge was unlocked (type === "badge_unlocked") */
  badge?: string;
  isRead: boolean;
  createdAt: string;
}

export interface MessageReaction {
  _id: string;
  emoji: string;
  sender: {
    _id: string;
    username: string;
    fullName: string;
    profilePic?: CloudinaryImage;
    isVerified?: boolean;
  };
  createdAt: string;
}

export interface MessageAttachment {
  url: string;
  public_id?: string;
  type: "voice_note" | "image" | "gif" | "video" | "file";
  duration?: number;
  /** Original filename (e.g. "report.pdf") — shown on the file card. */
  name?: string;
  /** File size in bytes. */
  size?: number;
  /** Original MIME type (e.g. "application/pdf"). */
  mimetype?: string;
}

export interface Message {
  _id: string;
  conversation: string;
  sender: {
    _id: string;
    username: string;
    fullName: string;
    profilePic?: CloudinaryImage;
    isVerified?: boolean;
  };
  recipient: string;
  text: string;
  /** Call-activity system message — renders as a centered chip (like WhatsApp). */
  system?: "call_started" | "call_ended" | "call_missed";
  callType?: "audio" | "video";
  /** Seconds the call lasted (only meaningful for call_ended). */
  callDuration?: number;
  replyTo?: ({
    _id: string;
    sender: {
      _id: string;
      username: string;
      fullName: string;
      profilePic?: CloudinaryImage;
      isVerified?: boolean;
    };
    text: string;
    attachments?: MessageAttachment[];
    createdAt: string;
  }) | null;
  attachments?: MessageAttachment[];
  seen: boolean;
  seenAt?: string | null;
  // When the recipient's device first received the message (WhatsApp-style
  // delivered) — drives the "Message info" panel's Sent → Delivered → Read.
  deliveredAt?: string | null;
  // Scheduled send: when set (future), the message is stored but not yet
  // delivered — the bubble renders a clock chip until delivery nulls it.
  scheduledAt?: string | null;
  isEdited?: boolean;
  isDeleted?: boolean;
  deletedFor?: string[];
  forwardedFrom?: string;
  _pending?: boolean;
  _pendingConv?: string;
  _failed?: boolean;
  reactions?: MessageReaction[];
  // Users who starred/saved this message (WhatsApp-style) — star shows in
  // the media library's "Starred" tab.
  savedBy?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Glance {
  _id: string;
  author: {
    _id: string;
    username: string;
    fullName: string;
    profilePic?: CloudinaryImage;
    isVerified?: boolean;
  };
  media: CloudinaryImage;
  mediaType: "image" | "video";
  // The feed deliberately omits the raw viewers array (it only ships
  // viewedByMe + viewerCount); the full "Viewed by" list loads lazily via
  // GET /api/glimpses/:id when the author opens it.
  viewers?: {
    user: { _id: string; username: string; fullName: string; profilePic?: CloudinaryImage } | string;
    viewedAt: string;
  }[];
  // Exact total view count — the viewers array is capped server-side, so
  // this counter is the authoritative number.
  viewerCount?: number;
  reactions?: {
    user: string | { _id: string; username: string; fullName: string; profilePic?: CloudinaryImage };
    emoji: string;
    createdAt?: string;
  }[];
  viewedByMe: boolean;
  visibility?: "public" | "closeFriends";
  expiresAt: string;
  createdAt: string;
}

export type Glimpse = Glance;

// ─── Imported open-web content (Bluesky / Mastodon / Lemmy) ─────────
export type ExternalSource = "bluesky" | "mastodon" | "lemmy";


export interface ExternalMedia {
  url: string;
  previewUrl?: string;
  type?: string;
}

export interface ExternalPost {
  _id: string;
  source: ExternalSource;
  sourceId: string;
  url: string;
  content: string;
  author: {
    handle: string;
    displayName: string;
    avatar?: string;
    profileUrl?: string;
  };
  media: ExternalMedia[];
  stats: {
    likes: number;
    reposts: number;
    replies: number;
  };
  originalCreatedAt: string;
  // Orbit-native interaction flags — mirror native Post fields so imported
  // posts behave identically (like/repost/save/comment buttons, three-dot
  // menu, translate, etc).
  likedByMe?: boolean;
  savedByMe?: boolean;
  repostedByMe?: boolean;
  orbitLikesCount?: number;
  orbitSavesCount?: number;
  orbitRepostsCount?: number;
  orbitCommentsCount?: number;
}

export interface Community {
  _id: string;
  name: string;
  description?: string;
  image?: { url: string; public_id?: string };
  creator: {
    _id: string;
    username: string;
    fullName: string;
    profilePic?: CloudinaryImage;
  };
  members: {
    user: {
      _id: string;
      username: string;
      fullName: string;
      profilePic?: CloudinaryImage;
    };
    joinedAt: string;
    role?: "creator" | "admin" | "moderator" | "member";
  }[];
  memberCount: number;
  isMember?: boolean;
  // True for communities created by simulated users (bots) — shows a badge
  // so nobody mistakes the members for real people.
  isSimulated?: boolean;
  // Privacy & access control
  privacy?: "public" | "private";
  whoCanPost?: "everyone" | "moderators" | "admins";
  whoCanUploadMedia?: "everyone" | "moderators" | "admins";
  // True when the CURRENT user has a pending join request (private only)
  pendingRequest?: boolean;
  // The current user's role when a member
  userRole?: "creator" | "admin" | "moderator" | "member";
  muted?: boolean;
  pinnedMessages?: string[];
  lastMessage?: {
    messageId?: string;
    text?: string;
    attachmentType?: string;
    sender?: { _id?: string; fullName?: string; username?: string } | null;
    createdAt?: string;
    isDeleted?: boolean;
  } | null;
  lastAction?: ConversationLastAction | null;
  messagingEnabled?: boolean;
  audioCallEnabled?: boolean;
  videoCallEnabled?: boolean;
  admins?: string[];
  // Rooms (channels) — the first room is always the protected "general" room.
  // null room on a message = general room (legacy messages included).
  // type: "text" (everyone posts) | "announcement" (mods only).
  rooms?: {
    _id: string;
    name: string;
    createdBy: string;
    type?: "text" | "announcement";
    // Discord-style slowmode: 0 = off; seconds between a member's posts
    slowModeSeconds?: number;
  }[];
  // Banned members — cannot re-join until unbanned by a moderator.
  bannedUsers?: {
    user: string;
    bannedBy?: string;
    reason?: string;
    bannedAt?: string;
  }[];
  // Welcome message shown to newly-joined members.
  welcomeMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommunityMessage {
  _id: string;
  community: string;
  // null (or absent) = default "general" room — matches legacy messages.
  room?: string | null;
  sender: {
    _id: string;
    username: string;
    fullName: string;
    profilePic?: CloudinaryImage;
    isVerified?: boolean;
  };
  text: string;
  /** Call-activity system message — renders as a centered chip (like WhatsApp). */
  system?: "call_started" | "call_ended" | "call_missed";
  callType?: "audio" | "video";
  /** Seconds the call lasted (only meaningful for call_ended). */
  callDuration?: number;
  replyTo?: ({
    _id: string;
    sender: {
      _id: string;
      username: string;
      fullName: string;
      profilePic?: CloudinaryImage;
      isVerified?: boolean;
    };
    text: string;
    attachments?: MessageAttachment[];
    createdAt: string;
  }) | null;
  attachments?: MessageAttachment[];
  isEdited?: boolean;
  isDeleted?: boolean;
  deletedFor?: string[];
  // When the server first broadcast this message to the community room
  // ("delivered"). For scheduled messages this is stamped at delivery time.
  deliveredAt?: string | null;
  // Scheduled send: when set (future), the message is stored but not yet
  // delivered — the bubble renders a clock chip until delivery nulls it.
  scheduledAt?: string | null;
  seenBy?: string[];
  reactions?: MessageReaction[];
  // Users who starred this message (WhatsApp-style).
  savedBy?: string[];
  // Poll attached to the message (rendered as a voting card).
  poll?: CommunityPoll;
  createdAt: string;
  updatedAt: string;
}

/** Poll attached to a community message (Discord/WhatsApp-style). */
export interface CommunityPoll {
  question: string;
  options: {
    text: string;
    // Voter ids — the client computes counts + votedByMe from this.
    voters: string[];
  }[];
  allowMultiple?: boolean;
  endsAt?: string | null;
  // Result privacy: null (always visible) | "vote" (hide until I vote) |
  // "end" (hide until the poll ends). The card masks counts accordingly.
  hideResults?: null | "vote" | "end";
}

export interface ConversationLastAction {
  type?: "reaction" | "pin" | "unpin" | "call" | "message_edit";
  emoji?: string;
  callType?: "audio" | "video";
  callStatus?: "started" | "ended";
  /** Seconds the call lasted — only set on callStatus "ended". */
  callDuration?: number;
  messageId?: string;
  messageSenderId?: string;
  actor?: {
    _id: string;
    fullName?: string;
    username?: string;
  } | null;
  createdAt?: string;
}

export interface Conversation {
  _id: string;
  participants: {
    _id: string;
    username: string;
    fullName: string;
    profilePic?: CloudinaryImage;
    isVerified?: boolean;
    statusText?: string;
  }[];
  lastMessage?: Message | null;
  lastAction?: ConversationLastAction | null;
  unreadCounts?: Record<string, number>;
  // Last missed call — shows the red badge on the chat list for the user in
  // `for` (the callee). Cleared when they open the conversation.
  missedCall?: {
    for: string;
    by: string;
    callType?: "audio" | "video";
    createdAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  presence?: "online" | "offline";
  // Partner's last-seen epoch ms (0 when unknown) — powers the WhatsApp-style
  // "last seen Xm ago" line when they're offline. Written by the server on
  // connect/disconnect; batched into the conversations payload.
  lastSeenAt?: number;
  // Per-user: notifications for this chat are muted
  muted?: boolean;
  // Per-user: this chat is archived (drops out of the main list)
  archived?: boolean;
  // WhatsApp-style "Message yourself" chat (both participants are the user) —
  // the server flags it so the UI renders "Message yourself" instead of the
  // user's own name as if chatting with a stranger.
  isSelfChat?: boolean;
}

/**
 * Animated background theme (Settings → Appearance).
 * - "none": calm static dark — no canvas at all
 * - "stellar": flowing liquid-glass waves (BackgroundGradients)
 */
export type BgTheme = "none" | "stellar";

/**
 * Color theme (Settings → Appearance). Swaps the ENTIRE palette at
 * runtime via a data-theme attribute on <html>.
 * - "aurora": cool cosmic midnight — violet-midnight surfaces with
 *   violet → fuchsia → amber gradients (default).
 * - "ember": warm golden-hour — espresso browns with coral → rose →
 *   amber gradients, a completely different mood.
 *   - xlite: classic monochrome — near-black neutral zinc with X-blue
 *     accents (the app's original look, and the default).
 */
export type ColorTheme = "xlite" | "aurora" | "ember" | "genesis";
