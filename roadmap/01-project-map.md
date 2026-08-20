# 01 — Complete Project Map

> Every file in the repo, what it is, and what it does. This is your atlas.
> "Never skip a thing" starts here — walk this map and you'll have touched
> every file in the project.

---

## Monorepo root

```
orbit/
├── client/          Main React app (Vercel)
├── server/          Express + Socket.IO backend (Render)
├── landingpage/     Standalone marketing page (React + Three.js, own git repo)
├── docs/            Maintained reference docs (STACK, ENV, FEATURES, ADMIN_GUIDE, GESTURES)
└── roadmap/         This learning curriculum
```

---

## `server/` — the backend

### Entry point & boot

| File | What it does |
|---|---|
| `src/server.ts` | THE entry. Express app setup, every middleware, **every route mount**, global error handler, `connectDB().then(...)` boot sequence (socket → port → schedulers → queue workers → external sync → bot farm), clustering logic, graceful shutdown |

**Server boot order (learn this):** validate env (`env.ts`) → create Express app → Sentry → compression → trust-proxy → global handlers → CORS → helmet → body parsers → request ID → logging → `Cache-Control: private, no-store` middleware → rate limiter → CSRF → mount 38 route modules → 404 handler → global error handler → `connectDB()` → `initSocket()` → `server.listen()` → background services.

### `src/configs/` — configuration modules (one per external system)

| File | Concept it teaches |
|---|---|
| `env.ts` | **Zod schema validation of environment variables** — the app refuses to boot with a bad config. Learn: `z.object`, `z.enum`, `z.coerce.number`, `process.exit(1)` on failure |
| `db.ts` | Mongoose connection: pool sizing (`maxPoolSize` 50 prod), `autoIndex: false` in prod, retry logic, reconnect polling, one-time migrations (Repost index sync, dropping old `glimpses`) |
| `redis.ts` | **Upstash REST Redis** client + the no-op Proxy fallback when unconfigured (every cache call resolves instantly) |
| `cache.ts` | The cache API used app-wide: **in-memory layer (10s) in front of Upstash**, `getCache`/`setCache`/`deleteCache`/`clearByPattern` (SCAN-based), plus named clear helpers (`clearFeedCache`, `clearChatCache`…) |
| `chatCache.ts` (in `utilities/`) | The in-memory `Map` cache + prefix/pattern eviction primitives that `cache.ts` wraps |
| `queue.ts` | **BullMQ**: 10 queues (enum `QueueName`), lazy queue singletons, enqueue helpers, `startQueueWorkers()`, `closeQueues()`. THE background-jobs hub |
| `scheduler.ts` | Cron fallbacks + BullMQ repeatable jobs: affinity recompute, notification pruner, mission reset, streak breaker, external-sync poll, scheduled-post publisher, keep-alive pinger |
| `socket.ts` | The **biggest config**: Socket.IO server, Redis pub/sub adapter, auth middleware, presence, realtime event log + `events:sync` backfill, chat/community/call/notification event handlers |
| `nodeMailer.ts` | Email transport selection: **Brevo (primary) → SendCoreX → Resend → SMTP** fallback chain, queued email worker impl |
| `cloudinary.ts` / `imagekit.ts` | Media SDK clients (two providers) |
| `meilisearch.ts` | Meilisearch client — **defined but indexing never wired to write paths** (a learn-it note in itself) |
| `sentry.ts` | Sentry init (skips when DSN absent) |
| `swagger.ts` | Swagger UI (dev only) |
| `cookie.ts` | Cookie options — `sameSite: none`, `secure`, `httpOnly` in prod |
| `trustProxy.ts` | Client-IP resolution from X-Forwarded-For (behind Render) |
| `generateOtp.ts` | OTP code generation for password reset |
| `sanitize.ts` | HTML/input sanitization helpers |

### `src/middlewares/` — the middleware chain

