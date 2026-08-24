import type { Community, ConversationLastAction } from "../types";
import { formatCallDuration } from "../utils/format";

interface CommunityLastActivityProps {
  lastMessage?: Community["lastMessage"];
  lastAction?: ConversationLastAction | null;
  currentUserId?: string;
}

/**
 * Human-readable label for a community message's attachment so the list never
 * says a generic "sent an attachment" — it always names the type:
 * "sent a photo", "sent a video", "sent a voice note", "sent a document", etc.
 */
const getAttachmentLabel = (attachmentType?: string): string => {
  switch (attachmentType) {
    case "image":
      return "sent a photo";
    case "gif":
      return "sent a GIF";
    case "video":
      return "sent a video";
    case "voice_note":
      return "sent a voice note";
    case "file":
      return "sent a document";
    case "sticker":
      return "sent a sticker";
    case "meme":
      return "sent a meme";
    default:
      return "sent an attachment";
  }
};

/**
 * Last-activity preview for the community list (My Communities), mirroring the
 * 1-on-1 chat list: shows the last message — or, when the most recent thing
 * that happened was a reaction, "Name reacted ❤️ to your message" etc.
 */
export default function CommunityLastActivity({
  lastMessage,
  lastAction,
  currentUserId,
}: CommunityLastActivityProps) {
  if (lastMessage?.isDeleted) {
    return <span className="italic">deleted message</span>;
  }

  const actionAt = lastAction?.createdAt
    ? new Date(lastAction.createdAt).getTime()
    : null;
  const messageAt = lastMessage?.createdAt
    ? new Date(lastMessage.createdAt).getTime()
    : null;
  const actionIsNewer =
    !!lastAction &&
    (actionAt !== null && messageAt !== null
      ? actionAt >= messageAt
      : actionAt !== null);

  if (actionIsNewer && lastAction) {
    const actorId = lastAction.actor?._id;
    const isMyAction = !!currentUserId && actorId === currentUserId;
    const actorName =
      lastAction.actor?.fullName?.split(" ")[0] ||
      lastAction.actor?.username ||
      "";

    if (lastAction.type === "reaction") {
      const isMyMessage =
        !!currentUserId && lastAction.messageSenderId === currentUserId;
      const reactionActor = actorName || "Someone";
      if (isMyAction) {
        return (
          <span className="font-semibold text-zinc-300">
            You reacted {lastAction.emoji}
          </span>
        );
      }
      if (isMyMessage) {
        return (
          <span className="font-semibold text-zinc-300">
            {reactionActor} reacted {lastAction.emoji} to your message
          </span>
        );
      }
      return (
        <span className="font-semibold text-zinc-300">
          {reactionActor} reacted {lastAction.emoji}
        </span>
      );
    }

    if (lastAction.type === "pin") {
      return (
        <span className="font-semibold text-zinc-300">
          {isMyAction ? "You" : actorName || "Someone"} pinned a message
        </span>
      );
    }

    if (lastAction.type === "unpin") {
      return (
        <span className="font-semibold text-zinc-300">
          {isMyAction ? "You" : actorName || "Someone"} unpinned a message
        </span>
      );
    }

    if (lastAction.type === "message_edit") {
      return (
        <span className="font-semibold text-zinc-300">
          {isMyAction ? "You" : actorName || "Someone"} edited a message
        </span>
      );
    }

    if (lastAction.type === "call") {
      const callKind =
        lastAction.callType === "video" ? "video call" : "voice call";
      if (lastAction.callStatus === "started") {
        return (
          <span className="font-semibold text-zinc-300">
            {isMyAction ? "You" : actorName || "Someone"} started a {callKind}
          </span>
        );
      }
      // Ended — prefer the simple "Voice call ended" phrasing, with the
      // call duration when it's known ("Voice call ended · 12m 30s").
      return (
        <span className="font-semibold text-zinc-300">
          {callKind[0].toUpperCase() + callKind.slice(1)} ended
          {lastAction.callDuration !== undefined &&
            lastAction.callDuration > 0 &&
            ` · ${formatCallDuration(lastAction.callDuration)}`}
        </span>
      );
    }
  }

  if (lastMessage?.text) {
    const senderName =
      lastMessage.sender?.fullName?.split(" ")[0] ||
      lastMessage.sender?.username ||
      "";
    return (
      <>
        {senderName && (
          <span className="font-semibold text-zinc-300">{senderName}: </span>
        )}
        {lastMessage.text}
      </>
    );
  }

  if (lastMessage?.attachmentType) {
    const senderName =
      lastMessage.sender?.fullName?.split(" ")[0] ||
      lastMessage.sender?.username ||
      "";
    return (
      <span className="font-semibold text-zinc-300">
        {senderName ? `${senderName} ` : ""}
        {getAttachmentLabel(lastMessage.attachmentType)}
      </span>
    );
  }

  return null;
}
