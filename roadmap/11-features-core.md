# 11 — The Core Features, Deep-Dive

> This file explains the *product* features that make ORBIT what it is — the
> ranked feed, gamification, communities/calls, glances, invites, and admin —
> with the algorithm internals and the files to read for each.

---

## 1. The ranked feed — the product's brain

`services/feedService.ts`. The feed is **not** chronological — every post gets
a score, and the top-scoring posts win. The pipeline:

1. **Candidates** (max ~450): three parallel indexed queries —
   - posts from **followed authors** (last 3 days, ~300)
   - posts from **high-affinity authors** not followed (~100)
   - **discovery/trending** public posts sorted by likes/comments (~100 → best 50)
   - Blocked/muted/private authors filtered out; close-friends visibility enforced.
2. **Scoring** (`computeScore`, pure function):
   ```
   finalScore = (affinity × 0.35) + (contentAffinity × 0.20)
             + (velocity × 0.25) + (recencyDecay × 0.15)
             + (followBoost × 0.05)  → × reachBoost × qualityMultiplier
   ```
   - **affinity** = `log1p` of the per-author interaction score (see 2)
   - **velocity** = engagement rate (likes/comments/saves/shares ÷ views) ×
     log-scaled momentum — *quality* engagement beats raw likes
   - **recency** = exponential decay (8%/hour)
   - **quality gate** = media/hashtags/length minus spam signals (boilerplate
     phrases, all-caps, repeated words, emoji spam) — spam below a hard floor
     is dropped even from followed authors
3. **Diversity re-rank** — max 2 consecutive posts from the same author.
4. **Freshness guarantee** — reserve slots (positions 2 & 6) for posts <2h old.
5. **Cache** the slim ranked list 5 min per user (see 06).

## 2. Affinity — the personalization engine

`services/affinityService.ts`:

- Every interaction (like=1, comment=4, save=3, share=5, dm=6, profileVisit=1.5,
  storyView=0.5) is logged to the **Interaction** collection (90-day TTL).
