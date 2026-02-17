import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Lock,
  Hourglass,
  Link2,
  LogIn,
  Hash,
  Users,
  Plus,
  ArrowLeft,
  ArrowRight,
  Send,
  Image,
  CornerDownLeft,
  ChevronsLeft,
  ChevronsRight,
  X,
  Trash2,
  Edit3,
  Loader2,
  MessageSquare,
  AlertCircle,
  Pin,
  PinOff,
  Search,
  Copy,
  Download,
  Share2,
  Mic,
  Play,
  Pause,
  Square,
  ChevronDown,
  Phone,
  Video,
  MoreVertical,
  LogOut,
  Bell,
  BellOff,
  Languages,
  WifiOff,
  Megaphone,
  Star,
  Vote,
  Sparkles,
  Timer,
  Info,
  BarChart3,
} from "lucide-react";

// Read-receipt check marks (mirrors MessageBubble's private copies + the
// personal-chat Message info panel). Community chat uses the same ✓ → ✓✓
// → blue-✓✓ language: single check = sent, double = delivered to the room,
// blue double = seen by at least one member.
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

/**
 * Poll card — rendered under a community message that carries a poll.
 * Shows the question, per-option vote counts + progress bars, and tap-to-
 * vote toggling (single-choice moves the vote, multi-choice toggles).
 */
