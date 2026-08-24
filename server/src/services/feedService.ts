import mongoose from "mongoose";
import Post from "../models/post.model";
import { User } from "../models/user.model";
import Follow from "../models/follow.model";
import Block from "../models/block.model";
import { getCache, setCache, clearByPattern } from "../configs/cache";
import { logger } from "../utilities/logger";

// ─── Named scoring constants (tuneable) ────────────────────────────

const SCORE = {
  /** Weight for per-author affinity (log-scaled engagement history) */
  AFFINITY_WEIGHT: 0.35,
  /** Weight for content-type / tag affinity */
  CONTENT_AFFINITY_WEIGHT: 0.20,
  /** Weight for post velocity (recent engagement rate) */
  VELOCITY_WEIGHT: 0.25,
  /** Weight for recency (exponential decay) */
  RECENCY_DECAY_WEIGHT: 0.15,
  /** Weight for follow relationship boost */
  FOLLOW_BOOST_WEIGHT: 0.05,
  /** Multiplier applied if the user follows the post's author */
  FOLLOW_BOOST_MULTIPLIER: 1.5,
  /** Base multiplier (no boost) */
  BASE_BOOST: 1.0,
  /** Multiplier applied to posts from authors with an active referral reach boost */
  REACH_BOOST_MULTIPLIER: 1.8,
  /** Recency decay factor: exp(-DECAY_RATE * hours) */
  RECENCY_DECAY_RATE: 0.08,
} as const;

const VELOCITY = {
  /** Weight of each like in velocity calculation */
  LIKE: 1,
  /** Weight of each comment (higher = deeper engagement) */
  COMMENT: 4,
  /** Weight of each save (strong interest signal) */
  SAVE: 3,
  /** Weight of each share (strongest passive signal) */
  SHARE: 5,
  /** Minimum denominator to avoid division by zero */
  MIN_HOURS: 0.5,
  /** Minimum view floor used as the engagement-rate denominator — stops a
   *  handful of likes on a brand-new post from looking viral */
  MIN_VIEWS: 25,
  /** Scales the log(momentum) × rate product back onto a magnitude
   *  comparable to the old raw velocity (keeps the 0.25 weight meaningful) */
  RATE_SCALE: 15,
} as const;

const POOL = {
  /** Max candidates to fetch from each source */
  FOLLOWING_LIMIT: 300,
  /** Max candidates from high-affinity authors (not followed) */
  AFFINITY_LIMIT: 100,
  /** Max trending/discovery posts */
  DISCOVERY_LIMIT: 50,
  /** Total candidate budget */
  MAX_CANDIDATES: 450,
  /** Recent posts window (in days) */
  RECENT_DAYS: 3,
  /** Don't recompute affinity if it's fresher than this (in minutes) */
  AFFINITY_STALE_THRESHOLD_MINUTES: 15,
} as const;

const DIVERSITY = {
  /** Max consecutive posts from the same author */
  MAX_SAME_AUTHOR: 2,
  /** Slots to reserve for very fresh content (< 2 hours old) */
  FRESHNESS_SLOTS: 3,
  /** Reserve these 0-indexed positions for fresh posts */
  FRESHNESS_POSITIONS: [2, 6],
  /** Freshness window in hours */
  FRESHNESS_HOURS: 2,
} as const;

/**
 * Phase-1 feed quality gate. Low-effort filler (no media, no tags, short or
 * boilerplate text) is what made the feed feel "AI-generated" and unrelated.
 * These constants tune how aggressively it is pushed down / excluded.
 */
const QUALITY = {
  /** Discovery (stranger) posts below this quality never enter the pool */
  MIN_DISCOVERY_QUALITY: 0.35,
  /** Hard floor: any post scoring below this (spam-signal boilerplate) is
   *  dropped from the ranked feed entirely — even from followed authors */
  MIN_SCORE_FLOOR: 0.15,
  /** Text length that counts as "meaningful" (vs. throwaway one-liners) */
  MIN_MEANINGFUL_LENGTH: 20,
  /** Phrases that scream auto-generated / onboarding boilerplate */
  SPAM_PHRASES: [
    "first post",
    "hello everyone",
    "welcome to",
    "just joined",
    "new here",
    "check out my",
    "follow for follow",
  ],
} as const;

