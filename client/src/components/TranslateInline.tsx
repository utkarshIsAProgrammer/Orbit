import React, { useState, useEffect, useRef } from "react";
import { Languages, Loader2 } from "lucide-react";
import { translateText } from "../utils/links";

interface TranslateInlineProps {
  text: string;
  /** Renders the displayed text (keeps hashtag/mention formatting). */
  render: (displayText: string) => React.ReactNode;
  /** Extra classes for the toggle button row. */
  className?: string;
  /**
   * Extra content rendered side-by-side in the SAME horizontal row as the
   * translate icon (e.g. a reaction pill on posts). Also rendered when the
   * text is too short to translate, so callers keep their action buttons
   * even on image-only content.
   */
  rowAfter?: React.ReactNode;
  /**
   * Optional unique id that lets external UI (e.g. a long-press menu item)
   * trigger this translate toggle programmatically by dispatching a
   * `translate-inline:toggle` window event with `{ id }`.
   */
  eventId?: string;
  /**
   * Hide the circular translate icon (chats where translation is offered in
   * the long-press menu instead). The translated text + event-driven toggle
   * still work — only the visible button is suppressed.
   */
  hideToggle?: boolean;
}

/**
 * Adds a minimal circular translate icon under text content (posts,
 * comments, messages). Translates to English via the server proxy and
 * caches the result, so toggling back and forth is instant.
 */
export default function TranslateInline({
  text,
  render,
  className = "",
  rowAfter,
  eventId,
  hideToggle = false,
}: TranslateInlineProps) {
  const [translated, setTranslated] = useState<string | null>(null);
  const [detected, setDetected] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [showTranslated, setShowTranslated] = useState(false);

  const handleToggle = async () => {
    if (translated) {
      setShowTranslated((v) => !v);
      return;
    }
    setLoading(true);
    const result = await translateText(text);
    setLoading(false);
    if (result) {
      setTranslated(result.translatedText);
      setDetected(result.detectedLanguage);
      setShowTranslated(true);
    } else {
      // Surface failures instead of dying silently — a null result means the
      // server couldn't translate (network blip, auth, or provider hiccup).
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: {
            message: "Couldn't translate this text. Please try again.",
            type: "error",
          },
        }),
      );
    }
  };

  // Always call the LATEST handleToggle (ref avoids stale closures in the
  // window-event listener, which is registered once per eventId).
  const handleToggleRef = useRef(handleToggle);
  handleToggleRef.current = handleToggle;

  useEffect(() => {
    if (!eventId) return;
    const handleEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.id === eventId) {
        void handleToggleRef.current();
      }
    };
    window.addEventListener(
      "translate-inline:toggle",
      handleEvent as EventListener,
    );
    return () =>
      window.removeEventListener(
        "translate-inline:toggle",
        handleEvent as EventListener,
      );
  }, [eventId]);

  // Hide the button entirely for trivial texts that don't need translation,
  // but keep any rowAfter content (reaction pills etc.) with a little spacing.
  if (!text || text.trim().length < 3) {
    return rowAfter ? (
      <div className={`flex items-center gap-1.5 pt-2 ${className}`}>
        {rowAfter}
      </div>
    ) : null;
  }

  const shownText = showTranslated && translated ? translated : text;
  const isActive = showTranslated && translated;

  return (
    <div className={`flex flex-col items-start gap-1 ${className}`}>
      <div className="w-full">{render(shownText)}</div>
      {(!hideToggle || rowAfter) && (
        <div className="flex items-center gap-1.5">
          {!hideToggle && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleToggle();
              }}
              title={isActive ? "Show original" : "Translate"}
              aria-label={isActive ? "Show original text" : "Translate text"}
              className={`flex h-6 w-6 items-center justify-center rounded-full border transition-colors cursor-pointer ${
                isActive
                  ? "border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20"
                  : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/20 hover:text-white"
              }`}
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Languages className="h-3 w-3" />
              )}
            </button>
          )}
          {!hideToggle && isActive && detected && detected !== "en" && (
            <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
              {detected}
            </span>
          )}
          {rowAfter}
        </div>
      )}
    </div>
  );
}
