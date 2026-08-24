/**
 * types.ts — the bot life-simulation type system.
 *
 * A bot is a persistent simulated human: a stable identity + personality,
 * a mood/energy state that fluctuates from events, a memory of recent
 * interactions, and a social graph of relationships with other bots (and
 * real users). The whole engine works in TWO modes:
 *
 *   1. Template brain — zero dependencies, works with no API key.
 *   2. Gemini brain — when GEMINI_API_KEY is set, conversations/replies
 *      become genuinely contextual; falls back to templates on any error.
 */

export type Gender = "male" | "female";

/** Big-5 personality, 0-1 scale. Drives posting rate, tone, mood swings. */
export interface Personality {
  openness: number; // 0-1 — new topics, curiosity
  extraversion: number; // 0-1 — posting rate, social appetite
  agreeableness: number; // 0-1 — likes everything, warm replies
  neuroticism: number; // 0-1 — mood swings, reacts to being ignored
}

/** Weighted interests → what the bot posts about and engages with. */
export interface InterestProfile {
  /** topic -> weight (0-1). Higher = posts about it more. */
  topics: Record<string, number>;
}

export type MoodTone = "happy" | "neutral" | "low" | "excited" | "tired" | "thoughtful";

/** Daily routine template — when the bot is awake/active. */
export interface Routine {
  wakeHour: number; // 0-23 local
  sleepHour: number;
  /** average number of posts per day (scaled by personality later) */
  postsPerDay: number;
  /** average number of engagements (likes/comments) per day */
  engagementsPerDay: number;
  /** peak activity window [startHour, endHour] */
  peakHours: [number, number];
}

/** The stable, persistent identity of one bot. */
export interface BotPersona {
  botId: string; // internal id (also used as account username suffix)
  username: string;
  password: string; // plaintext only for account creation; bots never log in via UI
  name: string; // display fullName
  gender: Gender;
  age: number;
  bio: string;
  avatarUrl: string;
  /** custom status text ("Busy", "In my gym era 💪") shown on their profile */
  statusText: string;
  /** country code ("IN", "NG"…) from the curated country registry */
  country: string;
  /** display name of the country ("India") */
  countryName: string;
  /** country emoji ("🇮🇳") */
  countryEmoji: string;
  /** optional — the bot has migrated to another country (foreign posts) */
  migratedTo?: string;
  /** profile banner image url */
  bannerUrl?: string;
  personality: Personality;
  interests: InterestProfile;
  /** comms style knobs */
  style: {
    emojiDensity: "none" | "light" | "heavy";
    messageLength: "short" | "medium" | "long";
    punctuation: "casual" | "standard" | "proper";
    topicsToTalkAbout: string[];
    favoriteGreetings: string[];
  };
  routine: Routine;
  /** which friend circle this bot belongs to (for the doc's group-density) */
  circleId: string;
  circleName: string;
  /** true = personality was configured by admin, false = auto-generated */
  custom?: boolean;
}

/** A single memory entry — what happened to this bot recently. */
export interface BotMemory {
  id: string;
  at: number; // epoch ms
  type:
    | "post_liked"
    | "post_commented"
    | "comment_replied"
    | "message_received"
    | "message_sent"
    | "followed"
    | "followed_back"
    | "glimpse_reaction"
    | "mentioned"
    | "ignored"
    | "ignored_them"
    // romance + conflict lifecycle events
    | "crush_developed"
    | "confessed"
    | "started_dating"
    | "rejected"
    | "broke_up"
    | "trolled"
    | "fought"
    | "defended";
  byUserId?: string; // who caused it
  byBotId?: string;
  content?: string;
  /** -1 (bad) .. +1 (good) emotional valence — shifts mood */
  valence: number;
}

/** Running life state — the part that changes every tick. */
export interface BotLifeState {
  botId: string;
  mood: number; // -1 .. +1
  energy: number; // 0 .. 1 (drains during the day, refills at night)
  lastWakeAt: number | null;
  lastSleepAt: number | null;
  /** rolling memory, newest last */
  memory: BotMemory[];
  /** total counters (perf + diagnostics) */
  stats: {
    posts: number;
    comments: number;
    likes: number;
    messagesSent: number;
    glances: number;
    follows: number;
  };
  lastActionAt: number;
}

/** Relationship bond between two bots (or a bot and a real user). */
export interface Relationship {
  a: string; // botId or userId
  b: string; // botId or userId
  isBotPair: boolean; // both simulated?
  bond: number; // -1 (hostile) .. +1 (best friends)
  kind: "acquaintance" | "friend" | "close_friend" | "best_friend" | "rival" | "crush";
  interactions: number;
  lastInteractionAt: number;
  /** romance lifecycle state (crush → dating → heartbreak) */
  romance?: {
    status: "crush" | "confessed" | "dating" | "rejected" | "broke_up";
    since: number;
  } | null;
}

/** A scheduled "thing the bot does now". */
export type BotActivity =
  | { type: "post"; topic?: string }
  | { type: "glimpse"; }
  | { type: "like"; targetBotId?: string }
  | { type: "comment"; targetBotId?: string; targetPostId?: string }
  | { type: "reply_to_comment"; }
  | { type: "message"; targetBotId: string; content: string }
  | { type: "reply_message"; toMessageId: string; conversationId: string }
  | { type: "follow"; targetBotId: string }
  | { type: "follow_back"; }
  | { type: "sleep"; };

/** Config for the whole farm. */
export interface BotFarmConfig {
  enabled: boolean;
  /** how many bots exist */
  count: number;
  /** 1-10 intensity multiplier on activity rates */
  intensity: number;
  /** ms between scheduler ticks */
  tickMs: number;
  /** id of the circle each new bot joins */
  circleTemplate: string;
  startedAt: number | null;
  /** true if Gemini key present */
  aiEnabled: boolean;
}
