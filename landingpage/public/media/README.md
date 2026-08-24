# Showreel video — drop it here 🎬

The **showreel panel** (bottom of the devices section) plays a real looping
video when you add `showreel.mp4` to this folder. Until then, an animated
fallback scene plays so the layout is never empty.

The panel is a **16:9, `object-cover`, autoplay-muted-loop** container
(max ~1024px wide), so record a **16:9 landscape screencast** of the app's
desktop layout (the dark UI blends perfectly with the page).

## Capture (OBS Studio)

1. Run the app, log in, resize the browser to **1280×720**.
2. OBS → Settings → Video: canvas **1920×1080**, output **1280×720**, FPS **30**.
3. OBS → Settings → Output → Recording: format **MP4**, hardware encoder
   (NVENC/AMF/QuickSync) or x264, rate control **CQP/CRF 18–20**, preset
   Quality, audio **None**.
4. Window Capture → the browser. Record **15–25s** of the app in action.

## Content that loops well

Feed slow-scroll → open a Glance → chat typing/reply → voice-note
waveform → profile tabs → back to the feed top (end ≈ start = seamless loop).

## Optimize with ffmpeg (recommended)

```bash
ffmpeg -i showreel_raw.mkv -t 20 \
  -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black" \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart -an \
  landingpage/public/media/showreel.mp4
```

Result: ~720p H.264 MP4, ~5–8 Mbps, 10–20 MB, fast-start, muted.

## Drop-in

```bash
cp showreel.mp4 landingpage/public/media/showreel.mp4
```

- Formats: `.mp4` (H.264) is safest — WebM works too.
- Dev: reload and it plays immediately (no rebuild). Production: `npm run build`.
