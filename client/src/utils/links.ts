import { apiFetch } from "./api";

/** Extract the first http(s) URL from a text string. */
export function extractFirstUrl(text: string): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0].replace(/[),.;!?]+$/, "") : null;
}

/** Strip the protocol for compact display (e.g. "youtube.com/watch?v=…"). */
export function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname + (parsed.pathname !== "/" ? parsed.pathname : "");
  } catch {
    return url;
  }
}

// ── Translation (client-side cache, mirrors the server 24h cache) ──
const translationCache = new Map<string, TranslationResult>();
const translationInflight = new Map<string, Promise<TranslationResult | null>>();

/** Set a key while keeping the map under a cap (drop the oldest entry). */
function setCapped<T>(map: Map<string, T>, key: string, value: T, cap = 200) {
  map.set(key, value);
  if (map.size > cap) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

export interface TranslationResult {
  translatedText: string;
  detectedLanguage: string;
}

/**
 * Translate text to English via the server proxy (Google Translate backend).
 * Cached per unique text so repeat posts/comments are instant.
 */
export async function translateText(
  text: string,
  targetLanguage = "en",
): Promise<TranslationResult | null> {
  if (!text.trim()) return null;
  const key = `${targetLanguage}:${text}`;
  const cached = translationCache.get(key);
  if (cached) return cached;

  if (translationInflight.has(key)) return translationInflight.get(key)!;

  const inflight = (async () => {
    try {
      const res = await apiFetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, targetLanguage }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.translation?.translatedText) {
        const translated = data.translation.translatedText;
        const result: TranslationResult = {
          translatedText: translated,
          detectedLanguage: data.translation.detectedLanguage || "",
        };
        setCapped(translationCache, key, result);
        return result;
      }
      return null;
    } catch {
      return null;
    } finally {
      translationInflight.delete(key);
    }
  })();

  setCapped(translationInflight, key, inflight);
  return inflight;
}
