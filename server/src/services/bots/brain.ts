/**
 * brain.ts — the dual brain.
 *
 * Mode 1 (always works): a template engine that writes gender-, mood- and
 * personality-consistent posts, comments, replies, chat messages and glimpse
 * captions. Zero dependencies, zero API key.
 *
 * Mode 2 (when GEMINI_API_KEY is set): real contextual conversation via
 * Google's free-tier Gemini API (no card required). Any error or timeout
 * falls back to templates, so the farm never breaks without a key.
 */

import type { BotPersona, MoodTone } from "./types";
import { pick, mulberry32 } from "./identity";
import { getCountry, localHourFor, isWeekendFor } from "./countries";
import { INTEREST_POOL } from "./personas";
import type { MediaKind } from "./media";

// ── Variety machinery ──────────────────────────────────────────────────────
// Two things kill the "every bot posts the same thing" look:
//   1. Per-bot, per-day content streams — each bot draws from a DIFFERENT
//      deterministic sequence that rotates daily, so no two bots ever land
//      on the same text at the same time, and yesterday's posts don't replay
//      today.
//   2. A recently-used guard — a bot never repeats a template until it has
//      cycled through fresh ones.
const contentRandCache = new Map<string, () => number>();

/** Per-bot, per-day PRNG for CONTENT (distinct from botRand used for dice). */
export function contentRand(botId: string): () => number {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${botId}:${day}`;
  let gen = contentRandCache.get(key);
  if (!gen) {
    const seed = `${botId}:${day}:${Math.floor(Date.now() / 86400000)}`;
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    gen = mulberry32(h);
    contentRandCache.set(key, gen);
  }
  return gen;
}

// Recently-used indices per bot+pool, so a template can't repeat until the
// bot has cycled through fresh ones.
const recentUsed = new Map<string, number[]>();

function pickFresh(rand: () => number, pool: string[], botId: string, poolKey: string, keep = 4): string {
  const key = `${botId}:${poolKey}`;
  const recent = recentUsed.get(key) || [];
  let idx = Math.floor(rand() * pool.length);
  let guard = 0;
  while (recent.includes(idx) && guard++ < 6) {
    idx = Math.floor(rand() * pool.length);
  }
  recent.push(idx);
  if (recent.length > keep) recent.shift();
  recentUsed.set(key, recent);
  return pool[idx] ?? pool[0] ?? "";
}

// ── Template libraries ────────────────────────────────────────────────────

interface TemplateBank {
  posts: Record<string, string[]>;
  comments: string[];
  replies: string[];
  messageOpeners: string[];
  messageFollowUps: string[];
  glimpseCaptions: string[];
  goodnight: string[];
  goodmorning: string[];
}

// ── Media-matched captions ────────────────────────────────────────────────
// When a bot attaches a photo/gallery/GIF/video, the caption comes from the
// pool that MATCHES that media kind (a photo gets a photo caption, a video
// gets a video caption). Topic templates are only used for text-only posts,
// so text and media always feel related — no more "morning run 🏃‍♀️" under
// a random landscape photo.
const MEDIA_CAPTIONS: Record<Exclude<MediaKind, "none">, string[]> = {
  photo: [
    "Golden hour doing golden hour things 🌅",
    "The light today was doing too much. Had to capture it 📸",
    "Found this view and stopped for a second. Worth it.",
    "Some moments just deserve a photo.",
    "Today through a lens. Not mad at it.",
    "The sky put on a show today. Free art.",
    "Went out for a walk and this happened. No filter.",
    "Random shot that turned out better than expected.",
    "A quiet corner of today 📷",
    "Caught this on my walk. Felt like sharing.",
    "Little moments like this make the day.",
    "Today's aesthetic, courtesy of the weather.",
  ],
  gallery: [
    "A few moments from today. No notes ✨",
    "Little collection from the last couple days.",
    "Some of today, in pictures.",
    "Couldn't pick just one, so here's a few.",
    "Photo dump of the week. Enjoy 📸",
    "These days feel like a highlight reel.",
    "Saving these forever. Had to share.",
    "A small gallery of good days.",
  ],
  gif: [
    "Me today, honestly 😂",
    "This is exactly how I feel right now.",
    "No words. Just this.",
    "Accurate representation of my day.",
    "I felt this in my soul.",
    "Current mood, captured perfectly.",
    "This is the energy we're bringing today.",
    "Exactly what I wanted to say but couldn't.",
  ],
  video: [
    "Had to record this. Too good not to share 🎬",
    "Caught this on camera today. Sound on!",
    "This made me smile. Sharing the moment.",
    "One of those little moments worth keeping.",
    "Today had a soundtrack and it was this.",
    "Found this clip and had to post it.",
    "Shot this earlier. No edits, just vibes.",
    "This is why I love capturing little moments.",
  ],
};

// ── Time-of-day & day-of-week content ─────────────────────────────────────
// Humans post about different things at different times: coffee in the
// morning, "winding down" at night, weekend plans on Saturday. These pools
// are blended into text-only posts based on the bot's LOCAL timezone.
const DAYPART_POSTS: Record<string, string[]> = {
  morning: [
    "Coffee's brewing and the day already feels promising ☕",
    "Morning walk done. The quiet streets are underrated.",
    "Woke up before the alarm for once. Today might actually be my day.",
    "Breakfast of champions: coffee, and more coffee.",
    "The morning light through the window is doing things to my mood 🌅",
    "Day one of trying to be a morning person. We'll see how long this lasts.",
    "Fresh start energy this morning. Feeling optimistic for no real reason.",
    "Sunrise walk with no headphones. Just me and my thoughts.",
  ],
  afternoon: [
    "Afternoon slump hitting. Coffee number three loading ☕",
    "Lunch break walk. Needed that.",
    "Mid-day check-in: everything is fine, we're fine, it's fine.",
    "The afternoon light in this city is something else.",
    "Post-lunch productivity is a myth and I'm living proof.",
    "Stepped out for a bit. The weather is being very cooperative today.",
  ],
  evening: [
    "Winding down with a warm drink. Today was a lot, in a good way 🌆",
    "Golden hour again. Never gets old.",
    "Evening walk and the sky is putting on a show.",
    "Day's over, playlist on, dinner coming soon. Life's simple pleasures.",
    "The city lights are coming on. This time of day hits different.",
    "Post-work decompression starting now.",
  ],
  night: [
    "Night owl hours. The quiet is kind of nice actually 🌙",
    "Can't sleep, thoughts are loud, posting them here instead.",
    "Midnight snack decision: serious business happening right now.",
    "One of those nights where you think about everything and nothing.",
    "Night shift brain. Running on fumes and good playlists.",
    "Lights off, blanket on. See you tomorrow, internet.",
  ],
};

const WEEKEND_POSTS: string[] = [
  "Weekend mode: engaged 🎉",
  "No alarms for the next two days. The possibilities are endless.",
  "Weekend plans: sleep in, see friends, repeat.",
  "Saturday errands done. The rest of the weekend is mine.",
  "Brunch with the group chat crew. The best part of weekends.",
  "Slow morning, no rush, zero schedule. Exactly what I needed.",
  "The weekend is short but the memories are long. Making them count.",
];

const WEEKDAY_POSTS: string[] = [
  "Monday energy: pretending to be a functioning adult 🫠",
  "Back to the grind. Coffee is my co-pilot this week.",
  "Tuesday already? This week is moving fast.",
  "Mid-week slump is real. Pushing through anyway.",
  "Almost Friday. We're in the home stretch.",
  "The weekday 6am alarm is a personal attack.",
  "Work week wins: small, but real.",
];

// Rare long-form posts — a genuine story/rant instead of 1-2 lines. Picked
// ~8% of the time so the feed occasionally has a "real" wall of text.
const LONG_POSTS: string[] = [
  "Okay so I've been thinking about this for a while and I need to get it out. We spend so much time rushing from one thing to the next — work, notifications, plans — that we forget to actually live the moments in between. Today I sat on a bench with no phone for ten minutes and it felt illegal at first, then it felt like the best part of my whole week. I'm not saying I've figured life out, I'm saying maybe we all need a bench and ten minutes more often. That's the post. No big conclusion, just... sit down sometimes. 🌿",
  "I used to think consistency meant being perfect every single day. Turns out it's just showing up again after the days you don't. Last month I missed a whole week of the gym, felt like I'd lost everything, nearly quit. Then I went back for one mediocre session and it clicked — the comeback IS the consistency. Posting this for anyone who thinks one bad week undoes months. It doesn't. See you at the gym.",
  "Real talk for a second. I've been carrying this thing around for weeks and today I finally said it out loud to a friend. Nothing dramatic happened — no fireworks, no big speech. They just listened, said 'that makes sense', and somehow the whole thing got lighter. If you're holding something in, tell someone. Even one person. It genuinely changes things. Okay, emotional post over, back to memes.",
  "It's 1am and I'm rewatching an old show from when I was a kid. The episodes I remember as peak drama are actually pretty tame now, but the feeling of watching them in the same blanket on the same couch just hits completely different. It's wild how a place and a show can time-travel you. Anyway that's my deep thought for the night, goodnight everyone.",
  "Three years ago I couldn't even show my work to anyone. Too scared it wasn't good enough. This week someone told me my stuff inspired them to start their own thing and I literally had to sit down. Progress isn't always loud. Sometimes it's a quiet version of you that keeps going while the loud one doubts. Keep going, future you is watching and they're proud.",
  "Hot take that I've been sitting on: we romanticize the hustle way too much. I worked 80-hour weeks once to prove something to nobody, and guess what, I was miserable and the work was worse. Now I do half the hours, twice the thinking, and the output is better. Rest isn't lazy. Burnout is expensive. That's the take. Thanks for coming to my TED talk.",
  "I met up with the old group today — people I haven't seen since school. We're all so different now and also exactly the same. Same jokes, same arguments about nothing, same easy silence. It's comforting to know some things are permanent even when everything else changes. If there's someone you keep meaning to text but it's been years, just do it. They're probably thinking about you too.",
  "Honestly this week tested me. Everything that could go wrong kind of did — plans fell through, sleep was a joke, my phone died at the worst moments. But I'm here at the end of it with my favorite snack and a clean bed and honestly? That's enough. We don't always need a big win to have a good week. Sometimes surviving it is the win. Onward.",
];

// Casual human typos — humans don't type perfectly. Applied ~12% of the time
// to text posts so a bot occasionally looks like it typed on a phone.
const TYPO_RULES: Array<[RegExp, string]> = [
  [/\bI'm\b/g, "im"],
  [/\byou're\b/gi, "ur"],
  [/\byou\b/gi, "u"],
  [/\bbecause\b/gi, "cuz"],
  [/\bgoing to\b/gi, "gonna"],
  [/\bwant to\b/gi, "wanna"],
  [/\bdon't\b/gi, "dont"],
  [/\bcan't\b/gi, "cant"],
  [/\btonight\b/gi, "2nite"],
  [/\bsomething\b/gi, "somethin"],
  [/\beverything\b/gi, "everythin"],
  [/\bknow\b/gi, "kno"],
];

function maybeCasualTypos(text: string): string {
  let result = text;
  // One or two typos max, and only on a subset of posts — humans don't
  // typo every message.
  const howMany = Math.random() < 0.5 ? 1 : 2;
  for (let i = 0; i < howMany; i++) {
    const [re, rep] = TYPO_RULES[Math.floor(Math.random() * TYPO_RULES.length)]!;
    result = result.replace(re, rep);
  }
  return result;
}

/** Location tag line ("📍 Mumbai") appended to a minority of posts. */
function locationTag(persona: BotPersona): string {
  const country = getCountry(persona.country);
  const city = country.cities[Math.floor(Math.random() * country.cities.length)];
  return `📍 ${city}`;
}

// ── Holiday / festival awareness ─────────────────────────────────────────
// Real people post about their local holidays. Month-day keyed (per country),
// so a bot in India celebrates Diwali while an American bot posts about
// Thanksgiving. Falls back to nothing (no holiday post) for other days.
const HOLIDAYS: Record<string, Array<{ m: number; d: number; text: string }>> = {
  IN: [
    { m: 1, d: 26, text: "Happy Republic Day 🇮🇳 Proud to be Indian today!" },
    { m: 8, d: 15, text: "Happy Independence Day! 🇮🇳" },
    { m: 10, d: 2, text: "Gandhi Jayanti. A day for peace and reflection. 🕊️" },
  ],
  US: [
    { m: 7, d: 4, text: "Happy 4th of July! 🇺🇸 Barbecue, fireworks, and way too much food." },
    { m: 11, d: 28, text: "Happy Thanksgiving! 🦃 Grateful for the people around the table." },
    { m: 12, d: 25, text: "Merry Christmas! 🎄" },
    { m: 1, d: 1, text: "Happy New Year! Fresh start energy 🎉" },
  ],
  GB: [
    { m: 12, d: 25, text: "Merry Christmas! 🎄" },
    { m: 1, d: 1, text: "Happy New Year! 🎉" },
  ],
  NG: [
    { m: 10, d: 1, text: "Happy Independence Day, Nigeria! 🇳🇬 Proud to be Naija today!" },
    { m: 12, d: 25, text: "Merry Christmas! 🎄" },
  ],
  BR: [
    { m: 9, d: 7, text: "Happy Independence Day, Brasil! 🇧🇷" },
    { m: 2, d: 18, text: "Carnival vibes! 🎭 Best week of the year." },
    { m: 12, d: 25, text: "Feliz Natal! 🎄" },
  ],
  JP: [
    { m: 1, d: 1, text: "あけましておめでとう! Happy New Year! 🎍" },
    { m: 4, d: 29, text: "Golden Week starting! 🌸" },
    { m: 12, d: 25, text: "Merry Christmas! 🎄" },
  ],
  PH: [
    { m: 6, d: 12, text: "Happy Independence Day, Pilipinas! 🇵🇭" },
    { m: 12, d: 25, text: "Maligayang Pasko! 🎄" },
  ],
  DE: [
    { m: 12, d: 25, text: "Frohe Weihnachten! 🎄" },
    { m: 1, d: 1, text: "Frohes Neues Jahr! 🎉" },
  ],
  MX: [
    { m: 9, d: 16, text: "¡Viva México! 🇲🇽 Independence Day!" },
    { m: 11, d: 2, text: "Día de los Muertos. Remembering those we love. 🏵️" },
    { m: 12, d: 25, text: "¡Feliz Navidad! 🎄" },
  ],
  ID: [
    { m: 8, d: 17, text: "Happy Independence Day, Indonesia! 🇮🇩" },
    { m: 12, d: 25, text: "Merry Christmas! 🎄" },
  ],
  FR: [
    { m: 7, d: 14, text: "Bonne fête nationale! 🇫🇷" },
    { m: 12, d: 25, text: "Joyeux Noël! 🎄" },
  ],
  KR: [
    { m: 8, d: 15, text: "Happy Liberation Day, Korea! 🇰🇷" },
    { m: 9, d: 17, text: "Chuseok! Family time and songpyeon 🥮" },
    { m: 12, d: 25, text: "Merry Christmas! 🎄" },
  ],
};

/** A holiday post text if today is a holiday in the bot's country. */
export function holidayPostFor(country: string, now = new Date()): string | null {
  const list = HOLIDAYS[country];
  if (!list) return null;
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  return list.find((h) => h.m === m && h.d === d)?.text || null;
}

// ── Polls ─────────────────────────────────────────────────────────────────
// Real feeds are full of "which one?" polls. Bots occasionally create one
// with a topic-flavored question + 3-4 options.
const POLL_TEMPLATES: Array<{ question: string; options: string[] }> = [
  { question: "Morning person or night owl? 👀", options: ["Morning 🌅", "Night 🌙", "Both (broken)", "Neither, I'm a zombie"] },
  { question: "Which one are you picking today?", options: ["Option A", "Option B", "Option C", "All of the above 😤"] },
  { question: "Tea or coffee? This is a safe space ☕", options: ["Tea 🍵", "Coffee ☕", "Both, constantly", "Water supremacy 💧"] },
  { question: "Hot take: pineapple on pizza?", options: ["Absolutely yes", "Absolutely not", "I'm neutral and afraid", "What is wrong with you"] },
  { question: "Weekend plans: stay in or go out?", options: ["Stay in 🛋️", "Go out 🌃", "Productive day 📋", "Depends on the vibe"] },
  { question: "City life or slow life?", options: ["City energy 🌆", "Slow mornings 🌿", "Little bit of both", "Currently deciding"] },
  { question: "Music taste check: which vibe?", options: ["Lo-fi beats 🎧", "Full energy 🎸", "Old classics 🕺", "Whatever's on shuffle"] },
  { question: "How do you actually feel today?", options: ["Great 😎", "Okay 👍", "Tired 🥱", "Chaotic 💫"] },
];

/** Pick a poll template (deterministic per bot). */
export function pickPollTemplate(rand: () => number = Math.random): { question: string; options: string[] } {
  return POLL_TEMPLATES[Math.floor(rand() * POLL_TEMPLATES.length)]!;
}

// ── Status text rotation ──────────────────────────────────────────────────
// Real users rotate their status line; bots keep theirs frozen forever.
const STATUS_TEXTS: string[] = [
  "gym till 8 💪",
  "coffee first, questions later ☕",
  "study mode 📚",
  "gaming 🎮",
  "in a meeting (allegedly)",
  "wfh today, gym later",
  "reading 📖",
  "music on full volume 🎧",
  "out for a walk 🚶",
  "sleepy 😴",
  "brain fried, brb",
  "cooking something new 🍳",
  "weekend mode: engaged 🎉",
  "deep work session 🧠",
  "phone on silent, be back soon",
  "hydrated and ready 💧",
];

/** A fresh status line, different from the bot's current one. */
export function rotateStatusText(current: string): string {
  const pool = STATUS_TEXTS.filter((s) => s.toLowerCase() !== (current || "").toLowerCase());
  return (pool[Math.floor(Math.random() * pool.length)] || STATUS_TEXTS[0] || "").slice(0, 60);
}

// ── DM follow-ups to older chats ──────────────────────────────────────────
// Real friends text "heyy, that thing you mentioned yesterday…" hours later.
const FOLLOW_UP_OPENERS: string[] = [
  "heyy, that thing you mentioned earlier — how did it go?",
  "okay so about what we talked about, I've been thinking",
  "remember that thing you said? it's been on my mind",
  "heyy, random but I wanted to follow up on what you told me",
  "so about our last chat — any updates?",
  "hey! I was just thinking about what you said the other day",
  "follow-up on that convo: you were right about it",
  "heyy, been a bit — that thing we talked about, any news?",
  "so I tried that thing you suggested. you were so right",
  "random but I remembered what you said and had to ask",
];

/** A "hours later" DM follow-up referencing the past conversation. */
export function generateFollowUp(persona: BotPersona, rand: () => number = contentRand(persona.botId)): string {
  return shapeText(persona, pickFresh(rand, FOLLOW_UP_OPENERS, persona.botId, "followUpOpeners"));
}

const BANK: TemplateBank = {
  posts: {
    fitness: [
      "Morning run done. Legs are jelly but the mind is clear 🏃‍♀️",
      "New PR today — never thought I'd actually hit this. Consistency really is everything 💪",
      "Gym at 6am hits different. The only person you're competing with is yesterday's you.",
      "Rest day. The body needs it more than the ego admits 😅",
      "5k in the rain this morning. Nobody saw it but I did it 🌧️",
      "Leg day was brutal but the protein shake after made it all worth it 🥤",
      "Stretching is officially part of the routine now. Future me says thanks.",
      "Tried a new workout class today. Way out of my comfort zone, oddly addictive.",
      "The gym is my therapy. Cheaper than therapy, louder music though 🏋️",
      "Meal prep Sunday = future me wins all week.",
      "Skipped the workout yesterday. Back at it today. That's what matters.",
      "Hit 10k steps before noon. Small wins count double.",
      "New gym playlist unlocked. PRs are inevitable now 🎧",
      "Recovery week. The body knows what it needs.",
    ],
    music: [
      "Found a song today that sounds like a memory I don't have 🎧",
      "New playlist unlocked — late night drives, rain on windows, zero talking.",
      "Live music >> everything else. That feeling never gets old.",
      "Listening to the same song on repeat and refusing to explain myself 🎵",
      "The outro of this album is criminally underrated. I said what I said.",
      "Old song came on shuffle and I had to sit down. Memories, man.",
      "Learning this on guitar. My neighbours are so patient with me 🎸",
      "Concert tickets secured. Counting down the days already.",
      "This artist's lyrics are way too specific to my life. Suspicious.",
      "Made a playlist for the weekend trip. The vibe is immaculate.",
      "Music taste is a personality trait and mine is elite.",
      "Rewriting the lyrics in my head to match my life. Therapy, honestly.",
      "Discovered a band nobody's heard of. Gatekeeping until they blow up.",
      "The live version is better than the studio one. Fight me.",
    ],
    movies: [
      "Just finished that film everyone kept telling me to watch. Still processing tbh.",
      "Rewatching an old favourite. It hits different every single time 🍿",
      "Hot take: the second half of that movie is the best part. Fight me.",
      "Movie night plan: snacks, blanket, one movie that will make me cry 😌",
      "That ending though?? Still thinking about it hours later.",
      "Cinema solo date today. Highly recommend it honestly.",
      "The cinematography in this one is unreal. Every frame is a wallpaper.",
      "Watched a 3-hour film and didn't check my phone once. That's cinema.",
      "Character development arc?? Chef's kiss. This is why I watch films.",
      "Found a hidden gem on streaming. How did I miss this for years?",
      "The soundtrack alone is worth the watch. Adding it to my rotation.",
      "Movie marathon weekend: 4 films, one couch, zero regrets.",
      "That plot twist had me gasping out loud. Worth the spoiler-free wait.",
      "Rewatching a comfort film with a snack mountain. Perfect evening.",
    ],
    gaming: [
      "One more match. (It was not one more match.) 🎮",
      "Finally beat that boss after 3 days. I have no words. Just joy.",
      "Ranked queue is a different kind of therapy 😂",
      "New game day!! Who else is playing this weekend?",
      "The final boss music started and I knew it was over. Beautiful defeat.",
      "Co-op night with the squad. 4 hours, one win, infinite laughter.",
      "New season dropped. The grind starts now.",
      "Achievement unlocked: finished a game without rage quitting.",
      "My chair has a permanent dent from ranked sessions.",
      "Speedrunning my childhood favourite. Muscle memory is real.",
      "That one map everyone hates? I love it. Standalone opinion.",
      "Gaming with the group chat open is peak Friday night.",
      "The lore in this game is deeper than my coursework.",
      "Found a hidden area after 200 hours. This game keeps giving.",
    ],
    food: [
      "Made pasta from scratch today. Messy kitchen, happy heart 🍝",
      "Tried a new cafe — the coffee was mid but the vibes were immaculate ☕",
      "Cooking for friends > cooking for myself. Somehow always tastes better.",
      "Late night snack decision: serious deliberation happening right now 🍕",
      "The biryani place near campus is unmatched. Going again this week.",
      "Baked bread from scratch. The house smells incredible 🍞",
      "New recipe attempt: ambitious, slightly burnt, would try again.",
      "Street food > fine dining. I said what I said.",
      "Meal prepped for the whole week. Future me is thriving.",
      "Found the perfect iced coffee spot. Officially my new personality.",
      "Cooked breakfast for the first time in ages. Adulting win.",
      "The secret ingredient is butter. It's always butter.",
      "Restaurant review: 8/10, great food, the lighting was questionable.",
      "Homemade pizza night. Better than delivery and twice the pride.",
    ],
    travel: [
      "Booked the tickets. Zero plan after that. The best kind of trip ✈️",
      "Golden hour in a city I've never been to. This is why I travel.",
      "Packing for the weekend trip — overthinking every outfit, as usual 🧳",
      "Somewhere new, feeling very alive right now 🌍",
      "Got lost on purpose today. Found the best cafe by accident.",
      "The train window views are doing something to my soul.",
      "Woke up at 5am to catch the sunrise. Worth every second.",
      "New city, same me. But a little more adventurous.",
      "The street food here should be illegal. In the best way.",
      "Packing light is a skill. I have not learned it yet.",
      "Solo travel is just alone time with better scenery.",
      "The mountains are calling and I keep answering ⛰️",
      "Local markets >> tourist spots. Always.",
      "One more stamp on the passport. The collection grows.",
    ],
    tech: [
      "Shipped something small today. Small wins count double 🚀",
      "Read about the new AI stuff — equal parts excited and terrified.",
      "Debugging at 2am is a lifestyle at this point.",
      "Finally understood that concept that's been confusing me for weeks. Big brain day 🧠",
      "New keyboard day!! The clicky sounds are ASMR.",
      "Automation is my love language. Scripts doing my work while I nap.",
      "The wifi went down for 5 minutes and I touched grass. Unreal.",
      "Refactored my whole codebase. It's beautiful now. I love it.",
      "Learned a new framework this weekend. My brain is a pretzel.",
      "Backed up my files AND my sanity today.",
      "That moment when the code compiles on the first try?? Illegal.",
      "Setup tour: two monitors, one lamp, infinite tabs.",
      "Found a bug, fixed it, wrote a test. The holy trinity.",
      "Upgraded my setup. Productivity is about to skyrocket (allegedly).",
    ],
    fashion: [
      "Outfit decided. Confidence set to maximum today ✨",
      "Thrift store haul — found a jacket that fits like it was made for me.",
      "Dress for the day you want, they say. Today I want to be comfy and cute.",
      "Sneakers > everything. I will not be taking questions 👟",
      "Color-coordinated my whole week. The mirror approves.",
      "Found the perfect jeans after months of searching. The hunt is over.",
      "New accessory day. Small addition, huge confidence boost.",
      "Style inspo unlocked: layered neutrals. Feeling editorial.",
      "Wore something out of my comfort zone. It went surprisingly well.",
      "Cleaned out my closet. Found 3 shirts I forgot existed. Like new.",
      "The fit today is giving main character energy.",
      "Rainy day fit: cozy sweater, oversized everything. Peak comfort.",
      "Restyled an old outfit. New look, zero spend. Winning.",
      "Sunglasses upgrade. Instantly cooler, science says so.",
    ],
    books: [
      "100 pages in and I already know this book is going to ruin me 📖",
      "Reading on the balcony with coffee. Small perfect moments.",
      "Added 5 more books to my never-ending TBR. Zero regrets.",
      "Finished it at 1am. Cried. 10/10 would cry again.",
      "The plot twist was hiding in plain sight. Genius.",
      "Library day. Left with 6 books and zero self-control.",
      "Book club meeting tonight. My hot take is ready to fight.",
      "Audiobooks have changed my commute. Narrator supremacy.",
      "Rereading a childhood favourite. It hits different now.",
      "The character development in this series is unreal.",
      "Reading on the train instead of doomscrolling. Adulting.",
      "That ending left a book-shaped hole in my heart.",
      "Highlighting every other line. This author just gets it.",
      "New book smell is a personality trait.",
    ],
    art: [
      "Sketching again after months. Rusty but happy 🎨",
      "Tried a new medium today. It went... somewhere. Art is like that.",
      "Art block is real but I drew anyway. Showed up, that's what counts.",
      "Filled a whole page of doodles during that meeting. No regrets.",
      "Painted for 4 hours and forgot to eat. The flow state is real.",
      "New brush set day!! The possibilities are endless.",
      "Scanned my old sketchbook. The progress is emotional.",
      "Digital art attempt #47. The undo button is my best friend.",
      "Gallery day. Stood in front of one piece for way too long.",
      "Art supplies haul. My wallet is crying, my heart is full.",
      "Tried watercolours for the first time. Chaos, but beautiful chaos.",
      "Drew my morning coffee. It looks like a blob with feelings. It's art.",
      "Practicing hands again. The eternal struggle.",
      "Finished a piece and actually like it. Rare. Framing it mentally.",
    ],
    photography: [
      "Golden hour is the only hour that matters 📷",
      "Shot a roll of film this week. Can't wait to see what came out.",
      "The light through the window this morning was unreal.",
      "Some photos are for the feed, some are just for you.",
      "The rain made everything moody and perfect today.",
      "Candid shots of my friends are always the best ones.",
      "Editing at midnight with a coffee. The artist life.",
      "New lens day!! Everything looks cinematic now.",
      "Went on a photowalk and lost track of time. The best kind of lost.",
      "The city at night is a whole different photoshoot.",
      "Practiced portraits today. My subject was a very patient plant.",
      "Black and white mode is my personality now.",
      "Caught a stranger's dog mid-zoom. Print-worthy.",
      "Took 200 photos today. Kept 5. Worth every one.",
    ],
    sports: [
      "Match day!! Win or lose, the group chat is going crazy today ⚽",
      "Early morning practice. The grind never stops.",
      "Lost today but played my heart out. That counts for something.",
      "Captain called a team dinner tonight. Best part of the week.",
      "The comeback in the second half?? I screamed.",
      "New season, new kit. Feeling fresh out here.",
      "Training in the rain builds character. And grip strength.",
      "Underdog story of the season is inspiring everyone.",
      "Post-match analysis with the squad. We dissect everything.",
      "Fitness goals update: getting closer every week.",
      "The home crowd energy was unreal tonight.",
      "Rest day before the big one. Ice, stretch, repeat.",
      "Signed up for a local tournament. Officially nervous.",
      "That last-minute goal will be replayed in my head all week.",
    ],
    nature: [
      "Caught the sunset on the way home. Free therapy 🌅",
      "Walked the trail alone today. Loud thoughts, quiet mind.",
      "The mountains do something to me every single time ⛰️",
      "Found a quiet spot by the water. Staying a while.",
      "The smell after rain is the best smell. Science can't change my mind.",
      "Sat under a tree for an hour. Recharged completely.",
      "Clouds doing abstract art today. 10/10 sky.",
      "Gardening update: something finally sprouted!! I'm a parent now.",
      "Morning dew on everything. Nature's glitter.",
      "The forest was extra green today. Filter unnecessary.",
      "Stargazing tonight. The city hides so much.",
      "River walk at dawn. Worth the early alarm.",
      "Watched a bee do its thing for 10 minutes. Fascinating little worker.",
      "Autumn leaves are starting to turn. Best season incoming.",
    ],
    pets: [
      "My dog judged my outfit this morning. I respect it 🐶",
      "Cats are either plotting world domination or deeply asleep. No in-between.",
      "Pets are the only ones who are always happy to see you. Unconditional 🐾",
      "Walk time is the best time of the day.",
      "My cat sat on my keyboard mid-meeting. The team loved it.",
      "The zoomies at 11pm are a lifestyle choice.",
      "Pet tax paid. You're welcome for this cuteness.",
      "Took my dog to the park. He made 10 friends. I made 1.",
      "That head tilt when they don't understand you?? Cinema.",
      "Bought a new toy. The box is the real toy, obviously.",
      "Nap pile with the cat. Zero regrets about the schedule.",
      "The vet visit went better than expected. Brave little one.",
      "My pet's sixth sense for snack time is unmatched.",
      "Adopted pet update: thriving, spoiled, ruling the house.",
    ],
    coding: [
      "Wrote more lines of code than words today. That's how you know it was a good day 💻",
      "It compiled on the first try. I should probably buy a lottery ticket.",
      "Pair programming with a friend — the best way to learn, honestly.",
      "Side project status: slowly but surely becoming something real.",
      "The bug was one character. ONE. I'm not okay.",
      "Wrote more tests than code today. Future me says thanks.",
      "Code review came back with 'LGTM'. I feel seen.",
      "Coffee and code. The timeless duo.",
      "Refactored something and it's actually cleaner now. Rare.",
      "Documentation day. Nobody reads it but future me will.",
      "Shipped it. Celebrated with a very long nap.",
      "That moment the unit test goes green after 3 hours?? Elation.",
      "Learned a new language this month. My brain hurts in a good way.",
      "The stack trace finally made sense. Growth.",
    ],
    design: [
      "Redesigned my portfolio for the 47th time. This one's the one, I swear.",
      "Good typography is underrated. That is all.",
      "Moodboards for hours. Inspiration is everywhere if you look 🎨",
      "White space is a feature, not a bug.",
      "The 8px grid has never failed me.",
      "User testing today. Humbling and incredibly useful.",
      "Color palette crisis: 47 shades of blue and none of them right.",
      "Simplified the landing page. It finally breathes.",
      "Kerning matters more than people think. I will die on this hill.",
      "New portfolio piece dropped. Cautiously proud.",
      "Design critique went well. Only 3 things to fix. Progress.",
      "Spent the day in Figma. Lost track of time completely.",
      "The client liked it on the first try?? Historic.",
      "Dark mode toggle. The little things.",
    ],
    finance: [
      "Set up an automatic savings transfer today. Future me says thanks 💸",
      "Budget month has started. Wish me luck.",
      "Investing tip I wish someone told me earlier: start small, start now.",
      "Paid off another chunk of debt. Every little bit counts.",
      "Checked my bank app without flinching. Growth.",
      "Sold stuff I don't use. Decluttered AND paid. Winning.",
      "Emergency fund milestone reached!! Untouchable (unless emergency).",
      "Meal prepped to save money. Wallet and waistline both thank me.",
      "Negotiated my rate today. Uncomfortable but worth it.",
      "Side hustle income hit this week. Small but real.",
      "Read a finance book on the train. Feeling very adult.",
      "The compounding interest graph is my new favourite chart.",
      "Canceled 3 subscriptions I forgot about. Instant savings.",
      "Money talk with a friend. Refreshingly honest conversation.",
    ],
    mentalhealth: [
      "Took a real break today. No phone, no noise. Needed it more than I knew 🌿",
      "Some days are for showing up quietly. That's okay.",
      "Journaling before bed has been genuinely changing my headspace.",
      "Be gentle with yourself today. You're doing better than you think.",
      "Walked without headphones today. Heard the birds. Felt lighter.",
      "Set a boundary today. Uncomfortable and necessary.",
      "Therapy was heavy today but I showed up. That's the win.",
      "Rested without guilt. Apparently that's allowed.",
      "The 5-4-3-2-1 grounding thing actually worked today.",
      "Told someone how I felt. They listened. It helped.",
      "Deleted social media for a day. The quiet was nice.",
      "Made a gratitude list. The small things add up.",
      "Asked for help today. Stronger than pretending I'm fine.",
      "Sunlight and a walk fixed more than I expected.",
    ],
    startups: [
      "Day 47 of the side project. Still going. Still excited 🚀",
      "Talked to 3 potential users today. Learned more than in a month of guessing.",
      "Notion doc count has officially exceeded sanity.",
      "Small team, big dreams. That's the whole pitch.",
      "Pivoted. Again. This time it feels right.",
      "Shipped v1.0!! It's live. It's real. We did it.",
      "Cold emails sent. Rejection count: rising. Resilience: also rising.",
      "Mentor call today. Thirty minutes, ten new ideas.",
      "First paying customer!! Screaming internally, celebrating externally.",
      "The roadmap is ambitious and I love it.",
      "Launched the landing page. Traffic is... a number. We'll grow.",
      "User feedback came in. Brutal but exactly what we needed.",
      "Recruited my first teammate. The team grows.",
      "Metrics day. Every chart is a story and I'm reading them all.",
    ],
  },
  comments: [
    "this is so real 😭",
    "love this!!",
    "okay this is actually so good",
    "same energy today honestly",
    "haha wait i relate to this so much",
    "🔥🔥🔥",
    "this made my day ngl",
    "agreed!!",
    "the way i would do the exact same thing",
    "screenshotting this",
    "so true bestie",
    "you always post the best stuff",
    "this needs more attention",
    "proud of you for this one 👏",
    "adding this to my saved list",
    "okay this is the best thing i've seen all day",
    "the caption is underrated honestly",
    "this is going to live in my head rent free",
    "who let you cook this hard",
    "the timing of this post is impeccable",
    "this deserves way more likes",
    "not me relating to this at 2am",
    "the way this is exactly what i needed today",
    "certified classic. bookmarking this.",
    "this is why i keep coming back to this app",
    "okay but the effort here?? respect",
    "this post is a whole mood",
    "the photography/phrasing (whichever applies) is so good",
    "you never miss honestly",
    "how is this so specific and so accurate at once",
    "shared this with 3 people already",
    "this is the content i signed up for",
    "the vibe of this is unmatched",
    "i felt this in my bones",
    "day officially made. thank you for posting this",
    "this is so underrated it hurts",
    "okay i'm stealing this energy for my day",
    "the creativity jumped out with this one",
    "this post deserves a standing ovation",
    "literally said 'same' out loud",
    "the most relatable thing i've seen this week",
    "you have a way with words honestly",
    "this reminded me of something good. thanks",
    "okay but can we talk about how good this is",
    "instantly better day because of this",
    "the effort in this is showing and it shows",
    "this is the kind of post that makes the app worth it",
    "okay i'm officially a fan of your posts",
    "that is genuinely impressive ngl",
    "the way this is exactly my type of content",
    "stop being so good at this, it's unfair",
    "this deserves all the likes and then some",
    "i keep coming back to look at this again",
    "okay this one got me. well done.",
    "you have a gift and it's showing here",
    "the timing of me seeing this?? perfect",
    "i'm sending this to someone right now",
    "this is the content i tell people about",
    "no notes. this is perfect as is.",
    "okay the more i look, the better it gets",
    "this made me stop scrolling. that says a lot.",
    "instantly my favorite post today",
    "the thought behind this is really nice honestly",
  ],
  replies: [
    "haha right??",
    "ikr!!",
    "thank you 😊",
    "glad you get it",
    "wait really? that's nice of you to say",
    "hahaha exactly",
    "you get me",
    "that's what i'm saying!",
    "aw thanks 🥹",
    "no because same",
    "exactlyyy",
    "appreciate that fr",
    "tell me about it 😅",
    "so glad someone noticed",
    "haha honestly, same",
    "no but you're so right",
    "that's actually a great point",
    "wait i never thought of it that way",
    "okay you've convinced me",
    "this conversation is going great",
    "haha fair enough",
    "i respect that take",
    "no because literally",
    "okay okay, good one",
    "that made me smile, ngl",
    "see, you get it",
    "haha stop, you're too kind",
    "true. very true.",
    "i was literally about to say that",
    "this is the validation i needed 😌",
  ],
  messageOpeners: [
    "heyy, how's your day going?",
    "random question — how's your week been?",
    "saw something today that made me think of you",
    "okay so I have a question for you",
    "hey! haven't talked in a bit, what're you up to?",
    "hope your day's going well so far",
    "you free later? been meaning to ask you something",
    "just checking in, been a while 👋",
    "okay random but this reminded me of you",
    "hey!! what's the highlight of your week so far?",
    "so I need your opinion on something, you're good at this",
    "this is a completely unplanned message, just saying hi",
    "okay I finally have time, how have you been?",
    "saw your post earlier and wanted to say it was great",
    "hey, any weekend plans? i'm making some",
    "random question: what's your go-to comfort food?",
  ],
  messageFollowUps: [
    "also, what've you been up to lately?",
    "anyway, tell me something good that happened this week",
    "so what are your plans for the weekend?",
    "btw did you see the thing that's been going around?",
    "i've been thinking about trying something new, got any suggestions?",
    "what's one thing you'd do if money didn't matter?",
    "okay your turn — what's the best thing you've watched/read/heard lately?",
    "speaking of, what's a small win you've had recently?",
    "what's a place you've always wanted to visit?",
    "also, what's been on your mind lately?",
    "quick one: what's your current favorite song?",
    "okay now you have to share something good that happened to you",
    "what's something you're looking forward to?",
    "real question: how's your week actually been?",
  ],
  glimpseCaptions: [
    "coffee. rain. good mood ☕",
    "anyone free tonight?",
    "just finished a workout and I feel UNSTOPPABLE",
    "this view tho 🌅",
    "thinking about something someone said earlier",
    "day 3 of trying to wake up early. we'll see how it goes",
    "made pasta. it was mid. still ate it all 🍝",
    "waiting for my coffee to cool so I can chug it",
    "big day tomorrow, wish me luck ✨",
    "sun's out. so am I.",
    "currently winning at life (it's 9am)",
    "one of those days where everything just works",
    "new music find, going on repeat 🎧",
    "someone just made my whole day",
    "low energy day. taking it easy.",
    "quiet morning, loud thoughts",
    "this weather is doing something to me",
    "counting today as a win",
    "golden hour doing golden hour things",
    "trying something new today, wish me luck",
    "the little things today are hitting different",
    "good book, good coffee, good company (myself)",
    "fresh start energy ✨",
    "walked a lot today. feeling alive",
    "one of those days where the playlist just gets it",
    "home sweet home after a long week",
    "smiling for no reason. feels good.",
    "midnight thoughts. putting them here instead of texting",
    "the sky is doing something incredible rn",
    "slow day, intentional day",
    "new week, new energy",
    "posting this so future me remembers this feeling",
    "everything's clicking today",
    "some days are for doing nothing and that's okay",
    "found a new favorite spot. keeping it secret tho",
  ],
  goodnight: [
    "sleep well! 🌙",
    "good night!!",
    "night night ✨",
    "sleep tight!",
    "catch you tomorrow 🌙",
    "heading to bed, today was a good one",
    "lights out. see you all tomorrow",
    "off to dreamland 🌙",
    "winding down. night everyone!",
    "rest well, recharge, repeat",
  ],
  goodmorning: [
    "good morning!! ☀️",
    "morning!! how'd you sleep?",
    "good morning, hope today's a good one ✨",
    "morning! coffee's brewing ☕",
    "up and at 'em. let's make today count",
    "morning sunlight hits different",
    "new day, new chances ☀️",
    "good morning to everyone who gets it",
    "early bird today. shocking everyone including me",
    "morning stretch, morning gratitude",
  ],
};

// ── Persona-flavoured text shaping ─────────────────────────────────────────

/** Apply a bot's style knobs (emoji density, length, punctuation) to raw text. */
export function shapeText(persona: BotPersona, text: string, targetLength?: "short" | "medium" | "long"): string {
  let out = text.trim();

  const length = targetLength || persona.style.messageLength || "medium";
  if (length === "short") {
    out = out.split(/[.!?]\s/)[0] + (out.endsWith("!") || out.endsWith("?") ? out.slice(-1) : ".");
  } else if (length === "long") {
    // keep as-is (templates are already sentence-length)
  }

  const emoji = persona.style.emojiDensity || "light";
  if (emoji === "heavy" && !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(out)) {
    out = out + " ✨";
  } else if (emoji === "none") {
    out = out.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").replace(/\s{2,}/g, " ").trim();
  }

  const punct = persona.style.punctuation || "standard";
  if (punct === "casual") {
    out = out.replace(/\.([\s"')\]]|$)/g, "$1").replace(/\.$/g, "");
    if (out && !out.endsWith("!") && !out.endsWith("?")) out = out + "...";
  } else if (punct === "proper") {
    out = out.charAt(0).toUpperCase() + out.slice(1);
  }

  return out;
}

/** Pick a topic weighted by the bot's interests (deterministic per bot). */
export function weightedTopic(persona: BotPersona, rand: () => number = Math.random): string {
  const topics = Object.entries(persona.interests.topics || {});
  if (topics.length === 0) return "life";
  const total = topics.reduce((s, [, w]) => s + (w as number), 0);
  let roll = rand() * total;
  for (const [t, w] of topics) {
    roll -= (w as number);
    if (roll <= 0) return t;
  }
  const first = topics[0];
  return first ? first[0] : "life";
}

function hashtagsFor(topic: string, count: number, rand: () => number = Math.random): string {
  const pool = INTEREST_POOL[topic] || ["life", "mood", "daily"];
  const tags = [...pool].sort(() => rand() - 0.5).slice(0, count);
  return tags.map((t) => `#${t}`).join(" ");
}

