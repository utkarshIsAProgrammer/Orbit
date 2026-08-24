# 🛟 ORBIT — Backup & Recovery

> ⚠️ **Status: NO AUTOMATED BACKUPS EXIST TODAY.**
> The `backup:db` script referenced in `server/package.json` does **not
> exist**, and MongoDB Atlas free/shared tiers have **no automated backups**.
> If the cluster is lost or a bad migration runs, the data is gone.
> **This is the #1 pre-launch gap. Pick an option in §3 and implement it.**

---

## 1. What's at risk (what a backup must cover)

- **MongoDB (the whole app)** — users, posts, comments, messages, communities,
  notifications, streaks, XP, invites, waitlist. `server/scripts/inventory-db.ts`
  lists the collections.
- **Cloudinary media** — images/videos are stored there (DB stores URLs). A
  Cloudinary account backup/download is a separate concern (secondary priority).
- **Environment variables** — in Render/Vercel dashboards, not the repo
  (gitignored). Export them periodically; `docs/ENV.md` is the checklist.

## 2. Recovery goals

| Metric | Target |
|---|---|
| **RPO** (max data loss) | ≤ 24h for a production app |
| **RTO** (time to restore) | ≤ 1 hour |

At current scale (early stage), a daily backup + tested restore satisfies both.

## 3. Options (pick one — cheapest first)

### Option A — Enable Atlas Cloud Backups ✅ recommended
- Atlas → cluster → Backup tab → enable (paid tiers; free tier has **none** —
  upgrading to M10+ includes it).
- Set a backup policy (daily snapshot, keep 7–30 days).
- Zero code, zero scripts. **Do this today if you can spend a few dollars/month.**

### Option B — Write the missing `backup-db.sh` (free)
- Script does `mongodump` (or `mongodump --uri "$MONGO_URI" --out backup/...`),
  tars it, uploads to object storage (Cloudflare R2 free tier / Backblaze B2),
  keeps N days.
- Restore: `mongorestore --uri "$MONGO_URI" --drop backup/...`.
- Restore must be **tested once** — a backup that's never restored is a rumor.
- Add a cron / GitHub Action schedule to run it daily.

### Option C — Atlas `mongodump` via one-off
- For a quick safety net today: run
  `mongodump --uri "$MONGO_URI" --archive=orbit-$(date +%F).archive` and store
  the archive somewhere off-platform. Repeat weekly manually until A or B exists.

## 4. Restore procedure (test this!)

```bash
# 1. Verify the archive
mongorestore --uri "$MONGO_URI" --archive=orbit-2026-08-16.archive --dryRun

# 2. Restore (--drop replaces the target collections)
mongorestore --uri "$MONGO_URI" --archive=orbit-2026-08-16.archive --drop

# 3. Restart the server (it re-syncs indexes on boot in dev; in prod run:
cd server && npm run db:sync-indexes
```

**After restore:** check user counts (`inventory-db.ts`), test a login, test a
post + chat message. Then **verify counters** (they're denormalized — run
`inspect-follows.ts` → `repair-follow-counts.ts` if drifted).

## 5. Backup checklist (monthly)

- [ ] A backup exists that is ≤ 24h old
- [ ] A restore has been **actually tested** in the last 90 days
- [ ] `MONGO_URI` credentials are stored somewhere safe (password manager), not
      only in the Render dashboard
- [ ] Cloudinary media: download/export at least once (or accept the risk)

---

## Decision log

| Date | Decision |
|---|---|
| — | *(fill in when you pick A or B)* |
