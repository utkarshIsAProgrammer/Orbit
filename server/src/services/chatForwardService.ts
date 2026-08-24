import mongoose from "mongoose";
import { Conversation } from "../models/conversation.model";
import { Message } from "../models/message.model";
import Block from "../models/block.model";
import { clearChatCache } from "../configs/cache";
import {
  getIO,
  emitNewMessage,
  emitChatNotification,
  isRecipientActiveInConversation,
} from "../configs/socket";
import { sanitizePlainText } from "../configs/sanitize";
import { logger } from "../utilities/logger";

interface ForwardChatOptions {
  senderId: string;
  recipientId: string;
  text: string;
  attachment?: { url: string; type: "image" | "video" | "file" };
}

/**
 * Deliver a forwarded item (post / profile / comment / collection / glimpse)
 * as a REAL chat message in a (possibly new) 1:1 conversation — the
 * WhatsApp/Instagram behavior. Without this, forwarding only created a
 * notification, so the recipient never saw the item in chat and the sender
 * never got the conversation in their chat list.
 *
 * Mirrors the sendMessage flow: creates/updates the conversation, bumps the
 * recipient's unread count, clears caches, and emits the same socket events
 * (`message:new` + `chat:notification` with the populated conversation) so the
 * recipient's chat list updates in real time. Returns the populated message,
 * or null when the delivery must be skipped (mutual block / self-forward).
 *
 * This is the actual implementation, run by the BullMQ chat-forward worker
 * or as the inline fallback.
 */
export const deliverForwardToChatInline = async ({
  senderId,
  recipientId,
  text,
  attachment,
}: ForwardChatOptions) => {
  try {
    if (!senderId || !recipientId || senderId === recipientId) return null;

    // Blocked users never appear in each other's chats — skip delivery.
    const isBlocked = await Block.findOne({
      $or: [
        { blocker: senderId, blocked: recipientId },
        { blocker: recipientId, blocked: senderId },
      ],
    });
    if (isBlocked) return null;

    const idA = new mongoose.Types.ObjectId(senderId);
    const idB = new mongoose.Types.ObjectId(recipientId);

    // Find or create the 1:1 conversation (mirrors getOrCreateConversation).
    let conversation = await Conversation.findOne({
      participants: { $all: [idA, idB] },
    });
    if (!conversation) {
      const sortedStr = [senderId, recipientId].sort();
      conversation = new Conversation({
        participants: sortedStr.map((id) => new mongoose.Types.ObjectId(id)),
        unreadCounts: { [senderId]: 0, [recipientId]: 0 },
      });
      await conversation.save();
      // Brand-new conversation must appear in both users' lists immediately.
      await clearChatCache(conversation._id.toString(), [
        senderId,
        recipientId,
      ]);
    }

    // Create the chat message with the forward preview text (+ optional media).
    const message = new Message({
      conversation: conversation._id,
      sender: senderId,
      recipient: recipientId,
      text: sanitizePlainText(text),
      attachments: attachment ? [{ ...attachment }] : [],
    });
    await message.save();

    // Recipient unread handling — identical to sendMessage.
    const isRecipientActive = await isRecipientActiveInConversation(
      conversation._id.toString(),
      recipientId,
    );
    const updateObj: any = { lastMessage: message._id, lastAction: null };
    if (!isRecipientActive) {
      updateObj.$inc = { [`unreadCounts.${recipientId}`]: 1 };
    }
    // Use the AFTER document so the emitted unread count reflects the
    // increment (a stale pre-update doc would undercount the badge when
    // the recipient already had unread messages).
    const updatedConversation = await Conversation.findByIdAndUpdate(
      conversation._id,
      updateObj,
      { returnDocument: "after" },
    );

    await clearChatCache(conversation._id.toString(), [senderId, recipientId]);

    const populatedMessage = await Message.findById(message._id)
      .populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();

    // Emit to the conversation room (active viewers).
    emitNewMessage(conversation._id.toString(), populatedMessage);

    // Emit to the recipient's personal room + chat notification so the badge
    // updates and the conversation appears in their list in real time.
    if (!isRecipientActive) {
      getIO().to(`user:${recipientId}`).emit("message:new", populatedMessage);

      const populatedConversation = await Conversation.findById(
        conversation._id,
      )
        .populate("participants", "username fullName profilePic isVerified statusText waitlistPerk")
        .populate({
          path: "lastMessage",
          populate: {
            path: "sender",
            select: "username fullName profilePic isVerified statusText waitlistPerk",
          },
        })
        .lean();

      const unreadCount =
        (updatedConversation as any)?.unreadCounts?.get?.(recipientId) || 1;
      emitChatNotification(recipientId, {
        conversationId: conversation._id.toString(),
        message: populatedMessage,
        unreadCount,
        conversation: populatedConversation,
      });
    }

    return populatedMessage;
  } catch (err: any) {
    logger.error("Error in deliverForwardToChatInline", { error: err.message });
    return null;
  }
}

/**
 * Deliver a forwarded item (post / profile / comment / collection / glimpse)
 * as a REAL chat message in a (possibly new) 1:1 conversation.
 *
 * Prefers BullMQ: the conversation find-or-create + message save + unread
 * bump + cache clears run on the chat-forward worker. Delivery to both sides
 * happens over the socket (`message:new` / `chat:notification`), so nothing
 * in the HTTP response depends on the DB work completing — callers get an
 * instant ack. Falls back to the inline delivery when BullMQ isn't
 * configured, so behavior is unchanged without REDIS_URL.
 */
export const deliverForwardToChat = async (
  opts: ForwardChatOptions,
): Promise<ReturnType<typeof deliverForwardToChatInline>> => {
  try {
    const { enqueueChatForward } = await import("../configs/queue");
    const queued = await enqueueChatForward(opts);
    if (queued) return null;
  } catch (err: any) {
    logger.error("Chat forward enqueue failed — delivering inline", {
      error: err.message,
    });
  }
  return deliverForwardToChatInline(opts);
};
