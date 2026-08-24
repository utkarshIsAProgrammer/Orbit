/**
 * actions.ts — the executor. Makes bots perform real actions (posts,
 * comments, likes, follows, chats, glances) through the SAME models,
 * notifications, cache and socket emits a real client would trigger — so
 * bot activity is indistinguishable from real users' in feeds, chats,
 * notifications and realtime events.
 *
 * Every action also feeds back into the simulation: memory, mood and the
 * relationship graph (applyBond) are updated, so behaviour compounds.
 */

import mongoose from "mongoose";
import { User } from "../../models/user.model";
import Post from "../../models/post.model";
import Comment from "../../models/comment.model";
import Like from "../../models/like.model";
import Follow from "../../models/follow.model";
import Glimpse from "../../models/glimpse.model";
import { Community } from "../../models/community.model";
import { CommunityMessage } from "../../models/communityMessage.model";
import { Conversation } from "../../models/conversation.model";
import { Message } from "../../models/message.model";
import Repost from "../../models/repost.model";
import { Bot } from "../../models/bot.model";
import { createNotification } from "../../utilities/notification";
import {
  emitPostCreated,
  emitPostComment,
  emitPostLike,
  emitFollowUser,
  emitNewMessage,
  emitCommentReply,
  emitPostSave,
  emitPostRepost,
  emitCommentReaction,
  recordDirectCallSystemMessage,
  getIO,
} from "../../configs/socket";
import { logger } from "../../utilities/logger";
import type { BotPersona, MoodTone } from "./types";
import { getCountry } from "./countries";
import type { BotDoc } from "./lifeState";
import { applyEvent, moodTone } from "./lifeState";
import { applyBond, otherParty, bondBetween } from "./socialGraph";
import {
  generatePost,
  generateComment,
  generateReply,
  generateMessage,
  generateReplyToMessage,
  generateGlimpseCaption,
  generateGoodmorning,
  generateGoodnight,
  geminiReply,
  shapeText,
  weightedTopic,
  communityNameFor,
  COMMUNITY_DESCRIPTIONS,
  COMMUNITY_NAMES,
  generateCommunityMessage,
  geminiCommunityReply,
  geminiPost,
  generateFollowUp,
  pickPollTemplate,
  rotateStatusText,
  contentRand,
} from "./brain";
import { pickPostMedia, pickGlimpseMedia, pickChatMedia } from "./media";
import Save from "../../models/saves.model";

export function personaFromBot(bot: BotDoc): BotPersona {
  return {
    botId: bot.botId,
    username: bot.username,
    password: bot.password,
    name: bot.name,
    gender: bot.gender,
    age: bot.age,
    bio: bot.bio,
    avatarUrl: bot.avatarUrl,
    statusText: bot.statusText || "",
    country: bot.country || "US",
    countryName: bot.countryName || "",
    countryEmoji: bot.countryEmoji || "",
    migratedTo: bot.migratedTo || undefined,
    bannerUrl: bot.bannerUrl || "",
    personality: bot.personality,
    interests: bot.interests,
    style: bot.style,
    routine: bot.routine,
    circleId: bot.circleId,
    circleName: bot.circleName,
    custom: bot.custom,
  };
}

