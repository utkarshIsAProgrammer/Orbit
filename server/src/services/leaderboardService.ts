import mongoose from "mongoose";
import Post from "../models/post.model";
import { User } from "../models/user.model";
import Follow from "../models/follow.model";

/**
 * Leaderboard for a period + optional scope.
 *
 * - `scope: "global"` — everyone (default).
 * - `scope: "following"` — only users the caller follows (the "friends" tab),
 *   which gives a normal user a real stake in the board.
 *
 * Returns the caller's own rank too (yourRank) so the client can render a
 * "Your rank #N" card — a user never lands on a global top-10 by chance, so
 * the personal rank gives them a reason to engage.
 */
export async function getLeaderboard(
  type: "weekly" | "monthly" | "alltime",
  limit: number = 20,
  blockedIds: string[] = [],
  opts: { scope?: "global" | "following"; viewerId?: string } = {},
) {
  const dateFilter: Record<string, Date | undefined> = {};
  const now = new Date();
  if (type === "weekly") dateFilter.$gte = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  else if (type === "monthly") dateFilter.$gte = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const match: any = { status: "published" };
  if (dateFilter.$gte) match.createdAt = dateFilter;

  // Blocked users must not exist for each other — exclude their posts and
  // their profiles from the leaderboard (either-direction blocks).
  // Cast string IDs to ObjectIds — $nin against ObjectId fields silently
  // matches nothing when compared with plain strings.
  const blockedObjectIds = blockedIds
    .filter((id) => mongoose.isObjectIdOrHexString(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  // "Friends" scope — the board shrinks to the users the caller follows
  // (including the caller themself, so their rank is meaningful even with
  // zero followers). Private-account rules do not apply here: the caller
  // chose to follow these people.
  let followingIds: mongoose.Types.ObjectId[] = [];
  if (opts.scope === "following" && opts.viewerId) {
    const follows = await Follow.find({ follower: opts.viewerId })
      .select("following")
      .lean();
    const ids = follows.map((f) => f.following.toString());
    ids.push(opts.viewerId.toString());
    followingIds = ids
      .filter((id) => mongoose.isObjectIdOrHexString(id))
      .map((id) => new mongoose.Types.ObjectId(id));
  }

  if (opts.scope === "following" && followingIds.length > 0) {
    match.author = { $in: followingIds };
  } else if (blockedObjectIds.length > 0) {
    match.author = { $nin: blockedObjectIds };
  }

  // Top posts by engagement
  const topPosts = await Post.aggregate([
    { $match: match },
    { $addFields: { engagementScore: { $add: ["$likesCount", { $multiply: ["$commentsCount", 4] }, { $multiply: ["$savesCount", 3] }, { $multiply: ["$sharesCount", 5] }] } } },
    { $sort: { engagementScore: -1 } },
    { $limit: limit },
    { $lookup: { from: "users", localField: "author", foreignField: "_id", as: "author" } },
    { $unwind: "$author" },
    { $project: { title: 1, slug: 1, engagementScore: 1, likesCount: 1, commentsCount: 1, "author._id": 1, "author.username": 1, "author.fullName": 1, "author.profilePic": 1 } },
  ]);

  // Top creators by followers
  let creatorQuery: any = {};
  if (followingIds.length > 0) {
    creatorQuery._id = { $in: followingIds };
  } else if (blockedObjectIds.length > 0) {
    creatorQuery._id = { $nin: blockedObjectIds };
  }
  const topCreators = await User.find(creatorQuery)
    .sort({ followersCount: -1 })
    .limit(limit)
    .select("_id username fullName profilePic followersCount")
    .lean();

  // ── Caller's rank ────────────────────────────────────────────────
  // Rank among the SAME population the board shows (global followers or the
  // caller's following set). A rank is only meaningful against a known
  // population size, so always compute it across the matching population
  // even when the caller isn't in the top `limit`.
  let yourRank: number | null = null;
  let yourFollowersCount = 0;
  if (opts.viewerId) {
    const rankQuery: any = { ...creatorQuery };
    if (followingIds.length === 0 && blockedObjectIds.length > 0) {
      rankQuery._id = { $nin: blockedObjectIds };
    }
    const myCount = await User.findById(opts.viewerId)
      .select("followersCount")
      .lean();
    yourFollowersCount = myCount?.followersCount || 0;
    const ahead = await User.countDocuments({
      ...rankQuery,
      followersCount: { $gt: yourFollowersCount },
    });
    yourRank = ahead + 1;
  }

  return { topPosts, topCreators, yourRank, yourFollowersCount };
}
