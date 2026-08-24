import { useState, useCallback } from "react";
import { Check, Clock, BarChart3 } from "lucide-react";
import type { PostPoll } from "../types";
import { apiFetch } from "../utils/api";
import { logger } from "../utils/logger";

interface PollCardProps {
	postId: string;
	poll: PostPoll;
	readOnly?: boolean;
	onPollUpdated?: (postId: string, poll: PostPoll) => void;
}

/**
 * Interactive poll card rendered inside a post.
 *
 * Shows one option per row with a live percentage bar. A user can tap an
 * option to vote; once voted (or when the poll has expired / the viewer is
 * in read-only mode) the results are shown with the user's choice highlighted.
 */
export default function PollCard({
	postId,
	poll,
	readOnly = false,
	onPollUpdated,
}: PollCardProps) {
	const [voting, setVoting] = useState(false);
	const [voteError, setVoteError] = useState<string | null>(null);

	const myVote = poll.myVote ?? null;
	const expired = poll.expired ?? (poll.expiresAt ? new Date(poll.expiresAt) < new Date() : false);
	const totalVotes = poll.totalVotes || 0;
	const hasVoted = myVote !== null && myVote !== undefined;
	const locked = readOnly || expired || hasVoted || voting;

	const percentFor = useCallback(
		(index: number) => {
			if (totalVotes === 0) return 0;
			const votes = poll.options[index]?.votes ?? 0;
			return Math.round((votes / totalVotes) * 100);
		},
		[poll.options, totalVotes],
	);

	const handleVote = async (optionIndex: number) => {
		if (locked || voting) return;
		setVoting(true);
		setVoteError(null);

		// ── Optimistic update — show the result instantly, no waiting for
		// the network round-trip. The bar fills, myVote locks the option,
		// and the server response reconciles (or we revert on failure).
		const optimisticPoll: PostPoll = {
			...poll,
			totalVotes: poll.totalVotes + 1,
			myVote: optionIndex,
			options: poll.options.map((opt, i) =>
				i === optionIndex
					? { ...opt, votes: opt.votes + 1 }
					: opt,
			),
		};
		onPollUpdated?.(postId, optimisticPoll);

		try {
			const res = await apiFetch(`/api/posts/${postId}/vote`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ optionIndex }),
			});
			const data = await res.json();
			if (!res.ok) {
				// Server rejected (e.g. already voted elsewhere) — if it returned
				// authoritative poll state, apply it; otherwise revert & surface error.
				if (data.poll) {
					onPollUpdated?.(postId, data.poll);
				} else {
					onPollUpdated?.(postId, poll);
				}
				throw new Error(data.message || "Failed to record your vote.");
			}
			if (data.poll) {
				onPollUpdated?.(postId, data.poll);
			}
		} catch (err: any) {
			logger.error("Poll vote failed", err);
			setVoteError(err.message || "Failed to record your vote. Please try again.");
		} finally {
			setVoting(false);
		}
	};

	const showResults = locked && totalVotes > 0;
	const leadingOptionIndex = poll.options.reduce(
		(best, opt, i) => (opt.votes > (poll.options[best]?.votes ?? 0) ? i : best),
		0,
	);

	return (
		<div className="mt-3 space-y-2">
			{poll.options.map((opt, idx) => {
				const pct = percentFor(idx);
				const isMyVote = myVote === idx;
				const isLeading = showResults && idx === leadingOptionIndex;
				return (
					<button
						key={idx}
						type="button"
						disabled={locked}
						onClick={() => handleVote(idx)}
						className={`relative w-full overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-all ${
							locked
							? isMyVote
								? "border-amber-100/70 bg-gradient-to-br from-white via-white to-amber-50/40 text-zinc-900 shadow-[0_0_10px_-6px_rgba(251,191,36,0.18),inset_0_1px_0_rgba(255,255,255,0.95)] ring-1 ring-inset ring-amber-200/25"
									: "border-zinc-700/40 bg-zinc-900/30"
								: "border-zinc-700/40 bg-zinc-900/30 hover:border-amber-400/50 hover:bg-zinc-800/50 active:scale-[0.99]"
						} ${locked ? "cursor-default" : "cursor-pointer"}`}
					>
						{/* Percentage fill bar */}
						{showResults && pct > 0 && (
							<span
								className={`absolute inset-y-0 left-0 rounded-l-xl transition-all duration-500 ${
								isMyVote
									? "bg-gradient-to-r from-amber-200/25 to-amber-300/15"
										: isLeading
											? "bg-amber-400/10"
											: "bg-zinc-700/20"
								}`}
								style={{ width: `${Math.max(pct, 3)}%` }}
							/>
						)}
						<span className="relative flex items-center justify-between gap-2">
							<span className={`flex items-center gap-2 text-sm min-w-0 ${isMyVote ? "font-extrabold text-amber-950" : "font-semibold text-zinc-200"}`}>
								{isMyVote && (
									<Check className="h-4 w-4 shrink-0 text-amber-700/90 drop-shadow-[0_0_2px_rgba(251,191,36,0.2)]" strokeWidth={3} />
								)}
								<span className="truncate">{opt.text}</span>
							</span>
							{showResults && (									<span className={`relative shrink-0 text-xs font-bold tabular-nums ${isMyVote ? "text-amber-900" : "text-zinc-400"}`}>
										{pct}% · {opt.votes}
									</span>
							)}
						</span>
					</button>
				);
			})}

			{/* Footer: vote count / expiry / error */}
			<div className="flex flex-wrap items-center justify-between gap-2 px-1">
				<span className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-500">
					<BarChart3 className="h-3 w-3" />
					{totalVotes} vote{totalVotes === 1 ? "" : "s"}
					{hasVoted && <span className="text-amber-400">· Voted</span>}
				</span>
				{poll.expiresAt && (
					<span className="flex items-center gap-1 text-[10px] font-semibold text-zinc-500">
						<Clock className="h-3 w-3" />
						{expired ? "Closed" : `Closes ${new Date(poll.expiresAt).toLocaleString()}`}
					</span>
				)}
			</div>

			{voteError && (
				<p className="text-[11px] font-semibold text-red-400 px-1">{voteError}</p>
			)}
		</div>
	);
}
