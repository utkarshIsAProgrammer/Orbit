import React, { useRef, useState, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import {
  MoreHorizontal,
  EyeOff,
  VolumeX,
  Ban,
  Link2,
  FolderPlus,
  Flag,
  Languages,
  Pencil,
  Pin,
  PinOff,
  Archive,
  Trash2,
} from "lucide-react";
import type { Post } from "../types";

interface PostMoreMenuProps {
  post: Post;
  user: { _id: string } | null;
  readOnly?: boolean;
  /** Show management actions (edit/pin/archive/delete) — own posts only. */
  isOwnPost: boolean;
  /** Content preference — hide from feeds ("Not interested"). */
  onHide?: (post: Post) => void;
  /** Moderation — mute the author for 30 days. */
  onMute?: (post: Post) => void;
  /** Moderation — block the author. */
  onBlock?: (post: Post) => void;
  /** Moderation — report the post. */
  onReport?: (post: Post) => void;
  /** Translate — trigger the post's inline translation. */
  onTranslate?: (post: Post) => void;
  /** Management — open the edit modal. */
  onEdit?: (post: Post) => void;
  /** Management — toggle pin on profile. */
  onPinToggle?: (post: Post) => void;
  /** Management — archive the post. */
  onArchive?: (post: Post) => void;
  /** Management — delete the post. */
  onDelete?: (post: Post) => void;
  onCopyLink?: (post: Post) => void;
  onSaveToCollection?: (post: Post) => void;
  /** Alignment of the dropdown relative to the trigger. */
  align?: "left" | "right";
}

/**
 * Post three-dot menu — moderation (report/block/mute), content preference
 * (not interested) and management (edit/pin/archive/delete) for own posts.
 * Portal-rendered with position:fixed so it can never be clipped by a card's
 * overflow-hidden; flips above the trigger when there's no room below and
 * closes on outside click or Escape.
 */
export default function PostMoreMenu({
  post,
  user,
  readOnly = false,
  isOwnPost,
  onHide,
  onMute,
  onBlock,
  onReport,
  onTranslate,
  onEdit,
  onPinToggle,
  onArchive,
  onDelete,
  onCopyLink,
  onSaveToCollection,
  align = "right",
}: PostMoreMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Starts null so the menu NEVER mounts at a default top-left corner
  // (8,8) — it only renders once compute() has measured the trigger and
  // set the real position (useLayoutEffect, before the browser paints).
  // Otherwise the first open of the session can flash the menu at the
  // screen's top-left before the correction lands.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const MENU_W = 208;

  const close = () => setOpen(false);

  const compute = () => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const GAP = 6;
    const menuH = menuRef.current?.offsetHeight || 260;
    let x = align === "right" ? rect.right - MENU_W : rect.left;
    x = Math.min(Math.max(GAP, x), Math.max(GAP, vw - MENU_W - GAP));
    const roomBelow = vh - rect.bottom - GAP;
    const up = roomBelow < menuH && rect.top > menuH;
    const y = up ? rect.top - menuH - GAP : rect.bottom + GAP;
    setPos({
      x,
      y: Math.min(Math.max(GAP, y), Math.max(GAP, vh - menuH - GAP)),
    });
  };

  useLayoutEffect(() => {
    if (open) compute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    compute();
    const onViewportChange = () => compute();
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        compute();
      });
    };
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", onViewportChange);
    window.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("orientationchange", onViewportChange);
      window.removeEventListener("scroll", onScroll, { capture: true });
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  // If the post disappears (deleted/hidden) close any open menu.
  useEffect(() => {
    if (open && !post) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post]);

  if (readOnly || !user) return null;

  const canManage = isOwnPost;
  const author = post.author;

  const menuItem =
    (
      icon: React.ReactNode,
      label: string,
      onClick: (e: React.MouseEvent) => void,
      danger = false,
    ) => (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick(e);
        }}
        className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-xs transition-colors text-left cursor-pointer ${
          danger
            ? "text-red-400 hover:bg-red-500/10"
            : "text-zinc-300 hover:bg-zinc-800 hover:text-white"
        }`}
      >
        <span className={`${danger ? "text-red-400/80" : "text-zinc-400"}`}>
          {icon}
        </span>
        {label}
      </button>
    );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onContextMenu={(e) => e.stopPropagation()}
        className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
        aria-label="Post options"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {typeof document !== "undefined" &&
        open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-[400] overflow-hidden rounded-xl border border-white/10 bg-zinc-900 py-1 shadow-[0_20px_55px_-15px_rgba(0,0,0,0.9)]"
            style={{ left: pos.x, top: pos.y, width: MENU_W }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Orbit signature: 1px glass edge-light along the top */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-linear-to-r from-transparent via-white/20 to-transparent" />

            {!canManage && (
              <>
                {onHide && menuItem(
                  <EyeOff className="h-3.5 w-3.5" />,
                  "Not interested",
                  () => {
                    close();
                    onHide(post);
                  },
                )}
                {onMute && menuItem(
                  <VolumeX className="h-3.5 w-3.5" />,
                  `Mute @${author.username}`,
                  () => {
                    close();
                    onMute(post);
                  },
                )}
                {onBlock && menuItem(
                  <Ban className="h-3.5 w-3.5" />,
                  `Block @${author.username}`,
                  () => {
                    close();
                    onBlock(post);
                  },
                  true,
                )}
                {onReport && menuItem(
                  <Flag className="h-3.5 w-3.5" />,
                  "Report",
                  () => {
                    close();
                    onReport(post);
                  },
                )}
                <div className="my-1 h-px bg-zinc-800" />
              </>
            )}

            {canManage && onEdit && menuItem(
              <Pencil className="h-3.5 w-3.5" />,
              "Edit Post",
              () => {
                close();
                onEdit(post);
              },
            )}
            {canManage && onPinToggle && menuItem(
              post.pinnedByMe ? (
                <PinOff className="h-3.5 w-3.5" />
              ) : (
                <Pin className="h-3.5 w-3.5" />
              ),
              post.pinnedByMe ? "Unpin from Profile" : "Pin to Profile",
              () => {
                close();
                onPinToggle(post);
              },
            )}
            {canManage && onArchive && menuItem(
              <Archive className="h-3.5 w-3.5" />,
              "Archive Post",
              () => {
                close();
                onArchive(post);
              },
            )}
            {canManage && (
              <div className="my-1 h-px bg-zinc-800" />
            )}

            {onCopyLink && menuItem(
              <Link2 className="h-3.5 w-3.5" />,
              "Copy link",
              () => {
                close();
                onCopyLink(post);
              },
            )}
            {onSaveToCollection && menuItem(
              <FolderPlus className="h-3.5 w-3.5" />,
              "Save to collection",
              () => {
                close();
                onSaveToCollection(post);
              },
            )}

            {onTranslate && menuItem(
              <Languages className="h-3.5 w-3.5" />,
              "Translate",
              () => {
                close();
                onTranslate(post);
              },
            )}

            {canManage && onDelete && (
              <>
                <div className="my-1 h-px bg-zinc-800" />
                {menuItem(
                  <Trash2 className="h-3.5 w-3.5" />,
                  "Delete Post",
                  () => {
                    close();
                    onDelete(post);
                  },
                  true,
                )}
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
