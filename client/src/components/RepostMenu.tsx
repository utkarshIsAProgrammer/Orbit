import React, { useRef, useState, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { Repeat2, MessageSquareQuote } from "lucide-react";
import type { Post } from "../types";

interface RepostMenuProps {
  post: Post;
  readOnly?: boolean;
  /** Users can't quote-repost their own post — hides the Quote option. */
  canQuote?: boolean;
  /** Toggle repost (already-reposted posts offer Undo). */
  onRepost: (postId: string, repostedByMe: boolean) => void;
  /** Open the quote-repost composer for this post. */
  onQuote: (postId: string) => void;
}

/**
 * Repost trigger + chooser — the repost icon opens a compact dropdown with
 * both "Repost" and "Quote" actions so the user picks one. Portal-rendered
 * with position:fixed so it can never be clipped by a card's overflow-hidden;
 * flips above the trigger when there's no room below and closes on outside
 * click or Escape.
 */
export default function RepostMenu({
  post,
  readOnly = false,
  canQuote = true,
  onRepost,
  onQuote,
}: RepostMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Starts null so the menu NEVER mounts at a default top-left corner
  // (8,8) — it only renders once compute() has measured the trigger and
  // set the real position (useLayoutEffect, before the browser paints).
  // Otherwise the first open of the session can flash the menu at the
  // screen's top-left before the correction lands.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const MENU_W = 168;

  const close = () => setOpen(false);

  const compute = () => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const GAP = 6;
    const menuH = menuRef.current?.offsetHeight || 96;
    let x = rect.left;
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
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const menuItem = (icon: React.ReactNode, label: string, action: () => void) => (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => {
        e.stopPropagation();
        close();
        action();
      }}
      className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs font-semibold text-zinc-300 transition-colors cursor-pointer hover:bg-white/10 hover:text-white"
    >
      <span className="text-zinc-400">{icon}</span>
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
          if (readOnly) return;
          setOpen((v) => !v);
        }}
        onContextMenu={(e) => e.stopPropagation()}
        className={`flex items-center gap-1.5 text-sm font-semibold select-none group focus:outline-none transition-colors ${
          readOnly ? "cursor-default" : "cursor-pointer"
        }`}
        aria-label={`${post.repostedByMe ? "Undo repost" : "Repost"} post (${post.repostsCount} reposts)`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <motion.span
          whileTap={
            !readOnly
              ? {
                  rotate: 180,
                }
              : undefined
          }
          whileHover={
            !readOnly
              ? {
                  scale: 1.1,
                }
              : undefined
          }
          className="flex"
        >
          <Repeat2
            className={`h-4 w-4 transition-colors ${
              post.repostedByMe
                ? "text-green-500 font-bold"
                : readOnly
                  ? "text-zinc-500"
                  : "text-zinc-500 group-hover:text-white"
            }`}
          />
        </motion.span>
        <span
          className={
            post.repostedByMe
              ? "text-green-500 font-bold"
              : readOnly
                ? "text-zinc-400"
                : "group-hover:text-white text-zinc-400"
          }
        >
          {post.repostsCount}
        </span>
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

            {menuItem(
              <Repeat2 className="h-3.5 w-3.5" />,
              post.repostedByMe ? "Undo Repost" : "Repost",
              () => onRepost(post._id, !!post.repostedByMe),
            )}
            {canQuote &&
              menuItem(
                <MessageSquareQuote className="h-3.5 w-3.5" />,
                "Quote",
                () => onQuote(post._id),
              )}
          </div>,
          document.body,
        )}
    </>
  );
}
