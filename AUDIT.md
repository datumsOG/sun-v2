# Sun · Light Planner — Code Audit & Fix Log

> **Standing rule for all future Claude sessions:**
> Every prompt that results in code changes **must** include an update to this file before the final commit. Log what changed, which files, and why. This is non-negotiable — treat it as part of the definition of done.



**Date:** 2026-05-03  
**Audited by:** Claude Sonnet 4.6  
**Commit at audit time:** `0cc0eb9` (checkpoint before any changes)

---

## Part 1 — Issues Found

### CRITICAL-1: Null dereference crash destroys the entire camera module
**File:** `js/ui/arrow-view.js:65, 109`

`elSensorBtn` is explicitly set to `null` on line 65 with the comment "removed from UI; permission requested automatically". But line 109 then calls:
```js
elSensorBtn.addEventListener('click', enableSensors);
```
This throws `TypeError: Cannot read properties of null`, which is caught by the `safe('camera', ...)` wrapper in `app.js`. The module-level variables (`elView`, `elVideo`, `arSvg`, etc.) are never assigned, so every subsequent call to `showCameraView()`, `hideCameraView()`, or `renderAR()` either silently fails or throws. **This is the root cause of the broken AR overlay — the camera module never initialises.**

A secondary null dereference exists in `enableSensors()` at line 163:
```js
if (res !== 'granted') { elSensorBtn.textContent = 'Permission denied'; return; }
```
And again at line 173:
```js
elSensorBtn.textContent = 'Sensors unavailable';
```
Both paths write to `elSensorBtn` without guarding for null.

**Fix:** Remove line 109 entirely. Guard the two residual `.textContent` writes with `if (elSensorBtn)`.

---

### CRITICAL-2: Date picker does not open on iOS (resistant to repair)
**File:** `css/style.css:201–207`, `js/ui/scrubber.js:48–55`

The `#date-input` element has `pointer-events: none` applied:
```css
#date-input {
  position: absolute;
  left: 0; top: 0;
  width: 1px; height: 1px;
  opacity: 0;
  pointer-events: none;   /* ← problem */
  ...
}
```
On iOS Safari (particularly in PWA/home-screen mode, pre-16.4), `showPicker()` either does not exist or throws. The fallback path calls `.click()` and `.focus()`, but both are no-ops on a `pointer-events: none` element — the browser refuses to recognise these as valid user-gesture activations on iOS. This causes silent failure every time.

The JS click handler also adds redundant complexity:
```js
dateBtn.addEventListener('click', () => {
  try {
    if (typeof dateInput.showPicker === 'function') dateInput.showPicker();
    else dateInput.click();
  } catch (e) {
    try { dateInput.focus(); dateInput.click(); } catch {}
  }
});
```

**Fix:** Convert `#date-btn` from a `<button>` to a `<label for="date-input">`. The browser's native label-activation behaviour opens the date picker on all platforms without any JavaScript. Reposition the input off-screen without `pointer-events: none`. Remove the JS click-to-showPicker handler.

---

### HIGH-1: AR connecting line (body → caster → shadow) never rendered
**File:** `js/ui/arrow-view.js:380–387`

The shadow polyline (`arShadowLine`) requires all three of `bodyScreen`, `casterP`, and `endP` to be non-null:
```js
if (bodyScreen && casterP && endP) {
  // draw line
} else {
  arShadowLine.setAttribute('opacity', '0');
}
```
`endP` is the shadow's ground endpoint projected from the AR scene. When the user points the camera at the sky (the primary AR use case to see where the sun is), ground-level objects have a negative depth in camera space and `projectPoint()` returns `null`. Therefore `endP` is virtually always null, and the entire connecting line is never drawn.

**Fix:** When `endP` is null but `bodyScreen` and `casterP` are available, extrapolate the body→caster direction ray to the nearest screen edge and draw the line to that edge point. This shows the shadow direction even when the ground endpoint is off-screen.

---

### HIGH-2: Blue caster-to-ground pole line missing from AR overlay
**File:** `js/ui/arrow-view.js` (omission)

In map/shadow mode a blue SVG `linePole` connects the caster sphere down to the observer's ground dot. In AR mode this element was never added. Users cannot see the visual connection between the floating caster sphere and the ground.

**Fix:** Add a second SVG `<line>` element (`arPoleLine`) to the AR overlay SVG. When the caster sphere is in frame, draw the pole from `casterP` straight down to the observer ground point (or to the bottom of screen when the observer dot is off-screen).

---

### MEDIUM-1: Ground elements (observer dot, shadow end) hidden when camera points at sky
**File:** `js/ui/arrow-view.js:348–377`

