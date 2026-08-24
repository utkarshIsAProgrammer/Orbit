/**
 * scheduler.ts — the farm heartbeat.
 *
 * A single loop wakes every `tickMs`, and for every bot that is awake,
 * rolls the dice against its routine rates (scaled by personality + the
 * admin's intensity slider) and triggers one human-scale action: post,
 * glimpse, like, comment, message, follow, reply, react. Actions are
 * spread across bots and randomized, so the farm never bursts — it just
 * keeps "something happening" at a human pace.
 *
 * Clustering safety: only the process holding the Mongo leadership lease
 * runs ticks, so a multi-worker deployment never double-acts.
 */

import mongoose from "mongoose";
import { Bot, BotFarm } from "../../models/bot.model";
import { markUserOnline, markUserOffline, getIO } from "../../configs/socket";
import { logger } from "../../utilities/logger";
import type { BotDoc } from "./lifeState";
import { isAwake, markWakeOrSleep, decayLife, energyAtHour, moodTone, localHour } from "./lifeState";
import {
  pickTargetBot,
  pickRealUserTarget,
  doPost,
  doGlimpse,
  doLike,
  doComment,
  doMessage,
  doFollow,
  doReplyMessage,
  doGlimpseReaction,
  doCreateCommunity,
  doJoinCommunity,
  doCommunityMessage,
  doReactToCommunityMessage,
  doReplyToComment,
  doMessageReaction,
  doEditOwnMessage,
  doBrowse,
  doInitiateMessage,
  doTextOnlyPost,
  doQuoteRepost,
  doPollPost,
  doRotateStatus,
  doFollowUpMessage,
  doVoteOnPoll,
  doSavePost,
  doReactToRealGlimpse,
  doEvolveProfile,
  doMissedCall,
  doPlainRepost,
  doCommentReaction,
  doMilestonePost,
  doChangeAvatar,
  doGlimpseReply,
  doVoiceNote,
  emitHesitationTyping,
  personaFromBot,
} from "./actions";
import { botRand, generateMessage, generateReplyToMessage, generateGoodmorning, generateGoodnight, contentRand } from "./brain";
import Comment from "../../models/comment.model";
import { doRomanceStep } from "./romance";
import { doConflictStep } from "./conflict";
import Post from "../../models/post.model";
import { Message } from "../../models/message.model";
import Follow from "../../models/follow.model";
import Glimpse from "../../models/glimpse.model";
import { Community } from "../../models/community.model";
import { CommunityMessage } from "../../models/communityMessage.model";
import { User } from "../../models/user.model";
import { Conversation } from "../../models/conversation.model";
import { applyBond, topBonds, otherParty, bondBetween } from "./socialGraph";

const LEASE_MS = 60_000;
// Presence sync cadence — awake bots appear "online" (green dots) and
// sleeping ones drop offline, exactly like real users connecting/disconnecting.
const PRESENCE_SYNC_MS = 5 * 60 * 1000;

let interval: NodeJS.Timeout | null = null;
let runningToken: string | null = null;
let lastPresenceSync = 0;

// ── Left-on-read cooldown ────────────────────────────────────────────────
// Real humans sometimes read a message and DON'T reply for a while. A tiny
// chance per pending DM makes the bot "leave on read" (mark seen, no reply)
// and sets a cooldown so the guaranteed-reply pass skips that person for a
// couple of hours — the reply eventually happens, just not instantly, which
// reads far more human than a 100% auto-answer rate.
const leftOnReadUntil = new Map<string, number>(); // key `${botId}:${userId}` -> epoch ms

function isLeftOnRead(bot: BotDoc, userId: string): boolean {
  const until = leftOnReadUntil.get(`${bot.botId}:${userId}`);
  return !!until && until > Date.now();
}

function setLeftOnRead(bot: BotDoc, userId: string, hours: number): void {
  leftOnReadUntil.set(`${bot.botId}:${userId}`, Date.now() + hours * 3600000);
}

