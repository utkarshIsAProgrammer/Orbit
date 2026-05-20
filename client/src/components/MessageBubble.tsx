import React, { useRef, useState } from "react";
import { CornerDownLeft, Play, Pause, AlertCircle, Volume2, VolumeX, Pin, Maximize2, File, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText as FileTextIcon, FileVideo, Download, Loader2, Clock } from "lucide-react";
import UserAvatar from "./UserAvatar";
import VerifiedBadge from "./VerifiedBadge";
import LinkPreviewCard from "./LinkPreviewCard";
import TranslateInline from "./TranslateInline";
import { extractFirstUrl } from "../utils/links";
import { renderLinkifiedText } from "../utils/linkify";
import { renderMentionTags, renderHashtagTags } from "../utils/mentions";
	import { popMessageBubble } from "../utils/messageHighlight";
	import { optimizeImageUrl } from "../utils/imageUrls";
	import { getAttachmentFileName, getFileDownloadHref } from "../utils/downloads";
import { hapticLight } from "../utils/haptics";
import type { Message } from "../types";

// Helper to get a human-readable label for an attachment type
/** True while a message is still scheduled (stored, not yet delivered). */
const isScheduled = (msg: any): boolean => {
  const ts = msg?.scheduledAt;
  if (!ts) return false;
  const t = new Date(ts).getTime();
  // Delivered messages have scheduledAt nulled server-side; a stale local
  // copy may still carry the old value — treat past times as delivered.
  return !isNaN(t) && t > Date.now();
};

const getAttachmentLabel = (attachments: any[]): string => {
  if (!attachments || attachments.length === 0) return "Attachment";
  const first = attachments[0];
  switch (first.type) {
    case "image": return "Image";
    case "gif": return "GIF";
    case "video": return "Video";
    case "voice_note": return "Voice note";
    case "file": return "File";
    case "sticker": return "Sticker";
    default: return "Attachment";
  }
};

// ─── File / document attachment card ────────────────────────────

