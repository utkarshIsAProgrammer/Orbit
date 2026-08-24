# 06 — Caching & Performance: Why It's Fast, and How It Stays Honest

> ORBIT's speed comes from **caching at five layers**, and its correctness
> comes from **cache invalidation at every mutation**. This file explains the
> layers, the invalidation machinery, and the performance decisions baked into
> the codebase — several of which were born from real bugs.

---

## 1. The five cache layers (read top-to-bottom)

| # | Layer | Where | Purpose | TTL / lifetime |
|---|---|---|---|---|
| 1 | **In-memory server cache** | `utilities/chatCache.ts` + `configs/cache.ts` | Repeat reads within one server process | 10s |
| 2 | **Upstash (REST) cache** | `configs/redis.ts` | Shared cache across instances (authoritative) | per-key (seconds–hours) |
| 3 | **Browser CacheStorage** | `utils/apiCache.ts` (`orbit-api-v1`) | GET responses survive reloads | until evicted |
| 4 | **Service worker caches** | `sw.js` (`orbit-api-cache`, `orbit-chat-messages`, media…) | NetworkFirst API responses, CacheFirst media | days–weeks |
| 5 | **Dexie (IndexedDB)** | `utils/offlineDB.ts` | *Queryable* offline store + the sync queue | 7-day prune |

**Read path** (`api.ts` GET): CacheStorage → (offline?) Dexie → network → write
to both CacheStorage + Dexie → register in the 30s SWR refresh timer.

## 2. The SWR (stale-while-revalidate) timer

`apiCache.ts`:

- `addToRefreshSchedule(url)` registers an endpoint; the **5-minute interval** checks
  each entry's TTL (pattern-based: conversations 2m, posts/notifications/communities
  5m, default 5m).
- Expired → background `refreshCache(url)` → updates the store → dispatches a
  custom event → React re-renders with fresh data.
- The timer **skips work when the tab is hidden** (`document.hidden`) — no
  battery/bandwidth waste in background tabs.
- On logout, `stopCacheRefreshTimer()` halts everything.

> **Free-tier optimization (2026):** The interval was reduced from 30s to 5m to
> cut Render bandwidth by ~90%. WebSocket pushes handle all realtime updates
> (messages, notifications, presence), so the SWR timer is only a safety net
> for missed events.

## 3. Invalidation — the hardest part, done twice

Every mutation must purge every cached copy, or users see ghosts (deleted posts
coming back, likes reverting, badges frozen). This codebase invalidates **in
two places that must stay in sync**:

**A. `api.ts → evictAffectedCaches(url)`** — after every successful
POST/PUT/DELETE:

