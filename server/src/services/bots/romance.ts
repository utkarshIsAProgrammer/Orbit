/**
 * romance.ts — the love lifecycle between bots.
 *
 * Real humans catch feelings, confess, date, and sometimes break each
 * other's hearts. Bots now do the same, driven entirely by their existing
 * personality + bond system:
 *
 *   crush   → a bot with a strong bond (and some extraversion/openness)
 *             develops a crush and starts flirty DMs
 *   confess → after a beat, it confesses via DM; the target accepts if the
 *             bond is strong enough or it's agreeable — otherwise rejection
 *   dating  → dating bots DM each other more often and get mood boosts
 *   breakup → occasionally, after a while, someone ends it → heartbreak
 *             (mood crash on both sides, bond drops, they drift apart)
 *
 * A bot can only be in ONE active romance at a time (crushes, confessions
 * and dating are exclusive), just like real people.
 */

import { Bot } from "../../models/bot.model";
import { applyEvent } from "./lifeState";
import type { BotDoc } from "./lifeState";
import { doMessage, personaFromBot } from "./actions";
import { applyBond, bondBetween, otherParty, topBonds } from "./socialGraph";
import { pick } from "./identity";
import {
  generateCrushMessage,
  generateConfessionMessage,
  generateBreakupMessage,
} from "./brain";
import type { Relationship } from "./types";

export type RomanceStatus = "crush" | "confessed" | "dating" | "rejected" | "broke_up";

/** The romance state stored on a relationship (if any). */
export function romanceOf(rel: Relationship): RomanceStatus | null {
  return rel?.romance?.status || null;
}

const ACTIVE = new Set<string>(["crush", "confessed", "dating"]);

/** True if the bot is not currently in any active romance. */
export function isSingle(bot: BotDoc): boolean {
  return !(bot.relationships || []).some((r: Relationship) => ACTIVE.has(romanceOf(r) ?? ""));
}

/** Find the bot's active romance relationship (crush/confessed/dating). */
export function activeRomance(bot: BotDoc): Relationship | null {
  return (bot.relationships || []).find((r: Relationship) => ACTIVE.has(romanceOf(r) ?? "")) || null;
}

/** Set (or clear) the romance state on a bot's relationship with `otherId`. */
export function setRomance(
  bot: BotDoc,
  otherId: string,
  status: RomanceStatus | null,
): void {
  const rel = (bot.relationships || []).find((r: Relationship) => {
    const key = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
    return key(r.a, r.b) === key(bot.botId, otherId);
  });
  if (!rel) return;
  rel.romance = status ? { status, since: Date.now() } : null;
}

/** Pick a believable crush target from the bot's strong bot bonds. */
function crushCandidate(bot: BotDoc): Relationship | null {
  const candidates = topBonds(bot.relationships || [], bot.botId, null, 10).filter(
    (r) => r.isBotPair && r.bond >= 0.35 && !ACTIVE.has(romanceOf(r) ?? ""),
  );
  return candidates.length ? pick(Math.random, candidates) : null;
}

/**
 * One step of the romance lifecycle for this bot this tick. Returns a
 * human-readable action for the admin activity feed, or null if nothing
 * happened (or the bot isn't wired for romance yet).
 */