// ─── Quality gate ──────────────────────────────────────────────────

/**
 * Content-quality score (0..1). Rewards media, hashtags and meaningful
 * length; penalizes spam signals (boilerplate phrases, excessive caps,
 * word repetition, emoji spam). Exported for unit tests.
 */
export function computeQualityScore(post: any): number {
  let score = 0.5;

  const content: string = (post.content || "").trim();
  const hasMedia =
    (Array.isArray(post.images) && post.images.length > 0) ||
    (Array.isArray(post.videos) && post.videos.length > 0) ||
    Boolean(post.video);

  if (hasMedia) score += 0.25;
  if (Array.isArray(post.hashtags) && post.hashtags.length > 0) score += 0.15;
  if (content.length >= QUALITY.MIN_MEANINGFUL_LENGTH) {
    score += 0.1;
  } else {
    // Throwaway one-liners ("hi", "lol") are the definition of filler
    score -= 0.1;
  }

  // Boilerplate / AI-flavored onboarding phrases. Strong enough (-0.5) that
  // a boilerplate post can never reach the discovery threshold even with the
  // full length + hashtag bonuses stacked on top.
  const lower = content.toLowerCase();
  if (QUALITY.SPAM_PHRASES.some((p) => lower.includes(p))) score -= 0.5;

  // Excessive caps (>50% of letters) — SHOUTY spam
  const letters = content.replace(/[^A-Za-z]/g, "");
  if (letters.length > 10) {
    const caps = letters.replace(/[^A-Z]/g, "").length;
    if (caps / letters.length > 0.5) score -= 0.2;
  }

  // Repeated words ("lol lol lol", "nice nice nice")
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length > 4) {
    const counts = new Map<string, number>();
    for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
    const maxRepeats = Math.max(...counts.values());
    if (maxRepeats / words.length > 0.4) score -= 0.2;
  }

  // Emoji spam (5+ emojis)
  const emojiCount =
    content.match(/(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu)?.length || 0;
  if (emojiCount >= 5) score -= 0.2;

  return Math.min(1, Math.max(0.05, score));
}

// ─── Types ─────────────────────────────────────────────────────────

export interface ScoredPost {
  post: any;
  score: number;
  authorId: string;
  isFollowed: boolean;
  isFresh: boolean;
  /** Content quality 0..1 (media/hashtags/length minus spam signals) */
  quality: number;
}

