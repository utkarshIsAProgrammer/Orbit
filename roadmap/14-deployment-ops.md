# 14 — Deployment & Operations: Render, Vercel, Env, Shutdown, The Bugs

> How the app actually runs in production, the environment it needs, the
> shutdown sequence, and the production incidents that shaped the code. Read
> this with `docs/ENV.md` and `docs/STACK.md` open.

---

## 1. Where things run

| Layer | Provider | Notes |
|---|---|---|
| Client SPA | **Vercel** | `vercel.json` rewrites + `/api/*` and `/socket.io/*` proxied to Render |
| API server | **Render** | Node cluster (2 workers), `node dist/server.js`, build = `npm run build` (`tsc`) |
| Database | **MongoDB Atlas** | Shared cluster, `MONGO_URI` in env |
| Redis (cache/limits/presence/log) | **Upstash** REST | `UPSTASH_REDIS_REST_URL/TOKEN` |
| Redis (queues + socket adapter) | TCP Redis | `REDIS_URL` (BullMQ) + `UPSTASH_REDIS_URL` (adapter) |
| Media | **Cloudinary** (+ ImageKit) | `CLOUDINARY_*` / `IMAGEKIT_*` |
| Email | **Brevo** | `BREVO_API_KEY` (SendCoreX/Resend/SMTP fallbacks) |
| Calls | **LiveKit** | `LIVEKIT_URL` + API key/secret |
| Monitoring | **Sentry** (optional) | `SENTRY_DSN` — **not currently configured in prod** |

## 2. The env contract (all of it)

- The **authoritative list** is `server/src/configs/env.ts` (Zod schema) —
  `MONGO_URI`, `JWT_SECRET`, `CLIENT_URL`, `CLOUDINARY_*` are **required**;
  everything else optional with defaults.
- `docs/ENV.md` is the human-readable version with the "mandatory / necessary /
  launch-gates / optional" buckets. **Keep them in sync when you add env vars.**
- Frontend: `VITE_API_URL` (no trailing `/api` — the code appends it) and
  `VITE_SOCKET_URL`; optional `VITE_ICE_SERVERS`, `VITE_SENTRY_DSN`.
- **Secrets hygiene:** `.env*` and `docs/` are gitignored; GitHub push
  protection + a pre-commit hook scan for secrets. Never put real keys in docs
  (a past `CREDENTIALS.md` with live secrets was removed; rotate anything that
  ever touched a committed file).

### Free-tier env vars (Render + Upstash + Vercel)

| Variable | Value | Why |
|---|---|---|
| `ENABLE_BULLMQ` | `false` | Disables BullMQ workers — saves ~50K Redis commands/day from idle polling. All callers fall back to node-cron / inline execution. |
| `CLUSTER_ENABLED` | `false` (optional) | Disables Node cluster — single process on free tier (1 CPU). |
| `SOCKET_REDIS_ADAPTER` | `false` (default) | Socket.IO uses in-memory adapter — no Redis pub/sub traffic. |
| `PUBLIC_API_URL` | your Render URL | Keep-alive pinger prevents Render free from sleeping. |

**When `ENABLE_BULLMQ=false`:** scheduled posts use 1-min cron poll, emails
send inline, notifications/gamification run on the request path, cache
invalidation uses in-memory SCAN. All features work — just slightly higher
request latency (~200ms) on mutation paths.

## 3. Clustering & the boot sequence

`server.ts`:

- Prod + `CLUSTER_ENABLED !== "false"` → fork up to `CLUSTER_MAX_WORKERS` (2)
  processes; the primary exits; workers share the port. Cluster mode is what
  made cron double-running a real bug (fixed via BullMQ repeatables, see 08).
- **Boot order (current, hardened):** `connectDB()` → `initSocket()` →
  **`server.listen(port)` FIRST** → then schedulers → `startQueueWorkers()` →
  `startExternalSync()` → `startBotFarm()`.
  Why listen first? A background-service failure must never leave a live
  process with no open port (Render's port scan then flags the deploy and
  restart-loops). That exact bug (queue-name crash) took production down.

## 4. The port story

- Render scans for an open port after boot. The app binds `env.PORT` (5006).
- The old bug: `server.listen()` came AFTER `startQueueWorkers()`, which threw
  → no port → "No open ports detected" + restart loop, even with `PORT` set.
