import { v2 as cloudinary } from "cloudinary";
import { env } from "./env";

cloudinary.config({
  cloud_name: env.CLOUDINARY_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Helper to append auto-optimization params to any existing Cloudinary URL.
 *
 * Upload middleware already adds `quality: "auto"` and `fetch_format: "auto"`
 * during image upload. This helper is for retroactively optimizing URLs
 * already stored in the database (e.g. user profile pics, old post images).
 *
 * - `q_auto`: Automatically selects optimal quality (40-80% bandwidth reduction)
 * - `f_auto`: Serves best format (WebP, AVIF, etc.) based on browser support
 */
export function optimizeImageUrl(url: string, width?: number): string {
  if (!url || !url.includes("cloudinary.com")) return url;
  // Insert transformation into Cloudinary URL: /image/upload/ → /image/upload/w_auto,q_auto,f_auto/
  return url.replace(
    "/image/upload/",
    width
      ? `/image/upload/w_${width},q_auto,f_auto/`
      : "/image/upload/w_auto,q_auto,f_auto/",
  );
}

export default cloudinary;
