import { fetchJson, storeExternalPosts, type NormalizedExternalPost } from "./normalizer";

import { logger } from "../../utilities/logger";

/**
 * Bluesky sync — uses the public AppView API (no auth required).
 *
 *   GET https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=…&limit=…
 *   GET https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=…   (best-effort)
 *
 * `getAuthorFeed` is reliably anonymous; `searchPosts` is sometimes
 * IP-blocked, so we treat it as a bonus and never fail the cycle on it.
 * Fetching a pool of well-known creators keeps the Web tab fresh with
 * evergreen, high-signal content across topics.
 */

const PUBLIC_API = "https://public.api.bsky.app";

// Curated creator pool (handles work, no app password needed for public reads)
export const CREATORS = [
  "bsky.app",
  "nasa.gov",
  "bbcnews.bsky.social",
  "theverge.com",
  "nytimes.com",
  "natgeo.com",
  "wikipedia.org",
  "natfriedman.dev",
  "9to5mac.com",
  "noamcat.dev",
  "scottaaronson.blog",
  "drewis.bsky.social",
];

const SEARCH_QUERIES = ["technology", "art", "music", "science", "photography", "design", "space"];

/**
 * Extract CDN image/video URLs from a Bluesky embed.
 * The Bsky CDN resolves blobs by DID + CID, so we need the author's DID.
 * Exported for reuse by the live firehose consumer.
 */
export function extractMedia(embed: any, authorDid: string): { url: string; previewUrl: string; type: string }[] {
  const out: { url: string; previewUrl: string; type: string }[] = [];
  if (!embed || typeof embed !== "object") return out;

  const cdnUrl = (mimeOrKind: string, cid: string, size: "feed_fullsize" | "feed_thumbnail" | "avatar") =>
    `https://cdn.bsky.app/img/${size}/plain/${authorDid}/${cid}@${
      mimeOrKind === "video/mp4" ? "jpeg" : "jpeg"
    }`;

  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.$type === "app.bsky.embed.images" && Array.isArray(node.images)) {
      node.images.forEach((img: any) => {
        const ref = img?.image?.ref?.$link || img?.image?.ref?.cid;
        if (ref) {
          out.push({
            url: cdnUrl(img?.image?.mimeType || "image/jpeg", ref, "feed_fullsize"),
            previewUrl: cdnUrl(img?.image?.mimeType || "image/jpeg", ref, "feed_thumbnail"),
            type: "image",
          });
        }
      });
      return;
    }
    if (node.$type === "app.bsky.embed.video") {
      const ref = node.video?.ref?.$link;
      if (ref) {
        out.push({
          url: `https://video.bsky.app/watch/${ref}`,
          previewUrl: node.thumbnail?.ref?.$link
            ? cdnUrl("image/jpeg", node.thumbnail.ref.$link, "feed_thumbnail")
            : "",
          type: "video",
        });
      }
      return;
    }
    if (node.$type === "app.bsky.embed.external" && node.external?.thumb) {
      const ref = node.external.thumb.ref?.$link || node.external.thumb;
      out.push({ url: ref, previewUrl: ref, type: "image" });
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === "uri" || key === "cid") continue;
      walk(node[key]);
    }
  };
  walk(embed);
  return out;
}

function normalizePost(p: any): NormalizedExternalPost | null {
  const post = p?.post || p;
  const author = post?.author || {};
  if (!post?.uri) return null;
  const did = author?.did || "";
  const uriParts = (post.uri as string).split("/");
  const rkey = uriParts[uriParts.length - 1];
  const text = post?.record?.text || post?.text || "";
  if (!text) return null;
  return {
    source: "bluesky" as const,
    sourceId: post.uri,
    url: `https://bsky.app/profile/${encodeURIComponent(author?.handle || did)}/post/${rkey}`,
    content: text,
    author: {
      handle: author?.handle || "unknown",
      displayName: author?.displayName || author?.handle || "Bluesky user",
      avatar: author?.avatar || "",
      profileUrl: author?.handle ? `https://bsky.app/profile/${encodeURIComponent(author.handle)}` : "",
    },
    media: extractMedia(post?.embed, did),
    stats: {
      likes: post?.likeCount || 0,
      reposts: post?.repostCount || 0,
      replies: post?.replyCount || 0,
    },
    originalCreatedAt: new Date(post?.indexedAt || post?.record?.createdAt || Date.now()),
  };
}

export async function syncBluesky(): Promise<number> {
  let total = 0;

  // 1) Featured creators (primary — reliably anonymous)
  for (const handle of CREATORS) {
    try {
      const data = await fetchJson(
        `${PUBLIC_API}/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(
          handle
        )}&limit=8&filter=posts_and_author_threads`
      );
      const posts = (data?.feed || [])
        .map(normalizePost)
        .filter((p: NormalizedExternalPost | null): p is NormalizedExternalPost => p !== null);
      const { inserted } = await storeExternalPosts(posts);
      total += inserted;
    } catch (err: any) {
      logger.warn(`Bluesky sync failed for @${handle}`, { error: err?.message });
    }
    await new Promise((r) => setTimeout(r, 900));
  }

  // 2) Topic search (best-effort — sometimes IP-blocked, never fatal)
  for (const query of SEARCH_QUERIES) {
    try {
      const data = await fetchJson(
        `${PUBLIC_API}/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=10&sort=latest`
      );
      const posts = (data?.posts || [])
        .map(normalizePost)
        .filter((p: NormalizedExternalPost | null): p is NormalizedExternalPost => p !== null);
      const { inserted } = await storeExternalPosts(posts);
      total += inserted;
    } catch (err: any) {
      // silent — known to be blocked from some IPs
      logger.debug(`Bluesky search "${query}" skipped (${(err as Error).message})`);
    }
    await new Promise((r) => setTimeout(r, 900));
  }

  return total;
}
