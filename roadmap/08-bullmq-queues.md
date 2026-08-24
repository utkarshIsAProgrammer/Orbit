# 08 — BullMQ: The 10 Background Queues

> Slow or retryable work never runs on a request path in this app — it's
> enqueued to a **BullMQ queue** (Redis-backed) and a worker executes it. Ten
> queues cover everything from exact-time scheduled posts to Cloudinary media
> cleanup. The entire implementation lives in `server/src/configs/queue.ts`.
>
> **Free-tier gate:** BullMQ is disabled by default (`ENABLE_BULLMQ=false`).
> When disabled, all enqueue helpers return `false` and callers fall back to
> their inline implementations (node-cron / direct send). This saves ~50K
> Redis commands/day from idle BRPOPLPUSH polling. Set `ENABLE_BULLMQ=true`
> and provide `REDIS_URL` to re-enable.

---

## 1. Why queues at all? (the arguments, from this codebase's history)

1. **Response latency** — a like used to trigger ~5 DB writes + a socket emit +
   a push *inside the request*. Now it responds in ms and the fan-out runs on a
   worker.
2. **Third-party timeouts** — a webhook delivery can take up to **10s** against
   a slow endpoint; web-push makes an HTTP call per device subscription. That
   used to occupy the event loop on like/comment paths.
3. **Retries** — fire-and-forget `.catch(()=>{})` silently *loses* work. BullMQ
   gives `attempts` + exponential `backoff`, so a Brevo 429 or dead webhook
   gets retried.
4. **Failure isolation** — a slow third party can't wedge the event loop or
   exhaust the DB pool serving user requests.
5. **Cross-process dedupe** — you run 2 cluster workers. In-process timers run
   **once per worker** (double-running!). BullMQ **repeatable jobs** store the
   schedule in Redis → run once. (The 4 maintenance crons were literally
   double-running before conversion.)
6. **Exact-time scheduling** — delayed jobs fire at the second, vs a 1-min
   cron poll that could publish 60s late.
7. **Backpressure** — a viral post's thousands of like-triggered jobs queue in
   Redis instead of spawning unbounded concurrent work; each worker caps
   concurrency (5 emails, 10 notifications…).

**The honest trade-offs:** every enqueue is a Redis round-trip (~1ms — silly
for a single fast write); payloads are JSON-only (no Mongo docs or buffers —
uploads stay inline); anything whose result the response needs can't be queued.

> **Free-tier warning:** BullMQ workers poll Redis every few milliseconds
> (`BRPOPLPUSH`), burning ~50K commands/day even when idle. On Upstash free
> tier (10K commands/day), this alone exhausts the quota. Always set
> `ENABLE_BULLMQ=false` on free tiers and let the inline fallbacks handle
> the work.

## 2. The ten queues (`QueueName` enum)

| Queue (Redis name) | Job | What the worker does |
|---|---|---|
| `orbit-scheduled-posts` | `publish` | Publish a post at its exact `scheduledAt` (delayed job) |
| `orbit-emails` | `send` | Send transactional email via Brevo chain |
| `orbit-notifications` | `create` / `delete` | Notification fan-out: DB + socket + push |
| `orbit-account-deletion` | `purge` | Full account data wipe (Cloudinary destroys + ~15 collections) |
| `orbit-webhooks` | `deliver` | SSRF-guarded POST to every active webhook of the owner |
| `orbit-push` | `send` | web-push delivery per device subscription |
| `orbit-scheduled-maintenance` | `maintenance` | Repeatable jobs: affinity recompute, notification pruner, mission reset, streak breaker, external-sync poll |
| `orbit-gamification` | `award_xp` / `progress_mission` / `check_badge` / `check_all_rounder` / `log_interaction` | XP, missions, badges, affinity interactions |
| `orbit-media-cleanup` | `destroy` | Cloudinary destroys for deleted content |
| `orbit-chat-forward` | `forward` | Create the forwarded-item chat message (socket delivers to both sides) |

**Names note:** BullMQ **forbids `:` in queue names** — that's why they're
`orbit-*` (dash), not `orbit:*`. This exact bug took production down (see 14).

## 3. How a queue is wired (the reusable pattern)

