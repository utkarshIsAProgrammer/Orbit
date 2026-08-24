# ORBIT — Environment Variables Reference

> ⚠️ **This file contains NO real secrets.** Copy `server/.env.example` for actual values.

## 🔧 BACKEND (Render)

### MANDATORY (app won't boot without these)

```
NODE_ENV=production
MONGO_URI=mongodb+srv://USER:PASS@cluster.mongodb.net/orbit?appName=Cluster0
JWT_SECRET=<your-long-random-secret>
CLOUDINARY_NAME=<your-cloudinary-name>
CLOUDINARY_API_KEY=<your-cloudinary-api-key>
CLOUDINARY_API_SECRET=<your-cloudinary-api-secret>
CLIENT_URL=https://<your-frontend-url>
```

### NECESSARY (core features break without them)

```
TRUST_PROXY=1
PUBLIC_API_URL=https://<your-backend-url>     # Keep-alive ping (root, NO /api)

# Google login
GOOGLE_CLIENT_ID=<your-google-client-id>
GOOGLE_CLIENT_SECRET=<your-google-client-secret>
GOOGLE_CALLBACK_URL=https://<your-backend-url>/api/auth/google/callback

# Emails (Brevo — free tier 300/day)
BREVO_API_KEY=<your-brevo-api-key>
BREVO_FROM_EMAIL=no-reply@yourdomain.com
BREVO_SENDER_NAME=ORBIT

# Push notifications (VAPID)
VAPID_PUBLIC_KEY=<your-vapid-public-key>
VAPID_PRIVATE_KEY=<your-vapid-private-key>
VAPID_SUBJECT=mailto:you@yourdomain.com

# Video calls (LiveKit)
LIVEKIT_URL=wss://<your-livekit-url>.livekit.cloud
LIVEKIT_API_KEY=<your-livekit-api-key>
LIVEKIT_API_SECRET=<your-livekit-api-secret>

# Redis (Upstash)
UPSTASH_REDIS_REST_URL=https://<your-instance>.upstash.io
UPSTASH_REDIS_REST_TOKEN=<your-rest-token>
```

### FREE-TIER OPTIMIZATIONS

```
ENABLE_BULLMQ=false        # Saves ~50K Redis commands/day
CLUSTER_ENABLED=false      # Single process for free tier
SOCKET_REDIS_ADAPTER=false # No Redis pub/sub for single instance
```

### LAUNCH GATES

```
WAITLIST_REQUIRED=false
INVITE_REQUIRED=false
INVITE_TTL_DAYS=14
```

### OPTIONAL

```
LANDING_PAGE_URL=https://<your-waitlist-url>
CLUSTER_MAX_WORKERS=2
DB_POOL_SIZE=50
GEMINI_API_KEY=<your-gemini-key>
MEILISEARCH_URL=<your-meilisearch-url>
IMAGEKIT_PUBLIC_KEY=<your-imagekit-public-key>
IMAGEKIT_PRIVATE_KEY=<your-imagekit-private-key>
IMAGEKIT_URL_ENDPOINT=<your-imagekit-endpoint>
SENTRY_DSN=<your-sentry-dsn>
```

---

## 🖥️ FRONTEND (Vercel)

### MANDATORY

```
VITE_API_URL=https://<your-backend-url>       # NO /api at the end
VITE_SOCKET_URL=https://<your-backend-url>    # For WebSocket realtime
```

### OPTIONAL

```
VITE_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"}]
VITE_SENTRY_DSN=https://<your-sentry-dsn>
```
