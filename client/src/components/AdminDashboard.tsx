import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
	Shield,
	Flag,
	ToggleLeft,
	ToggleRight,
	CheckCircle,
	X,
	Loader2,
	Search,
	Users,
	FileText,
	MessageSquare,
	Image,
	Hash,
	AlertTriangle,
	Clock,
	Activity,
	Ban,
	VolumeX,
	Mail,
	Crown,
	Trash2,
	Star,
	Pen,
	BadgeCheck,
	ChevronLeft,
	ChevronRight,
	LayoutDashboard,
	Eye,
	Megaphone,
	Server,
	Gauge,
	Wifi,
	Database,
	Zap,
	Bot as BotIcon,
	Play,
	Square,
} from "lucide-react";
import { apiFetch } from "../utils/api";
import { useCacheRefresh } from "../hooks/useCacheRefresh";
import { logger } from "../utils/logger";

// Stable RegExp for matching admin reports cache refresh events
// — module-level to prevent React effect re-attachment on every render.
const MATCHER_REPORTS = /\/api\/reports/;
import GlassCard from "./GlassCard";
import UserAvatar from "./UserAvatar";
import AdminUserDetail from "./AdminUserDetail";

interface Report {
	_id: string;
	reporter: { _id: string; username: string; fullName: string; profilePic?: { url: string } };
	contentType: string;
	contentId: string;
	reason: string;
	description: string;
	status: string;
	action?: string;
	createdAt: string;
}

interface FeatureFlag {
	_id: string;
	key: string;
	description: string;
	enabled: boolean;
	percentage: number;
	adminOverride: boolean;
	createdAt: string;
}

type Tab =
	| "stats"
	| "users"
	| "reports"
	| "posts"
	| "comments"
	| "glances"
	| "communities"
	| "flags"
	| "waitlist"
	| "system"
	| "audit"
	| "bots";

type AdminStats = {
	totalUsers: number;
	totalPosts: number;
	totalComments: number;
	totalGlances: number;
	totalCommunities: number;
	pendingReports: number;
	pendingModeration: number;
	activeUsers: number;
	mutedUsers: number;
	bannedUsers: number;
};

interface AdminUser {
	_id: string;
	username: string;
	fullName: string;
	email: string;
	bio?: string;
	profilePic?: { url: string };
	isVerified?: boolean;
	isMuted?: boolean;
	isBanned?: boolean;
	isAdmin?: boolean;
	isPrivate?: boolean;
	waitlistPerk?: boolean;
	followersCount?: number;
	followingCount?: number;
	postsCount?: number;
	createdAt?: string;
	updatedAt?: string;
}

interface AdminPost {
	_id: string;
	title?: string;
	content?: string;
	hashtags?: string[];
	image?: { url?: string };
	video?: { url?: string };
	images?: { url?: string }[];
	likesCount?: number;
	commentsCount?: number;
	repostsCount?: number;
	savesCount?: number;
	status?: string;
	slug?: string;
	createdAt?: string;
	author?: { _id: string; username: string; fullName: string; profilePic?: { url: string } };
}

interface AdminComment {
	_id: string;
	content: string;
	likesCount?: number;
	repliesCount?: number;
	createdAt?: string;
	author?: { _id: string; username: string; fullName: string; profilePic?: { url: string } };
	post?: { _id: string; slug?: string; title?: string } | null;
}

interface AdminGlimpse {
	_id: string;
	media?: { url?: string };
	mediaType?: string;
	expiresAt?: string;
	createdAt?: string;
	author?: { _id: string; username: string; fullName: string; profilePic?: { url: string } };
}

interface AdminCommunity {
	_id: string;
	name: string;
	description?: string;
	members?: unknown[];
	createdAt?: string;
	creator?: { _id: string; username: string; fullName: string; profilePic?: { url: string } };
}

// Small pagination bar shared by every list tab
function Pager({
	page,
	pages,
	onPage,
}: {
	page: number;
	pages: number;
	onPage: (p: number) => void;
}) {
	return (
		<div className="flex items-center justify-center gap-3 pt-3">
			<button
				type="button"
				disabled={page <= 1}
				onClick={() => onPage(page - 1)}
				className="flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[10px] font-bold text-zinc-400 transition-colors hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
			>
				<ChevronLeft className="h-3 w-3" /> Prev
			</button>
			<span className="text-[10px] font-semibold text-zinc-500">
				Page {page} of {pages}
			</span>
			<button
				type="button"
				disabled={page >= pages}
				onClick={() => onPage(page + 1)}
				className="flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[10px] font-bold text-zinc-400 transition-colors hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
			>
				Next <ChevronRight className="h-3 w-3" />
			</button>
		</div>
	);
}

