import Block from "../models/block.model";

/**
 * Check whether two users are blocked from each other — in EITHER direction.
 * Blocking is treated as fully mutual: if A blocked B or B blocked A,
 * they are invisible to each other across the entire app.
 */
export async function areMutuallyBlocked(
  userA: string,
  userB: string,
): Promise<boolean> {
  if (!userA || !userB || userA === userB) return false;
  const block = await Block.findOne({
    $or: [
      { blocker: userA, blocked: userB },
      { blocker: userB, blocked: userA },
    ],
  })
    .select("_id")
    .lean();
  return !!block;
}

/**
 * Get all user IDs that have ANY block relationship (either direction) with
 * the given user. Used to filter feeds/lists so blocked users never appear.
 */
export async function getBlockedUserIds(userId: string): Promise<string[]> {
  if (!userId) return [];
  const docs = await Block.find({
    $or: [{ blocker: userId }, { blocked: userId }],
  })
    .select("blocker blocked")
    .lean();

  const ids = new Set<string>();
  for (const d of docs) {
    const blocker = d.blocker?.toString();
    const blocked = d.blocked?.toString();
    if (blocker && blocker !== userId) ids.add(blocker);
    if (blocked && blocked !== userId) ids.add(blocked);
  }
  return [...ids];
}

