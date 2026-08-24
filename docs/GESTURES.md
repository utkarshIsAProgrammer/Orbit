# Orbit — Touch Gestures & Interactions Guide

> The app is **gesture-first**. We deliberately removed keyboard shortcuts
> (previously `g+h`, `g+p`, `?`, etc.) — on phones and tablets there is no
> keyboard, and on desktop a gesture-first feel keeps the product consistent
> across every device size.

All gestures are tuned to feel natural on **small phones (320–430 px wide)**
through **large desktop screens**. They never require precise targeting and
can all be performed one-handed.

---

## 1. Double-tap — Like a post ❤️

| | |
|---|---|
| **Where** | Home feed, Explore feed, any post card |
| **Action** | Double-tap anywhere on the card (not on buttons) |
| **Effect** | Loves the post + a heart burst animation pops in the middle + haptic tick on Android |
| **Feels like** | Instagram / TikTok |

- Tapping a button (like icon, comment, avatar, ⋯ menu) never triggers the
  gesture — only "empty" card space does.
- A second double-tap just loves again (already-loved posts stay loved).

**Files:** `client/src/components/Feed.tsx` (`handleCardTouchEnd`, `heartBurst`)

---

## 2. Double-tap — Quick-react ❤️ on messages 💬

| | |
|---|---|
| **Where** | Personal chats, community chats (any message bubble with text) |
| **Action** | Double-tap the bubble |
| **Effect** | Instantly reacts with ❤️ (or removes it) + haptic tick |
| **Feels like** | WhatsApp |

- Works for both your messages and others'.
- **Text-only bubbles** — media bubbles keep tap = open fullscreen viewer.
- Tapping a link, button, or avatar inside a bubble never triggers it.
- Long-press for the full emoji picker still works as before.

**Files:** `client/src/components/MessageBubble.tsx` (`handleTouchEnd`)

---

## 3. Swipe left/right — Jump between conversations 🗨️

| | |
|---|---|
| **Where** | Any open personal chat (swipe on the message area) |
| **Action** | Swipe left → next conversation · swipe right → previous conversation |
| **Effect** | Switches chat with a haptic pulse; messages load instantly |
| **Feels like** | WhatsApp / Telegram |

- Only fires on strong horizontal swipes (60 px+) — normal vertical scrolling
  is untouched.
- The **left screen edge** is reserved for the swipe-back gesture, so
  right-swipes starting at the very edge still go back in navigation.
- Disabled when only one conversation exists.

**Files:** `client/src/components/Chat.tsx` (`handleConvTouch*`, messages container)

---

## 4. Swipe right — Reply to a message ↩️

| | |
|---|---|
| **Where** | Chat / community message bubbles |
| **Action** | Swipe right on a message (left-swipe for your own outgoing messages) |
| **Effect** | Opens the reply composer with that message quoted |
| **Feels like** | WhatsApp |

**Files:** `client/src/components/MessageBubble.tsx` (swipe bar + badge)

---

## 5. Swipe right — Like · Swipe left — Repost 📲

| | |
|---|---|
| **Where** | Feed post cards |
| **Action** | Horizontal swipe on the card (right = like, left = repost) |
| **Effect** | Instant like / repost with colored edge indicator + label |

**Files:** `client/src/components/Feed.tsx` (`handleCardTouch*`)

---

## 6. Pull down — Refresh the feed 🔄

| | |
|---|---|
| **Where** | Home feed (top of the scroll) |
| **Action** | Pull down past the springy indicator |
| **Effect** | Refreshes posts with a spinner |

**Files:** `client/src/components/Feed.tsx` (`pullDistance` / `isRefreshing`)

---

## 7. Swipe from the left edge — Go back ⬅️

| | |
|---|---|
| **Where** | Anywhere in the app |
| **Action** | Swipe right starting at the left screen edge |
| **Effect** | Dismisses the current view / goes back (same as the back button) |
| **Feels like** | iOS |

**Files:** `client/src/hooks/useSwipeBack.ts`

---

## 8. Long-press — Context menu ⋯

| | |
|---|---|
| **Where** | Chat & community messages, posts, notifications |
| **Action** | Hold ~500 ms on the item |
| **Effect** | Opens the full action menu (react, reply, copy, pin, delete, report…) |

---

## 9. Pinch — Zoom into media 🔍

| | |
|---|---|
| **Where** | Any image / video preview |
| **Action** | Two-finger pinch to zoom, pan while zoomed |
| **Effect** | Fullscreen media zoom (same as Instagram) |

**Files:** `client/src/components/PinchZoom.tsx`

---

## 10. Stories — Swipe & tap navigation 👀

| | |
|---|---|
| **Where** | Glances / stories viewer |
| **Action** | Tap right side = next, tap left = previous · swipe up = close · drag to scrub |
| **Feels like** | Instagram Stories |

**Files:** `client/src/components/GlanceViewer.tsx`

---

## 11. Media gallery — Swipe between images 🖼️

| | |
|---|---|
| **Where** | Multi-image posts |
| **Action** | Swipe left/right to move between photos |
| **Effect** | Carousel paging with drag-follow |

**Files:** `client/src/components/ImageCarousel.tsx`

---

## Haptic feedback (Android only)

Small vibration pulses reinforce the gestures above:

| Pulse | Trigger |
|---|---|
| `hapticLight` (~10 ms) | double-tap like, double-tap react, message send |
| `hapticSuccess` (~25 ms) | conversation swipe, gesture threshold reached |
| `hapticError` (double pulse) | rejected / failed actions |

- iOS Safari & desktop simply no-op (no vibration API) — nothing breaks.
- Utility: `client/src/utils/haptics.ts`

---

## Gesture rules of thumb (kept deliberately)

1. **No gesture fights a system gesture** — the left-edge belongs to swipe-back.
2. **Vertical scroll is never hijacked** — horizontal gestures require the
   horizontal movement to dominate (1.5×) before they activate.
3. **Interactive elements win** — buttons, links and avatars never trigger
   card/message gestures.
4. **Every gesture has a visible tappable twin** — double-tap likes have the
   ♥ button, quick-react has the long-press emoji picker, etc. Nothing is
   gesture-only, so every action stays discoverable.