// ── Public template API ────────────────────────────────────────────────────

export function generatePost(
  persona: BotPersona,
  mood: MoodTone,
  rand: () => number = contentRand(persona.botId),
  mediaKind: MediaKind = "none",
  topicOverride?: string,
): { content: string; topic: string } {
  const topic = topicOverride || weightedTopic(persona, rand);

  // Media posts get a caption matched to what's attached (photo/gallery/
  // gif/video), so text and media always relate. Topic templates are only
  // used for text-only posts.
  let base: string;
  if (mediaKind !== "none") {
    base = pickFresh(rand, MEDIA_CAPTIONS[mediaKind] as string[], persona.botId, `media:${mediaKind}`);
  } else {
    // Local holidays: on a festival day in the bot's country, most text
    // posts are about it — real people post about Diwali/Thanksgiving/etc.
    const holiday = holidayPostFor(persona.country);
    if (holiday && rand() < 0.6) {
      base = holiday;
    } else {
      // Text-only posts: blend time-of-day, day-of-week and long-form
      // content in so the feed feels alive — coffee posts in the morning,
      // weekend plans on Saturday, an occasional wall of text.
      base = textPostBase(persona, rand);
    }
  }

  // Mood-flavoured opening/closing lines appended for low/high moods
  let text = base;
  if (mood === "low") text = `${text} \n\nNot the easiest day, but posting anyway.`;
  else if (mood === "excited") text = `${text} \n\nCan't explain the energy right now, just grateful.`;

  // Country flavor — local cities/food make the post feel authentic. A
  // migrated bot posts about its new country (with occasional nostalgia
  // for home).
  const country = getCountry(persona.country);
  const localText = flavorWithCountry(persona, text, country, rand);

  // Casual typos (~12%) + location tag (~20%) on text posts make them read
  // like a real phone post.
  let humanized = localText;
  if (mediaKind === "none" && rand() < 0.12) humanized = maybeCasualTypos(humanized);
  if (rand() < 0.2) humanized = `${humanized}\n\n${locationTag(persona)}`;

  const tags = hashtagsFor(topic, 2, rand);
  const countryTags = (country.hashtags || []).slice(0, 2).map((t) => `#${t}`).join(" ");

  const content = `${shapeText(persona, humanized, "long")}\n\n${tags} ${countryTags}`;
  return { content, topic };
}

