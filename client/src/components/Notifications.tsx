import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
	Bell,
	Heart,
	MessageSquare,
	UserPlus,
	Repeat2,
	Bookmark,
	AtSign,
	SmilePlus,
	AlertCircle,
	Clock,
	X,
	Eye,
	EyeOff,
	ExternalLink,
	Copy,
	Trash2,
	BarChart3,
	Check,
	Share2,
	Trophy,
	PhoneMissed,
	Phone,
	PhoneOff,
} from "lucide-react";
import { Socket } from "socket.io-client";
import { Notification, User } from "../types";
import { formatCallDuration } from "../utils/format";
import GlassCard from "./GlassCard";
import UserAvatar from "./UserAvatar";
import SharedCollectionView from "./SharedCollectionView";
import { apiFetch } from "../utils/api";
import { getCachedResponse } from "../utils/apiCache";
import { getOfflineFallback } from "../utils/dexieBridge";
import { useCacheRefresh } from "../hooks/useCacheRefresh";
import { logger } from "../utils/logger";
import { renderLinkifiedText } from "../utils/linkify";
import { BADGE_MAP } from "../utils/badgeCatalog";

interface NotificationsProps {
	user: User | null;
	socket: Socket | null;
	onPostClick: (slug: string) => void;
	onUserClick: (username: string) => void;
	onBadgeReset: () => void;
	onCommunityClick?: (communityId: string) => void;
}

// ─── Notification type filter categories ────────────────────────
const FILTER_TABS = [
	{ key: "all", label: "All", icon: Bell },
	{ key: "like", label: "Likes", icon: Heart },
	{ key: "comment", label: "Comments", icon: MessageSquare },
	{ key: "follow", label: "Follows", icon: UserPlus },
	{ key: "mention", label: "Mentions", icon: AtSign },
	{ key: "reaction", label: "Reactions", icon: SmilePlus },
	{ key: "repost", label: "Reposts", icon: Repeat2 },
	{ key: "save", label: "Saves", icon: Bookmark },
] as const;

