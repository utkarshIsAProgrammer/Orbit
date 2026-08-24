# QUICKSTART — Run Orbit Locally in 5 Minutes

This doc gets you from a fresh clone to a running app as fast as possible.
For the deep explanations behind everything here, read `roadmap/02-architecture.md`
and `roadmap/14-deployment-ops.md`.

---

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 20+ (prod uses 24) | Both server and client |
| MongoDB | Local or Atlas URI | Primary database |
| Redis | Local or Upstash URI | BullMQ queues + socket.io adapter |
| pnpm or npm | any recent | Client uses pnpm lockfile, server npm |

You can run with **zero external services** in the fallback paths — the app
degrades to in-memory queues and in-process caches when Redis is missing, and
every external integration (mail, media, OAuth) has a code path that logs and
continues. But for the full experience you want Mongo + Redis.

---

## 2. Env setup

Both folders need a `.env` file. The full variable list is in `docs/ENV.md`.

### Server (`server/.env`)

Minimal set to boot:

```bash
NODE_ENV=development
PORT=5006
MONGO_URI=mongodb://localhost:27017/orbit
JWT_SECRET=dev-secret-change-me
CLIENT_ORIGIN=http://localhost:5173
```

Then add whatever integrations you want to exercise (Brevo, Cloudinary,
Google OAuth, Upstash Redis…) — everything is optional at boot.

> Tip: the server loads `.env` via `dotenv` (see `server/src/configs/env.ts`).
> It logs `injected env (N) from .env` at boot — that count tells you it found
> your file.

### Client (`client/.env`)

```bash
VITE_API_URL=http://localhost:5006
```

> If unset, the client talks to the same origin as the page and the Vite dev
> server proxies `/api/*` to `http://localhost:5006` (see `client/vite.config.ts`).

---

## 3. Start the server

```bash
cd server
npm install
npm run dev        # tsx watch — auto-restarts on save
```

You should see (in order): env injected → MongoDB connected → socket.io
initialized → BullMQ workers started → `Server is running on PORT: 5006`.

### Common boot problems

| Symptom | Cause / fix |
|---|---|
| `Queue name cannot contain :` | Queue names must use `-`, never `:`. All current names are `orbit-*`. |
| Hangs at "No open ports" (Render) | Old bug — fixed. Port binds before background services now. |
| Mongo auth failure | Wrong `MONGO_URI` or the URI's special chars need URL-encoding. |
| Redis errors everywhere | BullMQ + socket adapter fall back to in-process modes; read the warnings but the app stays up. |

---

## 4. Start the client

```bash
cd client
pnpm install       # or npm install
pnpm dev           # vite dev server on http://localhost:5173
```

Open **http://localhost:5173**. You'll land on the marketing/waitlist page;
sign up or log in to get into the app.

---

## 5. Useful commands

```bash
# Server
cd server
npm run typecheck        # TS check only (fast)
npm test                 # all Jest suites (uses mongodb-memory-server, no real DB needed)
npm run test:watch       # watch mode
npm run build && npm start   # production build + run
npm run db:sync-indexes  # build missing Mongo indexes (prod after deploy)

# Client
cd client
npm run lint             # tsc --noEmit
npm test                 # vitest
npm run build            # vite build (also emits sw.js)
```

---

## 6. Seed data (optional)

```bash
cd server
npm run seed:test-user    # creates a test account
npm run make-admin        # promotes a username to admin
```

The **bot farm** can be turned on in dev via its env gates — see
`roadmap/12-bots-external-sync.md`. The waitlist invite sender is
`npm run invite:waitlist`.

---

## 7. First-things-first tour

Once running, in order:

1. Sign up → you're on the Feed
2. Post something → watch it appear via socket (open a second tab, post there, watch tab 1 update)
3. Open DevTools → Application → Service Workers → you'll see `sw.js` controlling the page
4. Reload → the page loads from the service worker cache instantly (see Network tab, "from service worker")
5. Open another tab → the tabChunks prefetch kicks in (see Network tab after idle)

That's the whole loop: instant boot, realtime updates, offline resilience.
Everything else in the app is built on those three foundations.
