import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  Eye,
  Heart,
  MessageSquare,
  Loader2,
  Trash2,
  MoreHorizontal,
  Send,
  Share2,
  Search,
  Link2,
} from "lucide-react";
import type { Glance, User, Conversation } from "../types";
import { apiFetch } from "../utils/api";
import { logger } from "../utils/logger";
import { optimizeImageUrl } from "../utils/imageUrls";

interface GlanceViewerProps {
  glimpses: Glance[];
  initialIndex: number;
  onClose: () => void;
  onView: (glanceId: string) => void;
  onIndexChange?: (index: number) => void;
  onDeleteGlance?: (glanceId: string) => void;
  currentUser?: User | null;
}

export default function GlanceViewer({
  glimpses,
  initialIndex,
  onClose,
  onView,
  onIndexChange,
  onDeleteGlance,
  currentUser,
}: GlanceViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [progress, setProgress] = useState(0);
  const [showViewersList, setShowViewersList] = useState(false);
  const viewedIdsRef = useRef<Set<string>>(new Set());
  const [isPaused, setIsPaused] = useState(false);
  const progressRef = useRef(0);

  // Hoisted to the top so every effect below (frame measurement, media sync,
  // progress) can reference it without a Temporal Dead Zone error.
  const currentGlance = glimpses[currentIndex];

  // ── Instagram-style features ──
  const [slideDirection, setSlideDirection] = useState<"left" | "right">(
    "right",
  );
  // Initialize reactedByMe from the initial glance's reaction data (avoids flash on mount)
  const [reactedByMe, setReactedByMe] = useState(() => {
    const g = glimpses[initialIndex];
    const uid = currentUser?._id;
    return (
      g?.reactions?.some((r) => {
        const rUserId = typeof r.user === "object" ? r.user._id : r.user;
        return rUserId && uid && rUserId.toString() === uid.toString();
      }) ?? false
    );
  });
  const [showHeartAnimation, setShowHeartAnimation] = useState(false);
  const [isReacting, setIsReacting] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showReplyInput, setShowReplyInput] = useState(false);
  const [replyText, setReplyText] = useState("");

  // ── Share-to-chat modal (people picker, mirroring the chat forward UX) ──
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareConversations, setShareConversations] = useState<Conversation[]>(
    [],
  );
  const [selectedShareConvIds, setSelectedShareConvIds] = useState<string[]>(
    [],
  );
  const [shareSearch, setShareSearch] = useState("");
  const [isSharing, setIsSharing] = useState(false);

  // ── Smart media fit: fill the 9:16 frame exactly when the content matches;
  // center it (no crop) when the content is smaller than the story canvas. ──
  const [mediaFit, setMediaFit] = useState<"cover" | "contain">("cover");

  // ── Broken-media guard ──
  // Glances created by an older editor build can be degenerate 1×2-pixel
  // images (or the CDN URL can fail). A broken image that still LOADS (tiny
  // dimensions) doesn't fire onError, so we also check naturalWidth on load.
  // When the media is unusable we show a graceful fallback instead of the
  // confusing black frame.
  const [mediaUnavailable, setMediaUnavailable] = useState(false);

  // ── Media load resilience ──
  // A freshly uploaded Cloudinary image can transiently 404 on the very
  // first request (CDN propagation). Instead of showing a black frame until
  // the user reloads, show a loading state and auto-retry a few times with
  // a cache-busting query param before giving up.
  const [mediaLoading, setMediaLoading] = useState(true);
  const [mediaSrcKey, setMediaSrcKey] = useState(0);
  const mediaErrorCountRef = useRef(0);

  const resetMediaLoadState = () => {
    setMediaLoading(true);
    setMediaUnavailable(false);
    mediaErrorCountRef.current = 0;
  };

  const handleMediaError = () => {
    mediaErrorCountRef.current += 1;
    if (mediaErrorCountRef.current <= 3) {
      // Transient failure — retry with a cache-busting query param
      setMediaLoading(true);
      setMediaSrcKey((k) => k + 1);
    } else {
      setMediaUnavailable(true);
      setMediaLoading(false);
    }
  };

  const computeMediaFit = (w: number, h: number) => {
    if (!w || !h) return;
    const mediaAspect = w / h;
    const frameAspect = 9 / 16; // story frame
    const ratioMatches =
      Math.abs(mediaAspect - frameAspect) / frameAspect < 0.04;
    const tooSmallToFill = w < 1080 && h < 1920; // less than a story canvas
    setMediaFit(ratioMatches || !tooSmallToFill ? "cover" : "contain");
  };

  const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setMediaLoading(false);
    // Degenerate decode (1×2) or missing → treat as unavailable
    if (img.naturalWidth < 50 || img.naturalHeight < 50) {
      setMediaUnavailable(true);
      return;
    }
    computeMediaFit(img.naturalWidth, img.naturalHeight);
  };

  const handleVideoMeta = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    setMediaLoading(false);
    if (v.videoWidth < 50 || v.videoHeight < 50) {
      setMediaUnavailable(true);
      return;
    }
    computeMediaFit(v.videoWidth, v.videoHeight);
  };
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressingRef = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const replyInputRef = useRef<HTMLInputElement>(null);

  // ── Story-frame sizing ──
  // The frame must never collapse to 0×0. A percentage height (`height: 100%`)
  // fails here because its flex parent's height is content-driven (the column
  // only had `max-h-[90vh]`, which is NOT a definite height), so the media
  // rendered at zero size — a black screen behind the Like/Reply buttons.
  // We measure the available area in pixels and apply an explicit height.
  const frameAreaRef = useRef<HTMLDivElement>(null);
  const [frameHeight, setFrameHeight] = useState(0);

  const measureFrameArea = useCallback(() => {
    const el = frameAreaRef.current;
    if (!el) return;
    // Subtract the area's vertical padding (py-3 = 12px top + 12px bottom)
    setFrameHeight(Math.max(0, el.clientHeight - 24));
  }, []);

  useEffect(() => {
    measureFrameArea();
    const ro = new ResizeObserver(measureFrameArea);
    if (frameAreaRef.current) ro.observe(frameAreaRef.current);
    window.addEventListener("resize", measureFrameArea);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measureFrameArea);
    };
  }, [
    measureFrameArea,
    currentGlance?._id,
    showViewersList,
    showReplyInput,
    showShareModal,
  ]);

  // ── Local reactions (optimistically update for real-time heart in viewers list) ──
  const [localReactions, setLocalReactions] = useState<
    Required<Glance>["reactions"]
  >([]);

  // ── Lazy glimpse detail (populated viewers) ──
  // The feed deliberately ships raw viewer ids (fast); the full "Viewed by"
  // names are fetched lazily here via GET /api/glimpses/:id and merged in.
  const [glimpseDetail, setGlimpseDetail] = useState<Glance | null>(null);
  useEffect(() => {
    if (!currentGlance) return;
    let cancelled = false;
    // Reset immediately so the previous glimpse's viewers are never shown
    // for the new glimpse while its detail loads.
    setGlimpseDetail(null);
    (async () => {
      try {
        const res = await apiFetch(`/api/glimpses/${currentGlance._id}`, {
          bypassCache: true,
        });
        const data = await res.json();
        if (!cancelled && res.ok && data.success && data.glimpse) {
          setGlimpseDetail(data.glimpse);
        }
      } catch {
        // Non-critical — fall back to feed data
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentGlance?._id]);

  // Preload the NEXT glance's media the moment the current one renders, so a
  // tap-to-advance (or auto-advance) never shows a loading frame on a slow
  // network — the browser already has the bytes. Images use a hidden Image;
  // videos warm their metadata (enough to start playback without a stall).
  useEffect(() => {
    const next = glimpses[currentIndex + 1];
    if (!next?.media?.url) return;
    if (next.mediaType === "video") {
      const vid = document.createElement("video");
      vid.preload = "metadata";
      vid.muted = true;
      vid.playsInline = true;
      vid.src = next.media.url;
    } else {
      const img = new window.Image();
      img.src = next.media.url;
    }
  }, [currentIndex, glimpses]);

  // Prefer populated viewers from the detail fetch; fall back to raw ids.
  const populatedViewers = glimpseDetail?.viewers?.length
    ? glimpseDetail.viewers
    : currentGlance?.viewers || [];

  const getAuthorId = () => {
    if (!currentGlance || !currentGlance.author) return null;
    if (typeof currentGlance.author === "string") return currentGlance.author;
    if (typeof currentGlance.author === "object") {
      return currentGlance.author._id || (currentGlance.author as any).id;
    }
    return null;
  };

  const getCurrentUserId = () => {
    if (!currentUser) return null;
    return currentUser._id || (currentUser as any).id;
  };

  const authorId = getAuthorId();
  const currentUserId = getCurrentUserId();

  const isAuthor = !!(
    authorId &&
    currentUserId &&
    authorId.toString() === currentUserId.toString()
  );

  // Duration each glance is shown (ms) — videos handle their own timing
  const DURATION = currentGlance?.mediaType === "video" ? 999999 : 5000;

  // Sync localReactions when currentGlance changes
  useEffect(() => {
    setMediaFit("cover");
    resetMediaLoadState();
    setMediaSrcKey(0);
    setLocalReactions(currentGlance?.reactions || []);
    setReactedByMe(
      currentGlance?.reactions?.some((r) => {
        const rUserId = typeof r.user === "object" ? r.user._id : r.user;
        return (
          rUserId &&
          currentUserId &&
          rUserId.toString() === currentUserId.toString()
        );
      }) ?? false,
    );
  }, [currentGlance?._id]);

  // ── Video ref ──
  const videoRef = useRef<HTMLVideoElement>(null);

  // Sync current index back to parent feed component
  useEffect(() => {
    if (onIndexChange) {
      onIndexChange(currentIndex);
    }
  }, [currentIndex, onIndexChange]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Mark glance as viewed on the server
  const markViewed = useCallback(
    async (glanceId: string) => {
      if (viewedIdsRef.current.has(glanceId)) return;
      viewedIdsRef.current.add(glanceId);
      onView(glanceId);

      try {
        await apiFetch(`/api/glimpses/${glanceId}/view`, {
          method: "POST",
        });
      } catch (err) {
        logger.error("Failed to mark glance as viewed", err);
      }
    },
    [onView],
  );

  // Handle close
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // Mark as viewed immediately when shown to a non-author
  useEffect(() => {
    if (currentGlance && !isAuthor && !currentGlance.viewedByMe) {
      markViewed(currentGlance._id);
    }
  }, [currentGlance?._id, currentGlance?.viewedByMe, isAuthor, markViewed]);

  // Auto-advance progress (for images) — videos are handled by video end/loop
  useEffect(() => {
    if (
      isPaused ||
      !currentGlance ||
      showViewersList ||
      showReplyInput ||
      currentGlance?.mediaType === "video"
    )
      return;

    progressRef.current = 0;
    setProgress(0);

    const interval = 30;
    const step = (interval / DURATION) * 100;

    timerRef.current = setInterval(() => {
      progressRef.current += step;
      setProgress(Math.min(progressRef.current, 100));

      if (progressRef.current >= 100) {
        clearInterval(timerRef.current!);
        if (currentIndex < glimpses.length - 1) {
          setCurrentIndex((prev) => prev + 1);
        } else {
          handleClose();
        }
      }
    }, interval);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [
    currentIndex,
    currentGlance?._id,
    isPaused,
    DURATION,
    glimpses.length,
    handleClose,
    isAuthor,
    showViewersList,
  ]);

  // Video progress tracking — updates progress bar based on video currentTime
  useEffect(() => {
    if (currentGlance?.mediaType !== "video" || !videoRef.current) return;

    setProgress(0);

    const video = videoRef.current;

    const handleTimeUpdate = () => {
      if (video.duration) {
        const videoProgress = (video.currentTime / video.duration) * 100;
        setProgress(Math.min(videoProgress, 100));
      }
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => video.removeEventListener("timeupdate", handleTimeUpdate);
  }, [currentGlance?._id, currentGlance?.mediaType]);

  // Handle tap: left=previous, center=pause/play, right=next
  const handleContainerClick = (e: React.MouseEvent) => {
    // Ignore clicks that immediately follow a swipe gesture
    if (didSwipeRef.current) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const third = rect.width / 3;

    if (x < third) {
      // Left third: go to previous
      if (currentIndex > 0) {
        setSlideDirection("left");
        setCurrentIndex((prev) => prev - 1);
      }
    } else if (x < third * 2) {
      // Center third: pause/play
      if (currentGlance?.mediaType === "video") {
        if (videoRef.current) {
          if (videoRef.current.paused) {
            videoRef.current.play().catch(() => {});
            setIsPaused(false);
          } else {
            videoRef.current.pause();
            setIsPaused(true);
          }
        }
      } else {
        setIsPaused((prev) => !prev);
      }
    } else {
      // Right third: go to next or close
      if (currentIndex < glimpses.length - 1) {
        setSlideDirection("right");
        setCurrentIndex((prev) => prev + 1);
      } else {
        handleClose();
      }
    }
  };

  // Instagram-style long press to pause
  const handleLongPressStart = useCallback(() => {
    isLongPressingRef.current = false;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      isLongPressingRef.current = true;
      setIsPaused(true);
      // Also pause video if playing
      if (videoRef.current && !videoRef.current.paused) {
        videoRef.current.pause();
      }
    }, 200);
  }, []);

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (isLongPressingRef.current) {
      isLongPressingRef.current = false;
      setIsPaused(false);
      // Resume video if paused
      if (
        videoRef.current &&
        videoRef.current.paused &&
        !videoRef.current.ended
      ) {
        videoRef.current.play().catch(() => {});
      }
    }
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    handleLongPressStart();
  };

  const handleMouseUp = () => {
    handleLongPressEnd();
  };

  // ── Swipe gesture state ──
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const isSwipingRef = useRef(false);
  const didSwipeRef = useRef(false);
  const SWIPE_THRESHOLD = 50;

  const handleTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const touch = e.touches[0];
    swipeStartX.current = touch.clientX;
    swipeStartY.current = touch.clientY;
    isSwipingRef.current = false;
    handleLongPressStart();
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!swipeStartX.current) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - swipeStartX.current;
    const deltaY = touch.clientY - swipeStartY.current;

    // If moved horizontally enough and more horizontal than vertical, treat as swipe
    if (Math.abs(deltaX) > 30 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      isSwipingRef.current = true;
      // Cancel the long-press since user is swiping
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;

    if (isSwipingRef.current) {
      const deltaX =
        (e.changedTouches[0]?.clientX ?? swipeStartX.current) -
        swipeStartX.current;
      if (Math.abs(deltaX) > SWIPE_THRESHOLD) {
        didSwipeRef.current = true;
        setTimeout(() => {
          didSwipeRef.current = false;
        }, 500);
        if (deltaX > 0) {
          // Swipe right → previous
          if (currentIndex > 0) {
            setSlideDirection("left");
            setCurrentIndex((prev) => prev - 1);
          }
        } else {
          // Swipe left → next
          if (currentIndex < glimpses.length - 1) {
            setSlideDirection("right");
            setCurrentIndex((prev) => prev + 1);
          } else {
            handleClose();
          }
        }
      }
      isSwipingRef.current = false;
      return;
    }

    // Not a swipe, handle normally (long-press end)
    handleLongPressEnd();
  };

  // Handle reaction — toggle like with optimistic update to localReactions
  const handleReact = useCallback(async () => {
    if (!currentGlance || isAuthor || isReacting) return;
    setIsReacting(true);

    const wasReacted = reactedByMe;
    setReactedByMe(!wasReacted);
    setShowHeartAnimation(true);
    setTimeout(() => setShowHeartAnimation(false), 1000);

    // Optimistically update localReactions for real-time heart in viewers list
    setLocalReactions((prev) => {
      if (!wasReacted) {
        // Add current user's reaction
        return [...(prev || []), { user: currentUserId || "", emoji: "❤️" }];
      } else {
        // Remove current user's reaction
        return (prev || []).filter((r) => {
          const rUserId = typeof r.user === "object" ? r.user._id : r.user;
          return (
            rUserId &&
            currentUserId &&
            rUserId.toString() !== currentUserId.toString()
          );
        });
      }
    });

    try {
      await apiFetch(`/api/glimpses/${currentGlance._id}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji: "❤️" }),
      });
    } catch (err) {
      // Revert on error
      setReactedByMe(wasReacted);
      setLocalReactions((prev) => {
        if (wasReacted) {
          return [...(prev || []), { user: currentUserId || "", emoji: "❤️" }];
        } else {
          return (prev || []).filter((r) => {
            const rUserId = typeof r.user === "object" ? r.user._id : r.user;
            return (
              rUserId &&
              currentUserId &&
              rUserId.toString() !== currentUserId.toString()
            );
          });
        }
      });
      logger.error("Failed to react to glimpse", err);
    } finally {
      setIsReacting(false);
    }
  }, [currentGlance, isAuthor, isReacting, reactedByMe, currentUserId]);

  // Handle delete glance
  const handleDelete = useCallback(async () => {
    if (!currentGlance || !isAuthor) return;
    setShowMenu(false);
    try {
      await apiFetch(`/api/glimpses/${currentGlance._id}`, {
        method: "DELETE",
      });
      onDeleteGlance?.(currentGlance._id);
      handleClose();
    } catch (err) {
      logger.error("Failed to delete glance", err);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Failed to delete.", type: "error" },
        }),
      );
    }
  }, [currentGlance, isAuthor, onDeleteGlance, handleClose]);

  // Open the share-to-chat people picker (fetches conversations cache-first)
  const openShareModal = useCallback(async () => {
    setShowMenu(false);
    if (!currentGlance) return;
    setSelectedShareConvIds([]);
    setShareSearch("");
    setShowShareModal(true);
    try {
      const res = await apiFetch("/api/chats/conversations");
      const data = await res.json();
      if (res.ok && data.success) {
        setShareConversations(data.conversations || []);
      }
    } catch (err) {
      logger.error("Failed to load conversations for share", err);
    }
  }, [currentGlance]);

  // Find the other participant in a personal conversation
  const getSharePartner = (conv: Conversation) => {
    const uid = getCurrentUserId();
    return (
      conv.participants?.find((p) => p._id !== uid) ||
      conv.participants?.[0] ||
      null
    );
  };

  const toggleShareConv = (convId: string) => {
    setSelectedShareConvIds((prev) => {
      if (prev.includes(convId)) return prev.filter((id) => id !== convId);
      if (prev.length >= 5) {
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: {
              message: "You can share with up to 5 conversations.",
              type: "error",
            },
          }),
        );
        return prev;
      }
      return [...prev, convId];
    });
  };

  // Copy the glance link (points at the author's profile where the glance lives)
  const copyGlanceLink = async () => {
    if (!currentGlance) return;
    const username = currentGlance.author?.username;
    const link = username
      ? `${window.location.origin}/u/${username}`
      : window.location.origin;
    try {
      await navigator.clipboard.writeText(link);
    } catch (e) {
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
    setShowShareModal(false);
    window.dispatchEvent(
      new CustomEvent("showToast", {
        detail: { message: "Glance link copied!", type: "success" },
      }),
    );
  };

  // Share the glance (media + caption) to every selected conversation
  const handleExecuteShare = async () => {
    if (!currentGlance || selectedShareConvIds.length === 0 || isSharing)
      return;
    setIsSharing(true);
    try {
      // Only attach the media when the schema-required public_id exists
      // (zod demands public_id min(1)); otherwise share the caption alone.
      const media = currentGlance.media;
      const attachments =
        media?.url && media.public_id
          ? [
              {
                url: media.url,
                public_id: media.public_id,
                type: currentGlance.mediaType === "video" ? "video" : "image",
              },
            ]
          : undefined;
      await Promise.all(
        selectedShareConvIds.map(async (convId) => {
          const formData = new FormData();
          formData.append("text", "Shared a glance");
          if (attachments) {
            formData.append("attachments", JSON.stringify(attachments));
          }
          return apiFetch(`/api/chats/conversations/${convId}/messages`, {
            method: "POST",
            body: formData,
          });
        }),
      );
      setShowShareModal(false);
      setSelectedShareConvIds([]);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: {
            message:
              selectedShareConvIds.length > 1
                ? `Glance shared with ${selectedShareConvIds.length} chats`
                : "Glance shared!",
            type: "success",
          },
        }),
      );
    } catch (err) {
      logger.error("Failed to share glance", err);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: {
            message: "Failed to share. Please try again.",
            type: "error",
          },
        }),
      );
    } finally {
      setIsSharing(false);
    }
  };

  // Filter conversations for the share modal search box
  const filteredShareConversations = shareConversations.filter((conv) => {
    const q = shareSearch.trim().toLowerCase();
    if (!q) return true;
    const partner = getSharePartner(conv);
    return (
      (partner?.fullName || "").toLowerCase().includes(q) ||
      (partner?.username || "").toLowerCase().includes(q)
    );
  });

  // Send reply text
  const handleSendReply = useCallback(async () => {
    if (!currentGlance || isAuthor || isReplying || !replyText.trim()) return;
    setIsReplying(true);
    try {
      await apiFetch(`/api/glimpses/${currentGlance._id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: replyText.trim() }),
      });
      setShowReplyInput(false);
      setReplyText("");
      handleClose();
    } catch (err) {
      logger.error("Failed to reply to glimpse", err);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Failed to send reply.", type: "error" },
        }),
      );
    } finally {
      setIsReplying(false);
    }
  }, [currentGlance, isAuthor, isReplying, replyText, handleClose]);

  // Focus reply input when it appears
  useEffect(() => {
    if (showReplyInput && replyInputRef.current) {
      replyInputRef.current.focus();
    }
  }, [showReplyInput]);

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  // When a video ends, auto-advance to the next glance (or close)
  const handleVideoEnded = useCallback(() => {
    // Don't auto-advance if reply input is open
    if (showReplyInput) return;

    if (currentIndex < glimpses.length - 1) {
      setSlideDirection("right");
      setCurrentIndex((prev) => prev + 1);
    } else {
      handleClose();
    }
  }, [currentIndex, glimpses.length, handleClose, showReplyInput]);

  // Listen for glimpse:reacted socket events — update localReactions for real-time heart in viewers list
  useEffect(() => {
    const handleReacted = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.glimpseId !== currentGlance?._id) return;

      if (detail.userId === getCurrentUserId()) {
        setReactedByMe(detail.action === "added");
      }

      // Update localReactions so viewers list hearts stay in sync via socket
      setLocalReactions((prev) => {
        if (detail.action === "added") {
          return [...prev, { user: detail.userId, emoji: detail.emoji }];
        } else {
          return prev.filter((r) => {
            const rUserId = typeof r.user === "object" ? r.user._id : r.user;
            return rUserId && rUserId.toString() !== detail.userId;
          });
        }
      });
    };
    window.addEventListener("glimpse:reacted", handleReacted);
    return () => window.removeEventListener("glimpse:reacted", handleReacted);
  }, [currentGlance?._id]);

  // Keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();

      if (e.key === "ArrowRight") {
        if (currentIndex < glimpses.length - 1)
          setCurrentIndex((prev) => prev + 1);
        else handleClose();
      }
      if (e.key === "ArrowLeft") {
        if (currentIndex > 0) setCurrentIndex((prev) => prev - 1);
      }
      // Skip space/toggle if user is typing in an input or textarea
      if (e.key === " ") {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        if (currentGlance?.mediaType === "video") {
          if (videoRef.current) {
            if (videoRef.current.paused) {
              videoRef.current.play().catch(() => {});
            } else {
              videoRef.current.pause();
            }
          }
        } else {
          setIsPaused((prev) => !prev);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentIndex, glimpses.length, handleClose, isAuthor, currentGlance]);

  // Helper: check if a viewer user ID exists in the reactions array
  const hasReacted = useCallback(
    (viewerUserId: string) => {
      return (localReactions || []).some((r) => {
        const rUserId = typeof r.user === "object" ? r.user._id : r.user;
        return rUserId && rUserId.toString() === viewerUserId;
      });
    },
    [localReactions],
  );

  // Build "Liked by X and Y others" text from reactions and viewers
  const getLikedByText = useCallback(() => {
    if (!localReactions || localReactions.length === 0) return null;

    // Separate current user from other reactors
    const otherReactorIds = new Set<string>();
    let currentUserReacted = false;

    localReactions.forEach((r) => {
      const rUserId = typeof r.user === "object" ? r.user._id : r.user;
      if (rUserId) {
        if (currentUserId && rUserId.toString() === currentUserId.toString()) {
          currentUserReacted = true;
        } else {
          otherReactorIds.add(rUserId.toString());
        }
      }
    });

    // Don't show anything if no one else reacted
    if (otherReactorIds.size === 0) return null;

    // Cross-reference with viewers to find display names
    const viewerNameMap = new Map<string, string>();
    populatedViewers.forEach((v) => {
      const viewerUser = typeof v.user === "object" ? v.user : null;
      if (viewerUser && viewerUser._id && viewerUser.fullName) {
        viewerNameMap.set(viewerUser._id.toString(), viewerUser.fullName);
      }
    });

    // Find the first reactor with a known name
    let firstName: string | null = null;
    for (const id of otherReactorIds) {
      const name = viewerNameMap.get(id);
      if (name) {
        firstName = name;
        break;
      }
    }

    const othersCount = otherReactorIds.size;

    if (firstName) {
      return othersCount === 1
        ? `Liked by ${firstName}`
        : `Liked by ${firstName} and ${othersCount - 1} other${othersCount - 1 > 1 ? "s" : ""}`;
    }

    // Fallback: just show count
    if (currentUserReacted) {
      return `Liked by you and ${othersCount} other${othersCount > 1 ? "s" : ""}`;
    }
    return `Liked by ${othersCount} people`;
  }, [localReactions, populatedViewers, currentUserId]);

  const filteredViewers = populatedViewers.filter((v) => {
    const viewerId = typeof v.user === "object" && v.user ? v.user._id : v.user;
    return (
      viewerId &&
      currentUserId &&
      viewerId.toString() !== currentUserId.toString()
    );
  });

  if (!currentGlance) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/95 backdrop-blur-sm"
      onClick={handleContainerClick}
    >
      {/* Close button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleClose();
        }}
        aria-label="Close glance"
        className="absolute top-6 right-6 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white transition-all cursor-pointer"
      >
        <X className="h-5 w-5" />
      </button>

      <div
        className="relative w-full max-w-2xl h-[88dvh] sm:h-[90vh] mx-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress bars — in normal flow at the top of the column so they
				    can never be clipped on short/landscape screens. */}
        <div className="shrink-0 flex gap-1.5 z-10 pt-4">
          {glimpses.map((g, idx) => (
            <div
              key={g._id}
              className="flex-1 h-1 rounded-full bg-white/20 overflow-hidden"
            >
              <div
                className="h-full rounded-full transition-all duration-100 ease-linear"
                style={{
                  width:
                    idx === currentIndex
                      ? `${progress}%`
                      : idx < currentIndex
                        ? "100%"
                        : "0%",
                  backgroundColor: "white",
                }}
              />
            </div>
          ))}
        </div>

        {/* Story frame area — flexes to fill whatever height remains after the
				    bars and the bottom controls, so Like/Reply are never pushed off
				    short/landscape screens. The frame derives its width from this
				    definite height (never from a percentage against a fit-content
				    ancestor, which resolves to ~0 and collapses the frame). */}
        <div
          ref={frameAreaRef}
          className="flex-1 min-h-0 flex items-center justify-center py-3"
        >
          <div
            className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/40 shadow-2xl"
            style={{
              aspectRatio: "9 / 16",
              height: frameHeight > 0 ? `${frameHeight}px` : "100%",
              width: "auto",
              maxWidth: "100%",
              maxHeight: "100%",
            }}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          >
            {/* Brightness gradient overlays for text contrast */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent pointer-events-none z-[5]" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/10 to-transparent pointer-events-none z-[5]" />

            {/* Author info overlay at top */}
            <div className="absolute top-4 left-4 z-10 flex items-center gap-3">
              {currentGlance.author.profilePic?.url ? (
                <img
                  src={optimizeImageUrl(currentGlance.author.profilePic.url)}
                  alt={currentGlance.author.fullName}
                  className="h-10 w-10 rounded-full object-cover border-2 border-white/30 shadow-lg"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-white/30 bg-zinc-800 shadow-lg">
                  <span className="text-sm font-bold text-zinc-400">
                    {currentGlance.author.fullName?.charAt(0)?.toUpperCase() ||
                      "?"}
                  </span>
                </div>
              )}
              <div>
                <p className="text-sm font-bold text-white drop-shadow-lg">
                  {currentGlance.author.fullName}
                </p>
                <p className="text-[11px] text-white/80 drop-shadow-lg">
                  @{currentGlance.author.username}
                </p>
              </div>
            </div>

            {/* Three-dots menu */}
            <div className="absolute top-4 right-4 z-10" ref={menuRef}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu((prev) => !prev);
                }}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white transition-all cursor-pointer"
                title="More"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>

              {showMenu && (
                <div className="absolute top-10 right-0 min-w-[140px] bg-zinc-950 border border-white/10 rounded-xl p-1.5 shadow-2xl backdrop-blur-xl">
                  {/* Share option for everyone */}{" "}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openShareModal();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-white hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <Share2 className="h-4 w-4 text-zinc-400" />
                    Share
                  </button>
                  {/* Delete option only for author */}
                  {isAuthor && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete();
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-red-400 hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>

            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={currentGlance._id}
                className="absolute inset-0"
                initial={{
                  opacity: 0,
                  x: slideDirection === "right" ? 80 : -80,
                  scale: 0.98,
                }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{
                  opacity: 0,
                  x: slideDirection === "right" ? -80 : 80,
                  scale: 0.98,
                }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                {mediaUnavailable ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950 px-6 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/5">
                      <X className="h-6 w-6 text-zinc-400" />
                    </div>
                    <p className="text-sm font-bold text-white">
                      Media unavailable
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      This glance's media can no longer be displayed. It may
                      have been removed or uploaded incorrectly.
                    </p>
                  </div>
                ) : currentGlance.mediaType === "video" ? (
                  <video
                    ref={videoRef}
                    key={`v-${mediaSrcKey}`}
                    src={
                      mediaSrcKey
                        ? `${currentGlance.media.url}?retry=${mediaSrcKey}`
                        : currentGlance.media.url
                    }
                    className={`w-full h-full ${mediaFit === "contain" ? "object-contain object-center" : "object-cover"}`}
                    autoPlay
                    muted
                    playsInline
                    draggable={false}
                    onEnded={handleVideoEnded}
                    onLoadedMetadata={handleVideoMeta}
                    onError={handleMediaError}
                  />
                ) : (
                  <img
                    key={`i-${mediaSrcKey}`}
                    src={
                      mediaSrcKey
                        ? `${currentGlance.media.url}?retry=${mediaSrcKey}`
                        : currentGlance.media.url
                    }
                    alt=""
                    className={`w-full h-full ${mediaFit === "contain" ? "object-contain object-center" : "object-cover"}`}
                    draggable={false}
                    onLoad={handleImgLoad}
                    onError={handleMediaError}
                  />
                )}
                {/* Loading shimmer so a slow/retrying media never looks like a black frame */}
                {mediaLoading && !mediaUnavailable && (
                  <div className="absolute inset-0 z-[6] flex items-center justify-center bg-zinc-950/80">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {/* Pause overlay */}
            {isPaused && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-10">
                <div className="rounded-full bg-white/20 px-6 py-3 backdrop-blur-sm">
                  <p className="text-sm font-bold text-white">Paused</p>
                </div>
              </div>
            )}

            {/* Heart animation on reaction */}
            <AnimatePresence>
              {showHeartAnimation && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.3 }}
                  animate={{ opacity: 1, scale: 1.2 }}
                  exit={{ opacity: 0, scale: 1.5 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="absolute inset-0 flex items-center justify-center pointer-events-none z-20"
                >
                  <Heart
                    className="h-24 w-24 text-red-500 drop-shadow-[0_0_20px_rgba(239,68,68,0.6)]"
                    fill="#ef4444"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Tap hints on first load */}
            {progress < 5 && !isPaused && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[11px] text-white/40 z-10">
                Swipe or tap sides: navigate · Center: play/pause
              </div>
            )}
          </div>
        </div>

        {/* Bottom controls — shrink-0 so they always stay fully visible on
				    short/landscape screens. */}
        <div className="shrink-0">
          {/* Liked by text */}
          {(() => {
            const likedBy = getLikedByText();
            return likedBy ? (
              <div className="mt-3 text-center">
                <p className="text-[13px] text-white/60 font-medium">
                  {likedBy}
                </p>
              </div>
            ) : null;
          })()}

          {/* Bottom row: reactions & reply */}
          {!isAuthor && !showReplyInput && (
            <div className="flex items-center justify-center gap-4 mt-4">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleReact();
                }}
                className="flex items-center gap-1.5 rounded-full bg-black/60 border border-white/10 px-4 py-2 text-[12px] md:text-sm font-bold text-white hover:bg-zinc-900 transition-all cursor-pointer shadow-lg"
                title={reactedByMe ? "Remove reaction" : "Like this glance"}
              >
                <Heart
                  className={`h-4 w-4 ${reactedByMe ? "text-red-500" : "text-white/70"}`}
                  fill={reactedByMe ? "#ef4444" : "none"}
                />
                <span>{reactedByMe ? "Liked" : "Like"}</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  // Pause glance preview when opening reply
                  setIsPaused(true);
                  if (videoRef.current && !videoRef.current.paused) {
                    videoRef.current.pause();
                  }
                  setShowReplyInput(true);
                }}
                className="flex items-center gap-1.5 rounded-full bg-black/60 border border-white/10 px-4 py-2 text-[12px] md:text-sm font-bold text-white hover:bg-zinc-900 transition-all cursor-pointer shadow-lg"
                title="Reply to this glance"
              >
                <MessageSquare className="h-4 w-4" />
                <span>Reply</span>
              </button>
            </div>
          )}

          {/* Reply input */}
          {!isAuthor && showReplyInput && (
            <div className="mt-4 w-full">
              <div className="flex items-center gap-2 rounded-full bg-black/60 border border-white/10 px-4 py-1.5 shadow-lg">
                <input
                  ref={replyInputRef}
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && replyText.trim()) {
                      handleSendReply();
                    }
                  }}
                  placeholder="Send a message..."
                  className="flex-1 bg-transparent text-white text-xs md:text-sm placeholder-zinc-500 outline-none py-2"
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    // Resume glance preview on cancel
                    setIsPaused(false);
                    if (
                      videoRef.current &&
                      videoRef.current.paused &&
                      !videoRef.current.ended
                    ) {
                      videoRef.current.play().catch(() => {});
                    }
                    setShowReplyInput(false);
                    setReplyText("");
                  }}
                  className="text-[11px] text-zinc-400 hover:text-white transition-colors cursor-pointer px-2"
                >
                  Cancel
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSendReply();
                  }}
                  disabled={isReplying || !replyText.trim()}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-aurora hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed text-white border border-white/10 shadow-aurora transition-all cursor-pointer"
                  title="Send reply"
                >
                  {isReplying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Views stats button for the creator */}
          {isAuthor && (
            <button
              onClick={() => setShowViewersList(true)}
              className="mt-4 mx-auto flex items-center gap-1.5 rounded-full bg-black/60 border border-white/10 px-4 py-2 text-[12px] md:text-sm font-bold text-white hover:bg-zinc-900 transition-all cursor-pointer shadow-lg w-fit"
            >
              <Eye className="h-4 w-4 text-white/70" />
              <span>
                {currentGlance.viewerCount ?? currentGlance.viewers?.length ?? 0}{" "}
                {(currentGlance.viewerCount ?? currentGlance.viewers?.length ?? 0) === 1
                  ? "view"
                  : "views"}
              </span>
            </button>
          )}
        </div>

        {/* Share-to-chat people picker modal (mirrors the chat forward UX) */}
        {showShareModal && (
          <div
            className="absolute inset-0 z-[330] flex items-center justify-center bg-black/80 p-4"
            onClick={() => setShowShareModal(false)}
          >
            <div
              className="flex w-full max-w-sm flex-col overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/5">
                <h4 className="font-bold text-sm text-white">Share Glance</h4>
                <button
                  onClick={() => setShowShareModal(false)}
                  className="p-1 rounded-full hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4 text-zinc-400" />
                </button>
              </div>

              {/* Search box */}
              <div className="px-5 pt-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
                  <input
                    value={shareSearch}
                    onChange={(e) => setShareSearch(e.target.value)}
                    placeholder="Search chats..."
                    className="w-full rounded-full border border-zinc-800 bg-black/40 py-2 pl-9 pr-4 text-xs font-bold text-white placeholder-zinc-500 outline-none focus:border-white/40 focus:bg-zinc-900/60 transition-all"
                  />
                </div>
              </div>

              {/* Conversation list */}
              <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5 max-h-[45vh]">
                {shareConversations.length === 0 ? (
                  <p className="text-center text-[11px] text-zinc-500 py-6">
                    No chats yet — start a conversation first
                  </p>
                ) : filteredShareConversations.length === 0 ? (
                  <p className="text-center text-[11px] text-zinc-500 py-6">
                    No matching chats
                  </p>
                ) : (
                  filteredShareConversations.map((conv) => {
                    const partner = getSharePartner(conv);
                    const isSelected = selectedShareConvIds.includes(conv._id);
                    return (
                      <button
                        key={conv._id}
                        onClick={() => toggleShareConv(conv._id)}
                        className={`w-full flex items-center gap-2.5 p-2 rounded-xl transition-all border ${isSelected ? "bg-white/10 border-white/30" : "hover:bg-zinc-900/60 border-transparent"} text-left cursor-pointer`}
                      >
                        {partner?.profilePic?.url ? (
                          <img
                            src={optimizeImageUrl(partner.profilePic.url)}
                            alt={partner.fullName}
                            className="h-8 w-8 rounded-full object-cover border border-zinc-800 shrink-0"
                          />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-800 shrink-0">
                            <span className="text-xs font-bold text-zinc-400">
                              {partner?.fullName?.charAt(0)?.toUpperCase() ||
                                "?"}
                            </span>
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-white truncate">
                            {partner?.fullName || "Unknown"}
                          </p>
                          <p className="text-[11px] text-zinc-500 truncate">
                            @{partner?.username || ""}
                          </p>
                        </div>
                        <div
                          className={`h-5 w-5 rounded-full border flex items-center justify-center shrink-0 transition-all ${isSelected ? "bg-white border-transparent text-black" : "border-zinc-700 text-transparent"}`}
                        >
                          {isSelected && (
                            <svg
                              className="h-3 w-3"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              strokeWidth="3"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M4.5 12.75l6 6 9-13.5"
                              />
                            </svg>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Copy link + Send buttons */}
              <div className="px-5 py-4 border-t border-white/5 space-y-2">
                <button
                  onClick={copyGlanceLink}
                  className="w-full py-2.5 border border-white/10 hover:border-white/30 text-[11px] font-bold uppercase tracking-wider text-zinc-200 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Copy link
                </button>
                <button
                  onClick={handleExecuteShare}
                  disabled={selectedShareConvIds.length === 0 || isSharing}
                  className="w-full py-2.5 bg-aurora hover:opacity-90 text-[11px] font-black uppercase tracking-wider text-white border border-white/10 shadow-aurora rounded-xl disabled:opacity-40 transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  {isSharing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  Send ({selectedShareConvIds.length}/5)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Viewers list popup */}
        {showViewersList && (
          <div
            className="absolute inset-0 bg-black/80 flex items-center justify-center p-4 z-[320]"
            onClick={() => setShowViewersList(false)}
          >
            <div
              className="w-full max-w-xs bg-zinc-950 border border-white/10 rounded-3xl p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/5">
                <h4 className="font-bold text-sm text-white">
                  Viewed by{" "}
                  <span className="text-violet-400">
                    {currentGlance.viewerCount ??
                      currentGlance.viewers?.length ??
                      0}
                  </span>
                </h4>
                <button
                  onClick={() => setShowViewersList(false)}
                  className="text-zinc-400 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                {filteredViewers.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-4 text-center">
                    No views yet
                  </p>
                ) : (
                  filteredViewers.map((v, idx) => {
                    const viewerUser =
                      typeof v.user === "object" ? v.user : null;
                    if (!viewerUser) return null;
                    const liked = hasReacted(viewerUser._id);
                    return (
                      <div key={idx} className="flex items-center gap-2.5">
                        {viewerUser.profilePic?.url ? (
                          <img
                            src={optimizeImageUrl(viewerUser.profilePic.url)}
                            alt={viewerUser.fullName}
                            className="h-8 w-8 rounded-full object-cover border border-zinc-800"
                          />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-800">
                            <span className="text-xs font-bold text-zinc-400">
                              {viewerUser.fullName?.charAt(0)?.toUpperCase() ||
                                "?"}
                            </span>
                          </div>
                        )}
                        <div className="text-left min-w-0 flex-1">
                          <p className="text-xs font-bold text-white truncate">
                            {viewerUser.fullName}
                          </p>
                          <p className="text-[11px] text-zinc-500 truncate">
                            @{viewerUser.username}
                          </p>
                        </div>
                        {liked && (
                          <Heart
                            className="h-3.5 w-3.5 text-red-500 shrink-0"
                            fill="#ef4444"
                          />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