`elArObs` (white ground dot at observer feet, `[0,0,-1.6]`) and `elArShadowEnd` (shadow endpoint on ground) are both behind the camera when looking skyward. `projectPoint()` returns `null` for any point with depth ≤ 0.01. These elements are never shown during normal AR use.

The shadow end indicator should appear at the screen edge where the extrapolated shadow ray exits the frame (handled by HIGH-1 fix above). The observer ground dot is less critical since its position is represented by the bottom of the pole line.

---

### LOW-1: Dead function — `attachLongPress()` defined but never called
**File:** `js/app.js:484–500`

```js
function attachLongPress(map, cb) { ... }
```
The long-press alignment finder was removed but this function remained.

---

### LOW-2: Stale DOM reference — `dom.hint` resolves to null
**File:** `js/app.js:51`

```js
hint: $('hint'),
```
There is no `id="hint"` element in `index.html`. The CSS has rules for `#hint` but they are unreachable. The reference is never read so there is no runtime error, but it is dead code.

---

### LOW-3: Duplicate `startOfLocalDay()` in `solar.js`
**File:** `js/solar.js:45–49`

A private `startOfLocalDay` function duplicates the exported version in `util.js`. `solar.js` does not import from `util.js`, so this is a silent divergence point.

---

### LOW-4: Misplaced JSDoc block in `solar.js`
**File:** `js/solar.js:122–123`

The JSDoc comment that belongs to `getMoonIllumination` appears above `getMoonTimes`. The actual `getMoonIllumination` function has no doc block.

---

### LOW-5: Orphaned source files not imported anywhere
**Files:** `js/buildings.js`, `js/terrain.js`, `js/reflection.js`, `js/ui/chart.js`

These files exist in the repo but are not imported by `app.js` or any other active module. They appear to be remnants of previous feature iterations.

---

## Part 2 — Fix Plan

| # | Severity | File(s) | Action |
|---|----------|---------|--------|
| F1 | CRITICAL | `js/ui/arrow-view.js` | Remove null `elSensorBtn.addEventListener` call; guard two `.textContent` writes |
| F2 | CRITICAL | `index.html`, `css/style.css`, `js/ui/scrubber.js` | Convert date-btn to `<label for>`, reposition input off-screen without pointer-events restriction, remove JS showPicker handler |
| F3 | HIGH | `js/ui/arrow-view.js` | Add `extendRayToScreenEdge()` helper; use it to draw shadow line to screen edge when endP is null |
| F4 | HIGH | `js/ui/arrow-view.js` | Add `arPoleLine` SVG element in init; draw blue caster-to-ground pole in renderAR |
| F5 | LOW | `js/app.js` | Remove dead `attachLongPress()` function; remove `dom.hint` stale ref |

---

## Part 3 — Fix Execution Log

**Commit:** `dd8866f` — 2026-05-03

All five planned fixes were implemented in a single commit. Summary of what changed:

### F1 — Critical null crash fixed (`js/ui/arrow-view.js`)
- Changed `elSensorBtn = null` to `elSensorBtn = document.getElementById('cam-sensor-btn')` so the element reference is kept for the (rare) case the button exists, and is null-safe for the common case it doesn't.
- Guarded `elSensorBtn.addEventListener(...)` with `if (elSensorBtn)`.
- Guarded both `elSensorBtn.textContent = ...` writes inside `enableSensors()` with `if (elSensorBtn)`.
- Result: `initCameraView()` no longer throws, the entire camera module initialises correctly.

### F2 — Date picker fixed (`index.html`, `css/style.css`, `js/ui/scrubber.js`)
- Changed `<button id="date-btn">` to `<label id="date-btn" for="date-input">`. The browser's native label-activation behaviour opens the date picker on every platform (iOS Safari, Android Chrome, desktop) without any JavaScript.
- Updated `#date-input` CSS: `position: fixed; left: -300px; top: 0` (off-screen but pointer-interactive). Removed `pointer-events: none`. Added `font-size: 16px` to prevent iOS zoom-on-focus.
- Removed the `dateBtn.addEventListener('click', ...)` showPicker/click/focus block from `scrubber.js` — it's now handled natively. The `change` event listener remains.

### F3 — AR shadow line visible even when pointing at sky (`js/ui/arrow-view.js`)
- Added `extendRayToScreenEdge(p1, p2, W, H)` helper that continues a ray from `p2` in the direction `p1→p2` until it hits the nearest screen boundary.
- When `endP` (shadow ground endpoint) is null because it's behind the camera, the helper computes where the body→caster→shadow ray would exit the screen. The polyline is drawn to that edge point.
- The orange shadow-end dot is also placed at the edge point in this case, clearly marking the shadow direction even when the camera is pointing at the sky.

