import { useState, useEffect, useMemo } from "react";
import { Trophy, Loader2, Lock, Gift } from "lucide-react";
import { apiFetch } from "../utils/api";
import { logger } from "../utils/logger";
import { BADGE_CATALOG } from "../utils/badgeCatalog";

interface AchievementsResponse {
  success: boolean;
  earned: string[];
  level: number;
  totalXP: number;
  progress: Record<string, number>;
}

/**
 * Personal achievements home — every badge in the catalog with live
 * "x / target" progress for the locked ones. Fetched from
 * GET /api/xp/achievements (catalog + earned + live counts).
 */
export default function AchievementsTab() {
	const [data, setData] = useState<AchievementsResponse | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			try {
				const res = await apiFetch("/api/xp/achievements");
				const json = await res.json();
				if (!cancelled && res.ok && json.success) {
					setData(json);
				}
			} catch (err) {
				logger.error("Failed to load achievements", err);
			} finally {
				if (!cancelled) setLoading(false);
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, []);

	// Map each catalog entry to its [metric key, target] so the progress bar
	// shows a real "current / target" fraction instead of a fake heuristic.
	const targetFor = useMemo(() => {
		const map: Record<string, { metric: string; target: number }> = {};
		for (const metric of [
			["post_1", "postCount", 1],
			["post_10", "postCount", 10],
			["post_50", "postCount", 50],
			["post_100", "postCount", 100],
			["video_1", "videoCount", 1],
			["video_10", "videoCount", 10],
			["image_1", "imageCount", 1],
			["image_25", "imageCount", 25],
			["glance_1", "glanceCount", 1],
			["glance_10", "glanceCount", 10],
			["likes_given_10", "likesGiven", 10],
			["likes_given_100", "likesGiven", 100],
			["likes_received_10", "likesReceived", 10],
			["likes_received_100", "likesReceived", 100],
			["likes_received_1k", "likesReceived", 1000],
			["likes_received_10k", "likesReceived", 10000],
			["comments_given_10", "commentsMade", 10],
			["comments_given_50", "commentsMade", 50],
			["comments_received_10", "commentsReceived", 10],
			["comments_received_100", "commentsReceived", 100],
			["saves_10", "saves", 10],
			["saves_50", "saves", 50],
			["shares_10", "shares", 10],
			["shares_50", "shares", 50],
			["repost_5", "reposts", 5],
			["repost_25", "reposts", 25],
			["repost_100", "reposts", 100],
			["followers_10", "followers", 10],
			["followers_100", "followers", 100],
			["followers_1k", "followers", 1000],
			["followers_10k", "followers", 10000],
			["community_1", "communitiesJoined", 1],
			["community_5", "communitiesJoined", 5],
			["message_1", "messages", 1],
			["message_100", "messages", 100],
			["message_1k", "messages", 1000],
			["mission_1", "missionsCompleted", 1],
			["mission_20", "missionsCompleted", 20],
		] as const) {
			map[metric[0]] = { metric: metric[1], target: metric[2] };
		}
		return map;
	}, []);

	if (loading) {
		return (
			<div className="flex items-center gap-2 text-sm text-zinc-400">
				<Loader2 className="h-4 w-4 animate-spin" />
				Loading achievements...
			</div>
		);
	}

	// Only count badges that still exist in the catalog — stale ids from a
	// catalog rebalance (e.g. the repost ladder rename) would otherwise
	// inflate the "X / N badges" count without ever rendering.
	const catalogIds = new Set(BADGE_CATALOG.map((b) => b.badge));
	const earned = new Set((data?.earned || []).filter((id) => catalogIds.has(id)));
	const progress = data?.progress || {};

	return (
		<div className="space-y-5">
			<div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 to-transparent p-4">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<Trophy className="h-5 w-5 text-amber-400" />
						<div>
							<p className="text-sm font-black text-white">
								Level {data?.level ?? 1}
							</p>
							<p className="text-[11px] text-zinc-400">
								{(data?.totalXP ?? 0).toLocaleString()} XP ·{" "}
								{earned.size} / {BADGE_CATALOG.length} badges
							</p>
						</div>
					</div>
					<div className="h-2 w-32 overflow-hidden rounded-full bg-zinc-800">
						<div
							className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-400"
							style={{
								width: `${Math.min(
									100,
									Math.round(
										(earned.size / Math.max(1, BADGE_CATALOG.length)) *
											100,
									),
								)}%`,
							}}
						/>
					</div>
				</div>
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
				{BADGE_CATALOG.map(({ badge, label, description, Icon, perk }) => {
					const has = earned.has(badge);
					const entry = targetFor[badge];
					const current = entry ? progress[entry.metric] ?? 0 : 0;
					const pct = entry
						? Math.min(100, Math.round((current / entry.target) * 100))
						: 0;
					const showProgress =
						!has && entry !== undefined && current > 0 && pct < 100;
					const progressText = showProgress
						? `${current.toLocaleString()} / ${entry!.target.toLocaleString()}`
						: undefined;
					return (
						<button
							type="button"
							key={badge}
							title={`${label} — ${description}`}
							onClick={() => {
								// Perk preview — click ANY achievement (locked or
								// unlocked) to see the reward + how to use it.
								window.dispatchEvent(
									new CustomEvent("achievementDetailRequested", {
										detail: { badgeId: badge, progressText },
									}),
								);
							}}
							className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-all cursor-pointer hover:border-amber-500/40 hover:bg-amber-500/5 active:scale-[0.99] ${
								has
									? "border-amber-500/25 bg-amber-500/5"
									: "border-zinc-800/60 bg-zinc-950/40"
							}`}
						>
							<span
								className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${
									has
										? "border-amber-500/40 bg-amber-500/10 text-amber-400"
										: "border-zinc-800 bg-zinc-900/40 text-zinc-600"
								}`}
							>
								{has ? <Icon className="h-4 w-4" /> : <Lock className="h-3.5 w-3.5" />}
							</span>
							<div className="min-w-0 flex-1">
								<p
									className={`text-[11px] font-bold truncate ${
										has ? "text-white" : "text-zinc-400"
									}`}
								>
									{label}
								</p>
								<p className="text-[9px] text-zinc-500 truncate">
									{description}
								</p>
								{perk && (
									<p className="mt-1 flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider text-amber-500/80 truncate">
										<Gift className="h-2.5 w-2.5 shrink-0" />
										{has ? perk.title : `Perk: ${perk.title}`}
									</p>
								)}
								{showProgress && (
									<div className="mt-1.5">
										<div className="h-1 w-full overflow-hidden rounded-full bg-zinc-800">
											<div
												className="h-full rounded-full bg-amber-500/70"
												style={{ width: `${pct}%` }}
											/>
										</div>
										<p className="mt-0.5 text-[8px] font-semibold text-zinc-600">
											{current.toLocaleString()} / {entry!.target.toLocaleString()}
										</p>
									</div>
								)}
							</div>
							{has ? (
								<span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-bold text-amber-400">
									Earned
								</span>
							) : (
								<Lock className="h-3.5 w-3.5 shrink-0 text-zinc-700" />
							)}
						</button>
					);
				})}
			</div>
		</div>
	);
}
