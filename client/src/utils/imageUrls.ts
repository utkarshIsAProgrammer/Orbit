/**
 * Rewrite a Cloudinary URL into a width-scaled, auto-optimized image.
 *
 * Two URL shapes exist in this codebase:
 *
 * 1. RAW upload URLs — `.../image/upload/v<version>/<id>` (chat/community
 *    media uploads carry NO transformation, so they are stored at full
 *    original resolution). We append `w_<width>,q_auto,f_auto` so the CDN
 *    serves a downscaled WebP/AVIF file — often 10-20x smaller.
 *
 * 2. BAKED URLs — `.../image/upload/c_limit,w_800,h_800,q_auto,f_auto/v…`
 *    (posts, avatars, banners get the transform applied at upload time and it
 *    is baked into the stored URL). We must NOT stack a second transform
 *    chain on top; instead we swap the existing width to what the render
 *    actually needs (e.g. a 40px avatar stops serving the upload-size image).
 *
 * - `w_<width>`: request only the pixels the surface actually needs
 * - `q_auto`: optimal quality (40-80% bandwidth reduction)
 * - `f_auto`: best format for the browser (WebP/AVIF/JPEG)
 */
/**
 * Cloudinary video → poster thumbnail URL.
 *
 * Cloudinary renders ANY frame of a video as an image via the
 * `so_<offset>`,w_<width>,f_jpg transform on the `video/upload` marker — a
 * few-KB jpg instead of the full video file. Media-library grid tiles use
 * this as `poster` with `preload="none"`, so browsing photos/videos never
 * downloads video bytes until the user actually taps play.
 *
 * Falls back to the original URL for non-Cloudinary hosts (the browser then
 * just loads video metadata as before).
 */
export function videoPosterUrl(
	url: string | undefined | null,
	width = 400,
	offsetSec = 0,
): string {
	if (!url) return "";
	if (!url.includes("cloudinary.com")) return url;
	const marker = "/video/upload/";
	const markerIdx = url.indexOf(marker);
	if (markerIdx === -1) return url;
	return (
		url.slice(0, markerIdx) +
		`/image/upload/so_${offsetSec},w_${width},f_jpg,q_auto/` +
		url.slice(markerIdx + marker.length)
	);
}

export function optimizeImageUrl(url: string | undefined | null, width = 96): string {
	if (!url) return "";
	// Only Cloudinary-hosted files can be re-transformed on the fly.
	if (!url.includes("cloudinary.com")) return url;
	// Animated GIFs: q_auto/f_auto can strip or degrade the animation, so
	// leave them at original resolution.
	if (/\.gif(\.gif)?(\?|$)/i.test(url)) return url;

	const marker = "/image/upload/";
	const markerIdx = url.indexOf(marker);
	if (markerIdx === -1) return url;

	const after = url.slice(markerIdx + marker.length);
	const slashIdx = after.indexOf("/");
	const segment = slashIdx === -1 ? after : after.slice(0, slashIdx);

	// Raw URL: `v<version>` (or a version-less public id) — no transform yet.
	// Transform segments are `key_value` pairs chained with commas (e.g.
	// c_limit,w_800,q_auto,f_auto). Only treat a segment as baked if it
	// actually parses as one or more transform params — never guess from a
	// bare underscore (a version-less id like `my_photo.jpg` must stay raw).
	const isBaked =
		segment.includes(",") || /^[a-z]+_[^/,]+(,[a-z]+_[^/,]+)*$/.test(segment);
	if (!isBaked) {
		return url.replace(marker, `${marker}w_${width},q_auto,f_auto/`);
	}

	// Baked URL: swap the existing width (keep the rest of the chain, e.g.
	// crop/quality/format) so we never double-transform.
	const parts = segment.split(",");
	const hasWidth = parts.some((p) => /^w_\d+/.test(p));
	const newSegment = hasWidth
		? parts.map((p) => (/^w_\d+/.test(p) ? `w_${width}` : p)).join(",")
		: [...parts, `w_${width}`].join(",");
	return (
		url.slice(0, markerIdx + marker.length) +
		newSegment +
		url.slice(markerIdx + marker.length + segment.length)
	);
}
