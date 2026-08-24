import { fetchJson, storeExternalPosts, stripHtml, stripMarkdown, type NormalizedExternalPost } from "./normalizer";
import { logger } from "../../utilities/logger";

/**
 * Lemmy sync — the v3 REST API is fully public & anonymous.
 *
 *   GET {instance}/api/v3/post/list?type_=Local&sort=Hot&limit=20
 *
 * Hot + TopDay give a solid mix of active discussions and evergreen content.
 * A few of the biggest instances keep the pool populated even when one is down.
 */

const INSTANCES = ["https://lemmy.ml", "https://lemmy.world", "https://sh.itjust.works"];

export async function syncLemmy(): Promise<number> {
  let total = 0;
  const sorts = ["Hot", "TopDay"];
  for (let i = 0; i < sorts.length; i++) {
    const sort = sorts[i];
    const instance = INSTANCES[i % INSTANCES.length];
    try {
      // Bump the request size and keep only posts that actually carry media
      // (thumbnail_url) — text-only discussions are exactly the "noise" the
      // feed should not show. 3:1 over-fetch compensates for the filtering.
      const data = await fetchJson(
        `${instance}/api/v3/post/list?type_=Local&sort=${sort}&limit=60`
      );
      const posts: NormalizedExternalPost[] = (data?.posts || [])
        .filter((pv: any) => pv?.post?.thumbnail_url)
        .map((pv: any) => {
        const p = pv?.post || {};
        const creator = pv?.creator || {};
        const community = pv?.community || {};
        const media = p?.thumbnail_url
          ? [
              {
                url: p.thumbnail_url,
                previewUrl: p.thumbnail_url,
                type: "image" as const,
              },
            ]
          : [];
        const body = p?.body ? stripMarkdown(stripHtml(p.body)) : "";
        const content = [body, p?.url ? `🔗 ${p.url}` : ""].filter(Boolean).join("\n\n");
        return {
          source: "lemmy" as const,
          sourceId: String(p.id),
          url: p?.ap_id || `${instance}/post/${p.id}`,
          content: p?.name ? `${stripMarkdown(stripHtml(p.name))}\n\n${content}`.trim() : content,
          author: {
            handle: creator?.name || "unknown",
            displayName: creator?.display_name || creator?.name || "Lemmy user",
            avatar: creator?.avatar || "",
            profileUrl: creator?.actor_id || `${instance}/u/${creator?.name}`,
          },
          media,
          stats: {
            likes: pv?.counts?.upvotes || 0,
            reposts: 0,
            replies: pv?.counts?.comments || 0,
          },
          originalCreatedAt: new Date(p?.published || Date.now()),
        };
      });
      const { inserted } = await storeExternalPosts(posts);
      total += inserted;
    } catch (err: any) {
      logger.warn(`Lemmy sync failed (${sort}) on ${instance}`, {
        error: err?.message,
      });
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return total;
}
