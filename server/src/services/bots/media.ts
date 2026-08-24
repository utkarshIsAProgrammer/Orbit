/**
 * media.ts — free, content-safe media for bot posts and glances.
 *
 * Bots should post like real people on Instagram/Reddit/X: photos, galleries,
 * GIFs, videos and text — not just walls of text. Every URL below is:
 *   • free (no API key)
 *   • verified live (HTTP 200 + correct content type)
 *   • content-safe (checked — no random/unvetted media)
 *
 * Sources:
 *   images  → picsum.photos (seeded, deterministic real photos)
 *   gifs    → Giphy CDN (curated ids, each verified via Giphy's oEmbed title)
 *   videos  → MDN CC0 clips, W3C Sintel trailer, test-videos.co.uk
 */

import { mulberry32 } from "./identity";
import type { BotPersona } from "./types";

/** Curated, verified-safe Giphy GIFs (each id checked against the CDN — all
 *  return HTTP 200 and are evergreen, content-safe reaction GIFs). */
const GIF_IDS = [
  "11sBLVxNs7v6WA",
  "3o7abKhOpu0NwenH3O",
  "JIX9t2j0ZTN9S",
  "3oEjI6SIIHBdRxXI40",
  "3o7TKtnuHOHHUjR38Y",
  "l3q2K5jinAlChoCLS",
  "26BRuo6sLetdllPAQ",
  "l0MYt5jPR6QX5pnqM",
  "26ufdipQqU2lhNA4g",
  "3o7TKUM3IgJBX2as9O",
  "xTiTnxpQ3ghPiB2Hp6",
  "3o7aCTPPm4OHfRLSH6",
  "13HgwGsXF0aiGY",
];

/** Verified, playable free videos (stable CDNs, no key). */
const VIDEO_URLS = [
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4",
  "https://media.w3.org/2010/05/sintel/trailer.mp4",
  "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4",
  "https://test-videos.co.uk/vids/jellyfish/mp4/h264/360/Jellyfish_360_10s_1MB.mp4",
  "https://test-videos.co.uk/vids/sintel/mp4/h264/360/Sintel_360_10s_1MB.mp4",
];

/** Topics that read as visual — these bots post photos far more often. */
const VISUAL_TOPICS = new Set(["photography", "nature", "travel", "fashion", "food", "art"]);
/** Topics that read as playful — these bots post GIFs far more often. */
const FUN_TOPICS = new Set(["gaming", "movies", "music", "anime"]);

export function gifUrl(seed: string): string {
  const rand = mulberry32(hash(`${seed}-gif`));
  const id = GIF_IDS[Math.floor(rand() * GIF_IDS.length)] as string;
  return `https://media.giphy.com/media/${id}/giphy.gif`;
}

export function videoUrl(seed: string): string {
  const rand = mulberry32(hash(`${seed}-video`));
  return VIDEO_URLS[Math.floor(rand() * VIDEO_URLS.length)] as string;
}

/** Deterministic real photo (picsum). */
export function imageUrl(seed: string, w: number, h: number): string {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;
}

export interface PostMedia {
  image?: { url: string; public_id: string };
  images?: { url: string; public_id: string }[];
  video?: { url: string; public_id: string };
}

/** What kind of media got attached — lets the brain write a matching caption. */
export type MediaKind = "photo" | "gallery" | "gif" | "video" | "none";

export interface PickedMedia extends PostMedia {
  kind: MediaKind;
}

/**
 * Pick media for a feed post, weighted by the bot's interest topic so the
 * feed feels alive like Instagram/Reddit/X. The returned `kind` tells the
 * brain WHICH caption pool to draw from, so text and media always relate:
 * a photo gets a photo caption, a video gets a video caption, and topic
 * templates are only used for text-only posts.
 *
 * Video is now a real share (12-15%) — before it was 0% on visual topics
 * and 6-7% elsewhere, which is why the feed felt video-less.
 */
