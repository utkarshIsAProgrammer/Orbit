import mongoose from "mongoose";
import type { Request, Response, NextFunction } from "express";
import Collection from "../models/collection.model";
import Post from "../models/post.model";
import { User } from "../models/user.model";
import { Community } from "../models/community.model";
import { CommunityMessage } from "../models/communityMessage.model";
import { getIO } from "../configs/socket";
import { env } from "../configs/env";
import { sanitizePlainText } from "../configs/sanitize";
import { createNotification } from "../utilities/notification";
import { canViewCloseFriendsPost } from "../utilities/postVisibility";
import { deliverForwardToChat } from "../services/chatForwardService";
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  AppError,
} from "../utilities/errors";
import { logger } from "../utilities/logger";

export const createCollection = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const currentUserId = req.user?._id;
  const { name } = req.body;

  try {
    if (!currentUserId) return next(new UnauthorizedError("Unauthorized!"));
    if (!name || typeof name !== "string" || !name.trim()) {
      return next(new BadRequestError("Collection name is required!"));
    }
    if (name.trim().length > 100) {
      return next(new BadRequestError("Collection name cannot exceed 100 characters!"));
    }

    const collection = new Collection({ user: currentUserId, name: name.trim() });
    await collection.save();

    return res.status(201).json({ success: true, collection });
  } catch (err: any) {
    logger.error("Error creating collection", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

export const getCollections = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) return next(new UnauthorizedError("Unauthorized!"));

    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const cursor: string | undefined = typeof req.query.cursor === "string" ? req.query.cursor : undefined;

    const query: any = { user: currentUserId };
    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      query._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const collections = await Collection.find(query)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = collections.length > limit;
    if (hasMore) {
      collections.pop();
    }
    const nextCursor = collections.slice(-1).shift()?._id || null;

    // Attach an authoritative post count so the UI never shows a stale/zero
    // count even when a cached list is served before the posts array refreshes.
    const withCounts = collections.map((c: any) => ({
      ...c,
      postsCount: (c.posts || []).length,
    }));

    return res.status(200).json({ success: true, collections: withCounts, hasMore, nextCursor });
  } catch (err: any) {
    logger.error("Error getting collections", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

export const addPostToCollection = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const currentUserId = req.user?._id;
  const { collectionId, postId } = req.params;

  try {
    if (!currentUserId) return next(new UnauthorizedError("Unauthorized!"));

    const collection = await Collection.findById(collectionId);
    if (!collection) return next(new NotFoundError("Collection not found!"));
    if (collection.user.toString() !== currentUserId.toString()) {
      return next(new BadRequestError("You can only add posts to your own collections!"));
    }

    const post = await Post.findById(postId).populate("author", "closeFriends");
    if (!post) return next(new NotFoundError("Post not found!"));

    if (post.visibility === "closeFriends") {
      const authorId = (post.author as any)?._id?.toString() || post.author?.toString();
      const currentUserIdStr = currentUserId.toString();
      if (authorId !== currentUserIdStr) {
        const closeFriendsList = (post.author as any)?.closeFriends || [];
        const isCloseFriend = closeFriendsList.some((id: any) => id.toString() === currentUserIdStr);
        if (!isCloseFriend) {
          return next(new ForbiddenError("You are not authorized to view or collect this post!"));
        }
      }
    }

    if (collection.posts.some((p) => p.toString() === postId)) {
      return res.status(200).json({ success: true, message: "Post already in collection!" });
    }

    collection.posts.push(post._id);
    await collection.save();

    return res.status(200).json({ success: true, collection });
  } catch (err: any) {
    logger.error("Error adding post to collection", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

export const removePostFromCollection = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const currentUserId = req.user?._id;
  const { collectionId, postId } = req.params;

  try {
    if (!currentUserId) return next(new UnauthorizedError("Unauthorized!"));

    const collection = await Collection.findById(collectionId);
    if (!collection) return next(new NotFoundError("Collection not found!"));
    if (collection.user.toString() !== currentUserId.toString()) {
      return next(new BadRequestError("You can only remove posts from your own collections!"));
    }

    collection.posts = collection.posts.filter((p) => p.toString() !== postId);
    await collection.save();

    return res.status(200).json({ success: true, collection });
  } catch (err: any) {
    logger.error("Error removing post from collection", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

export const deleteCollection = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const currentUserId = req.user?._id;
  const { collectionId } = req.params;

  try {
    if (!currentUserId) return next(new UnauthorizedError("Unauthorized!"));

    const collection = await Collection.findById(collectionId);
    if (!collection) return next(new NotFoundError("Collection not found!"));
    if (collection.user.toString() !== currentUserId.toString()) {
      return next(new BadRequestError("You can only delete your own collections!"));
    }

    await Collection.findByIdAndDelete(collectionId);

    return res.status(200).json({ success: true, message: "Collection deleted!" });
  } catch (err: any) {
    logger.error("Error deleting collection", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

export const getCollectionPosts = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const currentUserId = req.user?._id;
  const { collectionId } = req.params;

  try {
    if (!currentUserId) return next(new UnauthorizedError("Unauthorized!"));
    if (typeof collectionId !== "string" || !mongoose.Types.ObjectId.isValid(collectionId)) {
      return next(new BadRequestError("Invalid collection ID!"));
    }

    const collection = await Collection.findById(collectionId).select("user posts").lean();
    if (!collection) return next(new NotFoundError("Collection not found!"));
    if (collection.user.toString() !== currentUserId.toString()) {
      return next(new BadRequestError("You can only view your own collections!"));
    }

    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;

    // Get a slice of the posts array using cursor
    const postIds: any[] = collection.posts || [];
    let startIndex = 0;
    if (cursor) {
      const cursorIndex = postIds.findIndex(
        (p) => p.toString() === cursor
      );
      if (cursorIndex >= 0) {
        startIndex = cursorIndex + 1;
      }
    }

    const slicedIds = postIds.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < postIds.length;
    const nextCursor = hasMore ? postIds[startIndex + limit - 1]?.toString() || null : null;

    // Fetch the sliced posts with author populated
    const posts = await Post.find({ _id: { $in: slicedIds } })
      .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
      .sort({ _id: -1 })
      .lean();

    return res.status(200).json({ success: true, posts, hasMore, nextCursor });
  } catch (err: any) {
    logger.error("Error getting collection posts", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * GET /api/collections/shared/:collectionId — Read-only view of a shared
 * collection. Anyone with the share link can see the collection's name +
 * posts (posts themselves still respect their own visibility rules).
 * Enabled so the collection_share notification can deep-link somewhere
 * meaningful instead of dead-ending at a 403.
 */
export const getSharedCollection = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const currentUserId = req.user?._id;
  const { collectionId } = req.params;

  try {
    if (!currentUserId) return next(new UnauthorizedError("Unauthorized!"));
    if (typeof collectionId !== "string" || !mongoose.Types.ObjectId.isValid(collectionId)) {
      return next(new BadRequestError("Invalid collection ID!"));
    }

    const collection = await Collection.findById(collectionId)
      .populate("user", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();
    if (!collection) return next(new NotFoundError("Collection not found!"));

    // Resolve post ids → posts (respecting visibility: closeFriends posts are
    // shown only to their author's close friends — reuse the same gate as
    // single-post views so a shared collection can never leak private content).
    const postIds: any[] = (collection.posts || []).slice(0, 50);
    const rawPosts = await Post.find({ _id: { $in: postIds } })
      .populate("author", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();
    const posts = [];
    for (const p of rawPosts) {
      if (await canViewCloseFriendsPost(p, currentUserId.toString())) {
        posts.push(p);
      }
    }

    return res.status(200).json({
      success: true,
      collection: {
        _id: collection._id,
        name: collection.name,
        owner: collection.user,
        postCount: postIds.length,
        createdAt: collection.createdAt,
      },
      posts,
    });
  } catch (err: any) {
    logger.error("Error getting shared collection", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * POST /api/collections/:collectionId/forward — share a collection with a
 * user via the DM forward system (mirrors forwardProfile): validates the
 * sender owns the collection, then notifies the recipient with a
 * collection_share notification carrying the collection ref + a share URL.
 */
export const forwardCollection = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const currentUserId = req.user?._id;
  const { collectionId } = req.params;
  const { recipientId } = req.body || {};

  try {
    if (!currentUserId) return next(new UnauthorizedError("Unauthorized!"));
    if (typeof collectionId !== "string" || !mongoose.Types.ObjectId.isValid(collectionId)) {
      return next(new BadRequestError("Invalid collection ID!"));
    }
    if (!recipientId || !mongoose.Types.ObjectId.isValid(recipientId)) {
      return next(new BadRequestError("Invalid recipient!"));
    }
    if (currentUserId.toString() === recipientId.toString()) {
      return next(new BadRequestError("Cannot forward a collection to yourself!"));
    }

    const collection = await Collection.findById(collectionId)
      .select("user name posts")
      .lean();
    if (!collection) return next(new NotFoundError("Collection not found!"));
    if (collection.user.toString() !== currentUserId.toString()) {
      return next(new ForbiddenError("You can only share your own collections!"));
    }

    const recipient = await User.findById(recipientId).select("_id").lean();
    if (!recipient) return next(new BadRequestError("Recipient not found!"));

    // Notify the recipient (createNotification drops it if mutually blocked).
    await createNotification({
      recipient: recipientId,
      sender: currentUserId.toString(),
      type: "collection_share",
      collection: collectionId,
    });

    // WhatsApp/Instagram behavior: the forward ALSO lands as a real chat
    // message in the 1:1 conversation (created if needed), so the recipient
    // sees it in their chat and the sender sees the conversation in their
    // chat list.
    const shareUrl = `${env.CLIENT_URL}/collection/${collectionId}`;
    const postCount = (collection.posts || []).length;
    await deliverForwardToChat({
      senderId: currentUserId.toString(),
      recipientId: recipientId.toString(),
      text:
        `Shared a collection: ${collection.name}` +
        ` (${postCount} post${postCount === 1 ? "" : "s"})\n${shareUrl}`,
    });

    return res.status(200).json({
      success: true,
      message: "Collection shared!",
      shareUrl,
    });
  } catch (err: any) {
    logger.error("Error forwarding collection", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};

/**
 * POST /api/collections/:collectionId/forward-community — share a collection
 * into a community chat (mirrors forwardPostToCommunity): posts a message
 * containing the collection preview + link into the community.
 */
export const forwardCollectionToCommunity = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const currentUserId = req.user?._id;
  const { collectionId } = req.params;
  const { communityId } = req.body || {};

  try {
    if (!currentUserId) return next(new UnauthorizedError("Unauthorized!"));
    if (typeof collectionId !== "string" || !mongoose.Types.ObjectId.isValid(collectionId)) {
      return next(new BadRequestError("Invalid collection ID!"));
    }
    if (!communityId || !mongoose.Types.ObjectId.isValid(communityId)) {
      return next(new BadRequestError("Invalid community!"));
    }

    const collection = await Collection.findById(collectionId).select("user name posts").lean();
    if (!collection) return next(new NotFoundError("Collection not found!"));
    if (collection.user.toString() !== currentUserId.toString()) {
      return next(new ForbiddenError("You can only share your own collections!"));
    }

    const community = await Community.findById(communityId)
      .select("members messagingEnabled")
      .lean();
    if (!community) return next(new NotFoundError("Community not found!"));
    const isMember = (community.members || []).some(
      (m: any) => m.user?.toString() === currentUserId.toString(),
    );
    if (!isMember) {
      return next(new ForbiddenError("You must be a member to share into this community!"));
    }
    if (community.messagingEnabled === false) {
      return next(new ForbiddenError("Messaging is currently disabled in this community!"));
    }

    const shareUrl = `${env.CLIENT_URL}/collection/${collectionId}`;
    const previewText =
      `Shared a collection: ${collection.name}` +
      ` (${(collection.posts || []).length} posts)\n${shareUrl}`;

    const message = new CommunityMessage({
      community: communityId,
      sender: currentUserId,
      text: sanitizePlainText(previewText),
    });
    await message.save();

    const populatedMessage = await CommunityMessage.findById(message._id)
      .populate("sender", "username fullName profilePic isVerified waitlistPerk")
      .lean();

    await Community.findByIdAndUpdate(communityId, {
      updatedAt: new Date(),
      lastMessage: {
        messageId: message._id,
        text: sanitizePlainText(previewText),
        attachmentType: "",
        sender: {
          _id: currentUserId,
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

    return res.status(201).json({
      success: true,
      message: "Shared into community!",
      sentMessage: populatedMessage,
    });
  } catch (err: any) {
    logger.error("Error forwarding collection to community", { error: err.message });
    return next(new AppError("Internal server error!"));
  }
};
