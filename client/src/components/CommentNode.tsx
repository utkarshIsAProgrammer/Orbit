import React, { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import { User, Comment, CommentReaction } from "../types";
import {
	Reply,
	Smile,
	Heart,
	Edit3,
	Check,
	X as XIcon,
	MoreHorizontal,
	Share2,
	Languages,
	Flag,
} from "lucide-react";
import UserAvatar from "./UserAvatar";
import VerifiedBadge from "./VerifiedBadge";
import DayOneFlair from "./DayOneFlair";
import EmojiReactionMenu from "./EmojiReactionMenu";
import TranslateInline from "./TranslateInline";
import LinkPreviewCard from "./LinkPreviewCard";
import ShareMenu from "./ShareMenu";
import ForwardModal, { ForwardPartner } from "./ForwardModal";
import ReportButton from "./ReportButton";
import { apiFetch } from "../utils/api";
import { extractFirstUrl } from "../utils/links";
import { logger } from "../utils/logger";
import { useAutoGrow } from "../hooks/useAutoGrow";

interface CommentNodeProps {
	key?: React.Key;
	comment: Comment;
	user: User | null;
	onUserSelected: (username: string) => void;
	onReply: (commentId: string) => void;
	depth?: number;
	getRelativeDate: (date: string) => string;
	renderFormattedContent: (content: string) => React.ReactNode;
	/** Slug of the post this comment belongs to (used for share/copy link). */
	postSlug?: string;
}

export default function CommentNode({
	comment,
	user,
	onUserSelected,
	onReply,
	depth = 0,
	getRelativeDate,
	renderFormattedContent,
	postSlug,
}: CommentNodeProps) {
	const [forwardComment, setForwardComment] = useState<Comment | null>(null);
	// Comment being reported — the modal renders OUTSIDE the three-dot menu so
	// closing the menu can't unmount it mid-open (see the report item below).
	const [reportCommentId, setReportCommentId] = useState<string | null>(null);  // Copy the comment link (points at the post, scrolls to the comment).
  // External comments (on imported web posts) have no native post slug, so
  // there is no deep link to build.
  const copyCommentLink = async (c: Comment) => {
    const link = postSlug
      ? `${window.location.origin}/post/${postSlug}?comment=${c._id}`
      : c.post
        ? `${window.location.origin}/post/${c.post}?comment=${c._id}`
        : null;
    if (!link) {
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: {
            message: "This comment has no link to share.",
            type: "error",
          },
        }),
      );
      return;
    }
		try {
			await navigator.clipboard.writeText(link);
		} catch (e) {
			// Fallback for browsers without the async clipboard API
			try {
				const ta = document.createElement("textarea");
				ta.value = link;
				ta.style.position = "fixed";
				ta.style.opacity = "0";
				document.body.appendChild(ta);
				ta.select();
				document.execCommand("copy");
				document.body.removeChild(ta);
			} catch (clipErr) {
				logger.error("Clipboard copy failed", clipErr);
				window.dispatchEvent(
					new CustomEvent("showToast", {
						detail: { message: "Could not copy link", type: "error" },
					}),
				);
				return;
			}
		}
		window.dispatchEvent(
			new CustomEvent("showToast", {
				detail: { message: "Comment link copied!", type: "success" },
			}),
		);
	};

	// Forward the comment to one or more chat partners (notifies each recipient)
	const handleForwardComment = async (
		partners: ForwardPartner[],
	): Promise<boolean> => {
		if (!forwardComment || partners.length === 0) return false;
		try {
			const results = await Promise.all(
				partners.map(async (partner) => {
					try {
						const res = await apiFetch(
							`/api/comments/${forwardComment._id}/forward`,
							{
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({ recipientId: partner._id }),
							},
						);
						const data = await res.json();
						return res.ok && data.success;
					} catch {
						return false;
					}
				}),
			);
			const okCount = results.filter(Boolean).length;
			if (okCount > 0) {
				// The forward created/updated 1:1 conversations — refresh the chat
				// list so the new conversation + message appear immediately.
				window.dispatchEvent(new Event("chatConversationsRefresh"));
				window.dispatchEvent(
					new CustomEvent("showToast", {
						detail: {
							message:
								okCount === partners.length
									? "Comment forwarded!"
									: `Comment forwarded to ${okCount} of ${partners.length} chats.`,
							type: "success",
						},
					}),
				);
				return true;
			}
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: { message: "Failed to forward comment", type: "error" },
				}),
			);
			return false;
		} catch (e) {
			logger.error("Failed to forward comment", e);
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: { message: "Failed to forward comment", type: "error" },
				}),
			);
			return false;
		}
	};
	const [replies, setReplies] = useState<Comment[]>([]);
	const [loadingReplies, setLoadingReplies] = useState(false);
	const [showReplies, setShowReplies] = useState(false);
	const [repliesFetched, setRepliesFetched] = useState(false);
	const [localRepliesCount, setLocalRepliesCount] = useState<number>(
		comment.repliesCount ?? 0,
	);
	const [isEditing, setIsEditing] = useState(false);
	const [editText, setEditText] = useState(comment.content);
	const editTextRef = useAutoGrow<HTMLTextAreaElement>(editText);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [isExpanded, setIsExpanded] = useState(false);

	// Local mirror of comment fields for realtime updates without parent re-render
	const [likesCount, setLikesCount] = useState(comment.likesCount);
	const [likedByMe, setLikedByMe] = useState(!!comment.likedByMe);
	const [reactions, setReactions] = useState<CommentReaction[]>(
		comment.reactions || [],
	);

	// Sync when comment prop changes (e.g. drawer re-opens)
	useEffect(() => {
		setLikesCount(comment.likesCount);
		setLikedByMe(!!comment.likedByMe);
		setReactions(comment.reactions || []);
		setRepliesFetched(false);
		setLocalRepliesCount(comment.repliesCount ?? 0);
		setEditText(comment.content);
		setIsEditing(false);
		setShowDeleteConfirm(false);
	}, [
		comment._id,
		comment.likesCount,
		comment.likedByMe,
		comment.reactions,
		comment.repliesCount,
		comment.content,
	]);

	// Auto load replies when showing replies or when the comment changes
	useEffect(() => {
		if (showReplies && replies.length === 0) {
			loadReplies();
		}
	}, [showReplies, comment._id]);

	// Direct listener for realtime comment like/unlike updates
	useEffect(() => {
		const handleLikeChanged = (
			e: CustomEvent<{ commentId: string; likesCount: number }>,
		) => {
			const { commentId: cid, likesCount: lc } = e.detail;
			if (cid === comment._id) {
				setLikesCount(lc);
			}
		};
		window.addEventListener(
			"postCommentLikeChanged",
			handleLikeChanged as EventListener,
		);
		return () =>
			window.removeEventListener(
				"postCommentLikeChanged",
				handleLikeChanged as EventListener,
			);
	}, [comment._id]);

	// Listen for realtime comment edits (if this comment is updated remotely)
	useEffect(() => {
		const handleCommentUpdated = (e: CustomEvent<{ comment: Comment }>) => {
			const { comment: updatedComment } = e.detail;
			if (updatedComment._id === comment._id) {
				setEditText(updatedComment.content);
			}
		};
		window.addEventListener(
			"commentUpdated",
			handleCommentUpdated as EventListener,
		);
		return () =>
			window.removeEventListener(
				"commentUpdated",
				handleCommentUpdated as EventListener,
			);
	}, [comment._id]);

	// Keep a ref mirroring showReplies so the event handler can read the latest value
	const showRepliesRef = useRef(showReplies);
	showRepliesRef.current = showReplies;

	// Listen for realtime replies added to this comment
	useEffect(() => {
		const handleReplyAdded = (
			e: CustomEvent<{ parentCommentId: string; reply: Comment }>,
		) => {
			const { parentCommentId, reply } = e.detail;
			if (parentCommentId === comment._id) {
				setReplies((prev) => {
					if (prev.some((r) => r._id === reply._id)) return prev;
					return [...prev, reply];
				});
				setLocalRepliesCount((prev) => prev + 1);

				const wasShowing = showRepliesRef.current;
				// Auto-show replies so the user sees it right away
				setShowReplies(true);

				// If replies weren't already visible, fetch the full list from server
				// so pre-existing replies from other users also appear, not just this one
				if (!wasShowing) {
					loadReplies();
				}
			}
		};
		window.addEventListener(
			"commentReplyAdded",
			handleReplyAdded as EventListener,
		);
		return () =>
			window.removeEventListener(
				"commentReplyAdded",
				handleReplyAdded as EventListener,
			);
	}, [comment._id]);

	// Listen for realtime comment deletion (remove from replies list)
	useEffect(() => {
		const handleCommentDeleted = (
			e: CustomEvent<{ commentId: string }>,
		) => {
			const { commentId } = e.detail;
			if (commentId === comment._id) {
				// The parent will handle removal via re-render with updated comments list
				// For replies, we just mark locally
			}
		};
		window.addEventListener(
			"commentDeleted",
			handleCommentDeleted as EventListener,
		);
		return () =>
			window.removeEventListener(
				"commentDeleted",
				handleCommentDeleted as EventListener,
			);
	}, [comment._id]);

	// Direct listener for realtime comment emoji reaction updates
	useEffect(() => {
		const handleReactionChanged = (
			e: CustomEvent<{
				commentId: string;
				reaction: any;
				type: "add" | "remove";
			}>,
		) => {
			const { commentId: cid, reaction, type } = e.detail;
			if (cid !== comment._id) return;
			setReactions((prev) => {
				if (type === "add" && reaction) {
					// Remove ALL previous reactions by this sender, then add new one
					const senderId =
						typeof reaction.sender === "string"
							? reaction.sender
							: reaction.sender?._id;
					const filtered = prev.filter((r) => {
						const sId =
							typeof r.sender === "string"
								? r.sender
								: r.sender?._id;
						return sId !== senderId;
					});
					return [...filtered, reaction];
				} else if (type === "remove" && reaction) {
					// Remove only the reaction matching this sender + emoji
					const senderId =
						typeof reaction.sender === "string"
							? reaction.sender
							: reaction.sender?._id;
					const filtered = prev.filter((r) => {
						const sId =
							typeof r.sender === "string"
								? r.sender
								: r.sender?._id;
						return !(
							sId === senderId && r.emoji === reaction.emoji
						);
					});
					return filtered;
				}
				return prev;
			});
		};
		window.addEventListener(
			"commentReactionChanged",
			handleReactionChanged as EventListener,
		);
		return () =>
			window.removeEventListener(
				"commentReactionChanged",
				handleReactionChanged as EventListener,
			);
	}, [comment._id]);

	const loadReplies = async () => {
		setLoadingReplies(true);
		try {
			const res = await apiFetch(`/api/comments/replies/${comment._id}`);
			if (!res.ok)
				throw new Error(`Failed to load replies: ${res.status}`);
			const data = await res.json();
			if (data.success) {
				setReplies(data.replies || []);
				setRepliesFetched(true);
				setLocalRepliesCount((data.replies || []).length);
			}
		} catch (e) {
			logger.error(e);
			setReplies([]);
			setRepliesFetched(true);
		} finally {
			setLoadingReplies(false);
		}
	};

	// Determine if replies button should be shown
	// Don't show if we already fetched and found nothing
	// Use actual loaded count after fetch, otherwise use prop
	const effectiveRepliesCount = repliesFetched
		? localRepliesCount
		: (comment.repliesCount ?? 0);
	const hasReplies =
		replies.length > 0 || (!repliesFetched && effectiveRepliesCount > 0);

	const handleLikeToggle = async () => {
		if (!user) return;
		const prevLiked = likedByMe;
		const prevCount = likesCount;

		// Optimistic update
		setLikedByMe(!prevLiked);
		setLikesCount(Math.max(0, prevCount + (prevLiked ? -1 : 1)));

		try {
			const res = await apiFetch(`/api/likes/comment/${comment._id}`, {
				method: "POST",
			});
			const data = await res.json();
			if (!res.ok || !data.success) {
				// Rollback
				setLikedByMe(prevLiked);
				setLikesCount(prevCount);
			}
		} catch (e) {
			logger.error("Failed to toggle comment like", e);
			setLikedByMe(prevLiked);
			setLikesCount(prevCount);
		}
	};

	const handleReaction = async (emoji: string) => {
		if (!user) return;

		// 1. Optimistic UI update
		const userId = user._id;
		const existingIndex = (reactions || []).findIndex((r) => {
			const sId = typeof r.sender === "string" ? r.sender : r.sender?._id;
			return sId === userId && r.emoji === emoji;
		});

		let nextReactions = [...(reactions || [])];
		if (existingIndex >= 0) {
			// Toggle off
			nextReactions.splice(existingIndex, 1);
		} else {
			// Toggle off any other reaction by this sender first
			nextReactions = nextReactions.filter((r) => {
				const sId =
					typeof r.sender === "string" ? r.sender : r.sender?._id;
				return sId !== userId;
			});
			// Add new reaction
			nextReactions.push({
				_id: Date.now().toString(), // temp ID
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
			const res = await apiFetch(
				`/api/comments/${comment._id}/reactions`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ emoji }),
				},
			);
			const data = await res.json();
			if (res.ok && data.success && data.reactions) {
				// 2. Sync with backend source of truth
				setReactions(data.reactions);
			} else {
				logger.error("Failed to react to comment");
				// Revert
				setReactions(reactions);
			}
		} catch (e) {
			logger.error("Failed to react to comment", e);
			// Revert
			setReactions(reactions);
		}
	};

	const handleEdit = async () => {
		if (!user || !editText.trim()) return;
		try {
			const res = await apiFetch(`/api/comments/${comment._id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ content: editText.trim() }),
			});
			const data = await res.json();
			if (res.ok && data.success) {
				setIsEditing(false);
			}
		} catch (e) {
			logger.error("Failed to edit comment", e);
		}
	};

	const handleDelete = async () => {
		if (!user) return;
		try {
			const res = await apiFetch(`/api/comments/${comment._id}`, {
				method: "DELETE",
			});
			const data = await res.json();
			if (res.ok && data.success) {
				setShowDeleteConfirm(false);
				setCommentMenuOpen(false);
				// Notify parent to remove this comment from the list
				window.dispatchEvent(
					new CustomEvent("commentDeleted", {
						detail: { commentId: comment._id },
					}),
				);
			}
		} catch (e) {
			logger.error("Failed to delete comment", e);
		}
	};

	// Comment options menu — an Instagram-style dropdown anchored to the
	// three-dot button (same design as the profile page post menu). It is
	// positioned with `absolute` relative to the button (NOT `fixed`), which
	// makes it immune to the backdrop-blur containing-block bug that used to
	// clip the old fixed-position menu and made it invisible on desktop.
	const [commentMenuOpen, setCommentMenuOpen] = useState(false);
	const commentMenuRef = useRef<HTMLDivElement>(null);


	// Close the options menu / emoji menu when clicking or tapping anywhere
	// outside them (also Escape).
	useEffect(() => {
		const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
			if (
				commentMenuRef.current &&
				!commentMenuRef.current.contains(e.target as Node)
			) {
				setCommentMenuOpen(false);
			}
		};
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			setCommentMenuOpen(false);
		};
		document.addEventListener("mousedown", handleOutsideClick);
		document.addEventListener("touchstart", handleOutsideClick);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("mousedown", handleOutsideClick);
			document.removeEventListener("touchstart", handleOutsideClick);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, []);


	// Swipe-to-reply state
	const [showSwipeBadge, setShowSwipeBadge] = useState(false);
	const swipeBarRef = useRef<HTMLDivElement>(null);
	const swipeOffsetRef = useRef(0);
	const touchStartXRef = useRef(0);
	const touchStartYRef = useRef(0);
	const isSwipingRef = useRef(false);

	// Double-tap to like
	const lastTapTimeRef = useRef(0);

	// Long-press timer
	const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	const handleContextMenu = (
		e:
			| React.MouseEvent
			| { clientX: number; clientY: number; preventDefault: () => void },
		_c: Comment,
	) => {
		// The comment options menu is available for every comment: the author
		// gets Edit + Delete, everyone else gets Report. For guests there is
		// nothing useful in the menu, so keep the native menu / selection.
		if (!user) return;
		e.preventDefault();
		setCommentMenuOpen(true);
	};

	const handleTouchStart = (e: React.TouchEvent) => {
		const touch = e.touches[0];
		touchStartXRef.current = touch.clientX;
		touchStartYRef.current = touch.clientY;
		isSwipingRef.current = false;
		swipeOffsetRef.current = 0;
		setShowSwipeBadge(false);
		if (swipeBarRef.current)
			swipeBarRef.current.style.transform = "translateX(-6px)";

		// Double-tap detection
		const now = Date.now();
		if (lastTapTimeRef.current && now - lastTapTimeRef.current < 300) {
			// Double tap! Trigger like
			handleLikeToggle();
			lastTapTimeRef.current = 0;
			return;
		}
		lastTapTimeRef.current = now;

		touchTimerRef.current = setTimeout(() => {
			// Long press opens the comment options menu (only if not swiping)
			if (!isSwipingRef.current) {
				handleContextMenu(
					{
						clientX: 0,
						clientY: 0,
						preventDefault: () => {},
					} as any,
					comment,
				);
			}
		}, 500);
	};

	const handleTouchMove = (e: React.TouchEvent) => {
		const touch = e.touches[0];
		if (!touch) return;
		const deltaX = touch.clientX - touchStartXRef.current;
		const deltaY = touch.clientY - touchStartYRef.current;

		// Only start swipe if horizontal movement exceeds vertical by enough margin
		if (
			!isSwipingRef.current &&
			Math.abs(deltaX) > 15 &&
			Math.abs(deltaX) > Math.abs(deltaY) * 1.5
		) {
			isSwipingRef.current = true;
			if (touchTimerRef.current) {
				clearTimeout(touchTimerRef.current);
				touchTimerRef.current = null;
			}
		}

		if (isSwipingRef.current) {
			// Clamp swipe offset: rightwards only, max 100px
			const offset = Math.min(Math.max(0, deltaX), 100);
			swipeOffsetRef.current = offset;
			// Direct CSS transform for 60fps — no React re-render, no transition lag
			if (swipeBarRef.current) {
				swipeBarRef.current.style.transition = "none";
				// Clamp so the bar never pokes out the comment's left edge
				// (the root div no longer clips with overflow-hidden).
				swipeBarRef.current.style.transform = `translateX(${Math.max(offset - 6, 0)}px)`;
				swipeBarRef.current.style.opacity = offset > 0 ? "1" : "0";
			}
			if (offset > 20 && !showSwipeBadge) {
				setShowSwipeBadge(true);
			} else if (offset <= 20 && showSwipeBadge) {
				setShowSwipeBadge(false);
			}
		}
	};

	const handleTouchEnd = () => {
		if (touchTimerRef.current) {
			clearTimeout(touchTimerRef.current);
			touchTimerRef.current = null;
		}

		if (isSwipingRef.current && swipeOffsetRef.current > 60) {
			// Trigger reply
			onReply(comment._id);
		}

		swipeOffsetRef.current = 0;
		setShowSwipeBadge(false);
		if (swipeBarRef.current) {
			// Restore transition for smooth snap-back animation
			swipeBarRef.current.style.transition = "";
			swipeBarRef.current.style.transform = "translateX(-6px)";
			swipeBarRef.current.style.opacity = "0";
		}
		isSwipingRef.current = false;
		touchStartXRef.current = 0;
		touchStartYRef.current = 0;
	};



	// Group reactions by emoji (max 10 unique)
	const getGroupedReactions = (reacts?: CommentReaction[]) => {
		if (!reacts || reacts.length === 0) return {};
		const entries = Object.entries(
			reacts.reduce(
				(acc, r) => {
					if (!acc[r.emoji])
						acc[r.emoji] = { count: 0, hasReacted: false };
					acc[r.emoji].count++;
					const sId =
						typeof r.sender === "string" ? r.sender : r.sender?._id;
					if (sId === user?._id) acc[r.emoji].hasReacted = true;
					return acc;
				},
				{} as Record<string, { count: number; hasReacted: boolean }>,
			),
		);
		// Sort by most reacted first, limit to 10
		return Object.fromEntries(entries.slice(0, 10));
	};

	const groupedReactions = getGroupedReactions(reactions);

	return (
		<div
			ref={containerRef}
			className={`relative space-y-1.5 ${depth > 0 ? "ml-6 pl-4 border-l border-zinc-800/80" : ""}`}
				onContextMenu={(e) => handleContextMenu(e, comment)}
			onTouchStart={handleTouchStart}
			onTouchEnd={handleTouchEnd}
			onTouchMove={handleTouchMove}>
			{/* Swipe-to-reply visual indicator */}
			<div
				ref={swipeBarRef}
				className="absolute inset-y-0 left-0 w-1 bg-white/20 rounded-r-full pointer-events-none"
				style={{
					transform: "translateX(-4px)",
					opacity: 0,
					transition:
						"transform 180ms ease-out, opacity 180ms ease-out",
				}}
			/>

			<div className="rounded-2xl border border-white/5 bg-zinc-900/15 px-3 py-2 space-y-1.5 relative backdrop-blur-md hover:border-white/10 hover:bg-zinc-900/25 transition-all duration-350">
				{/* Delete Confirmation Overlay */}
				{showDeleteConfirm && (
					<div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-zinc-950/95 backdrop-blur-md">
						<div className="text-center space-y-3 px-4">
							<p className="text-[12px] font-semibold text-zinc-300">
								Delete this comment permanently?
							</p>
							<div className="flex items-center justify-center gap-2">
								<button
									onClick={handleDelete}
									className="rounded-full bg-red-500/90 px-3.5 py-1.5 text-[12px] md:text-sm font-bold text-white hover:bg-red-500 transition-colors cursor-pointer">
									Delete
								</button>
								<button
									onClick={() => setShowDeleteConfirm(false)}
									className="rounded-full bg-zinc-800 px-3.5 py-1.5 text-[12px] md:text-sm font-bold text-zinc-300 hover:bg-zinc-700 transition-colors cursor-pointer">
									Cancel
								</button>
							</div>
						</div>
					</div>
				)}
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2.5">
						<UserAvatar
							src={comment.author.profilePic?.url}
							alt={comment.author.fullName}
							perkRing={!!(comment.author as any).waitlistPerk}
							onClick={() =>
								onUserSelected(comment.author.username)
							}
							className="h-5.5 w-5.5 rounded-full object-cover border border-white/5 cursor-pointer shadow-sm"
						/>
						<div className="flex items-center gap-1.5 flex-wrap">
							<div className="flex flex-col min-w-0">
								<h5
									onClick={() =>
										onUserSelected(comment.author.username)
									}
									className="font-sans text-[12px] font-bold text-white leading-none cursor-pointer hover:text-white/80 transition-colors inline-flex items-center gap-1">
									{comment.author.fullName}
									{(comment.author as any).waitlistPerk && (
										<DayOneFlair />
									)}
									{(comment.author as any).isVerified && (
										<VerifiedBadge className="h-3 w-3 shrink-0" />
									)}
								</h5>
								{/* Mention tag: tucked under the name, smaller than the name */}
								<span className="text-[9px] text-zinc-500 font-medium leading-none -mt-px">
									@{comment.author.username}
								</span>
							</div>
							<span className="text-[9px] text-zinc-650 font-bold">•</span>
							<span className="text-[11px] text-zinc-500 font-medium">
								{getRelativeDate(comment.createdAt)}
								{comment.isEdited && (
									<span className="ml-1 italic opacity-60">
										(edited)
									</span>
								)}
							</span>
						</div>
					</div>

					<div className="flex items-center gap-2">
						{user && !isEditing && (
							<div className="relative" ref={commentMenuRef}>
								<button
									onClick={(e) => {
										e.stopPropagation();
										setCommentMenuOpen((prev) => !prev);
									}}
									className="p-1.5 bg-zinc-800 border border-zinc-800 rounded-full text-zinc-400 hover:text-white shadow-sm cursor-pointer transition-colors"
									title="Comment options"
									aria-label="Comment options"
									aria-haspopup="menu"
									aria-expanded={commentMenuOpen}>
									<MoreHorizontal className="h-3.5 w-3.5" />
								</button>

								{/* Options dropdown — same design as the post menu on the
								    profile page: solid zinc-900 card, full-width text-left
								    items. Author gets Edit + Delete; everyone else gets
								    Report. */}
								{commentMenuOpen && (
									<div className="absolute right-0 top-full mt-1 z-[100] w-44 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl overflow-hidden">
										{/* Translate — available for every comment; programmatically
										    triggers the inline translation (icon hidden on the body). */}
										<button
											onClick={() => {
												setCommentMenuOpen(false);
												window.dispatchEvent(
													new CustomEvent(
														"translate-inline:toggle",
														{
															detail: { id: comment._id },
														},
													),
												);
											}}
											className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors text-left">
											<Languages className="h-3.5 w-3.5" />
											Translate
										</button>
										{comment.author._id === user._id && (
											<>
											<button
												onClick={() => {
													setCommentMenuOpen(false);
													setIsEditing(true);
													setEditText(comment.content);
												}}
												className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors text-left">
												<Edit3 className="h-3.5 w-3.5 text-amber-400" />
												Edit Comment
											</button>
											<button
												onClick={() => {
													setCommentMenuOpen(false);
													setShowDeleteConfirm(true);
												}}
												className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-red-400 transition-colors text-left">
												<XIcon className="h-3.5 w-3.5" />
												Delete Comment
											</button>
											</>
										)}
										{comment.author._id !== user._id && (
											<button
												onClick={() => {
													setCommentMenuOpen(false);
													setReportCommentId(comment._id);
												}}
												className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-red-400 transition-colors text-left">
												<Flag className="h-3.5 w-3.5" />
												Report
											</button>
										)}
									</div>
								)}
							</div>
						)}
					</div>
				</div>

				{isEditing ? (
					<div className="space-y-2">
						<textarea
							ref={editTextRef}
							value={editText}
							onChange={(e) => setEditText(e.target.value)}
							className="w-full !rounded-lg border border-white/5 bg-zinc-950/60 px-2.5 py-1.5 text-[12px] md:text-sm text-zinc-200 placeholder-zinc-550 outline-none focus:border-white/15 focus:bg-zinc-950/80 resize-none transition-all"
							rows={2}
							maxLength={1000}
							spellCheck={false}
							autoFocus
						/>
						<div className="flex items-center gap-2">
							<button
								onClick={handleEdit}
								className="flex items-center gap-1 rounded-full bg-aurora text-white border border-white/10 shadow-aurora px-3.5 py-1.5 text-[12px] md:text-sm font-bold hover:opacity-90 transition-colors cursor-pointer">
								<Check className="h-3 w-3" /> Save
							</button>
							<button
								onClick={() => {
									setIsEditing(false);
									setEditText(comment.content);
								}}
								className="flex items-center gap-1 rounded-full bg-zinc-800 px-3.5 py-1.5 text-[12px] md:text-sm font-bold text-zinc-300 hover:bg-zinc-700 transition-colors cursor-pointer">
								<XIcon className="h-3 w-3" /> Cancel
							</button>
						</div>
					</div>
				) : (
					<div className="space-y-1">
						<TranslateInline
							text={
								comment.content.length > 240 && !isExpanded
									? comment.content.slice(0, 240) + "..."
									: comment.content
							}
							eventId={comment._id}
							hideToggle
							render={(t) => (
								<p className="text-[13px] text-zinc-300 select-text leading-snug font-sans pr-2">
									{renderFormattedContent(t)}
								</p>
							)}
						/>
						{comment.content && extractFirstUrl(comment.content) && (
							<LinkPreviewCard
								url={extractFirstUrl(comment.content)!}
								compact
							/>
						)}
						{comment.content.length > 240 && (
									<button
										onClick={() => setIsExpanded(!isExpanded)}
										className="text-[11px] font-bold text-zinc-400 hover:text-white transition-colors cursor-pointer block mt-0.5">
										{isExpanded ? "See less" : "See more"}
									</button>
								)}
							</div>
						)}

						{/* Emoji Reactions Row */}
						{Object.keys(groupedReactions).length > 0 && (
							<motion.div
								className="flex items-center gap-1 flex-wrap pt-0.5"
						layout>
						{Object.entries(groupedReactions).map(
							([emoji, data]) => (
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
									onClick={() => handleReaction(emoji)}
									className={`flex items-center gap-0.5 px-1.5 py-px rounded-full text-[11px] md:text-[12px] border transition-colors cursor-pointer ${
										data.hasReacted
											? "bg-white/10 border-white/20 text-white"
											: "bg-white/3 border-white/5 text-zinc-400 hover:bg-white/5"
									}`}>
									<span>{emoji}</span>
									<span className="text-[8px] font-bold">
										{data.count}
									</span>
								</motion.button>
							),
						)}
					</motion.div>
				)}

				{/* Action Bar */}
				<div className="flex items-center gap-4 pt-0.5 border-t border-white/3">
					{user && (
						<button
							onClick={handleLikeToggle}
							className="flex items-center gap-1 text-[12px] font-medium text-zinc-500 hover:text-red-450 transition-colors cursor-pointer group">
							<motion.span
								key={likedByMe ? "liked" : "unliked"}
								initial={{ scale: likedByMe ? 1.25 : 1 }}
								animate={{ scale: 1 }}
								transition={{
									type: "spring",
									stiffness: 400,
									damping: 15,
								}}>
								<Heart
									className={`h-3 w-3 transition-colors ${
										likedByMe
											? "fill-red-500 text-red-500"
											: "group-hover:text-red-400"
									}`}
								/>
							</motion.span>
							<span className={likedByMe ? "text-red-400 font-bold" : ""}>
								{likesCount}
							</span>
						</button>
					)}

					{user && (
						<button
							onClick={() => onReply(comment._id)}
							className="flex items-center gap-1 text-[12px] font-medium text-zinc-500 hover:text-white transition-colors cursor-pointer">
							<Reply className="h-3 w-3" /> Reply
						</button>
					)}

					{user && (
						<EmojiReactionMenu
							onReact={handleReaction}
							direction="up"
							ariaLabel="React to this comment"
							triggerContent={
								<>
									<Smile className="h-3 w-3" /> React
								</>
							}
						/>
					)}

					{user && (
						<ShareMenu
							onForward={() => setForwardComment(comment)}
							onCopyLink={() => copyCommentLink(comment)}
							ariaLabel="Share comment"
							triggerContent={
								<Share2 className="h-3 w-3" />
							}
							triggerClassName="flex items-center gap-1 text-[12px] font-medium text-zinc-500 hover:text-white transition-colors cursor-pointer"
						/>
					)}


					{(showReplies || hasReplies) && (
						<button
							onClick={() => setShowReplies(!showReplies)}
							className={`text-[11px] font-semibold transition-colors cursor-pointer ml-auto ${
								showReplies
									? "text-white"
									: "text-zinc-400 hover:text-white"
							}`}>
							{showReplies
								? "Hide Replies"
								: `View ${effectiveRepliesCount} ${effectiveRepliesCount === 1 ? "Reply" : "Replies"}`}
						</button>
					)}
				</div>
			</div>

			{showReplies && (						<div className="space-y-1.5 mt-1.5">
					{loadingReplies ? (
						<div className="flex items-center gap-2 text-[11px] text-zinc-500 ml-6">
							<span className="h-3 w-3 animate-spin rounded-full border border-zinc-600 border-t-zinc-300"></span>
							Loading replies...
						</div>
					) : replies.length === 0 ? (
						<div className="text-[11px] text-zinc-500 ml-6 italic">
							No replies yet.
						</div>
					) : (							replies.map((reply) => (
								<CommentNode
									key={reply._id}
									comment={reply}
									user={user}
									onUserSelected={onUserSelected}
									onReply={onReply}
									depth={depth + 1}
									getRelativeDate={getRelativeDate}
									renderFormattedContent={renderFormattedContent}
									postSlug={postSlug}
								/>
							))				)}
			</div>
			)}

			{/* Forward comment modal */}
			<ForwardModal
				open={!!forwardComment}
				onClose={() => setForwardComment(null)}
				title="Forward comment"
				subtitle={forwardComment?.content?.slice(0, 60)}
				myUserId={user?._id}
				onForward={handleForwardComment}
			/>

			{/* Report modal — rendered here (outside the three-dot menu) so the
			    menu closing never unmounts it before it can open. */}
			{reportCommentId && (
				<ReportButton
					contentType="comment"
					contentId={reportCommentId}
					initialOpen
					onClose={() => setReportCommentId(null)}
				/>
			)}
		</div>
	);
}
