import mongoose, { InferSchemaType, HydratedDocument } from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../configs/env";

// user schema
const userSchema = new mongoose.Schema(
	{
		// username
		username: {
			type: String,
			required: [true, "Username is required!"],
			minlength: [3, "Username must be at least 3 characters long!"],
			maxlength: [100, "Username must be less than 100 characters!"],
			trim: true,
			unique: true,
			lowercase: true,
		},

		// fullname
		fullName: {
			type: String,
			required: [true, "Full name is required!"],
			maxlength: 50,
			trim: true,
		},

		// gender
		gender: {
			type: String,
			enum: ["male", "female", "others"],
			lowercase: true,
			default: "others",
		},

		// country (ISO code, e.g. "IN") — used by simulated users so their
		// profile shows the country they belong to; optional for real users.
		country: {
			type: String,
			default: "",
			maxlength: 3,
		},

		// profile bio
		bio: {
			type: String,
			maxlength: 300,
			default: "",
		},

		// profile pic
		profilePic: {
			url: {
				type: String,
				default: "",
			},

			public_id: {
				type: String,
				default: "",
			},
		},

		// banner image
		bannerImage: {
			url: {
				type: String,
				default: "",
			},

			public_id: {
				type: String,
				default: "",
			},
		},

		// email
		email: {
			type: String,
			required: [true, "Email is required!"],
			trim: true,
			lowercase: true,
			unique: true,
		},

		// hashed password (not required for OAuth users)
		password: {
			type: String,
			minlength: [8, "Password must be at least 8 characters long!"],
			default: "",
		},

		// user followers
		followersCount: {
			type: Number,
			default: 0,
		},

		// user following
		followingCount: {
			type: Number,
			default: 0,
		},

		// share count
		sharesCount: {
			type: Number,
			default: 0,
		},

		// views count
		viewsCount: {
			type: Number,
			default: 0,
		},

		// pinned post IDs (max 3)
		pinnedPosts: {
			type: [
				{
					type: mongoose.Schema.Types.ObjectId,
					ref: "Post",
				},
			],
			default: [],
			validate: {
				validator: function (v: any[]) {
					return v.length <= 3;
				},
				message: "Maximum 3 pinned posts allowed!",
			},
		},

		// login attemps for brute force protection
		loginAttempts: {
			type: Number,
			default: 0,
		},

		// lock until (date) - if set, user cannot login
		lockUntil: {
			type: Date,
			default: null,
		},

		// verification otp
		otp: {
			type: String,
			default: null,
		},

		// otp expiry
		otpExpiry: {
			type: Date,
			default: null,
		},

		// otp attempts for abuse prevention
		otpAttempts: {
			type: Number,
			default: 0,
		},

		// when otp lockout expires
		otpLockedUntil: {
			type: Date,
			default: null,
		},

		// email verification status
		isEmailVerified: {
			type: Boolean,
			default: true,
		},

		// password history for preventing reuse (stores last 5 hashed passwords)
		passwordHistory: {
			type: [
				{
					password: String,
					changedAt: Date,
				},
			],
			default: [],
		},

		// Private account (follow requests required)
		isPrivate: {
			type: Boolean,
			default: false,
		},

		// Push notifications enabled
		notificationsEnabled: {
			type: Boolean,
			default: true,
		},

		// Onboarding completed
		isOnboarded: {
			type: Boolean,
			default: false,
		},

		// ── Device permission preferences ────────────────────────────────
		// Recorded once during the first-run permission onboarding (and kept
		// in sync from Settings → Permissions). These persist server-side so
		// the choice follows the account across devices; the browser itself
		// also remembers the actual grant per origin, so we never re-prompt
		// once the user has decided.
		permissionPrefs: {
			type: {
				notifications: {
					type: String,
					enum: ["default", "granted", "denied", "unsupported"],
					default: "default",
				},
				camera: {
					type: String,
					enum: ["default", "granted", "denied", "unsupported"],
					default: "default",
				},
				microphone: {
					type: String,
					enum: ["default", "granted", "denied", "unsupported"],
					default: "default",
				},
			},
			default: {},
		},
		// True once the user has been through the permission onboarding at
		// least once (even if they skipped individual prompts) — the screen
		// must never nag twice.
		permissionOnboardingCompleted: {
			type: Boolean,
			default: false,
		},
		permissionOnboardingCompletedAt: {
			type: Date,
			default: null,
		},

		// Follow request IDs (for private accounts)
		followRequests: [
			{
				type: mongoose.Schema.Types.ObjectId,
				ref: "User",
			},
		],

		// OAuth provider ("google", "local", etc.)
		oauthProvider: {
			type: String,
			enum: ["local", "google"],
			default: "local",
		},

		// OAuth provider user ID
		oauthId: {
			type: String,
			default: null,
		},

		// Admin flag
		isAdmin: {
			type: Boolean,
			default: false,
		},

		// Muted users (user -> mute metadata)
		mutedUsers: {
			type: [{
				user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
				mutedAt: { type: Date, default: Date.now },
				expiresAt: { type: Date },
			}],
			default: [],
		},

		// Posts the user dismissed as "Not interested" — hidden from their
		// home/For-You feeds and post search (content preference).
		hiddenPosts: {
			type: [{
				type: mongoose.Schema.Types.ObjectId,
				ref: "Post",
			}],
			default: [],
		},

		// Imported open-web posts dismissed as "Not interested" — same
		// content preference, applied to the external feed.
		hiddenExternalPosts: {
			type: [{
				type: mongoose.Schema.Types.ObjectId,
				ref: "ExternalPost",
			}],
			default: [],
		},

		// Muted communities (per-user: suppress notifications/push from this
		// community while still receiving its messages in the chat).
		mutedCommunities: {
			type: [{
				community: { type: mongoose.Schema.Types.ObjectId, ref: "Community" },
				mutedAt: { type: Date, default: Date.now },
			}],
			default: [],
		},

		// Muted direct-message conversations (per-user: suppress in-app bell
		// notifications + push from this chat while still receiving messages
		// and the chat-tab unread badge).
		mutedConversations: {
			type: [{
				conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation" },
				mutedAt: { type: Date, default: Date.now },
			}],
			default: [],
		},

		// Per-channel read pointers (communities): for each community room
		// (null room = the general channel) the id of the newest message the
		// user has actually seen. Drives the per-channel unread badges.
		communityRoomReads: {
			type: [{
				community: { type: mongoose.Schema.Types.ObjectId, ref: "Community" },
				// null = the general channel
				room: { type: mongoose.Schema.Types.ObjectId, ref: "CommunityMessage", default: null },
				lastReadMessageId: { type: mongoose.Schema.Types.ObjectId, ref: "CommunityMessage", default: null },
				updatedAt: { type: Date, default: Date.now },
			}],
			default: [],
		},

		// Close friends list
		closeFriends: [{
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
		}],

		// Mute/ban status
		isMuted: {
			type: Boolean,
			default: false,
		},
		isBanned: {
			type: Boolean,
			default: false,
		},

		// ─── Feed ranking fields (used by the affinity engine) ─────────────

		// Cached per-author affinity scores (authorId -> score).
		// Re-computed by a scheduled job, not on every feed request.
		affinityScores: {
			type: Map,
			of: Number,
			default: new Map(),
		},

		// Cached per-tag / content-type affinity (tag -> score).
		// Helps the feed rank higher posts on topics the user engages with.
		contentAffinity: {
			type: Map,
			of: Number,
			default: new Map(),
		},

		// Timestamp of the last affinity recomputation for this user.
		affinityUpdatedAt: {
			type: Date,
			default: null,
		},

		// Set of post IDs the user has recently viewed.
		// Used to exclude already-seen posts from the feed pool.
		// Managed as a capped array — oldest entries are evicted when length > 500.
		seenPosts: {
			type: [String],
			default: [],
		},

		// Users the viewer explicitly dismissed from recommendations ("skip"
		// button on suggestion cards). The recommender never suggests them
		// again. Managed as a capped array (latest 200 kept).
		dismissedSuggestionIds: {
			type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
			default: [],
		},

		// Referral reach boost — while this date is in the future, the user's
		// posts get a score multiplier in other users' feeds. Extended by
		// 7 days per accepted invite (stacking, capped at 90 days).
		reachBoostUntil: {
			type: Date,
			default: null,
		},

		// Verified badge (granted by admins — like Instagram's blue check)
		isVerified: {
			type: Boolean,
			default: false,
		},

		// Day One perk — true when this email was on the waitlist before
		// signing up. Grants the exclusive Aurum theme, the Day One name
		// flair and the First Orbit avatar ring (visual-only rewards) that
		// other users must earn through achievements. Set at signup when the
		// email matches a waitlist record; also back-filled on login for
		// waitlist members who signed up before this feature shipped.
		waitlistPerk: {
			type: Boolean,
			default: false,
		},

		// Custom status / presence text ("Busy", "On vacation 🏖", etc.)
		statusText: {
			type: String,
			default: "",
			maxlength: [80, "Status text must be less than 80 characters!"],
			trim: true,
		},

		// Known login devices — the deviceId comes from the client (a stable
		// id stored in localStorage). The first login from an unrecognized
		// device fires a "New device login" security email. Capped at the
		// most recent 10 so the array can't grow unbounded.
		knownDevices: {
			type: [{
				deviceId: { type: String, required: true },
				label: { type: String, default: "" },
				ip: { type: String, default: "" },
				firstSeenAt: { type: Date, default: Date.now },
				lastSeenAt: { type: Date, default: Date.now },
			}],
			default: [],
		},
	},

	{ timestamps: true },
);

