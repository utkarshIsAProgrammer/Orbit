import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Plus, Loader2, Lock } from "lucide-react";
import type { Glance, User } from "../types";
import { apiFetch } from "../utils/api";
import { evictCachedResponse, getCachedResponse } from "../utils/apiCache";
import { getOfflineFallback } from "../utils/dexieBridge";
import { useCacheRefresh } from "../hooks/useCacheRefresh";
import { useReveal } from "../hooks/useReveal";
import { logger } from "../utils/logger";
import { optimizeImageUrl } from "../utils/imageUrls";
import GlanceViewer from "./GlanceViewer";
import GlanceEditor from "./GlanceEditor";

interface GlancesFeedProps {
  user: User | null;
  /** When set, this feed shows ONE user's story rings for their profile
   *  page (fetches /api/glimpses/user/:id instead of the global feed).
   *  Omit it to keep the home-feed behavior. */
  profileUserId?: string;
}

export default function GlancesFeed({ user, profileUserId }: GlancesFeedProps) {
  // Profile mode = this strip is pinned to a specific user's profile.
  const isProfileMode = !!profileUserId;
  const isOwnProfile = isProfileMode && profileUserId === user?._id;
  // The "Add a glance" button + its divider only appear on the home feed or
  // on your OWN profile — never on someone else's profile.
  const canAdd = !isProfileMode || !!isOwnProfile;
  const endpoint = isProfileMode
    ? `/api/glimpses/user/${profileUserId}`
    : "/api/glimpses/feed";
  const [glances, setGlances] = useState<Glance[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [editFile, setEditFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Drag-to-scroll for mouse users — the strip scrolls horizontally with a
  // hidden scrollbar, so a plain mouse wheel can't move it. Touch swipes
  // work natively via overflow-x-auto.
  const dragState = useRef({
    down: false,
    startX: 0,
    startScroll: 0,
    moved: false,
    captured: false,
  });

  const onStripPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const el = scrollRef.current;
    if (!el) return;
    dragState.current = {
      down: true,
      startX: e.clientX,
      startScroll: el.scrollLeft,
      moved: false,
      captured: false,
    };
    // scroll-smooth would animate every scrollLeft write and make dragging
    // lag — switch to instant while the user is dragging.
    el.style.scrollBehavior = "auto";
    // NOTE: no setPointerCapture here. Capturing on pointerdown retargets
    // the pointerup to the strip, so the browser fires the click on the
    // strip instead of the glance button — which made glances unclickable.
    // Capture only engages once an actual drag begins (see move handler),
    // so a plain click keeps its natural click target.
  };

  const onStripPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragState.current;
    const el = scrollRef.current;
    if (!s.down || e.pointerType !== "mouse" || !el) return;
    const dx = e.clientX - s.startX;
    if (Math.abs(dx) > 3) {
      s.moved = true;
      // A real drag started — now (and only now) capture the pointer so the
      // drag keeps working even if the cursor leaves the strip. A plain
      // click never reaches this point, so button clicks stay clickable.
      if (!s.captured) {
        s.captured = true;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // Pointer may already be released — the drag still works while
          // the cursor stays over the strip.
        }
      }
    }
    el.scrollLeft = s.startScroll - dx;
  };

  const onStripPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const s = dragState.current;
    if (!s.down) return;
    dragState.current.down = false;
    const el = scrollRef.current;
    if (el) el.style.scrollBehavior = "";
    if (s.moved) {
      // A drag just happened — swallow the click that follows so a glance
      // doesn't open when the user only meant to scroll past it.
      const swallow = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        document.removeEventListener("click", swallow, true);
      };
      document.addEventListener("click", swallow, true);
    }
  };

  const onStripPointerCancel = () => {
    dragState.current.down = false;
    const el = scrollRef.current;
    if (el) el.style.scrollBehavior = "";
  };
  // Keep latest user in a ref so the socket listeners (registered once) can
  // check authorship/close-friendship without stale closures.
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);
  // Keep the latest endpoint in a ref too — async callbacks (socket events,
  // cache refreshes, uploads) must always target the CURRENT profile.
  const endpointRef = useRef(endpoint);
  useEffect(() => {
    endpointRef.current = endpoint;
  }, [endpoint]);

  // Fetch glances feed. `bypass` forces a network fetch (skips the cache-first
  // path) — used right after creating a glance so the author's own new glance
  // is never wiped out by a stale cached feed that predates it.
  const fetchGlances = async (bypass: boolean = false) => {
    try {
      const url = endpointRef.current;
      const res = await apiFetch(
        url,
        bypass ? { bypassCache: true } : undefined
      );
      const data = await res.json();
      if (res.ok && data.success) {
        setGlances(data.glimpses || []);
      }
    } catch (err) {
      logger.error("Failed to load glances", err);
    } finally {
      setLoading(false);
    }
  };

  // When the background cache timer refreshes the glances endpoint, re-fetch
  // so the rings stay up-to-date without the user lifting a finger.
  useCacheRefresh(endpoint, () => fetchGlances(true));
  // Scroll-reveal for the glance strip (landing-page style).
  const stripRevealRef = useReveal<HTMLDivElement>();

  // Blocked users must vanish from the glance strip immediately — when a
  // block/unblock is announced in realtime (App.tsx wipes caches and fires
  // this event), re-fetch the feed so mounted rings update without a reload.
  useEffect(() => {
    const handleGlancesRefresh = () => fetchGlances(true);
    window.addEventListener("glimpsesRefresh", handleGlancesRefresh);
    return () =>
      window.removeEventListener("glimpsesRefresh", handleGlancesRefresh);
  }, []);

  // On mount (or when the target profile changes), show cached glances
  // instantly (stale-while-revalidate) — this makes repeat visits feel
  // instant. `fetchGlances(true)` then refreshes from the network in the
  // background so fresh data (new glances, expirations) lands without a
  // visible loading state. Cancelled-safe so a slow response for profile A
  // can never overwrite profile B after a quick navigation.
  useEffect(() => {
    let cancelled = false;
    const url = endpointRef.current;
    // Profile navigation (or first mount): never show the PREVIOUS profile's
    // rings on the new profile — reset immediately so the strip stays
    // pristine while the new data loads.
    setGlances([]);
    setLoading(true);
    (async () => {
      try {
        let cached = await getCachedResponse<{
          glimpses: Glance[];
          success: boolean;
        }>(url);
        if (!cached?.glimpses?.length) {
          // CacheStorage missed → try the Dexie structured layer (survives
          // browser cache eviction) so the rings still paint offline.
          cached = (await getOfflineFallback(url)) as {
            glimpses: Glance[];
            success: boolean;
          } | null;
        }
        if (
          !cancelled &&
          cached?.success &&
          cached.glimpses?.length
        ) {
          setGlances(cached.glimpses);
          setLoading(false);
        }
      } catch {
        // Cache read failures are non-critical
      }
    })();
    fetchGlances(true);
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  // Listen for real-time glance events (created/viewed/expired).
  // Profile mode: global feed events must NOT pollute someone else's strip.
  useEffect(() => {
    if (isProfileMode) {
      return;
    }

    const handleGlanceCreated = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const uid = userRef.current?._id;
      // Defensive privacy check: never surface a close-friends glimpse we
      // aren't allowed to see, even if a socket payload slips through.
      if (detail?.visibility === "closeFriends") {
        const authorId = detail.author?._id?.toString();
        const isAuthor = !!uid && authorId === uid.toString();
        const isCloseFriend =
          !!uid &&
          Array.isArray(detail.author?.closeFriends) &&
          (detail.author.closeFriends as any[]).some(
            (id: any) => id?.toString() === uid.toString()
          );
        if (!isAuthor && !isCloseFriend) return;
      }
      setGlances((prev) => {
        if (prev.some((g) => g._id === detail._id)) return prev;
        return [detail, ...prev];
      });
    };

    const handleGlanceViewed = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setGlances((prev) =>
        prev.map((g) => {
          if (g._id !== detail.glimpseId) return g;
          // The socket payload is now lightweight (viewerCount only, targeted
          // at the author) — keep accepting the old shape if it ever arrives.
          return {
            ...g,
            ...(Array.isArray(detail.viewers) ? { viewers: detail.viewers } : {}),
            ...(typeof detail.viewerCount === "number"
              ? { viewerCount: detail.viewerCount }
              : {}),
            viewedByMe: detail.viewedByMe ?? g.viewedByMe,
          };
        })
      );
    };

    const handleGlanceExpired = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setGlances((prev) => prev.filter((g) => g._id !== detail.glimpseId));
    };

    window.addEventListener("glimpse:created", handleGlanceCreated);
    window.addEventListener("glimpse:viewed", handleGlanceViewed);
    window.addEventListener("glimpse:expired", handleGlanceExpired);

    return () => {
      window.removeEventListener("glimpse:created", handleGlanceCreated);
      window.removeEventListener("glimpse:viewed", handleGlanceViewed);
      window.removeEventListener("glimpse:expired", handleGlanceExpired);
    };
  }, [isProfileMode]);

  // Upload a glance media blob/file to the server
  const uploadGlanceMedia = async (
    media: Blob,
    filename: string,
    visibility: "public" | "closeFriends" = "public",
  ) => {
    setIsCreating(true);
    const formData = new FormData();
    formData.append("media", media, filename);
    formData.append("visibility", visibility);

    try {
      const res = await apiFetch("/api/glimpses", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setGlances((prev) => {
          if (prev.some((g) => g._id === data.glimpse._id)) return prev;
          return [data.glimpse, ...prev];
        });
        // Evict the feed + current-profile caches then force a network
        // refetch. The eviction in apiFetch runs fire-and-forget, so a plain
        // fetchGlances() could read the still-stale cache and REMOVE the
        // glance the author just created.
        await evictCachedResponse("/api/glimpses/feed").catch(() => {});
        await evictCachedResponse(endpointRef.current).catch(() => {});
        await fetchGlances(true);
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: {
              message:
                visibility === "closeFriends"
                  ? "Glance shared with close friends only"
                  : "Glance published to everyone",
              type: "success",
            },
          })
        );
      } else {
        throw new Error(data.message || "Failed to create glance");
      }
    } catch (err) {
      logger.error("Failed to create glance", err);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Failed to create glance. Media may be too large or unsupported.", type: "error" },
        })
      );
    } finally {
      setIsCreating(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Handle creating a new glance
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];

    // Validate video duration (max 1 minute)
    if (file.type.startsWith("video/")) {
      const video = document.createElement("video");
      video.preload = "metadata";
      const url = URL.createObjectURL(file);
      video.src = url;
      await new Promise((resolve) => {
        video.onloadedmetadata = resolve;
        video.onerror = resolve; // Handle corrupt files gracefully
      });
      URL.revokeObjectURL(url);
      if (video.duration > 60) {
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: { message: "Video must be 1 minute or less.", type: "error" },
          })
        );
        return;
      }

      // Server caps glance uploads at 30MB — reject oversized videos up front
      if (file.size > 30 * 1024 * 1024) {
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: { message: "Video must be under 30MB.", type: "error" },
          })
        );
        return;
      }
    }	// Both images and videos go through the pre-publish editor — images are
	// auto-framed to 9:16, and the author picks the audience (public or close
	// friends) there before publishing.
	if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
		setEditFile(file);
		if (fileInputRef.current) fileInputRef.current.value = "";
		return;
	}
  };

  // Open viewer for a specific glance
  const handleOpenViewer = (index: number) => {
    setViewerIndex(index);
    setViewerOpen(true);
  };

  // Mark a glance as viewed locally (optimistic update)
  const handleLocalView = (glanceId: string) => {
    setGlances((prev) =>
      prev.map((g) => {
        if (g._id !== glanceId) return g;
        return { ...g, viewedByMe: true };
      })
    );
  };

  // Handle delete glance (author only)
  const handleDeleteGlance = async (glanceId: string) => {
    try {
      await apiFetch(`/api/glimpses/${glanceId}`, {
        method: "DELETE",
      });
      setGlances((prev) => prev.filter((g) => g._id !== glanceId));
    } catch (err) {
      logger.error("Failed to delete glance", err);
    }
  };

  // Extract a stable author id string whether the server serialized the
  // author as a populated object or a bare string id.
  const authorKey = (author: typeof glances[0]["author"] | undefined): string => {
    if (typeof author === "object" && author) {
      return String((author as any)._id || (author as any).id || "");
    }
    return String(author || "");
  };

  // Group glances by author — each author gets one ring.
  const authorsMap = new Map<string, { user: typeof glances[0]["author"]; glimpses: Glance[] }>();
  glances.forEach((g) => {
    const authorStr = authorKey(g.author);
    if (!authorStr) return;
    if (!authorsMap.has(authorStr)) {
      authorsMap.set(authorStr, { user: g.author, glimpses: [] });
    }
    authorsMap.get(authorStr)!.glimpses.push(g);
  });
  const authorGlances = Array.from(authorsMap.values());

  // Your own ring is merged INTO the add button (Instagram-style "your
  // story"): when you have a glance, the button shows your story ring and
  // opens the viewer; the + add affordance only exists when you have NO
  // active glance. So the author-rings list skips your own group.
  const ownAuthorId = canAdd && user ? user._id?.toString() : undefined;
  const ownGroup = ownAuthorId
    ? authorGlances.find((a) => authorKey(a.user) === ownAuthorId)
    : undefined;
  const ownGlancesList = ownGroup?.glimpses || [];
  const hasOwnGlance = ownGlancesList.length > 0;
  const ownHasCloseFriends = ownGlancesList.some(
    (g) => g.visibility === "closeFriends"
  );
  const otherAuthorGlances = ownAuthorId
    ? authorGlances.filter((a) => authorKey(a.user) !== ownAuthorId)
    : authorGlances;

  // Only show if there are glances or user can create one
  const hasGlances = glances.length > 0;

  // Someone else's profile with zero glimpses → nothing to render at all
  // (no empty strip, no stray divider).
  if (!hasGlances && !loading && !canAdd) return null;

  if (!hasGlances && loading) {
    return (
      <div className="flex items-center gap-3 py-3 overflow-x-auto scrollbar-none">
        {[1, 2, 3].map((n) => (
          <div key={n} className="flex flex-col items-center gap-1 shrink-0">			<div className="h-[66px] w-[66px] rounded-[24px] bg-zinc-900 animate-pulse ring-1 ring-zinc-800 sm:h-20 sm:w-20 sm:rounded-[34px]" />
            <div className="h-2 w-10 bg-zinc-900 animate-pulse rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div ref={stripRevealRef} className="relative w-full">
        <div
          ref={scrollRef}
          data-reveal
          onPointerDown={onStripPointerDown}
          onPointerMove={onStripPointerMove}
          onPointerUp={onStripPointerUp}
          onPointerCancel={onStripPointerCancel}
          className="flex items-center gap-3 px-1 py-2.5 overflow-x-auto scrollbar-none scroll-smooth sm:py-3 cursor-grab active:cursor-grabbing select-none touch-pan-x"
        >
          {/* Your story ring — Instagram-style. The container doubles as your own
              glance: when you have an active glance it shows your story ring
              and tapping it opens your glance. The + add affordance only
              exists when you have NO glance yet. */}
          {user && canAdd && (
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className="relative">
                <button
                  onClick={() => {
                    if (hasOwnGlance) {
                      // Open YOUR own glance (first unviewed, else first).
                      const firstUnviewed = ownGlancesList.find(
                        (g) => !g.viewedByMe
                      );
                      const targetG = firstUnviewed || ownGlancesList[0];
                      const idx = glances.findIndex(
                        (g) => g._id === targetG?._id
                      );
                      if (idx >= 0) handleOpenViewer(idx);
                    } else {
                      fileInputRef.current?.click();
                    }
                  }}
                  disabled={isCreating}
                  className={`relative h-[66px] w-[66px] rounded-[24px] p-[2.5px] transition-all cursor-pointer active:scale-95 disabled:opacity-60 sm:h-20 sm:w-20 sm:rounded-[34px] ${
                    hasOwnGlance
                      ? ownHasCloseFriends
                        ? "bg-gradient-to-br from-emerald-400 via-green-400 to-teal-400"
                        : "bg-gradient-to-br from-white via-zinc-200 to-zinc-400 shadow-[0_0_14px_-2px_rgba(255,255,255,0.35)]"
                      : "bg-zinc-800 hover:bg-zinc-700"
                  }`}
                  title={hasOwnGlance ? "Watch your glance" : "Add a glance"}
                >
                  {/* Your own profile picture fills the ring — like
                      Instagram's "your story". */}
                  {user.profilePic?.url ? (
                    <img
                      src={optimizeImageUrl(user.profilePic.url, 128)}
                      alt={user.fullName}
                      className="h-full w-full rounded-[22px] object-cover border-2 border-zinc-950 sm:rounded-[34px]"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center rounded-[22px] border-2 border-zinc-950 bg-zinc-900/70 sm:rounded-[34px]">
                      <Plus className="h-5 w-5 text-zinc-400" />
                    </div>
                  )}
                  {/* + badge pinned to the corner — only when there is NO
                      active glance yet (the add affordance). */}
                  {!isCreating && !hasOwnGlance && user.profilePic?.url && (
                    <span className="absolute bottom-0 right-0 flex h-5 w-5 items-center justify-center rounded-full border-2 border-zinc-950 bg-white text-zinc-950 sm:h-5 sm:w-5">
                      <Plus className="h-3 w-3 sm:h-3 sm:w-3" strokeWidth={3} />
                    </span>
                  )}
                  {/* Uploading spinner overlay */}
                  {isCreating && (
                    <span className="absolute inset-0 z-10 flex items-center justify-center rounded-[22px] bg-black/60 sm:rounded-[34px]">
                      <Loader2 className="h-5 w-5 animate-spin text-white sm:h-7 sm:w-7" />
                    </span>
                  )}
                </button>
              </div>
              <span className="text-[10px] font-bold text-zinc-500">
                {hasOwnGlance
                  ? user.fullName.split(" ")[0]
                  : "Add"}
              </span>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Only show the rings section when there are OTHER authors to show
              (your own ring lives inside the add button now). */}
          {hasGlances && otherAuthorGlances.length > 0 && (
            <>
              {/* Divider line (only when the Add button is present) */}
              {canAdd && (
                <div className="h-14 w-px bg-zinc-800 shrink-0 sm:h-16" />
              )}

              {/* Author rings */}
              <AnimatePresence mode="popLayout">
                {otherAuthorGlances.map(({ user: author, glimpses: authorG }) => {
                  // Own ring is merged into the add button, so every ring
                  // rendered here belongs to someone else.
                  const allViewed = authorG.every((g) => g.viewedByMe);
                  const hasUnviewed = authorG.some((g) => !g.viewedByMe);
                  // Any glance in this ring is close-friends-only — drives both
                  // the green ring and the lock badge.
                  const hasCloseFriendsGlance = authorG.some(
                    (g) => g.visibility === "closeFriends"
                  );

                  return (
                    <motion.button
                      key={author._id}
                      layout
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                      onClick={() => {
                        // Open the first unviewed glance, or the first one
                        const firstUnviewed = authorG.find((g) => !g.viewedByMe);
                        const targetG = firstUnviewed || authorG[0];
                        const idx = glances.findIndex(
                          (g) => g._id === targetG._id
                        );
                        if (idx >= 0) handleOpenViewer(idx);
                      }}
                      className="flex flex-col items-center gap-1 shrink-0 group cursor-pointer"
                    >						<div					className={`relative h-[66px] w-[66px] rounded-[24px] p-[3px] transition-all sm:h-20 sm:w-20 sm:rounded-[34px] ${
                          hasCloseFriendsGlance
                            // Close-friends glances ALWAYS get the green ring —
                            // including your own ring — so a private glance
                            // reads as private no matter who owns it.
                            ? "bg-gradient-to-br from-emerald-400 via-green-400 to-teal-400"
                            : allViewed
                                // Watched glances go back to the normal
                                // neutral ring (same as the Add button).
                                ? "bg-zinc-800"
                                : hasUnviewed
                                  // Silver glow = "has something new" for
                                  // unseen glances.
                                  ? "bg-gradient-to-br from-white via-zinc-200 to-zinc-400 shadow-[0_0_14px_-2px_rgba(255,255,255,0.35)]"
                                  : "bg-zinc-800"
                        }`}
                      >						<div className="relative h-full w-full rounded-[22px] overflow-hidden bg-zinc-900 sm:rounded-[34px]">
                        {author.profilePic?.url ? (
                        <img
                          src={optimizeImageUrl(author.profilePic.url, 128)}
                          alt={author.fullName}
                          className="relative h-full w-full object-cover"
                        />
                        ) : (
                          <div className="relative h-full w-full flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
                            <span className="text-base sm:text-2xl font-bold text-zinc-400 select-none">
                              {author.fullName?.charAt(0)?.toUpperCase() || "?"}
                            </span>
                          </div>
                        )}
                        {hasCloseFriendsGlance && (							<span className="absolute right-0.5 bottom-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-950/70 backdrop-blur-sm border border-emerald-500/40 shadow-md">
                            <Lock className="h-3 w-3 text-emerald-400/90" />
                          </span>
                        )}
                        </div>
                      </div>
                      <span														className={`text-[10px] font-bold truncate max-w-24 text-center ${
                          allViewed ? "text-zinc-500" : "text-zinc-300"
                        }`}
                      style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                      >
                        {author.fullName.split(" ")[0]}
                      </span>
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            </>
          )}

          {/* Empty state when no glances */}
          {!hasGlances && !loading && null}
        </div>
      </div>

      {/* Full-screen glance viewer */}
      {viewerOpen && glances.length > 0 && (
        <GlanceViewer
          glimpses={glances}
          initialIndex={viewerIndex}
          onIndexChange={(idx) => setViewerIndex(idx)}
          onClose={() => {
            setViewerOpen(false);
          }}
          onView={handleLocalView}
          currentUser={user}
          onDeleteGlance={handleDeleteGlance}
        />
      )}

      {/* Pre-publish glance editor */}
      {editFile && (
        <GlanceEditor
          file={editFile}
          onClose={() => setEditFile(null)}			onApply={(blob, visibility) => {
				setEditFile(null);
				const filename = editFile.type.startsWith("video/")
					? "glance.mp4"
					: "glance.jpg";
				void uploadGlanceMedia(blob, filename, visibility);
			}}
        />
      )}
    </>
  );
}
