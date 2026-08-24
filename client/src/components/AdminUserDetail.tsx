import { useEffect, useState } from "react";
import {
	X,
	Loader2,
	Save,
	UserCog,
	KeyRound,
	Trash2,
	Ban,
	VolumeX,
	Crown,
	BadgeCheck,
	Star,
	Eye,
	FileText,
	MessageSquare,
	Send,
} from "lucide-react";
import { apiFetch } from "../utils/api";
import { logger } from "../utils/logger";
import UserAvatar from "./UserAvatar";

interface DetailUser {
	_id: string;
	username: string;
	fullName: string;
	email: string;
	bio?: string;
	gender?: string;
	statusText?: string;
	profilePic?: { url?: string };
	isVerified?: boolean;
	isMuted?: boolean;
	isBanned?: boolean;
	isAdmin?: boolean;
	isPrivate?: boolean;
	waitlistPerk?: boolean;
	notificationsEnabled?: boolean;
	permissionOnboardingCompleted?: boolean;
	followersCount?: number;
	followingCount?: number;
	postsCount?: number;
	createdAt?: string;
}

interface DetailStats {
	posts: number;
	comments: number;
	glimpses: number;
	communitiesCreated: number;
	conversations: number;
	xp: number;
	xpLevel: number;
	badges: string[];
	streak: number;
	lastActiveDate: string | null;
}

interface DetailPayload {
	user: DetailUser;
	stats: DetailStats;
	latestPosts: { _id: string; title?: string; content?: string; slug?: string; likesCount?: number; commentsCount?: number; createdAt?: string }[];
	latestComments: { _id: string; content: string; likesCount?: number; createdAt?: string; post?: { title?: string; slug?: string; content?: string } | null }[];
	conversations: { conversationId: string; count: number; lastMessage?: { content?: string; sender?: { username?: string } } | null }[];
}

function StatChip({ label, value }: { label: string; value: number | string }) {
	return (
		<div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-2.5 py-2 text-center">
			<p className="text-sm font-black text-white">{value}</p>
			<p className="text-[8px] font-bold uppercase tracking-wider text-zinc-500">{label}</p>
		</div>
	);
}