- **Per-author affinity** = Σ weight × `0.95^daysAgo`, compressed with `log1p`.
- **Content affinity** = same decay spread across the post's hashtags.
- Two update paths: **incremental** (`incrementAffinity` — `$inc` on the
  user's `affinityScores` map per interaction, via the gamification queue) and
  **full recompute** (`recomputeAffinityScores` — the 30-min maintenance job
  reads 90 days of interactions and rebuilds the map).
- `seenPosts` (capped 500) powers dedup across feed pages.

## 3. Gamification — XP, missions, streaks, badges

| System | How it works | Files |
|---|---|---|
| **XP/levels** | Actions award XP (`ACTION_WEIGHTS`-style table in `xpService.ts`); levels have thresholds; profile shows level + progress | `xpService.ts`, `xp.model.ts`, `utilities/badgeCatalog.ts` |
| **Badges** | `checkBadgesAndNotify` evaluates triggers (posts, streaks, all-rounder…) and creates a notification on unlock | `badgeService.ts` |
| **Daily missions** | 6 missions/day (post, comment, like, share, glance, view profiles), claimed via `/api/missions/claim` | `dailyMissionService.ts`, `dailyMission.model.ts` |
| **Streaks** | Consecutive-day streak + partner streaks + daily reward claim; the hourly maintenance job breaks stale streaks + sends reminders | `streak.controllers.ts`, `userStreak.model.ts`, `scheduler.ts` |
| **Leaderboard** | Top users by XP/engagement (computed, cached) | `leaderboardService.ts` |

**The queue angle:** every award/progress/check is **enqueued** to
`orbit-gamification` (see 08) — ~25 call sites offload 3–6 DB writes off the
request path. The two places that need the result in the response (invite
redeem, mission claim) call the `*Inline` versions directly.

**The product critique (from the old FEATURE_VALUE_AUDIT):** XP is earned but
never *spent* — a closed loop. Know this; it's the design gap if you ever own
this product.

## 4. Communities + group calls

- **Community model** — members array (with roles), settings (audio/video
  call toggles, messaging), `memberCount`, `updatedAt` (feed sorting).
- **Community messaging** — same feature set as 1:1 chat (voice notes, pins,
  reactions, search) in a `communityMessage` collection + socket room
  `community:<id>`.
- **Group calls** — `GroupCallFloor.tsx` + LiveKit rooms; server tracks
  `activeCommunityCalls` with a 10-min TTL for crashed starters, records
  WhatsApp-style "call started/ended" system messages, notifies online members
  (capped 30).
- **Roles** — member/role changes via socket (`community:member-role-changed`).

## 5. Glances (stories)

24h auto-expiring vertical media posts:

- **Editor** (`GlanceEditor.tsx`): 9:16 frame, zoom/pan (no free crop), text +
  drawing tools, public/closeFriends audience.
- **Viewer** (`GlanceViewer.tsx`): tap sides to advance, swipe up to close,
  drag to scrub, viewers list, emoji reactions, replies (become DMs).
- **Expiry** — TTL index on `expiresAt` (server) + socket `glimpse:expired`
  (client).

## 6. Invites — the growth loop

- Users generate invite codes (`userInvite` model, TTL via `INVITE_TTL_DAYS`),
  share them, see stats.
- Redeeming an invite grants the inviter a **+7-day reach boost** (feed score
  ×1.8) + referral badges — the reach boost is why invites feed the feed
  algorithm.
- Deep link `?invite=<code>` auto-joins (see the OAuth/deep-link handling in
  `App.tsx`).
- **Gates** (`utilities/waitlistGate.ts`): `WAITLIST_REQUIRED` /
  `INVITE_REQUIRED` env switches control open / waitlist-only / invite-only
  signup, read at call time (no redeploy).

## 7. Admin & moderation

- **Admin routes** (`admin.controllers.ts`): stats, feature flags (percentage
  rollout!), user mute/ban/verify. `make-admin` script or DB edit to promote.
- **Moderation** (`moderation.controller.ts`, `report.controllers.ts`):
  reports with reason categories → queue → admin review; auto-hide at 3 flags.
- **Realtime admin:** `admin:broadcast` banner, `user:updated` → client
  re-fetches the user so a mute/ban/verify lands instantly.
- **Audit trail** — `adminAuditLog` model records actions.

## 8. The smaller-but-real systems (skim each)

- **Webhooks + API keys** (`webhook.controller.ts`, `apiKey.controller.ts`) —
  developer integrations, SSRF-guarded, delivered via BullMQ; **hidden from
  the UI** (deferred feature, endpoints intact).
- **Translation** (`translationService.ts`) — detect + translate post/comment
  text inline (`TranslateInline.tsx`).
- **Link previews** (`linkPreviewService.ts`) — SSRF-guarded OG-metadata cards.
- **Data export** (`dataExport.controller.ts`) — GDPR-flavored: users can
  export their posts/profiles/messages.
- **Search** — user text index + collation prefix search, post full-text +
  hashtags, in-conversation message search (debounced). Meilisearch exists but
  is unwired (search runs on Mongo).
- **Suggestions** (`recommendationService.ts`) — affinity-based "who to follow".
- **Waitlist** — honeypot + timer + disposable-domain + MX checks +
  Turnstile; "Day One Founder" perks (`waitlistPerkService.ts`).
- **Bots** — see 12.

---

## Exercises

1. Reproduce `computeScore`'s velocity formula in words and say why per-view
   engagement rate beats raw like counts.
2. Why does the inviter get a reach boost but the redeemer nothing? What
   product loop does that create?
3. List the three systems that keep the feed fresh after a new post, and which
   layer each one lives in.
4. Trace a mission completion: user posts → where is XP awarded → when does
   the mission progress → what's shown in the panel?