- Fix: reorder (listen first) + make `startQueueWorkers` never throw.

## 5. Graceful shutdown (what happens on every deploy)

`SIGTERM` → `gracefulShutdown()`:

1. `server.close()` — stop accepting new connections.
2. Inside its callback: **`closeQueues()`** — workers first (drain in-flight
   jobs, close their Redis connections cleanly), then queue connections.
3. `shutdownSocket()` — Redis adapter pub/sub `quit()`, `io.close()`.
4. `mongoose.disconnect()`.
5. 30s force-exit timeout as a backstop.

**Why the order matters:** closing queues before stopping HTTP would let new
requests enqueue during teardown; not closing workers at all caused the
`write EPIPE` noise (their sockets died mid-command at `process.exit`).

## 6. The production incidents (the "why" behind the current code)

1. **Queue-name crash (the big one).** BullMQ rejects `:` in queue names; the
   10 `orbit:*` queues threw in `startQueueWorkers` → no port → restart loop.
   Also: maintenance jobs silently fell back to node-cron (so the app "worked"
   but BullMQ never did). Fix: dash names + hardened boot. **Lesson: read
   library constraints, and make boot failure non-fatal for background work.**
2. **"No open ports detected"** — same root cause; the port-scan error was the
   symptom, not the disease.
3. **EPIPE on every deploy** — shutdown didn't close workers (see §5).
4. **Affinity recompute log spam at 02:00** — that was the node-cron fallback
   doing its job (52 bots = 52 recomputes). With `REDIS_URL` set, it now runs
   as ONE repeatable BullMQ job.
5. **Save-index conflict** — the legacy non-partial unique index blocked the
   schema's partial replacement (`user_1_post_1` name collision); `npm run
   db:sync-indexes` now auto-falls back to `syncIndexes()` per model.
6. **Stale-shell on slow connections** — the SW's 1.8s nav timeout can serve
   the old shell; the stale-chunk self-heal reloads once (see 10).

## 7. Operational runbook (the day-to-day)

| Task | Command / place |
|---|---|
| Deploy | Push to main (Render + Vercel auto-deploy). Client changes reach users ≤5 min via the SW auto-update |
| See logs | Render dashboard; structured JSON, filter by `level` / `message` |
| Promote a user to admin | `npm run make-admin -- --email x@y.com` |
| Build new DB indexes after a schema change | `npm run db:sync-indexes` (against prod) |
| Stop the bots | `npx tsx scripts/stop-bot-farm.ts` |
| Ban/mute/verify a user | Admin dashboard (Shield icon) |
| Check queue health | Search Render logs for `BullMQ: ... failed` (a queue dashboard is a known gap) |
| Inspect the DB | `npx tsx scripts/inventory-db.ts` |
| Fix drifted counters | `scripts/inspect-follows.ts` → `repair-follow-counts.ts` → `clear-follow-caches.ts` |
| Enable BullMQ (upgraded plan) | Set `ENABLE_BULLMQ=true` + `REDIS_URL` in Render env |
| Check Redis usage | Upstash dashboard → Usage tab; should be <5K commands/day on free tier |

## 8. Known gaps (be honest about these)

- **No DB backups** — the `backup:db` script is referenced in package.json but
  the script file doesn't exist; Atlas free tier has no automated backups.
  **This is the #1 pre-launch gap.**
- **Sentry not configured** in prod — no error alerting; `@sentry/node` is
  installed, just needs `SENTRY_DSN`.
- **No queue observability** — failed jobs are log-only.
- **External feed sync is flaky** (Bluesky/Lemmy API errors in logs) — degrades
  gracefully, but the Web tab can be sparse.
- **Bot farm runs in production** — simulated users interacting with real ones;
  a trust decision, config-gated.
- **In-memory caches lose state on restart** — the route-level cacheMiddleware
  and generalLimiter use in-memory stores. Fine for single-instance free tier;
  would need Redis backing for multi-instance deployments.

---

## Exercises

1. Reconstruct the queue-name crash: what threw, where, and why did the port
   never open? What two fixes prevent the whole class?
2. Walk the shutdown sequence and explain what `closeQueues()` closes and why
   workers must come before queues.
3. What's the one-line rule for boot order in `server.ts`, and which bug made
   it a rule?
4. List the three pre-launch gaps from §8 in priority order and say what each
   needs to be closed.
