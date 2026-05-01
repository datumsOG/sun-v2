# Sun · light planner (V2)

Mobile-first PWA for planning sun and moon alignment, shadows, and light on an interactive map. No API keys. No build step. No framework.

## Features

### Core (original V2)
- **Interactive map** — MapLibre GL + OpenFreeMap dark style
- **Continuous sun path** — arc from sunrise to sunset, color-graded by time of day
- **Time scrubber** — drag to scrub the full day; sun ray, marker, and elevation chart update at 60fps
- **Elevation chart** — civil/nautical/astronomical twilight bands, golden-hour shading
- **Reflection mode** — draw a building face on the map, see incident + reflected rays in cyan
- **Next-alignment finder** — long-press to drop a target; brute-forces 365 days for a sunrise/sunset within ±1.5°
- **Geocoding search** — Photon (free, no key)
- **Shareable URLs** — state synced to location hash
- **Compass mode** — device orientation rotates map (iOS 13+ permission handled)
- **PWA** — installable, offline shell cache, dark theme

### New in this update

#### 🌑 Shadow + Obstruction Mode (`shadow toggle`)
- Projects a **shadow ray** from the observer in the opposite sun direction
- **Terrain-aware:** samples AWS Open Terrain Tiles (Terrarium RGB, no key) along the ray; finds the point where terrain blocks the sun
- **Building obstruction:** queries already-rendered OpenStreetMap building polygons from the map; shortens shadow if a building blocks the ray first
- Flat-ground fallback renders instantly; terrain refinement updates async
- **2.5D tilt:** map automatically pitches to 45° when shadow mode is active, giving depth for reading shadows

#### 🌙 Moon Mode
- New `Moon` mode button in the toolbar
- Uses SunCalc moon position (azimuth + altitude) for all visualizations
- Moon phase badge shows phase icon + illumination % (e.g. "🌔 78% lit")
- AR arrow view switches to silver material in moon mode
- Moon phase labels in AR HUD stats

#### 📷 AR Screenshot Capture
- `Capture` button in the AR HUD (visible after sensors enabled)
- Overlays date/time, lat/lon, azimuth/elevation, and mode as text
- Exports as PNG and triggers browser download

#### 📡 AR Stability Fixes
- Heading smoothing reduced from 0.20 → 0.12 in compass sensor
- Heading smoothing reduced from 0.25 → 0.15 in AR arrow view
- **Spike rejection:** orientation jumps > 40–45° are discarded instead of applied
- **Manual calibration:** `Align` button in AR HUD stores a heading correction offset — tap when the arrow visually aligns with the actual sun

#### ⏰ Reminders
- **Save reminder** button (clock icon in toolbar) — stores current location + time + mode to `localStorage`
- On app open, checks for reminders due within 30 minutes
- Fires `Notification` API if permitted; falls back to a toast message

#### 🔧 Service Worker Fix
- Cache version bumped to `v11` — forces stale shell eviction on next load
- New files added to the precache manifest

---

## Architecture

```
Client only · No backend · No build step · ES modules served as-is
```

**State flow:**
```
user gesture → store.set() → subscribeAll → throttleRaf → redraw()
                                                           ├── setObserver()
                                                           ├── updateSunNow()  ← accepts moon posOverride
                                                           ├── updateShadow()  ← terrain + buildings async
                                                           └── updateArrowView()
```

**Two-tier redraw:**
1. **Day-level** (on date/location change) — sun path arc, chart, scrubber ticks
2. **Per-frame** (on every scrubber move) — live ray, shadow, reflection, chart now-line

**Shadow pipeline:**
```
updateShadow()
  ├── findBuildingObstruction()   → sync, uses queryRenderedFeatures
  ├── flat fallback               → instant, renders immediately
  └── computeTerrainShadow()      → async, sampleElevationAlongLine() + getElevation()
                                       └── AWS Terrain Tiles (Terrarium RGB, no key, CORS ok)
```

---

## File layout

```
index.html                  # single page
manifest.webmanifest        # PWA manifest
sw.js                       # service worker (app-shell cache, v11)
css/style.css               # design system + tokens
js/
  app.js                    # main wiring + redraw loop
  state.js                  # tiny pub/sub store
  util.js                   # geo math (destination, bearing, etc.)
  solar.js                  # SunCalc wrapper — sun + moon position
  terrain.js                # AWS terrain tile fetch + elevation sampling  ← NEW
  buildings.js              # OSM building obstruction test                ← NEW
  reminders.js              # localStorage-backed shot reminders           ← NEW
  reflection.js             # mirror-vector math
  alignment.js              # next-alignment brute-force search
  share.js                  # URL hash ↔ state sync
  map.js                    # MapLibre setup (pitch: 0–70°, dragRotate on)
  layers/
    observer.js             # observer pin
    sun-path.js             # arc + rays + sun marker (accepts moon posOverride)
    reflection.js           # incident + reflected ray layers
    target.js               # alignment target pin + dashed line
    shadow.js               # shadow ray + long sun ray layers              ← NEW
  ui/
    scrubber.js             # time slider + date picker
    chart.js                # elevation curve SVG
    search.js               # geocoding
    sensor.js               # compass — device orientation + spike rejection
    arrow-view.js           # Three.js 3D arrow + AR camera + capture + calibration
vendor/
  suncalc.js                # solar/lunar position library
```

---

## State shape

```js
{
  observer:       { lat, lon },
  datetime:       Date,
  mode:           'sun' | 'moon' | 'reflection' | 'arrow',
  shadowEnabled:  boolean,       // shadow overlay on/off (orthogonal to mode)
  compassEnabled: boolean,
  compassHeading: number | null,
  target:         { lat, lon } | null,
}
```

---

## Deploy

```bash
sudo rsync -a --delete /home/blair/sun-v2/ /var/www/sun/
sudo chown -R caddy:caddy /var/www/sun
```

---

## Data sources (all free, no keys)

| Source | Used for |
|--------|---------|
| [OpenFreeMap](https://openfreemap.org) | Base map tiles |
| [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) | Elevation (Terrarium RGB) |
| [OpenStreetMap](https://openstreetmap.org) | Building footprints (via map vector tiles) |
| [Photon / Komoot](https://photon.komoot.io) | Geocoding search |
| [SunCalc](https://github.com/mourner/suncalc) | Sun + moon position math |
