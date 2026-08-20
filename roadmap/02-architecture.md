# 02 — Architecture: How Everything Fits Together

> The system you're learning is not "one app" — it's **four machines talking
> over HTTPS + WebSocket + WebRTC**, with three caching layers in the browser,
> two Redis connections, ten background queues, and a database that must stay
> consistent with all of it. This file is the map of that system.

---

## 1. The deployment topology

```
┌────────────┐  HTTPS (static + /api/* + /socket.io/* proxy)   ┌─────────────┐
│  Vercel    │ ──────────────────────────────────────────────▶ │   Render    │
│ (client +  │                                                 │ (server)    │
│  landing)  │ ◀────────────────────────────────────────────── │  cluster:   │
└────────────┘     JSON + WebSocket + web-push payloads        │  2 workers  │
                                                               └─────┬───────┘
                          ┌──────────────────────────────────────────┼───────────┐
                          ▼                                          ▼           ▼
                   MongoDB Atlas                               Upstash REST    TCP Redis
                   (all data)                            (cache/ratelimit/   (BullMQ queues +
                                                          presence/event log)  socket adapter)
```

- **Client on Vercel.** Vercel serves the built SPA and **proxies** `/api/*`
  and `/socket.io/*` to Render (`vercel.json` rewrites). This is why the
  client's `apiFetch("/api/...")` uses relative URLs — same-origin requests
  are proxied, so **cookies work without CORS gymnastics**.
- **Server on Render.** Node cluster: `CLUSTER_ENABLED` (default on in prod,
  capped `CLUSTER_MAX_WORKERS=2`) forks one process per CPU; all share the
  port. That's why things like cron jobs must be deduped (see 08 — the
  BullMQ-repeatables fix).
- **MongoDB Atlas** — the single source of truth. Shared cluster.
- **Two Redis roles, two providers:**
  1. **Upstash (REST/HTTPS)** — `configs/redis.ts` + `configs/cache.ts`:
     cache keys, rate limits, presence TTLs, the realtime event log. REST
     calls, not TCP — fine for occasional cache ops.
  2. **TCP Redis (`REDIS_URL`)** — BullMQ queues (needs TCP for blocking
     commands) and the Socket.IO pub/sub adapter (multi-instance broadcasts).

---

## 2. The request lifecycle — one POST, end to end

Take `POST /api/posts` (create a post). Follow it through every layer:

1. **Browser** → `apiFetch("/api/posts", { method: "POST" })` (`client/src/utils/api.ts`).
   - Attaches the **CSRF token** from the non-httpOnly cookie (`getCsrfToken`).
   - `credentials: "include"` sends the JWT cookie.
   - On success: `evictAffectedCaches(url)` purges every stale cached copy
     (CacheStorage + SW caches + Dexie) and **write-through** stores the fresh
     post into Dexie.
2. **Vercel proxy** → forwards to Render.
3. **Express middleware chain** (`server/src/server.ts`):
   request ID → logging → `Cache-Control: private, no-store` wrapper (GET-only)
   → general rate limiter → **CSRF check** (verifies the header matches the
   cookie, skips on the allowlist) → route.
4. **Route** (`post.routes.ts`): `protect` (JWT → `req.user`) → `postSchema`
   (Zod validation of the body) → `createPost` controller.
5. **Controller** (`post.controllers.ts`): sanitize → create the doc → $inc the
   user's post counter → **fire the fan-out** (enqueue notification for
   mention/mission progress via BullMQ) → evict feed caches →
   `res.status(201).json({ success: true, post })`.
6. **Socket** — the server also emits `post:created` to rooms so open feeds
   update in realtime.
7. **Browser receives it** — `apiFetch` cached the response into Dexie, the
   optimistic UI already showed the post, and the socket event keeps other
   devices in sync.

**Key mental model:** *the controller is the sync point.* It does the DB write,
then *tells every other system* (queues, caches, sockets) what changed. There
is no event bus — just direct calls + BullMQ + socket emits.

---

## 3. The read lifecycle — why pages feel instant