### F4 — Blue pole line added to AR overlay (`js/ui/arrow-view.js`)
- Added module-level `arPoleLine` SVG `<line>` element, created alongside `arShadowLine` in `initCameraView()`.
- In `renderAR()`, when the caster sphere is in camera frame (`casterP` non-null), the pole is drawn from `casterP` down to the observer ground dot (`obsP`) or to the screen bottom at `casterP.x` when the ground is off-screen.
- Colour: `#4dd2ff` (same light-blue as the map-mode caster pole).

### F5 — Dead code removed (`js/app.js`)
- Removed the unused `attachLongPress()` function (16 lines).
- Removed the stale `dom.hint: $('hint')` reference (resolved to null, never read).

### Unchanged low-priority items
- `solar.js` private `startOfLocalDay` duplication — left as-is; no runtime impact.
- Misplaced JSDoc in `solar.js` — cosmetic; left as-is.
- Orphaned files (`buildings.js`, `terrain.js`, `reflection.js`, `chart.js`) — not deleted; may be needed as future references.

### Cache bump
- Service worker cache bumped from `v29` → `v30`.
- CSS and JS asset query-string versions bumped from `?v=29` → `?v=30`.

---

## Part 3b — Follow-up Fixes (2026-05-03)

**Commit:** `1144b0c`

Three additional changes requested after the initial audit/fix round.

### Orange ray line always visible

**Files:** `js/layers/sun-path.js`, `js/app.js`

- Changed `RAY_LINE` paint from `#fff1c2` (cream, dashed) to `#ffb845` (orange, solid, 2.5px width).
- Changed ray geometry: now draws from the arc dot's ground position `[glon, glat]` back to the observer `[lon, lat]`, so it visually represents the sun/moon ray coming down to the observer's ground position.
- Added `setRayLineVisible(map, vis)` export. `setSunPathVisible()` no longer controls `RAY_LINE`.
- In `app.js syncChrome()`: added `setRayLineVisible(map, !inCamera)` independently of `setSunPathVisible`. The orange ray is now always visible in map mode, including while reflection mode is active.

### Reflection mode works in moon mode

**Files:** `js/layers/reflection.js`, `js/app.js`

- `updateReflectionNow` now accepts a `moonMode` parameter and uses `getMoonPos` instead of `getPosition` when in moon mode.
- Removed `s.mode !== 'sun'` guard from the `reflectionToggle` click handler.
- Changed `const reflectionAvail = inSun && !inCamera` → `const reflectionAvail = !inCamera` in `syncChrome()`.
- Both call sites in `app.js` updated to pass `moonMode`.

### Date picker (third attempt — input overlay)

**Files:** `index.html`, `css/style.css`

The `<label for>` approach from the previous fix still didn't open the native picker on iOS. Root cause: iOS Safari PWA mode requires the user's touch to land directly on the `<input type="date">` element itself — label activation and programmatic `.showPicker()` / `.click()` are both unreliable.

Fix: moved `<input id="date-input">` inside `<button id="date-btn">` as an absolutely-positioned transparent overlay covering the full button area. When the user taps the button, their touch lands directly on the input, which opens the native date picker. No JS is involved in opening the picker — only the `change` event handler in `scrubber.js` remains.

CSS: `#date-btn { position: relative; overflow: hidden; }` and `#date-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; font-size: 16px; }`.

### Cache bump
- Service worker cache bumped `v30` → `v31`.
- Asset query-string versions bumped `?v=30` → `?v=31`.

---

## Part 4 — App Description for Future Sessions

> **Purpose of this section:** Provide a fresh Claude Code session with full context on the app — what it does, how it works, every file's role, data sources, and the current state of the codebase as of commit `1144b0c`.

---

### What the app is

**Sun · Light Planner** (`/home/blair/sun-v2`) is a mobile-first Progressive Web App for photographers and cinematographers. Its purpose is to help the user plan and execute shots that involve precise sun or moon positioning — golden-hour alignments, shadow geometry, building reflections, and AR-guided framing.

It is a **pure front-end app**: no backend, no API keys, no build step. Everything runs in the browser from static files. The app runs as an installable PWA (service worker + manifest).

---

### Tech stack

| Layer | Technology |
|---|---|
| Map | MapLibre GL JS 4.7.1 (vector tiles from OpenFreeMap — free, no key) |
| Solar math | SunCalc.js (vendored, `vendor/suncalc.js`) |
| 3D math (AR) | Vanilla matrix math in `arrow-view.js` (no Three.js currently) |
| Geocoding | Photon API by Komoot (free, no key) |
| State | Custom 80-line pub/sub store (`state.js`) |
| Modules | Native ES Modules (`<script type="module">`) |
| Service worker | Network-first SW, falls back to cache offline |
| Build | None — edit and refresh |