1. Opens `orbit-api-v1`, matches cached requests by pathname (parent +
   children + the mutation's own path), deletes matches.
2. **Special-case matchers** (read these — they encode product knowledge):
   - community list mutations → purge `/api/communities/mine`
   - like/save/repost/share → purge **all** post lists/feeds (they embed
     `likedByMe` flags)
   - chat message mutations → purge the conversation list (unread badges)
   - streak/XP mutations → purge streak + XP caches
   - permission/profile updates → purge cached `/api/auth/me` (onboarding flag!)
   - follow/unfollow → purge profiles, suggestions, search, me, feeds
3. Also purges the **SW runtime caches** (`orbit-api-cache`, `orbit-chat-messages`)
   by pathname — a stale SW entry can *revert* optimistic UI when the network
   is slow.
4. **Write-through:** `cacheIntoDexie(url, data)` re-seeds the fresh copy so a
   reload shows the confirmed state immediately.

**B. `offlineDB.ts → purgeOfflineDataForPath(path)`** — the Dexie counterpart.
Maps API pathnames to table rows: notifications → clear table; a specific
conversation's messages → delete those rows; single post mutations → delete
that post row (keeping the rest of the offline feed); collection-level → clear.

> **Why both?** A stale row in ANY layer resurrects on the next fallback read.
> The bug that proved it: "I deleted it, reload, it's back, then it vanishes
> 30s later" — CacheStorage was purged but Dexie wasn't.

## 4. The server side — `cache.ts` design

- **In-memory first (10s)** — an Upstash REST round-trip is ~100–200ms; memory
  is ~1ms. `getCache` checks memory, then Upstash, and warms memory on a hit.
- `setCache` writes **both** layers (memory capped at 10s so it can't outlive
  the authoritative TTL).
- `clearByPattern(pattern)` — **SCAN-based** deletion (never blocking `KEYS`),
  and it purges the in-memory layer *first* so zero-latency reads can't go stale.
- Named clears: `clearFeedCache`, `clearUsersCache`, `clearCommentsCache`,
  `clearChatCache`, `clearFollowCache`, `clearSavesCache`, … — controllers call
  these on every mutation.

> **Route-level `cacheMiddleware`:** Originally used Redis directly for every
> GET response (2 Redis commands per request on 14 routes). Replaced with
> **in-memory caching** (`getMemCache`/`setMemCache` from `chatCache.ts`) to
> eliminate Redis round-trips. The in-memory cache is per-process and clears
> on restart, which is fine for single-instance free-tier deployments.

> **General rate limiter:** `generalLimiter` was replaced with an in-memory
> sliding-window counter (`generalWindows` Map) to eliminate 1 Redis command
> per API request. Stricter route-level limiters (auth, OTP, upload) still
> use Redis for their security-critical Lua scripts.

## 5. The ranked-feed cache (a case study)

`feedService.ts`:

- Key: `feed:ranked:<userId>`, TTL **5 min**. Rebuilding the feed = 3 parallel
  queries + affinity maps + JS scoring (~100ms+ on a cold cache).
- **Slim cache:** the cached value is *not* the full 450-post list — it's
  `{postId, score, quality, ...}` per candidate (~10x smaller). On a cache hit
  the page is **hydrated** by one indexed `_id $in` query. Bonus: a post
  deleted mid-TTL drops out instead of lingering.
- Cache hits skip the `MIN_SCORE_FLOOR` quality filter? No — the floor is
  re-applied on the cached path too (stale spam must not surface).
- `invalidateFeedCache(userId)` on follow/publish; like/comment rely on the
  5-min TTL.

## 6. Cache-Control headers — the "why" behind no-store

`server.ts` applies `Cache-Control: private, no-store` to **every** GET /api
response (unless a controller set its own). Why, when the app has its own
caches?

> The browser's HTTP cache is the ONE layer the app cannot purge from JS. A
> `max-age`/`swr` window there served stale bodies on reload for up to 150s
> after a mutation — the "I deleted it, reload, it's back" bug at the HTTP
> layer. `no-store` makes the HTTP cache a pure pass-through: every reload hits
> the app's own (purgeable) layers.

Trade-off accepted: no browser HTTP-cache hits, ever — but the app's SWR +
CacheStorage + Dexie layers do the caching *and can be evicted*.

## 7. Other performance machinery

- **`warmCache(urls)`** — idle-time prefetch (`requestIdleCallback`) of every
  tab's endpoints + registration in the SWR schedule (see `primeCache.ts`,
  `tabChunks.ts`, `App.tsx`).
- **Request dedup** — `api.ts` keeps a `Map<url, Promise>` so two simultaneous
  GETs for the same URL share one network call.
- **Live search bypasses the cache** — `/search?q=` is always network-fresh
  (cached search results feel broken the moment new content arrives).
- **Images** — Cloudinary transform URLs (`imageUrls.ts`): `w_<size>,q_auto,
  f_auto` thumbnails per context (avatar 96px, banners, chat, carousels).
- **Uploads** — client-side downscale before upload (`imageCompression.ts`) →
  fast uploads, less bandwidth.
- **DB-side perf** (see 04): compound indexes for every sort, `lean()` on hot
  reads, denormalized counters, 90-day TTL on interactions, `autoIndex: false`
  in prod, pool = 50.

> **Free-tier resource budget (2026):** After disabling BullMQ, the remaining
> Redis usage is ~2–5K commands/day: auth cache lookups, cache invalidation
> SCAN loops, and event logging (1 RPUSH per event, trimmed every 10 writes).
> Render bandwidth stays under ~0.5 GB/day with the 5m SWR interval.

---

## Exercises

1. `evictAffectedCaches` — trace what happens when a user *unfollows* someone.
   Which cached surfaces must die, and why does `view` mutations NOT evict?
2. Explain the stale-while-revalidate timer to someone: when is a cached
   response served, and when does the background refresh happen?
3. Why does `purgeOfflineDataForPath` need its own logic instead of just
   clearing the whole Dexie DB on every mutation?
4. State the one-sentence argument for `Cache-Control: no-store` on every API
   response — and its accepted cost.