// indexes for optimal query performance
userSchema.index({ username: "text", fullName: "text" });
// Case-insensitive prefix-search indexes (collation strength 2). These make
// EQUALITY/RANGE comparisons (e.g. { username: "alice" } or $gte/$lt bounds)
// case-insensitive and index-backed.
// NB: MongoDB's $regex does NOT apply collation to matching — an anchored
// regex like { username: { $regex: "^a" } } + .collation() matches
// CASE-SENSITIVELY (verified empirically; "^sh" misses "Shreya"). Case-
// insensitive search regexes MUST carry $options: "i" instead (see
// search.controllers.ts). The collation indexes below then serve the $text
// index's fallback: exact/prefix-equality paths, not regex paths.
// Explicit `name` on the username index: the field also declares
// `unique: true` (its own {username:1} index), and Mongoose warns about
// two unnamed indexes with identical fields even when they serve different
// purposes (the unique constraint vs. this case-insensitive collation
// index). Naming one silences the false "Duplicate schema index" warning.
userSchema.index(
  { username: 1 },
  { name: "username_collation", collation: { locale: "en", strength: 2 } },
);
userSchema.index({ fullName: 1 }, { collation: { locale: "en", strength: 2 } });
userSchema.index({ createdAt: -1 });
// username already has unique: true declared in the field definition
// email already has unique: true declared in the field definition
userSchema.index({ followersCount: -1 });
userSchema.index({ followingCount: -1 });
userSchema.index({ createdAt: -1, _id: -1 });
// Multikey index so "who has this user on their closeFriends list" lookups
// (feed visibility: User.find({ closeFriends: currentUserId })) stay fast.
userSchema.index({ closeFriends: 1 });
// Multikey index for per-community mute lookups on the chat hot path
// (sendCommunityMessage filters muted members on every message send).
userSchema.index({ "mutedCommunities.community": 1 });
// Multikey index for per-channel unread lookups (getRoomUnreadCounts reads
// the user's read pointers per community).
userSchema.index({ "communityRoomReads.community": 1 });
// Multikey index for per-conversation mute lookups on the chat hot path
// (sendMessage checks mutedConversations on every message send).
userSchema.index({ "mutedConversations.conversation": 1 });

// password hashing
userSchema.pre("save", async function () {
	// Only hash the password if it has been modified (or is new)
	if (!this.isModified("password")) {
		return;
	}

	// Use stronger bcrypt cost factor for production
	const costFactor = env.NODE_ENV === "production" ? 12 : 10;
	this.password = await bcrypt.hash(this.password, costFactor);
});

// jwt generation
userSchema.methods.signToken = function () {
	return jwt.sign({ userId: this._id }, env.JWT_SECRET, {
		expiresIn: "7d",
		issuer: "orbit",
		audience: "orbit-users",
	});
};

// password verification
userSchema.methods.comparePassword = function (password: string) {
	return bcrypt.compare(password, this.password);
};

type UserType = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<UserType> & {
	pinnedPosts?: mongoose.Types.ObjectId[];
	loginAttempts?: number;
	lockUntil?: Date | null;
	otp?: string | null;
	otpExpiry?: Date | null;
	otpAttempts?: number;
	otpLockedUntil?: Date | null;
	signToken: () => string;
	comparePassword: (password: string) => Promise<boolean>;
};

// user model
export const User = mongoose.model<UserDocument>("User", userSchema);