---

### File-by-file reference

#### `index.html`
Single-page app shell. All UI is defined here statically:
- `#map` — full-screen MapLibre canvas container.
- `#dock` — bottom glass panel containing: scrubber (time slider), time readout, date button (`#date-btn`, a `<label>`), rise/set times, and the 8-button control row.
- `#date-input` — off-screen `<input type="date">` activated by the label.
- `#camera-view` — full-screen div shown in camera mode, contains `<video>`, `#guide-arrow`, `#body-disk`, `#ar-overlay`, and action buttons.
- `#ar-overlay` — invisible overlay where AR elements are dynamically appended.
- `#toast` — transient notification bar.
- Vertical sliders: `#tilt-slider` (map pitch, upper-right) and `#radius-slider` (arc radius, lower-right).

#### `js/app.js`
Central orchestrator. Responsibilities:
- Calls `initMap()` then awaits `whenStyleReady()`.
- Adds all map layers via `safe()` wrapper (catches individual layer failures).
- Wires every UI control to `store.set(...)`.
- `redraw(s, changed)` — the main render function, called on every state change via `throttleRaf`. Decides what needs recomputing based on which keys changed.
- Day-level vs per-frame split: day-level recomputes (arc, rise/set) only trigger when date or observer changes; per-frame updates run every scrubber tick.
- `syncChrome(s)` — keeps body classes, button states, and visibility flags in sync.
- `initReflectionDraw(map)` — hold-then-drag gesture for drawing wall lines.
- Global error traps: uncaught exceptions and unhandled rejections surface in the toast bar (critical for mobile debugging).

#### `js/state.js`
Tiny pub/sub store. Shape:
```js
{
  observer: { lat, lon },       // observer / shadow caster position
  datetime: Date,               // current planning datetime
  sunDatetime: Date | null,     // saved sun-mode datetime (restored on mode switch)
  moonDatetime: Date | null,    // saved moon-mode datetime
  mode: 'sun' | 'moon',
  view: 'map' | 'camera',
  shadowEnabled: boolean,
  reflectionEnabled: boolean,
  compassEnabled: boolean,
  compassHeading: number | null,
  compassPitch: number | null,
  target: { lat, lon } | null,
}
```
`store.set(partial)` only fires subscribers for keys that actually changed (uses `Object.is` comparison). `subscribeAll(fn)` receives `(state, changedKeys[])`.

#### `js/solar.js`
Wraps SunCalc. Key exports:
- `getPosition(date, lat, lon)` → `{ altitudeDeg, azimuthDeg }` (compass bearing).
- `getMoonPos(date, lat, lon)` → same shape.
- `getSunTimes(date, lat, lon, horizonDipDeg)` → rise/set/goldenHour (optionally adjusted for observer elevation).
- `getMoonTimes(date, lat, lon)` → `{ rise, set }`.
- `getMoonIllumination(date)` → `{ phase, fraction, waxing }`.
- `getElevationCurve(date, lat, lon, stepMin)` → array of `{ t, alt, az }`.
- **Azimuth convention:** SunCalc measures from south going west; solar.js converts to compass (0=N, 90=E) via `180 + azRad * RAD2DEG mod 360`.

#### `js/util.js`
Geodesic and UI helpers:
- `destination(lat, lon, bearingDeg, distanceKm)` → `[lon, lat]` — Vincenty-style great-circle projection.
- `bearing(lat1, lon1, lat2, lon2)` → compass bearing.
- `project3D(map, lng, lat, altMeters)` — projects an elevated world point to screen pixels using MapLibre's free-camera API or a pitch/zoom fallback. Used by shadow overlay and arc markers to get perspective-correct 3D positions.
- `formatTime(date)`, `formatDate(date)`, `startOfLocalDay(date)`, `withMinutes(base, totalMins)`, `minutesOfDay(date)`, `throttleRaf(fn)`, `debounce(fn, ms)`.

#### `js/map.js`
- `initMap(container, center)` — creates MapLibre map with OpenFreeMap dark style, 55° initial pitch.
- `brightenLabels(map)` — overrides text-color to white on all symbol layers.
- `whenStyleReady(map)` — promise that resolves when style is loaded.

#### `js/layers/observer.js`
GeoJSON circle layer: white dot + ring at observer position. Updated by `setObserver(map, lat, lon)`.

