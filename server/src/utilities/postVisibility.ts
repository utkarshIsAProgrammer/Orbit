import { User } from "../models/user.model";
import Post from "../models/post.model";
import Follow from "../models/follow.model";

/**
 * Check whether the current user may view a post authored by the given
 * author, enforcing BOTH private-account privacy AND closeFriends.
 *
 * Rules (Instagram-style):
 * - Unauthenticated viewers are always denied.
 * - The author can always see their own content.
 * - If the author's account is PRIVATE, the viewer must be following them —
 *   otherwise every post (public or closeFriends) is hidden.
 * - closeFriends posts additionally require the viewer to be on the
 *   author's closeFriends list.
 */
export async function canViewCloseFriendsPost(
  post: any,
  currentUserId: string | undefined,
): Promise<boolean> {
  const authorId = post.author?._id?.toString() || post.author?.toString();
  if (!authorId) return false;

  // Anonymous viewers may see PUBLIC posts from PUBLIC accounts — but never
  // closeFriends posts or content from private accounts. This keeps shared
  // post links (/p/:slug) working for logged-out users while preserving
  // privacy.
  if (!currentUserId) {
    if (post.visibility === "closeFriends") return false;
    const author = await User.findById(authorId).select("isPrivate").lean();
    if (author?.isPrivate) return false;
    return true;
  }

  if (authorId === currentUserId) return true;

  const author = await User.findById(authorId)
    .select("isPrivate closeFriends")
    .lean();
  if (!author) return false;

  // Private accounts: only approved followers can see anything at all.
  if (author.isPrivate) {
    const isFollowing = await Follow.exists({
      follower: currentUserId,
      following: authorId,
    });
    if (!isFollowing) return false;
  }
  // (Follow.exists resolves to a document or null — coerce for clarity above.)

  // closeFriends posts: only listed friends (beyond following).
  if (post.visibility === "closeFriends") {
    return author.closeFriends?.some(
      (id: any) => id.toString() === currentUserId,
    );
  }
  return true;
}

/**
 * User-level privacy gate (for posts lists, pinned posts, follower/following
 * lists and glance feeds where we only know the AUTHOR's id, not a post doc).
 *
 * Rules:
 * - Unauthenticated viewers are denied.
 * - The user can always see their own data.
 * - Public accounts are visible to everyone.
 * - Private accounts are only visible to the author + their approved
 *   followers (following relationship).
 */
export async function canViewUserContent(
  authorId: string,
  currentUserId: string | undefined,
): Promise<boolean> {
  if (!currentUserId) return false;
  if (authorId === currentUserId) return true;

  const author = await User.findById(authorId).select("isPrivate").lean();
  if (!author) return false;
  if (!author.isPrivate) return true;

  const isFollowing = await Follow.exists({
    follower: currentUserId,
    following: authorId,
  });
  return !!isFollowing;
}

/**
 * Convenience guard for post-id endpoints (likes, comments, votes, views):
 * fetches the post, returns true when the caller may interact with it.
 * Returns false for non-existent / hidden posts so callers can 404.
 */
export async function canInteractWithPost(
  postId: string,
  currentUserId: string | undefined,
): Promise<{ allowed: boolean; post: any }> {
  const post = await Post.findById(postId).lean();
  if (!post) return { allowed: false, post: null };
  return {
    allowed: await canViewCloseFriendsPost(post, currentUserId),
    post,
  };
}
