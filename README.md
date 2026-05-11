# Sun · Light Planner

Mobile-first PWA for planning sun and moon alignment, shadows, and light on an interactive map.  
No API keys. No build step. No framework. Served as static files.

Live at: `https://sun-blair.duckdns.org`

---

## What it does

You place a pin on a map, scrub through the time of day, and watch:

- The **sun or moon arc** sweep across the sky (3D perspective, scales with zoom)
- The **shadow** of a caster object fall in real time — including on an elevated floor surface
- **Reflection rays** bounce off a building face you draw on the map
- The **AR camera view** overlays the sun/moon disk and shadow geometry on the live camera feed

The main use case is light planning for photography — knowing exactly when and where sunlight hits a subject, when golden hour falls on a specific wall, where a building's shadow will land at a given time, or whether the moon will be visible from a rooftop.

---

## Features

### Map view

| Feature | Notes |
|---------|-------|
| Sun/moon arc | Full-day arc from rise to set, 60 dot markers, scales with arc-radius slider |
| Drop line | Vertical line from each arc dot to its ground anchor |
| Time scrubber | Drag across the day; moon mode syncs to the visible moon window |
| Date picker | Native date picker button next to the time display |
| Altitude readout | Live `↑7.3°` / `↓2.1°` vertical angle shown in the time row |
| Arc radius slider | Right-edge vertical slider, log curve 20 m → 50 km |
| Map tilt slider | Right-edge vertical slider, 0–75° pitch |
| Reflection mode | Hold and drag to draw a building face; incident + reflected rays shown |
| Compass mode | Device orientation drives bearing + pitch; map pan still free; centers on observer on activate |
| Invert map | Toggles CSS `invert` filter on the map canvas |
| Geocoding | Photon / Komoot (no key required) |
| Alignment search | Magnifying-glass button; finds next date+time when sun/moon aligns two map points at their set heights; ±1.5° tolerance |
| Target pin | Tap the map to drop an observer pin |

### Shadow mode (always on)

The shadow panel shows in map mode at all times.

| Element | Behaviour |
|---------|-----------|
| White dot | Observer ground position (0 m). Never moves. |
| Blue caster sphere | At **Caster** height above ground. Moves only when the Caster slider changes. |
| Blue pole | Ground → caster top |
| Orange shadow dot | Shadow endpoint, elevated to **Floor** height above ground |
| Green dot | Ground-level reference directly below the orange dot (only when Floor > 0) |
| Green line | Vertical from green dot to orange dot |
| Sky line | Body → caster → shadow endpoint (always passes through caster sphere) |

