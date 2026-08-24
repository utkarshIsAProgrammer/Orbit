/**
 * personas.ts — builds a full BotPersona: Big-5 personality, weighted
 * interests, comms style, daily routine, and circle placement.
 *
 * Everything is derived from the personality traits so behaviour stays
 * internally consistent: an extroverted bot posts more, an agreeable bot
 * likes more, a neurotic bot has bigger mood swings.
 */

import {
  Gender,
  mulberry32,
  pick,
  randInt,
  usernameFromName,
  countryName,
  countryBio,
  countryStatus,
} from "./identity";
import { getCountry } from "./countries";
import type { CountryProfile } from "./countries";
import { buildBotAvatar, buildBotBanner } from "./avatars";
import type { BotPersona, Personality, Routine } from "./types";

// Interest pool: topic -> generic hashtags + post angles
export const INTEREST_POOL: Record<string, string[]> = {
  fitness: ["gymlife", "fitness", "workout", "health"],
  music: ["music", "playlist", "newmusic", "vinyl"],
  movies: ["movies", "film", "cinema", "netflix"],
  gaming: ["gaming", "games", "gamers", "playstation"],
  food: ["food", "foodie", "cooking", "recipes"],
  travel: ["travel", "wanderlust", "adventure", "explore"],
  tech: ["tech", "coding", "startup", "ai"],
  fashion: ["fashion", "style", "outfitoftheday", "streetwear"],
  books: ["books", "reading", "bookworm", "booktok"],
  art: ["art", "illustration", "sketching", "creative"],
  photography: ["photography", "shots", "camera", "goldenhour"],
  sports: ["sports", "cricket", "football", "fitness"],
  nature: ["nature", "outdoors", "sunset", "mountains"],
  pets: ["pets", "dogs", "cats", "animals"],
  coding: ["coding", "developers", "100daysofcode", "programming"],
  design: ["design", "uiux", "creativity", "designinspo"],
  finance: ["money", "finance", "investing", "budgeting"],
  mentalhealth: ["mentalhealth", "selfcare", "mindfulness", "growth"],
  startups: ["startup", "entrepreneur", "founder", "business"],
};

// Personality archetypes — pick one, then jitter so no two bots are identical
const ARCHETYPES: { name: string; personality: Personality }[] = [
  { name: "social-butterfly", personality: { openness: 0.8, extraversion: 0.9, agreeableness: 0.7, neuroticism: 0.3 } },
  { name: "the-thinker", personality: { openness: 0.9, extraversion: 0.3, agreeableness: 0.5, neuroticism: 0.5 } },
  { name: "the-steady", personality: { openness: 0.5, extraversion: 0.5, agreeableness: 0.8, neuroticism: 0.2 } },
  { name: "the-dreamer", personality: { openness: 0.85, extraversion: 0.6, agreeableness: 0.8, neuroticism: 0.4 } },
  { name: "the-achiever", personality: { openness: 0.6, extraversion: 0.7, agreeableness: 0.5, neuroticism: 0.6 } },
  { name: "the-quiet-one", personality: { openness: 0.6, extraversion: 0.2, agreeableness: 0.7, neuroticism: 0.5 } },
  { name: "the-life-of-party", personality: { openness: 0.7, extraversion: 1.0, agreeableness: 0.6, neuroticism: 0.3 } },
  { name: "the-cynic", personality: { openness: 0.5, extraversion: 0.4, agreeableness: 0.3, neuroticism: 0.7 } },
];

