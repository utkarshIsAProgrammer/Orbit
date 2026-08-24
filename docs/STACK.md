# ORBIT — Full Stack & Technology Reference

A monorepo with **three** deployable apps: the main **client** (React SPA, Vercel), the **server** (Node/Express API + realtime, Render), and a **standalone landing page** (Three.js storytelling page).

```
orbit/
├── client/        → Main app (React SPA) — deployed to Vercel as `orbit-client-live`
├── server/        → API + Socket.IO realtime backend — deployed to Render as `orbit-server-live`
├── landingpage/   → Standalone animated landing page (separate Vite build)
└── docs/          → Project documentation (this file: STACK.md)
```

---

## 1. Client App (`client/`) — React 19 + Vite 6

### Core framework
| Library | Version | Purpose |
|---|---|---|
| **React** | ^19.0.1 | UI framework (function components, hooks, Suspense) |
| **React DOM** | ^19.0.1 | DOM renderer |
| **Vite** | ^6.2.3 | Build tool + dev server |
| **@vitejs/plugin-react** | ^5.0.4 | Fast-refresh JSX transform |
| **TypeScript** | ~5.8.2 | Typed JavaScript |
| **Tailwind CSS** | ^4.1.14 | Utility-first styling (v4 via `@tailwindcss/vite`) |
| **motion** (framer-motion successor) | ^12.23.24 | Animations / AnimatePresence transitions |

### 3D & visual effects
| Library | Version | Purpose |
|---|---|---|
| **three** | ^0.185.1 | WebGL 3D engine |
| **@react-three/fiber** | ^9.7.0 | React renderer for Three.js |
| **@react-three/drei** | ^10.7.8 | Three.js helpers (controls, loaders, etc.) |
| **@react-three/postprocessing** | ^3.0.5 | Post-processing effects |
| **@types/three** | ^0.185.4 | Three.js types |
| **gsap** | ^3.15.0 | Scroll-triggered / timeline animations |
| **lenis** | ^1.3.26 | Smooth scrolling |

### Realtime & calls
| Library | Version | Purpose |
|---|---|---|
| **socket.io-client** | ^4.8.3 | Realtime events (messages, presence, notifications) |
| **livekit-client** | ^2.21.0 | WebRTC video/voice calls |
| **@livekit/components-react** | ^2.9.23 | React components for LiveKit |

### Data & offline-first layer
| Library | Version | Purpose |
|---|---|---|
| **dexie** | ^4.4.4 | IndexedDB wrapper — offline structured store (messages, posts, notifications…) |
| **vite-plugin-pwa** | ^1.3.0 | Service worker generation (Workbox-based, NetworkFirst / CacheFirst) |

### UI components & utilities
| Library | Version | Purpose |
|---|---|---|
| **lucide-react** | ^0.546.0 | Icons |
| **sonner** | ^2.0.7 | Toasts |
| **emoji-picker-react** | ^4.19.1 | Emoji picker |
| **react-easy-crop** | ^5.5.7 | Avatar/image cropping |
| **web-vitals** | ^6.0.1 | Performance metrics |

### Monitoring
| Library | Version | Purpose |
|---|---|---|
| **@sentry/react** | ^10.56.0 | Error tracking |
| **@sentry/feedback** | ^10.69.0 | User feedback widget |
| **@sentry/vite-plugin** | ^5.3.0 | Source maps upload (devDependency) |

### Testing & tooling (devDependencies)
| Library | Version | Purpose |
|---|---|---|
| **vitest** | ^4.1.8 | Unit/component test runner |
| **@testing-library/react** | ^16.3.2 | React component testing |
| **@testing-library/jest-dom** | ^6.9.1 | DOM matchers |
| **jsdom** | ^29.1.1 | Browser environment for tests |
| **tsx** | ^4.21.0 | Run TS scripts directly |
| **rollup-plugin-visualizer** | ^7.0.1 | Bundle analysis |

---

## 2. Server (`server/`) — Express 5 + Socket.IO + MongoDB

### Core framework
| Library | Version | Purpose |
|---|---|---|
| **Express** | ^5.2.1 | HTTP API framework |
| **TypeScript** | ^5.3.3 | Typed JavaScript |
| **tsx** | ^4.23.12 | Dev runner |
| **helmet** | ^8.1.0 | Security headers |
| **compression** | ^1.8.1 | gzip middleware |
| **cors** | ^2.8.6 | Cross-origin config |
| **zod** | ^4.3.6 | Env validation + input schemas |
| **cookie-parser** | ^1.4.7 | Cookie parsing |
| **cookie** | ^1.1.1 | Cookie serialization |
| **dotenv** | ^17.4.2 | Env file loading |
| **slugify** | ^1.6.9 | URL slugs |
| **sanitize-html** | ^2.17.4 | HTML sanitization |
| **multer** | ^2.1.1 | Multipart file uploads |