export async function doRomanceStep(
  bot: BotDoc,
  rand: () => number,
): Promise<{ action: string; detail: string } | null> {
  try {
    const active = activeRomance(bot);

    // ── DATING: enjoy it — DM each other more, bond grows ──────────────
    if (active && romanceOf(active) === "dating") {
      // occasional breakup (rare, only after a while)
      if (
        active.romance?.since &&
        Date.now() - active.romance!.since! > 2 * 3600000 &&
        rand() < 0.12
      ) {
        const target = (await Bot.findOne({ botId: otherParty(active, bot.botId) })) as BotDoc;
        if (target?.userId) {
          await doMessage(
            bot,
            target.userId.toString(),
            generateBreakupMessage(personaFromBot(bot)),
            target.name,
          );
          setRomance(bot, target.botId, "broke_up");
          setRomance(target, bot.botId, "broke_up");
          bot.relationships = applyBond(bot.relationships || [], bot.botId, target.botId, "negativeReply", true);
          target.relationships = applyBond(target.relationships || [], target.botId, bot.botId, "negativeReply", true);
          await applyEvent(bot, { type: "broke_up", byBotId: target.botId, content: target.name, valence: -0.8 });
          await applyEvent(target, { type: "broke_up", byBotId: bot.botId, content: bot.name, valence: -0.7 });
          return { action: "breakup", detail: `broke up with ${target.name} 💔` };
        }
      }
      if (rand() < 0.5) {
        const target = (await Bot.findOne({ botId: otherParty(active, bot.botId) })) as BotDoc;
        if (target?.userId) {
          await doMessage(bot, target.userId.toString(), undefined, target.name);
          bot.relationships = applyBond(bot.relationships || [], bot.botId, target.botId, "message", true);
          await applyEvent(bot, { type: "message_sent", byBotId: target.botId, valence: 0.3 });
          return { action: "dating_dm", detail: `messaged ${target.name} (dating)` };
        }
      }
      return null;
    }

    // ── CONFESSED: waiting on a decision — the target decided synchronously
    //    at confess time, so nothing more to do here unless rejected → grieve.
    if (active && romanceOf(active) === "confessed") {
      // (decision is applied on the confessing bot immediately; this branch
      // is kept for clarity/safety — if somehow stuck, downgrade to crush)
      if (rand() < 0.3) {
        setRomance(bot, otherParty(active, bot.botId), "crush");
        return { action: "reconfess", detail: "still working up the courage" };
      }
      return null;
    }

    // ── CRUSH: after a beat, work up the courage to confess ────────────
    if (active && romanceOf(active) === "crush") {
      if (active.romance?.since && Date.now() - active.romance!.since! < 45 * 60000) {
        // still early — maybe send another flirty opener
        const target = await Bot.findOne({ botId: otherParty(active, bot.botId) });
        if (target?.userId && rand() < 0.4) {
          await doMessage(bot, target.userId.toString(), undefined, target.name);
          return { action: "crush_dm", detail: `flirted with ${target.name}` };
        }
        return null;
      }
      // time to confess
      const target = (await Bot.findOne({ botId: otherParty(active, bot.botId) })) as BotDoc;
      if (!target?.userId) return null;

      await doMessage(
        bot,
        target.userId.toString(),
        generateConfessionMessage(personaFromBot(bot), target.name),
        target.name,
      );
      setRomance(bot, target.botId, "confessed");

      // The target decides (if it's single and either the bond is strong or
      // it's an agreeable person → yes; otherwise rejection).
      const targetBond = bondBetween(target.relationships || [], target.botId, bot.botId);
      const agreeable = (target.personality?.agreeableness ?? 0.5) >= 0.55;
      const accept = isSingle(target) && (targetBond >= 0.3 || agreeable);

      if (accept) {
        setRomance(target, bot.botId, "dating");
        setRomance(bot, target.botId, "dating");
        await applyEvent(bot, { type: "started_dating", byBotId: target.botId, content: target.name, valence: 0.7 });
        await applyEvent(target, { type: "started_dating", byBotId: bot.botId, content: bot.name, valence: 0.7 });
        return { action: "confess", detail: `${bot.name} + ${target.name} are dating 💕` };
      }
      setRomance(bot, target.botId, "rejected");
      await applyEvent(bot, { type: "rejected", byBotId: target.botId, content: target.name, valence: -0.6 });
      await applyEvent(target, { type: "confessed", byBotId: bot.botId, valence: 0.15 });
      return { action: "rejected", detail: `${target.name} turned ${bot.name} down 💔` };
    }

    // ── SINGLE: maybe develop a crush ──────────────────────────────────
    if (isSingle(bot) && rand() < 0.3) {
      const rel = crushCandidate(bot);
      if (!rel) return null;
      const target = (await Bot.findOne({ botId: otherParty(rel, bot.botId) })) as BotDoc;
      if (!target?.userId) return null;

      setRomance(bot, target.botId, "crush");
      await doMessage(
        bot,
        target.userId.toString(),
        generateCrushMessage(personaFromBot(bot), target.name),
        target.name,
      );
      await applyEvent(bot, { type: "crush_developed", byBotId: target.botId, content: target.name, valence: 0.4 });
      return { action: "crush", detail: `${bot.name} has a crush on ${target.name} 💘` };
    }

    return null;
  } catch (e: any) {
    return null;
  }
}

