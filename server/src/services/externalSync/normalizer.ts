import ExternalPost from "../../models/externalPost.model";
import { logger } from "../../utilities/logger";

export type ExternalSource = "bluesky" | "mastodon" | "lemmy";

export interface NormalizedExternalPost {
  source: ExternalSource;
  sourceId: string;
  url: string;
  content: string;
  author: {
    handle: string;
    displayName: string;
    avatar: string;
    profileUrl: string;
  };
  media: { url: string; previewUrl: string; type: string }[];
  stats: { likes: number; reposts: number; replies: number };
  originalCreatedAt: Date;
}

const MEDIA_TYPES = ["image", "video", "gifv"] as const;

export function toMediaType(t: string | undefined): string {
  if (!t) return "image";
  return MEDIA_TYPES.includes(t as (typeof MEDIA_TYPES)[number]) ? t : "image";
}

/**
 * Persist normalized posts, deduplicating on (source + sourceId) via upsert.
 * Returns the count of freshly inserted posts.
 */
export async function storeExternalPosts(
  posts: NormalizedExternalPost[]
): Promise<{ inserted: number; total: number }> {
  if (posts.length === 0) return { inserted: 0, total: 0 };
  let inserted = 0;
  try {
    const ops = posts.map((p) => ({
      updateOne: {
        filter: { dedupKey: `${p.source}:${p.sourceId}` },
        update: { $setOnInsert: p } as any,
        upsert: true,
      },
    }));
    const result = await ExternalPost.bulkWrite(ops, { ordered: false });
    inserted = result.upsertedCount || 0;
  } catch (err: any) {
    // 11000 = duplicate key race between concurrent sync runs — benign
    if (err?.code !== 11000) {
      logger.error("External sync bulk write failed", {
        error: err?.message,
      });
    }
  }
  return { inserted, total: posts.length };
}

/** Shared fetch helper with timeout + UA. */
export async function fetchJson(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 15000
): Promise<any> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Orbit/1.0 (open social feed syndicator)",
      Accept: "application/json",
      ...headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url.slice(0, 120)}`);
  }
  return res.json();
}

/** Strip basic markdown (bold/italic/links/code) to readable plain text. */
export function stripMarkdown(md: string): string {
  if (!md) return "";
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images → alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → label
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/\*([^*]+)\*/g, "$1") // italic
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/^>\s?/gm, "") // blockquotes
    .trim();
}

/** Strip HTML tags, collapse whitespace, keep @handles and #tags readable. */
export function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
