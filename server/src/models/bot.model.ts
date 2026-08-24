import mongoose from "mongoose";

/**
 * bot.model.ts — persistence for the bot life-simulation engine.
 *
 * A Bot document stores the full persistent "life" of one simulated human:
 * stable identity + personality, a mood/energy state that fluctuates from
 * events, a rolling memory of recent interactions, and a relationship graph
 * with other bots and real users. Everything survives server restarts.
 */

const memorySchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    at: { type: Number, required: true }, // epoch ms
    type: { type: String, required: true },
    byUserId: { type: String, default: null },
    byBotId: { type: String, default: null },
    content: { type: String, default: "" },
    valence: { type: Number, default: 0 }, // -1 .. +1
  },
  { _id: false },
);

const relationshipSchema = new mongoose.Schema(
  {
    a: { type: String, required: true },
    b: { type: String, required: true },
    isBotPair: { type: Boolean, default: true },
    bond: { type: Number, default: 0 }, // -1 .. +1
    kind: {
      type: String,
      enum: ["acquaintance", "friend", "close_friend", "best_friend", "rival", "crush"],
      default: "acquaintance",
    },
    interactions: { type: Number, default: 0 },
    lastInteractionAt: { type: Number, default: 0 },
    // romance lifecycle: crush → confessed → dating → rejected/broke_up
    romance: {
      status: {
        type: String,
        enum: ["crush", "confessed", "dating", "rejected", "broke_up"],
        default: null,
      },
      since: { type: Number, default: null },
    },
  },
  { _id: false },
);

const botSchema = new mongoose.Schema(
  {
    botId: { type: String, required: true, unique: true },
    // Linked real account in the User collection (created on first action)
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // ── Identity ───────────────────────────────────────────────────────
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // only used for account creation
    name: { type: String, required: true },
    gender: { type: String, enum: ["male", "female"], required: true },
    age: { type: Number, required: true },
    bio: { type: String, default: "" },
    avatarUrl: { type: String, default: "" },
    statusText: { type: String, default: "" },
    // Country identity (curated registry) — everything about the bot's
    // appearance, names, bios and content stays locally authentic.
    country: { type: String, default: "US" },
    countryName: { type: String, default: "" },
    countryEmoji: { type: String, default: "" },
    migratedTo: { type: String, default: null },
    bannerUrl: { type: String, default: "" },

    // ── Personality (Big-5, 0-1) ───────────────────────────────────────
    personality: {
      openness: { type: Number, default: 0.5 },
      extraversion: { type: Number, default: 0.5 },
      agreeableness: { type: Number, default: 0.5 },
      neuroticism: { type: Number, default: 0.5 },
    },

    // topic -> weight (0-1). Higher = posts about it more.
    interests: {
      topics: { type: Map, of: Number, default: {} },
    },

    // ── Comms style ────────────────────────────────────────────────────
    style: {
      emojiDensity: { type: String, enum: ["none", "light", "heavy"], default: "light" },
      messageLength: { type: String, enum: ["short", "medium", "long"], default: "medium" },
      punctuation: { type: String, enum: ["casual", "standard", "proper"], default: "standard" },
      topicsToTalkAbout: { type: [String], default: [] },
      favoriteGreetings: { type: [String], default: [] },
    },

    // ── Daily routine ──────────────────────────────────────────────────
    routine: {
      wakeHour: { type: Number, default: 7 },
      sleepHour: { type: Number, default: 23 },
      postsPerDay: { type: Number, default: 2 },
      engagementsPerDay: { type: Number, default: 12 },
      peakHours: { type: [Number], default: [18, 22] },
    },

    // ── Social placement ───────────────────────────────────────────────
    circleId: { type: String, default: "" },
    circleName: { type: String, default: "" },
    custom: { type: Boolean, default: false },

    // ── Life state ─────────────────────────────────────────────────────
    mood: { type: Number, default: 0 }, // -1 .. +1
    energy: { type: Number, default: 1 }, // 0 .. 1
    lastWakeAt: { type: Number, default: null },
    lastSleepAt: { type: Number, default: null },
    lastActionAt: { type: Number, default: 0 },
    memory: { type: [memorySchema], default: [] },
    stats: {
      posts: { type: Number, default: 0 },
      comments: { type: Number, default: 0 },
      likes: { type: Number, default: 0 },
      messagesSent: { type: Number, default: 0 },
      glances: { type: Number, default: 0 },
      follows: { type: Number, default: 0 },
    },
    // Highest follower milestone already celebrated (doMilestonePost).
    lastMilestonePosted: { type: Number, default: 0 },
    relationships: { type: [relationshipSchema], default: [] },
  },
  { timestamps: true },
);

botSchema.index({ circleId: 1 });
botSchema.index({ userId: 1 });

export const Bot = mongoose.model("Bot", botSchema);

/**
 * Singleton farm config — one document, `_id: "farm"`.
 * Also doubles as the distributed leadership lock: only the process holding
 * the current leaderToken + lease runs the scheduler ticks (so a clustered
 * multi-worker deployment never double-acts).
 */
const farmSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "farm" },
    enabled: { type: Boolean, default: false },
    count: { type: Number, default: 10 },
    intensity: { type: Number, default: 5 }, // 1-10 multiplier
    tickMs: { type: Number, default: 45000 },
    startedAt: { type: Number, default: null },
    aiEnabled: { type: Boolean, default: false },
    // leadership lease
    leaderToken: { type: String, default: "" },
    leaderUntil: { type: Number, default: 0 },
    // recent activity rolling log (for admin monitoring)
    recentActions: {
      type: [
        {
          botId: { type: String, default: "" },
          name: { type: String, default: "" },
          action: { type: String, default: "" },
          detail: { type: String, default: "" },
          at: { type: Number, default: 0 },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

export const BotFarm = mongoose.model("BotFarm", farmSchema);
