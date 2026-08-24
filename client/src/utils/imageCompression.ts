/**
 * Shared image downscaler — used before uploading photos anywhere in the app
 * (post composer, inline feed composer, edit-post drawer, chats).
 *
 * Large photos are resized so their longest side is at most `maxDim` pixels
 * and re-encoded (JPEG for photos, PNG kept as PNG so transparency survives).
 * GIFs pass through untouched to keep their animation, and any image that
 * can't be decoded is returned unchanged.
 *
 * Feeds render at a few hundred px wide and the server downscales post images
 * to ≤800px anyway, so 1600px is already ~2× sharpness — uploads stay tiny
 * and publishing feels instant.
 */
export async function downscaleImageFile(
  file: File,
  maxDim = 1600,
  quality = 0.85,
): Promise<File> {
  // Animated GIFs keep their animation — pass through untouched.
  if (file.type === "image/gif") return file;

  let url = "";
  try {
    url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new window.Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("image decode failed"));
      i.src = url;
    });

    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    // Already small enough — return the original untouched (no re-encode cost).
    if (longest <= maxDim) return file;

    const scale = maxDim / longest;
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.drawImage(img, 0, 0, w, h);

    // Preserve PNG transparency; photos become JPEG.
    const outType = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(
        resolve,
        outType,
        outType === "image/png" ? undefined : quality,
      ),
    );
    if (!blob) return file;

    const base = file.name.replace(/\.[^.]+$/, "") || "image";
    const ext = outType === "image/png" ? "png" : "jpg";
    return new File([blob], `${base}.${ext}`, { type: outType });
  } catch {
    return file; // fall back to the original file
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}