export default function Notifications({
	user,
	socket,
	onPostClick,
	onUserClick,
	onBadgeReset,
	onCommunityClick,
}: NotificationsProps) {
	const [notifications, setNotifications] = useState<Notification[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [activeFilter, setActiveFilter] = useState<string>("all");

	// ── Tab labels ──
	// On every screen size each tab is an icon pill and only the active tab
	// also shows its label (so tapping an icon reveals its name while the
	// previous tab collapses back to just the icon). Single line, no scroll.

	const filteredNotifications = activeFilter === "all"
		? notifications
		: notifications.filter((n) =>
				activeFilter === "follow"
					? n.type === "follow" || n.type === "follow_request"
					: n.type === activeFilter,
			);

	// On mount, try to display cached notifications instantly (stale-while-revalidate)
	useEffect(() => {
		(async () => {
			try {
				let cached = await getCachedResponse<{
					notifications: Notification[];
					success: boolean;
				}>("/api/notifications");
				if (!cached?.notifications?.length) {
					// CacheStorage missed → try the Dexie structured layer
					// (survives browser cache eviction).
					cached = (await getOfflineFallback(
						"/api/notifications",
					)) as { notifications: Notification[]; success: boolean } | null;
				}
				if (cached?.notifications?.length && cached.success) {
					setNotifications(cached.notifications);
					setLoading(false);
				}
			} catch {
				// Cache read failures are non-critical
			}
		})();
	}, []);

	const fetchNotifications = async (bypass: boolean = false) => {
		setLoading(true);
		try {
			const res = await apiFetch(
				"/api/notifications",
				bypass ? { bypassCache: true } : undefined,
			);
			const data = await res.json();
			if (res.ok && data.success) {
				setNotifications(data.notifications || []);
				onBadgeReset(); // Mark badge alerts read on load
			} else {
				setError(data.message || "Failed to load alerts.");
			}
		} catch (e) {
			setError("Lost connection to server.");
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		// Bypass the cache on mount — the tab unmounts when the user navigates
		// away, so notifications that arrived while on another tab were only
		// reflected in the badge counter, not in this list. A cache-first read
		// here could serve a stale list missing those new notifications.
		fetchNotifications(true);
	}, [user]);

	// When the background cache timer refreshes notifications, re-fetch
	// so the list stays up-to-date without manual refresh.
	useCacheRefresh("/api/notifications", () => fetchNotifications());

	// Blocked users must vanish from the notification list immediately —
	// when a block/unblock is announced in realtime (App.tsx wipes caches
	// and fires this event), re-fetch so mounted list updates without reload.
	useEffect(() => {
		const handleNotificationsRefresh = () =>
			fetchNotifications(true);
		window.addEventListener(
			"notificationsRefresh",
			handleNotificationsRefresh,
		);
		return () =>
			window.removeEventListener(
				"notificationsRefresh",
				handleNotificationsRefresh,
			);
	}, []);

	// Listen for real-time notifications via socket
	useEffect(() => {
		if (!socket) return;

		const handleNewNotification = (notification: Notification) => {
			setNotifications((prev) => {
				// Prevent duplicates
				if (prev.some((n) => n._id === notification._id)) return prev;
				return [notification, ...prev];
			});
		};

		socket.on("notification", handleNewNotification);

		return () => {
			socket.off("notification", handleNewNotification);
		};
	}, [socket]);

	// Rollback helper: re-fetch from the server when an optimistic mutation
	// fails, so the list reflects the authoritative state instead of the
	// (wrong) optimistic one.
	const rollbackNotifications = () => fetchNotifications(true);

	// Mark all notifications as read — OPTIMISTIC: flip every row instantly
	// so the button feels responsive even on slow networks (the server
	// round-trip here routinely takes many seconds). The server reconciles
	// below; on failure we re-fetch the authoritative list.
	const handleMarkAllRead = async () => {
		setNotifications((prev) =>
			prev.map((n) => ({ ...n, isRead: true })),
		);
		try {
			const res = await apiFetch("/api/notifications/read", {
				method: "PUT",
			});
			if (!res.ok) {
				logger.error("Mark all read failed", res.status);
				rollbackNotifications();
			}
		} catch (e) {
			logger.error(e);
			rollbackNotifications();
		}
	};

	// Mark a notification (or an entire grouped "X and N others" row) as
	// read — optimistic flip, rollback on failure. Grouped rows carry
	// groupMemberIds: one tap must clear every underlying unread row,
	// otherwise the badge stays inflated under a collapsed row.
	const handleMarkSingleRead = async (n: {
		_id: string;
		groupMemberIds?: string[];
	}) => {
		const ids = n.groupMemberIds?.length ? n.groupMemberIds : [n._id];
		setNotifications((prev) =>
			prev.map((item) =>
				ids.includes(item._id) ? { ...item, isRead: true } : item,
			),
		);
		try {
			const res = await apiFetch(`/api/notifications/${n._id}/read`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: ids.length > 1 ? JSON.stringify({ ids }) : undefined,
			});
			if (!res.ok) {
				logger.error("Mark single read failed", res.status);
				rollbackNotifications();
			}
		} catch (e) {
			logger.error(e);
			rollbackNotifications();
		}
	};

	// Clear all — optimistic empty, restore the snapshot on failure.
	const handleClearAll = async () => {
		const previous = notifications;
		setNotifications([]);
		try {
			const res = await apiFetch("/api/notifications", {
				method: "DELETE",
			});
			if (!res.ok) {
				logger.error("Clear all failed", res.status);
				setNotifications(previous);
			}
		} catch (e) {
			logger.error(e);
			setNotifications(previous);
		}
	};

	// Delete a notification (or an entire grouped row) — optimistic removal,
	// re-fetch on failure. Grouped rows delete all their members at once.
	const handleDeleteSingle = async (n: {
		_id: string;
		groupMemberIds?: string[];
	}) => {
		const ids = n.groupMemberIds?.length ? n.groupMemberIds : [n._id];
		setNotifications((prev) =>
			prev.filter((item) => !ids.includes(item._id)),
		);
		setContextMenu(null);
		try {
			const res = await apiFetch(`/api/notifications/${n._id}`, {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: ids.length > 1 ? JSON.stringify({ ids }) : undefined,
			});
			if (!res.ok) {
				logger.error("Delete notification failed", res.status);
				rollbackNotifications();
			}
		} catch (e) {
			logger.error(e);
			rollbackNotifications();
		}
	};

	// ─── Follow-request actions (private accounts) ────────────────────
	// Instagram-style Approve / Decline on the "wants to follow you"
	// notification row. The sender of the request is notif.sender._id.
	const [busyFollowRequestId, setBusyFollowRequestId] = useState<
		string | null
	>(null);

	const handleFollowRequestDecision = async (
		notif: Notification,
		approve: boolean,
	) => {
		const senderId = notif.sender?._id;
		if (!senderId || busyFollowRequestId) return;
		setBusyFollowRequestId(notif._id);
		try {
			const res = await apiFetch(
				`/api/users/${senderId}/${approve ? "approve-request" : "decline-request"}`,
				{ method: "POST" },
			);
			const data = await res.json();
			if (!res.ok || !data.success) {
				throw new Error(data.message || "Could not update follow request");
			}
			// Remove the notification row — the server already deletes the
			// follow_request notification and creates a "followed you" one on
			// approval, so a refetch shows the correct updated state.
			setNotifications((prev) =>
				prev.filter((n) => n._id !== notif._id),
			);
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message: approve
							? "Follow request approved — they can now see your content"
							: "Follow request declined",
						type: "success",
					},
				}),
			);
			// Refresh so the approval's "followed you" notification (and the
			// updated follower count in the profile header) appear immediately.
			void fetchNotifications(true);
		} catch (err: any) {
			logger.error("Follow request decision failed", err);
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message:
							err.message || "Failed to update follow request",
						type: "error",
					},
				}),
			);
		} finally {
			setBusyFollowRequestId(null);
		}
	};

	// Context menu state (like CommentNode & Chat)
	// Shared collection viewer — opened from collection_share notifications
	const [sharedCollectionId, setSharedCollectionId] = useState<string | null>(
		null,
	);
	const [contextMenu, setContextMenu] = useState<{
		notif: Notification;
		x: number;
		y: number;
	} | null>(null);

	// Mobile detection
	const [isMobile, setIsMobile] = useState(false);
	useEffect(() => {
		if (typeof window === "undefined") return;
		const mq = window.matchMedia("(max-width: 613px)");
		setIsMobile(mq.matches);
		const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, []);

	// Timestamp ref to prevent synthetic click events on mobile from closing the
	// context menu immediately after a long-press (browsers fire click after touchend).
	const contextMenuOpenedAtRef = useRef(0);

	// Close context menu when clicking outside.
	// Uses a timestamp guard to ignore synthetic click events that mobile browsers
	// fire after touchend — these race with the long-press handler (500ms in
	// handleTouchStart) and cause the menu to open and immediately close. Clicks
	// more than 300ms after the menu opened are real user clicks (e.g. tapping
	// outside) and should close the menu. The backdrop overlay also handles
	// tap-to-close on mobile.
	useEffect(() => {
		const handleClick = () => {
			if (Date.now() - contextMenuOpenedAtRef.current > 300) {
				setContextMenu(null);
			}
		};
		window.addEventListener("click", handleClick);
		return () => window.removeEventListener("click", handleClick);
	}, []);

	// Long-press timer ref
	const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Swipe-to-open-post gesture state (ref-based for 60fps)
	const [showSwipeBadge, setShowSwipeBadge] = useState(false);
	const swipeBarRef = useRef<HTMLDivElement>(null);
	const swipeOffsetRef = useRef(0);
	const swipeTouchStartXRef = useRef(0);
	const swipeTouchStartYRef = useRef(0);
	const isSwipingNotifRef = useRef(false);
	// True for the rest of a touch interaction when the user performed a
	// swipe-to-open gesture — the browser fires a trailing `click` after
	// touchend, and without this guard that click would also trigger the
	// row's navigation onClick (accidental redirect while swiping).
	const didSwipeRef = useRef(false);
	// Same idea for long-press: once the context menu opens, the trailing
	// click after touchend must NOT also navigate the row.
	const didLongPressRef = useRef(false);

	const handleContextMenuOpen = (
		e:
			| React.MouseEvent
			| {
					clientX: number;
					clientY: number;
					preventDefault: () => void;
					stopPropagation?: () => void;
			  },
		notif: Notification,
	) => {
		e.preventDefault();
		if (e.stopPropagation) e.stopPropagation();
		const x = Math.min(
			Math.max(10, (e as any).clientX || 0),
			window.innerWidth - 10,
		);
		const y = Math.min(
			Math.max(10, (e as any).clientY || 0),
			window.innerHeight - 10,
		);
		contextMenuOpenedAtRef.current = Date.now();
		setContextMenu({ notif, x, y });
	};

	// Integrated touch handler — handles swipe-to-open AND long-press context menu
	let touchNotifRef: Notification | null = null;

	const handleTouchStart = (e: React.TouchEvent, notif: Notification) => {
		const touch = e.touches[0];
		touchNotifRef = notif;
		swipeTouchStartXRef.current = touch.clientX;
		swipeTouchStartYRef.current = touch.clientY;
		isSwipingNotifRef.current = false;
		didSwipeRef.current = false;
		didLongPressRef.current = false;
		swipeOffsetRef.current = 0;
		setShowSwipeBadge(false);
		if (swipeBarRef.current) {
			swipeBarRef.current.style.transform = "translateX(-6px)";
			swipeBarRef.current.style.opacity = "0";
		}

		touchTimerRef.current = setTimeout(() => {
			if (!isSwipingNotifRef.current && touch) {
				didLongPressRef.current = true;
				handleContextMenuOpen(
					{
						clientX: touch.clientX,
						clientY: touch.clientY,
						preventDefault: () => {},
						stopPropagation: () => {},
					} as any,
					notif,
				);
			}
		}, 500);
	};

	const handleTouchMove = (e: React.TouchEvent) => {
		const touch = e.touches[0];
		if (!touch) return;
		const deltaX = touch.clientX - swipeTouchStartXRef.current;
		const deltaY = touch.clientY - swipeTouchStartYRef.current;

		// Check if horizontal swipe
		if (
			!isSwipingNotifRef.current &&
			Math.abs(deltaX) > 15 &&
			Math.abs(deltaX) > Math.abs(deltaY) * 1.5
		) {
			isSwipingNotifRef.current = true;
			if (touchTimerRef.current) {
				clearTimeout(touchTimerRef.current);
				touchTimerRef.current = null;
			}
		}

		if (isSwipingNotifRef.current) {
			const offset = Math.min(Math.max(0, deltaX), 80);
			swipeOffsetRef.current = offset;
			if (swipeBarRef.current) {
				swipeBarRef.current.style.transition = "none";
				swipeBarRef.current.style.transform = `translateX(${offset - 6}px)`;
				swipeBarRef.current.style.opacity = offset > 0 ? "1" : "0";
			}
			if (offset > 20 && !showSwipeBadge) {
				setShowSwipeBadge(true);
			} else if (offset <= 20 && showSwipeBadge) {
				setShowSwipeBadge(false);
			}
		}
	};

	const handleTouchEnd = () => {
		if (touchTimerRef.current) {
			clearTimeout(touchTimerRef.current);
			touchTimerRef.current = null;
		}

		if (
			isSwipingNotifRef.current &&
			swipeOffsetRef.current > 50 &&
			touchNotifRef
		) {
			const notif = touchNotifRef;
			didSwipeRef.current = true;
			if (notif.post) {
				onPostClick(notif.post.slug);
			} else if (notif.sender) {
				onUserClick(notif.sender.username);
			}
		}

		swipeOffsetRef.current = 0;
		setShowSwipeBadge(false);
		if (swipeBarRef.current) {
			swipeBarRef.current.style.transition = "";
			swipeBarRef.current.style.transform = "translateX(-6px)";
			swipeBarRef.current.style.opacity = "0";
		}
		isSwipingNotifRef.current = false;
		swipeTouchStartXRef.current = 0;
		swipeTouchStartYRef.current = 0;
		touchNotifRef = null;
	};

	// Copy notification text
	const handleCopyNotifText = (notif: Notification) => {
		let text = notif.sender?.fullName || "";
		const details = getNotifDetails(notif.type);
		text += ` ${details.text}`;
		if (notif.post?.title) text += `: ${notif.post.title}`;
		if (notif.comment?.content) text += `: "${notif.comment.content}"`;
		navigator.clipboard.writeText(text).catch(() => {});
		setContextMenu(null);
	};

	// Icon type mapping

	// Icon type mapping
	const getNotifDetails = (type: string) => {
		switch (type) {
			case "like":
				return {
					icon: Heart,
					color: "text-rose-600 bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/30",
					text: "liked your post",
				};
			case "comment":
				return {
					icon: MessageSquare,
					color: "text-zinc-600 bg-zinc-800/20 border-zinc-800",
					text: "commented on your post",
				};
			case "follow":
				return {
					icon: UserPlus,
					color: "text-zinc-400 bg-zinc-900/20 border-zinc-800",
					text: "started following you",
				};
			case "follow_request":
				return {
					icon: UserPlus,
					color: "text-amber-600 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/30",
					text: "wants to follow you",
				};
			case "repost":
				return {
					icon: Repeat2,
					color: "text-zinc-400 bg-zinc-900/20 border-zinc-800",
					text: "reposted your post",
				};
			case "save":
				return {
					icon: Bookmark,
					color: "text-zinc-400 bg-zinc-900/20 border-zinc-800",
					text: "bookmarked your post",
				};
			case "mention":
				return {
					icon: AtSign,
					color: "text-zinc-600 bg-zinc-800/20 border-zinc-800",
					text: "mentioned you inside a post thread",
				};
			case "reaction":
				return {
					icon: SmilePlus,
					color: "text-amber-600 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/30",
					text: "reacted to your comment",
				};    case "message":
      return {
        icon: MessageSquare,
        color: "text-zinc-400 bg-zinc-900/20 border-zinc-800",
        text: "sent you a message",
      };
    case "call_missed":
      return {
        icon: PhoneMissed,
        color: "text-rose-400 bg-rose-900/10 border-rose-900/30",
        text: "tried to call you",
      };
    case "call_started":
      return {
        icon: Phone,
        color: "text-emerald-400 bg-emerald-900/10 border-emerald-900/30",
        text: "called you",
      };
    case "call_ended":
      return {
        icon: PhoneOff,
        color: "text-zinc-400 bg-zinc-900/20 border-zinc-800",
        text: "ended a call with you",
      };
    case "message_reply":
      return {
        icon: MessageSquare,		color: "text-violet-300 bg-sky-50 dark:bg-violet-950/20 border-violet-200 dark:border-violet-900/30",
        text: "replied to your message",
      };
    case "glimpse_reaction":
      return {
        icon: Heart,
        color: "text-rose-600 bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/30",
        text: "reacted to your glance",
      };
    case "glimpse_reply":
      return {
        icon: MessageSquare,
        color: "text-violet-600 bg-violet-50 dark:bg-violet-950/20 border-violet-200 dark:border-violet-900/30",
        text: "replied to your glance",
      };
    case "poll_vote":
      return {
        icon: BarChart3,
        color: "text-violet-600 bg-violet-50 dark:bg-violet-950/20 border-violet-200 dark:border-violet-900/30",
        text: "voted in your poll",
      };
    case "collab_invite":
      return {
        icon: UserPlus,
        color: "text-green-600 bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900/30",
        text: "invited you to collaborate on their post",
      };
    case "invite_accepted":
      return {
        icon: Check,
        color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/30",
        text: "accepted your collaboration invite",
      };
    case "profile_share":
      return {
        icon: Share2,
        color: "text-zinc-400 bg-zinc-900/20 border-zinc-800",
        text: "shared a profile with you",
      };
    case "post_share":
      return {
        icon: Share2,
        color: "text-zinc-400 bg-zinc-900/20 border-zinc-800",
        text: "shared a post with you",
      };
    case "glimpse_share":
      return {
        icon: Share2,
        color: "text-zinc-400 bg-zinc-900/20 border-zinc-800",
        text: "shared a glance with you",
      };
    case "comment_share":
      return {
        icon: Share2,
        color: "text-zinc-400 bg-zinc-900/20 border-zinc-800",
        text: "shared a comment with you",
      };
    case "collection_share":
      return {
        icon: Share2,
        color: "text-zinc-400 bg-zinc-900/20 border-zinc-800",
        text: "shared a collection with you",
      };
    case "badge_unlocked":
      return {
        icon: Trophy,
        color: "text-amber-600 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/30",
        text: "unlocked an achievement",
      };
    default:
      return {
        icon: Bell,
        color: "text-zinc-500 bg-zinc-800 border-zinc-700",
        text: "interacted with you",
      };
		}
	};

	// Shared tab button. The label only shows for the active tab (icon pills
	// otherwise) on every screen size.
	const renderTabButton = (tab: (typeof FILTER_TABS)[number]) => {
		const TabIcon = tab.icon;
		const isActive = activeFilter === tab.key;
		const count =
			tab.key === "all"
				? notifications.length
				: notifications.filter((n) =>
						tab.key === "follow"
							? n.type === "follow" || n.type === "follow_request"
							: n.type === tab.key,
					).length;
		return (
			<button
				key={tab.key}
				onClick={() => setActiveFilter(tab.key)}
				title={tab.label}
				aria-label={tab.label}
				className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2 text-[11px] font-bold transition-all cursor-pointer ${
				isActive
					? "pill-active"
					: "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
				}`}
			>
				<TabIcon className="h-3.5 w-3.5 shrink-0" />
				<span className={`${isActive ? "inline" : "hidden"}`}>
					{tab.label}
				</span>
				{count > 0 && (
					<span
						className={`ml-0.5 text-[10px] ${
							isActive ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-500"
						}`}
					>
						{count}
					</span>
				)}
			</button>
		);
	};

	const getRelativeTime = (isoString: string) => {
		const stamp = new Date(isoString).getTime();
		const diff = Date.now() - stamp;
		const mins = Math.floor(diff / 60000);
		const hrs = Math.floor(mins / 60);

		if (mins < 1) return "Just now";
		if (mins < 60) return `${mins}m ago`;
		if (hrs < 24) return `${hrs}h ago`;
		return new Date(isoString).toLocaleDateString([], {
			month: "short",
			day: "numeric",
		});
	};

	if (loading) {
		return (
			<div className="w-full px-2 pt-6 space-y-4">
				{[1, 2, 3].map((n) => (
					<div
						key={n}
						className="flex h-20 w-full animate-pulse rounded-3xl border border-zinc-800 bg-zinc-800/40"
					/>
				))}
			</div>
		);
	}

	return (
		<div className="w-full px-2 pt-6">
			<div className="mb-4 flex flex-wrap items-center justify-between gap-2">
				<div className="min-w-0">
					<h2 className="text-display-sm text-gradient-aurora">
						Notifications
					</h2>
					<p className="text-sm text-slate-500 dark:text-zinc-400">
						Keep track of updates and interactions
					</p>
				</div>

				{notifications.length > 0 && (
					<div className="flex items-center gap-1.5">
						<button
							onClick={handleMarkAllRead}
							className="flex items-center gap-1 rounded-full border border-zinc-800/80 bg-zinc-900/50 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white cursor-pointer">
							<Check className="h-3 w-3" />
							Mark all read
						</button>
						<button
							onClick={handleClearAll}
							className="flex items-center gap-1 rounded-full border border-zinc-800/60 px-2.5 py-1 text-[11px] font-semibold text-zinc-500 transition-colors hover:border-red-900/40 hover:bg-red-950/20 hover:text-red-400 cursor-pointer">
							<Trash2 className="h-3 w-3" />
							Clear all
						</button>
					</div>
				)}
			</div>

			{/* Filter tabs — on every screen each tab is an icon pill and only the
			   active one also shows its label (tap an icon to reveal its name).
			   Single line, no scroll, no wrap. */}
			<div className="mb-5 flex items-center gap-1.5">
				{FILTER_TABS.map((tab) => renderTabButton(tab))}
			</div>

			{error && (
				<div className="mb-6 flex items-start gap-2.5 rounded-3xl border border-red-900/30 bg-red-950/25 p-4.5 text-sm text-red-800 dark:text-red-400">
					<AlertCircle className="h-4.5 w-4.5 shrink-0 text-red-600" />
					<span>{error}</span>
				</div>
			)}

			{filteredNotifications.length === 0 ? (
				<GlassCard className="flex flex-col items-center justify-center py-16 text-center shadow-sm">
					<div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-1 bg-zinc-800 border border-zinc-700 text-black dark:text-white shadow-sm animate-pulse font-sans">
						<Bell className="h-6 w-6" />
					</div>
					<h3 className="mt-4 text-label text-xl font-semibold text-slate-800 dark:text-zinc-200">
						{activeFilter === "all" ? "All quiet here" : `No ${FILTER_TABS.find((t) => t.key === activeFilter)?.label?.toLowerCase() || activeFilter} notifications`}
					</h3>
					<p className="mx-auto mt-2 max-w-sm text-sm text-slate-400 dark:text-zinc-400 leading-relaxed">
						{activeFilter === "all"
							? "When someone likes, comments, follows, or mentions you, you'll see it here."
							: `You don't have any ${activeFilter} notifications at this time.`}
					</p>
				</GlassCard>
			) : (
				<div className="space-y-3.5">
					<AnimatePresence initial={false}>
						{filteredNotifications.map((notif) => {
							const details = getNotifDetails(notif.type);
							const NotifIcon = details.icon;

							return (
								<div
									key={notif._id}
									className="relative overflow-hidden"
									onContextMenu={(e) =>
										handleContextMenuOpen(e, notif)
									}
									onTouchStart={(e) =>
										handleTouchStart(e, notif)
									}
									onTouchEnd={handleTouchEnd}
									onTouchMove={handleTouchMove}>
									{/* Swipe-to-open-post indicator — ref-based CSS transform */}
									<div
										ref={swipeBarRef}
										className="absolute inset-y-0 left-0 w-1.5 bg-zinc-400/50 rounded-r-full pointer-events-none z-10"
										style={{
											transform: "translateX(-6px)",
											opacity: 0,
											transition:
												"transform 200ms ease-out, opacity 200ms ease-out",
										}}
									/>
									{showSwipeBadge && (
										<div className="absolute left-2 top-1/2 -translate-y-1/2 z-10 pointer-events-none">
											<div className="flex items-center gap-1.5 bg-white/10 backdrop-blur-sm rounded-full px-2.5 py-1 border border-white/20">
												<ExternalLink className="h-3 w-3 text-zinc-300" />
												<span className="text-[9px] font-bold text-zinc-300 uppercase tracking-wider">
													Open
												</span>
											</div>
										</div>
									)}
									<div
										role="button"
										tabIndex={0}
										onClick={() => {
											// Ignore the trailing click that follows a
											// swipe-to-open gesture (already navigated) or
											// a long-press (context menu is open).
											if (didSwipeRef.current || didLongPressRef.current)
												return;
											if (!notif.isRead)
												handleMarkSingleRead(notif);
											// Whole-row tap opens the exact place the
											// notification happened.
											if (notif.type === "profile_share") {
												// Open the SHARED profile, not the sender
												if (notif.user?.username) {
													onUserClick(notif.user.username);
												} else if (notif.sender?.username) {
													onUserClick(
														notif.sender.username,
													);
												}
											} else if (
												notif.type === "comment_share" &&
												notif.comment?.post?.slug
											) {
												// Open the post that holds the shared comment
												onPostClick(notif.comment.post.slug);
											} else if (
												notif.type === "glimpse_share" &&
												notif.glimpse?.author?.username
											) {
												// Open the glance author's profile
												onUserClick(notif.glimpse.author.username);
											} else if (
												notif.type === "collection_share" &&
												notif.collection?._id
											) {
												// Open the read-only shared collection viewer
												setSharedCollectionId(
													notif.collection._id,
												);
											} else if (
												notif.type === "mention" &&
												notif.community?._id &&
												onCommunityClick
											) {
												// Community mention — open the community chat
												onCommunityClick(notif.community._id);
											} else if (
												(notif.type === "call_started" ||
													notif.type === "call_ended") &&
												notif.community &&
												onCommunityClick
											) {
												// Community call — open the community chat so the
												// user can see the call chip / join the next one.
												onCommunityClick(
													typeof notif.community === "string"
														? notif.community
														: notif.community._id,
												);
											} else if (
												notif.type === "mention" &&
												notif.comment?.post?.slug
											) {
												// Comment mention — open the post that holds the comment
												onPostClick(notif.comment.post.slug);
											} else if (notif.post?.slug) {
												onPostClick(notif.post.slug);
											} else if (notif.sender?.username) {
												onUserClick(notif.sender.username);
											}
										}}
										onKeyDown={(e) => {
											if (e.key === "Enter" || e.key === " ") {
												e.preventDefault();
												if (!notif.isRead)
													handleMarkSingleRead(notif);												if (
													notif.type === "mention" &&
													notif.community?._id &&
													onCommunityClick
												) {
													// Community mention — open the community chat
													onCommunityClick(notif.community._id);
												} else if (
													(notif.type === "call_started" ||
														notif.type === "call_ended") &&
													notif.community &&
													onCommunityClick
												) {
													// Community call — keyboard parity with the click
													// handler: open the community chat.
													onCommunityClick(
														typeof notif.community === "string"
															? notif.community
															: notif.community._id,
														);
												} else if (
													notif.type === "mention" &&
													notif.comment?.post?.slug
												) {
													// Comment mention — open the post that holds the comment
													onPostClick(notif.comment.post.slug);
												} else if (notif.post?.slug) {
													onPostClick(notif.post.slug);
												} else if (
													notif.type === "comment_share" &&
												notif.comment?.post?.slug
											) {
												onPostClick(notif.comment.post.slug);
											} else if (
												notif.type === "glimpse_share" &&
												notif.glimpse?.author?.username
											) {
												onUserClick(notif.glimpse.author.username);
											} else if (
												notif.type === "collection_share" &&
												notif.collection?._id
											) {
												// Keyboard parity with the click handler — open the
												// shared collection viewer instead of the sender's
												// profile.
												setSharedCollectionId(
													notif.collection._id,
												);
											} else if (notif.sender?.username) {
												onUserClick(notif.sender.username);
											}
										}
										}}
										className={`group relative flex items-start justify-between gap-3 rounded-2xl border px-3 py-2.5 transition-colors cursor-pointer ${
											notif.isRead
												? "border-transparent hover:bg-white/[0.04]"
												: "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
										}`}>
										<div className="flex gap-3">
											{/* Floating Bubble Type Indicator */}
											<div className="relative shrink-0">
												<UserAvatar
													src={
														notif.sender?.profilePic
															?.url
													}												alt={notif.sender?.fullName}
													className="h-8 w-8 pointer-events-none border border-zinc-800"
												/>
												{/* Grouped rows — "X and N others": a small count badge on the
												    avatar so the extra people are visible at a glance. */}
												{notif.groupCount && notif.groupCount > 1 && (
													<span
														className="absolute -top-1.5 -left-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-zinc-900 border border-zinc-700 px-0.5 text-[9px] font-bold text-zinc-100 shadow"
														title={`${notif.groupCount} people`}
													>
														{notif.groupCount > 99 ? "99+" : notif.groupCount}
													</span>
												)}
												{!notif.isRead && (
													<span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-zinc-100 shadow-[0_0_6px_rgba(255,255,255,0.6)]" />
												)}
												<span
													className={`absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border ${details.color}`}>
													<NotifIcon className="h-2 w-2" />
												</span>
											</div>

											<div className="space-y-1">
												<p className="text-[13px] leading-snug text-slate-700 dark:text-zinc-200">
													{/* Call-ended rows read neutral & sender-less, like a call log:
													    "Call with Alex ended · 12m 30s" (the sender may not be the
													    one who hung up). */}
													{notif.type === "call_ended" ? (
														<>
															Call with{" "}
															<span className="font-bold text-slate-900 dark:text-white">
																{notif.sender?.fullName ||
																	notif.sender?.username ||
																	"Someone"}
															</span>{" "}
															ended
														</>
													) : (
														<>
													<span className="font-bold text-slate-900 dark:text-white cursor-pointer hover:underline">
														{notif.sender?.fullName ||
															"Anonymous User"}
													</span>
													{notif.groupCount && notif.groupCount > 1 ? (
														<span className="font-bold text-slate-900 dark:text-white">
															{" "}and {notif.groupCount - 1}{" "}
															{notif.groupCount - 1 === 1 ? "other" : "others"}
														</span>
													) : null}{" "}
													<span className="text-slate-500 dark:text-zinc-400">
														{notif.type === "call_started" &&
														notif.community
															? "started a call in a community"
															: details.text}
													</span>
												</>
													)}
												</p>												{/* Brief context — post title / comment content */}
												{notif.post?.title && (
													<p className="mt-0.5 truncate text-[12px] font-medium text-slate-500 dark:text-zinc-400">
														{renderLinkifiedText(
															notif.post.title.length > 60
																? notif.post.title.slice(0, 60) +
																	"..."
																: notif.post.title,
														)}
													</p>
												)}

										{notif.comment?.content && (
											<p className="mt-0.5 truncate pl-2 text-[12px] italic text-slate-400 dark:text-zinc-500">
												"{renderLinkifiedText(notif.comment.content)}"
											</p>
										)}

										{/* Badge context for badge_unlocked — show the badge label */}
										{notif.type === "badge_unlocked" &&
											notif.badge && (
												<p className="mt-0.5 truncate text-[12px] font-bold text-amber-500 dark:text-amber-400">
													🏆 {BADGE_MAP[notif.badge]?.label || notif.badge.replace(/_/g, " ")}
												</p>
											)}											{/* Call context — "Missed voice call" / "Voice call" / "Call ended · 12m 30s" */}
											{notif.type === "call_missed" && (
												<p className="mt-0.5 truncate text-[12px] font-medium text-rose-400 dark:text-rose-400">
													Missed {notif.callType === "video" ? "video" : "voice"} call
												</p>
											)}
											{notif.type === "call_started" && (
												<p className="mt-0.5 truncate text-[12px] font-medium text-emerald-400">
													{notif.community
														? (typeof notif.community === "object"
																? notif.community.name || "Community call"
																: "Community call")
														: `${notif.callType === "video" ? "Video" : "Voice"} call`}
												</p>
											)}
											{notif.type === "call_ended" &&
												notif.callDuration !== undefined &&
												notif.callDuration > 0 && (
													<p className="mt-0.5 truncate text-[12px] font-medium text-zinc-400">
														{formatCallDuration(notif.callDuration)} · {notif.callType === "video" ? "Video" : "Voice"} call
													</p>
												)}

											{/* Shared profile context for profile_share */}
											{notif.type === "profile_share" &&
												notif.user && (
													<p className="mt-0.5 truncate text-[12px] font-medium text-slate-500 dark:text-zinc-400">
														@{notif.user.username} · profile
													</p>
												)}

											{/* Shared comment context for comment_share */}
											{notif.type === "comment_share" &&
												notif.comment?.content && (
													<p className="mt-0.5 truncate pl-2 text-[12px] italic text-slate-400 dark:text-zinc-500">
														"{renderLinkifiedText(notif.comment.content)}"
													</p>
												)}


										{/* Shared glance context for glimpse_share */}
										{notif.type === "glimpse_share" &&
											notif.glimpse?.author?.username && (
												<p className="mt-0.5 truncate text-[12px] font-medium text-slate-500 dark:text-zinc-400">
													by @{notif.glimpse.author.username} · glance
												</p>
											)}

												<div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400 dark:text-zinc-500">
													<Clock className="h-2.5 w-2.5" />
													<span>
														{getRelativeTime(
															notif.createdAt,
														)}
													</span>
												</div>

												{/* Approve / Decline actions for pending follow requests */}
												{notif.type === "follow_request" && (
													<div className="mt-2 flex items-center gap-2">
														<button
															onClick={(e) => {
																e.stopPropagation();
																handleFollowRequestDecision(
																	notif,
																	true,
																);
															}}
															disabled={
																busyFollowRequestId === notif._id
															}
															className="flex items-center gap-1 rounded-full bg-aurora px-3 py-1.5 text-[11px] font-bold text-white border border-white/10 shadow-aurora transition-all hover:opacity-90 disabled:opacity-50 cursor-pointer">
															<Check className="h-3 w-3" />
															Approve
														</button>
														<button
															onClick={(e) => {
																e.stopPropagation();
																handleFollowRequestDecision(
																	notif,
																	false,
																);
															}}
															disabled={
																busyFollowRequestId === notif._id
															}
															className="flex items-center gap-1 rounded-full border border-zinc-700/70 px-3 py-1.5 text-[11px] font-bold text-zinc-300 transition-all hover:bg-zinc-800 hover:text-white disabled:opacity-50 cursor-pointer">
															<X className="h-3 w-3" />
															Decline
														</button>
													</div>
												)}
											</div>
										</div>

										{/* Delete — subtle X pinned to the top-right */}
										<div className="flex items-start shrink-0">
											<button
												onClick={(e) => {
													e.stopPropagation();
												handleDeleteSingle(notif);
												}}
												aria-label="Delete notification"
												className="rounded-full p-1 text-zinc-600 hover:text-red-400 hover:bg-white/10 dark:hover:bg-zinc-800 transition-colors focus:outline-none cursor-pointer">
												<X className="h-3.5 w-3.5" />
											</button>
										</div>
									</div>
								</div>
							);
						})}
					</AnimatePresence>
				</div>
			)}

			{/* Context Menu — mobile bottom sheet or desktop popover */}
			<AnimatePresence>
				{contextMenu && (
					<>
						{isMobile ? (
							<>
								{/* Mobile Backdrop */}
								<motion.div
									initial={{ opacity: 0 }}
									animate={{ opacity: 1 }}
									exit={{ opacity: 0 }}
									transition={{ duration: 0.15 }}
									className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[300] pointer-events-auto"
									onClick={() => setContextMenu(null)}
								/>
								{/* Mobile Bottom Sheet */}
								<motion.div
									initial={{ y: "100%" }}
									animate={{ y: 0 }}
									exit={{ y: "100%" }}
									transition={{
										type: "spring",
										damping: 25,
										stiffness: 250,
									}}
									className="fixed bottom-0 inset-x-0 bg-zinc-900/95 backdrop-blur-xl border-t border-zinc-800 rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-[310] overflow-hidden pb-8 max-w-md mx-auto pointer-events-auto"
									onClick={(e) => e.stopPropagation()}>
									{/* Drag Handle */}
									<div className="w-12 h-1 bg-zinc-700 rounded-full mx-auto my-3" />

									{/* Notification preview */}
									<div className="px-6 py-3 border-b border-zinc-800/60">
										<div className="flex items-center gap-3">
											<UserAvatar
												src={
													contextMenu.notif.sender
														?.profilePic?.url
												}
												alt={
													contextMenu.notif.sender
														?.fullName
												}
												className="h-8 w-8 rounded-full object-cover border border-zinc-800"
											/>
											<div className="text-left">
												<p className="text-sm font-bold text-zinc-200">
													{contextMenu.notif.sender
														?.fullName ||
														"Anonymous"}
												</p>
												<p className="text-[11px] text-zinc-500">
													{
														getNotifDetails(
															contextMenu.notif
																.type,
														).text
													}
												</p>
											</div>
										</div>
									</div>

									{/* Actions */}
									<div className="p-3 space-y-0.5">
										{contextMenu.notif.post && (
											<button
												onClick={() => {
													onPostClick(
														contextMenu.notif.post!
															.slug,
													);
													setContextMenu(null);
												}}
												className="w-full px-3 py-2.5 text-left text-sm font-bold text-zinc-200 hover:bg-zinc-850 rounded-xl flex items-center gap-2.5 cursor-pointer">
												<ExternalLink className="h-3.5 w-3.5 text-zinc-400" />
												Go to post
											</button>
										)}
										{contextMenu.notif.sender && (
											<button
												onClick={() => {
													onUserClick(
														contextMenu.notif
															.sender!.username,
													);
													setContextMenu(null);
												}}
												className="w-full px-3 py-2.5 text-left text-sm font-bold text-zinc-200 hover:bg-zinc-850 rounded-xl flex items-center gap-2.5 cursor-pointer">
												<ExternalLink className="h-3.5 w-3.5 text-zinc-400" />
												View profile
											</button>
										)}
										{!contextMenu.notif.isRead ? (
											<button
												onClick={() => {												handleMarkSingleRead(contextMenu.notif);
												setContextMenu(null);
												}}
												className="w-full px-3 py-2.5 text-left text-sm font-bold text-zinc-200 hover:bg-zinc-850 rounded-xl flex items-center gap-2.5 cursor-pointer">
												<Eye className="h-3.5 w-3.5 text-zinc-400" />
												Mark as read
											</button>
										) : (
											<button
												onClick={() => {
													setContextMenu(null);
												}}
												className="w-full px-3 py-2.5 text-left text-sm font-bold text-zinc-200 hover:bg-zinc-850 rounded-xl flex items-center gap-2.5 cursor-pointer">
												<EyeOff className="h-3.5 w-3.5 text-zinc-400" />
												Already read
											</button>
										)}
										<button
											onClick={() =>
												handleCopyNotifText(
													contextMenu.notif,
												)
											}
											className="w-full px-3 py-2.5 text-left text-sm font-bold text-zinc-200 hover:bg-zinc-850 rounded-xl flex items-center gap-2.5 cursor-pointer">
											<Copy className="h-3.5 w-3.5 text-zinc-400" />
											Copy text
										</button>
										<button
											onClick={() => {
												handleDeleteSingle(contextMenu.notif);
											}}
											className="w-full px-3 py-2.5 text-left text-sm font-bold text-red-400 hover:bg-red-500/10 rounded-xl flex items-center gap-2.5 cursor-pointer">
											<Trash2 className="h-3.5 w-3.5 text-red-400" />
											Delete
										</button>
										<button
											onClick={() => setContextMenu(null)}
											className="w-full px-3 py-2.5 text-left text-sm font-bold text-zinc-400 hover:bg-zinc-850 rounded-xl flex items-center gap-2.5 border border-zinc-800/50 mt-1.5 cursor-pointer">
											<X className="h-3.5 w-3.5 text-zinc-400" />
											Cancel
										</button>
									</div>
								</motion.div>
							</>
						) : (
							/* Desktop Context Menu */
							<motion.div
								initial={{ opacity: 0, scale: 0.9 }}
								animate={{ opacity: 1, scale: 1 }}
								exit={{ opacity: 0, scale: 0.9 }}
								style={{
									position: "fixed",
									left: Math.min(
										Math.max(20, contextMenu.x),
										window.innerWidth - 220,
									),
									top: Math.min(
										Math.max(20, contextMenu.y),
										window.innerHeight - 280,
									),
									zIndex: 1000,
								}}
								className="bg-zinc-900/95 backdrop-blur-xl border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden pointer-events-auto w-52"
								onClick={(e) => e.stopPropagation()}>
								<div className="p-1">
									{contextMenu.notif.post && (
										<button
											onClick={() => {
												onPostClick(
													contextMenu.notif.post!
														.slug,
												);
												setContextMenu(null);
											}}
											className="w-full px-3 py-2.5 text-left text-sm font-bold text-zinc-200 hover:bg-zinc-800/60 rounded-xl flex items-center gap-2 cursor-pointer">
											<ExternalLink className="h-3.5 w-3.5" />
											Go to post
										</button>
									)}
									{contextMenu.notif.sender && (
										<button
											onClick={() => {
												onUserClick(
													contextMenu.notif.sender!
														.username,
												);
												setContextMenu(null);
											}}
											className="w-full px-3 py-2.5 text-left text-sm font-bold text-zinc-200 hover:bg-zinc-800/60 rounded-xl flex items-center gap-2 cursor-pointer">
											<ExternalLink className="h-3.5 w-3.5" />
											View profile
										</button>
									)}
									{!contextMenu.notif.isRead ? (
										<button
											onClick={() => {
												handleMarkSingleRead(contextMenu.notif);
												setContextMenu(null);
											}}
											className="w-full px-3 py-2.5 text-left text-sm font-bold text-zinc-200 hover:bg-zinc-800/60 rounded-xl flex items-center gap-2 cursor-pointer">
											<Eye className="h-3.5 w-3.5" />
											Mark as read
										</button>
									) : (
										<button
											onClick={() => {
												setContextMenu(null);
											}}
											className="w-full px-3 py-2.5 text-left text-sm font-bold text-zinc-400 hover:bg-zinc-800/60 rounded-xl flex items-center gap-2 cursor-pointer">
											<EyeOff className="h-3.5 w-3.5" />
											Already read
										</button>
									)}
									<button
										onClick={() =>
											handleCopyNotifText(
												contextMenu.notif,
											)
										}
										className="w-full px-3 py-2.5 text-left text-sm font-bold text-zinc-200 hover:bg-zinc-800/60 rounded-xl flex items-center gap-2 cursor-pointer">
										<Copy className="h-3.5 w-3.5" />
										Copy text
									</button>
									<button
										onClick={() => {
											handleDeleteSingle(contextMenu.notif);
										}}
										className="w-full px-3 py-2.5 text-left text-sm font-bold text-red-400 hover:bg-red-500/10 rounded-xl flex items-center gap-2 cursor-pointer">
										<Trash2 className="h-3.5 w-3.5" />
										Delete
									</button>
									<button
										onClick={() => setContextMenu(null)}
										className="w-full px-3 py-2.5 text-left text-sm font-bold text-zinc-400 hover:bg-zinc-800/60 rounded-xl flex items-center gap-2 cursor-pointer">
										<X className="h-3.5 w-3.5" />
										Cancel
									</button>
								</div>
							</motion.div>
						)}
					</>
				)}
			</AnimatePresence>

			{sharedCollectionId && (
				<SharedCollectionView
					collectionId={sharedCollectionId}
					onClose={() => setSharedCollectionId(null)}
					onPostClick={onPostClick}
					onUserClick={onUserClick}
				/>
			)}
		</div>
	);
}

// useClickOutside hook added; close panel when clicking outside bounds

// react-window for notifications list; only renders visible items

// raise z-index to 50 to sit above image modals at z-40

// clamp timestamp to Date.now() if server sends a future value

// trigger bell shake animation via CSS class toggle on unreadCount change

// sticky top-0 z-40 on notification panel header

// check document.hasFocus() before playing notification audio

// check document.hasFocus before playing notification audio