**Caster** = height of the object casting the shadow (above the observer's ground level).  
**Floor** = height of the surface the shadow lands on (e.g. a rooftop the photographer is standing on). Only the portion of the caster above the floor produces a shadow.  
Shadow hides entirely when: floor ≥ caster, body below 0.5°, or shadow distance > 4 km.

**Height inputs:** Each row has a log-curve range slider (0–1000 m) plus a tap-to-edit number field. Tap the number to type an exact metre value; the slider snaps to the nearest position.

### Persistence

- **URL hash**: observer lat/lon, datetime, and mode sync to the address bar on every change. Reopening the URL restores the exact session.
- **localStorage**: caster height, floor height, arc radius, and map tilt persist across closes and crashes via `localStorage['sun_ui']`.

### Error monitoring

Runtime errors (JS exceptions and unhandled promise rejections) are captured to a localStorage ring buffer (last 50 entries) with: timestamp, stack trace, app state snapshot, and `navigator.userAgent`.

**To view the error log:** open browser DevTools console and run `window.__sunLog()`.  
**To clear it:** run `window.__sunClearLog()`.

**Optional Sentry integration:** see commented-out block in `index.html`. Sign up at sentry.io (free tier), uncomment the CDN script, set `window.SENTRY_DSN` to your project DSN, and errors will forward to Sentry automatically.

---

## Architecture

```
Client only · No backend · No build step · ES modules served as-is
```

**State flow:**
```
user gesture → store.set() → subscribeAll → throttleRaf → redraw()
                                                           ├── updateSunPathDay()   (day-level: arc rebuild)
                                                           ├── updateSunNow()       (per-frame: live body)
                                                           ├── updateShadow()       (per-frame: shadow geometry)
                                                           ├── updateReflectionNow()
                                                           └── updateCameraView()   (camera mode only)
```

**Two-tier redraw:**
1. **Day-level** (date / observer / mode change) — rebuilds arc markers, scrubber ticks, rise/set times
2. **Per-frame** (every scrubber move) — updates live body position, shadow endpoint, reflection rays

**3D projection:**  
`project3D(map, lng, lat, altMetres)` in `util.js` — flat-earth ray-cast from camera through the elevated point to the ground plane; uses MapLibre's own `map.project()` for the apparent ground point so perspective is always correct.

**Shadow collinearity:**  
The sky line is a `<polyline>` with three explicit waypoints (body → caster → shadow end), forcing visual intersection with the caster sphere regardless of any `project3D` approximation error near the horizon.

---

## File layout

```
index.html              single page, all UI markup
manifest.webmanifest    PWA manifest
sw.js                   service worker (network-first, app-shell cache)
css/
  style.css             design system + tokens
js/
  app.js                main wiring, redraw loop, event handlers, persistence
  state.js              tiny pub/sub store
  util.js               geo math + project3D
  solar.js              SunCalc wrapper — sun + moon position
  monitor.js            error capture (localStorage ring buffer + Sentry hook)
  share.js              URL hash ↔ state sync
  map.js                MapLibre init
  alignment.js          next-alignment brute-force search
  reminders.js          localStorage-backed shot reminders
  layers/
    observer.js         observer pin marker
    sun-path.js         arc markers, drop line, ray line, live body dot
    shadow.js           shadow geometry — all markers and SVG lines
    reflection.js       incident + reflected ray layers
    target.js           alignment target pin
  ui/
    scrubber.js         time slider + date picker
    search.js           geocoding input
    sensor.js           compass — device orientation + spike rejection
    arrow-view.js       camera feed + AR overlay + capture + calibration
vendor/
  suncalc.js            solar/lunar position library (vendored)
```

Unused orphan files (not imported): `js/buildings.js`, `js/terrain.js`, `js/reflection.js` (root), `js/ui/chart.js`.

---

## Deploy

The repo is served directly from `/home/blair/sun-v2/` by Caddy. Changes are live as soon as files are saved; force a service worker update on the client by hard-refreshing or waiting for the network-first SW to fetch new assets.

```bash
# Hard restart (if Caddy or the SW cache gets stuck):
sudo systemctl restart caddy
```

After any JS/CSS/HTML change, bump the cache version string in `sw.js` and the `?v=NN` query strings in `index.html` so clients pick up the new shell.

---

## Data sources (all free, no keys)

| Source | Used for |
|--------|---------|
| [OpenFreeMap](https://openfreemap.org) | Base map tiles |
| [Photon / Komoot](https://photon.komoot.io) | Geocoding search |
| [SunCalc](https://github.com/mourner/suncalc) | Sun + moon position math |
| [MapLibre GL JS 4.7.1](https://maplibre.org) | Map rendering + marker system |

---

## State shape (`js/state.js`)

```js
{
  observer:          { lat, lon },       // map pin position
  datetime:          Date,               // current scrubber time
  sunDatetime:       Date,               // last sun-mode time (restored on mode switch)
  moonDatetime:      Date | null,        // last moon-mode time
  mode:              'sun' | 'moon',
  view:              'map' | 'camera',   // camera UI button hidden; always 'map' currently
  shadowEnabled:     true,               // always true (toggle removed)
  reflectionEnabled: boolean,
  compassEnabled:    boolean,
  compassHeading:    number | null,
  compassPitch:      number | null,
  target:            { lat, lon } | null,
}
```

---

## Alignment search

The magnifying-glass button opens a two-step wizard:
1. **Caster** (Point A) — pre-fills from current observer position + caster height. Tap map to adjust.
2. **Target** (Point B) — tap map to set. Pre-fills floor height.

Search finds the next datetime (within one year) when the sun/moon is simultaneously at the bearing from A→B and the altitude that matches the height difference between the two points. If the caster is taller than the target (shadow-casting case), the search automatically flips to find the sun at bearing B→A at the equivalent positive altitude.

**Tolerance:** ±1.5° for both azimuth and altitude. Adjustable via `toleranceDeg` parameter in `alignment.js`.

---

## Known limitations

- **Reflection mode is 2D only.** The reflected ray is a pure azimuth mirror with no elevation component.
- **Shadow cap at 4 km.** When the shadow would extend beyond 4 km (very low sun angle), it is hidden rather than shown truncated. This prevents misleading geometry at the cost of no display near sunrise/sunset with tall casters.
- **`project3D` approximation.** The flat-earth projection is accurate for typical use (caster heights up to ~1 km, arc radius up to a few km) but accumulates error at extreme parameters. The polyline waypoint approach compensates for this in the sky line.
- **Camera / AR view** is implemented in `js/ui/arrow-view.js` but the UI button is hidden pending a future UX pass.