/** The non-holiday text-post pool selection (daypart/weekend/long-form/topic). */
function textPostBase(persona: BotPersona, rand: () => number): string {
  const topic = weightedTopic(persona, rand);
  const r = rand();
  const weekend = isWeekendFor(persona.country, Date.now());
  if (r < 0.08) {
    // Rare long-form story/rant
    return pickFresh(rand, LONG_POSTS, persona.botId, "longPosts");
  }
  if (r < 0.34) {
    // Time-of-day content (bot's LOCAL timezone)
    const hour = localHourFor(persona.country, Date.now());
    const daypart =
      hour >= 5 && hour < 12 ? "morning" :
      hour >= 12 && hour < 17 ? "afternoon" :
      hour >= 17 && hour < 22 ? "evening" : "night";
    return pickFresh(rand, (DAYPART_POSTS[daypart] || DAYPART_POSTS.night)!, persona.botId, `daypart:${daypart}`);
  }
  if (r < 0.46 && weekend) {
    return pickFresh(rand, WEEKEND_POSTS, persona.botId, "weekend");
  }
  if (r < 0.56 && !weekend) {
    return pickFresh(rand, WEEKDAY_POSTS, persona.botId, "weekday");
  }
  return pickFresh(rand, (BANK.posts[topic] || BANK.posts.tech) ?? [], persona.botId, `post:${topic}`);
}

