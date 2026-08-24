/**
 * conflict.ts — drama, the human way.
 *
 * Not every interaction is warm. Some bots are prickly (low agreeableness)
 * and occasionally throw shade, which can spiral the way it does in real
 * life:
 *
 *   troll     → a low-agreeableness bot leaves a snarky comment on another
 *               bot's (or real user's) post; the target remembers it
 *   retaliate → a trolled bot with a temper fires back in a DM; the bond
 *               drops and they drift toward "rival"
 *   defend    → a close friend of the trolled bot jumps in publicly and
 *               defends them — bond with the friend rises, bond with the
 *               attacker drops, and the friend remembers being defended
 *
 * Repeated conflict makes bonds go negative → the relationship permanently
 * levels down to "rival" (fallout). Everything flows through the existing
 * memory + bond systems, so moods, memories and circles all react.
 */

import mongoose from "mongoose";
import { Bot } from "../../models/bot.model";
import Post from "../../models/post.model";
import { applyEvent, lastMemory } from "./lifeState";
import type { BotDoc } from "./lifeState";
import { doCommentText, doMessage, personaFromBot } from "./actions";
import { applyBond, otherParty, topBonds } from "./socialGraph";
import {
  generateSnarkComment,
  generateDefendComment,
  generateFightMessage,
} from "./brain";

/** A recent post by someone else (bot or real user) to throw shade at. */
async function pickRecentPostToTroll(bot: BotDoc, rand: () => number): Promise<{ post: any; authorId: string } | null> {
  try {
    const myId = bot.userId?.toString();
    const botDocs = await Bot.find({}).select("userId").lean();
    const botUserIds = botDocs
      .map((b) => b.userId?.toString())
      .filter((id): id is string => !!id)
      .map((id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id));

    const match: any = { status: "published" };
    if (myId) match.author = { $ne: myId };
    // mostly target other bots so the drama stays inside the simulation,
    // but occasionally a real user's post gets a snarky comment too
    if (rand() < 0.8 && botUserIds.length) {
      match.author = { $in: botUserIds };
    }
    const post = await Post.findOne(match).sort({ createdAt: -1 }).select("_id author").lean();
    if (!post) return null;
    return { post, authorId: post.author.toString() };
  } catch {
    return null;
  }
}

/**
 * One conflict step for this bot this tick: troll someone, retaliate for a
 * past troll, or defend a trolled friend. Returns a human-readable action
 * for the admin feed, or null if nothing happened.
 */
export async function doConflictStep(
  bot: BotDoc,
  rand: () => number,
): Promise<{ action: string; detail: string } | null> {
  try {
    const agreeableness = bot.personality?.agreeableness ?? 0.5;
    const neuroticism = bot.personality?.neuroticism ?? 0.5;

    // ── DEFEND: a close friend was trolled recently — jump in ──────────
    if (rand() < 0.45) {
      const friends = topBonds(bot.relationships || [], bot.botId, null, 6).filter(
        (r) => r.isBotPair && r.bond >= 0.5,
      );
      for (const rel of friends) {
        const friendBot = (await Bot.findOne({ botId: otherParty(rel, bot.botId) })) as BotDoc;
        if (!friendBot?.userId) continue;
        const trolled = lastMemory(friendBot, "trolled");
        if (!trolled || !trolled.byBotId || Date.now() - trolled.at > 6 * 3600000) continue;
        if (trolled.byBotId === bot.botId) continue; // don't defend against yourself

        const friendPost = await Post.findOne({
          author: friendBot.userId,
          status: "published",
        }).sort({ createdAt: -1 });
        if (!friendPost) continue;

        const text = generateDefendComment(personaFromBot(bot), friendBot.name);
        await doCommentText(bot, friendPost._id.toString(), friendBot.userId.toString(), text);

        // friend bond up, attacker bond down
        bot.relationships = applyBond(bot.relationships || [], bot.botId, friendBot.botId, "reply", true);
        bot.relationships = applyBond(bot.relationships || [], bot.botId, trolled.byBotId, "negativeReply", true);
        await bot.save();
        await applyEvent(bot, { type: "defended", byBotId: friendBot.botId, content: friendBot.name, valence: 0.3 });
        await applyEvent(friendBot, { type: "defended", byBotId: bot.botId, content: bot.name, valence: 0.5 });
        return { action: "defend", detail: `defended ${friendBot.name} in public 🛡️` };
      }
    }

    // ── RETALIATE: I was trolled recently and I have a temper ──────────
    const trolledMe = lastMemory(bot, "trolled");
    if (trolledMe?.byBotId && Date.now() - trolledMe.at < 3 * 3600000 && rand() < 0.5) {
      const attacker = (await Bot.findOne({ botId: trolledMe.byBotId })) as BotDoc;
      if (attacker?.userId) {
        const text = generateFightMessage(personaFromBot(bot), attacker.name);
        await doMessage(bot, attacker.userId.toString(), text, attacker.name);
        bot.relationships = applyBond(bot.relationships || [], bot.botId, attacker.botId, "negativeReply", true);
        attacker.relationships = applyBond(attacker.relationships || [], attacker.botId, bot.botId, "negativeReply", true);
        await bot.save();
        await attacker.save();
        await applyEvent(bot, { type: "fought", byBotId: attacker.botId, content: attacker.name, valence: -0.2 });
        await applyEvent(attacker, { type: "fought", byBotId: bot.botId, content: bot.name, valence: -0.2 });
        return { action: "retaliate", detail: `fought back at ${attacker.name} ⚔️` };
      }
    }

    // ── TROLL: prickly bots throw shade occasionally ────────────────────
    if (agreeableness < 0.55 && rand() < 0.5) {
      const target = await pickRecentPostToTroll(bot, rand);
      if (!target) return null;
      const text = generateSnarkComment(personaFromBot(bot));
      await doCommentText(bot, target.post._id.toString(), target.authorId, text);

      // if the target is a bot, it remembers being trolled (→ retaliate/defend)
      const targetBot = (await Bot.findOne({ userId: target.authorId })) as BotDoc;
      if (targetBot) {
        targetBot.relationships = applyBond(targetBot.relationships || [], targetBot.botId, bot.botId, "negativeReply", true);
        await applyEvent(targetBot, { type: "trolled", byBotId: bot.botId, content: bot.name, valence: -0.4 });
      }
      // troll also makes the target-author bond drop a little on our side
      bot.relationships = applyBond(bot.relationships || [], bot.botId, targetBot?.botId || target.authorId, "negativeReply", targetBot ? true : false);
      await bot.save();
      await applyEvent(bot, { type: "trolled", byBotId: targetBot?.botId || target.authorId, content: text.slice(0, 60), valence: -0.05 });
      return { action: "troll", detail: `threw shade: "${text.slice(0, 50)}"` };
    }

    return null;
  } catch (e: any) {
    return null;
  }
}
