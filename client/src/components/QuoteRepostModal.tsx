import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { X, Loader2, Quote as QuoteIcon } from "lucide-react";
import type { Post } from "../types";
import UserAvatar from "./UserAvatar";
import { useAutoGrow } from "../hooks/useAutoGrow";
import { usePostViewTracking } from "../hooks/usePostViewTracking";
import { optimizeImageUrl } from "../utils/imageUrls";

interface QuoteRepostModalProps {
	post: Post;
	isOpen: boolean;
	onClose: () => void;
	onSubmit: (quoteContent: string) => Promise<void>;
}

export default function QuoteRepostModal({
	post,
	isOpen,
	onClose,
	onSubmit,
}: QuoteRepostModalProps) {
	const [quoteText, setQuoteText] = useState("");
	const quoteTextRef = useAutoGrow<HTMLTextAreaElement>(quoteText);
	const [submitting, setSubmitting] = useState(false);

	// Reset state when modal opens
	useEffect(() => {
		if (isOpen) {
			setQuoteText("");
			setSubmitting(false);
			// Focus textarea after animation
			setTimeout(() => quoteTextRef.current?.focus(), 200);
		}
	}, [isOpen]);

	// Close on Escape
	useEffect(() => {
		if (!isOpen) return;
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", handleKey);
		return () => window.removeEventListener("keydown", handleKey);
	}, [isOpen, onClose]);

	const handleSubmit = async () => {
		const trimmed = quoteText.trim();
		if (!trimmed || submitting) return;
		setSubmitting(true);
		try {
			await onSubmit(trimmed.slice(0, 1000));
			onClose();
		} finally {
			setSubmitting(false);
		}
	};

	// View tracking for the shared post preview — a post being quote-reposted
	// (shared) is "opened" on screen, so it counts a view after 3s.
	usePostViewTracking({
		enabled: isOpen,
		deps: [isOpen, post._id],
	});

	if (!isOpen) return null;

	return createPortal(
		<AnimatePresence>
			<motion.div
				key="quote-repost-overlay"
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				exit={{ opacity: 0 }}
				transition={{ duration: 0.15 }}
				className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
				onClick={(e) => {
					if (e.target === e.currentTarget) onClose();
				}}>
				<motion.div
					initial={{ opacity: 0, scale: 0.95, y: 20 }}
					animate={{ opacity: 1, scale: 1, y: 0 }}
					exit={{ opacity: 0, scale: 0.95, y: 20 }}
					transition={{ duration: 0.2, ease: "easeOut" }}
					className="w-full max-w-lg rounded-3xl border border-zinc-800/60 bg-zinc-950/90 backdrop-blur-2xl shadow-2xl overflow-hidden">
					{/* Header */}
					<div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-zinc-800/40">
						<div className="flex items-center gap-2.5">
							<QuoteIcon className="h-4 w-4 text-zinc-400" />
							<h2 className="text-label text-lg font-semibold text-white">
								Quote Repost
							</h2>
						</div>
						<button
							onClick={onClose}
							className="p-1.5 rounded-full hover:bg-zinc-800 transition-colors cursor-pointer">
							<X className="h-4 w-4 text-zinc-400" />
						</button>
					</div>

					{/* Original post preview */}
					<div className="px-5 pt-4 pb-3" data-post-id={post._id}>
						<div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/50 p-3.5">
							<div className="flex items-center gap-2.5 mb-2">
								<UserAvatar
									src={post.author?.profilePic?.url}
									alt={post.author?.username || "user"}
									className="h-5 w-5 rounded-full object-cover border border-zinc-700 shrink-0"
								/>
								<span className="text-[11px] font-bold text-zinc-300 truncate">
									@{post.author?.username}
								</span>
							</div>
							{post.title && (
								<p className="text-xs font-semibold text-zinc-200 mb-1 leading-snug">
									{post.title}
								</p>
							)}
							{post.content && (
								<p className="text-[11px] text-zinc-400 leading-relaxed line-clamp-3">
									{post.content}
								</p>
							)}
							{post.image?.url && (
								<img
									src={optimizeImageUrl(post.image.url, 800)}
									alt=""
									className="mt-2 rounded-xl max-h-24 w-full object-cover"
								/>
							)}
						</div>
					</div>

					{/* Your comment textarea */}
					<div className="px-5 pb-3">
						<label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2 block">
							Add your comment
						</label>
						<textarea
							ref={quoteTextRef}
							value={quoteText}
							onChange={(e) =>
								setQuoteText(e.target.value)
							}
							placeholder="What's on your mind?"
							maxLength={1000}
							rows={3}
							className="w-full bg-zinc-900/60 border border-zinc-800/60 !rounded-lg px-3.5 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none resize-none focus:border-zinc-600/60 transition-colors"
						/>
						<div className="flex items-center justify-between mt-1.5">
							<span className="text-[10px] text-zinc-500">
								{quoteText.length}/1000
							</span>
						</div>
					</div>

					{/* Actions */}
					<div className="flex items-center justify-end gap-2.5 px-5 pb-5 pt-2">
						<button
							onClick={onClose}
							className="px-4 py-2 rounded-full text-xs font-bold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-all cursor-pointer">
							Cancel
						</button>
						<button
							onClick={handleSubmit}
							disabled={
								!quoteText.trim() || submitting
							}
							className="px-5 py-2 rounded-full text-xs font-bold text-white bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2 cursor-pointer">
							{submitting && (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							)}
							{submitting
								? "Posting..."
								: "Quote Repost"}
						</button>
					</div>
				</motion.div>
			</motion.div>
		</AnimatePresence>,
		document.body,
	);
}