/** Pick a per-extension icon + accent color for the file card. */
const getFileMeta = (att: any): { Icon: any; colorClass: string; ext: string } => {
  const name = att?.name || "";
  const ext = (name.split(".").pop() || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const map: Record<string, { Icon: any; colorClass: string }> = {
    pdf: { Icon: FileTextIcon, colorClass: "text-red-400" },
    doc: { Icon: FileTextIcon, colorClass: "text-blue-400" },
    docx: { Icon: FileTextIcon, colorClass: "text-blue-400" },
    txt: { Icon: FileTextIcon, colorClass: "text-zinc-400" },
    md: { Icon: FileTextIcon, colorClass: "text-zinc-400" },
    xls: { Icon: FileSpreadsheet, colorClass: "text-emerald-400" },
    xlsx: { Icon: FileSpreadsheet, colorClass: "text-emerald-400" },
    csv: { Icon: FileSpreadsheet, colorClass: "text-emerald-400" },
    ppt: { Icon: FileSpreadsheet, colorClass: "text-orange-400" },
    pptx: { Icon: FileSpreadsheet, colorClass: "text-orange-400" },
    zip: { Icon: FileArchive, colorClass: "text-amber-400" },
    rar: { Icon: FileArchive, colorClass: "text-amber-400" },
    "7z": { Icon: FileArchive, colorClass: "text-amber-400" },
    mp3: { Icon: FileAudio, colorClass: "text-fuchsia-400" },
    wav: { Icon: FileAudio, colorClass: "text-fuchsia-400" },
    m4a: { Icon: FileAudio, colorClass: "text-fuchsia-400" },
    aac: { Icon: FileAudio, colorClass: "text-fuchsia-400" },
    mp4: { Icon: FileVideo, colorClass: "text-violet-400" },
    mov: { Icon: FileVideo, colorClass: "text-violet-400" },
    webm: { Icon: FileVideo, colorClass: "text-violet-400" },
    jpg: { Icon: FileImage, colorClass: "text-sky-400" },
    jpeg: { Icon: FileImage, colorClass: "text-sky-400" },
    png: { Icon: FileImage, colorClass: "text-sky-400" },
    gif: { Icon: FileImage, colorClass: "text-sky-400" },
    webp: { Icon: FileImage, colorClass: "text-sky-400" },
  };
  return { ...(map[ext] || { Icon: File, colorClass: "text-zinc-400" }), ext };
};

/** Human-readable file size (e.g. "2.4 MB"). */
const formatFileSize = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }		return `${size.toFixed(size >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
	};

function FileAttachmentCard({ attachment, disabled, isMe }: { attachment: any; disabled?: boolean; isMe: boolean }) {
  const { Icon, colorClass, ext } = getFileMeta(attachment);	const fileName = getAttachmentFileName(attachment);
	const fileSize = formatFileSize(attachment?.size);
  const href = getFileDownloadHref(attachment);

  return (
    <a
      href={!disabled ? href : undefined}
      onClick={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        // Let the browser open the proxy URL — it responds with the file
        e.stopPropagation();
      }}
      target="_blank"
      rel="noopener noreferrer"
      title={`Download ${fileName}`}
      className={`group/file flex w-64 max-w-full items-center gap-3 rounded-xl border p-2.5 transition-all select-none ${
        isMe
          ? "border-white/10 bg-black/25 hover:bg-black/40"
          : "border-zinc-700/50 bg-zinc-900/80 hover:bg-zinc-800/80"
      } ${disabled ? "opacity-40 cursor-not-allowed pointer-events-none" : "cursor-pointer"}`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${colorClass} ${
          isMe ? "bg-white/10" : "bg-zinc-800/90"
        }`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-semibold text-zinc-100" title={fileName}>
          {fileName}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-wide text-zinc-500">
          {ext ? <span className="text-zinc-500">{ext}</span> : null}
          {fileSize ? <span>•</span> : null}
          {fileSize ? <span>{fileSize}</span> : null}
        </span>
      </span>
      {!disabled && (
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all ${
            isMe
              ? "bg-white/10 text-zinc-300 group-hover/file:bg-white/20 group-hover/file:text-white"
              : "bg-zinc-800 text-zinc-400 group-hover/file:bg-zinc-700 group-hover/file:text-white"
          }`}
        >
          <Download className="h-3.5 w-3.5" />
        </span>
      )}
    </a>
  );
}

const CustomCheck = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M22 4L9 17L4 12" />
  </svg>
);

const CustomCheckCheck = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M17 5L10 12L7 9" />
    <path d="M23 4L13 14L10 11" />
  </svg>
);

interface MessageBubbleProps {
  msg: Message;
  isMe: boolean;
  userId: string;
  groupedReactions: Record<string, { count: number; hasReacted: boolean }>;
  handleContextMenu: (e: React.MouseEvent | { clientX: number; clientY: number; preventDefault: () => void }, message: Message) => void;
  handleReaction: (message: Message, emoji: string) => void;
  formatMessageTime: (isoString: string) => string;
  onSwipeToReply?: (message: Message) => void;
  showDateSeparator?: boolean;
  dateSeparatorText?: string;
  showTimeHeader?: boolean;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  /** Personal chat shows reaction emojis without the count number. */
  hideReactionCount?: boolean;
  onRetrySend?: (pendingId: string) => void;
  /** 0–100 upload progress for a pending (sending) message. When provided,
   *  the bubble shows a real progress bar instead of just "Sending...". */
  uploadProgress?: number;
  /** True when this message is pinned in the current conversation — shows the
   *  WhatsApp-style pin badge on the bubble corner. */
  isPinned?: boolean;
  /** Navigates to a profile when an @mention tag is tapped inside the text. */
  onUserClick?: (username: string) => void;
  /** Network connectivity. Pending (optimistic) messages render a clock +
   *  "waiting for connection" while offline (WhatsApp behavior) instead of a
   *  spinner — the message is QUEUED, not actively uploading. */
  isOnline?: boolean;
}

function arePropsEqual(prev: MessageBubbleProps, next: MessageBubbleProps): boolean {
  if (prev.msg._id !== next.msg._id) return false;
  if (prev.msg.text !== next.msg.text) return false;
  if (prev.msg.isDeleted !== next.msg.isDeleted) return false;
  if (prev.msg.seen !== next.msg.seen) return false;
  if (prev.msg.isEdited !== next.msg.isEdited) return false;
  if (prev.isMe !== next.isMe) return false;
  if (prev.showDateSeparator !== next.showDateSeparator) return false;
  if (prev.dateSeparatorText !== next.dateSeparatorText) return false;
  if (prev.showTimeHeader !== next.showTimeHeader) return false;
  if (prev.isFirstInGroup !== next.isFirstInGroup) return false;
  if (prev.isLastInGroup !== next.isLastInGroup) return false;
  if (prev.msg._failed !== next.msg._failed) return false;
  if (prev.isPinned !== next.isPinned) return false;
  if (prev.isOnline !== next.isOnline) return false;

  if (prev.msg.replyTo?._id !== next.msg.replyTo?._id) return false;
  if (prev.msg.replyTo?.text !== next.msg.replyTo?.text) return false;

  const prevReactions = prev.msg.reactions || [];
  const nextReactions = next.msg.reactions || [];
  if (prevReactions.length !== nextReactions.length) return false;
  for (let i = 0; i < prevReactions.length; i++) {
    const pr = prevReactions[i];
    const nr = nextReactions[i];
    if (pr.emoji !== nr.emoji) return false;
    const pSender = typeof pr.sender === "string" ? pr.sender : pr.sender?._id;
    const nSender = typeof nr.sender === "string" ? nr.sender : nr.sender?._id;
    if (pSender !== nSender) return false;
  }

  const prevKeys = Object.keys(prev.groupedReactions);
  const nextKeys = Object.keys(next.groupedReactions);
  if (prevKeys.length !== nextKeys.length) return false;
  for (const key of prevKeys) {
    if (!next.groupedReactions[key]) return false;
    if (prev.groupedReactions[key].count !== next.groupedReactions[key].count) return false;
    if (prev.groupedReactions[key].hasReacted !== next.groupedReactions[key].hasReacted) return false;
  }

  const prevAttachments = prev.msg.attachments || [];
  const nextAttachments = next.msg.attachments || [];
  if (prevAttachments.length !== nextAttachments.length) return false;

  return true;
}

const MessageBubble = React.memo(function MessageBubble({
  msg,
  isMe,
  userId,
  groupedReactions,
  handleContextMenu,
  handleReaction,
  formatMessageTime,
  onSwipeToReply,
  showDateSeparator = false,
  dateSeparatorText = "",
  showTimeHeader = false,
  isFirstInGroup = true,
  isLastInGroup = true,
  hideReactionCount = false,
  onRetrySend,
  isPinned = false,
  onUserClick,
  isOnline = true,
}: MessageBubbleProps) {
  const [showSwipeBadge, setShowSwipeBadge] = useState(false);
  const swipeBarRef = useRef<HTMLDivElement>(null);
  const swipeOffsetRef = useRef(0);
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  const isSwipingRef = useRef(false);

  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Double-tap to quick-react ❤️ (WhatsApp-style) — timestamp of last clean tap.
  const lastTapRef = useRef(0);
  // Total finger movement — a scroll (even vertical) over the bubble must not
  // register as a tap for the double-tap quick-react.
  const tapMovedRef = useRef(false);

  // Video state (per video attachment)
  const [videoMuted, setVideoMuted] = useState<Record<number, boolean>>({});
  const [videoEnded, setVideoEnded] = useState<Record<number, boolean>>({});
  const [videoPlaying, setVideoPlaying] = useState<Record<number, boolean>>({});
  const videoRefs = useRef<Record<number, HTMLVideoElement | null>>({});

  const handleToggleMute = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRefs.current[idx];
    if (video) {
      video.muted = !video.muted;
      setVideoMuted((prev) => ({ ...prev, [idx]: !prev[idx] }));
    }
  };

  const handleVideoEnded = (idx: number) => {
    setVideoEnded((prev) => ({ ...prev, [idx]: true }));
    setVideoPlaying((prev) => ({ ...prev, [idx]: false }));
  };

  // Tap-to-play/pause — pausing also stops the audio (the video element
  // keeps the playhead, unlike the old behavior where tapping only opened
  // the fullscreen modal and sound kept playing behind it).
  const handleTogglePlay = (idx: number) => {
    const video = videoRefs.current[idx];
    if (!video) return;
    if (video.paused || video.ended) {
      if (video.ended) video.currentTime = 0;
      video.play().catch(() => {});
      setVideoEnded((prev) => ({ ...prev, [idx]: false }));
    } else {
      video.pause();
    }
  };

  const handleReplayVideo = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRefs.current[idx];
    if (video) {
      video.currentTime = 0;
      video.play().catch(() => {});
      setVideoEnded((prev) => ({ ...prev, [idx]: false }));
    }
  };

  // Open the fullscreen viewer — always pause the inline video first so it
  // doesn't keep playing (with audio) behind the modal.
  const handleOpenVideoFullscreen = (idx: number, url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRefs.current[idx];
    if (video) video.pause();
    window.dispatchEvent(
      new CustomEvent("openImagePreview", {
        detail: { url, type: "video" as const },
      })
    );
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartXRef.current = touch.clientX;
    touchStartYRef.current = touch.clientY;
    isSwipingRef.current = false;
    swipeOffsetRef.current = 0;
    tapMovedRef.current = false;
    setShowSwipeBadge(false);
    if (swipeBarRef.current) {
      swipeBarRef.current.style.transition = '';
      swipeBarRef.current.style.transform = isMe ? 'translateX(6px)' : 'translateX(-6px)';
      swipeBarRef.current.style.opacity = '0';
    }

    // Deleted messages (for everyone or for me) and UNSENT messages
    // (_pending = sending, _failed = failed) have no actions — never start
    // the long-press menu timer or the swipe-to-reply gesture.
    if (msg.isDeleted || deletedForMe || unsent) return;

    touchTimerRef.current = setTimeout(() => {
      if (!isSwipingRef.current && touch) {
        const msgEl = document.getElementById(`msg-${msg._id}`);
        const msgRect = msgEl?.getBoundingClientRect();
        const x = msgRect ? (isMe ? msgRect.right : msgRect.left) : touch.clientX;
        const y = msgRect ? msgRect.bottom + 4 : touch.clientY;
        handleContextMenu(
          { clientX: x, clientY: y, preventDefault: () => {} } as any,
          msg
        );
      }
    }, 500);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (msg.isDeleted || deletedForMe || unsent) return;
    const touch = e.touches[0];
    if (!touch) return;
    const deltaX = touch.clientX - touchStartXRef.current;
    const deltaY = touch.clientY - touchStartYRef.current;
    if (Math.abs(deltaX) > 12 || Math.abs(deltaY) > 12) {
      tapMovedRef.current = true;
      // Any real movement invalidates a pending double-tap.
      lastTapRef.current = 0;
    }

    if (!isSwipingRef.current && Math.abs(deltaX) > 15 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      isSwipingRef.current = true;
      if (touchTimerRef.current) {
        clearTimeout(touchTimerRef.current);
        touchTimerRef.current = null;
      }
    }

    if (isSwipingRef.current) {
      const maxOffset = 100;
      const offset = isMe
        ? Math.min(Math.max(0, -deltaX), maxOffset)
        : Math.min(Math.max(0, deltaX), maxOffset);
      swipeOffsetRef.current = offset;

      if (swipeBarRef.current) {
        const barX = isMe ? -offset + (offset > 0 ? 6 : 0) : offset - 6;
        swipeBarRef.current.style.transition = 'none';
        swipeBarRef.current.style.transform = `translateX(${barX}px)`;
        swipeBarRef.current.style.opacity = offset > 0 ? '1' : '0';
      }

      if (offset > 20 && !showSwipeBadge) {
        setShowSwipeBadge(true);
      } else if (offset <= 20 && showSwipeBadge) {
        setShowSwipeBadge(false);
      }
    }
  };

  const handleTouchEnd = (e?: React.TouchEvent) => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }

    if (isSwipingRef.current && swipeOffsetRef.current > 60 && onSwipeToReply && !(msg.isDeleted || deletedForMe || unsent)) {
      onSwipeToReply(msg);
      // The reply-swipe owns this touch — stop it bubbling to container-level
      // gestures (e.g. Chat's swipe-between-conversations).
      e?.stopPropagation();
    }

    // Clean tap (no swipe, no scroll) → double-tap to quick-react ❤️,
    // WhatsApp-style. Only for text-only bubbles (media taps open the
    // fullscreen viewer) and never on interactive elements (links, buttons,
    // avatars).
    if (
      !isSwipingRef.current &&
      !tapMovedRef.current &&
      !(msg.attachments && msg.attachments.length > 0) &&
      !(msg.isDeleted || deletedForMe || unsent) &&
      handleReaction
    ) {
      const tapTarget = e?.target as HTMLElement | null;
      const onInteractive =
        !!tapTarget &&
        !!tapTarget.closest("button, a, input, textarea, [role='button']");
      if (!onInteractive) {
        const now = Date.now();
        if (lastTapRef.current && now - lastTapRef.current < 320) {
          lastTapRef.current = 0;
          handleReaction(msg, "❤️");
          hapticLight();
        } else {
          lastTapRef.current = now;
        }
      }
    }

    swipeOffsetRef.current = 0;
    setShowSwipeBadge(false);
    if (swipeBarRef.current) {
      swipeBarRef.current.style.transform = isMe ? 'translateX(6px)' : 'translateX(-6px)';
      swipeBarRef.current.style.opacity = '0';
    }
    isSwipingRef.current = false;
    tapMovedRef.current = false;
    touchStartXRef.current = 0;
    touchStartYRef.current = 0;
  };

  const hasAttachments = msg.attachments && msg.attachments.length > 0;
  const hasOnlyAttachments = hasAttachments && !msg.text && !msg.replyTo;
  const deletedForMe = msg.deletedFor?.includes(userId);
  // Messages still in-flight (optimistic send) or that failed to send have
  // NO actions — long-press/context menus must not open for them.
  const unsent = !!(msg as any)._pending || !!(msg as any)._failed;

  const bubbleRoundClass = isMe
    ? `${isFirstInGroup ? "rounded-tr-none" : "rounded-tr-md"} ${isLastInGroup ? "rounded-br-none" : "rounded-br-md"}`
    : `${isFirstInGroup ? "rounded-tl-none" : "rounded-tl-md"} ${isLastInGroup ? "rounded-bl-none" : "rounded-bl-md"}`;

  // Pin indicator — rendered on the bubble corner when this message is pinned.
  // Group-start bubbles have a CUT corner (rounded-tr-none/tl-none), so the
  // badge sits on the opposite (uncut) corner to never overlap the notch.
  const badgeSide = isMe
    ? isFirstInGroup
      ? "-left-1.5"
      : "-right-1.5"
    : isFirstInGroup
      ? "-right-1.5"
      : "-left-1.5";
  const renderPinBadge = () => (
    <span
      title="Pinned message"
      className={`absolute -top-2 z-10 flex h-4 w-4 items-center justify-center rounded-full shadow-sm ${
        isMe
          ? `${badgeSide} bg-zinc-800 border border-amber-200/60`
          : `${badgeSide} bg-zinc-900 border border-amber-200/60`
      }`}
    >
      <Pin className="h-2 w-2 text-amber-200/90" />
    </span>
  );

  return (
    <div className="w-full flex flex-col select-none">
      {showDateSeparator && (
        <div className="flex justify-center my-3.5 select-none">
          <span className="bg-zinc-900/60 border border-zinc-800/80 text-zinc-400 text-[10px] px-2.5 py-0.5 rounded-full font-bold shadow-sm uppercase tracking-wide">
            {dateSeparatorText}
          </span>
        </div>
      )}

      {showTimeHeader && !showDateSeparator && (
        <div className="flex justify-center mt-2.5 mb-1 select-none">
          <span className="text-zinc-550 text-[9px] font-bold tracking-widest uppercase">
            {formatMessageTime(msg.createdAt)}
          </span>
        </div>
      )}

      <div
        id={`msg-${msg._id}`}
        className={`relative flex gap-3 max-w-[85%] group/bubble ${
          isMe ? "ml-auto flex-row-reverse" : "mr-auto"
        } ${isFirstInGroup ? "mt-2.5" : "mt-0.5"}`}
        onContextMenu={(e) => {
          // Deleted and unsent messages have no actions — suppress both our
          // custom menu and the native browser context menu.
          if (msg.isDeleted || deletedForMe || unsent) {
            e.preventDefault();
            return;
          }
          handleContextMenu(e, msg);
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={(e) => handleTouchEnd(e)}
        onTouchMove={handleTouchMove}
      >
        <div
          ref={swipeBarRef}
          className={`absolute inset-y-0 w-1.5 bg-white/30 pointer-events-none ${isMe ? "right-0 rounded-l-full rounded-r-none" : "left-0 rounded-r-full"}`}
          style={{ transform: isMe ? 'translateX(6px)' : 'translateX(-6px)', opacity: 0, transition: 'transform 200ms ease-out, opacity 200ms ease-out' }}
        />

        {!isMe && (
          <div className="w-8 shrink-0 flex items-end">
            {isLastInGroup ? (
              <UserAvatar
                src={msg.sender.profilePic?.url}
                alt={msg.sender.fullName}
                className="h-7 w-7 rounded-full object-cover border border-zinc-800"
              />
            ) : (
              <div className="w-7" />
            )}
          </div>
        )}

        <div className={`space-y-0.5 text-left flex flex-col ${isMe ? "items-end" : "items-start"}`}>
          {!isMe && isFirstInGroup && (
            <span className="text-[9px] text-zinc-500 font-bold mb-0.5 pl-1 select-none inline-flex items-center gap-1">
              {msg.sender.fullName}
              {(msg.sender as any).isVerified && (
                <VerifiedBadge className="h-2.5 w-2.5" />
              )}
            </span>
          )}

          <div
            data-msg-bubble="true"
            className={`rounded-2xl text-[12px] border relative select-none ${bubbleRoundClass} ${
              isPinned ? "border-amber-200/40" : ""
            } ${hasOnlyAttachments ? "p-1 pb-1 pt-3" : "px-3 py-1.5"} ${
			  isMe
				? "bg-gradient-to-br from-[#241438] via-[#171026] to-[#0c0b11] text-zinc-100 border-violet-500/20 shadow-md shadow-black/30"
				: "bg-gradient-to-br from-zinc-800/90 to-zinc-900/95 text-zinc-100 border-zinc-700/60 shadow-md shadow-black/20"
            }`}
          >
            {isPinned && !msg.isDeleted && renderPinBadge()}
            {msg.isDeleted || deletedForMe ? (
              <span className="italic text-zinc-500 text-[12px] md:text-sm">This message was deleted</span>
            ) : (
              <>
                {msg.forwardedFrom && (
                  <div className="mb-1.5 flex items-center gap-1">
                    <svg className="h-3 w-3 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17 2l4 4-4 4" />
                      <path d="M3 11v-1a4 4 0 014-4h14" />
                    </svg>
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                      Forwarded
                    </span>
                  </div>
                )}
                {msg.replyTo && (
                  <div
                    className="flex items-start gap-2 mb-2 pb-2 border-l-2 border-zinc-500/40 pl-2.5 cursor-pointer hover:bg-zinc-800/30 rounded-r-lg -ml-0.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (msg.replyTo?._id) popMessageBubble(msg.replyTo._id);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-black text-zinc-300 uppercase tracking-wider leading-tight">
                        {msg.replyTo.sender.fullName}
                      </p>
                      <p className="text-[12px] md:text-sm text-zinc-400 truncate leading-relaxed mt-0.5">
                        {msg.replyTo.text || (msg.replyTo.attachments && msg.replyTo.attachments.length > 0 ? getAttachmentLabel(msg.replyTo.attachments) : "")}
                      </p>
                    </div>
                    <CornerDownLeft className="h-3 w-3 text-zinc-500 shrink-0 mt-1" />
                  </div>
                )}
                {msg.text && (
                  <TranslateInline
                    text={msg.text}
                    eventId={msg._id}
                    hideToggle
                    className="!items-start"
                    render={(t) => (
                      <p className="leading-relaxed whitespace-pre-wrap select-none break-word pr-1.5">
                        {renderLinkifiedText(t, (seg) =>
                          renderHashtagTags(seg, undefined, (seg2) =>
                            renderMentionTags(seg2, onUserClick),
                          ),
                        )}
                        {msg.isEdited && (
                          <span className="text-[10px] text-zinc-400 italic ml-1">(edited)</span>
                        )}
                      </p>
                    )}
                  />
                )}
                {msg.text && !unsent && extractFirstUrl(msg.text) && (
                  <div className={`mt-1.5 ${msg.attachments && msg.attachments.length > 0 ? "mb-1.5" : ""}`}>
                    <LinkPreviewCard url={extractFirstUrl(msg.text)!} compact />
                  </div>
                )}
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className={`${msg.text ? "mt-1.5" : ""} space-y-1 max-w-sm rounded-xl overflow-hidden`}>
                    {msg.attachments.map((att, aIdx) => {
                      const isAttachmentDisabled = !!(msg._pending || msg._failed);
                      if (att.type === "voice_note") {
                        return (
                          <VoiceNotePlayer
                            key={aIdx}
                            url={att.url}
                            isMe={isMe}
                            initialDuration={att.duration}
                            disabled={isAttachmentDisabled}
                          />
                        );
                      } else if (att.type === "video") {
                        return (
                          <div
                            key={aIdx}
                            className={`relative overflow-hidden rounded-lg border border-zinc-800 bg-black ${
                              isAttachmentDisabled
                                ? "pointer-events-none opacity-40 select-none"
                                : "cursor-pointer"
                            }`}
                            onClick={(e) => {
                              // Tap the video to play/pause it — pausing also
                              // stops the audio. Use the fullscreen button to
                              // open the zoomed viewer.
                              if (isAttachmentDisabled) return;
                              e.stopPropagation();
                              handleTogglePlay(aIdx);
                            }}
                            title="Play / pause"
                          >
                            <div className="relative">
                              {/* Chat videos start PAUSED — no auto-play. Tap to
                                  play, tap again (or the pause button) to stop. */}
                              <video
                                ref={(el) => { videoRefs.current[aIdx] = el; }}
                                preload="metadata"
                                className="w-full h-auto max-h-60 object-contain"
                                src={att.url}
                                muted={videoMuted[aIdx] ?? true}
                                playsInline
                                loop={false}
                                onEnded={() => handleVideoEnded(aIdx)}
                                onPlay={() => setVideoPlaying((prev) => ({ ...prev, [aIdx]: true }))}
                                onPause={() => setVideoPlaying((prev) => ({ ...prev, [aIdx]: false }))}
                              />
                              {/* Play overlay while paused — sent videos only.
                                  Excludes ended videos (the replay overlay below
                                  takes over that state, so they never stack). */}
                              {!isAttachmentDisabled &&
                                !videoPlaying[aIdx] &&
                                !videoEnded[aIdx] && (
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                                  <div className="rounded-full bg-black/50 p-3 backdrop-blur-sm">
                                    <Play className="h-6 w-6 text-white fill-white" />
                                  </div>
                                </div>
                              )}
                              {/* Mute toggle + fullscreen — only after the video
                                  has actually been sent (no controls on pending
                                  or failed bubbles). */}
                              {!isAttachmentDisabled && (
                                <>
                                  <button
                                    onClick={(e) => handleToggleMute(aIdx, e)}
                                    className="absolute bottom-3 left-3 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white transition-all cursor-pointer"
                                    title={videoMuted[aIdx] ? "Unmute" : "Mute"}
                                  >
                                    {videoMuted[aIdx] ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                                  </button>
                                  <button
                                    onClick={(e) => handleOpenVideoFullscreen(aIdx, att.url, e)}
                                    className="absolute bottom-3 right-3 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white transition-all cursor-pointer"
                                    title="Open fullscreen"
                                  >
                                    <Maximize2 className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                              {/* Replay overlay when the video ended */}
                              {!isAttachmentDisabled && videoEnded[aIdx] && (
                                <div
                                  className="absolute inset-0 flex items-center justify-center bg-black/30 cursor-pointer z-10"
                                  onClick={(e) => handleReplayVideo(aIdx, e)}
                                >
                                  <div className="rounded-full bg-white/20 p-3 backdrop-blur-sm hover:bg-white/30 transition-all">
                                    <Play className="h-6 w-6 text-white fill-white" />
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      } else if (att.type === "file") {
                        return (
                          <FileAttachmentCard
                            key={aIdx}
                            attachment={att}
                            disabled={isAttachmentDisabled}
                            isMe={isMe}
                          />
                        );
                      } else {
                        // Images — open preview on click (original behavior)
                        return (
                          <div
                            key={aIdx}
                            className={`relative overflow-hidden rounded-lg border border-zinc-800/40 ${
                              isAttachmentDisabled
                                ? "opacity-40 cursor-not-allowed pointer-events-none select-none"
                                : "cursor-pointer"
                            }`}
                            onClick={(e) => {
                              if (isAttachmentDisabled) return;
                              e.stopPropagation();
                              window.dispatchEvent(
                                new CustomEvent("openImagePreview", {
                                  detail: att.url,
                                })
                              );
                            }}
                          >
                            <img loading="lazy"
                              src={optimizeImageUrl(att.url, 800)}
                              alt={`Attachment from ${msg.sender.fullName}`}
                              className="w-full h-auto max-h-60 object-cover"
                              draggable={false}
                            />
                          </div>
                        );
                      }
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {!msg.isDeleted && !deletedForMe && !unsent && (
            <div className="flex items-center gap-1 mt-0.5">
              {Object.entries(groupedReactions).map(([emoji, data]) => (
                <button
                  key={emoji}
                  onClick={() => handleReaction(msg, emoji)}
                  className={`flex items-center gap-0.5 px-1.5 py-px rounded-full text-[11px] md:text-[12px] border transition-colors cursor-pointer ${
                    data.hasReacted
                      ? "bg-white/10 border-white/20 text-white"
                      : "bg-white/3 border-white/5 text-zinc-400 hover:bg-white/5"
                  }`}
                >
                  <span>{emoji}</span>
                  {!hideReactionCount && (
                    <span className="text-[8px] font-bold">{data.count}</span>
                  )}
                </button>
              ))}
            </div>
          )}			  {isLastInGroup && (
			    <div className="flex items-center gap-1 px-1 text-[9px] font-bold text-zinc-550 select-none">
			      <span>{formatMessageTime(msg.createdAt)}</span>
			      {isMe && (
			        <span
			          title={
			            (msg as any)._pending || (msg as any)._failed
			              ? undefined
			              : isScheduled(msg)
			                ? `Scheduled for ${new Date((msg as any).scheduledAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
			                : msg.seen && msg.seenAt
			                  ? `Seen at ${new Date(msg.seenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
			                  : msg.seen
			                    ? 'Seen'
			                    : msg.deliveredAt
			                      ? `Delivered at ${new Date(msg.deliveredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
			                      : 'Sent'
			          }
			        >
			          {(msg as any)._pending ? (
			            // Sending — spinner sits exactly where the tick will land,
			            // then flips straight to the grey/blue tick on confirmation.
			            <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
			          ) : (msg as any)._failed ? (
			            null
			          ) : isScheduled(msg) ? (
			            // WhatsApp/IG-style scheduled chip — a clock glyph until
			            // the BullMQ job flips scheduledAt to null at delivery.
			            <Clock className="h-3 w-3 text-sky-300" />
			          ) : msg.seen ? (
			            // Literal hex, NOT text-sky-400: the app's theme remaps
			            // the whole sky- palette to greys (monochrome design), so
			            // text-sky-400 renders white — the read receipt never
			            // looked blue. A raw hex bypasses the remap entirely.
			            <CustomCheckCheck className="h-4 w-5 text-[#38bdf8]" />
			          ) : (
			            <CustomCheck className="h-4 w-4 text-zinc-550" />
			          )}
			        </span>
			      )}
			    </div>
			  )}

          {msg._pending && ((msg as any)._queued || isOnline === false) && (
            // Queued while offline — WhatsApp clock state. The message is
            // parked and will send automatically when connectivity returns;
            // no spinner (it is NOT uploading), no cancel (it is not stuck).
            <div className={`flex flex-col gap-1 text-[10px] text-zinc-400 font-bold mt-1 select-none ${isMe ? 'items-end' : 'items-start'}`}>
              <span className="flex items-center gap-1.5">
                <Clock className="h-3 w-3" />
                Waiting for connection
              </span>
            </div>
          )}

          {msg._failed && (
            <div className={`flex items-center gap-1.5 text-[10px] text-red-500 font-bold mt-1 select-none ${isMe ? 'justify-end' : 'justify-start'}`}>
              <AlertCircle className="h-3 w-3 shrink-0" />
              <span>Failed to send</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRetrySend?.(msg._id);
                }}
                className="text-[10px] underline hover:text-red-400 cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}
        </div>

        <div
          className={`absolute top-1/2 -translate-y-1/2 text-[10px] font-bold text-zinc-550 opacity-0 group-hover/bubble:opacity-100 transition-opacity duration-150 pointer-events-none select-none hidden md:block whitespace-nowrap ${
            isMe ? "left-[-60px]" : "right-[-60px]"
          }`}
        >
          {formatMessageTime(msg.createdAt)}
        </div>
      </div>
    </div>
  );
}, arePropsEqual);

