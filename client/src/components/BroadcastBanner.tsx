import { useEffect, useState } from "react";
import { Megaphone, X } from "lucide-react";
import { apiFetch } from "../utils/api";
import { useCacheRefresh } from "../hooks/useCacheRefresh";
import { logger } from "../utils/logger";

/**
 * BroadcastBanner — shows the admin's active announcement to every user.
 * Appears instantly via socket (window events dispatched from App.tsx),
 * and is re-fetched on mount/reload + on the cache-refresh cycle so
 * offline-returning users still see it.
 */
export default function BroadcastBanner() {
	const [broadcast, setBroadcast] = useState<{
		_id: string;
		title: string;
		message: string;
		type: string;
		createdAt: string;
	} | null>(null);
	const [dismissed, setDismissed] = useState(false);

	const fetchActive = async () => {
		try {
			const res = await apiFetch(`/api/admin/broadcasts/active`);
			const data = await res.json();
			if (res.ok && data.success) {
				setBroadcast(data.broadcast || null);
				if (!data.broadcast) setDismissed(false);
			}
		} catch (err) {
			logger.error("Failed to fetch active broadcast", err);
		}
	};

	useEffect(() => {
		void fetchActive();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Re-poll on the background cache-refresh cycle so new announcements
	// appear even without a socket connection.
	useCacheRefresh("/api/admin/broadcasts/active", () => fetchActive());

	useEffect(() => {
		const onBroadcast = (e: Event) => {
			const b = (e as CustomEvent).detail;
			if (b && b._id) {
				setBroadcast(b);
				setDismissed(false);
			}
		};
		const onClear = () => {
			setBroadcast(null);
			setDismissed(false);
		};
		window.addEventListener("orbit:broadcast", onBroadcast);
		window.addEventListener("orbit:broadcast:clear", onClear);
		return () => {
			window.removeEventListener("orbit:broadcast", onBroadcast);
			window.removeEventListener("orbit:broadcast:clear", onClear);
		};
	}, []);

	if (!broadcast || dismissed) return null;

	return (
		<div className="relative z-[700] w-full border-b border-amber-500/20 bg-gradient-to-r from-amber-500/15 via-amber-400/10 to-amber-500/15 backdrop-blur-xl">
			<div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
				<Megaphone className="h-4 w-4 shrink-0 text-amber-300" />
				<div className="min-w-0 flex-1">
					{broadcast.title && (
						<p className="text-[11px] font-black uppercase tracking-wider text-amber-200 truncate">
							{broadcast.title}
						</p>
					)}
					<p className="text-[11px] text-zinc-300 truncate">{broadcast.message}</p>
				</div>
				<button
					type="button"
					onClick={() => setDismissed(true)}
					className="shrink-0 rounded-full p-1 text-zinc-400 hover:text-white transition-colors cursor-pointer"
					aria-label="Dismiss announcement"
				>
					<X className="h-3.5 w-3.5" />
				</button>
			</div>
		</div>
	);
}