```
GET /api/feed/for-you
1. apiFetch → getCachedResponse(url)      → CacheStorage hit? return INSTANTLY
2. miss? offline? → getOfflineFallback()  → Dexie query? return
3. miss? → network fetch
4. success → setCachedResponse (CacheStorage) + cacheIntoDexie (Dexie)
5. background → the 30s SWR timer re-fetches registered URLs when TTL expires
```

Plus the **service worker** (NetworkFirst for API) and the **in-memory cache**
on the server (10s) in front of Upstash. Net effect: repeat reads never touch
the network or even the DB.

---

## 4. The realtime architecture

- One Socket.IO server per worker, joined by the **Redis adapter** so a message
  emitted on worker A reaches clients connected to worker B.
- Rooms: `user:<id>` (per-user), `conversation:<id>` (per chat),
  `community:<id>` (per community).
- **Presence** is per-worker in-memory (`onlineUsers` set) + Redis TTL keys.
- **Reconnect backfill:** every user-scoped event is appended to a per-user
  Redis list (`rt:events:<userId>`, 2h TTL, 200 max). On reconnect the client
  sends `events:sync { since }` and the server replays everything newer
  through the socket — same handlers run, no reload needed.
- **Broadcast events** (post:created etc.) are not per-user logged; the client
  refetches key lists on reconnect instead (`forceFeedRefresh`).

---

## 5. The data flow for one message send (chat)

1. Client sends POST `/api/chats/conversations/:id/messages` **and** optimistically shows the bubble.
2. Controller saves the Message, $inc unread for the recipient, evicts the
   conversation-list cache, emits `message:new` to the room, enqueues a push
   notification job, and logs the interaction (affinity) via the gamification queue.
3. Recipient's socket handler writes the message into **Dexie**
   (`realtimeSync.ts → applyRealtimeEvent`) and re-renders the bubble — even
   if the app is reloaded later, Dexie has it.

---

## 6. Where the hard problems live (and the answers this codebase chose)

| Problem | The hard part | This codebase's answer |
|---|---|---|
| Speed | Round-trips to a shared DB | Cache everywhere, 3 browser layers + server memory + Upstash |
| Freshness | Cache invalidation | `evictAffectedCaches` matcher + `purgeOfflineDataForPath` + socket write-through |
| Reliability | Slow external calls in request paths | BullMQ (10 queues) with graceful inline fallbacks |
| Realtime | Missed events while disconnected | Per-user Redis event log + `events:sync` backfill |
| Multi-instance | Duplicate cron jobs | BullMQ repeatable jobs (schedule lives in Redis) |
| Offline | Mutations during no network | Dexie sync queue with dedupe + toggle-cancel + exponential backoff |
| Deploys | Users stuck on old code | SW auto-update (5-min poll + NEW_VERSION message + auto reload) |

---

## 7. Run it locally (do this first)

```bash
# 1. Backend — needs a .env with MONGO_URI (local Mongo or Atlas) + secrets.
#    Copy the env list from docs/ENV.md. Minimal boot: MONGO_URI, JWT_SECRET,
#    CLOUDINARY_*, CLIENT_URL.
cd server
npm install
cp .env.example .env   # or create from docs/ENV.md
npm run dev            # tsx --watch, serves on :5006

# 2. Frontend — Vite dev server proxies /api + /socket.io to :5006.
cd ../client
npm install
npm run dev            # opens on :5173

# 3. Tests
cd ../server && npm test            # Jest, 26 suites / 245 tests
cd ../client && npm test            # Vitest, 14 files / 61 tests
```

Without a real MongoDB the server won't boot — use the free Atlas cluster from
`docs/ENV.md` or a local `mongod`.

---

## Exercises

1. Draw the request lifecycle for `DELETE /api/posts/:id` — name every layer
   it passes through and every cache it must invalidate.
2. Explain to yourself *why* there are two Redis connections (Upstash REST vs
   TCP `REDIS_URL`) and what each one's jobs are.
3. Trace how a `message:new` socket event becomes data in Dexie (start at
   `client/src/utils/realtimeSync.ts`, then `offlineDB.ts`).
4. In `server/src/server.ts`, list the boot steps in order and say why
   `server.listen()` now comes before `startQueueWorkers()` (hint: a failed
   queue boot must not kill the port — that was a real production bug).