interface FeedResult {
  posts: any[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ─── Slim cached shape ──────────────────────────────────────────────
// The per-user ranked feed is cached for 5 min. Storing the FULL candidate
// list (~450 posts × populated authors) wrote a ~0.5 MB JSON blob to the
// cache on every rebuild per active user. The cache now stores just
// {postId, score, ...} (~50 KB) and the page is hydrated from Mongo by _id
// on read — one indexed query, far smaller cache writes/reads, and a post
// deleted since the write drops out instead of lingering for the TTL.
interface CachedScored {
  postId: string;
  score: number;
  authorId: string;
  isFollowed: boolean;
  isFresh: boolean;
  quality: number;
}

// The populate spec used everywhere a feed post's author is attached.
const AUTHOR_POPULATE =
  "username fullName profilePic closeFriends isVerified statusText waitlistPerk";

const toCached = (s: ScoredPost): CachedScored => ({
  postId: (s.post as any)._id.toString(),
  score: s.score,
  authorId: s.authorId,
  isFollowed: s.isFollowed,
  isFresh: s.isFresh,
  quality: s.quality,
});

// ─── Step 1: Candidate Generation ───────────────────────────────────

/**
 * Build a diverse candidate pool of up to ~450 posts:
 * 1. Posts from followed authors in the last 3 days (~300)
 * 2. Posts from high-affinity authors even if not followed (~100)
 * 3. Trending/discovery posts from outside the network (~50)
 */
async function generateCandidates(
  userId: string,
  affinityScores: Map<string, number>,
  seenPosts: string[],
  followedUserIds: string[]
): Promise<any[]> {
  const threeDaysAgo = new Date(Date.now() - POOL.RECENT_DAYS * 24 * 60 * 60 * 1000);
  const candidateMap = new Map<string, any>(); // dedup by post._id

  // Fetch blocked and muted users to exclude from feed
  const [blockedDocs, userDoc] = await Promise.all([
    Block.find({ $or: [{ blocker: userId }, { blocked: userId }] }).select("blocker blocked").lean(),
    User.findById(userId).select("mutedUsers").lean(),
  ]);

  const excludedUserIds = new Set<string>();
  blockedDocs.forEach((b: any) => {
    if (b.blocker?.toString() === userId.toString()) excludedUserIds.add(b.blocked.toString());
    if (b.blocked?.toString() === userId.toString()) excludedUserIds.add(b.blocker.toString());
  });

  const now = new Date();
  ((userDoc as any)?.mutedUsers || []).forEach((m: any) => {
    if (!m.expiresAt || new Date(m.expiresAt) > now) {
      excludedUserIds.add(m.user.toString());
    }
  });

  const networkUserIds = [...followedUserIds, userId.toString()].filter((id) => !excludedUserIds.has(id));

  // Precompute the high-affinity author list — it only depends on the
  // affinity scores, so it can feed the parallel query batch below.
  const highAffinityIds: string[] = [];
  if (affinityScores && affinityScores.size > 0) {
    for (const [authorId, score] of affinityScores) {
      if (score > 0.5 && !followedUserIds.includes(authorId) && !excludedUserIds.has(authorId)) {
        highAffinityIds.push(authorId);
      }
    }
  }

  // 3. Discovery / trending posts (high velocity from outside network)
  // Only public posts are visible in discovery — closeFriends posts aren't shown
  const excludedDiscoveryAuthors = [...followedUserIds, ...excludedUserIds];

  // Run ALL THREE candidate queries in one round-trip. They used to run
  // sequentially — on a cold feed cache that added ~2 extra query latencies
  // (each 50-150ms) to every feed load. Dedup is enforced in the loops below
  // (candidateMap.has guard), so the missing cross-query $nin is harmless.
  const [networkPosts, affinityPosts, discoveryPostsRaw] = await Promise.all([
    // 1. Network users (followed users + self): public posts + closeFriends posts
    networkUserIds.length > 0
      ? Post.find({
          author: { $in: networkUserIds },
          createdAt: { $gte: threeDaysAgo },
          status: "published",
        })
          .populate("author", "username fullName profilePic closeFriends isVerified statusText waitlistPerk")
          .sort({ createdAt: -1 })
          .limit(POOL.FOLLOWING_LIMIT)
          .lean()
      : Promise.resolve([]),
    // 2. High-affinity authors (even if not followed) — public posts only
    highAffinityIds.length > 0
      ? Post.find({
          author: { $in: highAffinityIds },
          createdAt: { $gte: threeDaysAgo },
          status: "published",
          visibility: "public",
        })
          .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
          .sort({ createdAt: -1 })
          .limit(POOL.AFFINITY_LIMIT)
          .lean()
      : Promise.resolve([]),
    // 3. Discovery / trending — fetch 2x the target so the quality filter
    // below can't starve the pool (best DISCOVERY_LIMIT of the survivors).
    Post.find({
      author: { $nin: excludedDiscoveryAuthors },
      createdAt: { $gte: threeDaysAgo },
      status: "published",
      visibility: "public",
    })
      .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
      .sort({ likesCount: -1, commentsCount: -1 })
      .limit(POOL.DISCOVERY_LIMIT * 2)
      .lean(),
  ]);

  for (const post of networkPosts) {
    const authorIdStr = (post as any).author?._id?.toString() || (post as any).author?.toString();
    if (excludedUserIds.has(authorIdStr)) continue;

    if ((post as any).visibility === "closeFriends" && authorIdStr !== userId.toString()) {
      const authorCloseFriends: any[] = (post as any).author?.closeFriends || [];
      const isCloseFriend = authorCloseFriends.some(
        (id: any) => id.toString() === userId.toString()
      );
      if (!isCloseFriend) continue;
    }

    const id = (post as any)._id.toString();
    if (!seenPosts.includes(id)) {
      candidateMap.set(id, { ...post, _isFollowed: true });
    }
  }

  for (const post of affinityPosts) {
    const id = (post as any)._id.toString();
    // Only set when absent — a followed author with high affinity keeps
    // _isFollowed: true (the parallel query can't exclude it via $nin).
    if (!seenPosts.includes(id) && !candidateMap.has(id)) {
      candidateMap.set(id, { ...post, _isFollowed: false });
    }
  }

  // Phase-1 quality gate: low-effort filler from strangers (no media, no
  // hashtags, one-line or boilerplate text) is what made discovery feel like
  // "AI-generated noise". Hard-exclude it from the discovery pool — followed
  // and high-affinity authors are exempt (their content is already relevant).
  // Dedup against the network/affinity candidates BEFORE slicing so a
  // parallel overlap can't starve the discovery budget.
  const discoveryPosts = (discoveryPostsRaw as any[])
    .filter((p: any) => !candidateMap.has((p as any)._id.toString()))
    .filter((p: any) => computeQualityScore(p) >= QUALITY.MIN_DISCOVERY_QUALITY)
    .slice(0, POOL.DISCOVERY_LIMIT);

  for (const post of discoveryPosts) {
    const id = (post as any)._id.toString();
    if (!seenPosts.includes(id)) {
      candidateMap.set(id, { ...post, _isFollowed: false });
    }
  }

  // PRIVATE accounts: non-followers must never see a private user's posts,
  // even when they surface through the affinity or discovery pools. Network
  // posts are already scoped to followed users (+ self), so only filter the
  // non-followed candidates.
  const nonFollowedCandidates = [...candidateMap.values()].filter(
    (p: any) => !p._isFollowed && (p.author?._id?.toString() || p.author?.toString()) !== userId.toString(),
  );
  if (nonFollowedCandidates.length > 0) {
    const candidateAuthorIds = nonFollowedCandidates
      .map((p: any) => p.author?._id?.toString() || p.author?.toString())
      .filter((id: string | undefined): id is string => Boolean(id));
    const privateAuthors = await User.find({
      _id: { $in: candidateAuthorIds },
      isPrivate: true,
    })
      .select("_id")
      .lean();
    if (privateAuthors.length > 0) {
      const privateAuthorSet = new Set(
        privateAuthors.map((u: any) => u._id.toString()),
      );
      for (const [id, post] of candidateMap) {
        if (!(post as any)._isFollowed) {
          const authorId = (post as any).author?._id?.toString() || (post as any).author?.toString();
          if (authorId && privateAuthorSet.has(authorId)) {
            candidateMap.delete(id);
          }
        }
      }
    }
  }

  return [...candidateMap.values()];
}

// ─── Step 2: Scoring Function ──────────────────────────────────────

/**
 * Compute the final score for a single candidate post.
 *
 * finalScore = (affinity × 0.35)
 *            + (contentAffinity × 0.20)
 *            + (velocity × 0.25)
 *            + (recencyDecay × 0.15)
 *            + (followBoost × 0.05)
 */
export function computeScore(
  post: any,
  affinityScores: Map<string, number>,
  contentAffinity: Map<string, number>,
  followedIds: Set<string>,
  boostedAuthors: Set<string>
): ScoredPost {
  const authorId = post.author?._id?.toString() || post.author?.toString();
  const hoursSincePost = Math.max(
    (Date.now() - new Date(post.createdAt).getTime()) / 3_600_000,
    VELOCITY.MIN_HOURS
  );

  // ── Affinity score (log-scaled per-author engagement) ─────────────
  // Use affine form: affinity = log1p(rawScore) so 0→0, small signals don't vanish
  const rawAffinity = affinityScores?.get(authorId) || 0;
  const affinity = Math.log1p(rawAffinity);

  // ── Content affinity (user's engagement with this post's tags) ────
  let contentAffinityScore = 0;
  const hashtags: string[] = post.hashtags || [];
  if (hashtags.length > 0 && contentAffinity && contentAffinity.size > 0) {
    for (const tag of hashtags) {
      contentAffinityScore += contentAffinity.get(tag) || 0;
    }
    // Average across tags
    contentAffinityScore /= hashtags.length;
  }

  // ── Velocity (quality-adjusted) ──────────────────────────────────
  // Old: raw weighted engagement / hours — lets a low-effort post with many
  // likes but terrible per-view engagement dominate the feed. New: the
  // per-view engagement rate multiplied by log-scaled momentum:
  //   velocity = log1p(rawEngagement/hour) × (engagement / views) × scale
  // log1p keeps scale from overwhelming (a 100× engagement gap shrinks to a
  // ~3× gap), while the rate term does the real quality discrimination — a
  // viral spam post (5000 likes / 200k views = 2.5% rate) scores ~2, a
  // modest post with a 50% like rate scores ~21.
  const velocityNumerator =
    (post.likesCount || 0) * VELOCITY.LIKE +
    (post.commentsCount || 0) * VELOCITY.COMMENT +
    (post.savesCount || 0) * VELOCITY.SAVE +
    (post.sharesCount || 0) * VELOCITY.SHARE;
  const rawVelocity = velocityNumerator / hoursSincePost;
  const views = Math.max(post.viewsCount || 0, VELOCITY.MIN_VIEWS);
  const engagementRate = velocityNumerator / views;
  const velocity =
    Math.log1p(rawVelocity) * engagementRate * VELOCITY.RATE_SCALE;

  // ── Recency decay ────────────────────────────────────────────────
  // Recent posts score higher; exponential decay at 8% per hour
  const recencyDecay = Math.exp(-SCORE.RECENCY_DECAY_RATE * hoursSincePost);

  // ── Follow boost ─────────────────────────────────────────────────
  const isFollowed = followedIds.has(authorId);
  const followBoost = isFollowed ? SCORE.FOLLOW_BOOST_MULTIPLIER : SCORE.BASE_BOOST;

  // ── Content quality ──────────────────────────────────────────────
  // Computed once and reused for both the multiplier and the hard floor
  // filter in getRankedFeed. Rich posts (media/tags/meaningful text) float;
  // spam sinks. The multiplier (~0.5–1.2) is a strong tiebreaker but can
  // never fully override the other signals.
  const quality = computeQualityScore(post);
  const qualityMultiplier = 0.5 + quality * 0.7;

  // ── Referral reach boost ─────────────────────────────────────────
  // Authors with an active reach boost (earned by getting invites accepted)
  // get a multiplier on their final score so their content surfaces to more
  // viewers while the boost is live.
  const reachBoost = boostedAuthors.has(authorId)
    ? SCORE.REACH_BOOST_MULTIPLIER
    : 1;

  // ── Final score ──────────────────────────────────────────────────
  const finalScore =
    (affinity * SCORE.AFFINITY_WEIGHT +
      contentAffinityScore * SCORE.CONTENT_AFFINITY_WEIGHT +
      velocity * SCORE.VELOCITY_WEIGHT +
      recencyDecay * SCORE.RECENCY_DECAY_WEIGHT +
      followBoost * SCORE.FOLLOW_BOOST_WEIGHT) *
    reachBoost *
    qualityMultiplier;

  const isFresh = hoursSincePost < DIVERSITY.FRESHNESS_HOURS;

  return {
    post,
    score: finalScore,
    authorId,
    isFollowed,
    isFresh,
    quality,
  };
}

// ─── Step 3: Affinity is handled by the scheduled job ──────────────
// (see affinityService.ts)

// ─── Step 4: Diversity Re-ranking ───────────────────────────────────

/**
 * After scoring, re-rank to enforce:
 * - No more than 2 consecutive posts from the same author
 * - Alternate content types where possible
 */
export function applyDiversityRanking(scored: ScoredPost[]): ScoredPost[] {
  const result: ScoredPost[] = [];
  const remaining = [...scored];
  const recentAuthors: string[] = [];

  while (remaining.length > 0) {
    // Find the best candidate that doesn't violate diversity constraints
    let bestIdx = -1;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      if (!candidate) continue;

      // Check author diversity: count consecutive same-author
      const sameAuthorRecent = recentAuthors.filter(
        (a) => a === candidate.authorId
      ).length;

      if (sameAuthorRecent >= DIVERSITY.MAX_SAME_AUTHOR) {
        continue; // Skip — would violate author diversity
      }

      bestIdx = i;
      break;
    }

    // Fallback: if all remaining violate, just take the top one
    if (bestIdx === -1) {
      bestIdx = 0;
    }

    const selected = remaining.splice(bestIdx, 1)[0];
    if (!selected) break;
    result.push(selected);
    recentAuthors.push(selected.authorId);
    // Keep sliding window limited
    if (recentAuthors.length > DIVERSITY.MAX_SAME_AUTHOR * 2) {
      recentAuthors.shift();
    }
  }

  return result;
}

// ─── Step 5: Freshness Guarantee ───────────────────────────────────

/**
 * Inject very recent posts (< 2 hours old) into reserved slots
 * (positions 3 and 7, 0-indexed) if they aren't already near the top.
 */
export function applyFreshnessGuarantee(scored: ScoredPost[]): ScoredPost[] {
  const freshPosts = scored.filter((s) => s.isFresh);
  const nonFresh = scored.filter((s) => !s.isFresh);

  for (const pos of DIVERSITY.FRESHNESS_POSITIONS) {
    if (pos >= scored.length) break;

    // Check if the current post at this position is already fresh
    if (scored[pos]?.isFresh) continue;

    // Find a fresh post that isn't already in the top N
    const freshIdx = freshPosts.findIndex(
      (f) => !scored.slice(0, DIVERSITY.FRESHNESS_SLOTS).includes(f)
    );
    if (freshIdx === -1) break;

    const fresh = freshPosts.splice(freshIdx, 1)[0];
    if (fresh) {
      // Swap placeholder: replace the post at `pos` with the fresh one
      scored.splice(pos, 1, fresh);
    }
  }

  return scored;
}

// ─── Step 6: Pagination + Caching ──────────────────────────────────

/**
 * Get the ranked feed for a user.
 *
 * Strategy:
 * 1. Check cache (5-10 min TTL per user)
 * 2. Generate candidate pool
 * 3. Score each candidate
 * 4. Diversity re-rank
 * 5. Freshness guarantee
 * 6. Apply cursor-based pagination
 * 7. Cache the result
 */
export async function getRankedFeed(
  userId: string,
  cursor?: string | null,
  limit: number = 20
): Promise<FeedResult> {
  const cacheKey = `feed:ranked:${userId}`;
  const actualLimit = Math.min(limit, 50);

  // 1. Try cache first (TTL: 5 minutes). The hard floor must apply on the
  // cached path too, or stale entries could surface sub-floor spam until the
  // next rebuild. Accepts both the slim {postId, score, ...} entries and
  // legacy full-post entries (written before the slim cache shipped) via
  // the `s.post` shape check.
  try {
    const cached = await getCache<CachedScored[]>(cacheKey);
    if (cached && !cursor) {
      const slim: CachedScored[] = cached.map((s: any) =>
        s.post ? toCached(s) : s,
      );
      const filtered = slim.filter(
        (s) => (s.quality ?? 0) >= QUALITY.MIN_SCORE_FLOOR,
      );
      const page = paginateSlim(filtered, cursor, actualLimit);
      const posts = await hydratePosts(page.entries);
      return {
        posts,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      };
    }
  } catch (err: any) {
    logger.error("Feed cache read error", { error: err.message });
  }

  // 2. Load user data
  const user = await User.findById(userId)
    .select("affinityScores contentAffinity seenPosts following")
    .lean();

  if (!user) {
    return { posts: [], nextCursor: null, hasMore: false };
  }

  // Mongoose `Map` fields come back as plain objects after .lean() —
  // convert them into real JS Maps so `.get()` / `.size` / iteration work.
  const affinityScores = new Map<string, number>(
    Object.entries((user as any).affinityScores || {})
  );
  const contentAffinity = new Map<string, number>(
    Object.entries((user as any).contentAffinity || {})
  );
  const seenPosts: string[] = (user as any).seenPosts || [];

  // Get followed IDs once to reuse in candidate generation and scoring
  const followedUserIds = await Follow.find({ follower: userId })
    .select("following")
    .lean()
    .then((docs) => docs.map((d) => d.following.toString()));
  const followedIds = new Set(followedUserIds);

  // 3. Generate candidates (new users with empty affinity fall back to recency/follow-based feed)
  const candidates = await generateCandidates(userId, affinityScores, seenPosts, followedUserIds);

  if (candidates.length === 0) {
    return { posts: [], nextCursor: null, hasMore: false };
  }

  // 5. Referral reach boost: collect authors with an active boost
  const authorIds = candidates
    .map((c) => c.author?._id?.toString() || c.author?.toString())
    .filter((id): id is string => Boolean(id));
  const boostedAuthors = new Set<string>();
  if (authorIds.length > 0) {
    const boostedDocs = await User.find({
      _id: { $in: authorIds },
      reachBoostUntil: { $gt: new Date() },
    })
      .select("_id")
      .lean();
    boostedDocs.forEach((d: any) => boostedAuthors.add(d._id.toString()));
  }

  // 6. Score each candidate
  let scored: ScoredPost[] = candidates.map((post) =>
    computeScore(post, affinityScores, contentAffinity, followedIds, boostedAuthors)
  );

  // 6b. Phase-2 hard floor: drop spam-level content (boilerplate + spam
  // signals) from the ranked feed entirely — even from followed authors.
  // `?? computeQualityScore` guards against stale cached entries written
  // before the `quality` field existed.
  scored = scored.filter(
    (s) => (s.quality ?? computeQualityScore(s.post)) >= QUALITY.MIN_SCORE_FLOOR
  );

  // 7. Sort by score descending (stable tiebreaker: post ID)
  scored.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) < 0.0001) {
      return (b.post as any)._id.toString().localeCompare((a.post as any)._id.toString());
    }
    return diff;
  });

  // 8. Apply diversity re-ranking
  scored = applyDiversityRanking(scored);

  // 9. Apply freshness guarantee
  scored = applyFreshnessGuarantee(scored);

  // 10. Cache the ranked list (5 min TTL) — slim shape (IDs + scores only,
  // ~10x smaller than the full posts), hydrated on read.
  try {
    await setCache(cacheKey, scored.map(toCached), 300);
  } catch (err: any) {
    logger.error("Feed cache write error", { error: err.message });
  }

  // 11. Paginate
  return paginateFromCandidates(scored, cursor, actualLimit);
}