// ─── Voice Note Player ──────────────────────────────────────────

// Module-level manager that ensures only one voice note plays at a time.
// Intentionally module-scoped (not React state or ref) because it needs to
// synchronize across all VoiceNotePlayer instances without re-renders.
const voiceNoteManager = {
  player: null as { audio: HTMLAudioElement; reset: () => void; } | null,
  stopCurrent() {
    if (this.player) {
      this.player.audio.pause();
      this.player.reset();
      this.player = null;
    }
  },
  setPlayer(player: { audio: HTMLAudioElement; reset: () => void }) {
    if (this.player && this.player.audio !== player.audio) {
      this.stopCurrent();
    }
    this.player = player;
  },
  clear() {
    this.player = null;
  }
};

function getPlayableUrl(originalUrl: string): string {
  if (!originalUrl.includes("cloudinary.com")) return originalUrl;
  const pathname = originalUrl.split("?")[0];
  const ext = pathname.split(".").pop()?.toLowerCase() || "";
  const universallyPlayable = ["mp3", "m4a", "aac", "wav"];
  if (universallyPlayable.includes(ext)) return originalUrl;
  if (originalUrl.includes("/video/upload/f_")) return originalUrl;
  return originalUrl.replace(
    /(\/video\/upload\/)(.*)/,
    "$1f_mp3/$2"
  );
}