function FlagPill({ on, label, className }: { on: boolean; label: React.ReactNode; className: string }) {
	if (!on) return null;
	return (
		<span className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider ${className}`}>
			{label}
		</span>
	);
}

export default function AdminUserDetail({
	userId,
	onClose,
	onUserChanged,
}: {
	userId: string;
	onClose: () => void;
	onUserChanged: () => void;
}) {
	const [data, setData] = useState<DetailPayload | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [saving, setSaving] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);
	const [tempPassword, setTempPassword] = useState("");
	const [form, setForm] = useState<Record<string, any>>({});
	const [savedMsg, setSavedMsg] = useState("");

	const load = async () => {
		setLoading(true);
		try {
			const res = await apiFetch(`/api/admin/users/${userId}/detail`);
			const d = await res.json();
			if (res.ok && d.success) {
				setData(d);
				setForm({
					username: d.user.username,
					fullName: d.user.fullName || "",
					email: d.user.email || "",
					bio: d.user.bio || "",
					gender: d.user.gender || "",
					statusText: d.user.statusText || "",
					profilePic: d.user.profilePic?.url || "",
					followersCount: d.user.followersCount ?? 0,
					followingCount: d.user.followingCount ?? 0,
					postsCount: d.user.postsCount ?? 0,
				});
			} else {
				setError(d.message || "Failed to load user detail.");
			}
		} catch (err) {
			logger.error("Failed to load admin user detail", err);
			setError("Failed to load user detail.");
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [userId]);

	if (loading) {
		return (
			<div className="fixed inset-0 z-[900] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
				<div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-10" onClick={(e) => e.stopPropagation()}>
					<Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
				</div>
			</div>
		);
	}

	if (error || !data) {
		return (
			<div className="fixed inset-0 z-[900] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
				<div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-8 text-center" onClick={(e) => e.stopPropagation()}>
					<p className="text-sm font-bold text-red-300">{error || "Failed to load."}</p>
					<button type="button" onClick={onClose} className="mt-4 text-xs font-bold text-zinc-400 hover:text-white cursor-pointer">
						Close
					</button>
				</div>
			</div>
		);
	}

	const u = data.user;

	const save = async () => {
		setSaving(true);
		setSavedMsg("");
		try {
			const patch: Record<string, any> = {
				username: form.username,
				fullName: form.fullName,
				email: form.email,
				bio: form.bio,
				gender: form.gender,
				statusText: form.statusText,
				followersCount: Number(form.followersCount) || 0,
				followingCount: Number(form.followingCount) || 0,
				postsCount: Number(form.postsCount) || 0,
			};
			if (form.profilePic && form.profilePic !== u.profilePic?.url) patch.profilePic = form.profilePic;
			const res = await apiFetch(`/api/admin/users/${userId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(patch),
			});
			const d = await res.json();
			if (res.ok && d.success) {
				setSavedMsg("Saved.");
				setData((prev) => (prev ? { ...prev, user: { ...prev.user, ...d.user } } : prev));
				onUserChanged();
			} else {
				setSavedMsg(d.message || "Save failed.");
			}
		} catch (err) {
			logger.error("Failed to save user", err);
			setSavedMsg("Save failed.");
		} finally {
			setSaving(false);
		}
	};

	const toggleFlag = async (field: string, current: boolean) => {
		setBusy(field);
		setSavedMsg("");
		try {
			const res = await apiFetch(`/api/admin/users/${userId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ [field]: !current }),
			});
			const d = await res.json();
			if (res.ok && d.success) {
				setData((prev) => (prev ? { ...prev, user: { ...prev.user, ...d.user } } : prev));
				setSavedMsg(`${field} → ${!current}`);
				onUserChanged();
			}
		} catch (err) {
			logger.error("Failed to toggle flag", err);
		} finally {
			setBusy(null);
		}
	};

	const impersonate = async () => {
		if (!window.confirm(`Become @${u.username}? Your session will switch to their account (reload). Log out to return to your admin.`)) return;
		setBusy("impersonate");
		try {
			const res = await apiFetch(`/api/admin/users/${userId}/impersonate`, { method: "POST" });
			const d = await res.json();
			if (res.ok && d.success) {
				window.location.reload();
			} else {
				window.alert(d.message || "Impersonation failed.");
			}
		} catch (err) {
			logger.error("Impersonate failed", err);
		} finally {
			setBusy(null);
		}
	};

	const resetPassword = async () => {
		if (!window.confirm(`Reset @${u.username}'s password? All their current sessions will be killed.`)) return;
		setBusy("reset");
		try {
			const res = await apiFetch(`/api/admin/users/${userId}/reset-password`, { method: "POST" });
			const d = await res.json();
			if (res.ok && d.success) {
				setTempPassword(d.tempPassword);
			} else {
				window.alert(d.message || "Reset failed.");
			}
		} catch (err) {
			logger.error("Reset password failed", err);
		} finally {
			setBusy(null);
		}
	};

	const deleteUser = async () => {
		if (!window.confirm(`PERMANENTLY DELETE @${u.username} (${u.email})? This wipes ALL their data — posts, comments, chats, everything. This cannot be undone.`)) return;
		setBusy("delete");
		try {
			const res = await apiFetch(`/api/admin/users/${userId}`, { method: "DELETE" });
			const d = await res.json();
			if (res.ok && d.success) {
				onUserChanged();
				onClose();
			} else {
				window.alert(d.message || "Delete failed.");
			}
		} catch (err) {
			logger.error("Delete user failed", err);
		} finally {
			setBusy(null);
		}
	};

	const deletePost = async (postId: string) => {
		if (!window.confirm("Delete this post?")) return;
		try {
			const res = await apiFetch(`/api/admin/posts/${postId}`, { method: "DELETE" });
			if (res.ok) {
				setData((prev) => (prev ? { ...prev, latestPosts: prev.latestPosts.filter((p) => p._id !== postId) } : prev));
			}
		} catch (err) {
			logger.error("Delete post failed", err);
		}
	};

	const deleteComment = async (commentId: string) => {
		if (!window.confirm("Delete this comment?")) return;
		try {
			const res = await apiFetch(`/api/admin/comments/${commentId}`, { method: "DELETE" });
			if (res.ok) {
				setData((prev) => (prev ? { ...prev, latestComments: prev.latestComments.filter((c) => c._id !== commentId) } : prev));
			}
		} catch (err) {
			logger.error("Delete comment failed", err);
		}
	};

	const inputCls =
		"w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-[11px] text-white placeholder-zinc-600 outline-none focus:border-zinc-600 transition-colors";

	return (
		<div className="fixed inset-0 z-[900] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-6" onClick={onClose}>
			<div
				className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="sticky top-0 z-10 border-b border-zinc-800/70 bg-zinc-950/95 backdrop-blur-xl px-5 py-4 flex items-start justify-between gap-3">
					<div className="flex items-center gap-3 min-w-0">
						<UserAvatar src={u.profilePic?.url} alt={u.username || "User"} className="h-12 w-12 rounded-full object-cover border border-zinc-800 shrink-0" />
						<div className="min-w-0">
							<div className="flex items-center gap-1.5 flex-wrap">
								<p className="text-[15px] font-black text-white truncate">@{u.username}</p>
								<FlagPill on={!!u.isAdmin} label={<Crown className="h-2.5 w-2.5 inline" />} className="bg-amber-500/15 border-amber-500/30 text-amber-300" />
								<FlagPill on={!!u.isVerified} label={<BadgeCheck className="h-2.5 w-2.5 inline" />} className="bg-sky-500/15 border-sky-500/30 text-sky-300" />
								<FlagPill on={!!u.waitlistPerk} label={<Star className="h-2.5 w-2.5 inline" />} className="bg-emerald-500/15 border-emerald-500/30 text-emerald-300" />
								<FlagPill on={!!u.isBanned} label="Banned" className="bg-red-500/15 border-red-500/30 text-red-300" />
								<FlagPill on={!!u.isMuted} label="Muted" className="bg-amber-500/15 border-amber-500/30 text-amber-300" />
							</div>
							<p className="text-[10px] text-zinc-500 truncate">
								{u.fullName} · {u.email} · joined {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
							</p>
							{u.statusText ? <p className="text-[10px] text-zinc-400 truncate italic">“{u.statusText}”</p> : null}
						</div>
					</div>
					<div className="flex items-center gap-2 shrink-0">
						{tempPassword && (
							<span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-bold text-emerald-300">
								Temp password: <span className="font-mono">{tempPassword}</span>
							</span>
						)}
						<button
							type="button"
							onClick={onClose}
							className="rounded-full border border-zinc-800 bg-zinc-900/60 p-2 text-zinc-400 hover:text-white transition-colors cursor-pointer"
						>
							<X className="h-4 w-4" />
						</button>
					</div>
				</div>

				<div className="p-5 space-y-5">
					{/* God-eye stats */}
					<div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
						<StatChip label="Posts" value={data.stats.posts} />
						<StatChip label="Comments" value={data.stats.comments} />
						<StatChip label="Glances" value={data.stats.glimpses} />
						<StatChip label="Communities" value={data.stats.communitiesCreated} />
						<StatChip label="Chats" value={data.stats.conversations} />
						<StatChip label="XP" value={data.stats.xp} />
						<StatChip label="Level" value={data.stats.xpLevel} />
						<StatChip label="Streak" value={data.stats.streak} />
					</div>
					{data.stats.badges.length > 0 && (
						<p className="text-[10px] text-zinc-500">
							Badges: {data.stats.badges.join(", ")}
						</p>
					)}

					{/* Full edit */}
					<div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/20 p-4">
						<h4 className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-3">
							<UserCog className="h-3.5 w-3.5" /> Full account control
						</h4>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
							<label className="block">
								<span className="text-[9px] font-bold uppercase text-zinc-500">Username</span>
								<input className={inputCls} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
							</label>
							<label className="block">
								<span className="text-[9px] font-bold uppercase text-zinc-500">Full name</span>
								<input className={inputCls} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
							</label>
							<label className="block">
								<span className="text-[9px] font-bold uppercase text-zinc-500">Email</span>
								<input className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
							</label>
							<label className="block">
								<span className="text-[9px] font-bold uppercase text-zinc-500">Profile pic URL</span>
								<input className={inputCls} value={form.profilePic} onChange={(e) => setForm({ ...form, profilePic: e.target.value })} />
							</label>
							<label className="block">
								<span className="text-[9px] font-bold uppercase text-zinc-500">Status text</span>
								<input className={inputCls} value={form.statusText} onChange={(e) => setForm({ ...form, statusText: e.target.value })} />
							</label>
							<label className="block">
								<span className="text-[9px] font-bold uppercase text-zinc-500">Gender</span>
								<input className={inputCls} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} />
							</label>
							<label className="block">
								<span className="text-[9px] font-bold uppercase text-zinc-500">Followers count</span>
								<input className={inputCls} type="number" value={form.followersCount} onChange={(e) => setForm({ ...form, followersCount: e.target.value })} />
							</label>
							<label className="block">
								<span className="text-[9px] font-bold uppercase text-zinc-500">Following count</span>
								<input className={inputCls} type="number" value={form.followingCount} onChange={(e) => setForm({ ...form, followingCount: e.target.value })} />
							</label>
							<label className="block sm:col-span-2">
								<span className="text-[9px] font-bold uppercase text-zinc-500">Bio</span>
								<textarea className={`${inputCls} resize-none`} rows={2} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
							</label>
						</div>
						<div className="flex items-center gap-2 mt-3">
							<button
								type="button"
								onClick={save}
								disabled={saving}
								className="flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-[10px] font-black text-black transition-opacity hover:opacity-90 disabled:opacity-40 cursor-pointer"
							>
								{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
								Save changes
							</button>
							{savedMsg && <span className="text-[10px] font-bold text-zinc-400">{savedMsg}</span>}
						</div>
					</div>

					{/* Power toggles */}
					<div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/20 p-4">
						<h4 className="text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-3">Power toggles</h4>
						<div className="flex flex-wrap gap-1.5">
							{[
								{ field: "isAdmin", label: "Admin", icon: <Crown className="h-3 w-3" />, on: !!u.isAdmin, onCls: "bg-amber-500/20 border-amber-500/30 text-amber-300 hover:bg-amber-500/30", offCls: "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200" },
								{ field: "isVerified", label: "Verified", icon: <BadgeCheck className="h-3 w-3" />, on: !!u.isVerified, onCls: "bg-sky-500/20 border-sky-500/30 text-sky-300 hover:bg-sky-500/30", offCls: "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200" },
								{ field: "waitlistPerk", label: "Day One Perk", icon: <Star className="h-3 w-3" />, on: !!u.waitlistPerk, onCls: "bg-emerald-500/20 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30", offCls: "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200" },
								{ field: "isMuted", label: "Mute", icon: <VolumeX className="h-3 w-3" />, on: !!u.isMuted, onCls: "bg-amber-500/20 border-amber-500/30 text-amber-300 hover:bg-amber-500/30", offCls: "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200" },
								{ field: "isBanned", label: "Ban", icon: <Ban className="h-3 w-3" />, on: !!u.isBanned, onCls: "bg-red-500/20 border-red-500/30 text-red-300 hover:bg-red-500/30", offCls: "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200" },
							].map((t) => (
								<button
									key={t.field}
									type="button"
									disabled={busy === t.field}
									onClick={() => toggleFlag(t.field, t.on)}
									className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[9px] font-bold transition-all cursor-pointer ${t.on ? t.onCls : t.offCls}`}
								>
									{busy === t.field ? <Loader2 className="h-3 w-3 animate-spin" /> : t.icon}
									{t.label}
								</button>
							))}
						</div>
					</div>

					{/* Danger zone */}
					<div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4">
						<h4 className="text-[10px] font-black uppercase tracking-wider text-red-300 mb-3">Danger zone</h4>
						<div className="flex flex-wrap gap-2">
							<button
								type="button"
								disabled={busy === "impersonate"}
								onClick={impersonate}
								className="flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 px-3.5 py-1.5 text-[10px] font-bold text-violet-300 hover:bg-violet-500/20 transition-colors cursor-pointer"
							>
								{busy === "impersonate" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
								Act as user
							</button>
							<button
								type="button"
								disabled={busy === "reset"}
								onClick={resetPassword}
								className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3.5 py-1.5 text-[10px] font-bold text-amber-300 hover:bg-amber-500/20 transition-colors cursor-pointer"
							>
								{busy === "reset" ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
								Reset password
							</button>
							<button
								type="button"
								disabled={busy === "delete"}
								onClick={deleteUser}
								className="flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-3.5 py-1.5 text-[10px] font-bold text-red-300 hover:bg-red-500/20 transition-colors cursor-pointer"
							>
								{busy === "delete" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
								Delete account
							</button>
						</div>
					</div>

					{/* Content previews */}
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/20 p-4">
							<h4 className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-3">
								<FileText className="h-3.5 w-3.5" /> Latest posts
							</h4>
							<div className="space-y-2">
								{data.latestPosts.length === 0 && <p className="text-[10px] text-zinc-600">No posts.</p>}
								{data.latestPosts.map((p) => (
									<div key={p._id} className="flex items-start justify-between gap-2 rounded-lg border border-zinc-800/50 bg-zinc-950/40 p-2">
										<div className="min-w-0">
											<p className="text-[10px] text-zinc-300 truncate">{(p.content || p.title || "").slice(0, 80) || p.slug}</p>
											<p className="text-[8px] text-zinc-600">❤ {p.likesCount ?? 0} · 💬 {p.commentsCount ?? 0} · {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : ""}</p>
										</div>
										<button type="button" onClick={() => deletePost(p._id)} className="text-red-400 hover:text-red-300 cursor-pointer shrink-0">
											<Trash2 className="h-3 w-3" />
										</button>
									</div>
								))}
							</div>
						</div>

						<div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/20 p-4">
							<h4 className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-3">
								<MessageSquare className="h-3.5 w-3.5" /> Latest comments
							</h4>
							<div className="space-y-2">
								{data.latestComments.length === 0 && <p className="text-[10px] text-zinc-600">No comments.</p>}
								{data.latestComments.map((c) => (
									<div key={c._id} className="flex items-start justify-between gap-2 rounded-lg border border-zinc-800/50 bg-zinc-950/40 p-2">
										<div className="min-w-0">
											<p className="text-[10px] text-zinc-300 truncate">{(c.content || "").slice(0, 80)}</p>
											<p className="text-[8px] text-zinc-600">❤ {c.likesCount ?? 0} · {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ""}</p>
										</div>
										<button type="button" onClick={() => deleteComment(c._id)} className="text-red-400 hover:text-red-300 cursor-pointer shrink-0">
											<Trash2 className="h-3 w-3" />
										</button>
									</div>
								))}
							</div>
						</div>
					</div>

					{/* Chat visibility */}
					{data.conversations.length > 0 && (
						<div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/20 p-4">
							<h4 className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-3">
								<Send className="h-3.5 w-3.5" /> Recent conversations ({data.conversations.length} shown of {data.stats.conversations})
							</h4>
							<div className="space-y-1.5">
								{data.conversations.map((c) => (
									<div key={c.conversationId} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800/50 bg-zinc-950/40 px-2.5 py-1.5">
										<p className="text-[10px] text-zinc-400 truncate">
											{c.lastMessage ? (c.lastMessage.sender?.username || "?") + ": " + (c.lastMessage.content || "").slice(0, 60) : "No messages"}
										</p>
										<span className="text-[8px] font-bold text-zinc-600 shrink-0">{c.count} msgs</span>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
