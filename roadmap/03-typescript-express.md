# 03 — TypeScript, Express 5, Routing, Validation, Error Handling

> The server is a TypeScript Express 5 API. Every request that enters goes
> through the same pipeline: **middleware → route → controller → (model) →
> response**, with **Zod validation** at the door and a **global error
> handler** catching everything. Learn the pipeline once and every controller
> in the project becomes readable.

---

## 1. TypeScript setup (the boring but essential part)

- `server/tsconfig.json` — strict mode, CommonJS output (`dist/`), decorators off.
- `npm run build` = `tsc` (emit to `dist/`), `npm run dev` = `tsx --watch`
  (runs TS directly, no build step), `npm run typecheck` = `tsc --noEmit`.
- `src/types/` — ambient declarations that patch library types:
  - `express.d.ts` extends Express's `Request` with `req.user` (the JWT user)
    and `req.requestId` — this is what lets controllers write `req.user._id`
    without casts.
  - `web-push.d.ts`, `imagekit.d.ts`, `meilisearch.d.ts` — typings for libs
    that ship without them.

**Learn:** *ambient module augmentation* (`declare global { namespace Express { interface Request { user?: ... } } }`). Every Express + TS project needs it.

## 2. Express 5 — the pipeline

Express is a **stack of functions**. Each `app.use(fn)` pushes a function onto
the stack; each `fn(req, res, next)` either responds or calls `next()`.

In `server.ts`, the order matters enormously — read it top to bottom and note:

```ts
app.use(cors(...));      // CORS FIRST (before routes)
app.use(helmet(...));    // security headers
app.use(express.json({ limit: "10mb" }));   // body parsing
app.use(cookieParser()); // read cookies into req.cookies
app.use(generalLimiter); // rate limit every /api/* request
app.use(csrfProtection); // double-submit CSRF
app.use("/api/posts", postRoutes);  // routes mounted LAST
```

**Key mental model:** middleware *before* routes is request preprocessing;
error middleware *after* routes catches anything thrown.

## 3. Routing — the route file pattern

Every `src/routes/*.routes.ts` follows the same shape:

```ts
import { Router } from "express";
import { protect, optionalAuth } from "../middlewares/auth.middleware";
import { createPost, getPostById } from "../controllers/post.controllers";
import { validatePost } from "../schemas/post.schema";

const router = Router();

router.post("/", protect, validatePost, createPost);   // auth → validate → handle
router.get("/:id", optionalAuth, getPostById);          // public read, optional user
router.delete("/:id", protect, deletePost);

export { router as postRoutes };
```

Learn these middleware roles:

| Middleware | What it does | Where |
|---|---|---|
| `protect` | Verifies JWT, loads user, rejects banned users, sets `req.user` | `auth.middleware.ts` |
| `optionalAuth` | Same, but *doesn't* reject anonymous requests — `req.user` may be undefined (public profiles, feeds) | `auth.middleware.ts` |
| `adminOnly` | Requires `isAdmin: true` | `auth.middleware.ts` |
| Zod schema fns | Parse/validate the body, 400 with field errors on failure | `schemas/*.ts` |
| `generalLimiter` / `authLimiter` etc. | Rate limiting | `ratelimit.middleware.ts` |

## 4. Validation — Zod

Zod is a schema library: you describe the *shape* of valid input, and Zod both
validates and *types* it.

```ts
// schemas/post.schema.ts
const createPostSchema = z.object({
  content: z.string().max(2000).optional(),
  images: z.array(z.string()).max(10).optional(),
  visibility: z.enum(["public", "closeFriends"]).default("public"),
});
```

The middleware wrapper runs `schema.parse(req.body)` inside try/catch and
sends a **400 with the field errors** — the client shows them under the exact
input. `env.ts` uses the same Zod concept for *environment* variables, which
is why the app refuses to boot with a missing `MONGO_URI`.

**Learn:** `z.object`, `z.enum`, `z.string().min/max/email`, `z.coerce.number`
(coerce strings to numbers), `z.array().max()`, `.default()`, `.optional()`,
`.safeParse()` vs `.parse()`.

## 5. Error handling — the two-layer design

**Layer 1 — custom error classes** (`utilities/errors.ts`):

```ts
class AppError extends Error { statusCode: number; ... }
class NotFoundError extends AppError { statusCode = 404; }
class BadRequestError extends AppError { statusCode = 400; }
```

Controllers throw these when they know the outcome ("post not found"). **Layer
2 — the global error handler** in `server.ts`:

- `ZodError` → 400 + field errors
- `AppError` → its statusCode + message
- Mongoose `ValidationError` → 400 + the first human-readable reason
- Mongo duplicate key (11000) → 409 "already exists"
- anything else → 500 "Internal server error" (never leaks internals to the client)

So a controller can `throw new NotFoundError(...)` and never think about the
response shape. **This is the pattern to copy in any Express app.**

## 6. Controllers — the business-logic layer

Read `post.controllers.ts` `createPost` and notice the *steps*:

```ts
try {
  // 1. build the doc (sanitize input!)
  // 2. save + $inc counters
  // 3. fire-and-forget fan-out: enqueueGamification / enqueueNotificationCreate
  //    (BullMQ when configured — see 08)
  // 4. evict caches (clearByPattern on affected keys)
  // 5. respond 201
} catch (err) { next(err); }
```

Every interaction controller (like, follow, save, repost) follows this exact
shape — find it, and you've understood 80% of the controllers.

## 7. The pieces that make it production-grade

- **`req.requestId`** — `server.ts` assigns a UUID to every request; the
  logger and error handler carry it so you can correlate logs for one request.
- **Slow-request logging** — the request-logging middleware logs any request
  over 5s (that's how you spot a query that needs an index).
- **`Cache-Control: private, no-store`** — a middleware wraps `res.json` /
  `res.send` / `res.sendFile` on GET /api responses to stop the browser HTTP
  cache from ever serving stale authenticated data (the app's own caches are
  purgeable; the HTTP cache is not).
- **404 handler** after all routes, **global error handler** last.

---

## Exercises

1. Add a new endpoint: `GET /api/posts/:id/related` — write the route, a
   controller stub, and wire it in `server.ts`. Typecheck it.
2. Explain why the global error handler is the LAST `app.use` and what happens
   if a controller throws without `next(err)`.
3. Find three places `optionalAuth` is used and explain why the route can't
   use `protect` there.
4. Read `utilities/errors.ts` and add a `ConflictError` subclass, then throw it
   from a controller and confirm the client gets a 409.
