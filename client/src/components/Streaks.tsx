import { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import {
	Flame,
	Gift,
	Loader2,
	Check,
	Zap,
	AlertTriangle,
	Clock,
} from "lucide-react";
import { apiFetch } from "../utils/api";
import { logger } from "../utils/logger";
import GlassCard from "./GlassCard";

// ── Cold-start resilience ────────────────────────────────────────────
// The backend runs on a free-tier host (Render) that sleeps after ~15 min
// and takes 30–60s to cold-start, during which the proxy answers
// 502/503/504. Claiming a streak through that window used to surface a
// failure even though the server actually recorded the claim — the "I had
// to reload to see it" bug. This retries the idempotent claim POST while
// the server boots.
const COLD_START_STATUSES = new Set([502, 503, 504]);

async function apiFetchWithColdStartRetry(
	url: string,
	options: RequestInit,
): Promise<Response> {
	const maxAttempts = 5;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const res = await apiFetch(url, options);
			if (!COLD_START_STATUSES.has(res.status)) return res;
		} catch {
			// Network failure while online: server is likely mid-boot; retry
		}
		if (attempt < maxAttempts) {
			await new Promise((r) => setTimeout(r, 3000 * attempt));
		}
	}
	return apiFetch(url, options); // final attempt
}

interface UserStreak {
	_id: string;
	userId: string;
	currentStreak: number;
	longestStreak: number;
	lastActiveDate: string;
	updatedAt: string;
	dailyRewardClaimed: boolean;
	canClaim: boolean;
	nextClaimInMs: number;
	streakBroken: boolean;
	timeLeftBeforeBreak: number;
	timeLeftHours: number;
	timeLeftMinutes: number;
}

interface StreaksProps {
	user: { _id: string };
}

