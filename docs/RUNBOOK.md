# 🚨 ORBIT — Operations Runbook

> What to do when something goes wrong (or before it does). The app runs on
> **Vercel** (client) + **Render** (server) + **MongoDB Atlas** + **Redis**
> (Upstash REST + TCP) + **Cloudinary** + **Brevo** + **LiveKit**.

---

## 0. Where to look first

| Symptom | Look at |
|---|---|
| Anything | Render logs (structured JSON: `{"level":"info"|"warn"|"error", "message":...}`) |
| A 5xx / slow request | Request-logging middleware prints any request > 5s with `requestId` |
| A background job failed | `BullMQ: <queue> job failed` log lines |
| Client crash | Client console + Sentry (once `SENTRY_DSN` is set) |
| Deploy issues | Render Deploys tab + Vercel Deployments tab |

---

## 1. Deploy (routine)

1. Push to `main`. Render + Vercel auto-deploy.
2. Client changes reach users **≤ 5 min** via the service-worker auto-update
   (5-min poll + tab-focus + `NEW_VERSION` auto-reload). No user action needed.
3. Verify: Render log shows `Server is running on PORT: <port>` and
   `Your service is live`; Vercel deploy is green.
4. **If the deploy changed DB indexes** (model schema edits): run
   `npm run db:sync-indexes` once against prod after deploy.

## 2. Rollback

- **Client:** Vercel → Deployments → pick the previous green deploy → "Redeploy".
  Users get the old code within ~5 min automatically.
- **Server:** Render → Deploys → previous deploy → "Redeploy".
- The old code is fine to serve — index changes are the only thing that can't
  roll back cleanly (new code queries new indexes; old code doesn't need them).

## 3. The incidents we've already had (and their fixes)

| Incident | Symptom | Root cause | Fix (shipped) |
|---|---|---|---|
| **Restart loop / no open port** | "No open ports detected" + constant restarts; app unreachable | BullMQ forbids `:` in queue names → `startQueueWorkers()` threw → `server.listen()` never ran | Dash queue names + `startQueueWorkers` never throws + **port binds before background services** |
| **EPIPE noise on every deploy** | `[ioredis] Unhandled error event: write EPIPE` + "Connection is closed" at shutdown | Shutdown closed queues but not workers; `process.exit()` killed worker sockets mid-command | `closeQueues()` closes workers first, gracefully |
| **Users stuck on old version** | "I have to hard-reload after every deploy" | Stale `/sw.js` from HTTP cache; hourly poll; unreliable `controllerchange` on iOS | `updateViaCache:"none"` + 5-min poll + `NEW_VERSION` message handshake |
| **Index sync failure** | `npm run db:sync-indexes` → "FAILED Save: existing index has the same name" | Legacy non-partial unique index blocks the schema's partial replacement | Script auto-falls back to `syncIndexes()` per failing model |
| **Google login fails on mobile** | Login works on desktop, fails on phone | OAuth state cookie split across origins; mobile drops redirect cookies | Relative OAuth start + one-time `oauth-exchange` code swap |
| **Cold start 503** | Intermittent 503 on login | Render free tier sleeps the instance | `PUBLIC_API_URL` keep-alive + client retry with "Waking up server…" |

## 4. Queue health (BullMQ)

The 10 queues: `orbit-scheduled-posts`, `orbit-emails`, `orbit-notifications`,
`orbit-account-deletion`, `orbit-webhooks`, `orbit-push`,
`orbit-scheduled-maintenance`, `orbit-gamification`, `orbit-media-cleanup`,
`orbit-chat-forward`.

**Checks (no dashboard yet — logs only):**
- Health: `grep "BullMQ" logs` → `Workers started` at boot, `maintenance job registered` ×5.
- Failures: search Render logs for `BullMQ: .* failed`.
- If a queue is stuck: jobs retry automatically (`attempts` + exponential
  backoff). Persistent failures → check the worker's dependency (Redis up? DB
  up? the third-party API the job calls?).
- **Workers never block requests** — the worst case is deferred work, and the
  inline fallbacks run when Redis is unset.

## 5. Common ops tasks

| Task | How |
|---|---|
| Make someone admin | `cd server && npm run make-admin -- --email x@y.com` |
| Ban / mute / verify | Admin dashboard → Users → search → action |
| Deal with a report | Admin → Reports → Dismiss / Action |
| Feature flag / kill switch | Admin → Flags → create/update (percentage rollout) |
| Send a broadcast | Admin dashboard broadcast banner |
| Stop the bots | `cd server && npx tsx scripts/stop-bot-farm.ts` |
| Inspect the DB | `cd server && npx tsx scripts/inventory-db.ts` |
| Fix drifted follower counts | `scripts/inspect-follows.ts` → `repair-follow-counts.ts` → `clear-follow-caches.ts` |
| Build missing DB indexes | `cd server && npm run db:sync-indexes` (prod) |
| Check DB status | Atlas dashboard; also `GET /api/health` (DB + Redis status) |
| Liveness probe | `GET /api/ping` |

## 6. Known gaps (watch these)

1. **No backups** — see `BACKUP_AND_RECOVERY.md`. Fix before relying on this app.
2. **No Sentry in prod** — errors are log-only until `SENTRY_DSN` is set.
3. **No queue dashboard** — failed jobs are log-only.
4. **External feed sync is flaky** — Bluesky/Lemmy/Mastodon/PeerTube API errors
   in logs degrade the Web tab; other features unaffected.
5. **Bot farm runs in production** — simulated users post/like/comment real
   users. Config-gated; stop with `stop-bot-farm.ts` if needed.
