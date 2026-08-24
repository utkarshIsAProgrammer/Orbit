// Device detection for call-quality tuning.
//
// Calls must behave differently on phones: mobile CPUs are weaker, camera
// sensors are lower-power, and cellular upload bandwidth is a fraction of
// what a laptop on fiber gets. Every quality knob (codec, resolution,
// bitrate) reads `isMobileDevice()` so phones get hardware-encoded H.264 at
// a modest resolution/bitrate while desktops keep the full VP9/HD path.

const MOBILE_UA =
	/Android|iPhone|iPad|iPod|Mobile|Silk|BlackBerry|IEMobile|Opera Mini/i;

const TABLET_UA = /iPad|Tablet|PlayBook|Silk/i;

/** True on phones AND tablets (iOS Safari reports iPads as Macs, so also check touch + small screen). */
export const isMobileDevice = (): boolean => {
	try {
		if (typeof navigator === "undefined") return false;
		const ua = navigator.userAgent || "";
		if (MOBILE_UA.test(ua)) return true;
		// iPadOS 13+ reports a Mac user agent — a touch device with a small
		// viewport is a tablet, which gets the same bandwidth-friendly path.
		if (TABLET_UA.test(ua)) return true;
		if (navigator.maxTouchPoints > 1 && window.innerWidth <= 1024) {
			return true;
		}
		return false;
	} catch {
		return false;
	}
};