```ts
// 1. Enum name + lazy singleton
const getGamificationQueue = (): Queue | null => {
  if (!isAvailable()) return null;            // ENABLE_BULLMQ=false or no REDIS_URL → disabled
  if (!gamificationQueue) gamificationQueue = new Queue(QueueName.GAMIFICATION, { connection });
  return gamificationQueue;
};

// 2. Enqueue helper — try/catch, returns boolean
export async function enqueueGamification(action, params): Promise<boolean> {
  try {
    const q = getGamificationQueue();
    if (!q) return false;                      // caller falls back to inline
    await q.add(action, { action, params }, {
      attempts: 3, backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 604800 },
    });
    return true;
  } catch (err) { logger.error(...); return false; }
}
```

**The graceful-fallback pattern (learn this):** every `enqueueX` returns
`false` when BullMQ is unconfigured or the enqueue fails, and every caller has
an `*Inline` implementation that does the same work synchronously:

```ts
export async function awardXP(...) {
  const queued = await enqueueGamification("award_xp", {...});
  if (queued) return;
  await awardXPInline(...);   // same work, inline — old behavior preserved
}
```

**Why it matters:** the app NEVER depends on Redis. No `REDIS_URL` or
`ENABLE_BULLMQ=false` → identical behavior, just slower (inline execution).
That's how tests run (no Redis in CI), how the app works on a fresh Render
instance, and how it stays free-tier-safe.

## 4. `startQueueWorkers()` — one worker per queue

Each worker: `new Worker(QueueName.X, async (job) => { ... }, { connection, concurrency: N })`.
Workers **lazily import** the handler modules (`await import(...)`) to avoid
circular imports. Every worker has a `.on("failed")` logger.

Concurrency choices encode the workload: notifications 10 (many small DB jobs),
gamification 5, media cleanup 5, webhooks 5, account deletion 2 (heavy),
maintenance 1 (bounded DB passes).

**Boot hardening:** `startQueueWorkers()` never throws — if any worker fails to
construct it logs and the boot continues (a queue problem must never kill
`server.listen()`; that was the "no open port" production bug).

## 5. Repeatable jobs (the cron replacement)

`registerMaintenanceJob(task, cronPattern)`:

```ts
await q.upsertJobScheduler(task, { pattern: cronPattern }, { name: "maintenance", data: { task } });
```

The schedule lives **in Redis**, so all workers call this with the same task
name and only ONE schedule exists → no double-running. Current schedules:

- `affinity-recompute` — `*/30 * * * *` (every 30 min)
- `notification-pruner` — `0 3 * * *` (daily 3am)
- `daily-mission-reset` — `0 0 * * *` (midnight)
- `streak-break-checker` — `0 * * * *` (hourly)
- `external-sync` — `*/15 * * * *` (every 15 min)

Each `startX()` in `scheduler.ts` tries `registerMaintenanceJob` and falls back
to **node-cron** when BullMQ is unconfigured (the same graceful pattern).

## 6. Delayed jobs (exact-time scheduling)

`enqueueScheduledPostPublish(postId, scheduledAt)` computes
`delay = scheduledAt - now` and adds the job with that `delay`. The worker
calls `publishScheduledPost(postId)`. The 1-minute cron poll remains as the
**safety net** fallback when Redis is unset.

## 7. Shutdown — closing workers AND queues

`closeQueues()` closes every **worker first** (`worker.close()` — stops
polling, drains in-flight jobs), then every queue connection. This was a real
gap: closing queues alone left workers polling Redis, and `process.exit()`
killed their sockets mid-command → the `write EPIPE` noise on every deploy
(see 14).

## 8. What intentionally stays OFF the queues

- **Uploads** — multipart buffers can't be JSON job payloads.
- **Cache invalidation** — must be immediate; a queued invalidate creates a
  stale-read window.
- **Translation / link previews** — the HTTP response IS the result.
- **Bot farm / external firehose** — long-lived in-process state machines.

---

## Exercises

1. Read `queue.ts` `startQueueWorkers` and list the concurrency of each worker.
   Why does the maintenance worker use concurrency 1?
2. Explain the graceful-fallback pattern: what does `enqueueX` return when
   Redis is down, and what does the caller do with it?
3. Why were the maintenance crons double-running in cluster mode, and how do
   `upsertJobScheduler` + Redis fix it?
4. `startQueueWorkers` must never throw — what production bug does that rule
   prevent, and what's the boot-order rule in `server.ts` that backs it up?
