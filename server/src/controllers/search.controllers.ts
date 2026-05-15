import type { Request, Response } from "express";
import mongoose from "mongoose";
import { User } from "../models/user.model";
import Post from "../models/post.model";
import Follow from "../models/follow.model";
import { getCache, setCache } from "../configs/cache";
import { logger } from "../utilities/logger";
import { AppError, BadRequestError } from "../utilities/errors";
import { getBlockedUserIds } from "../utilities/blockCheck";
import { addUserStatusToPosts } from "../utilities/postStatus";

/**
 * Build the WhatsApp/Instagram-style tokenized prefix regex for a multi-word
 * query. Splits on whitespace and anchors EACH token as a prefix of a word,
 * allowing arbitrary words in between:
 *   "sh ku" → ^sh\S*(\s+\S+)*\s+ku\S*   (matches "Shreya Kumar")
 *   "s k"   → ^s\S*(\s+\S+)*\s+k\S*     (initials match too)
 * Returns null for single-token queries (the plain prefix path handles them).
 */
export function buildTokenizedSearchRegex(q: string): string | null {
  const tokens = q
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length <= 1) return null;
  const escapedTokens = tokens.map((t) =>
    t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  return `^${escapedTokens.join("\\S*(\\s+\\S+)*\\s+")}\\S*`;
}

