import { useRef, useState } from "react";
import {
  ExternalLink,
  Heart,
  MessageCircle,
  Repeat2,
  MoreHorizontal,
  EyeOff,
  Link2,
  Flag,
  Check,
  Languages,
  Share2,
} from "lucide-react";
import type { ExternalPost, User } from "../types";
import { apiFetch } from "../utils/api";
import { logger } from "../utils/logger";
import { renderLinkifiedText } from "../utils/linkify";
import { shareToExternal } from "../utils/shareToExternal";
import TranslateInline from "./TranslateInline";
import ShareMenu from "./ShareMenu";
import GlassCard from "./GlassCard";
import ReportButton from "./ReportButton";

const SOURCE_META: Record<string, { label: string; badge: string }> = {
  bluesky: { label: "Bluesky", badge: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  mastodon: { label: "Mastodon", badge: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30" },
  lemmy: { label: "Lemmy", badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
};

interface ExternalPostCardProps {
  post: ExternalPost;
  user: User | null;
  /** Called after "Not interested" hides the post — parent removes it. */
  onHidden?: (postId: string) => void;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const toast = (message: string, type: "success" | "error" = "success") => {
  window.dispatchEvent(
    new CustomEvent("showToast", { detail: { message, type } }),
  );
};

export default function ExternalPostCard({
  post,
  user,
  onHidden,
}: ExternalPostCardProps) {
  const meta = SOURCE_META[post.source] || { label: post.source, badge: "" };
  // Images are the primary medium for external posts; videos render inline
  // for legacy video attachments.
  const primaryMedia = post.media?.[0];
  const isVideo = primaryMedia?.type === "video";
  const image = isVideo ? undefined : primaryMedia;

  // Web posts are read-only imports: Orbit-native like/repost/comment/save
  // were removed — only sharing the original stays.
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const requireUser = (): boolean => {
    if (user) return true;
    toast("Log in to interact with posts.", "error");
    return false;
  };

  // Trigger the inline translation from the three-dot menu (same pattern as
  // native posts/comments: the toggle lives under the content, the menu item
  // just fires it).
  const triggerTranslate = () => {
    setMenuOpen(false);
    window.dispatchEvent(
      new CustomEvent("translate-inline:toggle", {
        detail: { id: `external-${post._id}` },
      }),
    );
  };

  const handleHide = async () => {
    setMenuOpen(false);
    if (!requireUser()) return;
    try {
      const res = await apiFetch(`/api/external/posts/${post._id}/hide`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Could not hide this post.");
      }
      toast("Post hidden — we'll show you less like this.");
      onHidden?.(post._id);
    } catch (err: any) {
      logger.error("External hide failed", err);
      toast(err.message || "Failed to hide post", "error");
    }
  };

  // Share the original post to other apps (Web Share API, clipboard fallback)
  // — used by both the action-row button and the three-dot menu.
  const handleShare = () => {
    setMenuOpen(false);
    void shareToExternal({
      title:
        (post.author.displayName || post.author.handle) + " on " + meta.label,
      url: post.url,
    });
  };

  const copyLink = async () => {
    setMenuOpen(false);
    try {
      await navigator.clipboard.writeText(post.url);
      setCopied(true);
      toast("Link copied to clipboard.");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Could not copy link.", "error");
    }
  };

  const iconBtn =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors cursor-pointer";

  return (
    <GlassCard className="p-4 rounded-2xl" whileHover={{ y: -2 }}>
      <div className="space-y-3">
        {/* Header — source badge + author */}
        <div className="flex items-center gap-3">
          <img
            src={post.author.avatar || undefined}
            alt=""
            referrerPolicy="no-referrer"
            className={`h-9 w-9 rounded-full object-cover ${post.author.avatar ? "" : "bg-zinc-800"}`}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-semibold text-white">
                {post.author.displayName || post.author.handle}
              </p>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${meta.badge}`}>
                {meta.label}
              </span>
            </div>
            <p className="truncate text-xs text-zinc-500">
              @{post.author.handle} · {timeAgo(post.originalCreatedAt)}
            </p>
          </div>

          {/* Three-dot menu — mirror native post options */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              className={`${iconBtn} text-zinc-500 hover:bg-zinc-800 hover:text-white`}
              aria-label="Post options"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 top-8 z-50 w-52 overflow-hidden rounded-xl border border-white/10 bg-zinc-900 py-1 shadow-[0_20px_55px_-15px_rgba(0,0,0,0.9)]">
                  <button
                    type="button"
                    onClick={handleHide}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-zinc-300 transition-colors text-left hover:bg-zinc-800 hover:text-white cursor-pointer"
                  >
                    <EyeOff className="h-3.5 w-3.5 text-zinc-400" /> Not interested
                  </button>
                  <button
                    type="button"
                    onClick={handleShare}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-zinc-300 transition-colors text-left hover:bg-zinc-800 hover:text-white cursor-pointer"
                  >
                    <Share2 className="h-3.5 w-3.5 text-zinc-400" />
                    Share
                  </button>
                  <button
                    type="button"
                    onClick={copyLink}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-zinc-300 transition-colors text-left hover:bg-zinc-800 hover:text-white cursor-pointer"
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Link2 className="h-3.5 w-3.5 text-zinc-400" />
                    )}
                    {copied ? "Copied!" : "Copy link"}
                  </button>
                  <button
                    type="button"
                    onClick={triggerTranslate}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-zinc-300 transition-colors text-left hover:bg-zinc-800 hover:text-white cursor-pointer"
                  >
                    <Languages className="h-3.5 w-3.5 text-zinc-400" />
                    Translate
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      if (!requireUser()) return;
                      setReportOpen(true);
                    }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-zinc-300 transition-colors text-left hover:bg-zinc-800 hover:text-white cursor-pointer"
                  >
                    <Flag className="h-3.5 w-3.5 text-zinc-400" /> Report
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Content — linkified so imported URLs are clickable like native
            text, wrapped in TranslateInline so the three-dot menu's Translate
            item works. The visible circular icon is hidden on web posts —
            translation is only offered from the menu. */}
        <TranslateInline
          text={post.content}
          eventId={`external-${post._id}`}
          hideToggle
          render={(t) => (
            <p className="text-sm leading-relaxed text-zinc-200 whitespace-pre-line line-clamp-6">
              {renderLinkifiedText(t)}
            </p>
          )}
        />

        {/* Media — inline image, or an inline video player for video
            attachments (native controls, poster before play) */}
        {isVideo && primaryMedia?.url ? (
          <div className="overflow-hidden rounded-xl border border-white/10 bg-black">
            <video
              src={primaryMedia.url}
              poster={primaryMedia.previewUrl || undefined}
              controls
              playsInline
              preload="metadata"
              className="w-full max-h-80 object-contain"
              onError={(e) => {
                (e.target as HTMLVideoElement).style.display = "none";
              }}
            />
          </div>
        ) : image?.url ? (
          <a href={post.url} target="_blank" rel="noopener noreferrer" className="block">
            <img
              src={image.previewUrl || image.url}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="w-full max-h-72 rounded-xl object-cover border border-white/10"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </a>
        ) : null}

        {/* Action row — web posts are read-only: the only action is sharing
            the original to other apps or copying its link. */}
        <div className="flex items-center gap-1 border-t border-white/5 pt-2.5">
          <ShareMenu
            onForward={handleShare}
            onCopyLink={copyLink}
            triggerContent={
              <>
                <Share2 className="h-3.5 w-3.5" />
                Share
              </>
            }
            triggerClassName="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-zinc-400 hover:bg-zinc-800 hover:text-white transition-all cursor-pointer"
          />
        </div>

        {/* Origin stats + open original */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-4 text-zinc-500">
            <span className="flex items-center gap-1 text-xs" title="Likes on the origin network">
              <Heart className="h-3.5 w-3.5" /> {post.stats?.likes?.toLocaleString() || 0}
            </span>
            <span className="flex items-center gap-1 text-xs" title="Reposts on the origin network">
              <Repeat2 className="h-3.5 w-3.5" /> {post.stats?.reposts?.toLocaleString() || 0}
            </span>
            <span className="flex items-center gap-1 text-xs" title="Replies on the origin network">
              <MessageCircle className="h-3.5 w-3.5" /> {post.stats?.replies?.toLocaleString() || 0}
            </span>
          </div>
          <a
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-full border border-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-400 transition-all hover:border-white/30 hover:text-white cursor-pointer"
          >
            Open on {meta.label} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Report modal — reuses the native report flow */}
      {reportOpen && (
        <ReportButton
          contentType="post"
          contentId={post._id}
          initialOpen
          onClose={() => setReportOpen(false)}
        />
      )}
    </GlassCard>
  );
}
