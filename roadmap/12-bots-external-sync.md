# 12 — The Bot Farm & External Feed Sync

> Two of the most unusual parts of the codebase: a **farm of simulated users**
> (bots) that keep the app feeling alive, and an **external sync engine** that
> imports public content from Bluesky, Mastodon, Lemmy, and PeerTube into the
> "Web" tab. Both are config-gated, in-process, stateful systems — deliberately
> NOT queue-shaped.

---

## 1. The bot farm — what and why

`server/src/services/bots/` (14 files). Bots are **real user rows** in the DB
that live simulated lives: they post, comment, like, follow, DM, call, react,
keep streaks, join communities, and follow a day/night cycle by country. The
point: a social app with zero content is a dead app — bots make it feel alive
(and they're the traffic that keeps the free tier awake).

**Control:** `stop-bot-farm.ts` script + config; bot farm status is stored in
the DB (`botFarm` model). The farm is **gated** (not started unless configured)
and was deliberately designed so banning/muting a bot works like a user.

### The modules (learn the design)

| File | Role |
|---|---|
| `index.ts` | Farm lifecycle: start/stop, heartbeat interval (45s tick) |
| `scheduler.ts` | Per-bot activity scheduling (what each bot does each tick) |
| `lifeState.ts` | Wake/sleep cycle per country (timezone-aware) |
| `identity.ts` / `personas.ts` / `countries.ts` / `avatars.ts` | Bot identity generation (names, personas, nationalities, avatars) |
| `socialGraph.ts` | Following/community memberships between bots + users |
| `actions.ts` | The action library (post, like, comment, DM, glance…) |
| `brain.ts` | What bots say — template responses; optional `GEMINI_API_KEY` makes replies genuinely contextual |
| `media.ts` | Bot media: seeded photos/GIFs/videos for posts/glances |
| `romance.ts` / `conflict.ts` | Human-layer social drama: bot-bot romances, arguments |
| `types.ts` | Shared types |

### The architecture decisions (learn these)

1. **In-memory state, not queues.** Bots keep PRNG state, lifeState, schedules
   in memory. Converting to BullMQ repeatable jobs would mean persisting all of
   that — a big refactor for a demo feature. Kept in-process deliberately.
2. **Persistent per-bot PRNG** — every bot has a seeded RNG so its dice rolls
   (will it post today?) advance deterministically instead of resetting each
   tick (a real bug fixed: "scheduler dice rolls advance").
3. **Real user paths** — bots use the same controllers/socket/cache machinery
   as real users, so they're consistent (and cheap to build — no separate bot
   code paths).
4. **Presence bridge** (`markUserOnline`/`markUserOffline` in socket.ts) — bots
   appear ONLINE (green dots, presence events) without holding real sockets.

## 2. External feed sync — the Web tab

`server/src/services/externalSync/` (7 files). Fetches public content from four
federated/open platforms into the `externalPost` collection for the Web tab:

| File | Platform |
|---|---|
| `blueskySync.ts` | Bluesky profiles/feeds via the public API |
| `blueskyFirehose.ts` | The **live firehose** — `@atproto/sync` streams new posts in real time |
| `mastodonSync.ts` | Mastodon hashtag timelines |
| `lemmySync.ts` | Lemmy community post lists |
| `peertubeSync.ts` | PeerTube video channels |
| `normalizer.ts` | Maps each platform's post shape → the app's `externalPost` shape |
| `index.ts` | The orchestration: 15-min poll (`external-sync` repeatable job / timer fallback) + firehose lifecycle |

### Key concepts

- **Normalization** — the hardest part: four APIs, one output shape (author,
  text, media, source, originalCreatedAt). `normalizer.ts` is where platform
  quirks live.
- **Poll vs firehose** — polls pull (Lemmy/Mastodon/PeerTube) every 15 min via
  the maintenance queue; the Bluesky **firehose** pushes (a long-lived WebSocket
  stream — in-process, single-instance guard, NOT queue-shaped).
- **Dedup + ranking** — `externalPost` has `unique` source+id; the Web tab
  ranks by engagement/recency; `Like`/`Save`/`Repost`/`Comment` are polymorphic
  (post OR externalPost — the partial-index design from 04 exists for this).
- **Resilience** — every sync is try/caught and logged; a failing platform
  (Bluesky 400s, Lemmy timeouts — visible in prod logs) degrades gracefully
  and the others keep working.

## 3. Why both systems are in-process

- The firehose is a **long-lived stream** — not a job.
- The bot farm is a **stateful simulation** — not a job.
Both were explicitly evaluated during the BullMQ conversion and left as-is;
only the *external sync poll* moved to a repeatable job (it IS job-shaped).

---

## Exercises

1. Open `bots/scheduler.ts` and `bots/lifeState.ts` — describe a bot's day.
2. Why would the bot farm break if it ran on BullMQ repeatable jobs? Name the
   state that would need persisting.
3. Open `externalSync/normalizer.ts` — list the fields it maps for Bluesky
   vs Mastodon and where they differ.
4. Explain the partial unique index on `saves`/`reposts` in terms of external
   posts: why does `post: null` need a partial filter?
