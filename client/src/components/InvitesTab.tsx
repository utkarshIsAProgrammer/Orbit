import { useState, useEffect, useRef, useMemo } from "react";
import { motion } from "motion/react";
import {
	Gift,
	Copy,
	Check,
	Users,
	Loader2,
	TicketCheck,
	Zap,
	TrendingUp,
	Lock,
} from "lucide-react";
import { apiFetch } from "../utils/api";
import { logger } from "../utils/logger";
import GlassCard from "./GlassCard";

// Referral badge tiers — each unlocks at N accepted invites.
const REFERRAL_BADGES: { badge: string; label: string; count: number }[] = [
	{ badge: "referral_1", label: "First Referral", count: 1 },
	{ badge: "referral_5", label: "Growth Starter", count: 5 },
	{ badge: "referral_10", label: "Network Builder", count: 10 },
	{ badge: "referral_25", label: "Orbit Ambassador", count: 25 },
];

export default function InvitesTab() {
	const [inviteCode, setInviteCode] = useState("");
	const [loading, setLoading] = useState(true);
	const [generating, setGenerating] = useState(false);
	const [copied, setCopied] = useState(false);
	const [stats, setStats] = useState({ totalInvites: 0, acceptedInvites: 0 });
	const [reachBoostUntil, setReachBoostUntil] = useState<string | null>(null);
	const [badges, setBadges] = useState<string[]>([]);
	const [redeemCode, setRedeemCode] = useState("");
	const [redeeming, setRedeeming] = useState(false);
	const [redeemMsg, setRedeemMsg] = useState<{ ok: boolean; text: string } | null>(null);
	// Redeemer rewards returned by the server (XP bundle + founder badge)
	const [redeemRewards, setRedeemRewards] = useState<{
		redeemerXp?: number;
		redeemerBadgeAwarded?: boolean;
		redeemerLeveledUp?: boolean;
	} | null>(null);
	// Guards against concurrent double-redeem (button + deep-link transports).
	const redeemInFlightRef = useRef(false);

	const fetchInviteCode = async () => {
		setLoading(true);
		try {
			const res = await apiFetch("/api/invites/code");
			const data = await res.json();
			if (res.ok && data.success) {
				setInviteCode(data.inviteCode);
			}
		} catch (err) {
			logger.error("Failed to fetch invite code", err);
		} finally {
			setLoading(false);
		}
	};

	const fetchStats = async () => {
		try {
			const res = await apiFetch("/api/invites/stats");
			const data = await res.json();
			if (res.ok && data.success) {
				setStats(data.stats);
				setReachBoostUntil(data.reachBoostUntil || null);
				setBadges(data.badges || []);
			}
		} catch (err) {
			logger.error("Failed to fetch invite stats", err);
		}
	};

	// Whole days left on the active reach boost (0 = not active).
	const boostDaysLeft = useMemo(() => {
		if (!reachBoostUntil) return 0;
		const ms = new Date(reachBoostUntil).getTime() - Date.now();
		return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
	}, [reachBoostUntil]);

	useEffect(() => {
		fetchInviteCode();
		fetchStats();
	}, []);

	// Redeem a specific code (used by the redeem button).
	// The ref guard makes double-fire impossible even if the deep-link event
	// and the sessionStorage path both run (or the user double-clicks).
	const handleRedeemWithCode = async (code: string) => {
		if (redeemInFlightRef.current) return;
		redeemInFlightRef.current = true;
		setRedeeming(true);
		setRedeemMsg(null);
		try {
			const res = await apiFetch(`/api/invites/redeem/${encodeURIComponent(code)}`, { method: "POST" });
			const data = await res.json();
			if (res.ok && data.success) {
				setRedeemMsg({ ok: true, text: "Invite redeemed successfully!" });
				setRedeemRewards({
					redeemerXp: data.rewards?.redeemerXp,
					redeemerBadgeAwarded: data.rewards?.redeemerBadgeAwarded,
					redeemerLeveledUp: data.rewards?.redeemerLeveledUp,
				});
				setRedeemCode("");
				fetchStats();
			} else {
				setRedeemMsg({ ok: false, text: data.message || "Could not redeem this code." });
			}
		} catch (err) {
			logger.error("Failed to redeem invite code", err);
			setRedeemMsg({ ok: false, text: "Could not redeem this code." });
		} finally {
			redeemInFlightRef.current = false;
			setRedeeming(false);
		}
	};

	const handleGenerate = async () => {
		setGenerating(true);
		try {
			const res = await apiFetch("/api/invites/code");
			const data = await res.json();
			if (res.ok && data.success) {
				setInviteCode(data.inviteCode);
			}
		} catch (err) {
			logger.error("Failed to generate invite code", err);
		} finally {
			setGenerating(false);
		}
	};

	const handleCopy = () => {
		// Copy just the invite code — the recipient redeems it in the
		// "Have an invite code?" field. Falls back to a hidden textarea for
		// browsers/contexts without the async clipboard API.
		const fallbackCopy = () => {
			try {
				const ta = document.createElement("textarea");
				ta.value = inviteCode;
				ta.style.position = "fixed";
				ta.style.opacity = "0";
				document.body.appendChild(ta);
				ta.select();
				document.execCommand("copy");
				document.body.removeChild(ta);
				setCopied(true);
				setTimeout(() => setCopied(false), 2000);
			} catch {
				logger.error("Failed to copy invite code");
			}
		};
		if (navigator.clipboard?.writeText) {
			navigator.clipboard.writeText(inviteCode).then(
				() => {
					setCopied(true);
					setTimeout(() => setCopied(false), 2000);
				},
				() => fallbackCopy(),
			);
		} else {
			fallbackCopy();
		}
	};

	const handleRedeem = () => {
		const code = redeemCode.trim().toUpperCase();
		if (!code) {
			setRedeemMsg({ ok: false, text: "Enter an invite code first." });
			return;
		}
		handleRedeemWithCode(code);
	};

	if (loading) {
		return (
			<GlassCard className="p-6 text-center">
				<Loader2 className="h-5 w-5 animate-spin text-zinc-500 mx-auto" />
			</GlassCard>
		);
	}

	return (
		<motion.div
			initial={{ opacity: 0, y: 10 }}
			animate={{ opacity: 1, y: 0 }}
			className="space-y-4"
		>
			<GlassCard className="p-6">
				<div className="flex items-center gap-2 mb-4">
					<Gift className="h-4 w-4 text-emerald-400" />
					<h3 className="text-label text-base font-semibold text-white">
						Invite Friends
					</h3>
				</div>

				<p className="text-[11px] text-zinc-400 mb-5 leading-relaxed">
					Share your code — each friend who joins gives you a 7-day reach boost
					and earns you referral badges!
				</p>

				{/* Invite Code Display */}
				{inviteCode ? (
					<div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 mb-4">
						<div className="flex items-center justify-between mb-1.5">
							<div className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
								Your Invite Code
							</div>
							<button
								type="button"
								onClick={handleCopy}
								title={copied ? "Copied!" : "Copy invite code"}
								aria-label="Copy invite code"
								className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-bold text-zinc-400 hover:text-white hover:bg-zinc-800/70 transition-all cursor-pointer"
							>
								{copied ? (
									<><Check className="h-3.5 w-3.5 text-emerald-400" /> Copied</>
								) : (
									<><Copy className="h-3.5 w-3.5" /> Copy</>
								)}
							</button>
						</div>
						<button
							type="button"
								onClick={handleCopy}
								title="Copy invite code"
								className="group w-full text-left cursor-pointer"
							>
							<span className="inline-flex items-center gap-2.5 text-lg font-black tracking-widest text-white font-mono group-hover:text-emerald-300 transition-colors">
								{inviteCode}
								<Copy className="h-4 w-4 text-zinc-600 group-hover:text-emerald-400 transition-colors" />
							</span>
						</button>
					</div>
				) : (
					<button
						type="button"
						onClick={handleGenerate}
						disabled={generating}
						className="w-full rounded-full bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 py-3 text-[11px] font-bold text-emerald-300 transition-all cursor-pointer flex items-center justify-center gap-2 mb-4"
					>
						{generating ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<><Gift className="h-3.5 w-3.5" /> Generate Invite Code</>
						)}
					</button>
				)}

				{/* Redeem a friend's code */}
				<div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 mb-4">
					<div className="flex items-center gap-2 mb-2">
						<TicketCheck className="h-4 w-4 text-emerald-400" />
						<div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
							Have an invite code?
						</div>
					</div>
					<div className="flex gap-2">
						<input
							value={redeemCode}
							onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
							placeholder="ABC12345"
							maxLength={12}
							className="min-w-0 flex-1 rounded-full border border-zinc-700 bg-zinc-950/60 px-4 py-2 text-[12px] font-mono font-bold tracking-widest text-white placeholder-zinc-600 outline-none focus:border-emerald-500/50 transition-colors uppercase"
						/>
						<button
							type="button"
							onClick={handleRedeem}
							disabled={redeeming}
							className="shrink-0 rounded-full bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 px-4 py-2 text-[10px] font-bold text-emerald-300 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
						>
							{redeeming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
							Redeem
						</button>
					</div>
					{redeemMsg && (
						<div
							className={`mt-2 text-[11px] font-semibold ${redeemMsg.ok ? "text-emerald-400" : "text-red-400"}`}
						>
							{redeemMsg.text}
						</div>
					)}
					{/* Redeemer rewards — the dual-sided loop: you get XP + the Founder
					    badge for accepting, the inviter gets reach + referral badges. */}
					{redeemMsg?.ok && redeemRewards?.redeemerXp ? (
						<div className="mt-2.5 flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2">
							<Zap className="h-3.5 w-3.5 shrink-0 text-amber-400" />
							<span className="text-[11px] font-semibold text-amber-300">
								+{redeemRewards.redeemerXp} XP
								{redeemRewards.redeemerBadgeAwarded
									? " · Founder badge unlocked"
									: ""}
								{redeemRewards.redeemerLeveledUp ? " · Level up!" : ""}
							</span>
						</div>
					) : null}
				</div>

				{/* Rewards — reach boost + referral badges */}
				<div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 mb-4">
					<div className="flex items-center gap-2 mb-2">
						<Zap className="h-4 w-4 text-amber-400" />
						<div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
							Your Rewards
						</div>
					</div>
					<div className="flex items-center justify-between rounded-xl bg-zinc-950/50 border border-zinc-800/60 px-3 py-2.5 mb-2">
						<div className="flex items-center gap-2">
							<TrendingUp className="h-3.5 w-3.5 text-amber-400" />
							<span className="text-[11px] font-bold text-zinc-300">Reach Boost</span>
						</div>
						{boostDaysLeft > 0 ? (
							<span className="text-[10px] font-bold text-amber-400">
								ACTIVE - {boostDaysLeft}d left
							</span>
						) : (
							<span className="text-[10px] text-zinc-500">
								Invite a friend to activate
							</span>
						)}
					</div>
					<p className="text-[9px] text-zinc-500 leading-relaxed mb-3">
						Each accepted invite adds 7 days (up to 90) during which your posts
						rank higher in other users' feeds.
					</p>
					<div className="flex flex-wrap items-center gap-2">
						{REFERRAL_BADGES.map((tier) => {
							const earned = badges.includes(tier.badge);
							return (
								<span
									key={tier.badge}
									title={`${tier.label} (${stats.acceptedInvites}/${tier.count})`}
									className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-bold border transition-colors ${
										earned
											? "bg-amber-500/10 border-amber-500/30 text-amber-300"
											: "bg-zinc-900/60 border-zinc-800 text-zinc-600"
									}`}
								>
									{earned ? (
										<Check className="h-2.5 w-2.5" />
									) : (
										<Lock className="h-2.5 w-2.5" />
									)}
									{tier.label}
								</span>
							);
						})}
					</div>
				</div>

				{/* Stats */}
				<div className="grid grid-cols-2 gap-3 pt-4 border-t border-zinc-800/50">
					<div className="text-center">
						<div className="flex items-center justify-center gap-1 text-zinc-400 mb-1">
							<Users className="h-3.5 w-3.5" />
						</div>
						<div className="text-lg font-black text-white">{stats.totalInvites}</div>
						<div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">
							Total Sent
						</div>
					</div>
					<div className="text-center">
						<div className="flex items-center justify-center gap-1 text-emerald-400 mb-1">
							<Check className="h-3.5 w-3.5" />
						</div>
						<div className="text-lg font-black text-white">{stats.acceptedInvites}</div>
						<div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">
							Accepted
						</div>
					</div>
				</div>
			</GlassCard>
		</motion.div>
	);
}
