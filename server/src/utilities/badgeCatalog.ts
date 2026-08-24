/**
 * The complete achievement badge catalog — single source of truth on the
 * server. The client mirrors this in `client/src/utils/badgeCatalog.ts`;
 * keep the two in sync (badge IDs must match; labels/descriptions are
 * display-only so they can diverge slightly for icon sizing).
 *
 * Badge naming philosophy: a mix of classic social-app achievements
 * ("First Steps", "Founder"), modern Gen-Z/gaming terms ("Glow Up",
 * "Main Character", "Final Boss"), and hustle-culture creator terms
 * ("Content Machine", "Go Viral", "Super Fan") so every kind of user
 * finds badges they actually want to chase.
 */
export interface BadgePerk {
  type: "theme" | "ring" | "aura" | "flair" | "stamp" | "confetti";
  tier: string;
  title: string;
  description: string;
  howToUse: string;
}

/**
 * Internal difficulty curve — NEVER shown in the UI. Records the
 * balance so the catalog is not trivially completable: easy hooks new
 * users, moderate takes weeks, hard takes months, super is legendary.
 */
export type BadgeDifficulty = "easy" | "moderate" | "hard" | "super";

export const BADGE_CATALOG: Record<
  string,
  { label: string; description: string; category: string; difficulty: BadgeDifficulty; perk: BadgePerk }
