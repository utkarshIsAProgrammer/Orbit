import mongoose from "mongoose";
import type { Request, Response } from "express";
import Post from "../models/post.model";
import Comment from "../models/comment.model";
import { Community } from "../models/community.model";
import { CommunityMessage } from "../models/communityMessage.model";
import { getIO } from "../configs/socket";
import Like from "../models/like.model";
import Repost from "../models/repost.model";
import Save from "../models/saves.model";
import Notification from "../models/notification.model";
import { createPostSchema } from "../schemas/post.schema";
import { updatePostSchema, addViewSchema } from "../schemas/interaction.schema";
import { AppError, BadRequestError, NotFoundError, UnauthorizedError, ForbiddenError, ConflictError } from "../utilities/errors";
import cloudinary from "../configs/cloudinary";
import {
  getCache,
  setCache,
  deleteCache,
  clearFeedCache,
  clearCommentsCache,
  clearSavesCache,
  clearUserPostsCache,
  clearDraftsCache,
  clearByPattern,
} from "../configs/cache";
import { User } from "../models/user.model";
import { env } from "../configs/env";
import { canViewCloseFriendsPost, canInteractWithPost } from "../utilities/postVisibility";
import Follow from "../models/follow.model";
import { createNotification, extractMentions } from "../utilities/notification";
import { areMutuallyBlocked, getBlockedUserIds } from "../utilities/blockCheck";
import { sanitizePlainText } from "../configs/sanitize";
import { emitPostCreated, emitPostDeleted, emitPostUpdated, emitPollUpdated, emitPostView, emitPostPin, emitPostUnpin, emitPostShare } from "../configs/socket";
import { deliverWebhookEvent } from "./webhook.controller";
import { logger } from "../utilities/logger";
import { addUserStatusToPosts, sanitizePoll } from "../utilities/postStatus";
import { logInteraction } from "../services/affinityService";
import { invalidateFeedCache } from "../services/feedService";
import { awardXP, XP_REWARDS } from "../services/xpService";
import { checkBadgesAndNotify } from "../services/badgeService";
import { checkAllRounderBadge } from "../services/badgeService";
import { awardTimeOfDayBadges } from "../services/badgeService";
import { progressMission } from "../services/dailyMissionService";
import { cleanupMedia } from "../services/mediaCleanupService";
import { deliverForwardToChat } from "../services/chatForwardService";
import { getMulterFiles, getErrorMessage } from "../types/global";

type Params = {
  postId: string;
};

/** Shape of an uploaded file from multer */
interface UploadedFile {
  path: string;
  filename: string;
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
}

/** Shape of the image metadata stored in the DB */
interface ImageMeta {
  url: string;
  public_id: string;
  alt?: string;
}

/** Extract uploaded files from request, returning typed arrays per field */
function extractFiles(req: Request): {
  images: UploadedFile[];
  image: UploadedFile[];
  video?: UploadedFile;
} {
  const files = getMulterFiles(req.files);
  return {
    images: (files.images || []) as UploadedFile[],
    image: (files.image || []) as UploadedFile[],
    video: (files.video?.[0]) as UploadedFile | undefined,
  };
}

/** Build ImageMeta array from UploadedFiles with a fallback alt text */
function buildImages(files: UploadedFile[], alt: string): ImageMeta[] {
  return files.map((f) => ({
    url: f.path,
    public_id: f.filename,
    alt: alt.substring(0, 100),
  }));
}