| File | Teaches |
|---|---|
| `auth.middleware.ts` | JWT verify → attach `req.user`; the `protect`, `optionalAuth`, `protectViews`, `adminOnly` variants; banned-user check |
| `csrf.middleware.ts` | **Double-submit cookie CSRF**: sets a `csrf-token` cookie, verifies the `x-csrf-token` header matches, public-path allowlist |
| `ratelimit.middleware.ts` | Rate limiting (Upstash-based + in-memory fallback), per-route limiters |
| `cache.middleware.ts` | Route-level response caching (`api:<userId>:<path>:<query>` keys) — and the comment about why it was *removed* from comment routes |
| `upload.middleware.ts` | Multer multipart handling, size/type limits |
| `view.middleware.ts` | Post-view counting middleware |

### `src/routes/` — 38 route modules

Thin **router files** that declare endpoints + attach middleware + hand to controllers. Pattern every one follows:

```ts
router.post("/", protect, postSchema, createPost);        // schema validation
router.get("/:id", optionalAuth, getPostById);            // optional auth for public
router.get("/feed", protect, getFeed);                    // protected
```

**Learn by reading 3:** `post.routes.ts` (CRUD + sub-resources), `auth.routes.ts` (public auth + rate limits), `admin.routes.ts` (admin-gated everything).

Full list (all mounted in `server.ts`): auth, oauth, password, user, post, comment, like, follow, saves, repost, search, notification, chat, glimpse, community, collection, streak, invite, report, admin, feed, feedForYou, push, block, dailyMission, xp, linkPreview, translation, leaderboard, trending, moderation, dataExport, file, webhook, apiKey, permission, externalFeed, waitlist.

### `src/controllers/` — 44 controllers (the business logic)

One controller file per feature area. The pattern:

```ts
export const createPost = async (req, res, next) => {
  try {
    // validate → build → save → enqueue fan-out (notification, gamification, webhook)
    // → evict caches → respond
  } catch (err) { next(err); }  // the global error handler shapes the response
};
```

Highlights to read first: `post.controllers.ts` (biggest CRUD + media + counters), `user.controllers.ts` (1700+ lines — profile, follow, suggestions, `publicUser()` whitelist), `chat.controllers.ts` (messages + media cleanup), `auth.controllers.ts` (register/login/session/OTP), `admin.controllers.ts` (stats/flags/mute/ban/verify), `like.controllers.ts` (the canonical "interaction + notification fan-out" controller), `oauth.controllers.ts` (Google flow + the `oauth-exchange` code swap).

### `src/models/` — 35 Mongoose schemas

| Area | Models |
|---|---|
| Identity | `user`, `bot`, `waitlist`, `userInvite`, `perkTombstone`, `deviceSubscription`, `emailPreference` |
| Content | `post`, `comment`, `glimpse`, `externalPost`, `collection`, `draft` (in post), `poll` (in post) |
| Social | `follow`, `followRequest`, `block`, `like`, `repost`, `save`, `interaction` |
| Messaging | `conversation`, `message`, `community`, `communityMessage` |
| Gamification | `xp`, `dailyMission`, `dailyReward`, `userStreak`, `badge` (in user) |
| Operations | `notification`, `report`, `moderationItem`, `featureFlag`, `adminAuditLog`, `apiKey`, `webhook`, `broadcast`, `botFarm` |

**Learn pattern:** every model = schema definition + `schema.index(...)` calls + `mongoose.model(...)`. Read `post.model.ts` (richest) and `user.model.ts` (most indexes).

### `src/services/` — business logic that's not request-shaped

