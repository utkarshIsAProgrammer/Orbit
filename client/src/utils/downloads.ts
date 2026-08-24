/**
 * Shared attachment download helpers — used by the message long-press menus
 * (Chat.tsx, Communities.tsx) and the inline file card (MessageBubble.tsx).
 */

/** Best-effort filename from attachment metadata or the URL path. */
export const getAttachmentFileName = (att: any): string => {
  if (att?.name) return att.name;
  try {
    const url = att?.url || "";
    const name = decodeURIComponent(url.split("?")[0].split("/").pop() || "");
    if (name) return name;
  } catch {
    /* ignore decode errors */
  }
  return "Download Attachment";
};

/**
 * Build the download href. Cloudinary originals 401 on this account's delivery
 * CDN, so route those through the server proxy (/api/files/download) which
 * fetches via Cloudinary's authenticated admin API. ImageKit URLs are fine.
 */
export const getFileDownloadHref = (att: any): string => {
  const url = att?.url || "";
  if (url.includes("res.cloudinary.com") || url.includes("cloudinary.com")) {
    const params = new URLSearchParams({ url });
    const name = getAttachmentFileName(att);
    if (name !== "Download Attachment") params.set("filename", name);
    return `/api/files/download?${params.toString()}`;
  }
  return url;
};

/**
 * Trigger a real file download for an attachment (image / video / file).
 *
 * Downloads the blob first so the browser saves the file (works even for
 * cross-origin media — the proxy endpoint streams with Content-Disposition).
 * If the blob fetch fails (CORS etc.), falls back to opening the URL in a new
 * tab instead of navigating the chat away.
 */
export const downloadAttachment = async (att: any): Promise<void> => {
  const href = getFileDownloadHref(att);
  const fileName = getAttachmentFileName(att);
  const finalName = fileName === "Download Attachment" ? "download" : fileName;

  try {
    const res = await fetch(href);
    if (res.ok) {
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = finalName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      return;
    }
  } catch {
    /* fall through to anchor fallback */
  }

  const a = document.createElement("a");
  a.href = href;
  a.download = finalName;
  a.rel = "noopener";
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};
