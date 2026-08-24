import React, { useState, useEffect, useRef } from "react";

import { Search, Hash, Users, Compass, Heart, MessageSquare, Bookmark, Repeat2, AlertCircle, TrendingUp, Flame, Globe, RefreshCw, Loader2, Eye } from "lucide-react";
import { User, Post, ExternalPost, ExternalSource } from "../types";
import GlassCard from "./GlassCard";
import Skeleton from "./Skeleton";
import UserAvatar from "./UserAvatar";
import { apiFetch } from "../utils/api";
import { getCachedResponse } from "../utils/apiCache";
import { getOfflineFallback } from "../utils/dexieBridge";
import { useCacheRefresh } from "../hooks/useCacheRefresh";
import {
  usePostViewTracking,
  registerPostView,
} from "../hooks/usePostViewTracking";
import EmptyState from "./EmptyState";
import { optimizeImageUrl } from "../utils/imageUrls";

// Stable RegExp for matching trending/popular cache refresh events
// — module-level to prevent React effect re-attachment on every render.
const MATCHER_TRENDING = /\/api\/posts\/trending|sort=likesCount/;
import { logger } from "../utils/logger";
import Leaderboard from "./Leaderboard";
import MissionsPanel from "./MissionsPanel";
import ExternalPostCard from "./ExternalPostCard";

interface ExploreProps {
  onUserSelected: (username: string) => void;
  onPostSelected: (slug: string) => void;
  user: any;
  followingStates: Record<string, boolean>;
  requestedFollows?: Record<string, boolean>;
  onToggleFollow: (
    userId: string,
  ) => Promise<void | { requested?: boolean }>;
  /** Hashtag search request from a `searchHashtag` tap anywhere in the app. */
  searchQuery?: string;
  /** Increments on every hashtag tap so repeat taps of the same tag re-search. */
  searchNonce?: number;
}

