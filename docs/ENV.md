# ORBIT — Mandatory & Necessary Env Vars

## 🔧 BACKEND (Render)

### MANDATORY (app won't boot without these)

```
NODE_ENV=production
MONGO_URI=mongodb+srv://USER:PASS@cluster0.nhxr6xt.mongodb.net/orbit?appName=Cluster0
JWT_SECRET=<your-secret>
CLOUDINARY_NAME=dgnw0qdrk
CLOUDINARY_API_KEY=337856956735819
CLOUDINARY_API_SECRET=<your-cloudinary-api-secret>
CLIENT_URL=https://<your-frontend-url>        # OAuth redirect + email buttons (use real URL, NOT localhost)
```

### NECESSARY (core features break without them)

```
TRUST_PROXY=1                                 # Required behind Render's proxy (client IP + secure cookies)
PUBLIC_API_URL=https://orbit-server-live.onrender.com   # Keep-alive so free tier doesn't sleep (root, NO /api)

# Google login (all three must match Google Console exactly)
GOOGLE_CLIENT_ID=57511669671-t8ea67gc6ukpprgolpq03l51t53i7jib.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_CALLBACK_URL=https://orbit-server-live.onrender.com/api/auth/google/callback

# Emails (welcome / OTP / reset / waitlist access links)
BREVO_API_KEY=xkeysib-...
BREVO_FROM_EMAIL=no-reply@orbit.app
BREVO_SENDER_NAME=ORBIT

# Push notifications
VAPID_PUBLIC_KEY=BKUE...
VAPID_PRIVATE_KEY=dZHW...
VAPID_SUBJECT=mailto:devutkarshya1@gmail.com

# Group video/voice calls (LiveKit)
LIVEKIT_URL=wss://orbit-p0vtu624.livekit.cloud
LIVEKIT_API_KEY=APImGzPhbGkR5GA
LIVEKIT_API_SECRET=<your-livekit-api-secret>

# REDIS — single database (casual-lion)
# ─────────────────────────────────────────────────────────────────────
# Everything points at ONE Upstash database (casual-lion) so the app works
# as one unit on a single 500K commands/month free budget. NOTE: the old
# database (warm-toucan) exhausted its quota in Aug 2026 — if this DB also
# fills up before the month resets, Upstash freezes it (every command fails
# with a limit error) until the 1st; the app's fallbacks (inline/cron,
# single-instance socket) keep it running but degraded.

# REST — cache / rate-limit / realtime event log / waitlist
UPSTASH_REDIS_REST_URL=https://casual-lion-149007.upstash.io
UPSTASH_REDIS_REST_TOKEN=<casual-lion-rest-token>


//////////////////////////////////////////////
REDIS_URL=rediss://default:gQAAAAAAAT4aAAIgcDI0NGJlMThlNzc0ZGM0MzQwYTU0ZjY2ZmI2NWUzMzk3OA@warm-toucan-81434.upstash.io:6379
UPSTASH_REDIS_URL=rediss://default:gQAAAAAAAT4aAAIgcDI0NGJlMThlNzc0ZGM0MzQwYTU0ZjY2ZmI2NWUzMzk3OA@warm-toucan-81434.upstash.io:6379
//////////////////////////////////////////////


# BullMQ background jobs (scheduled posts, emails, notifications, webhooks,
# push, maintenance, gamification, media-cleanup, chat-forward). Needs a TCP
# Redis URL (Upstash REST won't work).
REDIS_URL=rediss://default:<casual-lion-token>@casual-lion-149007.upstash.io:6379

# Socket.io pub/sub adapter (multi-instance realtime), same DB as BullMQ.
UPSTASH_REDIS_URL=rediss://default:<casual-lion-token>@casual-lion-149007.upstash.io:6379
```

### LAUNCH GATES (set these to control who can sign up)

```
WAITLIST_REQUIRED=true     # true = only waitlisted emails can sign up. false = open to everyone
INVITE_REQUIRED=true       # true = personal access links required. false = waitlist email enough
INVITE_TTL_DAYS=14         # access link expiry (days)
```

### OPTIONAL (skip if unused)

```
LANDING_PAGE_URL=https://your-orbit-waitlist.vercel.app   # waitlist landing URL (CORS)
CLUSTER_ENABLED=false                                      # false = single process; prod defaults to 2 workers
CLUSTER_MAX_WORKERS=2                                      # cap for cluster workers (prod only)
DB_POOL_SIZE=50                                            # Mongo connection pool (prod default 50)
GEMINI_API_KEY=...                                         # contextual bot-farm conversations
MEILISEARCH_URL=...                                        # full-text search (indexing currently unwired)
LOGTAIL_SOURCE_TOKEN=...                                   # cloud log shipping
TURNSTILE_SECRET_KEY=...                                   # waitlist anti-spam (fail-closed when set)
WAITLIST_SKIP_DNS=false                                    # true skips the MX check (tests only)
IMAGEKIT_PUBLIC_KEY=...
IMAGEKIT_PRIVATE_KEY=...
IMAGEKIT_URL_ENDPOINT=...
SENTRY_DSN=...
```

> Index management: production runs with Mongoose `autoIndex: false` — after
> deploying a schema change that adds/alters indexes, run `npm run db:sync-indexes`
> once (builds missing indexes; auto-drops legacy name-colliding ones).

---

## 🖥️ FRONTEND (Vercel)

### MANDATORY (only ONE var needed)

```
VITE_API_URL=https://orbit-server-live.onrender.com
```

⚠️ **NO `/api` at the end** — the code appends `/api/auth/google` itself.

### NECESSARY (realtime — optional, falls back to VITE_API_URL)

```
VITE_SOCKET_URL=https://orbit-server-live.onrender.com
```

### OPTIONAL

```
VITE_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:...","username":"...","credential":"..."}]
# OR
VITE_TURN_URL=...
VITE_TURN_USERNAME=...
VITE_TURN_CREDENTIAL=...

VITE_SENTRY_DSN=https://...
```

> Deploy updates reach users automatically — the service worker is registered with
> `updateViaCache: "none"`, checked every 5 min + on tab focus, and the app reloads
> itself on a new version. No user action needed after deploys.

---

## ✅ Pre-deploy checklist

1. **Google Console** → Credentials → OAuth Client → "Authorized redirect URIs" must contain exactly:
   `https://orbit-server-live.onrender.com/api/auth/google/callback`
2. **`CLIENT_URL`** = real public frontend URL (not localhost) before sharing the app.
3. **Test Google login** once against the live URL.
4. No quotes around values in Render dashboard (raw values only).