| File | Teaches |
|---|---|
| `feedService.ts` | **The ranked feed algorithm** — candidates → scoring (affinity, velocity, recency, follow boost, quality gate) → diversity → freshness → cache. Pure functions exported for tests |
| `affinityService.ts` | Per-author + content (hashtag) affinity scoring, incremental `$inc` updates, the Interaction log, `seenPosts` capping |
| `xpService.ts` / `badgeService.ts` / `dailyMissionService.ts` | Gamification internals — each has a queue-first wrapper (`awardXP` → BullMQ) + `*Inline` implementation |
| `pushService.ts` | Web-push delivery (queue-first, `sendPushToUserInline` impl) |
| `chatForwardService.ts` | Forward-as-chat-message (queue-first + inline) |
| `mediaCleanupService.ts` | Cloudinary destroys (queue-first + inline) |
| `livekitService.ts` | LiveKit room/token management for calls |
| `leaderboardService.ts` | Top-users computation |
| `recommendationService.ts` | User suggestions (affinity-based) |
| `translationService.ts` | Language detection + translation |
| `linkPreviewService.ts` | OG-metadata fetch **with SSRF guard** (`isBlockedUrl`, `safeFetch`, redirect limits) |
| `waitlistPerkService.ts` | Waitlist "Day One Founder" perks |
| `bots/` (14 files) | The **bot farm** — simulated users (see `12`) |
| `externalSync/` (7 files) | Bluesky/Mastodon/Lemmy/PeerTube ingestion (see `12`) |

### `src/utilities/`

`errors.ts` (AppError hierarchy + status codes), `logger.ts` (winston structured logs), `notification.ts` (the create/delete fan-out — DB + socket + push, queue-first), `blockCheck.ts`, `ssrfGuard.ts`, `waitlistGate.ts` (signup gating), `waitlistProtection.ts` (honeypot/disposable-domain/MX checks), `chatCache.ts`, `searchCache.ts`, `postStatus.ts`, `postVisibility.ts`, `badgeCatalog.ts`.

### `src/schemas/` — Zod request validators

`user.schema.ts`, `post.schema.ts`, `comment.schema.ts`, `chat.schema.ts`, `interaction.schema.ts`, `waitlist.schema.ts`.

### `src/types/` — ambient type declarations

`express.d.ts` (extends Request with `user`, `requestId`), `global.d.ts`, `imagekit.d.ts`, `meilisearch.d.ts`, `web-push.d.ts`, `swagger.d.ts`.

### `src/data/`

`disposableDomains.ts` — the disposable-email blocklist for waitlist anti-spam.

### `src/__tests__/` — 26 Jest suites (245 tests)

`setup.ts` / `setupAfterEnv.ts` / `teardown.ts` (mongodb-memory-server lifecycle), `helpers/mockSocket.ts` (fake socket for controller tests). Feature suites: auth, posts, likes, comments, chat, saves, reposts, feed, feedQuality, queue, sharing, glimpses, users, mentions, pins, permissions, oauthExchange, externalFeed, waitlist(+protection, +perk), achievements, blueTick, community-roles, recommendations, xpBadgeHistory.

### `scripts/` — one-shot operational scripts (run with `npx tsx`)

`make-admin`, `sync-indexes` (build DB indexes — **run after index changes in prod**), `inventory-db`, `inspect-follows`, `repair-follow-counts`, `clear-follow-caches`, `stop-bot-farm`, `inspect-bots`, `list-waitlist`, `send-launch-emails`, `seed-*` (data seeding), `reset-content`, `e2e-server`, `test-socket-e2e.mjs`, `load-env.ts` (dotenv loader used by all scripts).

---

## `client/` — the main app

### Core

| File | Teaches |
|---|---|
| `src/main.tsx` | React entry: theme boot, Sentry, **service worker registration with `updateViaCache: "none"`**, 5-min update poll, `NEW_VERSION` auto-reload, stale-chunk self-heal |
| `src/App.tsx` | THE 3500-line heart: session check, socket lifecycle + reconnect backfill, realtime event handling, cache warming, tab navigation (lazy chunks), badge state, toasts, the whole layout |
| `src/types.ts` | All shared client types (Post, User, Message, Conversation…) |
| `src/index.css` | Tailwind v4 + the design system |
| `src/sw.js` | The service worker (workbox `injectManifest` build) — precache, NetworkFirst API, CacheFirst media, push handling, `NEW_VERSION` broadcast |
| `vite.config.ts` | Build config: PWA plugin, `manualChunks` (vendor/socket/gsap/dexie/chat/feed/profile/leftnav — with comments about chunk-cycle crashes), proxy to backend |

