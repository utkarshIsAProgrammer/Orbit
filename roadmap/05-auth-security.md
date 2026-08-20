# 05 — Auth & Security: How Login Works and How the App Stays Locked Down

> Auth in this app is **session-based via JWT in an httpOnly cookie**, layered
> with CSRF protection, rate limiting, and per-route authorization checks.
> This file walks the three login paths (email/password, Google OAuth, session
> restore) and then every security control the app uses — with the files to
> learn each from.

---

## 1. The core auth design

- **Password hashing:** bcrypt (`user.model.ts` pre-save hook hashes only when
  the password changed).
- **Session token:** a **JWT** signed with `JWT_SECRET`, issued with
  `issuer: "orbit"`, `audience: "orbit-users"`, and the user's id in the payload.
- **Delivery:** an **httpOnly cookie** — JavaScript can't read it (XSS can't
  steal it). In production the cookie is `sameSite: none; secure` so the
  Vercel frontend (different origin) can send it to the Render API.
- **Verify:** `auth.middleware.ts` reads the cookie, `jwt.verify` with
  issuer+audience, loads the user, rejects banned users, attaches `req.user`.

**Why JWT-in-cookie and not localStorage?** localStorage is readable by any
script (XSS → account theft). An httpOnly cookie survives XSS; CSRF is the
remaining attack, handled by the double-submit token below.

## 2. Email/password flow — follow the code

`auth.controllers.ts`:

1. `register` — validate (Zod), check duplicate username/email, bcrypt-hash,
   create the user, set the cookie, respond with the user.
2. `login` — find by username-or-email, `bcrypt.compare`, check lockout
   (repeated failures → temporary lock), set cookie.
3. `logout` — clear cookie (idempotent; public route).
4. `forgot password` — generate a 6-digit **OTP** (`configs/generateOtp.ts`),
   email it, store hash + expiry; `verifyOtp` + `resetPassword` complete it.
5. `checkSession` (`/api/auth/me`) — cache-first read of the user; on reload
   the client restores the session from the cookie + cache (see 06 for the
   reconcile step that re-fetches the authoritative user).

## 3. Google OAuth — the flow and the tricky parts

`oauth.controllers.ts` + `routes/oauth.routes.ts` + the client button in
`Auth.tsx`:

1. Client navigates to **a relative `/api/auth/google`** (proxied to Render).
   *Why relative:* the server sets an httpOnly `oauth_state` cookie that must
   land on the *same origin as the callback* — a full backend URL would split
   the cookie from the callback and break the state check (a real production bug).
2. Server redirects to Google with a `state` param (anti-CSRF for the callback).
3. Google redirects back to `GOOGLE_CALLBACK_URL` with `?code=...`.
4. The **preferred path**: the callback redirects the browser to the app with
   `?oauth_code=<one-time code>`; the client exchanges it via
   `POST /api/auth/oauth-exchange` (a normal XHR, same channel as login) and
   calls `handleAuthSuccess(user, token)`. This survives **mobile browsers that
   drop redirect-set cookies** — the fix for "Google login works on desktop,
   fails on phone".
5. Legacy path: cookies set on the redirect → `checkSession()`.

## 4. CSRF — double-submit cookie

`csrf.middleware.ts`:

- The server sets a **non-httpOnly** `csrf-token` cookie.
- On any state-changing request the client reads that cookie and sends it back
  as the `x-csrf-token` **header** (`api.ts` `getCsrfToken`).
- The middleware compares header === cookie. An attacker's site can *set* a
  cookie on your domain but can't *read* yours, and can't set custom headers
  cross-origin — so the check fails for cross-site requests.
- Public paths (`/api/auth/login`, the OAuth endpoints, `/api/ping`) are
  allowlisted; CSRF is skipped there.

## 5. Authorization — the layers

| Attack | Defense | Where |
|---|---|---|
| Forged session | JWT signature + issuer/audience verification | `auth.middleware.ts` |
| Stolen cookie via XSS | httpOnly cookie | `cookie.ts` |
| Cross-site request (CSRF) | double-submit token | `csrf.middleware.ts` |
| Brute force | rate limiters (auth: strict, general: per-IP) | `ratelimit.middleware.ts` |
| Account takeover via leaked JWT secret | (ops) rotate `JWT_SECRET` — it's in env, never in code | `docs/ENV.md` |
| Admin abuse | `adminOnly` on every admin controller + API keys can never touch `/api/admin/*` | `admin.controllers.ts`, `apiKey.controller.ts` |
| Unauthorized reads of others' data | ownership checks in every controller (`req.user._id === doc.user`) + `publicUser()` whitelist | `user.controllers.ts` |
| Banned users | rejected at auth on cookies AND API keys AND sockets | `auth.middleware.ts` |

## 6. SSRF — the link-preview guard (a real audit finding, fixed)

`linkPreviewService.ts` — the app fetches URLs to build link cards, which is a
**Server-Side Request Forgery** risk (fetching `http://169.254.169.254` would
hit cloud metadata). The fix, worth studying:

- `isBlockedUrl(url)` — rejects private/loopback/link-local IPs (including the
  cloud metadata address), http/https only.
- `safeFetch(url, MAX_REDIRECTS)` — DNS re-resolved and re-checked on every
  redirect; redirects capped; response size limited.

## 7. Other security controls (skim each once)

- **helmet CSP** (`server.ts`) — a strict Content-Security-Policy allowing only
  self + Cloudinary + fonts + CDNs; `frameAncestors: none` (can't be iframed).
- **Rate limits** — `generalLimiter` (300/15min) + stricter per-route limiters
  (auth, OTP, comments, interactions, socket connections per-IP).
- **Upload validation** — `upload.middleware.ts`: file type/size limits before
  Cloudinary.
- **Sanitization** — `configs/sanitize.ts` strips HTML/scripts from content
  before storage (XSS defense at the write path).
- **Webhooks/API keys** — keys stored as **SHA-256 hashes**, raw key shown once;
  read/write scoping; SSRF-guarded delivery on a BullMQ worker.
- **Bots are users** — the bot farm uses the same auth/ban/mute paths, so
  banning a bot works like banning anyone.

---

## Exercises

1. Walk the Google OAuth path end-to-end in the code and explain *why* the
   `oauth-exchange` one-time code exists (what breaks on mobile without it).
2. Explain CSRF to yourself using the double-submit pattern: what can an
   attacker's site do, and why does the header-cookie comparison defeat it?
3. Open `auth.middleware.ts` — list every check `protect` performs and the order.
4. Find the `publicUser()` whitelist in `user.controllers.ts` — which fields
   are always stripped, and what's the conditional for email?
