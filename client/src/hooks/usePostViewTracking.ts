import { useEffect, useRef } from "react";
import { apiFetch } from "../utils/api";

/**
 * Shared, app-wide dedup set for post views. Lives at module scope so that:
 *  - the IntersectionObserver hook and Feed's media onPlay/onLoad calls share
 *    ONE counter per post (no double-counting), and
 *  - two simultaneously-mounted view-tracking components (e.g. Feed/Profile
 *    with a QuoteRepostModal portal on top) can't both count the same post.
 * Reset on a full page reload, which is the expected "new visit" boundary.
 */
const registeredPostViews = new Set<string>();

/**
 * Register a view for a post (fire-and-forget). Deduped app-wide — each post
 * counts at most once per session/page-load. Exported so media handlers
 * (onPlay/onLoad) can count instantly through the same dedup as the hook.
 *
 * Also safe to call from interaction handlers (like/save/comment/repost) —
 * the dedup guarantees those never double-count a post that was already
 * counted by the visibility observer.
 */
export const registerPostView = (postId: string) => {
	if (registeredPostViews.has(postId)) return;
	registeredPostViews.add(postId);
	apiFetch(`/api/posts/${postId}/view`, { method: "POST" })
		.then(async (res) => {
			// Update the visible count IMMEDIATELY via the same event the socket
			// path uses — the UI no longer depends on a socket round-trip to
			// show the new count (views used to "not count" because the count
			// only updated when post:view arrived over the socket).
			if (res.ok) {
				try {
					const data = await res.json();
					if (typeof data?.views === "number") {
						window.dispatchEvent(
							new CustomEvent("postViewUpdated", {
								detail: { postId, viewsCount: data.views },
							}),
						);
					}
				} catch {
					/* non-critical */
				}
			}
		})
		.catch(() => {
			// Allow a later re-visit to count this post.
			registeredPostViews.delete(postId);
		});
};

interface UsePostViewTrackingOptions {
	/** When false, tracking is disabled (e.g. still loading). */
	enabled?: boolean;
	/** Extra callback fired when a post card enters the viewport. */
	onIntersect?: (postId: string) => void;
	/**
	 * Re-run the DOM re-scan when these change (e.g. [posts, loading]). NOTE:
	 * this only OBSERVES newly-rendered cards — it never disconnects the
	 * observer or cancels in-flight dwell timers. The old implementation
	 * re-created the observer on every change, which meant the 3s timer was
	 * cancelled the instant a socket event (like/comment/other-user-view) or
	 * the 30s cache refresh created a new `posts` array — views never fired.
	 */
	deps: unknown[];
}

/**
 * Reusable post-view tracking: any element with a `data-post-id` attribute
 * that stays visible (threshold 0.3) for 3+ consecutive seconds registers one
 * view via `registerPostView` — once per post per session, fire-and-forget.
 *
 * The IntersectionObserver is created ONCE per mount and kept alive across
 * data changes; a lightweight re-scan only adds newly-rendered cards, so
 * realtime updates no longer reset the dwell timer.
 *
 * Shared by Feed (home), Profile (posts/saved/reposts tabs), Explore
 * (trending + search posts) and share surfaces, so views increase on every
 * screen that shows a post — matching the user's expectation that a post
 * "opened" anywhere counts a view.
 */
export function usePostViewTracking({
	enabled = true,
	onIntersect,
	deps,
}: UsePostViewTrackingOptions) {
	const viewTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
		new Map(),
	);
	const observerRef = useRef<IntersectionObserver | null>(null);
	const onIntersectRef = useRef(onIntersect);
	onIntersectRef.current = onIntersect;

	// ── 1. Observer lifecycle — created once, kept alive ────────────
	useEffect(() => {
		if (!enabled) return;

		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					const postId = entry.target.getAttribute("data-post-id");
					if (!postId) return;

					if (entry.isIntersecting) {
						onIntersectRef.current?.(postId);
						// Start 3-second timer if not already pending or counted
						if (
							!registeredPostViews.has(postId) &&
							!viewTimersRef.current.has(postId)
						) {
							const timer = setTimeout(() => {
								viewTimersRef.current.delete(postId);
								registerPostView(postId);
							}, 3000);
							viewTimersRef.current.set(postId, timer);
						}
					} else {
						// Left viewport before 3 seconds — cancel timer
						const timer = viewTimersRef.current.get(postId);
						if (timer) {
							clearTimeout(timer);
							viewTimersRef.current.delete(postId);
						}
					}
				});
			},
			{ threshold: 0.3 },
		);
		observerRef.current = observer;

		// Initial scan — observe whatever post cards are already mounted.
		document
			.querySelectorAll("[data-post-id]")
			.forEach((card) => observer.observe(card));

		return () => {
			observer.disconnect();
			observerRef.current = null;
			viewTimersRef.current.forEach((timer) => clearTimeout(timer));
			viewTimersRef.current.clear();
		};
	}, [enabled]);

	// ── 2. Re-scan — observe newly-rendered cards WITHOUT tearing down ──
	useEffect(() => {
		if (!enabled || !observerRef.current) return;
		const observer = observerRef.current;
		// Drop cards that were removed from the DOM (e.g. switching profile
		// tabs fully replaces the list) so the persistent observer doesn't
		// hold references to detached nodes.
		observer
			.takeRecords()
			.forEach((entry) => {
				if (!entry.target.isConnected) observer.unobserve(entry.target);
			});
		document
			.querySelectorAll("[data-post-id]")
			.forEach((card) => observer.observe(card));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, deps);
}
