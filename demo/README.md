# The 30-second demo

`docs/demo.mp4` is the real app, recorded frame by frame. Nothing in it is mocked up or generated.

1. `capture.js` drives Canary in headless Chromium (Playwright) on a virtual clock (`clock.js`).
   Each frame, `performance.now`, `Date.now`, `requestAnimationFrame` and CSS animations advance
   exactly 1/30 s, so the globe, weather loop and alert feed move smoothly however slowly the
   software renderer draws. Frames are saved at 2560×1440 into `frames/<shot>/`.
2. `endcard.js` renders `endcard.html` to `endcard.png`.
3. `compose.py` crops each shot with eased camera moves (zooms stay sharp because the source is
   larger than 1080p), draws the captions in IBM Plex, and adds cuts, crossfades, the hook and the
   end card. It writes `out/0000.jpg` onwards. The fonts go in `fonts/`, as WOFF files from the
   `@ibm/plex-sans` and `@ibm/plex-mono` npm packages.
4. `audio.py` synthesises the ambient bed (`bed.wav`).
5. Encode:

```bash
ffmpeg -framerate 30 -i out/%04d.jpg -i bed.wav -c:v libx264 -crf 19 -pix_fmt yuv420p -c:a aac -b:a 160k -shortest -movflags +faststart canary-demo.mp4
```

Run the server first (`uvicorn canary.api:app --port 8000`), with the weather fields loaded.