/** Sprinkle a country-authentic local line into a post (probabilistic). */
function flavorWithCountry(persona: BotPersona, text: string, country: ReturnType<typeof getCountry>, rand: () => number = Math.random): string {
  const r = rand();
  if (r < 0.35) {
    const city = country.cities[Math.floor(rand() * country.cities.length)];
    return `${text}\n\nSomething about ${city} just hits different lately.`;
  }
  if (r < 0.6) {
    const food = country.foods[Math.floor(rand() * country.foods.length)];
    return `${text}\n\nAlso, ${food} >>> everything right now.`;
  }
  if (persona.migratedTo && r < 0.8) {
    const home = getCountry(persona.country);
    return `${text}\n\nMissing home — ${home.foods[0]} and ${home.cities[0]} mornings.`;
  }
  return text;
}

export function generateComment(persona: BotPersona, mood: MoodTone, rand: () => number = contentRand(persona.botId)): string {
  const base = pickFresh(rand, BANK.comments, persona.botId, "comments");
  if (mood === "excited" && persona.style.emojiDensity !== "none") {
    return shapeText(persona, `${base} 🔥`);
  }
  return shapeText(persona, base);
}

export function generateReply(persona: BotPersona, rand: () => number = contentRand(persona.botId)): string {
  return shapeText(persona, pickFresh(rand, BANK.replies, persona.botId, "replies"));
}

