import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
	X,
	Lock,
	Trophy,
	Palette,
	Circle,
	Sparkles,
	BadgeCheck,
	PartyPopper,
	ArrowRight,
} from "lucide-react";
import { BADGE_MAP, THEME_UNLOCK_BADGES, type Perk } from "../utils/badgeCatalog";

interface AchievementDetailModalProps {
	/** Badge id to show ("" or null = closed). */
	badgeId: string | null;
	/** Badge ids the viewer has already earned. */
	earned: string[];
	/** Optional live progress value (e.g. "3 / 10" text) for locked badges. */
	progressText?: string;
	onClose: () => void;
	/** Navigate to Settings → Appearance (for theme perks). */
	onOpenAppearance?: () => void;
}

/**
 * Achievement detail — the "what do I get?" screen. Clicking ANY achievement
 * (locked or unlocked) opens this: badge name, description, live progress,
 * and the perk reward card with exactly how to use / enable it. Locked perks
 * look juicy (shimmer + gradient icon) so users want to chase them; unlocked
 * ones show a green "Active" state. Theme perks show which theme they unlock.
 */
export default function AchievementDetailModal({
	badgeId,
	earned,
	progressText,
	onClose,
	onOpenAppearance,
}: AchievementDetailModalProps) {
	const entry = badgeId ? BADGE_MAP[badgeId] : null;
	const [expanded, setExpanded] = useState(false);

	const open = !!entry;
	const has = entry ? earned.includes(entry.badge) : false;
	const perk: Perk | undefined = entry?.perk;
	const unlockedTheme = entry ? THEME_UNLOCK_BADGES[entry.badge] : undefined;

	if (!open || !entry) return null;

	// Visual per perk type — matches the celebration screen.
	const perkVisual = (p: Perk) => {
		switch (p.type) {
			case "theme":
				return { Icon: Palette, ring: "border-violet-400/50 bg-violet-500/15 text-violet-300" };
			case "ring":
				return { Icon: Circle, ring: "border-amber-400/50 bg-amber-500/15 text-amber-300" };
			case "aura":
				return { Icon: Sparkles, ring: "border-fuchsia-400/50 bg-fuchsia-500/15 text-fuchsia-300" };
			case "flair":
				return { Icon: BadgeCheck, ring: "border-sky-400/50 bg-sky-500/15 text-sky-300" };
			case "stamp":
				return { Icon: Trophy, ring: "border-emerald-400/50 bg-emerald-500/15 text-emerald-300" };
			case "confetti":
				return { Icon: PartyPopper, ring: "border-rose-400/50 bg-rose-500/15 text-rose-300" };
		}
	};

	const v = perk ? perkVisual(perk) : null;

	return (
		<AnimatePresence>
			{open && (
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
					onClick={onClose}
				>
					<motion.div
						initial={{ scale: 0.92, y: 24, opacity: 0 }}
						animate={{ scale: 1, y: 0, opacity: 1 }}
						exit={{ scale: 0.94, opacity: 0 }}
						transition={{ type: "spring", damping: 22, stiffness: 240 }}
						onClick={(e) => e.stopPropagation()}
						className="relative w-full max-w-md overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950/95 p-6 shadow-2xl"
					>
						{/* Header glow */}
						<div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-violet-600/20 blur-3xl" />

						<button
							onClick={onClose}
							aria-label="Close"
							className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-zinc-500 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
						>
							<X className="h-4 w-4" />
						</button>

						{/* Badge icon */}
						<div className="relative mx-auto mb-3 flex h-20 w-20 items-center justify-center">
							<motion.div
								initial={{ scale: 0.6, rotate: -12 }}
								animate={{ scale: 1, rotate: 0 }}
								transition={{ type: "spring", damping: 12, stiffness: 200 }}
								className={`flex h-16 w-16 items-center justify-center rounded-2xl border-2 ${
									has
										? "border-amber-400/60 bg-gradient-to-br from-amber-500/30 to-amber-600/10 shadow-[0_0_30px_rgba(245,158,11,0.25)]"
										: "border-zinc-700 bg-zinc-900"
								}`}
							>
								{has ? (
									<entry.Icon className="h-8 w-8 text-amber-400" />
								) : (
									<Lock className="h-7 w-7 text-zinc-600" />
								)}
							</motion.div>
							{has && (
								<motion.span
									initial={{ scale: 0.6, opacity: 0.9 }}
									animate={{ scale: 1.5, opacity: 0 }}
									transition={{ duration: 1.1, repeat: Infinity, ease: "easeOut" }}
									className="absolute inset-0 rounded-2xl border-2 border-amber-400/50"
								/>
							)}
						</div>

						<div className="text-center">
							<p className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">
								Achievement
							</p>
							<h3 className="mt-1 text-2xl font-black text-white">
								{entry.label}
							</h3>
							<p className="mt-1 text-sm text-zinc-400">{entry.description}</p>

							{/* Status pill */}
							<div className="mt-2.5 flex items-center justify-center gap-1.5">
								{has ? (
									<span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] font-bold text-emerald-400">
										<Trophy className="h-3 w-3" /> Unlocked
									</span>
								) : (
									<span className="inline-flex items-center gap-1 rounded-full bg-zinc-800 px-2.5 py-1 text-[10px] font-bold text-zinc-400">
										<Lock className="h-3 w-3" /> Locked
										{progressText ? ` · ${progressText}` : ""}
									</span>
								)}
							</div>
						</div>

						{/* ── Perk reward card ── */}
						{perk && v && (
							<div
								className={`mt-5 rounded-2xl border p-4 transition-all ${
									has
										? "border-emerald-500/25 bg-emerald-500/5"
										: "border-amber-500/25 bg-gradient-to-br from-amber-500/10 to-transparent"
								}`}
							>
								<div className="flex items-center gap-3">
									<span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${v.ring}`}>
										<v.Icon className="h-5 w-5" />
									</span>
									<div className="min-w-0">
										<p className="text-[9px] font-black uppercase tracking-wider text-zinc-500">
											{has ? "Perk unlocked" : "Perk you'll get"}
										</p>
										<p className="text-sm font-black text-white">
											{perk.title}
											{unlockedTheme && (
												<span className="ml-1.5 rounded-full bg-violet-500/20 px-2 py-0.5 text-[9px] font-bold text-violet-300">
													{unlockedTheme === "aurora" ? "Theme: Aurora" : "Theme: Ember"}
												</span>
											)}
										</p>
									</div>
								</div>

								<p className="mt-2.5 text-xs leading-relaxed text-zinc-300">
									{perk.description}
								</p>

								{/* How to use — collapsible on small screens */}
								<div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-3">
									<button
										type="button"
										onClick={() => setExpanded((e) => !e)}
										className="flex w-full items-center justify-between text-left cursor-pointer"
									>
										<span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
											<Sparkles className="h-3 w-3 text-amber-400" />
											{has ? "How to use it" : "Where you'll use it"}
										</span>
										<ArrowRight
											className={`h-3.5 w-3.5 text-zinc-500 transition-transform ${expanded ? "rotate-90" : ""}`}
										/>
									</button>
									{expanded && (
										<p className="mt-2 text-xs leading-relaxed text-zinc-300">
											{perk.howToUse}
										</p>
									)}
								</div>

								{/* Theme perk CTA — jump straight to Appearance */}
								{has && unlockedTheme && onOpenAppearance && (
									<button
										type="button"
										onClick={onOpenAppearance}
										className="mt-3 w-full rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 py-2.5 text-sm font-bold text-white shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
									>
										Enable {unlockedTheme === "aurora" ? "Aurora" : "Ember"} now
									</button>
								)}
							</div>
						)}

						<button
							type="button"
							onClick={onClose}
							className="mt-4 w-full rounded-full border border-zinc-700 py-2.5 text-sm font-bold text-zinc-300 transition-colors hover:bg-white/5 cursor-pointer"
						>
							{has ? "Done" : "I'll get there 💪"}
						</button>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
