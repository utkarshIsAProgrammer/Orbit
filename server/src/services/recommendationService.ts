import { User } from "../models/user.model";
import Post from "../models/post.model";
import Follow from "../models/follow.model";
import Interaction from "../models/interaction.model";
import { getBlockedUserIds } from "../utilities/blockCheck";
import { getCache, setCache, clearByPattern } from "../configs/cache";
import { logger } from "../utilities/logger";

// ─── Weights (tuneable) ────────────────────────────────────────────
//
// Hybrid user suggestion score:
//   friendOfFriend  — how many of your followings also follow the candidate
//   affinity        — how much YOU already interact with the candidate
//   popularity      — log-scaled follower count (cold-start signal)
//   quality         — engagement-per-follower (real creators, not bots)
//   freshness       — recently active creators are more likely to engage back
//
// The weights are normalized so each signal lands in a comparable range.

const SUGGEST = {
  /** Weight for friend-of-friend overlap (strongest social signal) */
  FOF_WEIGHT: 0.40,
  /** Weight for direct interaction affinity with the candidate */
  AFFINITY_WEIGHT: 0.25,
  /** Weight for popularity (log followers) */
  POPULARITY_WEIGHT: 0.15,
  /** Weight for creator quality (engagement per follower) */
  QUALITY_WEIGHT: 0.10,
  /** Weight for account recency/activity freshness */
  FRESHNESS_WEIGHT: 0.10,
  /** Popularity floor for the log scale: log1p(followers) */
  POPULARITY_FLOOR: 10,
  /** Engagement ratio cap to avoid insane ratios on tiny accounts */
  QUALITY_CAP: 0.5,
  /** Candidates to pull from the friend-of-friend pool before scoring */
  FOF_CANDIDATE_LIMIT: 200,
  /** Total candidate pool before final ranking */
  MAX_CANDIDATES: 250,
  /** Skip accounts with fewer followers than this when using popularity */
  MIN_FOLLOWERS_FOR_POPULAR: 2,
  /** Consider a creator "recently active" within this window */
  ACTIVE_WINDOW_DAYS: 14,
} as const;

// ─── Reason labels ─────────────────────────────────────────────────

export type SuggestionReason =
  | "mutual"
  | "affinity"
  | "popular"
  | "fresh";

export interface SuggestedUser {
  _id: string;
  username: string;
  fullName: string;
  profilePic?: any;
  bio?: string;
  followersCount: number;
  isVerified?: boolean;
  /** Primary reason this user was recommended */
  reason: SuggestionReason;
  /** Number of people you follow who also follow them */
  mutualFollowersCount: number;
  /** Normalized 0-1 score (client can show as a subtle bar / ordering) */
  score: number;
}

// ─── Shared exclusions ─────────────────────────────────────────────

/**
 * Everything that must never appear in ANY recommendation surface:
 * - blocked in either direction
 * - already followed
 * - the viewer themself
 * - previously dismissed via the skip button
 */
async function getExcludedUserIds(
  userId: string,
  includeFollowed: boolean = true
): Promise<{ ids: Set<string>; idsArr: string[] }> {
  const blockedIds = await getBlockedUserIds(userId);
  const ids = new Set<string>(blockedIds.map((id) => id.toString()));
  ids.add(userId.toString());

  if (includeFollowed) {
    const following = await Follow.find({ follower: userId })
      .select("following")
      .lean();
    following.forEach((f: any) => ids.add(f.following.toString()));
  }

  const user = await User.findById(userId).select("dismissedSuggestionIds").lean();
  ((user as any)?.dismissedSuggestionIds || []).forEach((d: any) =>
    ids.add(d.toString())
  );

  return { ids, idsArr: [...ids] };
}

// ─── Step 1: Friend-of-friend candidate pool ───────────────────────

/**
 * Pull people that your followings follow (2-hop graph), counting how many
 * of your followings each candidate has in common. This is the classic
 * "people you may know" signal and the backbone of the suggestion pool.
 */
