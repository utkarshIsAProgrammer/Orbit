# ORBIT — Landing Page

A standalone landing page for the Orbit social app — designed in **the
app's own visual language** (Cormorant Garamond + Manrope + Great Vibes,
zinc-black with a gold accent, warm and social), with the premium motion
patterns of nudot.com.tw (underscore labels, counter loader, service rows,
scroll marquee, film grain, smooth scroll).
Built with **React 19 + Tailwind CSS v4 + Three.js (react-three-fiber) +
GSAP (ScrollTrigger) + Lenis**.

## Design language (the app's own)

- **Typography**: the exact fonts the Orbit app uses — **Cormorant
  Garamond** for display headlines & labels, **Manrope** for body text, and
  **Great Vibes** for the Orbit wordmark (the app's logo font).
- **Labels**: underscore style — `24H_MOMENTS`, `0_ADS`,
  `( launch_day_is_open )`, `orbit/index.html`.
- **Color**: the app's `#09090b` zinc-black with the app's **gold accent**
  (`#d4af37`) — warm, peaceful, social. Gold selection, gold focus rings,
  gold light in the background, gold door handles.
- **Effects**: film-grain noise, warm golden light-field background (GLSL
  shader), custom cursor with contextual labels, Lenis smooth scroll
  synced to ScrollTrigger, masked word-by-word and line-by-line reveals,
  scrub parallax layers, a scroll-velocity marquee, a `01 / 07` chapter
  counter, and storytelling scroll-out hero layers.

## The experience

1. **The Hero — instantly.** No preloader, no counter — the headline words
   rise in the moment the page loads: giant mixed filled/outline display
   type in Cormorant (`YOUR INNER CIRCLE / ZERO NOISE`), a parenthesized
   category grid, an underscore stats row (`24H_GLANCES · 0_ADS · …`), and
   the **Join the waitlist** call to action. The headline **leans toward
   your cursor**, and the whole block fades + drifts away word-by-word in
   layers as you scroll down.
4. **The Story** — three chapters (Share / Connect / Belong) over the light
   field, then **service rows** in the nudot `WEBDESIGN ( 網頁設計 )` style:
   `GLANCES ( 24-hour moments )`, `LIVE CHAT ( real-time & typing )` … each
   row expands on hover.
5. **Why / Love / Steps** — the old-way-vs-orbit-way contrast, love notes,
   and a three-step how-it-works, all in the same label system.
6. **The Devices** — a pinned horizontal-scroll gallery (desktop) with four
   live phone frames (Feed / Chat / Glances / Profile) that come alive on
   hover.
7. **The Lab** — a sticky, scroll-scrubbed **living community in pure SVG
   + GSAP** (no 3D): a constellation of warm avatar tiles on a dashed
   conversation-ring around a glowing core. Click to **invite a friend** —
   the ring makes room, a pulse travels to them, and they grow in (up to
   six). It turns with your scroll, leans with your mouse, and live
   counters tick up.
8. **The Waitlist** (mid-page, after the Love notes) — a live, animated
   signup form (email input, magnetic reserve button, gold success burst
   with your seat number, and a live "already in line" counter fed by the
   server). Posts to the backend's separate `Waitlist` collection.
9. **The Close** — full-bleed scroll-linked marquee of giant words
   (`FEED · CHAT · GLANCES · …`), a `( launch_day_is_open )` CTA, and a
   nudot-style footer (`ORBIT / creative_social / est._2026`).

## Motion (always-on by default)

This page is an animation showcase — it runs its full choreography
**regardless of the OS "reduced motion" setting** (which would otherwise
freeze every scroll/reveal/parallax animation and make the page look
static). If you want to respect visitors' OS preference instead, build
with:

```bash
VITE_MOTION_MODE=gentle npm run build
```

In gentle mode Lenis is skipped and all GSAP
choreography falls back to the accessible minimal state.

## Real screenshots (drop-in)

Add PNGs to `public/screenshots/` (`feed-1.png`, `feed-2.png`,
`profile-1..3.png`, `banner.png`, `screen-*.png`, `glance-*.png`,
`avatar-*.png`, `community-1.png`) — the devices render them automatically.
See `public/screenshots/README.md`. (The old video showreel panel was
replaced by the interactive 3D Lab.)

## Run

```bash
cd landingpage
npm install
npm run dev        # http://localhost:5174
```

Production:

```bash
npm run build && npm run preview
```

### Point the CTAs at your app

The "Enter the App" buttons default to `http://localhost:5173`. Override with:

```bash
VITE_APP_URL=https://your-orbit-app.example.com npm run build
```

### Waitlist form → your API

The waitlist form posts to the Orbit backend's **separate `Waitlist`
collection** (`POST /api/waitlist/join`, `GET /api/waitlist/count`, admin
`GET /api/waitlist`). It defaults to the local server
(`http://localhost:5002/api`); point it at your deployed backend with:

```bash
VITE_WAITLIST_API_URL=https://your-orbit-backend.example.com/api npm run build
```

On the server, add `LANDING_PAGE_URL` to your `.env` so CORS/CSRF trust the
landing page's production origin.

## Structure

```
src/
├── world/            # Three.js layer (single fixed canvas)
│   ├── WorldCanvas.tsx   # Canvas + lights
│   ├── Aurora.tsx        # fullscreen warm-gold light-field shader
│   └── CameraRig.tsx     # calm damped camera + gentle mouse parallax
├── components/       # DOM layer (nav, hero, service rows, devices, …)
│                     #   incl. CursorGlow (gold cursor effect)
│                     #   incl. Lab.tsx (living 2D SVG community)
│                     #   incl. Waitlist.tsx (animated signup form)
├── hooks/            # useReducedMotion, useTilt/useMagnetic, useIsDesktop
├── store.ts          # mutable world state bridging GSAP ⇄ WebGL
├── config.ts         # APP_URL, WAITLIST_API_URL + nav links
└── public/
    ├── screenshots/  # real app captures — drop PNGs here (auto-used)
    └── media/        # extra assets (optional)
```

## Design notes

- Single WebGL context + `dpr [1, 1.6]`, capped on mobile.
- Lenis always on in full-motion mode; skipped only in gentle mode.
- The only WebGL is the fixed background light-field; the Lab is pure
  SVG/GSAP (no asset downloads) — fast first paint.
- Mouse interactivity: magnetic buttons, 3D-tilt devices, a cursor glow
  ring that labels interactive elements (`LIVE`, `view`).
