import { useEffect, useState } from "react";
import { ExternalLink, Globe } from "lucide-react";
import { apiFetch } from "../utils/api";
import { displayUrl } from "../utils/links";

interface PreviewData {
  url: string;
  title: string;
  description: string;
  image: string;
  favicon: string;
  siteName: string;
}

// Module-level cache so the same URL is only fetched once per session.
const previewCache = new Map<string, PreviewData | null>();
const previewInflight = new Map<string, Promise<PreviewData | null>>();

/** Set a key while keeping the map under a cap (drop the oldest entry). */
function setCapped<T>(map: Map<string, T>, key: string, value: T, cap = 200) {
  map.set(key, value);
  if (map.size > cap) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

async function fetchPreview(url: string): Promise<PreviewData | null> {
  if (previewCache.has(url)) return previewCache.get(url) || null;
  if (previewInflight.has(url)) return previewInflight.get(url)!;

  const inflight = (async () => {
    try {
      const res = await apiFetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      const preview: PreviewData | null =
        res.ok && data.success && data.preview ? data.preview : null;
      setCapped(previewCache, url, preview);
      return preview;
    } catch {
      setCapped(previewCache, url, null);
      return null;
    } finally {
      previewInflight.delete(url);
    }
  })();

  setCapped(previewInflight, url, inflight);
  return inflight;
}

interface LinkPreviewCardProps {
  url: string;
  /** Compact variant for comment threads / card views. */
  compact?: boolean;
}

export default function LinkPreviewCard({ url, compact }: LinkPreviewCardProps) {
  const [preview, setPreview] = useState<PreviewData | null | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    fetchPreview(url).then((p) => {
      if (mounted) setPreview(p);
    });
    return () => {
      mounted = false;
    };
  }, [url]);

  // No URL or no metadata — render nothing
  if (preview === null) return null;
  if (preview === undefined) {
    return (
      <div
        className={`w-full overflow-hidden rounded-xl border border-white/5 bg-zinc-900/60 ${compact ? "max-w-sm" : ""}`}
        aria-busy="true"
      >
        <div className="h-24 w-full shimmer-bg" />
        <div className="space-y-2 p-3">
          <div className="h-3 w-2/3 rounded shimmer-bg" />
          <div className="h-2.5 w-full rounded shimmer-bg" />
          <div className="h-2.5 w-1/2 rounded shimmer-bg" />
        </div>
      </div>
    );
  }

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`group block w-full overflow-hidden rounded-xl border border-white/5 bg-zinc-900/60 transition-colors hover:border-white/15 ${compact ? "max-w-sm" : ""}`}
    >
      {preview.image && (
        <div className="relative aspect-video w-full overflow-hidden bg-zinc-950">
          <img
            src={preview.image}
            alt={preview.title || "Link preview"}
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        </div>
      )}
      <div className="space-y-1 p-3">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {preview.favicon ? (
            <img
              src={preview.favicon}
              alt=""
              className="h-3.5 w-3.5 rounded-sm"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <Globe className="h-3 w-3" />
          )}
          <span className="truncate">{preview.siteName || displayUrl(preview.url)}</span>
        </div>
        <h4 className="line-clamp-2 text-[12px] font-bold leading-snug text-zinc-100 group-hover:text-white transition-colors">
          {preview.title || displayUrl(preview.url)}
        </h4>
        {preview.description && !compact && (
          <p className="line-clamp-2 text-[11px] leading-snug text-zinc-400">
            {preview.description}
          </p>
        )}
        <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
          <ExternalLink className="h-2.5 w-2.5" />
          <span className="truncate">{displayUrl(preview.url)}</span>
        </span>
      </div>
    </a>
  );
}