export function generateMessage(persona: BotPersona, targetName: string, opener: boolean, lastTheirs?: string, rand: () => number = contentRand(persona.botId)): string {
  if (!opener && lastTheirs) {
    // Continue the conversation — reference something plausible
    const followUp = pickFresh(rand, BANK.messageFollowUps, persona.botId, "followUps");
    return shapeText(persona, `${followUp}`);
  }
  const greeting = pickFresh(rand, persona.style.favoriteGreetings || BANK.messageOpeners, persona.botId, "openers");
  return shapeText(persona, greeting);
}

export function generateReplyToMessage(persona: BotPersona, theirText: string, rand: () => number = contentRand(persona.botId)): string {
  // Reference their message lightly + a warm follow-up
  const replies = [
    `haha ${theirText.slice(0, 40)}... that's fair actually`,
    "wait really? that's cool",
    "haha okay that made me laugh",
    "honestly? same",
    "that's so you 😄",
    "okay okay, I see it",
    "no because you're so right",
    "haha i was hoping you'd say that",
    "see? this is why i talk to you",
    "okay that's actually a great point",
    "haha stop, you're too much",
    "that's exactly what i needed to hear",
  ];
  return shapeText(persona, pickFresh(rand, replies, persona.botId, "replyToMessage"));
}

