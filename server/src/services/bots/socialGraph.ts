/**
 * socialGraph.ts — the relationship engine.
 *
 * Every interaction between two entities (bot-bot or bot-real-user) nudges
 * a bond score in [-1, +1]. Repeated positive interaction raises the bond
 * and the relationship levels up (acquaintance → friend → close friend →
 * best friend); silence decays it and people drift apart. Bots use their
 * bonds to decide who to engage with — so real friendships *emerge* instead
 * of being scripted.
 */

import type { Relationship } from "./types";
import { bondKind } from "./lifeState";

const BOND_RULES = {
  like: 0.02,
  comment: 0.05,
  reply: 0.07,
  message: 0.08,
  follow: 0.12,
  followBack: 0.1,
  glimpseReaction: 0.04,
  ignore: -0.06,
  negativeReply: -0.1,
};

export type InteractionType = keyof typeof BOND_RULES;

/**
 * Nudge the bond between two entities. `a` and `b` are bot ids or user ids
 * (a bot pair is always recorded as botId<->botId). Returns the updated bond.
 */
export function applyBond(
  relationships: Relationship[],
  a: string,
  b: string,
  kind: InteractionType,
  isBotPair: boolean,
): Relationship[] {
  const key = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  const target = key(a, b);
  const [ra, rb] = target.split("|") as [string, string];

  let rel = relationships.find((r) => {
    const rk = r.a < r.b ? `${r.a}|${r.b}` : `${r.b}|${r.a}`;
    return rk === target;
  });

  const delta = BOND_RULES[kind] ?? 0;

  if (!rel) {
    rel = {
      a: ra,
      b: rb,
      isBotPair,
      bond: 0,
      kind: "acquaintance" as const,
      interactions: 0,
      lastInteractionAt: 0,
    };
    relationships.push(rel);
  }

  rel.bond = Math.max(-1, Math.min(1, rel.bond + delta));
  rel.interactions += 1;
  rel.lastInteractionAt = Date.now();
  rel.kind = bondKind(rel.bond) as Relationship["kind"];

  return relationships;
}

/** Bond lookup between two ids (either direction). */
export function bondBetween(relationships: Relationship[], a: string, b: string): number {
  const rel = relationships.find((r) => {
    const rk = r.a < r.b ? `${r.a}|${r.b}` : `${r.b}|${r.a}`;
    const tk = a < b ? `${a}|${b}` : `${b}|${a}`;
    return rk === tk;
  });
  return rel ? rel.bond : 0;
}

/** The n strongest bonds this bot has (by bond, excluding a given id). */
export function topBonds(relationships: Relationship[], selfId: string, excludeId: string | null, n: number): Relationship[] {
  return relationships
    .filter((r) => r.a === selfId || r.b === selfId)
    .filter((r) => (excludeId ? r.a !== excludeId && r.b !== excludeId : true))
    .sort((x, y) => y.bond - x.bond)
    .slice(0, n);
}

/** The id of the OTHER party in a relationship involving selfId. */
export function otherParty(r: Relationship, selfId: string): string {
  return r.a === selfId ? r.b : r.a;
}

/**
 * Circle assignment: the doc's retention thesis calls for dense friend
 * groups (~5 people) rather than one flat follower graph. Bots are assigned
 * to circles of ~5 and get boosted starting bonds within their circle so
 * friendships form fast between circle-mates.
 */
export function assignCircles(botIds: string[], circleNames: string[]): Map<string, { circleId: string; circleName: string }> {
  const result = new Map<string, { circleId: string; circleName: string }>();
  const size = 5;
  for (let i = 0; i < botIds.length; i++) {
    const id = botIds[i];
    if (!id) continue;
    const circleIdx = Math.floor(i / size) % circleNames.length;
    result.set(id, {
      circleId: `circle-${circleIdx + 1}`,
      circleName: circleNames[circleIdx % circleNames.length] || "Friends",
    });
  }
  return result;
}

export const CIRCLE_NAMES = [
  "The Late Night Crew",
  "Weekend Warriors",
  "Campus Classics",
  "The Gym Gang",
  "Coffee Table Talks",
  "Road Trip Club",
  "The Gaming Guild",
  "Sunset Chasers",
  "The Book Club",
  "Studio Sessions",
  "Foodie Fam",
  "The Startup Table",
];
