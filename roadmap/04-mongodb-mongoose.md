# 04 — MongoDB + Mongoose: Schemas, Indexes, Queries, Design

> MongoDB is a **document database**: data lives in JSON-like documents inside
> collections (≈ tables), and there are no joins — you design your documents
> to serve the queries you need. Mongoose is the ODM (object-document mapper)
> that gives TypeScript schemas, validation, and query helpers on top.

---

## 1. The three things every model file contains

Every file in `server/src/models/` is:

```ts
// 1. The schema — field types + validation + defaults
const postSchema = new mongoose.Schema({ content: String, author: { type: ObjectId, ref: "User", required: true }, ... }, { timestamps: true });

// 2. Indexes — declared for every query pattern (see below)
postSchema.index({ author: 1, status: 1, createdAt: -1 });

// 3. The model
const Post = mongoose.model("Post", postSchema);
export default Post;
```

`{ timestamps: true }` auto-manages `createdAt`/`updatedAt`. **Every model uses
it** — that's why the whole app can sort by `createdAt` and cache-invalidate by
`updatedAt`.

## 2. Key Mongoose concepts, with the file to learn each from

| Concept | What it is | Best example |
|---|---|---|
| `ObjectId` + `ref` | A reference to another collection's `_id` (Mongo's join-substitute) | `post.model.ts` `author: { type: ObjectId, ref: "User" }` |
| `.populate()` | Fetch the referenced docs (N+1-safe when used well) | `feedService.ts` `.populate("author", "username fullName ...")` |
| `.lean()` | Return **plain JS objects**, not Mongoose documents — much faster, no getters/setters | every hot read path (`feedService`, controllers) |
| `.select()` | Choose fields — the `-field` syntax *excludes* (`-password -otp`) | `user.controllers.ts` `publicUser()` |
| `Map` fields | Dynamic key→value maps stored as objects | `user.model.ts` `affinityScores`, `contentAffinity` |
| Arrays of subdocs | Embedded lists (no separate collection) | `post.model.ts` `images`, `user.model.ts` `closeFriends` |
| TTL index | Auto-delete documents after a time | `interaction.model.ts` `expireAfterSeconds: 90*24*60*60`; `glimpse.model.ts` `expiresAt` |
| `$inc` | Atomic counter increment (no read-modify-write race) | `post.controllers.ts` `likesCount` |
| `$push $slice` | Append to an array while capping its length | `affinityService.ts` `markPostsAsSeen` ($slice: -500) |
| `$in` / `$nin` | Match against a list / exclude a list | `feedService.ts` candidate queries |
| `.collation()` | Case-insensitive matching + index use | `search.controllers.ts` username search |

## 3. Schema design decisions this codebase makes (the WHY)

1. **Denormalized counters.** `Post` stores `likesCount`, `commentsCount`,
   `savesCount`, `repostsCount`, `viewsCount`; `User` stores
   `followersCount`/`followingCount`. Reads never aggregate — they read one
   number. Writes `$inc` atomically. *Trade-off:* counters can drift from
   reality (hence `scripts/repair-follow-counts.ts`).
2. **Polymorphic interactions.** One `Like`/`Save`/`Repost` document handles
   *either* a native `post` *or* an `externalPost` — enabled by **partial
   unique indexes** (`saves.model.ts`, `repost.model.ts`):
   ```ts
   saveSchema.index({ user: 1, post: 1 }, { unique: true, partialFilterExpression: { post: { $type: "objectId" } } });
   ```
   A plain unique `{user, post}` would reject `post: null` (external saves) —
   that exact legacy index caused a production migration (see 14).
3. **Everything is cursor-paginated.** Lists return `{ posts, nextCursor,
   hasMore }` — never `skip`. Cursor = the last `_id` (sortable) or timestamp.
   Indexes are designed so the sort + cursor are an index seek.
4. **TTL for ephemeral data.** Interactions auto-delete after 90 days
   (bounded affinity history), glimpses after 24h. No cron cleanup needed.
5. **Embedded over separate.** Polls live inside posts; close-friends lists
   inside users; comments are a separate collection (they grow unboundedly).

## 4. Indexes — the most important performance topic

An index is a sorted structure Mongo maintains so a query can jump to matches
instead of scanning. **Every query in this app has a matching index** — that's
a deliberate, audited property.

Read the index blocks in `post.model.ts` and map each to a query:

```ts
postSchema.index({ author: 1, status: 1, createdAt: -1 });
// → Post.find({ author: id, status: "published" }).sort({ createdAt: -1 })
//   (profile pages: one author's published posts, newest first)

postSchema.index({ visibility: 1, status: 1, createdAt: -1 });
// → feed/discovery queries filtering public + published

postSchema.index({ likesCount: -1, commentsCount: -1 });
// → discovery sort .sort({ likesCount: -1, commentsCount: -1 })
//   (compound index added because single-field indexes can't serve a two-field sort)
```

**Index rules of thumb (learn these):**
- Index order matters: equality fields first, then the sort field.
- `-1` vs `1` matters for the *sort field* only (Mongo can walk backward).
- A compound index serves any query whose prefix matches (`{a:1,b:1}` serves
  `{a:1}` but not `{b:1}`).
- Unique + partialFilterExpression = unique *among matching docs only*.
- **Index management in prod:** the app runs `autoIndex: false` in production
  (boot-time index building for 35 models was hammering Atlas on every deploy).
  Schema index changes are applied with `npm run db:sync-indexes` (a script
  that builds missing indexes and auto-drops legacy name-colliding ones).

## 5. The hot queries — study these three

1. **The ranked feed** (`feedService.ts` `generateCandidates`) — three parallel
   queries (`Promise.all`): followed authors, high-affinity authors, discovery.
   Each `.lean()`, indexed, capped at 300/100/100. Then scoring happens **in
   JS**, not in Mongo — a deliberate choice so the ranking logic is testable
   pure functions.
2. **Chat message list** — `Message.find({ conversation })` sorted by `_id`
   desc (index `{conversation:1, _id:-1}`); cursor = last `_id`.
3. **The notification feed** — `{recipient:1, isRead:1, createdAt:-1}`.

## 6. The connection & operations config (`db.ts`)

- `maxPoolSize: 50` prod (was 100 — 2 instances × 100 exceeded shared-cluster
  limits), `minPoolSize: 10`.
- `retryWrites`/`retryReads` (Atlas replicas), `serverSelectionTimeoutMS: 5000`.
- `autoIndex: env.NODE_ENV !== "production"`.
- Custom reconnect polling (Mongoose's auto-reconnect + an explicit fallback
  loop that re-`mongoose.connect()`s on a 15s interval, capped at 10 attempts).

## 7. Data-consistency helpers

- `scripts/inventory-db.ts` — read-only inspection.
- `scripts/inspect-follows.ts` + `scripts/repair-follow-counts.ts` — detect and
  fix drifted follower counters (the denormalization tax).
- `scripts/sync-indexes.ts` — the prod index migration tool.

---

## Exercises

1. Pick any `Post.find(...)` in `feedService.ts` and find the index that serves
   it. Explain the order of the index fields.
2. Explain in one sentence why `saves` needs a *partial* unique index.
3. Write a query that lists a user's 20 most recent public posts, then check
   `post.model.ts` for the index that covers it.
4. Read `interaction.model.ts` — what happens to interaction rows after 90 days,
   and why is that okay for the affinity feature?
