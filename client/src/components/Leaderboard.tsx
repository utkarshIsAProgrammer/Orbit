import { useState, useEffect, useRef } from "react";
import { Crown, Heart, Loader2, Medal, TrendingUp, Trophy, Users, UserCheck, ArrowUp } from "lucide-react";
import { apiFetch } from "../utils/api";
import { useCacheRefresh } from "../hooks/useCacheRefresh";
import { logger } from "../utils/logger";
import GlassCard from "./GlassCard";
import UserAvatar from "./UserAvatar";

// Stable RegExp for matching leaderboard cache refresh events
const MATCHER_LEADERBOARD = /\/api\/leaderboard/;

interface LeaderboardCreator {
	_id: string;
	username: string;
	fullName: string;
	profilePic?: { url: string };
	followersCount: number;
}

interface LeaderboardPost {
	_id: string;
	title?: string;
	slug?: string;
	engagementScore: number;
	likesCount: number;
	commentsCount: number;
	likedByMe?: boolean;
	author?: { _id: string; username: string; fullName: string; profilePic?: { url: string } };
}

type Period = "weekly" | "monthly" | "alltime";
type Scope = "global" | "following";

const PERIOD_LABELS: { id: Period; label: string }[] = [
	{ id: "weekly", label: "Weekly" },
	{ id: "monthly", label: "Monthly" },
	{ id: "alltime", label: "All Time" },
];

const rankIcon = (idx: number) => {
	if (idx === 0) return <Crown className="h-3.5 w-3.5 text-amber-400" />;
	if (idx === 1) return <Medal className="h-3.5 w-3.5 text-zinc-300" />;
	if (idx === 2) return <Medal className="h-3.5 w-3.5 text-orange-700" />;
	return <span className="w-3.5 text-center text-[10px] font-bold text-zinc-600">{idx + 1}</span>;
};

interface LeaderboardProps {
  /** Open a user's profile from the Top Creators / Top Posts rows. */
  onUserSelected?: (username: string) => void;
  /** Open a post from the Top Posts rows. */
  onPostSelected?: (slug: string) => void;
}

