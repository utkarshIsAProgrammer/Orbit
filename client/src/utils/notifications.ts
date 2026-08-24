import { logger } from "./logger";
import { apiFetch } from "./api";

export type NotificationPermissionState = "default" | "granted" | "denied" | "unsupported";

/**
 * Check the current push notification permission state.
 */
export function getNotificationPermission(): NotificationPermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

/**
 * Request push notification permission from the user.
 * Shows a native browser prompt.
 *
 * @returns The resulting permission state after the user responds
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      // Subscribe to push notifications after permission is granted
      await subscribeToPushNotifications();
    }
    return permission;
  } catch (err) {
    logger.error("Failed to request notification permission", err);
    return "denied";
  }
}

/**
 * Ensure the current device is subscribed to push notifications WITHOUT
 * prompting the user — only acts when permission is already granted.
 * Used on session restore (reload / re-login via cookie) so returning users
 * stay subscribed even though no new permission prompt appears.
 */
export async function ensurePushSubscription(): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (!("serviceWorker" in navigator)) return;

  try {
    const reg = await navigator.serviceWorker.ready;
    if (!reg) return;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      // Re-sync the (possibly stale) subscription with the backend so the
      // server keeps a fresh endpoint for this device.
      await sendSubscriptionToServer(existing);
      return;
    }
    await subscribeToPushNotifications();
  } catch (err) {
    logger.warn("[Push] ensurePushSubscription failed", err);
  }
}

/**
 * Convert a base64 URL-encoded string to a Uint8Array (for VAPID public key).
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

/**
 * Subscribe the current device to push notifications via the service worker.
 * This creates a PushSubscription and sends it to the backend for storage.
 */
async function subscribeToPushNotifications(): Promise<void> {
  try {
    // Check if service worker is active (PWA)
    const reg = await navigator.serviceWorker.ready;
    if (!reg) {
      logger.warn("[Push] Service worker not ready — push subscription skipped");
      return;
    }

    // Check if already subscribed
    const existingSubscription = await reg.pushManager.getSubscription();
    if (existingSubscription) {
      // Subscription exists — send it to backend if not already registered
      // The backend will deduplicate by endpoint
      await sendSubscriptionToServer(existingSubscription);
      return;
    }

    // Fetch the VAPID public key from the backend
    const res = await apiFetch("/api/push/vapid-key");
    if (!res.ok) {
      logger.warn("[Push] Could not fetch VAPID key — push subscription skipped");
      return;
    }
    const data = await res.json();
    if (!data.success || !data.publicKey) {
      logger.warn("[Push] No VAPID key configured on server — push subscription skipped");
      return;
    }

    const vapidPublicKey = data.publicKey as string;

    // Create a new subscription
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });

    await sendSubscriptionToServer(subscription);
    logger.info("[Push] Successfully subscribed to push notifications");
  } catch (err) {
    // Push subscription failed — common on HTTP-only sites (requires HTTPS or localhost)
    logger.warn("[Push] Failed to subscribe to push notifications", err);
  }
}

/**
 * Send the push subscription object to the backend for storage.
 */
async function sendSubscriptionToServer(subscription: PushSubscription): Promise<void> {
  try {
    await apiFetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
      }),
    });
  } catch (err) {
    logger.warn("[Push] Failed to register push subscription with server", err);
  }
}

/**
 * Show a browser push notification.
 *
 * @param title Notification title
 * @param options Optional Notification options (body, icon, etc.)
 */
export function showBrowserNotification(
  title: string,
  options?: NotificationOptions,
) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  try {
    new Notification(title, {
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      ...options,
    });
  } catch (err) {
    logger.error("Failed to show notification", err);
  }
}

/**
 * Check if the browser supports push notifications.
 */
export function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}