export function getFarmConfig(): Promise<any> {
  return BotFarm.findByIdAndUpdate(
    "farm",
    {
      $setOnInsert: { _id: "farm", enabled: false, count: 0, intensity: 5, tickMs: 45000, startedAt: null },
      // ALWAYS reflect the live env: `aiEnabled` was previously written only
      // via $setOnInsert, so a farm created before GEMINI_API_KEY was set
      // kept a stale `false` forever — the admin panel (which reads the env
      // live) showed "AI enabled" while the scheduler silently used only
      // templates for replies.
      $set: { aiEnabled: !!process.env.GEMINI_API_KEY },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
}

export async function getFarmStatus(): Promise<any> {
  const [config, botCount] = await Promise.all([
    getFarmConfig(),
    Bot.countDocuments({}),
  ]);
  return {
    ...config,
    botCount,
    aiEnabled: !!process.env.GEMINI_API_KEY,
    leader: runningToken,
    running: interval !== null,
  };
}

/** Try to become the scheduler leader. Returns true if we hold the lease. */
async function acquireLeadership(config: any): Promise<boolean> {
  const token = runningToken || (runningToken = `${process.pid}-${Date.now()}`);
  const now = Date.now();
  const res = await BotFarm.findOneAndUpdate(
    {
      _id: "farm",
      $or: [{ leaderUntil: { $lt: now } }, { leaderToken: token }],
    },
    { $set: { leaderToken: token, leaderUntil: now + LEASE_MS } },
    { new: true },
  );
  return !!res;
}

async function logAction(bot: BotDoc, action: string, detail: string): Promise<void> {
  try {
    const config = await getFarmConfig();
    const recent = config.recentActions || [];
    recent.unshift({ botId: bot.botId, name: bot.name, action, detail, at: Date.now() });
    await BotFarm.updateOne({ _id: "farm" }, { $set: { recentActions: recent.slice(0, 40) } });
  } catch (e: any) {
    logger.warn("bot logAction failed", { error: e.message });
  }
}

/** Find a recent post to engage with: another bot's or a real user's. */
async function pickRecentPost(bot: BotDoc, preferReal: boolean): Promise<{ post: any; authorId: string } | null> {
  try {
    const botDocs = await Bot.find({}).select("userId").lean();
    const botUserIds = botDocs
      .map((b) => b.userId?.toString())
      .filter((id): id is string => !!id);
    const myId = bot.userId?.toString();

    const match: any = { status: "published" };
    if (myId) match.author = { $ne: myId };
    if (preferReal && botUserIds.length) {
      match.author = { ...(match.author || {}), $nin: botUserIds.map((id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id)) };
    }

    const post = await Post.findOne(match)
      .sort({ createdAt: -1 })
      .select("_id author content")
      .lean();
    if (!post) return null;
    return { post, authorId: post.author.toString() };
  } catch (e: any) {
    logger.warn("bot pickRecentPost failed", { error: e.message });
    return null;
  }
}

/** Find a real conversation where someone messaged this bot and it hasn't replied. */
async function findPendingConversation(bot: BotDoc): Promise<{ conversationId: string; theirUserId: string; theirText: string } | null> {
  try {
    const myId = bot.userId?.toString();
    if (!myId) return null;

    const latest = await Message.findOne({ recipient: myId, isDeleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .select("conversation sender text createdAt")
      .lean();
    if (!latest) return null;

    const theirUserId = latest.sender.toString();
    const theirText = latest.text || "";

    // Did we already reply after this message?
    const replied = await Message.exists({
      conversation: latest.conversation,
      sender: myId,
      createdAt: { $gt: latest.createdAt },
    });
    if (replied) return null;

    return { conversationId: latest.conversation.toString(), theirUserId, theirText };
  } catch (e: any) {
    logger.warn("bot findPendingConversation failed", { error: e.message });
    return null;
  }
}

// Cached list of bot user IDs (to tell real users apart from other bots).
let botUserIdsCache: string[] | null = null;
let botUserIdsCachedAt = 0;

async function botUserIds(): Promise<string[]> {
  if (botUserIdsCache && Date.now() - botUserIdsCachedAt < 60_000) return botUserIdsCache;
  const docs = await Bot.find({}).select("userId").lean();
  botUserIdsCache = docs
    .map((b) => b.userId?.toString())
    .filter((id): id is string => !!id);
  botUserIdsCachedAt = Date.now();
  return botUserIdsCache;
}

/** A pending DM from a REAL user (not another bot) that hasn't been answered. */
async function findPendingUserConversation(bot: BotDoc): Promise<{ conversationId: string; theirUserId: string; theirText: string; theirMessageId: string } | null> {
  try {
    const myId = bot.userId?.toString();
    if (!myId) return null;
    const bots = await botUserIds();

    const latest = await Message.findOne({ recipient: myId, isDeleted: { $ne: true }, sender: { $nin: bots } })
      .sort({ createdAt: -1 })
      .select("conversation sender text createdAt")
      .lean();
    if (!latest) return null;

    const theirUserId = latest.sender.toString();
    // The bot left this person on read recently — no guaranteed reply yet.
    if (isLeftOnRead(bot, theirUserId)) return null;

    const replied = await Message.exists({
      conversation: latest.conversation,
      sender: myId,
      createdAt: { $gt: latest.createdAt },
    });
    if (replied) return null;

    return {
      conversationId: latest.conversation.toString(),
      theirUserId,
      theirText: latest.text || "",
      theirMessageId: latest._id.toString(),
    };
  } catch {
    return null;
  }
}

/** A comment by a REAL user on one of the bot's posts that hasn't been replied to. */
async function findPendingCommentReply(bot: BotDoc): Promise<{ postId: string; postAuthorId: string; comment: any } | null> {
  try {
    const myId = bot.userId?.toString();
    if (!myId) return null;
    const bots = await botUserIds();

    // The bot's own posts (all of them — a user may comment on an older one)
    const myPosts = await Post.find({ author: myId, status: "published" })
      .sort({ createdAt: -1 })
      .select("_id")
      .lean();
    if (myPosts.length === 0) return null;
    const myPostIds = myPosts.map((p) => p._id);

    const comment = await Comment.findOne({
      post: { $in: myPostIds },
      author: { $nin: bots },
      isDeleted: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .select("_id content author post")
      .lean();
    if (!comment) return null;

    // Already replied to this comment? (a bot reply has parent = comment._id)
    const replied = await Comment.exists({ parent: comment._id, author: myId });
    if (replied) return null;

    return { postId: comment.post?.toString() || "", postAuthorId: myId, comment };
  } catch {
    return null;
  }
}

/**
 * A comment that REPLIES to one of the bot's own comments (2-level thread)
 * and hasn't been answered yet. Two flavours:
 *   1. real user replied to bot's comment → bot must reply back (guaranteed)
 *   2. another bot replied to the bot's comment → bot replies for bot↔bot
 *      threads that keep the conversation alive (random activity)
 */
async function findPendingNestedCommentReply(bot: BotDoc): Promise<{ comment: any; byRealUser: boolean } | null> {
  try {
    const myId = bot.userId?.toString();
    if (!myId) return null;
    const bots = await botUserIds();

    // The bot's own comments (all of them)
    const myComments = await Comment.find({ author: myId, isDeleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .select("_id")
      .lean();
    if (myComments.length === 0) return null;
    const myCommentIds = myComments.map((c) => c._id);

    // A reply to one of my comments, not by me, not deleted, unanswered.
    // Prefer real-user replies (they must be answered); bot replies are the
    // random-activity flavour and are only picked when no real reply exists.
    const realReply = await Comment.findOne({
      parent: { $in: myCommentIds },
      author: { $nin: [...bots, myId] },
      isDeleted: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .select("_id content author post")
      .lean();
    if (realReply) {
      const replied = await Comment.exists({ parent: realReply._id, author: myId });
      if (!replied) return { comment: realReply, byRealUser: true };
    }

    const botReply = await Comment.findOne({
      parent: { $in: myCommentIds },
      author: { $in: bots, $ne: myId },
      isDeleted: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .select("_id content author post")
      .lean();
    if (botReply) {
      const replied = await Comment.exists({ parent: botReply._id, author: myId });
      if (!replied) return { comment: botReply, byRealUser: false };
    }
    return null;
  } catch {
    return null;
  }
}

/** A community the bot is in where a REAL user spoke after the bot's last message. */
async function findPendingCommunityReply(bot: BotDoc): Promise<any | null> {
  try {
    const myId = bot.userId?.toString();
    if (!myId) return null;
    const bots = await botUserIds();

    const community = await pickBotCommunity(bot);
    if (!community) return null;

    const lastMine = await CommunityMessage.findOne({ community: community._id, sender: myId })
      .sort({ createdAt: -1 })
      .select("createdAt")
      .lean();

    const realMsg = await CommunityMessage.findOne({
      community: community._id,
      isDeleted: { $ne: true },
      sender: { $nin: bots },
      ...(lastMine ? { createdAt: { $gt: lastMine.createdAt } } : {}),
    })
      .sort({ createdAt: -1 })
      .select("_id")
      .lean();
    if (!realMsg) return null;

    return community;
  } catch {
    return null;
  }
}

/** A user who follows the bot but the bot hasn't followed back. */
async function findFollowBackTarget(bot: BotDoc): Promise<string | null> {
  try {
    const myId = bot.userId?.toString();
    if (!myId) return null;
    const follow = await Follow.findOne({ following: myId })
      .sort({ createdAt: -1 })
      .select("follower")
      .lean();
    if (!follow) return null;
    const already = await Follow.exists({ follower: myId, following: follow.follower });
    if (already) return null;
    return follow.follower.toString();
  } catch {
    return null;
  }
}

/** The bot's interest topics (the ones it would actually talk about). */
function botTopics(bot: BotDoc): string[] {
  return Object.keys(bot.interests?.topics || {});
}

/**
 * A simulated community the bot is already a member of — prefers one that
 * matches the bot's interests (its own created community is the top pick),
 * so bots keep chatting about the topic they created the community for.
 */
async function pickBotCommunity(bot: BotDoc): Promise<any | null> {
  try {
    const myId = bot.userId?.toString();
    if (!myId) return null;
    const topics = botTopics(bot);

    // 1. My own created community first — I keep the conversation going there.
    const mine = await Community.findOne({
      isSimulated: true,
      creator: myId,
      "members.user": myId,
    }).sort({ updatedAt: -1 });
    if (mine) return (mine as any) || null;

    // 2. Any community matching one of my interest topics.
    if (topics.length) {
      const matched = await Community.findOne({
        isSimulated: true,
        "members.user": myId,
        topic: { $in: topics },
      }).sort({ updatedAt: -1 });
      if (matched) return (matched as any) || null;
    }

    // 3. Any community I'm in (fallback).
    const any = await Community.findOne({
      isSimulated: true,
      "members.user": myId,
    }).sort({ updatedAt: -1 });
    return (any as any) || null;
  } catch {
    return null;
  }
}

/** A simulated community the bot is NOT in yet — prefers friends' communities. */
async function findCommunityToJoin(bot: BotDoc): Promise<any | null> {
  try {
    const myId = bot.userId?.toString();
    if (!myId) return null;

    // Prefer communities created by bots we have a relationship with
    const friendBotIds = (bot.relationships || [])
      .filter((r: any) => r.bond > 0.1)
      .map((r: any) => otherParty(r, bot.botId));
    if (friendBotIds.length) {
      const friendBots = await Bot.find({ botId: { $in: friendBotIds } }).select("userId").lean();
      const friendUserIds = friendBots
        .map((b) => b.userId?.toString())
        .filter((id): id is string => !!id)
        .map((id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id));
      if (friendUserIds.length) {
        const byFriend = await Community.findOne({
          isSimulated: true,
          creator: { $in: friendUserIds },
          "members.user": { $ne: myId },
        }).sort({ memberCount: -1 });
        if (byFriend) return (byFriend as any) || null;
      }
    }

    // Prefer a community matching this bot's interests, then any.
    const topics = botTopics(bot);
    if (topics.length) {
      const matched = await Community.findOne({
        isSimulated: true,
        topic: { $in: topics },
        "members.user": { $ne: myId },
      }).sort({ memberCount: -1 });
      if (matched) return (matched as any) || null;
    }

    const any = await Community.findOne({
      isSimulated: true,
      "members.user": { $ne: myId },
    }).sort({ memberCount: -1 });
    return (any as any) || null;
  } catch {
    return null;
  }
}

/** A recent message in a community the bot belongs to (for reactions). */
async function pickCommunityMessageToReact(bot: BotDoc): Promise<string | null> {
  try {
    const myId = bot.userId?.toString();
    if (!myId) return null;
    const community = await pickBotCommunity(bot);
    if (!community) return null;
    const msg = await CommunityMessage.findOne({
      community: community._id,
      sender: { $ne: myId },
      isDeleted: { $ne: true },
    }).sort({ createdAt: -1 });
    return msg ? msg._id.toString() : null;
  } catch {
    return null;
  }
}

/** Pick a live glimpse (from another bot) to react to. */
async function pickRecentGlimpse(bot: BotDoc): Promise<any | null> {
  try {
    const botDocs = await Bot.find({}).select("userId").lean();
    const botUserIds = botDocs
      .map((b) => b.userId?.toString())
      .filter((id): id is string => !!id)
      .map((id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id));
    const myId = bot.userId?.toString();
    // Note: NOT lean — doGlimpseReaction saves the reactions array on the doc
    const glimpse = await Glimpse.findOne({
      author: { $in: botUserIds, ...(myId ? { $ne: myId } : {}) },
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });
    return (glimpse as any) || null;
  } catch {
    return null;
  }
}

async function decideAndAct(bot: BotDoc, config: any): Promise<void> {
  const rand = botRand(bot.botId);
  const now = Date.now();

  await markWakeOrSleep(bot, now);

  // ── Sleep/wake transition greetings ─────────────────────────────────
  // Humans post "good morning ☀️" shortly after waking and "night night"
  // when they head to bed. Fire these on the actual transition (the tick
  // where lastWakeAt/lastSleepAt was just stamped) — BEFORE the dice gate
  // and before the awake-check below, so night owls can still say goodnight.
  try {
    const tickSpan = config.tickMs || 45000;
    // Just woke up → occasionally a good-morning post (fire-and-forget)
    if (bot.lastWakeAt && now - bot.lastWakeAt < tickSpan * 1.5 && Math.random() < 0.45) {
      const persona = personaFromBot(bot);
      void doTextOnlyPost(bot, generateGoodmorning(persona, contentRand(bot.botId)))
        .then((p) => { if (p) return logAction(bot, "good_morning", "good morning post"); })
        .catch(() => {});
    }
    // Just went to sleep → occasionally a good-night post
    if (bot.lastSleepAt && now - bot.lastSleepAt < tickSpan * 1.5 && Math.random() < 0.35) {
      const persona = personaFromBot(bot);
      void doTextOnlyPost(bot, generateGoodnight(persona, contentRand(bot.botId)))
        .then((p) => { if (p) return logAction(bot, "good_night", "good night post"); })
        .catch(() => {});
    }
  } catch (e: any) {
    logger.warn("bot greeting failed", { botId: bot.botId, error: e.message });
  }

  // ── GUARANTEED replies to real users ────────────────────────────────
  // Runs EVERY tick, NOT gated by the activity dice or sleep schedule, so a
  // real user who DMs, comments, speaks in a community or follows a bot gets
  // a reply within a tick or two no matter what. Falls through if nothing
  // is pending, and skips the random action when it did reply (one action
  // per tick keeps the farm human-paced).
  try {
    const replied = await respondToRealUsers(bot, config);
    if (replied) return;
  } catch (e: any) {
    logger.warn("bot respondToRealUsers failed", { botId: bot.botId, error: e.message });
  }

  if (!isAwake(bot, now)) return;

  // Peak hours follow the bot's LOCAL timezone, not the server's UTC.
  const hour = localHour(bot, now);
  const [peakStart, peakEnd] = bot.routine.peakHours || [18, 22];
  const inPeak = hour >= peakStart && hour < peakEnd;

  const intensityScale = (config.intensity || 5) / 5;
  // Lively-but-human baseline: ~18 actions/day at intensity 5, scaled by the
  // slider and the bot's own personality (extroverts post & engage more).
  const dailyEngagements = (bot.routine.engagementsPerDay || 18) * 1.5 * intensityScale;
  let p = dailyEngagements * (config.tickMs || 45000) / 86_400_000;
  p *= inPeak ? 1.8 : 0.6; // humans are more social in the evening
  p = Math.min(0.65, p);

  if (rand() > p) return;

  // Wake-up moment: morning greeting + relationship decay review (local hour)
  if (bot.lastWakeAt && localHour(bot, bot.lastWakeAt) !== hour && hour === bot.routine.wakeHour) {
    try { await decayLife(bot); } catch (e: any) { logger.warn("bot decay failed", { error: e.message }); }
  }

  // Weighted activity choice
  const roll = rand();
  try {
    let acted = false;
    if (roll < 0.06) {
      const post = await doPost(bot);
      if (post) { acted = true; await logAction(bot, "post", (post.content || "").slice(0, 60)); }
    } else if (roll < 0.09) {
      // poll post — "which one?" questions are everywhere in real feeds
      const post = await doPollPost(bot);
      if (post) { acted = true; await logAction(bot, "poll_post", "posted a poll"); }
    } else if (roll < 0.12) {
      // quote-repost another post with a take
      const post = await doQuoteRepost(bot);
      if (post) { acted = true; await logAction(bot, "quote_repost", "quote-reposted a post"); }
    } else if (roll < 0.15) {
      // plain repost (no commentary) — the most common repost type
      const ok = await doPlainRepost(bot);
      if (ok) { acted = true; await logAction(bot, "repost", "reposted a post"); }
    } else if (roll < 0.21) {
      const glimpse = await doGlimpse(bot);
      if (glimpse) { acted = true; await logAction(bot, "glimpse", "posted a 24h glance"); }
    } else if (roll < 0.37) {
      // browse — quiet doomscrolling that racks up view counts
      const ok = await doBrowse(bot);
      if (ok) acted = true;
    } else if (roll < 0.44) {
      // like — real user's post 40% of the time so real users feel seen
      const target = await pickRecentPost(bot, rand() < 0.4);
      if (target) {
        const ok = await doLike(bot, target.post._id.toString(), target.authorId);
        if (ok) { acted = true; await logAction(bot, "like", `liked ${target.authorId.slice(-6)}'s post`); }
      }
    } else if (roll < 0.49) {
      // save/bookmark a post — humans save things constantly
      const ok = await doSavePost(bot);
      if (ok) { acted = true; await logAction(bot, "save", "saved a post"); }
    } else if (roll < 0.53) {
      // vote on a poll — real users' polls fill up like real life
      const ok = await doVoteOnPoll(bot);
      if (ok) { acted = true; await logAction(bot, "poll_vote", "voted on a poll"); }
    } else if (roll < 0.57) {
      // react to a comment with an emoji — humans ❤️ comments constantly
      const ok = await doCommentReaction(bot);
      if (ok) { acted = true; await logAction(bot, "comment_reaction", "reacted to a comment"); }
    } else if (roll < 0.615) {
      // follower-milestone celebration when growth crosses a threshold
      const ok = await doMilestonePost(bot);
      if (ok) { acted = true; await logAction(bot, "milestone", "celebrated a follower milestone"); }
    } else if (roll < 0.66) {
      const target = await pickRecentPost(bot, rand() < 0.35);
      if (target) {
        const comment = await doComment(bot, target.post._id.toString(), target.authorId);
        if (comment) { acted = true; await logAction(bot, "comment", (comment.content || "").slice(0, 60)); }
      }
    } else if (roll < 0.65) {
      // nested thread: reply to a bot's reply on the bot's own comment, so
      // comment threads live past depth 1 (bot↔bot conversations)
      const nested = await findPendingNestedCommentReply(bot);
      if (nested && !nested.byRealUser) {
        const reply = await doReplyToComment(bot, nested.comment, config.aiEnabled);
        if (reply) { acted = true; await logAction(bot, "comment_reply", `continued a comment thread`); }
      }
    } else if (roll < 0.72) {
      // message: prefer a bonded bot; occasionally a real user
      const targetBot = rand() < 0.7 ? await pickTargetBot(bot) : null;
      if (targetBot && targetBot.userId) {
        await doMessage(bot, targetBot.userId.toString(), undefined, targetBot.name);
        acted = true; await logAction(bot, "message", `messaged ${targetBot.name}`);
      } else {
        const real = await pickRealUserTarget(bot);
        if (real) {
          await doMessage(bot, real._id.toString(), undefined, real.fullName || real.username);
          acted = true; await logAction(bot, "message", `messaged a real user`);
        }
      }
    } else if (roll < 0.77) {
      // INITIATE a conversation by referencing shared history — proactive,
      // like a real person reaching out ("how did the interview go?")
      const sent = await doInitiateMessage(bot);
      if (sent) { acted = true; await logAction(bot, "initiate", `reached out: ${sent.slice(0, 60)}`); }
    } else if (roll < 0.83) {
      // reply to a pending DM (with AI if enabled)
      const pending = await findPendingConversation(bot);
      if (pending) {
        const ai = config.aiEnabled;
        const reply = await doReplyMessage(bot, pending.conversationId, pending.theirText, pending.theirUserId, ai);
        if (reply) { acted = true; await logAction(bot, "reply", `replied: ${reply.slice(0, 60)}`); }
      }
    } else if (roll < 0.855) {
      // voice note in a DM — real friends drop voice messages
      const ok = await doVoiceNote(bot);
      if (ok) { acted = true; await logAction(bot, "voice_note", "sent a voice note"); }
    } else if (roll < 0.885) {
      // missed call to someone the bot talks to
      const ok = await doMissedCall(bot);
      if (ok) { acted = true; await logAction(bot, "missed_call", "missed a call"); }
    } else if (roll < 0.93) {
      // follow_back or a new follow
      const fb = await findFollowBackTarget(bot);
      if (fb) {
        const ok = await doFollow(bot, fb);
        if (ok) { acted = true; await logAction(bot, "follow_back", `followed back ${fb.slice(-6)}`); }
      } else {
        const targetBot = await pickTargetBot(bot);
        if (targetBot && targetBot.userId && bondBetween(bot.relationships || [], bot.botId, targetBot.botId) < 0.3) {
          await doFollow(bot, targetBot.userId.toString());
          acted = true; await logAction(bot, "follow", `followed ${targetBot.name}`);
        }
      }
    } else if (roll < 0.95) {
      // DM follow-up to an older conversation ("that thing you said…")
      const sent = await doFollowUpMessage(bot);
      if (sent) { acted = true; await logAction(bot, "follow_up", `followed up: ${sent.slice(0, 60)}`); }
    } else if (roll < 0.965) {
      // rotate status line OR change avatar — profiles feel alive
      if (rand() < 0.6) {
        const ok = await doRotateStatus(bot);
        if (ok) { acted = true; await logAction(bot, "status", `updated status`); }
      } else {
        const ok = await doChangeAvatar(bot);
        if (ok) { acted = true; await logAction(bot, "avatar", "changed profile pic"); }
      }
    } else if (roll < 0.975) {
      // reply to a real user's story with a message
      const ok = await doGlimpseReply(bot);
      if (ok) { acted = true; await logAction(bot, "glimpse_reply", "replied to a real user's glance"); }
    } else if (roll < 0.985) {
      // community life: message in a community, or start one if we have none
      const community = await pickBotCommunity(bot);
      if (community) {
        const ai = config.aiEnabled;
        const text = await doCommunityMessage(bot, community, ai);
        if (text) { acted = true; await logAction(bot, "community_message", `${community.name}: ${text.slice(0, 60)}`); }
      } else {
        const created = await doCreateCommunity(bot);
        if (created) { acted = true; await logAction(bot, "community_create", `created ${created.name}`); }
      }
    } else if (roll < 0.99) {
      // join a friend's community / create one if we have no circle home
      const community = await findCommunityToJoin(bot);
      if (community) {
        const ok = await doJoinCommunity(bot, community._id.toString());
        if (ok) { acted = true; await logAction(bot, "community_join", `joined ${community.name}`); }
      } else {
        const created = await doCreateCommunity(bot);
        if (created) { acted = true; await logAction(bot, "community_create", `created ${created.name}`); }
      }
    } else if (roll < 0.993) {
      // react: glimpse (bot's OR a real user's) OR a community message
      const r2 = rand();
      if (r2 < 0.3) {
        const glimpse = await pickRecentGlimpse(bot);
        if (glimpse) {
          const ok = await doGlimpseReaction(bot, glimpse);
          if (ok) { acted = true; await logAction(bot, "glimpse_reaction", `reacted to ${glimpse.author.toString().slice(-6)}'s glance`); }
        }
      } else if (r2 < 0.55) {
        // REAL user's story — they get reactions too, not just bots
        const ok = await doReactToRealGlimpse(bot);
        if (ok) { acted = true; await logAction(bot, "glimpse_reaction", `reacted to a real user's glance`); }
      } else {
        const msgId = await pickCommunityMessageToReact(bot);
        if (msgId) {
          const ok = await doReactToCommunityMessage(bot, msgId);
          if (ok) { acted = true; await logAction(bot, "community_reaction", `reacted in a community`); }
        }
      }
    } else if (roll < 0.995) {
      // evolve profile — bio refresh, like a real person updating their page
      const ok = await doEvolveProfile(bot);
      if (ok) { acted = true; await logAction(bot, "profile", "updated their bio"); }
    } else if (roll < 0.9975) {
      // romance: crushes → confessions → dating → (occasional heartbreak)
      const out = await doRomanceStep(bot, rand);
      if (out) { acted = true; await logAction(bot, out.action, out.detail); }
    } else {
      // conflict: trolls, retaliation, friends defending each other
      const out = await doConflictStep(bot, rand);
      if (out) { acted = true; await logAction(bot, out.action, out.detail); }
    }

    // ── Bursty activity ────────────────────────────────────────────────
    // Humans act in clusters (post + reply to comments + like a few things
    // in one sitting), not one isolated action per hour. When a bot DID
    // act this tick, there's a small extravert-scaled chance it follows up
    // with 1-2 quick quiet actions (browse/like/react) within the next few
    // minutes.
    if (acted) {
      const extraversion = bot.personality?.extraversion ?? 0.5;
      const burstChance = 0.08 + extraversion * 0.14; // ~15-19%
      if (Math.random() < burstChance) {
        const burstCount = 1 + Math.floor(Math.random() * 2); // 1-2 follow-ups
        for (let i = 0; i < burstCount; i++) {
          // Space them out like a real scrolling session
          await sleep(5000 + Math.random() * 20000);
          const r2 = Math.random();
          if (r2 < 0.4) {
            await doBrowse(bot);
          } else if (r2 < 0.75) {
            const target = await pickRecentPost(bot, rand() < 0.5);
            if (target) await doLike(bot, target.post._id.toString(), target.authorId);
          } else if (r2 < 0.9) {
            const msgId = await pickCommunityMessageToReact(bot);
            if (msgId) await doReactToCommunityMessage(bot, msgId);
          } else {
            const glimpse = await pickRecentGlimpse(bot);
            if (glimpse) await doGlimpseReaction(bot, glimpse);
          }
        }
      }
    }
  } catch (e: any) {
    logger.warn("bot tick action failed", { botId: bot.botId, error: e.message });
  }
}

/**
 * Human-like response timing, derived from the bot's personality:
 *   • extraverts reply faster, introverts take a beat
 *   • long messages take longer to type (scaled by length)
 * Returns { readMs, typingMs } so the caller can stage: mark-seen, then
 * typing indicator, then the actual message lands.
 */
function humanTiming(bot: BotDoc, messageLength: number): { readMs: number; typingMs: number } {
  const extraversion = bot.personality?.extraversion ?? 0.5;
  const neuroticism = bot.personality?.neuroticism ?? 0.5;
  // Reading: quick glance for extraverts, longer dwell for neurotic bots.
  const readMs = 1500 + (1 - extraversion) * 6000 + neuroticism * 3000 + Math.random() * 2500;
  // Typing: ~25ms/char up to a cap, slower when neurotic (re-reading).
  const typingMs = Math.min(12_000, 900 + messageLength * 28) + neuroticism * 3000 + Math.random() * 2500;
  return { readMs: Math.round(readMs), typingMs: Math.round(typingMs) };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Mark the user's messages in a conversation as seen (blue ticks), like the
 *  bot actually opened the chat. Mirrors the real chat:join seen-marking. */
async function markBotRead(conversationId: string, botUserId: string, theirUserId: string): Promise<void> {
  try {
    await Message.updateMany(
      { conversation: conversationId, recipient: botUserId, seen: false },
      { $set: { seen: true, seenAt: new Date() } },
    );
    const io = getIO();
    io.to(`conversation:${conversationId}`).emit("messages:seen", {
      conversationId,
      seenBy: botUserId,
      seenAt: new Date(),
    });
    // Clear the unread badge the bot "has" on this conversation.
    await Conversation.findByIdAndUpdate(conversationId, {
      $set: { [`unreadCounts.${botUserId}`]: 0, [`unreadCounts.${theirUserId}`]: 0 },
    });
  } catch (e: any) {
    logger.warn("bot markRead failed", { error: e.message });
  }
}

/**
 * GUARANTEED replies to real users. Runs every tick, before any dice rolls
 * and regardless of the bot's sleep schedule, so a real user who interacts
 * always gets an answer quickly — but with HUMAN timing: the bot "reads"
 * the message (blue ticks), shows a typing indicator for a personality- and
 * length-scaled duration, then the reply lands. Returns true when it staged
 * a reply (the caller skips the random action).
 *   1. DM from a real user that hasn't been answered → staged reply
 *   2. Comment by a real user on the bot's post → reply to the comment
 *   3. Real user spoke in a community the bot is in → respond there
 *   4. Real user followed the bot → follow back
 */
async function respondToRealUsers(bot: BotDoc, config: any): Promise<boolean> {
  const ai = config.aiEnabled;

  // 1. Pending DM from a real user — stage a human-timed reply
  const pendingDm = await findPendingUserConversation(bot);
  if (pendingDm) {
    const botUserId = bot.userId?.toString() || "";
    if (!botUserId) return false;
    const { readMs, typingMs } = humanTiming(bot, (pendingDm.theirText || "").length);

    // The bot is "online" while it replies — the user sees the green dot
    // instead of an offline account suddenly messaging them.
    await markUserOnline(botUserId).catch(() => {});

    // Humans sometimes just react with an emoji instead of typing a reply.
    if (Math.random() < 0.12) {
      setTimeout(() => {
        void doMessageReaction(bot, pendingDm.theirMessageId, pendingDm.conversationId).catch(() => {});
      }, readMs + Math.random() * 3000);
      return true;
    }

    // And sometimes they read the message and leave it on read for a while.
    // Mark seen (blue ticks) after the read delay, but DON'T reply, and set
    // a cooldown so the guaranteed pass skips them for 1-3 hours.
    if (Math.random() < 0.06) {
      void (async () => {
        try {
          await sleep(readMs);
          await markBotRead(pendingDm.conversationId, botUserId, pendingDm.theirUserId);
        } catch (e: any) {
          logger.warn("bot left-on-read failed", { botId: bot.botId, error: e.message });
        }
      })();
      setLeftOnRead(bot, pendingDm.theirUserId, 1 + Math.random() * 2);
      return true;
    }

    // Mark messages as seen after the "reading" delay, then show typing,
    // then let the reply land. Fire-and-forget so the tick isn't blocked.
    void (async () => {
      try {
        await sleep(readMs);
        await markBotRead(pendingDm.conversationId, botUserId, pendingDm.theirUserId);
        // ~18% of the time the bot "hesitates": types, deletes, retypes —
        // the typing bubble pulses off and on before the reply lands.
        if (Math.random() < 0.18) {
          emitHesitationTyping(
            `conversation:${pendingDm.conversationId}`,
            "chat:typing",
            { conversationId: pendingDm.conversationId, userId: botUserId },
            700 + Math.random() * 900,
          );
        }
        await sleep(typingMs);
        const reply = await doReplyMessage(bot, pendingDm.conversationId, pendingDm.theirText, pendingDm.theirUserId, ai, typingMs);
        if (reply) await logAction(bot, "reply", `replied to a real user's DM`);

        // Loop closure: occasionally react ❤️ to the user's message too, even
        // after typing a reply — real people double-signal.
        if (reply && Math.random() < 0.14) {
          setTimeout(() => {
            void doMessageReaction(bot, pendingDm.theirMessageId, pendingDm.conversationId).catch(() => {});
          }, 1000 + Math.random() * 4000);
        }

        // The reply message id (for the occasional "typo fix" edit below).
        let replyMessageId: string | null = null;
        if (reply) {
          const last = await Message.findOne({
            conversation: pendingDm.conversationId,
            sender: botUserId,
            isDeleted: { $ne: true },
          })
            .sort({ createdAt: -1 })
            .select("_id")
            .lean();
          replyMessageId = last ? last._id.toString() : null;
        }

        // Humans sometimes send a short follow-up a few seconds later.
        if (reply && Math.random() < 0.35) {
          const persona = personaFromBot(bot);
          const followUp = generateMessage(persona, "there", false, pendingDm.theirText, contentRand(bot.botId));
          setTimeout(() => {
            void doMessage(bot, pendingDm.theirUserId, followUp, "there").catch(() => {});
          }, 2500 + Math.random() * 6000);
        }

        // And occasionally "fix a typo" on the reply — the edited badge
        // appears a few seconds after the message lands.
        if (replyMessageId && Math.random() < 0.12) {
          const editMsgId = replyMessageId;
          setTimeout(() => {
            void doEditOwnMessage(bot, editMsgId, pendingDm.conversationId).catch(() => {});
          }, 4000 + Math.random() * 6000);
        }
      } catch (e: any) {
        logger.warn("bot staged DM reply failed", { botId: bot.botId, error: e.message });
      }
    })();
    return true;
  }

  // 2. Comment from a real user on the bot's post — short human pause, no
  //    typing indicator (comments don't have one), then the reply lands.
  const pendingComment = await findPendingCommentReply(bot);
  if (pendingComment) {
    void (async () => {
      try {
        await sleep(2000 + Math.random() * 4000);
        const reply = await doReplyToComment(bot, pendingComment.comment, ai);
        if (reply) await logAction(bot, "comment_reply", `replied to a comment on their post`);
      } catch (e: any) {
        logger.warn("bot staged comment reply failed", { botId: bot.botId, error: e.message });
      }
    })();
    return true;
  }

  // 3. A real user REPLIED to one of the bot's comments (nested thread) —
  //    reply back so threads don't die at depth 1.
  const nested = await findPendingNestedCommentReply(bot);
  if (nested?.byRealUser) {
    void (async () => {
      try {
        await sleep(2000 + Math.random() * 4000);
        const reply = await doReplyToComment(bot, nested.comment, ai);
        if (reply) await logAction(bot, "comment_reply", `replied to a reply on their comment`);
      } catch (e: any) {
        logger.warn("bot staged nested comment reply failed", { botId: bot.botId, error: e.message });
      }
    })();
    return true;
  }

  // 4. Real user spoke in a community the bot is in — short pause, then a
  //    typed reply in the community.
  const community = await findPendingCommunityReply(bot);
  if (community) {
    void (async () => {
      try {
        await sleep(2000 + Math.random() * 5000);
        const typingMs = 1200 + Math.random() * 2500;
        const text = await doCommunityMessage(bot, community, ai, typingMs);
        if (text) await logAction(bot, "community_reply", `answered in ${community.name}`);
      } catch (e: any) {
        logger.warn("bot staged community reply failed", { botId: bot.botId, error: e.message });
      }
    })();
    return true;
  }

  // 4. Real user followed the bot → follow back (instant is fine)
  const fb = await findFollowBackTarget(bot);
  if (fb) {
    const ok = await doFollow(bot, fb);
    if (ok) {
      await logAction(bot, "follow_back", `followed back ${fb.slice(-6)}`);
      return true;
    }
  }

  return false;
}

/**
 * Sync live presence for every bot: awake = online (green dots in chats and
 * communities, "active now" counts), asleep = offline. Runs on a slow cadence
 * so it never hammers the DB, but presence updates are instant for anyone
 * currently looking at a chat/community.
 */
async function syncBotPresence(bots: any[]): Promise<void> {
  const now = Date.now();
  for (const bot of bots) {
    if (!bot.userId) continue;
    const awake = isAwake(bot, now);
    try {
      if (awake) await markUserOnline(bot.userId.toString());
      else await markUserOffline(bot.userId.toString());
    } catch (e: any) {
      logger.warn("bot presence sync failed", { botId: bot.botId, error: e.message });
    }
  }
}

async function tick(): Promise<void> {
  try {
    const config = await getFarmConfig();
    if (!config.enabled) return;

    const isLeader = await acquireLeadership(config);
    if (!isLeader) return;

    // NOTE: hydrated docs (NOT lean) — decideAndAct/markWakeOrSleep/applyEvent
    // all call bot.save(), which plain lean objects don't have. This bug made
    // every tick throw "bot.save is not a function" and the farm do nothing.
    const bots = await Bot.find({});
    if (bots.length === 0) return;

    // Periodic presence sync (awake bots online, sleeping bots offline)
    if (Date.now() - lastPresenceSync > PRESENCE_SYNC_MS) {
      lastPresenceSync = Date.now();
      await syncBotPresence(bots);
    }

    // Process every bot every tick. The probability gate per bot keeps the
    // farm human-paced (a bot still only acts a few times an hour), but with
    // all bots rolling each tick the app sees steady, visible activity.
    for (const bot of bots) {
      await decideAndAct(bot as any, config);
    }
  } catch (e: any) {
    logger.error("bot farm tick failed", { error: e.message });
  }
}

/** Start the heartbeat. Safe to call multiple times. */
export function startBotFarm(tickMs = 45000): void {
  if (interval) return;
  interval = setInterval(() => {
    void tick();
  }, tickMs);
  interval.unref?.();
  // Fire an immediate tick so activity starts the moment the farm is enabled
  // (or right after boot), instead of waiting a full interval.
  void tick();
  logger.info(`Bot farm scheduler started (tick every ${tickMs}ms)`);
}

export function stopBotFarm(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