export default function Leaderboard({
  onUserSelected,
  onPostSelected,
}: LeaderboardProps) {
	const [period, setPeriod] = useState<Period>("weekly");
	const [scope, setScope] = useState<Scope>("global");
	const [creators, setCreators] = useState<LeaderboardCreator[]>([]);
	const [posts, setPosts] = useState<LeaderboardPost[]>([]);
	const [yourRank, setYourRank] = useState<number | null>(null);
	const [yourFollowersCount, setYourFollowersCount] = useState(0);
	const [loading, setLoading] = useState(true);
	// Local like state for Top Post rows (server response has no likedByMe)
	// so the heart can toggle optimistically and roll back on failure.
	const [likeOverrides, setLikeOverrides] = useState<
		Record<string, { liked: boolean; count: number }>
	>({});
	// In-flight guard: blocks a second toggle on the same post while a
	// request is pending (rapid double-clicks would otherwise fire two
	// toggles that cancel each other out server-side).
	const likePendingRef = useRef<Set<string>>(new Set());

	const handleLikeToggle = async (p: LeaderboardPost) => {
		if (likePendingRef.current.has(p._id)) return;
		likePendingRef.current.add(p._id);
		const override = likeOverrides[p._id];
		const wasLiked = override ? override.liked : !!p.likedByMe;
		const wasCount = override ? override.count : (p.likesCount ?? 0);
		const newLiked = !wasLiked;
		const newCount = Math.max(0, wasCount + (newLiked ? 1 : -1));
		setLikeOverrides((o) => ({
			...o,
			[p._id]: { liked: newLiked, count: newCount },
		}));
		try {
			const res = await apiFetch(`/api/likes/post/${p._id}`, {
				method: "POST",
			});
			const data = await res.json();
			if (!res.ok || !data.success) {
				throw new Error(data.message || "Failed to like post");
			}
			// Keep the rest of the app in sync (feed cards etc.)
			window.dispatchEvent(
				new CustomEvent("postInteractionChanged", {
					detail: { postId: p._id, type: "like", value: newLiked },
				}),
			);
		} catch (err) {
			logger.error("Failed to like post from leaderboard", err);
			setLikeOverrides((o) => ({
				...o,
				[p._id]: { liked: wasLiked, count: wasCount },
			}));
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: { message: "Failed to like post", type: "error" },
				}),
			);
		} finally {
			likePendingRef.current.delete(p._id);
		}
	};

	const fetchLeaderboard = async () => {
		try {
			const res = await apiFetch(
				`/api/leaderboard?type=${period}&scope=${scope}&limit=10`,
			);
			const data = await res.json();
			if (res.ok && data.success) {
				// Fresh server counts replace any local like overrides.
				setLikeOverrides({});
				setCreators(data.topCreators || []);
				setPosts(data.topPosts || []);
				setYourRank(
					typeof data.yourRank === "number" ? data.yourRank : null,
				);
				setYourFollowersCount(data.yourFollowersCount ?? 0);
			}
		} catch (err) {
			logger.error("Failed to fetch leaderboard", err);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		setLoading(true);
		fetchLeaderboard();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [period, scope]);

	useCacheRefresh(MATCHER_LEADERBOARD, () => fetchLeaderboard());

	return (
		<div className="space-y-4">
			<GlassCard className="p-5 rounded-3xl border border-zinc-800/40">
				<div className="flex items-center justify-between mb-4">
					<h3 className="text-label font-semibold text-zinc-300 flex items-center gap-2">
						<Trophy className="h-4 w-4 text-amber-400" /> Leaderboard
					</h3>
					<div className="flex items-center gap-1 rounded-full border border-zinc-800/60 bg-zinc-950/50 p-0.5">
						{PERIOD_LABELS.map((p) => (
							<button
								key={p.id}
								type="button"
								onClick={() => setPeriod(p.id)}
								className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
									period === p.id
										? "pill-active"
										: "text-zinc-500 hover:text-zinc-300"
								}`}
							>
								{p.label}
							</button>
						))}
					</div>
				</div>

				{/* Scope toggle — Global vs Following. The friends board gives a
				    normal user a real stake: competing against people you chose
				    to follow beats chasing an unreachable global top-10. */}
				<div className="flex items-center gap-1 rounded-full border border-zinc-800/60 bg-zinc-950/50 p-0.5 mb-4 w-fit">
					<button
						type="button"
						onClick={() => setScope("global")}
						className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
							scope === "global"
								? "pill-active"
								: "text-zinc-500 hover:text-zinc-300"
						}`}
					>
						<Users className="h-3 w-3" /> Global
					</button>
					<button
						type="button"
						onClick={() => setScope("following")}
						className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
							scope === "following"
								? "pill-active"
								: "text-zinc-500 hover:text-zinc-300"
						}`}
					>
						<UserCheck className="h-3 w-3" /> Following
					</button>
				</div>

				{/* Your rank — the personal stake card. Computed server-side
				    across the SAME population the board shows (global or your
				    following list), so it is always meaningful. Hidden on the
				    Following board when you follow nobody (the "#1" would just
				    be yourself on an otherwise empty board). */}
				{!loading &&
					yourRank !== null &&
					!(scope === "following" && creators.length === 0) && (
					<div className="mb-4 flex items-center justify-between rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
						<div className="flex items-center gap-2.5">
							<span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
								<ArrowUp className="h-4 w-4" />
							</span>
							<div>
								<p className="text-[10px] font-bold uppercase tracking-wider text-amber-400/80">
									Your rank
								</p>
								<p className="text-sm font-black text-white">
									#{yourRank.toLocaleString()}
									<span className="ml-1.5 text-[10px] font-semibold text-zinc-500">
										by followers · {yourFollowersCount.toLocaleString()}
									</span>
								</p>
							</div>
						</div>
						{yourRank <= 10 && (
							<span className="rounded-full bg-amber-500/15 px-2 py-1 text-[9px] font-bold text-amber-400">
								Top 10!
							</span>
						)}
					</div>
				)}

				{loading ? (
					<div className="flex items-center justify-center py-8">
						<Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
					</div>
				) : (
					<div className="space-y-5">
						{/* Top Creators */}
						<div>
							<div className="flex items-center gap-2 mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
								<Users className="h-3.5 w-3.5" /> Top Creators
							</div>
							{creators.length === 0 ? (
								<p className="text-[11px] text-zinc-600">
									{scope === "following"
										? "You're not following anyone yet — follow some creators to see their board."
										: "No creators yet."}
								</p>
							) : (
								<div className="space-y-1.5">
									{creators.map((c, idx) => (
										<div
											key={c._id}
											className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-zinc-900/50 transition-colors cursor-pointer" onClick={() => onUserSelected?.(c.username)}
										>
											{rankIcon(idx)}
											<UserAvatar
												src={c.profilePic?.url}
												alt={c.fullName}
												className="h-7 w-7 rounded-full object-cover border border-zinc-800 shrink-0"
											/>
											<div className="min-w-0 flex-1">
												<p className="text-[12px] font-bold text-white truncate">
													{c.fullName}
												</p>
												<p className="text-[9px] text-zinc-500 truncate">
													@{c.username} · {c.followersCount.toLocaleString()} followers
												</p>
											</div>
										</div>
									))}
								</div>
							)}
						</div>

						{/* Top Posts by engagement */}
						<div>
							<div className="flex items-center gap-2 mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
								<TrendingUp className="h-3.5 w-3.5" /> Top Posts
							</div>
							{posts.length === 0 ? (
								<p className="text-[11px] text-zinc-600">No posts yet.</p>
							) : (
								<div className="space-y-1.5">
									{posts.map((p, idx) => {
										const override = likeOverrides[p._id];
										const liked = override ? override.liked : !!p.likedByMe;
										const likeCount = override
											? override.count
											: (p.likesCount ?? 0);
										return (
										<div
											key={p._id}
											className={`flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-zinc-900/50 transition-colors ${p.slug ? "cursor-pointer" : ""}`} onClick={() => { if (p.slug) onPostSelected?.(p.slug); }}
										>
											{rankIcon(idx)}
											<div className="min-w-0 flex-1">
												<p className="text-[12px] font-bold text-white truncate">
													{p.title || "Untitled post"}
												</p>
												<p className="text-[9px] text-zinc-500 truncate">
													<span
												onClick={(e) => {
													e.stopPropagation();
													if (p.author?.username)
														onUserSelected?.(p.author.username);
												}}
												className={p.author?.username ? "cursor-pointer hover:text-white hover:underline" : ""}
											>
												@{p.author?.username || "unknown"}
											</span> · {p.engagementScore.toLocaleString()} score
												</p>
											</div>
											<button
												type="button"
												onClick={(e) => {
													e.stopPropagation();
													void handleLikeToggle(p);
												}}
												className={`shrink-0 flex items-center gap-0.5 text-[9px] transition-colors cursor-pointer hover:text-red-400 ${liked ? "text-red-400" : "text-zinc-500"}`}
												aria-label={liked ? "Unlike post" : "Like post"}
											>
												<Heart className={`h-3 w-3 ${liked ? "fill-red-400 text-red-400" : ""}`} />{" "}
												{likeCount}
											</button>
										</div>
									);
									})}
								</div>
							)}
						</div>
					</div>
				)}
			</GlassCard>
		</div>
	);
}
