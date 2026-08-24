/* eslint-disable no-restricted-globals */
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// ─── Static precache (injected at build time by vite-plugin-pwa) ────
const __manifest = self.__WB_MANIFEST || [];
precacheAndRoute(__manifest);
cleanupOutdatedCaches();

// ─── App shell navigation fallback (SPA) ─────────────────────────
// Always serve the LATEST index.html from the network when online so the
// referenced hashed chunks are always the current ones. Only when offline
// do we fall back to the precached shell. This avoids the classic stale-SW
// failure where an old cached index.html references chunk hashes that a
// newer deployment no longer ships ("Failed to load ... A ServiceWorker
// intercepted the request and encountered an unexpected error").
const hasAppShell = __manifest.some((entry) =>
  typeof entry === 'string' ? entry === 'index.html' : entry?.url === 'index.html',
);
if (hasAppShell) {
  registerRoute(
    ({ request, url }) =>
      request.mode === 'navigate' &&
      url.origin === self.location.origin &&
      !url.pathname.startsWith('/api') &&
      !url.pathname.startsWith('/socket.io'),
    async ({ request }) => {
      // Normalize double slashes: a trailing-slash CLIENT_URL on the backend
      // can produce redirects like "//?oauth_success=true". Navigating to
      // that path goes through this handler — fetch it normalized so it
      // resolves instead of hitting the 503 fallback below.
      const rawUrl = request.url.replace(/([^:])\/\/+/g, '$1/');
      const normalized =
        rawUrl === request.url ? request : new Request(rawUrl, request);
      try {
        // Prefer a fresh shell from the network, but NEVER let a slow
        // connection stall a navigation: if the fresh shell hasn't arrived
        // within NAV_TIMEOUT_MS we abort the wait and render the precached
        // shell instantly (it references the current hashed chunks, so the
        // app still boots correctly). This is what makes every click / tab /
        // navigation feel instant even on cold or flaky networks — and when
        // online the fresh shell still wins on normal connections.
        const NAV_TIMEOUT_MS = 1800;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), NAV_TIMEOUT_MS);
        try {
          const fresh = await fetch(normalized, { signal: controller.signal });
          if (fresh.ok) return fresh;
        } finally {
          clearTimeout(timer);
        }
      } catch {
        /* timed out or offline — fall through to the precached shell below */
      }
      const cached = await caches.match('/index.html');
      if (cached) return cached;
      // If we're online but the shell is somehow missing, redirect to the
      // root rather than render a bare 503 (which Firefox shows as a blank
      // "Quirks Mode" error page).
      if (self.navigator && self.navigator.onLine) {
        return Response.redirect('/', 302);
      }
      return new Response('', {
        status: 503,
        headers: { 'Content-Type': 'text/html' },
      });
    },
  );
}

// ─── Runtime caching (same strategy as the previous generateSW config) ──
// NOTE: both runtime routes are GET-only. Workbox matches routes by URL
// regardless of request method, so without this guard PUT/POST/DELETE
// responses (e.g. the permissions save, chat deletions) would be written
// into the API cache too — polluting it with mutation bodies.
registerRoute(
  ({ request, url }) =>
    request.method === 'GET' &&
    /^\/api\/chats\/conversations\/.*\/messages/i.test(url.pathname),
  new NetworkFirst({
    cacheName: 'orbit-chat-messages',
    plugins: [
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 }),
    ],
    networkTimeoutSeconds: 3,
  }),
);

// Never cache an EMPTY membership list (/api/communities/mine,
// /api/chats/conversations). A stale "no communities / no chats" response
// makes those lists look permanently empty: the page's bypassCache option
// skips the app-level cache but CANNOT bypass this SW cache, so on a slow
// backend the SW keeps serving the empty list and the user never sees their
// communities/chats. Skipping empties means a fallback always waits for the
// network instead of serving a wrong-but-cached answer.
const skipEmptyMembershipLists = {
  cacheWillUpdate: async ({ request, response }) => {
    if (!response) return null;
    try {
      if (
        !/\/api\/(communities\/mine|chats\/conversations)(\?|$)/i.test(
          request.url,
        )
      ) {
        return response;
      }
      const data = await response.clone().json();
      const list = data?.communities ?? data?.conversations;
      if (Array.isArray(list) && list.length === 0) return null;
    } catch {
      /* non-JSON — cache normally */
    }
    return response;
  },
};

registerRoute(
  ({ request, url }) =>
    request.method === 'GET' && url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'orbit-api-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 }),
      skipEmptyMembershipLists,
    ],
    networkTimeoutSeconds: 5,
  }),
);