async function buildFofPool(
  userId: string,
  excludedIds: Set<string>
): Promise<Map<string, number>> {
  const mutualCounts = new Map<string, number>();

  const following = await Follow.find({ follower: userId })
    .select("following")
    .lean()
    .then((docs) => docs.map((d: any) => d.following.toString()));

  if (following.length === 0) return mutualCounts;

  // Batch through followings in chunks to keep the $in sane, and cap the
  // candidate pool so a user who follows mega-accounts can't blow up the
  // graph. We keep only the STRONGEST mutual signals by tracking counts as
  // we scan; once the cap is reached we only add candidates that out-rank
  // the current weakest entry.
  for (let i = 0; i < following.length; i += 50) {
    const chunk = following.slice(i, i + 50);
    const edges = await Follow.find({
      follower: { $in: chunk },
      following: { $nin: [...excludedIds] },
    })
      .select("follower following")
      .limit(SUGGEST.FOF_CANDIDATE_LIMIT * 3)
      .lean();

    for (const edge of edges) {
      const candidateId = (edge as any).following.toString();
      const count = (mutualCounts.get(candidateId) || 0) + 1;
      if (mutualCounts.has(candidateId)) {
        mutualCounts.set(candidateId, count);
      } else if (mutualCounts.size < SUGGEST.FOF_CANDIDATE_LIMIT) {
        mutualCounts.set(candidateId, count);
      } else {
        // Pool is full — replace the weakest entry if this one is stronger
        let weakestId: string | null = null;
        let weakestCount = Infinity;
        for (const [id, c] of mutualCounts) {
          if (c < weakestCount) {
            weakestCount = c;
            weakestId = id;
          }
        }
        if (weakestId && count > weakestCount) {
          mutualCounts.delete(weakestId);
          mutualCounts.set(candidateId, count);
        }
      }
    }
  }

  return mutualCounts;
}

// ─── Step 2: Interaction affinity for candidates ───────────────────

/**
 * Look up how strongly the viewer already engages with each candidate.
 * Uses the same Interaction collection as the feed affinity engine so a
 * like/comment/save/share/dm/profileVisit all count toward suggestions.
 */
async function buildAffinityScores(
  userId: string,
  candidateIds: string[]
): Promise<Map<string, number>> {
  const affinity = new Map<string, number>();
  if (candidateIds.length === 0) return affinity;

  const interactions = await Interaction.find({
    userId,
    targetAuthorId: { $in: candidateIds },
  })
    .select("targetAuthorId type timestamp")
    .lean();

  const ACTION_WEIGHTS: Record<string, number> = {
    like: 1,
    comment: 4,
    save: 3,
    share: 5,
    dm: 6,
    profileVisit: 1.5,
    storyView: 0.5,
  };

  for (const ix of interactions) {
    const authorId = ix.targetAuthorId.toString();
    const daysAgo =
      (Date.now() - new Date(ix.timestamp).getTime()) / (24 * 60 * 60 * 1000);
    const decay = Math.pow(0.95, Math.max(0, daysAgo));
    const contribution =
      (ACTION_WEIGHTS[ix.type] || 1) * decay;
    affinity.set(authorId, (affinity.get(authorId) || 0) + contribution);
  }

  // Compress with log1p so a single DM doesn't dwarf everything
  const compressed = new Map<string, number>();
  for (const [id, raw] of affinity) {
    compressed.set(id, Math.log1p(raw));
  }
  return compressed;
}

// ─── Step 3: Hybrid scoring ────────────────────────────────────────

interface CandidateInfo {
  user: any;
  mutualCount: number;
  affinity: number;
  popularity: number;
  quality: number;
  freshness: number;
}

/**
 * Score every candidate with the hybrid formula and pick the top N,
 * attaching the dominant reason for each suggestion.
 */