// Tiny labelled action chip for the user management rows
function UserFlagChip({
	label,
	active,
	activeClass,
	inactiveClass,
	onClick,
	busy,
	title,
}: {
	label: string;
	active: boolean;
	activeClass: string;
	inactiveClass: string;
	onClick: () => void;
	busy?: boolean;
	title: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={busy}
			title={title}
			className={`flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-bold transition-all cursor-pointer border ${
				active ? activeClass : inactiveClass
			}`}
		>
			{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
			{label}
		</button>
	);
}

export default function AdminDashboard() {
	const [activeTab, setActiveTab] = useState<Tab>("stats");
	const [reports, setReports] = useState<Report[]>([]);
	const [flags, setFlags] = useState<FeatureFlag[]>([]);
	const [stats, setStats] = useState<AdminStats | null>(null);
	const [loadingReports, setLoadingReports] = useState(false);
	const [loadingFlags, setLoadingFlags] = useState(false);
	const [loadingStats, setLoadingStats] = useState(false);
	const [reviewingId, setReviewingId] = useState<string | null>(null);
	const [mutatingId, setMutatingId] = useState<string | null>(null);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [inspectUserId, setInspectUserId] = useState<string | null>(null);
	const [waitlistEntries, setWaitlistEntries] = useState<any[]>([]);
	const [waitlistLoading, setWaitlistLoading] = useState(false);

	// ── Users tab state ──
	const [users, setUsers] = useState<AdminUser[]>([]);
	const [usersLoading, setUsersLoading] = useState(false);
	const [usersSearch, setUsersSearch] = useState("");
	const [usersPage, setUsersPage] = useState(1);
	const [usersPages, setUsersPages] = useState(1);
	const [usersTotal, setUsersTotal] = useState(0);
	const usersTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

	// ── Posts / comments / glances / communities tab state ──
	const [posts, setPosts] = useState<AdminPost[]>([]);
	const [postsLoading, setPostsLoading] = useState(false);
	const [postsSearch, setPostsSearch] = useState("");
	const [postsPage, setPostsPage] = useState(1);
	const [postsPages, setPostsPages] = useState(1);
	const postsTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

	const [comments, setComments] = useState<AdminComment[]>([]);
	const [commentsLoading, setCommentsLoading] = useState(false);
	const [commentsPage, setCommentsPage] = useState(1);
	const [commentsPages, setCommentsPages] = useState(1);

	const [glances, setGlances] = useState<AdminGlimpse[]>([]);
	const [glancesLoading, setGlancesLoading] = useState(false);
	const [glancesPage, setGlancesPage] = useState(1);
	const [glancesPages, setGlancesPages] = useState(1);

	const [communities, setCommunities] = useState<AdminCommunity[]>([]);
	const [communitiesLoading, setCommunitiesLoading] = useState(false);
	const [communitiesPage, setCommunitiesPage] = useState(1);
	const [communitiesPages, setCommunitiesPages] = useState(1);

	// ── System tab (monitoring + broadcasts) ──
	const [monitoring, setMonitoring] = useState<any>(null);
	const [monitoringLoading, setMonitoringLoading] = useState(false);
	const [broadcasts, setBroadcasts] = useState<any[]>([]);
	const [bcTitle, setBcTitle] = useState("");
	const [bcMessage, setBcMessage] = useState("");
	const [bcType, setBcType] = useState<"banner" | "notice">("banner");
	const [bcSending, setBcSending] = useState(false);
	const [bcMsg, setBcMsg] = useState("");

	// ── Kill switches (Controls) ──
	const [switches, setSwitches] = useState<any[]>([]);
	const [switchesLoading, setSwitchesLoading] = useState(false);
	const [switchBusy, setSwitchBusy] = useState<string | null>(null);

	// ── Inline content editing (posts/comments) ──
	const [editingPostId, setEditingPostId] = useState<string | null>(null);
	const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
	const [editText, setEditText] = useState("");

	// ── Audit log ──
	const [auditLogs, setAuditLogs] = useState<any[]>([]);
	const [auditLoading, setAuditLoading] = useState(false);
	const [auditPage, setAuditPage] = useState(1);
	const [auditPages, setAuditPages] = useState(1);
	const [auditTotal, setAuditTotal] = useState(0);

	// ── Bots tab (simulated users) ──
	const [botStatus, setBotStatus] = useState<any>(null);
	const [bots, setBots] = useState<any[]>([]);
	const [botsLoading, setBotsLoading] = useState(false);
	const [botsPage, setBotsPage] = useState(1);
	const [botsPages, setBotsPages] = useState(1);
	const [seedCount, setSeedCount] = useState(10);
	const [botsBusy, setBotsBusy] = useState<string | null>(null);

	const fetchReports = useCallback(async (status = "pending") => {
		setLoadingReports(true);
		try {
			const res = await apiFetch(`/api/reports?status=${status}&limit=20`);
			const data = await res.json();
			if (res.ok && data.success) {
				setReports(data.reports || []);
			}
		} catch (err) {
			logger.error("Failed to fetch reports", err);
		} finally {
			setLoadingReports(false);
		}
	}, []);

	const fetchFlags = useCallback(async () => {
		setLoadingFlags(true);
		try {
			const res = await apiFetch("/api/admin/flags");
			const data = await res.json();
			if (res.ok && data.success) {
				setFlags(data.flags || []);
			}
		} catch (err) {
			logger.error("Failed to fetch feature flags", err);
		} finally {
			setLoadingFlags(false);
		}
	}, []);

	const fetchStats = useCallback(async () => {
		setLoadingStats(true);
		try {
			const res = await apiFetch("/api/admin/stats");
			const data = await res.json();
			if (res.ok && data.success) {
				setStats(data.stats || null);
			}
		} catch (err) {
			logger.error("Failed to fetch admin stats", err);
		} finally {
			setLoadingStats(false);
		}
	}, []);

	const fetchWaitlist = useCallback(async () => {
		setWaitlistLoading(true);
		try {
			const res = await apiFetch(`/api/waitlist?limit=100`);
			const data = await res.json();
			if (res.ok && data.success) {
				setWaitlistEntries(data.entries || []);
			}
		} catch (err) {
			logger.error("Failed to load waitlist", err);
		} finally {
			setWaitlistLoading(false);
		}
	}, []);

	// ── Users tab ──
	const fetchUsers = useCallback(async (page = 1, q = "") => {
		setUsersLoading(true);
		try {
			const query = new URLSearchParams({ page: String(page), limit: "20" });
			if (q.trim()) query.set("q", q.trim());
			const res = await apiFetch(`/api/admin/users?${query.toString()}`);
			const data = await res.json();
			if (res.ok && data.success) {
				setUsers(data.users || []);
				setUsersTotal(data.total || 0);
				setUsersPages(data.pages || 1);
			}
		} catch (err) {
			logger.error("Failed to fetch admin users", err);
		} finally {
			setUsersLoading(false);
		}
	}, []);

	useEffect(() => {
		if (activeTab !== "users") return;
		if (usersTimerRef.current) clearTimeout(usersTimerRef.current);
		usersTimerRef.current = setTimeout(() => {
			setUsersPage(1);
			void fetchUsers(1, usersSearch);
		}, 350);
		return () => {
			if (usersTimerRef.current) clearTimeout(usersTimerRef.current);
		};
	}, [usersSearch, activeTab, fetchUsers]);

	useEffect(() => {
		if (activeTab === "users") void fetchUsers(usersPage, usersSearch);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activeTab, usersPage]);

	// ── Posts tab ──
	const fetchPosts = useCallback(async (page = 1, q = "") => {
		setPostsLoading(true);
		try {
			const query = new URLSearchParams({ page: String(page), limit: "20" });
			if (q.trim()) query.set("q", q.trim());
			const res = await apiFetch(`/api/admin/posts?${query.toString()}`);
			const data = await res.json();
			if (res.ok && data.success) {
				setPosts(data.posts || []);
				setPostsPages(data.pages || 1);
			}
		} catch (err) {
			logger.error("Failed to fetch admin posts", err);
		} finally {
			setPostsLoading(false);
		}
	}, []);

	useEffect(() => {
		if (activeTab !== "posts") return;
		if (postsTimerRef.current) clearTimeout(postsTimerRef.current);
		postsTimerRef.current = setTimeout(() => {
			setPostsPage(1);
			void fetchPosts(1, postsSearch);
		}, 350);
		return () => {
			if (postsTimerRef.current) clearTimeout(postsTimerRef.current);
		};
	}, [postsSearch, activeTab, fetchPosts]);

	useEffect(() => {
		if (activeTab === "posts") void fetchPosts(postsPage, postsSearch);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activeTab, postsPage]);

	// ── Comments / glances / communities tabs ──
	const fetchComments = useCallback(async (page = 1) => {
		setCommentsLoading(true);
		try {
			const res = await apiFetch(`/api/admin/comments?page=${page}&limit=20`);
			const data = await res.json();
			if (res.ok && data.success) {
				setComments(data.comments || []);
				setCommentsPages(data.pages || 1);
			}
		} catch (err) {
			logger.error("Failed to fetch admin comments", err);
		} finally {
			setCommentsLoading(false);
		}
	}, []);

	const fetchGlances = useCallback(async (page = 1) => {
		setGlancesLoading(true);
		try {
			const res = await apiFetch(`/api/admin/glances?page=${page}&limit=20`);
			const data = await res.json();
			if (res.ok && data.success) {
				setGlances(data.glances || []);
				setGlancesPages(data.pages || 1);
			}
		} catch (err) {
			logger.error("Failed to fetch admin glances", err);
		} finally {
			setGlancesLoading(false);
		}
	}, []);

	const fetchCommunities = useCallback(async (page = 1) => {
		setCommunitiesLoading(true);
		try {
			const res = await apiFetch(`/api/admin/communities?page=${page}&limit=20`);
			const data = await res.json();
			if (res.ok && data.success) {
				setCommunities(data.communities || []);
				setCommunitiesPages(data.pages || 1);
			}
		} catch (err) {
			logger.error("Failed to fetch admin communities", err);
		} finally {
			setCommunitiesLoading(false);
		}
	}, []);

	const fetchMonitoring = useCallback(async () => {
		setMonitoringLoading(true);
		try {
			const res = await apiFetch(`/api/admin/monitoring`);
			const data = await res.json();
			if (res.ok && data.success) setMonitoring(data.monitoring);
		} catch (err) {
			logger.error("Failed to fetch monitoring", err);
		} finally {
			setMonitoringLoading(false);
		}
	}, []);

	const fetchBroadcasts = useCallback(async () => {
		try {
			const res = await apiFetch(`/api/admin/broadcasts`);
			const data = await res.json();
			if (res.ok && data.success) setBroadcasts(data.broadcasts || []);
		} catch (err) {
			logger.error("Failed to fetch broadcasts", err);
		}
	}, []);

	useEffect(() => {
		if (activeTab === "reports") fetchReports();
		if (activeTab === "flags") fetchFlags();
		if (activeTab === "stats") fetchStats();
		if (activeTab === "waitlist") fetchWaitlist();
		if (activeTab === "comments") fetchComments(commentsPage);
		if (activeTab === "glances") fetchGlances(glancesPage);
		if (activeTab === "communities") fetchCommunities(communitiesPage);
		if (activeTab === "system") {
			fetchMonitoring();
			fetchBroadcasts();
		}
		if (activeTab === "flags") fetchKillSwitches();
		if (activeTab === "audit") fetchAudit(auditPage);
		if (activeTab === "bots") {
			fetchBotStatus();
			fetchBots(botsPage);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activeTab, commentsPage, glancesPage, communitiesPage, auditPage, botsPage, fetchReports, fetchFlags, fetchStats]);

	useCacheRefresh(MATCHER_REPORTS, () => fetchReports());
	useCacheRefresh("/api/admin/flags", () => fetchFlags());
	useCacheRefresh("/api/admin/stats", () => fetchStats());

	// ── User actions (full control) ──
	const patchUser = useCallback(async (userId: string, patch: Record<string, unknown>) => {
		setMutatingId(userId);
		try {
			const res = await apiFetch(`/api/admin/users/${userId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(patch),
			});
			const data = await res.json();
			if (res.ok && data.success) {
				setUsers((prev) =>
					prev.map((u) => (u._id === userId ? { ...u, ...patch } : u)),
				);
				return true;
			}
			logger.error("Failed to update user", data?.message);
			return false;
		} catch (err) {
			logger.error("Failed to update user", err);
			return false;
		} finally {
			setMutatingId(null);
		}
	}, []);

	const handleDeleteUser = async (u: AdminUser) => {
		if (!window.confirm(`Permanently delete @${u.username} (${u.email})? This wipes all their posts, comments, chats and data.`)) return;
		setDeletingId(u._id);
		try {
			const res = await apiFetch(`/api/admin/users/${u._id}`, { method: "DELETE" });
			const data = await res.json();
			if (res.ok && data.success) {
				setUsers((prev) => prev.filter((x) => x._id !== u._id));
			} else {
				window.alert(data?.message || "Failed to delete user.");
			}
		} catch (err) {
			logger.error("Failed to delete user", err);
		} finally {
			setDeletingId(null);
		}
	};

	// ── Content actions ──
	const handleDeletePost = async (p: AdminPost) => {
		const preview = (p.content || p.title || "").slice(0, 60);
		if (!window.confirm(`Delete post "${preview}"?`)) return;
		setDeletingId(p._id);
		try {
			const res = await apiFetch(`/api/admin/posts/${p._id}`, { method: "DELETE" });
			const data = await res.json();
			if (res.ok && data.success) {
				setPosts((prev) => prev.filter((x) => x._id !== p._id));
			} else {
				window.alert(data?.message || "Failed to delete post.");
			}
		} catch (err) {
			logger.error("Failed to delete post", err);
		} finally {
			setDeletingId(null);
		}
	};

	const handleDeleteComment = async (c: AdminComment) => {
		if (!window.confirm(`Delete comment "${(c.content || "").slice(0, 60)}"?`)) return;
		setDeletingId(c._id);
		try {
			const res = await apiFetch(`/api/admin/comments/${c._id}`, { method: "DELETE" });
			const data = await res.json();
			if (res.ok && data.success) {
				setComments((prev) => prev.filter((x) => x._id !== c._id));
			} else {
				window.alert(data?.message || "Failed to delete comment.");
			}
		} catch (err) {
			logger.error("Failed to delete comment", err);
		} finally {
			setDeletingId(null);
		}
	};

	const handleDeleteGlimpse = async (g: AdminGlimpse) => {
		if (!window.confirm("Delete this 24h glance?")) return;
		setDeletingId(g._id);
		try {
			const res = await apiFetch(`/api/admin/glances/${g._id}`, { method: "DELETE" });
			const data = await res.json();
			if (res.ok && data.success) {
				setGlances((prev) => prev.filter((x) => x._id !== g._id));
			} else {
				window.alert(data?.message || "Failed to delete glance.");
			}
		} catch (err) {
			logger.error("Failed to delete glance", err);
		} finally {
			setDeletingId(null);
		}
	};

	const handleDeleteCommunity = async (c: AdminCommunity) => {
		if (!window.confirm(`Delete community "${c.name}" and all its messages?`)) return;
		setDeletingId(c._id);
		try {
			const res = await apiFetch(`/api/admin/communities/${c._id}`, { method: "DELETE" });
			const data = await res.json();
			if (res.ok && data.success) {
				setCommunities((prev) => prev.filter((x) => x._id !== c._id));
			} else {
				window.alert(data?.message || "Failed to delete community.");
			}
		} catch (err) {
			logger.error("Failed to delete community", err);
		} finally {
			setDeletingId(null);
		}
	};

	const handleSendBroadcast = async () => {
		if (!bcTitle.trim() || !bcMessage.trim()) {
			setBcMsg("Title and message are required.");
			return;
		}
		setBcSending(true);
		setBcMsg("");
		try {
			const res = await apiFetch(`/api/admin/broadcasts`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: bcTitle, message: bcMessage, type: bcType }),
			});
			const data = await res.json();
			if (res.ok && data.success) {
				setBcMsg("Broadcast sent to every user!");
				setBcTitle("");
				setBcMessage("");
				fetchBroadcasts();
			} else {
				setBcMsg(data.message || "Failed to send broadcast.");
			}
		} catch (err) {
			logger.error("Failed to send broadcast", err);
			setBcMsg("Failed to send broadcast.");
		} finally {
			setBcSending(false);
		}
	};

	const handleDeleteBroadcast = async (id: string) => {
		if (!window.confirm("Remove this broadcast?")) return;
		try {
			await apiFetch(`/api/admin/broadcasts/${id}`, { method: "DELETE" });
			setBroadcasts((prev) => prev.filter((b) => b._id !== id));
		} catch (err) {
			logger.error("Failed to delete broadcast", err);
		}
	};

	// ── Kill switches ──
	const fetchKillSwitches = useCallback(async () => {
		setSwitchesLoading(true);
		try {
			const res = await apiFetch(`/api/admin/killswitches`);
			const data = await res.json();
			if (res.ok && data.success) setSwitches(data.switches || []);
		} catch (err) {
			logger.error("Failed to fetch kill switches", err);
		} finally {
			setSwitchesLoading(false);
		}
	}, []);

	const toggleKillSwitch = async (key: string, enabled: boolean) => {
		setSwitchBusy(key);
		try {
			const res = await apiFetch(`/api/admin/killswitches`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ key, enabled: !enabled }),
			});
			const data = await res.json();
			if (res.ok && data.success) {
				setSwitches((prev) => prev.map((s) => (s.key === key ? { ...s, enabled: !enabled } : s)));
			} else {
				window.alert(data.message || "Failed to toggle.");
			}
		} catch (err) {
			logger.error("Failed to toggle kill switch", err);
		} finally {
			setSwitchBusy(null);
		}
	};

	// ── Inline content editing ──
	const saveEditPost = async () => {
		if (!editingPostId) return;
		try {
			const res = await apiFetch(`/api/admin/posts/${editingPostId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ content: editText }),
			});
			if (res.ok) {
				setPosts((prev) => prev.map((p) => (p._id === editingPostId ? { ...p, content: editText } : p)));
				setEditingPostId(null);
			}
		} catch (err) {
			logger.error("Failed to edit post", err);
		} finally {
			setEditingPostId(null);
		}
	};

	const saveEditComment = async () => {
		if (!editingCommentId) return;
		try {
			const res = await apiFetch(`/api/admin/comments/${editingCommentId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ content: editText }),
			});
			if (res.ok) {
				setComments((prev) => prev.map((c) => (c._id === editingCommentId ? { ...c, content: editText } : c)));
				setEditingCommentId(null);
			}
		} catch (err) {
			logger.error("Failed to edit comment", err);
		} finally {
			setEditingCommentId(null);
		}
	};

	// ── Audit log ──
	const fetchAudit = useCallback(async (page = 1) => {
		setAuditLoading(true);
		try {
			const res = await apiFetch(`/api/admin/audit?page=${page}&limit=20`);
			const data = await res.json();
			if (res.ok && data.success) {
				setAuditLogs(data.logs || []);
				setAuditTotal(data.total || 0);
				setAuditPages(data.pages || 1);
			}
		} catch (err) {
			logger.error("Failed to fetch audit log", err);
		} finally {
			setAuditLoading(false);
		}
	}, []);

	// ── Bots tab ──
	const fetchBotStatus = useCallback(async () => {
		try {
			const res = await apiFetch(`/api/admin/bots/status`);
			const data = await res.json();
			if (res.ok && data.success) setBotStatus(data);
		} catch (err) {
			logger.error("Failed to fetch bot status", err);
		}
	}, []);

	const fetchBots = useCallback(async (page = 1) => {
		setBotsLoading(true);
		try {
			const res = await apiFetch(`/api/admin/bots?page=${page}&limit=20`);
			const data = await res.json();
			if (res.ok && data.success) {
				setBots(data.bots || []);
				setBotsPages(data.pages || 1);
			}
		} catch (err) {
			logger.error("Failed to fetch bots", err);
		} finally {
			setBotsLoading(false);
		}
	}, []);

	const handleSeedBots = async () => {
		setBotsBusy("seed");
		try {
			const res = await apiFetch(`/api/admin/bots/seed`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ count: seedCount }),
			});
			const data = await res.json();
			if (res.ok && data.success) {
				window.alert(data.message || "Bots created");
			} else {
				window.alert(data?.message || "Failed to seed bots.");
			}
		} catch (err) {
			logger.error("Failed to seed bots", err);
		} finally {
			setBotsBusy(null);
			fetchBots(botsPage);
			fetchBotStatus();
		}
	};

	const handleStartBots = async () => {
		setBotsBusy("start");
		try {
			const res = await apiFetch(`/api/admin/bots/start`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ intensity: botStatus?.intensity || 5 }),
			});
			const data = await res.json();
			if (res.ok && data.success) setBotStatus(data);
			else window.alert(data?.message || "Failed to start bots.");
		} catch (err) {
			logger.error("Failed to start bots", err);
		} finally {
			setBotsBusy(null);
		}
	};

	const handleStopBots = async () => {
		setBotsBusy("stop");
		try {
			const res = await apiFetch(`/api/admin/bots/stop`, { method: "POST" });
			const data = await res.json();
			if (res.ok && data.success) setBotStatus(data);
			else window.alert(data?.message || "Failed to stop bots.");
		} catch (err) {
			logger.error("Failed to stop bots", err);
		} finally {
			setBotsBusy(null);
		}
	};

	const handleSetIntensity = async (v: number) => {
		setBotStatus((prev: any) => (prev ? { ...prev, intensity: v } : prev));
		try {
			const res = await apiFetch(`/api/admin/bots/config`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ intensity: v }),
			});
			const data = await res.json();
			if (res.ok && data.success) setBotStatus(data);
		} catch (err) {
			logger.error("Failed to set bot intensity", err);
		}
	};

	const handleDeleteBot = async (b: any) => {
		if (!window.confirm(`Delete bot @${b.username} (${b.name}) and all their content?`)) return;
		setBotsBusy(b.botId);
		try {
			const res = await apiFetch(`/api/admin/bots/${encodeURIComponent(b.botId)}`, { method: "DELETE" });
			const data = await res.json();
			if (res.ok && data.success) {
				setBots((prev) => prev.filter((x) => x.botId !== b.botId));
			} else {
				window.alert(data?.message || "Failed to delete bot.");
			}
		} catch (err) {
			logger.error("Failed to delete bot", err);
		} finally {
			setBotsBusy(null);
			fetchBotStatus();
		}
	};

	const handleReviewReport = async (reportId: string, status: string) => {
		setReviewingId(reportId);
		try {
			const res = await apiFetch(`/api/reports/${reportId}/review`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					status,
					action: status === "action_taken" ? "warning" : "none",
				}),
			});
			const data = await res.json();
			if (res.ok && data.success) {
				setReports((prev) => prev.filter((r) => r._id !== reportId));
			}
		} catch (err) {
			logger.error("Failed to review report", err);
		} finally {
			setReviewingId(null);
		}
	};

	const handleToggleFlag = async (flagId: string, currentEnabled: boolean) => {
		try {
			const res = await apiFetch(`/api/admin/flags/${flagId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: !currentEnabled }),
			});
			const data = await res.json();
			if (res.ok && data.success) {
				setFlags((prev) =>
					prev.map((f) =>
						f._id === flagId ? { ...f, enabled: !currentEnabled } : f,
					),
				);
			}
		} catch (err) {
			logger.error("Failed to toggle flag", err);
		}
	};

	const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
		{ id: "stats", label: "Overview", icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
		{ id: "users", label: "Users", icon: <Users className="h-3.5 w-3.5" /> },
		{ id: "reports", label: "Reports", icon: <Flag className="h-3.5 w-3.5" /> },
		{ id: "posts", label: "Posts", icon: <FileText className="h-3.5 w-3.5" /> },
		{ id: "comments", label: "Comments", icon: <MessageSquare className="h-3.5 w-3.5" /> },
		{ id: "glances", label: "Glances", icon: <Image className="h-3.5 w-3.5" /> },
		{ id: "communities", label: "Communities", icon: <Hash className="h-3.5 w-3.5" /> },
		{ id: "flags", label: "Flags", icon: <ToggleLeft className="h-3.5 w-3.5" /> },
		{ id: "waitlist", label: "Waitlist", icon: <Mail className="h-3.5 w-3.5" /> },
		{ id: "system", label: "System", icon: <Server className="h-3.5 w-3.5" /> },
		{ id: "audit", label: "Audit", icon: <Shield className="h-3.5 w-3.5" /> },
		{ id: "bots", label: "Bots", icon: <BotIcon className="h-3.5 w-3.5" /> },
	];

	return (
		<div className="w-full px-0 pb-24 mt-2 sm:px-4 sm:pb-28 sm:mt-4">
			<div className="mb-6">
				<div className="flex items-center gap-2 mb-1">
					<Shield className="h-5 w-5 text-amber-400" />
					<h2 className="text-display-sm text-zinc-100">Admin Dashboard</h2>
				</div>
				<p className="text-xs text-zinc-500">
					Full control — manage every user, post, comment, glance, community, report and flag.
				</p>
			</div>

			{/* Tab bar — wraps so all options always fit. Flat rounded-lg box
			   (same as the About box in the profile form) with the options
			   centered — no pill curve, no dead space on the right. */}
			<div className="flex flex-wrap justify-center gap-1 mb-6 rounded-lg border border-zinc-800 bg-zinc-900/55 p-1.5">
				{tabs.map((tab) => (
					<button
						key={tab.id}
						type="button"
						onClick={() => setActiveTab(tab.id)}
						className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap ${
							activeTab === tab.id
								? "pill-active"
								: "text-zinc-500 hover:text-zinc-300"
						}`}
					>
						{tab.icon}
						{tab.label}
					</button>
				))}
			</div>

			{activeTab === "stats" && (
				<div className="max-w-4xl">
					<div className="flex items-center justify-between mb-4">
						<h3 className="text-label-sm font-semibold text-zinc-300">Platform Overview</h3>
						<button
							type="button"
							onClick={() => fetchStats()}
							className="text-[10px] font-bold text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
						>
							Refresh
						</button>
					</div>

					{loadingStats && !stats ? (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
						</div>
					) : !stats ? (
						<GlassCard className="p-8 text-center">
							<Activity className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
							<p className="text-sm font-bold text-zinc-500">Stats unavailable</p>
						</GlassCard>
					) : (
						<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
							{[
								{ label: "Total Users", value: stats.totalUsers, icon: <Users className="h-3.5 w-3.5 text-zinc-400" /> },
								{ label: "Total Posts", value: stats.totalPosts, icon: <FileText className="h-3.5 w-3.5 text-zinc-400" /> },
								{ label: "Comments", value: stats.totalComments, icon: <MessageSquare className="h-3.5 w-3.5 text-zinc-400" /> },
								{ label: "Glances", value: stats.totalGlances, icon: <Image className="h-3.5 w-3.5 text-zinc-400" /> },
								{ label: "Communities", value: stats.totalCommunities, icon: <Hash className="h-3.5 w-3.5 text-zinc-400" /> },
								{ label: "Online Now", value: stats.activeUsers, icon: <Activity className="h-3.5 w-3.5 text-emerald-400" /> },
								{ label: "Pending Reports", value: stats.pendingReports, icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> },
								{ label: "Moderation Queue", value: stats.pendingModeration, icon: <Clock className="h-3.5 w-3.5 text-amber-400" /> },
								{ label: "Muted Users", value: stats.mutedUsers, icon: <VolumeX className="h-3.5 w-3.5 text-zinc-400" /> },
								{ label: "Banned Users", value: stats.bannedUsers, icon: <Ban className="h-3.5 w-3.5 text-red-400" /> },
							].map((s) => (
								<div
									key={s.label}
									className="rounded-2xl border border-zinc-800/50 bg-zinc-950/40 p-3.5"
								>
									<div className="flex items-center gap-1.5 mb-1.5">{s.icon}<span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">{s.label}</span></div>
									<p className="text-display-sm text-white">{s.value ?? 0}</p>
								</div>
							))}
						</div>
					)}
				</div>
			)}

			{activeTab === "users" && (
				<div className="max-w-4xl">
					<div className="relative mb-4">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
						<input
							type="text"
							value={usersSearch}
							onChange={(e) => setUsersSearch(e.target.value)}
							placeholder="Search all users by username, email or name…"
							className="w-full rounded-full border border-zinc-800 bg-zinc-900/50 py-2.5 pl-10 pr-4 text-[12px] text-white placeholder-zinc-600 outline-none focus:border-zinc-600 transition-colors"
						/>
					</div>

					<div className="flex items-center justify-between mb-3">
						<h3 className="text-label-sm font-semibold text-zinc-300">
							All Users ({usersTotal})
						</h3>
						<button
							type="button"
							onClick={() => fetchUsers(usersPage, usersSearch)}
							className="text-[10px] font-bold text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
						>
							Refresh
						</button>
					</div>

					{usersLoading ? (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
						</div>
					) : users.length === 0 ? (
						<GlassCard className="p-8 text-center">
							<Users className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
							<p className="text-sm font-bold text-zinc-500">No users found</p>
						</GlassCard>
					) : (
						<div className="space-y-2">
							{users.map((u) => (
								<div
									key={u._id}
									className="rounded-2xl border border-zinc-800/50 bg-zinc-950/40 p-3.5"
								>
									<div className="flex items-start justify-between gap-3">
										<div className="flex items-center gap-3 min-w-0">
											<UserAvatar
												src={u.profilePic?.url}
												alt={u.username || "User"}
												className="h-9 w-9 rounded-full object-cover border border-zinc-800 shrink-0"
											/>
											<div className="min-w-0">
												<div className="flex items-center gap-1.5 flex-wrap">
													<p className="text-[12px] font-bold text-white truncate">@{u.username}</p>
													{u.isAdmin && (
														<span className="flex items-center gap-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-amber-300">
															<Crown className="h-2.5 w-2.5" /> Admin
														</span>
													)}
													{u.isVerified && (
														<span className="flex items-center gap-0.5 rounded-full bg-sky-500/15 border border-sky-500/30 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-sky-300">
															<BadgeCheck className="h-2.5 w-2.5" /> Verified
														</span>
													)}
													{u.waitlistPerk && (
														<span className="flex items-center gap-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-emerald-300">
															<Star className="h-2.5 w-2.5" /> Day One
														</span>
													)}
													{u.isMuted && (
														<span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-amber-300">Muted</span>
													)}
													{u.isBanned && (
														<span className="rounded-full bg-red-500/15 border border-red-500/30 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-red-300">Banned</span>
													)}
												</div>
												<p className="text-[10px] text-zinc-500 truncate">
													{u.fullName || u.email}
												</p>
												<p className="text-[9px] text-zinc-600 truncate">
													{u.email} · joined {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
												</p>
											</div>
										</div>											<div className="flex flex-col items-end gap-1 shrink-0">
												<button
													type="button"
													onClick={() => setInspectUserId(u._id)}
													title="God-mode inspect: full control over this user"
													className="flex items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-[9px] font-bold text-violet-300 transition-colors hover:bg-violet-500/20 cursor-pointer"
												>
													<Eye className="h-3 w-3" />
													Inspect
												</button>
												<button
													type="button"
													onClick={() => handleDeleteUser(u)}
													disabled={deletingId === u._id || mutatingId === u._id}
													title="Delete user permanently"
													className="flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[9px] font-bold text-red-300 transition-colors hover:bg-red-500/20 cursor-pointer"
												>
													{deletingId === u._id ? (
														<Loader2 className="h-3 w-3 animate-spin" />
													) : (
														<Trash2 className="h-3 w-3" />
													)}
													Delete
												</button>
											</div>
									</div>
									<div className="mt-2.5 flex flex-wrap gap-1.5">
										<UserFlagChip
											label="Admin"
											active={!!u.isAdmin}
											activeClass="bg-amber-500/20 border-amber-500/30 text-amber-300 hover:bg-amber-500/30"
											inactiveClass="bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200"
											onClick={() => patchUser(u._id, { isAdmin: !u.isAdmin })}
											busy={mutatingId === u._id}
											title={u.isAdmin ? "Remove admin" : "Make admin"}
										/>
										<UserFlagChip
											label="Verify"
											active={!!u.isVerified}
											activeClass="bg-sky-500/20 border-sky-500/30 text-sky-300 hover:bg-sky-500/30"
											inactiveClass="bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200"
											onClick={() => patchUser(u._id, { isVerified: !u.isVerified })}
											busy={mutatingId === u._id}
											title={u.isVerified ? "Remove verified badge" : "Grant verified badge"}
										/>
										<UserFlagChip
											label="Mute"
											active={!!u.isMuted}
											activeClass="bg-amber-500/20 border-amber-500/30 text-amber-300 hover:bg-amber-500/30"
											inactiveClass="bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200"
											onClick={() => patchUser(u._id, { isMuted: !u.isMuted })}
											busy={mutatingId === u._id}
											title={u.isMuted ? "Unmute user" : "Mute user"}
										/>
										<UserFlagChip
											label="Ban"
											active={!!u.isBanned}
											activeClass="bg-red-500/20 border-red-500/30 text-red-300 hover:bg-red-500/30"
											inactiveClass="bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200"
											onClick={() => patchUser(u._id, { isBanned: !u.isBanned })}
											busy={mutatingId === u._id}
											title={u.isBanned ? "Unban user" : "Ban user"}
										/>
										<UserFlagChip
											label="Day One Perk"
											active={!!u.waitlistPerk}
											activeClass="bg-emerald-500/20 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30"
											inactiveClass="bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200"
											onClick={() => patchUser(u._id, { waitlistPerk: !u.waitlistPerk })}
											busy={mutatingId === u._id}
											title={u.waitlistPerk ? "Revoke Day One perk" : "Grant Day One perk"}
										/>
									</div>
								</div>
							))}
						</div>
					)}
					<Pager page={usersPage} pages={usersPages} onPage={setUsersPage} />
				</div>
			)}

			{activeTab === "reports" && (
				<div className="space-y-3 max-w-4xl">
					<div className="flex items-center justify-between">
						<h3 className="text-label-sm font-semibold text-zinc-300">
							Pending Reports ({reports.length})
						</h3>
						<button
							type="button"
							onClick={() => fetchReports()}
							className="text-[10px] font-bold text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
						>
							Refresh
						</button>
					</div>

					{loadingReports ? (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
						</div>
					) : reports.length === 0 ? (
						<GlassCard className="p-8 text-center">
							<CheckCircle className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
							<p className="text-sm font-bold text-zinc-400">No pending reports</p>
							<p className="text-[11px] text-zinc-600 mt-1">All reports have been reviewed.</p>
						</GlassCard>
					) : (
						<AnimatePresence>
							{reports.map((report) => (
								<motion.div
									key={report._id}
									initial={{ opacity: 0, y: 10 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, x: -20 }}
									className="rounded-2xl border border-zinc-800/50 bg-zinc-950/40 p-4"
								>
									<div className="flex items-start justify-between gap-3">
										<div className="flex items-center gap-2.5 min-w-0">
											<UserAvatar
												src={report.reporter?.profilePic?.url}
												alt={report.reporter?.username || "User"}
												className="h-7 w-7 rounded-full object-cover border border-zinc-800 shrink-0"
											/>
											<div className="min-w-0">
												<p className="text-[12px] font-bold text-white truncate">
													@{report.reporter?.username}
												</p>
												<p className="text-[10px] text-zinc-500">
													Reported {report.contentType} — {report.reason.replace(/_/g, " ")}
												</p>
											</div>
										</div>
										<span className="text-[9px] text-zinc-600 shrink-0">
											{new Date(report.createdAt).toLocaleDateString()}
										</span>
									</div>

									{report.description && (
										<p className="mt-2 text-[11px] text-zinc-400 pl-9.5">
											{report.description}
										</p>
									)}

									<div className="mt-3 flex gap-2 pl-9.5">
										<button
											type="button"
											onClick={() => handleReviewReport(report._id, "action_taken")}
											disabled={reviewingId === report._id}
											className="rounded-full bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 px-3 py-1.5 text-[10px] font-bold text-emerald-300 transition-all cursor-pointer flex items-center gap-1"
										>
											{reviewingId === report._id ? (
												<Loader2 className="h-3 w-3 animate-spin" />
											) : (
												<><CheckCircle className="h-3 w-3" /> Approve</>
											)}
										</button>
										<button
											type="button"
											onClick={() => handleReviewReport(report._id, "dismissed")}
											disabled={reviewingId === report._id}
											className="rounded-full bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 text-[10px] font-bold text-zinc-400 transition-all cursor-pointer flex items-center gap-1"
										>
											<X className="h-3 w-3" /> Dismiss
										</button>
									</div>
								</motion.div>
							))}
						</AnimatePresence>
					)}
				</div>
			)}

			{activeTab === "posts" && (
				<div className="max-w-4xl">
					<div className="relative mb-4">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
						<input
							type="text"
							value={postsSearch}
							onChange={(e) => setPostsSearch(e.target.value)}
							placeholder="Search posts by title or content…"
							className="w-full rounded-full border border-zinc-800 bg-zinc-900/50 py-2.5 pl-10 pr-4 text-[12px] text-white placeholder-zinc-600 outline-none focus:border-zinc-600 transition-colors"
						/>
					</div>

					{postsLoading ? (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
						</div>
					) : posts.length === 0 ? (
						<GlassCard className="p-8 text-center">
							<FileText className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
							<p className="text-sm font-bold text-zinc-500">No posts found</p>
						</GlassCard>
					) : (
						<div className="space-y-2">
							{posts.map((p) => (
								<div
									key={p._id}
									className="rounded-2xl border border-zinc-800/50 bg-zinc-950/40 p-3.5 flex items-start justify-between gap-3"
								>
									<div className="min-w-0">
										<div className="flex items-center gap-1.5 flex-wrap mb-1">
											<p className="text-[11px] font-bold text-zinc-300">
												@{p.author?.username || "unknown"}
											</p>
											{p.image || p.video || (p.images?.length ?? 0) > 0 ? (
												<span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-zinc-400">📎 media</span>
											) : null}
											<span className="text-[9px] text-zinc-600">
												{p.createdAt ? new Date(p.createdAt).toLocaleDateString() : ""}
											</span>
										</div>
										{editingPostId === p._id ? (
											<div className="flex items-center gap-2">
												<textarea
													value={editText}
													onChange={(e) => setEditText(e.target.value)}
													rows={2}
													className="w-full rounded-lg border border-zinc-700 bg-zinc-900/60 px-2.5 py-1.5 text-[11px] text-white outline-none focus:border-zinc-500 resize-none"
												/>
												<button
													type="button"
													onClick={saveEditPost}
													className="shrink-0 rounded-full bg-white px-3 py-1 text-[9px] font-black text-black cursor-pointer"
												>
													Save
												</button>
												<button
													type="button"
													onClick={() => setEditingPostId(null)}
													className="shrink-0 rounded-full border border-zinc-700 px-3 py-1 text-[9px] font-bold text-zinc-400 cursor-pointer"
												>
													Cancel
												</button>
											</div>
										) : (
											<p className="text-[12px] text-white line-clamp-2">
												{(p.content || p.title || "(no text)").slice(0, 220)}
											</p>
										)}
										{(p.hashtags?.length ?? 0) > 0 && (
											<p className="text-[10px] text-sky-400/80 mt-1 truncate">
												{p.hashtags?.map((h) => `#${h}`).join(" ")}
											</p>
										)}
										<div className="flex items-center gap-3 mt-1.5 text-[9px] text-zinc-500">
											<span>❤ {p.likesCount ?? 0}</span>
											<span>💬 {p.commentsCount ?? 0}</span>
											<span>🔁 {p.repostsCount ?? 0}</span>
										</div>
									</div>
									<div className="flex flex-col gap-1 shrink-0">
										<button
											type="button"
												onClick={() => { setEditingPostId(p._id); setEditText(p.content || p.title || ""); }}
												title="Edit post content"
												className="shrink-0 flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900/50 px-2.5 py-1 text-[9px] font-bold text-zinc-300 transition-colors hover:text-white cursor-pointer"
											>
												<Pen className="h-3 w-3" /> Edit
											</button>
											<button
												type="button"
												onClick={() => handleDeletePost(p)}
												disabled={deletingId === p._id}
												title="Delete post"
												className="shrink-0 flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[9px] font-bold text-red-300 transition-colors hover:bg-red-500/20 cursor-pointer"
											>
												{deletingId === p._id ? (
													<Loader2 className="h-3 w-3 animate-spin" />
												) : (
													<Trash2 className="h-3 w-3" />
												)}
												Delete
									</button>
									</div>
								</div>
							))}
						</div>
					)}
					<Pager page={postsPage} pages={postsPages} onPage={setPostsPage} />
				</div>
			)}

			{activeTab === "comments" && (
				<div className="max-w-4xl">
					{commentsLoading ? (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
						</div>
					) : comments.length === 0 ? (
						<GlassCard className="p-8 text-center">
							<MessageSquare className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
							<p className="text-sm font-bold text-zinc-500">No comments found</p>
						</GlassCard>
					) : (
						<div className="space-y-2">
							{comments.map((c) => (
								<div
									key={c._id}
									className="rounded-2xl border border-zinc-800/50 bg-zinc-950/40 p-3.5 flex items-start justify-between gap-3"
								>
									<div className="min-w-0">
										<div className="flex items-center gap-1.5 flex-wrap mb-1">
											<p className="text-[11px] font-bold text-zinc-300">
												@{c.author?.username || "unknown"}
											</p>
											<span className="text-[9px] text-zinc-600">
												{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ""}
											</span>
										</div>
										{editingCommentId === c._id ? (
											<div className="flex items-center gap-2">
												<textarea
													value={editText}
													onChange={(e) => setEditText(e.target.value)}
													rows={2}
													className="w-full rounded-lg border border-zinc-700 bg-zinc-900/60 px-2.5 py-1.5 text-[11px] text-white outline-none focus:border-zinc-500 resize-none"
												/>
												<button
													type="button"
													onClick={saveEditComment}
													className="shrink-0 rounded-full bg-white px-3 py-1 text-[9px] font-black text-black cursor-pointer"
												>
													Save
												</button>
												<button
													type="button"
													onClick={() => setEditingCommentId(null)}
													className="shrink-0 rounded-full border border-zinc-700 px-3 py-1 text-[9px] font-bold text-zinc-400 cursor-pointer"
												>
													Cancel
												</button>
											</div>
										) : (
											<p className="text-[12px] text-white line-clamp-2">
												{(c.content || "").slice(0, 220)}
											</p>
										)}
										<p className="text-[9px] text-zinc-600 mt-1 truncate">
											on {c.post?.slug || c.post?._id || "post"}
										</p>
									</div>
									<div className="flex flex-col gap-1 shrink-0">
										<button
											type="button"
												onClick={() => { setEditingCommentId(c._id); setEditText(c.content || ""); }}
												title="Edit comment content"
												className="shrink-0 flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900/50 px-2.5 py-1 text-[9px] font-bold text-zinc-300 transition-colors hover:text-white cursor-pointer"
											>
												<Pen className="h-3 w-3" /> Edit
											</button>
											<button
												type="button"
												onClick={() => handleDeleteComment(c)}
												disabled={deletingId === c._id}
												title="Delete comment"
												className="shrink-0 flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[9px] font-bold text-red-300 transition-colors hover:bg-red-500/20 cursor-pointer"
											>
												{deletingId === c._id ? (
													<Loader2 className="h-3 w-3 animate-spin" />
												) : (
													<Trash2 className="h-3 w-3" />
												)}														Delete
									</button>
									</div>
								</div>
							))}
						</div>
					)}
					<Pager page={commentsPage} pages={commentsPages} onPage={setCommentsPage} />
				</div>
			)}

			{activeTab === "glances" && (
				<div className="max-w-4xl">
					{glancesLoading ? (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
						</div>
					) : glances.length === 0 ? (
						<GlassCard className="p-8 text-center">
							<Image className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
							<p className="text-sm font-bold text-zinc-500">No glances found</p>
						</GlassCard>
					) : (
						<div className="space-y-2">
							{glances.map((g) => (
								<div
									key={g._id}
									className="rounded-2xl border border-zinc-800/50 bg-zinc-950/40 p-3.5 flex items-start justify-between gap-3"
								>
									<div className="min-w-0">
										<div className="flex items-center gap-1.5 flex-wrap mb-1">
											<p className="text-[11px] font-bold text-zinc-300">
												@{g.author?.username || "unknown"}
											</p>
											<span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-zinc-400">
												{g.mediaType === "video" ? "🎬 video" : "📸 image"}
											</span>
											<span className="text-[9px] text-zinc-600">
												{g.createdAt ? new Date(g.createdAt).toLocaleDateString() : ""}
											</span>
										</div>
										<p className="text-[9px] text-zinc-600">
											Expires {g.expiresAt ? new Date(g.expiresAt).toLocaleString() : "—"}
										</p>
									</div>
									<button
										type="button"
										onClick={() => handleDeleteGlimpse(g)}
										disabled={deletingId === g._id}
										title="Delete glance"
										className="shrink-0 flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[9px] font-bold text-red-300 transition-colors hover:bg-red-500/20 cursor-pointer"
									>
										{deletingId === g._id ? (
											<Loader2 className="h-3 w-3 animate-spin" />
										) : (
											<Trash2 className="h-3 w-3" />
										)}
										Delete
									</button>
								</div>
							))}
						</div>
					)}
					<Pager page={glancesPage} pages={glancesPages} onPage={setGlancesPage} />
				</div>
			)}

			{activeTab === "communities" && (
				<div className="max-w-4xl">
					{communitiesLoading ? (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
						</div>
					) : communities.length === 0 ? (
						<GlassCard className="p-8 text-center">
							<Hash className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
							<p className="text-sm font-bold text-zinc-500">No communities found</p>
						</GlassCard>
					) : (
						<div className="space-y-2">
							{communities.map((c) => (
								<div
									key={c._id}
									className="rounded-2xl border border-zinc-800/50 bg-zinc-950/40 p-3.5 flex items-start justify-between gap-3"
								>
									<div className="min-w-0">
										<div className="flex items-center gap-1.5 flex-wrap mb-1">
											<p className="text-[12px] font-bold text-white truncate">{c.name}</p>
											<span className="text-[9px] text-zinc-600">
												by @{c.creator?.username || "unknown"} · {c.members?.length ?? 0} members
											</span>
										</div>
										{c.description && (
											<p className="text-[11px] text-zinc-400 line-clamp-2">
												{c.description}
											</p>
										)}
									</div>
									<button
										type="button"
										onClick={() => handleDeleteCommunity(c)}
										disabled={deletingId === c._id}
										title="Delete community"
										className="shrink-0 flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[9px] font-bold text-red-300 transition-colors hover:bg-red-500/20 cursor-pointer"
									>
										{deletingId === c._id ? (
											<Loader2 className="h-3 w-3 animate-spin" />
										) : (
											<Trash2 className="h-3 w-3" />
										)}
										Delete
									</button>
								</div>
							))}
						</div>
					)}
					<Pager page={communitiesPage} pages={communitiesPages} onPage={setCommunitiesPage} />
				</div>
			)}

			{activeTab === "flags" && (
				<div className="space-y-4 max-w-3xl">
					{/* Platform Controls — one-click kill switches that actually turn
					    features of the app off for everyone (except admins). */}
					<div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/40 p-4">
						<h3 className="flex items-center gap-1.5 text-label-sm font-semibold text-zinc-300 mb-3">
							<Zap className="h-4 w-4 text-zinc-500" /> Platform controls
							<span className="text-[9px] font-bold uppercase tracking-wider text-zinc-600">— switch whole features off for everyone</span>
						</h3>
						{switchesLoading ? (
							<div className="flex items-center justify-center py-6">
								<Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
							</div>
						) : (
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
								{switches.map((s) => (
									<div
										key={s.key}
										className={`rounded-xl border p-3 transition-colors ${
											s.enabled
												? "border-emerald-500/25 bg-emerald-500/5"
												: "border-red-500/25 bg-red-500/5"
										}`}
									>
										<div className="flex items-center justify-between gap-2">
											<p className="text-[11px] font-bold text-white font-mono truncate">{s.key}</p>
											<button
												type="button"
												onClick={() => toggleKillSwitch(s.key, s.enabled)}
												disabled={switchBusy === s.key}
												className={`shrink-0 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-black transition-all cursor-pointer ${
													s.enabled
														? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30"
														: "bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30"
												}`}
											>
												{switchBusy === s.key ? (
													<Loader2 className="h-3 w-3 animate-spin" />
												) : s.enabled ? (
													<><ToggleRight className="h-3 w-3" /> ON</>
												) : (
													<><ToggleLeft className="h-3 w-3" /> OFF</>
												)}
											</button>
										</div>
										<p className="text-[9px] text-zinc-500 mt-1">{s.description}</p>
									</div>
								))}
							</div>
						)}
					</div>

					<h3 className="text-label-sm font-semibold text-zinc-300">A/B test flags</h3>
					{loadingFlags ? (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
						</div>
					) : flags.length === 0 ? (
						<GlassCard className="p-8 text-center">
							<ToggleLeft className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
							<p className="text-sm font-bold text-zinc-500">No feature flags</p>
							<p className="text-[11px] text-zinc-600 mt-1">
								Create feature flags via the API to start A/B testing.
							</p>
						</GlassCard>
					) : (
						flags.map((flag) => (
							<div
								key={flag._id}
								className="rounded-2xl border border-zinc-800/50 bg-zinc-950/40 p-4 flex items-center justify-between gap-3"
							>
								<div className="min-w-0">
									<p className="text-[12px] font-bold text-white font-mono">{flag.key}</p>
									<p className="text-[10px] text-zinc-500 truncate">{flag.description}</p>
									<p className="text-[9px] text-zinc-600 mt-0.5">
										Rollout: {flag.percentage}% | {flag.adminOverride ? "Admin override" : "User-based"}
									</p>
								</div>
								<button
									type="button"
									onClick={() => handleToggleFlag(flag._id, flag.enabled)}
									className={`shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold transition-all cursor-pointer ${
										flag.enabled
											? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
											: "bg-zinc-800 text-zinc-500 border border-zinc-700"
									}`}
								>
									{flag.enabled ? (
										<><ToggleRight className="h-3.5 w-3.5" /> Enabled</>
									) : (
										<><ToggleLeft className="h-3.5 w-3.5" /> Disabled</>
									)}
								</button>
							</div>
						))
					)}
				</div>
			)}

			{activeTab === "waitlist" && (
				<div className="space-y-3 max-w-4xl">
					{waitlistLoading ? (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
						</div>
					) : waitlistEntries.length === 0 ? (
						<GlassCard className="p-8 text-center">
							<Mail className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
							<p className="text-sm font-bold text-zinc-500">No waitlist members yet</p>
							<p className="text-[11px] text-zinc-600 mt-1">
								The waitlist is empty — share the landing page to grow it.
							</p>
						</GlassCard>
					) : (
						<div className="space-y-1.5">
							{waitlistEntries.map((w) => (
								<div
									key={w._id}
									className="rounded-2xl border border-zinc-800/50 bg-zinc-950/40 p-3 flex items-center justify-between gap-3"
								>
									<div className="min-w-0">
										<p className="text-[12px] font-bold text-white truncate">{w.email}</p>
										<p className="text-[9px] text-zinc-600 mt-0.5">
											Joined {new Date(w.createdAt).toLocaleDateString()}
										</p>
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			)}

			{activeTab === "system" && (
				<div className="space-y-4 max-w-4xl">
					{/* Live monitoring */}
					<div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/40 p-4">
						<div className="flex items-center justify-between mb-3">
							<h3 className="flex items-center gap-1.5 text-label-sm font-semibold text-zinc-300">
								<Gauge className="h-4 w-4 text-zinc-500" /> Live platform monitoring
							</h3>
							<button
								type="button"
								onClick={fetchMonitoring}
								className="text-[10px] font-bold text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
							>
								Refresh
							</button>
						</div>
						{monitoringLoading ? (
							<div className="flex items-center justify-center py-8">
								<Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
							</div>
						) : monitoring ? (
							<div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
								{[
									{ label: "Online now", value: monitoring.onlineUsers, icon: <Wifi className="h-3 w-3" /> },
									{ label: "Socket conns", value: monitoring.totalSockets, icon: <Zap className="h-3 w-3" /> },
									{ label: "Total users", value: monitoring.totalUsers, icon: <Users className="h-3 w-3" /> },
									{ label: "Total posts", value: monitoring.totalPosts, icon: <FileText className="h-3 w-3" /> },
									{ label: "New today", value: monitoring.todayUsers, icon: <Activity className="h-3 w-3" /> },
									{ label: "Posts today", value: monitoring.todayPosts, icon: <FileText className="h-3 w-3" /> },
									{ label: "Pending reports", value: monitoring.pendingReports, icon: <Flag className="h-3 w-3" /> },
									{ label: "Active flags", value: monitoring.activeFlags, icon: <ToggleLeft className="h-3 w-3" /> },
									{ label: "DB", value: monitoring.dbState, icon: <Database className="h-3 w-3" /> },
									{ label: "Uptime", value: `${Math.floor(monitoring.uptimeSeconds / 3600)}h ${Math.floor((monitoring.uptimeSeconds % 3600) / 60)}m`, icon: <Clock className="h-3 w-3" /> },
									{ label: "Memory", value: `${monitoring.memoryMB} MB`, icon: <Server className="h-3 w-3" /> },
									{ label: "Pending mod", value: monitoring.pendingModeration, icon: <AlertTriangle className="h-3 w-3" /> },
								].map((m) => (
									<div key={m.label} className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-2.5 py-2 text-center">
										<p className="flex items-center justify-center gap-1 text-sm font-black text-white">{m.icon}{m.value}</p>
										<p className="text-[8px] font-bold uppercase tracking-wider text-zinc-500">{m.label}</p>
									</div>
								))}
							</div>
						) : (
							<p className="text-[11px] text-zinc-600">Failed to load monitoring.</p>
						)}
					</div>

					{/* Broadcast composer */}
					<div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/40 p-4">
						<h3 className="flex items-center gap-1.5 text-label-sm font-semibold text-zinc-300 mb-3">
							<Megaphone className="h-4 w-4 text-zinc-500" /> Announce to every user
						</h3>
						<div className="space-y-2">
							<div className="flex flex-wrap items-center gap-2">
								<input
									type="text"
									value={bcTitle}
									onChange={(e) => setBcTitle(e.target.value)}
									placeholder="Title (e.g. New feature live!)"
									className="flex-1 min-w-[200px] rounded-full border border-zinc-800 bg-zinc-900/50 px-3.5 py-2 text-[12px] text-white placeholder-zinc-600 outline-none focus:border-zinc-600 transition-colors"
								/>
								<select
									value={bcType}
									onChange={(e) => setBcType(e.target.value as "banner" | "notice")}
									className="rounded-full border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-[11px] font-bold text-zinc-300 outline-none focus:border-zinc-600 cursor-pointer"
								>
									<option value="banner">Top banner</option>
									<option value="notice">Notice</option>
								</select>
							</div>
							<textarea
								value={bcMessage}
								onChange={(e) => setBcMessage(e.target.value)}
								rows={2}
								placeholder="Message to every user — appears instantly via socket to everyone online."
								className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/50 px-3.5 py-2.5 text-[12px] text-white placeholder-zinc-600 outline-none focus:border-zinc-600 transition-colors resize-none"
							/>
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={handleSendBroadcast}
									disabled={bcSending}
									className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[11px] font-black text-black transition-opacity hover:opacity-90 disabled:opacity-40 cursor-pointer"
								>
									{bcSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Megaphone className="h-3.5 w-3.5" />}
									Send to everyone
								</button>
								{bcMsg && <span className={`text-[10px] font-bold ${bcMsg.includes("sent") ? "text-emerald-300" : "text-amber-300"}`}>{bcMsg}</span>}
							</div>
						</div>

						{broadcasts.length > 0 && (
							<div className="mt-4 border-t border-zinc-800/60 pt-3 space-y-1.5">
								<p className="text-[9px] font-black uppercase tracking-wider text-zinc-500">Previous broadcasts</p>
								{broadcasts.map((b) => (
									<div key={b._id} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800/50 bg-zinc-950/40 px-3 py-2">
										<div className="min-w-0">
											<p className="text-[11px] font-bold text-white truncate">{b.title}</p>
											<p className="text-[9px] text-zinc-500 truncate">{b.message}</p>
										</div>
										<button type="button" onClick={() => handleDeleteBroadcast(b._id)} className="text-red-400 hover:text-red-300 cursor-pointer shrink-0">
											<Trash2 className="h-3.5 w-3.5" />
										</button>
									</div>
								))}
							</div>
						)}
					</div>
				</div>
			)}

			{activeTab === "bots" && (
				<div className="max-w-3xl">
					<div className="flex items-center justify-between mb-3">
						<h3 className="flex items-center gap-1.5 text-label-sm font-semibold text-zinc-300">
							<BotIcon className="h-4 w-4 text-zinc-500" /> Simulated Users
						</h3>
						<button
							type="button"
							onClick={() => {
								fetchBotStatus();
								fetchBots(botsPage);
							}}
							className="text-[10px] font-bold text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
						>
							Refresh
						</button>
					</div>

					{/* Status + controls card */}
					<GlassCard className="p-4 mb-4">
						<div className="flex flex-wrap items-center gap-4">
							<span
								className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wider ${
									botStatus?.enabled
										? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
										: "border-zinc-700 bg-zinc-900 text-zinc-500"
								}`}
							>
								<span className={`h-1.5 w-1.5 rounded-full ${botStatus?.enabled ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"}`} />
								{botStatus?.enabled ? "Farm running" : "Farm stopped"}
							</span>
							<span className="text-[11px] font-bold text-zinc-400">
								{botStatus?.botCount ?? 0} bots · intensity {botStatus?.intensity ?? 5}/10
							</span>
							<span
								className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
									botStatus?.aiEnabled
										? "border-violet-500/30 bg-violet-500/10 text-violet-300"
										: "border-zinc-700 bg-zinc-900 text-zinc-500"
								}`}
								title={botStatus?.aiEnabled ? "Gemini brain active — bots hold real conversations" : "Template brain active — add GEMINI_API_KEY on the server for real conversations"}
							>
								{botStatus?.aiEnabled ? "AI brain: ON" : "AI brain: OFF (templates)"}
							</span>
						</div>

						{/* Intensity slider */}
						<div className="mt-4">
							<div className="flex items-center justify-between mb-1.5">
								<label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Activity intensity</label>
								<span className="text-[10px] font-bold text-zinc-300">{botStatus?.intensity ?? 5}/10</span>
							</div>
							<input
								type="range"
								min={1}
								max={10}
								value={botStatus?.intensity ?? 5}
								step={1}
								onChange={(e) => handleSetIntensity(parseInt(e.target.value, 10))}
								className="w-full accent-emerald-400 cursor-pointer"
							/>
						</div>

						{/* Actions */}
						<div className="mt-4 flex flex-wrap items-center gap-2">
							<div className="flex items-center gap-2">
								<input
									type="number"
									min={1}
									max={50}
									value={seedCount}
									onChange={(e) => setSeedCount(parseInt(e.target.value, 10) || 1)}
									className="w-20 rounded-full border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[12px] text-white outline-none focus:border-zinc-600"
								/>
								<button
									type="button"
									onClick={handleSeedBots}
									disabled={botsBusy === "seed"}
									className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/20 transition-colors cursor-pointer disabled:opacity-40"
								>
									{botsBusy === "seed" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Users className="h-3 w-3" />}
									Create bots
								</button>
							</div>
							{botStatus?.enabled ? (
								<button
									type="button"
									onClick={handleStopBots}
									disabled={botsBusy === "stop"}
									className="flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-3.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-red-300 hover:bg-red-500/20 transition-colors cursor-pointer disabled:opacity-40"
								>
									{botsBusy === "stop" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
									Stop
								</button>
							) : (
								<button
									type="button"
									onClick={handleStartBots}
									disabled={botsBusy === "start" || (botStatus?.botCount ?? 0) === 0}
									className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/20 transition-colors cursor-pointer disabled:opacity-40"
								>
									{botsBusy === "start" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
									Start farm
								</button>
							)}
						</div>

						{/* Recent activity */}
						{(botStatus?.recentActions?.length ?? 0) > 0 && (
							<div className="mt-4 border-t border-zinc-800/60 pt-3">
								<p className="text-[9px] font-black uppercase tracking-wider text-zinc-600 mb-2">Latest activity</p>
								<div className="space-y-1">
									{botStatus.recentActions.slice(0, 6).map((a: any, i: number) => (
										<div key={i} className="flex items-center gap-2 text-[10px]">
											<span className="font-bold text-zinc-400">{a.name}</span>
											<span className="font-mono text-amber-300/80">{a.action}</span>
											<span className="text-zinc-600 truncate">{a.detail}</span>
											<span className="ml-auto shrink-0 text-[8px] text-zinc-600">{new Date(a.at).toLocaleTimeString()}</span>
										</div>
									))}
								</div>
							</div>
						)}
					</GlassCard>

					{/* Bot list */}
					{botsLoading ? (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
						</div>
					) : bots.length === 0 ? (
						<GlassCard className="p-8 text-center">
							<BotIcon className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
							<p className="text-sm font-bold text-zinc-500">No simulated users yet</p>
							<p className="text-[11px] text-zinc-600 mt-1">
								Create bots to populate the app with realistic friend circles.
							</p>
						</GlassCard>
					) : (
						<div className="space-y-2">
							{bots.map((b) => (
								<div key={b.botId} className="rounded-2xl border border-zinc-800/50 bg-zinc-950/40 p-3.5">
									<div className="flex items-start justify-between gap-3">
										<div className="flex items-center gap-3 min-w-0">
											<UserAvatar src={b.avatarUrl} alt={b.name} className="h-9 w-9 rounded-full object-cover border border-zinc-800 shrink-0" />
											<div className="min-w-0">
												<p className="text-[12px] font-bold text-white truncate">
													{b.name}{" "}
													<span className="font-normal text-zinc-500">@{b.username}</span>
													<span className="ml-1.5 rounded-full bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-zinc-400">
														{b.gender}
													</span>
													{b.countryEmoji && (
														<span
															title={`${b.countryName || b.country || ""}${b.migratedTo ? ` — migrated to ${b.countryName}` : ""}`}
															className="ml-1 rounded-full border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[8px] font-bold text-zinc-300"
														>
															{b.countryEmoji} {b.countryName || b.country}
														</span>
													)}
												</p>
												<p className="text-[10px] text-zinc-500 truncate">
													{b.circleName} · {b.age} · mood {(b.mood ?? 0).toFixed(2)} · energy {Math.round((b.energy ?? 0) * 100)}%
												</p>
												<p className="text-[9px] text-zinc-600 truncate">
													{b.stats?.posts ?? 0} posts · {b.stats?.comments ?? 0} comments · {b.stats?.likes ?? 0} likes · {b.stats?.messagesSent ?? 0} msgs · {b.stats?.glances ?? 0} glances · {b.stats?.follows ?? 0} follows
												</p>
											</div>
										</div>
										<button
											type="button"
											onClick={() => handleDeleteBot(b)}
											disabled={botsBusy === b.botId}
											className="flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[9px] font-bold text-red-300 hover:bg-red-500/20 transition-colors cursor-pointer shrink-0"
										>
											{botsBusy === b.botId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
											Delete
										</button>
									</div>
								</div>
							))}
						</div>
					)}
					<Pager page={botsPage} pages={botsPages} onPage={setBotsPage} />
				</div>
			)}

			{activeTab === "audit" && (
				<div className="max-w-3xl">
					<div className="flex items-center justify-between mb-3">
						<h3 className="flex items-center gap-1.5 text-label-sm font-semibold text-zinc-300">
							<Shield className="h-4 w-4 text-zinc-500" /> God-mode audit trail ({auditTotal})
						</h3>
						<button
							type="button"
							onClick={() => fetchAudit(auditPage)}
							className="text-[10px] font-bold text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
						>
							Refresh
						</button>
					</div>
					{auditLoading ? (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
						</div>
					) : auditLogs.length === 0 ? (
						<GlassCard className="p-8 text-center">
							<Shield className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
							<p className="text-sm font-bold text-zinc-500">No actions logged yet</p>
							<p className="text-[11px] text-zinc-600 mt-1">
								Every god-mode action (impersonations, edits, bans, deletes, broadcasts, kill-switch flips) is recorded here.
							</p>
						</GlassCard>
					) : (
						<div className="space-y-1.5">
							{auditLogs.map((log) => (
								<div
									key={log._id}
									className="rounded-xl border border-zinc-800/50 bg-zinc-950/40 px-3 py-2 flex items-center justify-between gap-3"
								>
									<div className="min-w-0">
										<p className="text-[11px] text-zinc-300 truncate">
											<span className="font-black text-white">@{log.actorName || "admin"}</span>
											<span className="mx-1.5 text-zinc-600">→</span>
											<span className="font-mono text-amber-300/90">{log.action}</span>
											{log.targetName && (
												<span className="text-zinc-500"> on <span className="font-bold text-zinc-300">{log.targetName}</span></span>
											)}
										</p>
										<p className="text-[8px] text-zinc-600 mt-0.5">
											{new Date(log.createdAt).toLocaleString()} · {log.targetType} {log.targetId?.slice(0, 10)}
										</p>
									</div>
									<span
										className={`shrink-0 rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-wider ${
											log.action.includes("delete") || log.action.includes("off")
												? "border-red-500/30 bg-red-500/10 text-red-300"
												: "border-zinc-700 bg-zinc-900 text-zinc-400"
										}`}
									>
										{log.action}
									</span>
								</div>
							))}
						</div>
					)}
					<Pager page={auditPage} pages={auditPages} onPage={setAuditPage} />
				</div>
			)}

			{inspectUserId && (
				<AdminUserDetail
					userId={inspectUserId}
					onClose={() => setInspectUserId(null)}
					onUserChanged={() => fetchUsers(usersPage, usersSearch)}
				/>
			)}
		</div>
	);
}
