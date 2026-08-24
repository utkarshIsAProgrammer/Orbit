# MONITORING — Observability for Orbit

Current state (verified): **no error monitoring in production** (logs say
`Sentry DSN not configured — skipping`), Logtail token is optional, and queue
health is only visible in logs. This doc covers what exists, how to read it,
and how to wire the missing pieces.

---

## What exists today

| Layer | Tool | Status |
|---|---|---|
| App logs | Structured JSON via `logger` (`server/src/configs/logger.ts`) | ✅ Always on |
| Log shipping | **Logtail** (`LOGTAIL_SOURCE_TOKEN` env) | ⚠️ Optional — wire it to get off Render's ephemeral logs |
| Error tracking | **Sentry** (`@sentry/node` installed, `SENTRY_DSN` env) | ❌ Unconfigured in prod |
| Uptime | Render health checks + keep-alive scheduler (pings `/api/ping` every 5 min) | ✅ On |
| DB health | Atlas dashboard + Performance Advisor | ✅ Free tier available |
| Queue health | Log-only (`[BullMQ] Workers started`, job completions) | ⚠️ No dashboard |

---

## Reading the logs (Render → Logs tab)

Every log line is JSON: `{ environment, level, message, pid, service, ...context }`.

- `level: "error"` — real errors (unhandled rejections, failed integrations)
- `level: "warn"` — degraded-but-alive (external sync failures, queue fallbacks)
- `level: "info"` — lifecycle (boot, workers, maintenance registrations, shutdown)

### Healthy boot sequence (what "all good" looks like)

```
Mail transport: brevo (primary)
MongoDB connected successfully!
Socket.io Redis adapter initialized
[BullMQ] Workers started (scheduled-posts, emails, ...)
Server is running on PORT: 5006
BullMQ: maintenance job registered × 5   ← repeatable jobs live
Keep-alive ping OK
```

### Red flags

| Log line | Meaning |
|---|---|
| `Unhandled Promise Rejection` | A promise escaped — often a teardown race or integration failure. Investigate if repeated. |
| `[ioredis] Unhandled error event` / `write EPIPE` | Redis socket died mid-write. Fixed at shutdown; if it appears mid-run, Redis connectivity is unstable. |
| `BullMQ: failed to register maintenance job` | Queue registration failed (old `orbit:` bug, or Redis down). App falls back to node-cron — degraded. |
| `Queue name cannot contain :` | **Must never appear** — that was the boot-crash bug; names are `orbit-*` now. |
| `MongoDB disconnected` (not during shutdown) | Atlas issue or connection cap (pool was trimmed to 50). |
| `No open ports detected` | Boot died before `listen()`. Check for a throw in startup (queue/worker errors). |

---

## What to wire up (recommended, in order)

### 1. Sentry — error tracking (15 minutes)

`@sentry/node` is already installed. In `server/src/server.ts` (or a config):

```ts
import * as Sentry from "@sentry/node";
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: "production" });
}
```

Then attach `Sentry.Handlers.requestHandler()` / `errorHandler()` to the
Express pipeline. Now every 500, every unhandled rejection, and every
failed queue job can report with stack traces — instead of waiting for a
user to complain.

### 2. Logtail — durable logs

Set `LOGTAIL_SOURCE_TOKEN` (the logger already detects it). Logs stream to
Logtail and survive Render log rotation / redeploys. Add alerts on
`level:error` + `message:Unhandled`.

### 3. Queue observability

Today: grep the logs. Better options when you're ready:
- **BullMQ `failed`/`stalled` event listeners** in `startQueueWorkers` → log + Sentry capture
- **Bull Board** (`@bull-board/api` + express adapter) — a web UI showing each queue's counts (waiting/active/failed), retry buttons. It's a read-only dashboard mounted at a protected route — small effort, big visibility.

### 4. Atlas Performance Advisor (free)

Atlas → your cluster → Performance Advisor tab. It reads real `explain()`
data from your live workload and recommends missing indexes. Run it before
guessing at indexes.

---

## Health-check endpoints

- `GET /api/ping` — liveness (used by Render + keep-alive scheduler)
- `GET /api/health` — if present, deeper checks (Mongo/Redis connectivity) — verify in routes

---

## The keep-alive scheduler

`server/src/configs/scheduler.ts` registers a ping to the public URL every 5
minutes. This keeps the free Render instance from cold-sleeping. If you see
"Keep-alive ping OK / status 200" in the logs, the scheduler is healthy.

---

## Alerting rules of thumb

Alert on:
1. `No open ports detected` (service down)
2. `Unhandled Promise Rejection` count > 0 outside graceful shutdown
3. Queue job failure rate > 0 for core queues (notifications, emails, scheduled-posts)
4. MongoDB disconnected while running
5. Keep-alive ping non-200 for 2 consecutive checks
