/**
 * index.ts — the bot farm facade. What the admin panel talks to.
 *
 * - seedBots(count): generate gender-consistent personas, assign friend
 *   circles, create real accounts, and post starter content so the app
 *   looks alive immediately.
 * - startFarm / stopFarm / updateConfig: control the always-on scheduler.
 * - listBots / deleteBot: inspect and manage individual bots.
 */

import mongoose from "mongoose";
import { Bot, BotFarm } from "../../models/bot.model";
import { User } from "../../models/user.model";
import Post from "../../models/post.model";
import Comment from "../../models/comment.model";
import Like from "../../models/like.model";
import Follow from "../../models/follow.model";
import Glimpse from "../../models/glimpse.model";
import { Conversation } from "../../models/conversation.model";
import { Message } from "../../models/message.model";
import { Community } from "../../models/community.model";
import { CommunityMessage } from "../../models/communityMessage.model";
import { logger } from "../../utilities/logger";
import { mulberry32, pick, randInt } from "./identity";
import { buildPersona, fillIdentity } from "./personas";
import { assignCircles, CIRCLE_NAMES } from "./socialGraph";
import { startBotFarm, stopBotFarm, getFarmStatus } from "./scheduler";
import { ensureAccount, doPost, doFollow, doCreateCommunity } from "./actions";
import { markUserOffline } from "../../configs/socket";
import { COUNTRIES, getCountry, randomCountry } from "./countries";
import type { Gender } from "./identity";
import type { CountryProfile } from "./countries";

function uniqueUsername(gender: Gender, rand: () => number): string {
  const base = gender === "female"
    ? pick(rand, ["aisha", "priya", "sara", "lena", "mira", "zara", "nina", "ella", "riya", "kavya", "meera", "tara"])
    : pick(rand, ["arjun", "rahul", "dev", "karan", "leo", "max", "noah", "ryan", "vihaan", "aditya", "sam", "jake"]);
  const suffix = randInt(rand, 100, 9999);
  return `${base}${suffix}`;
}

