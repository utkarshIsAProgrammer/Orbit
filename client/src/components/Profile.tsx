import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
	Calendar,
	Share2,
	Edit3,
	MoreHorizontal,
	Camera,
	AlertCircle,
	X,
	Heart,
	MessageSquare,
	Bookmark,
	Repeat2,
	FileText,
	Image,
	Lock,
	FilePenLine,
	Clock,
	Send,
	Link2,
	Pin,
	FolderOpen,
	FolderPlus,
	Plus,
	Trash2,
	ArrowLeft,
	ArrowRight,
	Users,
	Loader2,
	Archive,
} from "lucide-react";
	import { User as UserType, Post } from "../types";
import { UserPlus, Check } from "lucide-react";
import { downscaleImageFile } from "../utils/imageCompression";
import { optimizeImageUrl } from "../utils/imageUrls";
import GlassCard from "./GlassCard";
import LinkPreviewCard from "./LinkPreviewCard";
import TranslateInline from "./TranslateInline";
import { extractFirstUrl } from "../utils/links";
import { renderLinkifiedText } from "../utils/linkify";
import ImageCropModal from "./ImageCropModal";
import UserAvatar from "./UserAvatar";
import VerifiedBadge from "./VerifiedBadge";
import Skeleton from "./Skeleton";	import { useAutoGrow } from "../hooks/useAutoGrow";		import ConfirmDialog from "./ConfirmDialog";
	import ForwardModal, { ForwardPartner } from "./ForwardModal";
import ReportButton from "./ReportButton";

import Streaks from "./Streaks";
import ReputationDisplay from "./ReputationDisplay";
import ProfileBadgeWall from "./ProfileBadgeWall";
import DayOneFlair from "./DayOneFlair";
import PollCard from "./PollCard";
import { apiFetch } from "../utils/api";
import {
	getCachedResponse,
	prependPostToCachedFeeds,
	evictCachedResponse,
} from "../utils/apiCache";
import { getOfflineFallback } from "../utils/dexieBridge";
import { useCacheRefresh } from "../hooks/useCacheRefresh";
import {
	usePostViewTracking,
	registerPostView,
} from "../hooks/usePostViewTracking";
import { logger } from "../utils/logger";

// Stable RegExp for matching profile/posts cache refresh events
// — module-level to prevent React effect re-attachment on every render.
const MATCHER_PROFILE = /\/api\/users\/(username\/|[a-f0-9]{24}\/posts)/;
// Stable matchers for the Saved / Reposts / Drafts background refreshes
// (same module-level pattern — avoids re-attaching window listeners).
const MATCHER_SAVES = /\/api\/saves/;
const MATCHER_REPOSTS = /\/api\/reposts/;

interface ProfileProps {
	user: UserType | null; // Auth User
	targetUsername: string; // The username of the profile to view
	onUserUpdate: (newUser: UserType) => void;
	onPostClick: (slug: string, openComments?: boolean) => void;
	onUserClick: (username: string) => void;
	followingStates: Record<string, boolean>;
	requestedFollows?: Record<string, boolean>;
	onToggleFollow: (
		userId: string,
	) => Promise<void | { requested?: boolean }>;
	onProfileLoaded?: (profileId: string, followingByMe: boolean) => void;
	onBack?: () => void;
	onMessageUser?: (userId: string) => void;
}