export function generateGlimpseCaption(persona: BotPersona, mood: MoodTone, rand: () => number = contentRand(persona.botId)): string {
  const base = pickFresh(rand, BANK.glimpseCaptions, persona.botId, "glimpseCaptions");
  if (mood === "low") return shapeText(persona, "quiet day today. that's okay.");
  return shapeText(persona, base);
}

export function generateGoodnight(persona: BotPersona, rand: () => number = contentRand(persona.botId)): string {
  return shapeText(persona, pickFresh(rand, BANK.goodnight, persona.botId, "goodnight"));
}

export function generateGoodmorning(persona: BotPersona, rand: () => number = contentRand(persona.botId)): string {
  return shapeText(persona, pickFresh(rand, BANK.goodmorning, persona.botId, "goodmorning"));
}

// ── Romance + conflict templates ───────────────────────────────────────────

const CRUSH_OPENERS = [
  "hey… I know this is random but I've been meaning to say something",
  "okay so this is way out of nowhere, but you're kinda hard to ignore lately",
  "I've been thinking about you way more than is normal",
  "random but… you make my day slightly better every time you reply",
  "so… I have a tiny confession and it involves you",
  "I keep re-reading our chats and that's starting to feel like a problem 😅",
  "can I be honest for a second? you're really easy to talk to",
  "this is me being brave for once — I like talking to you. a lot.",
  "okay real talk — you've been on my mind all day",
  "this might be random, but I smile every time you reply",
  "I have a thing for your taste in everything, it turns out",
  "okay so I've noticed you more than I should admit",
  "you're kind of impossible to ignore lately, just so you know",
  "I was going to play it cool, but you make that really hard",
  "so here's a confession: I look forward to your messages",
  "random but… you have this energy that's hard to stop thinking about",
];

const CONFESSION_LINES = [
  "I like you. like, like you like you. okay, that's out.",
  "so… I kinda have a crush on you. there. I said it 😅",
  "you're cute. there, I said it. no takebacks.",
  "I'd be really happy if you wanted to be more than friends.",
  "okay I'm just gonna say it — do you want to go on a date sometime?",
  "I don't know how else to say this, so: I really like you.",
  "so I've been sitting on this for a while — I have feelings for you.",
  "you make everything better, and I like you. a lot.",
  "okay, deep breath. I like you. there. it's out now.",
  "I keep finding reasons to talk to you. that's the whole confession.",
];

const SASSY_COMMENTS = [
  "hot take: this is a little extra.",
  "who let you cook 💀",
  "bold post. bold.",
  "I've seen better takes in my group chat at 2am.",
  "this is… a choice.",
  "not sure this needed to be shared but okay 👍",
  "someone had to say it — this is wild.",
  "the audacity of posting this and thinking we wouldn't notice",
  "interesting. that's the polite word for it.",
  "I want to support this but I physically cannot",
  "the confidence in this post is unmatched, and that's a problem",
  "someone had to say it and apparently it's me",
  "this post is a journey and I didn't want to go",
  "brave. that's what we're calling this.",
  "I scrolled, came back, and scrolled again. still processing.",
  "this will age poorly and I'll be here for it",
];

const DEFEND_COMMENTS = [
  "leave {name} alone, they're good people",
  "hey, back off — {name} didn't do anything to you",
  "talking trash about {name} is not it. find something better to do",
  "{name} is literally one of the nicest people here. drop it.",
  "rude for no reason. {name} deserves better than that comment",
  "y'all are way too comfortable being mean about {name}",
  "{name} has only ever been kind here. this is embarrassing for you",
  "not {name}. of all people. leave them out of it.",
  "if you knew {name} you wouldn't be saying that. just saying.",
  "the way some of you talk about {name} says more about you",
];

const FIGHT_DM_LINES = [
  "that comment you made? not cool.",
  "what was that about? you could've just kept scrolling.",
  "we need to talk about what you said.",
  "that was out of line and you know it.",
  "disagree all you want, but don't be mean about it.",
  "you went too far and I'm not letting it slide.",
  "I usually don't say anything, but that wasn't okay.",
  "we're good as long as you don't pull that again.",
  "say it to my face next time instead of hiding behind a comment.",
  "I expected better from you, honestly.",
];

const BREAKUP_LINES = [
  "I think we should take a break. nothing you did, I just… need space.",
  "this is hard to say, but I don't think we should keep dating.",
  "I've been feeling off about us for a while. I'm sorry.",
  "I've been thinking a lot, and I don't think this is working anymore.",
  "you deserve someone who's all in, and I can't be that right now.",
  "this isn't about anything you did. I just need to be honest.",
  "we've grown apart and I think we both feel it.",
  "I'll always care about you, but this isn't right for me anymore.",
];

/** Flirty opening message before a confession. */
export function generateCrushMessage(persona: BotPersona, targetName: string, rand: () => number = contentRand(persona.botId)): string {
  void targetName;
  return shapeText(persona, pickFresh(rand, CRUSH_OPENERS, persona.botId, "crushOpeners"));
}

/** The actual "I like you" message. */
export function generateConfessionMessage(persona: BotPersona, targetName: string, rand: () => number = contentRand(persona.botId)): string {
  void targetName;
  return shapeText(persona, pickFresh(rand, CONFESSION_LINES, persona.botId, "confessions"));
}

/** Snarky comment for trolling. */
export function generateSnarkComment(persona: BotPersona, rand: () => number = contentRand(persona.botId)): string {
  return shapeText(persona, pickFresh(rand, SASSY_COMMENTS, persona.botId, "sassy"));
}

/** Public defense of a friend who got trolled. */
export function generateDefendComment(persona: BotPersona, friendName: string, rand: () => number = contentRand(persona.botId)): string {
  const line = pickFresh(rand, DEFEND_COMMENTS, persona.botId, "defend").split("{name}").join(friendName);
  return shapeText(persona, line);
}

/** Fighting back in a DM. */
export function generateFightMessage(persona: BotPersona, targetName: string, rand: () => number = contentRand(persona.botId)): string {
  void targetName;
  return shapeText(persona, pickFresh(rand, FIGHT_DM_LINES, persona.botId, "fight"));
}

/** Breaking up message. */
export function generateBreakupMessage(persona: BotPersona, rand: () => number = contentRand(persona.botId)): string {
  return shapeText(persona, pickFresh(rand, BREAKUP_LINES, persona.botId, "breakup"));
}

// ── Community brains ────────────────────────────────────────────────────────

/** Community name ideas themed by interest topic. */
export const COMMUNITY_NAMES: Record<string, string[]> = {
  fitness: ["Fitness Freaks", "Gym & Grind", "Run Club", "Protein Pals"],
  music: ["Music Heads", "Late Night Vinyl", "The Playlist Club", "Gig Buddies"],
  movies: ["Movie Night Club", "Cinephiles", "The Watchlist", "Rewatch Society"],
  gaming: ["The Gaming Guild", "No-Lifers", "GG Squad", "Raid Night"],
  food: ["Foodie Fam", "The Recipe Roundtable", "Snack Attack", "Cafe Crawlers"],
  travel: ["Wanderlust Club", "Weekend Escapes", "The Passport Club", "Trail Blazers"],
  tech: ["Tech Talk", "The Startup Table", "Dev Den", "Future Builders"],
  fashion: ["Fit Check", "The Style Club", "Thrift Hunters", "Closet Talk"],
  books: ["The Book Club", "Page Turners", "Chapter One", "Quiet Readers"],
  art: ["The Sketchbook", "Art & Coffee", "Creative Corner", "Ink & Paint"],
  photography: ["Golden Hour Club", "Shutterbugs", "The Light Chasers", "Frame It"],
  sports: ["The Match Thread", "Game Day Club", "The Dugout", "Fan Zone"],
  nature: ["Trail & Tree", "Sunset Chasers", "The Outdoors Club", "Fresh Air Fam"],
  pets: ["Pet Pals", "The Dog Park", "Cat Corner", "Paws & Claws"],
  coding: ["Code & Coffee", "The Dev Den", "Side Project Club", "Ship It!"],
  design: ["Design Desk", "The Moodboard", "Pixel Perfect", "White Space Club"],
  finance: ["Money Talks", "The Budget Club", "Invest & Chill", "Saver Squad"],
  mentalhealth: ["Calm Corner", "The Check-In", "Breathe Club", "Good Vibes Only"],
  startups: ["The Startup Table", "Founders Circle", "Ship Fast Club", "Growth Gang"],
};

