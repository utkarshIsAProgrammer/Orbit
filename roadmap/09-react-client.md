# 09 — The React Client: App.tsx, Hooks, Components, Gestures, Splitting

> The client is a React 19 + TypeScript + Vite + Tailwind v4 SPA with a huge
> central `App.tsx`, a strong component library, a gesture-first UI, and
> deliberate code splitting. This file explains the architecture so a 3500-line
> file stops being scary.

---

## 1. The component tree (mental model)

```
main.tsx (theme boot + SW registration + error self-heal)
└─ App.tsx — session, socket, tabs, badges, layout
   ├─ Auth (logged out)
   ├─ Landing (public mode)
   └─ The app shell
      ├─ LeftSidebar / Dock (navigation + badges)
      ├─ Active tab component (lazy-loaded):
      │   Feed / Explore / Notifications / Chat / Communities / Profile / Settings / Admin…
      ├─ Modals & overlays: PostModal, CallUI, GroupCallFloor, GlanceViewer…
      └─ Toasts (sonner) + BroadcastBanner
```

## 2. App.tsx — the heart (read it in passes, not linearly)

Everything important lives here. The major effects, in order:

1. **Theme boot** — applied in `main.tsx` *before* React mounts (no flash).
2. **Session check** (`/api/auth/me`, cache-first) → `setUser`; then a
   **background reconcile** re-fetches the authoritative user (admin/verify/
   mute changes made elsewhere land on next open).
3. **Cache warming** — `warmCache` all tabs' endpoints + `prefetchLikelyNextTabs`
   (lazy chunks) during idle time once a session exists.
4. **Socket lifecycle** — connect with auth, `hasConnectedOnceRef` tracks
   first connect vs reconnect; `lastRealtimeTsRef` (localStorage
   `orbit:rt-since`) drives `events:sync`; **`socket.onAny`** funnels every
   event into `applyRealtimeEvent` + updates the cursor. On reconnect: emit
   `events:sync`, refetch conversations/badges, dispatch `forceFeedRefresh` +
   `orbit:communities-refresh`.
5. **Per-event handlers** — `message:new` (upsert Dexie + badge),
   `notification` (badge + toast + chime), `post:created/updated/deleted`,
   `user:updated` (refetch me), `admin:broadcast`, call events, etc.
6. **Tab navigation** — `tab` state + `React.lazy` per tab; badge counts
   (conversations, notifications) fetched and incremented from socket events.
7. **Auth events** — `auth:expired` → clear caches + go to Auth.

**Learn the pattern:** *state lives in App, socket events mutate that state,
and every mutation also writes through to Dexie + evicts caches* — one
codebase-wide consistency rule.

## 3. The fetch layer (already covered in 06, recap in one line)

Components **never call `fetch`**. They call `apiFetch(url, { bypassCache })`
from `utils/api.ts`, which handles CSRF, dedup, cache-first reads, offline
queueing, and eviction. `bypassCache: true` = hard refresh (pull-to-refresh,
tab switches).

## 4. Hooks — the reusable behaviors

| Hook | Teaches |
|---|---|
| `useAutoGrow` | textarea auto-grow (WhatsApp-style) |
| `usePostViewTracking` | 3s-in-view counting with a module-scope dedup set |
| `useOfflineSync` | flush the sync queue on `online` event |
| `useMentionAutocomplete` | `@mention` suggestion engine |
| `useCacheRefresh` | subscribe to the SWR refresh event → re-render fresh data |
| `useSwipeBack` | iOS-style edge-swipe navigation history |
| `useKeyboardOpen` | mobile keyboard visibility for input layouts |
| `useLenisScroll` / `useReveal` | smooth scrolling + scroll-reveal animations |

## 5. Components worth studying deeply

- **`Feed.tsx`** — infinite scroll, pull-to-refresh, optimistic like/repost,
  gesture handling (`handleCardTouchEnd`), quality/velocity rendering.
- **`Chat.tsx`** — the most complex feature component: conversation list,
  message sending (optimistic + offline queue), voice notes, media, gestures,
  presence, search, pinned messages, missed-call badges.
- **`MessageBubble.tsx`** — double-tap react, swipe-to-reply, long-press menu,
  links/previews, seen ticks.
