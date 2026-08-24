import mongoose from "mongoose";
import type { Request, Response, NextFunction } from "express";
import { Message } from "../models/message.model";
import { Conversation } from "../models/conversation.model";
import { BadRequestError, NotFoundError, ForbiddenError } from "../utilities/errors";
import { emitMessageReaction } from "../configs/socket";
import { clearChatCache } from "../configs/cache";
import { createNotification } from "../utilities/notification";
import { logger } from "../utilities/logger";

export const toggleReaction = async (
  req: Request<{ messageId: string }>,
  res: Response,
  next: NextFunction,
) => {
  const { messageId } = req.params;
  const { emoji } = req.body;
  const currentUserId = req.user?._id;

  try {
    if (!currentUserId) {
      return next(new BadRequestError("Unauthorized!"));
    }

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return next(new BadRequestError("Invalid message ID!"));
    }

    if (!emoji || typeof emoji !== "string" || emoji.trim().length === 0) {
      return next(new BadRequestError("Emoji is required!"));
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return next(new NotFoundError("Message not found!"));
    }

    if (message.isDeleted) {
      return next(new BadRequestError("Cannot react to a deleted message!"));
    }

    const conversation = await Conversation.findById(message.conversation)
      .select("participants lastMessage lastAction")
      .lean();
    if (!conversation) {
      return next(new NotFoundError("Conversation not found!"));
    }
    const isParticipant = (conversation.participants || []).some(
      (p: any) => p.toString() === currentUserId.toString()
    );
    if (!isParticipant) {
      return next(new ForbiddenError("You are not a participant in this conversation!"));
    }

    const userIdStr = currentUserId.toString();
    const existingIndex = (message.reactions || []).findIndex(
      (r) => (r.sender?._id || r.sender)?.toString() === userIdStr && r.emoji === emoji.trim(),
    );

    let reaction: unknown = null;
    let type: "add" | "remove" = "add";

    if (existingIndex >= 0) {
      // Remove all existing reactions by this user (toggle off)
      message.reactions = message.reactions!.filter(
        (r) => (r.sender?._id || r.sender)?.toString() !== userIdStr
      ) as any;
      type = "remove";
    } else {
      // Remove any previous reaction by this user (replace), then add new one
      message.reactions = message.reactions!.filter(
        (r) => (r.sender?._id || r.sender)?.toString() !== userIdStr
      ) as any;
      reaction = {
        emoji: emoji.trim(),
        sender: currentUserId,
        createdAt: new Date(),
      };
      message.reactions!.push(reaction as any);
    }

    await message.save();

    // ── Emit the socket event IMMEDIATELY ───────────────────────────────
    // The recipient's perceived latency is the time between this save and the
    // emit — so nothing slow may run before it. The reaction payload is built
    // from req.user (the actor's profile is already loaded by the auth
    // middleware — no DB round-trip needed) and the conversation participants
    // are already in hand from the fetch above. Cache eviction, lastAction and
    // the response populate all happen AFTER the emit.
    const actorUser = (req.user as any) || {};
    const participantIds = (conversation.participants || []).map((p: any) =>
      p.toString(),
    );
    const populatedReaction =
      type === "add"
        ? {
            emoji: emoji.trim(),
            sender: {
              _id: currentUserId,
              username: actorUser.username || "",
              fullName: actorUser.fullName || "",
              profilePic: actorUser.profilePic || null,
            },
            createdAt: new Date(),
          }
        : { emoji: emoji.trim(), sender: { _id: userIdStr } };
    emitMessageReaction(
      message.conversation.toString(),
      {
        messageId,
        reaction: populatedReaction,
        type,
      },
      participantIds,
    );

    // ── After the emit: bookkeeping the recipient never waits on ────────
    // Record the last action on the conversation so the chat list preview shows
    // "reacted ❤️ to your message" instead of the stale last message.
    // Only reactions on the conversation's NEWEST message are recorded — a
    // reaction to an older message must not override the preview. Removing the
    // matching reaction clears it again server-side so a reload never shows a
    // stale "reacted" preview.
    try {
      const reactedMessageIsLast =
        conversation.lastMessage?.toString() === message._id.toString();
      const lastActionMatches =
        (conversation.lastAction as any)?.messageId?.toString() ===
        message._id.toString();

      if (type === "add" && reactedMessageIsLast) {
        await Conversation.findByIdAndUpdate(message.conversation, {
          $set: {
            lastAction: {
              type: "reaction",
              emoji: emoji.trim(),
              messageId: message._id,
              messageSenderId: message.sender,
              actor: {
                _id: currentUserId,
                fullName: actorUser.fullName || "",
                username: actorUser.username || "",
              },
              createdAt: new Date(),
            },
          },
        });
      } else if (type === "remove" && lastActionMatches) {
        await Conversation.findByIdAndUpdate(message.conversation, {
          $set: { lastAction: null },
        });
      }
      // Always invalidate cached conversation lists so the preview updates instantly
      await clearChatCache(message.conversation.toString(), participantIds);
    } catch (cacheErr: any) {
      logger.error("Failed to update conversation lastAction", {
        error: cacheErr.message,
      });
    }

    // Populate sender for the response only (the emit above already used
    // req.user — this extra query never delays the recipient).
    const populatedMessage = await Message.findById(message._id)
      .populate("reactions.sender", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    // Only notify for reaction if the recipient hasn't seen the message yet
    // If they've already seen it, they can see the reaction in the chat UI directly
    if (type === "add" && !message.seen) {
      // Determine who should be notified (the other participant)
      const recipientId =
        userIdStr === message.sender.toString()
          ? message.recipient.toString()
          : message.sender.toString();

      await createNotification({
        recipient: recipientId,
        sender: currentUserId.toString(),
        type: "reaction",
        post: null,
        comment: null,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Reaction updated successfully!",
      reactions: populatedMessage?.reactions || [],
    });
  } catch (err: any) {
    logger.error("Error in toggleReaction controller", { error: err.message });
    return next(err);
  }
};