/** Split a query into escaped lowercase tokens (for contains-anywhere AND). */
export function tokenizeSearchQuery(q: string): string[] {
  return q
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

export const searchUsers = async (req: Request, res: Response) => {
  try {
    const q = req.query.q?.toString().trim();
    const currentUserId = req.user?._id;
    const limit = Math.min(Number(req.query.limit) || 10, 20);
    const cursor = req.query.cursor as string;
    const escapedQuery = q ? q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";

    // cache key (v3: per-token matching + case-insensitive regex — bump when
    // the matching semantics change so stale results don't linger for the TTL)
    const cacheKey = `search:users:v3:${q || ""}:${cursor || "first"}:${limit}:${currentUserId?.toString() || "anon"}`;
    try {
      const cached = await getCache(cacheKey);
      if (cached) return res.status(200).json(cached);
    } catch (err: any) {
      logger.error(`Cache error in searchUsers!`, { error: err.message });
    }

    // Blocked users must never appear in search
    let blockedIds: any[] = [];
    if (currentUserId) {
      blockedIds = await getBlockedUserIds(currentUserId.toString());
    }

    let users: any[] = [];

    if (q) {
      try {
        const textQuery: Record<string, any> = { $text: { $search: q } };
        if (currentUserId && cursor) {
          textQuery._id = { $ne: currentUserId, $lt: cursor };
        } else if (currentUserId) {
          textQuery._id = { $ne: currentUserId };
        } else if (cursor) {
          textQuery._id = { $lt: cursor };
        }
        if (blockedIds.length > 0) {
          textQuery._id = { ...(typeof textQuery._id === "object" ? textQuery._id : {}), $nin: blockedIds };
        }
        users = await User.find(textQuery)
          .select("_id fullName username profilePic followersCount followingCount waitlistPerk")
          .sort({ _id: -1 })
          .limit(limit + 1)
          .lean();
      } catch (textErr) {
        logger.info("Text search failed, falling back to regex search", { error: (textErr as Error).message });
      }

      if (users.length === 0) {
        // Ranked fallback — this is the path short queries (1-2 chars, e.g.
        // the first letter of an @mention) take, because Mongo's $text search
        // ignores single-char terms. Instead of an unanchored, newest-first
        // regex (which surfaces "natalia" for the query "a"), rank matches:
        // username-prefix > fullName-prefix > contains-anywhere, ordered by
        // follower count so the most relevant people come first — the same
        // "best possible search" everywhere in the app, including @mention
        // autocomplete.
        const exclusions: Record<string, any> = {};
        if (currentUserId && cursor) {
          exclusions._id = { $ne: currentUserId, $lt: cursor };
        } else if (currentUserId) {
          exclusions._id = { $ne: currentUserId };
        } else if (cursor) {
          exclusions._id = { $lt: cursor };
        }
        if (blockedIds.length > 0) {
          exclusions._id = {
            ...(typeof exclusions._id === "object" ? exclusions._id : {}),
            $nin: blockedIds,
          };
        }

        const pick =
          "_id fullName username profilePic followersCount followingCount waitlistPerk";

        // ── Tokenized matching (WhatsApp/Instagram behavior) ───────────────
        // Split the query into whitespace-separated tokens and match EACH
        // token as a PREFIX of successive words in the name: "sh ku" must
        // match "Shreya Kumar" (sh→Shreya, ku→Kumar) and initials "s k" must
        // match too. A single literal regex `^sh ku` fails both — that was
        // the "type half the name, still no results" bug.
        //
        // NB: every regex here carries $options: "i". MongoDB's $regex does
        // NOT honor .collation() for case-insensitivity (verified empirically
        // on Atlas: `^sh` + collation strength 2 returns nothing for
        // "Shreya Kumari", while `^sh` + $options "i" matches). The collation
        // indexes can't serve case-insensitive regexes, so the anchored regex
        // + i scans the collection — instant at this size, and correct.
        const tokens = tokenizeSearchQuery(q);
        const isMultiToken = tokens.length > 1;

        // Pass 1: authoritative prefix matches.
        //  - Single token: ^token on username/fullName (the common "type the
        //    start" case).
        //  - Multi token: per-word prefix regex only — "s k" must NOT return
        //    every user whose name starts with "s" (that was the "Peter
        //    beniwal" pollution: first-token matches filling the limit while
        //    the second token was never checked). Each token must prefix a
        //    successive word: ^s\S*(\s+\S+)*\s+k\S*.
        let prefixUsers: any[] = [];
        if (isMultiToken) {
          const tokenizedRegex = buildTokenizedSearchRegex(q);
          if (tokenizedRegex) {
            prefixUsers = await User.find({
              ...exclusions,
              $or: [
                { fullName: { $regex: tokenizedRegex, $options: "i" } },
                { username: { $regex: tokenizedRegex, $options: "i" } },
              ],
            })
              .select(pick)
              .sort({ followersCount: -1, _id: -1 })
              .limit(limit + 1)
              .lean();
          }
        } else {
          const firstToken = tokens[0] || escapedQuery;
          prefixUsers = await User.find({
            ...exclusions,
            $or: [
              { username: { $regex: `^${firstToken}`, $options: "i" } },
              { fullName: { $regex: `^${firstToken}`, $options: "i" } },
            ],
          })
            .select(pick)
            .sort({ followersCount: -1, _id: -1 })
            .limit(limit + 1)
            .lean();
        }

        if (prefixUsers.length >= limit + 1) {
          users = prefixUsers;
        } else {
          // Pass 2: contains-anywhere, excluding what pass 1 already found.
          const prefixIds = prefixUsers.map((u: any) => u._id);
          const idFilter: Record<string, any> = {};
          if (currentUserId) idFilter.$ne = currentUserId;
          if (cursor) idFilter.$lt = cursor;
          // NB: never set `$nin: []` — MongoDB treats it as matching nothing.
          const excludeIds = [...blockedIds, ...prefixIds];
          if (excludeIds.length > 0) idFilter.$nin = excludeIds;

          // For multi-token queries, contains-anywhere must be per-token AND:
          // every token must appear somewhere ("sh ku" matches "Ashish
          // Kumar" via sh⊂Ashish, ku⊂Kumar), not the literal "sh ku" string.
          const containsOr: Record<string, any>[] = isMultiToken
            ? tokens.map((t) => ({
                $or: [
                  { username: { $regex: t, $options: "i" } },
                  { fullName: { $regex: t, $options: "i" } },
                ],
              }))
            : [
                { username: { $regex: escapedQuery, $options: "i" } },
                { fullName: { $regex: escapedQuery, $options: "i" } },
              ];

          const containsUsers = await User.find({
            _id: idFilter,
            ...(isMultiToken ? { $and: containsOr } : { $or: containsOr }),
          })
            .select(pick)
            .sort({ followersCount: -1, _id: -1 })
            .limit(limit + 1 - prefixUsers.length)
            .lean();
          users = [...prefixUsers, ...containsUsers];
        }
      }
    } else {
      // No query: show all users except current
      const allUsersQuery: Record<string, any> = {};
      if (currentUserId && cursor) {
        allUsersQuery._id = { $ne: currentUserId, $lt: cursor };
      } else if (currentUserId) {
        allUsersQuery._id = { $ne: currentUserId };
      } else if (cursor) {
        allUsersQuery._id = { $lt: cursor };
      }
      if (blockedIds.length > 0) {
        allUsersQuery._id = { ...(typeof allUsersQuery._id === "object" ? allUsersQuery._id : {}), $nin: blockedIds };
      }
      users = await User.find(allUsersQuery)
        .select("_id fullName username profilePic followersCount followingCount waitlistPerk")
        .sort({ _id: -1 })
        .limit(limit + 1)
        .lean();
    }

    const hasMore = users.length > limit;
    if (hasMore) {
      users.pop();
    }
    const nextCursor = users.slice(-1).pop()?._id || null;

    // add followingByMe to each user
    const followingSet = new Set<string>();
    if (currentUserId && users.length > 0) {
      const userIds = users.map(u => u._id);
      const existingFollows = await Follow.find({
        follower: currentUserId,
        following: { $in: userIds },
      }).lean();

      existingFollows.forEach(follow => {
        followingSet.add(follow.following.toString());
      });
    }

    const usersWithStatus = users.map(user => ({
      ...user,
      followingByMe: followingSet.has(user._id.toString()),
    }));

    const responseData = {
      success: true,
      count: usersWithStatus.length,
      users: usersWithStatus,
      nextCursor,
      hasMore,
    };

    // cache search results (60s — results are relatively stable)
    try {
      await setCache(cacheKey, responseData, 60);
    } catch (err: any) {
      logger.error(`Cache set error in searchUsers!`, { error: err.message });
    }

    return res.status(200).json(responseData);
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in the searchUsers controller!`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

export const searchPosts = async (req: Request, res: Response) => {
  try {
    const q = req.query.q?.toString().trim();
    const limit = Math.min(Number(req.query.limit) || 10, 20);
    const cursor = req.query.cursor as string;
    const escapedQuery = q ? q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
    const currentUserId = req.user?._id?.toString();

    // cache key
    const cacheKey = `search:posts:${q || ""}:${cursor || "first"}:${limit}:${currentUserId || "anon"}`;
    try {
      const cached = await getCache(cacheKey);
      if (cached) return res.status(200).json(cached);
    } catch (err: any) {
      logger.error(`Cache error in searchPosts!`, { error: err.message });
    }

    let posts: any[] = [];

    // Blocked users must never appear in post search. These four lookups
    // (blocked ids, hidden posts, followed ids, ALL private authors) used to
    // hit Mongo on EVERY keystroke — the private-author scan alone is a full
    // collection read. They change rarely, so cache each briefly: same
    // correctness within ~30-60s, but search stops paying for 4 extra queries
    // (and a users-collection scan) per request.
    let blockedPostIds: string[] = [];
    let hiddenPostIds: string[] = [];
    if (currentUserId) {
      const uid = currentUserId;
      const blockedKey = `search:blocked:${uid}`;
      try {
        const cachedBlocked = await getCache<string[]>(blockedKey);
        if (cachedBlocked) blockedPostIds = cachedBlocked;
      } catch { /* noop */ }
      if (blockedPostIds.length === 0) {
        blockedPostIds = await getBlockedUserIds(uid);
        try { await setCache(blockedKey, blockedPostIds, 60); } catch { /* noop */ }
      }

      const hiddenKey = `search:hidden:${uid}`;
      try {
        const cachedHidden = await getCache<string[]>(hiddenKey);
        if (cachedHidden) hiddenPostIds = cachedHidden;
      } catch { /* noop */ }
      if (hiddenPostIds.length === 0) {
        const viewer = await User.findById(uid).select("hiddenPosts").lean();
        hiddenPostIds = ((viewer as any)?.hiddenPosts || []).map((id: any) => id.toString());
        try { await setCache(hiddenKey, hiddenPostIds, 30); } catch { /* noop */ }
      }
    }

    // Cached "which private authors should be hidden from this viewer"
    // (private-user list changes rarely; cache it 120s globally).
    const privateAuthorsKey = `search:privateAuthors`;
    let allPrivateAuthors: { _id: mongoose.Types.ObjectId }[] | null = null;
    try {
      const cachedPriv = await getCache<{ _id: string }[]>(privateAuthorsKey);
      if (cachedPriv) {
        allPrivateAuthors = cachedPriv.map((p) => ({ _id: new mongoose.Types.ObjectId(p._id) }));
      }
    } catch { /* noop */ }
    if (!allPrivateAuthors) {
      allPrivateAuthors = await User.find({ isPrivate: true }).select("_id").lean();
      try {
        await setCache(
          privateAuthorsKey,
          (allPrivateAuthors as any[]).map((u) => ({ _id: u._id.toString() })),
          120,
        );
      } catch { /* noop */ }
    }

    // Content preference: hide posts the user marked "Not interested".
    const excludeHidden = (baseQuery: any) => {
      if (hiddenPostIds.length === 0) return;
      if (baseQuery._id && typeof baseQuery._id === "object") {
        baseQuery._id = { ...baseQuery._id, $nin: hiddenPostIds };
      } else {
        baseQuery._id = { $nin: hiddenPostIds };
      }
    };

    // PRIVATE accounts: Instagram never surfaces a private user's posts in
    // search for non-followers. Compute the private author ids the viewer
    // does NOT follow and exclude them from every post-search branch. The
    // viewer's followed list is cached 60s (it only changes on follow/unfollow)
    // and the private-author list is already cached above — two cached reads
    // instead of two collection queries per keystroke.
    let followedIds: string[] = [];
    if (currentUserId) {
      const followedKey = `search:followed:${currentUserId}`;
      try {
        const cached = await getCache<string[]>(followedKey);
        if (cached) followedIds = cached;
      } catch { /* noop */ }
      if (followedIds.length === 0) {
        followedIds = await Follow.find({ follower: currentUserId })
          .select("following")
          .lean()
          .then((docs) => docs.map((d) => d.following.toString()));
        try { await setCache(followedKey, followedIds, 60); } catch { /* noop */ }
      }
    }
    const followedSet = new Set(followedIds);
    const hiddenPrivateAuthorIds = (allPrivateAuthors as any[])
      .filter((u: any) => !followedSet.has(u._id.toString()))
      .map((u: any) => u._id);
    const excludePrivateAuthors = (baseQuery: any) => {
      if (hiddenPrivateAuthorIds.length === 0) return;
      const existingAuthor = baseQuery.author;
      if (existingAuthor && typeof existingAuthor === "object" && "$nin" in existingAuthor) {
        baseQuery.author = { $nin: [...existingAuthor.$nin, ...hiddenPrivateAuthorIds] };
      } else {
        baseQuery.author = { $nin: hiddenPrivateAuthorIds };
      }
    };

    if (q) {
      try {
        // PRIVACY: the $text path must be scoped to public posts only —
        // otherwise closeFriends-only posts leak into search results for
        // anyone (the regex fallback below already filters visibility, so
        // this keeps the two paths consistent).
        const textQuery: any = { $text: { $search: q }, visibility: "public" };
        if (cursor) {
          textQuery._id = { $lt: cursor };
        }
        if (blockedPostIds.length > 0) {
          textQuery.author = { $nin: blockedPostIds };
        }
        excludePrivateAuthors(textQuery);
        excludeHidden(textQuery);
        posts = await Post.find(textQuery)
          .select(
            "title content image images likesCount commentsCount repostsCount createdAt author viewsCount savesCount sharesCount tags slug",
          )
          .populate("author", "fullName username profilePic isVerified statusText waitlistPerk")
          .sort({ _id: -1 })
          .limit(limit + 1)
          .lean();
      } catch (textErr) {
        logger.info("Text search failed, falling back to regex search", { error: (textErr as Error).message });
      }

      if (posts.length === 0) {
        // Handle hashtag search - remove # from query if present and escape regex
        const tagQuery = q.startsWith('#') ? q.slice(1) : q;
        const escapedTagQuery = tagQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Case-insensitive matching via $options:"i" on every regex —
        // MongoDB's $regex does NOT apply collation to matching (verified
        // empirically), so `^Title` + collation silently misses "title".
        // The anchored title-prefix stays an index-friendly bound; content/
        // tag contains-matches are the bounded fallback.
        const regexQuery: any = { 
          visibility: "public",
          $or: [
            { title: { $regex: `^${escapedQuery}`, $options: "i" } },
            { content: { $regex: escapedQuery, $options: "i" } },
            { tags: { $in: [new RegExp(escapedTagQuery, "i")] } },
            { hashtags: { $in: [new RegExp(escapedTagQuery, "i")] } }
          ]
        };
        if (cursor) {
          regexQuery._id = { $lt: cursor };
        }
        if (blockedPostIds.length > 0) {
          regexQuery.author = { $nin: blockedPostIds };
        }
        excludePrivateAuthors(regexQuery);
        excludeHidden(regexQuery);
        posts = await Post.find(regexQuery)
          .collation({ locale: "en", strength: 2 })
          .select(
            "title content image images likesCount commentsCount repostsCount createdAt author viewsCount savesCount sharesCount tags slug",
          )
          .populate("author", "fullName username profilePic isVerified statusText waitlistPerk")
          .sort({ _id: -1 })
          .limit(limit + 1)
          .lean();
      }
    } else {
      // If no query, show public posts
      const allPostsQuery: any = { visibility: "public" };
      if (cursor) {
        allPostsQuery._id = { $lt: cursor };
      }
      if (blockedPostIds.length > 0) {
        allPostsQuery.author = { $nin: blockedPostIds };
      }
      excludePrivateAuthors(allPostsQuery);
      excludeHidden(allPostsQuery);
      posts = await Post.find(allPostsQuery)
        .select(
          "title content image images likesCount commentsCount repostsCount createdAt author viewsCount savesCount sharesCount tags slug",
        )
        .populate("author", "fullName username profilePic isVerified statusText waitlistPerk")
        .sort({ _id: -1 })
        .limit(limit + 1)
        .lean();
    }

    const hasMore = posts.length > limit;
    if (hasMore) posts.pop();
    const nextCursor = posts.slice(-1).pop()?._id || null;

    const postsWithStatus = await addUserStatusToPosts(posts, currentUserId);

    const responseData = {
      success: true,
      count: postsWithStatus.length,
      posts: postsWithStatus,
      nextCursor,
      hasMore,
    };

    // cache search results (60s)
    try {
      await setCache(cacheKey, responseData, 60);
    } catch (err: any) {
      logger.error(`Cache set error in searchPosts!`, { error: err.message });
    }

    return res.status(200).json(responseData);
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in the searchPosts controller!`, { error: err.message });
    throw new AppError("Internal server error!");
  }
};

// return empty array instead of 500 when q parameter is empty string

// use primaryPreferred for location-based search to ensure consistency

// escape special regex characters before constructing search pattern

// return [] instead of undefined when index is empty