- **`PostModal.tsx`** — compose: images (downscaled client-side), video, poll,
  scheduling, drafts, mentions.
- **`CallUI.tsx` / `GroupCallFloor.tsx`** — LiveKit WebRTC UI, fullscreen
  toggle, draggable PiP.
- **`GlanceViewer.tsx` / `GlanceEditor.tsx`** — stories viewer + editor
  (9:16 frame, drawing, zoom/pan).
- **`Profile.tsx`** — tabs (posts/saved/reposts/drafts/collections), pins,
  edit modal, XP display.
- **`Auth.tsx`** — login/signup with live field validation, Google OAuth
  button, cold-start retry handling.
- **`AdminDashboard.tsx`** — stats, reports queue, user mute/ban/verify, flags.

Shared UI primitives: `GlassCard`, `Skeleton`, `EmptyState`, `ConfirmDialog`,
`UserAvatar`, `TypingIndicator`, `CharCounter`, `SplitText`, `ShinyText`,
`ErrorBoundary` (top-level error boundary component).

## 6. Gestures — the app is gesture-first

See `docs/GESTURES.md` for the full catalog. The implementation patterns:

- **Double-tap like** — `Feed.tsx` `handleCardTouchEnd` with a 300ms tap
  window + heart-burst animation; haptics on Android (`utils/haptics.ts`).
- **Swipe gestures** — track pointer/touch delta; require horizontal movement
  to dominate vertical (1.5×) so scrolling isn't hijacked; the left screen
  edge is reserved for swipe-back (`useSwipeBack`).
- **Long-press menus** — 500ms hold → context menu.
- **Pinch zoom** — `PinchZoom.tsx` (two-pointer math).
- Every gesture has a visible tappable twin (rule: nothing is gesture-only).

## 7. Code splitting & the vendor-chunk story

`vite.config.ts` `manualChunks`:

```js
vendor: ['react', 'react-dom', 'react-dom/client'],
socket: ['socket.io-client'],
gsap: ['gsap'],
dexie: ['dexie'],                  // offline DB cached once
chat: ['./src/components/Chat.tsx'],
feed: ['./src/components/Feed.tsx'],
profile: ['./src/components/Profile.tsx'],
leftnav: ['./src/components/LeftSidebar.tsx'],
```

**The lesson embedded in the comments:** DON'T force-split UI libraries
(lucide-react, react-easy-crop, motion). A forced split pulls only the *entry*
module into the chunk while transitive deps land elsewhere, creating
**inter-chunk import cycles** that break namespace imports at runtime
("can't access property 'forwardRef' of undefined" — three crashes documented
in the config). Bundle heavy libs tree-shaken into consumer chunks instead.

Tabs are `React.lazy` + fetched on hover/tap (`utils/tabChunks.ts`
`prefetchTabChunk`), plus idle-time `prefetchLikelyNextTabs` for the
most-likely next screens.

## 8. Styling — Tailwind v4 + a design system

- `index.css` — Tailwind v4 (`@tailwindcss/vite`), CSS variables for the
  theme (dark-only: `data-theme` on `<html>`: aurora/ember/xlite), liquid-glass
  effects.
- Design language: dark glass + gold accents, cursive display font (Cormorant/
  Great Vibes) + Manrope body, skeleton shimmers, custom empty states.

## 9. Client-side state management — there is none (deliberately)

No Redux/Zustand. State is **React state + context + the offline stores**:
- UI state: `useState`/`useRef` in App/components.
- Server data: the cache layers (CacheStorage/Dexie) + SWR refresh events —
  components read through `apiFetch`, which returns cached data instantly.
- Realtime: socket events mutate state AND the stores.
- Cross-component: custom events (`showToast`, `forceFeedRefresh`,
  `orbit:communities-refresh`, `auth:expired`).

---

## Exercises

1. Open `App.tsx` and find the socket `onAny` handler — explain what it does
   with every event and why.
2. Explain the `manualChunks` comment: why is splitting `lucide-react` into
   its own chunk dangerous?
3. Trace the double-tap-to-like gesture from touch to like-count update.
4. Why is there no Redux? Describe the three sources of truth and how a
   component gets fresh data after a background refresh.
