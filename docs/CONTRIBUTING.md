# CONTRIBUTING — How to Work on Orbit

This repo has strong conventions. Following them keeps the code consistent
and the docs accurate (docs are refreshed against live code — drift gets
caught and fixed).

---

## Architecture in one sentence

A **REST API** (Express 5 + Mongoose) with **socket.io** for realtime, a
**React + Vite + TypeScript** SPA with offline-first caching, connected by a
**JSON API + socket event** contract. Background work runs on **BullMQ**
queues (or inline fallbacks when Redis is down).

Request flow: `route → controller → service/model → response + socket emit`.
Client flow: `component → apiFetch (SWR cache) → optimistic UI → syncQueue (offline) → socket event → applyRealtimeEvent`.

---

## Conventions (follow these)

### Server

| Concern | Convention |
|---|---|
| Routing | `src/routes/*.routes.ts` — thin: mount controllers with middleware. 38 route modules, each registered in `server.ts`. |
| Controllers | `src/controllers/*.controllers.ts` — request handling, validation (Zod), response shape, socket emits. |
| Models | `src/models/*.model.ts` — Mongoose schemas. **Indexes are declared in-schema** (compound, partial, TTL) — this is how the DB stays fast. |
| Services | `src/services/*.ts` — business logic that's shared or heavy (feed ranking, affinity, bots, external sync). |
| Queues | `src/configs/queue.ts` — **all queue names use `orbit-` prefix, dash never colon** (BullMQ rejects `:`). Enqueue through the helper; it falls back to inline execution when Redis is unavailable. |
| Error handling | Two layers: per-controller try/catch → next(err); global error middleware in `server.ts` normalizes to `{ success: false, message }`. |
| Validation | Zod schemas in controllers; parse before touching the DB. |
| Responses | Success: `{ success: true, data }`. Failure: `{ success: false, message }` (+ `fieldErrors` for auth forms). |
| Socket events | Define in `src/configs/socket.ts` + emit from controllers. Event names are kebab-case (`post:created`, `chat:notification`, `events:sync`). |
| Logging | Structured JSON logs via `logger` (`src/configs/logger.ts`): `{ environment, level, message, ...context }`. Never `console.log` in server code. |
| Secrets | **Never commit `.env` or real credentials.** `docs/ENV.md` documents variables with placeholders. |

### Client

| Concern | Convention |
|---|---|
| Data fetching | `apiFetch` from `src/utils/api.ts` — cache-first SWR with `bypassCache` opt-out. Never raw `fetch` for API calls. |
| Offline writes | Optimistic update → `syncQueue.enqueue` (dedupes by entity) → real API call. `src/utils/syncQueue.ts`. |
| Realtime | All socket events funnel through `applyRealtimeEvent` (`src/utils/realtimeSync.ts`) which upserts Dexie + evicts cache URLs. |
| State | `App.tsx` holds global state (user, tab, socket, conversations). Per-feature state lives in components. |
| Styling | Tailwind utility classes + `src/index.css` theme tokens. Dark-first "Midnight Aurora" palette. |
| Code splitting | One lazy chunk per tab + the composer. `prefetchTabChunk` on hover/tap; idle-time `prefetchLikelyNextTabs`. **Don't eagerly import tab components in App.tsx.** |
| Icons | `lucide-react`. |
| Comments | **Comments are load-bearing in this repo** — the "why" of every non-obvious decision is written inline. Preserve them; add them for your own decisions. |

### Both

- TypeScript strict-ish: typecheck with `npm run typecheck` (server) / `npm run lint` (client = `tsc --noEmit`).
- Tests: see `docs/TESTING.md`. Run relevant suites before pushing.
- Commit style: `type(scope): short imperative summary` — e.g. `fix(orbit): translate failure toast`, `feat(admin): audit trail`. Reference the git log for tone.

---

## Adding a feature end-to-end (the checklist)

1. **Model** — schema + indexes + (de)normalized counters. Server.
2. **Route** — mount in `server.ts` + create `*.routes.ts`.
3. **Controller** — Zod validation, DB work, response, **socket emit**.
4. **Tests** — controller test with supertest + mockSocket.
5. **Client API** — `apiFetch` call (+ cache invalidation if it changes existing data).
6. **Client component** — render + optimistic update + realtime apply.
7. **Docs** — if it changes the surface (routes, env, events, features), update `docs/API_REFERENCE.md`, `docs/FEATURES.md`, `docs/FEATURES_STATUS.md`, `roadmap/*` as applicable.
8. **Typecheck + tests + build** all three.

---

## Running checks before you push

```bash
cd server && npm run typecheck && npm test
cd client && npm run lint && npm test && npm run build
```

Deploys run: server `npm install --include=dev && npm run build` → `node dist/server.js`; client `pnpm build` → static hosting.

---

## Working with the docs

`docs/` is the live reference (all `.gitignore`d — **docs are not committed**,
they're local working notes; the `roadmap/` folder is your learning
curriculum). When you change behavior:

- Env vars changed → `docs/ENV.md`
- Route added/removed → `docs/API_REFERENCE.md`
- Feature changed → `docs/FEATURES.md` + `docs/FEATURES_STATUS.md`
- Deploy/ops behavior → `docs/RUNBOOK.md`
- Data model → `docs/DATABASE.md`

---

## Do / Don't

- ✅ Ask "what's the cache story?" for every read — most reads should be cached, most writes should invalidate.
- ✅ Ask "what's the socket story?" for every mutation — users in other tabs expect to see it live.
- ✅ Ask "should this be a queue?" — anything slow or fan-out on a request path should enqueue instead (BullMQ, falls back to inline).
- ❌ Don't add raw `fetch` — use `apiFetch`.
- ❌ Don't use `:` in queue names.
- ❌ Don't commit `.env`, credentials, or real tokens.
- ❌ Don't remove comments to "clean up" — the why matters here.