function CommunityPollCard({
  msg,
  userId,
  onVote,
}: {
  msg: CommunityMessage;
  userId: string;
  onVote: (msg: CommunityMessage, optionIndex: number) => void;
}) {
  const poll = msg.poll;
  if (!poll) return null;
  const ended =
    !!poll.endsAt && new Date(poll.endsAt).getTime() < Date.now();
  const myChoiceIndex = poll.options.findIndex((o) =>
    o.voters?.includes(userId),
  );

  // Poll result privacy (hideResults): "vote" hides counts until THIS viewer
  // votes; "end" hides until endsAt passes. Mask the counts for the card
  // regardless of the data source (GET, socket, search, optimistic) — the
  // render is the single gate.
  const hideCounts =
    !!poll.hideResults &&
    !ended &&
    (poll.hideResults === "end" || myChoiceIndex === -1);
  const totalVotes = hideCounts
    ? 0
    : poll.options.reduce((sum, o) => sum + (o.voters?.length || 0), 0);

  return (
    <div className="mx-auto my-1.5 w-full max-w-[85%] md:max-w-[440px] rounded-2xl border border-zinc-800 bg-zinc-900/80 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Vote className="h-3 w-3 text-zinc-500 shrink-0" />
        <p className="text-[11px] font-bold text-zinc-100">
          {poll.question || "Poll"}
        </p>
      </div>
      {poll.options.map((opt, i) => {
        const count = opt.voters?.length || 0;
        const pct = totalVotes ? Math.round((count / totalVotes) * 100) : 0;
        const myPick = myChoiceIndex === i;
        return (
          <button
            key={i}
            disabled={ended}
            onClick={() => onVote(msg, i)}
            className={`relative w-full mb-1.5 overflow-hidden rounded-xl border px-3 py-2 text-left transition-all ${
              ended
                ? "cursor-default"
                : "cursor-pointer hover:border-zinc-500"
            } ${
              myPick
                ? "border-aurora/60 bg-aurora/10"
                : "border-zinc-700/60 bg-zinc-950/40"
            }`}
            title={
              ended ? "Poll ended" : myPick ? "Tap to remove your vote" : "Vote"
            }
          >
            {!hideCounts && (
              <div
                className="absolute inset-y-0 left-0 bg-white/5 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            )}
            <div className="relative flex items-center justify-between gap-2">
              <span
                className={`truncate text-[11px] font-semibold ${
                  myPick ? "text-aurora" : "text-zinc-200"
                }`}
              >
                {opt.text}
              </span>
              {!hideCounts && (
                <span className="shrink-0 text-[9px] font-bold text-zinc-400 tabular-nums">
                  {pct}% · {count}
                </span>
              )}
            </div>
          </button>
        );
      })}
      <p className="mt-1 text-[9px] font-semibold text-zinc-500">
        {ended
          ? "Poll ended"
          : hideCounts
            ? poll.hideResults === "end"
              ? "Results hidden until the poll ends"
              : myChoiceIndex === -1
                ? "Vote to see results"
                : `${totalVotes} vote${totalVotes === 1 ? "" : "s"}${
                    poll.allowMultiple ? " · multiple choice" : ""
                  }`
            : `${totalVotes} vote${totalVotes === 1 ? "" : "s"}${
                poll.allowMultiple ? " · multiple choice" : ""
              }`}
      </p>
    </div>
  );
}
import type { Community, CommunityMessage, Conversation } from "../types";

/**
 * Replace a pending placeholder IN PLACE with its confirmed server copy so
 * queued messages keep their send order. A filter+append would push the
 * confirmed message past later pendings — showing those not-yet-sent
 * messages ABOVE the first sent one until every message confirms and the
 * order "fixes itself".
 */
const replacePendingWithSent = (
	prev: CommunityMessage[],
	pendingId: string,
	sentMessage: any,
): CommunityMessage[] => {
	if (prev.some((m) => m._id === sentMessage?._id)) {
		return prev.filter((m) => m._id !== pendingId);
	}
	const idx = prev.findIndex((m) => m._id === pendingId);
	if (idx === -1) return [...prev, sentMessage];
	const next = [...prev];
	next[idx] = sentMessage;
	return next;
};
import { apiFetch, uploadWithProgress } from "../utils/api";
import { getCachedResponse, evictCachedResponse } from "../utils/apiCache";
import { getOfflineFallback } from "../utils/dexieBridge";
import { useCacheRefresh } from "../hooks/useCacheRefresh";
import { useKeyboardOpen } from "../hooks/useKeyboardOpen";
import { useLenisScroll } from "../hooks/useLenisScroll";
import { logger } from "../utils/logger";
import { downscaleImageFile } from "../utils/imageCompression";
import { optimizeImageUrl } from "../utils/imageUrls";
import { popMessageBubble } from "../utils/messageHighlight";
import { downloadAttachment } from "../utils/downloads";
import { matchesSearchTokens } from "../utils/searchMatch";
import {
	getVisibleViewport,
	useMenuViewportClamp,
} from "../utils/menuPositioning";

// Stable RegExp for matching community cache refresh events
// — module-level to prevent React effect re-attachment on every render.
const MATCHER_COMMUNITIES = /\/api\/communities/;
import MessageBubble from "./MessageBubble";
import CallSystemMessage from "./CallSystemMessage";
import MentionSuggestions from "./MentionSuggestions";
import { useMentionAutocomplete } from "../hooks/useMentionAutocomplete";
import EmojiReactionMenu from "./EmojiReactionMenu";
import CommunityLastActivity from "./CommunityLastActivity";
import GlassCard from "./GlassCard";
import ConfirmDialog from "./ConfirmDialog";

// ─── On-demand code splitting ──────────────────────────────────────────
// These are only rendered when their feature is opened (file picker, crop
// modal, community settings/profile overlays, group calls). Eager imports
// bloated the Communities chunk to ~730 kB (189 kB gzip) — LiveKit alone is
// the single heaviest dependency in the app. Lazy-loading splits them into
// separate chunks fetched only on first use.
const ChatGallery = React.lazy(() => import("./ChatGallery"));
const CreateCommunityModal = React.lazy(
  () => import("./CreateCommunityModal"),
);
const CommunitySettingsPage = React.lazy(
  () => import("./CommunitySettingsPage"),
);
const CommunityProfileOverlay = React.lazy(
  () => import("./CommunityProfileOverlay"),
);
const ImageCropModal = React.lazy(() => import("./ImageCropModal"));
const GroupCallFloor = React.lazy(() => import("./GroupCallFloor"));

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB — matches uploadChatMedia backend limit

interface CommunitiesProps {
  user: {
    _id: string;
    username: string;
    fullName: string;
    profilePic?: { url: string; public_id?: string };
  };
  socket: any;
  onUserSelected?: (username: string) => void;
  onCommunityChatChange?: (isOpen: boolean) => void;
  /** Reports the currently-open community id (null when on the list). */
  onCommunityOpenChange?: (id: string | null) => void;
  /** Deep-link: when set (non-null), auto-open this community's chat. */
  openCommunityId?: string | null;
}

export default function Communities({
  user,
  socket,
  onUserSelected,
  onCommunityChatChange,
  openCommunityId,
  onCommunityOpenChange,
}: CommunitiesProps) {
  const userId = user._id;

  // ─── Permission helpers (mirror the server-side role checks) ───
  const myRole = (c: Community | null): string => {
    if (!c) return "member";
    if (c.userRole) return c.userRole;
    if (c.creator?._id === userId) return "creator";
    if ((c.admins || []).includes(userId)) return "admin";
    return "member";
  };
  const canPost = (c: Community | null): boolean => {
    const role = myRole(c);
    if (role === "creator" || role === "admin") return true;
    const gate = c?.whoCanPost || "everyone";
    if (gate === "everyone") return true;
    if (gate === "moderators") return role === "moderator";
    return false; // admins only
  };
  const canUploadMedia = (c: Community | null): boolean => {
    const role = myRole(c);
    if (role === "creator" || role === "admin") return true;
    const gate = c?.whoCanUploadMedia || "everyone";
    if (gate === "everyone") return true;
    if (gate === "moderators") return role === "moderator";
    return false; // admins only
  };
  const isModeratorOf = (c: Community | null): boolean =>
    ["creator", "admin", "moderator"].includes(myRole(c));

  const [view, setView] = useState<"list" | "chat" | "profile" | "settings">("list");
  const [selectedCommunity, setSelectedCommunity] = useState<Community | null>(null);

  // Welcome-message card — shown once per session when the community has a
  // welcomeMessage set (WhatsApp-style "Welcome to the group" card).
  const [showWelcomeCard, setShowWelcomeCard] = useState(false);
  useEffect(() => {
    if (selectedCommunity?.welcomeMessage?.trim()) {
      setShowWelcomeCard(true);
    } else {
      setShowWelcomeCard(false);
    }
  }, [selectedCommunity?._id, selectedCommunity?.welcomeMessage]);
  const [myCommunities, setMyCommunities] = useState<Community[]>([]);
  const [allCommunities, setAllCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [communityTab, setCommunityTab] = useState<"mine" | "browse">("mine");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  // Join a private community by invite code
  const [inviteCodeInput, setInviteCodeInput] = useState("");
  const [joiningInvite, setJoiningInvite] = useState(false);
  // Deep-link invite code (?invite=<code>) — carried in a ref because the
  // join handler reads state asynchronously and must not miss it.
  const pendingInviteCodeRef = useRef("");

  // Chat state
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  // Real upload progress for pending media sends (pendingId -> 0-100).
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  // Prune progress entries once a pending message resolves/removes so the
  // map stays tidy (and the bar disappears with the pending bubble).
  useEffect(() => {
    setUploadProgress((prev) => {
      const pendingIds = new Set(
        messages.filter((m) => (m as any)._pending).map((m) => m._id),
      );
      let changed = false;
      const next: Record<string, number> = {};
      for (const k of Object.keys(prev)) {
        if (pendingIds.has(k)) {
          next[k] = prev[k];
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [messages]);

  // Number of messages currently sending or queued (pending/queued bubbles).
  // Mirrors Chat.tsx's pendingMessageIds.size — drives the mic/send button
  // swap so the composer behaves identically in both chats.
  const pendingSendCount = messages.filter(
    (m) => (m as any)._pending || (m as any)._queued,
  ).length;
  const [showPinnedPanel, setShowPinnedPanel] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState("");
  // Synchronous mirror of the composer text (Chat.tsx inputTextRef pattern) —
  // lets the submit handler read + clear it immediately so a rapid
  // double-submit (Enter + click) can never send the same message twice.
  const messageInputRef = useRef("");
  messageInputRef.current = messageInput;

  // Poll composer (Discord/WhatsApp-style) — users create polls from the
  // composer instead of only bots. `pollDraft` holds the in-progress poll;
  // on submit it's sent as a message with the poll attached.
  const [pollComposerOpen, setPollComposerOpen] = useState(false);
  const [pollSubmitting, setPollSubmitting] = useState(false);
  const [pollDraft, setPollDraft] = useState<{
    question: string;
    options: string[];
    allowMultiple: boolean;
    durationMinutes: number | null;
    hideResults: null | "vote" | "end";
  }>({ question: "", options: ["", ""], allowMultiple: false, durationMinutes: null, hideResults: null });

  // @mention autocomplete (community composer) — members-only source so
  // only community members can be mentioned (Instagram/X behavior). The
  // member list comes from the members endpoint and is filtered client-
  // side by username/fullName prefix.
  // Cached community members for @mention suggestions. `fetchedAt` marks
  // when the list was last pulled so the mention flow can refresh it after a
  // minute (see fetchCandidates) — new joiners become mentionable quickly
  // without a full reload.
  const mentionMemberListRef = useRef<any[]>([]);
  const mentionCommunityIdRef = useRef<string | null>(null);
  // Reset the member cache when switching communities so mentions never
  // suggest members from the previously opened community.
  if (mentionCommunityIdRef.current !== (selectedCommunity?._id ?? null)) {
    mentionCommunityIdRef.current = selectedCommunity?._id ?? null;
    mentionMemberListRef.current = [];
  }
  const {
    showMentionDropdown,
    candidateUsers: mentionCandidates,
    handleMentionChange,
    selectMentionCandidate,
    closeMentionDropdown,
  } = useMentionAutocomplete({
    value: messageInput,
    setValue: setMessageInput,
    fetchCandidates: async (q: string) => {
      const communityId = selectedCommunity?._id;
      if (!communityId) return [];
      // Refresh the member cache lazily (debounced by the hook) so new
      // joiners are mentionable without a full reload. Staleness is the ONLY
      // trigger: re-fetch when we have no timestamp or the copy is older than
      // a minute. The timestamp is stamped even for empty results, so an
      // empty (or freshly-synced) member list is NOT refetched on every @
      // keystroke.
      const fetchedAt = (mentionMemberListRef.current as any)
        .fetchedAt as number | undefined;
      const cacheAge =
        typeof fetchedAt === "number" ? Date.now() - fetchedAt : Infinity;
      if (cacheAge > 60_000) {
        try {
          const res = await apiFetch(
            `/api/communities/${communityId}/members`,
          );
          const data = await res.json();
          if (res.ok && data.success) {
            mentionMemberListRef.current = (data.members || [])
              .map((m: any) => m?.user)
              .filter(Boolean);
            (mentionMemberListRef.current as any).fetchedAt = Date.now();
          }
        } catch (err) {
          logger.error("Failed to load members for mention", err);
        }
      }
      const ql = q.toLowerCase();
      // @everyone — Discord/Telegram-style "ping the whole room" option.
      // Only surfaces when the query is empty or starts with "everyo" so it
      // never crowds out real member matches.
      const everyoneOption = ql.length === 0 || "everyone".startsWith(ql)
        ? [
            {
              _id: "@everyone",
              username: "everyone",
              fullName: "Everyone",
              profilePic: null,
            },
          ]
        : [];
      return [
        ...everyoneOption,
        ...mentionMemberListRef.current
          .filter(
            (u: any) =>
              matchesSearchTokens(u.username, q) ||
              matchesSearchTokens(u.fullName || "", q),
          )
          .slice(0, 8)
          .map((u: any) => ({
            _id: u._id,
            username: u.username,
            fullName: u.fullName,
            profilePic: u.profilePic,
          })),
      ];
    },
  });
  const mentionDropdownRef = useRef<HTMLDivElement>(null);
  // Network connectivity — drives the offline banner + queued-vs-sending
  // clock state on pending bubbles, and auto-retries queued sends online.
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<string[]>([]);
  const [replyTo, setReplyTo] = useState<CommunityMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<CommunityMessage | null>(null);
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    message: CommunityMessage;
  } | null>(null);
  // Message info panel — WhatsApp-style Sent / Delivered / Seen-by-N for an
  // outgoing community message (mirrors the personal-chat panel).
  const [messageInfo, setMessageInfo] = useState<CommunityMessage | null>(null);
  // Resolved "Seen by" member profiles for the open Message info panel
  // (WhatsApp-group style: names + avatars, not just a count).
  const [messageInfoSeenBy, setMessageInfoSeenBy] = useState<
    {
      _id: string;
      username: string;
      fullName?: string;
      profilePic?: { url: string };
    }[]
  >([]);
  const [sendingError, setSendingError] = useState<string | null>(null);
  // Discord-style slowmode countdown: when a send is rejected, the composer
  // disables with a live "try again in Xs" countdown and AUTO-RETRIES the
  // queued message the moment the window elapses — no manual resend needed.
  const [slowmodeUntil, setSlowmodeUntil] = useState<number | null>(null);
  const [slowmodeNow, setSlowmodeNow] = useState(0);
  const slowmodeRetryPendingRef = useRef<string | null>(null);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [confirmClearForMeOpen, setConfirmClearForMeOpen] = useState(false);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  // Community being left from the "My Communities" list row (header leave uses selectedCommunity)
  const [pendingLeaveCommunityId, setPendingLeaveCommunityId] = useState<string | null>(null);
  // Long-press / right-click context menu for "My Communities" list rows (mute / leave)
  const [communityMenu, setCommunityMenu] = useState<{
    x: number;
    y: number;
    community: Community;
  } | null>(null);

  // Unsent-send infrastructure (matching personal Chat.tsx): every optimistic
  // send stores its payload here so a network blip can keep the bubble as
  // "queued" (clock) and retry it automatically on reconnect — including
  // text/media messages, not just voice notes.
  const activeUploadsRef = useRef<Record<string, AbortController>>({});
  const unsentPayloadsRef = useRef<Record<
    string,
    | {
        type: "voice_note";
        blob: Blob;
        url: string;
        duration: number;
        replyToId?: string;
        room?: string | null;
      }
    | {
        type: "message";
        text: string;
        files: File[];
        previews: string[];
        replyToId?: string;
        room?: string | null;
        scheduledAt?: string;
        fileDownscaled?: boolean;
      }
  >>({});

  // Scheduled send (WhatsApp/IG-style): null = send now; a Date means the
  // message is stored now and delivered at that time. Mirrors Chat.tsx.
  const [schedulePickerOpen, setSchedulePickerOpen] = useState(false);
  const [scheduledFor, setScheduledFor] = useState<Date | null>(null);

  // Voice note recording state
  const [isRecording, setIsRecording] = useState(false);

  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shouldSendAfterRecordRef = useRef(false);
  const recordingDurationRef = useRef(0);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);

  const [leavingCommunity, setLeavingCommunity] = useState(false);
  const [joiningCommunities, setJoiningCommunities] = useState<Set<string>>(new Set());
  const [pinnedMessages, setPinnedMessages] = useState<CommunityMessage[]>([]);
  // Rooms (channels) — null = the default "general" room (room-less messages).
  const [activeRoom, setActiveRoom] = useState<string | null>(null);
  const activeRoomRef = useRef<string | null>(null);
  // Rooms rail collapse — desktop users can hide the channel list to gain
  // chat width. Persisted locally so the choice survives reloads.
  const [roomsRailCollapsed, setRoomsRailCollapsed] = useState(() => {
    try {
      return localStorage.getItem("orbit:roomsRailCollapsed") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("orbit:roomsRailCollapsed", roomsRailCollapsed ? "1" : "0");
    } catch {
      // Storage unavailable (private mode) — preference just won't persist.
    }
  }, [roomsRailCollapsed]);
  // Room management — create / rename modal + delete confirmation.
  const [roomModal, setRoomModal] = useState<
    | { mode: "create" }
    | { mode: "rename"; roomId: string; currentName: string }
    | null
  >(null);
  const [roomNameInput, setRoomNameInput] = useState("");
  // Channel type for the CREATE modal — "text" (everyone posts) or
  // "announcement" (mods only, @everyone pings — Discord announcements).
  const [roomTypeInput, setRoomTypeInput] = useState<"text" | "announcement">(
    "text"
  );
  // Discord-style slowmode (seconds between a member's posts in the channel).
  // 0 = off. Editable on create AND rename.
  const [roomSlowModeInput, setRoomSlowModeInput] = useState(0);
  const [roomSaving, setRoomSaving] = useState(false);
  const [roomToDelete, setRoomToDelete] = useState<{
    roomId: string;
    name: string;
  } | null>(null);
  // Three-dot channel menu — shown ONLY on the currently-active channel pill
  // (admins use it to rename / delete the room they're inside).
  const [roomMenu, setRoomMenu] = useState<{
    x: number;
    y: number;
    roomId: string;
    roomName: string;
    slowModeSeconds?: number;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showMessageSearch, setShowMessageSearch] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CommunityMessage[]>([]);
  const [searchingMessages, setSearchingMessages] = useState(false);


  // Group call state (LiveKit)
  const [showGroupCall, setShowGroupCall] = useState(false);
  const [groupCallToken, setGroupCallToken] = useState<string | null>(null);
  const [groupCallRoomName, setGroupCallRoomName] = useState<string>("");
  const [groupCallUrl, setGroupCallUrl] = useState<string>("");
  const [groupCallType, setGroupCallType] = useState<"audio" | "video">("video");
  const [startingCall, setStartingCall] = useState(false);
  // Active call announced by another member of the currently-open community
  const [activeCommunityCall, setActiveCommunityCall] = useState<{
    roomName: string;
    type: "audio" | "video";
    startedBy: string;
  } | null>(null);

  // Forward modal state
  const [forwardModal, setForwardModal] = useState<{
    message: CommunityMessage;
  } | null>(null);
  const [selectedForwardConvIds, setSelectedForwardConvIds] = useState<string[]>([]);
  const [forwardConversations, setForwardConversations] = useState<Conversation[]>([]);
  const [loadingForwardConvs, setLoadingForwardConvs] = useState(false);
  const [, setOnlineUsers] = useState<Set<string>>(new Set());
  const onlineUsersRef = useRef<Set<string>>(new Set());



  // Camera capture state
  const [showCamera, setShowCamera] = useState(false);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  // Image crop state
	// Drag-and-drop state
	const [isDragActive, setIsDragActive] = useState(false);

  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropQueueFiles, setCropQueueFiles] = useState<{ file: File; preview: string }[]>([]);
  const cropPendingQueueRef = useRef<{ file: File; preview: string }[]>([]);

  // Scroll to bottom
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  // True while the user is at/near the bottom of the thread — incoming
  // messages only auto-scroll then; reading history is never hijacked.
  const nearBottomRef = useRef(true);
  const scrollThread = (force = false) => {
    if (!force && !nearBottomRef.current) {
      // Reading history — surface the button, don't yank the scroll.
      setShowScrollToBottom(true);
      return;
    }
    setShowScrollToBottom(false);
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  };
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 614);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  // Lenis smooth scroll for the community message thread — re-attached per
  // community AND per view change, so the instance is re-created whenever
  // the pane remounts (list → chat → list) instead of lingering on a dead node.
  useLenisScroll(messagesContainerRef, {}, [selectedCommunity?._id, view]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isKeyboardOpen = useKeyboardOpen();
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const communityMenuRef = useRef<HTMLDivElement>(null);
  const communityLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const communitySuppressClickRef = useRef(false);
  const messageSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic counter so only the LATEST search query's response is applied
  // — prevents out-of-order responses from older keystrokes overwriting newer
  // results when the free-tier backend answers slowly.
  const messageSearchSeqRef = useRef(0);	// ─── Fetch communities ─────────────────────────────────────────	// `bypass` forces a network fetch — used after community mutations so the
	// lists always reflect the server's fresh flags (audio/video calls, messaging)
	// instead of a stale cached response with the old toggle values.
	//
	// The browse directory (below) is mirrored into a ref so fetchMyCommunities
	// can derive a fallback from it WITHOUT re-creating this callback (which
	// would re-run the mount reconcile effect on every list change → loop).
	const allCommunitiesRef = useRef<Community[]>([]);

	const fetchMyCommunities = useCallback(async (bypass = false) => {
		try {
			const res = await apiFetch("/api/communities/mine", {
				...(bypass ? { bypassCache: true } : {}),
			});
			const data = await res.json();
			if (res.ok && data.success) {
				let list = data.communities || [];
				// Self-heal: if /mine comes back empty but the browse directory
				// knows communities this user belongs to (isMember: true), the
				// response was stale (a cache layer served an old empty list).
				// Derive the list from browse so "My Communities" is never
				// wrongly empty — the next successful /mine fetch replaces it.
				if (list.length === 0) {
					const fromBrowse = allCommunitiesRef.current.filter(
						(c) => c.isMember,
					);
					if (fromBrowse.length > 0) list = fromBrowse;
				}
				setMyCommunities(list);
			}
		} catch (err) {
			logger.error("Failed to fetch my communities", err);
		}
	}, []);

	const fetchAllCommunities = useCallback(async (bypass = false) => {
		try {
			const res = await apiFetch("/api/communities?limit=50", {
				...(bypass ? { bypassCache: true } : {}),
			});
			const data = await res.json();
			if (res.ok && data.success) {
				allCommunitiesRef.current = data.communities || [];
				setAllCommunities(allCommunitiesRef.current);
			}
		} catch (err) {
			logger.error("Failed to fetch all communities", err);
		}
	}, []);

  // Invite deep link: ?invite=<code> — prefill the code box and auto-join.
  // Used by shared community invite links ("Join" from another device/user).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("invite") || "";
    if (!code) return;
    pendingInviteCodeRef.current = code;
    setInviteCodeInput(code);
    // Let the ref flush before the join handler reads it.
    const t = setTimeout(() => void handleJoinViaInvite(), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cache-first: display cached community list instantly
  useEffect(() => {
    (async () => {
      try {
        let [cachedMine, cachedAll] = await Promise.all([
          getCachedResponse<{ communities: Community[] }>("/api/communities/mine"),
          getCachedResponse<{ communities: Community[] }>("/api/communities?limit=50"),
        ]);
        // CacheStorage missed → try the Dexie structured layer (survives
        // browser cache eviction) so both tabs still paint offline.
        if (!cachedMine?.communities?.length && !cachedAll?.communities?.length) {
          const offMine = (await getOfflineFallback(
            "/api/communities/mine",
          )) as { communities?: Community[] } | null;
          if (offMine?.communities?.length) {
            cachedMine = offMine as { communities: Community[] };
          }
          const offAll = (await getOfflineFallback(
            "/api/communities?limit=50",
          )) as { communities?: Community[] } | null;
          if (offAll?.communities?.length) {
            cachedAll = offAll as { communities: Community[] };
          }
        }
        if (cachedMine?.communities?.length || cachedAll?.communities?.length) {
          if (cachedMine?.communities?.length) {
            setMyCommunities(cachedMine.communities);
          }
          if (cachedAll?.communities?.length) {
            allCommunitiesRef.current = cachedAll.communities;
            setAllCommunities(cachedAll.communities);
          }
          setLoading(false);
        }
      } catch {
        // Cache miss or error — fall through to network fetch
      }
    })();
  }, []);

  // Network reconcile: always hit the server in the background (bypass cache).
  // The cache-first effect above paints the instant list, so this never blocks
  // the UI — it just replaces the cached copy with fresh membership data when
  // it lands. Without the bypass, apiFetch's SWR layer would return the cached
  // "mine" list (possibly stale/empty — e.g. missing a community joined on
  // another device) and never revalidate it, because /api/communities/mine was
  // not registered in the 30s background-refresh schedule. `loading` starts
  // true and is cleared by the cache-first paint (or here on failure), so a
  // skeleton only shows while there's genuinely nothing to paint yet.
  useEffect(() => {
    Promise.all([fetchMyCommunities(true), fetchAllCommunities(true)]).finally(
      () => setLoading(false)
    );
  }, [fetchMyCommunities, fetchAllCommunities]);

  // ─── Mobile detection ────────────────────────────────────────
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 614);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // ─── Fetch pinned messages ────────────────────────────────────
  const fetchPinnedMessages = useCallback(async (communityId: string) => {
    try {
      // bypassCache: pinning/unpinning does NOT evict the cached GET for
      // pinned-messages (the mutation URL is /messages/:id/pin), so a reload
      // would otherwise serve the stale pre-pin list — banner disappears and
      // the menu reverts to "Pin". Always fetch fresh (mirrors DM chat pins).
      // Room-scoped: only the ACTIVE room's pins are requested, so a pin made
      // in #gaming never shows in #general (the room-leak fix).
      const roomParam = activeRoomRef.current
        ? `?room=${encodeURIComponent(activeRoomRef.current)}`
        : "";
      const res = await apiFetch(
        `/api/communities/${communityId}/pinned-messages${roomParam}`,
        { bypassCache: true }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        setPinnedMessages(data.pinnedMessages || []);
      }
    } catch (err) {
      logger.error("Failed to fetch pinned messages", err);
    }
  }, []);

  // ─── Fetch messages for selected community ─────────────────────
  // When the background cache timer refreshes community data, re-fetch
  // so the list stays up-to-date without manual refresh.
  useCacheRefresh(MATCHER_COMMUNITIES, () => {
    fetchMyCommunities();
    fetchAllCommunities();
  });

  const fetchMessages = useCallback(
    async (communityId: string, cursorVal?: string | null) => {
      setLoadingMessages(true);
      try {
        // Room scoping — null room (general) when no room is selected; the
        // server defaults to the general room when the param is absent.
        const roomParam = activeRoomRef.current
          ? `&room=${activeRoomRef.current}`
          : "";
        const url = cursorVal
          ? `/api/communities/${communityId}/messages?cursor=${cursorVal}&limit=30${roomParam}`
          : `/api/communities/${communityId}/messages?limit=30${roomParam}`;

        // First page only — stale-while-revalidate. The thread is painted
        // from the local copy (CacheStorage entry for this exact URL written
        // on previous opens, else the Dexie layer primed at login) the moment
        // the community opens, with NO network wait — opening a community
        // chat feels instant even on a slow/cold backend or offline. Only the
        // network fetch below can replace it, so we never miss messages that
        // arrived while the thread was closed. Room-scoped too: each room's
        // URL (…&room=<id>) has its own cache entry, so switching back to a
        // previously-viewed room paints instantly as well.
        if (!cursorVal) {
          try {
            const cached = await getCachedResponse<{
              messages: CommunityMessage[];
              hasMore: boolean;
              nextCursor: string | null;
            }>(url);
            const fallback = (
              cached?.messages && cached.messages.length > 0
                ? cached
                : await getOfflineFallback(url)
            ) as {
              messages: CommunityMessage[];
              hasMore: boolean;
              nextCursor: string | null;
            } | null;
            if (fallback?.messages?.length) {
              setMessages(fallback.messages);
              setHasMore(fallback.hasMore);
              setCursor(fallback.nextCursor);
              setLoadingMessages(false); // painted — no skeleton wait
            }
          } catch {
            /* cache read failures are non-critical */
          }
        }

        // Always reconcile with the server on the first page — the fresh
        // copy replaces the cached one the moment it lands (and re-writes
        // both cache layers so the next open paints even newer data).
        // Pagination (cursor) stays cache-first like the DM thread.
        const res = await apiFetch(url, cursorVal ? {} : { bypassCache: true });
        const data = await res.json();
        if (res.ok && data.success) {
          if (cursorVal) {
            setMessages((prev) => [...data.messages, ...prev]);
          } else {
            setMessages(data.messages || []);
          }
          setHasMore(data.hasMore);
          setCursor(data.nextCursor);
        }
      } catch (err) {
        logger.error("Failed to fetch community messages", err);
      } finally {
        setLoadingMessages(false);
      }
    },
    []
  );

  const handleSelectCommunity = useCallback(
    (community: Community) => {
      setSelectedCommunity(community);
      setRoomMenu(null);
      setView("chat");
      setMessages([]);
      setHasMore(true);
      setCursor(null);
      setReplyTo(null);
      setEditingMessage(null);
      // Reset to the default "general" room on community switch.
      activeRoomRef.current = null;
      setActiveRoom(null);
      setPinnedMessages([]);
      setShowMessageSearch(false);
      setMessageSearchQuery("");
      setSearchResults([]);
      // Cache-first paint now lives inside fetchMessages (stale-while-
      // revalidate with Dexie fallback + room scoping) — opening a community
      // chat shows the cached thread instantly, then reconciles with the
      // server in the background.
      fetchMessages(community._id);
      fetchPinnedMessages(community._id);
      // The list endpoints intentionally omit the (potentially huge) members
      // array — the chat header's "active now" avatars and role handling need
      // it, so pull the full community in the background and merge it in.
      void (async () => {
        try {
          const res = await apiFetch(`/api/communities/${community._id}`, {
            bypassCache: true,
          });
          const data = await res.json();
          if (!res.ok || !data.success || !data.community) return;
          const full = data.community as Community;
          setSelectedCommunity((prev) =>
            prev && prev._id === full._id ? { ...prev, ...full } : prev
          );
          setMyCommunities((prev) =>
            prev.map((c) =>
              c._id === full._id ? { ...c, ...full, isMember: true } : c
            )
          );
          setAllCommunities((prev) =>
            prev.map((c) =>
              c._id === full._id
                ? { ...c, ...full, isMember: full.isMember ?? c.isMember }
                : c
            )
          );
        } catch (err) {
          // Non-critical — the list copy still opens and renders fine.
          logger.warn("Failed to merge full community", err);
        }
      })();
    },
    [fetchMessages, fetchPinnedMessages]
  );

  // ─── Notify parent when a community chat is opened/closed ─────
  useEffect(() => {
    onCommunityChatChange?.(selectedCommunity !== null);
    return () => onCommunityChatChange?.(false);
  }, [selectedCommunity, onCommunityChatChange]);

  // First-report guard: skip the initial null report while a deep-link
  // community id may still be resolving (the lists load async) — otherwise
  // the parent would clear openCommunityId before the deep-link select below.
  const reportedOpenCommunityRef = useRef(false);

  // Report the open community id so the parent can mirror it into the URL
  // (/communities/<id>) — drives reload persistence and shareable links.
  useEffect(() => {
    if (!reportedOpenCommunityRef.current) {
      reportedOpenCommunityRef.current = true;
      if (!selectedCommunity && openCommunityId) return;
    }
    onCommunityOpenChange?.(selectedCommunity?._id ?? null);
  }, [selectedCommunity, onCommunityOpenChange, openCommunityId]);

  // ─── Deep-link: auto-open a community (e.g. from a mention notification) ──
  // When the parent passes a community id, select it once it's present in
  // either list. Cleared once handled so it doesn't re-trigger on every
  // subsequent render.
  const handledDeepLinkRef = useRef<string | null>(null);
  // Remember a community the USER explicitly left via the back arrow. The
  // parent's openCommunityId still holds the old id for one render cycle
  // after leaving — without this marker the deep-link effect below would
  // instantly re-open it and make the back button feel dead.
  const userClosedCommunityRef = useRef<string | null>(null);
  // A fresh external navigation to a community id (new deep link, reload)
  // overrides the "user left" marker so auto-open can work again.
  useEffect(() => {
    userClosedCommunityRef.current = null;
  }, [openCommunityId]);
  useEffect(() => {
    if (!openCommunityId) return;
    // Respect an explicit user leave — never fight the back arrow.
    if (userClosedCommunityRef.current === openCommunityId) return;
    // Already open — nothing to do. Also stops the continuously-synced
    // openCommunityId (which now mirrors the open community for the URL)
    // from re-selecting the same community on every render.
    if (selectedCommunity?._id === openCommunityId) return;
    if (handledDeepLinkRef.current === openCommunityId) return;
    const target =
      [...myCommunities, ...allCommunities].find(
        (c) => c._id === openCommunityId,
      ) || null;
    if (target) {
      handledDeepLinkRef.current = openCommunityId;
      handleSelectCommunity(target);
    }
  }, [
    openCommunityId,
    myCommunities,
    allCommunities,
    selectedCommunity?._id,
    handleSelectCommunity,
  ]);

  // Reset the handled marker when no community is open so the same id can be
  // re-opened later (e.g. browser back to /communities/<id>).
  useEffect(() => {
    if (!selectedCommunity) handledDeepLinkRef.current = null;
  }, [selectedCommunity]);

  // The URL requested a community that never appeared in either list once
  // they loaded (deleted / not a member) — report null so the parent clears
  // the stale id from the URL instead of leaving /communities/<missing>.
  useEffect(() => {
    if (!openCommunityId) return;
    if (selectedCommunity?._id === openCommunityId) return;
    if (loading) return; // lists still loading
    const found = [...myCommunities, ...allCommunities].some(
      (c) => c._id === openCommunityId,
    );
    if (!found) {
      onCommunityOpenChange?.(null);
    }
  }, [
    openCommunityId,
    myCommunities,
    allCommunities,
    selectedCommunity?._id,
    loading,
    onCommunityOpenChange,
  ]);

  // Browser back / parent cleared the open community id — close the thread so
  // the list shows instead of a stale open community chat (mirrors Chat.tsx's
  // prevOpenConversationIdRef effect). Also mark it user-closed so the
  // deep-link auto-open above doesn't instantly re-open the same community.
  const prevOpenCommunityIdRef = useRef(openCommunityId);
  useEffect(() => {
    if (prevOpenCommunityIdRef.current && !openCommunityId) {
      userClosedCommunityRef.current = prevOpenCommunityIdRef.current;
      setView("list");
      setSelectedCommunity(null);
    }
    prevOpenCommunityIdRef.current = openCommunityId;
  }, [openCommunityId]);

  // Tracks the community id the active-call banner belongs to (set when the
  // banner appears), so a live banner isn't wiped by a re-run of the socket
  // effect — which happens on every selectedCommunity identity change
  // (member count, presence, toggle events all create a new object). The
  // banner is only cleared when the user switches to a different community
  // or the call actually ends.
  const activeCallBannerCommunityRef = useRef<string | null>(null);
  // Always-current community id, updated during render so effect cleanups
  // can tell whether the selected community changed between effect runs.
  const selectedCommunityIdRef = useRef<string | null>(selectedCommunity?._id ?? null);
  selectedCommunityIdRef.current = selectedCommunity?._id ?? null;
  // Tracks which community already requested a call-status check, so the
  // "community:call-status" request (and its toast) fires only once per
  // community open instead of on every effect re-run.
  const callStatusRequestedRef = useRef<string | null>(null);

  // ─── Socket events ─────────────────────────────────────────────
  useEffect(() => {
    if (!socket || !selectedCommunity) return;

    const communityId = selectedCommunity._id;

    // Join the community room
    socket.emit("community:join", { communityId });
    // Mark messages as seen when opening the chat
    socket.emit("community:seen", { communityId });
    if (callStatusRequestedRef.current !== communityId) {
      callStatusRequestedRef.current = communityId;
      socket.emit("community:call-status", { communityId });
    }

    // Listen for seen updates (other members reading messages)
    const handleSeenUpdate = (data: {
      communityId: string;
      messageIds: string[];
      seenByUserId: string;
    }) => {
      // Ignore our own read receipts — your own open of the chat must never
      // tick your own messages (mirrors Chat.tsx's `seenBy !== user` guard).
      if (
        data.communityId !== communityId ||
        data.seenByUserId === userId
      )
        return;
      setMessages((prev) =>
        prev.map((m) => {
          if (!data.messageIds.includes(m._id)) return m;
          // Dedupe: the same member opening the chat repeatedly (or a
          // reconnect replay) must not grow seenBy with duplicate ids.
          const seenBy = new Set<string>([
            ...((m.seenBy as string[]) || []),
            data.seenByUserId,
          ]);
          // Bounded read-receipt array — keep the newest 200 readers (same
          // contract as the server's SEENBY_CAP rotation).
          return { ...m, seenBy: [...seenBy].slice(-200) as any };
        })
      );
    };

    const handleNewMessage = (message: CommunityMessage) => {
      if (message.community === communityId) {
        // Room filter — ignore messages from other channels (null = general).
        if ((message.room || null) !== activeRoomRef.current) return;
        // Dedup: don't add messages that already exist (prevents voice note optimistic dupes)
        setMessages((prev) => {
          if (prev.some((m) => m._id === message._id)) return prev;
          // The server emits our own message echo BEFORE responding to the
          // send POST, so it races the response. Never strip the queued
          // pending placeholders here — nuking them all made every other
          // in-flight message disappear the moment the first one confirmed
          // (they only came back as each POST response landed). The POST
          // success handler owns the pending→confirmed replacement (exact
          // pendingId match). While ANY pending for this community exists,
          // this echo is our own send — skip appending a duplicate and let
          // the response finalize the placeholder. Only when there is no
          // pending (e.g. the same account sent from another device) do we
          // append the echo.
          const isOwnMessage = message.sender?._id === userId;
          if (isOwnMessage) {
            const hasPendingInCommunity = prev.some(
              (m) => (m as any)._pending && (m as any).community === message.community,
            );
            if (hasPendingInCommunity) return prev;
          }
          return [...prev, message];
        });
        // Only auto-scroll when the reader is already at the bottom — never
        // hijack their scroll while they're reading history.
        setTimeout(() => scrollThread(), 50);
      }
    };

    const handleEditMessage = (message: CommunityMessage) => {
      setMessages((prev) =>
        prev.map((m) => (m._id === message._id ? message : m))
      );
    };

    const handleDeleteMessage = ({
      messageId,
    }: {
      messageId: string;
    }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m._id === messageId
            ? { ...m, isDeleted: true, text: "This message was deleted", attachments: [] }
            : m
        )
      );
    };

    // Realtime delete-for-me: only the deleting user renders the placeholder;
    // other members keep seeing the original message.
    const handleDeleteForMeSocket = ({
      messageId,
      deletedByUserId,
    }: {
      messageId: string;
      deletedByUserId: string;
    }) => {
      if (deletedByUserId !== userId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m._id === messageId
            ? {
                ...m,
                isDeleted: true,
                text: "This message was deleted",
                attachments: [],
                deletedFor: [...(m.deletedFor || []), deletedByUserId],
              }
            : m
        )
      );
    };

    const handleReaction = ({
      messageId,
      reactions,
    }: {
      messageId: string;
      reactions: any[];
    }) => {
      // Merge ONLY the reactions into the existing message — never replace
      // the whole message (the server no longer ships a fully-populated copy,
      // and a wholesale swap would clobber local pending/seen state).
      setMessages((prev) =>
        prev.map((m) =>
          m._id === messageId ? { ...m, reactions } : m,
        ),
      );
    };

    const handleTyping = ({
      userId: typingUserId,
      isTyping,
    }: {
      userId: string;
      isTyping: boolean;
    }) => {
      if (typingUserId === userId) return;
      setTypingUsers((prev) => {
        if (isTyping) {
          return { ...prev, [typingUserId]: typingUserId };
        } else {
          const next = { ...prev };
          delete next[typingUserId];
          return next;
        }
      });
    };

    const handlePinUpdate = (data: {
      communityId: string;
      room?: string | null;
      pinnedMessages: CommunityMessage[];
    }) => {
      if (data.communityId !== communityId) return;
      // Only apply the live pin update if it's for the room we're currently
      // viewing — otherwise a pin in another room would clobber this room's
      // banner (the room-leak fix).
      const eventRoom = data.room ?? null;
      const currentRoom = activeRoomRef.current;
      if (eventRoom === currentRoom) {
        setPinnedMessages(data.pinnedMessages || []);
      }
    };

    socket.on("community:message:new", handleNewMessage);
    socket.on("community:message:edit", handleEditMessage);
    socket.on("community:message:delete", handleDeleteMessage);
    socket.on("community:message:delete-for-me", handleDeleteForMeSocket);
    socket.on("community:message:reaction", handleReaction);
    socket.on("community:message:pinned", handlePinUpdate);
    socket.on("community:message:unpinned", handlePinUpdate);
    socket.on("community:typing", handleTyping);
    socket.on("community:seen-update", handleSeenUpdate);

    // Handle presence sync for community members (green dots)
    const handlePresenceSync = (data: { communityId: string; onlineUserIds: string[] }) => {
      if (data.communityId === communityId) {
        const newSet = new Set(data.onlineUserIds);
        onlineUsersRef.current = newSet;
        setOnlineUsers(newSet);
      }
    };
    socket.on("community:presence:sync", handlePresenceSync);

    // Live presence changes: a member connected/disconnected while we're
    // viewing this community — update their green dot in realtime (mirrors
    // the personal-chat `user:presence` behavior for community members).
    const handleCommunityPresence = (data: {
      communityId: string;
      userId: string;
      status: "online" | "offline";
    }) => {
      if (data.communityId !== communityId) return;
      if (data.userId === userId) return;
      const next = new Set(onlineUsersRef.current);
      if (data.status === "online") {
        next.add(data.userId);
      } else {
        next.delete(data.userId);
      }
      onlineUsersRef.current = next;
      setOnlineUsers(next);
    };
    socket.on("community:presence", handleCommunityPresence);

    // Handle group call announcements from other members
    const handleCallStarted = (data: {
      communityId: string;
      roomName: string;
      type: "audio" | "video";
      startedBy: string;
    }) => {
      if (data.communityId !== communityId) return;
      if (data.startedBy === userId) return; // own call already tracked
      activeCallBannerCommunityRef.current = data.communityId;
      setActiveCommunityCall({
        roomName: data.roomName,
        type: data.type,
        startedBy: data.startedBy,
      });
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: {
            message:
              data.type === "video"
                ? "A member started a group video call — tap to join!"
                : "A member started a group audio call — tap to join!",
            type: "success",
          },
        }),
      );
    };
    const handleCallEnded = (data: { communityId: string }) => {
      if (data.communityId !== communityId) return;
      activeCallBannerCommunityRef.current = null;
      setActiveCommunityCall(null);
    };
    socket.on("community:call-started", handleCallStarted);
    socket.on("community:call-ended", handleCallEnded);

    // Live poll vote counts — a member votes while we're viewing the thread.
    const handlePollUpdated = (data: {
      communityId: string;
      messageId: string;
      options: { text: string; voters: string[] }[];
    }) => {
      if (data.communityId !== communityId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m._id === data.messageId && m.poll
            ? { ...m, poll: { ...m.poll, options: data.options } }
            : m,
        ),
      );
    };
    socket.on("community:poll:updated", handlePollUpdated);

    // Live star updates from other members (their stars show on our copy).
    const handleStarred = (data: {
      communityId: string;
      messageId: string;
      starred: boolean;
      userId: string;
    }) => {
      if (data.communityId !== communityId || data.userId === userId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m._id === data.messageId
            ? {
                ...m,
                savedBy: data.starred
                  ? [...new Set([...(m.savedBy || []), data.userId])]
                  : (m.savedBy || []).filter((id) => id !== data.userId),
              }
            : m,
        ),
      );
    };
    socket.on("community:message:starred", handleStarred);

    // Live delivered receipts — the server broadcast the message to the
    // community room; flip the ✓ → ✓✓ transition on senders' copies (their
    // "Message info" panel's Delivered row fills in live).
    const handleDelivered = (data: {
      communityId: string;
      messageId: string;
      deliveredAt: string;
    }) => {
      if (data.communityId !== communityId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m._id === data.messageId && !m.deliveredAt
            ? { ...m, deliveredAt: data.deliveredAt }
            : m,
        ),
      );
    };
    socket.on("community:message:delivered", handleDelivered);

    // Banned — a moderator removed us from the community. Close it locally
    // (the server already stripped membership, so no API call is needed).
    const handleBanned = (data: { communityId: string }) => {
      if (data.communityId !== communityId) return;
      setMyCommunities((prev) => prev.filter((c) => c._id !== communityId));
      setAllCommunities((prev) =>
        prev.map((c) =>
          c._id === communityId
            ? { ...c, isMember: false, memberCount: (c.memberCount || 1) - 1 }
            : c,
        ),
      );
      if (selectedCommunity?._id === communityId) {
        setView("list");
        setSelectedCommunity(null);
        setMessages([]);
        setCursor(null);
        setHasMore(true);
      }
      void Promise.all([
        evictCachedResponse("/api/communities/mine"),
        evictCachedResponse(`/api/communities/${communityId}/messages?limit=30`),
      ]).catch(() => {});
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: {
            message: "You have been banned from this community.",
            type: "error",
          },
        }),
      );
    };
    socket.on("community:banned", handleBanned);

    return () => {
      socket.emit("community:leave", { communityId });
      socket.off("community:message:new", handleNewMessage);
      socket.off("community:message:edit", handleEditMessage);
      socket.off("community:message:delete", handleDeleteMessage);
      socket.off("community:message:delete-for-me", handleDeleteForMeSocket);
      socket.off("community:message:reaction", handleReaction);
      socket.off("community:message:pinned", handlePinUpdate);
      socket.off("community:message:unpinned", handlePinUpdate);
      socket.off("community:typing", handleTyping);
      socket.off("community:seen-update", handleSeenUpdate);
      socket.off("community:poll:updated", handlePollUpdated);
      socket.off("community:message:starred", handleStarred);
      socket.off("community:message:delivered", handleDelivered);
      socket.off("community:banned", handleBanned);
      socket.off("community:presence:sync", handlePresenceSync);
      socket.off("community:presence", handleCommunityPresence);
      socket.off("community:call-started", handleCallStarted);
      socket.off("community:call-ended", handleCallEnded);
      // Clear the banner only when the user is no longer viewing the
      // community the banner belongs to (e.g. switched to a different
      // community). The effect itself re-runs on every selectedCommunity
      // identity change, and wiping the banner there would flash the
      // "join call" button off the moment it appears.
      if (selectedCommunityIdRef.current !== activeCallBannerCommunityRef.current) {
        activeCallBannerCommunityRef.current = null;
        setActiveCommunityCall(null);
      }
    };
  }, [socket, selectedCommunity, userId]);

  // ─── Real-time member count updates (global, not tied to selectedCommunity) ─
  useEffect(() => {
    if (!socket) return;

    const handleMemberUpdate = (data: {
      communityId: string;
      memberCount: number;
    }) => {
      setMyCommunities((prev) =>
        prev.map((c) =>
          c._id === data.communityId ? { ...c, memberCount: data.memberCount } : c
        )
      );
      setAllCommunities((prev) =>
        prev.map((c) =>
          c._id === data.communityId ? { ...c, memberCount: data.memberCount } : c
        )
      );
      // Also update selectedCommunity so the chat header shows live count
      setSelectedCommunity((prev) =>
        prev?._id === data.communityId
          ? { ...prev, memberCount: data.memberCount }
          : prev
      );
    };

    // A community was created — on our OTHER devices (same account) or a new
    // public community in the discover directory. Refresh both lists so it
    // appears instantly instead of after a reload or the 30s timer.
    const handleCommunityCreatedSocket = () => {
      evictCachedResponse("/api/communities/mine");
      evictCachedResponse("/api/communities?limit=50");
      fetchMyCommunities(true);
      fetchAllCommunities(true);
    };

    // ─── Reconnect broadcast backfill ──
    // Broadcast events (public community:created/updated) are NOT in the
    // per-user events:sync replay, so on socket reconnect App.tsx fires this
    // event and we refetch both lists — a community created while this
    // device's socket was dead appears without a reload. The OPEN community's
    // message thread is also room-based (not per-user logged), so refetch it
    // too — messages sent while the socket was dead then show up in place.
    const handleReconnectRefresh = () => {
      evictCachedResponse("/api/communities/mine");
      evictCachedResponse("/api/communities?limit=50");
      fetchMyCommunities(true);
      fetchAllCommunities(true);
      const openId = selectedCommunityIdRef.current;
      if (openId) {
        evictCachedResponse(`/api/communities/${openId}/messages`);
        fetchMessages(openId);
      }
    };

    const handleCommunityUpdate = (data: {
      communityId: string;
      community: Community;
    }) => {
      setMyCommunities((prev) =>
        prev.map((c) =>
          c._id === data.communityId ? data.community : c
        )
      );
      setAllCommunities((prev) =>
        prev.map((c) =>
          c._id === data.communityId ? { ...data.community, isMember: c.isMember ?? data.community.isMember } : c
        )
      );
      setSelectedCommunity((prev) =>
        prev?._id === data.communityId ? data.community : prev
      );
    };

    // ─── Keep community list previews live (last message / last action) ──
    // These listeners run for ALL joined communities (not just the open chat)
    // so "My Communities" shows the latest activity even without opening a chat.
    const updateAllCommunityLists = (
      updater: (c: Community) => Community
    ) => {
      setMyCommunities((prev) => prev.map(updater));
      setAllCommunities((prev) => prev.map(updater));
      setSelectedCommunity((prev) => (prev ? updater(prev) : prev));
    };

    const buildLastMessageSnapshot = (message: CommunityMessage) => ({
      messageId: message._id,
      text: message.text || "",
      attachmentType: message.attachments?.[0]?.type || "",
      sender: {
        _id: message.sender?._id,
        fullName: message.sender?.fullName,
        username: message.sender?.username,
      },
      createdAt: message.createdAt,
      isDeleted: false,
    });

    const handlePreviewNewMessage = (message: CommunityMessage) => {
      const cId = message.community;
      updateAllCommunityLists((c) =>
        c._id === cId
          ? {
              ...c,
              lastMessage: buildLastMessageSnapshot(message),
              lastAction: null,
            }
          : c
      );
      // A reload must not serve a stale cached list without the new preview
      evictCachedResponse("/api/communities/mine");
      evictCachedResponse("/api/communities?limit=50");
    };

    const handlePreviewEditMessage = (message: CommunityMessage) => {
      const cId = message.community;
      updateAllCommunityLists((c) => {
        if (c._id !== cId || c.lastMessage?.messageId !== message._id) {
          return c;
        }
        return {
          ...c,
          lastMessage: {
            ...c.lastMessage,
            text: message.text || "",
            attachmentType: message.attachments?.[0]?.type || "",
          },
          // Mirror the server: editing the newest message surfaces an action
          lastAction: {
            type: "message_edit",
            messageId: message._id,
            messageSenderId: message.sender?._id,
            actor: message.sender
              ? {
                  _id: message.sender._id,
                  fullName: message.sender.fullName,
                  username: message.sender.username,
                }
              : null,
            createdAt: new Date().toISOString(),
          },
        };
      });
    };

    const handlePreviewReaction = ({
      messageId,
      communityId,
      messageSenderId,
      type,
      emoji,
      actor,
    }: {
      messageId: string;
      communityId: string;
      messageSenderId?: string;
      type: "add" | "remove";
      emoji?: string;
      actor?: { _id: string; fullName?: string; username?: string } | null;
    }) => {
      const cId = communityId;
      updateAllCommunityLists((c) => {
        if (c._id !== cId) return c;
        const isLast = c.lastMessage?.messageId === messageId;
        if (type === "add" && isLast) {
          return {
            ...c,
            lastAction: {
              type: "reaction",
              emoji: emoji || "",
              messageId,
              messageSenderId,
              actor: actor
                ? { _id: actor._id, fullName: actor.fullName, username: actor.username }
                : null,
              createdAt: new Date().toISOString(),
            },
          };
        }
        if (type === "remove" && c.lastAction?.messageId === messageId) {
          return { ...c, lastAction: null };
        }
        return c;
      });
    };

    const handlePreviewPin = ({
      communityId,
      messageId,
      messageSenderId,
      actor,
    }: {
      communityId: string;
      messageId: string;
      messageSenderId?: string;
      actor?: { _id: string; fullName?: string; username?: string } | null;
    }) => {
      updateAllCommunityLists((c) =>
        c._id === communityId
          ? {
              ...c,
              lastAction: {
                type: "pin",
                messageId,
                messageSenderId,
                actor: actor || null,
                createdAt: new Date().toISOString(),
              },
            }
          : c
      );
    };

    const handlePreviewUnpin = ({
      communityId,
      messageId,
      actor,
    }: {
      communityId: string;
      messageId: string;
      actor?: { _id: string; fullName?: string; username?: string } | null;
    }) => {
      updateAllCommunityLists((c) =>
        c._id === communityId
          ? {
              ...c,
              lastAction: {
                type: "unpin",
                messageId,
                actor: actor || null,
                createdAt: new Date().toISOString(),
              },
            }
          : c
      );
    };

    const handlePreviewCallStarted = ({
      communityId,
      type,
      actor,
    }: {
      communityId: string;
      type: "audio" | "video";
      actor?: { _id: string; fullName?: string; username?: string } | null;
    }) => {
      updateAllCommunityLists((c) =>
        c._id === communityId
          ? {
              ...c,
              lastAction: {
                type: "call",
                callType: type,
                callStatus: "started",
                actor: actor || null,
                createdAt: new Date().toISOString(),
              },
            }
          : c
      );
    };

    const handlePreviewCallEnded = ({
      communityId,
      type,
      actor,
    }: {
      communityId: string;
      type?: "audio" | "video";
      actor?: { _id: string; fullName?: string; username?: string } | null;
    }) => {
      updateAllCommunityLists((c) =>
        c._id === communityId
          ? {
              ...c,
              lastAction: {
                type: "call",
                callType: type || c.lastAction?.callType || "audio",
                callStatus: "ended",
                actor: actor || c.lastAction?.actor || null,
                createdAt: new Date().toISOString(),
              },
            }
          : c
      );
    };

    const handlePreviewDeleteMessage = ({
      messageId,
      communityId,
    }: {
      messageId: string;
      communityId: string;
    }) => {
      updateAllCommunityLists((c) =>
        c._id === communityId && c.lastMessage?.messageId === messageId
          ? {
              ...c,
              lastMessage: {
                ...c.lastMessage,
                text: "This message was deleted",
                attachmentType: "",
                isDeleted: true,
              },
              lastAction: null,
            }
          : c
      );
    };

    const handlePreviewChatCleared = ({ communityId }: { communityId: string }) => {
      updateAllCommunityLists((c) =>
        c._id === communityId ? { ...c, lastMessage: null, lastAction: null } : c
      );
    };

    socket.on("community:message:new", handlePreviewNewMessage);
    socket.on("community:message:edit", handlePreviewEditMessage);
    socket.on("community:message:reaction", handlePreviewReaction);
    socket.on("community:message:pinned", handlePreviewPin);
    socket.on("community:message:unpinned", handlePreviewUnpin);
    socket.on("community:call-started", handlePreviewCallStarted);
    socket.on("community:call-ended", handlePreviewCallEnded);
    socket.on("community:message:delete", handlePreviewDeleteMessage);
    socket.on("community:chat-cleared", handlePreviewChatCleared);

    socket.on("community:member-joined", handleMemberUpdate);
    socket.on("community:member-left", handleMemberUpdate);
    const handleCommunityDeletedEvent = (data: { communityId: string }) => {
      handleCommunityDeleted(data.communityId);
    };

    // Rooms (channels) changed — another admin created / renamed / deleted a
    // room. Refresh every copy of the community, and bounce back to the
    // general room if the room we were viewing just got deleted.
    const handleRoomsUpdated = (data: {
      communityId: string;
      community?: Community;
    }) => {
      const freshCommunity = data.community;
      if (freshCommunity) {
        setMyCommunities((prev) =>
          prev.map((c) =>
            c._id === data.communityId ? freshCommunity : c
          )
        );
        setAllCommunities((prev) =>
          prev.map((c) =>
            c._id === data.communityId
              ? { ...freshCommunity, isMember: c.isMember ?? freshCommunity.isMember }
              : c
          )
        );
        setSelectedCommunity((prev) =>
          prev?._id === data.communityId ? freshCommunity : prev
        );
      }
      // The room we were viewing no longer exists → general room.
      if (
        data.communityId === selectedCommunityIdRef.current &&
        activeRoomRef.current &&
        !(freshCommunity?.rooms || []).some(
          (r: any) => r._id === activeRoomRef.current
        )
      ) {
        activeRoomRef.current = null;
        setActiveRoom(null);
        setMessages([]);
        setHasMore(true);
        setCursor(null);
        fetchMessages(data.communityId);
      }
    };
    socket.on("community:rooms-updated", handleRoomsUpdated);
    socket.on("community:created", handleCommunityCreatedSocket);
    socket.on("community:updated", handleCommunityUpdate);
    socket.on("community:deleted", handleCommunityDeletedEvent);

    // Reconnect broadcast backfill (fired by App.tsx on socket reconnect).
    window.addEventListener("orbit:communities-refresh", handleReconnectRefresh);

    // Listen for messaging/calls toggle events
    socket.on("community:messaging-toggled", (data: { communityId: string; messagingEnabled: boolean }) => {
      setSelectedCommunity((prev) =>
        prev?._id === data.communityId
          ? { ...prev, messagingEnabled: data.messagingEnabled }
          : prev
      );
      setMyCommunities((prev) =>
        prev.map((c) =>
          c._id === data.communityId ? { ...c, messagingEnabled: data.messagingEnabled } : c
        )
      );
      setAllCommunities((prev) =>
        prev.map((c) =>
          c._id === data.communityId ? { ...c, messagingEnabled: data.messagingEnabled } : c
        )
      );
    });

    socket.on("community:calls-toggled", (data: { communityId: string; audioCallEnabled?: boolean; videoCallEnabled?: boolean }) => {
      setSelectedCommunity((prev) =>
        prev?._id === data.communityId
          ? { ...prev, audioCallEnabled: data.audioCallEnabled ?? prev?.audioCallEnabled, videoCallEnabled: data.videoCallEnabled ?? prev?.videoCallEnabled }
          : prev
      );
      setMyCommunities((prev) =>
        prev.map((c) =>
          c._id === data.communityId ? { ...c, audioCallEnabled: data.audioCallEnabled ?? c.audioCallEnabled, videoCallEnabled: data.videoCallEnabled ?? c.videoCallEnabled } : c
        )
      );
      setAllCommunities((prev) =>
        prev.map((c) =>
          c._id === data.communityId ? { ...c, audioCallEnabled: data.audioCallEnabled ?? c.audioCallEnabled, videoCallEnabled: data.videoCallEnabled ?? c.videoCallEnabled } : c
        )
      );
    });

    // ─── Join requests (private communities) ─────
    // A new request arrived — managers with the community open get a live
    // toast so they can act without refreshing.
    const handleJoinRequestEvent = (data: { communityId: string; userId: string }) => {
      const isManagerOf = (c: Community | null) => {
        if (!c || c._id !== data.communityId) return false;
        return (
          c.creator?._id === userId ||
          (c.admins || []).includes(userId) ||
          c.userRole === "admin" ||
          c.userRole === "creator"
        );
      };
      if (isManagerOf(selectedCommunity) || isManagerOf(myCommunities.find((c) => c._id === data.communityId) || null)) {
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: { message: "New join request! Check Settings → Join Requests.", type: "info" },
          }),
        );
      }
    };
    socket.on("community:join-request", handleJoinRequestEvent);

    // A request was approved / rejected / cancelled — the requester's UI
    // updates live (pending button → member / back to join).
    const handleJoinRequestResolved = (data: {
      communityId: string;
      userId: string;
      status: "approved" | "rejected" | "cancelled";
    }) => {
      if (data.userId !== userId) return;
      const updater = (c: Community): Community => ({ ...c, pendingRequest: false });
      setSelectedCommunity((prev) =>
        prev?._id === data.communityId
          ? { ...prev, pendingRequest: false, isMember: data.status === "approved" ? true : prev.isMember, userRole: data.status === "approved" ? "member" : prev.userRole }
          : prev
      );
      setMyCommunities((prev) => prev.map((c) => (c._id === data.communityId ? updater(c) : c)));
      setAllCommunities((prev) => prev.map((c) => (c._id === data.communityId ? updater(c) : c)));
      if (data.status === "approved") {
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: { message: "Your join request was approved! 🎉", type: "success" },
          }),
        );
      } else if (data.status === "rejected") {
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: { message: "Your join request was declined.", type: "error" },
          }),
        );
      }
    };
    socket.on("community:join-request-resolved", handleJoinRequestResolved);

    // A member's role changed (promote/demote) — reflect it live everywhere.
    const handleRoleChanged = (data: {
      communityId: string;
      userId: string;
      role: string;
    }) => {
      const roleUpdater = (c: Community): Community => {
        const next = { ...c };
        if (data.userId === userId) next.userRole = data.role as Community["userRole"];
        if (next.members?.length) {
          next.members = next.members.map((m) =>
            m.user._id === data.userId ? { ...m, role: data.role as any } : m
          );
        }
        return next;
      };
      setSelectedCommunity((prev) =>
        prev?._id === data.communityId ? roleUpdater(prev) : prev
      );
      setMyCommunities((prev) =>
        prev.map((c) => (c._id === data.communityId ? roleUpdater(c) : c))
      );
      setAllCommunities((prev) =>
        prev.map((c) => (c._id === data.communityId ? roleUpdater(c) : c))
      );
    };
    socket.on("community:member-role-changed", handleRoleChanged);

    // ─── Track online users via presence events ─────
    const handlePresence = ({
      userId: presenceUserId,
      status,
    }: {
      userId: string;
      status: "online" | "offline";
    }) => {
      if (status === "online") {
        onlineUsersRef.current.add(presenceUserId);
      } else {
        onlineUsersRef.current.delete(presenceUserId);
      }
      setOnlineUsers(new Set(onlineUsersRef.current));
    };
    socket.on("user:presence", handlePresence);

    return () => {
      socket.off("community:message:new", handlePreviewNewMessage);
      socket.off("community:message:edit", handlePreviewEditMessage);
      socket.off("community:message:reaction", handlePreviewReaction);
      socket.off("community:message:pinned", handlePreviewPin);
      socket.off("community:message:unpinned", handlePreviewUnpin);
      socket.off("community:call-started", handlePreviewCallStarted);
      socket.off("community:call-ended", handlePreviewCallEnded);
      socket.off("community:message:delete", handlePreviewDeleteMessage);
      socket.off("community:chat-cleared", handlePreviewChatCleared);
      socket.off("community:member-joined", handleMemberUpdate);
      socket.off("community:member-left", handleMemberUpdate);
      socket.off("community:rooms-updated", handleRoomsUpdated);
      socket.off("community:created", handleCommunityCreatedSocket);
      socket.off("community:updated", handleCommunityUpdate);
      socket.off("community:deleted", handleCommunityDeletedEvent);
      window.removeEventListener("orbit:communities-refresh", handleReconnectRefresh);
      socket.off("community:join-request", handleJoinRequestEvent);
      socket.off("community:join-request-resolved", handleJoinRequestResolved);
      socket.off("community:member-role-changed", handleRoleChanged);
      socket.off("user:presence", handlePresence);
    };
  }, [socket]);

  // ─── Join all community rooms so we receive live member count updates ──
  useEffect(() => {
    if (!socket) return;
    myCommunities.forEach((c) => {
      socket.emit("community:join", { communityId: c._id });
    });
    return () => {
      myCommunities.forEach((c) => {
        socket.emit("community:leave", { communityId: c._id });
      });
    };
  }, [socket, myCommunities]);

  // Inject waveform animation keyframes
  useEffect(() => {
    const styleId = "community-waveform-style";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        @keyframes waveform {
          0% { transform: scaleY(0.4); }
          100% { transform: scaleY(1); }
        }
        .waveform-bar {
          transform-origin: center bottom;
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (view === "chat") {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    }
  }, [view]);
  // ─── Typing indicator ──────────────────────────────────────────
  const emitTyping = useCallback(
    (isTyping: boolean) => {
      if (!socket || !selectedCommunity) return;
      socket.emit("community:typing", {
        communityId: selectedCommunity._id,
        isTyping,
      });
    },
    [socket, selectedCommunity]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    handleMentionChange(e.target.value, e.target.selectionStart);
    setMessageInput(e.target.value);
    messageInputRef.current = e.target.value;

    // Emit typing
    emitTyping(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => emitTyping(false), 2000);

    // Auto-resize
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  };

  // ─── Voice Note Recording ─────────────────────────────────────────
  const getAudioMimeType = (): { mimeType: string; extension: string } => {
    const candidates = [
      { mimeType: "audio/webm;codecs=opus", extension: "webm" },
      { mimeType: "audio/webm", extension: "webm" },
      { mimeType: "audio/mp4;codecs=mp4a.40.2", extension: "mp4" },
      { mimeType: "audio/mp4", extension: "mp4" },
      { mimeType: "audio/aac", extension: "aac" },
      { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
      { mimeType: "audio/wav", extension: "wav" },
    ];
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c.mimeType)) {
        return c;
      }
    }
    return { mimeType: "", extension: "webm" };
  };

  const handleMicToggle = async () => {
    if (isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: 48000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        audioChunksRef.current = [];
        setRecordingDuration(0);

        const { mimeType } = getAudioMimeType();
        const recorderOptions: any = { audioBitsPerSecond: 128000 };
        if (mimeType) {
          recorderOptions.mimeType = mimeType;
        }

        const recorder = new MediaRecorder(stream, recorderOptions);

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            audioChunksRef.current.push(e.data);
          }
        };

        recorder.onstop = () => {
          const actualMimeType = mimeType || recorder.mimeType || "audio/webm";
          const blob = new Blob(audioChunksRef.current, { type: actualMimeType });
          stream.getTracks().forEach((track) => track.stop());

          if (shouldSendAfterRecordRef.current) {
            shouldSendAfterRecordRef.current = false;
            handleSendVoiceNote(blob, recordingDurationRef.current);
          } else {
            setRecordedBlob(blob);
            setRecordedUrl(URL.createObjectURL(blob));
          }
        };

        mediaRecorderRef.current = recorder;
        recorder.start();
        setIsRecording(true);

        recordingDurationRef.current = 0;
        recordingTimerRef.current = setInterval(() => {
          setRecordingDuration((prev) => {
            const next = prev + 1;
            recordingDurationRef.current = next;
            return next;
          });
        }, 1000);
      } catch (err) {
        logger.error("Failed to start recording", err);
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: {
              message: "Microphone access denied. Please allow microphone permissions.",
              type: "error",
            },
          })
        );
      }
    }
  };

  const handleMicClick = (_e: React.MouseEvent) => {
    handleMicToggle();
  };

  const handleSendVoiceNote = async (overrideBlob?: Blob, overrideDuration?: number) => {
    const targetBlob = overrideBlob || recordedBlob;
    const targetUrl = overrideBlob ? URL.createObjectURL(overrideBlob) : recordedUrl;
    const targetDuration = overrideDuration !== undefined ? overrideDuration : recordingDuration;

    if (!selectedCommunity || !targetBlob || !targetUrl) return;

    // No global sending guard (mirrors Chat.tsx) — each voice note gets its
    // own pending id, so voice notes queue alongside text/media messages.

    const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Snapshot replyTo BEFORE clearing state
    const replyToSnapshot = replyTo ? { ...replyTo } : null;

    const optimisticMessage: any = {
      _id: pendingId,
      _pending: true,
      community: selectedCommunity._id,
      room: activeRoomRef.current,
      sender: {
        _id: user._id,
        username: user.username,
        fullName: user.fullName,
        profilePic: user.profilePic,
      },
      text: "",
      replyTo: replyToSnapshot
        ? {
            _id: replyToSnapshot._id,
            sender: replyToSnapshot.sender,
            text: replyToSnapshot.text,
            attachments: replyToSnapshot.attachments,
            createdAt: replyToSnapshot.createdAt,
          }
        : null,
      attachments: [
        {
          url: targetUrl,
          type: "voice_note",
          duration: targetDuration,
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Save payload for retry before clearing UI
    unsentPayloadsRef.current[pendingId] = {
      type: "voice_note",
      blob: targetBlob,
      url: targetUrl,
      duration: targetDuration,
      replyToId: replyToSnapshot?._id,
      room: activeRoomRef.current,
    };

    setMessages((prev) => [...prev, optimisticMessage]);

    // Clear recording UI immediately
    setRecordedBlob(null);
    setRecordedUrl(null);
    setRecordingDuration(0);
    setIsPlayingPreview(false);
    setReplyTo(null);

    scrollThread(true);
    // Unified executor — owns the upload, progress, queued-on-offline state
    // and auto-retry (the payload above is already stored in
    // unsentPayloadsRef, so a reconnect can re-pump this send).
    await performCommunitySend(pendingId, selectedCommunity._id);
  };

  // ─── File selection ────────────────────────────────────────────
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Enforce file count limit (max 5 total, matching backend route)
    const maxAllowed = 5 - selectedFiles.length;
    if (maxAllowed <= 0) {
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Maximum 5 files allowed.", type: "error" },
        }),
      );
      if (e.target) e.target.value = "";
      return;
    }
    const validFiles = files.slice(0, maxAllowed);

    // Filter out oversized files (50MB per file limit matching backend)
    const oversized = validFiles.filter((f) => f.size > MAX_FILE_SIZE);
    oversized.forEach((f) => {
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: `"${f.name}" exceeds the 50MB size limit.`, type: "error" },
        }),
      );
    });
    const okFiles = validFiles.filter((f) => f.size <= MAX_FILE_SIZE);
    if (okFiles.length === 0) {
      if (e.target) e.target.value = "";
      return;
    }

    const images: { file: File; preview: string }[] = [];
    const otherFiles: File[] = [];

    okFiles.forEach((f) => {
      if (f.type.startsWith("image/")) {
        images.push({ file: f, preview: URL.createObjectURL(f) });
      } else if (f.type.startsWith("video/") || f.type.startsWith("audio/") || f.type.startsWith("application/") || f.type.startsWith("text/")) {
        otherFiles.push(f);
      }
    });

    if (images.length > 0) {
      // Store images in the crop queue and open the crop modal for the first one
      const queue = images.map((img) => ({ file: img.file, preview: img.preview }));
      cropPendingQueueRef.current = queue;
      setCropQueueFiles(queue);
      setCropSrc(queue[0].preview);
      setCropModalOpen(true);
    }

    if (otherFiles.length > 0) {
      const previews = otherFiles.map((f) => URL.createObjectURL(f));
      setSelectedFiles((prev) => [...prev, ...otherFiles]);
      setFilePreviews((prev) => [...prev, ...previews]);
    }

    if (e.target) e.target.value = "";
  };

  // Handle crop completion
  const handleCropComplete = (croppedBlob: Blob) => {
    const croppedFile = new File([croppedBlob], `cropped-${Date.now()}.jpg`, { type: "image/jpeg" });
    const previewUrl = URL.createObjectURL(croppedBlob);

    setSelectedFiles((prev) => [...prev, croppedFile]);
    setFilePreviews((prev) => [...prev, previewUrl]);

    // Advance to next queued image (the modal is about to close via ImageCropModal's internal onClose call)
    // We schedule the next open AFTER the current frame so onClose doesn't clobber it
    const remaining = cropQueueFiles.slice(1);
    if (remaining.length > 0) {
      cropPendingQueueRef.current = remaining;
      setCropQueueFiles(remaining);
      setCropSrc(remaining[0].preview);
      // Open the modal on the next frame AFTER ImageCropModal calls onClose
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setCropModalOpen(true);
        });
      });
    } else {
      cropPendingQueueRef.current = [];
      setCropQueueFiles([]);
      setCropSrc(null);
    }
  };

  const removeFile = (index: number) => {
    URL.revokeObjectURL(filePreviews[index]);
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setFilePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  // Cleanup file previews on unmount
  useEffect(() => {
    return () => {
      filePreviews.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Camera capture ─────────────────────────────────────────────
  const handleCapturePhoto = () => {
    const video = cameraVideoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1080;
    canvas.height = video.videoHeight || 1920;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
      const preview = URL.createObjectURL(blob);
      setSelectedFiles((prev) => [...prev, file]);
      setFilePreviews((prev) => [...prev, preview]);
      handleCloseCamera();
    }, "image/jpeg", 0.9);
  };

  const handleCloseCamera = () => {
    setShowCamera(false);
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
  };

  // ─── Send message ──────────────────────────────────────────────
  const handleSendMessage = async () => {
    // If currently recording, stop and send the voice note instead
    if (isRecording) {
      shouldSendAfterRecordRef.current = true;
      handleMicToggle();
      return;
    }
    if (!messageInputRef.current.trim() && selectedFiles.length === 0) return;
    if (!selectedCommunity) return;

    // Snapshot the text/attachments/reply before any state changes. Read from
    // the synchronous mirror and clear it immediately (Chat.tsx pattern) so a
    // fast second submit can't re-read the same text.
    const textToSend = messageInputRef.current.trim();
    messageInputRef.current = "";
    const filesToSend = [...selectedFiles];
    const previewsToClear = [...filePreviews];
    const replyToSend = replyTo ? { ...replyTo } : null;
    const scheduleIso = scheduledFor ? scheduledFor.toISOString() : undefined;

    // ─── Optimistic: show message immediately ───────────────────
    const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Build attachments array from selected files for the optimistic preview
    const optimisticAttachments: any[] = [];
    filesToSend.forEach((file, idx) => {
      const previewUrl = previewsToClear[idx] || URL.createObjectURL(file);
      const fileType = file.type;
      let attType: string = "file";
      if (fileType.startsWith("image/") && fileType !== "image/gif") attType = "image";
      else if (fileType === "image/gif") attType = "gif";
      else if (fileType.startsWith("video/")) attType = "video";
      else if (fileType.startsWith("audio/")) attType = "voice_note";
      optimisticAttachments.push({
        url: previewUrl,
        type: attType as any,
        name: file.name,
        size: file.size,
        mimetype: file.type,
      });
    });

    const optimisticMessage: any = {
      _id: pendingId,
      _pending: true,
      community: selectedCommunity._id,
      room: activeRoomRef.current,
      sender: {
        _id: user._id,
        username: user.username,
        fullName: user.fullName,
        profilePic: user.profilePic,
      },
      text: textToSend,
      replyTo: replyToSend
        ? {
            _id: replyToSend._id,
            sender: replyToSend.sender,
            text: replyToSend.text,
            attachments: replyToSend.attachments,
            createdAt: replyToSend.createdAt,
          }
        : null,
      attachments: optimisticAttachments,
      reactions: [],
      ...(scheduleIso ? { scheduledAt: scheduleIso } : {}),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDeleted: false,
      isEdited: false,
    };

    // Add optimistic message and clear input immediately
    setMessages((prev) => [...prev, optimisticMessage]);
    setMessageInput("");
    setSelectedFiles([]);
    setFilePreviews((prev) => {
      prev.forEach((url) => URL.revokeObjectURL(url));
      return [];
    });
    setReplyTo(null);
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    // Downscale photos BEFORE the payload reaches the send executor — the
    // executor used to encode inline, so the pending bubble sat on a large
    // image's encode before the upload even started. The flag lets it skip
    // its own (idempotent) re-encode; downscaleImageFile passes GIFs and
    // already-small images through unchanged.
    const downscaledFiles = await Promise.all(
      filesToSend.map(async (f) => {
        if (!f.type.startsWith("image/")) return f;
        try {
          return await downscaleImageFile(f);
        } catch {
          return f; // executor's own encode stays the fallback
        }
      })
    );
    const fileDownscaled = filesToSend.some((f) =>
      f.type.startsWith("image/")
    );

    // Store the payload so an offline blip can queue + auto-retry this send
    // (matches the voice-note path and the personal chat's queue).
    unsentPayloadsRef.current[pendingId] = {
      type: "message",
      text: textToSend,
      files: downscaledFiles,
      previews: previewsToClear,
      replyToId: replyToSend?._id,
      room: activeRoomRef.current,
      ...(scheduleIso ? { scheduledAt: scheduleIso } : {}),
      fileDownscaled,
    };
    // A scheduled send is one-shot: after it's queued, clear the picker.
    if (scheduleIso) {
      setScheduledFor(null);
      setSchedulePickerOpen(false);
    }

    setSendingError(null);
    emitTyping(false);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    scrollThread(true);
    // Unified executor — owns the upload, progress, queued-on-offline state
    // and auto-retry on reconnect.
    await performCommunitySend(pendingId, selectedCommunity._id);
  };

  // ─── Poll composer submit ───────────────────────────────────────
  // Sends a message whose ONLY payload is the poll (Discord-style): the
  // server stores the CommunityMessage with `poll` attached and the room
  // renders the voting card. The composer's text/files stay untouched.
  const handlePollSubmit = async () => {
    const question = pollDraft.question.trim();
    const options = pollDraft.options
      .map((o) => o.trim())
      .filter(Boolean);
    if (!question) {
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Add a question for your poll", type: "error" },
        }),
      );
      return;
    }
    if (options.length < 2) {
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Add at least 2 options", type: "error" },
        }),
      );
      return;
    }
    if (!selectedCommunity) return;

    setPollSubmitting(true);
    try {
      const endsAt = pollDraft.durationMinutes
        ? new Date(Date.now() + pollDraft.durationMinutes * 60000).toISOString()
        : null;
      const res = await apiFetch(
        `/api/communities/${selectedCommunity._id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: "",
            poll: {
              question,
              options: options.map((text) => ({ text })),
              allowMultiple: pollDraft.allowMultiple,
              ...(endsAt ? { endsAt } : {}),
              hideResults: pollDraft.hideResults,
            },
          }),
        },
      );
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.sentMessage) {
          // Insert the confirmed poll message into the thread immediately.
          setMessages((prev) => [...prev, data.sentMessage]);
          scrollThread(true);
        }
        setPollComposerOpen(false);
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: { message: "Poll created!", type: "success" },
          }),
        );
      } else {
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: {
              message: data?.message || "Failed to create poll",
              type: "error",
            },
          }),
        );
      }
    } catch (err) {
      logger.error("Poll creation failed", err);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Failed to create poll", type: "error" },
        }),
      );
    } finally {
      setPollSubmitting(false);
    }
  };

  // ─── Message actions (reply, edit, delete) ─────────────────────
  const handleReply = (message: CommunityMessage) => {
    setReplyTo(message);
    setEditingMessage(null);
    inputRef.current?.focus();
  };

  const handleEdit = (message: CommunityMessage) => {
    setEditingMessage(message);
    setReplyTo(null);
    setMessageInput(message.text);
    inputRef.current?.focus();
  };

  const cancelReply = () => {
    setReplyTo(null);
  };

  const cancelEdit = () => {
    setEditingMessage(null);
    setMessageInput("");
  };

  // Focus the input AFTER React commits the reply/edit banner — the sync
  // focus() inside handleReply/handleEdit fires while the banner isn't in
  // the DOM yet, and the banner insert + context-menu removal shift the
  // layout, dropping the focus (user had to tap the box before typing).
  // Running here, post-commit, leaves the input ready to type immediately.
  useEffect(() => {
    if (replyTo || editingMessage) {
      inputRef.current?.focus();
    }
  }, [replyTo, editingMessage]);

  // Slowmode countdown: tick once a second; when it hits 0, auto-resend the
  // queued message that was rejected (the clock-icon bubble stays visible the
  // whole time, then sends itself — no manual retry needed).
  useEffect(() => {
    if (!slowmodeUntil) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((slowmodeUntil - Date.now()) / 1000));
      setSlowmodeNow(remaining);
      if (remaining <= 0) {
        const pendingId = slowmodeRetryPendingRef.current;
        setSlowmodeUntil(null);
        slowmodeRetryPendingRef.current = null;
        if (pendingId && unsentPayloadsRef.current[pendingId]) {
          void performCommunitySend(pendingId);
        }
        return;
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slowmodeUntil]);

  // Message info panel: when it opens, resolve the "Seen by" member list
  // (names + avatars) from the server — the message only carries ids.
  useEffect(() => {
    if (!messageInfo) {
      setMessageInfoSeenBy([]);
      return;
    }
    const seenCount = messageInfo.seenBy?.length || 0;
    if (seenCount === 0) {
      setMessageInfoSeenBy([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch(
          `/api/communities/messages/${messageInfo._id}/seen-by`,
        );
        const data = await res.json();
        if (!cancelled && res.ok && data.success) {
          setMessageInfoSeenBy(data.seenBy || []);
        }
      } catch (err) {
        logger.warn("Failed to fetch seen-by list", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messageInfo]);

  // "Edit" and "Delete for everyone" are only available within 5 minutes
  // of sending — mirrors personal chat (Chat.tsx isEditable).
  const isEditable = (createdAt?: string) => {
    if (!createdAt) return false;
    const diffMs = Date.now() - new Date(createdAt).getTime();
    return diffMs <= 5 * 60 * 1000; // 5 minutes
  };

  const handleDeleteForMe = async (messageId: string) => {
    try {
      const res = await apiFetch(
        `/api/communities/messages/${messageId}/delete-for-me`,
        { method: "DELETE" }
      );
      if (res.ok) {
        // Mark as deleted (placeholder) for me only — others still see it.
        // Matches personal-chat behavior; the server keeps the message with
        // our id in deletedFor so the placeholder survives reloads.
        setMessages((prev) =>
          prev.map((m) =>
            m._id === messageId
              ? {
                  ...m,
                  isDeleted: true,
                  text: "This message was deleted",
                  attachments: [],
                  deletedFor: [...(m.deletedFor || []), userId],
                }
              : m
          )
        );
      }
    } catch (err) {
      logger.error("Failed to delete message for me", err);
    }
    setContextMenu(null);
  };

  const handleDelete = async (messageId: string) => {
    try {
      const res = await apiFetch(
        `/api/communities/messages/${messageId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setMessages((prev) =>
          prev.map((m) =>
            m._id === messageId
              ? { ...m, isDeleted: true, text: "This message was deleted", attachments: [] }
              : m
          )
        );
      } else {
        // e.g. "Message can only be deleted within 5 minutes of sending!"
        const data = await res.json().catch(() => null);
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: {
              message: data?.message || "Could not delete message",
              type: "error",
            },
          })
        );
      }
    } catch (err) {
      logger.error("Failed to delete message", err);
    }
    setContextMenu(null);
  };

	// ─── Drag-and-Drop Handlers ─────────────────────────────────
	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragActive(true);
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
			setIsDragActive(false);
		}
	}, []);

	const handleDrop = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragActive(false);
		const droppedFiles = Array.from(e.dataTransfer.files || []);
		if (droppedFiles.length === 0) return;
		const syntheticEvent = {
			target: { files: droppedFiles as any, value: "" },
		} as React.ChangeEvent<HTMLInputElement>;
		handleFileSelect(syntheticEvent);
	}, [handleFileSelect]);

  const handleEditSubmit = async () => {
    if (!editingMessage || !messageInput.trim()) return;
    try {
      const res = await apiFetch(
        `/api/communities/messages/${editingMessage._id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: messageInput.trim() }),
        }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        setMessages((prev) =>
          prev.map((m) =>
            m._id === editingMessage._id ? data.editedMessage : m
          )
        );
        setEditingMessage(null);
        setMessageInput("");
      }
    } catch (err) {
      logger.error("Failed to edit message", err);
    }
  };

  const handleReaction = async (message: CommunityMessage, emoji: string) => {
    const trimmedEmoji = emoji.trim();
    const optimisticReactions = [...(message.reactions || [])];
    const existingIndex = optimisticReactions.findIndex((r) => {
      const sId = typeof r.sender === "string" ? r.sender : r.sender?._id;
      return sId === userId && r.emoji === trimmedEmoji;
    });

    // Optimistic toggle/replace — ONE reaction per user. Clicking the same
    // emoji removes it; clicking a different one replaces the previous.
    let nextReactions = optimisticReactions.filter((r) => {
      const sId = typeof r.sender === "string" ? r.sender : r.sender?._id;
      return sId !== userId;
    });
    if (existingIndex < 0) {
      nextReactions = [
        ...nextReactions,
        {
          _id: Date.now().toString(), // temp ID
          emoji: trimmedEmoji,
          sender: {
            _id: user._id,
            username: user.username,
            fullName: user.fullName,
            profilePic: user.profilePic,
          },
          createdAt: new Date().toISOString(),
        } as any,
      ];
    }
    setMessages((prev) =>
      prev.map((m) =>
        m._id === message._id ? { ...m, reactions: nextReactions } : m,
      ),
    );

    try {
      const res = await apiFetch(
        `/api/communities/messages/${message._id}/reactions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emoji: trimmedEmoji }),
        },
      );
      const data = await res.json();
      if (res.ok && data.success) {
        // Sync with the exact backend response (server returns the full list)
        if (data.reactions) {
          setMessages((prev) =>
            prev.map((m) =>
              m._id === message._id
                ? { ...m, reactions: data.reactions }
                : m,
            ),
          );
        }
        // A reload must not serve the stale cached message list (which would
        // make the reaction appear "removed" — the cache holds the pre-reaction
        // snapshot). Evict the open community's message cache so the next load
        // re-fetches fresh data.
        evictCachedResponse(
          `/api/communities/${message.community}/messages?limit=30`,
        );
      } else {
        logger.error("Reaction failed", data?.message);
        setMessages((prev) =>
          prev.map((m) => (m._id === message._id ? message : m)),
        );
      }
    } catch (err) {
      logger.error("Failed to toggle reaction", err);
      setMessages((prev) =>
        prev.map((m) => (m._id === message._id ? message : m)),
      );
    }
  };

  // Viewport-safe positioning: after the context menu mounts, measure its