// get single post by id
export const getPost = async (req: Request<Params>, res: Response) => {
  const { postId } = req.params;
  const currentUserId = req.user?._id?.toString();

  try {
    // validate id
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new BadRequestError("Invalid ID!");
    }

    // try cache first
    const cacheKey = `post:${postId}`;
    try {
      const cached = await getCache<{ post: any }>(cacheKey);
      if (cached) {
        // The cache is shared across users, so closeFriends visibility AND
        // block status must be enforced on EVERY read — otherwise an
        // authorized viewer's cache entry would let an outsider or a blocked
        // user fetch the post until the TTL expires.
        const cachedAuthorId = cached.post?.author?._id?.toString() || cached.post?.author?.toString();
        if (
          cachedAuthorId &&
          currentUserId &&
          cachedAuthorId !== currentUserId &&
          (await areMutuallyBlocked(currentUserId, cachedAuthorId))
        ) {
          throw new NotFoundError("Post not found!");
        }
        if (!(await canViewCloseFriendsPost(cached.post, currentUserId))) {
          throw new NotFoundError("Post not found!");
        }
        // Re-attach user status (following state may have changed)
        const postsWithStatus = await addUserStatusToPosts([cached.post], currentUserId);
        return res.status(200).json({
          success: true,
          message: "Post fetched successfully!",
          post: postsWithStatus[0],
        });
      }
    } catch (err: any) {
      if (err.statusCode && err.statusCode < 500) throw err;
      logger.error(`Cache error in getPost!`, { error: err?.message });
    }

    // fetch post
    let post = await Post.findById(postId)
      .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
      .populate("collaborator", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    // check existence
    if (!post) {
      throw new NotFoundError("Post not found!");
    }

    // Blocked users must not exist for each other — hide the post entirely
    const postAuthorId = post.author?._id?.toString() || post.author?.toString();
    if (
      postAuthorId &&
      currentUserId &&
      postAuthorId !== currentUserId &&
      (await areMutuallyBlocked(currentUserId, postAuthorId))
    ) {
      throw new NotFoundError("Post not found!");
    }

    // Drafts & scheduled posts are only visible to their author
    if (post.status && post.status !== "published") {
      const isAuthor =
        currentUserId &&
        post.author?._id?.toString() === currentUserId;
      if (!isAuthor) {
        throw new NotFoundError("Post not found!");
      }
    }

    // Visibility check: hide closeFriends posts from non-close-friends
    if (!(await canViewCloseFriendsPost(post, currentUserId))) {
      throw new NotFoundError("Post not found!");
    }

    // Cache the RAW post (before user status + poll sanitization) so the
    // cache is shared across users without leaking one viewer's poll vote.
    // User status / sanitized poll are re-attached per request below.
    try {
      await setCache(cacheKey, { post }, 60 * 30); // 30 min — single posts rarely change
    } catch (err: any) {
      logger.error(`Cache set error in getPost!`, { error: err?.message });
    }

    // Add user status + sanitize poll for THIS viewer only
    const postsWithStatus = await addUserStatusToPosts([post], currentUserId);
    post = postsWithStatus[0];

    return res.status(200).json({
      success: true,
      message: "Post fetched successfully!",
      post,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in getPost controller!`, { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

// get all posts (supports optional sort parameter: likesCount, createdAt, viewsCount)
export const getAllPosts = async (req: Request, res: Response) => {
  const currentUserId = req.user?._id?.toString();
  try {
    // pagination
    const limit = Number(req.query.limit) || undefined;
    const cursor = req.query.cursor as string;
    const authorId = req.query.author as string;
    const sortField = req.query.sort as string;
    const cacheKey = `posts:${authorId || "all"}:${cursor || "first"}:${limit || "all"}:${currentUserId || "anon"}:sort${sortField || "_id"}`;

    // try cache first
    try {
      const cached = await getCache<{
        posts: any[];
        nextCursor: string | null;
        hasMore: boolean;
        message: string;
        success: boolean;
      }>(cacheKey);
      if (cached) {
        // Re-attach user status (in case following state changed since caching)
        const postsWithStatus = await addUserStatusToPosts(
          cached.posts,
          currentUserId,
        );
        return res.status(200).json({
          ...cached,
          posts: postsWithStatus,
        });
      }
    } catch (err: any) {
      logger.error(`Cache error in getAllPosts!`, { error: err?.message });
    }

    // query
    const query: any = { status: "published" };

    // author filter
    if (authorId && mongoose.Types.ObjectId.isValid(authorId)) {
      query.author = authorId;
    }

    // ── Relationship lookups, bundled + cached ───────────────────────
    // Blocked ids, muted ids, close-friend authors and hidden-post ids are
    // static per user for minutes at a time, but the posts cache only lives
    // 15s — so without this, EVERY cache miss re-ran 4 collection queries
    // before the Post query even started. The bundle is cached for 60s.
    const relCacheKey = `rel:posts:${currentUserId || "anon"}`;
    let relData: {
      blockedIds: string[];
      mutedIds: any[];
      closeFriendAuthorIds: any[];
      hiddenIds: string[];
    } = {
      blockedIds: [],
      mutedIds: [],
      closeFriendAuthorIds: [],
      hiddenIds: [],
    };
    if (currentUserId) {
      try {
        const cachedRel = await getCache(relCacheKey);
        if (cachedRel) {
          relData = cachedRel as typeof relData;
        } else {
          const now = new Date();
          const [blockedIds, viewer, closeFriendAuthors] = await Promise.all([
            getBlockedUserIds(currentUserId),
            User.findById(currentUserId).select("mutedUsers hiddenPosts").lean(),
            User.find({ closeFriends: currentUserId }).select("_id").lean(),
          ]);
          const mutedIds: any[] = [];
          ((viewer as any)?.mutedUsers || []).forEach((m: any) => {
            if (m?.user && (!m.expiresAt || new Date(m.expiresAt) > now)) {
              mutedIds.push(m.user);
            }
          });
          relData = {
            blockedIds,
            mutedIds,
            closeFriendAuthorIds: closeFriendAuthors.map((u: any) => u._id),
            hiddenIds: ((viewer as any)?.hiddenPosts || []).map((id: any) => id.toString()),
          };
          await setCache(relCacheKey, relData, 60);
        }
      } catch (err: any) {
        logger.error(`Cache error in getAllPosts rel lookup!`, { error: err.message });
      }
    }

    // If there's a specific author and they're blocked (either direction),
    // return nothing — blocked users must not exist for each other.
    if (authorId && currentUserId && authorId !== currentUserId) {
      if (await areMutuallyBlocked(currentUserId, authorId)) {
        return res.status(200).json({
          success: true,
          message: "No posts yet!",
          posts: [],
          nextCursor: null,
          hasMore: false,
        });
      }
    } else if (!authorId && currentUserId) {
      // Global feed — hide posts from anyone blocked in either direction
      if (relData.blockedIds.length > 0) {
        query.author = { $nin: relData.blockedIds };
      }
      // …and from anyone the viewer muted (30-day mute window).
      // Muted posts must not resurface on every paginated refetch.
      if (relData.mutedIds.length > 0) {
        query.author = {
          ...(typeof query.author === "object" && query.author
            ? query.author
            : {}),
          $nin: [...(query.author?.$nin || []), ...relData.mutedIds],
        };
      }
    }

    // If viewing user's own profile, show all their posts
    // Otherwise, only show public posts (hide closeFriends-only from non-close-friends)
    if (currentUserId && authorId && currentUserId !== authorId) {
      // Check if viewer is a close friend of the author
      const author = await User.findById(authorId).select("closeFriends").lean();
      const isCloseFriend = author?.closeFriends?.some(
        (id: any) => id.toString() === currentUserId
      );
      if (!isCloseFriend) {
        query.visibility = "public";
      }
    } else if (!authorId) {
      // Global feed: show public posts, PLUS closeFriends posts from any
      // author who has the viewer on their closeFriends list (close friends
      // must be able to see their friends' closeFriends posts here).
      if (currentUserId) {
        if (relData.closeFriendAuthorIds.length > 0) {
          query.$and = [
            {
              $or: [
                { visibility: "public" },
                // The author always sees their own closeFriends posts in
                // their home feed too (matches how public posts behave).
                { visibility: "closeFriends", author: currentUserId },
                { visibility: "closeFriends", author: { $in: relData.closeFriendAuthorIds } },
              ],
            },
          ];
        } else {
          // No author has this viewer as a close friend — but the viewer
          // must still see their own closeFriends posts.
          query.$and = [
            {
              $or: [
                { visibility: "public" },
                { visibility: "closeFriends", author: currentUserId },
              ],
            },
          ];
        }
      } else {
        // Unauthenticated global feed: public only
        query.visibility = "public";
      }
    }
    // Own profile: show everything (no filter needed)

    // Content preference: hide posts the user marked "Not interested" from
    // their global feed and from other users' profile views (a hidden post
    // shouldn't reappear just because the user navigated to the author page).
    if (currentUserId && relData.hiddenIds.length > 0) {
      const hiddenIds: any[] = relData.hiddenIds;
      if (query._id && typeof query._id === "object") {
        query._id = { ...query._id, $nin: hiddenIds };
      } else {
        query._id = { $nin: hiddenIds };
      }
    }

    // cursor pagination
    if (cursor && query._id && typeof query._id === "object") {
      query._id = { ...query._id, $lt: cursor };
    } else if (cursor) {
      query._id = {
        $lt: cursor,
      };
    }

    // Always cap at 20 max per page
    const actualLimit = Math.min(limit ?? 10, 20);

    // Build sort object (default to _id:-1, support likesCount, viewsCount, createdAt)
    const sortOption: Record<string, -1 | 1> = { _id: -1 };
    if (sortField === "likesCount") {
      sortOption.likesCount = -1;
    } else if (sortField === "viewsCount") {
      sortOption.viewsCount = -1;
    } else if (sortField === "createdAt") {
      sortOption.createdAt = -1;
    }

    // fetch posts
    let posts = await Post.find(query)
      .sort(sortOption)
      .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
      .limit(actualLimit + 1)
      .lean();

    // check more posts
    const hasMore = posts.length > actualLimit;
    if (hasMore) {
      posts.pop();
    }

    // next cursor
    const nextCursor = posts.slice(-1).shift()?._id || null;

    // Add user status to posts
    posts = await addUserStatusToPosts(posts, currentUserId);

    // response data
    const responseData = {
      success: true,
      message: posts.length
        ? "All posts fetched successfully!"
        : "No posts yet!",
      posts,
      nextCursor,
      hasMore,
    };

    // cache with 15s TTL (feed changes frequently)
    try {
      await setCache(cacheKey, {
        success: true,
        message: responseData.message,
        posts: posts,
        nextCursor,
        hasMore,
      }, 15);
    } catch (err: any) {
      logger.error(`Cache set error in getAllPosts!`, { error: err?.message });
    }

    return res.status(200).json(responseData);
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in getAllPosts controller!`, { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

// create new post
export const createPost = async (req: Request, res: Response) => {
  const result = createPostSchema.safeParse(req.body);

  try {
    // validate input
    if (!result.success) {
      throw new BadRequestError(result.error.issues[0]?.message || "Invalid input");
    }

    // auth check
    const author = req.user?._id;

    if (!author) {
      throw new UnauthorizedError("Unauthorized access!");
    }

    // extract hashtags
    const extractHashtags = (text: string): string[] => {
      const hashtagRegex = /#([a-zA-Z0-9_]+)/g;
      const matches = [...text.matchAll(hashtagRegex)];
      const hashtags = matches.map(match => match[1]?.toLowerCase()).filter(Boolean) as string[];
      // Remove duplicates and limit to 10 hashtags
      return [...new Set(hashtags)].slice(0, 10);
    };

    const sanitizedTitle = sanitizePlainText(result.data.title);
    const sanitizedContent = sanitizePlainText(result.data.content);
    const hashtags = extractHashtags(result.data.title + " " + result.data.content);

    // Validate hashtag count
    if (hashtags.length > 10) {
      throw new BadRequestError("Maximum 10 hashtags allowed!");
    }

    // handle multiple images/videos, single image, and video using typed helpers
    const uploaded = extractFiles(req);
    const allImages = [...uploaded.images, ...uploaded.image];
    const images = buildImages(allImages, result.data.title || "");

    // fall back to single file (in case future changes use req.file)
    const singleFile = req.file as UploadedFile | undefined;
    if (images.length === 0 && singleFile) {
      images.push({
        url: singleFile.path,
        public_id: singleFile.filename,
        alt: (result.data.title || "").substring(0, 100),
      });
    }

    // Handle video upload
    const video = uploaded.video
      ? { url: uploaded.video.path, public_id: uploaded.video.filename }
      : undefined;

    // ── Parse poll (JSON string from FormData) ───────────────────────
    let pollData: any = undefined;
    if (result.data.poll) {
      try {
        const parsed = JSON.parse(result.data.poll);
        const options = (parsed?.options || [])
          .map((o: any) => ({
            text: sanitizePlainText(String(o?.text || "")).trim(),
          }))
          .filter((o: any) => o.text.length > 0);
        if (options.length < 2) {
          throw new BadRequestError("A poll needs at least 2 options!");
        }
        if (options.length > 10) {
          throw new BadRequestError("A poll can have at most 10 options!");
        }
        pollData = {
          options,
          expiresAt: parsed?.expiresAt ? new Date(parsed.expiresAt) : null,
          totalVotes: 0,
        };
      } catch (err: any) {
        if (err instanceof BadRequestError) throw err;
        throw new BadRequestError("Invalid poll data!");
      }
    }

    // ── Resolve collaborator by @username ────────────────────────────
    let collaboratorId: mongoose.Types.ObjectId | null = null;
    if (result.data.collaborator?.trim()) {
      const username = result.data.collaborator.trim().replace(/^@/, "");
      const collabUser = await User.findOne({ username })
        .select("_id username fullName")
        .lean();
      if (!collabUser) {
        throw new BadRequestError(`User @${username} not found!`);
      }
      if (collabUser._id.toString() === author.toString()) {
        throw new BadRequestError("You cannot invite yourself as a collaborator!");
      }
      collaboratorId = collabUser._id;
    }

    // ── Status / scheduling handling ─────────────────────────────────
    const requestedStatus = result.data.status || "published";
    let finalStatus = requestedStatus;
    let scheduledDate: Date | null = null;

    if (requestedStatus === "scheduled") {
      if (!result.data.scheduledAt) {
        throw new BadRequestError("scheduledAt is required for scheduled posts!");
      }
      scheduledDate = new Date(result.data.scheduledAt);
      if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
        throw new BadRequestError("scheduledAt must be a future date/time!");
      }
    }

    // create post
    const post = new Post({
      ...result.data,
      title: sanitizedTitle,
      content: sanitizedContent,
      hashtags,
      author,
      visibility: result.data.visibility || "public",
      status: finalStatus,
      scheduledAt: scheduledDate,
      poll: pollData || null,
      collaborator: collaboratorId,
      collabAccepted: false,

      image: images.length > 0 ? { url: images[0]!.url, public_id: images[0]!.public_id } : null,
      images: images.length > 0 ? images : undefined,
      video,
    });

    // save post
    await post.save();

    // Scheduled posts → BullMQ delayed job: publish at the EXACT scheduledAt
    // time instead of the 1-min cron poll (which published up to 60s late).
    // Falls back to the cron when REDIS_URL isn't configured (returns false).
    if (finalStatus === "scheduled" && scheduledDate && post._id) {
      const { enqueueScheduledPostPublish } = await import("../configs/queue");
      void enqueueScheduledPostPublish(post._id.toString(), scheduledDate);
    }

    // handle mentions — ALL notification deliveries run in parallel. Each
    // createNotification does ~5 DB round-trips (block check, pref check,
    // insert, cache eviction, populate + socket), so awaiting them one at a
    // time made a post with 3 mentions cost 15+ serialized round-trips.
    const mentionedUserIds = await extractMentions(result.data.content + " " + result.data.title);
    const notifyRecipients = new Set<string>(mentionedUserIds);
    const notifyTasks: Promise<any>[] = [...notifyRecipients].map((recipient) =>
      createNotification({
        recipient,
        sender: author.toString(),
        type: "mention",
        post: post._id.toString(),
      }),
    );

    // Notify the invited collaborator
    if (collaboratorId) {
      notifyTasks.push(
        createNotification({
          recipient: collaboratorId.toString(),
          sender: author.toString(),
          type: "collab_invite",
          post: post._id.toString(),
        }),
      );
    }
    await Promise.all(notifyTasks);

    const isDraftOrScheduled = finalStatus === "draft" || finalStatus === "scheduled";

    // Drafts & scheduled posts are NOT visible on feeds yet — only published
    // posts clear the feed cache and appear for other users in realtime.
    // populate post with author and user status — run in parallel with the
    // cache invalidation (both are independent after the save, so awaiting
    // them one at a time added ~4 sequential round-trips to every post).
    const populatePost = () =>
      Post.findById(post._id)
        .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
        .populate("collaborator", "username fullName profilePic isVerified statusText waitlistPerk")
        .lean();

    let populatedPost: any;
    if (!isDraftOrScheduled) {
      const cacheTasks: Promise<any>[] = [
        // invalidate feed cache
        clearFeedCache(),
        clearUserPostsCache(author.toString()),
        // Invalidate personal feed cache so the new post appears immediately
        invalidateFeedCache(author.toString()),
      ];
      // Invalidate the trending-hashtag/topic caches so the chips react to
      // the new post right away (they also self-expire after 60s).
      if (hashtags.length > 0) {
        cacheTasks.push(deleteCache("trending:hashtags"));
        cacheTasks.push(deleteCache("trending:topics"));
      }
      const [, fetched] = await Promise.all([
        Promise.allSettled(cacheTasks),
        populatePost(),
      ]);
      populatedPost = fetched;
    } else {
      populatedPost = await populatePost();
    }

    if (populatedPost) {
      const postsWithStatus = await addUserStatusToPosts([populatedPost], req.user?._id?.toString());
      populatedPost = postsWithStatus[0];
      if (!isDraftOrScheduled && populatedPost) {
        emitPostCreated(populatedPost);
        // Webhook: the author's registered endpoints learn their post went live
        deliverWebhookEvent(
          "post.created",
          {
            postId: populatedPost._id,
            authorId: author.toString(),
            visibility: populatedPost.visibility,
          },
          author.toString(),
        ).catch(() => {});
      }
    }

    // Only published posts award XP / progress missions
    if (!isDraftOrScheduled) {
      // Award XP and progress mission (fire-and-forget)
      awardXP(author.toString(), "CREATE_POST").catch(() => {});
      progressMission(author.toString(), "post").catch(() => {});
    }
      // Achievement badges for content creation (fire-and-forget)
      checkBadgesAndNotify(author.toString(), "post_created").catch(() => {});
      awardTimeOfDayBadges(author.toString(), populatedPost?.createdAt).catch(() => {});

    return res.status(201).json({
      success: true,
      message: finalStatus === "draft"
        ? "Draft saved!"
        : finalStatus === "scheduled"
          ? "Post scheduled!"
          : "Post created successfully!",
      post: populatedPost,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;

    // duplicate slug
    if (err.code === 11000) {
      throw new ConflictError("Duplicate slug, try different title!");
    }

    logger.error(`Error in createPost controller!`, { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

// update existing post
export const updatePost = async (req: Request<Params>, res: Response) => {
  const { postId } = req.params;

  const userId = req.user?._id;

  try {
    // validate id
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new BadRequestError("Invalid ID!");
    }

    // auth check
    if (!userId) {
      throw new UnauthorizedError("Unauthorized!");
    }

    // find post
    const post = await Post.findById(postId);

    if (!post) {
      throw new NotFoundError("Post not found!");
    }

    // ownership check
    if (post.author.toString() !== userId.toString()) {
      throw new ForbiddenError("Forbidden!");
    }

    // parse and validate body
    const parsed = updatePostSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message || "Invalid input");
    }

    const file = req.file as UploadedFile | undefined;
    const uploaded = extractFiles(req);
    const allUpdateFiles = [...uploaded.images, ...uploaded.image];
    const videoFile = uploaded.video;

    // ensure update exists
    const hasText = !!parsed.data.title || !!parsed.data.content;
    const hasImage = !!file || allUpdateFiles.length > 0;
    const hasVideo = !!videoFile;

    if (!hasText && !hasImage && !hasVideo) {
      throw new BadRequestError("At least one field is required!");
    }

    // Save edit history before updating
    post.editHistory.push({
      title: post.title || "",
      content: post.content || "",
      editedAt: new Date(),
    });
    post.isEdited = true;

    // update title
    if (parsed.data.title) {
      post.title = sanitizePlainText(parsed.data.title);
    }

    // update content
    if (parsed.data.content) {
      post.content = sanitizePlainText(parsed.data.content);
    }

    // --- Image update logic ---
    const hasNewFiles = !!file || allUpdateFiles.length > 0;

    // Parse public_ids of existing images the user wants to keep
    const keepImageIds: string[] = req.body.existingImages
      ? (Array.isArray(req.body.existingImages) ? req.body.existingImages : [req.body.existingImages])
      : [];

    if (hasNewFiles || keepImageIds.length > 0) {
      const keepIdsSet = new Set(keepImageIds);

      // Build new images from uploaded files
      const uploadedImages = buildImages(allUpdateFiles, parsed.data.title || "");

      // fall back to single file
      if (uploadedImages.length === 0 && file) {
        uploadedImages.push({
          url: file.path,
          public_id: file.filename,
          alt: (parsed.data.title || "").substring(0, 100),
        });
      }

      // Delete from Cloudinary only images the user chose to remove —
      // offloaded to the BullMQ media-cleanup worker when configured (inline
      // otherwise). External HTTP must never block the edit response.
      const removedPublicIds: string[] = [];
      for (const oldImg of post.images || []) {
        if (oldImg.public_id && !keepIdsSet.has(oldImg.public_id)) {
          removedPublicIds.push(oldImg.public_id);
        }
      }
      if (post.image?.public_id && !keepIdsSet.has(post.image.public_id)) {
        removedPublicIds.push(post.image.public_id);
      }
      void cleanupMedia(removedPublicIds);

      // Final images = kept existing images + new uploaded images
      const keptExisting = (post.images || []).filter(
        (img) => img.public_id && keepIdsSet.has(img.public_id),
      );

      const finalImages = [...keptExisting, ...uploadedImages];

      // Mongoose DocumentArray requires explicit cast
      post.images = finalImages as any;
      post.image = finalImages.length > 0
        ? { url: finalImages[0]!.url, public_id: finalImages[0]!.public_id }
        : null;
    }

    // --- Video update logic ---
    if (videoFile) {
      // Delete old video from Cloudinary if it exists
      if (post.video?.public_id) {
        void cleanupMedia([post.video.public_id], "video");
      }
      // Set new video
      post.video = {
        url: videoFile.path,
        public_id: (videoFile as any).filename,
      };
    }

    // save
    await post.save();

    // invalidate cache + re-populate in parallel — the cache evictions have
    // no dependency on the fetch, so awaiting them one at a time added ~3
    // sequential round-trips to every edit.
    const [, fetchedPost] = await Promise.all([
      Promise.allSettled([
        deleteCache(`post:${postId}`),
        clearFeedCache(),
      ]),
      Post.findById(post._id)
        .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
        .lean(),
    ]);
    let populatedPost: any = fetchedPost;

    if (populatedPost) {
      const postsWithStatus = await addUserStatusToPosts([populatedPost], req.user?._id?.toString());
      populatedPost = postsWithStatus[0];
      emitPostUpdated(populatedPost);
    }

    return res.status(200).json({
      success: true,
      message: "Post updated successfully!",
      post: populatedPost,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in updatePost controller!`, { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

// delete post
// Shared post deletion cascade — used by the author (deletePost) and by the
// admin panel (adminDeletePost) so both paths clean up exactly the same data
// (comments, likes, reposts, saves, notifications, media, caches, sockets).
export const deletePostData = async (post: any, actorUserId?: string) => {
  const postId = String(post._id);

  // Capture who saved this post BEFORE the cascade below deletes the Save
  // docs — querying after (the old order) always returned nothing, so the
  // savers' cached lists were never cleared and "saved posts" showed the
  // deleted post until the cache TTL expired.
  const [savedBy, comments] = await Promise.all([
    Save.find({ post: postId }).select("user").lean(),
    Comment.find({ post: postId }).select("_id").lean(),
  ]);
  const commentIds = comments.map((c) => c._id);

  await Promise.all([
    Comment.deleteMany({ post: postId }),
    Like.deleteMany({
      $or: [{ post: postId }, { comment: { $in: commentIds } }],
    }),
    Repost.deleteMany({ post: postId }),
    Save.deleteMany({ post: postId }),
    Notification.deleteMany({
      $or: [{ post: postId }, { comment: { $in: commentIds } }],
    }),
  ]);

  // Cloudinary deletes are external HTTP calls — never block the delete
  // response on them. Offloaded to the BullMQ media-cleanup worker when
  // configured (inline otherwise); the DB deletion below doesn't depend on
  // them.
  const removedImageIds: string[] = [];
  if (post.image?.public_id) removedImageIds.push(post.image.public_id);
  for (const img of post.images || []) {
    if (img.public_id) removedImageIds.push(img.public_id);
  }
  void cleanupMedia(removedImageIds);
  if (post.video?.public_id) {
    void cleanupMedia([post.video.public_id], "video");
  }

  await post.deleteOne();

  // Cache eviction: all entries are independent — run them in parallel
  // instead of ~7 sequential awaits. allSettled keeps a cache hiccup from
  // 500-ing a deletion that already succeeded.
  const cacheTasks: Promise<any>[] = [
    deleteCache(`post:${postId}`),
    deleteCache(`post:slug:${post.slug}`),
    clearFeedCache(),
    clearCommentsCache(postId),
  ];
  // Deleted posts must stop inflating trending hashtags/topics right away.
  if (Array.isArray(post.hashtags) && post.hashtags.length > 0) {
    cacheTasks.push(deleteCache("trending:hashtags"));
    cacheTasks.push(deleteCache("trending:topics"));
  }
  if (actorUserId) {
    cacheTasks.push(clearDraftsCache(actorUserId));
    cacheTasks.push(clearUserPostsCache(actorUserId));
  }
  // clear saves caches only for users who saved this post (IDs captured
  // before the cascade deleted the Save docs)
  const uniqueUserIds = [...new Set(savedBy.map((s: any) => s.user.toString()))];
  cacheTasks.push(...uniqueUserIds.map((uid: any) => clearSavesCache(uid as string)));
  await Promise.allSettled(cacheTasks);

  emitPostDeleted(postId);
};

export const deletePost = async (req: Request<Params>, res: Response) => {
  const { postId } = req.params;

  const userId = req.user?._id;

  try {
    // validate id
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new BadRequestError("Invalid ID!");
    }

    // auth check
    if (!userId) {
      throw new UnauthorizedError("Unauthorized!");
    }

    // find post
    const post = await Post.findById(postId);

    if (!post) {
      throw new NotFoundError("Post not found!");
    }

    // ownership check
    if (post.author.toString() !== userId.toString()) {
      throw new ForbiddenError("Forbidden!");
    }

    await deletePostData(post, userId.toString());

    return res.status(200).json({
      success: true,
      message: "Post deleted successfully!",
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in deletePost controller!`, { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

// share post
export const sharePost = async (req: Request<Params>, res: Response) => {
  const { postId } = req.params;

  try {
    // validate id
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new BadRequestError("Invalid post ID!");
    }

    // closeFriends posts can only be shared by the author / their close friends
    const { allowed } = await canInteractWithPost(postId, req.user?._id?.toString());
    if (!allowed) {
      throw new NotFoundError("Post not found!");
    }

    // increment share count
    const post = await Post.findByIdAndUpdate(
      postId,
      {
        $inc: {
          sharesCount: 1,
        },
      },
      {
        returnDocument: 'after',
      },
    ).select("sharesCount slug");

    // check existence
    if (!post) {
      throw new NotFoundError("Post not found!");
    }

    // Log interaction for feed ranking
    const fullPost = await Post.findById(postId).select("author hashtags").lean();
    if (fullPost && req.user?._id?.toString() !== fullPost.author.toString()) {
      logInteraction(
        req.user?._id?.toString() || "",
        fullPost.author.toString(),
        postId,
        "share",
        fullPost.hashtags || []
      );
    }

    // invalidate cache
    await deleteCache(`post:${postId}`);

    // Award XP and progress mission (fire-and-forget)
    if (req.user?._id) {
      awardXP(req.user._id.toString(), "SHARE_POST").catch(() => {});
      progressMission(req.user._id.toString(), "share").catch(() => {});
      checkBadgesAndNotify(req.user._id.toString(), "share").catch(() => {});
      checkAllRounderBadge(req.user._id.toString()).catch(() => {});
    }

    // emit share socket event
    emitPostShare(postId, post.sharesCount);

    // share url
    const shareUrl = `${env.CLIENT_URL}/post/${post.slug}`;

    return res.status(200).json({
      success: true,
      message: "Post shared successfully!",
      shares: post.sharesCount,
      shareUrl,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in sharePost controller!`, { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

// forward a post to another user — notifies the recipient in-app
// (notification center + badge) and via device push.
export const forwardPost = async (req: Request<Params>, res: Response) => {
  const { postId } = req.params;
  const senderId = req.user?._id;
  const { recipientId } = req.body || {};

  try {
    if (!senderId) throw new UnauthorizedError("Unauthorized!");

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new BadRequestError("Invalid post ID!");
    }

    if (!recipientId || !mongoose.Types.ObjectId.isValid(recipientId)) {
      throw new BadRequestError("Invalid recipient!");
    }

    if (senderId.toString() === recipientId) {
      throw new BadRequestError("Cannot forward a post to yourself!");
    }

    // closeFriends posts can only be forwarded by the author / their close friends
    const { allowed } = await canInteractWithPost(postId, senderId.toString());
    if (!allowed) {
      throw new NotFoundError("Post not found!");
    }

    const post = await Post.findById(postId)
      .select("_id author slug visibility title content image images")
      .lean();
    if (!post) {
      throw new NotFoundError("Post not found!");
    }

    const recipient = await User.findById(recipientId).select("_id").lean();
    if (!recipient) {
      throw new BadRequestError("Recipient not found!");
    }

    // count the forward as a share
    const updated = await Post.findByIdAndUpdate(
      postId,
      { $inc: { sharesCount: 1 } },
      { returnDocument: "after" },
    ).select("sharesCount");

    if (updated) emitPostShare(postId, updated.sharesCount);
    await deleteCache(`post:${postId}`);

    // Log interaction for feed ranking
    if (senderId.toString() !== post.author.toString()) {
      logInteraction(senderId.toString(), post.author.toString(), postId, "share", []);
    }

    // The RECIPIENT must be able to view the post too — forwarding a
    // closeFriends post to an outsider would create a dead-end notification
    // pointing at content they can never open.
    const recipientCanView = await canViewCloseFriendsPost(post, recipientId);

    // Notify the recipient (skipped when they are mutually blocked with
    // the post author — otherwise they'd get a dead-end notification).
    if (
      recipientCanView &&
      !(await areMutuallyBlocked(recipientId, post.author.toString()))
    ) {
      await createNotification({
        recipient: recipientId,
        sender: senderId.toString(),
        type: "post_share",
        post: postId,
      });
    }

    // WhatsApp/Instagram behavior: the forward ALSO lands as a real chat
    // message in the 1:1 conversation (created if needed), so the recipient
    // sees it in their chat and the sender sees the conversation in their
    // chat list. Gated on the SAME combined condition as the notification
    // (recipient can view AND not mutually blocked with the post author) —
    // otherwise a blocked recipient would get a chat link that 404s.
    if (
      recipientCanView &&
      !(await areMutuallyBlocked(recipientId, post.author.toString()))
    ) {
      const link = `${env.CLIENT_URL}/post/${post.slug}`;
      const previewText =
        (post.title || post.content || "Shared a post").slice(0, 120) +
        `\n${link}`;
      const firstImage = post.image?.url || post.images?.[0]?.url || "";
      await deliverForwardToChat({
        senderId: senderId.toString(),
        recipientId: recipientId.toString(),
        text: previewText,
        attachment: firstImage ? { url: firstImage, type: "image" } : undefined,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Post forwarded successfully!",
      shares: updated?.sharesCount,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in forwardPost controller!`, { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

// Share a post into a community chat (communities are chat-only in Orbit,
// so "post to a community" = send a community message containing the post
// preview + link). Verifies membership + post visibility, then broadcasts
// the message to the community room like any other community message.
export const forwardPostToCommunity = async (
  req: Request<{ postId: string }>,
  res: Response,
) => {
  const { postId } = req.params;
  const senderId = req.user?._id;
  const { communityId } = req.body || {};

  try {
    if (!senderId) throw new UnauthorizedError("Unauthorized!");

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new BadRequestError("Invalid post ID!");
    }
    if (!communityId || !mongoose.Types.ObjectId.isValid(communityId)) {
      throw new BadRequestError("Invalid community!");
    }

    // Sender must be able to view the post (blocks closeFriends leaks)
    const { allowed } = await canInteractWithPost(postId, senderId.toString());
    if (!allowed) {
      throw new NotFoundError("Post not found!");
    }

    const post = await Post.findById(postId)
      .select("_id author slug title content image images visibility")
      .lean();
    if (!post) {
      throw new NotFoundError("Post not found!");
    }

    const community = await Community.findById(communityId).select("members messagingEnabled").lean();
    if (!community) {
      throw new NotFoundError("Community not found!");
    }
    const isMember = (community.members || []).some(
      (m: any) => m.user?.toString() === senderId.toString(),
    );
    if (!isMember) {
      throw new ForbiddenError("You must be a member to share into this community!");
    }
    if (community.messagingEnabled === false && post.author?.toString() !== senderId.toString()) {
      throw new ForbiddenError("Messaging is currently disabled in this community!");
    }

    // Post preview text: title + link (title may be empty — fall back to a
    // short content snippet like the chat-community forward UX).
    const firstImage = post.image?.url || post.images?.[0]?.url || "";
    const link = `${env.CLIENT_URL}/post/${post.slug}`;
    const previewText =
      (post.title || post.content || "Shared a post").slice(0, 120) +
      `\n${link}`;

    const message = new CommunityMessage({
      community: communityId,
      sender: senderId,
      text: sanitizePlainText(previewText),
      attachments: firstImage
        ? [{ url: firstImage, type: "image" }]
        : [],
    });
    await message.save();

    const populatedMessage = await CommunityMessage.findById(message._id)
      .populate("sender", "username fullName profilePic isVerified waitlistPerk")
      .lean();

    // Update community preview + broadcast like a normal community message
    await Community.findByIdAndUpdate(communityId, {
      updatedAt: new Date(),
      lastMessage: {
        messageId: message._id,
        text: sanitizePlainText(previewText),
        attachmentType: firstImage ? "image" : "",
        sender: {
          _id: senderId,
          fullName: (req.user as any)?.fullName || "",
          username: (req.user as any)?.username || "",
        },
        createdAt: new Date(),
        isDeleted: false,
      },
      lastAction: null,
    });

    const io = getIO();
    io.to(`community:${communityId}`).emit(
      "community:message:new",
      populatedMessage,
    );

    // Count the forward as a share on the post
    const updated = await Post.findByIdAndUpdate(
      postId,
      { $inc: { sharesCount: 1 } },
      { returnDocument: "after" },
    ).select("sharesCount");
    if (updated) emitPostShare(postId, updated.sharesCount);

    return res.status(201).json({
      success: true,
      message: "Shared into community!",
      sentMessage: populatedMessage,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in forwardPostToCommunity controller!`, {
      error: err?.message,
    });
    throw new AppError("Internal server error!");
  }
};

// get post by slug
export const getPostBySlug = async (req: Request<{ slug: string }>, res: Response) => {
  const { slug } = req.params;

  try {
    // cache key
    const cacheKey = `post:slug:${slug}`;

    // get cached post (raw, without user status) — re-attach status for THIS viewer
    try {
      const cached = await getCache<{ success: boolean; message: string; post: any }>(cacheKey);
      if (cached?.post) {
        const currentUserId = req.user?._id?.toString();
        // Cache is shared across users — enforce closeFriends visibility AND
        // block status per viewer on every read.
        const cachedAuthorId = cached.post?.author?._id?.toString() || cached.post?.author?.toString();
        if (
          cachedAuthorId &&
          currentUserId &&
          cachedAuthorId !== currentUserId &&
          (await areMutuallyBlocked(currentUserId, cachedAuthorId))
        ) {
          throw new NotFoundError("Post not found!");
        }
        if (!(await canViewCloseFriendsPost(cached.post, currentUserId))) {
          throw new NotFoundError("Post not found!");
        }
        const postsWithStatus = await addUserStatusToPosts([cached.post], currentUserId);
        return res.status(200).json({
          success: true,
          message: "Post fetched successfully!",
          post: postsWithStatus[0],
        });
      }
    } catch (cacheError: any) {
      if (cacheError.statusCode && cacheError.statusCode < 500) throw cacheError;
      logger.error(`Cache error in getPostBySlug controller!`, { error: cacheError.message });
    }

    // fetch post
    const post = await Post.findOne({ slug })
      .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
      .populate("collaborator", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    // check existence
    if (!post) {
      throw new NotFoundError("Post not found!");
    }

    // Visibility check: hide closeFriends posts from non-close-friends
    const currentUserId = req.user?._id?.toString();
    if (post.status && post.status !== "published") {
      const isAuthor = currentUserId && post.author?._id?.toString() === currentUserId;
      if (!isAuthor) {
        throw new NotFoundError("Post not found!");
      }
    }
    if (!(await canViewCloseFriendsPost(post, currentUserId))) {
      throw new NotFoundError("Post not found!");
    }

    // Cache the RAW post (without user status / poll sanitization) so the
    // cache is shared across users without leaking one viewer's poll vote.
    // Status + sanitized poll are re-attached per request below.
    const rawResponseData = {
      success: true,
      message: "Post fetched successfully!",
      post,
    };

    // cache post
    try {
      await setCache(cacheKey, rawResponseData, 60 * 30);
    } catch (cacheError: any) {
      logger.error(`Cache set error in getPostBySlug controller!`, { error: cacheError.message });
    }

    // Add user status + sanitize poll for THIS viewer only
    const postsWithStatus = await addUserStatusToPosts([post], currentUserId);

    return res.status(200).json({
      success: true,
      message: "Post fetched successfully!",
      post: postsWithStatus[0],
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in getPostBySlug controller!`, { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

export const getPostsByHashtag = async (
  req: Request<{ hashtag: string }>,
  res: Response,
) => {
  try {
    const { hashtag } = req.params;
    const lowerHashtag = hashtag.toLowerCase();

    // pagination
    const limit = Math.min(Number(req.query.limit) || 10, 20);
    const cursor = req.query.cursor as string;

    const currentUserId = req.user?._id?.toString();
    const query: any = { hashtags: lowerHashtag };

    // Only show public posts in hashtag search (closeFriends posts aren't discoverable by tag)
    query.visibility = "public";

    // PRIVATE accounts: a private user's posts must not appear in hashtag
    // discovery for non-followers.
    const followedIds = currentUserId
      ? await Follow.find({ follower: currentUserId })
          .select("following")
          .lean()
          .then((docs) => docs.map((d) => d.following.toString()))
      : [];
    const followedSet = new Set(followedIds);
    const privateAuthors = await User.find({ isPrivate: true })
      .select("_id")
      .lean();
    const hiddenPrivateAuthorIds = privateAuthors
      .filter((u: any) => !followedSet.has(u._id.toString()))
      .map((u: any) => u._id);
    if (hiddenPrivateAuthorIds.length > 0) {
      query.author = { $nin: hiddenPrivateAuthorIds };
    }

    if (cursor) {
      query._id = { $lt: cursor };
    }

    // get posts by hashtag
    const posts = await Post.find(query)
      .select(
        "title image images likesCount commentsCount repostsCount savesCount createdAt author hashtags",
      )
      .populate("author", "fullName username profilePic isVerified statusText waitlistPerk")
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = posts.length > limit;
    if (hasMore) {
      posts.pop();
    }

    const nextCursor = posts.slice(-1).shift()?._id || null;

    // Add user status to posts
    const postsWithStatus = await addUserStatusToPosts(posts, req.user?._id?.toString());

    return res.status(200).json({
      success: true,
      count: postsWithStatus.length,
      posts: postsWithStatus,
      nextCursor,
      hasMore,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in getPostsByHashtag controller!`, { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

// ─── Trending hashtags ────────────────────────────────────────────
// Aggregates most-used hashtags from recent posts
export const getTrendingHashtags = async (req: Request, res: Response) => {
  try {
    const cacheKey = "trending:hashtags";
    try {
      const cached = await getCache<{
        hashtags: string[];
        counts: Record<string, number>;
      }>(cacheKey);
      if (cached) {
        return res.status(200).json({
          success: true,
          ...cached,
        });
      }
    } catch {
      // cache miss
    }

    // RECENCY-WEIGHTED trending — hashtags used RIGHT NOW rank far above tags
    // that merely accumulated volume over the week. A tag with 10 posts in the
    // last hour (score 10) beats one with 30 posts spread over 7 days
    // (score ~3-7), so the chips track what users are actually using, not just
    // historical volume. Published PUBLIC posts only — closeFriends/draft
    // hashtags must never surface in trending.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const now = new Date();

    // PRIVATE accounts: their posts must not fuel global hashtag trending for
    // people who don't follow them (same rule as getTrendingTopics).
    const privateAuthors = await User.find({ isPrivate: true })
      .select("_id")
      .lean();
    const privateAuthorIds = privateAuthors.map((u: any) => u._id);

    const results = await Post.aggregate([
      {
        $match: {
          hashtags: { $exists: true, $not: { $size: 0 } },
          createdAt: { $gte: sevenDaysAgo },
          visibility: "public",
          status: "published",
          ...(privateAuthorIds.length > 0
            ? { author: { $nin: privateAuthorIds } }
            : {}),
        },
      },
      { $unwind: "$hashtags" },
      {
        $project: {
          tag: "$hashtags",
          hoursAgo: {
            $divide: [
              { $subtract: [now, "$createdAt"] },
              1000 * 60 * 60,
            ],
          },
        },
      },
      {
        $project: {
          tag: 1,
          weight: {
            $switch: {
              branches: [
                // < 6h → full weight (hot right now)
                { case: { $lte: ["$hoursAgo", 6] }, then: 1.0 },
                // 6-24h → half weight (still fresh)
                { case: { $lte: ["$hoursAgo", 24] }, then: 0.5 },
                // 1-3 days → quarter weight (recent)
                { case: { $lte: ["$hoursAgo", 72] }, then: 0.25 },
              ],
              // 3-7 days → minimal weight (background volume)
              default: 0.1,
            },
          },
        },
      },
      {
        $group: {
          _id: "$tag",
          score: { $sum: "$weight" },
          count: { $sum: 1 },
        },
      },
      { $sort: { score: -1, count: -1 } },
      { $limit: 10 },
    ]).option({ maxTimeMS: 5000 });

    const hashtags = results.map((r: any) => r._id);
    const counts: Record<string, number> = {};
    for (const r of results) {
      counts[r._id] = r.count;
    }

    // 60s cache (not 5 min) — combined with the invalidation in createPost,
    // a new post shifts the chips within a minute.
    await setCache(cacheKey, { hashtags, counts }, 60);

    return res.status(200).json({
      success: true,
      hashtags,
      counts,
    });
  } catch (err: any) {
    logger.error(`Error in getTrendingHashtags!`, { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

// increment post views
export const viewsCount = async (req: Request<Params>, res: Response) => {
  const { postId } = req.params;

  const currentUser = req.user?._id;

  try {
    const parsed = addViewSchema.safeParse({ postId });
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message || "Invalid input");
    }

    // closeFriends posts are invisible to non-close-friends — never count
    // (or reveal) their views to outsiders.
    const { allowed } = await canInteractWithPost(postId, currentUser?.toString());
    if (!allowed) {
      throw new NotFoundError("Post not found!");
    }

    // fetch minimal fields
    const post = await Post.findById(postId)
      .select("_id author viewsCount")
      .lean();

    // check existence
    if (!post) {
      throw new NotFoundError("Post not found!");
    }

    // Note: the author's own view counts too — every screen the post is
    // displayed on for 3+ seconds registers a view (feed, profile, saves,
    // reposts, trending, share, etc.), so the author sees a real, live count.

    // increment views
    const updatedPost = await Post.findByIdAndUpdate(
      postId,
      {
        $inc: {
          viewsCount: 1,
        },
      },
      {
        returnDocument: 'after',
      },
    ).select("viewsCount");

    // invalidate cache
    await deleteCache(`post:${postId}`);

    // emit real-time view update
    if (updatedPost?.viewsCount) {
      emitPostView(postId, updatedPost.viewsCount);
    }

    return res.status(200).json({
      success: true,
      message: "View counted successfully!",
      views: updatedPost?.viewsCount,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in viewsCount controller!`, { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

// pin a post to the current user's profile
export const pinPost = async (req: Request<Params>, res: Response) => {
  const { postId } = req.params;
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) {
      throw new UnauthorizedError("Unauthorized!");
    }

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new BadRequestError("Invalid post ID!");
    }

    // verify post exists and belongs to user
    const post = await Post.findById(postId).select("author").lean();
    if (!post) {
      throw new NotFoundError("Post not found!");
    }
    if (post.author.toString() !== currentUserId.toString()) {
      throw new ForbiddenError("Cannot pin another user's post!");
    }

    const user = await User.findById(currentUserId);
    if (!user) {
      throw new NotFoundError("User not found!");
    }

    const pinned = user.pinnedPosts || [];

    // check if already pinned
    if (pinned.some((id) => id.toString() === postId)) {
      throw new BadRequestError("Post already pinned!");
    }

    if (pinned.length >= 3) {
      throw new BadRequestError("Maximum 3 pinned posts allowed!");
    }

    pinned.push(new mongoose.Types.ObjectId(postId));
    user.pinnedPosts = pinned;
    await user.save();

    // invalidate caches
    await clearUserPostsCache(currentUserId.toString());
    await clearFeedCache();
    // Route-level api caches embed the FULL path (/api/users/:userId/pinned,
    // /api/users/:userId/posts) — match on the userId so both the author's
    // own view and other viewers' cached copies are invalidated.
    const pinUser = currentUserId.toString();
    await Promise.all([
      clearByPattern(`api:*${pinUser}*pinned*`),
      clearByPattern(`api:*${pinUser}*posts*`),
    ]);

    // emit real-time pin event
    emitPostPin(postId, currentUserId.toString());

    return res.status(200).json({
      success: true,
      message: "Post pinned successfully!",
      pinnedPosts: user.pinnedPosts,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in pinPost controller!`, { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

// ─── Poll voting ───────────────────────────────────────────────────
export const votePoll = async (req: Request<Params>, res: Response) => {
  const { postId } = req.params;
  const currentUserId = req.user?._id;
  const { optionIndex } = req.body;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");
    if (!mongoose.Types.ObjectId.isValid(postId)) throw new BadRequestError("Invalid post ID!");
    if (typeof optionIndex !== "number" || optionIndex < 0) throw new BadRequestError("Valid optionIndex is required!");

    // closeFriends polls are only votable by the author / their close friends
    const { allowed } = await canInteractWithPost(postId, currentUserId.toString());
    if (!allowed) throw new NotFoundError("Post not found!");

    const post = await Post.findById(postId);
    if (!post) throw new NotFoundError("Post not found!");
    if (!post.poll) throw new BadRequestError("This post does not have a poll!");

    // Check if poll has expired
    if (post.poll.expiresAt && new Date(post.poll.expiresAt) < new Date()) {
      throw new BadRequestError("Poll has already expired!");
    }

    if (optionIndex >= post.poll.options.length) {
      throw new BadRequestError("Invalid option index!");
    }

    const userIdStr = currentUserId.toString();

    // One vote per user: reject re-votes (including trying to change the
    // selected option). The client already locks the UI after voting, but
    // the server must enforce it too so votes can never be tampered with.
    const alreadyVoted = post.poll.options.some((opt) =>
      (opt.votes || []).some((v: any) => v?.toString() === userIdStr),
    );
    if (alreadyVoted) {
      return res.status(400).json({
        success: false,
        message: "You have already voted on this poll!",
        poll: sanitizePoll(post.poll, userIdStr),
      });
    }

    // Single atomic update — one DB round-trip instead of three. The filter
    // guard makes the increment race-safe: it only matches posts where NO
    // option's votes array contains this user, so concurrent double-taps from
    // the same account can never push twice.
    const updatedPost = await Post.findOneAndUpdate(
      {
        _id: postId,
        "poll.options": { $not: { $elemMatch: { votes: currentUserId } } },
      },
      {
        $push: { [`poll.options.${optionIndex}.votes`]: currentUserId },
        $inc: { "poll.totalVotes": 1 },
      },
      { new: true }
    );

    // Lost the race (or a second tab voted between our pre-check and here) —
    // the poll is locked to the user's first vote.
    if (!updatedPost) {
      return res.status(400).json({
        success: false,
        message: "You have already voted on this poll!",
        poll: sanitizePoll(post.poll, userIdStr),
      });
    }

    const finalPost = updatedPost;

    // Notify post author if someone voted (skip own poll votes)
    if (finalPost.author.toString() !== userIdStr) {
      await createNotification({
        recipient: finalPost.author.toString(),
        sender: userIdStr,
        type: "poll_vote",
        post: postId,
      });
    }

    // Invalidate the single-post cache AND every feed/list cache so other
    // users fetch fresh vote counts instead of a 30-minute-stale snapshot.
    await Promise.allSettled([
      deleteCache(`post:${postId}`),
      clearFeedCache(),
    ]);

    // Broadcast the updated poll so everyone viewing the post sees counts
    // move in realtime (each client keeps its own myVote locally).
    emitPollUpdated(postId, sanitizePoll(finalPost.poll));

    // Return the updated poll state (sanitized — no raw voter-ID arrays)
    return res.status(200).json({
      success: true,
      message: "Vote recorded!",
      poll: sanitizePoll(finalPost.poll, userIdStr),
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in votePoll controller!`, { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

// ─── Collab invitations ────────────────────────────────────────────
export const inviteCollab = async (req: Request<Params>, res: Response) => {
  const { postId } = req.params;
  const currentUserId = req.user?._id;
  const { collaboratorId } = req.body;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");
    if (!mongoose.Types.ObjectId.isValid(postId)) throw new BadRequestError("Invalid post ID!");
    if (!collaboratorId || !mongoose.Types.ObjectId.isValid(collaboratorId)) {
      throw new BadRequestError("Valid collaborator ID is required!");
    }
    if (collaboratorId.toString() === currentUserId.toString()) {
      throw new BadRequestError("You cannot invite yourself as a collaborator!");
    }

    const post = await Post.findById(postId);
    if (!post) throw new NotFoundError("Post not found!");
    // closeFriends posts are invisible to non-close-friends — 404 so
    // outsiders can't detect them via the collab endpoint either
    const { allowed: canCollab } = await canInteractWithPost(postId, currentUserId.toString());
    if (!canCollab) throw new NotFoundError("Post not found!");
    if (post.author.toString() !== currentUserId.toString()) {
      throw new ForbiddenError("Only the post author can invite collaborators!");
    }

    post.collaborator = collaboratorId;
    post.collabAccepted = false;
    await post.save();

    // Notify the collaborator
    await createNotification({
      recipient: collaboratorId,
      sender: currentUserId.toString(),
      type: "collab_invite",
      post: postId,
    });

    await deleteCache(`post:${postId}`);

    return res.status(200).json({
      success: true,
      message: "Collaborator invited!",
      post: await Post.findById(postId).populate("author", "username fullName profilePic isVerified statusText waitlistPerk").populate("collaborator", "username fullName profilePic isVerified statusText waitlistPerk").lean(),
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in inviteCollab controller!`, { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

export const acceptCollab = async (req: Request<Params>, res: Response) => {
  const { postId } = req.params;
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");
    if (!mongoose.Types.ObjectId.isValid(postId)) throw new BadRequestError("Invalid post ID!");

    const post = await Post.findById(postId);
    if (!post) throw new NotFoundError("Post not found!");
    // closeFriends posts are invisible to non-close-friends
    const { allowed: canAccept } = await canInteractWithPost(postId, currentUserId.toString());
    if (!canAccept) throw new NotFoundError("Post not found!");
    if (!post.collaborator || post.collaborator.toString() !== currentUserId.toString()) {
      throw new ForbiddenError("You haven't been invited to collaborate on this post!");
    }
    if (post.collabAccepted) {
      return res.status(200).json({ success: true, message: "Already accepted!", post });
    }

    post.collabAccepted = true;
    await post.save();

    await deleteCache(`post:${postId}`);
    await clearFeedCache();

    const populated = await Post.findById(post._id).populate("author", "username fullName profilePic isVerified statusText waitlistPerk").populate("collaborator", "username fullName profilePic isVerified statusText waitlistPerk").lean();

    return res.status(200).json({
      success: true,
      message: "Collaboration accepted!",
      post: populated,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in acceptCollab controller!`, { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

// ─── Post scheduling / draft publishing ────────────────────────────
export const publishDraft = async (req: Request<Params>, res: Response) => {
  const { postId } = req.params;
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");
    if (!mongoose.Types.ObjectId.isValid(postId)) throw new BadRequestError("Invalid post ID!");

    const post = await Post.findById(postId);
    if (!post) throw new NotFoundError("Post not found!");
    if (post.author.toString() !== currentUserId.toString()) {
      throw new ForbiddenError("Only the author can publish this post!");
    }
    if (post.status === "published") {
      return res.status(200).json({ success: true, message: "Post is already published!" });
    }

    post.status = "published";
    post.scheduledAt = null;
    await post.save();

    await deleteCache(`post:${postId}`);
    await clearFeedCache();
    // Also clear the author's profile posts cache so the newly published
    // post shows up on their profile tab immediately (not after TTL).
    await clearUserPostsCache(currentUserId.toString());
    // The published post is no longer a draft — the Drafts tab must drop it.
    await clearDraftsCache(currentUserId.toString());

    const populated = await Post.findById(post._id).populate("author", "username fullName profilePic isVerified statusText waitlistPerk").lean();

    if (populated) {
      const postsWithStatus = await addUserStatusToPosts([populated], currentUserId.toString());
      emitPostCreated(postsWithStatus[0]);
      // Webhook: manual publish of a previously scheduled/draft post
      deliverWebhookEvent(
        "post.created",
        {
          postId: populated._id,
          authorId: populated.author?._id?.toString() || currentUserId.toString(),
          visibility: populated.visibility,
        },
        currentUserId.toString(),
      ).catch(() => {});
    }

    return res.status(200).json({ success: true, message: "Post published!", post: populated });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in publishDraft controller!`, { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

// ─── Quote Repost (create a repost with commentary) ────────────────────
// Creates a new Post with `isQuoteRepost: true` and `quoteContent`,
// then creates a Repost document linking back to the original post.
export const quoteRepost = async (req: Request<Params>, res: Response) => {
  const { postId } = req.params;
  const currentUserId = req.user?._id;
  const { quoteContent } = req.body;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");
    if (!mongoose.Types.ObjectId.isValid(postId)) throw new BadRequestError("Invalid post ID!");
    if (!quoteContent || typeof quoteContent !== "string" || !quoteContent.trim()) {
      throw new BadRequestError("Quote content is required!");
    }

    // Verify original post exists
    const originalPost = await Post.findById(postId).select("_id author visibility").lean();
    if (!originalPost) throw new NotFoundError("Original post not found!");

    // Users can't quote-repost their own post
    if (originalPost.author.toString() === currentUserId.toString()) {
      throw new BadRequestError("You can't quote-repost your own post!");
    }

    // closeFriends posts can only be quoted by the author / their close friends
    const { allowed: canQuote } = await canInteractWithPost(postId, currentUserId.toString());
    if (!canQuote) throw new NotFoundError("Original post not found!");

    // Create a new post as the quote repost
    const sanitizedContent = sanitizePlainText(quoteContent.trim()).slice(0, 1000);

    const newPost = new Post({
      content: sanitizedContent,
      author: currentUserId,
      isQuoteRepost: true,
      quoteContent: sanitizedContent,
      status: "published",
      hashtags: [],
    });
    await newPost.save();

    // Also create a Repost document to track the repost. The { user, post }
    // index is unique — if the user already reposted (or quote-reposted)
    // this post, don't fail the whole request; just keep the existing repost.
    const existingRepost = await Repost.findOne({
      user: currentUserId,
      post: postId,
    });
    if (!existingRepost) {
      await Repost.create({ user: currentUserId, post: postId });
      // Increment repost count on the original post (only when a new repost
      // was actually created, to avoid double-counting)
      await Post.findByIdAndUpdate(postId, { $inc: { repostsCount: 1 } });
    }

    // Notify the original post author (if not reposting own post)
    if (originalPost.author.toString() !== currentUserId.toString()) {
      await createNotification({
        recipient: originalPost.author.toString(),
        sender: currentUserId.toString(),
        type: "repost",
        post: postId,
      });
    }

    // Log interaction for feed ranking
    const fullOriginal = await Post.findById(postId).select("author hashtags").lean();
    if (fullOriginal && currentUserId.toString() !== fullOriginal.author.toString()) {
      logInteraction(
        currentUserId.toString(),
        fullOriginal.author.toString(),
        postId,
        "share",
        fullOriginal.hashtags || []
      );
    }

    await clearFeedCache();
    await clearUserPostsCache(currentUserId.toString());

    // Return the newly created quote-repost post
    const populated = await Post.findById(newPost._id)
      .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    return res.status(201).json({
      success: true,
      message: "Quote repost created!",
      post: populated,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in quoteRepost controller!`, { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

// unpin a post from the current user's profile
export const unpinPost = async (req: Request<Params>, res: Response) => {
  const { postId } = req.params;
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) {
      throw new UnauthorizedError("Unauthorized!");
    }

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new BadRequestError("Invalid post ID!");
    }

    const user = await User.findById(currentUserId);
    if (!user) {
      throw new NotFoundError("User not found!");
    }

    const pinned = user.pinnedPosts || [];
    const filtered = pinned.filter((id) => id.toString() !== postId);

    if (filtered.length === pinned.length) {
      throw new BadRequestError("Post is not pinned!");
    }

    user.pinnedPosts = filtered;
    await user.save();

    // invalidate caches
    await clearUserPostsCache(currentUserId.toString());
    await clearFeedCache();
    const unpinUser = currentUserId.toString();
    await Promise.all([
      clearByPattern(`api:*${unpinUser}*pinned*`),
      clearByPattern(`api:*${unpinUser}*posts*`),
    ]);

    // emit real-time unpin event
    emitPostUnpin(postId, currentUserId.toString());

    return res.status(200).json({
      success: true,
      message: "Post unpinned successfully!",
      pinnedPosts: user.pinnedPosts,
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in unpinPost controller!`, { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * Hide a post from the current user's feeds ("Not interested").
 * POST /api/posts/:postId/hide
 */
export const hidePost = async (req: Request<Params>, res: Response) => {
  const { postId } = req.params;
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new BadRequestError("Invalid post ID!");
    }

    const post = await Post.findById(postId).select("_id").lean();
    if (!post) throw new NotFoundError("Post not found!");

    // Add the post to the user's hidden set (idempotent).
    await User.findByIdAndUpdate(currentUserId, {
      $addToSet: { hiddenPosts: postId },
    });

    // Feeds, For-You and search must reflect the change immediately.
    await clearFeedCache();
    await clearByPattern("feed:for-you:*");
    await clearByPattern("search:posts:*");

    return res.status(200).json({
      success: true,
      message: "Post hidden from your feeds.",
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in hidePost controller!`, { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * Unhide a previously hidden post (restore to feeds).
 * DELETE /api/posts/:postId/hide
 */
export const unhidePost = async (req: Request<Params>, res: Response) => {
  const { postId } = req.params;
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new BadRequestError("Invalid post ID!");
    }

    await User.findByIdAndUpdate(currentUserId, {
      $pull: { hiddenPosts: postId },
    });

    await clearFeedCache();
    await clearByPattern("feed:for-you:*");
    await clearByPattern("search:posts:*");

    return res.status(200).json({
      success: true,
      message: "Post restored to your feeds.",
    });
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error(`Error in unhidePost controller!`, { error: err?.message });
    throw new AppError("Internal server error!");
  }
};

// trim body; if empty after trim return 400

// check post body against configurable blocklist before save