#### `js/layers/sun-path.js`
Most complex layer. Responsibilities:
- Maintains 60 arc-dot `maplibregl.Marker` elements along the body's day-arc from rise to set. Markers are DOM elements (`.arc-dot`) lifted off the ground via `project3D()` offsets so altitude is perspectively correct.
- Live body marker (`.arc-dot.head`, the larger bright dot).
- Three MapLibre line sources: `SR_LINE` (sunrise bearing, orange dashed), `SS_LINE` (sunset bearing, red dashed), `RAY_LINE` (current body bearing, solid orange — always visible in map mode, controlled by `setRayLineVisible()` independently of the arc).
- `arcRadiusKm` — adjustable radius; default 1.5 km, controlled by the right-edge slider (0.02–50 km).
- `anchorLiftMetres` — lifts all arc markers by this much when shadow mode is active (raises the arc to be centred on the caster top, making body→caster→shadow rays collinear).
- `getArcSamples()` — returns the current arc sample array, used by AR renderer.
- `getLiveBodyAnchor()` — returns the live body position + screen offset, used by shadow overlay.

#### `js/layers/shadow.js`
Shadow mode visualisation. When enabled:
- White ground dot (`observerDot`) at observer position.
- Light-blue caster sphere (`casterMarker`, `.caster-sphere`) lifted above observer by caster height.
- SVG overlay (`svgOverlay`): blue `linePole` (observer → caster top), orange/blue `lineSky` (body screen position → shadow endpoint). Re-renders every `map render` event.
- Shadow endpoint (`endMarker`, `.shadow-end`) placed on the ground at `shadowAz` direction, distance = `casterHeight / tan(elevation)`, capped at 4 km.
- Shadow colour: `#ffb845` (sun) or `#d0d8e8` (moon).
- Exports `getShadowHeight()` (used by AR renderer).

#### `js/layers/reflection.js`
Reflection mode. When user holds and drags to draw a wall line:
- Wall line (white dashed).
- Sun/moon marker at projected position.
- Incident ray (body → wall midpoint, orange dashed).
- Reflected ray (wall midpoint → outward, solid cyan). Formula: `R = (2*wallBearing - bodyAzimuth + 180) mod 360`.
- Active in both sun and moon map mode. `updateReflectionNow(map, observer, datetime, line, moonMode)` uses `getMoonPos` when `moonMode=true`.

#### `js/layers/target.js`
Optional alignment target: orange pin at `target` position, dashed orange line back to observer. Currently no UI to set the target (removed); target can be set via URL hash `#tg=lat,lon`.

#### `js/ui/scrubber.js`
Time slider + date picker:
- Sun mode: slider range 0–1439 (minutes of day).
- Moon mode: slider range 0–N minutes from moonrise to moonset; value = minutes after moonrise.
- `setScrubberRange()` — called on day/observer/mode change to resize the slider.
- Date picker: `#date-btn` is a `<button>` containing a transparent `<input type="date">` overlay (`position:absolute; inset:0; opacity:0`). The user's tap lands directly on the input, which opens the native date picker on all platforms including iOS Safari PWA mode. The `change` event updates `store.datetime` preserving the current time-of-day.
- Moon phase marker (`#moon-phase-marker`) — small circle below scrubber showing illumination phase via CSS clip-path.

#### `js/ui/search.js`
Geocoding via Photon API (`photon.komoot.io`). Debounced input → autocomplete dropdown → sets `store.observer` and flies map to result.

#### `js/ui/sensor.js`
Device orientation / compass for map mode:
- `enableCompass()` — requests iOS permission, attaches `deviceorientationabsolute` + `deviceorientation` listeners.
- EMA smoothing: heading α=0.12, pitch α=0.18. Spike threshold: 45°.
- Publishes `{ compassHeading, compassPitch }` to store. `app.js` subscriber drives `map.setBearing()` and `map.setPitch()`.
- `disableCompass()` — detaches listeners, resets state.

#### `js/ui/arrow-view.js`
Camera + AR mode. The most complex file:

**Camera stream:**
- Requests rear camera via `getUserMedia({ facingMode: { ideal: 'environment' } })`.
- `tick()` runs `requestAnimationFrame` loop while visible.

**Body disk overlay:**
- `#body-disk` — pulsing sun or moon disk positioned at projected body screen coordinates.
- Moon shows phase shadow via `updateMoonShadow()` (clip-path computed from `getMoonIllumination`).
- `#guide-arrow` — off-screen guide arrow pointing toward body when body is behind camera.

**AR overlay (`#ar-overlay`):**
All rendered in the `renderAR(W, H, halfVfovTan)` function, called each tick when AR is enabled:

