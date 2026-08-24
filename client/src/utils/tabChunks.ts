/**
 * Per-tab chunk prefetch — the heart of "each tab loads its own chunk".
 *
 * Every tab component is already code-split (React.lazy in App.tsx), but an
 * idle preloader that eagerly downloads ALL tab chunks at once defeats that
 * split. Instead, we prefetch a tab's chunk only when the user is *about* to
 * open it (hover on desktop, tap on mobile), so navigation stays instant
 * while tabs the user never visits are never downloaded.
 *
 * These dynamic imports share the exact same chunk boundaries as the
 * React.lazy declarations in App.tsx (Rollup dedupes identical dynamic
 * imports), so prefetching here warms the same chunk the tab will render.
 */

const TAB_CHUNKS: Record<string, () => Promise<unknown>> = {
	home: () => import("../components/Feed"),
	saved: () => import("../components/Feed"),
	reposts: () => import("../components/Feed"),
	explore: () => import("../components/Explore"),
	notifications: () => import("../components/Notifications"),
	chat: () => import("../components/Chat"),
	communities: () => import("../components/Communities"),
	profile: () => import("../components/Profile"),
	settings: () => import("../components/Settings"),
	admin: () => import("../components/AdminDashboard"),
	// The composer modal — the single most-tapped control after any tab's
	// main content. Tiny chunk (~17 KB), so preloading it costs nothing.
	composer: () => import("../components/PostModal"),
};

const prefetched = new Set<string>();

/** Fetch a tab's chunk in the background. Idempotent — a tab's chunk is only
 *  requested once per session, so repeated hovers are free. */
export function prefetchTabChunk(tabId: string): void {
	if (prefetched.has(tabId)) return;
	prefetched.add(tabId);
	const loader = TAB_CHUNKS[tabId];
	if (loader) {
		void loader().catch(() => {
			// Chunk fetch failed (offline?) — allow a retry next hover.
			prefetched.delete(tabId);
		});
	}
}

/**
 * The tabs a logged-in user is statistically most likely to open next,
 * ranked by how often each is tapped in a typical session.
 *
 * Home (Feed) is excluded — it's the landing tab and renders immediately.
 * Settings / saved / reposts / admin stay on-demand: they're visited rarely
 * enough that preloading them would waste bandwidth for no felt benefit.
 * Admin also stays gated — it must not download for non-admins at all.
 */
const LIKELY_NEXT_TABS = [
	"chat",
	"notifications",
	"explore",
	"communities",
	"profile",
] as const;

/**
 * Idle-time preloading of the most-likely next screens.
 *
 * Hover/tap prefetch only helps the tab the user ALREADY aimed at — the
 * first tap on any other tab still pays a full chunk download (100-300 ms
 * on mobile). Once the session exists, the browser is idle right after the
 * home screen renders, so this spends that idle window downloading the few
 * tabs users actually open next. Deliberately a subset — see
 * LIKELY_NEXT_TABS — and skipped entirely on data-saver connections.
 */
export function prefetchLikelyNextTabs(): void {
	// Data-saver mode: don't burn the user's mobile data on speculative
	// downloads. Hover/tap prefetch still works (intent-based, tiny).
	if (
		typeof navigator !== "undefined" &&
		(navigator as any).connection?.saveData === true
	) {
		return;
	}
	for (const tab of LIKELY_NEXT_TABS) {
		prefetchTabChunk(tab);
	}
	prefetchTabChunk("composer");
}