export default function Streaks({ user: _user }: StreaksProps) {
	const [streak, setStreak] = useState<UserStreak | null>(null);
	const [loading, setLoading] = useState(true);
	const [claimed, setClaimed] = useState(false);
	const [claiming, setClaiming] = useState(false);
	const [claimMessage, setClaimMessage] = useState("");
	const [nextClaimInMs, setNextClaimInMs] = useState(0);

	// `bypassCache` guarantees we never serve a stale cached "claimed" state
	// that would block a legitimately-available claim after 24 hours.
	const fetchStreak = async () => {
		try {
			const res = await apiFetch("/api/streaks/my", { bypassCache: true });
			const data = await res.json();
			if (res.ok && data.success) {
				setStreak(data.streak);
				setClaimed(data.streak?.canClaim === false);
				setNextClaimInMs(data.streak?.nextClaimInMs || 0);
			}
		} catch (err) {
			logger.error("Failed to fetch streak", err);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchStreak();
	}, []);

	// Refresh time-left every minute
	useEffect(() => {
		if (!streak || streak.streakBroken) return;
		const interval = setInterval(() => {
			setStreak((prev) => {
				if (!prev || prev.streakBroken) return prev;
				const remaining = prev.timeLeftBeforeBreak - 1;
				if (remaining <= 0) {
					// Streak just broke — mark as broken
					return { ...prev, streakBroken: true, timeLeftBeforeBreak: 0, timeLeftHours: 0, timeLeftMinutes: 0 };
				}
				const hours = Math.floor(remaining / 60);
				const mins = remaining % 60;
				return { ...prev, timeLeftBeforeBreak: remaining, timeLeftHours: hours, timeLeftMinutes: mins };
			});
		}, 60000);
		return () => clearInterval(interval);
	}, [streak?.streakBroken]);

	// Count down to the next claimable moment; once the 24h cooldown elapses,
	// refetch so the claim button unlocks WITHOUT needing to reopen the app.
	// The `unlockFetchedRef` guard makes the refetch fire at most once per
	// claimed-cycle, so a future server change can never cause a fetch loop.
	const unlockFetchedRef = useRef(false);
	useEffect(() => {
		if (!claimed) {
			unlockFetchedRef.current = false;
			return;
		}
		if (nextClaimInMs <= 0) return;
		const interval = setInterval(() => {
			setNextClaimInMs((prev) => (prev <= 60000 ? 0 : prev - 60000));
		}, 60000);
		return () => clearInterval(interval);
	}, [claimed, nextClaimInMs]);

	useEffect(() => {
		if (claimed && nextClaimInMs === 0 && !unlockFetchedRef.current) {
			unlockFetchedRef.current = true;
			fetchStreak();
		}
	}, [claimed, nextClaimInMs]);

	const handleClaim = async () => {
		if (claimed || claiming) return;
		setClaiming(true);
		try {
			const res = await apiFetchWithColdStartRetry("/api/streaks/claim", {
				method: "POST",
			});
			const data = await res.json();
			if (res.ok && data.success) {
				setClaimed(true);
				setNextClaimInMs(24 * 60 * 60 * 1000);
				const newBadges: string[] = data.reward?.newBadges || [];
				const BADGE_NAMES: Record<string, string> = {
					streak_7: "7-Day Streak",
					streak_30: "30-Day Streak",
					streak_100: "100-Day Streak",
					streak_365: "1-Year Streak",
				};
				setClaimMessage(
					newBadges.length > 0
						? `Badge unlocked: ${newBadges.map((b) => BADGE_NAMES[b] || b).join(", ")}!`
						: data.message || "Reward claimed!",
				);
				// Update streak from claim response directly (avoids stale cached data)
				setStreak((prev) => {
					if (!prev) return prev;
					return {
						...prev,
						currentStreak: data.reward.currentStreak,
						longestStreak: data.reward.longestStreak,
						dailyRewardClaimed: true,
						canClaim: false,
						nextClaimInMs: 24 * 60 * 60 * 1000,
						streakBroken: false,
					} as UserStreak;
				});
				fetchStreak();
			} else {
				setClaimMessage(data.message || "Already claimed today");
				if (data.nextClaimInMs) {
					setClaimed(true);
					setNextClaimInMs(data.nextClaimInMs);
				}
			}
		} catch (err) {
			logger.error("Failed to claim reward", err);
			setClaimMessage("Failed to claim");
		} finally {
			setClaiming(false);
			if (!claimed) {
				setTimeout(() => setClaimMessage(""), 3000);
			}
		}
	};

	if (loading) {
		return (
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				className="space-y-4"
			>
				<div className="rounded-3xl border border-zinc-800/30 bg-zinc-950/40 p-5">
					<div className="flex items-center justify-between mb-4">
						<div className="flex items-center gap-2">
							<div className="h-4 w-4 rounded shimmer-bg" />
							<div className="h-3.5 w-14 rounded shimmer-bg" />
						</div>
						<div className="h-[10px] w-20 rounded shimmer-bg" />
					</div>
					<div className="flex items-center justify-center py-4">
						<div className="text-center flex flex-col items-center gap-2">
							<div className="h-12 w-12 rounded-full shimmer-bg" />
							<div className="h-4 w-16 rounded shimmer-bg" />
						</div>
					</div>
					<div className="mt-4 pt-4 border-t border-zinc-800/50">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<div className="h-4 w-4 rounded shimmer-bg" />
								<div className="h-[11px] w-20 rounded shimmer-bg" />
							</div>
							<div className="h-7 w-16 rounded-full shimmer-bg" />
						</div>
					</div>
				</div>
			</motion.div>
		);
	}

	const isBroken = streak?.streakBroken;
	const hasActiveStreak = (streak?.currentStreak || 0) > 0 && !isBroken;

	return (
		<motion.div
			initial={{ opacity: 0, y: 10 }}
			animate={{ opacity: 1, y: 0 }}
			className="space-y-4"
		>
			{/* Streak Display */}
			<GlassCard className="p-5">
				<div className="flex items-center justify-between mb-4">
					<h2 className="text-label text-base font-semibold text-white flex items-center gap-2">
						<Flame className={`h-4 w-4 ${hasActiveStreak ? "text-orange-400" : "text-zinc-600"}`} /> Streak
					</h2>
					<span className="text-[10px] text-zinc-500 font-mono">
						Best: {streak?.longestStreak || 0} days
					</span>
				</div>

				<div className="flex items-center justify-center py-4">
					<div className="text-center">
						<motion.div
							key={streak?.currentStreak || 0 + (isBroken ? 1 : 0)}
							initial={{ scale: 1.3 }}
							animate={{ scale: 1 }}
							transition={{ type: "spring", stiffness: 200 }}
							className="text-4xl font-black text-white flex items-center gap-2"
						>
							{isBroken ? (
								<AlertTriangle className="h-8 w-8 text-red-500" />
							) : (
								<Flame
									className={`h-8 w-8 ${
										hasActiveStreak
											? "text-orange-400"
											: "text-zinc-600"
									}`}
								/>
							)}
							{isBroken ? 0 : streak?.currentStreak || 0}
						</motion.div>
						<p className="text-[11px] text-zinc-400 mt-1 font-medium">
							{isBroken ? (
								<span className="text-red-400">Streak broken</span>
							) : hasActiveStreak ? (
								<>{streak?.currentStreak === 1 ? "day" : "days"} consecutive</>
							) : (
								"No active streak"
							)}
						</p>
					</div>
				</div>

				{/* Time left before streak breaks */}
				{!isBroken && (streak?.currentStreak || 0) > 0 && !claimed && (
					<div className="mb-3 flex items-center justify-center gap-1.5 text-[11px] text-zinc-500">
						<Clock className="h-3 w-3" />
						{streak && streak.timeLeftBeforeBreak > 0 ? (
							<>
								{streak.timeLeftHours > 0 && (
									<>{streak.timeLeftHours}h </>
								)}
								{streak.timeLeftMinutes}m left to keep your streak
							</>
						) : (
							"Claim now to keep your streak!"
						)}
					</div>
				)}

				{isBroken && (
					<div className="mb-3 text-center">
						<p className="text-[11px] text-zinc-500 font-medium">
							Claim to start a new streak!
						</p>
					</div>
				)}

				{/* Daily Reward Claim */}
				<div className="mt-4 pt-4 border-t border-zinc-800/50">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Gift className="h-4 w-4 text-emerald-400" />
							<span className="text-[11px] text-zinc-400 font-medium">
								Daily Reward
							</span>
						</div>
						{claimed ? (
							<div className="flex flex-col items-end gap-1">
								<div className="flex items-center gap-1.5 text-emerald-400 text-[10px] font-bold">
									<Check className="h-3 w-3" /> Claimed
								</div>
								{nextClaimInMs > 0 && (
									<div className="flex items-center gap-1 text-[9px] text-zinc-500">
										<Clock className="h-2.5 w-2.5" />
										Next reward in {Math.floor(nextClaimInMs / 3600000)}h{" "}
										{Math.round((nextClaimInMs % 3600000) / 60000)}m
									</div>
								)}
							</div>
						) : (
							<button
								onClick={handleClaim}
								disabled={claiming}
								className="rounded-full bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 px-3 py-1 text-[10px] font-bold text-emerald-300 transition-all cursor-pointer flex items-center gap-1"
							>
								{claiming ? (
									<Loader2 className="h-3 w-3 animate-spin" />
								) : (
									<><Zap className="h-3 w-3" /> Claim</>
								)}
							</button>
						)}
					</div>
					{claimMessage && (
						<motion.p
							initial={{ opacity: 0, y: 5 }}
							animate={{ opacity: 1, y: 0 }}
							className="text-[10px] text-zinc-500 mt-2"
						>
							{claimMessage}
						</motion.p>
					)}
				</div>
			</GlassCard>
		</motion.div>
	);
}
