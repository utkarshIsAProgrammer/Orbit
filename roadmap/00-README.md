# 🗺️ ORBIT — Full Learning Roadmap

> Everything in this project, explained: the technologies, the concepts, the
> why-behind-every-decision, and **exactly where each thing lives in the code**.
> Read this folder top-to-bottom and you will understand the entire app —
> server, client, realtime, queues, offline, bots, deployment — well enough to
> build it again from scratch and to work on it alone.

---

## How to use this roadmap

1. **Read in order.** Each file builds on the previous ones. Start at `01`.
2. **Open the referenced files as you go.** Every section names real files —
   read them alongside the explanation, not after. Learning = reading code +
   reading why.
3. **Do the exercises at the end of each file.** They are the difference
   between "I read it" and "I understand it."
4. **When stuck on a term, check `15-glossary.md`** first, then the external
   docs it links.
5. **Run the app locally** before/while reading — see `02-architecture.md`
   for setup. Code you have run is code you understand.

---

## The files

| # | File | What it teaches |
|---|------|-----------------|
| 00 | `00-README.md` (this) | Master index + learning path |
| 01 | `01-project-map.md` | The complete file-by-file map of the whole repo |
| 02 | `02-architecture.md` | Monorepo layout, deployment topology, request lifecycle, data flow |
| 03 | `03-typescript-express.md` | TypeScript, Express 5, routing, middleware, validation, error handling |
| 04 | `04-mongodb-mongoose.md` | MongoDB + Mongoose: schemas, indexes, queries, schema design |
| 05 | `05-auth-security.md` | JWT, cookies, CSRF, OAuth, rate limiting, uploads, SSRF, sanitization |
| 06 | `06-caching-performance.md` | Cache layers, invalidation, Cache-Control, feed caching, perf decisions |
| 07 | `07-realtime-socketio.md` | Socket.IO: rooms, adapter, presence, reconnect backfill, calls |
| 08 | `08-bullmq-queues.md` | The 10 background queues, workers, delayed/repeatable jobs, fallbacks |
| 09 | `09-react-client.md` | React architecture: App.tsx, hooks, components, gestures, code splitting |
| 10 | `10-offline-pwa.md` | Service worker, Dexie, sync queue, auto-update, web push |
| 11 | `11-features-core.md` | Feed ranking, gamification, communities, calls, glances, invites, admin |
| 12 | `12-bots-external-sync.md` | The bot farm + Bluesky/Mastodon/Lemmy/PeerTube sync |
| 13 | `13-testing-debugging.md` | Jest/vitest setup, logging, Sentry, the bug war stories |
| 14 | `14-deployment-ops.md` | Render/Vercel, clustering, env vars, shutdown, production bugs |
| 15 | `15-glossary.md` | Every technology + concept, one line each, with learning links |

---

## The 30,000-foot story (read this first)

ORBIT is a **social network for your inner circle** — posts, chat, communities,
calls, stories ("glances"), gamification, and a heavy **offline-first, realtime
client**. It is a **monorepo** with three apps:

```
orbit/
├── client/       → the main app (React SPA, deployed to Vercel)
├── server/       → the API + realtime backend (Express + Socket.IO, Render)
├── landingpage/  → a separate animated marketing page (React + Three.js)
└── docs/ + roadmap/ → documentation (this)
```

The **server** (Node.js/TypeScript) talks to:
- **MongoDB Atlas** (the database, via Mongoose) — everything is stored here
- **Redis** — two roles: Upstash REST (caching, rate limits, presence, the
  realtime event log) and a TCP Redis (BullMQ background queues + Socket.IO
  pub/sub for multi-instance)
- **Cloudinary / ImageKit** — media storage (uploads + CDN delivery)
- **Brevo** — transactional email
- **LiveKit** — WebRTC group audio/video calls
- **Google** — OAuth login
- **Bluesky / Mastodon / Lemmy / PeerTube** — public feeds for the "Web" tab

The **client** (React 19 + Vite + TypeScript + Tailwind v4) is the interesting
part: it is **offline-first**. Every API response is cached in THREE places
(browser CacheStorage, IndexedDB via Dexie, and the service worker's caches),
reads are served from cache instantly and refreshed in the background
(stale-while-revalidate), and mutations made offline are queued in IndexedDB
and replayed when the network returns. Realtime events (new messages, likes,
notifications) arrive over **Socket.IO** and are written into those same caches
so nothing is lost across reloads.

---

## Suggested learning order (with time estimates)

1. **Week 1 — Run it + the map.** `01` and `02`. Get it running locally,
   walk every folder. Goal: you can point at any file and say what it is.
2. **Week 2 — The request path.** `03`, `04`, `05`. Follow one request
   (a POST /api/posts) from route → middleware → controller → model → response.
3. **Week 3 — Making it fast.** `06`, `07`, `08`. Understand the cache layers,
   realtime, and why background queues exist.
4. **Week 4 — The client.** `09`, `10`. React architecture + offline/PWA.
5. **Week 5 — The features + the weird stuff.** `11`, `12`. Feed ranking,
   gamification, bots, external sync.
6. **Week 6 — Quality + operations.** `13`, `14`, `15`. Tests, debugging,
   deployment, the production bugs that were actually hit.

---

## Golden rules for learning this codebase

- **Everything has a comment.** This codebase explains itself unusually well —
  read the block comments *above* each function; they contain the "why".
- **The "why" is in the git log too.** `git log --oneline` tells the story:
  which bug each change fixed. `git log -p <file>` shows how it evolved.
- **The tests are documentation.** `server/src/__tests__/*.test.ts` shows how
  each feature is *supposed* to behave. Read a test before the code it tests.
- **The docs/ folder** (STACK.md, ENV.md, ADMIN_GUIDE.md, GESTURES.md,
  FEATURES.md) is the maintained reference — update it when you change code.
- **When you don't know a concept** (e.g. "what is a TTL index?"), read the
  glossary (`15`), then the official docs it links, then find it in THIS code.
