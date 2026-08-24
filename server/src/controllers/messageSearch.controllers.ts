import { Request, Response } from "express";
import mongoose from "mongoose";
import { Message } from "../models/message.model";
import { Conversation } from "../models/conversation.model";
import { logger } from "../utilities/logger";
import { AppError, BadRequestError, NotFoundError, UnauthorizedError } from "../utilities/errors";
import { getSearchCache, setSearchCache } from "../utilities/searchCache";

/**
 * Search messages within a conversation.
 * GET /api/chats/:conversationId/search?q=<query>
 */
export const searchMessages = async (req: Request, res: Response) => {
  try {
    const conversationId = req.params.conversationId as string;
    const query = (req.query.q as string)?.trim();
    const currentUserId = req.user?._id?.toString();

    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");
    if (!query) return res.status(400).json({ success: false, message: "Search query required" });
    if (!mongoose.Types.ObjectId.isValid(conversationId)) throw new BadRequestError("Invalid conversation ID!");

    // Verify user is a participant
    const conversation = await Conversation.findById(conversationId as any).select("participants").lean();
    if (!conversation) throw new NotFoundError("Conversation not found!");
    if (!conversation.participants.some((p: any) => p.toString() === currentUserId)) {
      throw new BadRequestError("Not a participant of this conversation!");
    }

    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Pagination
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const cursor = req.query.cursor as string | undefined;

    const searchQuery: any = {
      conversation: conversationId,
      text: { $regex: escapedQuery, $options: "i" },
      deletedFor: { $ne: currentUserId },
    };
    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      searchQuery._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    // Short-TTL in-memory cache: repeated/backspace queries resolve instantly
    // instead of hitting the (slow, free-tier) DB again.
    // NOTE: keyed per-user — the query filters `deletedFor: { $ne: user }`,
    // so different users can legitimately see different results in the same
    // conversation (a per-user key prevents cross-user cache contamination).
    const cacheKey = `chat:${conversationId}:${currentUserId}:${query}`;
    const cached = getSearchCache(cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }

    // Search messages using text index (case-insensitive regex fallback)
    const messages = await Message.find(searchQuery)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    const hasMore = messages.length > limit;
    if (hasMore) {
      messages.pop();
    }
    const nextCursor = messages.slice(-1).shift()?._id || null;

    const payload = { success: true, messages, count: messages.length, hasMore, nextCursor };
    setSearchCache(cacheKey, payload);

    return res.status(200).json(payload);
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Message search error", { error: err.message });
    throw new AppError("Internal server error!");
  }
};

/**
 * Search ALL of the user's conversations for a message — the WhatsApp-style
 * "search in chats" that powers the chat-list search box. Returns light
 * snippets (partner + text + time + conversationId) so the client can render
 * a message-result row and deep-link into the right conversation.
 *
 * GET /api/chats/search?q=<query>
 */
export const searchAllMessages = async (req: Request, res: Response) => {
  try {
    const query = (req.query.q as string)?.trim();
    const currentUserId = req.user?._id?.toString();

    if (!currentUserId) throw new UnauthorizedError("Unauthorized!");
    if (!query) return res.status(400).json({ success: false, message: "Search query required" });

    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Short-TTL in-memory cache (same pattern as the per-conversation search).
    const cacheKey = `allchat:${currentUserId}:${query}`;
    const cached = getSearchCache(cacheKey);
    if (cached) return res.status(200).json(cached);

    // Only search conversations this user actually participates in.
    const myConvs = await Conversation.find({
      participants: currentUserId,
    })
      .select("_id participants")
      .lean();
    const convIds = myConvs.map((c: any) => c._id);

    // Bounded per-conversation scan instead of one unbounded $in query:
    // the old query walked a conversation's ENTIRE history until it found 8
    // matches anywhere, so a popular chat with no hits forced a full scan of
    // every message in it. Two bounds here:
    //   1. Per-conversation result cap (SCAN_LIMIT matches, newest-first,
    //      index-backed via { conversation, createdAt }).
    //   2. A 365-day recency window, so a conversation whose history is
    //      huge but has < SCAN_LIMIT matches can't force a walk of every
    //      message it ever had — the walk is bounded to one year of docs.
    // Results are merged and re-sorted for the final top-8.
    const SCAN_LIMIT = 200;
    const SCAN_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
    const regex = { $regex: escapedQuery, $options: "i" } as const;
    const results = convIds.length
      ? (
          await Promise.all(
            convIds.map((convId) =>
              Message.find({
                conversation: convId,
                text: regex,
                createdAt: { $gte: new Date(Date.now() - SCAN_WINDOW_MS) },
                isDeleted: { $ne: true },
                deletedFor: { $ne: currentUserId },
              })
                .sort({ createdAt: -1 })
                .limit(SCAN_LIMIT)
                .select(
                  "_id conversation sender recipient text attachments createdAt",
                )
                .populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
                .populate("recipient", "username fullName profilePic isVerified statusText waitlistPerk")
                .lean(),
            ),
          )
        )
          .flat()
          .sort(
            (a: any, b: any) =>
              new Date(b.createdAt).getTime() -
              new Date(a.createdAt).getTime(),
          )
          .slice(0, 8)
      : [];

    // Attach the partner (the non-me participant of each conversation) so the
    // client can render the row without another query. Fall back to the
    // message's sender/recipient for edge cases (legacy data).
    const convById = new Map(
      myConvs.map((c: any) => [c._id.toString(), c]),
    );
    const payload = {
      success: true,
      results: results.map((m: any) => {
        const conv = convById.get(m.conversation?.toString());
        const participants = (conv?.participants || [])
          .map((p: any) => p?.toString())
          .filter(Boolean);
        const partnerId = participants.find(
          (p: string) => p !== currentUserId,
        );
        const meId = m.sender?._id?.toString();
        const partner =
          meId === currentUserId ? m.recipient : m.sender;
        return {
          conversationId: m.conversation,
          messageId: m._id,
          partner,
          partnerId: partner?._id?.toString() || partnerId || null,
          text: (m.text || "").slice(0, 140),
          hasAttachments: (m.attachments || []).length > 0,
          createdAt: m.createdAt,
        };
      }),
      count: results.length,
    };
    setSearchCache(cacheKey, payload);

    return res.status(200).json(payload);
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("Global message search error", { error: err.message });
    throw new AppError("Internal server error!");
  }
};