function VoiceNotePlayer({ url, isMe, initialDuration, disabled }: { url: string; isMe: boolean; initialDuration?: number; disabled?: boolean }) {
  const playableUrl = getPlayableUrl(url);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration || 0);
  const [hasError, setHasError] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  
  const safeDuration = duration && isFinite(duration) && duration > 0 
    ? duration 
    : (initialDuration && isFinite(initialDuration) && initialDuration > 0 ? initialDuration : 0);

  const togglePlay = () => {
    if (disabled) return;
    const audio = audioRef.current;
    if (!audio) return;

    if (playing) {
      audio.pause();
      setPlaying(false);
      if (voiceNoteManager.player?.audio === audio) {
        voiceNoteManager.clear();
      }
    } else {
      voiceNoteManager.setPlayer({
        audio,
        reset: () => {
          setPlaying(false);
          setCurrentTime(0);
        },
      });
      if (audio.currentTime >= (audio.duration || safeDuration) || audio.currentTime === 0) {
        audio.currentTime = 0;
        setCurrentTime(0);
      }
      if (duration === 0 && url.startsWith("blob:")) {
        audio.preload = "auto";
        audio.load();
      }
      audio.play().catch(() => {
        setHasError(true);
      });
      setPlaying(true);
      setHasError(false);
    }
  };

  const formatTime = (s: number) => {
    if (!isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const handleRetry = () => {
    setHasError(false);
    setDuration(0);
    if (audioRef.current) {
      audioRef.current.load();
    }
  };

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (safeDuration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const clickPercent = Math.max(0, Math.min(clickX / width, 1));
    const targetTime = clickPercent * safeDuration;
    if (audioRef.current) {
      audioRef.current.currentTime = targetTime;
      setCurrentTime(targetTime);
    }
  };

  if (hasError) {
    return (
      <div className={`flex items-center gap-2 py-1.5 px-1 min-w-[160px] ${isMe ? "flex-row" : "flex-row"}`}>
      <button
        onClick={handleRetry}
        className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition-all cursor-pointer bg-red-500/20 hover:bg-red-500/30"
        title="Retry loading"
      >
        <Play className="h-3.5 w-3.5 text-red-400 ml-0.5" />
      </button>
      <span className="text-[10px] text-red-400/60 font-mono">Failed to load</span>
      <audio
        ref={audioRef}
        src={playableUrl}
        preload="none"
          onLoadedMetadata={() => {
            if (audioRef.current) setDuration(audioRef.current.duration);
            setHasError(false);
          }}
          onError={() => setHasError(true)}
        />
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2.5 py-1.5 px-1 min-w-[160px] ${isMe ? "flex-row" : "flex-row"}`}>
      <button
        onClick={togglePlay}
        disabled={disabled}
        className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition-all ${
          disabled
            ? "bg-white/5 opacity-30 cursor-not-allowed pointer-events-none"
            :              playing
                ? "bg-white/30 cursor-pointer"
                : "bg-white/10 hover:bg-white/20 cursor-pointer"
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        {playing ? <Pause className="h-3.5 w-3.5 text-white" /> : <Play className="h-3.5 w-3.5 text-white ml-0.5" />}
      </button>
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <div 
          onClick={disabled ? undefined : handleProgressBarClick}
          className={`flex-1 h-1.5 bg-white/15 rounded-full overflow-hidden relative ${disabled ? 'cursor-not-allowed pointer-events-none opacity-50' : 'cursor-pointer'}`}
        >
          <div
            ref={progressRef}
            className="h-full rounded-full transition-all duration-150"
            style={{
              width: `${safeDuration > 0 ? Math.min((currentTime / safeDuration) * 100, 100) : 0}%`,
              backgroundColor: isMe ? "rgba(255,255,255,0.6)" : "rgba(99,102,241,0.6)",
            }}
          />
        </div>
        <span className="text-[10px] font-mono text-zinc-400 tabular-nums shrink-0">
          {safeDuration === 0 && !playing ? (
            <span className="text-zinc-600">--:--</span>
          ) : playing ? (
            formatTime(currentTime)
          ) : (
            formatTime(safeDuration)
          )}
        </span>
      </div>
      <audio
        ref={audioRef}
        src={playableUrl}
        preload={url.startsWith("blob:") ? "auto" : "metadata"}
        onLoadedMetadata={() => {
          if (audioRef.current) {
            const d = audioRef.current.duration;
            if (isFinite(d) && d > 0) {
              setDuration(d);
              setHasError(false);
            }
          }
        }}
        onTimeUpdate={() => {
          if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
        }}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(safeDuration);
          if (voiceNoteManager.player?.audio === audioRef.current) {
            voiceNoteManager.clear();
          }
        }}
        onError={() => {
          setHasError(true);
        }}
      />
    </div>
  );
}

export default MessageBubble;

// swipe right on message reveals reply button with quote preview

// swipe right on message reveals reply button with quote preview