### Database & caching
| Library | Version | Purpose |
|---|---|---|
| **mongoose** | ^9.5.0 | MongoDB ODM |
| **@upstash/redis** | ^1.37.0 | Serverless Redis (caching, rate limits, realtime event log) |
| **@upstash/ratelimit** | ^2.0.8 | Sliding-window rate limiting |
| **ioredis** | ^5.11.1 | TCP Redis client (socket adapter) |
| **@socket.io/redis-adapter** | ^8.3.0 | Socket.IO horizontal scaling over Redis |
| **meilisearch** | ^0.60.0 | Full-text search (users/posts) |

### Realtime
| Library | Version | Purpose |
|---|---|---|
| **socket.io** | ^4.8.3 | WebSocket realtime layer |
| **livekit-server-sdk** | ^2.17.0 | Video call room/token management |

### Auth
| Library | Version | Purpose |
|---|---|---|
| **passport** | ^0.7.0 | Authentication middleware |
| **passport-google-oauth20** | ^2.0.0 | Google OAuth2 login |
| **jsonwebtoken** | ^9.0.3 | JWT session tokens |
| **bcryptjs** | ^3.0.3 | Password hashing |

### Media storage — both providers in use
| Library | Version | Purpose |
|---|---|---|
| **cloudinary** | ^2.10.0 | Image/video upload + transforms |
| **imagekit** | ^6.0.0 | Image CDN + optimization (upload fallback/delivery) |

### Notifications & email
| Library | Version | Purpose |
|---|---|---|
| **web-push** | ^3.6.7 | Web Push (VAPID) for PWA push notifications |
| **nodemailer** | ^9.0.3 | SMTP email |
| **resend** | ^6.18.1 | Transactional email API |

