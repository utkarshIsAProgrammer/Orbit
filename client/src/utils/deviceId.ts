// Stable per-browser device identity — used for the "new device login"
// security email. The id is generated once, persisted in localStorage, and
// sent with every login so the server can recognize returning browsers and
// alert the owner when a brand-new one signs in.

const STORAGE_KEY = "orbit_device_id";

const randomId = (): string => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers / non-secure contexts.
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

export const getDeviceId = (): string => {
  try {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    // localStorage unavailable (private mode / iframe) — a throwaway id is
    // fine; the server just sees an "unknown device" every time, which still
    // triggers the alert once per browser session. Never crash login over this.
    return randomId();
  }
};

// A short human-readable device label, e.g. "Chrome · Windows".
export const getDeviceLabel = (): string => {
  try {
    const ua = navigator.userAgent;
    const parts: string[] = [];
    if (/Edg\//.test(ua)) parts.push("Edge");
    else if (/Chrome\//.test(ua)) parts.push("Chrome");
    else if (/Firefox\//.test(ua)) parts.push("Firefox");
    else if (/Safari\//.test(ua)) parts.push("Safari");
    else if (/OPR\//.test(ua)) parts.push("Opera");

    if (/Windows/.test(ua)) parts.push("Windows");
    else if (/Mac OS X/.test(ua)) parts.push("macOS");
    else if (/Android/.test(ua)) parts.push("Android");
    else if (/iPhone|iPad/.test(ua)) parts.push("iOS");
    else if (/Linux/.test(ua)) parts.push("Linux");

    return parts.join(" · ") || "Browser";
  } catch {
    return "Browser";
  }
};
