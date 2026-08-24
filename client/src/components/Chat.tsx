import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useKeyboardOpen } from "../hooks/useKeyboardOpen";
import { useLenisScroll } from "../hooks/useLenisScroll";
import { motion, AnimatePresence } from "motion/react";
import {
	MessageSquare,
	Send,
	Image as ImageIcon,
	Search,
	Trash2,
	Edit2,
	X,
	Loader2,
	CornerDownLeft,
	ArrowLeft,
	Copy,
	Share2,
	Languages,
	User,
	Mic,
	Square,
	Play,
	Pause,
	Pin,
	PinOff,
	Download,
	Phone,
	Video,
	ChevronDown,
	MoreVertical,
	ShieldAlert,
	Shield,
	ShieldOff,
	Bell,
	BellOff,
	WifiOff,
	Archive,
	ArchiveRestore,
	Star,
	FileText,
	FileAudio,
	Clapperboard,
	Info,
	Timer,
} from "lucide-react";

import ImageCropModal from "./ImageCropModal";
import { Socket } from "socket.io-client";
import {
	User as UserType,
	Conversation,
	Message,
	MessageReaction,
} from "../types";
import GlassCard from "./GlassCard";
import UserAvatar from "./UserAvatar";
import VerifiedBadge from "./VerifiedBadge";
import DayOneFlair from "./DayOneFlair";
import ChatGallery from "./ChatGallery";
import Skeleton from "./Skeleton";
import { apiFetch, uploadWithProgress } from "../utils/api";
import {
	evictCachedResponse,
	getCachedResponse,
} from "../utils/apiCache";
import { getOfflineFallback } from "../utils/dexieBridge";
import { formatPresence } from "../utils/presence";
import {
	getVisibleViewport,
	useMenuViewportClamp,
} from "../utils/menuPositioning";
import {
	cacheSingleMessage,
	deletePendingChatSend,
	getPendingChatSends,
	putPendingChatSend,
	db,
} from "../utils/offlineDB";
import { logger } from "../utils/logger";
import { downscaleImageFile } from "../utils/imageCompression";	import { optimizeImageUrl, videoPosterUrl } from "../utils/imageUrls";
	import { popMessageBubble } from "../utils/messageHighlight";
	import { downloadAttachment } from "../utils/downloads";
import { hapticSuccess } from "../utils/haptics";
import ValidationMessage from "./ValidationMessage";
import MentionSuggestions from "./MentionSuggestions";
import { useMentionAutocomplete } from "../hooks/useMentionAutocomplete";
import TypingIndicator from "./TypingIndicator";
import MessageBubble from "./MessageBubble";
import CallSystemMessage from "./CallSystemMessage";
import EmojiReactionMenu from "./EmojiReactionMenu";
import ConfirmDialog from "./ConfirmDialog";
import ConversationListItem from "./ConversationListItem";
import { validateChatMessage } from "../utils/validation";

/**
 * Replace a pending placeholder IN PLACE with its confirmed server copy so
 * queued messages keep their send order. A filter+append would push the
 * confirmed message past later pendings — showing those not-yet-sent
 * messages ABOVE the first sent one until every message confirms and the
 * order "fixes itself".
 *
 * - If the confirmed copy is already in the list (the socket echo won the
 *   race), just drop the placeholder.
 * - If the placeholder is gone (e.g. cancelled), append when the confirmed
 *   copy isn't present yet.
 */
const replacePendingWithSent = (
	prev: Message[],
	pendingId: string,
	sentMessage: any,
): Message[] => {
	if (prev.some((m) => m._id === sentMessage?._id)) {
		return prev.filter((m) => m._id !== pendingId);
	}
	const idx = prev.findIndex((m) => m._id === pendingId);
	if (idx === -1) return [...prev, sentMessage];
	const next = [...prev];
	next[idx] = sentMessage;
	return next;
};

type MediaTabKey = "image" | "video" | "audio" | "file" | "starred";

// Media-library tabs — shared by the 1:1 chat modal.
const MEDIA_TABS: { key: MediaTabKey; label: string; Icon: any }[] = [
	{ key: "image", label: "Photos", Icon: ImageIcon },
	{ key: "video", label: "Videos", Icon: Clapperboard },
	{ key: "audio", label: "Audio", Icon: FileAudio },
	{ key: "file", label: "Docs", Icon: FileText },
	{ key: "starred", label: "Starred", Icon: Star },
];

// Read-receipt glyphs — same SVGs as MessageBubble (duplicated here so the
// Message info panel doesn't need an export from a sibling).
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

interface ChatProps {
	user: UserType;
	socket: Socket | null;
	conversations: Conversation[];
	// True until the parent's FIRST conversations fetch resolves (cache paint
	// or network) — shows a loading skeleton instead of a false empty state.
	conversationsLoading?: boolean;
	setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>;
	onUserSelected: (username: string) => void;
	onBack: () => void;
	onChatConversationChange?: (hasActive: boolean) => void;
	// When set (non-null), auto-open this conversation (URL restore / deep link).
	openConversationId?: string | null;
	// Reports the currently-open conversation id (null when on the list) so the
	// parent can sync it into the URL (/chats/<id>).
	onConversationOpenChange?: (id: string | null) => void;
	// When set (non-null), the chat auto-opens a conversation with that user
	// (get-or-create) — used by the profile "Message" button deep link.
	openWithUserId?: string | null;
	onOpenWithUserIdHandled?: () => void;
	onStartCall?: (
		partnerId: string,
		partnerName: string,
		type: "audio" | "video",
	) => void;
}