/** Create `count` bot accounts with starter content. */
export async function seedBots(count: number): Promise<{ created: string[]; usernames: string[] }> {
  const created: string[] = [];
  const rand = mulberry32(Date.now() % 2147483647);
  const existingUsernames = new Set(
    (await Bot.find({}).select("username").lean()).map((b) => b.username),
  );

  const pending: { username: string; gender: Gender; country: CountryProfile; migratedTo?: CountryProfile }[] = [];
  for (let i = 0; i < count; i++) {
    const gender: Gender = rand() < 0.5 ? "female" : "male";

    let username = uniqueUsername(gender, rand);
    while (existingUsernames.has(username) || (await User.exists({ username }))) {
      username = uniqueUsername(gender, rand);
    }
    existingUsernames.add(username);

    // Weighted home country + occasional migration (posts go foreign)
    const country = randomCountry();
    const otherCountries = COUNTRIES.filter((c) => c.code !== country.code);
    const migratedTo =
      rand() < 0.15 && otherCountries.length
        ? getCountry(otherCountries[Math.floor(rand() * otherCountries.length)]!.code)
        : undefined;
    pending.push({ username, gender, country, migratedTo });
  }

  // Assign to friend circles (~5 per circle)
  const circleMap = assignCircles(pending.map((p) => p.username), CIRCLE_NAMES);

  const botDocs: any[] = [];
  for (const { username, gender, country, migratedTo } of pending) {
    const placement = circleMap.get(username)!;
    let persona = buildPersona({
      seed: randInt(rand, 1, 1_000_000),
      gender,
      botId: username,
      circleId: placement.circleId,
      circleName: placement.circleName,
      username,
      password: `OrbitBot!${Math.random().toString(36).slice(2, 10)}`,
      country,
    });
    persona = fillIdentity(persona, rand);
    // Keep the country-authentic, name-based username (e.g. meera30654) —
    // guarantee uniqueness against existing bots/users.
    let finalUsername = persona.username;
    while (
      existingUsernames.has(finalUsername) ||
      (await User.exists({ username: finalUsername }))
    ) {
      finalUsername = `${persona.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")}${randInt(rand, 1000, 99999)}`;
    }
    existingUsernames.add(finalUsername);
    persona.username = finalUsername;
    if (migratedTo) {
      persona.migratedTo = migratedTo.code;
      persona.countryEmoji = migratedTo.emoji;
      persona.statusText = `${migratedTo.emoji} living in ${migratedTo.name} now`;
    }

    const doc = new Bot({
      botId: `bot_${username}`,
      username: persona.username,
      password: persona.password,
      name: persona.name,
      gender: persona.gender,
      age: persona.age,
      bio: persona.bio,
      avatarUrl: persona.avatarUrl,
      statusText: persona.statusText,
      country: persona.country,
      countryName: persona.countryName,
      countryEmoji: persona.countryEmoji,
      migratedTo: persona.migratedTo || null,
      bannerUrl: persona.bannerUrl,
      personality: persona.personality,
      interests: { topics: persona.interests.topics },
      style: persona.style,
      routine: persona.routine,
      circleId: persona.circleId,
      circleName: persona.circleName,
      mood: (rand() - 0.5) * 0.6,
      energy: 1,
      lastActionAt: Date.now(),
      memory: [],
      stats: { posts: 0, comments: 0, likes: 0, messagesSent: 0, glances: 0, follows: 0 },
      relationships: [],
    });
    await doc.save();
    created.push(username);

    // Pre-seed circle bonds so friendships already exist between circle-mates
    const circleMates = botDocs.filter((d) => d.circleId === persona.circleId);
    for (const mate of circleMates) {
      doc.relationships = doc.relationships || [];
      mate.relationships = mate.relationships || [];
      const bond = 0.2 + rand() * 0.5;
      const isBotPair = true;
      doc.relationships.push({ a: doc.botId, b: mate.botId, isBotPair, bond, kind: bond > 0.45 ? "close_friend" : bond > 0.15 ? "friend" : "acquaintance", interactions: 1, lastInteractionAt: Date.now() });
      mate.relationships.push({ a: doc.botId, b: mate.botId, isBotPair, bond, kind: bond > 0.45 ? "close_friend" : bond > 0.15 ? "friend" : "acquaintance", interactions: 1, lastInteractionAt: Date.now() });
      await mate.save();
    }
    await doc.save();
    botDocs.push(doc);
  }

  // Starter content: each bot posts once, follows its circle-mates
  for (const doc of botDocs) {
    try {
      await ensureAccount(doc);
      await doPost(doc);
      for (const mate of botDocs) {
        if (mate.botId === doc.botId) continue;
        if (mate.circleId === doc.circleId && mate.userId && rand() < 0.8) {
          await doFollow(doc, mate.userId.toString());
        }
      }
    } catch (e: any) {
      logger.warn("bot seed starter content failed", { botId: doc.botId, error: e.message });
    }
  }

  // Community seeding: one bot per circle creates a themed community and
  // their connections (circle-mates with shared interests) join right away.
  const circles = new Map<string, any>();
  for (const doc of botDocs) {
    if (!circles.has(doc.circleId) && rand() < 0.5) circles.set(doc.circleId, doc);
  }
  for (const doc of circles.values()) {
    try {
      await doCreateCommunity(doc);
    } catch (e: any) {
      logger.warn("bot seed community failed", { botId: doc.botId, error: e.message });
    }
  }

  await BotFarm.updateOne(
    { _id: "farm" },
    { $set: { count: await Bot.countDocuments({}) }, $setOnInsert: { _id: "farm" } },
    { upsert: true },
  );

  return { created, usernames: created };
}