// ACTUAL dimensions and clamp it fully inside the VISIBLE viewport
// (visualViewport-aware, so mobile toolbars / the on-screen keyboard can't
// cut the bottom off).
useMenuViewportClamp(contextMenuRef, contextMenu);

// Viewport-safe positioning for the "My Communities" row context menu
useMenuViewportClamp(communityMenuRef, communityMenu);

// ─── Context menu handlers ─────────────────────────────────────
  // ─── Pin/Unpin handlers ──────────────────────────────────────
  // Apply the server-returned pinned list so the pin banner updates even if
  // the socket event is missed; show a toast when the server rejects the
  // action (previously every failure was silently swallowed).
  const showPinError = (err: any, fallback: string) => {
    const message =
      (typeof err === "object" && err !== null && err.message) || fallback;
    window.dispatchEvent(
      new CustomEvent("showToast", {
        detail: { message, type: "error" },
      }),
    );
  };

  const handlePinMessage = async (messageId: string) => {
    try {
      const res = await apiFetch(
        `/api/communities/messages/${messageId}/pin`,
        { method: "POST" },
      );
      const data = await res.json();
      if (res.ok && data?.success) {
        if (Array.isArray(data.pinnedMessages)) {
          setPinnedMessages(data.pinnedMessages);
        } else {
          // "Already pinned" responses omit the list — refetch so the banner
          // stays in sync even if the socket event was missed.
          const communityId = messages.find(
            (m) => m._id === messageId,
          )?.community;
          if (communityId) fetchPinnedMessages(communityId);
        }
      } else {
        showPinError(data, "Could not pin this message.");
      }
    } catch (err) {
      logger.error("Failed to pin message", err);
      showPinError(err, "Could not pin this message.");
    }
    setContextMenu(null);
  };

  const handleUnpinMessage = async (messageId: string) => {
    try {
      const res = await apiFetch(
        `/api/communities/messages/${messageId}/unpin`,
        { method: "POST" },
      );
      const data = await res.json();
      if (res.ok && data?.success) {
        if (Array.isArray(data.pinnedMessages)) {
          setPinnedMessages(data.pinnedMessages);
        }
      } else {
        showPinError(data, "Could not unpin this message.");
      }
    } catch (err) {
      logger.error("Failed to unpin message", err);
      showPinError(err, "Could not unpin this message.");
    }
    setContextMenu(null);
  };

  // Check if a message is currently pinned
  const isMessagePinned = (messageId: string) =>
    pinnedMessages.some((m) => m._id === messageId);

  // Timestamp ref to prevent synthetic click events on mobile from closing the
  // context menu immediately after a long-press (browsers fire click after touchend).
  const contextMenuOpenedAtRef = useRef(0);

  // Close context menu when clicking outside.
  // Uses a timestamp guard to ignore synthetic click events that mobile browsers
  // fire after touchend — these race with the long-press handler (500ms in MessageBubble)
  // and cause the menu to open and immediately close. Clicks more than 300ms after the
  // menu opened are real user clicks (e.g. tapping outside) and should close the menu.
  useEffect(() => {
    const handleClick = () => {
      if (Date.now() - contextMenuOpenedAtRef.current > 300) {
        setContextMenu(null);
      }
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  const handleContextMenu = (
    e: React.MouseEvent | { clientX: number; clientY: number; preventDefault: () => void },
    message: any
  ) => {
    e.preventDefault();
    // Initial position inside the VISIBLE viewport (visualViewport-aware on
    // mobile); the useMenuViewportClamp hook re-measures + corrects after
    // render so the menu can never be cut off.
    const vp = getVisibleViewport();
    const x = Math.min(
      Math.max(vp.left + 10, e.clientX),
      vp.left + vp.width - 10,
    );
    const y = Math.min(
      Math.max(vp.top + 10, e.clientY),
      vp.top + vp.height - 10,
    );
    // Record timestamp so the click-to-close handler can ignore synthetic
    // click events that mobile browsers fire immediately after touchend
    contextMenuOpenedAtRef.current = Date.now();
    setContextMenu({ x, y, message });
  };

  // ─── Formatting helpers ────────────────────────────────────────
  const formatMessageTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatDateSeparator = (isoString: string) => {
    const date = new Date(isoString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  };

  const shouldShowDateSeparator = (msg: CommunityMessage, index: number): boolean => {
    if (index === 0) return true;
    const prevMsg = messages[index - 1];
    if (!prevMsg) return true;
    const currDate = new Date(msg.createdAt).toDateString();
    const prevDate = new Date(prevMsg.createdAt).toDateString();
    return currDate !== prevDate;
  };

  const getGroupedReactions = (msg: CommunityMessage) => {
    const grouped: Record<string, { count: number; hasReacted: boolean }> = {};
    (msg.reactions || []).forEach((r: any) => {
      if (!grouped[r.emoji]) {
        grouped[r.emoji] = { count: 0, hasReacted: false };
      }
      grouped[r.emoji].count++;
      const senderId = typeof r.sender === "string" ? r.sender : r.sender?._id;
      if (senderId === userId) {
        grouped[r.emoji].hasReacted = true;
      }
    });
    return grouped;
  };

  // ─── Copy message to clipboard ─────────────────────────────
  const handleCopyMessage = async (message: CommunityMessage) => {
    if (message.text) {
      await navigator.clipboard.writeText(message.text);
    }
    setContextMenu(null);
  };

  // ─── Forward message ──────────────────────────────────────────────
  const fetchForwardConversations = useCallback(async () => {
    setLoadingForwardConvs(true);
    try {
      const res = await apiFetch("/api/chats/conversations");
      const data = await res.json();
      if (res.ok && data.success) {
        setForwardConversations(data.conversations || []);
      }
    } catch (err) {
      logger.error("Failed to fetch conversations for forward", err);
    } finally {
      setLoadingForwardConvs(false);
    }
  }, []);

  const handleToggleForwardSelection = (targetConversationId: string) => {
    setSelectedForwardConvIds((prev) => {
      if (prev.includes(targetConversationId)) {
        return prev.filter((id) => id !== targetConversationId);
      }
      if (prev.length >= 5) {
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: {
              message: "You can forward to a maximum of 5 conversations.",
              type: "error",
            },
          })
        );
        return prev;
      }
      return [...prev, targetConversationId];
    });
  };

  const handleExecuteForward = async () => {
    if (!forwardModal || selectedForwardConvIds.length === 0) return;
    try {
      const originalMessage = forwardModal.message;
      const senderName = originalMessage.sender.fullName || originalMessage.sender.username;
      const originalText = originalMessage.text;

      await Promise.all(
        selectedForwardConvIds.map(async (targetConvId) => {
          const formData = new FormData();
          const forwardedText = originalText
            ? `Forwarded from @${senderName}: ${originalText}`
            : `Forwarded from @${senderName}`;
          formData.append("text", forwardedText);
          formData.append("forwardedFrom", originalMessage._id);

          if (originalMessage.attachments && originalMessage.attachments.length > 0) {
            formData.append("forwardedAttachments", JSON.stringify(originalMessage.attachments));
          }

          await apiFetch(`/api/chats/conversations/${targetConvId}/messages`, {
            method: "POST",
            body: formData,
          });
        })
      );

      setForwardModal(null);
      setSelectedForwardConvIds([]);
      setForwardConversations([]);
    } catch (err) {
      logger.error("Failed to forward message", err);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Failed to forward message. Please try again.", type: "error" },
        })
      );
    }
  };

  // ─── Join/Leave community ──────────────────────────────────────
  const handleJoinCommunity = async (communityId: string) => {
    if (joiningCommunities.has(communityId)) return;

    setJoiningCommunities((prev) => new Set(prev).add(communityId));
    try {
      const res = await apiFetch(`/api/communities/${communityId}/join`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        // ── Private community: the join became a PENDING REQUEST ──
        if (data.pending) {
          setAllCommunities((prev) =>
            prev.map((c) =>
              c._id === communityId ? { ...c, pendingRequest: true } : c
            )
          );
          setSelectedCommunity((prev) =>
            prev?._id === communityId ? { ...prev, pendingRequest: true } : prev
          );
          window.dispatchEvent(
            new CustomEvent("showToast", {
              detail: {
                message: "Join request sent — an admin will review it.",
                type: "success",
              },
            }),
          );
          return;
        }

        // Find the community in allCommunities to get its full data
        const joinedCommunity = allCommunities.find((c) => c._id === communityId);
        const updatedCommunity = joinedCommunity
          ? { ...joinedCommunity, isMember: true, memberCount: data.memberCount }
          : null;

        setAllCommunities((prev) =>
          prev.map((c) =>
            c._id === communityId
              ? { ...c, isMember: true, memberCount: data.memberCount }
              : c
          )
        );

        // Join the community room immediately for live member count updates
        if (socket) {
          socket.emit("community:join", { communityId });
        }

        // Evict stale caches so the joined community appears in
        // "My Communities" instantly (apiFetch is cache-first and would
        // otherwise serve the old list without the new membership).
        await Promise.all([
          evictCachedResponse("/api/communities/mine"),
          evictCachedResponse("/api/communities?limit=50"),
          evictCachedResponse(`/api/communities/${communityId}/messages?limit=30`),
        ]);

        // Refresh my communities
        await fetchMyCommunities();

        // Auto-open the community chat after joining
        if (updatedCommunity) {
          handleSelectCommunity(updatedCommunity);
        }
      }
    } catch (err) {
      logger.error("Failed to join community", err);
    } finally {
      setJoiningCommunities((prev) => {
        const next = new Set(prev);
        next.delete(communityId);
        return next;
      });
    }
  };

  // ─── Join via invite code (works for public AND private communities) ───
  const handleJoinViaInvite = async () => {
    const code = (pendingInviteCodeRef.current || inviteCodeInput).trim();
    pendingInviteCodeRef.current = "";
    if (!code || joiningInvite) return;
    setJoiningInvite(true);
    try {
      const res = await apiFetch("/api/communities/join/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setInviteCodeInput("");
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: { message: "Joined community via invite! 🎉", type: "success" },
          }),
        );
        await Promise.all([
          evictCachedResponse("/api/communities/mine"),
          evictCachedResponse("/api/communities?limit=50"),
        ]);
        await fetchMyCommunities();
        // Open the community chat directly.
        if (data.communityId) {
          try {
            const detailRes = await apiFetch(`/api/communities/${data.communityId}`);
            const detail = await detailRes.json();
            if (detailRes.ok && detail.success) {
              handleSelectCommunity(detail.community);
              return;
            }
          } catch { /* fall through to the list */ }
        }
        setCommunityTab("mine");
      } else {
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: { message: data.message || "Invalid invite code.", type: "error" },
          }),
        );
      }
    } catch (err) {
      logger.error("Join via invite failed", err);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Couldn't join with that code.", type: "error" },
        }),
      );
    } finally {
      setJoiningInvite(false);
    }
  };

  const handleLeaveCommunity = async (communityId: string) => {
    try {
      const res = await apiFetch(`/api/communities/${communityId}/leave`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMyCommunities((prev) => prev.filter((c) => c._id !== communityId));
        setAllCommunities((prev) =>
          prev.map((c) =>
            c._id === communityId ? { ...c, isMember: false, memberCount: data.memberCount } : c
          )
        );
        if (selectedCommunity?._id === communityId) {
          setView("list");
          setSelectedCommunity(null);
          setMessages([]);
          setCursor(null);
          setHasMore(true);
        }
        // Evict stale caches so the left community disappears from
        // "My Communities" and its cached messages can't be re-shown
        // if the user rejoins (server hides pre-rejoin history anyway).
        await Promise.all([
          evictCachedResponse("/api/communities/mine"),
          evictCachedResponse("/api/communities?limit=50"),
          evictCachedResponse(`/api/communities/${communityId}/messages?limit=30`),
        ]);
        // Refresh from server to ensure consistency (e.g. stale cache edge cases)
        await fetchMyCommunities();
      }
    } catch (err) {
      logger.error("Failed to leave community", err);
    }
  };

  // ─── Polls ──────────────────────────────────────────────────────────
  // Optimistically toggle the current user's vote on a poll option (the
  // server applies the same single/multi-choice semantics, so applying the
  // toggle again reverts on failure).
  const applyPollVote = (messageId: string, optionIndex: number) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m._id !== messageId || !m.poll) return m;
        const poll = m.poll;
        const target = poll.options[optionIndex];
        if (!target) return m;
        const votedOnTarget = target.voters.includes(userId);
        let options = poll.options.map((o) => ({
          ...o,
          voters: [...o.voters],
        }));
        if (poll.allowMultiple) {
          options[optionIndex].voters = votedOnTarget
            ? options[optionIndex].voters.filter((id) => id !== userId)
            : [...options[optionIndex].voters, userId];
        } else {
          // Single choice — clear everywhere, then add to the chosen one.
          options = options.map((o) => ({
            ...o,
            voters: o.voters.filter((id) => id !== userId),
          }));
          if (!votedOnTarget) {
            options[optionIndex].voters = [...options[optionIndex].voters, userId];
          }
        }
        return { ...m, poll: { ...poll, options } };
      }),
    );
  };

  const handleVotePoll = async (msg: CommunityMessage, optionIndex: number) => {
    if (!msg.poll) return;
    if (
      msg.poll.endsAt &&
      new Date(msg.poll.endsAt).getTime() < Date.now()
    ) {
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: {
            message: "This poll has ended.",
            type: "error",
          },
        }),
      );
      return;
    }
    applyPollVote(msg._id, optionIndex);
    try {
      const res = await apiFetch(
        `/api/communities/messages/${msg._id}/vote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ optionIndex }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        applyPollVote(msg._id, optionIndex); // revert
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: {
              message: data.message || "Couldn't vote. Try again.",
              type: "error",
            },
          }),
        );
      }
    } catch {
      applyPollVote(msg._id, optionIndex); // revert
    }
  };

  // ─── Starred messages (community) ───────────────────────────────────
  const applyCommunityStar = (messageId: string, starred: boolean) => {
    setMessages((prev) =>
      prev.map((m) =>
        m._id === messageId
          ? {
              ...m,
              savedBy: starred
                ? [...new Set([...(m.savedBy || []), userId])]
                : (m.savedBy || []).filter((id) => id !== userId),
            }
          : m,
      ),
    );
  };

  const handleToggleCommunityStar = async (msg: CommunityMessage) => {
    const target = !(msg.savedBy || []).includes(userId);
    setContextMenu(null);
    applyCommunityStar(msg._id, target);
    try {
      const res = await apiFetch(
        `/api/communities/messages/${msg._id}/star`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to save message");
      }
    } catch {
      applyCommunityStar(msg._id, !target);
    }
  };

  // ─── Leave community (chat header OR "My Communities" list row) ───
  const handleLeaveCurrentCommunity = async () => {
    const targetId = pendingLeaveCommunityId || selectedCommunity?._id;
    if (!targetId || leavingCommunity) return;
    setLeavingCommunity(true);
    await handleLeaveCommunity(targetId);
    setLeavingCommunity(false);
    setConfirmLeaveOpen(false);
    setPendingLeaveCommunityId(null);
  };

  const promptLeaveCommunity = () => {
    // Header leave always targets the currently-open community
    setPendingLeaveCommunityId(null);
    setConfirmLeaveOpen(true);
  };

  const cancelLeaveCommunity = () => {
    setConfirmLeaveOpen(false);
    setPendingLeaveCommunityId(null);
  };

  // ─── "My Communities" row context menu (long-press / right-click) ───
  const openCommunityMenu = (
    e: { clientX: number; clientY: number },
    community: Community
  ) => {
    setCommunityMenu({ x: e.clientX, y: e.clientY, community });
  };

  // 500ms hold opens the menu (same feel as chat messages); scroll cancels.
  const handleCommunityTouchStart = (
    e: React.TouchEvent,
    community: Community
  ) => {
    if (communityLongPressTimerRef.current) {
      clearTimeout(communityLongPressTimerRef.current);
      communityLongPressTimerRef.current = null;
    }
    communitySuppressClickRef.current = false;
    const touch = e.touches[0];
    if (!touch) return;
    communityLongPressTimerRef.current = setTimeout(() => {
      communitySuppressClickRef.current = true;
      openCommunityMenu(
        { clientX: touch.clientX, clientY: touch.clientY },
        community
      );
    }, 500);
  };

  const handleCommunityTouchMove = () => {
    if (communityLongPressTimerRef.current) {
      clearTimeout(communityLongPressTimerRef.current);
      communityLongPressTimerRef.current = null;
    }
  };

  const handleCommunityTouchEnd = () => {
    if (communityLongPressTimerRef.current) {
      clearTimeout(communityLongPressTimerRef.current);
      communityLongPressTimerRef.current = null;
    }
  };

  const handleToggleCommunityMute = async (community: Community) => {
    const next = !community.muted;
    // Optimistic flip — instant, then reconciled with the server response.
    const patch = (c: Community) =>
      c._id === community._id ? { ...c, muted: next } : c;
    setMyCommunities((prev) => prev.map(patch));
    setAllCommunities((prev) => prev.map(patch));
    setCommunityMenu(null);
    try {
      const res = await apiFetch(
        `/api/communities/${community._id}/${next ? "mute" : "unmute"}`,
        { method: "POST" }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: {
              message: next
                ? "Community notifications muted"
                : "Community notifications unmuted",
              type: "success",
            },
          })
        );
        // A reload must not serve the stale cached list without the new flag
        evictCachedResponse("/api/communities/mine");
      } else {
        setMyCommunities((prev) =>
          prev.map((c) => (c._id === community._id ? community : c))
        );
        setAllCommunities((prev) =>
          prev.map((c) => (c._id === community._id ? community : c))
        );
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: {
              message: data?.message || "Couldn't update mute setting.",
              type: "error",
            },
          })
        );
      }
    } catch (err) {
      logger.error("Failed to toggle community mute", err);
      setMyCommunities((prev) =>
        prev.map((c) => (c._id === community._id ? community : c))
      );
      setAllCommunities((prev) =>
        prev.map((c) => (c._id === community._id ? community : c))
      );
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: {
            message: "Couldn't update mute setting. Try again.",
            type: "error",
          },
        })
      );
    }
  };

  // ─── Unified send executor (matching personal Chat.tsx) ────────
  // Every optimistic send (text, media, voice notes, retries) routes through
  // here. Network failures KEEP the bubble pending as "queued" (clock icon)
  // instead of failing it — the online listener re-pumps queued sends, so an
  // offline blip never loses a message. Server rejections still mark failed.
  const performCommunitySend = async (
    pendingId: string,
    communityId?: string
  ): Promise<"ok" | "failed" | "retry"> => {
    const payload = unsentPayloadsRef.current[pendingId];
    // First send: the optimistic message isn't in `messages` state yet (React
    // updates async) — callers pass the community id explicitly. Retries look
    // it up from the array (the message is already rendered).
    const optimistic = messages.find((m) => m._id === pendingId);
    const targetCommunityId =
      communityId || optimistic?.community || selectedCommunity?._id;
    if (!payload || !targetCommunityId) return "failed";

    const controller = new AbortController();
    activeUploadsRef.current[pendingId] = controller;
    setUploadProgress((prev) => ({ ...prev, [pendingId]: 0 }));

    const markQueued = () => {
      setMessages((prev) =>
        prev.map((m) =>
          m._id === pendingId
            ? { ...m, _pending: true, _queued: true, _failed: false }
            : m
        )
      );
      delete activeUploadsRef.current[pendingId];
    };
    const markFailed = (message?: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m._id === pendingId
            ? { ...m, _pending: false, _failed: true }
            : m
        )
      );
      delete activeUploadsRef.current[pendingId];
      delete unsentPayloadsRef.current[pendingId];
      if (message) setSendingError(message);
    };
    const resolveSent = (sentMessage: any) => {
      delete unsentPayloadsRef.current[pendingId];
      delete activeUploadsRef.current[pendingId];
      setMessages((prev) =>
        replacePendingWithSent(prev, pendingId, sentMessage)
      );
      setSendingError(null);
    };

    try {
      const formData = new FormData();
      if (payload.type === "voice_note") {
        formData.append("text", "");
        if (payload.room) formData.append("room", payload.room);
        const blobMime = payload.blob.type || "audio/webm";
        const ext =
          blobMime.includes("mp4") || blobMime.includes("aac")
            ? "mp4"
            : blobMime.includes("ogg")
              ? "ogg"
              : blobMime.includes("wav")
                ? "wav"
                : "webm";
        const audioFile = new File(
          [payload.blob],
          `voice-${Date.now()}.${ext}`,
          { type: blobMime }
        );
        formData.append("files", audioFile);
        formData.append("duration", String(payload.duration));
      } else {
        formData.append("text", payload.text || "");
        if (payload.room) formData.append("room", payload.room);
        for (const file of payload.files || []) {
          // Downscale photos before upload (shared util) — keeps sends fast.
          // Skip the re-encode when the file was already downscaled at send
          // time (see handleSendMessage) so it never runs twice.
          formData.append(
            "files",
            file.type.startsWith("image/") &&
              !(payload as any).fileDownscaled
              ? await downscaleImageFile(file)
              : file
          );
        }
      }
      if (payload.replyToId) {
        formData.append("replyTo", payload.replyToId);
      }
      if (payload.type === "message" && payload.scheduledAt) {
        formData.append("scheduledAt", payload.scheduledAt);
      }

      const res = await uploadWithProgress(
        `/api/communities/${targetCommunityId}/messages`,
        {
          method: "POST",
          body: formData,
          signal: controller.signal,
          onProgress: (p) =>
            setUploadProgress((prev) => ({ ...prev, [pendingId]: p })),
        }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        resolveSent(data.sentMessage || data.message || data.editedMessage);
        return "ok";
      }
      // Discord-style slowmode: keep the message queued (clock icon), arm a
      // countdown, and auto-resend the moment the window elapses. The server
      // returns structured retryAfterSeconds; fall back to parsing the human
      // message for older deploys.
      const slowSeconds =
        typeof data?.retryAfterSeconds === "number"
          ? data.retryAfterSeconds
          : typeof data?.message === "string" &&
              /in (\d+)s/.test(data.message)
            ? Number(data.message.match(/in (\d+)s/)?.[1])
            : null;
      if (slowSeconds && slowSeconds > 0) {
        const until = Date.now() + slowSeconds * 1000;
        setSlowmodeUntil(until);
        slowmodeRetryPendingRef.current = pendingId;
        // Keep the bubble with the clock icon — it sends when the timer hits 0.
        markQueued();
        return "retry";
      }
      markFailed(data?.message || "Failed to send message");
      return "failed";
    } catch (err: any) {
      if (err?.name === "AbortError") return "ok";
      const offline =
        !navigator.onLine ||
        err?.name === "TypeError" ||
        err?.message?.includes("fetch") ||
        err?.message?.includes("network") ||
        err?.message?.includes("NetworkError");
      if (offline) {
        // WhatsApp clock-icon behavior: keep the bubble, retry on reconnect.
        markQueued();
        return "retry";
      }
      markFailed("Failed to send message");
      logger.error("Community send failed", err);
      return "failed";
    } finally {
      delete activeUploadsRef.current[pendingId];
    }
  };

  // Manual retry from the failed bubble.
  const handleRetrySend = async (pendingId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m._id === pendingId
          ? { ...m, _pending: true, _failed: false, _queued: false }
          : m
      )
    );
    await performCommunitySend(pendingId);
  };

  // Re-pump queued sends when connectivity returns — matches the personal
  // chat's resume-on-online behavior. Kept behind a ref so the one-time
  // listener below always calls the latest closure.
  const retryQueuedCommunitySends = () => {
    const queued = messages.filter(
      (m) => (m as any)._queued || (m as any)._pending
    );
    for (const m of queued) {
      if (unsentPayloadsRef.current[m._id]) {
        void performCommunitySend(m._id);
      }
    }
  };
  const retryQueuedRef = useRef(retryQueuedCommunitySends);
  retryQueuedRef.current = retryQueuedCommunitySends;
  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      retryQueuedRef.current();
    };
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // ─── Handle community created ──────────────────────────────────
  const handleCommunityCreated = (community: Community) => {
    setMyCommunities((prev) => [community, ...prev]);
    setAllCommunities((prev) => [community, ...prev]);
    // Evict cached lists so the new community shows everywhere immediately
    evictCachedResponse("/api/communities/mine");
    evictCachedResponse("/api/communities?limit=50");
  };

  // ─── Handle community updated ──────────────────────────────────
  const handleCommunityUpdated = (updated: Community) => {
    setMyCommunities((prev) =>
      prev.map((c) => (c._id === updated._id ? updated : c))
    );
    setAllCommunities((prev) =>
      prev.map((c) => (c._id === updated._id ? updated : c))
    );
    setSelectedCommunity((prev) =>
      prev?._id === updated._id ? updated : prev
    );	// Refresh both lists from server to ensure data consistency (e.g. image URL).
	// Bypass the cache: the mutation just changed community flags (audio/video
	// calls, messaging) and a cache-first read could serve the OLD values,
	// making the toggle look like it "reverted" after reopening the community.
	fetchMyCommunities(true);
	fetchAllCommunities(true);
  };

  // ─── Handle community deleted ──────────────────────────────────
  // ─── Group Call (LiveKit) ────────────────────────────────────────
  const handleGroupCall = async (callType: "audio" | "video") => {
    if (!selectedCommunity || startingCall) return;
    setStartingCall(true);
    setGroupCallType(callType);
    try {
      const res = await apiFetch(
        `/api/communities/${selectedCommunity._id}/livekit-token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: callType }),
        },
      );
      const data = await res.json();
      if (res.ok && data.success && data.token) {
        setGroupCallToken(data.token);
        setGroupCallRoomName(data.roomName);
        setGroupCallUrl(data.livekitUrl);
        setShowGroupCall(true);
        // Announce the call to the community room so other members see a
        // "Join call" banner and can connect to the SAME LiveKit room.
        socket?.emit("community:call-started", {
          communityId: selectedCommunity._id,
          roomName: data.roomName,
          type: callType,
        });
        setActiveCommunityCall({
          roomName: data.roomName,
          type: callType,
          startedBy: userId,
        });
      } else {
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: {
              message: data?.message || "Failed to start group call. LiveKit may not be configured.",
              type: "error",
            },
          }),
        );
      }
    } catch (err) {
      logger.error("Failed to start group call", err);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: {
            message: "Failed to start group call. Please try again.",
            type: "error",
          },
        }),
      );
    } finally {
      setStartingCall(false);
    }
  };

  const handleCommunityDeleted = (communityId: string) => {
    setMyCommunities((prev) => prev.filter((c) => c._id !== communityId));
    setAllCommunities((prev) => prev.filter((c) => c._id !== communityId));
    if (selectedCommunity?._id === communityId) {
      setView("list");
      setSelectedCommunity(null);
    }
  };

  // ─── Load more messages (scroll up) ────────────────────────────
  const handleLoadMore = () => {
    if (selectedCommunity && hasMore && !loadingMessages) {
      fetchMessages(selectedCommunity._id, cursor);
    }
  };

  // ─── Rooms (channels) — switch / create / rename / delete ──────────
  const handleSelectRoom = (roomId: string | null) => {
    if (roomId === activeRoomRef.current) return;
    activeRoomRef.current = roomId;
    setActiveRoom(roomId);
    // Close the three-dot channel menu (it belongs to the previous room).
    setRoomMenu(null);
    // Reset thread state for the new room.
    setMessages([]);
    setHasMore(true);
    setCursor(null);
    setReplyTo(null);
    setEditingMessage(null);
    setPinnedMessages([]);
    setShowMessageSearch(false);
    setMessageSearchQuery("");
    setSearchResults([]);
    if (selectedCommunity) {
      fetchMessages(selectedCommunity._id);
      fetchPinnedMessages(selectedCommunity._id);
    }
  };

  const applyRoomCommunity = (community: Community) => {
    setSelectedCommunity(community);
    setMyCommunities((prev) =>
      prev.map((c) => (c._id === community._id ? community : c))
    );
    setAllCommunities((prev) =>
      prev.map((c) =>
        c._id === community._id
          ? { ...community, isMember: c.isMember ?? community.isMember }
          : c
      )
    );
  };

  const handleCreateRoom = async () => {
    if (!selectedCommunity || roomSaving) return;
    const name = roomNameInput.trim();
    if (!name) return;
    setRoomSaving(true);
    try {
      const res = await apiFetch(
        `/api/communities/${selectedCommunity._id}/rooms`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            type: roomTypeInput,
            slowModeSeconds: roomSlowModeInput,
          }),
        }
      );
      const data = await res.json();
      if (res.ok && data.success && data.community) {
        applyRoomCommunity(data.community);
        // Jump straight into the newly created room.
        const created = (data.community.rooms || []).find(
          (r: any) => r.name === name
        );
        if (created) {
          activeRoomRef.current = created._id;
          setActiveRoom(created._id);
          setMessages([]);
          setHasMore(true);
          setCursor(null);
          fetchMessages(data.community._id);
        }
        setRoomModal(null);
        setRoomNameInput("");
        setRoomTypeInput("text");
        setRoomSlowModeInput(0);
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: { message: "Room created!", type: "success" },
          })
        );
      } else {
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: {
              message: data.message || "Could not create room.",
              type: "error",
            },
          })
        );
      }
    } catch (err) {
      logger.error("Failed to create room", err);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Could not create room.", type: "error" },
        })
      );
    } finally {
      setRoomSaving(false);
    }
  };

  const handleRenameRoom = async () => {
    if (!selectedCommunity || !roomModal || roomModal.mode !== "rename") return;
    const name = roomNameInput.trim();
    if (!name || roomSaving) return;
    setRoomSaving(true);
    try {
      const res = await apiFetch(
        `/api/communities/${selectedCommunity._id}/rooms/${roomModal.roomId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            slowModeSeconds: roomSlowModeInput,
          }),
        }
      );
      const data = await res.json();
      if (res.ok && data.success && data.community) {
        applyRoomCommunity(data.community);
        setRoomModal(null);
        setRoomNameInput("");
        setRoomSlowModeInput(0);
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: { message: "Room renamed!", type: "success" },
          })
        );
      } else {
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: {
              message: data.message || "Could not rename room.",
              type: "error",
            },
          })
        );
      }
    } catch (err) {
      logger.error("Failed to rename room", err);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Could not rename room.", type: "error" },
        })
      );
    } finally {
      setRoomSaving(false);
    }
  };

  const handleDeleteRoom = async () => {
    if (!selectedCommunity || !roomToDelete) return;
    try {
      const res = await apiFetch(
        `/api/communities/${selectedCommunity._id}/rooms/${roomToDelete.roomId}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (res.ok && data.success && data.community) {
        applyRoomCommunity(data.community);
        // If the room we were viewing was deleted, bounce to general.
        if (activeRoomRef.current === roomToDelete.roomId) {
          activeRoomRef.current = null;
          setActiveRoom(null);
          setMessages([]);
          setHasMore(true);
          setCursor(null);
          fetchMessages(data.community._id);
        }
        setRoomToDelete(null);
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: { message: "Room deleted.", type: "success" },
          })
        );
      } else {
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: {
              message: data.message || "Could not delete room.",
              type: "error",
            },
          })
        );
      }
    } catch (err) {
      logger.error("Failed to delete room", err);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Could not delete room.", type: "error" },
        })
      );
    }
  };

  // ─── Render Community List ─────────────────────────────────────
  const renderCommunityList = () => {
    const filteredCommunities =
      (communityTab === "mine" ? myCommunities : allCommunities).filter(
        (c) =>
          matchesSearchTokens(c.name, searchQuery) ||
          (c.description && matchesSearchTokens(c.description, searchQuery))
      );

    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-zinc-800/50 shrink-0">
          <div className="flex items-center gap-2">
            <Hash className="h-4 w-4 text-zinc-400" />						<h2 className="text-display-xs text-gradient-aurora">Communities</h2>
          </div>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Create Community"
          >
            <Plus className="h-4 w-4 text-zinc-400" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800/50 shrink-0">
          <button
            onClick={() => {
              setCommunityTab("mine");
              setSearchQuery("");
            }}
            className={`flex-1 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
              communityTab === "mine"
                ? "text-white border-b-2 border-white"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            My Communities
          </button>
          <button
            onClick={() => {
              setCommunityTab("browse");
              setSearchQuery("");
            }}
            className={`flex-1 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
              communityTab === "browse"
                ? "text-white border-b-2 border-white"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Browse All
          </button>
        </div>

        {/* Search */}
        <div className="px-3 sm:px-4 py-2 shrink-0">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-500">
              <Search className="h-3.5 w-3.5" />
            </span>
            <input
              type="text"
              placeholder="Search communities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-full border border-zinc-800 bg-zinc-950/50 py-2 pl-9 pr-4 text-[12px] font-bold text-white placeholder-zinc-500 focus:outline-none focus:border-white focus:bg-zinc-900 transition-all"
            />
          </div>

          {/* Join by invite code — the entry point for private communities */}
          <div className="mt-2 flex items-center gap-1.5">
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-500">
                <Link2 className="h-3 w-3" />
              </span>
              <input
                type="text"
                placeholder="Have an invite code? Paste it here"
                value={inviteCodeInput}
                onChange={(e) => setInviteCodeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleJoinViaInvite();
                  }
                }}
                className="w-full rounded-full border border-dashed border-zinc-800 bg-zinc-950/30 py-1.5 pl-8 pr-3 text-[11px] text-white placeholder-zinc-600 focus:outline-none focus:border-white/50 transition-all"
              />
            </div>
            <button
              onClick={handleJoinViaInvite}
              disabled={joiningInvite || !inviteCodeInput.trim()}
              className="rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-40 px-3 py-1.5 text-[10px] font-bold text-white transition-all cursor-pointer disabled:cursor-not-allowed flex items-center gap-1"
            >
              {joiningInvite ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogIn className="h-3 w-3" />}
              Join
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-5 w-5 text-zinc-500 animate-spin" />
            </div>
          ) : filteredCommunities.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-6">
              <Hash className="h-10 w-10 text-zinc-700 mb-3" />
              <p className="text-sm font-semibold text-zinc-400 mb-1">
                {communityTab === "mine"
                  ? "No communities yet"
                  : "No communities found"}
              </p>
              <p className="text-[11px] text-zinc-400 mb-4">
                {communityTab === "mine"
                  ? "Create or join a community to get started"
                  : "Be the first to create one!"}
              </p>
              {communityTab === "mine" && (
                <button
                  onClick={() => setCreateModalOpen(true)}
                  className="rounded-full bg-aurora hover:opacity-90 px-4 py-2 text-xs font-bold text-white border border-white/10 shadow-aurora transition-all cursor-pointer shrink-0 [background-clip:padding-box]"
                >
                  Create Community
                </button>
              )}
            </div>
          ) : (
            <div className="py-2">
              {filteredCommunities.map((community) => (
                <div
                  key={community._id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    // A long-press fires a synthetic click on release — swallow it
                    // so the menu doesn't instantly open the chat.
                    if (communitySuppressClickRef.current) {
                      communitySuppressClickRef.current = false;
                      return;
                    }
                    if (community.isMember) {
                      handleSelectCommunity(community);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (community.isMember) {
                        handleSelectCommunity(community);
                      }
                    }
                  }}
                  onContextMenu={(e) => {
                    if (!community.isMember) return;
                    e.preventDefault();
                    openCommunityMenu(
                      { clientX: e.clientX, clientY: e.clientY },
                      community
                    );
                  }}
                  onTouchStart={(e) => {
                    if (community.isMember)
                      handleCommunityTouchStart(e, community);
                  }}
                  onTouchMove={handleCommunityTouchMove}
                  onTouchEnd={handleCommunityTouchEnd}					  className={`w-full flex items-center gap-3 px-4 sm:px-5 py-3 transition-all text-left group ${
					    community.isMember
					      ? "hover:bg-zinc-900/50 cursor-pointer"
					      : "cursor-default opacity-80"
					  }`}
					  >
					  <div className="h-10 w-10 rounded-full bg-zinc-800 flex items-center justify-center shrink-0 border border-zinc-700/50 overflow-hidden">
                    {community.image?.url ? (
                      <img
                        src={optimizeImageUrl(community.image.url, 80)}
                        alt={community.name}
                        className="h-full w-full rounded-full object-cover cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.dispatchEvent(new CustomEvent("openImagePreview", { detail: community.image!.url }));
                        }}
                      />
                    ) : (
                      <Hash className="h-5 w-5 text-zinc-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-white truncate flex items-center gap-1.5">
                      {community.name}
                      {community.isSimulated && (
                        <span
                          title="Created by simulated users — the members here are bots"
                          className="shrink-0 rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-violet-300"
                        >
                          Simulated
                        </span>
                      )}
                    </h3>
                    <p className="text-[11px] text-zinc-500 truncate">
                      {communityTab === "browse" ? (
                        // Browse tab: show the community bio (member count +
                        // description) instead of last-message activity — so
                        // browsing feels like discovering communities, not
                        // peeking into private conversations.
                        <>
                          {community.memberCount} member{community.memberCount !== 1 ? "s" : ""}
                          {community.description ? (
                            <>
                              {" "}·{" "}
                              {/* Plain text, not linkified — this is a list
                                  card; the whole card opens the community. A
                                  clickable anchor here would navigate away to
                                  the URL instead. */}
                              {community.description}
                            </>
                          ) : null}
                        </>
                      ) : community.lastMessage || community.lastAction ? (
                        <CommunityLastActivity
                          lastMessage={community.lastMessage}
                          lastAction={community.lastAction}
                          currentUserId={userId}
                        />
                      ) : (
                        <>
                          {community.memberCount} member{community.memberCount !== 1 ? "s" : ""}
                          {community.description ? (
                            <>
                              {" "}·{" "}
                              {/* Plain text, not linkified — see browse-tab
                                  branch above (list cards must not contain
                                  tappable anchors). */}
                              {community.description}
                            </>
                          ) : null}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="shrink-0">
                    {community.isMember ? (
                      communityTab === "mine" ? (
                        community.muted ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-zinc-500 bg-zinc-800/60 px-2.5 py-1 rounded-full">
                            <BellOff className="h-3 w-3" />
                            Muted
                          </span>
                        ) : null
                      ) : (
                        <span className="text-[10px] font-bold text-zinc-300 bg-white/10 px-2.5 py-1 rounded-full">
                          Open
                        </span>
                      )
                    ) : community.pendingRequest ? (
                      <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full inline-flex items-center gap-1.5">
                        <Hourglass className="h-3 w-3" />
                        Pending
                      </span>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleJoinCommunity(community._id);
                        }}
                        disabled={joiningCommunities.has(community._id)}
                        className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full hover:bg-emerald-500/20 transition-all inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {joiningCommunities.has(community._id) ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : null}
                        {joiningCommunities.has(community._id)
                          ? "Joining..."
                          : community.privacy === "private"
                            ? "Request"
                            : "Join"}
                      </button>
                    )}
                  </div>                </div>
              ))}
            </div>
          )
        }
        </div>
      </div>
    );
  };

  // ─── Render Community Chat ─────────────────────────────────────
  const renderCommunityChat = () => {
    if (!selectedCommunity) return null;

    const isInCommunity = selectedCommunity.isMember ?? 
      myCommunities.some((c) => c._id === selectedCommunity._id);

    // Members currently online (excludes self) — drives the green-dot
    // "active now" indicator in the chat header, like personal chat presence.
    const onlineMembers = (selectedCommunity.members || []).filter(
      (m) =>
        m.user?._id &&
        m.user._id !== userId &&
        onlineUsersRef.current.has(m.user._id),
    );

    // If not a member, show join prompt
    if (!isInCommunity) {
      return (
        <div className="h-full flex flex-col">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/50 shrink-0">
          <button
            onClick={() => {
              userClosedCommunityRef.current =
                selectedCommunity?._id ?? null;
              setView("list");
              setSelectedCommunity(null);
            }}
            className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4 text-zinc-400" />
          </button>
            <div className="h-9 w-9 rounded-xl bg-zinc-800 flex items-center justify-center">
              <Hash className="h-5 w-5 text-zinc-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">{selectedCommunity.name}</h3>
              <p className="text-[10px] text-zinc-500">{selectedCommunity.memberCount} members</p>
            </div>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
            <Users className="h-10 w-10 text-zinc-700 mb-3" />
            <p className="text-sm font-semibold text-zinc-400 mb-1">
              You're not a member of this community
            </p>
            <p className="text-[11px] text-zinc-400 mb-4">
              {selectedCommunity.privacy === "private"
                ? "This community is private — admins approve who joins."
                : "Join to see messages and participate in the conversation"}
            </p>
            {selectedCommunity.pendingRequest ? (
              <div className="flex flex-col items-center gap-2">
                <button
                  disabled
                  className="rounded-full bg-zinc-800 text-zinc-400 px-5 py-2.5 text-xs font-bold inline-flex items-center gap-2 cursor-not-allowed"
                >
                  <Hourglass className="h-3.5 w-3.5" />
                  Request Pending
                </button>
                <button
                  onClick={async () => {
                    try {
                      await apiFetch(`/api/communities/${selectedCommunity._id}/join-requests/cancel`, {
                        method: "POST",
                      });
                      setSelectedCommunity((prev) => prev ? { ...prev, pendingRequest: false } : prev);
                      setAllCommunities((prev) =>
                        prev.map((c) => c._id === selectedCommunity._id ? { ...c, pendingRequest: false } : c)
                      );
                    } catch {}
                  }}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 underline underline-offset-2 transition-colors cursor-pointer"
                >
                  Cancel request
                </button>
              </div>
            ) : (
              <button
                onClick={() => handleJoinCommunity(selectedCommunity._id)}
                disabled={joiningCommunities.has(selectedCommunity._id)}
                className="rounded-full bg-aurora hover:opacity-90 disabled:bg-zinc-800 disabled:text-zinc-600 px-5 py-2.5 text-xs font-bold text-white border border-white/10 shadow-aurora transition-all cursor-pointer disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                {joiningCommunities.has(selectedCommunity._id) ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {selectedCommunity.privacy === "private" ? "Requesting..." : "Joining..."}
                  </>
                ) : selectedCommunity.privacy === "private" ? (
                  <>
                    <Lock className="h-3.5 w-3.5" />
                    Request to Join
                  </>
                ) : (
                  "Join Community"
                )}
              </button>
            )}
          </div>
        </div>
      );
    }

    // Rooms (channels) — the first room is the protected "general" room.
    const roomsList = selectedCommunity.rooms || [];
    const isRoomAdmin =
      selectedCommunity.creator?._id === userId ||
      (selectedCommunity.admins || []).includes(userId);
    const activeRoomId = activeRoom; // null = general
    const activeRoomObj = activeRoomId
      ? (selectedCommunity.rooms || []).find((r) => r._id === activeRoomId)
      : null;
    // Announcement channels: moderators+ post (@everyone pings); members are
    // read-only — mirrors the server-side enforcement in sendCommunityMessage.
    const isAnnouncementRoom = activeRoomObj?.type === "announcement";
    const canPostHere =
      canPost(selectedCommunity) &&
      (!isAnnouncementRoom || isModeratorOf(selectedCommunity));

    return (
      <div className="h-full">
        {/* Main chat column — the unified Channels bar lives inside it, so
            rooms feel like a native part of the community, not a separate
            panel */}
        <div className="flex-1 min-w-0 h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/50 shrink-0">
          <button
            onClick={() => {
              userClosedCommunityRef.current =
                selectedCommunity?._id ?? null;
              setView("list");
              setSelectedCommunity(null);
            }}
            className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4 text-zinc-400" />
          </button>
          <div className="h-9 w-9 rounded-xl bg-zinc-800 flex items-center justify-center shrink-0 border border-zinc-700/50">
            {selectedCommunity.image?.url ? (
              <img
                src={optimizeImageUrl(selectedCommunity.image.url, 72)}
                alt={selectedCommunity.name}
                className="h-full w-full rounded-xl object-cover"
              />
            ) : (
              <Hash className="h-5 w-5 text-zinc-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <button
              onClick={() => setView("profile")}
              className="text-sm font-semibold text-white truncate text-left hover:underline cursor-pointer"
            >
              {selectedCommunity.name}
              {selectedCommunity.isSimulated && (
                <span
                  title="Created by simulated users — the members here are bots"
                  className="ml-1.5 inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-violet-300 align-middle"
                >
                  Simulated
                </span>
              )}
              {activeRoomId && (
                <span className="ml-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-400">
                  <Hash className="h-2.5 w-2.5" />
                  {roomsList.find((r) => r._id === activeRoomId)?.name}
                </span>
              )}
            </button>
            <p className="text-[10px] text-zinc-500">
              {selectedCommunity.memberCount} member{selectedCommunity.memberCount !== 1 ? "s" : ""}
              {onlineMembers.length > 0 && (
                <span className="ml-1.5 inline-flex items-center gap-1 text-emerald-400/90">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {onlineMembers.length} active now
                </span>
              )}
              {Object.keys(typingUsers).length > 0 && (
                <span className="text-zinc-300 ml-2">
                  · {Object.keys(typingUsers).length} typing...
                </span>
              )}
            </p>
            {onlineMembers.length > 0 && (
              <div className="flex items-center -space-x-1.5 mt-1">
                {onlineMembers.slice(0, 4).map((m) => (
                  <div
                    key={m.user._id}
                    className="relative h-6 w-6 rounded-full border-2 border-zinc-900 overflow-hidden shrink-0"
                    title={`${m.user.fullName} — active now`}
                  >
                    {m.user.profilePic?.url ? (
                      <img
                        src={m.user.profilePic.url}
                        alt={m.user.fullName}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="h-full w-full bg-zinc-700 flex items-center justify-center text-[9px] font-bold text-white">
                        {(m.user.fullName || m.user.username || "?").charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="absolute bottom-0 right-0 h-1.5 w-1.5 rounded-full bg-emerald-400 border border-zinc-900" />
                  </div>
                ))}
                {onlineMembers.length > 4 && (
                  <span className="h-6 w-6 rounded-full border-2 border-zinc-900 bg-zinc-800 flex items-center justify-center text-[9px] font-bold text-emerald-300">
                    +{onlineMembers.length - 4}
                  </span>
                )}
              </div>
            )}
          </div>
          {/* Group Audio call button - only when enabled */}
          {selectedCommunity.audioCallEnabled && (
            <button
              onClick={() => handleGroupCall("audio")}
              disabled={startingCall}
              className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-white/15 transition-colors cursor-pointer shrink-0 disabled:opacity-40"
              title="Start group audio call"
            >
              <Phone className="h-3.5 w-3.5 text-zinc-500 hover:text-white" />
            </button>
          )}
          {/* Group Video call button - only when enabled */}
          {selectedCommunity.videoCallEnabled && (
            <button
              onClick={() => handleGroupCall("video")}
              disabled={startingCall}
              className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-white/15 transition-colors cursor-pointer shrink-0 disabled:opacity-40"
              title="Start group video call"
            >
              <Video className="h-3.5 w-3.5 text-zinc-500 hover:text-white" />
            </button>
          )}
          {/* Community options — search, clear chat + leave live in a three-dot menu to keep the header clean */}
          <div className="relative shrink-0">
            <button
              onClick={() => setShowHeaderMenu((prev) => !prev)}
              className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-zinc-700/50 transition-colors cursor-pointer shrink-0"
              title="Community options"
            >
              <MoreVertical className="h-3.5 w-3.5 text-zinc-500 hover:text-white" />
            </button>
            {showHeaderMenu && (
              <>
                <div
                  className="fixed inset-0 z-[85]"
                  onClick={() => setShowHeaderMenu(false)}
                />
                <div className="absolute right-0 top-9 z-[90] w-48 overflow-hidden rounded-xl border border-zinc-700/50 bg-zinc-900/95 backdrop-blur-xl shadow-2xl">
                  <button
                    onClick={() => {
                      setShowHeaderMenu(false);
                      setShowMessageSearch((prev) => !prev);
                      // Drop any in-flight search response when opening/closing.
                      messageSearchSeqRef.current++;
                      setMessageSearchQuery("");
                      setSearchResults([]);
                    }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-semibold text-zinc-200 hover:bg-white/10 transition-colors cursor-pointer text-left"
                  >
                    <Search className="h-3.5 w-3.5 text-zinc-400" />
                    Search messages
                  </button>
                  <button
                    onClick={() => {
                      setShowHeaderMenu(false);
                      setConfirmClearForMeOpen(true);
                    }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-white/10 transition-colors cursor-pointer text-left"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Clear chat for me
                  </button>
                  <button
                    onClick={() => {
                      setShowHeaderMenu(false);
                      promptLeaveCommunity();
                    }}
                    disabled={leavingCommunity}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-semibold text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer text-left disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {leavingCommunity ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <LogOut className="h-3.5 w-3.5" />
                    )}
                    Leave community
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Channels — rooms as a native part of this community. A slim
            pill bar inside the chat column (NOT a separate panel) so every
            member sees the community's channels right under the header,
            matching the app's pill language. Desktop users can collapse it
            via the chevron (persisted in localStorage); admins manage the
            channel they're currently IN via a three-dot menu on its pill. */}
        {roomsList.length > 0 && (
          <div className={`${roomsRailCollapsed ? "md:hidden" : "flex"} shrink-0 items-center gap-1 px-3 py-1.5 border-b border-zinc-800/50 overflow-x-auto scrollbar-thin`}>
            <Hash className="h-3 w-3 shrink-0 text-zinc-500" />
            <div className="flex items-center gap-1 shrink-0">
              {roomsList.map((room, idx) => {
                const isGeneral = idx === 0;
                const isActive = (isGeneral ? null : room._id) === activeRoomId;
                return (
                  <div key={room._id} className="group relative shrink-0">
                    <button
                      onClick={() => handleSelectRoom(isGeneral ? null : room._id)}						className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold transition-colors cursor-pointer ${
							isActive
								? "pill-active"
								: "bg-zinc-800/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
						}${isRoomAdmin && isActive && !isGeneral ? " pr-7" : ""}`}
                      title={
                        isGeneral
                          ? "General channel"
                          : room.type === "announcement"
                            ? `Announcements — #${room.name}`
                            : `#${room.name}`
                      }
                    >
                      {(room as any).type === "announcement" && (
                        <Megaphone className="h-2.5 w-2.5 shrink-0 text-amber-400/90" />
                      )}
                      <span className="truncate max-w-[9rem]">{room.name}</span>
                    </button>
                    {/* Three-dot menu — ONLY on the channel you're currently
                        inside (admins), never on every pill. General is a
                        protected channel with no management options. */}
                    {isRoomAdmin && isActive && !isGeneral && (
                      <button
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setRoomMenu({
                            x: Math.min(
                              rect.right - 190,
                              window.innerWidth - 200,
                            ),
                            y: rect.bottom + 4,
                            roomId: room._id,
                            roomName: room.name,
                            slowModeSeconds: room.slowModeSeconds || 0,
                          });
                        }}
                        className="absolute right-0.5 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full flex items-center justify-center text-black/50 hover:text-black hover:bg-black/10 transition-colors cursor-pointer z-10"
                        title={`Manage #${room.name}`}
                        aria-label={`Manage channel ${room.name}`}
                      >
                        <MoreVertical className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
              {isRoomAdmin && (
                <button
                  onClick={() => {
                    setRoomNameInput("");
                    setRoomTypeInput("text");
                    setRoomSlowModeInput(0);
                    setRoomModal({ mode: "create" });
                  }}
                  className="shrink-0 flex items-center gap-1 rounded-full border border-dashed border-zinc-700 px-2.5 py-1 text-[10px] font-bold text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors cursor-pointer"
                  title="Create channel"
                >
                  <Plus className="h-2.5 w-2.5" /> Channel
                </button>
              )}
            </div>
            {/* Desktop collapse — keeps the previous hide/show preference */}
            <button
              onClick={() => setRoomsRailCollapsed((c) => !c)}
              className="hidden md:flex ml-auto shrink-0 h-6 w-6 rounded-full items-center justify-center text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
              title={roomsRailCollapsed ? "Show channels" : "Hide channels"}
            >
              {roomsRailCollapsed ? (
                <ChevronsRight className="h-3 w-3" />
              ) : (
                <ChevronsLeft className="h-3 w-3" />
              )}
            </button>
          </div>
        )}

        {/* Collapsed state — slim one-line strip when hidden on desktop */}
        {roomsRailCollapsed && roomsList.length > 0 && (
          <div className="hidden md:flex shrink-0 items-center gap-2 px-3 py-1.5 border-b border-zinc-800/50">
            <button
              onClick={() => setRoomsRailCollapsed(false)}
              className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-white transition-colors cursor-pointer"
              title="Show channels"
            >
              <ChevronsRight className="h-3 w-3" />
              Channels
            </button>
            <span className="text-[9px] text-zinc-600">
              {activeRoomId
                ? `#${roomsList.find((r) => r._id === activeRoomId)?.name || "…"}`
                : "#general"}
            </span>
          </div>
        )}

        {/* Active group call banner — join the call started by another member */}

        {activeCommunityCall && !showGroupCall && (
          <button
            onClick={() => handleGroupCall(activeCommunityCall.type)}
            disabled={startingCall}
            className="shrink-0 flex items-center justify-center gap-2 px-4 py-2.5 w-full border-b border-emerald-500/20 bg-emerald-500/10 hover:bg-emerald-500/15 transition-colors cursor-pointer disabled:opacity-50"
            title="Join the active group call"
          >
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <Phone className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <span className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider">
              {activeCommunityCall.type === "video"
                ? "Live group video call — tap to join"
                : "Live group audio call — tap to join"}
            </span>
            <ArrowRight className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          </button>
        )}

        {/* Message search bar */}
        {showMessageSearch && (
          <div className="shrink-0 border-b border-zinc-800/50 bg-zinc-950/35 px-4 py-2.5">
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-500">
                <Search className="h-3.5 w-3.5" />
              </span>
              <input
                type="text"
                placeholder="Search messages..."
                value={messageSearchQuery}
                onChange={(e) => {
                  const val = e.target.value;
                  setMessageSearchQuery(val);
                  // Invalidate any in-flight response from the previous query.
                  messageSearchSeqRef.current++;

                  // Clear previous debounce timer
                  if (messageSearchTimerRef.current) {
                    clearTimeout(messageSearchTimerRef.current);
                  }


                  if (!val.trim() || !selectedCommunity) {
                    setSearchResults([]);
                    setSearchingMessages(false);
                    return;
                  }

                  setSearchingMessages(true);
                  // Clear stale results from the previous query while the new
                  // search is in flight — otherwise old matches linger during
                  // the debounce and look wrong for the new query.
                  setSearchResults([]);

                  // Debounce: wait 350ms after last keystroke before searching
                  messageSearchTimerRef.current = setTimeout(async () => {
                    const seq = messageSearchSeqRef.current;
                    try {
                      const res = await apiFetch(
                        `/api/communities/${selectedCommunity._id}/messages/search?q=${encodeURIComponent(val)}&room=${activeRoomRef.current || ""}`
                      );
                      const data = await res.json();
                      // Drop responses from superseded keystrokes — only the
                      // latest query wins.
                      if (seq !== messageSearchSeqRef.current) return;
                      if (res.ok && data.success) {
                        setSearchResults(data.messages || []);
                      }
                    } catch (err) {
                      if (seq !== messageSearchSeqRef.current) return;
                      logger.error("Failed to search messages", err);
                    } finally {
                      if (seq === messageSearchSeqRef.current) {
                        setSearchingMessages(false);
                      }
                    }
                  }, 350);
                }}
                className="w-full rounded-full border border-zinc-800 bg-zinc-950/50 py-2 pl-9 pr-9 text-[12px] font-bold text-white placeholder-zinc-500 focus:outline-none focus:border-white focus:bg-zinc-900 transition-all"
              />
              {messageSearchQuery && (
                <button
                  onClick={() => {
                    setMessageSearchQuery("");
                    setSearchResults([]);
                  }}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-500 hover:text-zinc-300 cursor-pointer"
                  title="Clear search"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
              {!messageSearchQuery && (
                <button
                  onClick={() => {
                    setShowMessageSearch(false);
                    // Drop any in-flight search response when the bar closes.
                    messageSearchSeqRef.current++;
                    setMessageSearchQuery("");
                    setSearchResults([]);
                  }}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-500 hover:text-zinc-300 cursor-pointer"
                  title="Close search"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        )}



        {/* Pinned messages banner — WhatsApp-style slim bar */}
        {pinnedMessages.length > 0 && (
          <div className="shrink-0 border-b border-zinc-700/30 bg-zinc-950/35 px-3 py-1.5 flex items-center gap-2">
            <button
              type="button"
              title="View all pinned messages"
              onClick={() => setShowPinnedPanel(true)}
              className="flex items-center justify-center h-6 w-6 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-700/50 transition-all cursor-pointer shrink-0"
            >
              <Pin className="h-3 w-3" />
            </button>
            <div className="flex-1 min-w-0 flex gap-1.5 overflow-x-auto scrollbar-thin">
              {pinnedMessages.map((pinned) => (
                <button
                  key={pinned._id}
                  type="button"
                  title="Jump to message"
                  onClick={() => {
                    // Jump to the message and POP its bubble (no outline) — the avatar,
                    // reactions and other row furniture stay untouched.
                    if (!popMessageBubble(pinned._id)) {
                      window.dispatchEvent(
                        new CustomEvent("showToast", {
                          detail: {
                            message: "Pinned message not loaded yet — scroll up to find it.",
                            type: "error",
                          },
                        }),
                      );
                    }
                  }}
                  className="shrink-0 max-w-[220px] flex items-center gap-1.5 rounded-md bg-zinc-950/80 border border-zinc-700/40 px-2 py-1 hover:bg-zinc-900/90 hover:border-zinc-600/50 transition-colors cursor-pointer text-left"
                >
                  <span className="h-3.5 w-3.5 rounded-full bg-zinc-700 shrink-0 flex items-center justify-center overflow-hidden text-[7px] font-bold text-zinc-200">
                    {pinned.sender.profilePic?.url ? (
                      <img
                        src={pinned.sender.profilePic.url}
                        alt={pinned.sender.fullName}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      pinned.sender.fullName?.charAt(0) || "?"
                    )}
                  </span>
                  <span className="flex-1 min-w-0 text-[9px] leading-tight text-zinc-300 truncate">
                    <span className="font-semibold text-white">{pinned.sender.fullName}: </span>
                    {pinned.text || (pinned.attachments?.length ? "Attachment" : "")}
                  </span>
                </button>
              ))}
            </div>
            {pinnedMessages.length > 1 && (
              <span className="shrink-0 text-[9px] font-semibold text-zinc-400">
                {pinnedMessages.length}
              </span>
            )}
          </div>
        )}

        {/* View all pinned messages panel */}
        {showPinnedPanel &&
          createPortal(
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
              onClick={() => setShowPinnedPanel(false)}
            >
              <motion.div
                initial={{ y: 40, scale: 0.97, opacity: 0 }}
                animate={{ y: 0, scale: 1, opacity: 1 }}
                exit={{ y: 40, scale: 0.97, opacity: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full sm:max-w-md max-h-[75vh] rounded-t-3xl sm:rounded-3xl border border-zinc-800 bg-zinc-950/95 backdrop-blur-xl shadow-2xl flex flex-col overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/70 shrink-0">
                  <div className="flex items-center gap-2">
                    <Pin className="h-4 w-4 text-amber-200/90" />
                    <h3 className="text-sm font-bold text-white">Pinned messages</h3>
                  </div>
                  <button
                    onClick={() => setShowPinnedPanel(false)}
                    className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-zinc-800 transition-colors cursor-pointer"
                    title="Close"
                  >
                    <X className="h-4 w-4 text-zinc-400" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {pinnedMessages.length === 0 ? (
                    <p className="text-xs text-zinc-500 text-center py-8">No pinned messages</p>
                  ) : (
                    pinnedMessages.map((pinned) => (
                      <div
                        key={pinned._id}
                        className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-zinc-900/70 transition-colors group"
                      >
                        <span className="h-8 w-8 rounded-full bg-zinc-800 border border-zinc-700 shrink-0 flex items-center justify-center overflow-hidden text-[9px] font-bold text-zinc-300">
                          {pinned.sender?.profilePic?.url ? (
                            <img
                              src={pinned.sender.profilePic.url}
                              alt={pinned.sender.fullName}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            pinned.sender?.fullName?.charAt(0) || "?"
                          )}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-bold text-white truncate">
                            {pinned.sender?.fullName}
                          </p>
                          <p className="text-[11px] text-zinc-400 truncate">
                            {pinned.text ||
                              (pinned.attachments?.length ? "Attachment" : "")}
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            handleUnpinMessage(pinned._id);
                            setShowPinnedPanel(false);
                          }}
                          className="shrink-0 rounded-full border border-zinc-700 px-3 py-1.5 text-[10px] font-bold text-zinc-300 hover:text-white hover:border-red-400/60 hover:bg-red-500/10 transition-all cursor-pointer"
                          title="Unpin message"
                        >
                          Unpin
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            </motion.div>,
            document.body,
          )}

        {/* Messages area — regular or search results */}
        {/* When a search query is active, ALWAYS show the search view (results,
            loading or the empty state) instead of silently falling back to the
            normal chat — falling back made it look like search "did nothing". */}
        {messageSearchQuery.trim() ? (
          searchResults.length > 0 ? (
          <div className="flex-1 overflow-y-auto px-4 py-2 space-y-0.5">
            <div className="sticky top-0 z-10 bg-zinc-950/90 backdrop-blur-sm py-2 mb-2 flex items-center gap-2 border-b border-zinc-800/40">
              <Search className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                Search results for "{messageSearchQuery}"
              </span>
              <span className="text-[10px] text-zinc-400 ml-auto">{searchResults.length} result{searchResults.length !== 1 ? "s" : ""}</span>
            </div>
            {searchResults.map((msg, index) => {
              const isMe = msg.sender._id === userId;
              const adaptedMsg = {
                ...msg,
                conversation: msg.community,
                recipient: msg.sender._id,
                seen: (msg.seenBy?.length || 0) > 0,
              } as any;

              return (
                <React.Fragment key={msg._id}>
                  <MessageBubble
                    msg={adaptedMsg}
                    isMe={isMe}
                    userId={userId}
                    groupedReactions={getGroupedReactions(msg)}
                    handleContextMenu={handleContextMenu as any}
                    handleReaction={handleReaction as any}
                    formatMessageTime={formatMessageTime}
                    onSwipeToReply={handleReply as any}
                    onUserClick={onUserSelected}
                    uploadProgress={uploadProgress[msg._id]}
                    onRetrySend={handleRetrySend}
                    isOnline={isOnline}
                    showDateSeparator={index === 0}
                    dateSeparatorText={formatDateSeparator(msg.createdAt)}
                    showTimeHeader={false}
                    isFirstInGroup={index === 0 || searchResults[index - 1]?.sender._id !== msg.sender._id}
                    isLastInGroup={index === searchResults.length - 1 || searchResults[index + 1]?.sender._id !== msg.sender._id}
                  />
                  {msg.poll && (
                    <CommunityPollCard
                      msg={msg}
                      userId={userId}
                      onVote={handleVotePoll}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
          ) : searchingMessages ? (
            <div className="flex-1 overflow-y-auto px-2 md:px-3 py-2 flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-2 md:px-3 py-2 flex items-center justify-center">
              <p className="text-[10px] font-medium text-zinc-500 text-center">No messages found</p>
            </div>
          )
        ) : (
          <div
            ref={messagesContainerRef}
            className="flex-1 overflow-y-auto px-2 md:px-3 py-2 space-y-0.5 relative"
            onScroll={(e) => {
              const el = e.currentTarget;
              const isAtBottom =
                el.scrollHeight - el.scrollTop - el.clientHeight < 400;
              nearBottomRef.current = isAtBottom;
              setShowScrollToBottom(!isAtBottom);
              if (el.scrollTop < 50 && hasMore && !loadingMessages) {
                handleLoadMore();
              }
            }}
          >
            {loadingMessages && messages.length === 0 && (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-5 w-5 text-zinc-500 animate-spin" />
              </div>
            )}

            {!loadingMessages && messages.length === 0 && !searchingMessages && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <MessageSquare className="h-10 w-10 text-zinc-700 mb-3" />
                <p className="text-sm font-semibold text-zinc-400 mb-1">
                  No messages yet
                </p>
                <p className="text-[11px] text-zinc-400">
                  Be the first to send a message in {selectedCommunity.name}
                </p>
              </div>
            )}

            {/* Welcome card — the community's welcomeMessage (rules + intro),
                shown once per session as a dismissible card. */}
            {showWelcomeCard && selectedCommunity.welcomeMessage && (
              <div className="mb-2 mx-auto max-w-[90%] md:max-w-[480px] rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3">
                <div className="flex items-start gap-2.5">
                  <Sparkles className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-black text-white uppercase tracking-wider mb-1">
                      Welcome to {selectedCommunity.name}
                    </p>
                    <p className="text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap">
                      {selectedCommunity.welcomeMessage}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowWelcomeCard(false)}
                    className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                    title="Dismiss"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )}

            {/* Scroll to bottom button */}
            {showScrollToBottom && (
              <div className="absolute bottom-4 right-4 z-20">
                <button
                  onClick={() => scrollThread(true)}
                  className="h-9 w-9 rounded-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/50 flex items-center justify-center shadow-lg transition-all cursor-pointer animate-bounce"
                  title="Scroll to bottom"
                  type="button"
                >
                  <ChevronDown className="h-4 w-4 text-zinc-300" />
                </button>
              </div>
            )}

            {searchingMessages && (
              <div className="flex justify-center py-6">
                <Loader2 className="h-4 w-4 text-zinc-500 animate-spin" />
              </div>
            )}

            {messages.map((msg, index) => {
              const isMe = msg.sender._id === userId;
              // Convert CommunityMessage fields to match MessageBubble expectations
              const adaptedMsg = {
                ...msg,
                conversation: msg.community,
                recipient: msg.sender._id,
                // Show blue tick when other members have seen this message
                seen: (msg.seenBy?.length || 0) > 0,
                _pending: (msg as any)._pending,
                _failed: (msg as any)._failed,
                _queued: (msg as any)._queued,
              } as any;

              // Call-activity system messages ("Voice call started/ended") render
              // as a centered chip in the community timeline, like WhatsApp.
              if (msg.system) {
                return (
                  <CallSystemMessage
                    key={msg._id}
                    system={msg.system}
                    callType={msg.callType}
                    callDuration={msg.callDuration}
                    createdAt={msg.createdAt}
                    actorName={
                      msg.sender?.fullName?.split(" ")[0] ||
                      msg.sender?.username
                    }
                    isMe={isMe}
                    showDateSeparator={shouldShowDateSeparator(msg, index)}
                    dateSeparatorText={formatDateSeparator(msg.createdAt)}
                    formatMessageTime={formatMessageTime}
                  />
                );
              }

              return (
                <React.Fragment key={msg._id}>
                  <MessageBubble
                    msg={adaptedMsg}
                    isMe={isMe}
                    userId={userId}
                    groupedReactions={getGroupedReactions(msg)}
                    handleContextMenu={handleContextMenu as any}
                    handleReaction={handleReaction as any}
                    formatMessageTime={formatMessageTime}
                    onSwipeToReply={handleReply as any}
                    onUserClick={onUserSelected}
                    uploadProgress={uploadProgress[msg._id]}
                    onRetrySend={handleRetrySend}
                    isOnline={isOnline}
                    showDateSeparator={shouldShowDateSeparator(msg, index)}
                    dateSeparatorText={formatDateSeparator(msg.createdAt)}
                    showTimeHeader={false}
                    isFirstInGroup={
                      index === 0 ||
                      messages[index - 1]?.sender._id !== msg.sender._id
                    }
                    isLastInGroup={
                      index === messages.length - 1 ||
                      messages[index + 1]?.sender._id !== msg.sender._id
                    }
                  />
                  {msg.poll && (
                    <CommunityPollCard
                      msg={msg}
                      userId={userId}
                      onVote={handleVotePoll}
                    />
                  )}
                </React.Fragment>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Reply/Edit indicator */}
        {replyTo && (
          <div className="px-2 py-2 bg-zinc-950/35 border-t border-zinc-800/50 flex items-center gap-2 shrink-0">
            <CornerDownLeft className="h-3.5 w-3.5 text-zinc-300 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-zinc-300">
                Replying to {replyTo.sender.fullName}
              </p>
              <p className="text-[11px] text-zinc-500 truncate">
                {replyTo.text || "Attachment"}
              </p>
            </div>
            <button
              onClick={cancelReply}
              className="h-6 w-6 rounded-full flex items-center justify-center hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
            >
              <X className="h-3 w-3 text-zinc-500" />
            </button>
          </div>
        )}

        {editingMessage && (
          <div className="px-2 py-2 bg-zinc-950/35 border-t border-zinc-800/50 flex items-center gap-2 shrink-0">
            <Edit3 className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-amber-400">Editing message</p>
            </div>
            <button
              onClick={cancelEdit}
              className="h-6 w-6 rounded-full flex items-center justify-center hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
            >
              <X className="h-3 w-3 text-zinc-500" />
            </button>
          </div>
        )}

        {/* File previews - using ChatGallery like personal chat */}
        {filePreviews.length > 0 && (
          <div className="px-4 py-2 border-t border-zinc-800/50 shrink-0">
            <React.Suspense fallback={null}>
              <ChatGallery
                attachmentPreviews={filePreviews}
                attachments={selectedFiles}
                removeAttachment={removeFile}
              />
            </React.Suspense>
          </div>
        )}

        {/* Messaging disabled banner */}
        {selectedCommunity.messagingEnabled === false && myRole(selectedCommunity) !== "creator" && (
          <div className="px-4 py-3 border-t border-zinc-800/50 shrink-0 bg-zinc-950/35">
            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
              <span>Messaging is disabled in this community.</span>
            </div>
          </div>
        )}

        {/* Access-control banner — your role can't post here */}
        {selectedCommunity.messagingEnabled !== false &&
          !canPost(selectedCommunity) && (
          <div className="px-4 py-3 border-t border-zinc-800/50 shrink-0 bg-zinc-950/35">
            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              <span>
                Only{" "}
                {selectedCommunity.whoCanPost === "moderators"
                  ? "moderators and admins"
                  : "admins"}{" "}
                can send messages in this community.
              </span>
            </div>
          </div>
        )}

        {/* Announcement-channel lock — members can read but not post (only
            moderators+ can speak in announcement channels). */}
        {isAnnouncementRoom && !isModeratorOf(selectedCommunity) && (
          <div className="px-4 py-3 border-t border-zinc-800/50 shrink-0 bg-zinc-950/35">
            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
              <Megaphone className="h-3.5 w-3.5 shrink-0 text-amber-400/80" />
              <span>
                Only moderators and admins can post in this announcement
                channel
              </span>
            </div>
          </div>
        )}
        {/* Input area - hidden for members without post permission (or when
            messaging is disabled for non-creators) */}
        {canPostHere &&
          (selectedCommunity.messagingEnabled !== false || myRole(selectedCommunity) === "creator") && (
        <div className={`px-2 ${isMobile ? "pb-[calc(0.375rem+env(safe-area-inset-bottom,0px))] pt-3" : "py-3"} border-t border-zinc-800/50 shrink-0 relative`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
          {isDragActive && (
            <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-white/5 border-2 border-dashed border-white/25 backdrop-blur-sm">
              <div className="text-center">
                <Image className="h-8 w-8 text-zinc-300 mx-auto mb-2" />
                <p className="text-xs font-semibold text-zinc-200">Drop files here</p>
              </div>
            </div>
          )}
          {sendingError && !slowmodeUntil && (
            <div className="mb-2 flex items-center gap-1.5 text-[10px] text-red-400 bg-red-500/10 rounded-lg px-3 py-1.5 border border-red-500/20">
              <AlertCircle className="h-3 w-3 shrink-0" />
              <span>{sendingError}</span>
            </div>
          )}
          {slowmodeUntil && (
            <div className="mb-2 flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10">
              <Timer className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span className="text-[10px] font-semibold text-amber-300">
                Slowmode is on — your message will send automatically in{" "}
                {slowmodeNow}s
              </span>
            </div>
          )}
          {isOnline === false && (
            <div className="mb-2 flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10">
              <WifiOff className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span className="text-[10px] font-semibold text-amber-300">
                You're offline — messages will send automatically when you're
                back online
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="*/*"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
            <div className="flex-1 min-w-0 relative flex items-end">
              {!recordedUrl && (
                <>
                  <div className="relative w-full">
                    <textarea
                      ref={inputRef}
                      value={messageInput}
                    wrap="soft"
                    onChange={handleInputChange}
                    onKeyDown={(e) => {
                      if (
                        showMentionDropdown &&
                        (e.key === "ArrowDown" || e.key === "ArrowUp")
                      ) {
                        e.preventDefault();
                        mentionDropdownRef.current?.focus();
                        return;
                      }
                      if (e.key === "Escape") {
                        closeMentionDropdown();
                        return;
                      }
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (editingMessage) {
                          handleEditSubmit();
                        } else {
                          handleSendMessage();
                        }
                      }
                    }}
                    placeholder="Type a message..."
                    rows={1}
                    className={`w-full !rounded-2xl border border-zinc-800 bg-zinc-950/25 text-[12px] md:text-sm placeholder:text-[12px] md:placeholder:text-sm text-slate-100 placeholder-zinc-500 outline-none focus:border-white focus:bg-zinc-900/80 transition-all focus:ring-1 focus:ring-zinc-700 pl-[46px] resize-none max-h-[120px] overflow-y-auto leading-relaxed disabled:opacity-60 disabled:cursor-not-allowed ${
                      isKeyboardOpen ? "py-2 pr-3" : "py-2.5 pr-10"
                    }`}
                  />
                  <MentionSuggestions
                    ref={mentionDropdownRef}
                    candidates={mentionCandidates}
                    onSelect={selectMentionCandidate}
                    onClose={closeMentionDropdown}
                    anchorRef={inputRef}
                  />
                  {/* Media icon — inside the input box, tucked in slightly from the left edge.
                      Hidden when the community restricts media uploads to higher roles. */}
                  {canUploadMedia(selectedCommunity) && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute left-1 inset-y-0 my-auto flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800/60 border border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    title="Attach file"
                    type="button"
                  >
                    <Image className="h-4.5 w-4.5" />
                  </button>
                  )}
                  {/* Poll button — opens the poll builder (Discord/WhatsApp-style).
                      Users can finally create polls, not just bots. */}
                  <button
                    onClick={() => {
                      setPollDraft({
                        question: "",
                        options: ["", ""],
                        allowMultiple: false,
                        durationMinutes: null,
                        hideResults: null,
                      });
                      setPollComposerOpen(true);
                    }}
                    className="absolute left-10 inset-y-0 my-auto flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800/60 border border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    title="Create poll"
                    type="button"
                  >
                    <BarChart3 className="h-4 w-4" />
                  </button>
                  {!isKeyboardOpen && !messageInput && (
                    <span className="absolute right-3.5 top-3.5 text-[9px] text-zinc-650 hidden md:flex items-center gap-0.5 border border-zinc-800 px-1 rounded bg-zinc-950 select-none">
                      <CornerDownLeft className="h-2 w-2" />{" "}
                      Enter
                    </span>
                  )}
                  </div>
                </>
              )}
              

              {/* Recording indicator — animated waveform bars (matches personal chat) */}
              {isRecording && (
                <div className="flex items-center gap-2 shrink-0">
                  {/* Animated waveform bars */}
                  <span className="flex items-center gap-[3px] h-5">
                    {[3, 6, 10, 14, 18, 14, 10, 6, 3].map((h, i) => (
                      <span
                        key={i}
                        className="waveform-bar w-[3px] bg-red-500 rounded-full"
                        style={{
                          height: `${h}px`,
                          animation: `waveform 0.5s ease-in-out ${i * 0.1}s infinite alternate`,
                        }}
                      />
                    ))}
                  </span>
                  <span className="text-[12px] font-mono text-red-400 tabular-nums font-bold">
                    {recordingDuration}s
                  </span>
                </div>
              )}

              {/* Recorded audio preview — exact copy of personal chat (Chat.tsx) */}
              {recordedUrl && !isRecording && (
                <div className="flex items-center gap-3 px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (audioPreviewRef.current) {
                        if (isPlayingPreview) {
                          audioPreviewRef.current.pause();
                          audioPreviewRef.current.currentTime = 0;
                        }
                        setIsPlayingPreview(!isPlayingPreview);
                        if (!isPlayingPreview) {
                          audioPreviewRef.current.play();
                        }
                      }
                    }}
                    className="h-9 w-9 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-zinc-200 hover:bg-white/20 transition-all cursor-pointer shrink-0"
                  >
                    {isPlayingPreview ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </button>
                  <div className="flex-1 flex items-center gap-2 min-w-0">
                    <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-white/60 rounded-full w-0"
                        id="voice-preview-progress"
                      />
                    </div>
                    <span className="text-[11px] font-mono text-zinc-400 tabular-nums">
                      {recordingDuration}s
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setRecordedBlob(null);
                      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
                      setRecordedUrl(null);
                      setRecordingDuration(0);
                      setIsPlayingPreview(false);
                    }}
                    className="h-7 w-7 rounded-full border border-zinc-700 bg-zinc-800/60 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700 transition-all cursor-pointer shrink-0"
                    title="Discard recording"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendVoiceNote()}
                    className="flex shrink-0 items-center justify-center rounded-full bg-aurora text-white border border-white/10 shadow-aurora hover:opacity-90 cursor-pointer transition-all duration-200 h-9 w-9">
                    <Send className="h-4.5 w-4.5" />
                  </button>
                  <audio
                    ref={audioPreviewRef}
                    src={recordedUrl}
                    onEnded={() => setIsPlayingPreview(false)}
                    onTimeUpdate={() => {
                      if (audioPreviewRef.current) {
                        const progress = document.getElementById("voice-preview-progress");
                        if (progress) {
                          progress.style.width = `${(audioPreviewRef.current.currentTime / (audioPreviewRef.current.duration || 1)) * 100}%`;
                        }
                      }
                    }}
                  />
                </div>
              )}
            </div>

            {/* Right side buttons — exact copy of personal chat (Chat.tsx) */}
            {!recordedUrl && (
              <>
                {/* @everyone quick chip — announcement rooms only, one tap to
                    insert the ping (mods already have it via the @ menu, but a
                    visible chip makes the channel type discoverable). */}
                {isAnnouncementRoom && isModeratorOf(selectedCommunity) && (
                  <button
                    type="button"
                    onClick={() => {
                      const base = messageInput.trimEnd();
                      const next = base
                        ? `${base} @everyone `
                        : "@everyone ";
                      setMessageInput(next);
                      requestAnimationFrame(() => {
                        inputRef.current?.focus();
                        inputRef.current?.setSelectionRange(
                          next.length,
                          next.length,
                        );
                      });
                    }}
                    className="flex shrink-0 items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 h-9 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20 hover:text-amber-200 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Ping the whole room (@everyone)"
                  >
                    <Megaphone className="h-3.5 w-3.5" />
                    Everyone
                  </button>
                )}
                {/* Schedule-send button — quick time picker; the message is
                    stored now and delivered at the chosen time (mirrors Chat). */}
                <button
                  type="button"
                  title={scheduledFor ? "Change schedule" : "Schedule message"}
                  onClick={() => setSchedulePickerOpen((v) => !v)}
                  className={`flex shrink-0 items-center justify-center rounded-full transition-all duration-200 cursor-pointer h-9 w-9 ${
                    scheduledFor
                      ? "bg-sky-500/20 border border-sky-400/40 text-sky-300 hover:bg-sky-500/30"
                      : "bg-zinc-800/60 border border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-700"
                  }`}
                >
                  <Timer className="h-4 w-4" />
                </button>

                {/* Mic toggle — red square while recording (stop). Mirrors
                    Chat.tsx: hidden while content is typed, files are attached,
                    or a send is in flight (the send button takes its place). */}
                {pendingSendCount === 0 && !(messageInput.trim() || selectedFiles.length > 0) ? (
                  <button
                    type="button"
                    onClick={(e) => { handleMicClick(e); }}
                    className={`flex shrink-0 items-center justify-center rounded-full transition-all duration-200 cursor-pointer ${
                      isRecording
                        ? "h-9 w-9 bg-red-500 text-white hover:bg-red-600"
                        : "h-9 w-9 bg-zinc-800/60 border border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-700"
                    }`}
                    title={isRecording ? "Stop recording" : "Record voice note"}
                  >
                    {isRecording ? (
                      <Square className="h-4 w-4" />
                    ) : (
                      <Mic className="h-4.5 w-4.5" />
                    )}
                  </button>
                ) : null}
                {/* Send button — always a static Send icon (exactly like Chat).
                    Upload progress lives in the message bubble, not the button.
                    Shown when there's content to send OR a send is in flight
                    (pending/queued) so it never disappears mid-upload. */}
                {(messageInput.trim() || selectedFiles.length > 0 || isRecording || pendingSendCount > 0) && (
                  <button
                    type="button"
                    onClick={editingMessage ? handleEditSubmit : handleSendMessage}
                    className="flex items-center justify-center rounded-full bg-aurora text-white border border-white/10 shadow-aurora hover:opacity-90 cursor-pointer transition-all duration-200 h-9 w-9">
                    <Send className="h-4.5 w-4.5" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        )}

        {/* Schedule-send popover — quick presets + exact datetime (mirrors Chat.tsx). */}
        {schedulePickerOpen && (
          <>
            <div
              className="fixed inset-0 z-[290]"
              onClick={() => setSchedulePickerOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="absolute bottom-full mb-2 left-0 right-0 z-[295] bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-3"
            >
              <p className="text-[10px] font-black text-zinc-500 uppercase tracking-wider mb-2">
                Schedule message
              </p>
              <div className="grid grid-cols-2 gap-1.5 mb-2">
                {[
                  { label: "In 15 min", ms: 15 * 60 * 1000 },
                  { label: "In 1 hour", ms: 60 * 60 * 1000 },
                  { label: "In 3 hours", ms: 3 * 60 * 60 * 1000 },
                  { label: "Tomorrow 9 AM", ms: null },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      let d: Date;
                      if (preset.ms === null) {
                        d = new Date();
                        d.setDate(d.getDate() + 1);
                        d.setHours(9, 0, 0, 0);
                      } else {
                        d = new Date(Date.now() + preset.ms);
                      }
                      setScheduledFor(d);
                      setSchedulePickerOpen(false);
                    }}
                    className="px-2.5 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-700/70 hover:text-white transition-colors cursor-pointer"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <input
                type="datetime-local"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950/40 px-2.5 py-2 text-[11px] text-zinc-200 outline-none focus:border-white [color-scheme:dark]"
                defaultValue={
                  scheduledFor
                    ? new Date(
                        scheduledFor.getTime() -
                          scheduledFor.getTimezoneOffset() * 60000,
                      )
                        .toISOString()
                        .slice(0, 16)
                    : ""
                }
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  const d = new Date(v);
                  if (!isNaN(d.getTime())) {
                    setScheduledFor(d);
                  }
                }}
              />
              <div className="flex items-center justify-between mt-2">
                <button
                  type="button"
                  onClick={() => {
                    setScheduledFor(null);
                    setSchedulePickerOpen(false);
                  }}
                  className="text-[10.5px] font-semibold text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                >
                  Clear schedule
                </button>
                {scheduledFor && (
                  <span className="text-[10.5px] font-semibold text-sky-300">
                    Sends {scheduledFor.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    {scheduledFor.toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                )}
              </div>
            </motion.div>
          </>
        )}

        {/* Poll composer modal — build a poll and send it as a message. */}
        {pollComposerOpen && createPortal(
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm"
              onClick={() => !pollSubmitting && setPollComposerOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="fixed z-[310] inset-x-4 bottom-6 sm:inset-x-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[420px] sm:bottom-auto bg-zinc-900/98 backdrop-blur-xl border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-zinc-400" />
                  <h4 className="text-xs font-black text-white uppercase tracking-wider">
                    Create poll
                  </h4>
                </div>
                <button
                  onClick={() => !pollSubmitting && setPollComposerOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                    Question
                  </label>
                  <input
                    value={pollDraft.question}
                    maxLength={200}
                    onChange={(e) =>
                      setPollDraft((d) => ({ ...d, question: e.target.value }))
                    }
                    placeholder="Ask something…"
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-[12px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-white transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                    Options ({pollDraft.options.filter((o) => o.trim()).length}/10)
                  </label>
                  <div className="space-y-1.5">
                    {pollDraft.options.map((opt, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <input
                          value={opt}
                          maxLength={100}
                          onChange={(e) =>
                            setPollDraft((d) => {
                              const options = [...d.options];
                              options[i] = e.target.value;
                              return { ...d, options };
                            })
                          }
                          placeholder={`Option ${i + 1}`}
                          className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-[12px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-white transition-all"
                        />
                        {pollDraft.options.length > 2 && (
                          <button
                            type="button"
                            onClick={() =>
                              setPollDraft((d) => ({
                                ...d,
                                options: d.options.filter((_, idx) => idx !== i),
                              }))
                            }
                            className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer shrink-0"
                            title="Remove option"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {pollDraft.options.length < 10 && (
                    <button
                      type="button"
                      onClick={() =>
                        setPollDraft((d) => ({
                          ...d,
                          options: [...d.options, ""],
                        }))
                      }
                      className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-sky-400 hover:text-sky-300 transition-colors cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add option
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                      Duration
                    </label>
                    <select
                      value={pollDraft.durationMinutes ?? ""}
                      onChange={(e) =>
                        setPollDraft((d) => ({
                          ...d,
                          durationMinutes: e.target.value
                            ? Number(e.target.value)
                            : null,
                        }))
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950/40 px-2.5 py-2 text-[11px] text-zinc-200 outline-none focus:border-white transition-all"
                    >
                      <option value="">No end</option>
                      <option value={60}>1 hour</option>
                      <option value={1440}>24 hours</option>
                      <option value={4320}>3 days</option>
                      <option value={10080}>7 days</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                      Show results
                    </label>
                    <select
                      value={pollDraft.hideResults ?? "always"}
                      onChange={(e) =>
                        setPollDraft((d) => ({
                          ...d,
                          hideResults:
                            e.target.value === "always"
                              ? null
                              : (e.target.value as "vote" | "end"),
                        }))
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950/40 px-2.5 py-2 text-[11px] text-zinc-200 outline-none focus:border-white transition-all"
                    >
                      <option value="always">Always visible</option>
                      <option value="vote">After I vote</option>
                      <option value="end">After it ends</option>
                    </select>
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={pollDraft.allowMultiple}
                    onChange={(e) =>
                      setPollDraft((d) => ({
                        ...d,
                        allowMultiple: e.target.checked,
                      }))
                    }
                    className="accent-sky-500"
                  />
                  <span className="text-[11.5px] font-semibold text-zinc-300">
                    Allow multiple answers
                  </span>
                </label>
              </div>
              <div className="px-4 py-3 border-t border-zinc-800 flex justify-end shrink-0">
                <button
                  onClick={handlePollSubmit}
                  disabled={pollSubmitting}
                  className="flex items-center gap-1.5 rounded-full bg-aurora text-white border border-white/10 shadow-aurora hover:opacity-90 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed px-4 h-9 text-[12px] font-bold"
                >
                  {pollSubmitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <BarChart3 className="h-3.5 w-3.5" />
                  )}
                  {pollSubmitting ? "Creating…" : "Send poll"}
                </button>
              </div>
            </motion.div>
          </>,
          document.body
        )}

        {/* Context menu — rendered via portal to avoid motion.div transform stacking context */}
        {/* Camera capture portal */}
        {showCamera && createPortal(
          <div className="fixed inset-0 z-[500] bg-black flex flex-col">
            <video
              ref={cameraVideoRef}
              autoPlay
              playsInline
              muted
              className="flex-1 w-full object-cover"
            />
            <div className="flex items-center justify-between px-8 py-6 bg-black/80">
              <button
                type="button"
                onClick={handleCloseCamera}
                className="h-10 w-20 rounded-full border border-zinc-600 text-zinc-400 hover:text-white hover:border-zinc-400 font-bold text-xs transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCapturePhoto}
                className="h-16 w-16 rounded-full bg-white border-4 border-zinc-300 hover:border-white transition-all cursor-pointer flex items-center justify-center"
              >
                <div className="h-12 w-12 rounded-full bg-white border-2 border-zinc-900" />
              </button>
              <div className="w-20" />
            </div>
          </div>,
          document.body
        )}

        {contextMenu && createPortal(
          <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[300]"
                onClick={() => setContextMenu(null)}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="fixed z-[310] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden py-1 min-w-[180px] max-w-[calc(100vw-1rem)]"
                ref={contextMenuRef}
                style={{ left: contextMenu.x, top: contextMenu.y }}
              >

                {/* Quick-reaction pill — same options as the emoji menu; reacts
                    straight from the long-press menu. Hidden for deleted msgs. */}
                {!contextMenu.message.isDeleted && (
                  <div className="border-b border-zinc-800 px-1 py-1">
                    <EmojiReactionMenu
                      inline
                      onReact={(emoji) => {
                        handleReaction(contextMenu.message, emoji);
                        setContextMenu(null);
                      }}
                      ariaLabel="React to this message"
                      title="React"
                    />
                  </div>
                )}

                <button
                  onClick={() => {
                    handleReply(contextMenu.message);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  <CornerDownLeft className="h-3.5 w-3.5" />
                  Reply
                </button>
                {/* Translate — programmatically triggers the message's inline translation */}
                {!contextMenu.message.isDeleted &&
                  contextMenu.message.text && (
                    <button
                      onClick={() => {
                        window.dispatchEvent(
                          new CustomEvent("translate-inline:toggle", {
                            detail: { id: contextMenu.message._id },
                          }),
                        );
                        setContextMenu(null);
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
                    >
                      <Languages className="h-3.5 w-3.5" />
                      Translate
                    </button>
                  )}
                {contextMenu.message.sender._id === userId &&
                  isEditable(contextMenu.message.createdAt) && (
                    <button
                      onClick={() => {
                        handleEdit(contextMenu.message);
                        setContextMenu(null);
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      Edit
                    </button>
                  )}
                {/* Delete for everyone — own message within 5 min, OR any
                    message if you're a moderator+ (moderation power) */}
                {(contextMenu.message.sender._id === userId
                  ? isEditable(contextMenu.message.createdAt)
                  : isModeratorOf(selectedCommunity)) && (
                    <button
                      onClick={() => handleDelete(contextMenu.message._id)}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-red-400 hover:bg-zinc-800 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete for everyone
                    </button>
                  )}
                {/* Delete for me — available for ALL messages, not just own */}
                {!contextMenu.message.isDeleted && (
                  <button
                    onClick={() => handleDeleteForMe(contextMenu.message._id)}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-400 hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                    Delete for me
                  </button>
                )}
                {/* Star / Unstar — WhatsApp-style saved messages (shows in the
                    community profile overlay's Starred tab) */}
                {!contextMenu.message.isDeleted && (
                  <button
                    onClick={() =>
                      handleToggleCommunityStar(contextMenu.message)
                    }
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    {(contextMenu.message.savedBy || []).includes(userId) ? (
                      <Star className="h-3.5 w-3.5 text-amber-400" />
                    ) : (
                      <Star className="h-3.5 w-3.5" />
                    )}
                    {(contextMenu.message.savedBy || []).includes(userId)
                      ? "Unstar message"
                      : "Star message"}
                  </button>
                )}
                {/* Message info — WhatsApp-style Sent/Delivered/Seen-by-N
                    timestamps. Only meaningful for own messages. */}
                {contextMenu.message.sender._id === userId && (
                  <button
                    onClick={() => {
                      setMessageInfo(contextMenu.message);
                      setContextMenu(null);
                    }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    <Info className="h-3.5 w-3.5" />
                    Message info
                  </button>
                )}
                {/* Copy Message — only when the message actually has text
                    (a media-only message has nothing to copy) */}
                {!contextMenu.message.isDeleted &&
                  contextMenu.message.text && (
                  <button
                    onClick={() => handleCopyMessage(contextMenu.message)}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy Message
                  </button>
                )}
                {/* Save media — real download for image/video/file attachments */}
                {!contextMenu.message.isDeleted &&
                  (contextMenu.message.attachments?.length ?? 0) > 0 && (
                  <button
                    onClick={() => {
                      void downloadAttachment(
                        contextMenu.message.attachments?.[0],
                      );
                      setContextMenu(null);
                    }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {contextMenu.message.attachments?.[0]?.type === "file"
                      ? "Download file"
                      : "Save media"}
                  </button>
                )}
                {/* Forward Message */}
                {!contextMenu.message.isDeleted && (
                  <button
                    onClick={() => {
                      setForwardModal({ message: contextMenu.message });
                      setContextMenu(null);
                      fetchForwardConversations();
                      setSelectedForwardConvIds([]);
                    }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    Forward Message
                  </button>
                )}
                {/* Pin/Unpin — available to all members */}
                {isMessagePinned(contextMenu.message._id) ? (
                  <button
                    onClick={() => handleUnpinMessage(contextMenu.message._id)}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-amber-400 hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    <PinOff className="h-3.5 w-3.5" />
                    Unpin
                  </button>
                ) : (
                  <button
                    onClick={() => handlePinMessage(contextMenu.message._id)}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    <Pin className="h-3.5 w-3.5" />
                    Pin
                  </button>
                )}
              </motion.div>
            </>,
          document.body
        )}

        {/* ── Message info panel (Sent / Delivered / Seen by N) ── */}
        {messageInfo && createPortal(
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm"
              onClick={() => setMessageInfo(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="fixed z-[310] inset-x-4 bottom-6 sm:inset-x-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[380px] sm:bottom-auto bg-zinc-900/98 backdrop-blur-xl border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-zinc-400" />
                  <h4 className="text-xs font-black text-white uppercase tracking-wider">
                    Message info
                  </h4>
                </div>
                <button
                  onClick={() => setMessageInfo(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-4">
                {/* Message preview */}
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2.5 mb-4">
                  <p className="text-[11px] text-zinc-200 leading-relaxed break-words">
                    {messageInfo.text ||
                      (messageInfo.attachments?.[0]?.type === "voice_note"
                        ? "🎤 Voice note"
                        : messageInfo.attachments?.[0]?.type === "video"
                          ? "🎬 Video"
                          : messageInfo.attachments?.[0]?.type === "image" ||
                              messageInfo.attachments?.[0]?.type === "gif"
                            ? "🖼️ Photo"
                            : messageInfo.attachments?.[0]?.name || "Attachment")}
                  </p>
                </div>
                {/* Receipt rows — Sent always, Delivered once broadcast, and
                    Seen by N (community read receipts are a count, not a
                    single timestamp like 1:1 chats). */}
                {(
                  [
                    {
                      label: "Sent",
                      value: messageInfo.createdAt
                        ? new Date(messageInfo.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—",
                      date: messageInfo.createdAt
                        ? new Date(messageInfo.createdAt).toLocaleDateString([], {
                            month: "short",
                            day: "numeric",
                          })
                        : "",
                      icon: <CustomCheck className="h-3.5 w-4 text-zinc-550" />,
                      highlight: false,
                    },
                    {
                      label: "Delivered",
                      value: messageInfo.deliveredAt
                        ? new Date(messageInfo.deliveredAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "Not delivered yet",
                      date: messageInfo.deliveredAt
                        ? new Date(messageInfo.deliveredAt).toLocaleDateString([], {
                            month: "short",
                            day: "numeric",
                          })
                        : "",
                      icon: <CustomCheckCheck className="h-3.5 w-4.5 text-zinc-550" />,
                      highlight: false,
                    },
                    {
                      label: "Seen by",
                      value:
                        (messageInfo.seenBy?.length || 0) > 0
                          ? `${messageInfo.seenBy!.length} member${
                              messageInfo.seenBy!.length === 1 ? "" : "s"
                            }`
                          : "No one yet",
                      date: "",
                      icon: <CustomCheckCheck className="h-3.5 w-4.5 text-[#38bdf8]" />,
                      highlight: (messageInfo.seenBy?.length || 0) > 0,
                    },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className={`flex items-center justify-between py-2.5 border-b border-zinc-800/40 last:border-0 ${
                        row.highlight ? "" : "opacity-80"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`text-[11px] font-bold ${
                            row.highlight ? "text-sky-400" : "text-zinc-400"
                          }`}
                        >
                          {row.label}
                        </span>
                        {row.icon}
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] font-semibold text-zinc-200">
                          {row.value}
                        </p>
                        {row.date && (
                          <p className="text-[9px] text-zinc-500">{row.date}</p>
                        )}
                      </div>
                    </div>
                  ))
                )}
                {/* Seen-by member list — names + avatars (WhatsApp-group
                    style), resolved lazily from the server when the panel
                    opens. Shown once we have profiles to render. */}
                {messageInfoSeenBy.length > 0 && (
                  <div className="mt-3 pt-1 space-y-2 max-h-44 overflow-y-auto">
                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">
                      Read by
                    </p>
                    {messageInfoSeenBy.map((m) => (
                      <div key={m._id} className="flex items-center gap-2.5">
                        {m.profilePic?.url ? (
                          <img
                            src={m.profilePic.url}
                            alt={m.username}
                            className="h-6 w-6 rounded-full object-cover shrink-0"
                          />
                        ) : (
                          <div className="h-6 w-6 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[9px] font-bold text-zinc-400 uppercase shrink-0">
                            {(m.fullName || m.username || "?")[0]}
                          </div>
                        )}
                        <span className="text-[11px] font-semibold text-zinc-200 truncate">
                          {m.fullName || m.username}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </>,
          document.body
        )}

        {/* Channel three-dot menu — rename / delete for the room you're
            currently inside (admins only, general channel excluded) */}
        {roomMenu && createPortal(
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[300]"
              onClick={() => setRoomMenu(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed z-[310] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden py-1 min-w-[180px] max-w-[calc(100vw-1rem)]"
              style={{ left: roomMenu.x, top: roomMenu.y }}
            >
              <button
                onClick={() => {
                  setRoomNameInput(roomMenu.roomName);
                  setRoomSlowModeInput(roomMenu.slowModeSeconds || 0);
                  setRoomModal({
                    mode: "rename",
                    roomId: roomMenu.roomId,
                    currentName: roomMenu.roomName,
                  });
                  setRoomMenu(null);
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <Edit3 className="h-3.5 w-3.5" />
                Rename channel
              </button>
              <button
                onClick={() => {
                  setRoomToDelete({
                    roomId: roomMenu.roomId,
                    name: roomMenu.roomName,
                  });
                  setRoomMenu(null);
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-red-400 hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete channel
              </button>
            </motion.div>
          </>,
          document.body
        )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* "My Communities" row context menu — long-press / right-click (mounted
          at root so it works in BOTH the list and chat views) */}
      {communityMenu && createPortal(
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300]"
            onClick={() => setCommunityMenu(null)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed z-[310] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden py-1 min-w-[190px] max-w-[calc(100vw-1rem)]"
            ref={communityMenuRef}
            style={{ left: communityMenu.x, top: communityMenu.y }}
          >
            <button
              onClick={() => handleToggleCommunityMute(communityMenu.community)}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              {communityMenu.community.muted ? (
                <>
                  <Bell className="h-3.5 w-3.5" />
                  Unmute notifications
                </>
              ) : (
                <>
                  <BellOff className="h-3.5 w-3.5" />
                  Mute notifications
                </>
              )}
            </button>
            <button
              onClick={() => {
                setPendingLeaveCommunityId(communityMenu.community._id);
                setConfirmLeaveOpen(true);
                setCommunityMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-red-400 hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              Leave community
            </button>
          </motion.div>
        </>,
        document.body
      )}

      <GlassCard
        className="w-full h-full !pt-0 sm:!pt-4 lg:!pt-4 xl:!pt-5 !pb-0 !px-0 flex !rounded-none sm:!rounded-3xl lg:!rounded-4xl sm:border sm:border-white/10"
      >
        {view === "list" && renderCommunityList()}
        {view === "chat" && renderCommunityChat()}
        {view === "profile" && selectedCommunity && (
  <React.Suspense fallback={null}>
          <CommunityProfileOverlay
            community={selectedCommunity}
            isAdmin={["creator", "admin"].includes(myRole(selectedCommunity))}
            isModerator={isModeratorOf(selectedCommunity)}
            userRole={myRole(selectedCommunity)}
            onClose={() => setView("chat")}
    onOpenSettings={() => setView("settings")}
    onUserSelected={onUserSelected}
  />
  </React.Suspense>
)}
{view === "settings" && selectedCommunity && (
  <React.Suspense fallback={null}>
  <CommunitySettingsPage
    community={selectedCommunity}
    userRole={myRole(selectedCommunity)}            onClose={() => setView("chat")}
    onUpdated={handleCommunityUpdated}
    onDeleted={handleCommunityDeleted}
  />
  </React.Suspense>
)}
      </GlassCard>
      {createModalOpen && (
        <React.Suspense fallback={null}>
          <CreateCommunityModal
            isOpen={createModalOpen}
            onClose={() => setCreateModalOpen(false)}
            onCreated={handleCommunityCreated}
          />
        </React.Suspense>
      )}
      <ConfirmDialog
        isOpen={confirmLeaveOpen}
        title="Leave community?"
        message={`Are you sure you want to leave "${
          (pendingLeaveCommunityId
            ? myCommunities.find((c) => c._id === pendingLeaveCommunityId) ||
              allCommunities.find((c) => c._id === pendingLeaveCommunityId)
            : selectedCommunity)?.name || "this community"
        }"? You'll need to rejoin to see messages again.`}
        confirmLabel={leavingCommunity ? "Leaving..." : "Leave"}
        cancelLabel="Stay"
        variant="danger"
        onConfirm={handleLeaveCurrentCommunity}
        onCancel={cancelLeaveCommunity}
      />
      <ConfirmDialog
        isOpen={confirmClearForMeOpen}
        title="Clear chat for me?"
        message={`This will clear all messages in "${selectedCommunity?.name || "this community"}" for you only. Other members will still see their messages.`}
        confirmLabel="Clear"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => {
          setMessages([]);
          setConfirmClearForMeOpen(false);
        }}
        onCancel={() => setConfirmClearForMeOpen(false)}
      />

      {/* Room create / rename modal */}
      {roomModal &&
        createPortal(
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
            onClick={() => setRoomModal(null)}
          >
            <motion.div
              initial={{ y: 40, scale: 0.97, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 40, scale: 0.97, opacity: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl border border-zinc-800 bg-zinc-950/95 backdrop-blur-xl shadow-2xl p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-white">
                  {roomModal.mode === "create" ? "Create room" : "Rename room"}
                </h3>
                <button
                  onClick={() => setRoomModal(null)}
                  className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4 text-zinc-400" />
                </button>
              </div>
              <input
                autoFocus
                value={roomNameInput}
                onChange={(e) => setRoomNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (roomModal.mode === "create") handleCreateRoom();
                    else handleRenameRoom();
                  }
                }}
                placeholder="e.g. memes, news, help"
                maxLength={30}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-white/40 focus:bg-zinc-900 transition-all"
              />
              {roomModal.mode === "create" && (
                <div className="mt-3">
                  <p className="text-[9px] font-black uppercase tracking-wider text-zinc-500 mb-1.5">
                    Channel type
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRoomTypeInput("text")}
                      className={`rounded-xl border px-3 py-2 text-left transition-all cursor-pointer ${
                        roomTypeInput === "text"
                          ? "border-white/40 bg-zinc-800/80"
                          : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
                      }`}
                    >
                      <p className="text-[11px] font-bold text-zinc-200">
                        Text
                      </p>
                      <p className="text-[9px] text-zinc-500 leading-tight mt-0.5">
                        Everyone can post
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRoomTypeInput("announcement")}
                      className={`rounded-xl border px-3 py-2 text-left transition-all cursor-pointer ${
                        roomTypeInput === "announcement"
                          ? "border-amber-400/40 bg-amber-500/10"
                          : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
                      }`}
                    >
                      <p className="text-[11px] font-bold text-amber-300 inline-flex items-center gap-1">
                        <Megaphone className="h-3 w-3" /> Announcement
                      </p>
                      <p className="text-[9px] text-zinc-500 leading-tight mt-0.5">
                        Only moderators post
                      </p>
                    </button>
                  </div>
                </div>
              )}
              {/* Discord-style slowmode — limit how often a member can post
                  in this channel (0 = off). Visible in BOTH create + rename. */}
              <div className="mt-3">
                <p className="text-[9px] font-black uppercase tracking-wider text-zinc-500 mb-1.5">
                  Slowmode
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { value: 0, label: "Off" },
                    { value: 5, label: "5s" },
                    { value: 15, label: "15s" },
                    { value: 30, label: "30s" },
                    { value: 60, label: "1m" },
                    { value: 300, label: "5m" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setRoomSlowModeInput(opt.value)}
                      className={`rounded-full border px-3 py-1.5 text-[10px] font-bold transition-all cursor-pointer ${
                        roomSlowModeInput === opt.value
                          ? "border-white/40 bg-zinc-800/80 text-white"
                          : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[9px] text-zinc-600 leading-tight">
                  Members can only send one message per interval in this channel
                  (moderators are never throttled).
                </p>
              </div>
              <p className="mt-3 text-[10px] text-zinc-500">
                Rooms are separate channels inside this community — only admins
                manage them.
              </p>
              <div className="flex items-center justify-end gap-2 mt-4">
                <button
                  onClick={() => setRoomModal(null)}
                  className="rounded-full px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() =>
                    roomModal.mode === "create"
                      ? handleCreateRoom()
                      : handleRenameRoom()
                  }
                  disabled={roomSaving || !roomNameInput.trim()}								className="rounded-full bg-aurora text-white border border-white/10 px-4 py-2 text-xs font-bold shadow-aurora hover:opacity-90 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                >
                  {roomSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                  {roomModal.mode === "create" ? "Create" : "Save"}
                </button>
              </div>
            </motion.div>
          </motion.div>,
          document.body
        )}

      {/* Room delete confirmation */}
      {roomToDelete && (
        <ConfirmDialog
          isOpen
          title="Delete room?"
          message={`Delete "#${roomToDelete.name}" and all of its messages? This cannot be undone.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={() => void handleDeleteRoom()}
          onCancel={() => setRoomToDelete(null)}
        />
      )}

      {/* Image Crop Modal */}
      {cropModalOpen && (
      <React.Suspense fallback={null}>
        <ImageCropModal
          isOpen={cropModalOpen}
          onClose={() => {
            setCropModalOpen(false);
            // Only clean up queue if there are no remaining items (otherwise handleCropComplete manages it)
            if (cropPendingQueueRef.current.length === 0) {
              setCropQueueFiles([]);
              setCropSrc(null);
            }
          }}
          imageSrc={cropSrc || ""}
          onCropComplete={handleCropComplete}
        />
      </React.Suspense>
      )}

      {/* Group call floor — LiveKit-powered multi-participant audio/video */}
      {showGroupCall && groupCallToken && groupCallUrl && selectedCommunity && (
        <React.Suspense fallback={null}>
          <GroupCallFloor
            livekitUrl={groupCallUrl}
            token={groupCallToken}
            roomName={groupCallRoomName}
            callType={groupCallType}
            onLeave={() => {
              setShowGroupCall(false);
              setGroupCallToken(null);
              socket?.emit("community:call-ended", {
                communityId: selectedCommunity._id,
              });
            }}
          />
        </React.Suspense>
      )}

      {/* Forward Message Modal */}
      {forwardModal && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => {
                setForwardModal(null);
                setSelectedForwardConvIds([]);
                setForwardConversations([]);
              }}
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="relative z-10 w-full max-w-md mx-4 bg-zinc-900/95 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden max-h-[80vh] flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50 shrink-0">
                <h3 className="text-label text-base font-semibold text-white">Forward Message</h3>
                <button
                  onClick={() => {
                    setForwardModal(null);
                    setSelectedForwardConvIds([]);
                    setForwardConversations([]);
                  }}
                  className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  <X className="h-3.5 w-3.5 text-zinc-500" />
                </button>
              </div>

              {/* Message preview */}
              <div className="px-4 py-3 border-b border-zinc-800/30 bg-zinc-900/60 shrink-0">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                  Message
                </p>
                <div className="flex items-start gap-2.5">
                  <div className="h-6 w-6 rounded-full bg-zinc-800 shrink-0 flex items-center justify-center overflow-hidden">
                    {forwardModal.message.sender.profilePic?.url ? (
                      <img src={optimizeImageUrl(forwardModal.message.sender.profilePic?.url)!} alt="" className="h-full w-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <span className="text-[8px] font-bold text-zinc-500">
                        {forwardModal.message.sender.fullName?.charAt(0) || "?"}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold text-zinc-300 line-clamp-2 leading-snug">
                      {forwardModal.message.text || (forwardModal.message.attachments?.length ? "Attachment" : "")}
                    </p>
                    <p className="text-[9px] text-zinc-400 mt-0.5">
                      {forwardModal.message.sender.fullName} · {formatMessageTime(forwardModal.message.createdAt)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Conversation list */}
              <div className="flex-1 overflow-y-auto px-4 py-2">
                {loadingForwardConvs ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-5 w-5 text-zinc-500 animate-spin" />
                  </div>
                ) : forwardConversations.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <MessageSquare className="h-8 w-8 text-zinc-700 mb-2" />
                    <p className="text-sm font-semibold text-zinc-400">No conversations yet</p>
                    <p className="text-[11px] text-zinc-400 mt-1">
                      Start a chat to forward messages
                    </p>
                  </div>
                ) : (
                  <div className="space-y-0.5 py-1">
                    {forwardConversations.map((conv) => {
                      const partner = conv.participants?.find((p: any) => p._id !== user._id);
                      const isSelected = selectedForwardConvIds.includes(conv._id);
                      return (
                        <button
                          key={conv._id}
                          onClick={() => handleToggleForwardSelection(conv._id)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all cursor-pointer text-left ${
                            isSelected
                              ? "bg-white/10 border border-white/20"
                              : "hover:bg-zinc-800/50 border border-transparent"
                          }`}
                        >
                          <div className="h-9 w-9 rounded-full bg-zinc-800 shrink-0 flex items-center justify-center overflow-hidden border border-zinc-700/50">
                            {partner?.profilePic?.url ? (
                              <img src={optimizeImageUrl(partner.profilePic?.url)!} alt="" className="h-full w-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            ) : (
                              <span className="text-[10px] font-bold text-zinc-500">
                                {partner?.fullName?.charAt(0) || "?"}
                              </span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-zinc-200 truncate">
                              {partner?.fullName || "Unknown"}
                            </p>
                            <p className="text-[11px] text-zinc-500 truncate">
                              @{partner?.username || "unknown"}
                            </p>
                          </div>
                          <div className={`h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                            isSelected ? "bg-white border-white" : "border-zinc-600"
                          }`}>
                            {isSelected && (
                              <svg className="h-3 w-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-4 py-3 border-t border-zinc-800/50 shrink-0">
                <button
                  onClick={handleExecuteForward}
                  disabled={selectedForwardConvIds.length === 0}
                  className="w-full rounded-full bg-aurora hover:opacity-90 disabled:bg-zinc-800 disabled:text-zinc-600 text-white border border-white/10 shadow-aurora text-sm font-bold py-2.5 transition-all cursor-pointer disabled:cursor-not-allowed"
                >
                  {selectedForwardConvIds.length > 0
                    ? `Send (${selectedForwardConvIds.length}/5)`
                    : "Select conversations"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}

    </>
  );
}

// skeleton placeholder renders while members endpoint loads

// images use data-src + IntersectionObserver; load on viewport entry