> = {
  // ── XP milestones ──────────────────────────────────────────────
  first_100: { difficulty: "easy", label: "First Steps", description: "Reach 100 XP", category: "XP", perk: { type: "ring", tier: "bronze", title: "Bronze Halo", description: "Your avatar wears a bronze halo ring.", howToUse: "It is on automatically — your avatar wears it on your profile." } },
  first_1k: { difficulty: "moderate", label: "Rising Star", description: "Reach 1,000 XP", category: "XP", perk: { type: "ring", tier: "silver", title: "Silver Orbit", description: "Your avatar wears a silver orbit ring.", howToUse: "It is on automatically — your avatar wears it on your profile." } },
  xp_5k: { difficulty: "moderate", label: "Big Brain Energy", description: "Reach 5,000 XP", category: "XP", perk: { type: "theme", tier: "aurora", title: "Aurora Theme", description: "Unlock the Aurora color theme for the whole app.", howToUse: "Open Settings → Appearance → Color Theme and switch it on." } },
  first_10k: { difficulty: "hard", label: "XP Legend", description: "Reach 10,000 XP", category: "XP", perk: { type: "ring", tier: "gold", title: "Golden Halo", description: "Your avatar wears a golden halo ring.", howToUse: "It is on automatically — your avatar wears it on your profile." } },
  xp_25k: { difficulty: "hard", label: "Content King", description: "Reach 25,000 XP", category: "XP", perk: { type: "aura", tier: "gold", title: "Golden Aura", description: "A golden aura glows behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },
  xp_50k: { difficulty: "hard", label: "Mogul Mode", description: "Reach 50,000 XP", category: "XP", perk: { type: "aura", tier: "violet", title: "Violet Aura", description: "A violet aura glows behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },
  xp_100k: { difficulty: "hard", label: "Final Boss", description: "Reach 100,000 XP", category: "XP", perk: { type: "aura", tier: "cosmic", title: "Cosmic Aura", description: "A cosmic aura radiates behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },

  // ── Levels ─────────────────────────────────────────────────────
  level_5: { difficulty: "easy", label: "Level 5", description: "Reach level 5", category: "Level", perk: { type: "ring", tier: "silver", title: "Silver Orbit", description: "Your avatar wears a silver orbit ring.", howToUse: "It is on automatically — your avatar wears it on your profile." } },
  level_10: { difficulty: "moderate", label: "Level 10", description: "Reach level 10", category: "Level", perk: { type: "flair", tier: "crown", title: "Crown Flair", description: "A crown appears beside your display name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },
  level_15: { difficulty: "moderate", label: "Star Collector", description: "Reach level 15", category: "Level", perk: { type: "flair", tier: "star", title: "Star Flair", description: "A star appears beside your display name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },
  level_20: { difficulty: "hard", label: "Level 20", description: "Reach level 20", category: "Level", perk: { type: "aura", tier: "gold", title: "Golden Aura", description: "A golden aura glows behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },
  level_25: { difficulty: "hard", label: "Orbit Elite", description: "Reach level 25", category: "Level", perk: { type: "aura", tier: "violet", title: "Violet Aura", description: "A violet aura glows behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },

  // ── Content creation ───────────────────────────────────────────
  post_1: { difficulty: "easy", label: "Hello World", description: "Publish your first post", category: "Creator", perk: { type: "stamp", tier: "common", title: "Post Stamp", description: "Your posts carry the classic stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  post_10: { difficulty: "moderate", label: "Storyteller", description: "Publish 10 posts", category: "Creator", perk: { type: "stamp", tier: "common", title: "Post Stamp", description: "Your posts carry the classic stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  post_50: { difficulty: "moderate", label: "Content Machine", description: "Publish 50 posts", category: "Creator", perk: { type: "stamp", tier: "rare", title: "Rare Post Stamp", description: "Your posts carry the rare stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  post_100: { difficulty: "hard", label: "Trending Topic", description: "Publish 100 posts", category: "Creator", perk: { type: "stamp", tier: "rare", title: "Rare Post Stamp", description: "Your posts carry the rare stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  video_1: { difficulty: "easy", label: "Lights, Camera", description: "Publish your first video", category: "Creator", perk: { type: "stamp", tier: "common", title: "Post Stamp", description: "Your posts carry the classic stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  video_10: { difficulty: "moderate", label: "Director's Cut", description: "Publish 10 videos", category: "Creator", perk: { type: "stamp", tier: "rare", title: "Rare Post Stamp", description: "Your posts carry the rare stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  image_1: { difficulty: "easy", label: "Snap Master", description: "Publish your first photo", category: "Creator", perk: { type: "stamp", tier: "common", title: "Post Stamp", description: "Your posts carry the classic stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  image_25: { difficulty: "moderate", label: "Visual Storyteller", description: "Publish 25 photos", category: "Creator", perk: { type: "stamp", tier: "rare", title: "Rare Post Stamp", description: "Your posts carry the rare stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  glance_1: { difficulty: "easy", label: "Glance Starter", description: "Post your first glance", category: "Creator", perk: { type: "stamp", tier: "common", title: "Post Stamp", description: "Your posts carry the classic stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  glance_10: { difficulty: "moderate", label: "Story Time", description: "Post 10 glances", category: "Creator", perk: { type: "stamp", tier: "rare", title: "Rare Post Stamp", description: "Your posts carry the rare stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  night_owl: { difficulty: "easy", label: "Night Owl", description: "Post between 12am–5am", category: "Creator", perk: { type: "confetti", tier: "aurora", title: "Aurora Confetti", description: "Your celebrations burst in aurora confetti.", howToUse: "It is on automatically — your achievement celebrations burst in these colors." } },
  early_bird: { difficulty: "easy", label: "Early Riser", description: "Post between 5am–8am", category: "Creator", perk: { type: "confetti", tier: "gold", title: "Golden Confetti", description: "Your celebrations burst in golden confetti.", howToUse: "It is on automatically — your achievement celebrations burst in these colors." } },

  // ── Reach (engagement received) ────────────────────────────────
  likes_received_10: { difficulty: "easy", label: "First Applause", description: "10 likes on your posts", category: "Reach", perk: { type: "ring", tier: "bronze", title: "Bronze Halo", description: "Your avatar wears a bronze halo ring.", howToUse: "It is on automatically — your avatar wears it on your profile." } },
  likes_received_100: { difficulty: "moderate", label: "Crowd Favorite", description: "100 likes on your posts", category: "Reach", perk: { type: "ring", tier: "silver", title: "Silver Orbit", description: "Your avatar wears a silver orbit ring.", howToUse: "It is on automatically — your avatar wears it on your profile." } },
  likes_received_1k: { difficulty: "hard", label: "Internet Famous", description: "1,000 likes on your posts", category: "Reach", perk: { type: "ring", tier: "gold", title: "Golden Halo", description: "Your avatar wears a golden halo ring.", howToUse: "It is on automatically — your avatar wears it on your profile." } },
  likes_received_10k: { difficulty: "hard", label: "Viral Star", description: "10,000 likes on your posts", category: "Reach", perk: { type: "ring", tier: "aurora", title: "Aurora Ring", description: "Your avatar wears the cosmic aurora ring.", howToUse: "It is on automatically — your avatar wears it on your profile." } },
  comments_received_10: { difficulty: "easy", label: "Conversation Starter", description: "10 comments on your posts", category: "Reach", perk: { type: "flair", tier: "heart", title: "Heart Flair", description: "A heart appears beside your display name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },
  comments_received_100: { difficulty: "moderate", label: "Community Voice", description: "100 comments on your posts", category: "Reach", perk: { type: "flair", tier: "heart", title: "Heart Flair", description: "A heart appears beside your display name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },
  followers_10: { difficulty: "easy", label: "Social Butterfly", description: "Reach 10 followers", category: "Reach", perk: { type: "flair", tier: "sparkles", title: "Sparkle Flair", description: "Sparkles appear beside your display name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },
  followers_100: { difficulty: "moderate", label: "Rising Influencer", description: "Reach 100 followers", category: "Reach", perk: { type: "flair", tier: "star", title: "Star Flair", description: "A star appears beside your display name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },
  followers_1k: { difficulty: "hard", label: "Trendsetter", description: "Reach 1,000 followers", category: "Reach", perk: { type: "aura", tier: "gold", title: "Golden Aura", description: "A golden aura glows behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },
  followers_10k: { difficulty: "hard", label: "Celebrity Status", description: "Reach 10,000 followers", category: "Reach", perk: { type: "aura", tier: "violet", title: "Violet Aura", description: "A violet aura glows behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },

  // ── Engagement given ───────────────────────────────────────────
  likes_given_10: { difficulty: "easy", label: "Like Machine", description: "Like 10 posts", category: "Engagement", perk: { type: "flair", tier: "heart", title: "Heart Flair", description: "A heart appears beside your display name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },
  likes_given_100: { difficulty: "moderate", label: "Super Fan", description: "Like 100 posts", category: "Engagement", perk: { type: "flair", tier: "heart", title: "Heart Flair", description: "A heart appears beside your display name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },
  comments_given_10: { difficulty: "easy", label: "Chatterbox", description: "Comment 10 times", category: "Engagement", perk: { type: "flair", tier: "star", title: "Star Flair", description: "A star appears beside your display name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },
  comments_given_50: { difficulty: "moderate", label: "Open Mic", description: "Comment 50 times", category: "Engagement", perk: { type: "flair", tier: "star", title: "Star Flair", description: "A star appears beside your display name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },
  saves_10: { difficulty: "easy", label: "Curator", description: "Save 10 posts", category: "Engagement", perk: { type: "stamp", tier: "common", title: "Post Stamp", description: "Your posts carry the classic stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  saves_50: { difficulty: "moderate", label: "Museum Curator", description: "Save 50 posts", category: "Engagement", perk: { type: "stamp", tier: "rare", title: "Rare Post Stamp", description: "Your posts carry the rare stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  shares_10: { difficulty: "easy", label: "Amplifier", description: "Share 10 posts", category: "Engagement", perk: { type: "stamp", tier: "common", title: "Post Stamp", description: "Your posts carry the classic stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  shares_50: { difficulty: "moderate", label: "Go Viral", description: "Share 50 posts", category: "Engagement", perk: { type: "stamp", tier: "rare", title: "Rare Post Stamp", description: "Your posts carry the rare stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  repost_5: { difficulty: "moderate", label: "Rebroadcaster", description: "Repost 5 posts", category: "Engagement", perk: { type: "stamp", tier: "rare", title: "Rare Post Stamp", description: "Your posts carry the rare stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  repost_25: { difficulty: "hard", label: "Echo Chamber", description: "Repost 25 posts", category: "Engagement", perk: { type: "stamp", tier: "epic", title: "Epic Post Stamp", description: "Your posts carry the epic stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },

  // ── Communities ────────────────────────────────────────────────
  community_1: { difficulty: "easy", label: "Local Hero", description: "Join your first community", category: "Community", perk: { type: "stamp", tier: "common", title: "Post Stamp", description: "Your posts carry the classic stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  community_5: { difficulty: "moderate", label: "Community Connector", description: "Join 5 communities", category: "Community", perk: { type: "stamp", tier: "rare", title: "Rare Post Stamp", description: "Your posts carry the rare stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  community_created: { difficulty: "easy", label: "Mayor", description: "Create your first community", category: "Community", perk: { type: "aura", tier: "gold", title: "Golden Aura", description: "A golden aura glows behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },
  community_admin: { difficulty: "moderate", label: "Sheriff", description: "Become an admin or moderator", category: "Community", perk: { type: "aura", tier: "violet", title: "Violet Aura", description: "A violet aura glows behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },

  // ── Chat ───────────────────────────────────────────────────────
  message_1: { difficulty: "easy", label: "First Contact", description: "Send your first DM", category: "Chat", perk: { type: "flair", tier: "sparkles", title: "Sparkle Flair", description: "Sparkles appear beside your display name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },
  message_100: { difficulty: "moderate", label: "Smooth Talker", description: "Send 100 DMs", category: "Chat", perk: { type: "flair", tier: "heart", title: "Heart Flair", description: "A heart appears beside your display name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },
  message_1k: { difficulty: "hard", label: "Chatterbox", description: "Send 1,000 DMs", category: "Chat", perk: { type: "flair", tier: "trophy", title: "Trophy Flair", description: "A trophy appears beside your display name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },

  // ── Streaks ────────────────────────────────────────────────────
  streak_3: { difficulty: "easy", label: "Getting Hooked", description: "3-day streak", category: "Streak", perk: { type: "confetti", tier: "gold", title: "Golden Confetti", description: "Your celebrations burst in golden confetti.", howToUse: "It is on automatically — your achievement celebrations burst in these colors." } },
  streak_7: { difficulty: "moderate", label: "On Fire", description: "7-day streak", category: "Streak", perk: { type: "confetti", tier: "ember", title: "Ember Confetti", description: "Your celebrations burst in ember confetti.", howToUse: "It is on automatically — your achievement celebrations burst in these colors." } },
  streak_30: { difficulty: "moderate", label: "Unstoppable", description: "30-day streak", category: "Streak", perk: { type: "theme", tier: "ember", title: "Ember Theme", description: "Unlock the Ember color theme for the whole app.", howToUse: "Open Settings → Appearance → Color Theme and switch it on." } },
  streak_100: { difficulty: "hard", label: "Century Club", description: "100-day streak", category: "Streak", perk: { type: "confetti", tier: "rainbow", title: "Rainbow Confetti", description: "Your celebrations burst in rainbow confetti.", howToUse: "It is on automatically — your achievement celebrations burst in these colors." } },
  streak_365: { difficulty: "super", label: "Year One", description: "365-day streak", category: "Streak", perk: { type: "confetti", tier: "legendary", title: "Legend Confetti", description: "Your celebrations burst in legendary confetti.", howToUse: "It is on automatically — your achievement celebrations burst in these colors." } },

  // ── Referrals ──────────────────────────────────────────────────
  referral_1: { difficulty: "easy", label: "First Friend", description: "1 friend joined", category: "Referral", perk: { type: "flair", tier: "sparkles", title: "Sparkle Flair", description: "Sparkles appear beside your display name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },
  referral_5: { difficulty: "moderate", label: "Growth Starter", description: "5 friends joined", category: "Referral", perk: { type: "flair", tier: "star", title: "Star Flair", description: "A star appears beside your display name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },
  referral_10: { difficulty: "hard", label: "Network Builder", description: "10 friends joined", category: "Referral", perk: { type: "aura", tier: "gold", title: "Golden Aura", description: "A golden aura glows behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },
  referral_25: { difficulty: "hard", label: "Orbit Ambassador", description: "25 friends joined", category: "Referral", perk: { type: "aura", tier: "violet", title: "Violet Aura", description: "A violet aura glows behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },
  referral_50: { difficulty: "hard", label: "Social Magnet", description: "50 friends joined", category: "Referral", perk: { type: "aura", tier: "cosmic", title: "Cosmic Aura", description: "A cosmic aura radiates behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },
  referral_100: { difficulty: "hard", label: "Influencer", description: "100 friends joined", category: "Referral", perk: { type: "aura", tier: "legendary", title: "Legend Aura", description: "A legendary aura radiates behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },

  // ── Missions ───────────────────────────────────────────────────
  mission_1: { difficulty: "easy", label: "Task Tamer", description: "Complete your first daily mission", category: "Missions", perk: { type: "stamp", tier: "common", title: "Post Stamp", description: "Your posts carry the classic stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  mission_20: { difficulty: "moderate", label: "Mission Control", description: "Complete 20 daily missions", category: "Missions", perk: { type: "stamp", tier: "rare", title: "Rare Post Stamp", description: "Your posts carry the rare stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },

  // ── Special ────────────────────────────────────────────────────
  founder: { difficulty: "easy", label: "Founder", description: "Joined via an invite", category: "Special", perk: { type: "aura", tier: "legendary", title: "Legend Aura", description: "A legendary aura radiates behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },
  profile_complete: { difficulty: "easy", label: "Glow Up", description: "Add an avatar and bio", category: "Special", perk: { type: "ring", tier: "gold", title: "Golden Halo", description: "Your avatar wears a golden halo ring.", howToUse: "It is on automatically — your avatar wears it on your profile." } },
  all_rounder: { difficulty: "moderate", label: "Omnivore", description: "Like, comment, save and share 10 times each", category: "Special", perk: { type: "flair", tier: "trophy", title: "Trophy Flair", description: "A trophy appears beside your display name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },
  // Extended XP milestones
  xp_200k: { difficulty: "hard", label: "Living Legend", description: "Reach 200,000 XP", category: "XP", perk: { type: "aura", tier: "legendary", title: "Legend Aura", description: "A legendary aura radiates behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },
  xp_500k: { difficulty: "hard", label: "Orbit Royalty", description: "Reach 500,000 XP", category: "XP", perk: { type: "aura", tier: "legendary", title: "Legend Aura", description: "A legendary aura radiates behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },
  xp_1m: { difficulty: "super", label: "One in a Million", description: "Reach 1,000,000 XP", category: "XP", perk: { type: "aura", tier: "legendary", title: "Legend Aura", description: "A legendary aura radiates behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },

  // Extended levels
  level_30: { difficulty: "hard", label: "Level 30", description: "Reach level 30", category: "Level", perk: { type: "aura", tier: "cosmic", title: "Cosmic Aura", description: "A cosmic aura radiates behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },
  level_40: { difficulty: "hard", label: "Level 40", description: "Reach level 40", category: "Level", perk: { type: "aura", tier: "legendary", title: "Legend Aura", description: "A legendary aura radiates behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },
  level_50: { difficulty: "super", label: "Max Level", description: "Reach level 50", category: "Level", perk: { type: "aura", tier: "legendary", title: "Legend Aura", description: "A legendary aura radiates behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },

  // Extended creation
  post_500: { difficulty: "hard", label: "Content Empire", description: "Publish 500 posts", category: "Creator", perk: { type: "stamp", tier: "epic", title: "Epic Post Stamp", description: "Your posts carry the epic stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  post_1k: { difficulty: "hard", label: "Story God", description: "Publish 1,000 posts", category: "Creator", perk: { type: "stamp", tier: "legendary", title: "Legend Stamp", description: "Your posts carry the legendary stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  video_25: { difficulty: "hard", label: "Film Studio", description: "Publish 25 videos", category: "Creator", perk: { type: "stamp", tier: "epic", title: "Epic Post Stamp", description: "Your posts carry the epic stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  image_100: { difficulty: "hard", label: "Shutter Legend", description: "Publish 100 photos", category: "Creator", perk: { type: "stamp", tier: "epic", title: "Epic Post Stamp", description: "Your posts carry the epic stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  glance_50: { difficulty: "hard", label: "Moment Maker", description: "Post 50 glances", category: "Creator", perk: { type: "stamp", tier: "epic", title: "Epic Post Stamp", description: "Your posts carry the epic stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  glance_100: { difficulty: "hard", label: "Storyteller Supreme", description: "Post 100 glances", category: "Creator", perk: { type: "stamp", tier: "epic", title: "Epic Post Stamp", description: "Your posts carry the epic stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },

  // Extended reach
  likes_received_50k: { difficulty: "hard", label: "Tastemaker", description: "50,000 likes on your posts", category: "Reach", perk: { type: "ring", tier: "rainbow", title: "Rainbow Ring", description: "Your avatar wears a radiant rainbow ring.", howToUse: "It is on automatically — your avatar wears it on your profile." } },
  likes_received_100k: { difficulty: "super", label: "Cultural Phenomenon", description: "100,000 likes on your posts", category: "Reach", perk: { type: "ring", tier: "legendary", title: "Legend Ring", description: "Your avatar wears the legendary ring.", howToUse: "It is on automatically — your avatar wears it on your profile." } },
  comments_received_500: { difficulty: "hard", label: "Dinner Table", description: "500 comments on your posts", category: "Reach", perk: { type: "flair", tier: "gem", title: "Gem Flair", description: "A gem appears beside your display name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },
  comments_received_1k: { difficulty: "hard", label: "Main Character", description: "1,000 comments on your posts", category: "Reach", perk: { type: "flair", tier: "gem", title: "Gem Flair", description: "A gem appears beside your display name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },
  followers_50k: { difficulty: "hard", label: "Star Power", description: "Reach 50,000 followers", category: "Reach", perk: { type: "aura", tier: "cosmic", title: "Cosmic Aura", description: "A cosmic aura radiates behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },
  followers_100k: { difficulty: "super", label: "Blue Check Energy", description: "Reach 100,000 followers", category: "Reach", perk: { type: "aura", tier: "legendary", title: "Legend Aura", description: "A legendary aura radiates behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },

  // Extended engagement
  likes_given_500: { difficulty: "moderate", label: "Engagement Fiend", description: "Like 500 posts", category: "Engagement", perk: { type: "flair", tier: "zap", title: "Bolt Flair", description: "A lightning bolt appears beside your name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },
  likes_given_1k: { difficulty: "hard", label: "Like God", description: "Like 1,000 posts", category: "Engagement", perk: { type: "flair", tier: "zap", title: "Bolt Flair", description: "A lightning bolt appears beside your name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },
  comments_given_200: { difficulty: "hard", label: "Deep Conversationalist", description: "Comment 200 times", category: "Engagement", perk: { type: "flair", tier: "gem", title: "Gem Flair", description: "A gem appears beside your display name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },
  comments_given_500: { difficulty: "hard", label: "Talk of the Town", description: "Comment 500 times", category: "Engagement", perk: { type: "flair", tier: "gem", title: "Gem Flair", description: "A gem appears beside your display name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },
  saves_100: { difficulty: "hard", label: "Curator's Eye", description: "Save 100 posts", category: "Engagement", perk: { type: "stamp", tier: "epic", title: "Epic Post Stamp", description: "Your posts carry the epic stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  shares_200: { difficulty: "hard", label: "Town Crier", description: "Share 200 posts", category: "Engagement", perk: { type: "stamp", tier: "epic", title: "Epic Post Stamp", description: "Your posts carry the epic stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  repost_100: { difficulty: "hard", label: "Signal Booster", description: "Repost 100 posts", category: "Engagement", perk: { type: "stamp", tier: "legendary", title: "Legend Stamp", description: "Your posts carry the legendary stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },

  // Extended community
  community_10: { difficulty: "hard", label: "Social Hub", description: "Join 10 communities", category: "Community", perk: { type: "stamp", tier: "epic", title: "Epic Post Stamp", description: "Your posts carry the epic stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  community_25: { difficulty: "hard", label: "Community Soul", description: "Join 25 communities", category: "Community", perk: { type: "stamp", tier: "legendary", title: "Legend Stamp", description: "Your posts carry the legendary stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  community_admin_2: { difficulty: "hard", label: "Boss Energy", description: "Admin or moderator of 2+ communities", category: "Community", perk: { type: "aura", tier: "cosmic", title: "Cosmic Aura", description: "A cosmic aura radiates behind your avatar.", howToUse: "It is on automatically — the glow shows behind your avatar on your profile." } },

  // Extended chat
  message_5k: { difficulty: "hard", label: "Conversation King", description: "Send 5,000 DMs", category: "Chat", perk: { type: "flair", tier: "crown", title: "Crown Flair", description: "A crown appears beside your display name.", howToUse: "It is on automatically — the icon shows next to your display name across the app." } },

  // Extended streaks
  streak_150: { difficulty: "hard", label: "Iron Will", description: "150-day streak", category: "Streak", perk: { type: "confetti", tier: "aurora", title: "Aurora Confetti", description: "Your celebrations burst in aurora confetti.", howToUse: "It is on automatically — your achievement celebrations burst in these colors." } },
  streak_200: { difficulty: "hard", label: "Legendary Streak", description: "200-day streak", category: "Streak", perk: { type: "confetti", tier: "rainbow", title: "Rainbow Confetti", description: "Your celebrations burst in rainbow confetti.", howToUse: "It is on automatically — your achievement celebrations burst in these colors." } },

  // Extended missions
  mission_50: { difficulty: "hard", label: "Task Crusher", description: "Complete 50 daily missions", category: "Missions", perk: { type: "stamp", tier: "epic", title: "Epic Post Stamp", description: "Your posts carry the epic stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
  mission_100: { difficulty: "hard", label: "Mission Impossible", description: "Complete 100 daily missions", category: "Missions", perk: { type: "stamp", tier: "legendary", title: "Legend Stamp", description: "Your posts carry the legendary stamp.", howToUse: "It is on automatically — your posts carry the stamp in feeds and profiles." } },
};

/**
 * Color themes that are locked behind achievements. A user may select a
 * theme only after earning its badge (see THEME_UNLOCK_BADGES). "xlite"
 * is the free default and is never in this map. Mirrored in the client
 * (client/src/utils/badgeCatalog.ts).
 */
export const THEME_UNLOCK_BADGES: Record<string, string> = {
  aurora: "xp_5k",
  ember: "streak_30",
};

/** Progress metric keys returned by the achievements endpoint. */
export const ACHIEVEMENT_METRICS = [
  "postCount",
  "videoCount",
  "imageCount",
  "glanceCount",
  "likesGiven",
  "likesReceived",
  "commentsMade",
  "commentsReceived",
  "saves",
  "shares",
  "reposts",
  "followers",
  "communitiesJoined",
  "communitiesCreated",
  "communitiesAdmin",
  "messages",
  "missionsCompleted",
] as const;

export type AchievementMetric = (typeof ACHIEVEMENT_METRICS)[number];