### Jobs & scheduling
| Library | Version | Purpose |
|---|---|---|
| **bullmq** | ^5.81.3 | Background jobs: scheduled posts (exact-time delayed jobs), emails, notification fan-out, account deletion, webhook delivery, push notifications, gamification (XP/missions/badges/interactions), Cloudinary media cleanup, chat-forward delivery, and repeatable maintenance jobs (affinity recompute, notification pruner, mission reset, streak breaker, external feed sync). Requires `REDIS_URL` (TCP Redis — Upstash REST won't work); degrades gracefully to inline/fallbacks when unset. **Queue names use a dash prefix** (`orbit-scheduled-posts`, `orbit-emails`, …) — BullMQ forbids `:` in names, and the namespaced dash form is what's registered in Redis. |
| **node-cron** | ^4.6.0 | Fallback scheduler when BullMQ is unconfigured (maintenance tasks + scheduled-post 1-min poll) plus the keep-alive pinger and in-process timers (external sync, bot farm) |

### External content sync
| Library | Version | Purpose |
|---|---|---|
| **@atproto/sync** | ^0.4.2 | Bluesky feed ingestion (Web tab) |

### Logging & monitoring
| Library | Version | Purpose |
|---|---|---|
| **winston** | ^3.19.0 | Structured logging |
| **winston-daily-rotate-file** | ^5.0.0 | Rotating log files |
| **@sentry/node** | ^10.67.0 | Error tracking |
| **@sentry/profiling-node** | ^10.67.0 | CPU profiling |

### API docs
| Library | Version | Purpose |
|---|---|---|
| **swagger-jsdoc** | ^6.3.0 | Generate OpenAPI spec from JSDoc |
| **swagger-ui-express** | ^5.0.1 | Swagger UI at runtime |

### Testing (devDependencies)
| Library | Version | Purpose |
|---|---|---|
| **jest** | ^30.4.2 | Test runner |
| **ts-jest** | ^29.4.11 | TS support for Jest |
| **supertest** | ^7.2.2 | HTTP integration tests |
| **mongodb-memory-server** | ^11.2.0 | In-memory MongoDB for tests |
| **socket.io-client** | ^4.8.3 | Socket test client |

---

## 3. Landing Page (`landingpage/`) — standalone Three.js experience

| Library | Version | Purpose |
|---|---|---|
| **React** | ^19.1.0 | UI |
| **three** / **@react-three/fiber** / **@react-three/drei** / **@react-three/postprocessing** | ^0.185.x | 3D portal animation |
| **gsap** | ^3.15.0 | Animations |
| **lenis** | ^1.3.26 | Smooth scroll |
| **lucide-react** | ^0.546.0 | Icons |
| **Vite + Tailwind v4 + TS** | | Build |

> Note: the main app ALSO has an in-app landing (`client/src/landing/` with the 3D world, `world/` dir) — the standalone `landingpage/` is a separate marketing page.

---

## 4. Deployment Architecture

| Layer | Provider | Detail |
|---|---|---|
| **Client** | **Vercel** | `orbit-client-live` repo → `orbit-your-inner-circle.vercel.app`. SPA rewrites + `/api/*` and `/socket.io/*` proxied to Render. `vercel.json` handles rewrites + SW cache headers. |
| **Server** | **Render** | `orbit-server-live` repo → `orbit-server-live.onrender.com`. Free tier (sleeps after inactivity — cold starts). Express + Socket.IO + MongoDB + Redis. |
| **MongoDB** | (via MONGO_URI env) | Primary database |
| **Redis** | **Upstash** (REST) + **TCP `REDIS_URL`** | Upstash REST: caching, rate limits, presence, realtime event backfill log. TCP Redis (`REDIS_URL`): BullMQ queues + Socket.IO pub/sub adapter |
| **Media** | **Cloudinary** + **ImageKit** | Both configured for image/video storage |
| **Calls** | **LiveKit** | WebRTC rooms (server SDK on backend, client SDK on frontend) |
| **Search** | **Meilisearch** | Full-text search |
| **Email** | **Brevo** (primary) | Transactional email — `BREVO_API_KEY`; falls back to SendCoreX / Resend / SMTP when unset |
| **Push** | **Web Push (VAPID)** | PWA notifications — keys configured via `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` envs |
| **Monitoring** | **Sentry** | Client + server error tracking |

### Key env vars (server — full list in `server/src/configs/env.ts`)
- `MONGO_URI` — MongoDB connection string (required)
- `JWT_SECRET` — JWT signing secret (required)
- `CLIENT_URL` — frontend origin for CORS/OAuth/email links (required)
- `CLOUDINARY_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` (required)
- `TRUST_PROXY` — set `1` behind Render/Heroku so client IPs are read from X-Forwarded-For
- `BREVO_API_KEY` / `BREVO_FROM_EMAIL` / `BREVO_SENDER_NAME` — primary transactional email
- `PUBLIC_API_URL` — own URL; powers the keep-alive pinger (free tier stays awake)
- `LANDING_PAGE_URL` — marketing-page origin (waitlist form CORS/CSRF)
- `REDIS_URL` — TCP Redis for BullMQ queues (exact-time scheduled posts, retried emails, offloaded webhooks/push/gamification/media/chat-forward, repeatable maintenance jobs)
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — caching, rate limits, presence, realtime event log
- `UPSTASH_REDIS_URL` — TCP Redis for the Socket.IO pub/sub adapter (multi-instance realtime)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` — Google OAuth
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` — web push
- `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` / `LIVEKIT_URL` — group calls
- `GEMINI_API_KEY` — optional; gives bot-farm conversations real context
- `IMAGEKIT_PUBLIC_KEY` / `IMAGEKIT_PRIVATE_KEY` / `IMAGEKIT_URL_ENDPOINT` — media fallback
- `SENTRY_DSN` — error monitoring (optional)
- `LOGTAIL_SOURCE_TOKEN` — cloud log shipping (optional)
- `TURNSTILE_SECRET_KEY` — waitlist anti-spam (optional)
- `WAITLIST_REQUIRED` / `INVITE_REQUIRED` / `INVITE_TTL_DAYS` — signup gates
- `DB_POOL_SIZE` — Mongo pool override (prod default 50; `autoIndex` is off in prod — index changes are applied via `npm run db:sync-indexes`)

### Key client-side mechanisms
- **Offline-first**: CacheStorage + Dexie (IndexedDB) + service worker (Workbox: NetworkFirst for API, CacheFirst for static) + offline sync queue
- **Stale-while-revalidate**: cache-first reads with a 30s background refresh timer
- **Realtime**: Socket.IO with per-user rooms (`user:<id>`), conversation/community rooms, presence heartbeat, and `events:sync` reconnect backfill (per-user Redis event log)
- **Auto-update on deploy**: SW registered with `updateViaCache: 'none'`, polled every 5 min + on tab focus; `skipWaiting` + `clientsClaim` + a `NEW_VERSION` message handshake reload the app automatically — users never hard-reload after a deploy
- **Optimistic mutations**: instant UI updates with server reconciliation; all mutation paths evict affected caches across every layer (CacheStorage + SW caches + Dexie)

---

## 5. Scripts & utilities (server/scripts/)

| Script | Purpose |
|---|---|
| `inventory-db.ts` | Read-only DB inventory (collections, users, waitlist) |
| `inspect-follows.ts` | Audit follower/following count consistency |
| `repair-follow-counts.ts` | Re-sync counters from the authoritative Follow collection |
| `clear-follow-caches.ts` | Purge stale follow/profile cache keys |
| `stop-bot-farm.ts` | Disable the bot farm in the DB |
| `make-admin.ts` | Promote a user to admin |
| `sync-indexes.ts` | Build missing Mongo indexes for all models — **run once against prod after any schema index change** (`npm run db:sync-indexes`; auto-falls back to `syncIndexes()` per-model when a legacy index name-collides, e.g. the old non-partial unique save/repost indexes) |
| `inventory-db.ts` / `inspect-*.ts` | Read-only DB audits |
| `seed-*.ts` / `reset-content.ts` | Seed / reset dev data |
| `load-env.ts` | Load `.env` before src imports (env validation) |