registerRoute(
  /^https?:\/\/res\.cloudinary\.com\/.*\/(image|video)\/upload\/.*/i,
  new CacheFirst({
    cacheName: 'orbit-cloudinary-media',
    plugins: [
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
);

registerRoute(
  /^https?:\/\/.*\.(?:png|jpg|jpeg|svg|gif|webp|avif|ico)/i,
  new CacheFirst({
    cacheName: 'orbit-image-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
);

registerRoute(
  /^https?:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)/i,
  new StaleWhileRevalidate({
    cacheName: 'orbit-font-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 60 }),
    ],
  }),
);

registerRoute(
  /^https?:\/\/.*\.(?:mp3|mp4|aac|ogg|wav|webm|m4a)/i,
  new CacheFirst({
    cacheName: 'orbit-audio-video',
    plugins: [
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 }),
    ],
  }),
);

// ─── Web Push Notifications ───────────────────────────────────────
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // One-time self-heal: older SW versions cached stale responses in the
      // runtime API cache — a pre-onboarding /api/auth/me (re-showed the
      // permission onboarding on every open) and EMPTY /api/communities/mine
      // + /api/chats/conversations lists (made "My Communities" / the chat
      // list look permanently empty, since the page's bypassCache can't
      // bypass this SW cache). Purge them on activation so the next fetch
      // gets a fresh answer instead of a stale one.
      try {
        const cache = await caches.open('orbit-api-cache');
        const keys = await cache.keys();
        await Promise.all(
          keys
            .filter((r) => {
              const p = new URL(r.url).pathname.replace(/\/$/, '');
              return (
                p === '/api/auth/me' ||
                p === '/api/communities/mine' ||
                p === '/api/chats/conversations'
              );
            })
            .map((r) => cache.delete(r)),
        );
      } catch {
        /* best-effort */
      }
      await self.clients.claim();

      // Tell every open tab a fresh version is live so they reload right
      // away. Belt-and-braces alongside the controllerchange event: some
      // iOS standalone-PWA / WebView engines don't reliably fire
      // controllerchange, and the page's message listener (main.tsx) is the
      // fallback that guarantees users never stay on stale code after a
      // deploy until they manually reload.
      const tabs = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of tabs) {
        client.postMessage({ type: 'NEW_VERSION' });
      }
    })(),
  );
});

// Message from the app: e.g. skip-waiting on new SW version
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// The critical handler — display the device notification when the
// server sends a web-push payload.
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    // Fallback for plain-text payloads
    event.waitUntil(
      self.registration.showNotification('ORBIT', {
        body: event.data.text(),
        icon: '/icon-192.png',
        badge: '/icon-192.png',
      }),
    );
    return;
  }

  const { title, body, icon, badge, image, vibrate, actions, data: payloadData, tag, requireInteraction, renotify, timestamp } = data;

  const options = {
    body: body || '',
    icon: icon || '/icon-192.png',
    badge: badge || '/icon-192.png',
    data: payloadData || {},
    vibrate: vibrate || [200, 100, 200],
    ...(timestamp && { timestamp: new Date(timestamp).getTime() }),
    ...(tag && { tag }),
    ...(requireInteraction !== undefined && { requireInteraction }),
    ...(renotify !== undefined && { renotify }),
    ...(image && { image }),
    ...(actions && { actions }),
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title || 'ORBIT', options);
      // Update the launcher badge (Android) with the unread count carried
      // in the payload (data.unreadCount) — like real social apps.
      const unread = payloadData?.unreadCount;
      if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
        try {
          const count = Number(unread) || 0;
          if (count > 0) {
            await navigator.setAppBadge(count);
          } else {
            await navigator.clearAppBadge();
          }
        } catch {
          /* badge unsupported — ignore */
        }
      }
    })(),
  );
});

// Click on a notification → focus the app, navigate to the target URL
// carried in the payload (post, profile, notifications, chat, etc.),
// mark the notification read server-side, and clear the launcher badge.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const payloadData = event.notification.data || {};
  const urlToOpen = payloadData.url || '/';

  event.waitUntil(
    (async () => {
      // Mark the notification as read so in-app counts stay accurate
      const notificationId = payloadData.notificationId;
      if (notificationId) {
        try {
          await fetch(`/api/notifications/mark-as-read/${notificationId}`, {
            method: 'PUT',
            credentials: 'include',
          });
        } catch {
          /* best-effort — non-critical */
        }
      }

      // Clear the launcher badge when the user acts on a notification
      if (typeof navigator !== 'undefined' && 'clearAppBadge' in navigator) {
        try {
          await navigator.clearAppBadge();
        } catch {
          /* ignore */
        }
      }

      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Focus an existing ORBIT window and navigate it to the target
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin)) {
          client.focus();
          try {
            client.navigate(urlToOpen);
          } catch {
            // Navigation not supported on this client — ignore
          }
          return;
        }
      }
      // Otherwise open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })(),
  );
});

self.addEventListener('notificationclose', (event) => {
  // Analytics / dismissal tracking could be hooked here
});