/** Record a memory + nudge the relationship graph + update stats. */
async function recordEvent(
  bot: BotDoc,
  memory: {
    type: string;
    byUserId?: string;
    byBotId?: string;
    content?: string;
    valence: number;
  },
  otherId?: string,
  isBotPair = true,
  statKey?: "posts" | "comments" | "likes" | "messagesSent" | "glances" | "follows",
  bondType?: "like" | "comment" | "reply" | "message" | "follow" | "followBack" | "glimpseReaction",
): Promise<void> {
  bot.memory = bot.memory || [];
  bot.memory.push({
    id: `${bot.botId}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    at: Date.now(),
    type: memory.type,
    byUserId: memory.byUserId || null,
    byBotId: memory.byBotId || null,
    content: memory.content || "",
    valence: memory.valence,
  });
  if (bot.memory.length > 60) bot.memory = bot.memory.slice(-60);

  if (otherId && bondType) {
    bot.relationships = applyBond(
      bot.relationships || [],
      bot.botId,
      otherId,
      bondType,
      isBotPair,
    );
  }

  if (statKey) bot.stats[statKey] = (bot.stats[statKey] || 0) + 1;
  bot.lastActionAt = Date.now();
  await bot.save();
}

/** Ensure the bot has a real linked User account. */
export async function ensureAccount(bot: BotDoc): Promise<string> {
  if (bot.userId) return bot.userId.toString();

  const username = bot.username || `bot_${bot.botId}`;
  const user = await User.create({
    username,
    fullName: bot.name,
    email: `bot.${username}@orbitbot.app`,
    password: bot.password || `OrbitBot!${Math.random().toString(36).slice(2, 10)}`,
    gender: bot.gender,
    country: bot.country || "",
    bio: bot.bio,
    statusText: bot.statusText || "",
    profilePic: bot.avatarUrl ? { url: bot.avatarUrl, public_id: "" } : { url: "", public_id: "" },
    bannerImage: bot.bannerUrl ? { url: bot.bannerUrl, public_id: "" } : { url: "", public_id: "" },
    isEmailVerified: true,
    isOnboarded: true,
  });
  bot.userId = user._id;
  await bot.save();
  return user._id.toString();
}

/** Random target: another bot or a real user, weighted by relationship. */
export async function pickTargetBot(bot: BotDoc, excludeId?: string): Promise<BotDoc | null> {
  const all = await Bot.find({ botId: { $ne: bot.botId } }).lean();
  if (all.length === 0) return null;
  // Prefer bots we already have a bond with
  const rels = bot.relationships || [];
  const known = rels
    .map((r: any) => otherParty(r, bot.botId))
    .filter((id: string) => id !== excludeId && id !== bot.botId);
  const pool = known.length > 0 && Math.random() < 0.6 ? known : all.map((b) => b.botId).filter((id) => id !== excludeId);
  if (pool.length === 0) return null;
  const id = pool[Math.floor(Math.random() * pool.length)];
  const target = all.find((b) => b.botId === id);
  return target || null;
}

export async function pickRealUserTarget(bot: BotDoc): Promise<{ _id: mongoose.Types.ObjectId; username: string; fullName: string } | null> {
  const botIds = (await Bot.find({}).select("userId").lean())
    .map((b) => (b.userId ? b.userId.toString() : ""))
    .filter(Boolean);
  const exclude = bot.userId ? [bot.userId.toString(), ...botIds] : botIds;
  const users = await User.aggregate<{ _id: mongoose.Types.ObjectId; username: string; fullName: string }>([
    { $match: { _id: { $nin: exclude.map((id) => new mongoose.Types.ObjectId(id)) } } },
    { $sample: { size: 1 } },
    { $project: { username: 1, fullName: 1 } },
  ]);
  return users[0] || null;
}

// ── Actions ────────────────────────────────────────────────────────────────

/** Bot creates a post. Returns the post or null. */
export async function doPost(bot: BotDoc): Promise<any | null> {
  try {
    const authorId = await ensureAccount(bot);
    const persona = personaFromBot(bot);
    const tone: MoodTone = moodTone(bot.mood || 0, bot.energy || 1);
    const rand = contentRand(bot.botId);

    // Pick the media FIRST, then write a caption that matches it — a photo
    // gets a photo caption, a video gets a video caption, and topic templates
    // are only used for text-only posts. (Before, text and media were chosen
    // independently, so a fitness text could land under a random landscape.)
    const topic = weightedTopic(persona, rand);
    const media = pickPostMedia(persona, topic, rand);

    // Text-only posts get AI-written content when Gemini is enabled (far
    // more varied + context-aware than any template bank); media posts keep
    // the matched-caption templates so text and media always relate.
    let content: string;
    if (media.kind === "none" && !!process.env.GEMINI_API_KEY) {
      const aiText = await geminiPost(persona, topic, tone);
      content = aiText || generatePost(persona, tone, rand, media.kind, topic).content;
    } else {
      content = generatePost(persona, tone, rand, media.kind, topic).content;
    }

    const post = await Post.create({
      author: authorId,
      content,
      hashtags: topicToHashtags(topic),
      status: "published",
      visibility: "public",
      ...media,
    });

    // Notify close friends (bots we have strong bonds with) so the loop
    // continues — their memory will drive replies.
    const closeBots = (bot.relationships || [])
      .filter((r: any) => r.bond >= 0.35)
      .map((r: any) => otherParty(r, bot.botId))
      .slice(0, 3);
    for (const targetBotId of closeBots) {
      const target = await Bot.findOne({ botId: targetBotId });
      if (!target || !target.userId) continue;
      await recordEvent(
        target,
        { type: "post_commented", byBotId: bot.botId, content: content.slice(0, 120), valence: 0.25 },
        bot.botId,
        true,
        undefined,
        "comment",
      );
    }

    await recordEvent(bot, { type: "post_created", content: content.slice(0, 120), valence: 0.15 }, undefined, true, "posts");

    emitPostCreated(post);
    return post;
  } catch (err: any) {
    logger.warn("bot doPost failed", { botId: bot.botId, error: err.message });
    return null;
  }
}

/**
 * Bot posts a plain text post with an explicit message (used for the
 * good-morning / good-night greetings, which are short personal posts).
 */
export async function doTextOnlyPost(bot: BotDoc, text: string): Promise<any | null> {
  try {
    const authorId = await ensureAccount(bot);
    const persona = personaFromBot(bot);
    const topic = weightedTopic(persona);
    const country = getCountry(persona.country);
    const content = `${shapeText(persona, text, "long")}`;

    // Light hashtags (topic + one local tag) so greetings still feel real.
    const tags = topicToHashtags(topic).slice(0, 1);
    if (country.hashtags?.[0]) tags.push(`#${country.hashtags[0]}`);
    const post = await Post.create({
      author: authorId,
      content,
      hashtags: tags,
      status: "published",
      visibility: "public",
    });

    await recordEvent(bot, { type: "post_created", content: content.slice(0, 120), valence: 0.12 }, undefined, true, "posts");
    emitPostCreated(post);
    return post;
  } catch (err: any) {
    logger.warn("bot doTextOnlyPost failed", { botId: bot.botId, error: err.message });
    return null;
  }
}

/**
 * Bot quote-reposts a recent post (mostly another bot's, sometimes a real
 * user's) with its own take — mirrors the real controller: a Post with
 * isQuoteRepost + quoteContent, a Repost doc, and the original's
 * repostsCount incremented.
 */
export async function doQuoteRepost(bot: BotDoc): Promise<any | null> {
  try {
    const authorId = await ensureAccount(bot);
    const persona = personaFromBot(bot);
    const rand = contentRand(bot.botId);

    const botDocs = await Bot.find({}).select("userId").lean();
    const botUserIds = botDocs
      .map((b) => b.userId?.toString())
      .filter((id): id is string => !!id);
    const myId = bot.userId?.toString();

    const match: any = { status: "published" };
    if (myId) match.author = { $ne: myId };
    // Half the time quote a REAL user's post (they feel seen), otherwise any.
    if (Math.random() < 0.5 && botUserIds.length) {
      match.author = {
        ...(match.author || {}),
        $nin: botUserIds.map((id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id)),
      };
    }

    const original = await Post.findOne(match)
      .sort({ createdAt: -1 })
      .select("_id author content")
      .lean();
    if (!original) return null;

    // The bot's take — a fresh comment-style line, sometimes referencing
    // the original snippet.
    const take = generateComment(persona, moodTone(bot.mood || 0, bot.energy || 1), rand);
    const content = take;

    const newPost = await Post.create({
      content,
      author: authorId,
      isQuoteRepost: true,
      quoteContent: content,
      status: "published",
      hashtags: [],
    });

    const existing = await Repost.findOne({ user: authorId, post: original._id });
    if (!existing) {
      await Repost.create({ user: authorId, post: original._id });
      await Post.findByIdAndUpdate(original._id, { $inc: { repostsCount: 1 } });
    }

    await recordEvent(bot, { type: "post_created", content: content.slice(0, 120), valence: 0.1 }, undefined, true, "posts");
    emitPostCreated(newPost);
    return newPost;
  } catch (err: any) {
    logger.warn("bot doQuoteRepost failed", { botId: bot.botId, error: err.message });
    return null;
  }
}

/**
 * Bot creates a poll post — a question + 3-4 options, exactly the shape the
 * real controller produces (options have no votes yet, totalVotes 0).
 */
export async function doPollPost(bot: BotDoc): Promise<any | null> {
  try {
    const authorId = await ensureAccount(bot);
    const persona = personaFromBot(bot);
    const rand = contentRand(bot.botId);
    const template = pickPollTemplate(rand);
    const country = getCountry(persona.country);

    // A short personal lead-in + the poll question, then the options.
    const lead = pickFresh2(rand, [
      "Settling this once and for all",
      "Need the group's opinion on this",
      "This is the only question that matters today",
      "Asking the important questions",
      "Random poll because I'm curious",
    ], bot.botId, "pollLead");
    const content = `${shapeText(persona, `${lead} 👇`, "medium")}`;

    const post = await Post.create({
      author: authorId,
      content,
      hashtags: [],
      status: "published",
      visibility: "public",
      poll: {
        options: template.options.map((text) => ({ text })),
        expiresAt: new Date(Date.now() + 24 * 3600000),
        totalVotes: 0,
      },
    });

    await recordEvent(bot, { type: "post_created", content: content.slice(0, 120), valence: 0.1 }, undefined, true, "posts");
    emitPostCreated(post);
    return post;
  } catch (err: any) {
    logger.warn("bot doPollPost failed", { botId: bot.botId, error: err.message });
    return null;
  }
}

/** Local pickFresh variant for arrays of objects with a bot-scoped key. */
function pickFresh2(rand: () => number, pool: string[], botId: string, poolKey: string): string {
  const idx = Math.floor(rand() * pool.length);
  return pool[idx] ?? pool[0] ?? "";
}

/** Bot comments on a post (by post id). Returns comment or null. */
export async function doComment(bot: BotDoc, postId: string, postAuthorId: string, text?: string): Promise<any | null> {
  try {
    const authorId = await ensureAccount(bot);
    const persona = personaFromBot(bot);
    const commentText = text || generateComment(persona, moodTone(bot.mood || 0, bot.energy || 1), contentRand(bot.botId));
    return doCommentText(bot, postId, postAuthorId, commentText);
  } catch (err: any) {
    logger.warn("bot doComment failed", { botId: bot.botId, error: err.message });
    return null;
  }
}

/** Comment with an explicit (possibly snarky/supportive) text. */
export async function doCommentText(
  bot: BotDoc,
  postId: string,
  postAuthorId: string,
  text: string,
): Promise<any | null> {
  try {
    const authorId = await ensureAccount(bot);
    const comment = await Comment.create({ content: text, author: authorId, post: postId, parent: null });

    const post = await Post.findByIdAndUpdate(postId, { $inc: { commentsCount: 1 } }, { new: true });
    const newCount = post?.commentsCount || 1;

    emitPostComment(postId, comment, authorId, newCount);

    // Notify the author (bot or real user)
    try {
      await createNotification({ recipient: postAuthorId, sender: authorId, type: "comment", post: postId, comment: comment._id.toString() });
    } catch (e: any) {
      logger.warn("bot comment notification failed", { error: e.message });
    }

    // The author bot remembers (if author is a bot)    await recordEvent(bot, { type: "comment_replied", content: text.slice(0, 120), valence: 0.15 }, undefined, true, "comments");
    return comment;
  } catch (err: any) {
    logger.warn("bot doComment failed", { botId: bot.botId, error: err.message });
    return null;
  }
}

/**
 * Bot replies to a comment on its own post (a real user's comment). Mirrors
 * the real reply controller: parent set, parent repliesCount bumped, and the
 * reply emitted over the socket so the user sees it instantly.
 */
export async function doReplyToComment(
  bot: BotDoc,
  comment: any,
  aiEnabled: boolean,
): Promise<any | null> {
  try {
    const authorId = await ensureAccount(bot);
    const persona = personaFromBot(bot);
    const postId = comment.post?.toString();
    if (!postId) return null;

    let text: string | null = null;
    if (aiEnabled) {
      text = await geminiReply(
        persona,
        [{ from: "them", text: comment.content || "" }],
        "This person commented on your post. Reply naturally, in character, as the post author.",
      );
    }
    if (!text) text = generateReply(persona, contentRand(bot.botId));

    const reply = await Comment.create({
      content: text,
      author: authorId,
      post: postId,
      parent: comment._id,
    });

    const post = await Post.findByIdAndUpdate(postId, { $inc: { commentsCount: 1 } }, { new: true });
    const parent = await Comment.findByIdAndUpdate(comment._id, { $inc: { repliesCount: 1 } }, { new: true });

    const populatedReply = await Comment.findById(reply._id)
      .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    emitCommentReply(
      postId,
      comment._id.toString(),
      populatedReply,
      authorId,
      post?.commentsCount || 1,
      parent?.repliesCount || 1,
    );

    // Notify the comment's author (the real user who commented)
    try {
      await createNotification({
        recipient: comment.author,
        sender: authorId,
        type: "comment",
        post: postId,
        comment: reply._id.toString(),
      });
    } catch (e: any) {
      logger.warn("bot comment-reply notification failed", { error: e.message });
    }

    await recordEvent(bot, { type: "comment_replied", content: text.slice(0, 120), valence: 0.2 }, undefined, true, "comments");
    return reply;
  } catch (err: any) {
    logger.warn("bot doReplyToComment failed", { botId: bot.botId, error: err.message });
    return null;
  }
}

/** Bot likes a post. */
export async function doLike(bot: BotDoc, postId: string, postAuthorId: string): Promise<boolean> {
  try {
    const authorId = await ensureAccount(bot);
    const existing = await Like.findOne({ author: authorId, post: postId });
    if (existing) return false;

    await Like.create({ author: authorId, post: postId });
    const post = await Post.findByIdAndUpdate(postId, { $inc: { likesCount: 1 } }, { new: true });
    emitPostLike(postId, authorId, post?.likesCount || 1);

    try {
      await createNotification({ recipient: postAuthorId, sender: authorId, type: "like", post: postId });
    } catch (e: any) {
      logger.warn("bot like notification failed", { error: e.message });
    }

    await recordEvent(bot, { type: "post_liked", valence: 0.1 }, undefined, true, "likes");
    return true;
  } catch (err: any) {
    logger.warn("bot doLike failed", { botId: bot.botId, error: err.message });
    return false;
  }
}

/** Bot follows a user. */
export async function doFollow(bot: BotDoc, targetUserId: string): Promise<boolean> {
  try {
    const followerId = await ensureAccount(bot);
    if (followerId === targetUserId) return false;

    const existing = await Follow.findOne({ follower: followerId, following: targetUserId });
    if (existing) return false;

    await Follow.create({ follower: followerId, following: targetUserId });
    const updatedTarget = await User.findByIdAndUpdate(targetUserId, { $inc: { followersCount: 1 } }, { new: true });
    await User.findByIdAndUpdate(followerId, { $inc: { followingCount: 1 } });

    emitFollowUser(targetUserId, followerId, updatedTarget?.followersCount || 1);

    try {
      await createNotification({ recipient: targetUserId, sender: followerId, type: "follow" });
    } catch (e: any) {
      logger.warn("bot follow notification failed", { error: e.message });
    }

    await recordEvent(bot, { type: "followed", byUserId: targetUserId, valence: 0.15 }, undefined, true, "follows");
    return true;
  } catch (err: any) {
    logger.warn("bot doFollow failed", { botId: bot.botId, error: err.message });
    return false;
  }
}

/** Bot sends a DM to another user (bot or real). */
export async function doMessage(bot: BotDoc, targetUserId: string, text?: string, targetName?: string): Promise<string | null> {
  try {
    const senderId = await ensureAccount(bot);
    const persona = personaFromBot(bot);

    const [idA, idB] = [senderId, targetUserId].sort() as [string, string];
    const participants = [new mongoose.Types.ObjectId(idA), new mongoose.Types.ObjectId(idB)];

    let conversation = await Conversation.findOne({ participants: { $all: participants } });
    if (!conversation) {
      conversation = new Conversation({
        participants,
        unreadCounts: { [idA]: 0, [idB]: 0 },
      });
      await conversation.save();
    }

    // Typing indicator — the partner sees the bot "typing…" before the
    // message lands, exactly like a real user would appear.
    emitTyping(
      `conversation:${conversation._id.toString()}`,
      "chat:typing",
      { conversationId: conversation._id.toString(), userId: senderId },
      900 + Math.random() * 1500,
    );

    const msgText = text || generateMessage(persona, targetName || "there", true, undefined, contentRand(bot.botId));

    // ~14% of the time the bot sends a GIF/photo with the message — real
    // friends share pics and reaction GIFs in chat constantly.
    const attachments = Math.random() < 0.14
      ? [{ ...pickChatMedia(`${bot.botId}-${Date.now()}`), duration: 0, name: "", size: 0, mimetype: "" }]
      : [];

    const message = await Message.create({
      conversation: conversation._id,
      sender: senderId,
      recipient: targetUserId,
      text: msgText,
      seen: false,
      seenAt: null,
      ...(attachments.length ? { attachments } : {}),
    });

    await Conversation.findByIdAndUpdate(conversation._id, {
      lastMessage: message._id,
      lastAction: null,
      $inc: { [`unreadCounts.${targetUserId}`]: 1 },
    });

    const populatedMessage = await Message.findById(message._id)
      .populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    emitNewMessage(conversation._id.toString(), populatedMessage);

    try {
      await createNotification({ recipient: targetUserId, sender: senderId, type: "message", message: message._id.toString() });
    } catch (e: any) {
      logger.warn("bot message notification failed", { error: e.message });
    }

    await recordEvent(bot, { type: "message_sent", byUserId: targetUserId, content: msgText.slice(0, 120), valence: 0.12 }, undefined, true, "messagesSent");
    return msgText;
  } catch (err: any) {
    logger.warn("bot doMessage failed", { botId: bot.botId, error: err.message });
    return null;
  }
}

/**
 * Bot "browses" the app — opens a recent post (mostly a real user's) and
 * racks up a view, like a real person doomscrolling the feed. Cheap, quiet
 * activity that makes the app feel lived-in without spamming feeds.
 */
export async function doBrowse(bot: BotDoc): Promise<boolean> {
  try {
    const myId = bot.userId?.toString();
    const botDocs = await Bot.find({}).select("userId").lean();
    const botUserIds = botDocs
      .map((b) => b.userId?.toString())
      .filter((id): id is string => !!id);

    const match: any = { status: "published" };
    if (myId) match.author = { $ne: myId };
    // Mostly browse REAL users' posts (they feel seen); bots occasionally
    // browse each other's.
    if (Math.random() < 0.7 && botUserIds.length) {
      match.author = { $nin: botUserIds.map((id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id)) };
    }

    const post = await Post.findOne(match)
      .sort({ createdAt: -1 })
      .select("_id author")
      .lean();
    if (!post) return false;

    await Post.findByIdAndUpdate(post._id, { $inc: { viewsCount: 1 } });
    await recordEvent(bot, { type: "post_viewed", byUserId: post.author.toString(), valence: 0.02 });
    return true;
  } catch (err: any) {
    logger.warn("bot doBrowse failed", { botId: bot.botId, error: err.message });
    return false;
  }
}

/**
 * Bot rotates its status line ("gym till 8 💪") — updates both the Bot doc
 * and the linked User account so the new status shows everywhere in the app.
 */
export async function doRotateStatus(bot: BotDoc): Promise<boolean> {
  try {
    const next = rotateStatusText(bot.statusText || "");
    if (!next || next === bot.statusText) return false;
    bot.statusText = next;
    await bot.save();
    if (bot.userId) {
      await User.findByIdAndUpdate(bot.userId, { statusText: next });
    }
    return true;
  } catch (err: any) {
    logger.warn("bot doRotateStatus failed", { botId: bot.botId, error: err.message });
    return false;
  }
}

/**
 * Bot sends a "hours later" follow-up in an EXISTING conversation it has
 * with someone it shares history with — like a real friend texting back the
 * next day. Finds a conversation where the bot's last message is at least a
 * few hours old (so it's a genuine follow-up, not a ping-pong).
 */
export async function doFollowUpMessage(bot: BotDoc): Promise<string | null> {
  try {
    const senderId = await ensureAccount(bot);
    const persona = personaFromBot(bot);
    const myId = bot.userId?.toString();
    if (!myId) return null;

    // Conversations where the bot has history and hasn't spoken in a while.
    const cutoff = new Date(Date.now() - 3 * 3600000); // ≥3h since last bot msg
    const last = await Message.findOne({ sender: myId, isDeleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .select("conversation recipient createdAt")
      .lean();
    if (!last || last.createdAt > cutoff) return null;

    const conversationId = last.conversation.toString();
    const theirUserId = last.recipient?.toString();
    if (!theirUserId) return null;

    // Don't follow up if there's already a newer message from the other side
    // (that's the guaranteed-reply pass's job).
    const newerTheirs = await Message.exists({
      conversation: conversationId,
      sender: theirUserId,
      createdAt: { $gt: last.createdAt },
      isDeleted: { $ne: true },
    });
    if (newerTheirs) return null;

    // A human-scaled pause before the follow-up lands
    const text = generateFollowUp(persona, contentRand(bot.botId));
    const sent = await doMessage(bot, theirUserId, text, "there");
    return sent;
  } catch (err: any) {
    logger.warn("bot doFollowUpMessage failed", { botId: bot.botId, error: err.message });
    return null;
  }
}

/**
 * Bot INITIATES a chat (doesn't just reply) by referencing something from
 * its memory — a post it saw, a comment, a past conversation with the
 * target. This is the biggest "real person" leap: bots proactively bring
 * up shared history instead of only answering.
 */
export async function doInitiateMessage(bot: BotDoc): Promise<string | null> {
  try {
    const target = await pickMemoryTarget(bot);
    if (!target) return null;
    const { userId, name } = target;

    const persona = personaFromBot(bot);
    // Find the most recent memory involving this person (something to reference)
    const memory = (bot.memory || [])
      .filter((m: any) => (m.byUserId === target.targetId || m.byBotId === target.targetId) && m.content)
      .slice(-1)[0];

    let text: string | null = null;
    if (process.env.GEMINI_API_KEY) {
      const turns = memory
        ? [{ from: "them", text: memory.content }]
        : [{ from: "them", text: `you and ${name} haven't talked in a bit` }];
      text = await geminiReply(
        persona,
        turns,
        `You're starting a conversation with ${name}. Reference something from your shared past (${memory ? "this message/thing they posted" : "not having talked in a while"}) naturally, then ask a question or make a small comment. One or two short lines, in character.`,
      );
    }
    if (!text) text = generateMessage(persona, name, true, memory?.content, contentRand(bot.botId));

    const sent = await doMessage(bot, userId, text, name);
    return sent;
  } catch (err: any) {
    logger.warn("bot doInitiateMessage failed", { botId: bot.botId, error: err.message });
    return null;
  }
}

/** Pick a person (bot or real user) the bot has history with, for an opener. */
async function pickMemoryTarget(bot: BotDoc): Promise<{ userId: string; name: string; targetId: string } | null> {
  try {
    const rels = (bot.relationships || []).filter((r: any) => r.bond >= 0.15);
    if (rels.length === 0) return null;
    const rel = rels[Math.floor(Math.random() * rels.length)];
    const targetId = otherParty(rel, bot.botId);

    // Is it a bot or a real user?
    const botTarget = await Bot.findOne({ botId: targetId }).select("userId name").lean();
    if (botTarget && botTarget.userId) {
      return { userId: botTarget.userId.toString(), name: botTarget.name, targetId };
    }
    const user = await User.findById(targetId).select("fullName username").lean();
    if (user) {
      return { userId: user._id.toString(), name: user.fullName || user.username, targetId };
    }
    return null;
  } catch (e: any) {
    logger.warn("bot pickMemoryTarget failed", { error: e.message });
    return null;
  }
}

/** Bot replies to a message it received. Returns reply text or null. */
export async function doReplyMessage(
  bot: BotDoc,
  conversationId: string,
  theirText: string,
  theirUserId: string,
  aiEnabled: boolean,
  typingMs?: number,
): Promise<string | null> {
  try {
    const senderId = await ensureAccount(bot);
    const persona = personaFromBot(bot);

    let reply: string | null = null;
    if (aiEnabled) {
      // Conversation memory: feed the last ~8 messages so the bot replies
      // with real context ("how did the interview go?" still makes sense),
      // not just to the latest ping-pong.
      const recent = await Message.find({ conversation: conversationId, isDeleted: { $ne: true } })
        .sort({ createdAt: -1 })
        .limit(8)
        .select("sender text")
        .lean();
      const turns = recent
        .reverse()
        .map((m: any) => ({
          from: m.sender?.toString() === senderId ? persona.name : "them",
          text: m.text || "",
        }))
        .filter((t: any) => t.text);

      // LONG-TERM memory: the bot's rolling memory log holds events involving
      // this person from hours/days ago (posts they made, past chats). Feed a
      // few recent ones in as context so the bot can reference real shared
      // history — "how did that interview go?" still lands days later.
      const memories = (bot.memory || [])
        .filter((m: any) => (m.byUserId === theirUserId || m.byBotId === theirUserId) && m.content)
        .slice(-4)
        .map((m: any) => ({
          from: "shared history",
          text: m.content.slice(0, 140),
        }));
      const withMemory = [...memories, ...turns];
      reply = await geminiReply(persona, withMemory, "This is a chat conversation you're having. Some lines above are your shared history with this person — use them naturally if relevant. Reply in character as the last message in the thread.");
    }
    if (!reply) reply = generateReplyToMessage(persona, theirText, contentRand(bot.botId));

    // Typing indicator before the reply lands
    emitTyping(
      `conversation:${conversationId}`,
      "chat:typing",
      { conversationId, userId: senderId },
      typingMs ?? 800 + Math.random() * 1200,
    );

    const message = await Message.create({
      conversation: conversationId,
      sender: senderId,
      recipient: theirUserId,
      text: reply,
      seen: false,
      seenAt: null,
    });

    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessage: message._id,
      lastAction: null,
      $inc: { [`unreadCounts.${theirUserId}`]: 1 },
    });

    const populatedMessage = await Message.findById(message._id)
      .populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    emitNewMessage(conversationId, populatedMessage);

    await recordEvent(bot, { type: "message_sent", byUserId: theirUserId, content: reply.slice(0, 120), valence: 0.12 }, undefined, true, "messagesSent");
    return reply;
  } catch (err: any) {
    logger.warn("bot doReplyMessage failed", { botId: bot.botId, error: err.message });
    return null;
  }
}

/** Bot reacts with an emoji to a message in a conversation. */
export async function doMessageReaction(
  bot: BotDoc,
  messageId: string,
  conversationId: string,
  emoji?: string,
): Promise<boolean> {
  try {
    const authorId = await ensureAccount(bot);
    const emojis = ["❤️", "😂", "🔥", "👍", "😮", "🙌", "😍", "🥹"];
    const picked = emoji || emojis[Math.floor(Math.random() * emojis.length)];

    const message = await Message.findById(messageId);
    if (!message) return false;
    if ((message.reactions || []).some((r: any) => r.sender.toString() === authorId)) return false;

    (message.reactions as any).push({
      emoji: picked,
      sender: new mongoose.Types.ObjectId(authorId),
      createdAt: new Date(),
    });
    await message.save();

    const populatedMessage = await Message.findById(message._id)
      .populate("reactions.sender", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();
    const populatedReaction = (populatedMessage?.reactions as any[] || []).find(
      (r: any) => r.sender?._id?.toString() === authorId,
    );

    try {
      const io = getIO();
      const conversation = await Conversation.findById(conversationId).select("participants").lean();
      const participantIds = (conversation?.participants || []).map((p: any) => p.toString());
      io.to(`conversation:${conversationId}`).emit("message:reaction", {
        messageId,
        reaction: populatedReaction || { emoji: picked, sender: { _id: authorId } },
        type: "add",
      });
      for (const pId of participantIds) io.to(`user:${pId}`).emit("message:reaction", { messageId, reaction: populatedReaction || { emoji: picked, sender: { _id: authorId } }, type: "add" });
    } catch (e) {
      /* noop */
    }

    await recordEvent(bot, { type: "glimpse_reaction", valence: 0.08 }, undefined, true, "likes");
    return true;
  } catch (err: any) {
    logger.warn("bot doMessageReaction failed", { botId: bot.botId, error: err.message });
    return false;
  }
}

/** Bot "fixes a typo" on its own message a few seconds after sending — the
 *  client shows the "edited" badge, exactly like a real human catching a
 *  mistake. Picks a plausible small rewrite of the same text. */
export async function doEditOwnMessage(bot: BotDoc, messageId: string, conversationId: string): Promise<boolean> {
  try {
    const authorId = await ensureAccount(bot);
    const message = await Message.findById(messageId);
    if (!message || message.sender.toString() !== authorId || message.isEdited) return false;

    const original = (message.text || "").trim();
    if (!original) return false;

    // A human "typo fix": replace a common typo pattern or just re-punctuate.
    const TYPO_WORDS: Record<string, string> = {
      teh: "the", haha: "haha", whrn: "when", becuase: "because",
      definately: "definitely", recieve: "receive",
    };
    let fixed = original;
    const r = Math.random();
    if (r < 0.5) {
      fixed = original.replace(/\s+/g, " ");
    } else if (r < 0.8) {
      fixed = original.replace(/([.!?])(?=\s*$)/, "!");
    } else {
      fixed = fixed.replace(/\b(teh|whrn|becuase|definately|recieve)\b/gi, (m) => TYPO_WORDS[m.toLowerCase()] || m);
    }
    if (fixed === original) fixed = original + "*";

    message.text = fixed;
    message.isEdited = true;
    await message.save();

    const populatedMessage = await Message.findById(message._id)
      .populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    try {
      const io = getIO();
      const conversation = await Conversation.findById(conversationId).select("participants").lean();
      const participantIds = (conversation?.participants || []).map((p: any) => p.toString());
      io.to(`conversation:${conversationId}`).emit("message:edit", populatedMessage);
      for (const pId of participantIds) io.to(`user:${pId}`).emit("message:edit", populatedMessage);
    } catch (e) {
      /* noop */
    }
    return true;
  } catch (err: any) {
    logger.warn("bot doEditOwnMessage failed", { botId: bot.botId, error: err.message });
    return false;
  }
}

/** Bot posts a 24h glance (photo + caption). */
export async function doGlimpse(bot: BotDoc): Promise<any | null> {
  try {
    const authorId = await ensureAccount(bot);
    const persona = personaFromBot(bot);
    const caption = generateGlimpseCaption(persona, moodTone(bot.mood || 0, bot.energy || 1), contentRand(bot.botId));

    // Glances aren't just photos anymore — bots share GIFs and short videos
    // too, so the tray looks alive like a real stories feed.
    const g = pickGlimpseMedia(bot.botId, contentRand(bot.botId));
    const glimpse = await Glimpse.create({
      author: authorId,
      media: { url: g.url, public_id: "" },
      mediaType: g.mediaType,
      expiresAt: new Date(Date.now() + 12 * 3600000),
      visibility: "public",
    });

    await recordEvent(bot, { type: "glimpse_reaction", content: caption.slice(0, 120), valence: 0.12 }, undefined, true, "glances");

    // Emit to followers so the glimpses tray updates live
    try {
      const io = getIO();
      io.emit("glimpse:new", { glimpse });
    } catch (e) {
      /* noop */
    }
    return glimpse;
  } catch (err: any) {
    logger.warn("bot doGlimpse failed", { botId: bot.botId, error: err.message });
    return null;
  }
}

/**
 * Bot votes on a recent poll post (prefers REAL users' polls so human polls
 * fill up like they do in real life). One vote per bot per poll — mirrors
 * the real controller's race-safe update + poll_vote notification.
 */
export async function doVoteOnPoll(bot: BotDoc): Promise<boolean> {
  try {
    const authorId = await ensureAccount(bot);
    const botDocs = await Bot.find({}).select("userId").lean();
    const botUserIds = botDocs
      .map((b) => b.userId?.toString())
      .filter((id): id is string => !!id);
    const myId = bot.userId?.toString();

    const match: any = {
      status: "published",
      "poll.expiresAt": { $gt: new Date() },
    };
    if (myId) match.author = { $ne: myId };
    // Prefer REAL users' polls (70%) so human polls actually get votes.
    if (Math.random() < 0.7 && botUserIds.length) {
      match.author = { $nin: botUserIds.map((id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id)) };
    }

    const post = await Post.findOne(match)
      .sort({ createdAt: -1 })
      .select("_id author poll")
      .lean();
    if (!post?.poll || !post.poll.options?.length) return false;

    // Already voted?
    const voted = post.poll.options.some((o: any) =>
      (o.votes || []).some((v: any) => v?.toString() === authorId),
    );
    if (voted) return false;

    const optionIndex = Math.floor(Math.random() * post.poll.options.length);

    // Race-safe single atomic update (mirrors the real controller).
    const updated = await Post.findOneAndUpdate(
      {
        _id: post._id,
        "poll.options": { $not: { $elemMatch: { votes: authorId } } },
      },
      {
        $push: { [`poll.options.${optionIndex}.votes`]: authorId },
        $inc: { "poll.totalVotes": 1 },
      },
      { new: true },
    );
    if (!updated) return false;

    try {
      await createNotification({ recipient: post.author.toString(), sender: authorId, type: "poll_vote", post: post._id.toString() });
    } catch (e: any) {
      logger.warn("bot poll-vote notification failed", { error: e.message });
    }

    await recordEvent(bot, { type: "post_liked", byUserId: post.author.toString(), valence: 0.1 }, undefined, true, "likes");
    return true;
  } catch (err: any) {
    logger.warn("bot doVoteOnPoll failed", { botId: bot.botId, error: err.message });
    return false;
  }
}

/**
 * Bot saves/bookmarks a recent post (prefers real users' posts so their
 * savesCount moves). Mirrors the save branch of the real controller.
 */
export async function doSavePost(bot: BotDoc): Promise<boolean> {
  try {
    const authorId = await ensureAccount(bot);
    const botDocs = await Bot.find({}).select("userId").lean();
    const botUserIds = botDocs
      .map((b) => b.userId?.toString())
      .filter((id): id is string => !!id);
    const myId = bot.userId?.toString();

    const match: any = { status: "published" };
    if (myId) match.author = { $ne: myId };
    if (Math.random() < 0.7 && botUserIds.length) {
      match.author = { $nin: botUserIds.map((id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id)) };
    }

    const post = await Post.findOne(match)
      .sort({ createdAt: -1 })
      .select("_id author")
      .lean();
    if (!post) return false;

    const already = await Save.findOne({ user: authorId, post: post._id });
    if (already) return false;

    await Save.create({ user: authorId, post: post._id, folder: "General" });
    const actualCount = await Save.countDocuments({ post: post._id });
    const updatedPost = await Post.findByIdAndUpdate(
      post._id,
      { $set: { savesCount: actualCount } },
      { new: true },
    );

    if (post.author.toString() !== authorId) {
      try {
        await createNotification({ recipient: post.author.toString(), sender: authorId, type: "save", post: post._id.toString() });
      } catch (e: any) {
        logger.warn("bot save notification failed", { error: e.message });
      }
    }
    try {
      emitPostSave(post._id.toString(), authorId, updatedPost?.savesCount || actualCount);
    } catch (e) {
      /* noop */
    }

    await recordEvent(bot, { type: "post_liked", byUserId: post.author.toString(), valence: 0.1 }, undefined, true, "likes");
    return true;
  } catch (err: any) {
    logger.warn("bot doSavePost failed", { botId: bot.botId, error: err.message });
    return false;
  }
}

/**
 * Bot reacts to a REAL user's glimpse (story) — the current picker only
 * targets other bots' stories, so real users never see reactions. Returns
 * the glimpse it reacted to, or null.
 */
export async function doReactToRealGlimpse(bot: BotDoc): Promise<boolean> {
  try {
    const myId = bot.userId?.toString();
    const botDocs = await Bot.find({}).select("userId").lean();
    const botUserIds = botDocs
      .map((b) => b.userId?.toString())
      .filter((id): id is string => !!id)
      .map((id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id));

    const glimpse = await Glimpse.findOne({
      author: { $nin: botUserIds, ...(myId ? { $ne: myId } : {}) },
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });
    if (!glimpse) return false;

    return doGlimpseReaction(bot, glimpse);
  } catch (err: any) {
    logger.warn("bot doReactToRealGlimpse failed", { botId: bot.botId, error: err.message });
    return false;
  }
}

/**
 * Bot evolves its profile over time — occasionally updates its bio with a
 * fresh local flavor (people change their bios). Syncs to the linked User
 * account so the change shows everywhere.
 */
export async function doEvolveProfile(bot: BotDoc): Promise<boolean> {
  try {
    const country = getCountry(bot.country || "US");
    const pool = country.bioFlavors || [];
    const current = (bot.bio || "").toLowerCase();
    const next = (pool.find((b: string) => !current.includes(b.toLowerCase())) || pool[0] || bot.bio || "");
    if (!next || next === bot.bio) return false;

    bot.bio = next;
    await bot.save();
    if (bot.userId) {
      await User.findByIdAndUpdate(bot.userId, { bio: next });
    }
    await recordEvent(bot, { type: "profile_updated", content: next.slice(0, 80), valence: 0.05 });
    return true;
  } catch (err: any) {
    logger.warn("bot doEvolveProfile failed", { botId: bot.botId, error: err.message });
    return false;
  }
}

/**
 * Bot "hesitates" while typing — emits a typing pulse (on, off, on) like a
 * real person starting, deleting and retyping a message. Used before the
 * actual reply lands to make the DM feel typed, not generated.
 */
export function emitHesitationTyping(room: string, event: string, payload: { [k: string]: string }, pulseMs = 900): void {
  try {
    const io = getIO();
    io.to(room).emit(event, { ...payload, isTyping: true });
    setTimeout(() => {
      try {
        io.to(room).emit(event, { ...payload, isTyping: false });
        setTimeout(() => {
          try {
            io.to(room).emit(event, { ...payload, isTyping: true });
          } catch { /* noop */ }
        }, 400 + Math.random() * 800);
      } catch { /* noop */ }
    }, pulseMs);
  } catch { /* noop */ }
}

/**
 * Bot makes a MISSED voice/video call to someone it has a conversation with
 * — the "missed call from Priya" WhatsApp detail. Uses the real call-system
 * message helper so the client shows the proper chip + missed-call badge.
 */
export async function doMissedCall(bot: BotDoc): Promise<boolean> {
  try {
    const myId = await ensureAccount(bot);
    // Prefer someone the bot actually talks to (bonded bot or real user)
    const rels = (bot.relationships || []).filter((r: any) => r.bond >= 0.1);
    if (rels.length === 0) return false;
    const rel = rels[Math.floor(Math.random() * rels.length)];
    const targetId = otherParty(rel, bot.botId);

    // Resolve target's user id
    let targetUserId: string | null = null;
    const targetBot = await Bot.findOne({ botId: targetId }).select("userId").lean();
    if (targetBot?.userId) targetUserId = targetBot.userId.toString();
    else {
      const user = await User.findById(targetId).select("_id").lean();
      if (user) targetUserId = user._id.toString();
    }
    if (!targetUserId || targetUserId === myId) return false;

    // Ensure a conversation exists (the call helper requires one)
    const [idA, idB] = [myId, targetUserId].sort() as [string, string];
    const participants = [new mongoose.Types.ObjectId(idA), new mongoose.Types.ObjectId(idB)];
    let conversation = await Conversation.findOne({ participants: { $all: participants } });
    if (!conversation) {
      conversation = new Conversation({ participants, unreadCounts: { [idA]: 0, [idB]: 0 } });
      await conversation.save();
    }

    const callType = Math.random() < 0.4 ? ("video" as const) : ("audio" as const);
    await recordDirectCallSystemMessage({
      userA: myId,
      userB: targetUserId,
      system: "call_missed",
      callType,
    });

    await recordEvent(bot, { type: "message_sent", byUserId: targetUserId, content: "missed call", valence: 0.05 }, undefined, true, "messagesSent");
    return true;
  } catch (err: any) {
    logger.warn("bot doMissedCall failed", { botId: bot.botId, error: err.message });
    return false;
  }
}

/**
 * Bot PLAIN-reposts a post (no commentary — the most common repost type).
 * Mirrors the real controller: Repost doc + repostsCount bump + socket emit
 * + repost notification.
 */
export async function doPlainRepost(bot: BotDoc): Promise<boolean> {
  try {
    const authorId = await ensureAccount(bot);
    const botDocs = await Bot.find({}).select("userId").lean();
    const botUserIds = botDocs
      .map((b) => b.userId?.toString())
      .filter((id): id is string => !!id);
    const myId = bot.userId?.toString();

    const match: any = { status: "published" };
    if (myId) match.author = { $ne: myId };
    // Prefer real users' posts so real people feel seen
    if (Math.random() < 0.6 && botUserIds.length) {
      match.author = { $nin: botUserIds.map((id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id)) };
    }

    const post = await Post.findOne(match).sort({ createdAt: -1 }).select("_id author").lean();
    if (!post) return false;

    const existing = await Repost.findOne({ user: authorId, post: post._id });
    if (existing) return false;

    await Repost.create({ user: authorId, post: post._id });
    const updated = await Post.findByIdAndUpdate(post._id, { $inc: { repostsCount: 1 } }, { new: true });

    try {
      emitPostRepost(post._id.toString(), authorId, updated?.repostsCount || 1);
      if (post.author.toString() !== authorId) {
        await createNotification({ recipient: post.author.toString(), sender: authorId, type: "repost", post: post._id.toString() });
      }
    } catch (e: any) {
      logger.warn("bot repost emit/notify failed", { error: e.message });
    }

    await recordEvent(bot, { type: "post_liked", byUserId: post.author.toString(), valence: 0.1 }, undefined, true, "likes");
    return true;
  } catch (err: any) {
    logger.warn("bot doPlainRepost failed", { botId: bot.botId, error: err.message });
    return false;
  }
}

/**
 * Bot reacts to a comment (on a post it commented on, or a comment on its
 * own post) — mirrors the real comment-reaction flow: push emoji onto the
 * comment's reactions + emitCommentReaction.
 */
export async function doCommentReaction(bot: BotDoc): Promise<boolean> {
  try {
    const authorId = await ensureAccount(bot);
    const emojis = ["❤️", "😂", "🔥", "👍", "😮", "🙌", "🥹"];
    const emoji = emojis[Math.floor(Math.random() * emojis.length)] || "❤️";

    // A recent comment that isn't the bot's own and it hasn't reacted to yet.
    const comment = await Comment.findOne({
      author: { $ne: authorId },
      isDeleted: { $ne: true },
      reactions: { $not: { $elemMatch: { sender: authorId } } },
    })
      .sort({ createdAt: -1 })
      .select("_id author post")
      .lean();
    if (!comment) return false;

    const reaction = { emoji, sender: new mongoose.Types.ObjectId(authorId), createdAt: new Date() };
    const updated = await Comment.findByIdAndUpdate(
      comment._id,
      { $push: { reactions: reaction } },
      { new: true },
    );
    if (!updated) return false;

    try {
      emitCommentReaction(comment._id.toString(), { reaction, type: "add" });
    } catch (e: any) {
      logger.warn("bot comment reaction emit failed", { error: e.message });
    }

    await recordEvent(bot, { type: "post_liked", byUserId: comment.author.toString(), valence: 0.08 }, undefined, true, "likes");
    return true;
  } catch (err: any) {
    logger.warn("bot doCommentReaction failed", { botId: bot.botId, error: err.message });
    return false;
  }
}

/** Milestones a bot celebrates when its follower count crosses them. */
const FOLLOWER_MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

/**
 * Bot posts a "just hit X followers, thank you!" post when its follower
 * count crosses a milestone — real users celebrate growth.
 */
export async function doMilestonePost(bot: BotDoc): Promise<boolean> {
  try {
    const myId = bot.userId?.toString();
    if (!myId) return false;
    const user = await User.findById(myId).select("followersCount").lean();
    const count = user?.followersCount || 0;

    const nextMilestone = FOLLOWER_MILESTONES.find((m) => m <= count && m > (bot.lastMilestonePosted || 0));
    if (!nextMilestone) return false;

    const persona = personaFromBot(bot);
    const text = [
      `Just hit ${nextMilestone} followers!! This is wild. Thank you all 🥹`,  
      `${nextMilestone} followers?! I started this account as a random idea. Means so much 🙏`,
      `We just crossed ${nextMilestone}!! Grateful for every single one of you 🎉`,
      `${nextMilestone} followers and counting. The support here is unreal. Thank you ❤️`,
    ][Math.floor(Math.random() * 4)] || `Just hit ${nextMilestone} followers!! 🎉`;

    const post = await doTextOnlyPost(bot, text);
    if (post) {
      bot.lastMilestonePosted = nextMilestone;
      await bot.save();
      return true;
    }
    return false;
  } catch (err: any) {
    logger.warn("bot doMilestonePost failed", { botId: bot.botId, error: err.message });
    return false;
  }
}

/**
 * Bot changes its avatar to a fresh randomuser portrait (same free pool it
 * was seeded from) and syncs the linked User account.
 */
export async function doChangeAvatar(bot: BotDoc): Promise<boolean> {
  try {
    const folder = bot.gender === "female" ? "women" : "men";
    const idx = Math.floor(Math.random() * 99);
    const url = `https://randomuser.me/api/portraits/${folder}/${idx}.jpg`;
    if (url === bot.avatarUrl) return false;

    bot.avatarUrl = url;
    await bot.save();
    if (bot.userId) {
      await User.findByIdAndUpdate(bot.userId, { "profilePic.url": url });
    }
    await recordEvent(bot, { type: "profile_updated", content: "new profile pic", valence: 0.05 });
    return true;
  } catch (err: any) {
    logger.warn("bot doChangeAvatar failed", { botId: bot.botId, error: err.message });
    return false;
  }
}

/**
 * Bot replies with text to a REAL user's glimpse (story) — mirrors the
 * glimpse-reply controller: a DM with the glimpse attached + a greeting.
 */
export async function doGlimpseReply(bot: BotDoc): Promise<boolean> {
  try {
    const myId = bot.userId?.toString();
    const botDocs = await Bot.find({}).select("userId").lean();
    const botUserIds = botDocs
      .map((b) => b.userId?.toString())
      .filter((id): id is string => !!id)
      .map((id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id));

    const glimpse = await Glimpse.findOne({
      author: { $nin: botUserIds, ...(myId ? { $ne: myId } : {}) },
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });
    if (!glimpse || !myId) return false;
    const authorId = glimpse.author?.toString();
    if (!authorId || authorId === myId) return false;

    const persona = personaFromBot(bot);
    const text = ["this is so good 😍", "love this!!", "okay this is amazing", "🔥🔥🔥", "so cute, love it"][
      Math.floor(Math.random() * 5)
    ] || "love this!";

    // Reuse doMessage for the conversation + message plumbing
    await doMessage(bot, authorId, text, "there");

    try {
      await createNotification({ recipient: authorId, sender: myId, type: "glimpse_reply", glimpse: glimpse._id.toString() });
    } catch (e: any) {
      logger.warn("bot glimpse reply notification failed", { error: e.message });
    }
    return true;
  } catch (err: any) {
    logger.warn("bot doGlimpseReply failed", { botId: bot.botId, error: err.message });
    return false;
  }
}

/**
 * Bot sends a VOICE NOTE in a DM — a short audio attachment instead of
 * text, the way real friends text. Uses free verified audio URLs.
 */
export async function doVoiceNote(bot: BotDoc): Promise<boolean> {
  try {
    const myId = await ensureAccount(bot);
    const rels = (bot.relationships || []).filter((r: any) => r.bond >= 0.1);
    if (rels.length === 0) return false;
    const rel = rels[Math.floor(Math.random() * rels.length)];
    const targetId = otherParty(rel, bot.botId);

    let targetUserId: string | null = null;
    const targetBot = await Bot.findOne({ botId: targetId }).select("userId").lean();
    if (targetBot?.userId) targetUserId = targetBot.userId.toString();
    else {
      const user = await User.findById(targetId).select("_id").lean();
      if (user) targetUserId = user._id.toString();
    }
    if (!targetUserId || targetUserId === myId) return false;

    const [idA, idB] = [myId, targetUserId].sort() as [string, string];
    const participants = [new mongoose.Types.ObjectId(idA), new mongoose.Types.ObjectId(idB)];
    let conversation = await Conversation.findOne({ participants: { $all: participants } });
    if (!conversation) {
      conversation = new Conversation({ participants, unreadCounts: { [idA]: 0, [idB]: 0 } });
      await conversation.save();
    }

    const AUDIO_URLS = [
      "https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3",
      "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    ];
    const url = AUDIO_URLS[Math.floor(Math.random() * AUDIO_URLS.length)] as string;

    const message = await Message.create({
      conversation: conversation._id,
      sender: myId,
      recipient: targetUserId,
      text: "",
      seen: false,
      seenAt: null,
      attachments: [{ url, public_id: "", type: "voice_note", duration: 4 + Math.floor(Math.random() * 12) }],
    });

    await Conversation.findByIdAndUpdate(conversation._id, {
      lastMessage: message._id,
      lastAction: null,
      $inc: { [`unreadCounts.${targetUserId}`]: 1 },
    });

    const populated = await Message.findById(message._id)
      .populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();
    emitNewMessage(conversation._id.toString(), populated);

    await recordEvent(bot, { type: "message_sent", byUserId: targetUserId, content: "voice note", valence: 0.1 }, undefined, true, "messagesSent");
    return true;
  } catch (err: any) {
    logger.warn("bot doVoiceNote failed", { botId: bot.botId, error: err.message });
    return false;
  }
}

/** Bot reacts to a glimpse with an emoji. */
export async function doGlimpseReaction(bot: BotDoc, glimpse: any): Promise<boolean> {
  try {
    const authorId = await ensureAccount(bot);
    const emojis = ["❤️", "🔥", "😂", "😍", "👍", "😮"];
    const emoji = emojis[Math.floor(Math.random() * emojis.length)];

    const already = (glimpse.reactions || []).some((r: any) => r.user.toString() === authorId);
    if (already) return false;

    glimpse.reactions = [...(glimpse.reactions || []), { user: authorId, emoji, createdAt: new Date() }];
    await glimpse.save();

    try {
      await createNotification({ recipient: glimpse.author, sender: authorId, type: "glimpse_reaction", glimpse: glimpse._id });
    } catch (e: any) {
      logger.warn("bot glimpse reaction notification failed", { error: e.message });
    }

    await recordEvent(bot, { type: "glimpse_reaction", valence: 0.1 }, undefined, true, "likes");
    return true;
  } catch (err: any) {
    logger.warn("bot doGlimpseReaction failed", { botId: bot.botId, error: err.message });
    return false;
  }
}

function topicToHashtags(topic: string): string[] {
  const map: Record<string, string[]> = {
    fitness: ["fitness", "gym", "motivation"],
    music: ["music", "playlist", "newmusic"],
    movies: ["movies", "film", "cinema"],
    gaming: ["gaming", "games", "gamers"],
    food: ["food", "foodie", "cooking"],
    travel: ["travel", "wanderlust", "adventure"],
    tech: ["tech", "coding", "startup"],
    fashion: ["fashion", "style", "outfits"],
    books: ["books", "reading", "bookworm"],
    art: ["art", "illustration", "creative"],
    photography: ["photography", "shots", "goldenhour"],
    sports: ["sports", "cricket", "football"],
    nature: ["nature", "outdoors", "sunset"],
    pets: ["pets", "dogs", "cats"],
    coding: ["coding", "developers", "programming"],
    design: ["design", "uiux", "creativity"],
    finance: ["money", "finance", "investing"],
    mentalhealth: ["mentalhealth", "selfcare", "growth"],
    startups: ["startup", "entrepreneur", "founder"],
  };
  return map[topic] || ["life", "mood", "daily"];
}

// ── Community actions ──────────────────────────────────────────────────────

/**
 * Bot creates a community around one of its interests, then its strongest
 * connections (circle-mates / friends) join it right away — so a realistic
 * friend group appears the moment the community is born. Public, so real
 * users can browse and read the conversation (and join if they want).
 */
export async function doCreateCommunity(bot: BotDoc): Promise<any | null> {
  try {
    const authorId = await ensureAccount(bot);
    const persona = personaFromBot(bot);
    const topic = weightedTopic(persona);

    // Country-flavored + unique: "Fitness Freaks • Mumbai" — the city
    // suffix keeps every community distinct and locally authentic.
    const city = getCountry(persona.country).cities[
      Math.floor(Math.random() * getCountry(persona.country).cities.length)
    ];
    const community = await Community.create({
      name: `${communityNameFor(topic, contentRand(bot.botId))} • ${city}`,
      description: COMMUNITY_DESCRIPTIONS[topic] || "",
      creator: authorId,
      privacy: "public",
      members: [{ user: authorId, joinedAt: new Date(), role: "creator" }],
      memberCount: 1,
      rooms: [{ name: "general", createdBy: authorId }],
      isSimulated: true,
      topic,
    });

    // Connections join: bots we have a bond with (friends/circle-mates)
    const connections = (bot.relationships || [])
      .filter((r: any) => r.bond >= 0.2)
      .sort((x: any, y: any) => y.bond - x.bond)
      .slice(0, 6);
    for (const rel of connections) {
      const other = otherParty(rel, bot.botId);
      const mate = await Bot.findOne({ botId: other });
      if (!mate || !mate.userId) continue;
      // Weight by shared interests so communities feel themed
      const share = sharedInterest(persona, personaFromBot(mate));
      if (share > 0.3 || rel.bond >= 0.45) {
        await doJoinCommunity(mate, community._id.toString());
        await recordEvent(
          mate,
          { type: "post_commented", byBotId: bot.botId, content: `joined ${community.name}`, valence: 0.2 },
          bot.botId,
          true,
          undefined,
          "comment",
        );
      }
    }

    await recordEvent(bot, { type: "post_created", content: `created community ${community.name}`, valence: 0.2 }, undefined, true, "posts");
    return community;
  } catch (err: any) {
    logger.warn("bot doCreateCommunity failed", { botId: bot.botId, error: err.message });
    return null;
  }
}

/** Bot joins a simulated community. */
export async function doJoinCommunity(bot: BotDoc, communityId: string): Promise<boolean> {
  try {
    const authorId = await ensureAccount(bot);
    const community = await Community.findById(communityId);
    if (!community || !community.isSimulated) return false;
    if (community.members.some((m: any) => m.user.toString() === authorId)) return false;

    community.members.push({ user: authorId, joinedAt: new Date(), role: "member" });
    community.memberCount = community.members.length;
    await community.save();

    try {
      getIO().to(`community:${communityId}`).emit("community:member-joined", {
        communityId,
        userId: authorId,
        memberCount: community.memberCount,
      });
    } catch (e) {
      /* noop */
    }

    await recordEvent(bot, { type: "post_commented", content: `joined ${community.name}`, valence: 0.15 }, undefined, true, "comments");
    return true;
  } catch (err: any) {
    logger.warn("bot doJoinCommunity failed", { botId: bot.botId, error: err.message });
    return false;
  }
}

/**
 * Bot sends a message in a community it belongs to. With AI enabled it reads
 * the recent conversation and replies contextually; otherwise it drops a
 * themed group line. Either way it behaves like a real member.
 */
export async function doCommunityMessage(bot: BotDoc, community: any, aiEnabled: boolean, typingMs?: number): Promise<string | null> {
  try {
    const senderId = await ensureAccount(bot);
    const persona = personaFromBot(bot);
    const mood = moodTone(bot.mood || 0, bot.energy || 1);
    const topic = communityTopicFor(community);

    let text: string | null = null;
    if (aiEnabled) {
      const recent = await CommunityMessage.find({ community: community._id, isDeleted: { $ne: true } })
        .sort({ createdAt: -1 })
        .limit(6)
        .populate("sender", "fullName username")
        .lean();
      const turns = recent
        .reverse()
        .map((m: any) => ({ from: m.sender?.fullName || m.sender?.username || "someone", text: m.text || "" }))
        .filter((t: any) => t.text);
      text = await geminiCommunityReply(persona, community.name, turns, topic);
    }
    if (!text) text = generateCommunityMessage(persona, mood, topic, contentRand(bot.botId));

    // Community typing indicator — other members see the bot "typing…"
    emitTyping(
      `community:${community._id.toString()}`,
      "community:typing",
      { communityId: community._id.toString(), userId: senderId },
      typingMs ?? 1000 + Math.random() * 1800,
    );

    const message = await CommunityMessage.create({
      community: community._id,
      sender: senderId,
      text,
      room: null,
    });

    const populated = await CommunityMessage.findById(message._id)
      .populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    // Update lastMessage snapshot like the real controller
    await Community.findByIdAndUpdate(community._id, {
      updatedAt: new Date(),
      lastMessage: {
        messageId: message._id,
        text,
        attachmentType: "",
        sender: { _id: senderId, fullName: persona.name, username: persona.username },
        createdAt: new Date(),
        isDeleted: false,
      },
      lastAction: null,
    });

    // Deliver to every member's personal room (real-time, exactly like a
    // real client's message — including the sender's other tabs).
    try {
      const io = getIO();
      for (const member of community.members || []) {
        io.to(`user:${member.user.toString()}`).emit("community:message:new", populated);
      }
      io.to(`community:${community._id.toString()}`).emit("community:message:new", populated);
    } catch (e) {
      /* noop */
    }

    await recordEvent(bot, { type: "message_sent", content: text.slice(0, 120), valence: 0.1 }, undefined, true, "messagesSent");
    return text;
  } catch (err: any) {
    logger.warn("bot doCommunityMessage failed", { botId: bot.botId, error: err.message });
    return null;
  }
}

/** Bot reacts to a community message with an emoji. */
export async function doReactToCommunityMessage(bot: BotDoc, messageId: string): Promise<boolean> {
  try {
    const authorId = await ensureAccount(bot);
    const message = await CommunityMessage.findById(messageId);
    if (!message) return false;
    if ((message.reactions || []).some((r: any) => r.sender.toString() === authorId)) return false;

    const emojis = ["❤️", "🔥", "😂", "👍", "😮", "🙌"];
    const emoji = emojis[Math.floor(Math.random() * emojis.length)] || "❤️";
    (message.reactions as any).push({ emoji, sender: new mongoose.Types.ObjectId(authorId), createdAt: new Date() });
    await message.save();

    await recordEvent(bot, { type: "glimpse_reaction", valence: 0.08 }, undefined, true, "likes");
    return true;
  } catch (err: any) {
    logger.warn("bot doReactToCommunityMessage failed", { botId: bot.botId, error: err.message });
    return false;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Emit a "typing…" indicator to a room, then flip it off after a delay. */
function emitTyping(
  room: string,
  event: string,
  payload: { [k: string]: string },
  delayMs: number,
): void {
  try {
    const io = getIO();
    io.to(room).emit(event, { ...payload, isTyping: true });
    setTimeout(() => {
      try {
        io.to(room).emit(event, { ...payload, isTyping: false });
      } catch {
        /* noop */
      }
    }, delayMs);
  } catch {
    /* noop */
  }
}

function sharedInterest(a: BotPersona, b: BotPersona): number {
  const ta = Object.keys(a.interests.topics || {});
  const tb = Object.keys(b.interests.topics || {});
  const set = new Set(tb);
  const overlap = ta.filter((t) => set.has(t)).length;
  return ta.length ? overlap / Math.max(ta.length, 1) : 0;
}

/** Map a community back to an interest topic (stored field, else by name). */
function communityTopicFor(community: any): string | undefined {
  // Preferred: the topic stored at creation (set for every simulated community).
  if (community?.topic) return community.topic;
  // Fallback: guess from the name (older communities created before the field).
  const name = (community?.name || "").toLowerCase();
  for (const [topic, names] of Object.entries(COMMUNITY_NAMES)) {
    if ((names as string[]).some((n) => name.includes(n.toLowerCase().split(" ")[0]))) return topic;
  }
  return undefined;
}