### `src/components/` — 80+ components

Organized by feature: `Feed.tsx`, `PostModal.tsx`, `Profile.tsx`, `Chat.tsx`, `Communities.tsx`, `GroupCallFloor.tsx`, `CallUI.tsx`, `GlanceViewer.tsx`, `GlanceEditor.tsx`, `Notifications.tsx`, `Settings.tsx`, `AdminDashboard.tsx`, `Auth.tsx`, `Explore.tsx`, `Leaderboard.tsx`, `MissionsPanel.tsx`, `Streaks.tsx`, `InvitesTab.tsx`… plus shared UI primitives (`GlassCard`, `Skeleton`, `EmptyState`, `ConfirmDialog`, `ShinyText`, `SplitText`, `CharCounter`, `UserAvatar`, `VerifiedBadge`, `TypingIndicator`…) and interaction components (`PinchZoom`, `ImageCarousel`, `EmojiReactionMenu`, `MessageBubble`, `PollCard`, `CommentNode`, `ForwardModal`, `ShareMenu`, `RepostMenu`, `LinkPreviewCard`, `TranslateInline`…).

### `src/hooks/` — 9 custom hooks

`useAutoGrow` (auto-growing inputs), `useOfflineSync` (flush queue on reconnect), `usePostViewTracking` (3s-in-view), `useMentionAutocomplete`, `useCacheRefresh`, `useKeyboardOpen`, `useLenisScroll`, `useReveal`, `useSwipeBack` (in hooks — edge-swipe back gesture).

### `src/utils/` — the client's brain

`api.ts` (**the fetch layer**: CSRF header, request dedup, cache-first + background refresh, offline queueing, `evictAffectedCaches` — the giant invalidation matcher, uploads with progress), `apiCache.ts` (CacheStorage + SWR timer registry), `offlineDB.ts` (Dexie schema v1–v5 + all query helpers + `purgeOfflineDataForPath`), `syncQueue.ts` (offline mutation replay with dedupe/toggle-cancel + exponential backoff), `dexieBridge.ts` (`cacheIntoDexie`, `getOfflineFallback`), `realtimeSync.ts` (`applyRealtimeEvent` — upsert into Dexie + evict CacheStorage on every socket event), `tabChunks.ts` (prefetch lazy chunks), `primeCache.ts` (idle-time warming), `apiCache.ts`, `featureGates.ts`, `validation.ts`, `imageUrls.ts` (Cloudinary transform URLs), `imageCompression.ts`, `deviceId.ts`, `haptics.ts`, `notificationText.ts`, `notificationChime.ts`, `logger.ts`, `analytics.ts`, `sentry.ts`, `shareToExternal.ts`, `downloads.ts`, `linkify.tsx`, `mentions.tsx`, `badgeCatalog.ts`, `format.ts`, `links.ts`, `messageHighlight.ts`, `permissions.ts`, `hasWebGL.ts`.

### `src/landing/` + `src/world/` — the in-app landing page

React Three Fiber 3D world (`world/WorldCanvas.tsx`, `Aurora.tsx`, `CameraRig.tsx`), scroll-animated sections (`landing/components/*`: Hero, Features, CTA, Stats…), gsap + lenis scroll, motion.

---

## `landingpage/` — the standalone marketing page

A separate Vite app (own git repo): Three.js hero, waitlist form, scroll storytelling. Same design language, different codebase. Read `src/main.tsx` + `src/world/WorldCanvas.tsx` + `src/config.ts`.

---

## `docs/` — maintained reference (keep updated)

`STACK.md` (stack + deployment + env), `ENV.md` (env vars for Render/Vercel), `FEATURES.md` (feature catalog), `FEATURES_STATUS.md` (verification audit), `ADMIN_GUIDE.md` (admin ops), `GESTURES.md` (touch gestures).