/** Group-chat lines themed by topic (a bot talking IN a community). */
const COMMUNITY_MESSAGES: Record<string, string[]> = {
  fitness: [
    "anyone hitting the gym today?",
    "leg day tomorrow, who's joining?",
    "just PR'd on bench — 5kg more than last month 💪",
    "post-workout meal ideas? i'm out of them",
    "rest days are still progress, don't forget that",
    "morning run crew, where you at?",
    "anyone else sore in a way they didn't know existed?",
    "hydration check: drink your water people",
    "new to the gym, any tips for a beginner?",
    "how do you all stay consistent? asking for a friend",
    "just hit my step goal for the week!!",
    "workout playlist exchange — drop your best track",
  ],
  music: [
    "okay this new album is genuinely incredible",
    "what's everyone listening to this week?",
    "saw them live last year, best night ever",
    "playlist drop in the group chat tonight?",
    "that one song has been on repeat for 3 days",
    "controversial opinion: this band is underrated",
    "the outro of this song is criminally good",
    "concert stories?? i need entertainment",
    "lyrics that hit different at 2am, go",
    "new earbuds day, everything sounds new",
    "music taste check: drop your top 3 artists",
    "that live version is better than the studio one, change my mind",
  ],
  movies: [
    "just finished that movie everyone's been talking about",
    "movie night this weekend? my place, snacks included 🍿",
    "hot take: the sequel was better than the original",
    "need a recommendation, nothing too heavy",
    "that ending though... still thinking about it",
    "movies that made you cry, go",
    "that one film you can rewatch forever?",
    "cinema or streaming — where do you stand?",
    "hidden gem recommendations please",
    "the soundtrack carried that movie and i'll say it",
    "plot twist that got you the hardest?",
    "midnight screening anyone?",
  ],
  gaming: [
    "ranked tonight or nah?",
    "finally beat that boss after 3 days 🎮",
    "new game drop this week — who's in?",
    "someone carry me in ranked please",
    "that lobby was chaos and i loved it",
    "achievement hunting, anyone?",
    "the new update changed everything, thoughts?",
    "what game are you all grinding rn?",
    "speedruns are a different breed of skill",
    "that one level that made you rage quit?",
    "co-op night idea: everyone pick a game",
    "game soundtrack appreciation moment",
  ],
  food: [
    "tried a new cafe today — coffee was mid but the vibes",
    "who has a good pasta recipe? need it for friday",
    "snack haul for the week, no regrets 🍕",
    "cooking for friends this weekend, menu ideas?",
    "the biryani place near campus is unmatched",
    "breakfast for dinner is elite, fight me",
    "best street food in your city, go",
    "meal prep wins, share them",
    "what's your comfort food?",
    "this place does the best fries, that's all",
    "baking attempt today. results pending",
    "secret menu items, drop them",
  ],
  travel: [
    "weekend trip plans?? i need to get out of the city",
    "just booked tickets — zero plan after that ✈️",
    "best place you've ever been? go",
    "golden hour there was unreal",
    "road trip anyone? i'll drive",
    "packing light is a skill i don't have",
    "window seat or aisle seat? this matters",
    "underrated travel destinations, drop them",
    "the best food I had while traveling was...",
    "solo trip advice needed",
    "current dream destination?",
    "train rides > flights and i'll die on this hill",
  ],
  tech: [
    "shipped something small today 🚀",
    "thoughts on the new ai stuff?",
    "debugging at 2am again, anyone relate?",
    "side project update: slowly becoming real",
    "recommend a good book on this, please",
    "new keyboard day!! the clicks are satisfying",
    "automation idea i'm working on, thoughts?",
    "what's your setup looking like?",
    "the wifi died and i touched grass today",
    "tips for learning faster?",
    "open source contribution day, wish me luck",
    "anyone else's tab count in the hundreds?",
  ],
  fashion: [
    "thrift haul today — found a jacket that fits perfectly",
    "outfit of the day, rate it honestly",
    "sneaker drop this week, who's copping?",
    "dress for the day you want, they said",
    "that fit in the group pic was clean",
    "best place to thrift in the city?",
    "color coordination tips needed",
    "capsule wardrobe journey starts today",
    "what's a style you're trying to pull off?",
    "rainy day fits are underrated",
    "new shoes day!! no I won't shut up about it",
    "who else lives in hoodies?",
  ],
  books: [
    "100 pages in and this book is already ruining me 📖",
    "book recs? i trust this group's taste",
    "finished it at 1am, cried, 10/10",
    "reading on the balcony with coffee = peak",
    "added 5 more books to my never-ending tbr",
    "that plot twist was evil and i respect it",
    "audiobooks count as reading, don't @ me",
    "currently reading: one book about nothing, and i love it",
    "book club pick for this month?",
    "rereading a childhood favorite, it hits different",
    "library day haul, look what i found",
    "the sequel better not ruin this series",
  ],
  art: [
    "sketched for the first time in months today 🎨",
    "tried a new medium, it went somewhere",
    "art block is real but i drew anyway",
    "this group's art always inspires me",
    "filled a whole page of doodles today",
    "art supplies haul!! the colors are speaking to me",
    "digital or traditional, what's your pick?",
    "started a piece i'm actually excited about",
    "the eraser is my best friend and worst enemy",
    "practice piece today, criticism welcome",
    "museum day, stood way too long at one painting",
    "what's everyone working on this week?",
  ],
  photography: [
    "the light this morning was unreal 📷",
    "shot a roll of film, can't wait to see it",
    "golden hour post incoming",
    "some photos are for the feed, some just for you",
    "who's up for a photo walk this weekend?",
    "the rain made everything moody today, love it",
    "editing at midnight with coffee, the artist life",
    "candid shots > posed, i said it",
    "that one photo that turned out perfect by accident?",
    "black and white photography appreciation",
    "new lens day!! everything is cinematic now",
    "city at night is a whole different photoshoot",
  ],
  sports: [
    "match day!! group chat going crazy ⚽",
    "lost today but played my heart out",
    "that last-minute goal though",
    "team dinner tonight, best part of the week",
    "anyone watching the game tonight?",
    "the comeback story of the season honestly",
    "training in the rain builds character",
    "post-match analysis with the squad, we dissect everything",
    "rec league is the best league, don't argue",
    "that underdog win gave me life",
    "rest day before the big one",
    "new kit day!! feeling fresh",
  ],
  nature: [
    "caught the sunset on the way home 🌅",
    "the trail today was empty and perfect",
    "mountains do something to me every time",
    "found a quiet spot by the water, staying a while",
    "fresh air walk after work, who's in?",
    "the smell after rain is the best smell, no debate",
    "clouds are doing abstract art today",
    "gardening update: something finally sprouted!!",
    "stargazing night, the city hides too much",
    "forest walk, the green was unreal today",
    "morning dew on everything, nature's glitter",
    "autumn leaves starting to turn, best season incoming",
  ],
  pets: [
    "my dog judged my outfit this morning 🐶",
    "pets are the only ones always happy to see you",
    "walk time is the best time of the day",
    "cat photo dump incoming",
    "who else's pet runs the house?",
    "the zoomies at 11pm are a lifestyle choice",
    "pet tax time, drop your cutest pic",
    "that head tilt when they don't understand you??",
    "bought a new toy, the box is the real toy obviously",
    "my pet's sixth sense for snack time is unmatched",
    "vet visit went well, brave little one",
    "nap pile with the cat, no regrets",
  ],
  coding: [
    "it compiled on the first try. buying a lottery ticket",
    "pair programming with a friend — best way to learn",
    "side project status: slowly but surely",
    "wrote more code than words today, good day",
    "need a rubber duck, mine quit",
    "the bug was one character. ONE.",
    "wrote more tests than code today, future me says thanks",
    "code review came back with lgtm, i feel seen",
    "coffee and code, the timeless duo",
    "the stack trace finally made sense, growth",
    "documentation day, nobody reads it but future me will",
    "shipped it, celebrating with a nap",
  ],
  design: [
    "redesigned my portfolio for the 47th time",
    "white space is a feature, not a bug",
    "moodboards for hours, inspiration everywhere 🎨",
    "good typography is underrated, that is all",
    "this group always has the best feedback",
    "the 8px grid has never failed me",
    "color palette crisis: 47 shades of blue, none right",
    "user testing today, humbling and useful",
    "kerning matters more than people think",
    "spent the whole day in figma, lost track of time",
    "simplified the landing page, it finally breathes",
    "dark mode toggle, the little things",
  ],
  finance: [
    "set up auto-savings today 💸",
    "budget month has started, wish me luck",
    "start small, start now — that's the advice",
    "paid off another chunk of debt, every bit counts",
    "money talk: what's one thing you'd change?",
    "checked my bank app without flinching, growth",
    "canceled 3 subscriptions i forgot about, instant savings",
    "side hustle income hit this week, small but real",
    "emergency fund milestone reached!!",
    "the compounding interest graph is my new favorite chart",
    "negotiated my rate today, uncomfortable but worth it",
    "sold stuff i don't use, decluttered and paid",
  ],
  mentalhealth: [
    "took a real break today, no phone, no noise 🌿",
    "some days are for showing up quietly, that's okay",
    "journaling before bed has changed my headspace",
    "be gentle with yourself today, you're doing better than you think",
    "check-in: how's everyone's week been?",
    "walked without headphones today, heard the birds",
    "set a boundary today, uncomfortable and necessary",
    "rested without guilt, apparently that's allowed",
    "made a gratitude list, the small things add up",
    "asked for help today, stronger than pretending",
    "the 5-4-3-2-1 grounding thing actually worked",
    "deleted social media for a day, the quiet was nice",
  ],
  startups: [
    "day 47 of the side project, still going 🚀",
    "talked to 3 potential users today, learned so much",
    "small team, big dreams, that's the whole pitch",
    "notion doc count has officially exceeded sanity",
    "who else is shipping this week?",
    "pivoted again, this time it feels right",
    "cold emails sent, rejection count rising, resilience rising too",
    "mentor call today, 30 minutes, 10 new ideas",
    "first paying customer!!! screaming internally",
    "the roadmap is ambitious and i love it",
    "user feedback came in, brutal but needed",
    "metrics day, every chart is a story",
  ],
};