async function scoreAndRank(
  fofCounts: Map<string, number>,
  affinity: Map<string, number>,
  limit: number
): Promise<SuggestedUser[]> {
  const candidateIds = [...fofCounts.keys()];
  const candidatePool = new Set(candidateIds);

  // Add high-affinity candidates even if they aren't in the 2-hop graph —
  // someone you DM with but never followed should still be suggested.
  for (const [id, score] of affinity) {
    if (score > 0.3) candidatePool.add(id);
  }

  if (candidatePool.size === 0) return [];

  const users = await User.find({ _id: { $in: [...candidatePool] } })
    .select(
      "_id username fullName profilePic bio followersCount followingCount postsCount isVerified createdAt waitlistPerk"
    )
    .lean();

  const userIds = users.map((u: any) => u._id.toString());
  const userIdSet = new Set(userIds);

  // Remove fof candidates that don't exist (edge cleanup)
  const candidates: CandidateInfo[] = [];
  for (const id of candidateIds) {
    if (!userIdSet.has(id)) continue;
    const user = users.find((u: any) => u._id.toString() === id)!;
    candidates.push({
      user,
      mutualCount: fofCounts.get(id) || 0,
      affinity: affinity.get(id) || 0,
      popularity: 0,
      quality: 0,
      freshness: 0,
    });
  }
  // Pure-affinity candidates (not in fof pool)
  for (const id of candidatePool) {
    if (userIdSet.has(id) && !fofCounts.has(id)) {
      const user = users.find((u: any) => u._id.toString() === id)!;
      candidates.push({
        user,
        mutualCount: 0,
        affinity: affinity.get(id) || 0,
        popularity: 0,
        quality: 0,
        freshness: 0,
      });
    }
  }

  const now = Date.now();

  const scored = candidates.map((c) => {
    const followers = c.user.followersCount || 0;
    const posts = c.user.postsCount || 0;
    const createdDaysAgo =
      (now - new Date(c.user.createdAt).getTime()) / (24 * 60 * 60 * 1000);

    // Popularity: log1p scale so mega-accounts don't dominate
    const popularity =
      followers >= SUGGEST.MIN_FOLLOWERS_FOR_POPULAR
        ? Math.log1p(followers) / Math.log1p(10_000) // ~normalized to 0..1
        : 0;

    // Quality: engagement per follower (likes+comments per post vs audience)
    const engagementPerPost = followers > 0 && posts > 0 ? followers / posts : 0;
    const quality = Math.min(1, engagementPerPost / 50 / SUGGEST.QUALITY_CAP);

    // Freshness: newer accounts that are still active get a boost
    const freshness = Math.max(
      0,
      1 - createdDaysAgo / (SUGGEST.ACTIVE_WINDOW_DAYS * 8)
    );

    const mutualNorm = c.mutualCount > 0
      ? Math.log1p(c.mutualCount) / Math.log1p(10)
      : 0;
    const affinityNorm = c.affinity > 0
      ? Math.log1p(c.affinity) / Math.log1p(6)
      : 0;

    const score =
      mutualNorm * SUGGEST.FOF_WEIGHT +
      affinityNorm * SUGGEST.AFFINITY_WEIGHT +
      popularity * SUGGEST.POPULARITY_WEIGHT +
      quality * SUGGEST.QUALITY_WEIGHT +
      freshness * SUGGEST.FRESHNESS_WEIGHT;

    return { ...c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);

  return top.map((c) => {
    let reason: SuggestionReason = "popular";
    if (c.mutualCount >= 2) reason = "mutual";
    else if (c.mutualCount === 1 && c.affinity > 0.2) reason = "mutual";
    else if (c.affinity > 0.3) reason = "affinity";
    else if (c.user.isVerified) reason = "popular";
    else if (
      c.user.followersCount > 0 &&
      (Date.now() - new Date(c.user.createdAt).getTime()) /
        (24 * 60 * 60 * 1000) < SUGGEST.ACTIVE_WINDOW_DAYS
    ) {
      reason = "fresh";
    }

    return {
      _id: c.user._id.toString(),
      username: c.user.username,
      fullName: c.user.fullName,
      profilePic: c.user.profilePic || undefined,
      bio: c.user.bio || undefined,
      followersCount: c.user.followersCount || 0,
      isVerified: c.user.isVerified || false,
      reason,
      mutualFollowersCount: c.mutualCount,
      score: Math.round(c.score * 1000) / 1000,
    };
  });
}

// ─── Step 4: Cold-start fallback ───────────────────────────────────

/**
 * New / low-activity users have no affinity and often no followings at all.
 * Fall back to a popularity + freshness + verified mix so the suggestions
 * rail is never empty, while still excluding blocked/dismissed/already-followed.
 */
async function getColdStartSuggestions(
  userId: string,
  excludedIds: Set<string>,
  limit: number
): Promise<SuggestedUser[]> {
  const users = await User.find({
    _id: { $nin: [...excludedIds] },
    isPrivate: { $ne: true },
  })
    .select(
      "_id username fullName profilePic bio followersCount followingCount postsCount isVerified createdAt waitlistPerk"
    )
    .sort({ followersCount: -1, isVerified: -1, createdAt: -1 })
    .limit(limit * 3)
    .lean();

  const now = Date.now();
  const scored = users
    .map((u: any) => {
      const followers = u.followersCount || 0;
      const createdDaysAgo =
        (now - new Date(u.createdAt).getTime()) / (24 * 60 * 60 * 1000);
      const popularity = Math.log1p(followers) / Math.log1p(10_000);
      const freshness = Math.max(
        0,
        1 - createdDaysAgo / (SUGGEST.ACTIVE_WINDOW_DAYS * 8)
      );
      const score =
        popularity * 0.6 + (u.isVerified ? 0.25 : 0) + freshness * 0.15;
      return { u, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ u, score }) => ({
    _id: u._id.toString(),
    username: u.username,
    fullName: u.fullName,
    profilePic: u.profilePic || undefined,
    bio: u.bio || undefined,
    followersCount: u.followersCount || 0,
    isVerified: u.isVerified || false,
    reason: u.isVerified
      ? ("popular" as SuggestionReason)
      : ("fresh" as SuggestionReason),
    mutualFollowersCount: 0,
    score: Math.round(score * 1000) / 1000,
  }));
}

// ─── Public API: User suggestions ──────────────────────────────────

/**
 * GET /api/users/suggestions
 *
 * Hybrid recommendation engine:
 *   1. Friend-of-friend pool (2-hop graph, mutual counts)
 *   2. Interaction affinity boost (likes/comments/saves/shares/DMs)
 *   3. Hybrid score: FOF + affinity + popularity + quality + freshness
 *   4. Cold-start fallback for new users
 *   5. Exclusions: blocked, already-followed, self, dismissed
 *
 * Results are cached per-user (2 min) and each entry carries a `reason`
 * so the UI can explain *why* the user was suggested.
 */
export async function getUserSuggestions(
  userId: string,
  limit: number = 5
): Promise<SuggestedUser[]> {
  const cacheKey = `recs:suggestions:${userId}:${limit}`;
  try {
    const cached = await getCache<SuggestedUser[]>(cacheKey);
    if (cached) return cached;
  } catch (err: any) {
    logger.error("Suggestion cache read error", { error: err.message });
  }

  const { ids: excludedIds } = await getExcludedUserIds(userId);
  const followingCount = await Follow.countDocuments({ follower: userId });

  let suggestions: SuggestedUser[] = [];

  if (followingCount > 0) {
    const fofCounts = await buildFofPool(userId, excludedIds);
    const affinity = await buildAffinityScores(userId, [
      ...fofCounts.keys(),
    ]);
    suggestions = await scoreAndRank(fofCounts, affinity, limit);
  }

  // Cold start: not enough network signals — blend in popular/fresh accounts
  if (suggestions.length < limit) {
    const fillCount = limit - suggestions.length;
    const excludedForFallback = new Set([
      ...excludedIds,
      ...suggestions.map((s) => s._id),
    ]);
    const coldStart = await getColdStartSuggestions(
      userId,
      excludedForFallback,
      fillCount
    );
    suggestions = [...suggestions, ...coldStart];
  }

  try {
    await setCache(cacheKey, suggestions, 120);
  } catch (err: any) {
    logger.error("Suggestion cache write error", { error: err.message });
  }

  return suggestions.slice(0, limit);
}

// ─── Dismiss (skip) feedback loop ──────────────────────────────────

/**
 * POST /api/users/suggestions/dismiss
 *
 * Permanently removes a user from the viewer's suggestion surfaces.
 * Capped at 200 dismissed users (FIFO).
 */
export async function dismissSuggestion(
  userId: string,
  dismissedUserId: string
): Promise<void> {
  if (userId === dismissedUserId) return;
  await User.updateOne(
    { _id: userId },
    {
      $push: {
        dismissedSuggestionIds: {
          $each: [dismissedUserId],
          $slice: -200,
        },
      },
    }
  );
  // Invalidate ALL suggestion cache variants for this viewer (any limit)
  try {
    await clearByPattern(`recs:suggestions:${userId}`);
  } catch (err: any) {
    logger.error("Failed to clear suggestion cache", { error: err.message });
  }
}

// ─── Similar creators (profile surface) ────────────────────────────

/**
 * GET /api/users/:userId/similar-creators
 *
 * "More creators like this" card on profile pages.
 * Algorithm: audience overlap — people who follow the target ALSO follow
 * the candidate (collaborative filtering). Ranked by overlap count, then
 * boosted by the viewer's own affinity and candidate popularity.
 */
export async function getSimilarCreators(
  viewerId: string,
  targetUserId: string,
  limit: number = 6
): Promise<SuggestedUser[]> {
  if (viewerId === targetUserId) return [];

  const cacheKey = `recs:similar:${viewerId}:${targetUserId}:${limit}`;
  try {
    const cached = await getCache<SuggestedUser[]>(cacheKey);
    if (cached) return cached;
  } catch (err: any) {
    logger.error("Similar-creators cache read error", { error: err.message });
  }

  const { ids: excludedIds, idsArr: excludedArr } = await getExcludedUserIds(
    viewerId
  );
  excludedIds.add(targetUserId.toString());

  // People who follow the target — capped so a mega-account can't trigger
  // thousands of chunked follow lookups. Recent followers are the most
  // representative audience anyway.
  const targetFollowers = await Follow.find({ following: targetUserId })
    .select("follower")
    .sort({ createdAt: -1 })
    .limit(500)
    .lean()
    .then((docs) => docs.map((d: any) => d.follower.toString()));
  targetFollowers.push(viewerId); // viewer counts as audience too

  if (targetFollowers.length === 0) return [];

  // What do those people ALSO follow? = overlap candidates
  const overlap = new Map<string, number>();
  for (let i = 0; i < targetFollowers.length; i += 50) {
    const chunk = targetFollowers.slice(i, i + 50);
    const edges = await Follow.find({
      follower: { $in: chunk },
      following: { $nin: excludedArr },
    })
      .select("following")
      .lean();
    for (const edge of edges) {
      const id = (edge as any).following.toString();
      overlap.set(id, (overlap.get(id) || 0) + 1);
    }
  }

  if (overlap.size === 0) return [];

  const topIds = [...overlap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, SUGGEST.MAX_CANDIDATES)
    .map(([id]) => id);

  const [candidateUsers, affinityMap] = await Promise.all([
    User.find({ _id: { $in: topIds }, isPrivate: { $ne: true } })
      .select(
        "_id username fullName profilePic bio followersCount postsCount isVerified createdAt"
      )
      .lean(),
    buildAffinityScores(viewerId, topIds),
  ]);

  const now = Date.now();
  const scored = candidateUsers
    .map((u: any) => {
      const id = u._id.toString();
      const overlapCount = overlap.get(id) || 0;
      const followers = u.followersCount || 0;
      const createdDaysAgo =
        (now - new Date(u.createdAt).getTime()) / (24 * 60 * 60 * 1000);
      const popularity = Math.log1p(followers) / Math.log1p(10_000);
      const affinity = affinityMap.get(id) || 0;
      const mutualNorm = Math.log1p(overlapCount) / Math.log1p(10);
      const affinityNorm = Math.log1p(affinity) / Math.log1p(6);
      const freshness = Math.max(
        0,
        1 - createdDaysAgo / (SUGGEST.ACTIVE_WINDOW_DAYS * 8)
      );

      const score =
        mutualNorm * 0.55 +
        affinityNorm * 0.20 +
        popularity * 0.15 +
        freshness * 0.10;

      return { u, score, overlapCount, affinity };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const result: SuggestedUser[] = scored.map(({ u, score, overlapCount, affinity }) => ({
    _id: u._id.toString(),
    username: u.username,
    fullName: u.fullName,
    profilePic: u.profilePic || undefined,
    bio: u.bio || undefined,
    followersCount: u.followersCount || 0,
    isVerified: u.isVerified || false,
    reason: (overlapCount >= 2
      ? "mutual"
      : affinity > 0.3
        ? "affinity"
        : "popular") as SuggestionReason,
    mutualFollowersCount: overlapCount,
    score: Math.round(score * 1000) / 1000,
  }));

  try {
    await setCache(cacheKey, result, 300);
  } catch (err: any) {
    logger.error("Similar-creators cache write error", { error: err.message });
  }

  return result;
}

// ─── Similar posts (post detail surface) ───────────────────────────

/**
 * GET /api/posts/:postId/similar
 *
 * "More like this" under a post: candidates share hashtags with the source
 * post, scored by tag overlap + the viewer's tag affinity + recency.
 */
export async function getSimilarPosts(
  viewerId: string,
  sourcePostId: string,
  limit: number = 6
): Promise<any[]> {
  const cacheKey = `recs:similar-posts:${viewerId}:${sourcePostId}:${limit}`;
  try {
    const cached = await getCache<any[]>(cacheKey);
    if (cached) return cached;
  } catch (err: any) {
    logger.error("Similar-posts cache read error", { error: err.message });
  }

  const source = await Post.findById(sourcePostId).select("hashtags author").lean();
  if (!source || !(source as any).hashtags?.length) return [];

  const { ids: excludedIds } = await getExcludedUserIds(viewerId, false);
  excludedIds.add(viewerId.toString());

  const sourceTags = (source as any).hashtags as string[];
  const candidates = await Post.find({
    _id: { $ne: sourcePostId },
    hashtags: { $in: sourceTags },
    status: "published",
    visibility: "public",
    author: { $nin: [...excludedIds] },
  })
    .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
    .select("hashtags likesCount commentsCount savesCount sharesCount createdAt")
    .sort({ likesCount: -1, createdAt: -1 })
    .limit(limit * 3)
    .lean();

  if (candidates.length === 0) return [];

  const viewer = await User.findById(viewerId)
    .select("contentAffinity")
    .lean();
  const tagAffinity = new Map<string, number>(
    Object.entries((viewer as any)?.contentAffinity || {})
  );

  const now = Date.now();
  const scored = candidates
    .map((p: any) => {
      const tags = p.hashtags || [];
      const overlap =
        tags.filter((t: string) => sourceTags.includes(t)).length /
        Math.max(1, sourceTags.length);
      const tagAffinityScore = tags.reduce(
        (sum: number, t: string) => sum + (tagAffinity.get(t) || 0),
        0
      );
      const hours = Math.max(
        0.5,
        (now - new Date(p.createdAt).getTime()) / 3_600_000
      );
      const velocity =
        ((p.likesCount || 0) * 1 +
          (p.commentsCount || 0) * 4 +
          (p.savesCount || 0) * 3 +
          (p.sharesCount || 0) * 5) /
        hours;
      const recency = Math.exp(-0.08 * hours);

      const score =
        overlap * 0.5 +
        Math.min(1, tagAffinityScore) * 0.2 +
        Math.min(1, velocity / 20) * 0.2 +
        recency * 0.1;

      return { p, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  try {
    await setCache(cacheKey, scored.map((s) => s.p), 600);
  } catch (err: any) {
    logger.error("Similar-posts cache write error", { error: err.message });
  }

  return scored.map((s) => s.p);
}

export default {
  getUserSuggestions,
  dismissSuggestion,
  getSimilarCreators,
  getSimilarPosts,
};
