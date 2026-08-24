# 🔌 ORBIT — API Reference

> Endpoint inventory by feature area, with auth requirements. **Auth legend:**
> 🔓 public · 🔐 `protect` (logged-in user, `req.user`) · 🔑 `optionalAuth`
> (works either way) · 🛡️ admin-only.
>
> Full request/response shapes are in Swagger — **dev only** (`npm run dev` →
> `http://localhost:5006/api-docs`). This file is the curated map; when in
> doubt, read `server/src/routes/<area>.routes.ts` + the controller.
>
> Conventions: every response is `{ success: true|false, message, ...data }`;
> errors come from the global handler (400/401/403/404/409/500 with a
> `message`); lists paginate with `cursor` + `hasMore`; mutations require the
> `x-csrf-token` header (read from the `csrf-token` cookie by the client).

---

## Auth & accounts (`/api/auth`, `/api/password`)

| Method + path | Auth | Purpose |
|---|---|---|
| POST `/api/auth/signup` | 🔓 | Create account (Zod validated, bcrypt) |
| POST `/api/auth/login` | 🔓 | Login by username-or-email → JWT cookie |
| POST `/api/auth/logout` | 🔓 | Clear cookie (idempotent) |
| GET `/api/auth/me` | 🔐 | Current user (cache-first; the session restore) |
| GET `/api/auth/google` | 🔓 | Start Google OAuth (relative path — same-origin) |
| GET `/api/auth/google/callback` | 🔓 | OAuth callback → redirects with `oauth_code` |
| POST `/api/auth/oauth-exchange` | 🔓 | Swap the one-time code for a session |
| POST `/api/password/forgot` | 🔓 | Email an OTP |
| POST `/api/password/verify-otp` | 🔓 | Verify OTP |
| POST `/api/password/reset` | 🔓 | Set new password |
| DELETE `/api/users/delete-account` | 🔐 | Full data purge (queued) |

## Users & profiles (`/api/users`)

| Method + path | Auth | Purpose |
|---|---|---|
| GET `/api/users/:id` | 🔑 | Profile by id (email stripped unless owner — `publicUser()` whitelist) |
| GET `/api/users/username/:username` | 🔑 | Profile by username |
| GET `/api/users/suggestions` | 🔐 | Affinity-based "who to follow" |
| POST `/api/users/update-profile` | 🔐 | Name/bio/links/avatar/banner |
| POST `/api/users/:id/view` | 🔐 | Increment profile view |
| POST `/api/users/:id/follow` / DELETE | 🔐 | Follow/unfollow |
| Follow-request routes | 🔐 | Private-account follow requests |

## Posts (`/api/posts`)

| Method + path | Auth | Purpose |
|---|---|---|
| GET `/api/posts` | 🔑 | Feed/list (query params: limit, cursor, sort) |
| GET `/api/posts/:id` | 🔑 | Single post (by id) |
| GET `/api/posts/slug/:slug` | 🔑 | Single post by slug |
| POST `/api/posts` | 🔐 | Create (text/images/video/poll/schedule) |
| PUT `/api/posts/:id` | 🔐 | Edit (owner) |
| DELETE `/api/posts/:id` | 🔐 | Delete (owner; cascades + media cleanup) |
| POST `/api/posts/:id/like` · `/unlike` · `/save` · `/repost` · `/vote` | 🔐 | Interactions (evict all cached post lists) |
| GET `/api/posts/:id/comments` | 🔑 | Comment thread (cursor-paginated) |
| POST `/api/posts/:id/comments` | 🔐 | Comment |
| Drafts / archived / trending routes | 🔐 | Profile tabs |

## Feed (`/api/feed`)

| Method + path | Auth | Purpose |
|---|---|---|
| GET `/api/feed/for-you` | 🔐 | The ranked affinity feed (cached 5 min/user) |
| GET `/api/feed` | 🔑 | Feed list |
| GET `/api/feed/trending` | 🔑 | Trending posts/users/hashtags |

## Social (`/api/likes`, `/api/follows`, `/api/saves`, `/api/reposts`, `/api/blocks`)