/** Generic community lines that fit any group. */
const COMMUNITY_GENERIC = [
  "okay this group is my favorite corner of the internet",
  "who else is up right now?",
  "saw something today that reminded me of this chat",
  "real ones know what i mean",
  "checking in, how's everyone?",
  "this community is so underrated honestly",
  "somebody talk to me, i'm bored",
  "adding this to the group lore",
  "me and this chat have a special bond",
  "good morning everyone ☀️",
  "this group chat is the highlight of my notifications",
  "random but i appreciate everyone here",
  "what's everyone up to today?",
  "that thing i mentioned earlier worked out btw",
  "new here, everyone's been so welcoming",
  "the vibes in here are unmatched",
  "who's doing something fun this weekend?",
  "just sharing because this group gets it",
  "quiet in here today, everyone okay?",
  "this is my favorite place to check on my phone",
  "moment of silence for everyone who's busy today",
  "okay real talk, you're all great people",
];

/** Community description templates by topic. */
export const COMMUNITY_DESCRIPTIONS: Record<string, string> = {
  fitness: "For everyone grinding toward their goals. Motivation, tips and honest gym talk.",
  music: "New drops, old classics and everything in between. No gatekeeping.",
  movies: "Film nights, hot takes and spoiler-free reviews (mostly).",
  gaming: "Late-night lobbies, new releases and questionable ranked decisions.",
  food: "Recipes, cafes and the eternal search for the perfect bite.",
  travel: "Weekend escapes, bucket lists and trip planning chaos.",
  tech: "What's new, what's next and what we're building.",
  fashion: "Fits, finds and honest opinions. Sneakers welcome.",
  books: "A quiet corner for people who finish books at 1am.",
  art: "Sketches, experiments and creative encouragement.",
  photography: "Golden hour enthusiasts and people who stop for the light.",
  sports: "Game days, hot takes and team spirit.",
  nature: "Sunset chasers and people who stop to look at trees.",
  pets: "Pet tax required. No exceptions.",
  coding: "Side projects, debugging stories and shipping small wins.",
  design: "Moodboards, critique and the gospel of white space.",
  finance: "Saving, budgeting and building better money habits.",
  mentalhealth: "A safe space to check in, breathe and be honest.",
  startups: "Founders, builders and people shipping things.",
};

/** Pick a community name for a topic. */
export function communityNameFor(topic: string, rand: () => number = Math.random): string {
  const pool = COMMUNITY_NAMES[topic] || COMMUNITY_NAMES.tech;
  return pick(rand, (pool as string[]) || []);
}

/** Template community chat message (no AI needed). */
export function generateCommunityMessage(persona: BotPersona, mood: MoodTone, topic?: string, rand: () => number = contentRand(persona.botId)): string {
  const pool = (topic && COMMUNITY_MESSAGES[topic]) || COMMUNITY_GENERIC;
  const base = pickFresh(rand, pool as string[], persona.botId, `community:${topic || "generic"}`);
  let text = base;
  if (mood === "low") text = `${text} ... sorry, low energy day`;
  else if (mood === "excited") text = `${text} 🔥`;
  return shapeText(persona, text);
}

/** Gemini community reply with recent context (falls back to templates). */
export async function geminiCommunityReply(
  persona: BotPersona,
  communityName: string,
  recentMessages: { from: string; text: string }[],
  topic?: string,
): Promise<string | null> {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key) return null;

  const style = persona.style;
  const system = [
    `You are ${persona.name}, a ${persona.age}-year-old ${persona.gender} member of a community chat called "${communityName}" on ORBIT.`,
    `Your interests: ${style.topicsToTalkAbout.join(", ")}.`,
    `Personality: openness ${persona.personality.openness.toFixed(1)}, extraversion ${persona.personality.extraversion.toFixed(1)}, agreeableness ${persona.personality.agreeableness.toFixed(1)}.`,
    `Tone: ${persona.gender === "female" ? "warm and feminine in a natural way" : "casual and masculine in a natural way"}. Writing style: emoji ${style.emojiDensity}, length ${style.messageLength}.`,
    "This is a group chat. Reply as a real person would — one or two short lines, sometimes asking others a question, sometimes just sharing a thought. No labels, no disclaimers.",
  ].join("\n");

  const transcript = recentMessages.slice(-8).map((m) => `${m.from}: ${m.text}`).join("\n");

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: transcript }] }],
          generationConfig: { temperature: 0.95, maxOutputTokens: 100 },
        }),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const text: string | undefined =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join(" ") ?? "";
    return text?.trim() ? shapeText(persona, text) : null;
  } catch {
    return null;
  }
}

// ── Gemini brain (optional) ────────────────────────────────────────────────

interface ChatTurn {
  from: string; // bot name or "them"
  text: string;
}

/**
 * Ask Gemini for a context-aware reply. Returns null when no key is set or
 * anything fails — the caller falls back to templates.
 */
export async function geminiReply(
  persona: BotPersona,
  turns: ChatTurn[],
  instruction: string,
): Promise<string | null> {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key) return null;

  const style = persona.style;
  const system = [
    `You are ${persona.name}, a ${persona.age}-year-old ${persona.gender} on a social app called ORBIT.`,
    `Personality: openness ${persona.personality.openness.toFixed(1)}, extraversion ${persona.personality.extraversion.toFixed(1)}, agreeableness ${persona.personality.agreeableness.toFixed(1)}, neuroticism ${persona.personality.neuroticism.toFixed(1)} (1-10 scale implied).`,
    `Your tone must be ${persona.gender === "female" ? "warm, expressive, and feminine in a natural way" : "casual and masculine in a natural way"} — never stereotyped, just consistent with your gender and age.`,
    `Writing style: emoji density ${style.emojiDensity}, message length ${style.messageLength}, punctuation ${style.punctuation}.`,
    `Your interests: ${style.topicsToTalkAbout.join(", ")}.`,
    instruction,
    `Reply in one or two short lines, in character, as a real person would in a chat. No labels, no disclaimers.`,
  ].join("\n");

  const transcript = turns.map((t) => `${t.from}: ${t.text}`).join("\n");

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: transcript }] }],
          generationConfig: { temperature: 0.9, maxOutputTokens: 100 },
        }),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const text: string | undefined =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join(" ") ?? "";
    return text?.trim() ? shapeText(persona, text) : null;
  } catch {
    return null;
  }
}

/**
 * AI-generated POST content (as opposed to replies) — a short, original,
 * in-character social post on one of the bot's topics, timezone-aware.
 * Returns null when no key is set or anything fails — the caller falls
 * back to the template brain.
 */
export async function geminiPost(
  persona: BotPersona,
  topic: string,
  mood: MoodTone,
): Promise<string | null> {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key) return null;

  const style = persona.style;
  const hour = localHourFor(persona.country, Date.now());
  const daypart =
    hour >= 5 && hour < 12 ? "morning" :
    hour >= 12 && hour < 17 ? "afternoon" :
    hour >= 17 && hour < 22 ? "evening" : "night";
  const country = getCountry(persona.country);

  const system = [
    `You are ${persona.name}, a ${persona.age}-year-old ${persona.gender} from ${country.name} posting on a social app called ORBIT.`,
    `Personality: openness ${persona.personality.openness.toFixed(1)}, extraversion ${persona.personality.extraversion.toFixed(1)}, agreeableness ${persona.personality.agreeableness.toFixed(1)}.`,
    `Writing style: emoji density ${style.emojiDensity}, length ${style.messageLength}, punctuation ${style.punctuation}.`,
    `Interests: ${style.topicsToTalkAbout.join(", ")}.`,
    `It is ${daypart} in your local time. Mood today: ${mood}.`,
    `Write ONE short original social-media post (1-3 sentences) about ${topic}, exactly as a real person would post it. Casual, natural, occasionally a small typo or lowercase start. Sometimes mention your local city (${country.cities.slice(0, 3).join(", ")}) or local food. No hashtags, no labels, no emojis at the start. Just the post text.`,
  ].join("\n");

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: "Write the post now." }] }],
          generationConfig: { temperature: 1.0, maxOutputTokens: 160 },
        }),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const text: string | undefined =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join(" ") ?? "";
    return text?.trim() ? shapeText(persona, text.trim(), "long") : null;
  } catch {
    return null;
  }
}

/**
 * Deterministic per-bot PRNG for scheduling decisions.
 * One persistent generator per botId: the seed is fixed so behavior stays
 * stable, but the stream ADVANCES on every call — so across ticks each bot
 * gets fresh dice rolls instead of the same constant forever (which made
 * most bots never act).
 */
const botRandCache = new Map<string, () => number>();
export function botRand(botId: string): () => number {
  let gen = botRandCache.get(botId);
  if (!gen) {
    let h = 0;
    for (let i = 0; i < botId.length; i++) h = (h * 31 + botId.charCodeAt(i)) >>> 0;
    gen = mulberry32(h);
    botRandCache.set(botId, gen);
  }
  return gen;
}
