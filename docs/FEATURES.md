# Orbit — Complete Feature Catalog (August 2026)

> Every feature currently implemented in Orbit across the client, server, and realtime layers.
> ✅ = fully implemented and wired.

---

## Table of Contents

1. [Authentication & Accounts](#1-authentication--accounts)
2. [User Profiles](#2-user-profiles)
3. [Posts & Content Creation](#3-posts--content-creation)
4. [Feed & Discovery](#4-feed--discovery)
5. [Social Interactions](#5-social-interactions)
6. [Chat / Direct Messages](#6-chat--direct-messages)
7. [Communities](#7-communities)
8. [Audio & Video Calls](#8-audio--video-calls)
9. [Glances (Stories)](#9-glances-stories)
10. [Search](#10-search)
11. [Notifications](#11-notifications)
12. [Push Notifications (On-Device)](#12-push-notifications-on-device)
13. [Close Friends](#13-close-friends)
14. [Settings](#14-settings)
15. [Moderation & Blocking](#15-moderation--blocking)
16. [Admin Dashboard](#16-admin-dashboard)
17. [Gamification: XP, Streaks, Missions, Leaderboard](#17-gamification)
18. [Translation & Link Previews](#18-translation--link-previews)
19. [Invite System](#19-invite-system)
20. [Offline & Performance](#20-offline--performance)
21. [UI / UX Polish](#21-ui--ux-polish)
22. [Realtime (Socket Events)](#22-realtime-socket-events)
23. [Security](#23-security)
24. [Data Models](#24-data-models)

---

## 1. Authentication & Accounts

| Feature | Backend | Frontend | Details |
| --- | --- | --- | --- |
| Email/Password Signup | ✅ | ✅ | `POST /api/auth/signup` — Zod validated, bcrypt hashed |
| Email/Password Login | ✅ | ✅ | `POST /api/auth/login` — JWT in httpOnly cookie |
| OAuth (Google) | ✅ | ✅ | `GET /api/auth/google` + one-time `oauth-exchange` code swap (survives mobile browsers that drop redirect cookies) |
| Logout | ✅ | ✅ | Clears auth cookie, wipes caches, stops background refresh |
| Session Check on Load | ✅ | ✅ | `GET /api/auth/me` on mount |
| Forgot / Reset Password | ✅ | ✅ | OTP email → verify → reset |
| Delete Account | ✅ | ✅ | `DELETE /api/users/delete-account` — cascades all data |
| Auth Expiry Handling | ✅ | ✅ | Socket disconnect + full cache wipe on `auth:expired` |

---

## 2. User Profiles

| Feature | Backend | Frontend | Details |
| --- | --- | --- | --- |
| View by ID / Username | ✅ | ✅ | `/api/users/:id`, `/api/users/username/:username` |
| Edit Profile | ✅ | ✅ | Name, bio, links, avatar, banner |
| Avatar & Banner Upload | ✅ | ✅ | Cloudinary upload, cropped & downscaled before upload |
| Avatar/Banner Crop Modal | ✅ | ✅ | Portal-centered cropper — no scrolling needed |
| Profile Share / Forward | ✅ | ✅ | Share menu → forward to chat + copy link (toast + in-app & device notification) |
| Followers / Following | ✅ | ✅ | Lists + follow/unfollow |
| Follow Requests (Private) | ✅ | ✅ | Send / approve / decline flow |
| Pinned Posts | ✅ | ✅ | Up to 3 posts pinned to profile top |
| Profile Tabs | ✅ | ✅ | Posts, Saved, Reposts, Drafts, Collections |
| Profile View Counter | ✅ | ✅ | Tracks visits |
| XP + Level Display | ✅ | ✅ | Badge + progress in header |
| Block / Mute on Profile | ✅ | ✅ | Inline block/unblock toggle |
| Suggestions | ✅ | ✅ | `GET /api/users/suggestions` — affinity-based |
| Post View Tracking | ✅ | ✅ | 3s-in-view increments view count app-wide |

---

## 3. Posts & Content Creation

| Feature | Backend | Frontend | Details |
| --- | --- | --- | --- |
| Create Post | ✅ | ✅ | Text, up to 10 images, single video |
| Image Downscale Before Upload | ✅ | ✅ | Client-side compression → fast publish |
| Edit Post | ✅ | ✅ | Tracked `isEdited` + history |
| Delete Post | ✅ | ✅ | Cascading cleanup + Cloudinary media deletion |
| Hashtags | ✅ | ✅ | Extraction, clickable, hashtag page |
| Mentions | ✅ | ✅ | `@username` autocomplete + notification |
| Quote Reposts | ✅ | ✅ | Commentary on repost, count on original |
| Repost | ✅ | ✅ | Toggle with optimistic UI |
| Audience (Public / Close Friends) | ✅ | ✅ | Green indication for close-friends-only posts |
| View Count | ✅ | ✅ | Deduped per-session counter |
| Reach Stats | ✅ | ✅ | Views / likes / shares / saves on card |

### Polls
| Feature | Details |
| --- | --- |
| Create Poll with Post | ✅ Multiple options, optional expiry |
| Vote (once, locked) | ✅ One vote per user, cannot be changed after selection |
| Results Display | ✅ Live counts; white + golden-glow selected style |
| Expiry | ✅ `expiresAt` blocks late votes |
| Notification on Vote | ✅ Notifies author |

### Scheduling & Drafts
| Feature | Details |
| --- | --- |
| Save Draft | ✅ Not visible in feed |
| Publish Draft | ✅ Instant optimistic publish + feed cache prepend |
| Draft Manager | ✅ View/edit/delete drafts in Profile tab with confirm dialog |
| Schedule Post | ✅ `scheduledAt` — exact-time BullMQ delayed job when `REDIS_URL` is set, 1-min cron poll fallback (feeds update in place) |

### Collaboration
| Feature | Details |
| --- | --- |
| Invite Collaborator | ✅ Backend wired (`collab-invite`) — **button disabled for now** |
| Accept Collaboration | ✅ Backend wired |
| Collab Badge | ✅ Shows collaborator on card |

---

## 4. Feed & Discovery

| Feature | Backend | Frontend | Details |
| --- | --- | --- | --- |
| Ranked Feed | ✅ | ✅ | Affinity + velocity + recency + follow boost |
| For-You Feed | ✅ | ✅ | `/api/feed/for-you` |
| Explore | ✅ | ✅ | Trending + discovery |
| Trending | ✅ | ✅ | Posts / users / hashtags (7-day window) |
| Infinite Scroll | ✅ | ✅ | IntersectionObserver pagination |
| Pull-to-Refresh | ✅ | ✅ | Touch gesture |
| Swipe to Like/Repost | ✅ | ✅ | Left = repost, right = like |
| Realtime Post Events | ✅ | ✅ | Created/updated/deleted sync via socket |
| Saves / Reposts Views | ✅ | ✅ | Filter views |
| Feed Cache | ✅ | ✅ | Per-user in-memory + CacheStorage prepend on publish |

---

## 5. Social Interactions

| Feature | Backend | Frontend | Details |
| --- | --- | --- | --- |
| Like / Unlike Post | ✅ | ✅ | Optimistic toggle; own state isolated per-device |
| Like / Unlike Comment | ✅ | ✅ | Optimistic, red heart persists after reload |
| Comment on Post | ✅ | ✅ | With validation |
| Comment Drawer | ✅ | ✅ | Load-more pagination (`nextCursor`/`hasMore`) + prefetch on hover |
| Nested Replies | ✅ | ✅ | Threaded with parent tracking |
| Edit / Delete Comment | ✅ | ✅ | Edit tracked; delete with confirm |
| Comment Emoji Reactions | ✅ | ✅ | Emoji picker, animated pill open/close, latest emoji first, clear option |
| Follow / Unfollow | ✅ | ✅ | Consistent from feed, search, profile — never flips back |
| Save to Collection | ✅ | ✅ | Bookmark + folder organization |
| Repost | ✅ | ✅ | Toggle + reposts-only view |
| Share / Forward | ✅ | ✅ | Posts, profiles, glances, comments → forward modal + copy link |
| External Share | ✅ | ✅ | Web Share API + share count |
| Read Receipts | ✅ | ✅ | Seen tracking in chats |

---

## 6. Chat / Direct Messages

| Feature | Backend | Frontend | Details |
| --- | --- | --- | --- |
| Conversation List | ✅ | ✅ | Avatar, last message, timestamp, unread dot + count badge |
| Last-Action Preview | ✅ | ✅ | "reacted ❤️ to your message", "image sent", "voice note" etc. |
| Get/Create Conversation | ✅ | ✅ | `/api/chats/conversation/:userId` |
| Send Text Message | ✅ | ✅ | Optimistic send |
| WhatsApp-Style Auto-Grow Input | ✅ | ✅ | Text wraps before the edge, box grows upward, no scrollbar |
| Voice Notes | ✅ | ✅ | Record, waveform preview, play/pause, delete — identical in community chat |
| Image Attachments | ✅ | ✅ | Downscaled before upload, media icon in circle container |
| Camera Capture | ✅ | ✅ | Take & send directly |
| GIF Picker | ✅ | ✅ | Tenor search/send |
| File Attachments | ✅ | ✅ | Generic files |
| Reply to Message | ✅ | ✅ | Inline quoted reply preview |
| Edit Message | ✅ | ✅ | 5-minute window |
| Delete / Delete for Me | ✅ | ✅ | Soft delete + per-user hide |
| Undo Send | ✅ | ✅ | Hard delete within 5 seconds |
| Forward Message | ✅ | ✅ | With "Forwarded from" banner |
| Emoji Reactions | ✅ | ✅ | Long-press menu with reaction pill — toggle system, one active emoji |
| Long-Press Message Menu | ✅ | ✅ | Reply, react, copy, pin, forward, delete |
| Three-Dot Menu (Header) | ✅ | ✅ | Search messages, **mute/unmute**, clear chat, block/unblock |
| Mute Conversation | ✅ | ✅ | Long-press list item + three-dot menu; state syncs to header |
| Pinned Messages | ✅ | ✅ | Pin/unpin from menu, pinned panel (newest first), unpin from panel |
| Pin Highlight | ✅ | ✅ | Clean identifier style on the pinned message |
| Message Search | ✅ | ✅ | Debounced, in-conversation search |
| Typing Indicator | ✅ | ✅ | Realtime via socket |
| Presence (Online Status) | ✅ | ✅ | Redis-backed, 25s heartbeat |
| Active Users Panel | ✅ | ✅ | See who's online in a conversation |
| User Search (New Chat) | ✅ | ✅ | Debounced (300ms) + stale-response guard → fast |
| Unread Badges | ✅ | ✅ | Aggregate badge in Dock + per-conversation |

---

## 7. Communities

| Feature | Backend | Frontend | Details |
| --- | --- | --- | --- |
| Create / Edit / Delete | ✅ | ✅ | With avatar upload (downscaled) + confirm dialogs |
| My Communities / Browse Tabs | ✅ | ✅ | Cache-evicted on join/leave for instant updates |
| Join / Leave | ✅ | ✅ | Leave = hidden from "My", still visible in browse |
| Long-Press List Menu | ✅ | ✅ | Mute community / leave community |
| Community Mute | ✅ | ✅ | Long-press menu |
| Member List | ✅ | ✅ | With join dates |
| Active Users | ✅ | ✅ | See who's online in the community |
| Community Messaging | ✅ | ✅ | Same feature set as personal chat |
| Community Voice Notes | ✅ | ✅ | Identical to personal chat (record, waveform, playback) |
| Reactions | ✅ | ✅ | Long-press pill + emoji picker, toggle system |
| Pinned Messages | ✅ | ✅ | Pin/unpin, pinned panel |
| Message Search | ✅ | ✅ | Debounced |
| Last-Action Preview | ✅ | ✅ | "Name reacted ❤️ to your message" on list items |
| Community Settings | ✅ | ✅ | Name, image, audio/video call toggles |
| Audio/Video Calls in Community | ✅ | ✅ | Group call floor |
| Call Toggles in Settings | ✅ | ✅ | Smooth, functional switches |
| Real-time Sync | ✅ | ✅ | All message/typing/member events via socket |

---

## 8. Audio & Video Calls

| Feature | Backend | Frontend | Details |
| --- | --- | --- | --- |
| 1-on-1 Audio Calls | ✅ | ✅ | WebRTC (LiveKit) |
| 1-on-1 Video Calls | ✅ | ✅ | WebRTC with full CallUI |
| Group Calls (Community) | ✅ | ✅ | GroupCallFloor |
| Incoming Call UI | ✅ | ✅ | Accept / decline, ICE candidate queueing |
| Call State Handling | ✅ | ✅ | Outgoing / incoming / active / missed / ended |
| Call Notifications | ✅ | ✅ | Socket-based |

---

## 9. Glances (Stories)

| Feature | Backend | Frontend | Details |
| --- | --- | --- | --- |
| Glance Feed Row | ✅ | ✅ | Story-style horizontal strip (compact on mobile) |
| Add Glance (+ container) | ✅ | ✅ | Tap → pick media → opens editor; loading spinner while uploading |
| 9:16 Glance Frame | ✅ | ✅ | Full-bleed when matching; centered + zoom/drag when not |
| Text on Glance | ✅ | ✅ | Editable, non-curved outline |
| Drawing on Glance | ✅ | ✅ | Finger drawing with color palette, scaled strokes |
| Zoom & Reposition | ✅ | ✅ | Pinch/gesture zoom, drag to position |
| Free Crop | ✅ | ✅ | Removed — glance editor uses zoom/pan (no forced crop box) |
| Audience (Public / Close Friends) | ✅ | ✅ | Default public; toggle to close-friends-only (green outline, lock icon) |
| Privacy Enforcement | ✅ | ✅ | Close-friends glances hidden from non-close-friends everywhere |
| View Glance | ✅ | ✅ | Full-screen viewer, progress bar, content never clipped |
| Like / Reply | ✅ | ✅ | White send button, reply opens a DM thread in chat list |
| Share Glance | ✅ | ✅ | Share menu (forward + copy link) |
| Reaction to Glance | ✅ | ✅ | Emoji reactions, realtime |
| Viewers List | ✅ | ✅ | Who has seen it |
| Expiry | ✅ | ✅ | Auto-expire (24h) |
| Notification for Replies | ✅ | ✅ | In-app + device: "replied to your glance" |

---

## 10. Search

| Feature | Backend | Frontend | Details |
| --- | --- | --- | --- |
| Search Users | ✅ | ✅ | Text index + regex fallback, debounced client-side |
| Search Posts | ✅ | ✅ | Full-text + hashtag |
| Search Messages | ✅ | ✅ | In-conversation + in-community, debounced |
| Search in Chat Header | ✅ | ✅ | Via three-dot menu only (icon removed) |
| Trending Hashtags | ✅ | ✅ | Top 10, 7-day window, cached |
| Result Caching | ✅ | ✅ | Fast repeat searches |

---

## 11. Notifications

| Feature | Backend | Frontend | Details |
| --- | --- | --- | --- |
| Notification Feed | ✅ | ✅ | Slim, elegant rows with top-right close icon |
| Categories | ✅ | ✅ | All / Likes / Comments / Follows / Mentions / Messages — text-only until icons overflow |
| Badge Counts | ✅ | ✅ | Live unread badge (notifications + chat) |
| Mark Read / Mark All | ✅ | ✅ | Compact buttons |
| Clear All / Delete | ✅ | ✅ | With confirm |
| Deep-Link Routing | ✅ | ✅ | Click → jumps to exact place (post, profile, chat) |
| Realtime Push | ✅ | ✅ | Socket `notification` → instant toast + badge |
| Types | ✅ | ✅ | like, comment, follow, mention, repost, message, collab, poll_vote, glimpse_reply, community_invite |
| Fit-to-Screen Layout | ✅ | ✅ | Non-scrollable on all dimensions |

---

## 12. Push Notifications (On-Device)

| Feature | Backend | Frontend | Details |
| --- | --- | --- | --- |
| VAPID Key | ✅ | ✅ | `GET /api/push/vapid-key` |
| Device Subscription | ✅ | ✅ | Subscribe/unsubscribe per device |
| Service Worker | ✅ | ✅ | PWA push handling + notification click routing |
| Permission Flow | ✅ | ✅ | Requested on relevant actions |
| Push for All Major Events | ✅ | ✅ | Messages, likes, comments, follows, mentions, reposts, glance replies |
| Notification Text | ✅ | ✅ | "replied to your glance", "reacted to your message", etc. |

---

## 13. Close Friends

| Feature | Backend | Frontend | Details |
| --- | --- | --- | --- |
| Add / Remove | ✅ | ✅ | Settings → Close Friends tab (only place) |
| List Close Friends | ✅ | ✅ | Manageable list |
| Close-Friends-Only Posts | ✅ | ✅ | Green indication; visible to CF + author only |
| Close-Friends-Only Glances | ✅ | ✅ | Green outline + lock; hard-hidden from others |
| Status Checks | ✅ | ✅ | `GET /api/close-friends/check/:userId` |

---

## 14. Settings

| Feature | Details |
| --- | --- |
| Profile (edit) | ✅ Bio field "ABOUT" style inputs; uploads crop-centered |
| Password | ✅ Change password with OTP |
| Account | ✅ Username, email, delete account (no animated icon) |
| Notifications | ✅ Per-category toggles |
| Privacy | ✅ Private account, close friends |
| Invites | ✅ InvitesTab — generate, copy, share, stats |
| Blocked Users | ✅ View + manage (unblock) from settings |
| Responsive Options | ✅ Desktop sidebar; mobile icon-only expand-on-tap (no scroll, no cut text) |
| Dark-Only Theme | ✅ No light theme; theme-switching code removed |

---

## 15. Moderation & Blocking

| Feature | Backend | Frontend | Details |
| --- | --- | --- | --- |
| Block User | ✅ | ✅ | Settings + user chat three-dot menu only (removed from profile) |
| Mutual Block Enforcement | ✅ | ✅ | Either direction = both sides blocked everywhere |
| Blocked Feed Filtering | ✅ | ✅ | Posts/comments/glances hidden from feed, trending, search |
| Blocked Chat Enforcement | ✅ | ✅ | No messages, no calls, no presence |
| Blocked Notification Filtering | ✅ | ✅ | No notifications from blocked users |
| Unblock Management | ✅ | ✅ | Settings → Blocked Users |
| Mute User | ✅ | ✅ | Hide content without blocking |
| Report Content | ✅ | ✅ | Posts/comments/users with reason categories |
| Moderation Queue | ✅ | ✅ | Admin review; auto-hide at 3 flags |

---

## 16. Admin Dashboard

| Feature | Details |
| --- | --- |
| Reports Queue | ✅ Review/dismiss/action |
| User Moderation | ✅ Mute / ban / flag |
| Feature Flags | ✅ Create, update, rollout %, A/B hooks |
| System Stats | ✅ Overview metrics |
| Nav Entry | ✅ Shield icon in sidebar |

---

## 17. Gamification

| Feature | Backend | Frontend | Details |
| --- | --- | --- | --- |
| XP System | ✅ | ✅ | Earn on posts/likes/comments; level + progress |
| Streaks | ✅ | ✅ | Calendar, daily rewards, partner streaks |
| Daily Missions | ✅ | ✅ | Panel with progress; auto-progress on actions |
| Leaderboard | ✅ | ✅ | Top users by XP/engagement |
| Reputation Display | ✅ | ✅ | Badge component |

---

## 18. Translation & Link Previews

| Feature | Backend | Frontend | Details |
| --- | --- | --- | --- |
| Translate Text | ✅ | ✅ | Post/comment translation |
| Detect Language | ✅ | ✅ | |
| Link Previews | ✅ | ✅ | OG metadata → rich link card |

---

## 19. Invite System

| Feature | Details |
| --- | --- |
| Generate Invite Code | ✅ |
| My Invites + Stats | ✅ |
| Redeem Code | ✅ |
| Copy / Share Codes | ✅ Toast on copy |

---

## 20. Offline & Performance

| Feature | Backend | Frontend | Details |
| --- | --- | --- | --- |
| Offline Viewing | ✅ | ✅ | Dexie (IndexedDB) offline store — everything readable offline |
| Offline Sync Queue | ✅ | ✅ | Actions queued, flushed when online |
| Cache-First API Layer | ✅ | ✅ | CacheStorage + TTL + eviction + warm-up |
| Cache Warming | ✅ | ✅ | Idle-time preload of all tab endpoints |
| Cache Refresh Timer | ✅ | ✅ | Background refresh of active-tab data |
| Cache Eviction on Mutation | ✅ | ✅ | Join/leave/like/publish evict affected keys |
| Instant Feed Publish | ✅ | ✅ | Optimistic prepend to cached feeds |
| Background Job Offloading | ✅ | — | 10 BullMQ queues: scheduled posts, emails, notifications, account deletion, webhooks, push, gamification, media cleanup, chat-forward, maintenance — slow work never blocks request paths (inline fallback when Redis is unset) |
| Auto-Update on Deploy | — | ✅ | New service worker installs itself (5-min poll + tab-focus) and the app reloads automatically — no hard refresh, no cache clearing |
| Image Optimization | ✅ | ✅ | Cloudinary `w_<w>,q_auto,f_auto` thumbnails — avatars (96px), banners, carousels, chats; GIF-safe |
| Downscale Before Upload | ✅ | ✅ | Images compressed client-side for posts, glances, chats, avatars → fast uploads |
| Debounced Search | ✅ | ✅ | User/message search — 1 request per pause |
| Preconnect CDN | ✅ | ✅ | Cloudinary + fonts |
| Code Splitting | ✅ | ✅ | Lazy-loaded heavy components |
| Request Dedup (Views) | ✅ | ✅ | One view count per post per session |
| Toast Speed | ✅ | ✅ | Instant on action, auto-dismiss quickly |

---

## 21. UI / UX Polish

| Feature | Details |
| --- | --- |
| Black & White Glass Theme | ✅ Liquid-glass, dark-only, gold accents on selections |
| Premium Font Pairing | ✅ Cursive display font for headings + refined body font |
| Sonner Toasts | ✅ Sleek, slim, no left color bar, theme-matched |
| Three-Dot Menus | ✅ Replace raw dustbin icons app-wide (comments, chats, communities) |
| Emoji-Free UI | ✅ No emojis in app chrome |
| WhatsApp-Style Inputs | ✅ Every large-text input auto-grows, wraps, no scrollbar |
| Keyboard Shortcuts | ❌ Removed deliberately — the app is gesture-first (see `GESTURES.md`); every action has a tappable twin |
| Long-Press Menus | ✅ Chats, community list (mute/leave), messages |
| Skeleton Shimmers | ✅ Everywhere |
| Empty States | ✅ Custom |
| Avatar/Banner Cropping | ✅ Posts, avatars, banners — centered modals (posts keep natural aspect, no crop box) |
| Pinch Zoom | ✅ Fullscreen viewer |
| Responsive Settings | ✅ Sidebar on desktop; icon-expand on mobile/tablet |
| Swipe-Back Gesture | ✅ Mobile navigation history |
| Dynamic Page Titles | ✅ |
| Error Boundary | ✅ |

---

## 22. Realtime (Socket Events)

> **Reconnect backfill:** every user-scoped event is appended to a per-user Redis log (`events:sync`); on any (re)connect the client sends its last-processed timestamp and the server replays everything newer — a phone that was backgrounded catches up with no reload.

| Area | Events (client → server unless noted) |
| --- | --- |
| Connection | `connect`, `disconnect`, `reconnect_attempt`, `presence:heartbeat`, `events:sync` (backfill cursor) |
| Chat | `chat:join`, `chat:leave`, `chat:typing`, `chat:recording`; server emits `message:new`, `message:edit`, `message:delete`, `message:delete-for-me`, `message:reaction`, `message:pin`, `message:unpin`, `messages:seen`, `chat:notification` |
| Presence | server emits `user:presence` (online/offline), `community:presence`, `community:presence:sync` |
| Community | `community:join`, `community:typing`; server emits `community:message:new/edit/delete/reaction/pinned/unpinned`, `community:member-joined/left`, `community:updated`, `community:deleted`, `community:call-started`, `community:call-ended`, `community:calls-toggled`, `community:messaging-toggled`, `community:rooms-updated` |
| Posts | server emits `post:created`, `post:deleted`, `post:updated`, `post:pin`, `post:unpin`, `poll:updated`, `comment:updated`, `user:follow`, `user:unfollow`, `glimpse:created`, `glimpse:expired` |
| Calls | `call:offer`, `call:answer`, `call:ice-candidate`, `call:ice-restart`, `call:end`, `call:missed`; server relays all |
| Admin | server emits `admin:broadcast`, `admin:broadcast:clear`, `user:updated` (admin changed this account → client re-fetches) |
| Notifications | server emits `notification` |

---

## 23. Security

| Feature | Details |
| --- | --- |
| JWT httpOnly Cookie | ✅ |
| bcrypt Password Hashing | ✅ |
| Zod Validation | ✅ All input endpoints |
| Rate Limiting | ✅ Auth, OTP, comments, interactions, search |
| CSRF Protection | ✅ Double-submit cookie |
| Helmet Headers | ✅ |
| CORS Allowlist | ✅ |
| Ownership Checks | ✅ |
| Input Sanitization | ✅ |
| Media Cleanup | ✅ Cloudinary deletion on cascade |
| Blocked-User Hard Filters | ✅ Server-side on feeds, chats, search, notifications |

---

## 24. Data Models

| Model | Purpose |
| --- | --- |
| User | Profile, privacy, follow/block/mute lists, close friends |
| Post | Content, images/video, poll, collab, quote, scheduling, edit history |
| Comment | Nested, reactions, edit tracking |
| Like / Repost / Save | Polymorphic interactions |
| Conversation / Message | DMs, attachments, forwards, pins, reactions |
| Community / CommunityMessage | Groups, pins, reactions, last-action preview |
| Glimpse | 24h stories, viewers, replies |
| Notification | All types with deep-link refs |
| Follow / Block | Relationships + requests |
| Interaction | Feed-ranking signals |
| Report / ModerationItem | Reports + moderation queue |
| Collection | Saved-post folders |
| FeatureFlag | A/B config |
| DeviceSubscription | Push subscriptions |
| DailyReward / UserMission / UserStreak / XP | Gamification |
| UserInvite | Invite codes |
| Waitlist / EmailPreference / PerkTombstone | Signup gating + perks |
| ExternalPost | Imported open-web content (Web tab) |
| AdminAuditLog | Admin actions |
| ApiKey / Webhook | Developer integrations |
| Bot / BotFarm / Broadcast | Simulated users + bot activity |

---

## Quick Stats (August 16, 2026)

| Metric | Count |
| --- | --- |
| Backend route modules mounted | 38 |
| Backend models | 35 |
| Frontend components | 80+ |
| Server tests | **245 passing / 26 suites** (`npm test`) |
| Client tests | **61 passing / 14 files** (`npm test`) |
| BullMQ queues | 10 |
| TypeScript Errors | 0 |

_Last updated: August 16, 2026_