export function pickPostMedia(persona: BotPersona, topic: string, rand: () => number): PickedMedia {
  // Full timestamp in the seed so two posts from the same bot can never get
  // the same image again (Date.now() % 100000 repeated every 100 seconds).
  const seed = `${persona.botId}-${Date.now()}`;
  const visual = VISUAL_TOPICS.has(topic);
  const fun = FUN_TOPICS.has(topic);
  const r = rand();

  if (visual) {
    // visual topics: 40% photo, 12% gallery, 8% gif, 12% video, rest text
    if (r < 0.4) {
      return { kind: "photo", image: { url: imageUrl(`${seed}-a`, 1080, 1350), public_id: "" } };
    }
    if (r < 0.52) {
      const n = 2 + Math.floor(rand() * 3); // 2-4 images
      return {
        kind: "gallery",
        images: Array.from({ length: n }, (_, i) => ({
          url: imageUrl(`${seed}-g${i}`, 1080, 1080),
          public_id: "",
        })),
      };
    }
    if (r < 0.6) return { kind: "gif", image: { url: gifUrl(seed), public_id: "" } };
    if (r < 0.72) return { kind: "video", video: { url: videoUrl(seed), public_id: "" } };
    return { kind: "none" };
  }

  if (fun) {
    // playful topics: 18% gif, 18% photo, 5% gallery, 15% video, rest text
    if (r < 0.18) return { kind: "gif", image: { url: gifUrl(seed), public_id: "" } };
    if (r < 0.36) return { kind: "photo", image: { url: imageUrl(`${seed}-a`, 1080, 1350), public_id: "" } };
    if (r < 0.41) {
      const n = 2 + Math.floor(rand() * 3);
      return {
        kind: "gallery",
        images: Array.from({ length: n }, (_, i) => ({
          url: imageUrl(`${seed}-g${i}`, 1080, 1080),
          public_id: "",
        })),
      };
    }
    if (r < 0.56) return { kind: "video", video: { url: videoUrl(seed), public_id: "" } };
    return { kind: "none" };
  }

  // generic: 26% photo, 8% gallery, 8% gif, 12% video, rest text
  if (r < 0.26) return { kind: "photo", image: { url: imageUrl(`${seed}-a`, 1080, 1350), public_id: "" } };
  if (r < 0.34) {
    const n = 2 + Math.floor(rand() * 3);
    return {
      kind: "gallery",
      images: Array.from({ length: n }, (_, i) => ({
        url: imageUrl(`${seed}-g${i}`, 1080, 1080),
        public_id: "",
      })),
    };
  }
  if (r < 0.42) return { kind: "gif", image: { url: gifUrl(seed), public_id: "" } };
  if (r < 0.54) return { kind: "video", video: { url: videoUrl(seed), public_id: "" } };
  return { kind: "none" };
}

/** Pick media for a chat DM attachment (mirrors the Message attachment
 *  schema: url + type). 60% GIF (the verified-safe reaction pool), 40%
 *  photo — real friends send GIFs and pics in DMs all the time. */
export function pickChatMedia(seed: string): { url: string; type: "gif" | "image"; public_id: string } {
  const rand = mulberry32(hash(`${seed}-chat`));
  if (rand() < 0.6) {
    const id = GIF_IDS[Math.floor(rand() * GIF_IDS.length)] as string;
    return { url: `https://media.giphy.com/media/${id}/giphy.gif`, type: "gif", public_id: "" };
  }
  return { url: imageUrl(`${seed}-chat`, 720, 720), type: "image", public_id: "" };
}

/** Pick media for a 24h glance: 50% photo, 25% GIF, 25% video. */
export function pickGlimpseMedia(botId: string, rand: () => number): { url: string; mediaType: "image" | "video" } {
  const seed = `${botId}-${Date.now()}`;
  const r = rand();
  if (r < 0.25) return { url: gifUrl(seed), mediaType: "image" };
  if (r < 0.5) return { url: videoUrl(seed), mediaType: "video" };
  return { url: imageUrl(seed, 720, 1280), mediaType: "image" };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
