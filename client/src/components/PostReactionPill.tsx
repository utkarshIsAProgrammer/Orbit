import { useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { Smile } from "lucide-react";
import type { CommentReaction, User } from "../types";
import { apiFetch } from "../utils/api";
import { logger } from "../utils/logger";
import EmojiReactionMenu from "./EmojiReactionMenu";

interface PostReactionPillProps {
	postId: string;
	postReactions?: CommentReaction[];
	user: User | null;
	/** Mirrors the `readOnly` mode used by the rest of the card. */
	readOnly?: boolean;
}

/**
 * Post emoji reactions — mirrors the comment/message reaction system exactly:
 * one active emoji per user (a new emoji replaces the old), tapping the same
 * emoji toggles it off. The pill shows grouped reactions with counts and a
 * Smile trigger that opens the SAME EmojiReactionMenu used everywhere else in
 * the app. Realtime updates arrive via the `postReactionChanged` window event
 * (dispatched by App.tsx from the `post:reaction` socket event).
 */
export default function PostReactionPill({
	postId,
	postReactions,
	user,
	readOnly = false,
}: PostReactionPillProps) {
	const [reactions, setReactions] = useState<CommentReaction[]>(
		postReactions || [],
	);

	// Sync when the post prop changes (feed refetch, cache refresh, etc.).
	// IMPORTANT: preserve the current user's own reaction from local state —
	// a parent refresh may carry stale reactions (cached data) that would
	// otherwise revert an optimistic/local reaction the user just applied.
	// Remote reactions from other users still merge in.
	useEffect(() => {
		if (!user) {
			setReactions(postReactions || []);
			return;
		}
		setReactions((local) => {
			const myLocal = (local || []).find((r) => {
				const sId = typeof r.sender === "string" ? r.sender : r.sender?._id;
				return sId === user._id;
			});
			if (!myLocal) return postReactions || [];
			// Strip my stale entry from the prop list, then re-append my local one
			const merged = (postReactions || []).filter((r) => {
				const sId = typeof r.sender === "string" ? r.sender : r.sender?._id;
				return sId !== user._id;
			});
			return [...merged, myLocal];
		});
	}, [postReactions, user]);

	// Realtime: other users' reactions (add/remove) update this pill in place
	useEffect(() => {
		const handleReactionChanged = (
			e: CustomEvent<{
				postId: string;
				reaction: any;
				type: "add" | "remove";
			}>,
		) => {
			const { postId: pid, reaction, type } = e.detail;
			if (pid !== postId) return;
			setReactions((prev) => {
				if (type === "add" && reaction) {
					const senderId =
						typeof reaction.sender === "string"
							? reaction.sender
							: reaction.sender?._id;
					const filtered = prev.filter((r) => {
						const sId =
							typeof r.sender === "string" ? r.sender : r.sender?._id;
						return sId !== senderId;
					});
					return [...filtered, reaction];
				} else if (type === "remove" && reaction) {
					const senderId =
						typeof reaction.sender === "string"
							? reaction.sender
							: reaction.sender?._id;
					return prev.filter((r) => {
						const sId =
							typeof r.sender === "string" ? r.sender : r.sender?._id;
						return !(sId === senderId && r.emoji === reaction.emoji);
					});
				}
				return prev;
			});
		};
		window.addEventListener(
			"postReactionChanged",
			handleReactionChanged as EventListener,
		);
		return () =>
			window.removeEventListener(
				"postReactionChanged",
				handleReactionChanged as EventListener,
			);
	}, [postId]);

	const handleReaction = useCallback(
		async (emoji: string) => {
			if (!user || readOnly) return;

			// 1. Optimistic update
			const userId = user._id;
			const existingIndex = (reactions || []).findIndex((r) => {
				const sId = typeof r.sender === "string" ? r.sender : r.sender?._id;
				return sId === userId && r.emoji === emoji;
			});

			let nextReactions = [...(reactions || [])];
			if (existingIndex >= 0) {
				nextReactions.splice(existingIndex, 1);
			} else {
				nextReactions = nextReactions.filter((r) => {
					const sId = typeof r.sender === "string" ? r.sender : r.sender?._id;
					return sId !== userId;
				});
				nextReactions.push({
					_id: Date.now().toString(),
					emoji,
					sender: {
						_id: user._id,
						username: user.username,
						fullName: user.fullName,
						profilePic: user.profilePic,
					},
					createdAt: new Date().toISOString(),
				} as any);
			}
			setReactions(nextReactions);

			try {
				const res = await apiFetch(`/api/posts/${postId}/reactions`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ emoji }),
				});
				const data = await res.json();
				if (res.ok && data.success && data.reactions) {
					setReactions(data.reactions);
				} else {
					setReactions(reactions);
				}
			} catch (e) {
				logger.error("Failed to react to post", e);
				setReactions(reactions);
			}
		},
		[user, readOnly, reactions, postId],
	);

	// Group reactions by emoji (max 10 unique) — same as comments/messages
	const groupedReactions = (() => {
		if (!reactions || reactions.length === 0) return {};
		const entries = Object.entries(
			reactions.reduce(
				(acc, r) => {
					if (!acc[r.emoji]) acc[r.emoji] = { count: 0, hasReacted: false };
					acc[r.emoji].count++;
					const sId = typeof r.sender === "string" ? r.sender : r.sender?._id;
					if (sId === user?._id) acc[r.emoji].hasReacted = true;
					return acc;
				},
				{} as Record<string, { count: number; hasReacted: boolean }>,
			),
		);
		return Object.fromEntries(entries.slice(0, 10));
	})();

	const hasAny = Object.keys(groupedReactions).length > 0;

	return (
		<div className="flex items-center gap-1 flex-wrap">
			{hasAny &&
				Object.entries(groupedReactions).map(([emoji, data]) => (
					<motion.button
						key={emoji}
						layout
						initial={{ opacity: 0, scale: 0.8 }}
						animate={{ opacity: 1, scale: 1 }}
						transition={{
							type: "spring",
							stiffness: 400,
							damping: 25,
						}}
						onClick={() => !readOnly && handleReaction(emoji)}
						disabled={readOnly}
						title={data.hasReacted ? "Remove reaction" : `React with ${emoji}`}
						className={`flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[11px] transition-colors cursor-pointer disabled:cursor-default ${
							data.hasReacted
								? "bg-white/10 border-white/20 text-white"
								: "bg-white/3 border-white/5 text-zinc-400 hover:bg-white/5"
						}`}
					>
						<span>{emoji}</span>
						<span className="text-[8px] font-bold">{data.count}</span>
					</motion.button>
				))}

			{!readOnly && (
				<EmojiReactionMenu
					onReact={handleReaction}
					direction="up"
					ariaLabel="React to this post"
					triggerContent={
						<>
							<Smile
								className={`h-4 w-4 ${
									hasAny ? "" : "text-zinc-500"
								}`}
							/>
							<span className="text-[11px] font-semibold">
								{reactions.length > 0 ? reactions.length : ""}
							</span>
						</>
					}
					triggerClassName={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-sm font-semibold select-none transition-colors cursor-pointer ${
						hasAny
							? "border-white/15 bg-white/5 text-zinc-300 hover:border-white/25 hover:text-white"
							: "border-transparent text-zinc-500 hover:text-white"
					}`}
				/>
			)}
		</div>
	);
}
