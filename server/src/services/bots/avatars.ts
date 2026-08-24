/**
 * avatars.ts — profile picture + banner variety for bots.
 *
 * Bots are no longer all real-person photos. Every bot is assigned one of
 * three avatar styles (weighted):
 *
 *   • photo — a real human portrait (randomuser.me free pool, gender-matched)
 *   • art   — an illustrated character (DiceBear, free + deterministic,
 *             gender-appropriate style pools so a female bot still looks female)
 *   • gif   — an animated clip (a small curated set of safe, verified Giphy
 *             GIFs — the app supports GIF profiles)
 *
 * Banners mix the country photo (picsum) with illustrated art (DiceBear
 * shapes/rings/thumbs) so profiles don't all look alike.
 */

import type { Gender } from "./identity";
import { mulberry32, pick } from "./identity";
import type { CountryProfile } from "./countries";

export type AvatarStyle = "photo" | "art" | "gif";

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Real human portrait, gender-indexed (randomuser.me free pool). */
function photoAvatar(gender: Gender, seed: number): string {
  const idx = ((seed % 100) + 100) % 100;
  const folder = gender === "female" ? "women" : "men";
  return `https://randomuser.me/api/portraits/${folder}/${idx}.jpg`;
}

// Illustrated character styles (DiceBear v9 — free, no key, deterministic per
// seed). Style pools are gender-matched so identity stays consistent.
const ART_FEMALE = ["lorelei", "avataaars", "micah", "notionists", "open-peeps"];
const ART_MALE = ["adventurer", "avataaars", "micah", "notionists", "open-peeps"];
const ART_BG = ["b6e3f4", "c0aede", "d1d4f9", "ffd5dc", "ffdfbf", "d1f4d9"];

function artAvatar(gender: Gender, seed: string): string {
  const rand = mulberry32(hash(`${seed}-art`));
  const style = pick(rand, gender === "female" ? ART_FEMALE : ART_MALE);
  const bg = ART_BG[Math.floor(rand() * ART_BG.length)] as string;
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${bg}`;
}

// Curated animated GIFs — every id verified live via Giphy's public oEmbed
// endpoint (titles: "Happy So Excited", "SpongeBob Yes", "Cat Working",
// "Processing Buffering") so nothing inappropriate or broken ships.
const GIF_AVATARS = [
  "11sBLVxNs7v6WA", // Happy So Excited
  "3o7abKhOpu0NwenH3O", // SpongeBob "Yes!"
  "JIX9t2j0ZTN9S", // Cat Working
  "3oEjI6SIIHBdRxXI40", // Buffering (tiny, ideal)
];

function gifAvatar(seed: string): string {
  const rand = mulberry32(hash(`${seed}-gif`));
  const id = GIF_AVATARS[Math.floor(rand() * GIF_AVATARS.length)] as string;
  return `https://media.giphy.com/media/${id}/giphy.gif`;
}

/**
 * Pick an avatar for a bot. Weighted: 55% real photo, 25% illustrated
 * character, 20% GIF. Deterministic per seed (botId) so a bot keeps the
 * same avatar forever.
 */
export function buildBotAvatar(gender: Gender, seed: string): { url: string; style: AvatarStyle } {
  const rand = mulberry32(hash(`${seed}-avatar`));
  const roll = rand();
  if (roll < 0.55) {
    return { url: photoAvatar(gender, Math.floor(rand() * 100)), style: "photo" };
  }
  if (roll < 0.8) {
    return { url: artAvatar(gender, seed), style: "art" };
  }
  return { url: gifAvatar(seed), style: "gif" };
}

/** Abstract illustrated banner art (DiceBear). */
function artBanner(seed: string): string {
  const rand = mulberry32(hash(`${seed}-banner`));
  const style = pick(rand, ["shapes", "rings", "thumbs"]);
  const bg = ART_BG[Math.floor(rand() * ART_BG.length)] as string;
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${bg}`;
}

/**
 * Pick a profile banner: 70% the country photo (picsum), 30% illustrated art
 * so banners have variety too.
 */
export function buildBotBanner(seed: string, country: CountryProfile): string {
  const rand = mulberry32(hash(`${seed}-bannerstyle`));
  if (rand() < 0.7) return country.bannerUrl;
  return artBanner(seed);
}