/**
 * Extract a page from the pre-sorted candidate list using cursor-based pagination.
 */
function paginateFromCandidates(
  candidates: ScoredPost[],
  cursor?: string | null,
  limit: number = 20
): FeedResult {
  let startIdx = 0;

  if (cursor) {
    const foundIdx = candidates.findIndex(
      (s) => (s.post as any)._id.toString() === cursor
    );
    if (foundIdx > -1) {
      startIdx = foundIdx + 1;
    }
  }

  const page = candidates.slice(startIdx, startIdx + limit);
  const hasMore = startIdx + limit < candidates.length;
  const lastItem = page.length > 0 ? page[page.length - 1] : null;
  const nextCursor =
    hasMore && lastItem
      ? (lastItem.post as any)._id.toString()
      : null;

  return {
    posts: page.map((s) => s.post),
    nextCursor,
    hasMore,
  };
}

/**
 * Paginate the SLIM cached entries (no post docs attached yet).
 */
function paginateSlim(
  entries: CachedScored[],
  cursor?: string | null,
  limit: number = 20,
): { entries: CachedScored[]; nextCursor: string | null; hasMore: boolean } {
  let startIdx = 0;

  if (cursor) {
    const foundIdx = entries.findIndex((s) => s.postId === cursor);
    if (foundIdx > -1) {
      startIdx = foundIdx + 1;
    }
  }

  const page = entries.slice(startIdx, startIdx + limit);
  const hasMore = startIdx + limit < entries.length;
  const lastItem = page.length > 0 ? page[page.length - 1] : null;
  const nextCursor = hasMore && lastItem ? lastItem.postId : null;

  return { entries: page, nextCursor, hasMore };
}

/**
 * Fetch the full post docs for a slim page, preserving the ranked order.
 * One indexed `_id $in` query; posts deleted since the cache write drop out.
 */
async function hydratePosts(entries: CachedScored[]): Promise<any[]> {
  if (entries.length === 0) return [];
  const ids = entries.map((e) => e.postId);
  const posts = await Post.find({ _id: { $in: ids } })
    .populate("author", AUTHOR_POPULATE)
    .lean();
  const byId = new Map<string, any>();
  for (const p of posts) {
    byId.set((p as any)._id.toString(), p);
  }
  return entries.map((e) => byId.get(e.postId)).filter(Boolean);
}

/**
 * Invalidate the feed cache for a user (call when user follows someone or posts).
 */
export async function invalidateFeedCache(userId: string): Promise<void> {
  await clearByPattern(`feed:ranked:${userId}`);
  logger.info("Feed cache invalidated for user", { userId });
}