export default function Profile({
	user,
	targetUsername,
	onUserUpdate,
	onPostClick,
	onUserClick,
	followingStates,
	requestedFollows,
	onToggleFollow,
	onProfileLoaded,
	onBack: _onBack,
	onMessageUser,
}: ProfileProps) {
	const [profile, setProfile] = useState<UserType | null>(null);
	const [posts, setPosts] = useState<Post[]>([]);
	const [loading, setLoading] = useState(true);
	// Posts load in the background AFTER the profile header paints — this
	// shows a lightweight grid skeleton (instead of a misleading "No posts
	// yet") while the posts round-trip is still in flight.
	const [postsLoading, setPostsLoading] = useState(false);
	const [editOpen, setEditOpen] = useState(false);
	const [, setEditType] = useState<"profile" | "banner">("profile");

	// Crop Modal States
	const [cropModalOpen, setCropModalOpen] = useState(false);

	// ─── Profile share: menu + forward ────────────────────────────────
	const [shareMenuOpen, setShareMenuOpen] = useState(false);
	const [forwardOpen, setForwardOpen] = useState(false);
	const shareMenuRef = useRef<HTMLDivElement>(null);
	const [cropImageSrc, setCropImageSrc] = useState("");
	const [cropType, setCropType] = useState<"profile" | "banner">("profile");

	// Interaction List Modal State
	const [activeList, setActiveList] = useState<
		"followers" | "following" | "reposts" | null
	>(null);
	const [listItems, setListItems] = useState<any[]>([]);
	const [listLoading, setListLoading] = useState(false);

	// Profile content tab
	const [profileTab, setProfileTab] = useState<
		"posts" | "saved" | "reposts" | "drafts" | "collections"
	>("posts");
	const [savedPosts, setSavedPosts] = useState<Post[]>([]);
	const [repostedPosts, setRepostedPosts] = useState<Post[]>([]);
	const [loadingSaved, setLoadingSaved] = useState(false);
	const [loadingReposts, setLoadingReposts] = useState(false);
	// Drafts & scheduled posts (self only)
	const [drafts, setDrafts] = useState<Post[]>([]);
	const [scheduledPosts, setScheduledPosts] = useState<Post[]>([]);
	const [loadingDrafts, setLoadingDrafts] = useState(false);
	// Archived posts sub-view (self only, inside the Drafts tab)
	const [showArchived, setShowArchived] = useState(false);
	const [openMenuPostId, setOpenMenuPostId] = useState<string | null>(null);
	// Collections (self only) — server-side CRUD at /api/collections
	const [collections, setCollections] = useState<any[]>([]);
	const [loadingCollections, setLoadingCollections] = useState(false);
	const [activeCollectionId, setActiveCollectionId] = useState<string | null>(
		null,
	);
	const [collectionPosts, setCollectionPosts] = useState<Post[]>([]);
	const [loadingCollectionPosts, setLoadingCollectionPosts] =
		useState(false);
	const [collectionCursor, setCollectionCursor] = useState<string | null>(
		null,
	);
	const [collectionHasMore, setCollectionHasMore] = useState(false);
	const [loadingMoreCollectionPosts, setLoadingMoreCollectionPosts] =
		useState(false);
	const [deleteConfirmCollectionId, setDeleteConfirmCollectionId] =
		useState<string | null>(null);
	const [newCollectionName, setNewCollectionName] = useState("");
	const [creatingCollection, setCreatingCollection] = useState(false);
	// Sharing a collection via the forward modal (self only)
	const [shareCollection, setShareCollection] = useState<any | null>(null);
	const [sharingCollection, setSharingCollection] = useState(false);
	// Pinned posts (up to 3) shown at the top of the Posts tab
	const [pinnedPosts, setPinnedPosts] = useState<Post[]>([]);

	// "More creators like this" — audience-overlap recommendations for the
	// profile being viewed (hidden on your own profile).
	const [similarCreators, setSimilarCreators] = useState<UserType[]>([]);
	const [similarCreatorsLoading, setSimilarCreatorsLoading] = useState(false);

	// Pagination states for posts
	const [postsCursor, setPostsCursor] = useState<string | null>(null);
	const [postsHasMore, setPostsHasMore] = useState(false);
	const [loadingMorePosts, setLoadingMorePosts] = useState(false);
	const postsSentinelRef = useRef<HTMLDivElement>(null);

	// Pagination states for saved
	const [savedCursor, setSavedCursor] = useState<string | null>(null);
	const [savedHasMore, setSavedHasMore] = useState(false);
	const [loadingMoreSaved, setLoadingMoreSaved] = useState(false);
	const savedSentinelRef = useRef<HTMLDivElement>(null);

	// Pagination states for reposts
	const [repostsCursor, setRepostsCursor] = useState<string | null>(null);
	const [repostsHasMore, setRepostsHasMore] = useState(false);
	const [loadingMoreReposts, setLoadingMoreReposts] = useState(false);
	const repostsSentinelRef = useRef<HTMLDivElement>(null);

	// Edit Forms State
	const [fullName, setFullName] = useState("");
	const [bio, setBio] = useState("");
	const bioRef = useAutoGrow<HTMLTextAreaElement>(bio);
	const [statusText, setStatusText] = useState("");
	const [profilePicFile, setProfilePicFile] = useState<File | null>(null);
	const [bannerPicFile, setBannerPicFile] = useState<File | null>(null);

	const [profilePicPreview, setProfilePicPreview] = useState("");
	const [bannerPicPreview, setBannerPicPreview] = useState("");

	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [, setSuccess] = useState<string | null>(null);

	const [editPostId, setEditPostId] = useState<string | null>(null);




	const [editPostDrawerOpen, setEditPostDrawerOpen] = useState(false);
	const [deleteConfirmPostId, setDeleteConfirmPostId] = useState<
		string | null
	>(null);
	const [deleteConfirmDraftId, setDeleteConfirmDraftId] = useState<
		string | null
	>(null);
	const [editPostTitle, setEditPostTitle] = useState("");
	const [editPostContent, setEditPostContent] = useState("");
	const editPostContentRef = useAutoGrow<HTMLTextAreaElement>(editPostContent);
	const [editPostExistingImages, setEditPostExistingImages] = useState<
		{ public_id: string; url: string }[]
	>([]);
	const [editPostNewFiles, setEditPostNewFiles] = useState<File[]>([]);
	const [editPostNewPreviews, setEditPostNewPreviews] = useState<string[]>(
		[],
	);

	// Edit post image crop
	const [editPostCropOpen, setEditPostCropOpen] = useState(false);
	const [editPostCropSrc, setEditPostCropSrc] = useState("");

	const handleEditPostDrawerSave = async () => {
		if (!editPostId) return;
		try {
			const formData = new FormData();
			formData.append("title", editPostTitle);
			formData.append("content", editPostContent);

			// Send existing image public_ids to keep
			if (editPostExistingImages.length > 0) {
				editPostExistingImages.forEach((img) => {
					formData.append("existingImages", img.public_id);
				});
			}

			// Append new image files
			for (const file of editPostNewFiles) {
				formData.append("images", await downscaleImageFile(file));
			}

			const res = await apiFetch(`/api/posts/${editPostId}`, {
				method: "PUT",
				body: formData,
			});
			if (res.ok) {
				// Revoke old preview URLs
				editPostNewPreviews.forEach((url) => URL.revokeObjectURL(url));

				// Re-fetch to get updated post with all fields
				const fetchRes = await apiFetch(`/api/posts/${editPostId}`);
				if (fetchRes.ok) {
					const data = await fetchRes.json();
					if (data.success && data.post) {
						const updatedPost = data.post;
						const updateFn = (p: any) =>
							p._id === editPostId
								? {
										...p,
										...updatedPost,
										likedByMe: p.likedByMe,
										savedByMe: p.savedByMe,
										repostedByMe: p.repostedByMe,
									}
								: p;
						setPosts((prev) => prev.map(updateFn));
						setSavedPosts((prev) => prev.map(updateFn));
						setRepostedPosts((prev) => prev.map(updateFn));
					}
				}

				setEditPostDrawerOpen(false);
				setEditPostId(null);
				setEditPostExistingImages([]);
				setEditPostNewFiles([]);
				setEditPostNewPreviews([]);
			}
		} catch (e) {
			logger.error(e);
		}
	};

	const handleEditPostRemoveExistingImage = (publicId: string) => {
		setEditPostExistingImages((prev) =>
			prev.filter((img) => img.public_id !== publicId),
		);
	};

	const handleEditPostRemoveNewImage = (idx: number) => {
		setEditPostNewFiles((prev) => prev.filter((_, i) => i !== idx));
		setEditPostNewPreviews((prev) => {
			URL.revokeObjectURL(prev[idx]);
			return prev.filter((_, i) => i !== idx);
		});
	};

	const handleEditPostAddImages = (
		e: React.ChangeEvent<HTMLInputElement>,
	) => {
		const files = Array.from(e.target.files || []);
		if (files.length === 0) return;
		const file = files[0];
		// Revoke previous crop src to prevent memory leak
		if (editPostCropSrc) URL.revokeObjectURL(editPostCropSrc);
		const src = URL.createObjectURL(file);
		setEditPostCropSrc(src);
		setEditPostCropOpen(true);
		e.target.value = "";
	};

	const handleEditPostCropComplete = (blob: Blob) => {
		const file = new File([blob], `edit_image_${Date.now()}.jpg`, {
			type: "image/jpeg",
		});
		const preview = URL.createObjectURL(blob);
		setEditPostNewFiles((prev) => [...prev, file]);
		setEditPostNewPreviews((prev) => [...prev, preview]);
		setEditPostCropOpen(false);
		if (editPostCropSrc) URL.revokeObjectURL(editPostCropSrc);
		setEditPostCropSrc("");
	};

	// Guards the in-flight race between a stale `loadProfile` (started BEFORE
	// the user followed/unfollowed) and the fresh follow action. Such a stale
	// load would otherwise call onProfileLoaded(oldState) AFTER the toggle and
	// overwrite followingStates — flipping the button back. Bumped whenever a
	// follow action begins; loadProfile only applies its result if it started
	// after the last action (its server data is then guaranteed fresh).
	const lastFollowActionAtRef = useRef(0);
	// Tracks which username the CURRENT in-flight fetch belongs to — a slow
	// response for user A that lands after the user has already navigated to
	// user B must not overwrite B's freshly-painted profile/posts.
	const profileFetchUsernameRef = useRef<string>("");

	// Pull-to-refresh state
	const [pullDistance, setPullDistance] = useState(0);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const touchStartRef = useRef(0);
	const isPullingRef = useRef(false);
	const containerRef = useRef<HTMLDivElement>(null);

	const getRelativeDate = (iso: string) => {
		const minDiff = Math.floor(
			(Date.now() - new Date(iso).getTime()) / 60000,
		);
		const hrDiff = Math.floor(minDiff / 60);
		if (minDiff < 1) return "Now";
		if (minDiff < 60) return `${minDiff}m`;
		if (hrDiff < 24) return `${hrDiff}h`;
		return new Date(iso).toLocaleDateString([], {
			month: "short",
			day: "numeric",
		});
	};

	// Handle touch pull-to-refresh
	const handleTouchStart = (e: React.TouchEvent) => {
		const scrollContainer =
			containerRef.current?.closest('[class*="overflow-y-auto"]') ||
			containerRef.current;
		if (
			scrollContainer &&
			scrollContainer.scrollTop <= 0 &&
			e.touches[0].clientY < 150
		) {
			touchStartRef.current = e.touches[0].clientY;
			isPullingRef.current = true;
		}
	};

	const handleTouchMove = (e: React.TouchEvent) => {
		if (!isPullingRef.current) return;
		const currentY = e.touches[0].clientY;
		const diff = currentY - touchStartRef.current;
		if (diff > 0) {
			setPullDistance(Math.min(diff * 0.5, 120));
		}
	};

	const handleTouchEnd = () => {
		if (!isPullingRef.current) return;
		isPullingRef.current = false;
		if (pullDistance > 60) {
			setIsRefreshing(true);
			setPullDistance(0);
			loadProfile().finally(() => {
				setIsRefreshing(false);
			});
		} else {
			setPullDistance(0);
		}
	};	// On mount or targetUsername change, try to display cached profile + posts
	// instantly — stale-while-revalidate. CacheStorage first, then the Dexie
	// offline layer (the user may be in Dexie even if the SW cache missed,
	// e.g. an offline reload after eviction), so a return visit or offline
	// open paints the profile header + post grid with no network wait. The
	// loadProfile() refresh below always reconciles with the server.
	useEffect(() => {
		(async () => {
			try {
				const userUrl = `/api/users/username/${targetUsername}`;
				const cached = await getCachedResponse<{
					user: UserType;
					success: boolean;
				}>(userUrl);
				const fallback = (
					cached?.user && cached.success
						? cached
						: await getOfflineFallback(userUrl)
				) as { user: UserType; success: boolean } | null;
				if (fallback?.user) {
					setProfile(fallback.user);
					setFullName(fallback.user.fullName || "");
					setBio(fallback.user.bio || "");
					setStatusText(fallback.user.statusText || "");
					setProfilePicPreview(fallback.user.profilePic?.url || "");
					setBannerPicPreview(fallback.user.bannerImage?.url || "");
					setLoading(false);

					// Also try to load cached posts for this user
					if (fallback.user._id) {
						const postsUrl = `/api/users/${fallback.user._id}/posts?limit=10`;
						const postsCache = await getCachedResponse<{
							posts: Post[];
							success: boolean;
							nextCursor: string | null;
							hasMore: boolean;
						}>(postsUrl);
						const postsFallback = (
							postsCache?.posts?.length && postsCache.success
								? postsCache
								: await getOfflineFallback(postsUrl)
						) as {
							posts: Post[];
							success: boolean;
							nextCursor: string | null;
							hasMore: boolean;
						} | null;
						if (postsFallback?.posts?.length) {
							setPosts(postsFallback.posts);
							setPostsCursor(postsFallback.nextCursor || null);
							setPostsHasMore(postsFallback.hasMore || false);
						}
					}
				}
			} catch {
				// Cache read failures are non-critical
			}
		})();
	}, [targetUsername]);

	// When the background cache timer refreshes the user's profile or posts,
	// re-fetch so the profile page stays up-to-date automatically.
	useCacheRefresh(MATCHER_PROFILE, () => loadProfile());

	// Keep the Saved / Reposts / Drafts tabs fresh when the background timer
	// refreshes those endpoints. Silent mode avoids flashing a spinner over
	// data that's already on screen (cache-first revalidate).
	useCacheRefresh(MATCHER_SAVES, () => {
		void fetchSavedPosts(undefined, { silent: true });
	});
	useCacheRefresh(MATCHER_REPOSTS, () => {
		void fetchRepostedPosts(undefined, { silent: true });
	});
	useCacheRefresh("/api/posts/drafts", () => {
		void fetchDrafts({ silent: true });
	});

	const loadProfile = async () => {
		const username = targetUsername;
		profileFetchUsernameRef.current = username;
		// Only show the full-page skeleton when nothing is painted for this
		// username yet (first visit / cache miss). On a return visit the cached
		// profile stays visible and this refresh runs silently in the
		// background — no skeleton flash, no "user disappeared" blink.
		if (!profile || profile.username !== username) {
			setProfile(null);
			setPosts([]);
			setPostsCursor(null);
			setPostsHasMore(false);
			setLoading(true);
		}
		// Snapshot when this fetch STARTS so a stale in-flight response that
		// began before a follow/unfollow action can't overwrite its result.
		const fetchStartedAt = Date.now();
		try {
			// 1. Fetch profile user — ALWAYS bypass the HTTP cache. The cached
			// profile embeds the viewer's `followingByMe` flag, and a stale
			// cached copy (pre-follow) would overwrite the fresh follow state
			// via onProfileLoaded, flipping the button back to "Follow".
			// Instant first paint still comes from the mount cache-read effect.
			const res = await apiFetch(`/api/users/username/${username}`, {
				bypassCache: true,
			});
			const data = await res.json();
			if (!res.ok || !data.success) {
				setLoading(false);
				return;
			}
			// Superseded — the user navigated to another profile while this
			// request was in flight; its data must not overwrite the new one.
			if (profileFetchUsernameRef.current !== username) return;

			setProfile(data.user);
			setFullName(data.user.fullName || "");
			setBio(data.user.bio || "");
			setStatusText(data.user.statusText || "");
			setProfilePicPreview(data.user.profilePic?.url || "");
			setBannerPicPreview(data.user.bannerImage?.url || "");

			// Sync following state with server — but ONLY if this fetch started
			// after the last follow action (otherwise its data predates the
			// toggle and must not overwrite the fresh optimistic state).
			if (
				onProfileLoaded &&
				data.user._id &&
				fetchStartedAt >= lastFollowActionAtRef.current
			) {
				onProfileLoaded(data.user._id, !!data.user.followingByMe);
			}

			// Trigger view count increment (if not self view) — fire-and-forget
			if (user?._id !== data.user._id) {
				apiFetch(`/api/users/${data.user._id}/view`, {
					method: "POST",
				});
			}

			// Profile header is ready — paint it NOW instead of also waiting
			// for the posts round-trip (previously the whole page was blocked
			// on both sequential requests).
			setLoading(false);

			// Fetch pinned posts in the background — they render above the grid.
			void apiFetch(`/api/users/${data.user._id}/pinned`, {
				bypassCache: true,
			})
				.then(async (r) => {
					if (profileFetchUsernameRef.current !== username) return;
					const d = await r.json();
					if (r.ok && d.success) setPinnedPosts(d.posts || []);
				})
				.catch((e) => logger.error(e));

			// "More creators like this" — only on other people's profiles. The
			// recommender uses audience overlap (their followers also follow the
			// candidate), boosted by the viewer's affinity + popularity.
			if (user?._id !== data.user._id) {
				setSimilarCreatorsLoading(true);
				apiFetch(`/api/users/${data.user._id}/similar-creators?limit=6`, {
					bypassCache: true,
				})
					.then(async (r) => {
						if (profileFetchUsernameRef.current !== username) return;
						const d = await r.json();
						if (r.ok && d.success) {
							setSimilarCreators(d.users || []);
						}
					})
					.catch((e) => logger.error(e))
					.finally(() => setSimilarCreatorsLoading(false));
			}

			const targetId = data.user._id;

			// 2. Fetch posts in the BACKGROUND (not awaited) — the header is
			// already on screen and the grid fills in the moment it arrives.
			setPostsLoading(true);
			void apiFetch(`/api/users/${targetId}/posts?limit=10`, {
				bypassCache: true,
			})
				.then(async (postRes) => {
					if (profileFetchUsernameRef.current !== username) return;
					const postData = await postRes.json();
					if (postRes.ok && postData.success) {
						setPosts(postData.posts || []);
						setPostsCursor(postData.nextCursor || null);
						setPostsHasMore(postData.hasMore || false);
					}
				})
				.catch((e) => logger.error(e))
				.finally(() => setPostsLoading(false));

			// 3. Warm saved/reposted lists for own profile in the BACKGROUND.
			// They're cache-first with instant render, so they never block the
			// profile page render.
			if (user && user.username === username) {
				void fetchSavedPosts();
				void fetchRepostedPosts();
			}
		} catch (e) {
			logger.error(e);
			setLoading(false);
		}
	};

	const handleDeletePost = async (e: React.MouseEvent, postId: string) => {
		e.stopPropagation();
		setDeleteConfirmPostId(postId);
	};

	const confirmDeletePost = async () => {
		const postId = deleteConfirmPostId;
		setDeleteConfirmPostId(null);
		if (!postId) return;
		// Optimistic removal
		setPosts((prev) => prev.filter((p) => p._id !== postId));
		setSavedPosts((prev) => prev.filter((p) => p._id !== postId));
		setRepostedPosts((prev) => prev.filter((p) => p._id !== postId));
		try {
			const res = await apiFetch(`/api/posts/${postId}`, {
				method: "DELETE",
			});
			if (!res.ok) {
				// Re-fetch to restore correct state on failure
				loadProfile();
			}
		} catch (e) {
			logger.error(e);
			// Re-fetch to restore correct state on error
			loadProfile();
		}
	};

	// ─── Archive / unarchive own posts ─────────────────────────────────
	const [archivedPosts, setArchivedPosts] = useState<Post[]>([]);
	const [loadingArchived, setLoadingArchived] = useState(false);

	const handleArchivePost = async (postId: string) => {
		try {
			const res = await apiFetch(`/api/posts/${postId}/archive`, {
				method: "POST",
			});
			if (res.ok) {
				setOpenMenuPostId(null);
				setPosts((prev) => prev.filter((p) => p._id !== postId));
				void evictCachedResponse("/api/posts/archived");
				window.dispatchEvent(
					new CustomEvent("showToast", {
						detail: {
							message: "Post archived — hidden from your profile.",
							type: "success",
						},
					}),
				);
			}
		} catch (e) {
			logger.error("Archive failed", e);
		}
	};

	const fetchArchivedPosts = async () => {
		setLoadingArchived(true);
		try {
			const res = await apiFetch("/api/posts/archived");
			const data = await res.json();
			if (res.ok && data.success) {
				setArchivedPosts(data.posts || []);
			}
		} catch (e) {
			logger.error("Failed to load archived posts", e);
		} finally {
			setLoadingArchived(false);
		}
	};

	const handleUnarchivePost = async (postId: string) => {
		try {
			const res = await apiFetch(`/api/posts/${postId}/unarchive`, {
				method: "POST",
			});
			if (res.ok) {
				// Restore the post to the Posts tab immediately so it's
				// visible without a refetch.
				const restoredPost = archivedPosts.find(
					(p) => p._id === postId,
				);
				setArchivedPosts((prev) =>
					prev.filter((p) => p._id !== postId),
				);
				if (restoredPost) {
					setPosts((prev) => [
						{ ...restoredPost, status: "published" },
						...prev.filter((p) => p._id !== postId),
					]);
				}
				void evictCachedResponse("/api/posts/archived");
				window.dispatchEvent(
					new CustomEvent("showToast", {
						detail: {
							message: "Post restored to your profile.",
							type: "success",
						},
					}),
				);
			}
		} catch (e) {
			logger.error("Unarchive failed", e);
		}
	};

	// Load archived posts when the Archived sub-view opens
	useEffect(() => {
		if (profileTab === "drafts" && showArchived && isSelf) {
			fetchArchivedPosts();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [profileTab, showArchived]);

	// Listen for realtime comment count updates from other users
	useEffect(() => {
		const handleCommentAdded = (
			e: CustomEvent<{ postId: string; commentsCount: number }>,
		) => {
			const { postId, commentsCount } = e.detail;
			setPosts((prev) =>
				prev.map((p) =>
					p._id === postId ? { ...p, commentsCount } : p,
				),
			);
			setSavedPosts((prev) =>
				prev.map((p) =>
					p._id === postId ? { ...p, commentsCount } : p,
				),
			);
			setRepostedPosts((prev) =>
				prev.map((p) =>
					p._id === postId ? { ...p, commentsCount } : p,
				),
			);
		};
		window.addEventListener(
			"postCommentAdded",
			handleCommentAdded as EventListener,
		);
		return () =>
			window.removeEventListener(
				"postCommentAdded",
				handleCommentAdded as EventListener,
			);
	}, []);

	// Listen for realtime post deletion
	useEffect(() => {
		const handlePostDeleted = (e: CustomEvent<{ postId: string }>) => {
			const { postId } = e.detail;
			setPosts((prev) => prev.filter((p) => p._id !== postId));
			setSavedPosts((prev) => prev.filter((p) => p._id !== postId));
			setRepostedPosts((prev) => prev.filter((p) => p._id !== postId));
		};
		window.addEventListener(
			"postDeleted",
			handlePostDeleted as EventListener,
		);
		return () =>
			window.removeEventListener(
				"postDeleted",
				handlePostDeleted as EventListener,
			);
	}, []);

	// Listen for realtime post edits (preserve interaction status for current user)
	useEffect(() => {
		const handlePostUpdated = (e: CustomEvent<{ post: Post }>) => {
			const { post } = e.detail;
			const updateFn = (p: Post) =>
				p._id === post._id
					? {
							...p,
							...post,
							likedByMe: p.likedByMe,
							savedByMe: p.savedByMe,
							repostedByMe: p.repostedByMe,
						}
					: p;
			setPosts((prev) => prev.map(updateFn));
			setSavedPosts((prev) => prev.map(updateFn));
			setRepostedPosts((prev) => prev.map(updateFn));
		};
		window.addEventListener(
			"postUpdated",
			handlePostUpdated as EventListener,
		);
		return () =>
			window.removeEventListener(
				"postUpdated",
				handlePostUpdated as EventListener,
			);
	}, []);

	// Listen for realtime poll votes — merge aggregate counts into every post
	// list (own posts / saved / reposted). Broadcast has no per-user data, so
	// preserve the viewer's own myVote from the existing post state.
	useEffect(() => {
		const handlePollUpdated = (
			e: CustomEvent<{ postId: string; poll: Post["poll"] }>,
		) => {
			const { postId, poll } = e.detail;
			if (!poll) return;
			const mergePoll = (existing: Post["poll"]) => ({
				...poll,
				myVote: existing?.myVote ?? poll.myVote ?? null,
			});
			const updateFn = (p: Post) =>
				p._id === postId ? { ...p, poll: mergePoll(p.poll) } : p;
			setPosts((prev) => prev.map(updateFn));
			setSavedPosts((prev) => prev.map(updateFn));
			setRepostedPosts((prev) => prev.map(updateFn));
		};
		window.addEventListener(
			"postPollUpdated",
			handlePollUpdated as EventListener,
		);
		return () =>
			window.removeEventListener(
				"postPollUpdated",
				handlePollUpdated as EventListener,
			);
	}, []);

	// Listen for realtime comment deletion (update commentsCount from authoritative server value)
	useEffect(() => {
		const handleCommentDeleted = (
			e: CustomEvent<{ postId: string; commentsCount: number }>,
		) => {
			const { postId, commentsCount } = e.detail;
			setPosts((prev) =>
				prev.map((p) =>
					p._id === postId ? { ...p, commentsCount } : p,
				),
			);
			setSavedPosts((prev) =>
				prev.map((p) =>
					p._id === postId ? { ...p, commentsCount } : p,
				),
			);
			setRepostedPosts((prev) =>
				prev.map((p) =>
					p._id === postId ? { ...p, commentsCount } : p,
				),
			);
		};
		window.addEventListener(
			"postCommentDeleted",
			handleCommentDeleted as EventListener,
		);
		return () =>
			window.removeEventListener(
				"postCommentDeleted",
				handleCommentDeleted as EventListener,
			);
	}, []);

	// Listen for realtime post view updates
	useEffect(() => {
		const handlePostViewUpdated = (
			e: CustomEvent<{ postId: string; viewsCount: number }>,
		) => {
			const { postId, viewsCount } = e.detail;
			setPosts((prev) =>
				prev.map((p) => (p._id === postId ? { ...p, viewsCount } : p)),
			);
			setSavedPosts((prev) =>
				prev.map((p) => (p._id === postId ? { ...p, viewsCount } : p)),
			);
			setRepostedPosts((prev) =>
				prev.map((p) => (p._id === postId ? { ...p, viewsCount } : p)),
			);
		};
		window.addEventListener(
			"postViewUpdated",
			handlePostViewUpdated as EventListener,
		);
		return () =>
			window.removeEventListener(
				"postViewUpdated",
				handlePostViewUpdated as EventListener,
			);
	}, []);

	// Listen for realtime user profile view updates
	useEffect(() => {
		const handleUserViewUpdated = (
			e: CustomEvent<{ userId: string; viewsCount: number }>,
		) => {
			const { userId, viewsCount } = e.detail;
			setProfile((prev) =>
				prev && prev._id === userId ? { ...prev, viewsCount } : prev,
			);
		};
		window.addEventListener(
			"userViewUpdated",
			handleUserViewUpdated as EventListener,
		);
		return () =>
			window.removeEventListener(
				"userViewUpdated",
				handleUserViewUpdated as EventListener,
			);
	}, []);

	// Listen for realtime user followers count updates. The payload carries
	// the TARGET's new followersCount AND the FOLLOWER's new followingCount,
	// so this updates whichever side the open profile is:
	//  - viewing the followed user → their followersCount changes
	//  - viewing the follower (incl. your own profile) → their followingCount
	//    changes (e.g. you followed someone from another screen).
	useEffect(() => {
		const handleFollowersCountChanged = (
			e: CustomEvent<{
				targetUserId: string;
				followerId: string;
				followersCount: number;
				followerFollowingCount?: number;
			}>,
		) => {
			const { targetUserId, followerId, followersCount, followerFollowingCount } =
				e.detail;
			setProfile((prev) => {
				if (!prev) return prev;
				// Bail out unless this event concerns the open profile — the
				// follow events are broadcast to every client, so without this
				// guard the whole Profile subtree re-renders for follow actions
				// happening anywhere else in the app.
				if (prev._id !== targetUserId && prev._id !== followerId) {
					return prev;
				}
				const updated: any = { ...prev };
				if (prev._id === targetUserId && typeof followersCount === "number") {
					updated.followersCount = followersCount;
				}
				if (
					prev._id === followerId &&
					typeof followerFollowingCount === "number"
				) {
					updated.followingCount = followerFollowingCount;
				}
				return updated;
			});
		};
		window.addEventListener(
			"userFollowersCountChanged",
			handleFollowersCountChanged as EventListener,
		);
		return () =>
			window.removeEventListener(
				"userFollowersCountChanged",
				handleFollowersCountChanged as EventListener,
			);
	}, []);

	// Listen for post interaction changes from other components
	useEffect(() => {
		const handleInteraction = (
			e: CustomEvent<{
				postId: string;
				type: string;
				value: boolean;
				source?: string;
				count?: number;
			}>,
		) => {
			const { postId, type, value, source, count } = e.detail;
			// Skip local dispatches — Profile already has its own optimistic handling
			if (source === "local") return;
			if (!source) return; // Events without source prevent double-counting
			// Socket events only update counts using authoritative count from server
			const isSocketSource = source === "socket";

			// Helper: use absolute count from server when available
			const getCount = (currentCount: number) => {
				if (count !== undefined) return count;
				return Math.max(0, currentCount + (value ? 1 : -1));
			};

			const updateFn = (p: Post) => {
				if (p._id !== postId) return p;
				const interactiveTypes = ["like", "save", "repost"];
				if (interactiveTypes.includes(type)) {
					const statusField =
						type === "like"
							? "likedByMe"
							: type === "save"
								? "savedByMe"
								: "repostedByMe";
					const countField =
						type === "like"
							? "likesCount"
							: type === "save"
								? "savesCount"
								: "repostsCount";
					if (isSocketSource) {
						// Socket: only update count using authoritative server value, leave status untouched
						return {
							...p,
							[countField]: getCount(
								(p[countField as keyof Post] as number) || 0,
							),
						};
					}
					// Not socket, not local — update both status and count
					return {
						...p,
						[statusField]: value,
						[countField]: getCount(
							(p[countField as keyof Post] as number) || 0,
						),
					};
				}
				if (type === "share") {
					return {
						...p,
						sharesCount:
							count !== undefined
								? count
								: Math.max(0, (p.sharesCount || 0) + 1),
					};
				}
				return p;
			};
			// Update all three state arrays
			setPosts((prev) => prev.map(updateFn));
			setSavedPosts((prev) => prev.map(updateFn));
			setRepostedPosts((prev) => prev.map(updateFn));
		};

		window.addEventListener(
			"postInteractionChanged",
			handleInteraction as EventListener,
		);
		return () =>
			window.removeEventListener(
				"postInteractionChanged",
				handleInteraction as EventListener,
			);
	}, []);

	// Toggle like from profile cards
	const handleProfileLikeToggle = async (
		postId: string,
		likedByMe: boolean,
	) => {
		// Liking is an explicit signal of engagement — count it as a view.
		registerPostView(postId);
		const prevLiked = likedByMe;
		const prevCount = (() => {
			const p = posts.find((x) => x._id === postId);
			return p?.likesCount ?? 0;
		})();

		setPosts((prev) =>
			prev.map((p) =>
				p._id === postId
					? {
							...p,
							likedByMe: !prevLiked,
							likesCount: Math.max(
								0,
								(p.likesCount || 0) + (prevLiked ? -1 : 1),
							),
						}
					: p,
			),
		);
		setSavedPosts((prev) =>
			prev.map((p) =>
				p._id === postId
					? {
							...p,
							likedByMe: !prevLiked,
							likesCount: Math.max(
								0,
								(p.likesCount || 0) + (prevLiked ? -1 : 1),
							),
						}
					: p,
			),
		);
		setRepostedPosts((prev) =>
			prev.map((p) =>
				p._id === postId
					? {
							...p,
							likedByMe: !prevLiked,
							likesCount: Math.max(
								0,
								(p.likesCount || 0) + (prevLiked ? -1 : 1),
							),
						}
					: p,
			),
		);
		try {
			const res = await apiFetch(`/api/likes/post/${postId}`, {
				method: "POST",
			});
			const data = await res.json();
			if (!res.ok || !data.success) {
				// Rollback to previous state
				setPosts((prev) =>
					prev.map((p) =>
						p._id === postId
							? {
									...p,
									likedByMe: prevLiked,
									likesCount: prevCount,
								}
							: p,
					),
				);
				setSavedPosts((prev) =>
					prev.map((p) =>
						p._id === postId
							? {
									...p,
									likedByMe: prevLiked,
									likesCount: prevCount,
								}
							: p,
					),
				);
				setRepostedPosts((prev) =>
					prev.map((p) =>
						p._id === postId
							? {
									...p,
									likedByMe: prevLiked,
									likesCount: prevCount,
								}
							: p,
					),
				);
			}
		} catch (e) {
			logger.error(e);
			// Rollback
			setPosts((prev) =>
				prev.map((p) =>
					p._id === postId
						? { ...p, likedByMe: prevLiked, likesCount: prevCount }
						: p,
				),
			);
			setSavedPosts((prev) =>
				prev.map((p) =>
					p._id === postId
						? { ...p, likedByMe: prevLiked, likesCount: prevCount }
						: p,
				),
			);
			setRepostedPosts((prev) =>
				prev.map((p) =>
					p._id === postId
						? { ...p, likedByMe: prevLiked, likesCount: prevCount }
						: p,
				),
			);
		}
	};

	// Toggle save from profile cards
	const handleProfileSaveToggle = async (
		postId: string,
		savedByMe: boolean,
	) => {
		// Saving is an explicit signal of engagement — count it as a view.
		registerPostView(postId);
		const prevSaved = savedByMe;
		const prevCount = (() => {
			const p =
				savedPosts.find((x) => x._id === postId) ??
				posts.find((x) => x._id === postId);
			return p?.savesCount ?? 0;
		})();

		// If unsaving and on the saved tab, remove immediately
		if (profileTab === "saved" && prevSaved) {
			setSavedPosts((prev) => prev.filter((p) => p._id !== postId));
		} else {
			setSavedPosts((prev) =>
				prev.map((p) =>
					p._id === postId
						? {
								...p,
								savedByMe: !prevSaved,
								savesCount: Math.max(
									0,
									(p.savesCount || 0) + (prevSaved ? -1 : 1),
								),
							}
						: p,
				),
			);
		}

		setPosts((prev) =>
			prev.map((p) =>
				p._id === postId
					? {
							...p,
							savedByMe: !prevSaved,
							savesCount: Math.max(
								0,
								(p.savesCount || 0) + (prevSaved ? -1 : 1),
							),
						}
					: p,
			),
		);
		setRepostedPosts((prev) =>
			prev.map((p) =>
				p._id === postId
					? {
							...p,
							savedByMe: !prevSaved,
							savesCount: Math.max(
								0,
								(p.savesCount || 0) + (prevSaved ? -1 : 1),
							),
						}
					: p,
			),
		);
		try {
			const res = await apiFetch(`/api/saves/${postId}`, {
				method: "POST",
			});
			const data = await res.json();
			if (!res.ok || !data.success) {
				// Rollback: re-fetch to get correct state
				if (profileTab === "saved") fetchSavedPosts();
				else {
					setPosts((prev) =>
						prev.map((p) =>
							p._id === postId
								? {
										...p,
										savedByMe: prevSaved,
										savesCount: prevCount,
									}
								: p,
						),
					);
					setSavedPosts((prev) =>
						prev.map((p) =>
							p._id === postId
								? {
										...p,
										savedByMe: prevSaved,
										savesCount: prevCount,
									}
								: p,
						),
					);
					setRepostedPosts((prev) =>
						prev.map((p) =>
							p._id === postId
								? {
										...p,
										savedByMe: prevSaved,
										savesCount: prevCount,
									}
								: p,
						),
					);
				}
			}
		} catch (e) {
			logger.error(e);
			if (profileTab === "saved") fetchSavedPosts();
			else {
				setPosts((prev) =>
					prev.map((p) =>
						p._id === postId
							? {
									...p,
									savedByMe: prevSaved,
									savesCount: prevCount,
								}
							: p,
					),
				);
				setSavedPosts((prev) =>
					prev.map((p) =>
						p._id === postId
							? {
									...p,
									savedByMe: prevSaved,
									savesCount: prevCount,
								}
							: p,
					),
				);
				setRepostedPosts((prev) =>
					prev.map((p) =>
						p._id === postId
							? {
									...p,
									savedByMe: prevSaved,
									savesCount: prevCount,
								}
							: p,
					),
				);
			}
		}
	};

	// Toggle repost from profile cards
	const handleProfileRepostToggle = async (
		postId: string,
		repostedByMe: boolean,
	) => {
		const prevReposted = repostedByMe;
		const prevCount = (() => {
			const p =
				repostedPosts.find((x) => x._id === postId) ??
				posts.find((x) => x._id === postId);
			return p?.repostsCount ?? 0;
		})();

		// If un-reposting and on the reposts tab, remove immediately
		if (profileTab === "reposts" && prevReposted) {
			setRepostedPosts((prev) => prev.filter((p) => p._id !== postId));
		} else {
			setRepostedPosts((prev) =>
				prev.map((p) =>
					p._id === postId
						? {
								...p,
								repostedByMe: !prevReposted,
								repostsCount: Math.max(
									0,
									(p.repostsCount || 0) +
										(prevReposted ? -1 : 1),
								),
							}
						: p,
				),
			);
		}

		setPosts((prev) =>
			prev.map((p) =>
				p._id === postId
					? {
							...p,
							repostedByMe: !prevReposted,
							repostsCount: Math.max(
								0,
								(p.repostsCount || 0) + (prevReposted ? -1 : 1),
							),
						}
					: p,
			),
		);
		setSavedPosts((prev) =>
			prev.map((p) =>
				p._id === postId
					? {
							...p,
							repostedByMe: !prevReposted,
							repostsCount: Math.max(
								0,
								(p.repostsCount || 0) + (prevReposted ? -1 : 1),
							),
						}
					: p,
			),
		);
		try {
			const res = await apiFetch(`/api/reposts/${postId}`, {
				method: "POST",
			});
			const data = await res.json();
			if (!res.ok || !data.success) {
				// Rollback: re-fetch on reposts tab, map on others
				if (profileTab === "reposts") fetchRepostedPosts();
				else {
					setPosts((prev) =>
						prev.map((p) =>
							p._id === postId
								? {
										...p,
										repostedByMe: prevReposted,
										repostsCount: prevCount,
									}
								: p,
						),
					);
					setSavedPosts((prev) =>
						prev.map((p) =>
							p._id === postId
								? {
										...p,
										repostedByMe: prevReposted,
										repostsCount: prevCount,
									}
								: p,
						),
					);
					setRepostedPosts((prev) =>
						prev.map((p) =>
							p._id === postId
								? {
										...p,
										repostedByMe: prevReposted,
										repostsCount: prevCount,
									}
								: p,
						),
					);
				}
			}
		} catch (e) {
			logger.error(e);
			if (profileTab === "reposts") fetchRepostedPosts();
			else {
				setPosts((prev) =>
					prev.map((p) =>
						p._id === postId
							? {
									...p,
									repostedByMe: prevReposted,
									repostsCount: prevCount,
								}
							: p,
					),
				);
				setSavedPosts((prev) =>
					prev.map((p) =>
						p._id === postId
							? {
									...p,
									repostedByMe: prevReposted,
									repostsCount: prevCount,
								}
							: p,
					),
				);
				setRepostedPosts((prev) =>
					prev.map((p) =>
						p._id === postId
							? {
									...p,
									repostedByMe: prevReposted,
									repostsCount: prevCount,
								}
							: p,
					),
				);
			}
		}
	};

	// Auto-clear error and success messages after timeout
	useEffect(() => {
		if (!error) return;
		const timer = setTimeout(() => setError(null), 6000);
		return () => clearTimeout(timer);
	}, [error]);

	// Post view tracking (3s visibility → one view) across ALL profile post
	// surfaces: the Posts tab, Saved, and Reposts. Cards carry data-post-id.
	usePostViewTracking({
		enabled: !loading,
		deps: [posts, savedPosts, repostedPosts, profileTab, loading],
	});

	useEffect(() => {
		// loadProfile decides whether to show the skeleton: when the cache
		// already has this user's profile (return visit / navigated back) it
		// stays visible and refreshes silently in the background instead of
		// flashing a loading skeleton.
		loadProfile();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [targetUsername, user?._id]);

	// Load saved & reposted when switching to those tabs (self only)
	useEffect(() => {
		if (
			profileTab === "saved" &&
			isSelf !== undefined &&
			savedPosts.length === 0
		) {
			fetchSavedPosts();
		}
		if (
			profileTab === "reposts" &&
			isSelf !== undefined &&
			repostedPosts.length === 0
		) {
			fetchRepostedPosts();
		}
		if (profileTab === "drafts" && isSelf !== undefined) {
			fetchDrafts();
		}
		if (profileTab === "collections" && isSelf !== undefined) {
			fetchCollections();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [profileTab]);

	const fetchMorePosts = async () => {
		if (!postsCursor || loadingMorePosts) return;
		setLoadingMorePosts(true);
		try {
			const targetId = profile?._id;
			if (!targetId) return;
			const res = await apiFetch(
				`/api/users/${targetId}/posts?limit=10&cursor=${postsCursor}`,
			);
			const data = await res.json();
			if (res.ok && data.success) {
				setPosts((prev) => {
					const keys = new Set(prev.map((p) => p._id));
					const newOnes = (data.posts || []).filter(
						(p: any) => !keys.has(p._id),
					);
					return [...prev, ...newOnes];
				});
				setPostsCursor(data.nextCursor || null);
				setPostsHasMore(data.hasMore || false);
			}
		} catch (e) {
			logger.error(e);
		} finally {
			setLoadingMorePosts(false);
		}
	};

	// Infinite scroll sentinel observer for posts
	useEffect(() => {
		if (!postsHasMore || loadingMorePosts || !profile) return;
		const sentinel = postsSentinelRef.current;
		if (!sentinel) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) fetchMorePosts();
			},
			{ rootMargin: "200px", threshold: 0 },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [postsHasMore, loadingMorePosts, postsCursor, profile]);

	// Infinite scroll sentinel observer for saved
	useEffect(() => {
		if (!savedHasMore || loadingMoreSaved || !profile) return;
		const sentinel = savedSentinelRef.current;
		if (!sentinel) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) fetchSavedPosts(savedCursor);
			},
			{ rootMargin: "200px", threshold: 0 },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [savedHasMore, loadingMoreSaved, savedCursor, profile]);

	// Infinite scroll sentinel observer for reposts
	useEffect(() => {
		if (!repostsHasMore || loadingMoreReposts || !profile) return;
		const sentinel = repostsSentinelRef.current;
		if (!sentinel) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting)
					fetchRepostedPosts(repostsCursor);
			},
			{ rootMargin: "200px", threshold: 0 },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [repostsHasMore, loadingMoreReposts, repostsCursor, profile]);

	const loadList = async (type: "followers" | "following" | "reposts") => {
		if (!profile) return;
		setActiveList(type);
		setListLoading(true);
		try {
			// followers and following come from /api/follows/:userId/...
			const endpoint =
				type === "reposts"
					? `/api/users/${profile._id}/reposts`
					: `/api/follows/${profile._id}/${type}`;
			const res = await apiFetch(endpoint);
			const data = await res.json();
			if (res.ok && data.success) {
				if (type === "reposts") {
					setListItems(data.posts || []);
				} else if (type === "followers") {
					// Extract the actual user objects from the follower objects
					const users = (data.followers || [])
						.map((f: any) => {
							return f.follower || f;
						})
						.filter(Boolean);
					setListItems(users);
				} else {
					// Extract the actual user objects from the following objects
					const users = (data.following || [])
						.map((f: any) => {
							return f.following || f;
						})
						.filter(Boolean);
					setListItems(users);
				}
			}
		} catch (e) {
			logger.error(`Error loading ${type}:`, e);
		} finally {
			setListLoading(false);
		}
	};

	const fetchPinnedPosts = async () => {
		try {
			const res = await apiFetch(`/api/users/${profile?._id}/pinned`, {
				bypassCache: true,
			});
			const data = await res.json();
			if (res.ok && data.success) setPinnedPosts(data.posts || []);
		} catch (err) {
			logger.error("Failed to fetch pinned posts", err);
		}
	};

	const handleTogglePin = async (post: Post) => {
		const isPinned = post.pinnedByMe;
		setOpenMenuPostId(null);
		try {
			const res = await apiFetch(
				`/api/users/${profile?._id}/${isPinned ? "unpin" : "pin"}`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ postId: post._id }),
				},
			);
			const data = await res.json();
			if (!res.ok || !data.success) {
				throw new Error(data.message || "Could not update pin.");
			}
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message: isPinned
							? "Post unpinned from profile"
							: "Post pinned to profile",
						type: "success",
					},
				}),
			);
			// Refresh pinned + the grid so both stay consistent.
			await fetchPinnedPosts();
			const fresh = await apiFetch(
				`/api/users/${profile?._id}/posts?limit=${posts.length || 10}`,
				{ bypassCache: true },
			);
			const freshData = await fresh.json();
			if (fresh.ok && freshData.success) setPosts(freshData.posts || []);
		} catch (err: any) {
			logger.error(err);
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: { message: err.message || "Failed to update pin.", type: "error" },
				}),
			);
		}
	};

	const fetchSavedPosts = async (
		cursor?: string | null,
		opts?: { silent?: boolean },
	) => {
		if (cursor) {
			setLoadingMoreSaved(true);
		} else if (!opts?.silent) {
			setLoadingSaved(true);
		}
		try {
			let endpoint = "/api/saves?limit=10";
			if (cursor) {
				endpoint += `&cursor=${cursor}`;
			}
			// Instant render from cache (stale-while-revalidate) — never show a
			// blank spinner when we already have data for this list.
			if (!cursor) {
				try {
					const cached = await getCachedResponse<{
						posts: Post[];
						success: boolean;
						nextCursor: string | null;
						hasMore: boolean;
					}>(endpoint);
					if (cached?.success && cached.posts?.length) {
						setSavedPosts(cached.posts);
						setSavedCursor(cached.nextCursor || null);
						setSavedHasMore(cached.hasMore || false);
					}
				} catch {
					// Non-critical — fall through to the network fetch below
				}
			}
			const res = await apiFetch(endpoint);
			const data = await res.json();
			if (res.ok && data.success) {
				if (cursor) {
					setSavedPosts((prev) => {
						const keys = new Set(prev.map((p) => p._id));
						const newOnes = (data.posts || []).filter(
							(p: any) => !keys.has(p._id),
						);
						return [...prev, ...newOnes];
					});
				} else {
					setSavedPosts(data.posts || []);
				}
				setSavedCursor(data.nextCursor || null);
				setSavedHasMore(data.hasMore || false);
			}
		} catch (e) {
			logger.error(e);
		} finally {
			if (cursor) {
				setLoadingMoreSaved(false);
			} else {
				setLoadingSaved(false);
			}
		}
	};

	const fetchRepostedPosts = async (
		cursor?: string | null,
		opts?: { silent?: boolean },
	) => {
		if (cursor) {
			setLoadingMoreReposts(true);
		} else if (!opts?.silent) {
			setLoadingReposts(true);
		}
		try {
			let endpoint = "/api/reposts?limit=10";
			if (cursor) {
				endpoint += `&cursor=${cursor}`;
			}
			// Instant render from cache (stale-while-revalidate)
			if (!cursor) {
				try {
					const cached = await getCachedResponse<{
						posts: Post[];
						success: boolean;
						nextCursor: string | null;
						hasMore: boolean;
					}>(endpoint);
					if (cached?.success && cached.posts?.length) {
						setRepostedPosts(cached.posts);
						setRepostsCursor(cached.nextCursor || null);
						setRepostsHasMore(cached.hasMore || false);
					}
				} catch {
					// Non-critical — fall through to the network fetch below
				}
			}
			const res = await apiFetch(endpoint);
			const data = await res.json();
			if (res.ok && data.success) {
				if (cursor) {
					setRepostedPosts((prev) => {
						const keys = new Set(prev.map((p) => p._id));
						const newOnes = (data.posts || []).filter(
							(p: any) => !keys.has(p._id),
						);
						return [...prev, ...newOnes];
					});
				} else {
					setRepostedPosts(data.posts || []);
				}
				setRepostsCursor(data.nextCursor || null);
				setRepostsHasMore(data.hasMore || false);
			}
		} catch (e) {
			logger.error(e);
		} finally {
			if (cursor) {
				setLoadingMoreReposts(false);
			} else {
				setLoadingReposts(false);
			}
		}
	};

	// Fetch the current user's drafts + scheduled posts (self only)
	const fetchDrafts = async (opts?: { silent?: boolean }) => {
		if (!opts?.silent) setLoadingDrafts(true);
		try {
			// Instant render from cache (stale-while-revalidate)
			try {
				const cached = await getCachedResponse<{
					drafts: Post[];
					scheduled: Post[];
					success: boolean;
				}>("/api/posts/drafts");
				if (cached?.success) {
					if (cached.drafts?.length) setDrafts(cached.drafts);
					if (cached.scheduled?.length)
						setScheduledPosts(cached.scheduled);
				}
			} catch {
				// Non-critical — fall through to the network fetch below
			}
			// Cache-first: apiFetch serves a fresh cached copy instantly and
			// only hits the network when the entry is stale/missing.
			const res = await apiFetch("/api/posts/drafts");
			const data = await res.json();
			if (res.ok && data.success) {
				setDrafts(data.drafts || []);
				setScheduledPosts(data.scheduled || []);
			}
		} catch (e) {
			logger.error(e);
		} finally {
			setLoadingDrafts(false);
		}
	};

	// ─── Collections (self only) ───────────────────────────────────────
	const fetchCollections = async () => {
		setLoadingCollections(true);
		try {
			// bypassCache: the collection list + counts must be fresh — a stale
			// cached list can show "0" even after collections were created.
			const res = await apiFetch("/api/collections", {
				bypassCache: true,
			});
			const data = await res.json();
			if (res.ok && data.success) {
				setCollections(data.collections || []);
			}
		} catch (e) {
			logger.error("Failed to fetch collections", e);
		} finally {
			setLoadingCollections(false);
		}
	};

	const handleCreateCollection = async () => {
		if (!newCollectionName.trim() || creatingCollection) return;
		setCreatingCollection(true);
		try {
			const res = await apiFetch("/api/collections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: newCollectionName.trim() }),
			});
			const data = await res.json();
			if (!res.ok)
				throw new Error(data.message || "Failed to create collection.");
			void evictCachedResponse("/api/collections");
			setCollections((prev) => [data.collection, ...prev]);
			setNewCollectionName("");
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message: "Collection created!",
						type: "success",
					},
				}),
			);
		} catch (err: any) {
			logger.error("Create collection failed", err);
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message: err.message || "Failed to create collection.",
						type: "error",
					},
				}),
			);
		} finally {
			setCreatingCollection(false);
		}
	};

	// Share a collection to chat partners (DM) or community chats — mirrors
	// the post forward flow, reusing the exact same ForwardModal.
	const handleForwardCollection = async (
		partners: ForwardPartner[],
	): Promise<boolean> => {
		if (!shareCollection || partners.length === 0) return false;
		setSharingCollection(true);
		try {
			const results = await Promise.all(
				partners.map(async (partner) => {
					try {
						const isCommunity = partner.type === "community";
						const res = await apiFetch(
							isCommunity
								? `/api/collections/${shareCollection._id}/forward-community`
								: `/api/collections/${shareCollection._id}/forward`,
							{
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: isCommunity
									? JSON.stringify({ communityId: partner._id })
									: JSON.stringify({ recipientId: partner._id }),
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
									? "Collection shared!"
									: `Shared to ${okCount} of ${partners.length} chats.`,
							type: "success",
						},
					}),
				);
				setShareCollection(null);
				return true;
			}
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message: "Could not share this collection.",
						type: "error",
					},
				}),
			);
			return false;
		} catch (err) {
			logger.error("Share collection failed", err);
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message: "Could not share this collection.",
						type: "error",
					},
				}),
			);
			return false;
		} finally {
			setSharingCollection(false);
		}
	};

	const confirmDeleteCollection = async () => {
		const collectionId = deleteConfirmCollectionId;
		setDeleteConfirmCollectionId(null);
		if (!collectionId) return;
		try {
			const res = await apiFetch(`/api/collections/${collectionId}`, {
				method: "DELETE",
			});
			if (res.ok) {
				void evictCachedResponse("/api/collections");
				setCollections((prev) =>
					prev.filter((c) => c._id !== collectionId),
				);
				if (activeCollectionId === collectionId) {
					setActiveCollectionId(null);
					setCollectionPosts([]);
					setCollectionCursor(null);
					setCollectionHasMore(false);
				}
				window.dispatchEvent(
					new CustomEvent("showToast", {
						detail: {
							message: "Collection deleted.",
							type: "success",
						},
					}),
				);
			}
		} catch (e) {
			logger.error("Delete collection failed", e);
		}
	};

	const handleOpenCollection = async (collectionId: string) => {
		setActiveCollectionId(collectionId);
		setCollectionPosts([]);
		setCollectionCursor(null);
		setCollectionHasMore(false);
		setLoadingCollectionPosts(true);
		try {
			const res = await apiFetch(`/api/collections/${collectionId}`);
			const data = await res.json();
			if (res.ok && data.success) {
				setCollectionPosts(data.posts || []);
				setCollectionCursor(data.nextCursor || null);
				setCollectionHasMore(data.hasMore || false);
			}
		} catch (e) {
			logger.error("Failed to load collection posts", e);
		} finally {
			setLoadingCollectionPosts(false);
		}
	};

	const loadMoreCollectionPosts = async () => {
		if (!activeCollectionId || !collectionCursor || loadingMoreCollectionPosts)
			return;
		setLoadingMoreCollectionPosts(true);
		try {
			const res = await apiFetch(
				`/api/collections/${activeCollectionId}?cursor=${collectionCursor}`,
			);
			const data = await res.json();
			if (res.ok && data.success) {
				setCollectionPosts((prev) => {
					const keys = new Set(prev.map((p) => p._id));
					const newOnes = (data.posts || []).filter(
						(p: any) => !keys.has(p._id),
					);
					return [...prev, ...newOnes];
				});
				setCollectionCursor(data.nextCursor || null);
				setCollectionHasMore(data.hasMore || false);
			}
		} catch (e) {
			logger.error("Load more collection posts failed", e);
		} finally {
			setLoadingMoreCollectionPosts(false);
		}
	};

	const handleRemoveFromCollection = async (postId: string) => {
		if (!activeCollectionId) return;
		try {
			const res = await apiFetch(
				`/api/collections/${activeCollectionId}/posts/${postId}`,
				{ method: "DELETE" },
			);
			if (res.ok) {
				void evictCachedResponse("/api/collections");
				void evictCachedResponse(
					`/api/collections/${activeCollectionId}`,
				);
				setCollectionPosts((prev) =>
					prev.filter((p) => p._id !== postId),
				);
				// Keep the grid's per-collection count in sync immediately.
				setCollections((prev) =>
					prev.map((c) =>
						c._id === activeCollectionId
							? {
									...c,
									posts: (c.posts || []).filter(
										(p: any) => p !== postId && p?._id !== postId,
									),
								}
							: c,
					),
				);
			}
		} catch (e) {
			logger.error("Remove from collection failed", e);
		}
	};

	// Publish a draft (or an early-published scheduled post)
	const handlePublishDraft = async (postId: string) => {
		try {
			const res = await apiFetch(`/api/posts/${postId}/publish`, {
				method: "POST",
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.message || "Failed to publish.");
			setDrafts((prev) => prev.filter((p) => p._id !== postId));
			setScheduledPosts((prev) => prev.filter((p) => p._id !== postId));
			// Evict the drafts cache so the published post isn't served from
			// a stale cached list on the next Drafts-tab visit.
			void evictCachedResponse("/api/posts/drafts");
			if (data.post) {
				// Seed the client-side feed cache so the home feed shows the
				// published post INSTANTLY on next mount (the Feed component is
				// unmounted while on Profile, so it can't receive the in-memory
				// newPostCreated event). The background cache refresh then
				// reconciles with the server without the user waiting.
				prependPostToCachedFeeds(data.post);
				window.dispatchEvent(
					new CustomEvent("newPostCreated", {
						detail: { post: data.post },
					}),
				);
			}
			// If the feed is already mounted, force an instant bypass-cache
			// refresh so the new post appears even without a remount.
			window.dispatchEvent(new CustomEvent("forceFeedRefresh"));
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: { message: "Post published!", type: "success" },
				}),
			);
		} catch (err: any) {
			logger.error("Publish draft failed", err);
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message: err.message || "Failed to publish.",
						type: "error",
					},
				}),
			);
		}
	};

	// Request deletion confirmation for a draft / scheduled post
	const handleDeleteDraft = (postId: string) => {
		setDeleteConfirmDraftId(postId);
	};

	// Perform the actual deletion after the user confirms
	const confirmDeleteDraft = async () => {
		const postId = deleteConfirmDraftId;
		setDeleteConfirmDraftId(null);
		if (!postId) return;
		try {
			const res = await apiFetch(`/api/posts/${postId}`, {
				method: "DELETE",
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.message || "Failed to delete.");
			setDrafts((prev) => prev.filter((p) => p._id !== postId));
			setScheduledPosts((prev) => prev.filter((p) => p._id !== postId));
			// Evict the drafts cache so the deleted draft isn't served from a
			// stale cached list on the next Drafts-tab visit.
			void evictCachedResponse("/api/posts/drafts");
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: { message: "Post deleted.", type: "success" },
				}),
			);
		} catch (err: any) {
			logger.error("Delete draft failed", err);
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message: err.message || "Failed to delete.",
						type: "error",
					},
				}),
			);
		}
	};

	const handleFollowToggle = async () => {
		if (!profile) return;
		const amIFollowing =
			followingStates[profile._id] ??
			(profile as any).followingByMe ??
			(profile as any).isFollowing ??
			false;

		// Any loadProfile already in flight is now stale relative to this
		// action — its onProfileLoaded must not overwrite the new state.
		lastFollowActionAtRef.current = Date.now();

		// 1. Optimistic Update local profile state instantly
		setProfile((prev) =>
			prev
				? ({
						...prev,
						isFollowing: !amIFollowing,
						followingByMe: !amIFollowing,
						followersCount: amIFollowing
							? Math.max(0, (prev.followersCount || 0) - 1)
							: (prev.followersCount || 0) + 1,
					} as any)
				: null,
		);

		try {
			// Call the global toggle function (handles global optimistic state + rollback + toast)
			const outcome = await onToggleFollow(profile._id);

			// Private account → a follow REQUEST was sent, not a follow. Undo the
			// optimistic local follow state so the header doesn't show a bogus
			// +1 follower / "Following" until reload (the button itself shows
			// "Requested" via the requestedFollows prop). This runs for BOTH
			// directions: request sent (requested: true) and request cancelled
			// (requested: false) — in neither case did a real follow happen, so
			// the optimistic follow state must always be rolled back.
			if (outcome) {
				setProfile((prev) =>
					prev
						? ({
								...prev,
								isFollowing: false,
								followingByMe: false,
								followersCount: Math.max(
									0,
									(prev.followersCount || 0) - 1,
								),
							} as any)
						: null,
				);
			}
		} catch (err) {
			// 2. Rollback local profile state if server failed
			setProfile((prev) =>
				prev
					? ({
							...prev,
							isFollowing: amIFollowing,
							followingByMe: amIFollowing,
							followersCount: !amIFollowing
								? Math.max(0, (prev.followersCount || 0) - 1)
								: (prev.followersCount || 0) + 1,
						} as any)
					: null,
			);
		}
	};

	// ─── Private-account follow-request inbox (own profile only) ────────
	// Instagram-style: the owner of a private account sees pending requests
	// on their profile and can Approve / Decline each one inline.
	const [pendingRequests, setPendingRequests] = useState<
		{ _id: string; createdAt: string; sender: any }[]
	>([]);
	const [loadingRequests, setLoadingRequests] = useState(false);
	const [busyRequestId, setBusyRequestId] = useState<string | null>(null);

	const fetchPendingRequests = async () => {
		if (!isSelf) return;
		setLoadingRequests(true);
		try {
			const res = await apiFetch("/api/users/follow-requests");
			const data = await res.json();
			if (res.ok && data.success) {
				setPendingRequests(data.requests || []);
			}
		} catch (e) {
			logger.error("Failed to load follow requests", e);
		} finally {
			setLoadingRequests(false);
		}
	};

	// Load pending requests once when the OWN profile loads. isSelf is
	// computed inline here (the main isSelf const is declared further down
	// in the component, after the data-loading hooks).
	useEffect(() => {
		if (profile && user?._id === profile._id) fetchPendingRequests();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [profile?._id, user?._id]);

	const handleRequestDecision = async (requestId: string, approve: boolean) => {
		const req = pendingRequests.find((r) => r._id === requestId);
		if (!req || busyRequestId) return;
		setBusyRequestId(requestId);
		try {
			const res = await apiFetch(
				`/api/users/${req.sender._id}/${approve ? "approve-request" : "decline-request"}`,
				{ method: "POST" },
			);
			const data = await res.json();
			if (!res.ok || !data.success) {
				throw new Error(data.message || "Could not update request");
			}
			setPendingRequests((prev) => prev.filter((r) => r._id !== requestId));
			// Bump the follower count locally when approving.
			if (approve) {
				setProfile((prev) =>
					prev
						? { ...prev, followersCount: (prev.followersCount || 0) + 1 }
						: prev,
				);
			}
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message: approve
							? "Follow request approved — they can now see your content"
							: "Follow request declined",
						type: "success",
					},
				}),
			);
			// Refresh the profile header (counts + follow state).
			void loadProfile();
		} catch (err: any) {
			logger.error("Follow request decision failed", err);
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message: err.message || "Failed to update follow request",
						type: "error",
					},
				}),
			);
		} finally {
			setBusyRequestId(null);
		}
	};

	// Copy the profile link to the clipboard and count the share
	const handleCopyProfileLink = async () => {
		if (!profile) return;
		setShareMenuOpen(false);
		const urlLink = `${window.location.origin}/u/${profile.username}`;
		try {
			await navigator.clipboard.writeText(urlLink);
		} catch (e) {
			// Fallback for browsers without the async clipboard API
			try {
				const ta = document.createElement("textarea");
				ta.value = urlLink;
				ta.style.position = "fixed";
				ta.style.opacity = "0";
				document.body.appendChild(ta);
				ta.select();
				document.execCommand("copy");
				document.body.removeChild(ta);
			} catch {
				logger.error("Clipboard copy failed", e);
			}
		}
		// Count the share (fire-and-forget)
		apiFetch(`/api/users/${profile._id}/share`, { method: "POST" })
			.then((res) => res.json())
			.then((data) => {
				if (data?.success) {
					setProfile((prev) =>
						prev
							? {
									...prev,
									sharesCount: data.shares ?? data.count,
								}
							: null,
					);
				}
			})
			.catch(() => {});
		window.dispatchEvent(
			new CustomEvent("showToast", {
				detail: { message: "Profile link copied!", type: "success" },
			}),
		);
	};

	// Forward the profile to one or more chat partners (notifies each recipient)
	const handleForwardProfile = async (
		partners: ForwardPartner[],
	): Promise<boolean> => {
		if (!profile || partners.length === 0) return false;
		try {
			const results = await Promise.all(
				partners.map(async (partner) => {
					try {
						const res = await apiFetch(
							`/api/users/${profile._id}/forward`,
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
									? "Profile sent!"
									: `Profile sent to ${okCount} of ${partners.length} conversations.`,
								type: "success",
							},
					}),
				);
				return true;
			}
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message: "Failed to send the profile. Please try again.",
						type: "error",
					},
				}),
			);
			return false;
		} catch (e) {
			logger.error("Failed to forward profile", e);
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message: "Failed to send the profile. Please try again.",
						type: "error",
					},
				}),
			);
			return false;
		}
	};

	// Close the share menu on outside click / Escape
	useEffect(() => {
		if (!shareMenuOpen) return;
		const handleOutside = (e: MouseEvent | TouchEvent) => {
			if (
				shareMenuRef.current &&
				!shareMenuRef.current.contains(e.target as Node)
			) {
				setShareMenuOpen(false);
			}
		};
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setShareMenuOpen(false);
		};
		document.addEventListener("mousedown", handleOutside);
		document.addEventListener("touchstart", handleOutside);
		document.addEventListener("keydown", handleKey);
		return () => {
			document.removeEventListener("mousedown", handleOutside);
			document.removeEventListener("touchstart", handleOutside);
			document.removeEventListener("keydown", handleKey);
		};
	}, [shareMenuOpen]);

	const handleUpdateSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSaving(true);
		setError(null);
		setSuccess(null);

		const formData = new FormData();
		formData.append("fullName", fullName);
		formData.append("bio", bio);
		formData.append("statusText", statusText);

		if (profilePicFile) {
			formData.append("profilePic", await downscaleImageFile(profilePicFile));
		} else if (!profilePicPreview && profile?.profilePic?.url) {
			formData.append("removeProfilePic", "true");
		}
		if (bannerPicFile) {
			formData.append("bannerImage", await downscaleImageFile(bannerPicFile));
		} else if (!bannerPicPreview && profile?.bannerImage?.url) {
			formData.append("removeBannerImage", "true");
		}

		try {
			const res = await apiFetch("/api/users/update-profile", {
				method: "PUT",
				body: formData,
			});
			const data = await res.json();
			if (res.ok && data.success) {
				setProfile(data.user);
				onUserUpdate(data.user); // Synchronize active session user
				setTimeout(() => {
					setEditOpen(false);
				}, 1500);
			} else {
				setError(data.message || "Failed to save settings.");
			}
		} catch (err) {
			setError("Lost connection to server during upload.");
		} finally {
			setSaving(false);
		}
	};

	if (loading) {
		return (
			<div className="w-full space-y-6 pt-6 px-2 sm:pt-10 sm:px-4">
				<Skeleton variant="banner" />
				<div className="flex items-center gap-4 px-2">
					<Skeleton variant="circle" className="h-18 w-18 shrink-0" />
					<div className="space-y-2">
						<Skeleton className="h-5 w-40" />
						<Skeleton className="h-4 w-20" />
					</div>
				</div>
				<div className="grid grid-cols-4 gap-3">
					{[1, 2, 3, 4].map((i) => (
						<Skeleton key={i} className="h-20" />
					))}
				</div>
			</div>
		);
	}

	if (!profile) {
		return (
			<div className="flex h-96 flex-col items-center justify-center text-center">
				<p className="text-sm text-zinc-400">
					This profile does not exist.
				</p>
			</div>
		);
	}

	const isSelf = user?._id === profile._id;

	// Live count source: on your OWN profile the App-level `user` object is
	// the authoritative live value — onToggleFollow bumps it optimistically
	// and the user:follow/unfollow socket events correct it with the server
	// value, so the header stays right even when the follow action happened
	// on a different screen. On other people's profiles the fetched `profile`
	// object rules (it also updates via the same socket events).
	const displayFollowingCount = isSelf
		? (user?.followingCount ?? profile.followingCount ?? 0)
		: (profile.followingCount ?? 0);
	const displayFollowersCount = isSelf
		? (user?.followersCount ?? profile.followersCount ?? 0)
		: (profile.followersCount ?? 0);

	// PRIVATE account gate (Instagram-style): a non-follower who hasn't sent
	// a request sees the profile header + counts but a locked content area
	// instead of posts, tabs, pinned posts and follower/following lists.
	const amIFollowingView =
		followingStates[profile._id] ??
		(profile as any).followingByMe ??
		(profile as any).isFollowing ??
		false;
	const isPrivateLocked =
		!!profile.isPrivate && !isSelf && !amIFollowingView;
	const isRequestedView =
		!amIFollowingView &&
		(!!requestedFollows?.[profile._id] ||
			!!(profile as any).followRequestedByMe);

	// Pinned posts render at the top of the Posts tab (deduped against the
	// paginated list so a pinned post never appears twice).
	const displayPosts = [
		...pinnedPosts,
		...posts.filter((p) => !pinnedPosts.some((pp) => pp._id === p._id)),
	];

	return (
		<>
			<div
				ref={containerRef}
				onTouchStart={handleTouchStart}
				onTouchMove={handleTouchMove}
				onTouchEnd={handleTouchEnd}
				className="w-full px-2 pt-6"
				style={{
					transform:
						pullDistance !== 0
							? `translateY(${pullDistance}px)`
							: undefined,
					transition: isPullingRef.current
						? "none"
						: "transform 0.3s ease-out",
				}}>
				{/* Banner */}
				{bannerPicPreview ? (
					<div
						className="group relative h-40 overflow-hidden rounded-3xl border border-white/20 bg-zinc-900 md:h-48 cursor-pointer"
						onClick={() => {
							window.dispatchEvent(
								new CustomEvent("openImagePreview", {
									detail: bannerPicPreview,
								}),
							);
						}}>
						<img
							loading="eager"
							decoding="async"
							src={optimizeImageUrl(bannerPicPreview, 1200)}
							alt="User banner"
							className="h-full w-full object-cover transition-transform duration-1000 group-hover:scale-102"
						/>
						<div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
					</div>
				) : (
					<div className="relative flex h-40 items-center justify-center rounded-3xl border border-zinc-800 bg-zinc-900/50 md:h-48 overflow-hidden">
						{/* Subtle dots pattern */}
						<div
							className="absolute inset-0 opacity-[0.04]"
							style={{
								backgroundImage: `radial-gradient(circle, white 1px, transparent 1px)`,
								backgroundSize: "20px 20px",
							}}
						/>
						<div className="relative flex flex-col items-center gap-2">
							<Image className="h-8 w-8 text-zinc-400" />
							<span className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">
								No banner
							</span>
						</div>
					</div>
				)}

				{/* Profile Header Block */}
				<div className="relative -mt-12 px-3 font-sans sm:px-6">
					<div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end sm:gap-4">
						<div className="relative">
						<UserAvatar
							src={profilePicPreview || ""}
							alt={profile.fullName}
							perkRing={!!(profile as any).waitlistPerk}
							className="h-20 w-20 rounded-full border-4 border-white dark:border-zinc-900 object-cover shadow-md cursor-pointer hover:opacity-90 transition-opacity"
								onClick={() => {
									if (profilePicPreview) {												window.dispatchEvent(
													new CustomEvent(
														"openImagePreview",
														{
															detail: {
																url: profilePicPreview,
																variant: "avatar",
															},
														},
													),
												);
									}
								}}
							/>
						</div>

						<div className="flex flex-wrap items-center gap-2 self-end sm:self-auto">
							{/* Report user (other profiles only) */}
							{!isSelf && profile && (
								<ReportButton
									contentType="user"
									contentId={profile._id}
									iconOnly
									className="!h-10 !w-10 !p-0 items-center justify-center rounded-full border border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-red-400 shadow-sm"
								/>
							)}

							<div className="relative" ref={shareMenuRef}>
								<button
									onClick={() => setShareMenuOpen((v) => !v)}
									className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-slate-800 dark:hover:text-zinc-150 transition-colors shadow-sm cursor-pointer"
									aria-label="Share profile"
									aria-haspopup="menu"
									aria-expanded={shareMenuOpen}>
									<Share2 className="h-4.5 w-4.5" />
								</button>

								{/* Share menu — Forward / Copy link */}
								{shareMenuOpen && (
									<div className="absolute right-0 top-full mt-1 z-[100] w-48 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl overflow-hidden">
										<button
											onClick={() => {
												setShareMenuOpen(false);
												setForwardOpen(true);
											}}
											className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors text-left cursor-pointer">
											<Send className="h-3.5 w-3.5 text-zinc-400" />
											Forward
										</button>
										<button
											onClick={handleCopyProfileLink}
											className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors text-left cursor-pointer">
											<Link2 className="h-3.5 w-3.5 text-zinc-400" />
											Copy link
										</button>
									</div>
								)}
							</div>

							{/* Message user — opens their chat conversation directly */}
							{!isSelf && profile && onMessageUser && (
								<button
									onClick={() => onMessageUser(profile._id)}
									className="flex h-10 items-center justify-center gap-1.5 rounded-full border border-zinc-800 bg-white dark:bg-zinc-900 px-4 text-sm font-medium text-zinc-400 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800 shadow-sm cursor-pointer"
									aria-label={`Message ${profile.fullName || "this user"}`}>
									<MessageSquare className="h-4 w-4" /> Message
								</button>
							)}

							{isSelf ? (
								<button
									onClick={() => {
										setEditType("profile");
										setEditOpen(true);
									}}
									className="flex h-10 items-center justify-center gap-1.5 rounded-full border border-zinc-800 bg-white dark:bg-zinc-900 px-5 text-sm font-medium text-zinc-400 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800 shadow-sm cursor-pointer">
									<Edit3 className="h-4 w-4" /> Edit Profile
								</button>
							) : (
								(() => {										const amIFollowing =
											followingStates[profile._id] ??
											(profile as any).followingByMe ??
											(profile as any).isFollowing ??
											false;
										// "Requested" survives reloads: the server payload carries
										// followRequestedByMe (a pending follow request exists), and
										// the client-side requestedFollows map covers live actions.
										const isRequested =
											!amIFollowing &&
											(!!requestedFollows?.[profile._id] ||
												!!(profile as any).followRequestedByMe);
									return (
										<button
											onClick={(e) => {
												e.stopPropagation();
												handleFollowToggle();
											}}
											className={`text-xs font-semibold px-4 py-2 rounded-full transition-all cursor-pointer transform hover:scale-105 active:scale-95 ${isRequested
												? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
												: amIFollowing
													? "bg-zinc-900 text-white dark:bg-zinc-800 dark:text-white border border-zinc-300 dark:border-zinc-600 shadow-md"
													: "bg-aurora text-white border border-white/10 shadow-aurora hover:opacity-90"}`}>
											{isRequested
												? "Requested"
												: amIFollowing
													? "Following"
													: "Follow"}
										</button>
									);
								})()
							)}
						</div>
					</div>
				</div>

				{/* User details: name, username, bio, join date, stats */}
				<div className="mt-4 px-1 space-y-3 sm:px-1.5">
					<div>
						<h1 className="text-display-sm text-white flex items-center gap-1.5">
							{profile.fullName}
							{(profile as any).waitlistPerk && (
								<DayOneFlair className="mt-1" />
							)}
							{profile.isVerified && (
								<VerifiedBadge className="h-5 w-5" />
							)}
						</h1>
						<p className="text-sm text-zinc-400">
							@{profile.username}
						</p>
						{profile.statusText && (
							<p className="mt-1 text-xs text-zinc-500 flex items-center gap-1.5">
								<span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
								{renderLinkifiedText(profile.statusText)}
							</p>
						)}
					</div>

					{profile.bio && (
						<TranslateInline
							text={profile.bio}
							className="!items-start max-w-lg"
							render={(t) => (
								<p className="text-sm text-zinc-300 leading-relaxed max-w-lg whitespace-pre-wrap break-words">
									{renderLinkifiedText(t)}
								</p>
							)}
						/>
					)}
					{profile.bio && extractFirstUrl(profile.bio) && (
						<div className="mt-2.5 max-w-lg">
							<LinkPreviewCard
								url={extractFirstUrl(profile.bio)!}
								compact
							/>
						</div>
					)}

					{profile.createdAt && (
						<div className="flex items-center gap-1.5 text-xs text-zinc-500">
							<Calendar className="h-3.5 w-3.5" />
							<span>
								Joined{" "}
								{new Date(profile.createdAt).toLocaleDateString(
									"en-US",
									{ month: "long", year: "numeric" },
								)}
							</span>
						</div>
					)}

					{/* XP & Level Display */}
					<div className="mt-3">
						<ReputationDisplay userId={profile._id} compact />
					</div>

					{/* Badge wall — earned (gold) + locked (grey). Fetches the XP
					    record directly so non-self profiles show it too. */}
					<ProfileBadgeWall userId={profile._id} />
				</div>

				<div className="mt-5 flex flex-wrap items-center gap-4 px-1 text-sm sm:gap-6 sm:px-1.5">
					{/* Instagram hides the follower/following LISTS of a private
					    account from non-followers — counts stay visible but taps
					    are disabled. */}
					<button
						onClick={() => {
							if (isPrivateLocked) {
								window.dispatchEvent(
									new CustomEvent("showToast", {
										detail: {
											message:
												"This account is private — follow to see their lists",
											type: "error",
										},
									}),
								);
								return;
							}
							loadList("following");
						}}
						className={`flex items-center gap-1.5 group ${isPrivateLocked ? "cursor-not-allowed" : "hover:underline cursor-pointer"}`}>
						<span className="font-bold text-white">
							{displayFollowingCount.toLocaleString()}
						</span>
						<span className="text-zinc-400 group-hover:text-slate-700 dark:group-hover:text-zinc-300">
							Following
						</span>
					</button>
					<button
						onClick={() => {
							if (isPrivateLocked) {
								window.dispatchEvent(
									new CustomEvent("showToast", {
										detail: {
											message:
												"This account is private — follow to see their lists",
											type: "error",
										},
									}),
								);
								return;
							}
							loadList("followers");
						}}
						className={`flex items-center gap-1.5 group ${isPrivateLocked ? "cursor-not-allowed" : "hover:underline cursor-pointer"}`}>
						<span className="font-bold text-white">
							{displayFollowersCount.toLocaleString()}
						</span>
						<span className="text-zinc-400 group-hover:text-slate-700 dark:group-hover:text-zinc-300">
							Followers
						</span>
					</button>
				</div>

				{/* Own profile → pending follow-request inbox (Instagram style) */}
				{isSelf && (pendingRequests.length > 0 || loadingRequests) && (
					<div className="mt-6">
						<div className="mb-3 flex items-center justify-between">
							<h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
								<UserPlus className="h-3.5 w-3.5 text-emerald-400" />
								Follow Requests
							</h3>
							<span className="rounded-full bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
								{pendingRequests.length} pending
							</span>
						</div>
						<div className="space-y-2.5">
							{loadingRequests && pendingRequests.length === 0 && (
								<div className="flex items-center gap-2 px-3 py-4 text-xs text-zinc-500">
									<Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
								</div>
							)}
							{pendingRequests.map((req) => (
								<div
									key={req._id}
									className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-zinc-950/30 px-3 py-2.5">
									<div
										className="flex min-w-0 items-center gap-2.5 cursor-pointer"
										onClick={() =>
											req.sender?.username &&
											onUserClick(req.sender.username)
										}>
										<UserAvatar
											src={req.sender?.profilePic?.url}
											alt={req.sender?.fullName}
											className="h-9 w-9 rounded-full object-cover border border-zinc-800 shrink-0"
										/>
										<div className="min-w-0">
											<p className="truncate text-xs font-semibold text-white">
												{req.sender?.fullName ||
													req.sender?.username}
											</p>
											<p className="truncate text-[10px] text-zinc-500">
												@{req.sender?.username}
											</p>
										</div>
									</div>
									<div className="flex shrink-0 items-center gap-2">
										<button
											onClick={() =>
												handleRequestDecision(req._id, true)
											}
											disabled={busyRequestId === req._id}
											className="flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3 py-1.5 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/25 transition-all cursor-pointer disabled:opacity-50">
											{busyRequestId === req._id ? (
												<Loader2 className="h-3 w-3 animate-spin" />
											) : (
												<Check className="h-3 w-3" />
											)}
											Approve
										</button>
										<button
											onClick={() =>
												handleRequestDecision(req._id, false)
											}
											disabled={busyRequestId === req._id}
											className="flex items-center gap-1 rounded-full bg-zinc-800/60 border border-zinc-700 px-3 py-1.5 text-[10px] font-bold text-zinc-300 hover:bg-zinc-700 transition-all cursor-pointer disabled:opacity-50">
											<X className="h-3 w-3" />
											Decline
										</button>
									</div>
								</div>
							))}
						</div>
					</div>
				)}

				{/* Private account locked content area — Instagram-style: the
				    header + counts stay visible, everything else is hidden behind
				    the follow gate. */}
				{isPrivateLocked ? (
					<div className="mt-10 flex flex-col items-center justify-center px-4 text-center">
						<div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-zinc-950/40">
							<Lock className="h-7 w-7 text-zinc-400" />
						</div>
						<h3 className="mt-4 text-lg font-bold text-white">
							This account is private
						</h3>
						<p className="mt-1.5 max-w-xs text-sm text-zinc-400 leading-relaxed">
							{isRequestedView
								? "Your follow request is pending. Once they approve it, you'll see their posts and glances."
								: "Follow this account to see their posts, glances and activity."}
						</p>
					</div>
				) : (
					<>

				

				{/* Profile Content Tabs */}
				<div className="mt-7">
					<div className="flex flex-wrap items-center gap-1 mb-5">
						{[
							{
								id: "posts" as const,
								label: "Posts",
								icon: FileText,
								count: posts.length,
							},									...(isSelf
								? [			{
											id: "saved" as const,
											label: "Saved",
											icon: Bookmark,
											count: savedPosts.length,
										},
										{
											id: "reposts" as const,
											label: "Reposts",
											icon: Repeat2,
											count: repostedPosts.length,
										},
										{
											id: "drafts" as const,
											label: "Drafts",
											icon: FilePenLine,
											count:
												drafts.length + scheduledPosts.length,
										},
										{
											id: "collections" as const,
											label: "Collections",
											icon: FolderOpen,
											count: collections.length,
										},
									]
								: []),
						].map((tab) => {
							const Icon = tab.icon;
							const active = profileTab === tab.id;
							return (
								<button
									key={tab.id}
									onClick={() => setProfileTab(tab.id)}
									className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-all cursor-pointer rounded-t-lg ${
										active
											? "text-black dark:text-white"
											: "text-zinc-500"
									}`}>
									<Icon className="h-3.5 w-3.5" />
									{tab.label}
									<span
										className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold md:h-6 md:min-w-6 md:text-xs ${
											active
												? "pill-active"
												: "bg-slate-100 dark:bg-zinc-800 text-zinc-400"
										}`}>
										{tab.count}
									</span>
								</button>
							);
						})}
					</div>

					{/* More creators like this — audience-overlap recommendations,
					    shown only on other people's profiles. */}
					{!isSelf &&
						(similarCreatorsLoading || similarCreators.length > 0) && (
							<div className="px-1 pt-4 pb-2">
								<div className="flex items-center gap-1.5 mb-3">
									<Users className="h-3.5 w-3.5 text-zinc-400" />
									<h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
										More creators like this
									</h3>
								</div>
								{similarCreatorsLoading && similarCreators.length === 0 ? (
									<div className="grid gap-2 sm:grid-cols-2">
										{[0, 1, 2].map((i) => (
											<div
												key={i}
												className="flex items-center gap-2.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/40 p-2.5">
												<div className="h-8 w-8 rounded-full shimmer-bg shrink-0" />
												<div className="flex-1 space-y-1.5">
													<div className="h-2.5 w-24 rounded shimmer-bg" />
													<div className="h-2 w-16 rounded shimmer-bg" />
												</div>
											</div>
										))}
									</div>
								) : (
									<div className="grid gap-2 sm:grid-cols-2">
										{similarCreators.map((sc) => (
											<div
												key={sc._id}
												className="group flex items-center gap-2.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/40 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all p-2.5 cursor-pointer"
												onClick={() => onUserClick(sc.username)}>
												<UserAvatar
													src={sc.profilePic?.url}
													alt=""
													className="h-8 w-8 rounded-full object-cover border border-zinc-800/60 shrink-0"
												/>
												<div className="flex-1 min-w-0">
													<div className="flex items-center gap-1">
														<span className="text-[11px] font-bold text-black dark:text-white truncate">
															{sc.fullName}
														</span>
														{sc.isVerified && <VerifiedBadge className="h-3 w-3 shrink-0" />}
													</div>
													<span className="text-[9px] font-semibold text-zinc-400 block truncate">
														@{sc.username}
													</span>
													{sc.mutualFollowersCount ? (
														<span className="text-[9px] text-zinc-500 dark:text-zinc-450 block truncate">
															Followed by {sc.mutualFollowersCount} ${
																sc.mutualFollowersCount === 1
																	? "person"
																	: "people"
																} who follow this profile
														</span>
													) : null}
												</div>
												<button
													onClick={(e) => {
														e.stopPropagation();
														onUserClick(sc.username);
													}}
													className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-black dark:hover:text-white hover:border-zinc-400 dark:hover:border-zinc-500 transition-all cursor-pointer"
													title="View profile">
													<ArrowRight className="h-3.5 w-3.5" />
												</button>
											</div>
										))}
									</div>
								)}
							</div>
						)}

					{/* Posts Tab */}
					{profileTab === "posts" && (
						<>
							{isSelf && (
								<div className="px-2 py-4">
									<Streaks user={user} />
								</div>
							)}

							{postsLoading && posts.length === 0 ? (
								<div className="space-y-5 max-w-2xl mx-auto w-full">
									{[1, 2, 3].map((i) => (
										<Skeleton key={i} className="h-44 w-full" />
									))}
								</div>
							) : displayPosts.length === 0 ? (
								<GlassCard className="flex flex-col items-center justify-center py-12 text-center shadow-sm">
									<h4 className="text-sm font-bold text-white">
										No posts yet
									</h4>
									<p className="mt-1 text-xs text-zinc-500 max-w-xs">
										When this account posts, it will appear
										here.
									</p>
								</GlassCard>
							) : (
								<div className="space-y-5 max-w-2xl mx-auto w-full">									<AnimatePresence>
										{displayPosts.map((post) => (
										<GlassCard
											key={post._id}
											dataPostId={post._id}
											animate={true}
											className="group relative flex flex-col justify-between overflow-hidden p-6 text-left rounded-4xl border-white/5 bg-zinc-950/20 hover:border-white/10 transition-all"
											showMacControls={false}>
										{" "}
										<>												{post.pinnedByMe && (
													<div className="mb-3 flex w-fit items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[10px] font-bold tracking-wider text-amber-200">
														<Pin className="h-3 w-3" />
														PINNED
													</div>
												)}
													{user?._id ===
														profile?._id && (
														<div className="absolute top-4 right-4 opacity-100 transition-opacity flex items-center gap-1.5 z-20">
															<div className="relative">
																																								<button
																																									onClick={(e) => {
																																										e.stopPropagation();
																																										setOpenMenuPostId(openMenuPostId === post._id ? null : post._id);
																																									}}
																																									className="p-1.5 bg-zinc-800 border border-zinc-800 rounded-full text-zinc-400 hover:text-white shadow-sm cursor-pointer transition-colors">
																																									<MoreHorizontal className="h-3.5 w-3.5" />
																																								</button>
																																								{openMenuPostId === post._id && (
																																									<div className="absolute right-0 top-full mt-1 z-[100] w-40 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl overflow-hidden">																				<button
																					onClick={() => handleTogglePin(post)}
																					className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors text-left">
																					<Pin className="h-3.5 w-3.5 text-zinc-400" />
																					{post.pinnedByMe
																						? "Unpin from Profile"
																						: "Pin to Profile"}
																				</button>
																				<button
																					onClick={() => {
																						setOpenMenuPostId(null);
																						setEditPostId(post._id);
																																												setEditPostTitle(post.title || "");
																																												setEditPostContent(post.content || "");
																																												const existingImgs: { public_id: string; url: string }[] = [];
																																												if (post.image?.public_id) {
																																													existingImgs.push({ public_id: post.image.public_id, url: post.image.url });
																																												}
																																												(post.images || []).forEach((img: any) => {
																																													if (img.public_id && !existingImgs.some((e) => e.public_id === img.public_id)) {
																																														existingImgs.push({ public_id: img.public_id, url: img.url });
																																													}
																																												});
																																												setEditPostExistingImages(existingImgs);
																																												setEditPostNewFiles([]);
																																												setEditPostNewPreviews([]);
																																												setEditPostDrawerOpen(true);
																																											}}
																																											className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors text-left">																		<Edit3 className="h-3.5 w-3.5 text-amber-400" />
																		Edit Post
																	</button>
																	<button
																		onClick={() => {
																			setOpenMenuPostId(null);
																			void handleArchivePost(post._id);
																		}}
																		className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors text-left">
																		<Archive className="h-3.5 w-3.5 text-zinc-400" />
																		Archive Post
																	</button>
																	<button
																		onClick={(e) => {
																			setOpenMenuPostId(null);
																			handleDeletePost(e, post._id);
																		}}
																		className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-red-400 transition-colors text-left">
																		<X className="h-3.5 w-3.5" />
																		Delete Post
																	</button>
																</div>
																																								)}
</div>

														</div>
													)}

													{/* Author Context Line */}
													<div className="mb-4 flex items-center justify-between">
														<div className="flex items-center gap-3">
															<UserAvatar
																src={
																	profile
																		.profilePic
																		?.url
																}
																alt={
																	profile.fullName
																}
																className="h-10 w-10 rounded-full object-cover border border-zinc-800 shadow-sm shrink-0"
															/>
															<div className="text-left">
																<h4 className="text-sm font-semibold text-white">
																	{
																		profile.fullName
																	}
																</h4>
																<p className="text-xs text-zinc-400 font-medium">
																	@
																	{
																		profile.username
																	}{" "}
																	•{" "}
																	{getRelativeDate(
																		post.createdAt,
																	)}
																</p>
																{post.visibility === "closeFriends" && (
														<span className="mt-1 inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 text-[9px] font-bold text-emerald-400/80">
															<Lock className="h-2.5 w-2.5" /> Close Friends
														</span>
																)}
															</div>
														</div>
													</div>

													<div
														onClick={() =>
															onPostClick(
																post.slug,
															)
														}
														className="cursor-pointer space-y-3">
														{" "}
														<h4 className="font-sans text-sm md:text-base font-bold text-white leading-tight text-left">
															{post.title}
														</h4>
														<p className="text-xs md:text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap text-left select-text">
															{post.content}
														</p>															{post.image && (
																<div className="mt-3.5 overflow-hidden rounded-3xl border border-zinc-800">
																	<img
																		loading="lazy"
																		src={
																			post
																				.image
																				.url
																		}
																		alt="attachment"
																		className="w-full h-auto max-h-120 object-cover"
																	/>
																</div>
															)}
															{post.poll && (
																<PollCard
																	postId={post._id}
																	poll={post.poll}
																	readOnly={false}
																	onPollUpdated={(pid, poll) => {
																		setPosts((prev) =>
																			prev.map((p) =>
																				p._id === pid
																					? { ...p, poll }
																					: p,
																			),
																		);
																	}}
																/>
															)}
															</div>

															<div
																className="mt-4 flex items-center justify-between pt-3 text-sm text-zinc-400 border-t border-zinc-800/50"
														onClick={(e) =>
															e.stopPropagation()
														}>
														<button
															onClick={() =>
																handleProfileLikeToggle(
																	post._id,
																	!!post.likedByMe,
																)
															}
															className="flex items-center gap-1.5 font-medium cursor-pointer hover:text-red-500 transition-colors">
															<Heart
																className={`h-4 w-4 ${post.likedByMe ? "fill-red-500 text-red-500" : "text-zinc-550"}`}
															/>{" "}
															{post.likesCount ||
																0}
														</button>
														<button
															onClick={() =>
																onPostClick(
																	post.slug,
																	true,
																)
															}
															className="flex items-center gap-1.5 font-medium cursor-pointer hover:text-white transition-colors">
															<MessageSquare className="h-4 w-4 text-zinc-550" />{" "}
															{post.commentsCount ||
																0}
														</button>
														<button
															onClick={() =>
																handleProfileSaveToggle(
																	post._id,
																	!!post.savedByMe,
																)
															}
															className="flex items-center gap-1.5 font-medium cursor-pointer hover:text-yellow-500 transition-colors">
															<Bookmark
																className={`h-4 w-4 ${post.savedByMe ? "fill-yellow-500 text-yellow-500" : "text-zinc-550"}`}
															/>{" "}
															{post.savesCount ||
																0}
														</button>
														<button
															onClick={() =>
																handleProfileRepostToggle(
																	post._id,
																	!!post.repostedByMe,
																)
															}
															className="flex items-center gap-1.5 font-medium cursor-pointer hover:text-green-500 transition-colors">
															<Repeat2
																className={`h-4 w-4 ${post.repostedByMe ? "text-green-500" : "text-zinc-550"}`}
															/>{" "}
															{post.repostsCount ||
																0}
														</button>{" "}
													</div>
												</>
											</GlassCard>
										))}
									</AnimatePresence>
									{/* Pagination sentinel + skeleton for posts */}
									{postsHasMore && (
										<div ref={postsSentinelRef}>
											{loadingMorePosts && (
												<div className="grid gap-3.5 sm:grid-cols-2">
													<div className="space-y-4">
														<Skeleton variant="card" />
														<Skeleton variant="card" />
													</div>
												</div>
											)}
										</div>
									)}
								</div>
							)}
						</>
					)}

					{/* Saved Tab (self only) */}
					{profileTab === "saved" && isSelf && (
						<>
							{loadingSaved ? (
								<div className="grid gap-3.5 sm:grid-cols-2">
									{[1, 2].map((n) => (
										<div
											key={n}
											className="animate-pulse rounded-3xl border border-zinc-800 bg-zinc-900/40 p-4.5 space-y-3">
											<div className="flex items-center gap-2">
												<div className="h-6 w-6 rounded-full bg-zinc-800" />
												<div className="h-3 w-20 rounded bg-zinc-800" />
											</div>
											<div className="h-4 w-3/4 rounded bg-zinc-800" />
											<div className="space-y-2">
												<div className="h-3 w-full rounded bg-zinc-800" />
												<div className="h-3 w-2/3 rounded bg-zinc-800" />
											</div>
										</div>
									))}
								</div>
							) : savedPosts.length === 0 ? (
								<GlassCard className="flex flex-col items-center justify-center py-12 text-center shadow-sm">
									<Bookmark className="mx-auto h-8 w-8 text-zinc-400 mb-3" />
									<h4 className="text-sm font-bold text-white">
										No saved posts
									</h4>
									<p className="mt-1 text-xs text-zinc-500 max-w-xs">
										Posts you save will appear here.
									</p>
								</GlassCard>
							) : (
								<div className="space-y-5 max-w-2xl mx-auto w-full">
									{savedPosts.map((post) => (
										<GlassCard
											key={post._id}
											dataPostId={post._id}
											animate={true}
											className="group relative flex flex-col justify-between overflow-hidden p-6 text-left rounded-4xl border-white/5 bg-zinc-950/20 hover:border-white/10 transition-all"
											showMacControls={false}>
											{/* Author Context Line */}
											<div className="mb-4 flex items-center justify-between">
												<div className="flex items-center gap-3">
													<UserAvatar
														src={
															(post as any).author
																?.profilePic
																?.url
														}
														alt=""
														className="h-10 w-10 rounded-full object-cover border border-zinc-800 shadow-sm shrink-0 cursor-pointer"
														onClick={() =>
															onUserClick(
																(post as any)
																	.author
																	?.username,
															)
														}
													/>
													<div className="text-left">
														<h4
															className="text-sm font-semibold text-white hover:underline cursor-pointer"
															onClick={() =>
																onUserClick(
																	(
																		post as any
																	).author
																		?.username,
																)
															}>
															{
																(post as any)
																	.author
																	?.fullName
															}
														</h4>
														<p className="text-xs text-zinc-400 font-medium">
															@
															{
																(post as any)
																	.author
																	?.username
															}{" "}
															•{" "}
															{getRelativeDate(
																post.createdAt,
															)}
														</p>
														{post.visibility === "closeFriends" && (
														<span className="mt-1 inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 text-[9px] font-bold text-emerald-400/80">
															<Lock className="h-2.5 w-2.5" /> Close Friends
														</span>
														)}
													</div>
												</div>
											</div>

											<div
												onClick={() =>
													onPostClick(post.slug)
												}
												className="cursor-pointer space-y-3">
												<h4 className="font-sans text-lg md:text-xl font-bold text-white leading-tight text-left">
													{post.title}
												</h4>
												<p className="text-sm md:text-base text-zinc-300 leading-relaxed whitespace-pre-wrap text-left select-text">
													{post.content}
												</p>
												{post.image && (
													<div className="mt-3.5 overflow-hidden rounded-3xl border border-zinc-800">
														<img
															loading="lazy"
															src={optimizeImageUrl(post.image.url, 1000)}
															alt=""
															className="w-full h-auto max-h-120 object-cover"
														/>
													</div>
												)}
											</div>

											<div
												className="mt-4 flex items-center justify-between pt-3 text-sm text-zinc-400 border-t border-zinc-800/50"
												onClick={(e) =>
													e.stopPropagation()
												}>
												<button
													onClick={() => {
														handleProfileLikeToggle(
															post._id,
															!!post.likedByMe,
														);
													}}
													className="flex items-center gap-1.5 font-medium cursor-pointer hover:text-red-500 transition-colors">
													<Heart
														className={`h-4 w-4 ${post.likedByMe ? "fill-red-500 text-red-500" : "text-zinc-550"}`}
													/>{" "}
													{post.likesCount || 0}
												</button>
												<button
													onClick={() =>
														onPostClick(
															post.slug,
															true,
														)
													}
													className="flex items-center gap-1.5 font-medium cursor-pointer hover:text-white transition-colors">
													<MessageSquare className="h-4 w-4 text-zinc-550" />{" "}
													{post.commentsCount || 0}
												</button>
												<button
													onClick={() => {
														handleProfileSaveToggle(
															post._id,
															!!post.savedByMe,
														);
													}}
													className="flex items-center gap-1.5 font-medium cursor-pointer hover:text-yellow-500 transition-colors">
													<Bookmark
														className={`h-4 w-4 ${post.savedByMe ? "fill-yellow-500 text-yellow-500" : "text-zinc-550"}`}
													/>{" "}
													{post.savesCount || 0}
												</button>
												<button
													onClick={() => {
														handleProfileRepostToggle(
															post._id,
															!!post.repostedByMe,
														);
													}}
													className="flex items-center gap-1.5 font-medium cursor-pointer hover:text-green-500 transition-colors">
													<Repeat2
														className={`h-4 w-4 ${post.repostedByMe ? "text-green-500" : "text-zinc-550"}`}
													/>{" "}
													{post.repostsCount || 0}
												</button>
											</div>
										</GlassCard>
									))}
								</div>
							)}
							{/* Pagination sentinel + skeleton for saved */}
							{savedHasMore && (
								<div ref={savedSentinelRef}>
									{loadingMoreSaved && (
										<div className="grid gap-3.5 sm:grid-cols-2">
											<div className="space-y-4">
												<Skeleton variant="card" />
												<Skeleton variant="card" />
											</div>
										</div>
									)}
								</div>
							)}
						</>
					)}

					{/* Reposts Tab (self only) */}
					{profileTab === "reposts" && isSelf && (
						<>
							{loadingReposts ? (
								<div className="grid gap-3.5 sm:grid-cols-2">
									{[1, 2].map((n) => (
										<div
											key={n}
											className="animate-pulse rounded-3xl border border-zinc-800 bg-zinc-900/40 p-4.5 space-y-3">
											<div className="flex items-center gap-2">
												<div className="h-3 w-3 rounded bg-zinc-800" />
												<div className="h-6 w-6 rounded-full bg-zinc-800" />
												<div className="h-3 w-20 rounded bg-zinc-800" />
											</div>
											<div className="h-4 w-3/4 rounded bg-zinc-800" />
											<div className="space-y-2">
												<div className="h-3 w-full rounded bg-zinc-800" />
												<div className="h-3 w-2/3 rounded bg-zinc-800" />
											</div>
										</div>
									))}
								</div>
							) : repostedPosts.length === 0 ? (
								<GlassCard className="flex flex-col items-center justify-center py-12 text-center shadow-sm">
									<Repeat2 className="mx-auto h-8 w-8 text-zinc-400 mb-3" />
									<h4 className="text-sm font-bold text-white">
										No reposts yet
									</h4>
									<p className="mt-1 text-xs text-zinc-500 max-w-xs">
										Posts you repost will appear here.
									</p>
								</GlassCard>
							) : (
								<div className="space-y-5 max-w-2xl mx-auto w-full">
									{repostedPosts.map((post) => (
										<GlassCard
											key={post._id}
											dataPostId={post._id}
											animate={true}
											className="group relative flex flex-col justify-between overflow-hidden p-6 text-left rounded-4xl border-white/5 bg-zinc-950/20 hover:border-white/10 transition-all"
											showMacControls={false}>
											{/* Author Context Line */}
											<div className="mb-4 flex items-center justify-between">
												<div className="flex items-center gap-3">
													<UserAvatar
														src={
															(post as any).author
																?.profilePic
																?.url
														}
														alt=""
														className="h-10 w-10 rounded-full object-cover border border-zinc-800 shadow-sm shrink-0 cursor-pointer"
														onClick={() =>
															onUserClick(
																(post as any)
																	.author
																	?.username,
															)
														}
													/>
													<div className="text-left">
														<h4
															className="text-sm font-semibold text-white hover:underline cursor-pointer"
															onClick={() =>
																onUserClick(
																	(
																		post as any
																	).author
																		?.username,
																)
															}>
															{
																(post as any)
																	.author
																	?.fullName
															}
														</h4>
														<p className="text-xs text-zinc-400 font-medium">
															@
															{
																(post as any)
																	.author
																	?.username
															}{" "}
															•{" "}
															{getRelativeDate(
																post.createdAt,
															)}
														</p>
														{post.visibility === "closeFriends" && (
														<span className="mt-1 inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 text-[9px] font-bold text-emerald-400/80">
															<Lock className="h-2.5 w-2.5" /> Close Friends
														</span>
														)}
													</div>
												</div>
											</div>

											<div
												onClick={() =>
													onPostClick(post.slug)
												}
												className="cursor-pointer space-y-3">
												<h4 className="font-sans text-lg md:text-xl font-bold text-white leading-tight text-left">
													{post.title}
												</h4>
												<p className="text-sm md:text-base text-zinc-300 leading-relaxed whitespace-pre-wrap text-left select-text">
													{post.content}
												</p>
												{post.image && (
													<div className="mt-3.5 overflow-hidden rounded-3xl border border-zinc-800">
														<img
															loading="lazy"
															src={optimizeImageUrl(post.image.url, 1000)}
															alt=""
															className="w-full h-auto max-h-120 object-cover"
														/>
													</div>
												)}
											</div>

											<div
												className="mt-4 flex items-center justify-between pt-3 text-sm text-zinc-400 border-t border-zinc-800/50"
												onClick={(e) =>
													e.stopPropagation()
												}>
												<button
													onClick={() => {
														handleProfileLikeToggle(
															post._id,
															!!post.likedByMe,
														);
													}}
													className="flex items-center gap-1.5 font-medium cursor-pointer hover:text-red-500 transition-colors">
													<Heart
														className={`h-4 w-4 ${post.likedByMe ? "fill-red-500 text-red-500" : "text-zinc-550"}`}
													/>{" "}
													{post.likesCount || 0}
												</button>
												<button
													onClick={() =>
														onPostClick(
															post.slug,
															true,
														)
													}
													className="flex items-center gap-1.5 font-medium cursor-pointer hover:text-white transition-colors">
													<MessageSquare className="h-4 w-4 text-zinc-550" />{" "}
													{post.commentsCount || 0}
												</button>
												<button
													onClick={() => {
														handleProfileSaveToggle(
															post._id,
															!!post.savedByMe,
														);
													}}
													className="flex items-center gap-1.5 font-medium cursor-pointer hover:text-yellow-500 transition-colors">
													<Bookmark
														className={`h-4 w-4 ${post.savedByMe ? "fill-yellow-500 text-yellow-500" : "text-zinc-550"}`}
													/>{" "}
													{post.savesCount || 0}
												</button>
												<button
													onClick={() => {
														handleProfileRepostToggle(
															post._id,
															!!post.repostedByMe,
														);
													}}
													className="flex items-center gap-1.5 font-medium cursor-pointer hover:text-green-500 transition-colors">
													<Repeat2
														className={`h-4 w-4 ${post.repostedByMe ? "text-green-500" : "text-zinc-550"}`}
													/>{" "}
													{post.repostsCount || 0}
												</button>
											</div>
										</GlassCard>
									))}
								</div>
							)}
							{/* Pagination sentinel + skeleton for reposts */}
							{repostsHasMore && (
								<div ref={repostsSentinelRef}>
									{loadingMoreReposts && (
										<div className="grid gap-3.5 sm:grid-cols-2">
											<div className="space-y-4">
												<Skeleton variant="card" />
												<Skeleton variant="card" />
											</div>
										</div>
									)}
								</div>
							)}
						</>
					)}

					{/* Drafts & Scheduled Tab (self only) */}
					{profileTab === "drafts" && isSelf && (
						<>
							{/* Drafts / Archived sub-toggle */}
							<div className="mb-5 flex max-w-2xl mx-auto w-full items-center gap-2">
								<button
									onClick={() => setShowArchived(false)}
									className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-[11px] font-bold transition-all cursor-pointer ${
										!showArchived
											? "pill-active"
											: "border border-zinc-800 text-zinc-400 hover:text-white"
									}`}>
									<FilePenLine className="h-3.5 w-3.5" /> Drafts
								</button>
								<button
									onClick={() => setShowArchived(true)}
									className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-[11px] font-bold transition-all cursor-pointer ${
										showArchived
											? "pill-active"
											: "border border-zinc-800 text-zinc-400 hover:text-white"
									}`}>
									<Archive className="h-3.5 w-3.5" /> Archived
								</button>
							</div>

							{showArchived ? (
								<div className="max-w-2xl mx-auto w-full">
									{loadingArchived ? (
										<div className="grid gap-3.5 sm:grid-cols-2">
											{[1, 2].map((n) => (
												<div
													key={n}
													className="animate-pulse rounded-3xl border border-zinc-800 bg-zinc-900/40 p-4.5 space-y-3">
													<div className="h-4 w-3/4 rounded bg-zinc-800" />
													<div className="h-3 w-full rounded bg-zinc-800" />
												</div>
											))}
										</div>
									) : archivedPosts.length === 0 ? (
										<GlassCard className="flex flex-col items-center justify-center py-12 text-center shadow-sm">
											<Archive className="mx-auto h-8 w-8 text-zinc-400 mb-3" />
											<h4 className="text-sm font-bold text-white">
												No archived posts
											</h4>
											<p className="mt-1 text-xs text-zinc-500 max-w-xs">
												Archive posts to tidy your profile without
												deleting them. Use the ⋮ menu on your
												posts to archive.
											</p>
										</GlassCard>
									) : (
										<div className="space-y-3">
											{archivedPosts.map((post) => (
												<GlassCard
													key={post._id}
													animate={true}
													className="p-5 rounded-4xl border-white/5 bg-zinc-950/20 hover:border-white/10 transition-all"
													showMacControls={false}>
													<div className="flex items-start justify-between gap-3">
												<div className="min-w-0">
													<p className="text-sm font-semibold text-white line-clamp-2">
														{post.content || "(No text)"}
													</p>
													{(() => {
														const n =
															(post.images?.length || 0) +
															(post.image ? 1 : 0) +
															(post.video ? 1 : 0);
														return n > 0 ? (
															<span className="mt-1 inline-block text-[10px] text-zinc-500">
																{n} media
															</span>
														) : null;
													})()}
												</div>
														<div className="flex shrink-0 items-center gap-2">
															<button
																onClick={() =>
																	void handleUnarchivePost(
																		post._id,
																	)
																}
																className="rounded-full border border-emerald-500/30 px-3 py-1.5 text-[10px] font-bold text-emerald-400 hover:bg-emerald-500/10 transition-all cursor-pointer">
																Restore
															</button>
														</div>
													</div>
												</GlassCard>
											))}
										</div>
									)}
								</div>
							) : loadingDrafts ? (
								<div className="grid gap-3.5 sm:grid-cols-2">
									{[1, 2].map((n) => (
										<div
											key={n}
											className="animate-pulse rounded-3xl border border-zinc-800 bg-zinc-900/40 p-4.5 space-y-3">
											<div className="h-4 w-3/4 rounded bg-zinc-800" />
											<div className="space-y-2">
												<div className="h-3 w-full rounded bg-zinc-800" />
												<div className="h-3 w-2/3 rounded bg-zinc-800" />
											</div>
										</div>
									))}
								</div>
							) : drafts.length === 0 && scheduledPosts.length === 0 ? (
								<GlassCard className="flex flex-col items-center justify-center py-12 text-center shadow-sm">
									<FilePenLine className="mx-auto h-8 w-8 text-zinc-400 mb-3" />
									<h4 className="text-sm font-bold text-white">
										No drafts or scheduled posts
									</h4>
									<p className="mt-1 text-xs text-zinc-500 max-w-xs">
										Posts you save as drafts or schedule will appear
										here. Use the composer to save a draft or pick a
										future time.
									</p>
								</GlassCard>
							) : (
								<div className="space-y-5 max-w-2xl mx-auto w-full">
									{scheduledPosts.length > 0 && (
										<div>
											<h4 className="mb-3 flex items-center gap-2 text-label-sm font-semibold text-violet-300">
												<Calendar className="h-3.5 w-3.5" /> Scheduled
											</h4>
											<div className="space-y-3">
												{scheduledPosts.map((post) => (
													<GlassCard
														key={post._id}
														animate={true}
														className="p-5 rounded-4xl border-white/5 bg-zinc-950/20 hover:border-white/10 transition-all"
														showMacControls={false}>
														<div className="flex items-start justify-between gap-3">
															<div className="min-w-0">
																<h5 className="truncate font-sans text-base font-bold text-white">
																	{post.title || "Untitled post"}
																</h5>
																<p className="mt-1 text-xs text-zinc-400 line-clamp-2">
																	{post.content}
																</p>
																<p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-violet-300">
																	<Clock className="h-3 w-3" />
																	{post.scheduledAt
																			? `Scheduled for ${new Date(
																					post.scheduledAt,
																					).toLocaleString()}`
																			: "Scheduled"}
																</p>
															</div>
															<div className="flex shrink-0 items-center gap-2">
																<button
																	onClick={() =>
																		handlePublishDraft(
																			post._id,
																		)
																	}
																	className="rounded-full bg-violet-500/20 border border-violet-400/40 px-3 py-1.5 text-[10px] font-bold text-violet-200 hover:bg-violet-500/30 transition-all cursor-pointer">
																	Publish now
																</button>
																<button
																	onClick={() =>
																		handleDeleteDraft(
																			post._id,
																		)
																	}
																	className="rounded-full border border-red-500/30 px-3 py-1.5 text-[10px] font-bold text-red-400 hover:bg-red-500/10 transition-all cursor-pointer">
																	Delete
																</button>
															</div>
														</div>
													</GlassCard>
												))}
											</div>
										</div>
									)}

									{drafts.length > 0 && (
										<div>
											<h4 className="mb-3 flex items-center gap-2 text-label-sm font-semibold text-amber-300">
												<FilePenLine className="h-3.5 w-3.5" /> Drafts
											</h4>
											<div className="space-y-3">
												{drafts.map((post) => (
													<GlassCard
														key={post._id}
														animate={true}
														className="p-5 rounded-4xl border-white/5 bg-zinc-950/20 hover:border-white/10 transition-all"
														showMacControls={false}>
														<div className="flex items-start justify-between gap-3">
															<div className="min-w-0">
																<h5 className="truncate font-sans text-base font-bold text-white">
																	{post.title || "Untitled post"}
																</h5>
																<p className="mt-1 text-xs text-zinc-400 line-clamp-2">
																	{post.content}
																</p>
																<p className="mt-2 text-[11px] font-semibold text-zinc-500">
																	Last edited{" "}
																	{post.updatedAt
																		? new Date(
																				post.updatedAt,
																			).toLocaleString()
																		: "recently"}
																</p>
															</div>
															<div className="flex shrink-0 items-center gap-2">
																<button
																	onClick={() =>
																		handlePublishDraft(
																			post._id,
																		)
																	}																		className="rounded-full bg-green-500/10 border border-green-500/30 px-3 py-1.5 text-[10px] font-bold text-green-400/90 hover:bg-green-500/20 transition-all cursor-pointer">
																	Publish
																</button>
																<button
																	onClick={() =>
																		handleDeleteDraft(
																			post._id,
																		)
																	}
																	className="rounded-full border border-red-500/30 px-3 py-1.5 text-[10px] font-bold text-red-400 hover:bg-red-500/10 transition-all cursor-pointer">
																	Delete
																</button>
															</div>
														</div>
													</GlassCard>
												))}
											</div>
										</div>
									)}
								</div>
							)}
						</>
					)}

					{/* Collections Tab (self only) */}
					{profileTab === "collections" && isSelf && (
						<>
							{/* Create collection bar */}
							<div className="mb-5 max-w-2xl mx-auto w-full">
								<div className="flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-2">
									<input
										value={newCollectionName}
										onChange={(e) =>
											setNewCollectionName(e.target.value)
										}
										onKeyDown={(e) => {
											if (e.key === "Enter")
												void handleCreateCollection();
										}}
										placeholder="New collection name..."
										maxLength={100}
										className="flex-1 bg-transparent px-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none"
									/>
									<button
										onClick={() => void handleCreateCollection()}
										disabled={
											!newCollectionName.trim() || creatingCollection
										}
										className="flex shrink-0 items-center gap-1 rounded-full bg-aurora px-3 py-1.5 text-[10px] font-bold text-white border border-white/10 shadow-aurora hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer">
										{creatingCollection ? (
											<Loader2 className="h-3.5 w-3.5 animate-spin" />
										) : (
											<Plus className="h-3.5 w-3.5" />
										)}
										Create
									</button>
								</div>
							</div>

							{/* Collection detail view */}
							{activeCollectionId ? (
								<div className="max-w-2xl mx-auto w-full">
									<button
										onClick={() => {
											setActiveCollectionId(null);
											setCollectionPosts([]);
										}}
										className="mb-4 flex items-center gap-1.5 rounded-full border border-zinc-800 px-3 py-1.5 text-[11px] font-bold text-zinc-300 hover:bg-zinc-900 transition-all cursor-pointer">
										<ArrowLeft className="h-3.5 w-3.5" /> All collections
									</button>
									{loadingCollectionPosts ? (
										<div className="space-y-4">
											{[1, 2].map((n) => (
												<div
													key={n}
													className="animate-pulse rounded-3xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-3">
													<div className="h-4 w-2/3 rounded bg-zinc-800" />
													<div className="h-3 w-full rounded bg-zinc-800" />
												</div>
											))}
										</div>
									) : collectionPosts.length === 0 ? (
										<GlassCard className="flex flex-col items-center justify-center py-12 text-center shadow-sm">
											<FolderOpen className="mx-auto h-8 w-8 text-zinc-400 mb-3" />
											<h4 className="text-sm font-bold text-white">
												No posts in this collection
											</h4>
											<p className="mt-1 text-xs text-zinc-500 max-w-xs">
												Save posts to this collection from any
												post's menu to keep them organized.
											</p>
										</GlassCard>
									) : (
										<div className="space-y-3">
											{collectionPosts.map((post) => (
												<GlassCard
													key={post._id}
													animate={true}
													className="p-5 rounded-4xl border-white/5 bg-zinc-950/20 hover:border-white/10 transition-all"
													showMacControls={false}>
													<div className="flex items-start justify-between gap-3">
												<div className="min-w-0">
													<p className="text-sm font-semibold text-white line-clamp-2">
														{post.content || "(No text)"}
													</p>
													{(() => {
														const n =
															(post.images?.length || 0) +
															(post.image ? 1 : 0) +
															(post.video ? 1 : 0);
														return n > 0 ? (
															<span className="mt-1 inline-block text-[10px] text-zinc-500">
																{n} media
															</span>
														) : null;
													})()}
												</div>
														<div className="flex shrink-0 items-center gap-2">
															<button
																onClick={() =>
																	void handleRemoveFromCollection(
																		post._id,
																	)
																}
																className="rounded-full border border-red-500/30 px-3 py-1.5 text-[10px] font-bold text-red-400 hover:bg-red-500/10 transition-all cursor-pointer">
																Remove
																</button>
														</div>
													</div>													</GlassCard>
											))}
											{collectionHasMore && (
												<button
													onClick={() =>
														void loadMoreCollectionPosts()
													}
													disabled={loadingMoreCollectionPosts}
													className="w-full rounded-full border border-zinc-800 py-2.5 text-[11px] font-bold text-zinc-300 hover:bg-zinc-900 disabled:opacity-50 transition-all cursor-pointer flex items-center justify-center gap-2">
													{loadingMoreCollectionPosts ? (
														<Loader2 className="h-3.5 w-3.5 animate-spin" />
													) : (
														"Load more"
													)}
												</button>
											)}
										</div>
									)}
								</div>
							) : loadingCollections ? (
								<div className="max-w-2xl mx-auto w-full grid gap-3.5 sm:grid-cols-2">
									{[1, 2].map((n) => (
										<div
											key={n}
											className="animate-pulse rounded-3xl border border-zinc-800 bg-zinc-900/40 p-4.5 space-y-3">
											<div className="h-4 w-3/4 rounded bg-zinc-800" />
											<div className="h-3 w-1/2 rounded bg-zinc-800" />
										</div>
									))}
								</div>
							) : collections.length === 0 ? (
								<GlassCard className="flex flex-col items-center justify-center py-12 text-center shadow-sm">
									<FolderPlus className="mx-auto h-8 w-8 text-zinc-400 mb-3" />
									<h4 className="text-sm font-bold text-white">
										No collections yet
									</h4>
									<p className="mt-1 text-xs text-zinc-500 max-w-xs">
										Create a collection above to organize saved
										posts into folders.
									</p>
								</GlassCard>
							) : (
								<div className="max-w-2xl mx-auto w-full grid gap-3.5 sm:grid-cols-2">
									{collections.map((c) => (
										<GlassCard
											key={c._id}
											animate={true}
											className="p-4.5 rounded-4xl border-white/5 bg-zinc-950/20 hover:border-white/10 transition-all"
											showMacControls={false}>
											<div className="flex items-center justify-between gap-3">
												<button
													onClick={() =>
															void handleOpenCollection(
																c._id,
																)
														}
													className="min-w-0 flex-1 text-left cursor-pointer group">
													<div className="flex items-center gap-2.5">
														<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-zinc-300 group-hover:bg-zinc-800 transition-colors">
															<FolderOpen className="h-4 w-4" />
														</div>
														<div className="min-w-0">
															<h5 className="truncate text-sm font-bold text-white">
																{c.name}
															</h5>
														<p className="text-[11px] text-zinc-500">
															{c.postsCount ?? (c.posts || []).length} post
															{(c.postsCount ?? (c.posts || []).length) === 1 ? "" : "s"}
														</p>
														</div>
													</div>												</button>												<div className="flex shrink-0 items-center gap-1">
												<button
													onClick={() => setShareCollection(c)}
													className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition-all cursor-pointer"
													title="Share collection">
													<Share2 className="h-3.5 w-3.5" />
												</button>
												<button
													onClick={() =>
														setDeleteConfirmCollectionId(
															c._id,
														)
													}
													className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-red-500/10 hover:text-red-400 transition-all cursor-pointer"
													title="Delete collection">
														<Trash2 className="h-3.5 w-3.5" />
													</button>
												</div>
											</div>
										</GlassCard>
									))}
								</div>
							)}
						</>
					)}
				</div>
					</>
				)}

					{editOpen && (
						<div
							className="fixed inset-0 z-[300] flex items-start justify-center p-4 pt-12 md:pt-20 overflow-y-auto bg-black/75"
							onClick={() => setEditOpen(false)}>
							{/* Click-out backdrop */}
							<div className="absolute inset-0" />

							<div
								onClick={(e) => e.stopPropagation()}
								className="relative z-[310] w-full max-w-xl rounded-3xl border border-white/10 bg-zinc-950 p-4 md:p-5 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] mb-12">
								<div className="mb-4 pb-4 flex items-center justify-between border-b border-white/5">
									<div>
										<h3 className="text-display-xs text-white">
											Edit Profile
										</h3>
										<p className="text-sm text-zinc-400 mt-1">
											Update your profile information
										</p>
									</div>
									<button
										onClick={() => setEditOpen(false)}
										className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-black dark:hover:text-white transition-colors cursor-pointer">
										<X className="h-4 w-4" />
									</button>
								</div>

								{error && (
									<div className="mb-6 flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
										<AlertCircle className="h-4 w-4 shrink-0" />
										<span>{error}</span>
									</div>
								)}

								<form
									onSubmit={handleUpdateSubmit}
									className="space-y-4">
									<div className="grid grid-cols-2 gap-3">
										{/* Avatar Upload */}
										<div className="space-y-1.5 text-center">
											<label className="text-[12px] md:text-sm font-medium text-zinc-400">
												Profile Pic
											</label>{" "}
											<div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900 transition-colors group mx-auto overflow-hidden">
												<input
													type="file"
													accept="image/*"
													onChange={(e) => {
														const file =
															e.target.files?.[0];
														if (file) {
															if (
																file.type ===
																"image/gif"
															) {
																setProfilePicFile(
																	file,
																);
																setProfilePicPreview(
																	URL.createObjectURL(
																		file,
																	),
																);
															} else {
																setCropImageSrc(
																	URL.createObjectURL(
																		file,
																	),
																);
																setCropType(
																	"profile",
																);
																setCropModalOpen(
																	true,
																);
															}
														}
														e.target.value = "";
													}}
													className="absolute inset-0 opacity-0 cursor-pointer animate-none z-10"
												/>
												{profilePicPreview ? (
													<>
														<img
															loading="lazy"
															src={
																profilePicPreview
															}
															alt="Avatar preview"
															className="absolute inset-0 h-full w-full rounded-full object-cover pointer-events-none"
														/>
														<button
															type="button"
															onClick={(e) => {
																e.stopPropagation();
																setProfilePicFile(
																	null,
																);
																setProfilePicPreview(
																	"",
																);
															}}
															className="absolute top-3 right-3 h-4 w-4 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-md cursor-pointer transition-colors z-20"
															title="Remove avatar">
															<X className="h-2.5 w-2.5 text-white" />
														</button>
													</>
												) : (
													<div className="text-center space-y-1">
														<Camera className="mx-auto h-5 w-5 text-zinc-500" />
													</div>
												)}
											</div>
										</div>

										{/* Banner Upload */}
										<div className="space-y-1.5 text-center">
											<label className="text-[12px] md:text-sm font-medium text-zinc-400">
												Banner
											</label>
											<div className="relative flex h-16 w-full items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900 transition-colors group mx-auto overflow-hidden">
												<input
													type="file"
													accept="image/*"
													onChange={(e) => {
														const file =
															e.target.files?.[0];
														if (file) {
															if (
																file.type ===
																"image/gif"
															) {
																setBannerPicFile(
																	file,
																);
																setBannerPicPreview(
																	URL.createObjectURL(
																		file,
																	),
																);
															} else {
																setCropImageSrc(
																	URL.createObjectURL(
																		file,
																	),
																);
																setCropType(
																	"banner",
																);
																setCropModalOpen(
																	true,
																);
															}
														}
														e.target.value = "";
													}}
													className="absolute inset-0 opacity-0 cursor-pointer animate-none z-10"
												/>
												{bannerPicPreview ? (
													<>
														<img
															loading="lazy"
															src={
																bannerPicPreview
															}
															alt="Banner preview"
															className="absolute inset-0 h-full w-full object-cover"
														/>
														<button
															type="button"
															onClick={(e) => {
																e.stopPropagation();
																setBannerPicFile(
																	null,
																);
																setBannerPicPreview(
																	"",
																);
															}}
															className="absolute top-3 right-3 h-4 w-4 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-md cursor-pointer transition-colors z-20"
															title="Remove banner">
															<X className="h-2.5 w-2.5 text-white" />
														</button>
													</>
												) : (
													<div className="text-center space-y-1">
														<Camera className="mx-auto h-5 w-5 text-zinc-500" />
													</div>
												)}
											</div>
										</div>
									</div>

									<div className="space-y-4">
										<div className="space-y-1.5 font-sans">
											<label className="text-sm font-medium text-zinc-400 pl-4">
												Name
											</label>
											<input
												type="text"
												required
												value={fullName}
												onChange={(e) =>
													setFullName(e.target.value)
												}
												className="w-full rounded-lg border border-zinc-800 bg-zinc-900/55 py-2.5 px-3.5 text-[12px] md:text-sm font-medium text-white focus:outline-none focus:border-white focus:bg-zinc-900 transition-all"
											/>
										</div>

										<div className="space-y-1.5 font-sans">
											<label className="text-sm font-medium text-zinc-400 pl-4">
												About
											</label>
											<textarea
												rows={3}
												value={bio}
												onChange={(e) =>
													setBio(e.target.value)
												}
												ref={bioRef} placeholder="Write something about yourself..."
												className="w-full !rounded-lg border border-zinc-800 bg-zinc-900/55 py-2.5 px-3.5 text-[12px] md:text-sm font-medium text-white focus:outline-none focus:border-white focus:bg-zinc-900 transition-all resize-none leading-relaxed"
												maxLength={150}
											/>
										</div>

										<div className="space-y-1.5 font-sans">
											<label className="text-sm font-medium text-zinc-400 pl-4">
												Status
											</label>
											<input
												type="text"
												value={statusText}
												onChange={(e) =>
													setStatusText(e.target.value)
												}
												placeholder="Add a status (e.g. Busy, On vacation)"
												className="w-full rounded-lg border border-zinc-800 bg-zinc-900/55 py-2.5 px-3.5 text-[12px] md:text-sm font-medium text-white focus:outline-none focus:border-white focus:bg-zinc-900 transition-all"
												maxLength={80}
											/>
										</div>
									</div>

									<div className="flex gap-3.5 pt-2 font-sans">
										<button
											type="button"
											onClick={() => setEditOpen(false)}
											className="flex-1 rounded-full border border-zinc-800 py-2.5 text-[12px] md:text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-white shadow-sm cursor-pointer">
											Cancel
										</button>
										<button
											type="submit"
											disabled={saving}
											className="flex-1 rounded-full bg-aurora py-2.5 text-[12px] md:text-sm font-semibold text-white border border-white/10 shadow-aurora hover:opacity-90 disabled:opacity-50 transition-all cursor-pointer">
											{saving ? "Saving..." : "Save"}
										</button>
									</div>
								</form>
							</div>
						</div>
					)}

				{/* Edit Post Modal */}
				{editPostDrawerOpen && (
					<div
						className="fixed inset-0 z-[300] flex items-start justify-center p-4 pt-12 md:pt-20 overflow-y-auto bg-black/75"
						onClick={() => {
							setEditPostDrawerOpen(false);
							setEditPostId(null);
							setEditPostNewPreviews((prev) => {
								prev.forEach((u) => URL.revokeObjectURL(u));
								return [];
							});
							setEditPostNewFiles([]);
							setEditPostExistingImages([]);
						}}
					>
						<div
							onClick={(e) => e.stopPropagation()}
							className="relative z-[310] w-full max-w-xl rounded-3xl border border-white/10 bg-zinc-950 p-5 md:p-6 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] mb-12"
						>
							<div className="mb-5 flex items-center justify-between">
								<div>
									<h3 className="text-display-xs text-white">Edit Post</h3>
								</div>
								<button
									onClick={() => {
										setEditPostDrawerOpen(false);
										setEditPostId(null);
										setEditPostNewPreviews((prev) => {
											prev.forEach((u) => URL.revokeObjectURL(u));
											return [];
										});
										setEditPostNewFiles([]);
										setEditPostExistingImages([]);
									}}
									className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer"
								>
									<X className="h-4 w-4" />
								</button>
							</div>
							<div className="space-y-4">
								<input
									type="text"
									value={editPostTitle}
									onChange={(e) => setEditPostTitle(e.target.value)}
									placeholder="Post title"
									className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 py-3.5 px-5 text-[12px] md:text-sm text-white outline-none focus:border-zinc-600 transition-all"
								/>
								<textarea
									value={editPostContent}
									onChange={(e) => setEditPostContent(e.target.value)}
									ref={editPostContentRef} placeholder="Post content"
									rows={5}
									className="w-full !rounded-lg border border-zinc-800 bg-zinc-900/55 py-3.5 px-5 text-[12px] md:text-sm text-white outline-none focus:border-white transition-all resize-none"
								/>

								{/* Existing images — show with remove button */}
								{editPostExistingImages.length > 0 && (
									<div>
										<label className="text-[12px] md:text-sm font-medium text-zinc-400 pl-3 mb-2 block">Current Images</label>
										<div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
											{editPostExistingImages.map((img) => (
												<div key={img.public_id} className="relative shrink-0 overflow-hidden rounded-xl border border-zinc-800 w-20 h-20 group">
													<img loading="lazy" src={optimizeImageUrl(img.url, 400)} alt="" className="w-full h-full object-cover" />
													<button
														type="button"
														onClick={() => handleEditPostRemoveExistingImage(img.public_id)}
														className="absolute top-1.5 right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100 hover:bg-black transition-all z-20"
													>
														<X className="h-2.5 w-2.5" />
													</button>
												</div>
											))}
										</div>
									</div>
								)}

								{/* New image previews */}
								{editPostNewPreviews.length > 0 && (
									<div>
										<label className="text-[12px] md:text-sm font-medium text-zinc-400 pl-3 mb-2 block">New Images</label>
										<div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
											{editPostNewPreviews.map((preview, idx) => (
												<div key={idx} className="relative shrink-0 overflow-hidden rounded-xl border border-zinc-800 w-20 h-20 group">
													<img loading="lazy" src={preview} alt="" className="w-full h-full object-cover" />
													<button
														type="button"
														onClick={() => handleEditPostRemoveNewImage(idx)}
														className="absolute top-1.5 right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100 hover:bg-black transition-all z-20"
													>
														<X className="h-2.5 w-2.5" />
													</button>
												</div>
											))}
										</div>
									</div>
								)}

								{/* Add image button */}
								<div className="relative">
									<input
										type="file"
										accept="image/*"
										onChange={handleEditPostAddImages}
										className="absolute inset-0 opacity-0 cursor-pointer"
									/>
									<button
										type="button"
										className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-700 py-3 text-[12px] md:text-sm font-medium text-zinc-400 hover:border-zinc-500 hover:text-zinc-300 transition-all pointer-events-none"
									>
										<Image className="h-4 w-4" /> Add Image
									</button>
								</div>
							</div>
							<div className="flex gap-3.5 pt-4">
								<button
									onClick={() => {
										setEditPostDrawerOpen(false);
										setEditPostId(null);
										setEditPostNewPreviews((prev) => {
											prev.forEach((u) => URL.revokeObjectURL(u));
											return [];
										});
										setEditPostNewFiles([]);
										setEditPostExistingImages([]);
									}}
									className="flex-1 rounded-full border border-zinc-800 py-3.5 text-[12px] md:text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-white cursor-pointer"
								>
									Cancel
								</button>
								<button
									onClick={handleEditPostDrawerSave}
									className="flex-1 rounded-full bg-aurora py-3.5 text-sm font-semibold text-white border border-white/10 shadow-aurora hover:opacity-90 cursor-pointer"
								>
									Save
								</button>
							</div>
						</div>
					</div>
				)}

				{/* Edit post image crop modal */}
				<ImageCropModal
					isOpen={editPostCropOpen}
					onClose={() => {
						setEditPostCropOpen(false);
						if (editPostCropSrc) {
							URL.revokeObjectURL(editPostCropSrc);
							setEditPostCropSrc("");
						}
					}}
					imageSrc={editPostCropSrc}
					aspectRatio={1}
					title="Crop Image"
					onCropComplete={handleEditPostCropComplete}
				/>

				<ImageCropModal
					isOpen={cropModalOpen}
					onClose={() => setCropModalOpen(false)}
					imageSrc={cropImageSrc}
					aspectRatio={cropType === "profile" ? 1 : 16 / 9}
					title={`Adjust ${cropType === "profile" ? "Avatar" : "Banner"} crop`}
					onCropComplete={(blob) => {
						const file = new File(
							[blob],
							`${cropType}_cropped.jpg`,
							{
								type: "image/jpeg",
							},
						);
						if (cropType === "profile") {
							setProfilePicFile(file);
							setProfilePicPreview(URL.createObjectURL(blob));
						} else {
							setBannerPicFile(file);
							setBannerPicPreview(URL.createObjectURL(blob));
						}
					}}
				/>

				{deleteConfirmDraftId !== null && createPortal(
					<ConfirmDialog
						isOpen={deleteConfirmDraftId !== null}
						title="Delete Draft"
						message="Are you sure you want to delete this draft? This action cannot be undone."
						confirmLabel="Delete"
						cancelLabel="Cancel"
						variant="danger"
						onConfirm={confirmDeleteDraft}
						onCancel={() => setDeleteConfirmDraftId(null)}
					/>,
					document.body
				)}

				{deleteConfirmPostId !== null && createPortal(
					<ConfirmDialog
						isOpen={deleteConfirmPostId !== null}
						title="Delete Post"
						message="Are you sure you want to delete this post? This action cannot be undone."
						confirmLabel="Delete"
						cancelLabel="Cancel"
						variant="danger"
						onConfirm={confirmDeletePost}
						onCancel={() => setDeleteConfirmPostId(null)}
					/>,
					document.body
				)}

				{deleteConfirmCollectionId !== null &&
					createPortal(
						<ConfirmDialog
							isOpen={deleteConfirmCollectionId !== null}
							title="Delete Collection"
							message="Are you sure you want to delete this collection? The posts inside it will not be deleted, only removed from this folder."
							confirmLabel="Delete"
							cancelLabel="Cancel"
							variant="danger"
							onConfirm={() => void confirmDeleteCollection()}
							onCancel={() =>
								setDeleteConfirmCollectionId(null)
							}
						/>,
						document.body,
					)}

				{/* Share collection — reuse the same ForwardModal as posts */}
				{shareCollection && (
					<ForwardModal
						open={!!shareCollection}
						onClose={() => {
							if (!sharingCollection) setShareCollection(null);
						}}
						title="Share collection"
						subtitle={shareCollection?.name}
						myUserId={user?._id}
						includeCommunities
						onForward={handleForwardCollection}
					/>
				)}

				{createPortal(
					<AnimatePresence>
						{activeList && (
							<div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
								<motion.div
									initial={{ opacity: 0 }}
									animate={{ opacity: 1 }}
									exit={{ opacity: 0 }}
									transition={{ duration: 0.15 }}
									onClick={() => setActiveList(null)}
									className="absolute inset-0 bg-black/70"
								/>
								<motion.div
									initial={{ opacity: 0, scale: 0.96 }}
									animate={{ opacity: 1, scale: 1 }}
									exit={{ opacity: 0, scale: 0.96 }}
									transition={{ duration: 0.15, ease: "easeOut" }}
									className="relative w-full max-w-sm bg-zinc-950 rounded-4xl shadow-2xl overflow-hidden border border-zinc-800/50 flex flex-col max-h-[80vh]">
								<div className="flex items-center justify-between p-4 border-b border-zinc-100 dark:border-zinc-900 sticky top-0 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-md z-10">
									<h3 className="font-bold text-white capitalize">
										{activeList}
									</h3>
									<button
										onClick={() => setActiveList(null)}
										className="rounded-full p-2 text-slate-400 hover:bg-zinc-800 transition">
										<X className="h-4 w-4" />
									</button>
								</div>

								<div className="overflow-y-auto p-4 space-y-4">
									{listLoading ? (
										<div className="py-8 text-center text-zinc-500 text-sm">
											Loading...
										</div>
									) : listItems.length === 0 ? (
										<div className="py-8 text-center text-zinc-500 text-sm">
											No {activeList} found.
										</div>
									) : activeList === "reposts" ? (
										listItems.map((post) => (
											<div
												key={post._id}
												className="cursor-pointer group flex gap-3 text-left p-3.5 rounded-3xl hover:bg-zinc-900 shadow-sm transition-all border border-zinc-800/40 mb-2 last:mb-0"
												onClick={() => {
													setActiveList(null);
													onPostClick(post.slug);
												}}>
												<UserAvatar
													src={
														post.author?.profilePic
															?.url
													}
													alt=""
													className="w-10 h-10 rounded-full object-cover shrink-0"
												/>
												<div>
													<div className="font-bold text-sm text-white">
														{post.author?.fullName}
													</div>														<div className="text-xs font-semibold text-zinc-500">
															@{post.author?.username}
														</div>
														{post.visibility === "closeFriends" && (
														<span className="mt-1 inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 text-[9px] font-bold text-emerald-400/80">
															<Lock className="h-2.5 w-2.5" /> Close Friends
														</span>
														)}
														<p className="text-sm mt-1 text-zinc-400 line-clamp-2">
														{post.title}
													</p>
												</div>
											</div>
										))
									) : (
										listItems.map((u) => (
											<div
												key={u._id}
												className="cursor-pointer flex items-center gap-3 p-3 rounded-2xl hover:bg-zinc-900 border border-zinc-800/30 transition-colors mb-2 last:mb-0"
												onClick={() => {
													setActiveList(null);
													onUserClick(u.username);
												}}>
												<UserAvatar
													src={u.profilePic?.url}
													alt=""
													className="w-10 h-10 rounded-full object-cover shrink-0"
												/>
												<div className="flex flex-col text-left flex-1">
													<span className="font-bold text-sm text-white">
														{u.fullName}
													</span>
													<span className="text-xs font-semibold text-zinc-500">
														@{u.username}
													</span>
												</div>
												{user &&
													user._id !== u._id &&
													(() => {
														const isUserFollowing =
															followingStates[
																u._id
															] ??
															u.isFollowing ??
															false;
														return (
															<button
																onClick={async (
																	e,
																) => {
																	e.stopPropagation();
																	await onToggleFollow(
																		u._id,
																	);
																}}
																className={`ml-auto text-xs font-bold px-3.5 py-1.5 rounded-full border transition-all cursor-pointer ${
																	isUserFollowing
																		? "bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700 hover:text-zinc-200"																						: "bg-aurora text-white border border-white/10 shadow-aurora hover:opacity-90"
																}`}>
																{isUserFollowing
																	? "Following"
																	: "Follow"}
															</button>
														);
													})()}
											</div>
										))
									)}
								</div>
							</motion.div>
						</div>
					)}
				</AnimatePresence>,
				document.body
			)}
			</div>

	{/* Forward Profile Modal (shared message-forward UI) */}
	<ForwardModal
		open={forwardOpen}
		onClose={() => setForwardOpen(false)}
		title="Forward Profile"
		subtitle={
			profile ? (
				<span>										{profile.fullName || "Profile"} (@{profile.username})
									</span>
			) : undefined
		}
		myUserId={user?._id}
		onForward={handleForwardProfile}
	/>

			{/* Pull-to-refresh indicator */}
			{(pullDistance > 0 || isRefreshing) && (
				<div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center justify-center">
					<div
						className={`flex items-center gap-2 text-[11px] text-zinc-400 ${isRefreshing ? "" : ""}`}>
						<svg
							className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
							style={
								!isRefreshing
									? {
											transform: `rotate(${pullDistance * 3}deg)`,
										}
									: undefined
							}
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2">
							<path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 0 1 9-9" />
						</svg>
						<span>
							{isRefreshing ? "Refreshing..." : "Pull to refresh"}
						</span>
					</div>
				</div>
			)}
		</>
	);
}

// shimmer skeleton while profile data loads from API

// button triggers /api/users/export and downloads JSON file
