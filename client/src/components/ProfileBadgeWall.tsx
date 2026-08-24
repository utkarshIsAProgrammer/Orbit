import { useState, useEffect } from "react";
import { Loader2, Medal } from "lucide-react";
import { apiFetch } from "../utils/api";
import { logger } from "../utils/logger";
import { BADGE_CATALOG } from "../utils/badgeCatalog";

interface BadgeHistoryEntry {
	badge: string;
	earnedAt: string;
}

interface ProfileBadgeWallProps {
	userId: string;
}

// Compact relative-time label for when a badge was earned ("just now" → "1y ago").
const timeAgo = (iso: string): string => {
	if (!iso) return "";
	const then = new Date(iso).getTime();
	if (Number.isNaN(then) || then <= 0) return "";
	const diff = Date.now() - then;
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	if (days < 30) return `${days}d ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo ago`;
	return `${Math.floor(months / 12)}y ago`;
};

/**
 * Achievements on a profile — a single "Latest achievement" hero showing the
 * most recently earned badge (server returns badgeHistory newest-first). The
 * earned-badge strip and the "View all" catalog toggle are intentionally
 * omitted: the profile only surfaces the latest win. Shows nothing until the
 * record loads, and nothing at all for users with zero achievements.
 */
export default function ProfileBadgeWall({ userId }: ProfileBadgeWallProps) {
	const [history, setHistory] = useState<BadgeHistoryEntry[] | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			try {
				const res = await apiFetch(`/api/xp/${userId}`);
				const data = await res.json();
				if (!cancelled && res.ok && data.success) {
					// Prefer badgeHistory (newest-first); fall back to the plain
					// badges array for records that predate the history field.
					const hist: BadgeHistoryEntry[] =
						Array.isArray(data.badgeHistory) &&
						data.badgeHistory.length > 0
							? data.badgeHistory
							: (data.badges || []).map((b: string) => ({
									badge: b,
									earnedAt: "",
								}));
					setHistory(hist);
				}
			} catch (err) {
				logger.error("Failed to load badge wall", err);
			} finally {
				if (!cancelled) setLoading(false);
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [userId]);

	if (loading) {
		return (
			<div className="mt-3 flex items-center gap-1.5 text-[10px] text-zinc-500">
				<Loader2 className="h-3 w-3 animate-spin" />
				Achievements...
			</div>
		);
	}

	const earned = history ?? [];
	if (earned.length === 0) return null;

	const catalogMap = new Map(BADGE_CATALOG.map((b) => [b.badge, b]));
	// Drop stale ids (e.g. badges renamed/removed by a catalog rebalance) so a
	// dead "repost_1" never renders as a tile on the profile.
	const known = earned.filter((h) => catalogMap.has(h.badge));
	if (known.length === 0) return null;
	// Server returns badgeHistory newest-first — the hero is the latest win.
	const latest = known[0];
	const latestMeta = catalogMap.get(latest.badge);
	const LatestIcon = latestMeta?.Icon ?? Medal;
	const latestAgo = timeAgo(latest.earnedAt);

	return (
		<div className="mt-4 rounded-2xl border border-zinc-800/50 bg-zinc-900/20 p-3">
			<div className="mb-2.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
				<Medal className="h-3.5 w-3.5 text-amber-400" />
				Achievements
			</div>

			{/* Latest achievement — the only achievement shown on a profile */}
			<div className="flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2.5">
				<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/15 text-amber-400">
					<LatestIcon className="h-5 w-5" />
				</span>
				<div className="min-w-0 flex-1">
					<p className="text-[9px] font-bold uppercase tracking-wider text-amber-400/80">
						Latest achievement
					</p>
					<p className="truncate text-xs font-bold text-white">
						{latestMeta?.label ?? latest.badge}
					</p>
				</div>
				{latestAgo && (
					<span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300/90">
						{latestAgo}
					</span>
				)}
			</div>
		</div>
	);
}