export async function startFarm(intensity?: number): Promise<any> {
  const config = await BotFarm.findByIdAndUpdate(
    "farm",
    {
      $set: {
        enabled: true,
        startedAt: Date.now(),
        ...(intensity ? { intensity: Math.max(1, Math.min(10, intensity)) } : {}),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  startBotFarm(config.tickMs || 45000);
  return getFarmStatus();
}

export async function stopFarm(): Promise<any> {
  await BotFarm.updateOne({ _id: "farm" }, { $set: { enabled: false, startedAt: null } }, { upsert: true });
  // Take every bot offline — the farm is done simulating, so green dots
  // and "active now" counts should clear immediately.
  try {
    const bots = await Bot.find({ userId: { $ne: null } }).select("userId").lean();
    await Promise.all(
      bots.map((b) => (b.userId ? markUserOffline(b.userId.toString()) : Promise.resolve())),
    );
  } catch (e: any) {
    logger.warn("stopFarm presence cleanup failed", { error: e.message });
  }
  return getFarmStatus();
}

export async function updateFarmConfig(patch: { intensity?: number; tickMs?: number }): Promise<any> {
  const set: Record<string, unknown> = {};
  if (typeof patch.intensity === "number") set.intensity = Math.max(1, Math.min(10, patch.intensity));
  if (typeof patch.tickMs === "number") set.tickMs = Math.max(15_000, Math.min(300_000, patch.tickMs));
  await BotFarm.updateOne({ _id: "farm" }, { $set: set }, { upsert: true });
  return getFarmStatus();
}

export async function listBots(page = 1, limit = 20): Promise<any> {
  const skip = (page - 1) * limit;
  const [bots, total] = await Promise.all([
    Bot.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Bot.countDocuments({}),
  ]);
  const pages = Math.max(1, Math.ceil(total / limit));
  return {
    success: true,
    bots: bots.map((b: any) => ({
      botId: b.botId,
      username: b.username,
      name: b.name,
      gender: b.gender,
      age: b.age,
      avatarUrl: b.avatarUrl,
      bio: b.bio,
      statusText: b.statusText,
      country: b.country,
      countryName: b.countryName,
      countryEmoji: b.countryEmoji,
      migratedTo: b.migratedTo || null,
      circleName: b.circleName,
      mood: b.mood,
      energy: b.energy,
      stats: b.stats,
      userId: b.userId?.toString() || null,
      createdAt: b.createdAt,
    })),
    total,
    pages,
  };
}

/** Delete a bot + its linked user + all its content. */
export async function deleteBot(botId: string): Promise<boolean> {
  const bot = await Bot.findOne({ botId });
  if (!bot) return false;

  const userId = bot.userId?.toString();

  if (userId && mongoose.Types.ObjectId.isValid(userId)) {
    // Clean up content
    const posts = await Post.find({ author: userId }).select("_id").lean();
    const postIds = posts.map((p) => p._id);
    if (postIds.length) {
      await Promise.all([
        Comment.deleteMany({ post: { $in: postIds } }),
        Like.deleteMany({ post: { $in: postIds } }),
        Post.deleteMany({ _id: { $in: postIds } }),
      ]);
    }
    await Comment.deleteMany({ author: userId });
    await Like.deleteMany({ author: userId });
    await Follow.deleteMany({ $or: [{ follower: userId }, { following: userId }] });
    await Glimpse.deleteMany({ author: userId });
    await Message.deleteMany({ $or: [{ sender: userId }, { recipient: userId }] });
    await Conversation.deleteMany({ participants: userId });
    // Simulated communities this bot created (and their messages) must go too,
    // otherwise deleting a bot leaves an orphaned community behind.
    const sims = await Community.find({ creator: userId, isSimulated: true })
      .select("_id")
      .lean();
    if (sims.length) {
      await CommunityMessage.deleteMany({ community: { $in: sims.map((s) => s._id) } });
      await Community.deleteMany({ _id: { $in: sims.map((s) => s._id) } });
    }
    await User.deleteOne({ _id: userId });
  }

  await Bot.deleteOne({ botId });
  await BotFarm.updateOne({ _id: "farm" }, { $set: { count: await Bot.countDocuments({}) } }, { upsert: true });
  return true;
}

export { getFarmStatus, startBotFarm, stopBotFarm };
