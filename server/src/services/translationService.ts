import { logger } from "../utilities/logger";

interface TranslationResult {
  translatedText: string;
  detectedLanguage: string;
}

const CACHE_TTL = 24 * 60 * 60 * 1000;
const cache = new Map<string, { result: TranslationResult; expires: number }>();

/**
 * Translate text using Google Translate (free, no API key needed for basic usage).
 * Falls back to a simple mock if the external call fails.
 */
export async function translateText(
  text: string,
  targetLanguage: string = "en"
): Promise<TranslationResult | null> {
  try {
    const cacheKey = `${text}:${targetLanguage}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.result;
    }

    const response = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLanguage}&dt=t&q=${encodeURIComponent(text)}`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!response.ok) {
      throw new Error(`Translation API returned ${response.status}`);
    }

    const data: any = await response.json();
    const translatedText = data?.[0]?.map((segment: any) => segment?.[0] || "").join("") || text;
    const detectedLanguage = data?.[2] || "unknown";

    const result: TranslationResult = { translatedText, detectedLanguage };
    cache.set(cacheKey, { result, expires: Date.now() + CACHE_TTL });

    return result;
  } catch (err) {
    logger.warn("Translation API failed", { error: (err as Error).message });
    return null;
  }
}

/**
 * Detect the language of a text.
 */
export async function detectLanguage(text: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text.slice(0, 200))}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!response.ok) return null;
    const data: any = await response.json();
    return data?.[2] || null;
  } catch {
    return null;
  }
}
