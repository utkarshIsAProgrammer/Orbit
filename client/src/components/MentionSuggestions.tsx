import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useLayoutEffect,
  forwardRef,
} from "react";
import { createPortal } from "react-dom";
import UserAvatar from "./UserAvatar";

interface MentionUser {
  _id: string;
  username: string;
  fullName?: string;
  profilePic?: { url?: string } | null;
}

interface MentionSuggestionsProps {
  candidates: MentionUser[];
  onSelect: (username: string) => void;
  /** Called on Escape while the dropdown has focus (closes it). */
  onClose?: () => void;
  /** Where the dropdown anchors (absolute-positioned inside the composer). */
  className?: string;
  /** The input/textarea that triggered the @. When provided, the dropdown is
   *  portaled to document.body and fixed-positioned just below it (flipping
   *  above when there's no room) — so it can never be clipped or hidden by an
   *  overflow-hidden/auto ancestor like the post composer modal. */
  anchorRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Shared @mention autocomplete dropdown (Instagram/X-style). Rendered inside
 * the composer's relative container; positioned directly below the input
 * (the portaled mode pins it just under the anchor and flips above when the
 * viewport runs out of room below).
 *
 * Keyboard flow: when the composer textarea sees ArrowDown/ArrowUp while the
 * dropdown is open, the parent focuses this wrapper (`ref.current?.focus()`),
 * after which arrow keys move the highlight and Enter/Tab selects — matching
 * the native Instagram/X feel.
 */
const MentionSuggestions = forwardRef<HTMLDivElement, MentionSuggestionsProps>(
  function MentionSuggestions(
    {
      candidates,
      onSelect,
      onClose,
      // NOTE: default stays empty — the non-portal fallback positioning is
      // appended below only when NO anchorRef is given. If this default ever
      // carried the `absolute bottom-full ...` classes, they'd leak into the
      // portaled mode too and fight the fixed inline position (collapsing the
      // panel to a sliver). Callers that want to tweak styling pass their own.
      className = "",
      anchorRef,
    },
    ref,
  ) {
    const [activeIdx, setActiveIdx] = useState(0);
    const activeRef = useRef<HTMLButtonElement>(null);
    const [portalStyle, setPortalStyle] = useState<React.CSSProperties>({
      visibility: "hidden",
    });
    // Last computed portal position — skip re-renders when scroll/resize fires
    // but nothing actually moved.
    const lastPosRef = useRef({ top: 0, left: 0, width: 0, maxH: 0 });

    // Keep the highlighted row in view as the selection moves.
    useEffect(() => {
      activeRef.current?.scrollIntoView({ block: "nearest" });
    }, [activeIdx]);

    // Reset the highlight whenever the candidate list changes.
    useEffect(() => {
      setActiveIdx(0);
    }, [candidates]);

    // Portal positioning — pinned just above the anchor, flipped below it when
    // there isn't room, and kept in place while the user scrolls/resizes or
    // the composer grows. Only active when an anchorRef is provided.
    useLayoutEffect(() => {
      // MAX_PANEL_H must match the panel's max-h-56 class (224px) — the flip
      // math and the applied style share one source of truth so the panel can
      // never grow taller than the position was computed for.
      const MAX_PANEL_H = 224;

      const measure = () => {
        const anchor = anchorRef?.current;
        const panel = (ref as React.RefObject<HTMLDivElement | null>).current;
        if (!anchor || !panel) return;
        const rect = anchor.getBoundingClientRect();
        const panelH = Math.min(panel.offsetHeight || 200, MAX_PANEL_H);
        const vh = window.innerHeight;
    const gap = 6;
    let top = rect.bottom + gap;
    // Not enough room below → flip above the input.
    if (top + panelH > vh - 8) top = rect.top - panelH - gap;
    // Never run off the top of the viewport either.
    if (top < 8) top = Math.max(8, vh - panelH - 8);
        const maxW = Math.max(
          256,
          Math.min(rect.width + 32, window.innerWidth - 16),
        );
        const left = Math.max(8, rect.left);
        const maxH = Math.min(MAX_PANEL_H, vh - 16);
        // Skip the re-render when nothing actually moved (scroll/resize fire a
        // lot — the dropdown must not re-render on every tick).
        const last = lastPosRef.current;
        if (
          last.top === top &&
          last.left === left &&
          last.width === maxW &&
          last.maxH === maxH
        ) {
          return;
        }
        lastPosRef.current = { top, left, width: maxW, maxH };
        setPortalStyle({
          position: "fixed",
          top,
          left,
          width: maxW,
          maxHeight: maxH,
          zIndex: 999,
          visibility: "visible",
        });
      };

      if (!anchorRef?.current) {
        // The anchor may attach right after mount (conditionally-rendered
        // composer) — check again on the next frame so the dropdown never
        // stays hidden.
        const raf = requestAnimationFrame(() => {
          if (anchorRef?.current) measure();
        });
        return () => cancelAnimationFrame(raf);
      }

      measure();
      window.addEventListener("resize", measure);
      // Capture-phase scroll catches scrolls inside ANY ancestor container
      // (the modal card, the chat list, etc.).
      window.addEventListener("scroll", measure, true);
      let ro: ResizeObserver | null = null;
      try {
        ro = new ResizeObserver(measure);
        ro.observe(anchorRef.current);
      } catch {
        // Older browsers without ResizeObserver — scroll/resize still cover it.
      }
      return () => {
        window.removeEventListener("resize", measure);
        window.removeEventListener("scroll", measure, true);
        ro?.disconnect();
      };
    }, [candidates, anchorRef, ref]);

    const handleKeyNav = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveIdx((i) => (i + 1) % candidates.length);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveIdx((i) => (i - 1 + candidates.length) % candidates.length);
        } else if (e.key === "Enter" || e.key === "Tab") {
          const active = candidates[activeIdx];
          if (active) {
            e.preventDefault();
            onSelect(active.username);
          }
        } else if (e.key === "Escape") {
          e.preventDefault();
          onClose?.();
        }
      },
      [candidates, activeIdx, onSelect, onClose],
    );

    if (!candidates || candidates.length === 0) return null;

    const panel = (
      <div
        ref={ref}
        tabIndex={-1}
        onKeyDown={handleKeyNav}
        onMouseLeave={() => setActiveIdx(0)}
        style={anchorRef ? portalStyle : undefined}
        className={`rounded-2xl border border-zinc-800 bg-zinc-900/95 backdrop-blur-xl p-1.5 shadow-2xl max-h-56 overflow-y-auto outline-none ${
          anchorRef ? "" : "absolute top-full left-0 mt-1.5 z-50 w-64"
        } ${className}`}
      >
        <p className="px-2.5 pb-1 pt-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
          People to Mention
        </p>
        <div className="space-y-0.5">
          {candidates.map((u, idx) => (
            <button
              key={u._id}
              ref={idx === activeIdx ? activeRef : undefined}
              type="button"
              onClick={() => onSelect(u.username)}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIdx(idx)}
              className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors cursor-pointer ${
                idx === activeIdx ? "bg-zinc-700/70" : "hover:bg-zinc-800"
              }`}
            >
              <UserAvatar
                src={u.profilePic?.url}
                alt=""
                className="h-6 w-6 rounded-full object-cover border border-zinc-800 shrink-0"
              />
              <div className="min-w-0">
                <p className="truncate font-bold text-zinc-200 text-[12px]">
                  {u.fullName || u.username}
                </p>
                <p className="truncate text-[11px] text-zinc-500">
                  @{u.username}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    );

    // With an anchorRef the dropdown floats above every overflow container;
    // without one it stays absolutely-positioned inside the composer.
    return anchorRef ? createPortal(panel, document.body) : panel;
  },
);

export default MentionSuggestions;
