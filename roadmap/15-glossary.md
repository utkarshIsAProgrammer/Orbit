# 15 — Glossary: Every Technology & Concept, One Line Each

> Alphabetical-ish reference. Each entry: what it is, where it lives in this
> project, and where to learn it properly. If a roadmap file mentions a term
> you don't know, look here first.

---

## Languages & tooling

- **TypeScript** — JS with types. Every file in `client/src` and `server/src`.
  Learn: official handbook → then this codebase's `types/` folder.
- **JavaScript (ES2022+)** — the runtime language. `sw.js`, scripts.
- **Node.js** — the server runtime. `server/`.
- **npm / npx** — package manager + runner. `tsx` runs TS directly (dev +
  scripts); `tsc` compiles for prod.
- **tsx** — TS execution without a build step (dev server, scripts).

## Frontend

- **React 19** — UI library. `client/src`. Learn: react.dev → then `App.tsx`.
- **Vite** — build tool + dev server. `client/vite.config.ts`.
- **Tailwind CSS v4** — utility CSS. `client/src/index.css`.
- **React Three Fiber / drei / postprocessing** — Three.js as React. `client/src/world/`, `landingpage/`.
- **gsap** — animation library (scroll timelines). `client/src/landing/`, `landingpage/`.
- **lenis** — smooth scrolling. `client/src/hooks/useLenisScroll.ts`.
- **motion** (framer-motion successor) — React animations.
- **lucide-react** — icons.
- **sonner** — toasts.
- **emoji-picker-react** — emoji picker.
- **vitest + @testing-library/react + jsdom** — client tests.

## Backend

- **Express 5** — web framework. `server/src/server.ts`.
- **MongoDB** — document database. Learn: MongoDB University → the models.
- **Mongoose** — MongoDB ODM. `server/src/models/`, `db.ts`.
- **Zod** — schema validation (bodies + env). `server/src/schemas/`, `configs/env.ts`.
- **JWT (jsonwebtoken)** — signed session tokens. `auth.middleware.ts`.
- **bcryptjs** — password hashing.
- **helmet** — security headers/CSP.
- **cors** — cross-origin config.
- **multer** — multipart uploads. `upload.middleware.ts`.
- **sanitize-html** — input sanitization.
- **winston** — structured logging. `utilities/logger.ts`.
- **swagger-jsdoc / swagger-ui-express** — API docs (dev only).

## Realtime

- **Socket.IO** — WebSocket library with fallbacks + rooms. `configs/socket.ts`.
- **@socket.io/redis-adapter** — multi-instance broadcasts over Redis pub/sub.
- **WebRTC** — peer-to-peer media for calls.
- **LiveKit** — WebRTC infra (rooms/tokens). `services/livekitService.ts`, `CallUI.tsx`, `GroupCallFloor.tsx`.
- **web-push** — VAPID push notifications. `services/pushService.ts`, `sw.js`.

## Data & caching

- **CacheStorage** — browser request cache. `utils/apiCache.ts`.
- **IndexedDB** — browser database.
- **Dexie** — IndexedDB wrapper. `utils/offlineDB.ts`.
- **Stale-while-revalidate (SWR)** — serve stale, refresh in background. `utils/apiCache.ts` timer.
- **Redis** — in-memory data store. Two uses here: **Upstash REST** (cache/limits/presence/log) and **TCP Redis** (BullMQ + socket adapter).
- **BullMQ** — Redis-backed job queues. `configs/queue.ts` (see 08).
- **node-cron** — cron scheduling (fallbacks). `configs/scheduler.ts`.
- **Mongo TTL indexes** — auto-expiry (`interaction`, `glimpse`).
- **Partial unique indexes** — unique only among matching docs (`saves`, `reposts`).

## Services

- **Cloudinary** — media storage/CDN. `configs/cloudinary.ts`, `utils/imageUrls.ts`.
- **ImageKit** — second media provider. `configs/imagekit.ts`.
- **Brevo** — transactional email (primary). `configs/nodeMailer.ts` (Brevo → SendCoreX → Resend → SMTP).
- **SendCoreX / Resend / Nodemailer** — email fallbacks.
- **Atproto (@atproto/sync)** — Bluesky protocol (firehose). `services/externalSync/blueskyFirehose.ts`.
- **Meilisearch** — full-text search engine (**installed, unwired**). `configs/meilisearch.ts`.
- **Sentry** — error monitoring (installed, DSN optional). `configs/sentry.ts`, `utils/sentry.ts`.
- **Google OAuth (passport-google-oauth20)** — Google login. `oauth.controllers.ts`.
- **Upstash (@upstash/redis, @upstash/ratelimit)** — serverless Redis + rate limiting.