1. **Arc dots** (`.ar-dot`) — 60 dots along the day-arc, projected as unit-direction vectors via `projectUnit()`.
2. **Caster sphere** (`elArCaster`, `.ar-caster`) — blue sphere, projected at `[0, 0, casterH - 1.6]` ENU. Size scales with distance.
3. **Observer ground dot** (`elArObs`) — white dot at `[0, 0, -1.6]` ENU (observer's feet). Visible only when camera points toward ground.
4. **Shadow end dot** (`elArShadowEnd`, `.shadow-end`) — orange/blue dot. When actual shadow endpoint is behind camera (most common case), shown at the screen edge where the shadow ray exits frame.
5. **Shadow line** (`arShadowLine`, SVG polyline) — body → caster → shadow end (or screen edge). Always drawn when body and caster are both in frame.
6. **Caster pole** (`arPoleLine`, SVG line) — blue line from caster sphere down to observer ground dot or screen bottom.

**Orientation math:**
- `onOrient(e)` — consumes `deviceorientation`/`deviceorientationabsolute` events.
- Smoothed Euler angles → 3×3 rotation matrix `R` via `Rz(α) * Rx(β) * Ry(γ)`.
- `T3(R)` (transpose of R) transforms world-frame ENU vectors to device camera frame.
- Body world vector: `[cos(el)*sin(az), cos(el)*cos(az), sin(el)]` (ENU, X=East, Y=North, Z=Up).
- Depth = `-v[2]` (positive = in front of rear camera).
- Projection: NDC = `v[x|y] / depth / halfFovTan`, screen = `(NDC ± 1) / 2 * W|H`.
- HFOV: 68° total (hardcoded constant `HALF_HFOV_TAN = tan(34°)`).
- Calibration offset: the "Align" button computes `body.azimuthDeg - headingSmoothed` and adds it to all subsequent azimuth calculations to remove compass offset.

**Capture:** Draws video frame + metadata (date, lat/lon, az/el) to a canvas and triggers download.

#### `js/share.js`
URL hash ↔ state encoding. Format: `#ll=lat,lon&t=YYYY-MM-DDTHH:MM&m=moon&tg=lat,lon`. Debounced `history.replaceState` on every state change. Restores state on load and `hashchange`.

#### `js/reminders.js`
Saves reminders to `localStorage`. `saveReminder(observer, datetime, mode)` and `checkAndNotify()` (checks on load, shows toast if due, requests Notification permission).

#### `js/alignment.js`
`findNextAlignment(observer, targetAzDeg, toleranceDeg, fromDate, kind)` — brute-force 365-day scan for next sunrise/sunset matching a bearing within tolerance. Not currently surfaced in UI but exported and importable.

#### `vendor/suncalc.js`
SunCalc library (vendored copy). Provides: `getPosition`, `getTimes`, `getMoonPosition`, `getMoonTimes`, `getMoonIllumination`. Azimuth convention: 0 = south, positive = west (radians). All callers go through `solar.js` which converts to compass bearing.

#### `css/style.css`
Design system variables, layout, and component styles:
- CSS custom properties for all colours, surfaces, shadows.
- `#dock` — glass panel, safe-area-aware.
- `.vslider` — vertical range inputs on right edge.
- `.arc-dot`, `.arc-dot.head` — sun/moon arc dot markers.
- `.caster-sphere`, `.shadow-end` — shadow mode markers.
- `.ar-dot`, `.ar-caster`, `.ar-line` — AR overlay elements.
- `#body-disk` — sun (pulsing animation) or moon (overflow:hidden for phase clip).
- `body.invert` — applies `filter: invert(1) hue-rotate(180deg)` to map canvas and markers.
- `body.mode-moon` — recolours arc dots, scrubber, rise/set labels to moon-blue.
- `body.view-camera` — hides map, shows camera view.

#### `sw.js`
Network-first service worker. On install caches `./`, `./index.html`, `./manifest.webmanifest`. On activate deletes old caches. On fetch: tries network, caches successful responses, falls back to cache offline. Cache key: `sun-v2-shell-v30` (bump version to force update).

---

---

## Part 5 — New Work Plan (2026-05-04)

**Checkpoint commit before starting.**

### Issues / feature requests

| # | Severity | Description |
|---|----------|-------------|
| N1 | BUG | Reflection mode hides sun/moon arc, sunrise/sunset bearing lines — they should remain visible in all map modes |
| N2 | FEATURE | New "drop line" from elevated arc dot straight down to its ground anchor. Yellow in sun mode, white in moon mode. The existing RAY_LINE (ground ray) should also turn white in moon mode |
| N3 | FEATURE | Shadow mode on by default; caster height slider defaults to 0 m |
| N4 | FEATURE | New "Floor" slider: raises the observer dot and caster sphere by an observer elevation (e.g., top of a building), adjusts total shadow length accordingly |

### Fix Plan

| # | File(s) | Action |
|---|---------|--------|
| N1 | `js/app.js` | Remove `&& !s.reflectionEnabled` from `setSunPathVisible` call in `syncChrome()` |
| N2 | `js/layers/sun-path.js`, `js/app.js` | Add SVG drop-line overlay in sun-path; export `setBodyColor(map, moonMode)` to recolour RAY_LINE + drop line; call from `syncChrome` on mode change |
| N3 | `js/state.js`, `index.html`, `js/app.js` | `shadowEnabled: true`; slider `value="0"`; init display "0 m" |
| N4 | `js/layers/shadow.js`, `index.html`, `js/app.js`, `css/style.css` | Add `FLOOR_H_M`, `setFloorHeight()`; observer dot offset to floor height; caster offset to floor+caster; shadow distance = (floor+caster)/tan(el); arc anchor = floor+caster; add floor `<input>` in shadow-elev-panel |

---

---

## Part 5b — Execution Log (2026-05-04)

**Commit:** (see git log)

### N1 — Reflection mode no longer hides arc (`js/app.js`)
- Removed `&& !s.reflectionEnabled` from the `setSunPathVisible` call in `syncChrome()`.
- Arc dots, live body marker, and sunrise/sunset bearing lines now remain visible when reflection mode is active.

### N2 — Drop line + moon-mode ray recolouring (`js/layers/sun-path.js`, `js/app.js`)
- Added `dropSvg` / `dropLine` SVG overlay elements created in `addSunPathLayer()`.
- `renderDropLine()` fires on every `map render` event: draws an SVG line from the elevated arc-dot screen position (`map.project([lon,lat]) + offsetForSample`) down to the ground anchor. Hidden if the elevation offset is < 3 px.
- Added `setBodyColor(map, moonMode)` export: sets `dropLineColor` module var, updates `dropLine` stroke, and calls `map.setPaintProperty(RAY_LINE, 'line-color', ...)`. Yellow (`#ffb845`) in sun mode, white (`#d0d8e8`) in moon mode.
- `setSunPathVisible` also toggles `dropSvg.style.display` so the drop line hides with the rest of the arc.
- `syncChrome()` in `app.js` calls `setBodyColor(map, !inSun)` on every mode/view/shadow/reflection change.

### N3 — Shadow on by default, caster height defaults to 0 m
- `js/state.js`: `shadowEnabled: false` → `shadowEnabled: true`.
- `index.html`: caster slider `value="333"` → `value="0"`.
- `js/layers/shadow.js`: `OBJECT_H_M` initial value `10` → `0`.
- Display text initialises to "0 m" via existing `sliderToHeight(0) === 0` path.

### N4 — Floor slider (`js/layers/shadow.js`, `index.html`, `js/app.js`, `css/style.css`)
- `shadow.js`: added `FLOOR_H_M = 0`, `setFloorHeight(h)` / `getFloorHeight()` exports.
- `setShadowHeight` and `setShadowVisible` now use `FLOOR_H_M + OBJECT_H_M` for `setAnchorLiftMetres` and shadow distance: `totalH / tan(el)`.
- `renderOverlay()`: observer dot offset to floor height (via `project3D`); caster sphere offset to `floor + caster`; SVG pole drawn from floor level to caster top.
- `index.html`: shadow-elev-panel restructured into two `.elev-row` divs (Caster / Floor), each with label + slider + value span.
- `css/style.css`: shadow-elev-panel changed to `flex-direction: column`; `.elev-row` flex-row class added.
- `app.js`: added `dom.floorElev` / `dom.floorElevVal`; floor slider `input` handler mirrors caster handler; imports `setFloorHeight`.

### Cache bump
- Service worker cache: `v31` → `v32`.
- Asset query strings: `?v=31` → `?v=32`.

---

---

## Part 6 — Shadow always-on, green floor indicator (2026-05-04)

**Commit:** (see git log)

### Changes

#### Shadow mode permanently on — toggle removed
- `index.html`: removed `<button id="shadow-toggle">` from the control row.
- `js/app.js`: removed `dom.shadowToggle` from the dom map; removed click handler; `setShadowVisible` now called with `!inCamera` (no `s.shadowEnabled` guard); removed toggle active/aria-pressed state management from `syncChrome`; shadow panel no longer toggled to `disabled` class.
- `js/state.js`: `shadowEnabled: true` default unchanged (set in Part 5); the field is retained but never written to false again.
- The floor and caster sliders are now always visible in map mode, always interactive.

#### Green floor dot + green ground→floor line (`js/layers/shadow.js`)
- Renamed `observerDot` → `groundDot`. It stays at true ground level with **no pixel offset** — it never moves off the map surface.
- Added `floorDot`: a green (`#4dff9a`) dot created and offset to floor height when `FLOOR_H_M > 0.01`, destroyed when floor returns to 0.
- Added `lineFloor` SVG line (green, `stroke-width: 2`): drawn from `groundScreen` to `floorScreen` when floor > 0, hidden otherwise.
- SVG element order in overlay: `lineSky` (body→shadow), `lineFloor` (ground→floor), `linePole` (floor→caster). Each hides independently via `opacity`.
- Shadow endpoint dot and sky line are hidden when both floor and caster are 0 (no geometry to draw).

### Cache bump
- `v33` → `v34`.

---

---

## Part 7 — Shadow graphics regression fix + drop line sync (2026-05-04)

**Commit:** (see git log)

### Bugs fixed

#### Shadow caster sphere / blue pole / sky line not showing (`js/layers/shadow.js`)
Root cause: v34 added `endMarker.getElement().style.display === 'none'` as the sky-line early-return guard in `renderOverlay()`. This was fragile — it relied on an inline style set in `update()` and the condition was always true at initial load (both sliders at 0 → totalH=0 → endMarker hidden via inline style). When sliders were raised, the sky line draw path was blocked until the next direct `renderOverlay()` call, and the check introduced a dependency between two functions that shouldn't need to know each other's internal state.

Fix: removed `endMarker.style.display` manipulation entirely. `endMarker` is now only created when `totalH > 0.01` AND `p.altitudeDeg > 0.5`. When either condition fails, endMarker is removed/null. `renderOverlay()` checks `!endMarker` (null check) instead of display style. `renderOverlay()` also checks `totalH > 0.01` directly when computing `casterTopScreen`.

#### Drop line doesn't track arc dot when caster/floor slider moves (`js/layers/sun-path.js`)
Root cause: `updateAllOffsets()` repositions arc marker DOM elements but doesn't update any MapLibre GL source, so no `map render` event fires. `renderDropLine()` only runs on `map render`. Result: the drop line SVG stayed at its old position until the user did something else (moved the time slider, panned, etc.).

Fix: added `renderDropLine()` call at the end of `updateAllOffsets()`. Now the drop line syncs immediately whenever arc offsets change, including slider moves.

### Cache bump
- `v34` → `v35`.

---

### Known limitations and open work

- **AR coordinate frame calibration:** The HFOV is hardcoded at 68° which is close but may drift on different phones. The "Align" button corrects azimuth but not elevation.
- **Ground elements behind camera:** Observer ground dot and actual shadow endpoint are always behind the camera when pointing at sky. The shadow direction is now shown via screen-edge extrapolation but the true ground point is not visible.
- **Terrain not modelled:** Rise/set times assume flat horizon. Mountainous terrain would require elevation API integration.
- **No moon arc in AR:** `getArcSamples()` returns sun arc data from `sun-path.js`. In moon mode, the same arc samples (computed from moon positions) are used, which is correct — the arc samples switch mode with `updateSunPathDay(map, obs, dt, moonMode=true)`.
- **Orphaned files:** `js/buildings.js`, `js/terrain.js`, `js/reflection.js` (root), `js/ui/chart.js` exist but are not imported. They represent abandoned features from earlier versions.
- **`refreshArcGeometry()` is a no-op** in `sun-path.js` — the radius change triggers a full `updateSunPathDay` call in `app.js` which rebuilds the arc anyway.
- **Reflection mode:** Only supports vertical walls. The reflected ray is a pure 2D azimuth mirror (no elevation component).

---

### Data flow summary

```
User interaction (tap, drag, scrubber)
  ↓
store.set({ ... })
  ↓
subscribeAll → throttleRaf → redraw(state, changedKeys)
  ↓
  ├── dayLevelChanged → updateSunPathDay, setScrubberRange, renderScrubberTicks
  ├── always         → updateSunNow, updateReflectionNow, updateShadow, updateNowText
  └── view=camera    → updateCameraView (sets datetime/observer/moonMode in arrow-view module)
                        tick() loop → renderAR() / updateBodyDisk()
```

### URL hash state example
```
https://yourdomain.com/sun-v2/#ll=43.65320,-79.38320&t=2026-05-03T18:30&m=sun
```
Opening this URL restores observer position, datetime, and mode exactly.

