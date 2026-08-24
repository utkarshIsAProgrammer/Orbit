# TESTING — How Orbit is Tested

Current state (verified): **server 26 suites / 245 tests, client 14 test files / 61 tests.**

- Server: **Jest** (`server/jest.config.*`) with `mongodb-memory-server` — no real DB needed.
- Client: **Vitest** (Vite-native, shares the Vite config).

---

## Server tests

### Stack

| Piece | What it does |
|---|---|
| **Jest** | Test runner (`npm test` → `jest --forceExit --detectOpenHandles`) |
| **mongodb-memory-server** | Spins up a real MongoDB binary in-memory per test run — real queries, real indexes, zero setup |
| **supertest** | HTTP-level tests: boot the Express app and make real requests |
| **mockSocket** (`server/src/__tests__/helpers/mockSocket.ts`) | A fake socket.io client/server pair so controller tests can assert emitted events without a real socket |

### Layout

```
server/src/__tests__/
├── helpers/            # mockSocket, test utilities
├── *.test.ts           # one file per controller/service
└── queue.test.ts       # BullMQ queue config tests (12 tests)
```

### How tests are structured

Controller tests follow the same shape:

```ts
// 1. Build a fresh app instance (or the real one)
// 2. Insert fixture data through the models directly
// 3. supertest(app).post("/api/posts").set("Cookie", jwtCookie)...
// 4. Assert the response shape AND the emitted socket event
```

### Adding a test

1. Create `server/src/__tests__/<thing>.test.ts`.
2. Import the app + models + helpers.
3. Use `beforeEach`/`afterEach` to clean collections (memory-server resets between runs).
4. Run `npx jest src/__tests__/<thing>.test.ts` — iterate fast.
5. Run the full suite `npm test` before committing.

### Running

```bash
cd server
npm test                # full suite
npx jest src/__tests__/queue.test.ts   # single file
npm run test:watch      # watch
npm run test:coverage
npm run test:ci         # CI mode (coverage + forceExit)
```

---

## Client tests

Vitest with jsdom. Components that touch the offline/cache layers use mocks
for `localStorage`, `indexedDB`, and the service worker APIs.

```bash
cd client
npm test            # vitest run
npm run test:ui     # interactive UI
npm run test:coverage
```

### What's covered

- Pure utilities: validation, deviceId, notification text, tabChunks logic, offline DB helpers
- Components with isolated logic (char counters, validation messages, etc.)
- Feature-gate behavior (isFeatureOn)

### Not covered (by design)

- Full socket flows end-to-end (covered by `server/scripts/test-socket-e2e.mjs` against a live server)
- Visual/gesture behavior (manual QA; see `docs/GESTURES.md`)
- Service-worker precache behavior (verified in devtools; the `sw.js` has unit checks inside its build)

---

## The socket E2E script

`npm run test:socket` runs `server/scripts/test-socket-e2e.mjs` — a real
socket.io client that connects to a **running** server and asserts the
realtime contract (connect → events:sync → presence → emit/receive). Useful
after any socket change. Requires the dev server running.

---

## Golden rules for this codebase

1. **Never hit the real prod DB from a test** — memory-server or fixtures only.
2. **Assert socket emissions**, not just HTTP responses — most endpoints emit events and that's half the contract.
3. **`--forceExit` is on** — open handles (timers, sockets) are common; if a test hangs, look for an unclosed interval in the code under test.
4. When you change a controller, run its test file **and** `queue.test.ts` if you touched queue.ts.

---

## Debugging a failing test

- Run just that file with `-t "test name"` to filter.
- `console.log` works — Jest shows it with `--verbose`.
- If it passes alone but fails in the suite: **test pollution** — a `beforeEach` missing a collection cleanup, or a shared module-level state (e.g. a cache singleton). The in-memory cache in `cache.ts` is a common culprit — clear it in `beforeEach`.
