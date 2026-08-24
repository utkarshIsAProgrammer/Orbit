# CHANGELOG — Orbit Release Notes

Generated from the git history (most recent first). Human-readable summary of
what shipped in each change. For the technical story behind the incidents and
fixes, see `docs/RUNBOOK.md`.

---

## 2026-08-16

### `no more reload` (18b5b532)
**The auto-update guarantee.** Completed the service-worker update pipeline so
users never have to reload or clear cache when you deploy:
- SW update poll dropped from hourly → every 5 minutes (plus tab-focus + page load)
- New `NEW_VERSION` message handshake — the SW broadcasts to every open tab and the page auto-reloads (works where iOS `controllerchange` doesn't)
- Combined with the existing `skipWaiting`/`clientsClaim`/`updateViaCache:"none"`/NetworkFirst, a deploy now reaches every user's app within ~5 minutes, hands-free

### `bullmq and db queries` (207e806f)
**The queue + DB overhaul** (the big one):
- All 10 BullMQ queues renamed `orbit:x` → `orbit-x` — BullMQ forbids `:` in queue names; the old prefix meant queues had *never* worked and the uncaught throw killed the boot (no port, restart loop)
- `startQueueWorkers` hardened — a worker failure logs and falls back instead of crashing boot
- `server.listen()` moved **before** background services so the port always binds
- Graceful shutdown reordered: stop HTTP → close workers+queues → socket.io → Mongo; socket adapter Redis clients got error handlers (kills the EPIPE/`Connection is closed` teardown noise)
- DB pass: `autoIndex:false` in prod, pool 50, named username collation index (duplicate-index warning gone), new `{likesCount:-1, commentsCount:-1}` compound index, feed cache slimmed to IDs+scores (~10× smaller), `scripts/sync-indexes.ts` for deliberate prod index builds
- `sync-indexes.ts` gained the legacy-index conflict fallback (drops stale index, builds schema's — fixed the Save collection migration)

### `fix(client): translate failure toast + cache-busting SW registration` (0628c9d5)
- Failure toasts now translate per-locale
- Service-worker registration cache-busted so a new `sw.js` always installs

### `feat(orbit): realtime + instant-load overhaul, perf pass, and DB reset` (ebda4749)
- `events:sync` reconnect backfill — events missed while the socket was dead are replayed from a persisted cursor; broadcast lists refetch on reconnect
- `applyRealtimeEvent` universal persistence — every socket event upserts Dexie + evicts cache URLs
- Session reconcile on boot (admin/verified/mute changes land without waiting out the cache)
- `user:updated` socket event → live user refresh when an admin changes your account
- Idle-time prefetch of likely-next tabs; async Google Fonts (non-blocking first paint)
- OAuth one-time `oauth_code` exchange (fixes mobile cookie loss)
- Community invite deep links (`?invite=`)

### `feat(orbit): launch blast exclude-email flag + bot-seat skip` (ebbcd828)
- Launch-blast tooling: exclude-email flag; bot accounts skipped from blasts

## 2026-08-15

### `fix(orbit): landing content can no longer stay hidden + stale-chunk self-heal` (302011f0)
- Landing page content can no longer stay hidden (scroll/canvas fixes)
- Stale-chunk self-heal — a failed lazy-chunk load auto-recovers instead of stranding the user

## 2026-08-14 — Bot farm push

- `feat(orbit): bots post photos/GIFs/videos + video glances` (554bcd07)
- `fix(orbit): scheduler hydrated docs fix + waitlist seed script` (4cef4d74)
- `feat(orbit): bot avatar variety + romance/conflict human layers + CSP fix` (dbe8c562)
- `fix(orbit): persistent per-bot PRNG so scheduler dice rolls advance` (b6cbe15a)
- `fix(orbit): livelier bot farm pacing — all bots tick, higher baseline, instant start` (011c1d61)
- `fix(orbit): bot username/community polish + seed script` (913b2524)
- `feat(orbit): country-authentic bot identities + admin country chips` (f18761e8)
- `feat(orbit): bot live presence + typing indicators` (ce1a1180)
- `fix(orbit): use gemini-2.5-flash for bot brains` (6d0a4cb0)
- `feat(orbit): simulated communities + Simulated badge` (bc084506)
- `feat(orbit): bot life-simulation engine + admin Bots tab` (72c0614e)

## 2026-08-13 — Admin + perf

- `feat(admin): audit trail, kill switches, content editing, feature gating` (2c0a589e)
- `feat(admin): god mode — full user control, impersonation, broadcast, monitoring` (1ed18cf0)
- `perf: never stall navigation on slow networks + warm socket connection` (89ce6801)
- `feat(offline): prime offline caches the moment a user joins` (2011800b)

## 2026-08-12 — Landing redesign

- `perf(landing): stop idle 60fps rendering — demand-mode canvas, idle-stop cursor` (d2427f69)
- `feat(orbit): restyle landing accents white (stellar theme)` (c6362b33)
- `feat(orbit): restyle landing with the app's Midnight Aurora palette` (37dab7e2)
- `feat(orbit): rebuild logged-out landing as the waitlist page with embedded auth` (e18188cf)

---

*Earlier history exists before this changelog's range (the app's original
build-out). If you need it, `git log --reverse` is the source of truth.*
