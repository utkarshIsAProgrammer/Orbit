# 🗄️ ORBIT — Database Reference (MongoDB Atlas)

> 35 Mongoose models, one MongoDB. Every model lives in `server/src/models/`.
> This doc is the map: purpose, key fields, and the *notable* indexes (the full
> set is in each model file — and every query in the app has a matching index).
>
> **Index changes:** prod runs with `autoIndex: false` — after editing a model's
> indexes, run `npm run db:sync-indexes` once against prod.

---

## Conventions used across all models

- `{ timestamps: true }` on every schema → `createdAt` / `updatedAt` everywhere.
- **Denormalized counters** — `Post.likesCount`, `User.followersCount`, etc.
  are `$inc`'d atomically, never aggregated. They can drift → repair scripts
  exist (`inspect-follows.ts`, `repair-follow-counts.ts`).
- **Cursors over skip** — lists paginate by `_id`/`createdAt`; indexes support
  the sort.
- **TTL indexes** for ephemeral data (interactions 90d, glimpses 24h).
- **Polymorphic interactions** — `Like`/`Save`/`Repost` point at a native
  `post` OR an `externalPost` (nullable), enforced by **partial unique
  indexes**.

---

## The models, by domain

### Identity & accounts
| Model | Purpose | Notable |
|---|---|---|
| `User` | Profiles, privacy, follow/block/mute lists, close friends, `affinityScores`/`contentAffinity` maps, `seenPosts` (capped 500), perks, XP/badges | Most indexes in the app: username unique, collation index for search, multikey indexes for `closeFriends`/`mutedCommunities`/`mutedConversations` |
| `Bot` | Bot farm rows (a real user per bot) | `botId` unique, `username` unique |
| `BotFarm` | Farm status/state | — |
| `Waitlist` | Waitlist signups | unique emails |
| `UserInvite` | Invite codes | unique `inviteCode`, TTL via `INVITE_TTL_DAYS` |
| `PerkTombstone` | One-time-perk grant records | unique `emailKey` |
| `DeviceSubscription` | Web-push subscriptions | unique `user + endpoint` |
| `EmailPreference` | Opt-outs | unique email |
| `ApiKey` | Developer API keys | `keyHash` unique, `user + isActive` |

### Content
| Model | Purpose | Notable |
|---|---|---|
| `Post` | Content: text, images/video, poll, collab, quote, schedule, edit history | ~20 indexes: `author+status+createdAt`, `visibility+status+createdAt`, `hashtags+createdAt`, `likesCount+commentsCount` (discovery sort), `status+scheduledAt`, text index on title/content |
| `Comment` | Nested replies, reactions | `post+parent+_id`, `post+createdAt` |
| `Glimpse` | 24h stories, viewers, replies | TTL on `expiresAt`, `author+createdAt` |
| `ExternalPost` | Imported open-web content (Web tab) | `source` unique + `source+originalCreatedAt` |
| `Collection` | Save folders | `user+name`, `user+createdAt` |

### Social graph & interactions
| Model | Purpose | Notable |
|---|---|---|
| `Follow` | Follow edges | unique `follower+following`, `following+createdAt` |
| `FollowRequest` | Private-account requests | unique `sender+recipient` |
| `Block` | Mutual block edges | unique `blocker+blocked`, `blocked` |
| `Like` / `Save` / `Repost` | Polymorphic interactions | **partial unique** indexes (`user+post` where post is an ObjectId) |
| `Interaction` | Feed-ranking signals | `userId+timestamp`, `targetAuthorId+timestamp`, TTL 90 days |

### Messaging
| Model | Purpose | Notable |
|---|---|---|
| `Conversation` | 1:1 chats | unique `participants.0+participants.1`, `participants+updatedAt`, `updatedAt` |
| `Message` | DM messages | `conversation+createdAt`, `conversation+recipient+seen`, `conversation+isDeleted+createdAt` |
| `Community` | Groups | `members.user` (multikey), `members.user+updatedAt`, `memberCount` |
| `CommunityMessage` | Group messages | `community+createdAt`, `community+room+createdAt`, `community+isDeleted+createdAt` |

### Gamification
| Model | Purpose | Notable |
|---|---|---|
| `XP` | Per-user XP/level history | unique `userId` |
| `DailyMission` / `UserMission` | Daily missions | unique `userId+date` |
| `DailyReward` | Daily claim records | `totalPoints` for leaderboard |
| `UserStreak` | Streaks (incl. partner streaks) | `currentStreak`, `lastActiveDate` |

### Operations
| Model | Purpose | Notable |
|---|---|---|
| `Notification` | All notification types | `recipient+createdAt`, `recipient+isRead+createdAt`, `recipient+type+createdAt` |
| `Report` | User reports | `status+createdAt` |
| `ModerationItem` | Moderation queue | `status+createdAt`, `targetType+targetId` |
| `FeatureFlag` | A/B flags + rollout % | unique key |
| `AdminAuditLog` | Admin actions | `createdAt`, `action` |
| `Webhook` | Developer webhooks | `user+isActive` |
| `Broadcast` | Admin announcements | — |

---

## Indexes worth understanding deeply

1. **`Post { author: 1, status: 1, createdAt: -1 }`** — profile pages:
   "one author's published posts, newest first". Equality fields first
   (author, status), then the sort field.
2. **`Post { likesCount: -1, commentsCount: -1 }`** — the discovery sort. A
   single-field `likesCount` index can't serve a two-field sort — this
   compound index was the missing piece (in-memory sort → index seek).
3. **Partial unique `Save/Repost { user, post }`** — allows `post: null`
   (external saves) while staying unique for real posts. The legacy non-partial
   version rejected external saves (duplicate-key on null) and required the
   `sync-indexes` migration.
4. **Collation index `User { username: 1 }` (strength 2)** — case-insensitive
   anchored regex + `.collation()` = index seek, not a scan. Search depends on it.
5. **TTL `Interaction { timestamp: 1 } expireAfterSeconds: 90d`** — bounded
   affinity history without cron cleanup.
6. **`Message { conversation: 1, _id: -1 }`** — cursor pagination: the `_id`
   cursor + reverse sort ride the index.

## Repair & inspection scripts

| Script | Fixes |
|---|---|
| `inventory-db.ts` | Read-only collection/user/waitlist inventory |
| `inspect-follows.ts` | Detect follower/following counter drift |
| `repair-follow-counts.ts` | Rebuild counters from the authoritative Follow collection |
| `clear-follow-caches.ts` | Purge stale follow/profile cache keys after repair |
| `sync-indexes.ts` | Build missing indexes (auto-drops legacy name-colliding ones) |

## Cache-key namespace (data that mirrors the DB)

Reads are cached in Upstash + memory (see `configs/cache.ts`): `user:*`,
`feed:ranked:*`, `posts:*`, `comments:*`, `followers:*`, `following:*`,
`chat:messages:*`, `chat:conversations:*`, `presence:user:*`,
`rt:events:*` (realtime log), `hashtag:*`, `saves:*`, `drafts:*`. Mutation
controllers clear the affected patterns — see `evictAffectedCaches` on the
client and `clearByPattern` on the server.