All 🔐 — the canonical interaction controllers: toggle endpoints + "my list"
views (e.g. GET `/api/saves`, GET `/api/reposts`). `/api/blocks` for
block/unblock + lists.

## Chat (`/api/chats`)

| Method + path | Auth | Purpose |
|---|---|---|
| GET `/api/chats/conversations` | 🔐 | Conversation list (badges, lastMessage) |
| GET/POST `/api/chats/conversations/:id/messages` | 🔐 | Message list / send |
| POST `/api/chats/conversation/:userId` | 🔐 | Get-or-create 1:1 conversation |
| DELETE `/api/chats/messages/:id` | 🔐 | Delete / delete-for-me |
| Clear-conversation routes | 🔐 | Clear chat |
| Forward routes | 🔐 | Forward posts/profiles/comments (queued) |
| POST `/api/chats/forward` | 🔐 | Forward → chat message |

## Communities (`/api/communities`)

| Method + path | Auth | Purpose |
|---|---|---|
| GET `/api/communities` · `/api/communities/mine` | 🔐 | Browse / my communities |
| POST `/api/communities` | 🔐 | Create |
| PUT/DELETE `/api/communities/:id` | 🔐 | Update / delete (owner) |
| POST `/api/communities/:id/join` · `/leave` | 🔐 | Membership |
| GET/POST `/api/communities/:id/messages` | 🔐 | Community chat |
| Settings toggles (`toggle-audio-calls`, `toggle-video-calls`, `toggle-messaging`) | 🔐 | Community settings |

## Glances (`/api/glimpses`)

🔐 — feed, user strips, create (media + text/draw), viewer data, replies,
react, expire. 24h TTL.

## Notifications (`/api/notifications`)

🔐 — list, unread count, mark-read, mark-all-read, delete, clear.

## Gamification (`/api/xp`, `/api/missions`, `/api/streaks`, `/api/leaderboard`)

🔐 — XP/level view, mission list + `POST /api/missions/claim`, streak status +
daily reward claim, leaderboard.

## Search (`/api/search`)

🔑 — `?q=` users / posts (users: text index + collation prefix search; posts:
full-text + hashtags). Client always fetches search fresh (never cached).

## Content services

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/translate` | 🔐 | Detect + translate text |
| `GET /api/link-preview?url=` | 🔐 | OG metadata (SSRF-guarded) |
| `GET /api/files/*` | 🔐 | Cloudinary file-download proxy |

## Waitlist & invites (`/api/waitlist`, `/api/invites`)

🔓 join (anti-spam: honeypot/MX/Turnstile) · 🔐 invite list/claims,
`POST /api/invites/redeem`.

## Push (`/api/push`)

🔐 — `GET /vapid-key`, `POST /subscribe`, `DELETE /subscribe`.

## Admin (`/api/admin`) — 🛡️ all admin routes

`GET /stats` · `GET/POST /flags` + `PUT /flags/:id` (percentage rollout) ·
`PUT /users/:id/mute|ban|verify` · broadcast. Reports + moderation:
`GET /api/reports?status=pending`, `PUT /api/reports/:id/review`,
`POST /api/moderation/flag`, `GET /api/moderation/queue`,
`PUT /api/moderation/:id/approve|reject`.

## Developer (`/api/developer`, `/api/webhooks`) — UI hidden, endpoints live

🔐 — API keys (scoped read/read-write, returned once, stored hashed) +
webhook CRUD (SSRF-guarded delivery on the `orbit-webhooks` queue).

## External feed (`/api/external`)

🔓 — the Web tab's imported content (Bluesky/Mastodon/Lemmy/PeerTube).

## Data export (`/api/export`)

🔐 — `GET /posts`, `/profile`, `/messages` (GDPR-style export).

---

## Auth headers/cookies recap

- **Session:** JWT in httpOnly cookie (`sameSite: none; secure` in prod).
- **CSRF:** non-httpOnly `csrf-token` cookie echoed as `x-csrf-token` header on
  every mutation.
- **API keys:** `x-api-key: <key>` — never accepted on `/api/admin/*`.