## Concepts (the "why" words)

- **Monorepo** — many apps in one repo (`client/`, `server/`, `landingpage/`).
- **SPA (single-page app)** — one HTML shell, JS swaps views (React).
- **PWA (progressive web app)** — installable web app with SW + push + offline.
- **Middleware chain** — ordered functions wrapping a request (Express, SW, sockets).
- **Controller** — the function that handles one endpoint (route → controller → model).
- **ODM / ORM** — object mapping over a database (Mongoose over Mongo).
- **Denormalization** — storing redundant counters for read speed (trade-off: drift).
- **Cursor pagination** — paging by "after this id" instead of skip (stable, indexed).
- **Compound index** — an index over multiple fields, prefix-served.
- **N+1 problem** — per-row queries; avoided with `$in` + `populate` + parallel queries.
- **JWT** — signed JSON token carrying the user id.
- **httpOnly cookie** — cookie JS can't read (XSS-proof session transport).
- **CSRF** — cross-site request forgery; defeated by double-submit token.
- **SSRF** — server-side request forgery; guarded by IP allowlisting (`ssrfGuard.ts`).
- **Rate limiting** — per-IP request caps.
- **OAuth flow / state param** — delegated login with anti-CSRF state; one-time code exchange here.
- **VAPID** — push subscription identity.
- **ICE / SDP** — WebRTC negotiation artifacts relayed over the socket.
- **Room** — Socket.IO named group.
- **Reconnect backfill** — replaying missed events on reconnect (`events:sync`).
- **Optimistic UI** — show the result before the server confirms.
- **Offline-first** — reads served from local caches; mutations queued.
- **Sync queue with toggle-cancel** — dedupe + cancel opposite mutations offline.
- **Service worker lifecycle** — install → activate → claim; `skipWaiting` for instant control.
- **`updateViaCache: "none"`** — force the browser to revalidate the SW file every check.
- **Idempotent** — safe to repeat (logout, cache clears).
- **Rate-limit lockout** — temp account lock after failed attempts.
- **TTL** — time-to-live (cache expiry, index expiry, event log expiry).
- **SCAN vs KEYS** — non-blocking vs blocking Redis iteration (`clearByPattern`).
- **Graceful shutdown** — drain work before exit.
- **Cluster** — multiple processes sharing a port; dedupe side-effects (crons!).
- **BullMQ repeatable jobs** — cron stored in Redis (cluster-safe).
- **Delayed jobs** — fire at a specific time (scheduled posts).
- **Exponential backoff** — retry delay doubling (queues, sync queue).
- **Deduplication / write-through** — avoid duplicate work / persist confirmed writes immediately.

## Where to learn the technologies (official docs)

- React: https://react.dev/learn
- TypeScript: https://www.typescriptlang.org/docs/
- Express: https://expressjs.com/en/guide/routing.html
- Mongoose: https://mongoosejs.com/docs/
- MongoDB: https://www.mongodb.com/docs/manual/
- Redis: https://redis.io/docs/
- BullMQ: https://docs.bullmq.io/
- Socket.IO: https://socket.io/docs/v4/
- Zod: https://zod.dev/
- Vite: https://vite.dev/guide/
- Tailwind: https://tailwindcss.com/docs
- Workbox (service workers): https://developer.chrome.com/docs/workbox/
- MDN (web platform): https://developer.mozilla.org/ (fetch, caches, IndexedDB, service worker, WebRTC, web push)

---

## The end

You now have the complete map. The order to internalize:

1. **Architecture** (02) — how the pieces talk.
2. **Request path** (03–05) — what happens per request.
3. **Speed** (06–08) — caches, realtime, queues.
4. **Client** (09–10) — React + offline.
5. **Features** (11–12) — what the product does.
6. **Quality & ops** (13–14) — tests, debugging, deploy.

Read code alongside every file. Run the app. Break it. Read the tests. Read
the git log. That's the whole method — and now you know where everything is.
