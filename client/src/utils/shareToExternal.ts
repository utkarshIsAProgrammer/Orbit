import { logger } from "./logger";

interface ShareData {
  title?: string;
  text?: string;
  url?: string;
}

/**
 * Share content to external platforms using the Web Share API.
 * Falls back to copying the URL to clipboard when Web Share is unavailable.
 *
 * @returns Whether the share was successful
 */
export async function shareToExternal(data: ShareData): Promise<boolean> {
  const { title, text, url } = data;

  // Try Web Share API first (mobile browsers, modern desktop)
  if (typeof navigator !== "undefined" && "share" in navigator) {
    try {
      await navigator.share({
        title: title || "Check this out on ORBIT",
        text: text || undefined,
        url: url || window.location.href,
      });
      return true;
    } catch (err: unknown) {
      // AbortError means user cancelled — not a failure
      if (err instanceof DOMException && err.name === "AbortError") {
        return false;
      }
      logger.warn("Web Share API failed, falling back to clipboard", err);
    }
  }

  // Fallback: copy to clipboard
  try {
    const shareUrl = url || window.location.href;
    const shareText = text ? `${text}\n\n${shareUrl}` : shareUrl;
    await navigator.clipboard.writeText(shareText);
    return true;
  } catch (err) {
    logger.error("Clipboard fallback failed", err);
    window.dispatchEvent(
      new CustomEvent("showToast", {
        detail: {
          message: "Could not share. Try copying manually.",
          type: "error",
        },
      }),
    );
    return false;
  }
}

/**
 * Specific helper to share a post to external platforms.
 */
export function sharePostToExternal(slug: string) {
  const url = `${window.location.origin}/post/${slug}`;
  return shareToExternal({
    url,
  });
}
