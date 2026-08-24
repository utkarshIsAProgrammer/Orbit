# Orbit — Admin Guide (for the app creator / admins)

Everything you can do as an admin, how to do it, and where it lives in the code.
Last verified: August 16, 2026.

---

## 1. Becoming an admin

There is **no self-service way** to become admin from the app (by design — it's a
security boundary). The `isAdmin` flag on your user record must be set directly.

**Option A — script (recommended):**
```bash
cd server
npm run make-admin -- --email you@example.com     # grant
npm run make-admin -- --email you@example.com --remove   # revoke
```

**Option B — MongoDB Atlas Data Explorer:**
1. Atlas → your cluster (`cluster0`) → **Browse Collections** → `orbit` → `users`
2. Find your user → Edit document → set `"isAdmin": true` → Save.

After either: **reload the app** (or sign out/in). The **Admin** tab (Shield
icon) appears at the bottom of the left sidebar.

> Grant co-admins the same way with their email. Revoke anytime. Banned users
> are checked on every request, admin or not.

---

## 2. The Admin dashboard (4 tabs)

Opened via the Shield icon in the sidebar. Server-rendered, admin-gated.

### 📊 Stats
Live counters, refreshed on load:
| Metric | Meaning |
|---|---|
| Total Users / Posts / Comments / Glances / Communities | Raw counts |
| Online Now | Authoritative count from live socket presence |
| Muted / Banned Users | Moderation state totals |
| Pending Reports | User-reported content awaiting review |
| Pending Moderation | Content in the moderation queue |

### 📥 Reports
The user-report queue. Every report shows reporter, reason, and target.
- **Dismiss** → marks the report handled, no action.
- **Action** → flips status to `action_taken` and removes it from the queue.
- (For a hard action on the *reported user*, use the Users tab → mute/ban.)

### 👥 Users
Search any username, then per user:
- **Mute** — silences them app-wide (no push/notifications to others).
- **Ban** — blocks them outright; their login, API keys, and sockets stop working.
- **Verify** — grants the ✅ verified badge on their profile.

### 🚩 Flags
Feature flags control releases **without redeploys**:
- Create a flag → every client gets it via `GET /api/admin/flags/mine`.
- Flip `enabled` on/off live, or use `percentage` for **gradual rollout**
  (e.g. 10% → 50% → 100%).
- Typical uses: kill-switch a feature, A/B test, staged launches.

---

## 3. Developer tools — ⏸️ DEFERRED (future concern)

> **Status:** The Settings **Developer** tab (API keys + webhooks) was **removed
> from the UI** by owner decision. The full backend + UI components are
> **retained intact** (marked `FUTURE CONCERN` in code) so it can be re-enabled
> without rework.
> **Cross-posting / Connected Accounts was FULLY REMOVED** (owner decision —
> not useful for the current stage) — server routes, controller, service, model
> field, client UI, and tests are all deleted. Do not expect it back unless
> rebuilt from scratch.
> External content **fetching** (web feed) is unaffected — it uses server-side
> public APIs and never depended on these.

| Tool | What it does (when re-enabled) | Endpoint base |
|---|---|---|
| **API Keys** | Scoped `read`/`read+write` keys so scripts/bots can call the API without a login | `/api/developer` |
| **Webhooks** | POST real-time events (`post.created`, `post.liked`, `post.commented`, `comment.created`, `user.followed`) to an external HTTPS endpoint — delivery runs on a BullMQ worker (`orbit-webhooks`), so a slow endpoint can't block request paths | `/api/webhooks` |

**To re-enable API keys + webhooks:** add the tab entry back in
`client/src/components/Settings.tsx` (see the `FUTURE CONCERN` comment).
The endpoints above still work today.

---

## 4. Admin API reference

All admin endpoints require the session cookie of an `isAdmin` user.
(`X-Api-Key` is **never** accepted on these — see Security.)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/stats` | Dashboard stats |
| GET | `/api/admin/flags` | List feature flags |
| POST | `/api/admin/flags` | Create flag `{ key, description, enabled, percentage }` |
| PUT | `/api/admin/flags/:flagId` | Update flag |
| GET | `/api/admin/flags/mine` | Public — a user's own effective flags |
| PUT | `/api/admin/users/:userId/mute` | `{ muted: bool }` |
| PUT | `/api/admin/users/:userId/ban` | `{ banned: bool }` |
| PUT | `/api/admin/users/:userId/verify` | `{ verified: bool }` |
| GET | `/api/reports?status=pending` | Report queue (admin) |
| PUT | `/api/reports/:reportId/review` | Dismiss / action a report |
| POST | `/api/moderation/flag` | Flag content for the queue |
| GET | `/api/moderation/queue` | Moderation queue (admin) |
| PUT | `/api/moderation/:id/approve` / `/reject` | Resolve a moderation item |
| GET | `/api/export/posts` · `/profile` · `/messages` | User data export (self) |

---

## 5. Security posture (verified in code)

What is locked down — do not weaken these:

- **Admin endpoints** double-gated: `isAdmin` checked in every admin controller.
- **API keys cannot touch `/api/admin/*`** — even an admin owner's write key gets
  `403 "API keys cannot access admin endpoints"`.
- **Read keys** can only GET (`403` on any mutation).
- **API keys** stored as SHA-256 hashes; raw key shown once at creation.
- **Webhooks** SSRF-protected: private/loopback/link-local IPs rejected (incl.
  cloud metadata `169.254.169.254`), DNS re-verified before **every** delivery,
  redirects never followed, https-only in production, delivery timeout, auto
  deactivate after repeated failures.
- **Rate limits** on all mutation endpoints (80/min interaction, 300/15min general).
- **Banned users** rejected at auth (cookies and keys).

---

## 6. Common operations cheat-sheet

| Task | How |
|---|---|
| Make someone admin | `npm run make-admin -- --email x@y.com` |
| Ban a spammer | Admin → Users → search → **Ban** |
| Silence without banning | Admin → Users → **Mute** |
| Give a verified badge | Admin → Users → **Verify** |
| Deal with a report | Admin → Reports → Dismiss / Action |
| Roll out a feature gradually | Admin → Flags → create with `percentage` |
| Kill a broken feature instantly | Admin → Flags → disable |
| Bot/script access for yourself | ⏸️ Deferred — API keys hidden (see §3) |
| Get notified when events happen | ⏸️ Deferred — webhooks hidden (see §3) |
| Post to Bluesky/Mastodon too | ❌ Removed — cross-posting deleted (see §3) |

---

## 7. Tips

- **First launch:** make yourself admin before telling anyone to sign up, then
  consider adding a first-user bootstrap or an `ADMIN_EMAILS` env list so you
  never depend on a manual DB edit.
- **Staged rollout checklist:** Flags tab → create flag → 10% → 50% → 100% →
  monitor Stats → disable if anything looks off.
- **Recovering from a lockout:** the `isAdmin` flag lives in MongoDB, not the
  app — `make-admin` or Atlas will always get you back in.
- **Abuse of the Developer tools** is bounded (rate limits + per-key scoping);
  banning the account kills its keys instantly.
