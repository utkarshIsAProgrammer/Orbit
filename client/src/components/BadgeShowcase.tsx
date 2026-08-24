import { useMemo } from "react";
import { Lock } from "lucide-react";
import { BADGE_CATALOG } from "../utils/badgeCatalog";

/**
 * The full badge catalog rendered as earned/locked tiles — every badge the
 * server can award (XP milestones, level milestones, referral tiers, streak
 * tiers, creator/reach/engagement tiers, founder). Earned badges render in
 * gold, locked ones greyed out, so achievements motivate: you can always
 * see the ones you don't have yet.
 */
export default function BadgeShowcase({ badges }: { badges: string[] }) {
	const earned = useMemo(() => new Set(badges || []), [badges]);

	return (
		<div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
			{BADGE_CATALOG.map(({ badge, label, description, Icon }) => {
				const has = earned.has(badge);
				return (
					<div
						key={badge}
						title={`${label} — ${description}`}
						className={`flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 transition-all ${
							has
								? "border-amber-500/25 bg-amber-500/5"
								: "border-zinc-800/60 bg-zinc-950/40 opacity-60"
						}`}
					>
						<span
							className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${
								has
									? "border-amber-500/40 bg-amber-500/10 text-amber-400"
									: "border-zinc-800 bg-zinc-900/40 text-zinc-700"
							}`}
						>
							{has ? <Icon className="h-4 w-4" /> : <Lock className="h-3.5 w-3.5" />}
						</span>
						<div className="min-w-0">
							<p className={`text-[11px] font-bold truncate ${has ? "text-white" : "text-zinc-500"}`}>
								{label}
							</p>
							<p className="text-[9px] text-zinc-500 truncate">{description}</p>
						</div>
					</div>
				);
			})}
		</div>
	);
}
