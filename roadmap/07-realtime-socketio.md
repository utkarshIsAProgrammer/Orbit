# 07 — Realtime: Socket.IO, Rooms, Presence, Backfill, Calls

> The app is realtime: messages, likes, notifications, calls, and presence all
> arrive over **Socket.IO** (WebSocket with automatic fallback). The big file
> is `server/src/configs/socket.ts` (~2300 lines) — everything in this
> document lives there (plus the client side in `App.tsx`).

---

## 1. The Socket.IO mental model

- The client connects once (`socket.io-client`, `App.tsx`).
- The server authenticates the socket (JWT from auth payload or cookie).
- **Rooms** are named groups; the server emits *to a room* and only its
  members receive it. This app's room scheme:
  - `user:<userId>` — personal room: presence, notifications, new messages
  - `conversation:<conversationId>` — 1:1 chat: messages, typing, seen
  - `community:<communityId>` — community chat + presence + calls
- **Events** are named messages. The convention: client→server lowercase
  (`chat:typing`), server→client too (`message:new`).

## 2. The connection + auth middleware

`socket.ts`:

```ts
io.use(async (socket, next) => {
  // rate-limit per resolved client IP (60/min — mobile reconnects are frequent)
  // find JWT (auth payload → header → cookie) → jwt.verify → socket.userId
  // banned users rejected
  next();
});
```

On connect: join `user:<id>`, mark online (per-instance `onlineUsers` set +
Redis TTL key), broadcast `user:presence` to cached conversation partners +
communities, send a `community:presence:sync` of currently-online members.

**Multi-device presence:** a `Map<userId, count>` tracks live sockets *per
account* — a phone backgrounding (WebSocket dies) must NOT flip the account
offline while the PC is connected. Offline only when the count hits 0.

## 3. The Redis adapter (multi-instance)

Two instances = two Socket.IO servers. Without an adapter, an event emitted on
instance A never reaches a client on instance B. The **`@socket.io/redis-adapter`**
uses Redis **pub/sub**: every instance subscribes to a channel and re-broadcasts
everything. In `initSocket`: creates a pubClient + subClient (ioredis, TCP
`UPSTASH_REDIS_URL`), `io.adapter(createAdapter(pub, sub))`. Falls back to
single-instance mode when no Redis URL.

## 4. Chat events (the highest-traffic area)

Client sends: `chat:join` (join room + mark messages seen + clear unread +
missed-call), `chat:leave`, `chat:typing`, `chat:recording`.

Server emits: `message:new` (both participants + the room), `message:edit`,
`message:delete`, `message:delete-for-me`, `message:reaction`, `message:pin`/
`unpin`, `messages:seen`, `chat:notification` (bubble + badge for the
non-viewing participant).

**The seen-tick lesson:** `chat:join` marks messages seen and emits
`messages:seen` **immediately**, then does the unread/missed-call bookkeeping
in a background `void (async () => …)` — so blue ticks never wait on DB
round-trips (a real complaint fixed by ordering).

## 5. Reconnect backfill — the killer feature (`events:sync`)

Problem: a phone is backgrounded, the socket dies, someone messages them —
when the socket reconnects, the message is lost unless the client reloads.

Solution (server `socket.ts` + client `App.tsx`):

1. Every **user-scoped** event is appended to a Redis list
   `rt:events:<userId>` (2h TTL, capped 50): `{ts, event, payload}`.
2. On every (re)connect the client emits `events:sync { since }` — the ts of
   the last event it processed, persisted in localStorage (`orbit:rt-since`).
3. The server replays everything newer **through the same socket events**, so
   every existing client handler runs as if the event arrived live. No reload.
4. **Broadcast events** (post:created, etc.) aren't per-user logged — so on
   reconnect the client also refetches key lists (`forceFeedRefresh`,
   `orbit:communities-refresh`, conversations, badges).

Client side (`App.tsx`): `socket.onAny((event, payload) => …)` funnels every
event into `applyRealtimeEvent` (`utils/realtimeSync.ts`), which upserts the
entity into Dexie and evicts affected CacheStorage URLs — **realtime data
survives reloads** because it's written into the same stores reads use.

> **Free-tier optimization (2026):** The event log was optimized from 3 Redis
> commands per event (RPUSH + LTRIM + EXPIRE) down to **1 command** (RPUSH
> only). LTRIM + EXPIRE are batched every 10th write via a module-level
> counter. The list cap was reduced from 200 → 50 entries per user. These
> changes save ~66% of Redis calls from event logging.

## 6. Call signaling (WebRTC over the socket)

WebRTC needs a **signaling channel** to exchange SDP offers/answers + ICE
candidates. This app relays them over the socket:

- `call:offer` → `call:answer` → `call:ice-candidate` (and `call:ice-restart`
  for network handoffs) → `call:end` / `call:missed`.
- **Authorization:** `canRelayCall` — calls only allowed between users who
  share a conversation, block status re-checked on every offer, ICE candidates
  skip the DB check (high-frequency, already authorized).
- Call state tracked in maps (`activeDirectCalls`, `activeCommunityCalls`) to
  record WhatsApp-style "call started/ended/missed" system messages and
  prune stale entries.
- Actual media flows **peer-to-peer via LiveKit** (see 11); the socket only
  signals.

## 7. Community + admin events

- Community: `community:join`, `community:typing`, plus emits for
  message CRUD/reactions/pins, member-joined/left, roles, settings toggles
  (`community:calls-toggled`, `community:messaging-toggled`), room updates,
  call start/end.
- Admin: `admin:broadcast` (announcement banner), `admin:broadcast:clear`,
  and `user:updated` — when an admin mutes/bans/verifies a user, that user's
  client re-fetches `/api/auth/me` so the UI reflects it in real time.

## 8. Presence heartbeat

Client sends `presence:heartbeat` periodically → server refreshes the
in-memory `onlineUsers` + Redis TTL — so a brief network blip doesn't make a
user look offline to everyone.

---

## Exercises

1. Explain the difference between a *broadcast* event and a *user-scoped*
   event, and why only user-scoped ones are logged for `events:sync`.
2. Why does the multi-device presence counter exist? What would break without it?
3. Trace a `chat:typing` event: client → server → room → other client. Name
   every hop.
4. Open `realtimeSync.ts` — what does `applyRealtimeEvent` do with a
   `message:new` payload, and why does that make realtime data survive a reload?
