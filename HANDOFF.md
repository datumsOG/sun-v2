# HANDOFF — sun-v2 (Sun · Light Planner, experimental)

**What this is:** sun-v2 is the active experimental branch of the Sun · Light Planner PWA —
a mobile-first app for photographers and cinematographers to plan sun/moon positions, shadow
geometry, building reflections, and AR-guided framing. It is the development counterpart to
`sun-stable`, which is the live 24/7 demo. New features are built and tested here; stable
ones are selectively merged to sun-stable.

---

## Stack

| Layer | Tech |
|---|---|
| Map | MapLibre GL JS 4.7.1 (vector tiles via OpenFreeMap — free, no key) |
| Solar math | SunCalc.js (vendored at `vendor/suncalc.js`) |
| 3D scene (photo-view) | Three.js (loaded in `js/ui/photo-3d.js`) |
| Geocoding | Photon API by Komoot (free, no key) |
| State | Custom 80-line pub/sub store (`js/state.js`) |
| Modules | Native ES Modules (`<script type="module">`) — no build step |
| Service worker | Network-first SW; falls back to cache. Key: `sun-v2-shell-v69` |
| Build | None — edit files, refresh browser |
| Deploy | Caddy serves `/home/blair/sun-v2/` directly |

---

## File Map

```
index.html              Single-page app shell; all UI markup lives here
manifest.webmanifest    PWA manifest
sw.js                   Service worker (network-first; bump CACHE const on every release)
css/
  style.css             Design system tokens, layout, component styles (glassmorphism dark)
js/
  app.js                Central orchestrator: init, redraw loop, event wiring, persistence
  state.js              Tiny pub/sub store (store.set / store.get / subscribeAll)
  solar.js              SunCalc wrapper — sun + moon position, azimuth conversion
  util.js               Geodesic math (destination, bearing, project3D) + UI helpers
  map.js                MapLibre init, maxZoom:24, style ready promise
  monitor.js            Error capture: localStorage ring buffer (last 50), optional Sentry hook
  share.js              URL hash ↔ state sync (observer, datetime, mode, target)
  alignment.js          Next-alignment brute-force search (findAlignmentBetweenPoints)
  reminders.js          localStorage-backed shot reminders
  layers/
    observer.js         White observer pin
    sun-path.js         Arc markers (60 dots), drop line, SR/SS/RAY lines, live body dot
    shadow.js           Shadow geometry: caster sphere, pole, sky line, floor surface indicators
    reflection.js       Incident + reflected ray MapLibre layers
    target.js           Alignment target pin + dashed line to observer
    grid.js             Graph-paper SVG overlay for backyard use (grid mode)
  ui/
    scrubber.js         Time slider + native date picker (input overlay approach)
    search.js           Geocoding input (Photon API, debounced)
    sensor.js           Device orientation/compass (EMA smoothed, spike-rejected)
    arrow-view.js       Camera feed + AR overlay (body disk, arc dots, shadow line, calibration)
    photo-3d.js         Three.js photographer's-eye view (v69+); local map tile texture
    sky-view.js         (experimental — status: TODO(blair) verify if imported/active)
    chart.js            SVG elevation chart (orphaned — not imported in current app.js)
vendor/
  suncalc.js            SunCalc library (vendored)
docs/
  superpowers/          Internal planning and spec docs (not user-facing)
  archive/              Superseded audit and AI summary docs
```

**Orphaned files (exist but not imported by app.js):**
`js/buildings.js`, `js/terrain.js`, `js/reflection.js` (root-level), `js/ui/chart.js` —
retained as future feature references.

---

## How to Run Locally

No build step. Open `index.html` in a browser. For PWA features (service worker, device
orientation on iOS) you need HTTPS — use the live server.

```bash
# The repo is served by Caddy from /home/blair/sun-v2/
# Changes are live immediately after file save.
# Force a SW cache update: bump the CACHE const in sw.js and bump ?v=NN query strings in index.html
sudo systemctl restart caddy     # if Caddy or SW cache gets stuck
```

---

## How to Deploy

Caddy serves the directory directly. There is no CI or build pipeline. Steps:
1. Edit files.
2. Bump `CACHE` in `sw.js` (e.g. `v69` → `v70`).
3. Bump `?v=69` → `?v=70` on all JS/CSS `<script>` and `<link>` tags in `index.html`.
4. Commit. Changes are live immediately at `experimental-blair.duckdns.org`.

---

## Current State (as of 2026-06-12)

**Last SW version:** v69 (three.js photo-view).

**Active / stable features in this branch:**
- Sun/moon arc (60 dot markers, perspective-correct, z-ordered)
- Shadow mode always-on (caster + floor height sliders, tap-to-edit number inputs)
- Reflection mode (hold-drag to draw wall, incident + reflected rays)
- Grid mode (graph-paper SVG overlay, metric/imperial, auto-scaling, zoom-21 fly-in)
- DATA panel (observer + shadow endpoint coordinates, "Find Alignment" entry point)
- Alignment wizard (two-point, ±1° tolerance, scans 1 year in 5-min steps)
- Error monitor (`window.__sunLog()` in DevTools console)
- AR camera mode (implemented in arrow-view.js; UI button currently hidden)
- Idle perspective drift (±2° bearing, ±1.5° pitch after 4s idle)
- URL hash state persistence + localStorage slider persistence

**Experimental / in-progress:**
- Photo-3d view (v69): three.js scene from photographer's-eye position, tile texture,
  drag-to-swivel, pinch-zoom. Known gaps: caster is locked to observer lat/lon (not a
  separate subject pin); tile snapshot is static; floor support partial.
- Camera mode 2.0 (arrow-view.js v43+): two-axis visual calibration, FOV presets,
  centre crosshair. UI button hidden pending UX pass.

**Relationship to sun-stable:**
sun-stable was forked from sun-v2 at commit `4deb1e7` (v65). Features from v66+ (below-view
spike, photographer view, three.js photo-3d, alignment wizard) exist only in sun-v2.
sun-stable carries a lean feature set and has its own independent version counter.

**Known limitations / open work:**
- Caster lat/lon is locked to observer position (photo-3d caster-as-separate-subject deferred)
- AR coordinate frame HFOV hardcoded at 68°; elevation calibration approximate
- Terrain not modelled (flat horizon assumed for rise/set)
- Reflection mode is 2D only (azimuth mirror, no elevation component)
- Shadow hidden when distance > 4 km (near sunrise/sunset with tall casters)
- share.js NaN propagation from malformed hashes: guarded in decodeHashToState + redraw NaN guard

---

## Data Sources (all free, no keys)

| Source | Used for |
|---|---|
| OpenFreeMap | Base map tiles |
| Photon / Komoot | Geocoding search |
| SunCalc (vendored) | Sun + moon position math |
| MapLibre GL JS 4.7.1 | Map rendering + marker system |
