# Real screenshots — drop them here 🖼️

The showcase devices render **real screenshots of your app** automatically when
you add PNG files with these exact names. Until then, beautiful monochrome
placeholders are shown instead, so the page looks complete either way.

## Whole-screen capture mode 📱

Drop a **full screenshot of the actual app screen** in and the entire phone
swaps from the animated mockup to your real screen (tilt/float still work):

| File | Device |
| --- | --- |
| `screen-feed.png` | Live Feed phone → your real feed screen |
| `screen-chat.png` | Direct Chat phone → your real chat screen |
| `screen-glance.png` | Glances phone → your real glance/story screen |
| `screen-profile.png` | Profile phone → your real profile screen |

Capture: Chrome DevTools device toolbar at **390×844**, navigate to the
screen, `⋯ → Capture screenshot`. The phone frame is roughly 9:19, so a
portrait capture fills it edge-to-edge (object-cover).

## How to capture

1. Run your Orbit app and open it in Chrome.
2. DevTools → device toolbar → pick a phone (e.g. 390×844).
3. Navigate to the screen, then **DevTools → ⋯ → Capture screenshot** (or
   full-page capture for feeds).
4. Save the PNG into this folder with the names below.

## File names (each is optional)

| File | Used in |
| --- | --- |
| `feed-1.png` | first post image on the Live Feed device |
| `feed-2.png` | second post image on the Live Feed device |
| `profile-1.png` `profile-2.png` `profile-3.png` | Profile device post tiles |
| `banner.png` | Profile device banner |
| `glance-1.png` `glance-2.png` `glance-3.png` | Glances device — one background per story slide (9:16 portraits work best) |
| `avatar-aria.png` `avatar-kai.png` `avatar-nova.png` `avatar-leo.png` | avatars anywhere that user appears (feed, chat, glance, profile) **and the Lab's "YOUR PEOPLE" circle** — add `avatar-5.png`/`avatar-6.png` for the two friends who join on invite |
| `avatar-orbit.png` | the showreel fallback card avatar |
| `community-1.png` | Direct Chat device — a cover backdrop in the chat header |

## Sizing tips

- Post images (`feed-*`, `profile-*`, `banner`) ≤ 400px wide.
- Glance backgrounds: **9:16 portrait** (e.g. 360×640) — they fill the whole
  story screen.
- Avatars: square (e.g. 160×160) — they fill the round avatar masks.
- Community cover: wide strip (e.g. 640×240).
- All render as small previews inside the phones — keep file sizes modest.

> Tip: the devices come alive on hover, so real imagery of your actual feed,
> glances, chat and community makes the showcase feel like the real app.
