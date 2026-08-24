import Like from "../models/like.model";
import Save from "../models/saves.model";
import Repost from "../models/repost.model";
import { User } from "../models/user.model";

/**
 * Adds user interaction status to posts (likedByMe, savedByMe, repostedByMe, pinnedByMe)
 * Uses batch queries for efficiency - only 4 queries regardless of post count
 * 
 * @param posts - Array of posts to annotate
 * @param userId - Current user's ID (if authenticated)
 * @returns Posts with added status fields
 */
export const addUserStatusToPosts = async (posts: any[], userId: string | undefined) => {
  if (!userId || !posts.length) return posts;

  const postIds = posts.map(post => post._id?.toString() || post._id);

  // All queries run in parallel for optimal performance
  const [likedPosts, savedPosts, repostedPosts, currentUser] = await Promise.all([
    Like.find({ author: userId, post: { $in: postIds } }).select("post").lean(),
    Save.find({ user: userId, post: { $in: postIds } }).select("post").lean(),
    Repost.find({ user: userId, post: { $in: postIds } }).select("post").lean(),
    User.findById(userId).select("pinnedPosts").lean(),
  ]);

  // Build Sets for O(1) lookup
  const likedSet = new Set(likedPosts.map((l: any) => l.post?.toString()));
  const savedSet = new Set(savedPosts.map((s: any) => s.post?.toString()));
  const repostedSet = new Set(repostedPosts.map((r: any) => r.post?.toString()));
  const pinnedSet = new Set(
    currentUser?.pinnedPosts?.map((id: any) => id.toString()) || []
  );

  return posts.map(post => {
    const postId = post._id?.toString() || post._id;
    return {
      ...post,
      likedByMe: likedSet.has(postId),
      savedByMe: savedSet.has(postId),
      repostedByMe: repostedSet.has(postId),
      pinnedByMe: pinnedSet.has(postId),
      // Expose the user's own poll vote (option index) and strip the raw
      // voter-ID arrays so other users' identities are never leaked.
      myVote: getMyPollVote(post, userId),
      poll: sanitizePoll(post.poll, userId),
    };
  });
};

/**
 * Compute the option index the given user voted on, or null.
 *
 * Handles both raw polls (votes = array of user IDs) and already-sanitized
 * polls (votes = count + optional `votedByMe`) so it is safe to call on
 * cached responses that were sanitized before being stored.
 */
function getMyPollVote(post: any, userId: string | undefined): number | null {
  if (!userId || !post?.poll?.options) return null;
  const uid = userId.toString();
  for (let i = 0; i < post.poll.options.length; i++) {
    const opt = post.poll.options[i];
    // Sanitized poll carries an explicit per-option votedByMe flag
    if (opt && typeof opt.votedByMe === "boolean" && opt.votedByMe) return i;
    // Raw poll: votes is an array of user ObjectIds
    if (Array.isArray(opt?.votes) && opt.votes.some((v: any) => v?.toString() === uid)) {
      return i;
    }
  }
  return null;
}

/**
 * Strip raw voter-ID arrays from a poll and replace them with vote counts,
 * plus a computed `expired` flag. Idempotent — safe to call on already-
 * sanitized polls. Returns null when there is no poll.
 */
export function sanitizePoll(
  poll: any,
  userId?: string | undefined,
): any {
  if (!poll) return null;
  const uid = userId?.toString();
  const myVote = getMyPollVote({ poll }, userId);
  const options = (poll.options || []).map((opt: any, i: number) => {
    const rawVotes = Array.isArray(opt?.votes) ? opt.votes : [];
    return {
      text: opt.text,
      votes: rawVotes.length > 0 ? rawVotes.length : (opt.votes || 0),
      votedByMe: myVote === i && uid !== undefined,
    };
  });
  return {
    options,
    totalVotes: poll.totalVotes || 0,
    expiresAt: poll.expiresAt || null,
    expired: poll.expiresAt ? new Date(poll.expiresAt) < new Date() : false,
    myVote: uid ? myVote : null,
  };
}