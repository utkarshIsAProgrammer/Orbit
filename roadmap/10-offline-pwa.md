# 10 — Offline-First, PWA, and Auto-Update

> This app works **offline**: you can read posts, messages, notifications, and
> profiles with zero network, and mutations you make while offline (send a
> message, like a post) are **queued and replayed** when you're back online.
> Deploys reach users automatically. This file covers the service worker,
> Dexie, the sync queue, web push, and the auto-update pipeline.

---

## 1. The three browser storage technologies (know the difference)

| Technology | What it is | Used for here |
|---|---|---|
| **CacheStorage** | Request/response cache, same storage SW uses | Fast response cache (`orbit-api-v1`), SW precache |
| **IndexedDB (via Dexie)** | Full structured DB in the browser | *Queryable* offline store + the sync queue |
| **localStorage / sessionStorage** | Tiny synchronous key-value | `orbit:rt-since` cursor, theme, chunk-reload guard |

CacheStorage answers "give me the response for this URL". IndexedDB answers
"give me all messages for this conversation, newest first" — that's why both
exist.

## 2. Dexie (`utils/offlineDB.ts`)

- Schema versions v1→v5 with **indexes** per table (`"_id, conversation,
  [conversation+createdAt], createdAt"` — Dexie's index syntax; compound
  `[a+b]` indexes exist for sorted range queries). Version bumps auto-migrate.
- Tables: conversations, messages, communityMessages, posts, notifications,
  users, comments, commentThreadMeta, glances, communities, syncQueue.
- Upsert helpers (`cachePosts`, `cacheSingleMessage`, …) + query helpers
  (`getCachedConversationMessages`, `searchCachedMessages`, …) + the
  **purge/eviction** logic (see 06) + `pruneOldData` (7-day TTL on notifications).
- **Singleton:** `export const db = new OrbitDB()` — one connection app-wide.

## 3. The service worker (`src/sw.js`, built by workbox `injectManifest`)

**Why injectManifest and not generateSW?** The custom worker needs push/
notification handlers — generateSW would produce a caching-only worker with no
push support (the root cause of "notifications stopped working").

What it does:

1. **Precache** — `precacheAndRoute(__manifest)` (48 entries injected at build:
   hashed JS/CSS, icons, index.html) + `cleanupOutdatedCaches()` (old versions
   purged on activation).
2. **Navigation = NetworkFirst with a 1.8s timeout** — always try to serve the
   fresh index.html from network (so hashed chunk refs are current); abort →
   serve the precached shell instantly; offline → precached shell.
3. **API routes** — NetworkFirst: `orbit-api-cache` (100 entries, 24h) and
   `orbit-chat-messages` (50, 7d), 3–5s network timeouts.
4. **Media** — CacheFirst for Cloudinary images/video + generic images + fonts.
5. **Push** — `push` event renders the notification (badge via
   `navigator.setAppBadge`), `notificationclick` focuses the app and navigates
   to the payload URL + marks read.
6. **Activation** — purge stale `/api/auth/me` copies, `clients.claim()`, and
   **post `NEW_VERSION` to every tab** (see 5).

## 4. The offline mutation queue (`utils/syncQueue.ts`)

When `apiFetch` hits a network error for a POST/PUT/DELETE and
`!navigator.onLine`, it stores the mutation in `syncQueue` and returns a fake
202 — **the UI never breaks offline**.

Replay rules (the clever part):

- **Dedupe:** same URL + method + body → skip (already queued).
- **Toggle-cancel:** POST↔DELETE on the same URL cancels both (like/unlike
  while offline = no change — don't replay either).
- **FIFO replay** on `online` event (`useOfflineSync`) with **exponential
  backoff** (1s→30s, max 5 retries); 4xx responses are dropped (non-retryable),
  5xx retried.

## 5. Auto-update on deploy (the "users never hard-reload" pipeline)

`main.tsx` + `sw.js` together:

1. **Register** with `updateViaCache: "none"` — the browser never serves a
   stale `sw.js` from the HTTP cache (that was the classic "deploy didn't
   reach me for 24h" bug).
2. **Poll** `reg.update()` every **5 minutes** + on tab visibility change +
   on load. Cheap byte-diff against the new sw.js.
3. **`skipWaiting()`** on install + **`clients.claim()`** on activate → the
   new SW takes control immediately, `cleanupOutdatedCaches()` purges old ones.
4. **Reload triggers (belt & braces):** the page listens for `controllerchange`
   AND the `NEW_VERSION` message the SW posts to every client — either fires a
   **one-shot auto reload** (guarded, no loop).
5. **Stale-chunk self-heal:** if a tab running old code tries to lazy-load a
   chunk the new build no longer ships, the `unhandledrejection` handler
   reloads once (sessionStorage guard prevents a loop).

Result: within ~5 minutes of a deploy, every open tab is on the new code.
Deploys reach users automatically.

## 6. Web push (VAPID)

- Server holds `VAPID_*` keys (`docs/ENV.md`); the client subscribes via the
  Push API (`utils/permissions.ts`), stores the subscription via
  `/api/push/subscribe` (`deviceSubscription` model).
- Server sends pushes through **`pushService.ts`** → BullMQ `orbit-push` queue
  (or inline) using `web-push`; stale 410/404 endpoints are cleaned up.
- `sw.js` `push` handler → `showNotification` with rich payload (icon, actions,
  badge, vibrate); click → deep-link + mark-read + clear app badge.

## 7. The consistency rule (learn this once)

**Every source of data change writes to the offline stores:**

- GET responses → CacheStorage + Dexie (`api.ts` write-through).
- Mutations → evict affected rows (both layers) then write-through fresh copy.
- Socket events → `applyRealtimeEvent` upserts into Dexie + evicts CacheStorage.
- Logout → `clearAllCaches()` (CacheStorage + Dexie + stop the SWR timer).

Because every read falls back cache-first, keeping all three layers honest on
every write is what makes offline mode *correct*, not just *present*.

---

## Exercises

1. Why does the app need BOTH CacheStorage and IndexedDB? Give a query that
   only IndexedDB can answer.
2. Explain the sync queue's toggle-cancel rule with a concrete like/unlike
   example while offline.
3. Walk the auto-update pipeline: what happens 5 minutes after a deploy for an
   open tab? Name every step from `reg.update()` to the reload.
4. Why `updateViaCache: "none"`? What bug does it prevent, and what was the
   old symptom?
