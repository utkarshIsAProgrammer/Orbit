import { fetchJson, storeExternalPosts, stripHtml, toMediaType, type NormalizedExternalPost } from "./normalizer";
import { logger } from "../../utilities/logger";

/**
 * Mastodon sync — per-hashtag timelines are readable anonymously on most
 * instances (the instance-wide public timeline often requires auth).
 *
 *   GET {instance}/api/v1/timelines/tag/{tag}?limit=40&only_media=true
 *
 * `only_media=true` returns ONLY posts with image/video attachments — the
 * single biggest free source of media-rich real posts (the tags are chosen
 * to be visual). We rotate across a small set of federated instances so no
 * single instance bears the whole load, and drop results when one is down
 * or rate-limited.
 */

const INSTANCES = ["https://mastodon.social", "https://mastodon.online", "https://mstdn.social"];

const TAGS = [
  "photography",
  "art",
  "nature",
  "architecture",
  "travel",
  "food",
  "videography",
  "animals",
];

export async function syncMastodon(): Promise<number> {
  let total = 0;
  // Round-robin instances across tags so each request hits a different server.
  for (let i = 0; i < TAGS.length; i++) {
    const tag = TAGS[i] as string;
    const instance = INSTANCES[i % INSTANCES.length] as string;
    try {
      const statuses = await fetchJson(
        `${instance}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=40&only_media=true`
      );
      const posts: NormalizedExternalPost[] = (Array.isArray(statuses) ? statuses : [])
        .filter((s: any) => s && s.account)
        .map((s: any) => {
          const acct = s.account || {};
          const media = (s.media_attachments || []).map((m: any) => ({
            url: m?.url || "",
            previewUrl: m?.preview_url || m?.url || "",
            type: toMediaType(m?.type),
          }));
          return {
            source: "mastodon" as const,
            sourceId: String(s.id),
            url: s.url || `${instance}/@${String(acct.username)}/${s.id}`,
            content: stripHtml(s.content || ""),
            author: {
              handle: String(acct.acct || acct.username || "unknown"),
              displayName: String(acct.display_name || acct.username || "Mastodon user"),
              avatar: String(acct.avatar || ""),
              profileUrl: String(acct.url || `${instance}/@${String(acct.username)}`),
            },
            media,
            stats: {
              likes: s.favourites_count || 0,
              reposts: s.reblogs_count || 0,
              replies: s.replies_count || 0,
            },
            originalCreatedAt: new Date(s.created_at || Date.now()),
          };
        });
      const { inserted } = await storeExternalPosts(posts);
      total += inserted;
    } catch (err: any) {
      logger.warn(`Mastodon sync failed for #${tag} on ${instance}`, {
        error: err?.message,
      });
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return total;
}
