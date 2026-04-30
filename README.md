# Sun · light planner (V2)

Mobile-first web app for planning sun alignment, light, and reflections on an interactive map.

## What's in V2

- **Interactive map** (MapLibre GL + OpenFreeMap dark style — no API key required)
- **Continuous sun path** projected as an arc on the map, color-graded by time of day
- **Time scrubber** with play button — drag to scrub through the day; sun marker, ray, and elevation chart update at 60fps
- **Elevation chart** with twilight bands (civil/nautical/astronomical) and golden-hour shading
- **Reflection mode** — mirrored sun azimuth in cyan, for water-reflection planning
- **"Next alignment" insight** — long-press the map to drop a target; the app brute-forces the next 365 days for a sunrise/sunset that aligns within ±1.5°
- **Geocoding search** via Photon (free, no key)
- **Shareable URLs** — every state change updates the location hash; copy-link via the share button
- **PWA** — installable, offline-shell cached, dark theme
- **Compass mode** — phone orientation rotates the map (iOS 13+ permission flow handled)

## Architecture

- **Client-first.** No backend.
- **Pure modules.** Solar math (`js/solar.js`) is pure functions, no DOM.
- **Tiny pub/sub state** (`js/state.js` — ~80 lines). No framework.
- **Two-tier redraw:** day-level recompute when date or location changes; per-frame updates for scrubber motion.
- **No build step.** ES modules served as-is.

## File layout

```
index.html              # single page
manifest.webmanifest    # PWA manifest
sw.js                   # service worker (app-shell cache only)
css/style.css           # design system
js/
  app.js                # wiring
  state.js              # pub/sub store
  util.js               # geo helpers (destination, bearing, etc.)
  solar.js              # SunCalc wrapper (reused from V1)
  reflection.js         # mirror-vector math
  alignment.js          # next-alignment search
  share.js              # URL hash <-> state
  map.js                # MapLibre setup
  layers/
    observer.js         # observer pin
    sun-path.js         # arc + sunrise/sunset rays + live ray + sun marker
    reflection.js       # mirror layers
    target.js           # alignment target pin + dashed line
  ui/
    scrubber.js         # time slider + play button + date picker
    chart.js            # elevation curve SVG
    search.js           # geocoding input
    sensor.js           # device orientation (compass)
vendor/suncalc.js       # solar position library
```

## Deploy

```bash
sudo rsync -a --delete /home/blair/sun-v2/ /var/www/sun/
sudo chown -R caddy:caddy /var/www/sun
```

## What's deferred

- **Horizon-aware visible sunrise/sunset** (terrain sampling). V1 had a basic dip approximation via Open-Elevation API. V2 omits it pending a tile-based terrain RGB pipeline.
- **Building reflections.** The reflection mode assumes a horizontal water surface. Glass/building reflections need surface-normal vectors that we don't have.
- **AR camera overlay.** Future V3.