export default function Explore({
  onUserSelected,
  onPostSelected,
  user,
  followingStates,
  requestedFollows,
  onToggleFollow,
  searchQuery,
  searchNonce = 0,
}: ExploreProps) {
  const [q, setQ] = useState(searchQuery || "");
  const [activeSegment, setActiveSegment] = useState<"users" | "posts" | "trending" | "web">("trending");
  // Imported open-web feed (Bluesky / Mastodon / Lemmy)
  const [externalPosts, setExternalPosts] = useState<ExternalPost[]>([]);
  const [externalNextCursor, setExternalNextCursor] = useState<string | null>(null);
  const [externalSource, setExternalSource] = useState<ExternalSource | "all">("all");
  const [externalLoading, setExternalLoading] = useState(false);
  const [externalRefreshing, setExternalRefreshing] = useState(false);
  const [externalReloadTick, setExternalReloadTick] = useState(0);
  const [candidates, setCandidates] = useState<User[]>([]);
  const [postCandidates, setPostCandidates] = useState<Post[]>([]);
  const [trendingHashtags, setTrendingHashtags] = useState<string[]>([]);
  // Live post counts per trending tag (what users are actually using right now)
  const [trendingCounts, setTrendingCounts] = useState<Record<string, number>>({});
  const [trendingPosts, setTrendingPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);

  // Post view tracking (3s visibility → one view) for the trending + search
  // post surfaces — cards carry data-post-id.
  usePostViewTracking({
    enabled: !loading,
    deps: [trendingPosts, postCandidates, activeSegment, q, loading],
  });

  // Listen for realtime comment count updates from other users
  useEffect(() => {
    const handleCommentAdded = (e: CustomEvent<{ postId: string; commentsCount: number }>) => {
      const { postId, commentsCount } = e.detail;
      const update = (p: Post) => (p._id === postId ? { ...p, commentsCount } : p);
      setPostCandidates((prev) => prev.map(update));
      setTrendingPosts((prev) => prev.map(update));
    };
    window.addEventListener("postCommentAdded", handleCommentAdded as EventListener);
    return () => window.removeEventListener("postCommentAdded", handleCommentAdded as EventListener);
  }, []);

  // Listen for realtime post deletion
  useEffect(() => {
    const handlePostDeleted = (e: CustomEvent<{ postId: string }>) => {
      const { postId } = e.detail;
      setPostCandidates((prev) => prev.filter((p) => p._id !== postId));
      setTrendingPosts((prev) => prev.filter((p) => p._id !== postId));
    };
    window.addEventListener("postDeleted", handlePostDeleted as EventListener);
    return () => window.removeEventListener("postDeleted", handlePostDeleted as EventListener);
  }, []);

  // Listen for realtime post edits (preserve interaction status for current user)
  useEffect(() => {
    const handlePostUpdated = (e: CustomEvent<{ post: Post }>) => {
      const { post } = e.detail;
      const update = (p: Post) =>
        p._id === post._id
          ? { ...p, ...post, likedByMe: p.likedByMe, savedByMe: p.savedByMe, repostedByMe: p.repostedByMe }
          : p;
      setPostCandidates((prev) => prev.map(update));
      setTrendingPosts((prev) => prev.map(update));
    };
    window.addEventListener("postUpdated", handlePostUpdated as EventListener);
    return () => window.removeEventListener("postUpdated", handlePostUpdated as EventListener);
  }, []);

  // Listen for realtime comment deletion (update commentsCount from authoritative server value)
  useEffect(() => {
    const handleCommentDeleted = (e: CustomEvent<{ postId: string; commentsCount: number }>) => {
      const { postId, commentsCount } = e.detail;
      const update = (p: Post) => (p._id === postId ? { ...p, commentsCount } : p);
      setPostCandidates((prev) => prev.map(update));
      setTrendingPosts((prev) => prev.map(update));
    };
    window.addEventListener("postCommentDeleted", handleCommentDeleted as EventListener);
    return () => window.removeEventListener("postCommentDeleted", handleCommentDeleted as EventListener);
  }, []);

  // Listen for realtime post view updates
  useEffect(() => {
    const handlePostViewUpdated = (e: CustomEvent<{ postId: string; viewsCount: number }>) => {
      const { postId, viewsCount } = e.detail;
      const update = (p: Post) => (p._id === postId ? { ...p, viewsCount } : p);
      setPostCandidates((prev) => prev.map(update));
      setTrendingPosts((prev) => prev.map(update));
    };
    window.addEventListener("postViewUpdated", handlePostViewUpdated as EventListener);
    return () => window.removeEventListener("postViewUpdated", handlePostViewUpdated as EventListener);
  }, []);

  // Listen for post interaction changes from other components
  useEffect(() => {
    const handleInteraction = (e: CustomEvent<{ postId: string; type: string; value: boolean; source?: string }>) => {
      const { postId, type, value, source } = e.detail;
      const isSocketSource = source === "socket";
      const updatePost = (p: Post): Post => {
        if (p._id !== postId) return p;
        if (type === "like" || type === "save" || type === "repost") {
          const statusField = type === "like" ? "likedByMe" : type === "save" ? "savedByMe" : "repostedByMe";
          const countField = type === "like" ? "likesCount" : type === "save" ? "savesCount" : "repostsCount";
          const count = Math.max(0, (p[countField as keyof Post] as number || 0) + (value ? 1 : -1));
          if (isSocketSource) {
            return { ...p, [countField]: count };
          }
          return { ...p, [statusField]: value, [countField]: count };
        }
        if (type === "share") {
          return { ...p, sharesCount: Math.max(0, (p.sharesCount || 0) + 1) };
        }
        return p;
      };
      setPostCandidates((prev) => prev.map(updatePost));
      setTrendingPosts((prev) => prev.map(updatePost));
    };
    window.addEventListener("postInteractionChanged", handleInteraction as EventListener);
    return () => window.removeEventListener("postInteractionChanged", handleInteraction as EventListener);
  }, []);

  // Toggle like from search results
  const handleLikeToggle = async (postId: string, likedByMe: boolean) => {
    // Liking is an explicit signal of engagement — count it as a view.
    registerPostView(postId);
    const prevLiked = likedByMe;
    const prevCount = (() => { const p = [...postCandidates, ...trendingPosts].find(x => x._id === postId); return p?.likesCount ?? 0; })();

    const toggleLike = (p: Post) =>
      p._id === postId
        ? { ...p, likedByMe: !prevLiked, likesCount: Math.max(0, (p.likesCount || 0) + (prevLiked ? -1 : 1)) }
        : p;
    setPostCandidates((prev) => prev.map(toggleLike));
    setTrendingPosts((prev) => prev.map(toggleLike));
    try {
      const res = await apiFetch(`/api/likes/post/${postId}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const rollback = (p: Post) =>
          p._id === postId ? { ...p, likedByMe: prevLiked, likesCount: prevCount } : p;
        setPostCandidates((prev) => prev.map(rollback));
        setTrendingPosts((prev) => prev.map(rollback));
        window.dispatchEvent(new CustomEvent("showToast", {
          detail: { message: data.message || "Failed to like post", type: "error" },
        }));
      } else {
        window.dispatchEvent(new CustomEvent("postInteractionChanged", { detail: { postId, type: "like", value: !likedByMe } }));
      }
    } catch (e) {
      logger.error(e);
      const rollback = (p: Post) =>
        p._id === postId ? { ...p, likedByMe: prevLiked, likesCount: prevCount } : p;
      setPostCandidates((prev) => prev.map(rollback));
      setTrendingPosts((prev) => prev.map(rollback));
      window.dispatchEvent(new CustomEvent("showToast", {
        detail: { message: "Network connection error", type: "error" },
      }));
    }
  };

  // Toggle save from search results
  const handleSaveToggle = async (postId: string, savedByMe: boolean) => {
    // Saving is an explicit signal of engagement — count it as a view.
    registerPostView(postId);
    const prevSaved = savedByMe;
    const prevCount = (() => { const p = [...postCandidates, ...trendingPosts].find(x => x._id === postId); return p?.savesCount ?? 0; })();

    const toggleSave = (p: Post) =>
      p._id === postId
        ? { ...p, savedByMe: !prevSaved, savesCount: Math.max(0, (p.savesCount || 0) + (prevSaved ? -1 : 1)) }
        : p;
    setPostCandidates((prev) => prev.map(toggleSave));
    setTrendingPosts((prev) => prev.map(toggleSave));
    try {
      const res = await apiFetch(`/api/saves/${postId}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const rollback = (p: Post) =>
          p._id === postId ? { ...p, savedByMe: prevSaved, savesCount: prevCount } : p;
        setPostCandidates((prev) => prev.map(rollback));
        setTrendingPosts((prev) => prev.map(rollback));
        window.dispatchEvent(new CustomEvent("showToast", {
          detail: { message: data.message || "Failed to save post", type: "error" },
        }));
      } else {
        window.dispatchEvent(new CustomEvent("postInteractionChanged", { detail: { postId, type: "save", value: !savedByMe } }));
      }
    } catch (e) {
      logger.error(e);
      const rollback = (p: Post) =>
        p._id === postId ? { ...p, savedByMe: prevSaved, savesCount: prevCount } : p;
      setPostCandidates((prev) => prev.map(rollback));
      setTrendingPosts((prev) => prev.map(rollback));
      window.dispatchEvent(new CustomEvent("showToast", {
        detail: { message: "Network connection error", type: "error" },
      }));
    }
  };

  // Toggle repost from search results
  const handleRepostToggle = async (postId: string, repostedByMe: boolean) => {
    const prevReposted = repostedByMe;
    const prevCount = (() => { const p = [...postCandidates, ...trendingPosts].find(x => x._id === postId); return p?.repostsCount ?? 0; })();

    const toggleRepost = (p: Post) =>
      p._id === postId
        ? { ...p, repostedByMe: !prevReposted, repostsCount: Math.max(0, (p.repostsCount || 0) + (prevReposted ? -1 : 1)) }
        : p;
    setPostCandidates((prev) => prev.map(toggleRepost));
    setTrendingPosts((prev) => prev.map(toggleRepost));
    try {
      const res = await apiFetch(`/api/reposts/${postId}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const rollback = (p: Post) =>
          p._id === postId ? { ...p, repostedByMe: prevReposted, repostsCount: prevCount } : p;
        setPostCandidates((prev) => prev.map(rollback));
        setTrendingPosts((prev) => prev.map(rollback));
        window.dispatchEvent(new CustomEvent("showToast", {
          detail: { message: data.message || "Failed to repost", type: "error" },
        }));
      } else {
        window.dispatchEvent(new CustomEvent("postInteractionChanged", { detail: { postId, type: "repost", value: !repostedByMe } }));
        window.dispatchEvent(new CustomEvent("showToast", {
          detail: { message: !repostedByMe ? "Reposted!" : "Repost removed.", type: "success" },
        }));
      }
    } catch (e) {
      logger.error(e);
      const rollback = (p: Post) =>
        p._id === postId ? { ...p, repostedByMe: prevReposted, repostsCount: prevCount } : p;
      setPostCandidates((prev) => prev.map(rollback));
      setTrendingPosts((prev) => prev.map(rollback));
      window.dispatchEvent(new CustomEvent("showToast", {
        detail: { message: "Network connection error", type: "error" },
      }));
    }
  };

  const performSearch = async (query: string) => {
    if (!query.trim()) {
      setCandidates([]);
      setPostCandidates([]);
      return;
    }

    setLoading(true);
    try {
      if (activeSegment === "users") {
        const res = await apiFetch(`/api/search/users?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (res.ok && data.success) {
          setCandidates(data.users || []);
        }
      } else {
        const res = await apiFetch(`/api/search/posts?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (res.ok && data.success) {
          setPostCandidates(data.posts || []);
        }
      }
    } catch (err) {
      logger.error(err);
    } finally {
      setLoading(false);
    }
  };	// On mount, try to display cached trending data instantly (stale-while-revalidate)
	useEffect(() => {
		(async () => {
			if (activeSegment !== "trending" || q) return;
			try {
				let [cachedHashtags, cachedPosts] = await Promise.all([
					getCachedResponse<{
						hashtags: string[];
						counts?: Record<string, number>;
						success: boolean;
					}>("/api/posts/trending/hashtags"),
					getCachedResponse<{
						posts: Post[];
						success: boolean;
					}>("/api/posts?limit=5&sort=likesCount"),
				]);
				// CacheStorage missed → try the Dexie structured layer so an
				// eviction or offline reload still paints the trending strip.
				if (!cachedPosts?.posts?.length) {
					const offPosts = (await getOfflineFallback(
						"/api/posts?limit=5&sort=likesCount",
					)) as { posts?: Post[]; success: boolean } | null;
					if (offPosts?.posts?.length) {
						cachedPosts = offPosts as {
							posts: Post[];
							success: boolean;
						};
					}
				}
				if (cachedHashtags?.hashtags?.length && cachedHashtags.success) {
					setTrendingHashtags(cachedHashtags.hashtags);
					setTrendingCounts(cachedHashtags.counts || {});
				}
				if (cachedPosts?.posts?.length && cachedPosts.success) {
					setTrendingPosts(cachedPosts.posts);
				}
				if (cachedHashtags || cachedPosts) {
					setLoading(false);
				}
			} catch {
				// Cache read failures are non-critical
			}
		})();
	}, []);

	// When the background cache timer refreshes trending/popular data,
	// re-fetch so the Explore tab stays up-to-date automatically.
	useCacheRefresh(MATCHER_TRENDING, () => fetchTrending());  // Fetch trending hashtags and popular posts
  const fetchTrending = async () => {
    setLoading(true);
    try {
      const [hashtagRes, postsRes] = await Promise.all([
        apiFetch("/api/posts/trending/hashtags", { bypassCache: true }),
        apiFetch("/api/posts?limit=5&sort=likesCount", { bypassCache: true }),
      ]);
      const hashtagData = await hashtagRes.json();
      const postsData = await postsRes.json();
      if (hashtagRes.ok && hashtagData.success) {
        setTrendingHashtags(hashtagData.hashtags || []);
        setTrendingCounts(hashtagData.counts || {});
      }
      if (postsRes.ok && postsData.success) {
        setTrendingPosts(postsData.posts || []);
      }
    } catch (err) {
      logger.error("Failed to fetch trending", err);
    } finally {
      setLoading(false);
    }
  };

  // Lightweight refresh of JUST the hashtag chips — used by the live poll
  // below so the chips keep tracking what users are posting right now.
  const refreshTrendingHashtags = async () => {
    try {
      const res = await apiFetch("/api/posts/trending/hashtags", {
        bypassCache: true,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTrendingHashtags(data.hashtags || []);
        setTrendingCounts(data.counts || {});
      }
    } catch (err) {
      logger.error("Failed to refresh trending hashtags", err);
    }
  };

  // Live trending — while the trending segment is open (and no search query
  // is active), refresh the chips every 60s so they change as the feed does.
  useEffect(() => {
    if (activeSegment !== "trending" || q) return;
    const id = setInterval(() => {
      void refreshTrendingHashtags();
    }, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSegment, q]);

  useEffect(() => {
    if (activeSegment === "trending" && !q) {
      fetchTrending();
    }
  }, [activeSegment]);

  // Fetch the imported open-web feed (first page, on tab open / source change)
  useEffect(() => {
    if (activeSegment !== "web") return;
    let cancelled = false;
    setExternalLoading(true);
    (async () => {
      try {
        const res = await apiFetch(
          `/api/external/feed?source=${externalSource === "all" ? "" : externalSource}&limit=20`,
          { bypassCache: true },
        );
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data.success) {
          setExternalPosts(data.posts || []);
          setExternalNextCursor(data.nextCursor || null);
        }
      } catch (err) {
        if (!cancelled) logger.error("Failed to fetch external feed", err);
      } finally {
        if (!cancelled) setExternalLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSegment, externalSource, externalReloadTick]);

  const fetchMoreExternal = async () => {
    if (!externalNextCursor || externalLoading) return;
    setExternalLoading(true);
    try {
      const res = await apiFetch(
        `/api/external/feed?source=${externalSource === "all" ? "" : externalSource}&limit=20&cursor=${externalNextCursor}`,
        { bypassCache: true },
      );
      const data = await res.json();
      if (res.ok && data.success) {
        setExternalPosts((prev) => [...prev, ...(data.posts || [])]);
        setExternalNextCursor(data.nextCursor || null);
      }
    } catch (err) {
      logger.error("Failed to load more external posts", err);
    } finally {
      setExternalLoading(false);
    }
  };

  // Infinite scroll for the open-web feed — a sentinel div below the cards
  // auto-loads the next page as soon as it scrolls into view (same pattern
  // as the main feed). The observer re-arms whenever the cursor, loading
  // state, or source filter changes.
  const externalSentinelRef = useRef<HTMLDivElement>(null);
  const fetchMoreExternalRef = useRef(fetchMoreExternal);
  useEffect(() => {
    fetchMoreExternalRef.current = fetchMoreExternal;
  });

  useEffect(() => {
    if (!externalNextCursor || externalLoading) return;
    const sentinel = externalSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !externalLoading) {
          void fetchMoreExternalRef.current();
        }
      },
      { root: null, rootMargin: "200px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [externalNextCursor, externalLoading, externalSource]);

  const refreshExternal = async () => {
    setExternalRefreshing(true);
    try {
      await apiFetch("/api/external/feed/refresh", { method: "POST" });
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Open-web feed refreshed!", type: "success" },
        }),
      );
      // Re-pull the first page
      setExternalReloadTick((t) => t + 1);
    } catch (err) {
      logger.error("Failed to refresh external feed", err);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Could not refresh right now.", type: "error" },
        }),
      );
    } finally {
      setExternalRefreshing(false);
    }
  };

  // Debounced search — `searchNonce` is included so tapping the SAME hashtag
  // twice still re-runs the search (setQ alone is a no-op for equal values).
  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(q);
    }, 300);
    return () => clearTimeout(timer);
  }, [q, activeSegment, searchNonce]);

  // Hashtag tap from anywhere in the app — switch to the posts segment and
  // search that hashtag (the App shell passes the query via `searchQuery` +
  // a monotonically-increasing `searchNonce` so repeat taps of the same tag
  // and taps after a manual search change all re-trigger).
  useEffect(() => {
    if (!searchQuery || searchNonce === 0) return;
    setActiveSegment("posts");
    setQ(searchQuery);
  }, [searchQuery, searchNonce]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    performSearch(q);
  };

  return (
    <div className="w-full px-2 pt-6 content-visibility-auto">
      {/* Search Header */}
      <div className="mb-6 px-1.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>					<span className="text-[10px] font-mono tracking-[0.25em] font-black text-violet-300/80 uppercase flex items-center gap-1.5">
            <Compass className="h-6 w-6 text-violet-200 shrink-0" /> EXPLORE
          </span>
          <h2 className="text-display-sm text-gradient-aurora mt-1">
            Discover
          </h2>
        </div>
      </div>

      {/* Modern Search bar */}
      <form onSubmit={handleSearch} className="mb-6 relative group/form">
        <input
          type="text"
          placeholder={`Search ${activeSegment === "users" ? "users" : activeSegment === "web" ? "the open web" : "posts"}`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full rounded-full border border-zinc-800 bg-zinc-950/60 backdrop-blur-xl py-3.5 pl-14 pr-24 text-[12px] md:text-sm font-medium text-slate-850 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-550 outline-none focus:border-white focus:ring-2 focus:ring-white/20 transition-all shadow-md relative z-10"
        />
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-5 w-5 text-zinc-400 z-10" />
        <button
          type="submit"			className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-aurora text-white border border-white/10 px-5 py-2 text-[12px] md:text-sm font-semibold shadow-aurora transition-all hover:opacity-90 active:scale-95 cursor-pointer z-10"
        >
          Search
        </button>
      </form>

      {/* Tab select slider */}
      <div className="mb-6 flex items-center justify-start gap-2 px-1.5">
        <button
          onClick={() => {
            setActiveSegment("trending");
            setCandidates([]);
            setPostCandidates([]);
          }}			className={`flex items-center gap-2 rounded-full px-4 py-2 text-[12px] md:text-sm font-medium transition-all cursor-pointer ${activeSegment === "trending"
			? "pill-active"
			: "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
			}`}
        >
          <Flame className="h-4 w-4" /> Trending
        </button>
        <button
          onClick={() => {
            setActiveSegment("users");
            setCandidates([]);
            setPostCandidates([]);
          }}			className={`flex items-center gap-2 rounded-full px-4 py-2 text-[12px] md:text-sm font-medium transition-all cursor-pointer ${activeSegment === "users"
			? "pill-active"
			: "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
			}`}
        >
          <Users className="h-4 w-4" /> Users
        </button>

        <button
          onClick={() => {
            setActiveSegment("posts");
            setCandidates([]);
            setPostCandidates([]);
          }}			className={`flex items-center gap-2 rounded-full px-4 py-2 text-[12px] md:text-sm font-medium transition-all cursor-pointer ${activeSegment === "posts"
			? "pill-active"
			: "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
			}`}
        >
          <Hash className="h-4 w-4" /> Posts
        </button>
        <button
          onClick={() => setActiveSegment("web")}			className={`flex items-center gap-2 rounded-full px-4 py-2 text-[12px] md:text-sm font-medium transition-all cursor-pointer ${activeSegment === "web"
			? "pill-active"
			: "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
			}`}
        >
          <Globe className="h-4 w-4" /> Web
        </button>
      </div>

      <div className="space-y-4">
        {/* Results Stream column */}
        <div className="space-y-4">            {followError && (
              <div className="mb-4 flex items-start gap-2 rounded-3xl border border-red-500/20 bg-red-500/5 p-3.5 text-sm text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{followError}</span>
              </div>
            )}
            {loading ? (
              <div className="space-y-3">
              <Skeleton variant="profile-row" />
              <Skeleton variant="profile-row" />
              <Skeleton variant="profile-row" />
            </div>
          ) : activeSegment === "users" ? (
            candidates.length === 0 ? (
              q ? (
                <EmptyState variant="search" title="No users found" description="Try a different search term." />
              ) : null
            ) : (
              <div className="space-y-3">
                {candidates.map((usr) => (
                  <GlassCard
                    key={usr._id}
                    className="p-3 rounded-2xl"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <UserAvatar
                          src={usr.profilePic?.url}
                          alt={usr.fullName}
                          className="h-8 w-8 shrink-0 rounded-full object-cover border border-zinc-800 shadow-sm cursor-pointer"
                          onClick={() => onUserSelected(usr.username)}
                        />
                        <div className="text-left min-w-0">
                          <h4
                            onClick={() => onUserSelected(usr.username)}
                            className="text-sm font-semibold text-slate-900 dark:text-zinc-100 cursor-pointer hover:underline hover:text-white dark:hover:text-white truncate"
                          >
                            {usr.fullName}
                          </h4>
                          <span className="text-sm text-slate-500 dark:text-zinc-500 block truncate">@{usr.username}</span>
                        </div>
                      </div>                          {user && user._id !== usr._id && (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            setFollowError(null);
                            try {
                              await onToggleFollow(usr._id);
                            } catch {
                              setFollowError("Follow action failed. Please try again.");
                            }
                          }}
                          className={`shrink-0 text-sm font-semibold px-4 py-2 rounded-full transition-all cursor-pointer transform hover:scale-105 active:scale-95 ${
                            !followingStates[usr._id] && requestedFollows?.[usr._id]
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                              : followingStates[usr._id]
                                ? "bg-zinc-900 text-white dark:bg-zinc-800 dark:text-white border border-zinc-300 dark:border-zinc-600 shadow-md"
                                : "bg-aurora text-white border border-white/10 shadow-aurora hover:opacity-90"
                            }`}
                        >
                          {!followingStates[usr._id] && requestedFollows?.[usr._id]
                            ? "Requested"
                            : followingStates[usr._id]
                              ? "Following"
                              : "Follow"}
                        </button>
                      )}
                    </div>
                  </GlassCard>
                ))}
              </div>
            )
          ) : postCandidates.length === 0 ? (
            q ? (                <EmptyState variant="search" title="No posts found" description="Try a different search term or hashtag." />
            ) : null
          ) : (
            <div className="space-y-5">
              {postCandidates.map((pst) => (
                <GlassCard
                  key={pst._id}
                  dataPostId={pst._id}
                  className="shadow-sm border-white/5 bg-zinc-950/20 hover:border-white/10 transition-all rounded-4xl"
                  animate={false}
                  showMacControls={false}
                >
                  {/* Author context line */}
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <UserAvatar
                        src={(pst as any).author?.profilePic?.url}
                        alt={(pst as any).author?.fullName}
                        onClick={(e) => {
                          e.stopPropagation();
                          onUserSelected((pst as any).author?.username);
                        }}
                        className="h-10 w-10 cursor-pointer rounded-full object-cover border border-zinc-800 shadow-sm"
                      />
                      <div>
                        <h4
                          onClick={(e) => {
                            e.stopPropagation();
                            onUserSelected((pst as any).author?.username);
                          }}
                          className="text-sm font-semibold text-white cursor-pointer hover:underline"
                        >
                          {(pst as any).author?.fullName}
                        </h4>
                        <p className="text-sm text-zinc-400 font-medium">@{(pst as any).author?.username}</p>
                      </div>
                    </div>
                  </div>

                  <div onClick={() => onPostSelected(pst.slug)} className="cursor-pointer space-y-3">
                    <h4 className="font-sans text-lg font-bold text-white leading-tight">{pst.title}</h4>
                    <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{pst.content}</p>
                    {pst.image && (
                      <div className="mt-3 overflow-hidden rounded-3xl border border-zinc-800">
                        <img loading="lazy" 
                          src={optimizeImageUrl(pst.image.url, 1000)}
                          alt=""
                          className="w-full h-auto max-h-125 object-cover"
                        />
                      </div>
                    )}
                    {/* Post stats like in feed */}
                    <div onClick={(e) => e.stopPropagation()} className="mt-4 flex items-center justify-between pt-3 text-sm text-zinc-400">
                      <button
                        onClick={() => handleLikeToggle(pst._id, !!(pst as any).likedByMe)}
                        className="flex items-center gap-1 font-medium cursor-pointer hover:text-red-500 transition-colors"
                      >
                        <Heart className={`h-4 w-4 ${(pst as any).likedByMe ? "fill-red-500 text-red-500" : "text-zinc-550"}`} /> {pst.likesCount || 0}
                      </button>
                      <button
                        onClick={() => onPostSelected(pst.slug)}
                        className="flex items-center gap-1 font-medium cursor-pointer hover:text-white transition-colors"
                      >
                        <MessageSquare className="h-4 w-4 text-zinc-550" /> {pst.commentsCount || 0}
                      </button>
                      <button
                        onClick={() => handleSaveToggle(pst._id, !!(pst as any).savedByMe)}
                        className="flex items-center gap-1 font-medium cursor-pointer hover:text-yellow-500 transition-colors"
                      >
                        <Bookmark className={`h-4 w-4 ${(pst as any).savedByMe ? "fill-yellow-500 text-yellow-500" : "text-zinc-550"}`} /> {pst.savesCount || 0}
                      </button>
                      <button
                        onClick={() => handleRepostToggle(pst._id, !!(pst as any).repostedByMe)}
                        className="flex items-center gap-1 font-medium cursor-pointer hover:text-green-500 transition-colors"
                      >
                        <Repeat2 className={`h-4 w-4 ${(pst as any).repostedByMe ? "text-green-500" : "text-zinc-550"}`} /> {pst.repostsCount || 0}
                      </button>
                    </div>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}

          {/* Open-web feed (Bluesky / Mastodon / Lemmy) */}
          {activeSegment === "web" && (
            <div className="space-y-4">
              {/* Header row — source filter chips + refresh */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1.5">														<Globe className="h-4 w-4 text-violet-300" />
                  <h3 className="text-label font-semibold text-zinc-300">
                    Open Web
                  </h3>
                  <span className="text-[11px] text-zinc-500">
                    live from Bluesky · Mastodon · Lemmy
                  </span>
                </div>
                <button
                  onClick={refreshExternal}
                  disabled={externalRefreshing}
                  className="flex items-center gap-1.5 rounded-full border border-zinc-800 px-3 py-1.5 text-[11px] font-semibold text-zinc-400 transition-all hover:border-white/30 hover:text-white disabled:opacity-50 cursor-pointer"
                >
                  {externalRefreshing ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  {externalRefreshing ? "Syncing…" : "Refresh"}
                </button>
              </div>

              {/* Source chips */}
              <div className="flex flex-wrap items-center gap-1.5">
                {(["all", "bluesky", "mastodon", "lemmy"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setExternalSource(s)}						className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
							externalSource === s
								? "pill-active"
								: "bg-zinc-900/60 text-zinc-400 hover:text-zinc-200 border border-zinc-800"
						}`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {externalLoading && externalPosts.length === 0 ? (
                <div className="space-y-3">
                  <Skeleton variant="card" />
                  <Skeleton variant="card" />
                  <Skeleton variant="card" />
                </div>
              ) : externalPosts.length === 0 ? (
                <EmptyState
                  variant="search"
                  title="No open-web posts yet"
                  description="Sync runs every 15 minutes — hit Refresh to pull fresh content now."
                />
              ) : (
                <div className="space-y-3">
                  {externalPosts.map((p) => (
                    <ExternalPostCard
                      key={p._id}
                      post={p}
                      user={user}
                      onHidden={(id) =>
                        setExternalPosts((prev) =>
                          prev.filter((x) => x._id !== id),
                        )
                      }
                    />
                  ))}
                  {externalNextCursor && (
                    <div
                      ref={externalSentinelRef}
                      className="flex items-center justify-center gap-2 py-6"
                      role="status"
                      aria-live="polite"
                    >
                      <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
                      <span className="text-[11px] font-semibold text-zinc-600">
                        Loading more…
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Trending feed when no search query */}
          {!q && activeSegment === "trending" && (
            <div className="space-y-6">
              {/* Trending Hashtags */}
              {trendingHashtags.length > 0 && (
                <GlassCard className="p-5 rounded-3xl border border-zinc-800/40">
                  <div className="flex items-center gap-2 mb-4">
                    <TrendingUp className="h-5 w-5 text-orange-400" />
                    <h3 className="text-label font-semibold text-zinc-300">
                      Trending Hashtags
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {trendingHashtags.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => {
                          window.dispatchEvent(
                            new CustomEvent("forceFeedRefresh")
                          );
                          window.dispatchEvent(
                            new CustomEvent("searchHashtag", {
                              detail: { hashtag: tag },
                            })
                          );
                        }}
                        className="flex items-center gap-1.5 rounded-full bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-700/40 px-3.5 py-1.5 text-xs font-semibold text-zinc-300 transition-all cursor-pointer"
                      >
                        <Hash className="h-3 w-3 text-orange-400" />
                        {tag}
                        {typeof trendingCounts[tag] === "number" && (
                          <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-orange-300/90">
                            {trendingCounts[tag]}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </GlassCard>
              )}

              {/* Daily missions — the daily-retention checklist (XP/levels
                  still feed the closed economy; the panel itself was moved
                  here per owner decision). */}
              <MissionsPanel />

              {/* Leaderboard */}
              <Leaderboard onUserSelected={onUserSelected} onPostSelected={onPostSelected} />

              {/* Trending Posts */}
              <div>
                <h3 className="text-label font-semibold text-zinc-300 mb-4 px-1 flex items-center gap-2">
                  <Flame className="h-4 w-4 text-orange-400" /> Popular Posts
                </h3>
                {loading ? (
                  <div className="space-y-3">
                    <Skeleton variant="card" />
                    <Skeleton variant="card" />
                    <Skeleton variant="card" />
                  </div>
                ) : trendingPosts.length > 0 ? (
                  <div className="space-y-4">
                                        {trendingPosts.map((pst, idx) => (
                      <GlassCard
                        key={pst._id}
                        dataPostId={pst._id}
                        onClick={() => onPostSelected(pst.slug)}
                        whileHover={{ y: -3 }}
                        className="p-4 rounded-3xl border border-zinc-800/30 hover:border-zinc-700/50 transition-all"
                      >
                        <div className="flex items-start gap-4">
                          <span className="text-lg font-black text-zinc-500 shrink-0 mt-1 w-6 text-center">
                            {idx + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <UserAvatar
                                src={(pst as any).author?.profilePic?.url}
                                alt={(pst as any).author?.fullName}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onUserSelected((pst as any).author?.username);
                                }}
                                className="h-6 w-6 rounded-full object-cover border border-zinc-800 cursor-pointer shrink-0"
                              />
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onUserSelected((pst as any).author?.username);
                                }}
                                className="text-xs font-bold text-zinc-400 cursor-pointer hover:text-white truncate"
                              >
                                @{(pst as any).author?.username}
                              </span>
                              {pst.viewsCount > 0 && (
                                <span className="ml-auto flex items-center gap-1 text-[11px] text-zinc-600">
                                  <Eye className="h-3 w-3" aria-hidden="true" />
                                  {pst.viewsCount}
                                </span>
                              )}
                            </div>
                            <h4 className="text-sm font-bold text-white hover:underline leading-snug cursor-pointer">
                              {pst.title}
                            </h4>
                            <p className="text-xs text-zinc-500 mt-1 line-clamp-2 cursor-pointer">
                              {pst.content}
                            </p>
                            {/* Like / Comment / Repost / Save — full interaction row */}
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-4 mt-2.5 text-xs text-zinc-500"
                            >
                              <button
                                onClick={() =>
                                  handleLikeToggle(pst._id, !!(pst as any).likedByMe)
                                }
                                className="flex items-center gap-1 font-medium transition-colors cursor-pointer hover:text-red-500"
                                aria-label="Like post"
                              >
                                <Heart
                                  className={`h-3.5 w-3.5 ${(pst as any).likedByMe ? "fill-red-500 text-red-500" : ""}`}
                                />
                                {pst.likesCount || 0}
                              </button>
                              <button
                                onClick={() => onPostSelected(pst.slug)}
                                className="flex items-center gap-1 font-medium transition-colors cursor-pointer hover:text-white"
                                aria-label="Comment"
                              >
                                <MessageSquare className="h-3.5 w-3.5" />
                                {pst.commentsCount || 0}
                              </button>
                              <button
                                onClick={() =>
                                  handleRepostToggle(pst._id, !!(pst as any).repostedByMe)
                                }
                                className="flex items-center gap-1 font-medium transition-colors cursor-pointer hover:text-green-500"
                                aria-label="Repost"
                              >
                                <Repeat2
                                  className={`h-3.5 w-3.5 ${(pst as any).repostedByMe ? "text-green-500" : ""}`}
                                />
                                {pst.repostsCount || 0}
                              </button>
                              <button
                                onClick={() =>
                                  handleSaveToggle(pst._id, !!(pst as any).savedByMe)
                                }
                                className="flex items-center gap-1 font-medium transition-colors cursor-pointer hover:text-yellow-500"
                                aria-label="Save post"
                              >
                                <Bookmark
                                  className={`h-3.5 w-3.5 ${(pst as any).savedByMe ? "fill-yellow-500 text-yellow-500" : ""}`}
                                />
                                {pst.savesCount || 0}
                              </button>
                            </div>
                          </div>
                          {pst.image && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onPostSelected(pst.slug);
                              }}
                              className="w-14 h-14 shrink-0 rounded-xl overflow-hidden border border-zinc-800 cursor-pointer group p-0"
                              aria-label="View post"
                            >
                              <img
                                src={optimizeImageUrl(pst.image.url, 112)}
                                alt=""
                                className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-110"
                              />
                            </button>
                          )}
                        </div>
                      </GlassCard>
                    ))}

                  </div>
                ) : (
                  <GlassCard className="py-10 text-center rounded-3xl border border-zinc-800/30">
                    <p className="text-sm text-zinc-500">
                      No trending content right now
                    </p>
                  </GlassCard>
                )}
              </div>
            </div>
          )}

          {/* Prompt card on empty search input (users/posts tabs) — hidden
              while the feed/results are still loading. */}
          {!q && !loading && activeSegment !== "trending" && (
            <GlassCard className="py-14 px-6 text-center flex flex-col items-center rounded-3xl border border-zinc-800/30 bg-zinc-950/40">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-900 border border-zinc-700 mb-4 shadow-lg">
                <Compass className="h-8 w-8 text-white" />
              </div>
              <h4 className="text-sm font-bold text-white">Start Exploring</h4>
              <p className="mx-auto mt-2 max-w-xs text-sm text-zinc-500 leading-relaxed">
                Search for users to connect with, or posts to discover.
              </p>
            </GlassCard>
          )}
        </div>
      </div>


    </div>
  );
}
