import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, FolderOpen, Loader2, Heart, MessageSquare } from "lucide-react";
import { apiFetch } from "../utils/api";
import { logger } from "../utils/logger";
import UserAvatar from "./UserAvatar";
import { optimizeImageUrl } from "../utils/imageUrls";

interface SharedCollectionViewProps {
	collectionId: string;
	onClose: () => void;
	onPostClick?: (slug: string) => void;
	onUserClick?: (username: string) => void;
}

interface SharedCollection {
	_id: string;
	name: string;
	owner?: { _id: string; username: string; fullName: string; profilePic?: { url: string } };
	postCount?: number;
}

interface SharedPost {
	_id: string;
	content?: string;
	title?: string;
	slug?: string;
	images?: { url: string }[];
	image?: { url: string };
	likesCount?: number;
	commentsCount?: number;
	author?: { _id: string; username: string; fullName: string; profilePic?: { url: string } };
}

/**
 * Read-only viewer for a collection that was shared with you (collection_share
 * notifications / /collection/:id links). Shows the collection name, owner and
 * its posts — taps fall through to the normal post/profile navigation.
 */
export default function SharedCollectionView({
	collectionId,
	onClose,
	onPostClick,
	onUserClick,
}: SharedCollectionViewProps) {
	const [collection, setCollection] = useState<SharedCollection | null>(null);
	const [posts, setPosts] = useState<SharedPost[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			setLoading(true);
			setError(null);
			try {
				const res = await apiFetch(`/api/collections/shared/${collectionId}`);
				const data = await res.json();
				if (cancelled) return;
				if (res.ok && data.success) {
					setCollection(data.collection);
					setPosts(data.posts || []);
				} else {
					setError(data?.message || "Could not open this collection.");
				}
			} catch (err) {
				logger.error("Failed to load shared collection", err);
				if (!cancelled) setError("Could not open this collection.");
			} finally {
				if (!cancelled) setLoading(false);
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [collectionId]);

	return createPortal(
		<div
			className="fixed inset-0 z-[350] flex items-center justify-center p-4"
			role="dialog"
			aria-modal="true"
		>
			<div
				className="absolute inset-0 bg-black/75 backdrop-blur-sm"
				onClick={onClose}
			/>
			<div className="relative z-[360] flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl">
				{/* Header */}
				<div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
					<div className="min-w-0 flex items-center gap-2.5">
						<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-zinc-300">
							<FolderOpen className="h-4 w-4" />
						</span>
						<div className="min-w-0">
							<h3 className="truncate text-sm font-bold text-white">
								{loading
									? "Shared collection"
									: collection?.name || "Collection"}
							</h3>
							{collection?.owner && (
								<p className="truncate text-[10px] text-zinc-500">
									by {collection.owner.fullName || `@${collection.owner.username}`}
									{typeof collection.postCount === "number" &&
										` · ${collection.postCount} post${collection.postCount === 1 ? "" : "s"}`}
								</p>
							)}
						</div>
					</div>
					<button
						onClick={onClose}
						className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
						aria-label="Close"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				{/* Body */}
				<div className="flex-1 overflow-y-auto p-4">
					{loading ? (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
						</div>
					) : error ? (
						<div className="flex flex-col items-center justify-center py-12 text-center">
							<FolderOpen className="h-8 w-8 text-zinc-600" />
							<p className="mt-3 text-sm font-bold text-zinc-300">{error}</p>
							<button
								onClick={onClose}
								className="mt-4 rounded-full border border-zinc-700 px-4 py-1.5 text-[11px] font-bold text-zinc-300 hover:bg-zinc-800 transition-all cursor-pointer"
							>
								Close
							</button>
						</div>
					) : posts.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-12 text-center">
							<FolderOpen className="h-8 w-8 text-zinc-600" />
							<p className="mt-3 text-sm font-bold text-zinc-300">
								This collection has no visible posts
							</p>
						</div>
					) : (
						<div className="space-y-3">
							{posts.map((post) => (
								<div
									key={post._id}
									onClick={() => post.slug && onPostClick?.(post.slug)}
									className={`rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-3.5 transition-colors ${
										post.slug ? "cursor-pointer hover:border-zinc-700" : ""
									}`}
								>
									{post.images?.[0]?.url || post.image?.url ? (
										<img
											src={optimizeImageUrl(post.images?.[0]?.url || post.image?.url, 800)}
											alt=""
											className="mb-2.5 h-40 w-full rounded-xl object-cover"
										/>
									) : null}
									<div className="flex items-start gap-2.5">
										{post.author && (
											<button
												onClick={(e) => {
													e.stopPropagation();
													if (post.author?.username)
														onUserClick?.(post.author.username);
												}}
												className="shrink-0 cursor-pointer"
											>
												<UserAvatar
													src={post.author.profilePic?.url}
													alt={post.author.fullName}
													className="h-6 w-6 rounded-full border border-zinc-800"
												/>
											</button>
										)}
										<div className="min-w-0 flex-1">
											<p className="line-clamp-2 text-[12px] font-semibold text-zinc-100">
												{post.content || post.title || "(No text)"}
											</p>
											<div className="mt-1 flex items-center gap-3 text-[10px] text-zinc-500">
												<span className="flex items-center gap-1">
													<Heart className="h-3 w-3 text-red-400/80" />
													{post.likesCount ?? 0}
												</span>
												<span className="flex items-center gap-1">
													<MessageSquare className="h-3 w-3" />
													{post.commentsCount ?? 0}
												</span>
											</div>
										</div>
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		</div>,
		document.body,
	);
}