export default function Chat({
	user,
	socket,
	conversations,
	conversationsLoading = false,
	setConversations,
	onUserSelected,
	onChatConversationChange,
	onStartCall,
	openConversationId,
	onConversationOpenChange,
	openWithUserId,
	onOpenWithUserIdHandled,
}: ChatProps) {
	const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
	// True when the open conversation's partner has a mutual block
	// relationship (either direction) — disables the composer entirely.
	const [blockedPartner, setBlockedPartner] = useState(false);
	// True when WE have blocked the partner (blockedPartner is any-direction).
	const [iBlockedPartner, setIBlockedPartner] = useState(false);
	const [blockToggling, setBlockToggling] = useState(false);
	// Ref for the WhatsApp-style auto-growing composer textarea
	const composerRef = useRef<HTMLTextAreaElement>(null);
	const editComposerRef = useRef<HTMLTextAreaElement>(null);
	const [messages, setMessages] = useState<Message[]>([]);
	// WhatsApp-style "Unread messages" divider — the createdAt of the FIRST
	// unread message when the conversation was opened with a badge. The
	// divider renders above it; sending a message or tapping scroll-to-bottom
	// clears it. null = no divider.
	const [unreadDividerTs, setUnreadDividerTs] = useState<string | null>(null);
	const unreadAtOpenRef = useRef(0);
	// Given the freshly-loaded thread (server/cache copy, WITHOUT optimistic
	// pending messages), mark where the unread block starts.
	const applyUnreadDivider = (msgs: Message[]) => {
		const n = unreadAtOpenRef.current;
		if (!n || n <= 0 || msgs.length === 0) {
			setUnreadDividerTs(null);
			return;
		}
		const idx = Math.max(0, msgs.length - Math.min(n, msgs.length));
		setUnreadDividerTs(msgs[idx]?.createdAt || null);
	};
	const [pinnedMessages, setPinnedMessages] = useState<Message[]>([]);
	const [showPinnedPanel, setShowPinnedPanel] = useState(false);
	const [loadingConvs] = useState(false);
	// Show a skeleton while the parent's first fetch is still in flight so a
	// slow load never flashes the false "No conversations yet" empty state.
	const showConvSkeleton = loadingConvs || conversationsLoading;
	const [loadingMsgs, setLoadingMsgs] = useState(false);
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

	const clearFieldError = (field: string) => {
		setFieldErrors((prev) => {
			if (!prev[field]) return prev;
			const next = { ...prev };
			delete next[field];
			return next;
		});
	};

	const [inputText, setInputText] = useState("");
	// Per-chat drafts — the composer text is remembered per conversation, so
	// switching chats never loses what you were typing (WhatsApp behavior).
	// Persisted to localStorage (debounced) so a reload keeps them too.
	const draftsRef = useRef<Map<string, string>>(new Map());
	const DRAFTS_STORAGE_KEY = "orbit:chat-drafts";
	const draftsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => {
		try {
			const raw = localStorage.getItem(DRAFTS_STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				if (parsed && typeof parsed === "object") {
					draftsRef.current = new Map(Object.entries(parsed));
				}
			}
		} catch {
			/* corrupt storage — drafts just start empty */
		}
		return () => {
			if (draftsSaveTimerRef.current) clearTimeout(draftsSaveTimerRef.current);
		};
	}, []);
	// Persist the draft map to localStorage (debounced 300ms).
	const saveDrafts = () => {
		if (draftsSaveTimerRef.current) clearTimeout(draftsSaveTimerRef.current);
		draftsSaveTimerRef.current = setTimeout(() => {
			try {
				localStorage.setItem(
					DRAFTS_STORAGE_KEY,
					JSON.stringify(Object.fromEntries(draftsRef.current)),
				);
			} catch {
				/* storage full/blocked — draft still lives in-session */
			}
		}, 300);
	};
	// @mention autocomplete (DM composer) — global user search source.
	const {
		showMentionDropdown,
		candidateUsers,
		handleMentionChange,
		selectMentionCandidate,
		closeMentionDropdown,
	} = useMentionAutocomplete({ value: inputText, setValue: setInputText });
	const mentionDropdownRef = useRef<HTMLDivElement>(null);

	// New conversation / User Search state
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<UserType[]>([]);
	const [searching, setSearching] = useState(false);
	// Debounce + monotonic seq for user search — without this every keystroke
	// fires a network request (hitting the server rate limiter fast) and
	// out-of-order responses can overwrite newer results with stale ones.
	const userSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const userSearchSeqRef = useRef(0);
	const [showSearchDropdown, setShowSearchDropdown] = useState(false);
	// Global chat search — digs through ALL conversations' message content
	// (WhatsApp-style "search chats"), shown under the user results.
	const [chatMessageResults, setChatMessageResults] = useState<
		{
			conversationId: string;
			messageId: string;
			partner: {
				_id: string;
				username: string;
				fullName: string;
				profilePic?: { url: string };
			} | null;
			partnerId: string | null;
			text: string;
			hasAttachments: boolean;
			createdAt: string;
		}[]
	>([]);
	const [searchingChatMessages, setSearchingChatMessages] = useState(false);
	const chatMsgSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const chatMsgSearchSeqRef = useRef(0);

	// Clear the debounce timer on unmount so a pending search can't fire a
	// setState / wasted network request after the component is gone.
	useEffect(() => {
		return () => {
			if (userSearchTimerRef.current) clearTimeout(userSearchTimerRef.current);
			if (chatMsgSearchTimerRef.current) clearTimeout(chatMsgSearchTimerRef.current);
		};
	}, []);

	// Message search within conversation state
	const [showMessageSearch, setShowMessageSearch] = useState(false);
	const [messageSearchQuery, setMessageSearchQuery] = useState("");
	const [messageSearchResults, setMessageSearchResults] = useState<Message[]>([]);
	const [searchingMessages, setSearchingMessages] = useState(false);
	const messageSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Monotonic counter so only the LATEST search query's response is applied
	// — prevents out-of-order responses from older keystrokes overwriting newer
	// results when the free-tier backend answers slowly.
	const messageSearchSeqRef = useRef(0);

	// Drag-and-drop state
	const [isDragActive, setIsDragActive] = useState(false);

	// Media attachments upload
	const [attachments, setAttachments] = useState<File[]>([]);
	const [attachmentPreviews, setAttachmentPreviews] = useState<string[]>([]);
	// Scheduled send (WhatsApp/IG-style): null = send immediately; a Date
	// means the message is stored now and delivered at that time. The server
	// returns the persisted row with scheduledAt set; the bubble renders a
	// "Scheduled" chip until delivery flips it to a normal sent message.
	const [schedulePickerOpen, setSchedulePickerOpen] = useState(false);
	const [scheduledFor, setScheduledFor] = useState<Date | null>(null);
	// Synchronous mirror of the composer text so a submit handler can clear it
	// immediately. React state updates are async — without this, a rapid
	// double-submit (Enter + click) could send the same message twice.
	const inputTextRef = useRef("");
	inputTextRef.current = inputText;

	// Crop modal state
	const [cropModalOpen, setCropModalOpen] = useState(false);
	const [cropSrc, setCropSrc] = useState("");
	const [cropQueueFiles, setCropQueueFiles] = useState<File[]>([]);
	const cropPendingQueueRef = useRef<{ files: File[]; previews: string[]; cancelledFile?: { file: File; url: string } }>({ files: [], previews: [] });

	// Typing indicator states
	const [isTyping, setIsTyping] = useState(false);
	const [partnerTyping, setPartnerTyping] = useState(false);
	const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	// Voice note recording indicator states
	const [partnerRecording, setPartnerRecording] = useState(false);

	// Message edit state
	const [editingMessage, setEditingMessage] = useState<Message | null>(null);
	const [editText, setEditText] = useState("");

	// Voice note recording state
	const [isRecording, setIsRecording] = useState(false);
	const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
	const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
	const [recordingDuration, setRecordingDuration] = useState(0);
	const [isPlayingPreview, setIsPlayingPreview] = useState(false);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const audioChunksRef = useRef<Blob[]>([]);
	const activeUploadsRef = useRef<Record<string, AbortController>>({});
	const unsentPayloadsRef = useRef<Record<
		string,
		| { type: "message"; text: string; files: File[]; previews: string[]; replyToId?: string; scheduledAt?: string; fileDownscaled?: boolean }
		| { type: "voice_note"; blob: Blob; url: string; duration: number; replyToId?: string }
	>>({});
	// The conversation a pending send belongs to — captured at create time so
	// retry/cancel still target the right chat even after the user switches
	// conversations (the queue itself is keyed per conversation, but this
	// maps pendingId → convId for the retry/cancel affordances).
	const unsentConvIdsRef = useRef<Record<string, string>>({});
	const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
	const shouldSendAfterRecordRef = useRef(false);
	const recordingDurationRef = useRef(0);
	const audioPreviewRef = useRef<HTMLAudioElement | null>(null);

	// Reply state
	const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);

	// Clear confirmation dialog state
	const [showClearConfirm, setShowClearConfirm] = useState(false);
	const [showChatMenu, setShowChatMenu] = useState(false);
	const chatMenuRef = useRef<HTMLDivElement>(null);
	// Conversation-row context menu (long-press / right-click) — measured and
	// clamped to the visible viewport after render (see useMenuViewportClamp).
	const convMenuRef = useRef<HTMLDivElement>(null);

	// Delete conversation confirmation state
	const [deleteConvConfirmId, setDeleteConvConfirmId] = useState<string | null>(null);

	// Conversation list context menu (mute / delete) — opened via long-press
	// on mobile or right-click on desktop.
	const [convMenu, setConvMenu] = useState<{
		conv: Conversation;
		x: number;
		y: number;
	} | null>(null);
	const convMenuOpenedAtRef = useRef(0);

	// Context menu state
	const [contextMenu, setContextMenu] = useState<{
		message: Message;
		x: number;
		y: number;
	} | null>(null);

	// ── Archive (WhatsApp-style) ────────────────────────────────────────────
	// Archived chats drop out of the main list into an "Archived" section
	// (loaded lazily on first expand). A new incoming message un-archives the
	// chat server-side; the refresh event below reconciles both lists.
	const [archivedConvs, setArchivedConvs] = useState<Conversation[]>([]);
	const [showArchivedSection, setShowArchivedSection] = useState(false);
	const [archivedLoading, setArchivedLoading] = useState(false);
	const archivedFetchedRef = useRef(false);

	const loadArchivedConvs = async () => {
		if (archivedFetchedRef.current) return;
		archivedFetchedRef.current = true;
		setArchivedLoading(true);
		try {
			const res = await apiFetch("/api/chats/conversations/archived", {
				bypassCache: true,
			});
			const data = await res.json();
			if (res.ok && data.success) {
				setArchivedConvs(data.conversations || []);
			}
		} catch (err) {
			logger.warn("Failed to load archived conversations", err);
		} finally {
			setArchivedLoading(false);
		}
	};

	const handleToggleConvArchive = async (conv: Conversation) => {
		const target = !conv.archived;
		setConvMenu(null);
		// Optimistic UI — move the chat between the lists instantly.
		setConversations((prev) =>
			target
				? prev.filter((c) => c._id !== conv._id)
				: prev.some((c) => c._id === conv._id)
					? prev
					: [conv, ...prev],
		);
		setArchivedConvs((prev) =>
			target
				? [conv, ...prev.filter((c) => c._id !== conv._id)]
				: prev.filter((c) => c._id !== conv._id),
		);
		try {
			const res = await apiFetch(
				`/api/chats/conversations/${conv._id}/archive`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ archived: target }),
				},
			);
			const data = await res.json();
			if (!res.ok || !data.success) {
				throw new Error(data.message || "Archive failed");
			}
			// Reconcile with the server (its cache was evicted, so this is fresh).
			window.dispatchEvent(new Event("chatConversationsRefresh"));
		} catch (err) {
			// Revert on failure.
			setConversations((prev) =>
				target
					? prev.some((c) => c._id === conv._id)
						? prev
						: [conv, ...prev]
					: prev.filter((c) => c._id !== conv._id),
			);
			setArchivedConvs((prev) =>
				target
					? prev.filter((c) => c._id !== conv._id)
					: [conv, ...prev.filter((c) => c._id !== conv._id)],
			);
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message: "Couldn't update chat. Try again.",
						type: "error",
					},
				}),
			);
		}
	};

	// Message info panel — WhatsApp-style Sent / Delivered / Read timestamps
	// for an outgoing message.
	const [messageInfo, setMessageInfo] = useState<Message | null>(null);

	// ── Starred messages + 1:1 media library ───────────────────────────────
	// The chat header "Media & files" modal has tabs (Photos/Videos/Audio/
	// Docs/Starred) backed by the server endpoints added with the model.
	const [mediaLibOpen, setMediaLibOpen] = useState(false);
	const [mediaTab, setMediaTab] = useState<MediaTabKey>("image");
	const [mediaItems, setMediaItems] = useState<Message[]>([]);
	const [mediaLoading, setMediaLoading] = useState(false);
	const mediaSeqRef = useRef(0);

	const fetchMediaTab = async (
		tab: "image" | "video" | "audio" | "file" | "starred",
		convId: string,
	) => {
		const seq = ++mediaSeqRef.current;
		setMediaLoading(true);
		const path =
			tab === "starred"
				? `/api/chats/conversations/${convId}/starred`
				: `/api/chats/conversations/${convId}/media?type=${tab}`;
		try {
			// 1) Instant paint — stale-while-revalidate, same as the thread:
			// a previously-viewed tab renders from the local copy (CacheStorage
			// entry written on the last open, else Dexie) the moment the modal
			// opens, with NO network wait. Only the reconcile below can replace
			// it, so the library never flashes a skeleton over data we already
			// have on-device.
			try {
				const cached = await getCachedResponse<{
					success: boolean;
					messages?: Message[];
				}>(path);
				const fallback = (
					cached?.messages && cached.messages.length > 0
						? cached
						: await getOfflineFallback(path)
				) as { success: boolean; messages?: Message[] } | null;
				if (seq === mediaSeqRef.current && fallback?.messages?.length) {
					setMediaItems(fallback.messages);
					setMediaLoading(false);
				}
			} catch {
				/* cache read failures are non-critical */
			}

			// 2) Always reconcile with the server — the fresh copy replaces the
			// cached one the moment it lands (and rewrites both cache layers).
			const res = await apiFetch(path, { bypassCache: true });
			const data = await res.json();
			if (seq !== mediaSeqRef.current) return; // stale response
			if (res.ok && data.success) {
				setMediaItems(data.messages || []);
			} else {
				setMediaItems([]);
			}
		} catch {
			if (seq === mediaSeqRef.current) setMediaItems([]);
		} finally {
			if (seq === mediaSeqRef.current) setMediaLoading(false);
		}
	};

	const openMediaLibrary = (convId: string) => {
		setShowChatMenu(false);
		setMediaLibOpen(true);
		setMediaTab("image");
		setMediaItems([]);
		void fetchMediaTab("image", convId);
	};

	// Optimistically flip a message's star in the thread state.
	const applyStar = (messageId: string, starred: boolean) => {
		setMessages((prev) =>
			prev.map((m) =>
				m._id === messageId
					? {
							...m,
							savedBy: starred
								? [...new Set([...(m.savedBy || []), user._id])]
								: (m.savedBy || []).filter((id) => id !== user._id),
					  }
					: m,
			),
		);
	};

	const handleToggleStarMessage = async (msg: Message) => {
		const target = !(msg.savedBy || []).includes(user._id);
		setContextMenu(null);
		applyStar(msg._id, target);
		try {
			const res = await apiFetch(`/api/chats/messages/${msg._id}/star`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			const data = await res.json();
			if (!res.ok || !data.success) {
				throw new Error(data.message || "Failed to save message");
			}
		} catch {
			applyStar(msg._id, !target);
		}
	};

	// Ref for measuring context menu dimensions (viewport clamping)
	const contextMenuRef = useRef<HTMLDivElement>(null);

	// Emoji picker state

	// Forward modal state
	const [forwardModal, setForwardModal] = useState<{
		message: Message;
		x: number;
		y: number;
	} | null>(null);

	const [selectedForwardConvIds, setSelectedForwardConvIds] = useState<string[]>([]);

	// Camera capture state
	const [showCamera, setShowCamera] = useState(false);
	const cameraVideoRef = useRef<HTMLVideoElement>(null);
	const cameraStreamRef = useRef<MediaStream | null>(null);

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
			setAttachments((prev) => [...prev, file]);
			setAttachmentPreviews((prev) => [...prev, preview]);
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

	// Mobile detection state
	const [isMobile, setIsMobile] = useState(window.innerWidth < 614);

	useEffect(() => {
		const handleResize = () => {
			setIsMobile(window.innerWidth < 614);
		};
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, []);

	// Messages pagination
	const [messagesCursor, setMessagesCursor] = useState<string | null>(null);
	const [messagesHasMore, setMessagesHasMore] = useState(false);
	const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
	const messagesTopSentinelRef = useRef<HTMLDivElement>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const messagesContainerRef = useRef<HTMLDivElement>(null);
	// Swipe between conversations (WhatsApp/Telegram-style) — a horizontal
	// swipe on the open chat's message area jumps to the previous/next
	// conversation in the list. The left edge is left to swipe-back.
	const convSwipeStartXRef = useRef(0);
	const convSwipeStartYRef = useRef(0);
	const convIsSwipingRef = useRef(false);
	// Element the gesture STARTED on — message bubbles own horizontal swipes
	// (swipe-to-reply), so a conv-switch must never hijack them.
	const convSwipeStartElRef = useRef<HTMLElement | null>(null);
	// Lenis smooth scroll for the message thread — re-attached per
	// conversation so the scroll limit is always fresh.
	useLenisScroll(messagesContainerRef, {}, [selectedConv?._id]);
	const [showScrollToBottom, setShowScrollToBottom] = useState(false);

	// Ref for handleFileChange (avoids temporal dead zone issues in drag handlers)
	const handleFileChangeRef = useRef<((e: React.ChangeEvent<HTMLInputElement>) => void) | null>(null);

	// Sync ref with latest handleFileChange (avoids TDZ issues in drag handlers)
	useEffect(() => {
		handleFileChangeRef.current = handleFileChange;
	});

	// Refs for socket listener closures — prevents listener re-registration on conversation/user change
	const selectedConvRef = useRef(selectedConv);
	selectedConvRef.current = selectedConv;
	const userRef = useRef(user);
	userRef.current = user;
	const socketRef = useRef(socket);
	socketRef.current = socket;

	// Pending message IDs (optimistic messages not yet confirmed by server).
	// The SIZE of this set is the source of truth for "is anything sending" —
	// each in-flight message has its own pending id, so multiple messages can
	// be queued/concurrent and the composer stays enabled throughout.
	const [pendingMessageIds, setPendingMessageIds] = useState<Set<string>>(new Set());
	// Network connectivity — drives the offline banner + the queued-vs-sending
	// state of pending bubbles (clock "waiting for connection" vs spinner).
	const [isOnline, setIsOnline] = useState(navigator.onLine);
	useEffect(() => {
		const onOnline = () => setIsOnline(true);
		const onOffline = () => setIsOnline(false);
		window.addEventListener("online", onOnline);
		window.addEventListener("offline", onOffline);
		return () => {
			window.removeEventListener("online", onOnline);
			window.removeEventListener("offline", onOffline);
		};
	}, []);
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

	// ── Strict per-conversation send queue ──────────────────────────────
	// WhatsApp/Instagram guarantee: messages leave your device in the exact
	// order you sent them — one network call in flight per chat at a time.
	// Concurrent POSTs (HTTP/2 multiplexing, multiple connections, slow media
	// uploads) can reach the server out of order, which makes Mongo assign
	// ObjectIds in the wrong order and the thread render flipped. This queue
	// serializes sends per conversation: message N+1's POST doesn't start
	// until message N's finishes (or permanently fails), so arrival order at
	// the server always equals send order.
	//
	// run() returns the outcome: "ok" (done/cancelled), "failed" (permanent
	// — mark _failed, keep pumping so later messages aren't blocked), or
	// "retry" (offline/transient — put back at the HEAD and stop pumping so
	// ordering is preserved; the online listener resumes it).
	type SendOutcome = "ok" | "failed" | "retry";
	const sendQueueRef = useRef<
		Array<{
			convId: string;
			pendingId: string;
			run: () => Promise<SendOutcome>;
		}>
	>([]);
	const inFlightConvsRef = useRef<Set<string>>(new Set());

	const pumpSendQueue = useCallback(async (convId: string) => {
		if (inFlightConvsRef.current.has(convId)) return; // one in-flight per chat
		const queue = sendQueueRef.current;
		inFlightConvsRef.current.add(convId);
		try {
			while (true) {
				const idx = queue.findIndex((e) => e.convId === convId);
				if (idx === -1) break;
				const entry = queue[idx];
				queue.splice(idx, 1);
				let outcome: SendOutcome = "ok";
				try {
					outcome = await entry.run();
				} catch (err) {
					logger.error("Queued send crashed", err);
					outcome = "failed";
				}
				if (outcome === "retry") {
					// Offline/transient — put it back at the head and STOP.
					// Nothing after it may leave the device first (ordering).
					queue.unshift(entry);
					break;
				}
				// "ok" / "failed" → move on to the next queued message.
			}
		} finally {
			inFlightConvsRef.current.delete(convId);
		}
	}, []);

	const enqueueSend = useCallback(
		(
			convId: string,
			pendingId: string,
			run: () => Promise<SendOutcome>,
		) => {
			sendQueueRef.current.push({ convId, pendingId, run });
			void pumpSendQueue(convId);
		},
		[pumpSendQueue],
	);

	// When connectivity returns, resume every conversation that has queued
	// sends (the "retry" head re-runs first, preserving order).
	const resumeQueuedSends = useCallback(() => {
		const convIds = new Set(
			sendQueueRef.current.map((e) => e.convId),
		);
		for (const convId of convIds) void pumpSendQueue(convId);
	}, [pumpSendQueue]);

	// Notify parent when active conversation changes (for dock visibility)
	useEffect(() => {
		onChatConversationChange?.(selectedConv !== null);
	}, [selectedConv, onChatConversationChange]);

	// First-report guard: skip the initial null report while a deep-link
	// conversation id may still be resolving (the conversations list loads
	// async) — otherwise the parent would clear openConversationId before
	// the auto-select below could pick it up.
	//
	// IMPORTANT: initialize from the URL so remounting (tab switch) doesn't
	// cause a stale "not yet reported" → skip null → stuck-open loop.
	const reportedOpenConversationRef = useRef(!!openConversationId);

	// Report the open conversation id so the parent can mirror it into the
	// URL (/chats/<id>) — drives reload persistence and shareable links.
	useEffect(() => {
		if (!reportedOpenConversationRef.current) {
			reportedOpenConversationRef.current = true;
			if (!selectedConv && openConversationId) return;
		}
		onConversationOpenChange?.(selectedConv?._id ?? null);
	}, [selectedConv, onConversationOpenChange, openConversationId]);

	// Remember a conversation the USER explicitly closed via the back arrow.
	// The parent's openConversationId still holds the old id for one render
	// cycle after the close, which would otherwise make the auto-open effect
	// below instantly re-open the thread and make the back button feel dead.
	const userClosedConvRef = useRef<string | null>(null);
	const handleCloseConversation = useCallback(() => {
		userClosedConvRef.current = selectedConv?._id ?? null;
		setSelectedConv(null);
	}, [selectedConv?._id]);

	// A fresh external navigation to a conversation id (new deep link, reload)
	// overrides the "user closed" marker so auto-open can work again.
	// Also clear stale markers on remount (tab switch) — the ref survives
	// unmount but the user's intent does not.
	useEffect(() => {
		if (!openConversationId) {
			userClosedConvRef.current = null;
		}
	}, [openConversationId]);

	// Auto-select the conversation requested by the URL (e.g. a reload of
	// /chats/<id> or a shared link) once it's present in the list.
	useEffect(() => {
		if (!openConversationId) return;
		// Respect an explicit user close — never fight the back arrow.
		if (userClosedConvRef.current === openConversationId) return;
		if (selectedConv?._id === openConversationId) return;
		const target = conversations.find(
			(c) => c._id === openConversationId,
		);
		if (target) {
			setSelectedConv(target);
		}
	}, [openConversationId, conversations, selectedConv?._id]);


	// The URL requested a conversation that never appeared in the loaded list
	// (deleted / the list returned without it) — report null so the parent
	// clears the stale id from the URL instead of leaving /chats/<missing>.
	useEffect(() => {
		if (!openConversationId) return;
		if (selectedConv?._id === openConversationId) return;
		if (conversations.length === 0) return; // list still loading / empty
		const found = conversations.some(
			(c) => c._id === openConversationId,
		);
		if (!found) {
			onConversationOpenChange?.(null);
		}
	}, [openConversationId, conversations, selectedConv?._id, onConversationOpenChange]);
	// Browser back / URL cleared the conversation — close the thread so the
	// list shows instead of a stale open chat.
	const prevOpenConversationIdRef = useRef(openConversationId);
	useEffect(() => {
		if (prevOpenConversationIdRef.current && !openConversationId) {
			setSelectedConv(null);
		}
		prevOpenConversationIdRef.current = openConversationId;
	}, [openConversationId]);

	// WhatsApp-style composer: auto-grow the textarea to fit its content (up
	// to a max height) so text wraps instead of scrolling sideways. Re-runs
	// whenever the text changes or the composer remounts (recording / block
	// notice toggles), keeping the box sized to what you're typing.
	useEffect(() => {
		const el = composerRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
	}, [inputText, isRecording, blockedPartner]);

	// Fetch messages when conversation is selected or socket becomes available
	useEffect(() => {
		if (!selectedConv) {
			setMessages([]);
			setPinnedMessages([]);
			setBlockedPartner(false);
			setIBlockedPartner(false);
			setPartnerTyping(false);
			return;
		}

		const fetchMessages = async () => {
			setLoadingMsgs(true);
			setMessagesCursor(null);
			setMessagesHasMore(false);
			const messagesUrl = `/api/chats/conversations/${selectedConv._id}/messages?limit=20`;
			try {
				// 1) Instant paint — stale-while-revalidate. The thread is shown
				// from the local copy (CacheStorage entry for this URL written on
				// previous opens, else the Dexie layer primed at login) the moment
				// the conversation opens, with NO network wait — opening a chat
				// feels instant even on a slow/cold backend or offline. Only the
				// network fetch below can replace it, so we never miss messages
				// that arrived while the chat was closed.
				try {
					const cached = await getCachedResponse<{
						success: boolean;
						messages?: Message[];
						nextCursor?: string | null;
						hasMore?: boolean;
					}>(messagesUrl);
					const fallback = (
						cached?.messages && cached.messages.length > 0
							? cached
							: await getOfflineFallback(messagesUrl)
					) as {
						success: boolean;
						messages?: Message[];
						nextCursor?: string | null;
						hasMore?: boolean;
					} | null;
					if (fallback?.messages?.length) {
						setMessages(fallback.messages);
						setMessagesCursor(
							(fallback as any).nextCursor || null,
						);							setMessagesHasMore(!!(fallback as any).hasMore);
							setLoadingMsgs(false); // painted — no skeleton wait
							applyUnreadDivider(fallback.messages);
							scrollToBottom(true);
						}
				} catch {
					/* cache read failures are non-critical */
				}

				// 2) Always reconcile with the server — the fresh copy replaces
				// the cached one the moment it lands (and re-writes both cache
				// layers so the next open paints even newer data).
				const res = await apiFetch(messagesUrl, {
					bypassCache: true,
				});
				const data = await res.json();
				if (res.ok && data.success) {
					// Reconcile BUT never drop optimistic sends: pending messages
					// (queued/in-flight, still in this array or persisted in
					// Dexie) aren't part of the server copy yet — re-append them
					// after the fresh page so they don't vanish mid-send.
					const convId = selectedConvRef.current?._id;
					setMessages((prev) => {
						const fresh = data.messages || [];
						const pending = prev.filter(
							(m) =>
								(m as any)._pending &&
								convId &&
								(m as any)._pendingConv === convId,
						);
						if (pending.length === 0) return fresh;
						const freshIds = new Set(fresh.map((m: any) => m._id));
						return [
							...fresh,
							...pending.filter((m) => !freshIds.has(m._id)),
						];
					});
					setMessagesCursor(data.nextCursor || null);
					setMessagesHasMore(data.hasMore || false);
					applyUnreadDivider(data.messages || []);
					// Fresh open of the conversation — land at the latest message.
					scrollToBottom(true);
				}
			} catch (err) {
				logger.error("Failed to fetch messages", err);
			} finally {
				setLoadingMsgs(false);
			}
		};

		fetchMessages();

		// Fetch pinned messages for this conversation (mirrors community pins).
		// Cache-first: a previously-viewed conversation's banner paints from
		// the local copy instantly; pin/unpin evicts it below so it never
		// serves a stale list on the next open.
		apiFetch(`/api/chats/conversations/${selectedConv._id}/pinned-messages`)
			.then((res) => res.json())
			.then((data) => {
				if (data?.success) {
					setPinnedMessages(data.pinnedMessages || []);
				}
			})
			.catch(() => {
				/* non-critical — pins refresh on open */
			});

		// Blocked users must not exist for each other — if this conversation's
		// partner shares a block relationship (either direction), disable the
		// composer and surface a notice. The server also hard-rejects sends,
		// so this is UX plus a second layer of protection.
		setBlockedPartner(false);
		setIBlockedPartner(false);
		const partnerForBlockCheck = selectedConv.participants?.find(
			(p: any) => p && p._id !== user._id,
		);
		if (partnerForBlockCheck?._id) {
			apiFetch(`/api/blocks/${partnerForBlockCheck._id}/check`)
				.then((res) => res.json())
				.then((data) => {
					if (data?.success) {
						setBlockedPartner(
							!!(data.iBlocked || data.blockedByThem),
						);
						setIBlockedPartner(!!data.iBlocked);
					}
				})
				.catch(() => {
					/* non-critical — server enforces blocks anyway */
				});
		}

		// Reset partner recording indicator when switching conversations
		setPartnerRecording(false);
		setPartnerTyping(false);

		// Snapshot the unread count at open (for the "Unread messages"
		// divider) — computed once the thread paints. Reset until then.
		unreadAtOpenRef.current =
			selectedConv.unreadCounts?.[user._id] || 0;
		setUnreadDividerTs(null);

		// ── Reset composer state that must NEVER leak across conversations ──
		// Editing/reply context, staged attachments and the draft are all
		// per-chat state. Leaving them set while opening another chat lets a
		// send attach a reply/edit/media to the WRONG conversation (the reply
		// bar and edit form would show content from the previous chat, and a
		// quick Enter would send A's draft to B).
		setEditingMessage(null);
		setEditText("");
		setReplyToMessage(null);
		setAttachments([]);
		setAttachmentPreviews([]);
		// Restore this chat's saved draft — the PREVIOUS chat's draft was
		// already persisted on every keystroke, so switching never loses
		// either side (WhatsApp keeps per-chat drafts).
		setInputText(draftsRef.current.get(selectedConv._id) || "");

		// Clear unread count for this conversation when opening it
		setConversations((prev) =>
			prev.map((c) =>
				c._id === selectedConv._id
					? {
							...c,
							unreadCounts: { ...c.unreadCounts, [user._id]: 0 },
							// Opening the chat clears the missed-call badge locally
							// (the server also clears it in chat:join).
							missedCall: null,
						}
					: c,
			),
		);

		// Socket: Join room
		if (socket) {
			socket.emit("chat:join", { conversationId: selectedConv._id });
		}

		// Opening a conversation clears its unread count server-side (chat:join).
		// Evict the cached conversations list so a stale copy carrying the OLD
		// badge count can't resurface on the next read/reload — fetchConversations
		// is cache-first, so without this the unread badge comes back after reload
		// until a 30s background refresh happens to overwrite the cache.
		void evictCachedResponse("/api/chats/conversations");

		return () => {
			// Socket: Leave room
			if (socket && selectedConv) {
				socket.emit("chat:leave", { conversationId: selectedConv._id });
			}
		};
	}, [selectedConv, socket]);

	// ─── Read-receipt self-heal ────────────────────────────────────
	// If a messages:seen event was ever missed (socket reconnect blip,
	// event-ordering race, or a socket that couldn't authenticate), the
	// sender's tick stays stuck at one check FOREVER — no later event
	// re-flips it. While a conversation is open, periodically reconcile the
	// authoritative seen state straight from the server (bypassing both the
	// client cache and the server cache, which is cleared on send + join) and
	// MERGE it into the messages in state: only upgrades seen → true and
	// fills seenAt, never drops, reorders, or rewrites anything else.
	useEffect(() => {
		const convId = selectedConv?._id;
		if (!convId) return;
		let cancelled = false;
		const reconcileSeen = async () => {
			try {
				const res = await apiFetch(
					`/api/chats/conversations/${convId}/messages?limit=20`,
					{ bypassCache: true },
				);
				const data = await res.json();
				if (!res.ok || !data.success || cancelled) return;
				const fresh: any[] = data.messages || [];
				if (fresh.length === 0) return;
				const seenById = new Map<string, any>();
				for (const m of fresh) seenById.set(m._id, m);
				setMessages((prev) => {
					let changed = false;
					const next = prev.map((m) => {
						const f = seenById.get(m._id);
						if (f && f.seen && !m.seen) {
							changed = true;
							return {
								...m,
								seen: true,
								seenAt:
									f.seenAt ||
									new Date().toISOString(),
							};
						}
						return m;
					});
					return changed ? next : prev;
				});
			} catch {
				// Offline / network hiccup — skip this round.
			}
		};
		// First pass shortly after opening (covers events missed before the
		// socket attached), then a light interval while the chat stays open.
		const first = setTimeout(() => void reconcileSeen(), 2500);
		const timer = setInterval(() => void reconcileSeen(), 30000);
		return () => {
			cancelled = true;
			clearTimeout(first);
			clearInterval(timer);
		};
	}, [selectedConv?._id]);

	// ─── Swipe between conversations ───────────────────────────────
	const handleConvTouchStart = (e: React.TouchEvent) => {
		const touch = e.touches[0];
		if (!touch) return;
		convSwipeStartXRef.current = touch.clientX;
		convSwipeStartYRef.current = touch.clientY;
		convIsSwipingRef.current = false;
		convSwipeStartElRef.current = e.target as HTMLElement | null;
	};

	const handleConvTouchMove = (e: React.TouchEvent) => {
		const touch = e.touches[0];
		if (!touch) return;
		const dx = touch.clientX - convSwipeStartXRef.current;
		const dy = touch.clientY - convSwipeStartYRef.current;
		if (
			!convIsSwipingRef.current &&
			Math.abs(dx) > 15 &&
			Math.abs(dx) > Math.abs(dy) * 1.5
		) {
			convIsSwipingRef.current = true;
		}
	};

	const handleConvTouchEnd = (e: React.TouchEvent) => {
		if (!convIsSwipingRef.current) return;
		convIsSwipingRef.current = false;
		const touch = e.changedTouches[0];
		if (!touch) return;
		const dx = touch.clientX - convSwipeStartXRef.current;
		if (Math.abs(dx) < 60) return;
		if (!selectedConv || conversations.length < 2) return;

		// Defense-in-depth: message bubbles own horizontal swipes (reply). Even
		// though the bubble stops propagation when its reply swipe fires, never
		// let a conv-switch start on a bubble.
		if (convSwipeStartElRef.current?.closest('[id^="msg-"]')) return;

		const idx = conversations.findIndex((c) => c._id === selectedConv._id);
		if (idx === -1) return;

		let next: Conversation | null = null;
		if (dx < 0 && idx < conversations.length - 1) {
			// Swipe left → next conversation
			next = conversations[idx + 1];
		} else if (
			dx > 0 &&
			idx > 0 &&
			convSwipeStartXRef.current > 40
		) {
			// Swipe right → previous conversation (the left edge is reserved for
			// swipe-back — checked against the START position, so an edge swipe
			// never triggers both gestures).
			next = conversations[idx - 1];
		}

		if (next && next._id !== selectedConv._id) {
			hapticSuccess();
			setSelectedConv(next);
		}
	};	// Timestamp ref to prevent synthetic click events on mobile from closing the
	// context menu immediately after a long-press (browsers fire click after touchend).
	const contextMenuOpenedAtRef = useRef(0);

	// Close context menu when clicking outside.
	// Uses a timestamp guard to ignore synthetic click events that mobile browsers
	// fire after touchend — these race with the long-press handler (500ms in MessageBubble)
	// and cause the menu to open and immediately close. Clicks more than 300ms after the
	// menu opened are real user clicks (e.g. tapping outside) and should close the menu.
	// The backdrop overlay also handles tap-to-close on mobile.
	useEffect(() => {
		const handleClick = () => {
			if (Date.now() - contextMenuOpenedAtRef.current > 300) {
				setContextMenu(null);
			}
			if (Date.now() - convMenuOpenedAtRef.current > 300) {
				setConvMenu(null);
			}
		};
		window.addEventListener("click", handleClick);
		return () => window.removeEventListener("click", handleClick);
	}, []);

	// Close the header chat-options menu when clicking outside it or pressing Escape
	useEffect(() => {
		if (!showChatMenu) return;
		const handleClick = (e: MouseEvent) => {
			if (chatMenuRef.current && !chatMenuRef.current.contains(e.target as Node)) {
				setShowChatMenu(false);
			}
		};
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setShowChatMenu(false);
		};
		document.addEventListener("mousedown", handleClick);
		document.addEventListener("keydown", handleKey);
		return () => {
			document.removeEventListener("mousedown", handleClick);
			document.removeEventListener("keydown", handleKey);
		};
	}, [showChatMenu]);

	// ─── Context Menu Viewport Clamping ────────────────────────────
	// After each context menu renders, measure its ACTUAL size and clamp it
	// fully inside the VISIBLE viewport (visualViewport-aware, so mobile
	// toolbars / the on-screen keyboard can't cut the bottom off). Runs
	// before paint, so the corrected position is never seen.
	useMenuViewportClamp(contextMenuRef, contextMenu);
	useMenuViewportClamp(convMenuRef, convMenu);

	// Handle Socket Events — reads from refs to avoid re-registering listeners on conv/user change
	useEffect(() => {
		const s = socket;
		if (!s) return;

		// Rejoin the active conversation room when socket reconnects (e.g. mobile after sleep)
		// This ensures isRecipientActiveInConversation works on the server for read receipts
		s.on("connect", () => {
			const currentConv = selectedConvRef.current;
			if (currentConv) {
				logger.info(
					"Chat: Socket reconnected, rejoining conversation room",
					{ conversationId: currentConv._id },
				);
				s.emit("chat:join", { conversationId: currentConv._id });
			}
		});

		// Listen for presence updates
		s.on(
			"user:presence",
			({
				userId: presenceUserId,
				status,
			}: {
				userId: string;
				status: "online" | "offline";
			}) => {
				logger.info("Chat: Received user:presence event", {
					presenceUserId,
					status,
				});
				setConversations((prev) =>
					prev.map((c) => {
						const other = c.participants.find(
							(p) => p && p._id === presenceUserId,
						);
						if (other) {
							return {
								...c,
								presence: status as "online" | "offline",
							};
						}
						return c;
					}),
				);
			},
		);

		// Listen for new messages
		s.on("message:new", (message: Message) => {
			logger.info("Chat: Received message:new event", {
				messageId: message._id,
				conversationId: message.conversation,
			});
			const currentConv = selectedConvRef.current;
			const currentUser = userRef.current;
			if (!currentUser) return;
			// If message is for the current conversation, append it
			if (currentConv && message.conversation === currentConv._id) {
				setMessages((prev) => {
					// Prevent duplicates (the confirmed copy is already in the
					// list — e.g. added by this send's POST response).
					if (prev.some((m) => m._id === message._id)) return prev;

					const incomingSenderId =
						typeof message.sender === "string"
							? message.sender
							: message.sender?._id;

					// The server emits this event BEFORE responding to the send
					// POST, so the echo of our OWN message races the response.
					// Never wipe the queued pending placeholders here — that made
					// every OTHER in-flight message disappear the moment the
					// first one confirmed (they only came back as each POST
					// response landed). The POST success handler owns the
					// pending→confirmed replacement (it matches the exact
					// pendingId). While any pending for this conversation exists,
					// this echo is our own send — skip appending a duplicate;
					// the response will finalize the placeholder. Only when there
					// is NO pending (e.g. the same account sent from another
					// device) do we append the echo.
					if (incomingSenderId === currentUser._id) {
						const hasPendingInConv = prev.some(
							(m) =>
								(m as any)._pending &&
								(m as any)._pendingConv === message.conversation,
						);
						if (hasPendingInConv) return prev;
					}

					return [...prev, message];
				});
				// Auto-scroll to bottom so messages are visible (and thus get marked as seen)
				scrollToBottom();

				// Guarantee the sender's blue tick: the server marks the message as
				// seen at SEND time when the recipient is actively viewing, but a
				// reconnect blip (mobile socket drop/restore) can make that check
				// miss. Re-running chat:join when a message lands in the OPEN
				// conversation is idempotent and instantly marks everything seen,
				// so messages:seen fires back to the sender right away.
				const incomingSenderId =
					typeof message.sender === "string"
						? message.sender
						: message.sender?._id;
				if (incomingSenderId && incomingSenderId !== currentUser._id) {
					s.emit("chat:join", { conversationId: currentConv._id });
				}
			}

			// Update conversations list to show last message and re-sort.
			// For the ACTIVE conversation, keep unread at 0 (already set by chat:join).
			// For OTHER conversations, do NOT touch unreadCounts at all here — the
			// `chat:notification` event (server-authoritative, carries the exact count)
			// handles badge counts. Writing back a stale value here would race with
			// chat:notification and could clobber the server count with an outdated 0
			// (badge disappears) or double-count (badge shows +1).
			setConversations((prev) => {
				return prev
					.map((c) => {
						if (c._id === message.conversation) {
							if (currentConv && currentConv._id === c._id) {
								return {
									...c,
									lastMessage: message,
									lastAction: null,
									unreadCounts: {
										...c.unreadCounts,
										[currentUser._id]: 0,
									},
								};
							}
							// Non-active conversation — only update lastMessage,
							// leave unreadCounts to chat:notification.
							return { ...c, lastMessage: message, lastAction: null };
						}
						return c;
					})
					.sort(
						(a, b) =>
							new Date(
								b.lastMessage?.createdAt || b.updatedAt,
							).getTime() -
							new Date(
								a.lastMessage?.createdAt || a.updatedAt,
							).getTime(),
					);
			});
		});

		// Listen for message edits
		s.on("message:edit", (message: Message) => {
			logger.info("Chat: Received message:edit event", {
				messageId: message._id,
				conversationId: message.conversation,
			});
			const currentConv = selectedConvRef.current;
			if (currentConv && message.conversation === currentConv._id) {
				setMessages((prev) =>
					prev.map((m) => (m._id === message._id ? message : m)),
				);
			}
			setConversations((prev) =>
				prev.map((c) =>
					c._id === message.conversation
						? { ...c, lastMessage: message }
						: c,
				),
			);
		});

		// Listen for delete-for-me events
		s.on(
			"message:delete-for-me",
			({
				messageId,
				deletedByUserId,
			}: {
				messageId: string;
				deletedByUserId: string;
			}) => {
				const currentUser = userRef.current;
				if (!currentUser) return;
				if (deletedByUserId === currentUser._id) {
					// This was our own delete-for-me action, mark as deleted
					setMessages((prev) =>
						prev.map((m) =>
							m._id === messageId
								? {
										...m,
										isDeleted: true,
										text: "This message was deleted",
										attachments: [],
										deletedFor: [
											...(m.deletedFor || []),
											deletedByUserId,
										],
									}
								: m,
						),
					);
				}
			},
		);

		// Listen for message deletions
		s.on("message:delete", ({ messageId }: { messageId: string }) => {
			logger.info("Chat: Received message:delete event", { messageId });
			setMessages((prev) =>
				prev.map((m) =>
					m._id === messageId
						? {
								...m,
								isDeleted: true,
								text: "This message was deleted",
								attachments: [],
							}
						: m,
				),
			);
			// Update ALL conversations — this event now comes via both conversation room
			// and personal room, so we need to update regardless of active conversation
			setConversations((prev) =>
				prev.map((c) => {
					if (c.lastMessage?._id === messageId) {
						return {
							...c,
							lastMessage: {
								...c.lastMessage,
								isDeleted: true,
								text: "This message was deleted",
								attachments: [],
							},
						};
					}
					return c;
				}),
			);
		});

		// Listen for message pin / unpin events (server emits to conversation + personal rooms)
		s.on(
			"message:pin",
			(payload: { messageId: string; pinnedMessages?: Message[] }) => {
				logger.info("Chat: Received message:pin event", {
					messageId: payload.messageId,
				});
				if (payload.pinnedMessages) {
					setPinnedMessages(payload.pinnedMessages);
				} else {
					// Fall back to a refetch so the banner always reflects the server
					const currentConv = selectedConvRef.current;
					if (currentConv) {
						apiFetch(
							`/api/chats/conversations/${currentConv._id}/pinned-messages`,
							{ bypassCache: true },
						)
							.then((res) => res.json())
							.then((data) => {
								if (data?.success) setPinnedMessages(data.pinnedMessages || []);
							})
							.catch(() => {});
					}
				}
			},
		);

		s.on(
			"message:unpin",
			(payload: { messageId: string; pinnedMessages?: Message[] }) => {
				logger.info("Chat: Received message:unpin event", {
					messageId: payload.messageId,
				});
				if (payload.pinnedMessages) {
					setPinnedMessages(payload.pinnedMessages);
				} else {
					setPinnedMessages((prev) =>
						prev.filter((m) => m._id !== payload.messageId),
					);
				}
			},
		);

		// Listen for message reactions
		s.on(
			"message:reaction",
			(payload: {
				messageId: string;
				reaction: MessageReaction | null;
				type: "add" | "remove";
			}) => {
				logger.info("Chat: Received message:reaction event", payload);
				setMessages((prev) =>
					prev.map((m) => {
						if (m._id !== payload.messageId) return m;
						const reaction = payload.reaction;
						if (payload.type === "add" && reaction) {
							const existingReactions = m.reactions || [];
							const senderId =
								typeof reaction.sender === "string"
									? reaction.sender
									: reaction.sender._id;
							const filtered = existingReactions.filter((r) => {
								const sId =
									typeof r.sender === "string"
										? r.sender
										: r.sender?._id;
								return sId !== senderId;
							});
							return { ...m, reactions: [...filtered, reaction] };
						} else if (payload.type === "remove" && reaction) {
							const existingReactions = m.reactions || [];
							const senderId =
								typeof reaction.sender === "string"
									? reaction.sender
									: reaction.sender._id;
							const filtered = existingReactions.filter((r) => {
								const sId =
									typeof r.sender === "string"
										? r.sender
										: r.sender?._id;
								return !(
									sId === senderId &&
									r.emoji === reaction.emoji
								);
							});
							return { ...m, reactions: filtered };
						}
						return m;
					}),
				);

					// Keep the conversations-list preview in sync: a reaction added
					// to the newest message becomes the "last action" preview
					// (e.g. "reacted ❤️ to your message"); removing one falls back
					// to the last message preview.
					setConversations((prev) =>
						prev.map((c) => {
							if (c.lastMessage?._id !== payload.messageId) return c;
							if (payload.type !== "add" || !payload.reaction) {
								return { ...c, lastAction: null };
							}
							const sender = payload.reaction.sender;
							const actor =
								typeof sender === "string"
									? { _id: sender }
									: {
											_id: sender?._id || "",
											fullName: sender?.fullName || "",
											username: sender?.username || "",
									  };
							return {
								...c,
								lastAction: {
									type: "reaction" as const,
									emoji: payload.reaction.emoji || "",
									messageId: payload.messageId,
									messageSenderId: c.lastMessage.sender?._id || "",
									actor,
									createdAt: new Date().toISOString(),
								},
							};
						}),
					);
				},
			);

		// Listen for conversation deletions
		s.on(
			"conversation:delete",
			({ conversationId }: { conversationId: string }) => {
				logger.info("Chat: Received conversation:delete event", {
					conversationId,
				});
				setConversations((prev) =>
					prev.filter((c) => c._id !== conversationId),
				);
				setSelectedConv((currentSelected) => {
					if (currentSelected?._id === conversationId) {
						return null;
					}
					return currentSelected;
				});
			},
		);

		// Listen for conversation clearing (conversation room)
		s.on(
			"conversation:clear",
			({ conversationId }: { conversationId: string }) => {
				logger.info("Chat: Received conversation:clear event", {
					conversationId,
				});
				const currentConv = selectedConvRef.current;
				if (currentConv && currentConv._id === conversationId) {
					setMessages([]);
				}
				setConversations((prev) =>
					prev.map((c) =>
						c._id === conversationId
							? { ...c, lastMessage: undefined, lastAction: null }
							: c,
					),
				);
			},
		);

		// Listen for conversation cleared (personal room — when user is not in the conversation)
		s.on(
			"conversation:cleared",
			({ conversationId }: { conversationId: string }) => {
				logger.info("Chat: Received conversation:cleared event", {
					conversationId,
				});
				const currentConv = selectedConvRef.current;
				if (currentConv && currentConv._id === conversationId) {
					setMessages([]);
				}
				setConversations((prev) =>
					prev.map((c) =>
						c._id === conversationId
							? { ...c, lastMessage: undefined, lastAction: null }
							: c,
					),
				);
			},
		);

		// Listen for read receipts
		s.on(
			"messages:seen",
			({
				conversationId,
				seenBy,
				seenAt,
			}: {
				conversationId: string;
				seenBy: string;
				seenAt?: Date;
			}) => {
				logger.info("Chat: Received messages:seen event", {
					conversationId,
					seenBy,
					seenAt,
				});
				const currentConv = selectedConvRef.current;
				const currentUser = userRef.current;

				// Update messages in the active conversation (double tick)
				if (
					currentConv &&
					currentConv._id === conversationId &&
					seenBy !== currentUser?._id
				) {
					setMessages((prev) =>
						prev.map((m) => {
							const senderId =
								typeof m.sender === "string"
									? m.sender
									: m.sender?._id;
							if (senderId === currentUser?._id) {
								return {
									...m,
									seen: true,
									seenAt: seenAt
										? new Date(seenAt).toISOString()
										: new Date().toISOString(),
								};
							}
							return m;
						}),
					);
				}

				// Update the conversation's unreadCounts so the app-level chatBadgeCount recalculates
				setConversations((prev) =>
					prev.map((c) => {
						if (c._id === conversationId && currentUser) {
							return {
								...c,
								unreadCounts: {
									...c.unreadCounts,
									[currentUser._id]: 0,
								},
							};
						}
						return c;
					}),
				);
			},
		);

		// Listen for delivered receipts — the recipient's device received the
		// message (they're online but not viewing, so no seen event fires).
		// Updates the ✓ → ✓✓ transition + the Message info panel live.
		s.on(
			"messages:delivered",
			({
				conversationId,
				messageId,
				deliveredAt,
			}: {
				conversationId: string;
				messageId: string;
				deliveredAt?: Date;
			}) => {
				const currentConv = selectedConvRef.current;
				if (!currentConv || currentConv._id !== conversationId) return;
				setMessages((prev) =>
					prev.map((m) =>
						m._id === messageId && !m.deliveredAt
							? {
									...m,
									deliveredAt: deliveredAt
										? new Date(deliveredAt).toISOString()
										: new Date().toISOString(),
							  }
							: m,
					),
				);
			},
		);

		// Listen for voice note recording indicators
		s.on(
			"chat:recording",
			({
				conversationId,
				userId: recordingUserId,
				isRecording: partnerIsRecording,
			}: any) => {
				logger.info("Chat: Received chat:recording event", {
					conversationId,
					recordingUserId,
					isRecording: partnerIsRecording,
				});
				const currentConv = selectedConvRef.current;
				const currentUser = userRef.current;
				if (
					currentConv &&
					currentConv._id === conversationId &&
					recordingUserId !== currentUser?._id
				) {
					setPartnerRecording(partnerIsRecording);
				}
			},
		);

		// Listen for typing indicators
		s.on(
			"chat:typing",
			({
				conversationId,
				userId: typingUserId,
				isTyping: partnerIsTyping,
			}: any) => {
				logger.info("Chat: Received chat:typing event", {
					conversationId,
					typingUserId,
					isTyping: partnerIsTyping,
				});
				const currentConv = selectedConvRef.current;
				const currentUser = userRef.current;
				if (
					currentConv &&
					currentConv._id === conversationId &&
					typingUserId !== currentUser?._id
				) {
					setPartnerTyping(partnerIsTyping);
				}
			},
		);

		return () => {
			s.off("connect");
			s.off("user:presence");
			s.off("message:new");
			s.off("message:edit");
			s.off("message:delete");
			s.off("message:delete-for-me");
			s.off("message:pin");
			s.off("message:unpin");
			s.off("message:reaction");
			s.off("conversation:delete");
			s.off("conversation:clear");
			s.off("conversation:cleared");
			s.off("messages:seen");
			s.off("messages:delivered");
			s.off("chat:typing");
			s.off("chat:recording");
		};
	}, [socket]);

		// Track scroll position to show/hide the scroll-to-bottom button
	useEffect(() => {
		const container = messagesContainerRef.current;
		if (!container) return;

		const handleScroll = () => {
			const threshold = 200; // px from bottom before showing the button
			const isAtBottom =
				container.scrollHeight -
					container.scrollTop -
					container.clientHeight <
				threshold;
			nearBottomRef.current = isAtBottom;
			setShowScrollToBottom(!isAtBottom);
		};

		// Run once initially to set the correct state
		handleScroll();

		container.addEventListener("scroll", handleScroll, { passive: true });
		return () => container.removeEventListener("scroll", handleScroll);
	}, [selectedConv]);

	// Fetch older messages (infinite scroll up)
	const fetchOlderMessages = async () => {
		if (!messagesCursor || loadingOlderMessages || !selectedConv) return;
		setLoadingOlderMessages(true);
		// Preserve scroll position: record the height before loading
		const container = document.querySelector(
			'[class*="overflow-y-auto"][class*="scrollbar-thin"]',
		);
		const prevScrollHeight = container?.scrollHeight || 0;
		try {
			const res = await apiFetch(
				`/api/chats/conversations/${selectedConv._id}/messages?limit=20&cursor=${messagesCursor}`,
			);
			const data = await res.json();
			if (res.ok && data.success) {
				const newOnes = (data.messages || []).filter(
					(m: any) =>
						!messages.some((existing) => existing._id === m._id),
				);
				setMessages((prev) => [...newOnes, ...prev]);
				setMessagesCursor(data.nextCursor || null);
				setMessagesHasMore(data.hasMore || false);
				// Restore scroll position after new messages are prepended
				requestAnimationFrame(() => {
					if (container) {
						container.scrollTop =
							container.scrollHeight - prevScrollHeight;
					}
				});
			}
		} catch (err) {
			logger.error("Failed to fetch older messages", err);
		} finally {
			setLoadingOlderMessages(false);
		}
	};

	// IntersectionObserver for loading older messages
	useEffect(() => {
		if (!messagesHasMore || loadingOlderMessages || !selectedConv) return;
		const sentinel = messagesTopSentinelRef.current;
		if (!sentinel) return;

		// Find the scrollable parent
		let scrollParent: Element | null = null;
		let el: Element | null = sentinel.parentElement;
		while (el && el !== document.body) {
			const style = window.getComputedStyle(el);
			if (
				style.overflowY === "auto" ||
				style.overflowY === "scroll" ||
				style.overflow === "auto" ||
				style.overflow === "scroll"
			) {
				scrollParent = el;
				break;
			}
			el = el.parentElement;
		}

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) {
					fetchOlderMessages();
				}
			},
			{ root: scrollParent, rootMargin: "100px", threshold: 0 },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [messagesHasMore, loadingOlderMessages, messagesCursor, selectedConv]);

	// Scroll to bottom — uses double requestAnimationFrame to wait for React commit + paint.
	// This ensures messages are actually rendered in the DOM before scrolling,
	// and the smooth behavior lands at the correct position every time.
	// True while the user is at/near the bottom of the thread. Incoming
	// messages only auto-scroll when this is true — otherwise reading history
	// would be impossible (every new message yanks you back to the bottom).
	const nearBottomRef = useRef(true);
	const scrollToBottom = (force = false) => {
		// Reading history (scrolled up): never hijack the user's position for
		// INCOMING messages — just surface the scroll-to-bottom button. Only
		// own sends, conversation opens, and the button click force the scroll.
		if (!force && !nearBottomRef.current) {
			setShowScrollToBottom(true);
			return;
		}
		// Also hide the scroll-to-bottom button since we're going to the bottom
		setShowScrollToBottom(false);

		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
			});
		});
	};

	// Trigger typing notification — use refs to avoid stale closure in setTimeout
	const handleTyping = () => {
		const s = socketRef.current;
		const conv = selectedConvRef.current;
		if (!s || !conv) return;

		if (!isTyping) {
			setIsTyping(true);
			s.emit("chat:typing", { conversationId: conv._id, isTyping: true });
		}

		if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

		typingTimeoutRef.current = setTimeout(() => {
			setIsTyping(false);
			const s2 = socketRef.current;
			const conv2 = selectedConvRef.current;
			if (s2 && conv2) {
				s2.emit("chat:typing", {
					conversationId: conv2._id,
					isTyping: false,
				});
			}
		}, 2000);
	};

	// User search to start a new chat — debounced (300ms) with a monotonic
	// seq guard so only the latest query's response is applied.
	const handleUserSearch = async (val: string) => {
		const seq = userSearchSeqRef.current;
		setSearchQuery(val);
		if (!val.trim()) {
			setSearchResults([]);
			setShowSearchDropdown(false);
			setSearching(false);
			return;
		}

		setSearching(true);
		setShowSearchDropdown(true);
		try {
			const res = await apiFetch(
				`/api/search/users?q=${encodeURIComponent(val)}`,
			);
			const data = await res.json();
			// Drop responses from superseded keystrokes — only the latest wins.
			if (seq !== userSearchSeqRef.current) return;
			if (res.ok && data.success) {
				// Exclude current user
				setSearchResults(
					(data.users || []).filter(
						(u: UserType) => u._id !== user._id,
					),
				);
			} else {
				setSearchResults([]);
			}
		} catch (_e) {
			if (seq !== userSearchSeqRef.current) return;
			logger.error(_e);
			setSearchResults([]);
		} finally {
			if (seq === userSearchSeqRef.current) {
				setSearching(false);
			}
		}
	};

	// Message-content search across ALL conversations — debounced + monotonic
	// seq (same pattern as handleUserSearch). Powers the "Messages" section
	// of the chat-list search dropdown.
	const handleChatMessageSearch = async (val: string) => {
		const seq = chatMsgSearchSeqRef.current;
		if (!val.trim()) {
			setChatMessageResults([]);
			setSearchingChatMessages(false);
			return;
		}
		setSearchingChatMessages(true);
		try {
			const res = await apiFetch(
				`/api/chats/search?q=${encodeURIComponent(val)}`,
			);
			const data = await res.json();
			if (seq !== chatMsgSearchSeqRef.current) return;
			if (res.ok && data.success) {
				setChatMessageResults(data.results || []);
			} else {
				setChatMessageResults([]);
			}
		} catch (_e) {
			if (seq !== chatMsgSearchSeqRef.current) return;
			logger.error(_e);
			setChatMessageResults([]);
		} finally {
			if (seq === chatMsgSearchSeqRef.current) {
				setSearchingChatMessages(false);
			}
		}
	};

	// Start chat with user. Resolves true when the conversation was selected
	// (existing or newly created), false on failure.
	const startConversation = async (recipientId: string): Promise<boolean> => {
		setShowSearchDropdown(false);
		setSearchQuery("");

		try {
			const res = await apiFetch("/api/chats/conversations", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ recipientId }),
			});
			const data = await res.json();
			if (res.ok && data.success && data.conversation) {
				// Select this conversation immediately
				setSelectedConv(data.conversation);
				// Add to list
				setConversations((prev) => [data.conversation, ...prev]);
				return true;
			}
			// A blocked/not-allowed pair or server error — surface it so the
			// deep-link path (profile Message button) isn't silently dropped.
			logger.error("Failed to create conversation", data?.message);
			return false;
		} catch (err) {
			logger.error("Failed to create conversation", err);
			return false;
		}
	};

	// Deep link from a user's profile "Message" button — open (or create) the
	// conversation with that user the moment the chat tab mounts. The parent
	// (App) clears openWithUserId via onOpenWithUserIdHandled so the effect
	// doesn't re-fire on every render.
	useEffect(() => {
		if (!openWithUserId) return;
		startConversation(openWithUserId).then((opened) => {
			if (!opened) {
				window.dispatchEvent(
					new CustomEvent("showToast", {
						detail: {
							message:
								"Could not open a chat with this user right now.",
							type: "error",
						},
					}),
				);
			}
		});
		onOpenWithUserIdHandled?.();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [openWithUserId]);

	// ─── Voice Note Recording ────────────────────────────────────────────
	/** Detect the best supported audio MIME type for the current browser/platform.
	 *  Falls back to audio/webm if nothing else is supported.
	 *  - Chrome/Android: audio/webm;codecs=opus
	 *  - Safari/iOS:     audio/mp4 (AAC)
	 *  - Firefox:        audio/webm;codecs=opus or audio/ogg;codecs=opus
	 */
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
		// Fallback: let the browser decide
		return { mimeType: "", extension: "webm" };
	};

	const handleMicToggle = async () => {
		if (isRecording) {
			// Stop recording
			if (
				mediaRecorderRef.current &&
				mediaRecorderRef.current.state !== "inactive"
			) {
				mediaRecorderRef.current.stop();
			}
			if (recordingTimerRef.current) {
				clearInterval(recordingTimerRef.current);
				recordingTimerRef.current = null;
			}
			setIsRecording(false);
			// Notify partner that recording stopped
			const conv = selectedConvRef.current;
			if (conv) {
				socketRef.current?.emit("chat:recording", {
					conversationId: conv._id,
					isRecording: false,
				});
			}
		} else {
			// Start recording
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
				const recorderOptions: any = {
					audioBitsPerSecond: 128000,
				};
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
					const actualMimeType =
						mimeType || recorder.mimeType || "audio/webm";
					const blob = new Blob(audioChunksRef.current, {
						type: actualMimeType,
					});
					// Stop all tracks to release the microphone
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

				// Notify partner that we started recording a voice note
				const currentConv = selectedConvRef.current;
				if (currentConv) {
					socket?.emit("chat:recording", {
						conversationId: currentConv._id,
						isRecording: true,
					});
				}

				// Start duration timer
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
							message:
								"Microphone access denied. Please allow microphone permissions.",
							type: "error",
						},
					}),
				);
			}
		}
	};

	const handleMicClick = (_e: React.MouseEvent) => {
		handleMicToggle();
	};

	// ── Unified pending-send executor ───────────────────────────────────
	// Every send path (text/media, voice note, retry) funnels its network POST
	// through this ONE function via the FIFO queue above. It rebuilds the
	// multipart body from the saved payload and resolves the optimistic
	// placeholder to its confirmed server copy. Returns the outcome the queue
	// pump needs: "ok" | "failed" | "retry" (see pumpSendQueue).
	//
	// convId is captured at ENQUEUE time — the user may switch chats while
	// the message is queued, and the POST must still target the conversation
	// it was written in.
	const performPendingSend = useCallback(
		async (pendingId: string, convId: string): Promise<SendOutcome> => {
			const payload = unsentPayloadsRef.current[pendingId];
			if (!payload) return "ok"; // cancelled/cleaned while queued

			const controller = new AbortController();
			activeUploadsRef.current[pendingId] = controller;
			setUploadProgress((prev) => ({ ...prev, [pendingId]: 0 }));

			// Local helper: mark the placeholder failed + toast (server error,
			// non-network failure).
			const markFailed = (message?: string) => {
				setPendingMessageIds((prev) => {
					const next = new Set(prev);
					next.delete(pendingId);
					return next;
				});
				setMessages((prev) =>
					prev.map((m) =>
						m._id === pendingId
							? { ...m, _pending: false, _failed: true }
							: m,
					),
				);
				// Keep the message in the array (retry affordance) — but stop
				// tracking it as an active pending send.
				delete activeUploadsRef.current[pendingId];
				delete unsentConvIdsRef.current[pendingId];
				if (message) {
					window.dispatchEvent(
						new CustomEvent("showToast", {
							detail: { message, type: "error" },
						}),
					);
				}
			};

			// Local helper: replace the placeholder with the confirmed copy +
			// persist it to Dexie (replacing the optimistic row) + drop the
			// pending-send record.
			const resolveSent = (sentMessage: any) => {
				setPendingMessageIds((prev) => {
					const next = new Set(prev);
					next.delete(pendingId);
					return next;
				});
				setMessages((prev) =>
					replacePendingWithSent(prev, pendingId, sentMessage),
				);
				delete activeUploadsRef.current[pendingId];
				delete unsentPayloadsRef.current[pendingId];
				delete unsentConvIdsRef.current[pendingId];
				void cacheSingleMessage(sentMessage).catch(() => {});
				void db.messages.delete(pendingId).catch(() => {});					void deletePendingChatSend(pendingId).catch(() => {});
					// Own message confirmed — always scroll to it, even if the user
					// had scrolled up (they just sent it).
					scrollToBottom(true);
			};

			try {						const formData = new FormData();
					if (payload.type === "voice_note") {
					formData.append("text", "");
					if (payload.blob) {
						const blobMime = payload.blob.type || "audio/webm";
						const ext = blobMime.includes("mp4") || blobMime.includes("aac")
							? "mp4"
							: blobMime.includes("ogg")
								? "ogg"
								: blobMime.includes("wav")
									? "wav"
									: "webm";
							formData.append(
								"files",
								new File([payload.blob], `voice-${Date.now()}.${ext}`, {
									type: blobMime,
								}),
							);
							formData.append("duration", String(payload.duration || 0));
						}
					} else {
						formData.append("text", payload.text || "");
						for (const file of payload.files || []) {
							// Skip the re-encode when the file was already downscaled
							// at enqueue time (see sendSingleMessage) — otherwise a
							// big photo's encode would run inside the send queue and
							// hold up every message sent after it in this chat.
							formData.append(
								"files",
								file.type.startsWith("image/") &&
									!(payload as any).fileDownscaled
									? await downscaleImageFile(file)
									: file,
							);
						}
					}					if (payload.replyToId) {
						formData.append("replyTo", payload.replyToId);
					}
					if (payload.type === "message" && payload.scheduledAt) {
						formData.append("scheduledAt", payload.scheduledAt);
					}

					// Text-only sends go as JSON — multipart boundary + parsing is
				// pure waste for a plain string and adds real latency on mobile
				// networks. Media/voice notes keep the multipart upload path
				// (they need progress + the raw bytes).
				const isTextOnly =
					payload.type === "message" &&
					!(payload.files && payload.files.length > 0);
				let res: Response;
				if (isTextOnly) {
					const csrfMatch = document.cookie.match(
						/(?:^|;\s*)csrf-token=([^;]*)/,
					);
					const jsonHeaders: Record<string, string> = {
						"Content-Type": "application/json",
					};
					if (csrfMatch) jsonHeaders["x-csrf-token"] = csrfMatch[1]!;
					res = await fetch(
						`/api/chats/conversations/${convId}/messages`,
						{
							method: "POST",
							headers: jsonHeaders,
							credentials: "include",
							signal: controller.signal,
						body: JSON.stringify({
							text: payload.text || "",
							...(payload.replyToId
								? { replyTo: payload.replyToId }
								: {}),
							...(payload.type === "message" && payload.scheduledAt
								? { scheduledAt: payload.scheduledAt }
								: {}),
						}),
						},
					);
				} else {
					res = await uploadWithProgress(
						`/api/chats/conversations/${convId}/messages`,
						{
							method: "POST",
							body: formData,
							onProgress: (p) =>
								setUploadProgress((prev) => ({
									...prev,
									[pendingId]: p,
								})),
							signal: controller.signal,
						},
					);
				}
				const data = await res.json();
				if (res.ok && data.success && data.sentMessage) {
					resolveSent(data.sentMessage);
					return "ok";
				}
				// Server rejected the message (validation, 4xx/5xx) — permanent.
				markFailed(
					data?.message || "Failed to send message. Please try again.",
				);
				return "failed";
			} catch (err: any) {
				if (err?.name === "AbortError") {
					// User cancelled — placeholder already removed by the caller.
					logger.info("Queued send aborted by user", { pendingId });
					return "ok";
				}
				// Network-level failure. Offline (or the socket/fetch layer says
				// so): keep the placeholder in "sending" state and let the
				// reconnect listener retry it — WhatsApp's clock-icon behavior.
				// No toast spam for a connection blip.
				const offline =
					!navigator.onLine ||
					err?.name === "TypeError" ||
					err?.message?.includes("fetch") ||
					err?.message?.includes("network") ||
					err?.message?.includes("NetworkError");
				if (offline) {
					delete activeUploadsRef.current[pendingId];
					logger.warn("Queued send deferred (offline/transient)", {
						pendingId,
						err: err?.message,
					});
					return "retry";
				}
				markFailed("Failed to send message. Please try again.");
				logger.error("Queued send failed", err);
				return "failed";
			}
		},
		// scrollToBottom / setters are stable; refs are stable. No deps needed
		// — the payload comes from the ref at run time.
		[],
	);

	// ── Rehydrate unsent messages after a reload ────────────────────────
	// WhatsApp behavior: a message you sent stays in the thread even if the
	// app reloaded while it was queued (offline). On mount we reload persisted
	// pending sends, rebuild their optimistic rows (fresh blob object URLs —
	// the old ones died with the previous page), and re-enqueue them in
	// createdAt order so they send one at a time in the order they were made.
	const rehydratedRef = useRef(false);
	useEffect(() => {
		if (rehydratedRef.current) return;
		rehydratedRef.current = true;
		let cancelled = false;
		(async () => {
			try {
				const pending = await getPendingChatSends();
				if (cancelled || pending.length === 0) return;
				const currentUser = userRef.current;
				for (const entry of pending) {
					const { localId, conversationId, payload } = entry;
					if (unsentPayloadsRef.current[localId]) continue; // already live

					// Rebuild the optimistic row — prefer the persisted one.
					let optimistic: any = await db.messages.get(localId);
					if (!optimistic) {
						// Old session wrote the payload but not the row — build a
						// minimal placeholder so the bubble still renders.
						optimistic = {
							_id: localId,
							conversation: conversationId,
							sender: currentUser
								? {
										_id: currentUser._id,
										username: currentUser.username,
										fullName: currentUser.fullName,
										profilePic: currentUser.profilePic,
								  }
								: undefined,
							text: payload.text || "",
							attachments: [],
							seen: false,
							_pending: true,
							_pendingConv: conversationId,
							createdAt: new Date(entry.createdAt).toISOString(),
							updatedAt: new Date(entry.createdAt).toISOString(),
						};
					}
					// Refresh the blob URL so media/voice placeholders preview
					// again after the reload.
					if (
						payload.type === "voice_note" &&
						payload.blob &&
						Array.isArray(optimistic.attachments)
					) {
						optimistic.attachments = optimistic.attachments.map(
							(a: any) => ({
								...a,
								url: URL.createObjectURL(payload.blob as Blob),
							}),
						);
					} else if (
						payload.type === "message" &&
						payload.files?.[0] &&
						Array.isArray(optimistic.attachments)
					) {
						optimistic.attachments = optimistic.attachments.map(
							(a: any) => ({
								...a,
								url: URL.createObjectURL(payload.files![0]),
							}),
						);
					}
					await db.messages.put(optimistic);
					unsentPayloadsRef.current[localId] = payload as any;
					unsentConvIdsRef.current[localId] = conversationId;
					setPendingMessageIds((prev) => new Set(prev).add(localId));
					// Show it immediately if its conversation is already open.
					if (selectedConvRef.current?._id === conversationId) {
						setMessages((prev) =>
							prev.some((m) => m._id === localId)
								? prev
								: [...prev, optimistic],
						);
						scrollToBottom(true);
					}
					// Re-enqueue in persisted order — the FIFO pump sends them
					// one at a time, oldest first.
					enqueueSend(conversationId, localId, () =>
						performPendingSend(localId, conversationId),
					);
				}
				logger.info("Rehydrated pending chat sends", {
					count: pending.length,
				});
			} catch (err) {
				logger.error("Failed to rehydrate pending chat sends", err);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [enqueueSend, performPendingSend]);

	// ── Resume queued sends when connectivity returns ───────────────────
	// The FIFO queue parks the head message ("retry") when a send hits a
	// network failure. When the browser reports online (or the tab regains
	// focus while online), pump every conversation with queued sends — the
	// parked head runs first, preserving order.
	useEffect(() => {
		const onOnline = () => resumeQueuedSends();
		const onVisibility = () => {
			if (!document.hidden && navigator.onLine) resumeQueuedSends();
		};
		window.addEventListener("online", onOnline);
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			window.removeEventListener("online", onOnline);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [resumeQueuedSends]);

	const handleSendVoiceNote = async (overrideBlob?: Blob, overrideDuration?: number) => {
		const targetBlob = overrideBlob || recordedBlob;
		const targetUrl = overrideBlob ? URL.createObjectURL(overrideBlob) : recordedUrl;
		const targetDuration = overrideDuration !== undefined ? overrideDuration : recordingDuration;

		if (!selectedConv || !targetBlob || !targetUrl)
			return;

		// NOTE: no global sending guard here — each voice note gets its own
		// pending id, so voice notes queue alongside text/media messages.

		const partner = getPartner(selectedConv);
		const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const optimisticMessage: any = {
			_id: pendingId,
			conversation: selectedConv._id,
			sender: {
				_id: user._id,
				username: user.username,
				fullName: user.fullName,
				profilePic: user.profilePic,
			},
			recipient: partner._id,
			text: "",
			replyTo: replyToMessage
				? {
						_id: replyToMessage._id,
						sender: replyToMessage.sender,
						text: replyToMessage.text,
						attachments: replyToMessage.attachments,
						createdAt: replyToMessage.createdAt,
					}
				: null,
			attachments: [
				{
					url: targetUrl,
					type: "voice_note",
					duration: targetDuration,
				},
			],
			seen: false,
			_pending: true,
			_pendingConv: selectedConv._id,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		// Insert optimistic message immediately
		setPendingMessageIds((prev) => new Set(prev).add(pendingId));
		setMessages((prev) => [...prev, optimisticMessage]);					scrollToBottom(true);

					// Save payload for retrying + persist it (with the optimistic row) so
					// an offline reload keeps this voice note in the thread and replays it
		// in order. IndexedDB stores Blobs natively.
		const payload = {
			type: "voice_note" as const,
			blob: targetBlob,
			url: targetUrl,
			duration: targetDuration,
			replyToId: replyToMessage?._id,
		};
		unsentPayloadsRef.current[pendingId] = payload as any;
		unsentConvIdsRef.current[pendingId] = selectedConv._id;
		void db.messages.put(optimisticMessage).catch(() => {});
		void putPendingChatSend({
			localId: pendingId,
			conversationId: selectedConv._id,
			payload,
			createdAt: Date.now(),
		}).catch(() => {});

		// Clear recording UI immediately so user can send next message
		setRecordedBlob(null);
		setRecordedUrl(null);
		setRecordingDuration(0);
		setIsPlayingPreview(false);
		setReplyToMessage(null);

		// Queue the network POST — strict FIFO per conversation: voice notes
		// leave the device in the order they were recorded, one at a time.
		enqueueSend(selectedConv._id, pendingId, () =>
			performPendingSend(pendingId, selectedConv._id),
		);
	};

	// Send a single message (helper)
	const sendSingleMessage = async (
		text: string,
		file?: File,
		preview?: string,
		replyMsg: Message | null = null,
		scheduleAt?: string
	) => {
		if (!selectedConv) return;
		const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		let optimisticAttachments: any[] = [];
		if (file && preview) {
			let type: "voice_note" | "image" | "gif" | "video" | "file" = "file";
			if (file.type.startsWith("audio/")) {
				type = "voice_note";
			} else if (file.type.startsWith("video/")) {
				type = "video";
			} else if (file.type.startsWith("image/")) {
				if (file.type === "image/gif") {
					type = "gif";
				} else {
					type = "image";
				}
			}
			optimisticAttachments = [
				{
					url: preview,
					public_id: file.name,
					type,
					name: file.name,
					size: file.size,
					mimetype: file.type,
				},
			];
		}

		const optimisticMessage: any = {
			_id: pendingId,
			conversation: selectedConv._id,
			sender: {
				_id: user._id,
				username: user.username,
				fullName: user.fullName,
				profilePic: user.profilePic,
			},
			recipient: getPartner(selectedConv)._id,
			text: text,
			replyTo: replyMsg
				? {
						_id: replyMsg._id,
						sender: replyMsg.sender,
						text: replyMsg.text,
						attachments: replyMsg.attachments,
						createdAt: replyMsg.createdAt,
					}
				: null,
			attachments: optimisticAttachments,
			seen: false,
			_pending: true,
			_pendingConv: selectedConv._id,
			...(scheduleAt ? { scheduledAt: scheduleAt } : {}),
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		setPendingMessageIds((prev) => new Set(prev).add(pendingId));
		setMessages((prev) => [...prev, optimisticMessage]);					scrollToBottom(true);

					// Save payload for retrying + persist it (with the optimistic row) so
					// an offline reload keeps this message in the thread and replays it in
		// order. File/Blob objects are structured-cloneable → IndexedDB stores
		// them natively, so even photos/videos survive a reload.

		// Downscale photos BEFORE the payload enters the per-conversation send
		// queue. The queue worker used to encode inline, so one large image
		// held up every message sent after it in the same chat (text included)
		// until the encode finished. The flag lets the worker skip its own
		// (idempotent) re-encode — downscaleImageFile returns the file
		// unchanged for GIFs/small images, so this is safe for every case.
		let queuedFile = file;
		let fileDownscaled = false;
		if (file && file.type.startsWith("image/")) {
			try {
				queuedFile = await downscaleImageFile(file);
				fileDownscaled = true;
			} catch {
				/* keep the original — the worker's own encode stays the fallback */
			}
		}

		const payload = {
			type: "message" as const,
			text: text,
			files: queuedFile ? [queuedFile] : [],
			previews: preview ? [preview] : [],
			replyToId: replyMsg?._id,
			...(scheduleAt ? { scheduledAt: scheduleAt } : {}),
			fileDownscaled,
		};
		unsentPayloadsRef.current[pendingId] = payload as any;
		unsentConvIdsRef.current[pendingId] = selectedConv._id;
		void db.messages.put(optimisticMessage).catch(() => {});
		void putPendingChatSend({
			localId: pendingId,
			conversationId: selectedConv._id,
			payload,
			createdAt: Date.now(),
		}).catch(() => {});

		// Queue the network POST — strict FIFO per conversation: this message
		// doesn't leave the device until every earlier one in THIS chat has
		// finished, so the server always persists them in send order.
		enqueueSend(selectedConv._id, pendingId, () =>
			performPendingSend(pendingId, selectedConv._id),
		);
	};

	// Send message
	const handleSendMessage = async (e: React.FormEvent) => {
		e.preventDefault();
		if (isRecording) {
			shouldSendAfterRecordRef.current = true;
			handleMicToggle();
			return;
		}
		const errors = validateChatMessage({
			text: inputText,
			hasAttachments: attachments.length > 0,
		});
		if (Object.keys(errors).length > 0) {
			return;
		}
		setFieldErrors({});
		if (!selectedConv) return;

		if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
		setIsTyping(false);

		if (socket) {
			socket.emit("chat:typing", {
				conversationId: selectedConv._id,
				isTyping: false,
			});
		}

		// Save state variables. Read from the synchronous ref so a fast second
		// submit can't re-read the same text (see inputTextRef above), and clear
		// the ref + state immediately so the next queued message starts fresh.
		const savedInput = inputTextRef.current.trim();
		inputTextRef.current = "";
		const savedAttachments = [...attachments];
		const savedPreviews = [...attachmentPreviews];
		const savedReplyTo = replyToMessage;

		// Clear input immediately for all sends
		setInputText("");
		setAttachments([]);
		setAttachmentPreviews([]);
		setReplyToMessage(null);
		// Clear this chat's draft (the message was sent, not abandoned).
		if (selectedConv) {
			draftsRef.current.set(selectedConv._id, "");
			saveDrafts();
		}
		// Sending a message clears the "Unread messages" divider — you've
		// acknowledged everything above your reply (WhatsApp behavior).
		setUnreadDividerTs(null);

		try {
			const scheduleIso = scheduledFor
				? scheduledFor.toISOString()
				: undefined;
			if (savedAttachments.length > 0) {
				// Send first attachment with caption text (if any) and reply state
				await sendSingleMessage(savedInput.trim(), savedAttachments[0], savedPreviews[0], savedReplyTo, scheduleIso);
				
				// Send remaining attachments as separate caption-less messages
				for (let i = 1; i < savedAttachments.length; i++) {
					await new Promise((resolve) => setTimeout(resolve, 50));
					await sendSingleMessage("", savedAttachments[i], savedPreviews[i], undefined, scheduleIso);
				}
			} else {
				// Text-only message
				await sendSingleMessage(savedInput.trim(), undefined, undefined, savedReplyTo, scheduleIso);
			}
			// A scheduled send is one-shot: after it's queued, clear the picker.
			if (scheduleIso) {
				setScheduledFor(null);
				setSchedulePickerOpen(false);
			}
		} catch (err) {
			logger.error(err);
		}
		// NOTE: no global sending flag — each message tracks its own pending
		// state (pendingMessageIds + _pending), so failures don't block the
		// next queued message.
	};

	const handleRetrySend = async (pendingId: string) => {
		const payload = unsentPayloadsRef.current[pendingId];
		if (!payload) return;

		setMessages((prev) =>
			prev.map((m) =>
				m._id === pendingId ? { ...m, _pending: true, _failed: false } : m
			)
		);
		setPendingMessageIds((prev) => new Set(prev).add(pendingId));

		// The failed message's conversation — captured from the stored payload
		// or the placeholder row (the user may have switched chats since).
		const convId = unsentConvIdsRef.current[pendingId];
		if (!convId) {
			// Fall back to the current conversation if unknown.
			if (!selectedConv) return;
			enqueueSend(selectedConv._id, pendingId, () =>
				performPendingSend(pendingId, selectedConv._id),
			);
			return;
		}
		enqueueSend(convId, pendingId, () =>
			performPendingSend(pendingId, convId),
		);
	};

	// Edit message
	const handleEditMessageSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		const errors = validateChatMessage({
			text: editText,
			hasAttachments: false,
		});
		if (Object.keys(errors).length > 0) {
			setFieldErrors(errors);
			return;
		}
		setFieldErrors({});
		if (!editingMessage || !selectedConv) return;

		const msgId = editingMessage._id;
		const txt = editText;

		// Optimistic update for messages and conversations
		setMessages((prev) =>
			prev.map((m) =>
				m._id === msgId
					? { ...m, text: txt, isEdited: true }
					: m,
			),
		);
		setConversations((prev) =>
			prev.map((c) => {
				if (c.lastMessage?._id === msgId) {
					return {
						...c,
						lastMessage: {
							...c.lastMessage,
							text: txt,
							isEdited: true,
						},
					};
				}
				return c;
			}),
		);

		setEditingMessage(null);
		setEditText("");

		try {
			const res = await apiFetch(`/api/chats/messages/${msgId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text: txt }),
			});
			const data = await res.json();
			if (!res.ok || !data.success) {
				logger.error("Message edit failed");
			}
		} catch (_e) {
			logger.error(_e);
		}
	};	// Delete message for current user only
	const handleDeleteForMe = async (messageId: string) => {
		const currentUserId = user._id;
		// Optimistic: mark as deleted for current user
		setMessages((prev) =>
			prev.map((m) =>
				m._id === messageId
					? {
							...m,
							isDeleted: true,
							text: "This message was deleted",
							attachments: [],
							deletedFor: [
								...(m.deletedFor || []),
								currentUserId,
							],
						}
					: m,
			),
		);
		// Also optimistically update the conversations list's lastMessage
		setConversations((prev) =>
			prev.map((c) => {
				if (c.lastMessage?._id === messageId) {
					return {
						...c,
						lastMessage: {
							...c.lastMessage,
							isDeleted: true,
							text: "This message was deleted",
							attachments: [],
						},
					};
				}
				return c;
			}),
		);

		if (messageId.startsWith("pending-") || messageId.startsWith("temp-")) {
			return;
		}

		try {
			const res = await apiFetch(
				`/api/chats/messages/${messageId}/delete-for-me`,
				{
					method: "DELETE",
				},
			);
			const data = await res.json();
			if (!res.ok || !data.success) {
				logger.error("Delete for me failed");
				window.dispatchEvent(
					new CustomEvent("showToast", {
						detail: {
							message:
								"Failed to delete message. Please try again.",
							type: "error",
						},
					}),
				);
			}
		} catch (_e) {
			logger.error(_e);
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message: "Failed to delete message. Please try again.",
						type: "error",
					},
				}),
			);
		}
	};

	// Delete message (for everyone - within 5 min)
	const handleDeleteMessage = async (messageId: string) => {
		// 1. Optimistic UI update for messages AND conversations
		setMessages((prev) =>
			prev.map((m) =>
				m._id === messageId
					? {
							...m,
							isDeleted: true,
							text: "This message was deleted",
							attachments: [],
						}
					: m,
			),
		);
		// Also optimistically update the conversations list's lastMessage
		setConversations((prev) =>
			prev.map((c) => {
				if (c.lastMessage?._id === messageId) {
					return {
						...c,
						lastMessage: {
							...c.lastMessage,
							isDeleted: true,
							text: "This message was deleted",
							attachments: [],
						},
					};
				}
				return c;
			}),
		);

		if (messageId.startsWith("pending-") || messageId.startsWith("temp-")) {
			return;
		}

		try {
			const res = await apiFetch(`/api/chats/messages/${messageId}`, {
				method: "DELETE",
			});
			const data = await res.json();
			if (!res.ok || !data.success) {
				logger.error("Message deletion failed");
				window.dispatchEvent(
					new CustomEvent("showToast", {
						detail: {
							message:
								"Failed to delete message. Please try again.",
							type: "error",
						},
					}),
				);
			}
		} catch (_e) {
			logger.error(_e);
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message: "Failed to delete message. Please try again.",
						type: "error",
					},
				}),
			);
		}
	};

	// Open the conversation context menu (long-press on mobile, right-click on
	// desktop). Initial position uses the VISIBLE viewport (visualViewport,
	// so mobile toolbars/keyboard don't push it below the fold); the
	// useMenuViewportClamp hook re-measures and corrects it after render.
	const openConvMenu = (
		e: { clientX: number; clientY: number },
		conv: Conversation,
	) => {
		convMenuOpenedAtRef.current = Date.now();
		const MENU_W = 200;
		const MENU_H = 132;
		const vp = getVisibleViewport();
		const x = Math.max(
			vp.left + 8,
			Math.min(e.clientX, vp.left + vp.width - MENU_W - 8),
		);
		const y = Math.max(
			vp.top + 8,
			Math.min(e.clientY, vp.top + vp.height - MENU_H - 8),
		);
		setConvMenu({ conv, x, y });
	};

	// Toggle mute for a conversation — optimistic flip, reconciled with server.
	const handleToggleConvMute = async (conv: Conversation) => {
		const next = !conv.muted;
		// Update BOTH the list and the currently-open conversation so the
		// header three-dot menu shows the correct Mute/Unmute state right away.
		const apply = (muted: boolean) => {
			setConversations((prev) =>
				prev.map((c) => (c._id === conv._id ? { ...c, muted } : c)),
			);
			setSelectedConv((cur) =>
				cur && cur._id === conv._id ? { ...cur, muted } : cur,
			);
		};
		apply(next);
		setConvMenu(null);
		const revert = () => apply(!next);
		try {
			const res = await apiFetch(
				`/api/chats/conversations/${conv._id}/${next ? "mute" : "unmute"}`,
				{ method: "POST" },
			);
			const data = await res.json();
			if (!(res.ok && data.success)) {
				revert();
				window.dispatchEvent(
					new CustomEvent("showToast", {
						detail: {
							message: data?.message || "Couldn't update mute setting.",
							type: "error",
						},
					}),
				);
			}
		} catch (err: any) {
			logger.error("Failed to toggle conversation mute", err);
			revert();
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message: "Couldn't update mute setting. Try again.",
						type: "error",
					},
				}),
			);
		}
	};

	// Actually delete conversation after user confirms
	const executeDeleteConversation = async () => {
		if (!deleteConvConfirmId) return;
		const conversationId = deleteConvConfirmId;
		setDeleteConvConfirmId(null);

		try {
			const res = await apiFetch(
				`/api/chats/conversations/${conversationId}`,
				{
					method: "DELETE",
				},
			);
			const data = await res.json();
			if (res.ok && data.success) {
				setConversations((prev) =>
					prev.filter((c) => c._id !== conversationId),
				);
				if (selectedConv?._id === conversationId) {
					setSelectedConv(null);
				}
			} else {
				logger.error("Failed to delete conversation", data.message);
			}
		} catch (err) {
			logger.error("Failed to delete conversation", err);
		}
	};

	// Clear chat history trigger
	const handleClearChat = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (!selectedConv) return;
		setShowClearConfirm(true);
	};

	// Block / Unblock the conversation partner (only 1:1 user chat)
	const handleToggleBlock = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (!selectedConv) return;
		const partnerForBlock = selectedConv.participants?.find(
			(p: any) => p && p._id !== user._id,
		);
		if (!partnerForBlock?._id) return;

		const willBlock = !iBlockedPartner;
		const partnerName =
			partnerForBlock.fullName ||
			partnerForBlock.username ||
			"This user";
		setBlockToggling(true);
		setShowChatMenu(false);
		try {
			const res = await apiFetch(`/api/blocks/${partnerForBlock._id}`, {
				method: willBlock ? "POST" : "DELETE",
			});
			const data = await res.json();
			if (res.ok && data.success) {
				setIBlockedPartner(willBlock);
				// A block deletes the 1:1 conversation server-side.
				if (willBlock) {
					setBlockedPartner(true);
					setMessages([]);
					// Drop the conversations list from cache so the deleted
					// conversation can't resurrect (socket event handles live UI).
					evictCachedResponse("/api/chats/conversations");
					window.dispatchEvent(
						new CustomEvent("showToast", {
							detail: {
								message: `${partnerName} has been blocked.`,
								type: "success",
							},
						}),
					);
				} else {
					setBlockedPartner(false);
					window.dispatchEvent(
						new CustomEvent("showToast", {
							detail: {
								message: `${partnerName} has been unblocked.`,
								type: "success",
							},
						}),
					);
				}
			}
		} catch (err) {
			logger.error("Failed to toggle block", err);
		} finally {
			setBlockToggling(false);
		}
	};

	// Clear chat history confirmation
	const handleConfirmClear = async () => {
		setShowClearConfirm(false);
		if (!selectedConv) return;
		try {
			const res = await apiFetch(
				`/api/chats/conversations/${selectedConv._id}/messages`,
				{
					method: "DELETE",
				},
			);
			const data = await res.json();
			if (res.ok && data.success) {
				setMessages([]);
				// Update local conversations list to reset lastMessage
				setConversations((prev) =>
					prev.map((c) =>
						c._id === selectedConv._id
							? { ...c, lastMessage: undefined }
							: c,
					),
				);
			} else {
				logger.error("Failed to clear chat", data.message);
			}
		} catch (err) {
			logger.error("Failed to clear chat", err);
		}
	};

	// Handle reaction
	const handleReaction = async (message: Message, emoji: string) => {
		// Don't allow reactions on deleted messages
		if (message.isDeleted) return;

		const userId = user._id;
		const existingIndex = (message.reactions || []).findIndex((r) => {
			const sId = typeof r.sender === "string" ? r.sender : r.sender?._id;
			return sId === userId && r.emoji === emoji;
		});

		let nextReactions = [...(message.reactions || [])];
		if (existingIndex >= 0) {
			// Toggle off
			nextReactions.splice(existingIndex, 1);
		} else {
			// Toggle off any other reaction by this sender first
			nextReactions = nextReactions.filter((r) => {
				const sId =
					typeof r.sender === "string" ? r.sender : r.sender?._id;
				return sId !== userId;
			});
			// Add new reaction
			nextReactions.push({
				_id: Date.now().toString(), // temp ID
				emoji,
				sender: {
					_id: user._id,
					username: user.username,
					fullName: user.fullName,
					profilePic: user.profilePic,
				},
				createdAt: new Date(),
			} as any);
		}

		setMessages((prev) =>
			prev.map((m) =>
				m._id === message._id ? { ...m, reactions: nextReactions } : m,
			),
		);

		try {
			const res = await apiFetch(
				`/api/chats/messages/${message._id}/reactions`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ emoji }),
				},
			);
			const data = await res.json();
			if (res.ok && data.success && data.reactions) {
				// 2. Synchronize with exact backend response
				setMessages((prev) =>
					prev.map((m) =>
						m._id === message._id
							? { ...m, reactions: data.reactions }
							: m,
					),
				);
			} else {
				logger.error("Reaction failed");
				// Revert to original
				setMessages((prev) =>
					prev.map((m) => (m._id === message._id ? message : m)),
				);
			}
		} catch (err) {
			logger.error(err);
			// Revert to original
			setMessages((prev) =>
				prev.map((m) => (m._id === message._id ? message : m)),
			);
		}
	};

	// ─── WebRTC Call Initiation ──────────────────────────────────────
	const handleStartCall = (type: "audio" | "video") => {
		const partner = selectedConv ? getPartner(selectedConv) : null;
		if (!partner) return;
		if (onStartCall) {
			onStartCall(partner._id, partner.fullName, type);
		}
	};

	// Handle reply
	const handleReplyMessage = (message: Message) => {
		setReplyToMessage(message);
		setContextMenu(null);
	};

	// Focus the composer AFTER React commits the reply/edit banner — the sync
	// focus fired inside the click handlers runs before the banner is in the
	// DOM, and the banner insert + context-menu removal shift the layout,
	// dropping the focus. Post-commit, the input is ready to type immediately.
	useEffect(() => {
		// Focus the ACTIVE box: the edit form replaces the main composer when
		// editing, so focus that (and size it to the message being edited).
		// Otherwise (reply bar, or a fresh reply set while not editing) focus
		// the main composer so the user can just start typing.
		if (editingMessage) {
			const el = editComposerRef.current;
			if (el) {
				el.style.height = "auto";
				el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
				el.focus();
			}
		} else if (replyToMessage) {
			composerRef.current?.focus();
		}
	}, [replyToMessage, editingMessage]);

	// Handle copy message
	const handleCopyMessage = async (message: Message) => {
		if (message.text) {
			await navigator.clipboard.writeText(message.text);
		}
		setContextMenu(null);
	};

	// ─── Pin / Unpin handlers ───────────────────────────────────────
	// Drop any optimistic markers before storing an authoritative server list.
	const stripOptimistic = (list: Message[]) =>
		list.map((m) => {
			if ((m as any)._optimistic) {
				const { _optimistic, ...rest } = m as any;
				return rest as Message;
			}
			return m;
		});

	// Apply a server-returned pinned list only if the user is still on the
	// conversation it belongs to (avoids cross-conversation clobbering).
	const applyPinnedFromServer = (
		conversationId: string | undefined,
		list: Message[] | undefined,
	) => {
		if (
			list &&
			conversationId &&
			selectedConvRef.current?._id === conversationId
		) {
			setPinnedMessages(stripOptimistic(list));
		}
	};

	// Roll back any optimistic pin entries (network failure / server rejection).
	const rollbackOptimisticPins = () =>
		setPinnedMessages((prev) =>
			prev.filter((m) => !(m as any)._optimistic),
		);

	const handlePinMessage = async (messageId: string) => {
		// Evict the pinned-messages cache so the next open doesn't paint the
		// pre-pin banner (the read is cache-first now).
		const pinConvId = selectedConvRef.current?._id;
		if (pinConvId) {
			void evictCachedResponse(
				`/api/chats/conversations/${pinConvId}/pinned-messages`,
			).catch(() => {});
		}
		// Optimistic pin — the banner updates instantly so the action feels
		// immediate; the server response + socket event reconcile afterwards.
		setPinnedMessages((prev) => {
			if (prev.some((m) => m._id === messageId)) return prev;
			const msg = messages.find((m) => m._id === messageId);
			if (!msg) return prev;
			// Mirror the server: max 5 pins, oldest dropped at the limit.
			const next = [
				{ ...msg, _optimistic: true } as Message,
				...prev.filter((m) => !(m as any)._optimistic),
			];
			return next.slice(0, 5);
		});
		try {
			const res = await apiFetch(`/api/chats/messages/${messageId}/pin`, {
				method: "POST",
			});
			const data = await res.json();
			if (res.ok && data?.success) {
				applyPinnedFromServer(data.conversationId, data.pinnedMessages);
			} else {
				// Server rejected the pin (e.g. 500) — don't leave a phantom pin.
				rollbackOptimisticPins();
				window.dispatchEvent(
					new CustomEvent("showToast", {
						detail: {
							message: data?.message || "Could not pin this message.",
							type: "error",
						},
					}),
				);
			}
		} catch (err) {
			logger.error("Failed to pin message", err);
			rollbackOptimisticPins();
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message: "Could not pin this message.",
						type: "error",
					},
				}),
			);
		}
		setContextMenu(null);
	};

	const handleUnpinMessage = async (messageId: string) => {
		// Evict the pinned-messages cache so the next open doesn't paint the
		// pre-unpin banner (the read is cache-first now).
		const unpinConvId = selectedConvRef.current?._id;
		if (unpinConvId) {
			void evictCachedResponse(
				`/api/chats/conversations/${unpinConvId}/pinned-messages`,
			).catch(() => {});
		}
		// Optimistic unpin — remove instantly, reconcile with the server list.
		setPinnedMessages((prev) => prev.filter((m) => m._id !== messageId));
		try {
			const res = await apiFetch(`/api/chats/messages/${messageId}/unpin`, {
				method: "POST",
			});
			const data = await res.json();
			if (res.ok && data?.success) {
				applyPinnedFromServer(data?.conversationId, data?.pinnedMessages);
			} else {
				// Server rejected the unpin — refetch the authoritative list so the
				// message does not silently reappear as a "phantom" pin.
				window.dispatchEvent(
					new CustomEvent("showToast", {
						detail: {
							message: data?.message || "Could not unpin this message.",
							type: "error",
						},
					}),
				);
				const currentConv = selectedConvRef.current;
				if (currentConv) {
					apiFetch(
						`/api/chats/conversations/${currentConv._id}/pinned-messages`,
						{ bypassCache: true },
					)
						.then((r) => r.json())
						.then((d) => {
							if (d?.success) setPinnedMessages(d.pinnedMessages || []);
						})
						.catch(() => {});
				}
			}
		} catch (err) {
			logger.error("Failed to unpin message", err);
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message: "Could not unpin this message.",
						type: "error",
					},
				}),
			);
		}
		setContextMenu(null);
	};

	// Unpin directly from the "View all pinned" panel.
	const handleUnpinFromPanel = async (messageId: string) => {
		await handleUnpinMessage(messageId);
		setShowPinnedPanel(false);
	};

	// Check if a message is currently pinned
	const isMessagePinned = (messageId: string) =>
		pinnedMessages.some((m) => m._id === messageId);

	// Handle forward selection toggles
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
							type: "warning",
						},
					}),
				);
				return prev;
			}
			return [...prev, targetConversationId];
		});
	};

	// Handle execute forward to all selected conversations
	const handleExecuteForward = async () => {
		if (!forwardModal || selectedForwardConvIds.length === 0) return;
		try {
			const originalMessage = forwardModal.message;
			const senderName =
				typeof originalMessage.sender === "string"
					? "Unknown"
					: originalMessage.sender?.username || "Unknown";
			const originalText = originalMessage.text || "";
			const attachmentsJson =
				forwardModal.message.attachments &&
				forwardModal.message.attachments.length > 0
					? JSON.stringify(forwardModal.message.attachments)
					: undefined;

			// Send to all selected conversations
			await Promise.all(
				selectedForwardConvIds.map(async (targetConvId) => {
					const formData = new FormData();
					const forwardedText = originalText
					? `Forwarded from @${senderName}: ${originalText}`
					: `Forwarded from @${senderName}`;
					formData.append("text", forwardedText);
					formData.append("forwardedFrom", originalMessage._id);
					if (attachmentsJson) {
						formData.append("attachments", attachmentsJson);
					}
					return apiFetch(
						`/api/chats/conversations/${targetConvId}/messages`,
						{
							method: "POST",
							body: formData,
						},
					);
				}),
			);

			setForwardModal(null);
			setSelectedForwardConvIds([]);
		} catch (err) {
			logger.error(err);
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message: "Failed to forward message. Please try again.",
						type: "error",
					},
				}),
			);
		}
	};

	// Context menu handlers
	const isEditable = (createdAtStr: string) => {
		const diffMs = Date.now() - new Date(createdAtStr).getTime();
		return diffMs <= 5 * 60 * 1000; // 5 minutes
	};

	const handleContextMenu = (
		e:
			| React.MouseEvent
			| { clientX: number; clientY: number; preventDefault: () => void },
		message: Message,
	) => {
		e.preventDefault();
		// Calculate safe position for mobile to prevent menu from being cut off
		const x = e.clientX;
		const y = e.clientY;
		const safeX = Math.min(Math.max(10, x), window.innerWidth - 10);
		const safeY = Math.min(Math.max(10, y), window.innerHeight - 10);
		// Record timestamp so the click-to-close handler can ignore synthetic
		// click events that mobile browsers fire immediately after touchend
		contextMenuOpenedAtRef.current = Date.now();
		setContextMenu({ message, x: safeX, y: safeY });
	};

	// Attachments handlers
	// Message search within conversation
	const handleMessageSearch = useCallback(async (query: string) => {
		const seq = messageSearchSeqRef.current;
		if (!query.trim() || !selectedConv) {
			setMessageSearchResults([]);
			return;
		}
		setSearchingMessages(true);
		try {
			const res = await apiFetch(`/api/chats/conversations/${selectedConv._id}/search?q=${encodeURIComponent(query)}`);
			const data = await res.json();
			// Drop responses from superseded keystrokes — only the latest query wins.
			if (seq !== messageSearchSeqRef.current) return;
			if (res.ok && data.success) {
				setMessageSearchResults(data.messages || []);
			} else {
				setMessageSearchResults([]);
			}
		} catch (_e) {
			if (seq !== messageSearchSeqRef.current) return;
			logger.error(_e);
			setMessageSearchResults([]);
		} finally {
			if (seq === messageSearchSeqRef.current) {
				setSearchingMessages(false);
			}
		}
	}, [selectedConv]);

	// Drag-and-drop file handlers
	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragActive(true);
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragActive(false);
	}, []);

	const handleDrop = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragActive(false);
		const droppedFiles = Array.from(e.dataTransfer.files) as File[];
		if (droppedFiles.length === 0) return;
		// Create a synthetic change event for handleFileChange
		const input = document.createElement("input");
		input.type = "file";
		const dt = new DataTransfer();
		droppedFiles.forEach((f) => dt.items.add(f));
		input.files = dt.files;
		const changeEvent = new Event("change", { bubbles: true });
		Object.defineProperty(changeEvent, "target", { value: input });
		handleFileChangeRef.current?.(changeEvent as unknown as React.ChangeEvent<HTMLInputElement>);
	}, []);

	// Attachments handlers
	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(e.target.files || []) as File[];
		if (files.length === 0) return;

		const validFiles = files.slice(0, 5 - attachments.length);

		// Find first image (non-GIF) to crop — rest go directly to attachments
		const cropIdx = validFiles.findIndex((f) => f.type.startsWith("image/") && f.type !== "image/gif");
		if (cropIdx >= 0) {
			const cropFile = validFiles[cropIdx];
			const remaining = validFiles.filter((_, i) => i !== cropIdx);
			const remainingPreviews = remaining.map((f) => URL.createObjectURL(f));

			// Store the crop file in the ref so we can re-add it if user cancels
			const cropUrl = URL.createObjectURL(cropFile);
			cropPendingQueueRef.current = {
				files: remaining,
				previews: remainingPreviews,
				cancelledFile: { file: cropFile, url: cropUrl },
			};

			// Open crop modal
			setCropSrc(cropUrl);
			setCropQueueFiles(remaining);
			setCropModalOpen(true);

			// Add non-image/GIF files immediately
			if (remaining.length > 0) {
				setAttachments((prev) => [...prev, ...remaining]);
				setAttachmentPreviews((prev) => [...prev, ...remainingPreviews]);
			}
		} else {
			// No image to crop — add all files directly
			setAttachments((prev) => [...prev, ...validFiles]);
			const newPreviews = validFiles.map((file) => URL.createObjectURL(file));
			setAttachmentPreviews((prev) => [...prev, ...newPreviews]);
		}
	};

	const handleCropComplete = useCallback((croppedBlob: Blob) => {
		const croppedFile = new File([croppedBlob], `cropped_${Date.now()}.jpg`, { type: "image/jpeg" });
		const previewUrl = URL.createObjectURL(croppedBlob);

		setAttachments((prev) => [croppedFile, ...cropQueueFiles, ...prev]);
		setAttachmentPreviews((prev) => [previewUrl, ...cropPendingQueueRef.current.previews, ...prev]);

		// Clean up
		cropPendingQueueRef.current = { files: [], previews: [] };
		setCropQueueFiles([]);
		// Revoke the crop URL that was stored in cancelledFile
		if (cropSrc) URL.revokeObjectURL(cropSrc);
	}, [cropQueueFiles, cropSrc]);

	const removeAttachment = (idx: number) => {
		setAttachments((prev) => prev.filter((_, i) => i !== idx));
		setAttachmentPreviews((prev) => prev.filter((_, i) => i !== idx));
	};

	const getPartner = (conv: Conversation) => {
		return conv.participants.find((p) => p && p._id !== user._id) || user;
	};

	// WhatsApp-style "Message yourself" chat — both participants are me. The
	// server flags these with isSelfChat so the header/lists render "Message
	// yourself" instead of your own name as if you were chatting with a
	// stranger.
	const isSelfChatConv = (conv?: Conversation | null) => {
		if (!conv) return false;
		if ((conv as any).isSelfChat) return true;
		return (
			(conv.participants?.length || 0) > 1 &&
			conv.participants.every((p) => p && p._id === user._id)
		);
	};

	const getPartnerPresence = (conv: Conversation) => {
		return conv.presence || "offline";
	};

	const formatMessageTime = (isoString: string) => {
		const date = new Date(isoString);
		return date.toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
		});
	};

	const formatDateSeparator = (isoString: string): string => {
		const date = new Date(isoString);
		const now = new Date();

		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);

		const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());

		if (target.getTime() === today.getTime()) {
			return "Today";
		} else if (target.getTime() === yesterday.getTime()) {
			return "Yesterday";
		} else {
			return date.toLocaleDateString("en-US", { day: "numeric", month: "long" });
		}
	};

	// Group reactions by emoji and count them (max 10 unique emojis)
	const getGroupedReactions = (reactions?: MessageReaction[]) => {
		if (!reactions || reactions.length === 0) return {};
		const entries = Object.entries(
			reactions.reduce(
				(acc, r) => {
					if (!acc[r.emoji])
						acc[r.emoji] = { count: 0, hasReacted: false };
					acc[r.emoji].count++;
					const sId =
						typeof r.sender === "string" ? r.sender : r.sender?._id;
					if (sId === user._id) acc[r.emoji].hasReacted = true;
					return acc;
				},
				{} as Record<string, { count: number; hasReacted: boolean }>,
			),
		);
		// Sort by most reacted first, limit to 10
		return Object.fromEntries(entries.slice(0, 10));
	};

	const isKeyboardOpen = useKeyboardOpen();

	// Instant local chat-name matches for the list search — filters the
	// ALREADY-LOADED conversations by partner name. Renders in <10ms with zero
	// network, so "find the chat with Alice" feels instant while the slower
	// server searches (users + message content) run in the background.
	const localConvMatches = (() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return [];
		return conversations.filter((c) => {
			const p = getPartner(c);
			return (
				(p.fullName || "").toLowerCase().includes(q) ||
				(p.username || "").toLowerCase().includes(q)
			);
		});
	})();

	return (
		<div className="w-full h-full px-0 pt-0 pb-0 relative select-none chat-container">
			<GlassCard
				animate={true}
				className="w-full h-full !pt-0 !pb-0 !px-0 flex !rounded-none sm:!rounded-4xl sm:border sm:border-white/5 bg-zinc-950/20 backdrop-blur-xl">					<AnimatePresence mode="wait" initial={false}>
						{!selectedConv ? (
							<motion.div
								key="conversations-list"
							initial={{ opacity: 0, x: -20 }}
							animate={{ opacity: 1, x: 0 }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0 }}
							className="w-full h-full flex flex-col">
							<div className="p-3 pb-0 flex items-center gap-3 shrink-0 sm:p-4">
								<h3 className="text-display-xs text-gradient-aurora">
									Messages
								</h3>
							</div>

							<div className="p-3 border-b border-zinc-800/30 relative z-20 shrink-0 sm:p-4">
								<div className="relative">
									<span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-zinc-500">
										<Search className="h-4 w-4" />
									</span>
									<input
										type="text"												placeholder="Search usernames..."
												value={searchQuery}
												onChange={(e) => {
													const val = e.target.value;
													setSearchQuery(val);
													// Invalidate any in-flight response from the previous query.
													userSearchSeqRef.current++;
													chatMsgSearchSeqRef.current++;
													if (userSearchTimerRef.current) clearTimeout(userSearchTimerRef.current);
													if (chatMsgSearchTimerRef.current) clearTimeout(chatMsgSearchTimerRef.current);
													if (!val.trim()) {
														setSearchResults([]);
														setChatMessageResults([]);
														setSearching(false);
														setSearchingChatMessages(false);
														setShowSearchDropdown(false);
														return;
													}
													// Debounce so fast typing issues ONE request instead of one per
													// keystroke (the server search limiter is 40 req/min).
													setSearching(true);
													setShowSearchDropdown(true);
													userSearchTimerRef.current = setTimeout(() => {
														handleUserSearch(val);
													}, 300);
													// Same debounce for the across-chats message search — but a
													// single character is useless for message CONTENT (it matches
													// everything) and costs a slow DB regex round-trip, so only
													// fire once the query is 2+ chars. Name matches (local chats
													// + user search) still work for 1 char.
													if (val.trim().length >= 2) {
														chatMsgSearchTimerRef.current = setTimeout(() => {
															handleChatMessageSearch(val);
														}, 300);
													} else {
														setChatMessageResults([]);
														setSearchingChatMessages(false);
													}
												}}
										className="w-full rounded-full border border-zinc-800 bg-zinc-950/50 py-2 pl-10 pr-4 text-[12px] md:text-sm font-bold text-white placeholder-zinc-550 focus:outline-none focus:border-white focus:bg-zinc-900 transition-all"
									/>
								</div>

								<AnimatePresence>
									{showSearchDropdown && (
										<motion.div
											initial={{ opacity: 0, y: 10 }}
											animate={{ opacity: 1, y: 0 }}
											exit={{ opacity: 0, y: 10 }}
											className="absolute left-4 right-4 mt-2 rounded-2xl border border-zinc-800 bg-zinc-900/95 backdrop-blur-2xl p-2 shadow-2xl max-h-80 overflow-y-auto z-50">													<div className="flex items-center justify-between px-2 pb-1.5 border-b border-zinc-800">
														<span className="text-[9px] font-black uppercase tracking-wider text-zinc-550">
															Find Users
														</span>
														<button
															onClick={() =>
																setShowSearchDropdown(
																	false,
																)
															}>																<X className="h-3 w-3 text-zinc-500 hover:text-white" />
															</button>
															</div>

															{/* Message yourself — WhatsApp's Saved Messages equivalent: a
															    1:1 chat with yourself for notes/links. The server allows a
															    self-recipient conversation, so startConversation(user._id)
															    just works. Always pinned at the top, like WhatsApp. */}
															<div
																onClick={() => {
																	setShowSearchDropdown(false);
																	setSearchQuery("");
																	void startConversation(user._id);
																}}
																className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-zinc-800/60 cursor-pointer transition-colors mt-1.5">
																<UserAvatar
																	src={user.profilePic?.url}
																	alt={user.fullName}
																	className="h-7 w-7 rounded-full object-cover border border-zinc-800"
																/>
																<div className="text-left">
																	<p className="text-xs font-bold text-zinc-200 leading-tight">
																		Message yourself
																	</p>
																	<p className="text-[9px] text-zinc-500 font-bold">
																		Private notes & links
																	</p>
																</div>
															</div>

													{/* Existing chats matching the query — filtered from the
													    already-loaded list, so this section appears INSTANTLY
													    (no network) while the server searches run. */}
													{localConvMatches.length > 0 && (
														<>
															<div className="flex items-center justify-between px-2 pb-1.5 border-b border-zinc-800 mt-1.5">
																<span className="text-[9px] font-black uppercase tracking-wider text-zinc-550">
																	Chats
																</span>
															</div>
															<div className="space-y-0.5 mt-1.5">
																{localConvMatches.map((c) => (
																	<div
																		key={c._id}
																		onClick={() => {
																			setShowSearchDropdown(false);
																			setSearchQuery("");
																			setSelectedConv(c);
																		}}
																		className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-zinc-800/60 cursor-pointer transition-colors">
																		<UserAvatar
																			src={
																				getPartner(c).profilePic
																					?.url
																			}
																			alt={
																				getPartner(c).fullName
																			}
																			className="h-7 w-7 rounded-full object-cover border border-zinc-800"
																		/>
																		<div className="text-left min-w-0">
																			<p className="text-xs font-bold text-zinc-200 leading-tight truncate">
																				{getPartner(c).fullName}
																			</p>
																			<p className="text-[9px] text-zinc-500 font-bold">
																				@
																				{getPartner(c).username}
																			</p>
																		</div>
																	</div>
																))}
															</div>
														</>
													)}

																																					{searching ? (
														<div className="flex items-center justify-center py-6">
															<Loader2 className="h-4 w-4 animate-spin text-zinc-550" />
														</div>
													) : searchResults.length > 0 ? (
														<div className="space-y-0.5 mt-1.5">
															{searchResults.map(
																(usr) => (
																	<div
																		key={usr._id}
																		onClick={() =>
																			startConversation(
																				usr._id,
																			)
																		}
																		className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-zinc-800/60 cursor-pointer transition-colors">
																		<UserAvatar
																			src={
																				usr
																					.profilePic
																					?.url
																			}
																			alt={
																				usr.fullName
																			}
																			className="h-7 w-7 rounded-full object-cover border border-zinc-800"
																		/>
																		<div className="text-left">
																			<p className="text-xs font-bold text-zinc-200 leading-tight">
																				{
																					usr.fullName
																				}
																			</p>
																			<p className="text-[9px] text-zinc-500 font-bold">
																				@
																				{
																					usr.username
																				}
																			</p>
																		</div>
																	</div>
																),
															)}
														</div>
													) : null}

													{/* Messages found inside existing chats — WhatsApp-style "search
													    chats". Clicking a row opens the conversation it lives in. */}
													{(searchingChatMessages ||
														chatMessageResults.length > 0) && (
														<>
															<div className="flex items-center justify-between px-2 pb-1.5 pt-2.5 border-b border-zinc-800 mt-1.5">
																<span className="text-[9px] font-black uppercase tracking-wider text-zinc-550">
																	Messages
																</span>
															</div>
															{searchingChatMessages ? (
																<div className="flex items-center justify-center py-4">
																	<Loader2 className="h-4 w-4 animate-spin text-zinc-550" />
																</div>
															) : chatMessageResults.length === 0 ? (
																<p className="text-[11px] text-zinc-550 text-center py-4 font-mono uppercase">
																	No messages found
																</p>
															) : (
																<div className="space-y-0.5 mt-1.5">
																	{chatMessageResults.map(
																		(res) => (
																			<div
																				key={res.messageId}
																				onClick={() => {
																					setShowSearchDropdown(false);
																					setSearchQuery("");
																					// Open the conversation instantly if it's already
																					// loaded; otherwise create/fetch it by partner.
																					const existing = conversations.find(
																						(c) =>
																							c._id ===
																								res.conversationId,
																					);
																					if (existing) {
																						setSelectedConv(existing);
																					} else if (res.partnerId) {
																						void startConversation(
																							res.partnerId,
																						);
																					}
																				}}
																				className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-zinc-800/60 cursor-pointer transition-colors">
																				<UserAvatar
																					src={
																						res.partner
																							?.profilePic
																							?.url
																					}
																					alt={
																						res.partner
																							?.fullName || ""
																					}
																					className="h-7 w-7 rounded-full object-cover border border-zinc-800"
																				/>
																				<div className="text-left min-w-0 flex-1">
																					<p className="text-[11px] font-bold text-zinc-200 leading-tight truncate">
																						{res.partner?.fullName || "Chat"}
																					</p>
																					<p className="text-[9.5px] text-zinc-500 leading-tight truncate">
																						{res.hasAttachments && !res.text
																							? "📎 Media"
																							: res.text}
																					</p>
																				</div>
																				<span className="text-[8.5px] font-mono text-zinc-600 shrink-0">
																					{formatMessageTime(
																						res.createdAt,
																					)}
																				</span>
																			</div>
																			),
																	)}
																</div>
															)}
														</>
													)}

													{!searching &&
														!searchingChatMessages &&
														localConvMatches.length === 0 &&
														searchResults.length === 0 &&
														chatMessageResults.length === 0 && (
															<p className="text-[11px] text-zinc-550 text-center py-6 font-mono uppercase">
																No results found
															</p>
														)}
													</motion.div>
									)}
								</AnimatePresence>
							</div>

							<div className="flex-1 overflow-y-auto space-y-1 p-2 pb-24 md:pb-2.5 scrollbar-thin md:p-2.5">
								{showConvSkeleton ? (
									<div className="space-y-3 p-2">
										<Skeleton variant="profile-row" />
										<Skeleton variant="profile-row" />
										<Skeleton variant="profile-row" />
									</div>
								) : conversations.length === 0 ? (
									<div className="text-center py-20 px-4">
										<MessageSquare className="mx-auto h-8 w-8 text-zinc-600 mb-2" />
										<h4 className="text-label-sm font-semibold text-zinc-300 leading-relaxed">
											No conversations yet
										</h4>
										<p className="text-[11px] text-zinc-550 mt-1 font-mono uppercase">
											Search for a user to start chatting
										</p>
									</div>								) : (
									<>
										{/* Archived section — WhatsApp-style, pinned to the TOP of
										    the chat list. Loaded lazily on first expand; opening an
										    archived chat keeps it open (a new message un-archives it
										    server-side). */}
										<div className="border-b border-zinc-800/40 pb-1">
											<button
												onClick={() => {
													setShowArchivedSection((prev) => !prev);
													if (!showArchivedSection) {
														void loadArchivedConvs();
													}
												}}
												className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] font-bold text-zinc-400 hover:text-white hover:bg-zinc-800/40 rounded-lg transition-colors cursor-pointer">
												<Archive className="h-3.5 w-3.5" />
												<span className="flex-1 text-left">
													Archived{" "}
													{archivedConvs.length > 0 && (
														<span className="text-[9px] text-zinc-600">
															({archivedConvs.length})
														</span>
													)}
												</span>
												<ChevronDown
													className={`h-3 w-3 transition-transform ${
														showArchivedSection ? "rotate-180" : ""
													}`}
												/>
											</button>
											{showArchivedSection && (
												<div className="space-y-1 pl-2 pr-2 pb-1">
													{archivedLoading ? (
														<div className="px-2 py-3">
															<Skeleton variant="profile-row" />
														</div>
													) : archivedConvs.length === 0 ? (
														<p className="px-3 py-2 text-[10px] text-zinc-600 text-center">
															No archived chats
														</p>
													) : (
														archivedConvs.map((conv) => (
															<ConversationListItem
																key={conv._id}
																conv={conv}
																user={user}
																onSelect={() => {
																	// Opening an archived chat keeps it archived (WhatsApp)
																	// — it stays in the archived section.
																	setSelectedConv(conv);
																}}
																onOpenMenu={(e) => openConvMenu(e, conv)}
																formatMessageTime={formatMessageTime}
															/>
														))
													)}
												</div>
											)}
										</div>

										{conversations.map((conv) => (
											<ConversationListItem
												key={conv._id}
												conv={conv}
												user={user}
												onSelect={() => setSelectedConv(conv)}
												onOpenMenu={(e) => openConvMenu(e, conv)}
												formatMessageTime={formatMessageTime}
											/>
										))}
									</>
								)}

								</div>
							</motion.div>
						) : (
						<motion.div
							key="conversation-view"
							initial={{ opacity: 0, x: 20 }}
							animate={{ opacity: 1, x: 0 }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0 }}
							className="w-full h-full flex flex-col min-h-0">
							<div className="px-2.5 py-2 border-b border-zinc-800/30 flex items-center justify-between gap-1.5 shrink-0 bg-zinc-950/10 backdrop-blur-lg relative z-10 sm:px-4 sm:py-2.5">
								<div className="flex items-center gap-3">
									<button
										onClick={handleCloseConversation}
										className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer shrink-0"
										title="Back to Conversations List">
										<ArrowLeft className="h-4 w-4" />
									</button>
									<div
										className="relative cursor-pointer hover:opacity-85"
										onClick={() =>
											onUserSelected(
												getPartner(selectedConv)
													.username,
											)
										}>
										<UserAvatar
											src={
												getPartner(selectedConv)
													.profilePic?.url
											}
											alt={
												getPartner(selectedConv)
													.fullName
											}
											perkRing={
												!!(getPartner(selectedConv) as any)
													.waitlistPerk
											}
											className="h-9 w-9 rounded-full object-cover border border-zinc-800"
										/>
										{getPartnerPresence(selectedConv) ===
											"online" && (
											<span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-zinc-950" />
										)}
									</div>
									<div className="text-left">
										<h4
											className="text-xs font-black text-white hover:underline cursor-pointer uppercase tracking-wider inline-flex items-center gap-1"
											onClick={() =>
												isSelfChatConv(selectedConv)
													? undefined
													: onUserSelected(
															getPartner(selectedConv)
																.username,
															)
											}>
											{isSelfChatConv(selectedConv)
												? "Message yourself"
												: getPartner(selectedConv).fullName}
											{!isSelfChatConv(selectedConv) &&
												(getPartner(selectedConv) as any)
													.waitlistPerk && <DayOneFlair />}
										</h4>
										<p className="text-[9px] text-zinc-500 font-bold leading-none mt-0.5">
											{isSelfChatConv(selectedConv)
												? "Your notes & links"
												: formatPresence(
														selectedConv.presence,
														selectedConv.lastSeenAt,
													)}
										</p>
									</div>
								</div>

								<div className="flex items-center gap-1.5">
									<button
										onClick={() => handleStartCall("audio")}
										className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
										title="Audio Call">
										<Phone className="h-3.5 w-3.5" />
									</button>
									<button
										onClick={() => handleStartCall("video")}
										className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
										title="Video Call">
									<Video className="h-3.5 w-3.5" />
									</button>
									<div className="relative" ref={chatMenuRef}>
										<button
											onClick={(e) => {
												e.stopPropagation();
												setShowChatMenu((prev) => !prev);
											}}
											className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
											title="Chat options">
											<MoreVertical className="h-3.5 w-3.5" />
										</button>
										<AnimatePresence>
											{showChatMenu && (
												<>
													<motion.div
														initial={{ opacity: 0, y: -6, scale: 0.97 }}
														animate={{ opacity: 1, y: 0, scale: 1 }}
														exit={{ opacity: 0, y: -6, scale: 0.97 }}
														transition={{ duration: 0.12 }}
														className="absolute right-0 top-9 z-[90] w-48 overflow-hidden rounded-xl border border-zinc-700/50 bg-zinc-900/95 backdrop-blur-xl shadow-2xl">
														<button
															onClick={() => {															setShowChatMenu(false);
															setShowMessageSearch((prev) => !prev);
															// Drop any in-flight search response when opening/closing.
															messageSearchSeqRef.current++;
															setMessageSearchQuery("");
															setMessageSearchResults([]);
														}}
														className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-semibold text-zinc-200 hover:bg-white/10 transition-colors cursor-pointer text-left">																<Search className="h-3.5 w-3.5 text-zinc-400" />
																Search messages
																</button>
																{/* Mute / Unmute — same toggle as the conversation-list menu */}
																<button
																	onClick={() => {
																		setShowChatMenu(false);
																		handleToggleConvMute(selectedConv);
																	}}
																	className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-semibold transition-colors cursor-pointer text-left ${
																		selectedConv?.muted
																			? "text-amber-300 hover:bg-amber-500/10"
																			: "text-zinc-200 hover:bg-white/10"
																	}`}
																>
																	{selectedConv?.muted ? (
																		<>
																			<BellOff className="h-3.5 w-3.5 text-amber-300" />
																			Unmute notifications
																		</>
																	) : (
																		<>
																			<Bell className="h-3.5 w-3.5 text-zinc-400" />
																			Mute notifications
																		</>
																	)}
																</button>
												{/* Media & files — the 1:1 media library (Photos/Videos/Audio/
												    Docs/Starred tabs), mirroring the community overlay. */}
												<button
													onClick={() => openMediaLibrary(selectedConv._id)}
													className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-semibold text-zinc-200 hover:bg-white/10 transition-colors cursor-pointer text-left">
													<ImageIcon className="h-3.5 w-3.5 text-zinc-400" />
													Media & files
												</button>
																{/* Archive / Unarchive — same toggle as the list menu */}
																<button
																	onClick={() =>
																		handleToggleConvArchive(selectedConv)
																	}
																	className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-semibold text-zinc-200 hover:bg-white/10 transition-colors cursor-pointer text-left">
																	{selectedConv.archived ? (
																		<ArchiveRestore className="h-3.5 w-3.5 text-zinc-400" />
																	) : (
																		<Archive className="h-3.5 w-3.5 text-zinc-400" />
																	)}
																	{selectedConv.archived
																		? "Unarchive chat"
																		: "Archive chat"}
																</button>
																<button
																	onClick={(e) => {
																		setShowChatMenu(false);
																		handleClearChat(e);
																	}}
																className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-semibold text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer text-left">
																<Trash2 className="h-3.5 w-3.5" />
																Clear chat history
															</button>
															{/* Block / Unblock — only meaningful in 1:1 user chats */}
															{blockToggling ? (
																<div className="flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-semibold text-zinc-400">
																	<Loader2 className="h-3.5 w-3.5 animate-spin" />
																	Updating…
																</div>
															) : (
																<button
																	onClick={handleToggleBlock}
																	className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-semibold transition-colors cursor-pointer text-left ${
																		iBlockedPartner
																			? "text-red-300 hover:bg-red-500/10"
																			: "text-zinc-300 hover:bg-zinc-800"
																	}`}
																>
																	{iBlockedPartner ? (
																		<>
																			<ShieldOff className="h-3.5 w-3.5" />
																			Unblock
																		</>
																	) : (
																		<>
																			<Shield className="h-3.5 w-3.5" />
																			Block
																		</>
																	)}
																</button>
															)}
														</motion.div>
												</>
											)}
										</AnimatePresence>
									</div>
								</div>
							</div>

							{/* Message search bar */}
							{showMessageSearch && (
								<div className="px-3 py-2 border-b border-zinc-800/30 shrink-0 bg-zinc-950/60">
									<div className="relative">
										<button
											type="button"
											onClick={() => {
												setShowMessageSearch(false);
												// Drop any in-flight search response when the bar closes.
												messageSearchSeqRef.current++;
												setMessageSearchQuery("");
												setMessageSearchResults([]);
											}}
											className="absolute right-2 top-1/2 -translate-y-1/2 z-10 flex h-5 w-5 items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
											title="Close search"
										>
											<X className="h-3 w-3" />
										</button>
										<input
											type="text"
											placeholder="Search messages..."
											value={messageSearchQuery}												onChange={(e) => {
													const val = e.target.value;
													setMessageSearchQuery(val);
													// Invalidate any in-flight response from the previous query.
													messageSearchSeqRef.current++;
													if (messageSearchTimerRef.current) clearTimeout(messageSearchTimerRef.current);
													if (!val.trim()) {
														setMessageSearchResults([]);
														setSearchingMessages(false);
														return;
													}
													// Clear stale results and show the searching state right
													// away so the previous query's matches never linger and
													// "No messages found" doesn't flash during the debounce.
													setMessageSearchResults([]);
													setSearchingMessages(true);
													messageSearchTimerRef.current = setTimeout(() => {
														handleMessageSearch(val);
													}, 300);
												}}
											onKeyDown={(e) => {
												if (e.key === "Escape") {
													setShowMessageSearch(false);
													setMessageSearchQuery("");
													setMessageSearchResults([]);
												}
											}}
											className="w-full rounded-full border border-zinc-800 bg-zinc-950/25 text-xs placeholder:text-xs text-slate-100 placeholder-zinc-500 outline-none focus:border-white focus:bg-zinc-900/80 transition-all focus:ring-1 focus:ring-white/20 px-3 py-2 pr-8"
											autoFocus
										/>
										{searchingMessages && (
											<span className="absolute right-8 top-1/2 -translate-y-1/2">
												<Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
											</span>
										)}
									</div>
									{messageSearchResults.length > 0 && (
										<div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
											{messageSearchResults.slice(0, 10).map((msg) => (
												<button
													key={msg._id}
													onClick={() => {
														setShowMessageSearch(false);
														setMessageSearchQuery("");
														setMessageSearchResults([]);
														popMessageBubble(msg._id);
													}}
													className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800/60 rounded-lg transition-colors truncate">
													{msg.text || (msg.attachments?.[0]?.type === "voice_note" ? "Voice note" : msg.attachments?.[0]?.type === "image" ? "Photo" : msg.attachments?.[0]?.type === "video" ? "Video" : "File")}
												</button>
											))}
										</div>
									)}
									{messageSearchQuery && !searchingMessages && messageSearchResults.length === 0 && (
										<p className="mt-2 text-[10px] text-zinc-500 text-center">No messages found</p>
									)}
								</div>
							)}									{/* Pinned messages banner — WhatsApp-style slim bar */}
									{pinnedMessages.length > 0 && (
										<div												className="shrink-0 border-b border-zinc-700/30 bg-zinc-950/60 px-3 py-1.5 flex items-center gap-2">
											<button
												type="button"
												title="View all pinned messages"
												onClick={() => setShowPinnedPanel(true)}
												className="flex items-center justify-center h-6 w-6 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-700/50 transition-all cursor-pointer"
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
																			message:
																				"Pinned message not loaded yet — scroll up to find it.",
																			type: "error",
																		},
																	}),
																);
															}
														}}
														className="shrink-0 max-w-[220px] flex items-center gap-1.5 rounded-md bg-zinc-950/80 border border-zinc-700/40 px-2 py-1 hover:bg-zinc-900/90 hover:border-zinc-600/50 transition-colors cursor-pointer text-left"
												>
													<span className="h-3.5 w-3.5 rounded-full bg-zinc-700 shrink-0 flex items-center justify-center overflow-hidden text-[7px] font-bold text-zinc-200">
														{pinned.sender?.profilePic?.url ? (
															<img
																src={optimizeImageUrl(pinned.sender.profilePic.url)}
																alt={pinned.sender.fullName}
																className="h-full w-full object-cover"
															/>
														) : (
															pinned.sender?.fullName?.charAt(0) ||
															"?"
														)}
													</span>
													<span className="flex-1 min-w-0 text-[9px] leading-tight text-zinc-300 truncate">
														<span className="font-semibold text-white">
															{pinned.sender?.fullName}:{" "}
														</span>
														{pinned.text ||
															(pinned.attachments?.length
																	? "Attachment"
																	: "")}
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
									{showPinnedPanel && createPortal(
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
														<h3 className="text-sm font-bold text-white">
															Pinned messages
														</h3>
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
														<p className="text-xs text-zinc-500 text-center py-8">
															No pinned messages
														</p>
													) : (
														pinnedMessages.map((pinned) => (
															<div
																key={pinned._id}
																className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-zinc-900/70 transition-colors group"
															>
																<span className="h-8 w-8 rounded-full bg-zinc-800 border border-zinc-700 shrink-0 flex items-center justify-center overflow-hidden text-[9px] font-bold text-zinc-300">
																	{pinned.sender?.profilePic?.url ? (
																		<img
																			src={optimizeImageUrl(pinned.sender.profilePic.url)}
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
																			(pinned.attachments?.length
																					? "Attachment"
																					: "")}
																	</p>
																</div>
																<button
																	onClick={() =>
																		handleUnpinFromPanel(pinned._id)
																	}
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
										</motion.div>
										,
										document.body,
									)}

									<div
										ref={messagesContainerRef}
										onTouchStart={handleConvTouchStart}
										onTouchMove={handleConvTouchMove}
										onTouchEnd={handleConvTouchEnd}
										className="flex-1 overflow-y-auto p-1.5 space-y-2.5 min-h-0 relative md:p-3">
								{loadingMsgs ? (
									<div className="space-y-4 p-2">
										{/* First batch loading — show 4 message bubble skeletons */}
										<Skeleton variant="message-received" />
										<Skeleton variant="message-sent" />
										<Skeleton variant="message-received" />
										<Skeleton variant="message-sent" />
									</div>
								) : messages.length === 0 ? (
									<div className="flex flex-col items-center justify-center h-full text-center px-4">
										<MessageSquare className="h-7 w-7 text-zinc-700 animate-bounce mb-2" />
										<h4 className="text-label-sm font-semibold text-zinc-300">
											Say hello!
										</h4>
										<p className="text-[11px] text-zinc-550 mt-1 font-mono uppercase max-w-xs leading-relaxed">
											Send the first message to start the
											conversation
										</p>
									</div>
								) : (
									<>
										{/* Top sentinel for infinite scroll (load older messages) */}
										{messagesHasMore && (
											<div
												ref={messagesTopSentinelRef}
												className="flex justify-center py-3">
												{loadingOlderMessages ? (
													<div className="space-y-3 w-full">
														<Skeleton variant="message-received" />
														<Skeleton variant="message-sent" />
													</div>
												) : (
													<Loader2 className="h-5 w-5 animate-spin text-zinc-550" />
												)}
											</div>
										)}
										{messages.map((msg, index) => {
											const prevMsg = index > 0 ? messages[index - 1] : null;
											const nextMsg = index < messages.length - 1 ? messages[index + 1] : null;

											const isMe = msg.sender._id === user._id;
											const prevIsMe = prevMsg ? prevMsg.sender._id === msg.sender._id : false;
											const nextIsMe = nextMsg ? nextMsg.sender._id === msg.sender._id : false;

											let showDateSeparator = false;
											let dateSeparatorText = "";
											if (!prevMsg) {
												showDateSeparator = true;
												dateSeparatorText = formatDateSeparator(msg.createdAt);
											} else {
												const prevDate = new Date(prevMsg.createdAt);
												const currDate = new Date(msg.createdAt);
												if (prevDate.toDateString() !== currDate.toDateString()) {
													showDateSeparator = true;
													dateSeparatorText = formatDateSeparator(msg.createdAt);
												}
											}

											let showTimeHeader = false;
											if (!prevMsg) {
												showTimeHeader = true;
											} else {
												const prevTime = new Date(prevMsg.createdAt).getTime();
												const currTime = new Date(msg.createdAt).getTime();
												const diffMinutes = (currTime - prevTime) / (1000 * 60);
												if (diffMinutes >= 20) {
													showTimeHeader = true;
												}
											}

											const isFirstInGroup = !prevMsg || !prevIsMe || showTimeHeader || showDateSeparator;

											const nextDateSeparator = nextMsg && new Date(msg.createdAt).toDateString() !== new Date(nextMsg.createdAt).toDateString();
											const nextTimeHeader = nextMsg && (new Date(nextMsg.createdAt).getTime() - new Date(msg.createdAt).getTime()) / (1000 * 60) >= 20;
											const isLastInGroup = !nextMsg || !nextIsMe || nextTimeHeader || nextDateSeparator;

						const groupedReactions =
							getGroupedReactions(
								msg.reactions,
							);

						// WhatsApp-style "Unread messages" divider — renders above the
						// FIRST message that was unread when the chat was opened.
						const showUnreadDivider = !!(
							unreadDividerTs &&
							new Date(msg.createdAt).getTime() >=
								new Date(unreadDividerTs).getTime() &&
							(!prevMsg ||
								new Date(prevMsg.createdAt).getTime() <
									new Date(unreadDividerTs).getTime())
						);
						const unreadDividerEl = showUnreadDivider ? (
							<div className="flex justify-center my-3 select-none">
								<span className="bg-sky-500/15 border border-sky-500/40 text-sky-400 text-[9.5px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wide">
									Unread messages
								</span>
							</div>
						) : null;

						// Call-activity system messages ("Voice call started/ended",
						// "Missed call") render as a centered chip, like WhatsApp.
						if (msg.system) {
								return (
									<React.Fragment key={msg._id}>
										{unreadDividerEl}
										<CallSystemMessage
														system={msg.system}
														callType={msg.callType}
														callDuration={msg.callDuration}
														createdAt={msg.createdAt}
														isMe={isMe}
														showDateSeparator={showDateSeparator}
														dateSeparatorText={dateSeparatorText}												formatMessageTime={formatMessageTime}
													/>
												</React.Fragment>
												);
											}

											return (
												<React.Fragment key={msg._id}>
													{unreadDividerEl}
													<MessageBubble
													msg={msg}
													isMe={isMe}
													userId={user._id}
													groupedReactions={
														groupedReactions
													}
													handleContextMenu={
														handleContextMenu
													}
													handleReaction={
														handleReaction
													}
													formatMessageTime={
														formatMessageTime
													}
													onSwipeToReply={
														handleReplyMessage
													}
													onUserClick={onUserSelected}
													showDateSeparator={
														showDateSeparator
													}
													dateSeparatorText={
														dateSeparatorText
													}
													showTimeHeader={
														showTimeHeader
													}
													isFirstInGroup={
														isFirstInGroup
													}
													isLastInGroup={
														isLastInGroup ?? undefined
													}
												uploadProgress={uploadProgress[msg._id]}
												onRetrySend={
													handleRetrySend
												}																	hideReactionCount
																	isOnline={isOnline}																		isPinned={pinnedMessages.some(
																			(p) => p._id === msg._id,
																		)}																			/>
																			</React.Fragment>
																		);
																	})}
																</>
															)}
															<div ref={messagesEndRef} />

								{/* Floating scroll-to-bottom button */}
								<AnimatePresence>
									{showScrollToBottom && (
										<motion.button
											initial={{ opacity: 0, y: 10, scale: 0.9 }}
											animate={{ opacity: 1, y: 0, scale: 1 }}
											exit={{ opacity: 0, y: 10, scale: 0.9 }}
											transition={{ duration: 0.2, ease: "easeOut" }}														onClick={() => {
															setUnreadDividerTs(null);
															scrollToBottom(true);
														}}
													className="absolute bottom-2 right-2 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800/90 backdrop-blur-md border border-zinc-700/50 text-zinc-300 hover:text-white hover:bg-zinc-700 hover:border-zinc-500 shadow-lg transition-all cursor-pointer"
											title="Scroll to bottom">
											<ChevronDown className="h-4 w-4" />
										</motion.button>
									)}
								</AnimatePresence>
							</div>

							<AnimatePresence>
								{partnerRecording && !isKeyboardOpen && (
									<motion.div
										initial={{ opacity: 0, y: 5 }}
										animate={{ opacity: 1, y: 0 }}
										exit={{ opacity: 0, y: 5 }}
										className="px-4 py-1.5 text-[9.5px] font-black text-red-400 font-mono text-left tracking-wide select-none flex items-center gap-2">
										<span className="flex items-center gap-1">
											<span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
											<span>
												{
													getPartner(selectedConv)
														.fullName
												}{" "}
												is recording a voice note...
											</span>
										</span>
										{/* Waveform bars */}
										<span className="flex items-center gap-[2px]">
											{[2, 4, 6, 8, 6, 4, 2].map(
												(h, i) => (
													<span
														key={i}
														className="w-[2px] bg-red-400/60 rounded-full"
														style={{
															height: `${h}px`,
															transformOrigin:
																"bottom",
															animation: `waveform 0.6s ease-in-out ${i * 0.15}s infinite alternate`,
														}}
													/>
												),
											)}
										</span>
									</motion.div>
								)}
								{partnerTyping &&
									!partnerRecording &&
									!isKeyboardOpen && (
										<TypingIndicator name={getPartner(selectedConv).fullName} />
									)}
							</AnimatePresence>

							<div
								className={`border-t border-zinc-800/30 shrink-0 bg-zinc-950/10 backdrop-blur-lg relative z-10 chat-input-area transition-all duration-200 ${
									isKeyboardOpen
										? "px-3 py-2"
										: "pl-1.5 pr-2.5 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom,0px))] sm:pl-2.5 sm:pr-4 sm:pt-3 sm:pb-3"
								}`}>
								{replyToMessage &&
									!replyToMessage.isDeleted && (
										<div className="flex items-start gap-2.5 mb-3 bg-zinc-950/60 p-3 rounded-2xl border border-zinc-800/60 max-w-md">
											<div className="w-0.5 h-full min-h-[2.5rem] rounded-full bg-white/40 shrink-0" />
											<div className="flex-1 min-w-0 text-left">
												<p className="text-[11px] font-black text-zinc-300 uppercase tracking-wider leading-tight">
													Replying to{" "}
													{
														replyToMessage.sender
															.fullName
													}
												</p>
												<p className="text-[12px] text-zinc-400 truncate mt-0.5 leading-relaxed">
													{replyToMessage.text ||
														(replyToMessage.attachments &&
														replyToMessage
															.attachments
															.length > 0
															? "Attachment"
															: "")}
												</p>
											</div>
											<button
												type="button"
												onClick={() =>
													setReplyToMessage(null)
												}
												className="h-5 w-5 rounded-full flex items-center justify-center hover:bg-zinc-800 text-zinc-500 hover:text-white transition-all shrink-0 mt-0.5 cursor-pointer">
												<X className="h-3 w-3" />
											</button>
										</div>
									)}

								{attachmentPreviews.length > 0 && (
									<ChatGallery
										attachmentPreviews={attachmentPreviews}
										attachments={attachments}
										removeAttachment={removeAttachment}
									/>
								)}
								{editingMessage ? (
									<form
										onSubmit={handleEditMessageSubmit}
										className="flex gap-2 items-center">
										<div className="grow relative">
											<textarea
												ref={editComposerRef}
												rows={1}
												wrap="soft"
												required
												value={editText}
												onChange={(e) => {
													// Auto-grow like the main composer — editing a
													// multi-line message shouldn't be a cramped box.
													const el = e.target;
													el.style.height = "auto";
													el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
													setEditText(el.value);
													clearFieldError("edit");
												}}
												onKeyDown={(e) => {
													// Same behavior as the main composer: Enter saves,
													// Shift+Enter inserts a line break.
													if (e.key === "Enter" && !e.shiftKey) {
														e.preventDefault();
														e.currentTarget.form?.requestSubmit();
													}
												}}
												className="w-full rounded-2xl border border-white/20 bg-zinc-900 px-4 py-2 text-[12px] md:text-sm text-white outline-none resize-none max-h-[120px] overflow-y-auto leading-relaxed"
											/>
											<span className="absolute right-4 top-3 text-[8.5px] font-mono text-zinc-550 uppercase pointer-events-none">
												Editing
											</span>
											<ValidationMessage
												message={fieldErrors.edit}
											/>
										</div>
										<button
											type="submit"															className="flex shrink-0 items-center justify-center rounded-full bg-aurora text-white border border-white/10 shadow-aurora hover:opacity-90 cursor-pointer transition-all duration-200 h-9 w-9">
											<Send className="h-4 w-4" />
										</button>
										<button
											type="button"
											onClick={() =>
												setEditingMessage(null)
											}
											className="flex shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-all cursor-pointer h-7 w-7">
											<X className="h-3.5 w-3.5" />
										</button>
									</form>
								) : recordedUrl ? (
									<div className="flex items-center gap-3 px-2 py-1.5">
										<button
											type="button"
											onClick={() => {
												if (audioPreviewRef.current) {
													if (isPlayingPreview) {
														audioPreviewRef.current.pause();
														audioPreviewRef.current.currentTime = 0;
													}
													setIsPlayingPreview(
														!isPlayingPreview,
													);
													if (!isPlayingPreview) {
														audioPreviewRef.current.play();
													}
												}
											}}
											className="h-9 w-9 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-zinc-200 hover:bg-white/20 transition-all cursor-pointer shrink-0">
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
												setRecordedUrl(null);
												setRecordingDuration(0);
												setIsPlayingPreview(false);
												if (recordedBlob) {
													URL.revokeObjectURL(
														recordedUrl!,
													);
												}
											}}
											className="h-7 w-7 rounded-full border border-zinc-700 bg-zinc-800/60 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700 transition-all cursor-pointer shrink-0">
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
											onEnded={() =>
												setIsPlayingPreview(false)
											}
											onTimeUpdate={() => {
												if (audioPreviewRef.current) {
													const progress =
														document.getElementById(
															"voice-preview-progress",
														);
													if (progress) {
														progress.style.width = `${(audioPreviewRef.current.currentTime / (audioPreviewRef.current.duration || 1)) * 100}%`;
													}
												}
											}}
										/>
									</div>
								) : isOnline === false ? (
									<div className="flex items-center justify-center gap-2 px-4 py-2 border border-amber-500/20 rounded-xl bg-amber-500/10">
										<WifiOff className="h-3.5 w-3.5 text-amber-400 shrink-0" />
										<p className="text-[10.5px] font-semibold text-amber-300">
											You're offline — messages will send automatically when
											you're back online
										</p>
									</div>
								) : blockedPartner ? (
									<div className="flex flex-col items-center justify-center gap-1.5 px-4 py-5 text-center border border-zinc-800/60 rounded-2xl bg-zinc-900/40">
										<ShieldAlert className="h-5 w-5 text-zinc-500" />
										<p className="text-[11px] md:text-xs font-semibold text-zinc-300">
											You can't message this user
										</p>
										<p className="text-[10px] text-zinc-600">
											This chat is unavailable due to a block.
										</p>
									</div>
								) : (
									<form
										onSubmit={handleSendMessage}
										onDragOver={handleDragOver}
										onDragLeave={handleDragLeave}
										onDrop={handleDrop}
										className="flex gap-2 items-center w-full relative">
									{isDragActive && (
										<div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-white/5 border-2 border-dashed border-white/25 backdrop-blur-sm">
											<div className="text-center">
												<ImageIcon className="h-8 w-8 text-zinc-300 mx-auto mb-2" />
												<p className="text-xs font-semibold text-zinc-200">Drop files here</p>
											</div>
										</div>
									)}
										<div className="grow relative flex items-end">
											<div className="relative w-full">
												{/* Media icon — inside the input box, tucked in slightly from the left edge */}
												<div className="absolute left-1 inset-y-0 z-10 flex items-center">
													<input
														type="file"
														accept="*/*"
														multiple
														disabled={attachments.length >= 5}
														onChange={handleFileChange}
														title="Select attachments (multiple allowed)"
														className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed z-30"
													/>
													<button
														type="button"
														className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800/60 border border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors cursor-pointer pointer-events-none">
														<ImageIcon className="h-4.5 w-4.5" />
													</button>
												</div>
												<textarea
													ref={composerRef}
												rows={1}
												wrap="soft"
												placeholder="Type a message..."
												value={inputText}
												onChange={(e) => {
													const v = e.target.value;
													setInputText(v);
													clearFieldError("message");
													handleTyping();
													handleMentionChange(v, e.target.selectionStart);
													// Per-chat draft — remember what's being typed for
													// THIS conversation so switching chats keeps it.
													if (selectedConv) {
														draftsRef.current.set(
																selectedConv._id,
																v,
															);
														saveDrafts();
													}
												}}
												onKeyDown={(e) => {
													// Arrow keys move the @mention highlight.
													if (
														showMentionDropdown &&
														(e.key === "ArrowDown" || e.key === "ArrowUp")
													) {
														e.preventDefault();
														mentionDropdownRef.current?.focus();
														return;
													}
													// Escape closes the @mention dropdown.
													if (e.key === "Escape") {
														closeMentionDropdown();
														return;
													}
													// WhatsApp-style: Enter sends, Shift+Enter inserts a
													// real line break that is preserved in the message.
													if (
														e.key === "Enter" &&
														!e.shiftKey
													) {
														e.preventDefault();
														e.currentTarget.form?.requestSubmit();
													}
												}}
												className={`w-full !rounded-2xl border border-zinc-800 bg-zinc-950/25 text-[12px] md:text-sm placeholder:text-[12px] md:placeholder:text-sm text-slate-100 placeholder-zinc-500 outline-none focus:border-white focus:bg-zinc-900/80 transition-all focus:ring-1 focus:ring-zinc-700 pl-[46px] resize-none max-h-[120px] overflow-y-auto leading-relaxed select-text disabled:opacity-60 disabled:cursor-not-allowed ${
													isKeyboardOpen
														? "py-2 pr-3"
														: "py-2.5 pr-10"
												}`}
											/>														<MentionSuggestions
															ref={mentionDropdownRef}
															candidates={candidateUsers}
															onSelect={selectMentionCandidate}
															onClose={closeMentionDropdown}
															anchorRef={composerRef}
														/>
													</div>
											<ValidationMessage
												message={fieldErrors.message}
											/>

											{!isKeyboardOpen && !inputText && (
												<span className="absolute right-3.5 top-3.5 text-[9px] text-zinc-650 hidden md:flex items-center gap-0.5 border border-zinc-800 px-1 rounded bg-zinc-950 select-none">
													<CornerDownLeft className="h-2 w-2" />{" "}
													Enter
												</span>
											)}
										</div>

										{isRecording ? (
											<div className="flex items-center gap-2 shrink-0">
												{/* Animated waveform bars */}
												<span className="flex items-center gap-[3px] h-5">
													{[
														3, 6, 10, 14, 18, 14,
														10, 6, 3,
													].map((h, i) => (
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
										) : null}

										{/* Schedule-send button — opens a quick time picker; the
										    message is stored now and delivered at the chosen time. */}
										<button
											type="button"
											title={scheduledFor ? "Change schedule" : "Schedule message"}
											onClick={() => setSchedulePickerOpen((v) => !v)}
											className={`flex shrink-0 items-center justify-center rounded-full transition-all duration-200 cursor-pointer h-9 w-9 ${
												scheduledFor
													? "bg-sky-500/20 border border-sky-400/40 text-sky-300 hover:bg-sky-500/30"
													: "bg-zinc-800/60 border border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-700"
											}`}>
											<Timer className="h-4 w-4" />
										</button>

										{pendingMessageIds.size === 0 && !(inputText.trim() || attachments.length > 0) && (
											<button
												type="button"
												onClick={handleMicClick}
												className={`flex shrink-0 items-center justify-center rounded-full transition-all duration-200 cursor-pointer ${
													isRecording
														? "h-9 w-9 bg-red-500 text-white hover:bg-red-600"
														: "h-9 w-9 bg-zinc-800/60 border border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-700"
												}`}>
												{isRecording ? (
													<Square className="h-4 w-4" />
												) : (
													<Mic className="h-4.5 w-4.5" />
												)}
											</button>
										)}

										{(inputText.trim() || attachments.length > 0 || recordedBlob || isRecording || pendingMessageIds.size > 0) && (
										<button
											type="submit"
											className="flex items-center justify-center rounded-full bg-aurora text-white border border-white/10 shadow-aurora hover:opacity-90 cursor-pointer transition-all duration-200 h-9 w-9">
											<Send className="h-4.5 w-4.5" />
										</button>
									)}
														</form>
								)}

							{/* Schedule-send popover — quick presets + exact datetime. Anchored
							    above the composer; closes on outside click. */}
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
											{/* Custom date+time picker — NO native datetime-local input (its
											    calendar/clock chrome renders as an ugly arrow on the field).
										    Discrete labeled fields: month / day / year + hour / minute /
										    AM-PM. Every change updates scheduledFor live (same behavior
										    as the old input). */}
											<div className="space-y-2 mt-2">
												<div>
													<p className="text-[8.5px] font-black text-zinc-500 uppercase tracking-wider mb-1">
														Date
													</p>
													<div className="grid grid-cols-3 gap-1.5">
														<select
															aria-label="Month"
															value={scheduledFor ? scheduledFor.getMonth() : new Date().getMonth()}
															onChange={(e) => {
																const base = scheduledFor ? new Date(scheduledFor) : new Date();
																const month = Number(e.target.value);
																// Clamp the day to the new month's length (Jan 31 → Feb 28).
																const daysInMonth = new Date(
																	base.getFullYear(),
																	month + 1,
																	0,
																).getDate();
																base.setMonth(month);
																base.setDate(Math.min(base.getDate(), daysInMonth));
																setScheduledFor(base);
															}}
															className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-2 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-white cursor-pointer"
														>
															{Array.from({ length: 12 }, (_, i) => (
																<option key={i} value={i}>
																	{new Date(2000, i, 1).toLocaleString([], { month: "short" })}
																</option>
															))}
														</select>
														<select
															aria-label="Day"
															value={scheduledFor ? scheduledFor.getDate() : new Date().getDate()}
															onChange={(e) => {
																const base = scheduledFor ? new Date(scheduledFor) : new Date();
																base.setDate(Number(e.target.value));
																setScheduledFor(base);
															}}
															className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-2 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-white cursor-pointer"
														>
															{(() => {
																	const d = scheduledFor ? new Date(scheduledFor) : new Date();
																	const daysInMonth = new Date(
																		d.getFullYear(),
																		d.getMonth() + 1,
																		0,
																	).getDate();
																	return Array.from({ length: daysInMonth }, (_, i) => (
																		<option key={i} value={i + 1}>
																			{i + 1}
																		</option>
																	));
																})()}
														</select>
														<select
															aria-label="Year"
															value={scheduledFor ? scheduledFor.getFullYear() : new Date().getFullYear()}
															onChange={(e) => {
																const base = scheduledFor ? new Date(scheduledFor) : new Date();
																const year = Number(e.target.value);
																base.setFullYear(year);
																// Clamp Feb 29 → Feb 28 on non-leap years.
																const daysInMonth = new Date(
																	year,
																	base.getMonth() + 1,
																	0,
																).getDate();
																base.setDate(Math.min(base.getDate(), daysInMonth));
																setScheduledFor(base);
															}}
															className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-2 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-white cursor-pointer"
														>
															{Array.from({ length: 3 }, (_, i) => {
																	const y = new Date().getFullYear() + i;
																	return (
																		<option key={y} value={y}>
																			{y}
																		</option>
																	);
																})}
														</select>
													</div>
												</div>
												<div>
													<p className="text-[8.5px] font-black text-zinc-500 uppercase tracking-wider mb-1">
														Time
													</p>
													<div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
														<select
															aria-label="Hour"
															value={
																	(() => {
																			const h = (scheduledFor ? new Date(scheduledFor) : new Date()).getHours();
																			const h12 = h % 12;
																			return h12 === 0 ? 12 : h12;
																		})()
																	}
																	onChange={(e) => {
																		const base = scheduledFor ? new Date(scheduledFor) : new Date();
																		const h12 = Number(e.target.value);
																		const ampm = base.getHours() >= 12 ? "PM" : "AM";
																		const h24 =
																			h12 === 12
																				? ampm === "AM"
																					? 0
																					: 12
																				: h12 + (ampm === "PM" ? 12 : 0);
																		base.setHours(h24);
																		setScheduledFor(base);
																	}}
																	className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-2 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-white cursor-pointer"
																>
																	{Array.from({ length: 12 }, (_, i) => (
																		<option key={i + 1} value={i + 1}>
																			{i + 1}
																		</option>
																	))}
																</select>
															<select
																aria-label="Minute"
																value={scheduledFor ? new Date(scheduledFor).getMinutes() : new Date().getMinutes()}
																onChange={(e) => {
																	const base = scheduledFor ? new Date(scheduledFor) : new Date();
																	base.setMinutes(Number(e.target.value));
																	setScheduledFor(base);
																}}
																className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-2 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-white cursor-pointer"
															>
																{Array.from({ length: 60 }, (_, i) => (
																	<option key={i} value={i}>
																		{String(i).padStart(2, "0")}
																	</option>
																))}
																</select>
																<div className="flex rounded-lg border border-zinc-800 overflow-hidden">
																	{["AM", "PM"].map((ampm) => {
																			const isActive =
																				(scheduledFor ? new Date(scheduledFor) : new Date()).getHours() >=
																				12
																					? ampm === "PM"
																					: ampm === "AM";
																			return (
																				<button
																					key={ampm}
																					type="button"
																					onClick={() => {
																						const base = scheduledFor ? new Date(scheduledFor) : new Date();
																						const h = base.getHours();
																						const isPm = h >= 12;
																						if (ampm === "PM" && !isPm) base.setHours(h + 12);
																						if (ampm === "AM" && isPm) base.setHours(h - 12);
																						setScheduledFor(base);
																					}}
																					className={`px-2.5 py-1.5 text-[10px] font-black transition-colors cursor-pointer ${
																						isActive
																							? "bg-zinc-700 text-white"
																							: "bg-zinc-950/40 text-zinc-500 hover:text-zinc-300"
																					}`}
																				>
																					{ampm}
																				</button>
																			);
																		})}
																</div>
															</div>
														</div>
													</div>
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
							</div>
						</motion.div>
					)}
				</AnimatePresence>				</GlassCard>

			{/* Camera capture overlay */}
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

			{contextMenu && (
				<>
					/* Desktop Context Menu with backdrop + viewport clamping */
					<>
						<motion.div
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							className="fixed inset-0 z-[300]"
							onClick={() => setContextMenu(null)}
						/>
						<motion.div
							ref={contextMenuRef}
							initial={{ opacity: 0, scale: 0.95 }}
							animate={{ opacity: 1, scale: 1 }}
							exit={{ opacity: 0, scale: 0.95 }}
							className="fixed z-[310] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden py-1 min-w-[180px] max-w-[calc(100vw-1rem)]"
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
							)}									<button
										onClick={() => {
											handleReplyMessage(contextMenu.message);
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
														new CustomEvent(
															"translate-inline:toggle",
															{
																detail: {
																	id: contextMenu.message
																		._id,
																},
															},
														),
													);
													setContextMenu(null);
												}}
												className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
											>
												<Languages className="h-3.5 w-3.5" />
												Translate
											</button>
										)}
									{/* Pin / Unpin — available for all non-deleted messages */}
									{!contextMenu.message.isDeleted &&
										(isMessagePinned(contextMenu.message._id) ? (
											<button
												onClick={() => {
													handleUnpinMessage(contextMenu.message._id);
												}}												className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
											>
												<PinOff className="h-3.5 w-3.5" />
												Unpin
											</button>
										) : (
											<button
												onClick={() => {
													handlePinMessage(contextMenu.message._id);
												}}
												className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
											>
												<Pin className="h-3.5 w-3.5" />
												Pin
											</button>
										))}
								{/* Star / Unstar — WhatsApp-style saved messages. Shows in the
								    chat's "Media & files → Starred" tab. */}
								{!contextMenu.message.isDeleted && (
									<button
										onClick={() =>
											handleToggleStarMessage(
												contextMenu.message,
											)
										}
										className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
									>
										{(
											contextMenu.message.savedBy || []
										).includes(user._id) ? (
											<Star className="h-3.5 w-3.5 text-amber-400" />
										) : (
											<Star className="h-3.5 w-3.5" />
										)}
										{(
											contextMenu.message.savedBy || []
										).includes(user._id)
											? "Unstar message"
											: "Star message"}
									</button>
								)}
								{/* Message info — WhatsApp-style Sent/Delivered/Read timestamps.
								    Outgoing messages only (receipts are the sender's view). */}
								{!contextMenu.message.isDeleted &&
									!contextMenu.message._pending &&
									(typeof contextMenu.message.sender === "string"
										? contextMenu.message.sender === user._id
										: contextMenu.message.sender?._id === user._id) && (
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
							{contextMenu.message.text && (
								<button
									onClick={() => {
										handleCopyMessage(contextMenu.message);
										setContextMenu(null);
									}}
									className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
								>
									<Copy className="h-3.5 w-3.5" />
									Copy Message
								</button>
								)}
							{/* Save media — a real download for image/video/file attachments.
							    (Previously media-only messages showed “Copy Message”, which
							    had nothing to copy.) */}
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
							<button
								onClick={() => {
									setForwardModal({
										message: contextMenu.message,
										x: contextMenu.x,
										y: contextMenu.y,
									});
									setContextMenu(null);
								}}
								className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
							>
								<Share2 className="h-3.5 w-3.5" />
								Forward Message
							</button>
							{/* Delete for me — available for ALL messages, not just own */}
							{!contextMenu.message.isDeleted && (
								<button
									onClick={() => {
										handleDeleteForMe(contextMenu.message._id);
										setContextMenu(null);
									}}
									className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-400 hover:bg-zinc-800 transition-colors cursor-pointer"
								>
									<X className="h-3.5 w-3.5" />
									Delete for me
								</button>
							)}
							{contextMenu.message.sender._id === user._id && (
								<>
									{isEditable(contextMenu.message.createdAt) && (
										<button
											onClick={() => {
												setEditingMessage(contextMenu.message);
												setEditText(contextMenu.message.text);
												setContextMenu(null);
											}}
											className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
										>
											<Edit2 className="h-3.5 w-3.5" />
											Edit
										</button>
									)}
									{isEditable(contextMenu.message.createdAt) && (
										<button
											onClick={() => {
												handleDeleteMessage(contextMenu.message._id);
												setContextMenu(null);
											}}
											className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-red-400 hover:bg-zinc-800 transition-colors cursor-pointer"
										>
											<Trash2 className="h-3.5 w-3.5" />
											Delete for everyone
										</button>
									)}
								</>
							)}
						</motion.div>
					</>
				</>
			)}

			{/* Conversation context menu — long-press / right-click on a chat row */}
			{convMenu && (
				<>
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						className="fixed inset-0 z-[300]"
						onClick={() => setConvMenu(null)}
					/>
					<motion.div
						ref={convMenuRef}
						initial={{ opacity: 0, scale: 0.95 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.95 }}
						className="fixed z-[310] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden py-1 min-w-[200px] max-w-[calc(100vw-1rem)]"
						style={{ left: convMenu.x, top: convMenu.y }}
						onClick={(e) => e.stopPropagation()}
					>
						{convMenu.conv.muted ? (
							<button
								onClick={() => handleToggleConvMute(convMenu.conv)}
								className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
							>
								<BellOff className="h-3.5 w-3.5" />
								Unmute chat
							</button>
						) : (
							<button
								onClick={() => handleToggleConvMute(convMenu.conv)}
								className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
							>
								<Bell className="h-3.5 w-3.5" />
								Mute chat
							</button>
						)}
						<button
							onClick={() => handleToggleConvArchive(convMenu.conv)}
							className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
						>
							{convMenu.conv.archived ? (
								<ArchiveRestore className="h-3.5 w-3.5" />
							) : (
								<Archive className="h-3.5 w-3.5" />
							)}
							{convMenu.conv.archived
								? "Unarchive chat"
								: "Archive chat"}
						</button>
						<button
							onClick={() => {
								const conversationId = convMenu.conv._id;
								setConvMenu(null);
								setDeleteConvConfirmId(conversationId);
							}}
							className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-red-400 hover:bg-zinc-800 transition-colors cursor-pointer"
						>
							<Trash2 className="h-3.5 w-3.5" />
							Delete chat
						</button>
					</motion.div>
				</>
			)}

			{/* ── 1:1 Media library (Photos/Videos/Audio/Docs/Starred) ── */}
			{mediaLibOpen && selectedConv && createPortal(
				<>
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm"
						onClick={() => setMediaLibOpen(false)}
					/>
					<motion.div
						initial={{ opacity: 0, scale: 0.96 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.96 }}
						className="fixed z-[310] inset-x-0 top-0 sm:inset-x-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[560px] h-[85vh] sm:h-[75vh] max-w-full bg-zinc-900/98 backdrop-blur-xl border-b sm:border border-zinc-800 rounded-b-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
					>
						{/* Header */}
						<div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
							<div className="flex items-center gap-2 min-w-0">
								<Archive className="h-4 w-4 text-zinc-400 shrink-0" />
								<div className="min-w-0">
									<h4 className="text-xs font-black text-white uppercase tracking-wider truncate">
										{getPartner(selectedConv).fullName}
									</h4>
									<p className="text-[9px] text-zinc-500 font-bold">
										Media & files
									</p>
								</div>
							</div>
							<button
								onClick={() => setMediaLibOpen(false)}
								className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
								title="Close">
								<X className="h-4 w-4" />
							</button>
						</div>
						{/* Tabs */}
						<div className="flex items-center gap-1 px-3 py-2 border-b border-zinc-800/60 shrink-0 overflow-x-auto scrollbar-thin">
							{MEDIA_TABS.map((tab) => (
								<button
									key={tab.key}
									onClick={() => {
										setMediaTab(tab.key);
										void fetchMediaTab(tab.key, selectedConv._id);
									}}
									className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold transition-colors cursor-pointer ${
										mediaTab === tab.key
											? "bg-white/10 text-white border border-white/20"
											: "text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent"
									}`}
								>
									<tab.Icon className="h-3 w-3" />
									{tab.label}
								</button>
							))}
						</div>
						{/* Content */}
						<div className="flex-1 overflow-y-auto scrollbar-thin">
							{mediaLoading ? (
								<div className="p-4 grid grid-cols-3 gap-2">
									<Skeleton variant="profile-row" />
									<Skeleton variant="profile-row" />
									<Skeleton variant="profile-row" />
								</div>
							) : mediaItems.length === 0 ? (
								<div className="py-16 text-center">
									<ImageIcon className="mx-auto h-8 w-8 text-zinc-700 mb-2" />
									<p className="text-[11px] text-zinc-500 font-bold">
										{mediaTab === "image"
											? "No photos yet"
											: mediaTab === "video"
												? "No videos yet"
												: mediaTab === "audio"
													? "No voice notes yet"
													: mediaTab === "file"
														? "No files yet"
														: "No starred messages yet"}
									</p>
								</div>
							) : mediaTab === "image" ? (
								<div className="p-3 grid grid-cols-3 gap-1.5">
									{mediaItems.map((m) =>
										(m.attachments || [])
											.filter((a) =>
												["image", "gif", "sticker", "meme"].includes(a.type),
											)
											.map((a) => (
												<button
													key={`${m._id}-${a.url}`}
													onClick={() => {
														setMediaLibOpen(false);
														popMessageBubble(m._id);
													}}
													className="aspect-square rounded-lg overflow-hidden bg-zinc-800/50 border border-zinc-800/50 hover:border-white/30 transition-colors cursor-pointer"
												>
													<img
															src={optimizeImageUrl(a.url, 300)}
															alt=""
															loading="lazy"
															decoding="async"
															className="h-full w-full object-cover"
														/>
													</button>
											))
											)}
								</div>
							) : mediaTab === "video" ? (
								<div className="p-3 grid grid-cols-3 gap-1.5">
									{mediaItems.map((m) =>
										(m.attachments || [])
											.filter((a) => a.type === "video")
											.map((a) => (
												<button
													key={`${m._id}-${a.url}`}
													onClick={() => {
														setMediaLibOpen(false);
														popMessageBubble(m._id);
													}}
													className="relative aspect-square rounded-lg overflow-hidden bg-zinc-800/50 border border-zinc-800/50 hover:border-white/30 transition-colors cursor-pointer"
												>
													<img
															src={videoPosterUrl(a.url, 300)}
															alt=""
															loading="lazy"
															decoding="async"
															className="h-full w-full object-cover"
														/>
													<span className="absolute inset-0 flex items-center justify-center">
														<span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
															<Play className="h-3.5 w-3.5 text-white" />
														</span>
													</span>
												</button>
											))
										)}
								</div>
							) : (
								<div className="p-3 space-y-1.5">
									{mediaItems.map((m) => (
										<button
											key={m._id}
											onClick={() => {
												setMediaLibOpen(false);
												popMessageBubble(m._id);
											}}
											className="w-full flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2.5 hover:border-zinc-600/60 hover:bg-zinc-900/60 transition-colors cursor-pointer text-left"
										>
											{mediaTab === "audio" ? (
												<FileAudio className="h-4 w-4 text-amber-400 shrink-0" />
											) : mediaTab === "file" ? (
												<FileText className="h-4 w-4 text-sky-400 shrink-0" />
											) : (
												<Star className="h-4 w-4 text-amber-400 shrink-0" />
											)}
											<div className="flex-1 min-w-0">
												<p className="text-[11px] text-zinc-200 font-semibold truncate">
													{mediaTab === "audio"
														? `Voice note · ${Math.round(
																(m.attachments?.[0]?.duration || 0) / 1000,
															)}s`
														: mediaTab === "file"
															? (m.attachments?.[0]?.name || "File")
															: m.text || "Starred message"}
												</p>
												<p className="text-[9px] text-zinc-500">
													{m.sender?.fullName || m.sender?.username}{" "}
													· {formatMessageTime(m.createdAt)}
												</p>
											</div>
											<ChevronDown className="h-3 w-3 -rotate-90 text-zinc-600 shrink-0" />
										</button>
									))}
								</div>
							)}
						</div>
					</motion.div>
				</>,
				document.body,
			)}

			{/* ── Message info panel (Sent / Delivered / Read) ── */}
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
							{/* Receipt rows */}
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
									icon: (
										<CustomCheck className="h-3.5 w-4 text-zinc-550" />
									),
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
									icon: (
										<CustomCheckCheck className="h-3.5 w-4.5 text-zinc-550" />
									),
									highlight: false,
								},
								{
									label: "Read",
										value: messageInfo.seenAt
											? new Date(messageInfo.seenAt).toLocaleTimeString([], {
													hour: "2-digit",
													minute: "2-digit",
												})
											: "Not read yet",
										date: messageInfo.seenAt
											? new Date(messageInfo.seenAt).toLocaleDateString([], {
													month: "short",
													day: "numeric",
												})											: "",
										icon: (
											<CustomCheckCheck className="h-3.5 w-4.5 text-[#38bdf8]" />
										),
									highlight: !!messageInfo.seenAt,
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
							)))}
						</div>
					</motion.div>
				</>,
				document.body,
			)}

			{/* Forward Message Modal */}
						{forwardModal && createPortal(
				<AnimatePresence>
					{isMobile ? (
						<>
							{/* Mobile Backdrop */}
							<motion.div
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								className="fixed inset-0 bg-black/70 z-[300]"
								onClick={() => {
									setForwardModal(null);
									setSelectedForwardConvIds([]);
								}}
							/>
							{/* Mobile Bottom Sheet */}
							<motion.div
								initial={{ y: "100%" }}
								animate={{ y: 0 }}
								exit={{ y: "100%" }}
								transition={{ type: "spring", damping: 25, stiffness: 250 }}
								className="fixed bottom-0 inset-x-0 bg-zinc-900/95 backdrop-blur-xl border-t border-zinc-800 rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-[310] overflow-hidden pb-8 max-w-md mx-auto pointer-events-auto max-h-[85vh] flex flex-col"
								onClick={(e) => e.stopPropagation()}
							>
								{/* Drag Handle */}
								<div className="w-12 h-1 bg-zinc-700 rounded-full mx-auto my-3" />
								{/* Forward content */}
								<div className="flex items-center justify-between px-6 mb-3">
									<h4 className="text-label-sm font-semibold text-zinc-200">
										Forward Message
									</h4>
									<button onClick={() => {
										setForwardModal(null);
										setSelectedForwardConvIds([]);
									}}>
										<X className="h-3 w-3 text-zinc-500 hover:text-white" />
									</button>
								</div>

								<div className="mx-6 mb-3 p-2.5 rounded-xl bg-zinc-800/50 border border-zinc-700 max-h-24 overflow-y-auto">
									<p className="text-[10px] text-zinc-300 leading-relaxed break-words">
										{forwardModal.message.text || (forwardModal.message.attachments && forwardModal.message.attachments.length > 0 ? "Attachment" : "")}
									</p>
								</div>

								<div className="flex-1 overflow-y-auto space-y-1 pr-0.5 px-6">
									{conversations.length === 0 ? (
										<p className="text-center text-[9px] text-zinc-500 font-mono uppercase py-3">
											No conversations yet
										</p>
									) : (
										conversations.map((conv) => {
											const partner = getPartner(conv);
											const isSelected = selectedForwardConvIds.includes(conv._id);
											return (
												<button
													key={conv._id}
													onClick={() =>
														handleToggleForwardSelection(
															conv._id,
														)
													}
													className={`w-full flex items-center gap-2.5 p-2 rounded-xl transition-all border ${
														isSelected
															? "bg-white/10 border-white/30"
															: "hover:bg-zinc-800/60 border-transparent"
													} text-left`}>
													<UserAvatar
														src={
															partner.profilePic?.url
														}
														alt={partner.fullName}
														className="h-7 w-7 rounded-full object-cover border border-zinc-800 shrink-0"
													/>
													<div className="min-w-0 flex-1">
														<p className="text-[11px] font-bold text-zinc-200 truncate inline-flex items-center gap-1">
															{partner.fullName}
															{(partner as any).isVerified && (
																<VerifiedBadge className="h-3 w-3 shrink-0" />
															)}
														</p>
														<p className="text-[8px] text-zinc-500 font-bold truncate">
															@{partner.username}
														</p>
													</div>
													<div className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ml-auto transition-all ${
														isSelected
															? "bg-white border-transparent text-black"
															: "border-zinc-700 text-transparent"
													}`}>
														{isSelected && (
															<svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3">
																<path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
															</svg>
														)}
													</div>
												</button>
											);
										})
									)}
								</div>
								<button
									onClick={handleExecuteForward}
									disabled={selectedForwardConvIds.length === 0}												className="w-full mt-3 py-2.5 bg-aurora hover:opacity-90 text-[10px] font-black uppercase tracking-wider text-white border border-white/10 rounded-xl shadow-aurora disabled:opacity-40 transition-all cursor-pointer shrink-0">
									Send ({selectedForwardConvIds.length}/5)
								</button>

								<div className="mt-3 pt-2.5 border-t border-zinc-800">
									<div className="text-[8px] font-mono text-zinc-500 uppercase mb-1.5">
										Or
									</div>
									<button
										onClick={() => {
											setForwardModal(null);
											setSelectedConv(null);
											setSelectedForwardConvIds([]);
										}}
										className="w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-xl hover:bg-zinc-800/60">
										<User className="h-3 w-3 text-zinc-400" />
										<span className="text-[11px] font-bold text-zinc-200">
											Start a new conversation
										</span>
									</button>
								</div>
							</motion.div>
						</>
					) : (
						<>
							<motion.div
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								className="fixed inset-0 z-[300] bg-black/50 flex items-center justify-center p-4"
								onClick={() => {
									setForwardModal(null);
									setSelectedForwardConvIds([]);
								}}>
								<motion.div
									initial={{ scale: 0.9, y: 20 }}
									animate={{ scale: 1, y: 0 }}
									exit={{ scale: 0.9, y: 20 }}
									onClick={(e) => e.stopPropagation()}
									className="bg-zinc-900/95 backdrop-blur-xl border border-zinc-800 rounded-2xl p-4 w-full max-w-xs shadow-2xl max-h-[85vh] flex flex-col">
									<div className="flex items-center justify-between mb-3">
										<h4 className="text-label-sm font-semibold text-zinc-200">
											Forward Message
										</h4>
										<button onClick={() => {
											setForwardModal(null);
											setSelectedForwardConvIds([]);
										}}>
											<X className="h-3 w-3 text-zinc-500 hover:text-white" />
										</button>
									</div>

									<div className="mb-3 p-2.5 rounded-xl bg-zinc-800/50 border border-zinc-700 max-h-24 overflow-y-auto">
										<p className="text-[10px] text-zinc-300 leading-relaxed break-words">
											{forwardModal.message.text || (forwardModal.message.attachments && forwardModal.message.attachments.length > 0 ? "Attachment" : "")}
										</p>
									</div>

									<div className="flex-1 overflow-y-auto space-y-1 pr-0.5">
										{conversations.length === 0 ? (
											<p className="text-center text-[9px] text-zinc-500 font-mono uppercase py-3">
												No conversations yet
											</p>
										) : (
											conversations.map((conv) => {
												const partner = getPartner(conv);
												const isSelected = selectedForwardConvIds.includes(conv._id);
												return (
													<button
														key={conv._id}
														onClick={() =>
															handleToggleForwardSelection(
																conv._id,
															)
														}
														className={`w-full flex items-center gap-2.5 p-2 rounded-xl transition-all border ${
															isSelected
																? "bg-white/10 border-white/30"
																: "hover:bg-zinc-800/60 border-transparent"
														} text-left`}>
														<UserAvatar
															src={
																partner.profilePic?.url
															}
															alt={partner.fullName}
															className="h-7 w-7 rounded-full object-cover border border-zinc-800 shrink-0"
														/>
														<div className="min-w-0 flex-1">
															<p className="text-[11px] font-bold text-zinc-200 truncate">
																{partner.fullName}
															</p>
															<p className="text-[8px] text-zinc-500 font-bold truncate">
																@{partner.username}
															</p>
														</div>
														<div className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ml-auto transition-all ${
															isSelected
																? "bg-white border-transparent text-black"
																: "border-zinc-700 text-transparent"
														}`}>
															{isSelected && (
																<svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3">
																	<path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
																</svg>
															)}
														</div>
													</button>
												);
											})
										)}
									</div>
									<button
										onClick={handleExecuteForward}
										disabled={selectedForwardConvIds.length === 0}
										className="w-full mt-3 py-2.5 bg-white hover:bg-zinc-200 text-[10px] font-black uppercase tracking-wider text-black rounded-xl disabled:opacity-40 disabled:hover:bg-white transition-all cursor-pointer shadow-md shrink-0">
										Send ({selectedForwardConvIds.length}/5)
									</button>

									<div className="mt-3 pt-2.5 border-t border-zinc-800">
										<div className="text-[8px] font-mono text-zinc-500 uppercase mb-1.5">
											Or
										</div>
										<button
											onClick={() => {
												setForwardModal(null);
												setSelectedConv(null);
												setSelectedForwardConvIds([]);
											}}
											className="w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-xl hover:bg-zinc-800/60">
											<User className="h-3 w-3 text-zinc-400" />
											<span className="text-[11px] font-bold text-zinc-200">
												Start a new conversation
											</span>
										</button>
									</div>
								</motion.div>
							</motion.div>
						</>
					)}
				</AnimatePresence>,
				document.body
			)}

			{/* Confirm Clear Chat Modal */}
			{showClearConfirm && createPortal(
				<ConfirmDialog
					isOpen={showClearConfirm}
					title="Clear Chat History"
					message="Are you sure you want to clear the entire chat history? This action cannot be undone."
					confirmLabel="Clear"
					cancelLabel="Cancel"
					variant="danger"
					onConfirm={handleConfirmClear}
					onCancel={() => setShowClearConfirm(false)}
				/>,
				document.body
			)}

			{/* Confirm Delete Conversation Modal */}
			{deleteConvConfirmId !== null && createPortal(
				<ConfirmDialog
					isOpen={deleteConvConfirmId !== null}
					title="Delete Conversation"
					message="Are you sure you want to delete this conversation? This action cannot be undone."
					confirmLabel="Delete"
					cancelLabel="Cancel"
					variant="danger"
					onConfirm={executeDeleteConversation}
					onCancel={() => setDeleteConvConfirmId(null)}
				/>,
				document.body
			)}

			{/* Crop Modal for image attachments */}
			<ImageCropModal
				isOpen={cropModalOpen}
			onClose={() => {
				const pending = cropPendingQueueRef.current;
				if (pending?.cancelledFile) {
					// User cancelled — restore original file first (before revoking URL)
					setAttachments((prev) => [pending.cancelledFile!.file, ...cropQueueFiles, ...prev]);
					setAttachmentPreviews((prev) => [pending.cancelledFile!.url, ...pending.previews, ...prev]);
				} else if (cropSrc) {
					// User cancelled without a pending file — clean up the blob URL
					URL.revokeObjectURL(cropSrc);
				}
				setCropModalOpen(false);
				// Clean up
				cropPendingQueueRef.current = { files: [], previews: [] };
				setCropQueueFiles([]);
			}}
				imageSrc={cropSrc}
				title="Free Crop Image"
				onCropComplete={handleCropComplete}
			/>
		</div>
	);
}