export interface BuildPersonaInput {
  seed: number;
  gender: Gender;
  botId: string;
  circleId: string;
  circleName: string;
  username?: string;
  password: string;
  country: CountryProfile;
}

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function buildPersona(input: BuildPersonaInput): BotPersona {
  const rand = mulberry32(input.seed);
  const archetype = pick(rand, ARCHETYPES);
  const jitter = () => clamp01(archetype.personality.openness + (rand() - 0.5) * 0.2);

  const personality: Personality = {
    openness: jitter(),
    extraversion: clamp01(archetype.personality.extraversion + (rand() - 0.5) * 0.2),
    agreeableness: clamp01(archetype.personality.agreeableness + (rand() - 0.5) * 0.2),
    neuroticism: clamp01(archetype.personality.neuroticism + (rand() - 0.5) * 0.2),
  };

  // Pick 3-5 weighted interests (extraverts/open people have more)
  const topicCount = 3 + Math.floor(personality.openness * 2.5);
  const shuffled = Object.keys(INTEREST_POOL).sort(() => rand() - 0.5);
  const topics: Record<string, number> = {};
  for (const topic of shuffled.slice(0, topicCount)) {
    topics[topic] = 0.3 + rand() * 0.7;
  }

  // Comms style derived from personality
  const emojiDensity = personality.extraversion > 0.7 ? "heavy" : personality.agreeableness > 0.6 ? "light" : rand() > 0.5 ? "light" : "none";
  const messageLength = personality.extraversion > 0.6 ? "long" : rand() > 0.5 ? "medium" : "short";
  const punctuation = personality.agreeableness > 0.75 ? "proper" : rand() > 0.5 ? "standard" : "casual";

  // Routine scaled by personality
  const wakeHour = randInt(rand, 6, 9);
  const sleepHour = randInt(rand, 22, 24);
  const routine: Routine = {
    wakeHour,
    sleepHour,
    postsPerDay: Math.round((1 + personality.extraversion * 2.5) * 10) / 10, // 1 - 3.5
    engagementsPerDay: Math.round((6 + personality.extraversion * 14) * 10) / 10, // 6 - 20
    peakHours: [randInt(rand, 17, 19), randInt(rand, 21, 23)],
  };

  const name = input.username ?? ""; // filled below via identity
  const country = input.country;

  const talkTopics = Object.keys(topics).slice(0, 3 + Math.floor(personality.extraversion * 2));
  // Blend the persona's generic interests with country-typical ones so posts
  // feel local (cricket in India, football in Brazil, ramen in Japan…)
  for (const topic of country.interests) {
    if (!topics[topic]) topics[topic] = 0.5 + rand() * 0.4;
  }

  const avatar = buildBotAvatar(input.gender, input.botId);

  return {
    botId: input.botId,
    username: name,
    password: input.password,
    name: name,
    gender: input.gender,
    age: randInt(rand, 18, 34),
    bio: countryBio(country, rand),
    avatarUrl: avatar.url,
    statusText: countryStatus(country, input.gender, rand),
    country: country.code,
    countryName: country.name,
    countryEmoji: country.emoji,
    bannerUrl: buildBotBanner(input.botId, country),
    personality,
    interests: { topics },
    style: {
      emojiDensity,
      messageLength,
      punctuation,
      topicsToTalkAbout: talkTopics,
      favoriteGreetings: genderGreetings(input.gender),
    },
    routine,
    circleId: input.circleId,
    circleName: input.circleName,
  };
}

/**
 * Country-aware identity fill: name + username + status come from the
 * bot's country (gender-matched). Called right after buildPersona.
 */
export function fillIdentity(persona: BotPersona, rand: () => number): BotPersona {
  const country = getCountry(persona.country);
  const name = countryName(country, persona.gender, rand);
  persona.name = name;
  persona.username = usernameFromName(name, rand);
  persona.statusText = countryStatus(country, persona.gender, rand);
  persona.countryEmoji = country.emoji;
  persona.countryName = country.name;
  // bannerUrl is deliberately NOT overwritten here — it was already set with
  // style variety (photo or art) by buildPersona.
  return persona;
}

function genderGreetings(gender: Gender): string[] {
  return gender === "female"
    ? ["heyy", "hi!!", "hey stranger", "hello hello", "omg hi", "heyyy", "hey you", "hiii"]
    : ["hey", "yo", "hi", "what's up", "hey man", "hello", "sup", "hey there"];
}
