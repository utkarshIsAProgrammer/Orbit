# 13 — Testing, Logging & Debugging

> 26 Jest suites (245 tests) on the server, 14 vitest files (61 tests) on the
> client, structured winston logs, optional Sentry — and a pile of hard-won
> debugging lessons encoded in the code comments. This file shows you how to
> test this app and how to debug it like the people who built it.

---

## 1. Server testing — Jest + mongodb-memory-server

Setup (`server/src/__tests__/`):

- `setup.ts` / `setupAfterEnv.ts` / `teardown.ts` — spin up an **in-memory
  MongoDB** (`mongodb-memory-server`) per test run, so tests are hermetic (no
  real DB, no Redis — which is also why every BullMQ helper falls back to
  inline and tests still pass).
- `helpers/mockSocket.ts` — a fake Socket.IO instance injected into controllers
  that emit realtime events, so tests can assert "the socket received X".
- Each suite tests one feature area through its **HTTP API** using `supertest`
  (real Express app + real memory Mongo): e.g. `likes.test.ts` POSTs a like and
  asserts the response, the notification row, the counter, and the socket emit.

**The pattern to learn (from `likes.test.ts`):**

```ts
// seed a user + post → login (get the JWT cookie) → POST /api/likes/... →
// assert 200 + success:true + counter incremented + notification created
```

**Why this matters for learning:** the tests are the *spec* — read a test file
before the controller and you know exactly what behavior is expected.

Run: `npm test` (server), `npm test` (client, vitest). Typecheck: `npm run typecheck` (server) / `npm run lint` (client).

## 2. Client testing — Vitest + Testing Library

`client/src/**/__tests__/` — 14 files testing pure utils (`api.test.ts`,
`imageUrls.test.ts`, `linkify.test.tsx`, `hashtags.test.tsx`) and components
(`Feed`, `Chat`, `MessageBubble`, `Notifications`, `CommentNode`,
`GlanceViewer`…). Component tests use jsdom + Testing Library: render, interact,
assert DOM.

## 3. Logging — winston

`server/src/utilities/logger.ts`: structured JSON logs (that's the
`{"level":"info","message":...}` you see in Render). Conventions:

- **info** — lifecycle events ("Workers started", "Socket joined conversation").
- **warn** — recoverable problems (external sync failures, rate-limit
  fallbacks, Redis hiccups).
- **error** — real failures, always with a message + error field.
- **Request logging middleware** (`server.ts`) logs 4xx/5xx and any request
  over 5s (your slow-query detector).
- **`req.requestId`** — every request carries a UUID; correlate logs by it.

**Learn:** the log is the first debugging tool. "The app is slow" → look for
5s+ request logs. "Push didn't arrive" → `BullMQ: push job failed`.

## 4. The debugging war stories (bugs this codebase actually hit — each is a lesson)

| Bug | Root cause | The lesson |
|---|---|---|
| **"Queue name cannot contain :" crash** | BullMQ forbids `:` in names; all 10 queues were `orbit:*` → every worker threw at boot → `server.listen()` never ran → "no open ports" + restart loop | Library constraints are real; validate on day one; never let background services block the port |
| **Users must hard-reload after deploys** | SW update flow gaps: stale `/sw.js` from HTTP cache, hourly poll, unreliable `controllerchange` on iOS | `updateViaCache:"none"` + 5-min poll + `NEW_VERSION` message handshake |
| **"I deleted it, reload, it's back, then it vanishes 30s later"** | CacheStorage purged but **Dexie not** — the fallback layer resurrected deleted rows | Every cache layer must be invalidated on every mutation (`purgeOfflineDataForPath`) |
| **Blue ticks delayed seconds** | `chat:join` awaited unread/missed-call bookkeeping before emitting `messages:seen` | Emit the user-visible event first; do bookkeeping in the background |
| **Google login works on desktop, fails on mobile** | OAuth state cookie set on the backend origin never reached the frontend callback (mobile drops redirect cookies) | Same-origin OAuth start + one-time code exchange (`oauth-exchange`) |
| **"Like reverts after reload"** | Stale cached post (likedByMe:false) served cache-first after the mutation | Post-interaction mutations evict ALL cached post lists |
| **Realtime events lost while backgrounded** | No replay: events during a dead socket were gone until manual reloads | Per-user Redis event log + `events:sync` backfill |
| **Scheduled posts published late (up to 60s)** | 1-min cron poll | BullMQ exact-time delayed jobs (cron kept as safety net) |
| **Maintenance crons ran twice** | In-process cron in every cluster worker | BullMQ repeatable jobs (schedule lives in Redis) |
| **EPIPE / "Connection is closed" on every deploy** | Shutdown closed queues but not workers → `process.exit()` killed worker sockets mid-command | Close workers first, gracefully, in `closeQueues()` |
| **Feed felt "AI-generated" / spammy** | Discovery surfaced low-effort posts | Quality gate + per-view engagement rate in scoring |

## 5. Debugging workflow (what to do first)

1. **Reproduce locally** — `npm run dev` in both folders, same env.
2. **Find the request** — the request-logging middleware prints slow/error
   requests; enable it and hit the failing endpoint.
3. **Check the queue** — failed jobs are logged with the queue name; search
   Render logs for `BullMQ: ... failed`.
4. **Check the caches** — most "state bugs" are stale caches. Hard-refresh with
   `bypassCache`, then look at `evictAffectedCaches` and
   `purgeOfflineDataForPath` for the missing matcher.
5. **Write a test first** — the suites make regression fixes cheap.

## 6. Sentry

`configs/sentry.ts` + `client/src/utils/sentry.ts` — init'd when `SENTRY_DSN`
is set (it isn't in prod currently — a known gap; see 14). When configured:
source maps upload via the vite plugin, errors + breadcrumbs, release tracking.

---

## Exercises

1. Read `likes.test.ts` and list every assertion it makes — what does "a like
   works" actually verify?
2. Run one server suite with `--verbose` and explain the setup/teardown dance.
3. Pick two war-story bugs above and find the code comment that documents each
   fix (the comments carry the same story — practice finding them).
4. Why do the queue tests pass without a Redis connection? What design makes
   that possible?
