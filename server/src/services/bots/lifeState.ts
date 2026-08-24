/**
 * lifeState.ts — the mood/energy/memory engine.
 *
 * Every bot has a persistent emotional state that fluctuates from real
 * events: getting liked lifts their mood, being ignored drags it down,
 * energy drains through the day and refills when they "sleep". Memory is a
 * rolling log of what recently happened to them, which the brain uses to
 * respond contextually (reciprocate, drift, bring up shared moments).
 */

import type { BotMemory, MoodTone } from "./types";
import { Bot } from "../../models/bot.model";
import { localHourFor } from "./countries";

export type BotDoc = any; // Hydrated Bot document

const MEMORY_CAP = 60;
const RELATIONSHIP_DECAY_PER_DAY = 0.04;

/** The bot's LOCAL wall-clock hour (its country's timezone, not server UTC). */
export function localHour(bot: BotDoc, now: number): number {
  return localHourFor(bot.country || "US", now);
}

/** Map a mood+energy state to a tone the template brain can write in. */
export function moodTone(mood: number, energy: number): MoodTone {
  if (energy < 0.25) return "tired";
  if (mood > 0.55) return "excited";
  if (mood > 0.15) return "happy";
  if (mood < -0.45) return "low";
  if (mood < -0.1) return "thoughtful";
  return "neutral";
}

/** Is the bot currently within its waking hours (in its LOCAL timezone)? */
export function isAwake(bot: BotDoc, now: number): boolean {
  const hour = localHour(bot, now);
  const { wakeHour, sleepHour } = bot.routine || { wakeHour: 7, sleepHour: 23 };
  if (wakeHour <= sleepHour) return hour >= wakeHour && hour < sleepHour;
  return hour >= wakeHour || hour < sleepHour; // overnight wake window
}

/** 0..1 energy at a given LOCAL hour based on the wake/sleep window. */
export function energyAtHour(bot: BotDoc, hour: number): number {
  const { wakeHour, sleepHour } = bot.routine || { wakeHour: 7, sleepHour: 23 };
  if (wakeHour <= sleepHour && (hour < wakeHour || hour >= sleepHour)) return 0.05;
  if (wakeHour > sleepHour && hour >= sleepHour && hour < wakeHour) return 0.05;
  // awake: peak energy mid-morning, drains toward sleep
  const awakeSpan = (sleepHour - wakeHour + 24) % 24 || 12;
  const elapsed = (hour - wakeHour + 24) % 24;
  const progress = Math.min(1, elapsed / awakeSpan);
  return Math.max(0.1, 1 - progress * 0.85);
}

/** Push a memory, cap the log, and shift mood/energy from the event. */
export async function applyEvent(bot: BotDoc, memory: Omit<BotMemory, "id" | "at">): Promise<void> {
  const neuroticism = bot.personality?.neuroticism ?? 0.5;
  const sensitivity = 1 + neuroticism; // neurotic bots feel events more

  bot.mood = clamp(-1, 1, (bot.mood ?? 0) + memory.valence * 0.22 * sensitivity);
  // energy drain scales with how emotional the event was
  const drain = 0.01 + Math.abs(memory.valence) * 0.015;
  bot.energy = clamp(0, 1, (bot.energy ?? 1) - drain);
  bot.lastActionAt = Date.now();

  bot.memory = [
    ...(bot.memory || []),
    {
      id: `${bot.botId}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      at: Date.now(),
      ...memory,
    },
  ].slice(-MEMORY_CAP);
  await bot.save();
}

/** Daily passive decay: mood drifts to neutral, bonds fade without contact. */
export async function decayLife(bot: BotDoc): Promise<void> {
  bot.mood = clamp(-1, 1, (bot.mood ?? 0) * 0.9);
  bot.energy = Math.max(bot.energy ?? 0, energyAtHour(bot, localHour(bot, Date.now())));

  const decayed = (bot.relationships || []).map((r: any) => {
    if (r.interactions === 0) return r;
    const daysSince = (Date.now() - (r.lastInteractionAt || Date.now())) / 86400000;
    const newBond = clamp(-1, 1, r.bond - daysSince * RELATIONSHIP_DECAY_PER_DAY);
    return { ...r, bond: newBond, kind: bondKind(newBond) };
  });
  bot.relationships = decayed;
  await bot.save();
}

/** Wake/sleep bookkeeping — updates lastWakeAt/lastSleepAt. */
export async function markWakeOrSleep(bot: BotDoc, now: number): Promise<void> {
  if (isAwake(bot, now)) {
    if (!bot.lastWakeAt || now - bot.lastWakeAt > 12 * 3600000) {
      bot.lastWakeAt = now;
      bot.energy = 1; // a fresh day, full battery
      await bot.save();
    }
  } else if (!bot.lastSleepAt || now - bot.lastSleepAt > 12 * 3600000) {
    bot.lastSleepAt = now;
    await bot.save();
  }
}

/** Find the most recent memory of a type (for contextual responses). */
export function lastMemory(bot: BotDoc, type: string): BotMemory | null {
  const mems = bot.memory || [];
  for (let i = mems.length - 1; i >= 0; i--) {
    if (mems[i].type === type) return mems[i];
  }
  return null;
}

export function bondKind(bond: number): string {
  if (bond >= 0.7) return "best_friend";
  if (bond >= 0.45) return "close_friend";
  if (bond >= 0.15) return "friend";
  if (bond >= -0.1) return "acquaintance";
  return "rival";
}

function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(max, v));
}
