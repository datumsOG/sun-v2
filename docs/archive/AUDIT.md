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

---

## Part 8 — v36 Fix: Sky line forced through caster sphere (polyline fix)

**Date:** 2026-05-04

### Bug
Near sunrise/sunset (and moonrise/moonset), the orange/white sky line from the body position in the arc failed to intersect the blue caster sphere. The line appeared to pass beside or miss the sphere entirely as the time slider moved toward the horizon.

### Root cause
`project3D()` uses a flat-earth approximation that builds a local coordinate frame for each point individually, using that point's lat/lon as its own origin. When the arc body is far horizontally (near-horizon low altitude = large horizontal distance at the arc radius) and only slightly elevated, the three screen projections (body, caster top, shadow endpoint) accumulate small but visible approximation errors. These errors destroy 3D collinearity on screen — so a `<line>` drawn from body to shadow endpoint does not pass through the caster sphere's screen position.

### Fix
Changed `lineSky` from `<line>` to `<polyline>` with three explicit waypoints: body screen position → caster top screen position → shadow endpoint screen position. This bypasses the collinearity requirement entirely — the line is forced through all three computed screen points regardless of any approximation errors in `project3D`.

**Files changed:**
- `js/layers/shadow.js`: `lineSky` element changed to `polyline` in `addShadowLayer()`; `renderOverlay()` updated to set `points` attribute (`"${bx},${by} ${casterTopScreen.x},${casterTopScreen.y} ${endPt.x},${endPt.y}"`) instead of `x1,y1,x2,y2`.
- `sw.js`: cache bumped `v35` → `v36`
- `index.html`: asset query strings bumped `?v=35` → `?v=36`

---

## Part 9 — Stability + Error Monitoring (2026-05-05)

### Summary
Added a persistent error monitor and hardened the five most likely runtime crash points.

---

### 1) Error monitoring — `js/monitor.js` (new file)

**What:** Lightweight error capture module. Captures full stack traces, app state snapshot (mode, view, observer, datetime, shadowEnabled), and `navigator.userAgent` into a `localStorage` ring buffer (last 50 entries).

**How to access logs:**
- Open browser DevTools console on any device.
- Run: `window.__sunLog()` → returns array of error objects sorted oldest-first.
- Run: `window.__sunClearLog()` → clears the buffer.

**Sentry integration (optional, not yet enabled):**
- See commented-out block in `index.html` for instructions.
- Create a free project at sentry.io, uncomment the CDN script tag, and set `window.SENTRY_DSN`.
- `monitor.js` auto-forwards to `Sentry.captureException()` when the SDK and DSN are both present.

**Wired into `app.js`:**
- `initMonitor(() => store.get())` called at the start of `main()` — captures global window errors and unhandled promise rejections from that point forward.
- `captureError(e, { phase })` called in all three top-level catch blocks: `redraw`, `init-redraw`, and `main()`.

---

### 2) Top 5 crash fixes

#### Crash 1 — `arrow-view.js:119-120`: `elCalibrate`/`elCapture` null dereference
**Was:** `elCalibrate.addEventListener(...)` unconditionally — crashes if either button is missing from HTML, leaving the camera module partially initialised.
**Fix:** Added null guards: `if (elCalibrate)` / `if (elCapture)` before both `addEventListener` calls.

#### Crash 2 — `arrow-view.js:179-180`: `enableSensors()` null dereference
**Was:** `elCalibrate.hidden = false` and `elCapture.hidden = false` with no null checks. Called inside `showCameraView()` on every camera-mode entry — crashes on iOS if either element is missing.
**Fix:** Added `if (elCalibrate)` / `if (elCapture)` guards around both assignments.

#### Crash 3 — `arrow-view.js`: `showCameraView`/`hideCameraView`/`startCamera`/`stopCamera` null dereference
**Was:** `elView.hidden`, `elVideo.srcObject` used without null checks. If `initCameraView()` threw before these were set, subsequent camera-mode switches crash.
**Fix:** Added `if (elView)` / `if (elVideo)` guards in all four functions.

#### Crash 4 — `arrow-view.js:tick` + `renderAR`: partially initialised AR elements
**Was:** `tick()` calls `elDisk.hidden` without checking `elDisk`. `renderAR()` accesses `elArCaster`, `arShadowLine`, `arPoleLine` etc with only an `!elArOverlay` guard — any of the child elements could be null if the overlay was missing during init.
**Fix:** Added `!elDisk` guard at top of `tick()`. Added comprehensive entry guard to `renderAR()` checking all six AR elements.

#### Crash 5 — `shadow.js`/`sun-path.js`: NaN propagation from `project3D`
**Was:** `project3D()` can return non-finite `x`/`y` values at extreme zoom levels or when the camera transform is in an invalid state. These values were passed directly into `SVG.setAttribute` (producing `"NaN,NaN"` polyline strings) and `MapLibre.Marker.setOffset` (causing silent failures or downstream exceptions).
**Fix:**
- `shadow.js renderOverlay`: Added `isFinite` checks on `groundScreen`, `floorScreen`, `casterTopScreen`, `bodyScreen`, and `endPt` before any SVG attribute write. Returns early and hides affected elements instead of writing bad values.
- `sun-path.js offsetForSample`: Returns `[0, 0]` when `dx`/`dy` are non-finite.
- `sun-path.js renderDropLine`: Returns with opacity 0 when ground projection is non-finite.
- Also added `isFinite(observer.lat/lon)` guard at top of `renderOverlay` to prevent projecting invalid coordinates.

---

### Files changed
- `js/monitor.js` — new file
- `js/app.js` — import + init monitor; `captureError` in 3 catch blocks; comments on toast handlers
- `js/ui/arrow-view.js` — null guards on `elCalibrate`, `elCapture`, `elView`, `elVideo`, AR elements; `tick` early-exit on null `elDisk`; `calibrate` null guard
- `js/layers/shadow.js` — `isFinite` guards throughout `renderOverlay`
- `js/layers/sun-path.js` — `isFinite` guards in `offsetForSample` and `renderDropLine`
- `sw.js` — cache bumped `v36` → `v37`
- `index.html` — asset strings bumped to `?v=37`; Sentry CDN instructions added as comments

---

### Remaining known risks
- **Observer coordinates from hash**: `share.js` parses lat/lon with `parseFloat` from the URL hash. If the hash is malformed, `observer.lat`/`lon` could be NaN. The `renderOverlay` guard now stops this from crashing the SVG layer, but the arc and reflection layers would also get NaN inputs. Worth adding validation in `share.js` / `attachHashSync` if hash-sharing is used in the wild.
- **`captureFrame` canvas failure**: `out.getContext('2d')` can return null (e.g. too many canvases). Wrapped in try/catch so it won't crash, but the download silently fails.
- **AR coordinate frame on Android**: `deviceorientationabsolute` is preferred but not universal. The fallback `deviceorientation` uses `360 - alpha` which is only a compass heading approximation and drifts on some devices. Not a crash, but produces incorrect AR alignment.
- **Moon arc in moon mode**: `getArcSamples()` returns the arc built by the most recent `updateSunPathDay` call. If the user switches to moon mode before the first day-level recompute, the samples are from a prior sun arc. No crash, but AR dots would be misplaced briefly.
- **`compassPitch` → `map.setPitch`**: Not wrapped in try/catch. If MapLibre rejects an out-of-range pitch value, this throws in the `subscribeAll` callback. Low probability but worth a future guard.

---

## Part 10 — Shadow geometry redesign + UI persistence (2026-05-05)

### Changes

#### 1) Shadow geometry redesign (`js/layers/shadow.js` — full rewrite of `update()` + `renderOverlay()`)

**Problem 1: Sky line misalignment at low sun angles / high caster**
The old code capped shadow distance at `MAX_SHADOW_KM = 4km`. When the shadow was longer than that, the capped endpoint was placed at the wrong lat/lon — meaning the sky line from body → caster → capped endpoint was geometrically invalid. The polyline FORCED it through the caster sphere visually, but the endpoint dot was in the wrong place, and the near-horizon case still looked broken because the line had to bend around the cap.

**Fix:** Shadow is hidden entirely (endMarker removed, sky line hidden) when `flatKm >= MAX_SHADOW_KM`. No more capping to a misleading position. The geometry is either correct or absent.

**Problem 2: Floor slider raised the caster and arc, not the shadow endpoint**
Old model: `totalH = FLOOR_H_M + OBJECT_H_M`. Raising floor raised the caster above the white dot, and the shadow still landed on the ground. This was inverted from the intended meaning.

**New model:**
- Caster is always at `OBJECT_H_M` above the white ground dot. Changing floor does NOT move the caster.
- The floor surface is a horizontal plane at `FLOOR_H_M` above ground. The shadow lands on this surface.
- Effective shadow height = `shadowH = OBJECT_H_M − FLOOR_H_M` (only the portion of the caster above the floor casts a shadow onto it).
- Shadow endpoint dot (orange) is elevated to `FLOOR_H_M` height above its ground lat/lon via `project3D`.
- Green dot appears at ground level directly below the shadow endpoint (same lat/lon, no offset).
- Green vertical line connects ground dot to elevated shadow endpoint.
- If `FLOOR_H_M >= OBJECT_H_M`, no shadow exists (floor is at or above the caster) — shadow hidden.
- `setAnchorLiftMetres(OBJECT_H_M)` — floor no longer contributes to arc lift. The arc/body stays centred on the caster top.

**Sky line geometry:** body → caster (at `OBJECT_H_M`) → shadow endpoint (at `FLOOR_H_M`) are geometrically collinear (all on the same sun ray by construction), so the polyline looks straight.

#### 2) AR shadow geometry (`js/ui/arrow-view.js`)
- Import `getFloorHeight`.
- Shadow distance now uses `shadowH = casterH − floorH` (matching map view).
- Shadow endpoint placed at `floorH − EYE_HEIGHT_M` in world Z (elevated to floor height).
- Shadow hidden when `dist >= 4000m`, matching map view's hide-instead-of-cap behaviour.

#### 3) UI state persistence (`js/app.js`)
- `saveUI()`: writes `{casterH, floorH, radius, tilt}` slider values to `localStorage['sun_ui']` on every input event.
- `restoreUI(map)`: reads the saved values, sets slider elements, calls `setShadowHeight`, `setFloorHeight`, `setArcRadiusKm`, `map.setPitch` to apply them immediately.
- `restoreUI()` is called just before `applyRadius()` so the restored radius is used in the initial arc render.
- Observer / datetime / mode are already persisted via URL hash (`attachHashSync`).

### Files changed
- `js/layers/shadow.js` — full redesign of update() and renderOverlay(); revised header comment
- `js/ui/arrow-view.js` — import getFloorHeight; updated AR shadow calc
- `js/app.js` — saveUI/restoreUI functions; saveUI wired to all four slider inputs; restoreUI called on init
- `sw.js` — cache bumped `v37` → `v38`
- `index.html` — asset strings bumped to `?v=38`

---

## Part 11 — Tap-to-edit height inputs (2026-05-05)

### Change
The `<span>` value displays in the Caster and Floor rows were replaced with `<input type="number">` fields. This gives two interaction modes on each row:

- **Slider** (coarse): drag to sweep the value; number field updates in sync.
- **Number field** (precise): tap the displayed number, type an exact metre value (0–1000), press Enter or blur. The slider snaps to the nearest representable position via the inverse log formula (`heightToSlider`).

### Implementation
- `index.html`: `<span id="shadow-elev-val">` → `<input class="elev-num" type="number" inputmode="numeric">` + `<span class="elev-unit">m</span>`. Same for `floor-elev-val`.
- `css/style.css`: `.elev-num` — borderless, transparent background, underline border that highlights cyan on focus; spinner buttons hidden. `.elev-unit` — dimmed "m" label.
- `js/app.js`:
  - `heightToSlider(h)`: inverse of `sliderToHeight` — `max(1, round(1000 * ln(h) / ln(1000)))`. Used to snap the slider when the user types a value.
  - Slider `input` handlers: now set `dom.*ElevVal.value` (was `.textContent`).
  - Number input `change` handlers: clamp 0–1000, call `setHeight`, snap slider, call `saveUI`.
  - `restoreUI`: switched from `.textContent` to `.value` assignments.
- `sw.js` / `index.html`: bumped to `v39`.

### Files changed
- `index.html` — replaced spans with number inputs
- `css/style.css` — `.elev-num` and `.elev-unit` rules
- `js/app.js` — `heightToSlider`, updated handlers, `change` event listeners
- `sw.js` — `v38` → `v39`

---

---

## Part 12 — Spherical slider thumbs + idle perspective drift (2026-05-05)

### Change 1: Spherical slider thumbs
All four sliders (tilt vslider, radius vslider, Caster elev-row, Floor elev-row) now have circular sphere-style thumbs instead of flat rectangles or browser defaults. The thumb uses a radial gradient (`white → light blue → steel blue`) to suggest a sphere lit from upper-left. The vertical sliders were previously 28×12 px rectangles (hard to grab on a phone) — now 24×24 px circles.

### Implementation (css/style.css)
- `.vslider::-webkit-slider-thumb` / `::-moz-range-thumb`: changed from `width:28px; height:12px; border-radius:4px` to `width:24px; height:24px; border-radius:50%` with radial gradient and updated `margin-left:-11px`.
- `.elev-row input[type=range]`: added `-webkit-appearance:none` / `appearance:none` plus custom track background. Added `::-webkit-slider-thumb` / `::-moz-range-thumb` with 20×20 sphere style matching the vslider thumbs.

### Change 2: Idle perspective drift
After 4 seconds of no map interaction, the map gently oscillates its bearing (±2°, ~16 s period) and pitch (±1.5°, ~22 s period) to preserve the 3D depth effect when static. Stops immediately on any canvas interaction and eases back to the base position over 600 ms.

### Implementation (js/app.js)
- Module-level drift state: `_driftRafId`, `_driftBaseBearing`, `_driftBasePitch`, `_driftT0`, `_lastInteract`, `DRIFT_IDLE_MS = 4000`.
- `_driftFrame(ts)`: RAF loop; exits if camera mode or compass active.
- `stopDrift()`: cancels the RAF loop; calls `map.easeTo()` to glide back to base bearing/pitch over 600 ms; resets `_lastInteract`.
- `_startDrift()`: captures current bearing/pitch as base; starts RAF loop.
- In `main()`:
  - Canvas `mousedown` / `touchstart` / `wheel` listeners call `stopDrift()`.
  - `setInterval(1000)` checks `Date.now() - _lastInteract > 4000` and calls `_startDrift()`.
  - `map.on('pitch', ...)` tilt-slider sync skips update when `_driftRafId` is set (prevents slider jitter during drift).
- `tryGeolocate()`: calls `stopDrift()` at entry so flyTo doesn't conflict.

### Files changed
- `css/style.css` — vslider and elev-row range thumb styles
- `js/app.js` — drift state + functions + wiring
- `sw.js` — `v39` → `v40`
- `index.html` — asset strings bumped to `?v=40`

---

---

## Part 13 — Polish pass: depth, touch, lines, scale (2026-05-06)

### Arc dot z-ordering
Arc markers now update their CSS `z-index` to match their projected screen Y position (computed in `updateAllOffsets`). Higher screen Y = closer to camera in pitched view = higher z-index = drawn in front. The live (head) dot is always at `z-index: 9999`. This fixes the backwards depth cue where near-horizon dots were appearing in front of overhead dots.

### Arc dot perspective size
Dots now scale with `5 + 5 * sin(altDeg)` px, giving 5 px at the horizon and 10 px at zenith. Overhead dots appear larger (closer), horizon dots appear smaller (farther). Size is set inline when each dot element is created in `updateSunPathDay`.

### Solid sunrise/sunset lines with faded ends
`SR_SRC` and `SS_SRC` GeoJSON sources now use `lineMetrics: true`. Layer paint changed from `line-color + line-dasharray` to `line-gradient` with transparency at 0% and 100% progress (both endpoints) and full opacity from 18%–82%. Dasharray removed.

### vslider touch area
`width: 22px` → `44px`, `right: 12px` → `4px`. Track and thumb are visually unchanged (1.5 px track, 24 px sphere thumb). The element is wider on both sides, giving a much larger grab zone on mobile.

### Elev-row slider touch area
Added `height: 24px` to the elev-row range inputs (was 4 px). Track drawn via `::webkit-slider-runnable-track` at 4 px, so visuals are unchanged while touch target is 6× larger.

### Slider spacing and bottom overflow
- Tilt slider: `height` reduced from `33vh - 30px` to `33vh - 44px` (more gap between sliders).
- Radius slider: `top: 33vh + 24px` (was `33vh + 14px`); height now `calc(67vh - 280px - var(--safe-bottom))` with `min-height: 40px`. This anchors the bottom of the slider to a safe distance above the dock even when the shadow panel is open (~228 px tall).

### Scale bar
`maplibregl.ScaleControl({ maxWidth: 80, unit: 'metric' })` added to `bottom-left` after map style is ready. CSS: `.maplibregl-ctrl-bottom-left` removed from hidden list and positioned at `bottom: calc(safe-bottom + 170px)`. Scale bar styled with dark glass background to match the app theme. Previously `.maplibregl-ctrl-bottom-left` was hidden by the blanket hide rule; now only attrib, top-left, top-right, and bottom-right are hidden.

### Invert mode marker color fix
Removed the `body.invert .arc-dot / .caster-sphere / .shadow-end / #shadow-svg { filter: invert(1)... }` rules. These were double-inverting the markers when the map canvas was inverted (trying to keep them looking the same but producing incorrect hues). The canvas filter only affects the raster canvas; markers are DOM elements that were already unaffected. Removing the rules leaves marker colors natural in both light and dark map modes.

### Not implemented this pass
- Small/backyard mode (grid, no map) — significant feature, needs separate scope.
- Map pan speed dampening at top of pitched viewport — inherent to MapLibre perspective math; would require overriding all drag handlers.

### Files changed
- `css/style.css` — controls visibility, scale bar styles, invert fix, vslider width, elev-row height, slider positioning
- `js/layers/sun-path.js` — z-ordering in `updateAllOffsets`, size scaling in `updateSunPathDay`, solid+gradient SR/SS lines
- `js/app.js` — `map.addControl(ScaleControl)`
- `sw.js` — `v40` → `v41`
- `index.html` — asset strings bumped to `?v=41`

---

---

## Part 14 — Grid mode + top-of-screen pan guard (2026-05-06)

### Map top-of-screen pan guard
At high pitch, the top 28% of the map canvas maps to the distant horizon. A 1 mm drag there moves the map by kilometres. Fix: capture-phase `touchmove` listener on the map canvas blocks single-touch moves originating in the top 28% by calling `stopImmediatePropagation()`. Multi-touch (pinch-to-zoom) and taps pass through unaffected.

### Grid mode (`js/layers/grid.js`, new)
A graph-paper style SVG overlay that replaces the tile map in "backyard" use. The map canvas fades to `opacity: 0` (CSS transition) while the `#map` dark background and all DOM markers (arc, shadow, etc.) remain fully visible. MapLibre continues running in the background — its projection math and `map.project()` are used for all coordinate transforms, so the grid has correct perspective foreshortening with map pitch.

**Cell auto-scaling:** `pixPerMetre()` computes a screen pixel/metre ratio from two projected points. `pickCell()` picks the nice step value (e.g., 1 cm, 10 cm, 1 m, 10 m …) that puts ~60 px between grid lines. At zoom 24 (~4 m view) this gives 1 m major / 0.1 m minor; at zoom 20 (~60 m view) it gives 10 m major / 1 m minor.

**Line hierarchy:** Axis lines (through observer) at opacity 0.5, major lines (every 10 cells) at 0.22, minor lines at 0.07. Labels shown at major lines crossing the observer's screen row/column.

**Imperial toggle:** `unit-btn` in the dock (visible only in grid mode) toggles metric ↔ imperial. State persisted in `localStorage['sun_grid_unit']`. Imperial uses nice foot steps expressed in metres; labels show `"`, `'`, or mi.

**Transition:** Tap Grid → tiles fade out over 0.55 s + `map.flyTo({zoom:24})` simultaneously. The observer pin is kept centred; all arc/shadow overlays remain on top. Tap Grid again or switch to camera → `map.flyTo({zoom:14})` + tiles fade back in.

**Location model:** The observer (set by tapping the regular map, geolocation, or search) is the grid origin. Tapping the map in grid mode moves the origin. The user sets location on the regular map first, then taps Grid — the fly-in animation makes this feel intentional.

### `map.js`
`maxZoom: 24` added so `map.flyTo({zoom: 24})` is reachable.

### Files changed
- `js/layers/grid.js` — new (140 lines)
- `js/map.js` — maxZoom: 24
- `js/app.js` — import; `_enterGrid` / `_exitGrid`; grid-toggle + unit-toggle wiring; observer subscription; touch guard
- `index.html` — grid-toggle and unit-toggle buttons; `?v=42`
- `css/style.css` — canvas transition, `body.grid-mode` tile fade, unit-btn visibility, grid-toggle active colour
- `sw.js` — `v41` → `v42`

---

---

## Part 15 — Camera mode 2.0 phase 1: visual calibration + FOV presets (2026-05-06)

### Visual sun/moon calibration
The Align button now performs a true two-axis visual calibration. The user aims the centre of the camera at the actual sun (or moon) and taps Align. Implementation: compute the camera-forward direction in world ENU coordinates as `R · [0,0,−1]`, convert to (camAz, camEl), and store the discrepancy vs. the body's astronomically-calculated (az, el) as `azCalibOffset` and `elCalibOffset`. Both are persisted to `localStorage['sun_cam_calib']` so a single calibration survives reloads.

The on-screen crosshair (centre of the screen, white circle with cardinal ticks) gives the user a precise aim point.

The previous calibration was heading-only and used the smoothed sensor heading at tap time as a "snap to truth" rule, which was wrong: it didn't compensate for actual aim error or for pitch bias. The new method handles both.

**Long-press on Align clears calibration** (700 ms hold → both offsets reset to 0, label flashes "Cleared").

### FOV preset toggle
0.5× / 1× / 2× pill at the top of the camera view, mapping to 80° / 55° / 30° horizontal screen FOV. Selection persisted in `localStorage['sun_cam_fov']`. The `HALF_HFOV_TAN` constant was replaced with a runtime `halfHfovTan` that is recomputed when the preset changes; vertical FOV is still derived from screen aspect ratio.

### Smoother orientation
`HEADING_SMOOTHING` 0.10 → 0.08, `TILT_SMOOTHING` 0.15 → 0.10 — heavier exponential filter, less twitch when phone is held still.

### Files changed
- `js/ui/arrow-view.js` — calibration math (camera-forward method); two-axis offsets persisted; FOV preset state + `setFovPreset()`; long-press clear; smoothing tweak
- `index.html` — `#cam-crosshair` SVG, `#cam-fov-row` with three buttons; `?v=43`
- `css/style.css` — crosshair + FOV row styles, only visible in `body.view-camera`
- `sw.js` — `v42` → `v43`

### Not implemented this pass (per scope)
- WebXR fast path (Android-only; iOS has no support)
- Continuous sun-spot detection (flaky; flag-gated for later)
- Time-lock + share preview (user said screenshot is fine)
- Lens picker via `enumerateDevices` (defaults are good enough)

---

---

## Part 16 — Grid mode bugfixes (2026-05-06)

### Bug: arc/shadow graphics break in grid mode and don't recover on exit
**Root cause:** at zoom 24, MapLibre's camera altitude drops to ~6.7 m AGL while default arc altitudes (e.g. 680 m radius × sin(30°) = 340 m) are far higher. `project3D` falls through its "camera below body" guard and returns the flat ground projection, collapsing all arc dots to ground positions. The day-level arc was never rebuilt on entry/exit, so the breakage persisted after switching back.

**Fix:**
- Grid entry zoom dropped from **24 → 21** (~21 m wide, camera ≈ 54 m AGL — well above any ≤10 m arc apex).
- Arc radius is now **forced to 10 m on grid entry** (saved slider value restored on exit). The `setArcRadiusKm` floor was lowered from 20 m to 5 m to allow this.
- A `_refreshLayers(map)` helper is fired on `moveend` after both the entry and exit `flyTo` animations, calling `updateSunPathDay` + `updateSunNow` so the arc rebuilds against the new zoom/centre.

### Bug: unit toggle pushed off-screen
**Root cause:** the dock's control row had grown to 10 buttons; with grid mode adding the unit toggle, total width exceeded the screen on small phones.

**Fix:** the unit toggle is removed from the dock and rendered as a floating pill in the top-left corner (matching the camera FOV pill style). Only visible when `body.grid-mode` is set. This keeps the dock compact and the toggle obviously available without crowding.

### Files changed
- `js/layers/sun-path.js` — `setArcRadiusKm` floor 0.02 → 0.005
- `js/app.js` — `_enterGrid` saves slider, sets 10 m radius, zoom 21, `moveend` refresh; `_exitGrid` restores radius from saved slider, `moveend` refresh; `_refreshLayers` helper
- `index.html` — `#unit-toggle` moved out of `#control-row` to be a top-level floating element
- `css/style.css` — new `#unit-toggle` floating pill rules; old `.unit-btn` rules removed
- `sw.js` — `v43` → `v44`

---

## Session summary (2026-05-05 full session)

Versions v36 through v39 were produced in this session. Key changes in order:

| v | What |
|---|------|
| v36 | Polyline fix: sky line forced through caster sphere via explicit body→caster→shadow waypoints |
| v37 | Error monitoring (`js/monitor.js`): localStorage ring buffer, Sentry hook; crash hardening in `arrow-view.js`, `shadow.js`, `sun-path.js` |
| v38 | Shadow geometry redesign: caster fixed at OBJECT_H_M, floor surface at FLOOR_H_M, shadow hidden when too long, green ground-ref indicator. UI persistence (sliders to localStorage). AR shadow updated to match. |
| v39 | Tap-to-edit number inputs for Caster and Floor height rows. |
| v40 | Spherical slider thumbs (all four sliders). Idle perspective drift (±2° bearing, ±1.5° pitch oscillation after 4 s idle; stops on interaction). |
| v44 | Grid mode bugfixes: zoom 24 → 21, arc radius auto-shrunk to 10 m on entry (lower floor 5 m); `moveend` triggers `updateSunPathDay`/`updateSunNow` so arc rebuilds at new scale on entry+exit; unit toggle moved out of dock to a floating top-left pill. |
| v43 | Camera mode 2.0 phase 1: visual sun/moon calibration (camera-forward method, both az+el offsets, persisted), FOV preset toggle (0.5×/1×/2×), centre crosshair, smoother sensor filter, long-press to clear calibration. |
| v42 | Grid mode (graph-paper SVG overlay, auto-scaling, metric/imperial, fly-in transition). Top-of-screen pan guard (28% zone blocked for single-touch drag). |
| v41 | Arc dot z-ordering (screen-Y-based, correct depth cue with map pitch). Arc dot perspective size scaling (5–10 px by altitude). Solid sunrise/sunset lines with gradient fade at both ends. Wider vslider touch area (44 px). Wider elev-row slider touch area (24 px tall hit zone). Scale bar (MapLibre ScaleControl, bottom-left, styled). Slider spacing and bottom-overflow fix. Invert mode no longer double-inverts arc/shadow markers (colors stay consistent). |
| v45 | Arc dot density-aware sizing: `updateAllOffsets` computes average inter-dot screen gap and caps rendered size so dots shrink proportionally when zoomed out (prevents bunching). Drift jitter fix: per-marker offset cache in `updateAllOffsets` skips `setOffset`/`zIndex` DOM writes when change is sub-pixel (< 1px), eliminating ±1px jitter during idle drift. |
| v46 | Stability pass (see Part 17). Grid mode DOM thrashing fixed; `redraw()` layer isolation; drift guard. |

---

## Part 17 — Stability Pass (2026-05-08)

**Fixes implemented based on cross-audit of internal AUDIT.md, Gemini-3-Flash audit (2026-05-07), and GPT-5 mini audit (2026-05-07). Priority: stop the app crashing on mobile.**

---

### Fix 1 — Grid mode DOM thrashing (`js/layers/grid.js` — rewrite of render path)

**Root cause (Gemini CRITICAL-P1):** The original `_render()` called `_clear()` on every `map.on('render')` event (up to 60fps during pan/zoom), which removed all SVG children and then recreated **800+ `<line>` elements** plus `<defs>`, `<clipPath>`, and a `<g>` container from scratch. On mid-range phones this caused extreme GC pressure and layout thrashing — the primary cause of the app crashing or freezing in grid mode.

**Fix:** Three persistent `<path>` elements (`pathMinor`, `pathMajor`, `pathAxis`) are created once in `initGrid()` and appended to a persistent group. On each `_render()`, path data strings are built as `M x,y L x,y` concatenations and set via a single `setAttribute('d', ...)` call per path. No DOM nodes are created or destroyed during pan/zoom.

**Result:** DOM element count during grid render drops from ~810 created+destroyed per frame to 3 attribute writes. Labels (`<text>` elements) are still recreated each frame but their count is capped to ~5–15 visible major-line labels — acceptable.

**Files:** `js/layers/grid.js` — complete rewrite of `_render()`, `initGrid()`, `setGridEnabled()`; removed `_line()` helper (no longer needed); added `_makePath()` helper.

---

### Fix 2 — `redraw()` layer isolation (`js/app.js`)

**Root cause (Gemini CRITICAL-A1 / GPT H3):** `redraw()` called all layer update functions in sequence with no per-call error handling. If any single call threw (e.g. `updateSunPathDay`, `updateShadow`, `syncChrome`), the rest of the frame's updates were skipped — leaving the UI in a partially-rendered state until the next state change. The outer try/catch in `subscribeAll` caught the error and showed a toast, but the remaining updates for that frame were lost.

**Fixes applied:**
1. **NaN observer guard**: Added at the top of `redraw()` — if `s.observer.lat` or `.lon` is not finite, return immediately. Prevents the entire update pipeline from running against garbage coordinates (e.g. from a malformed URL hash).
2. **Per-layer try/catch**: `updateSunPathDay`, `updateReflectionDay`, `updateSunNow`, `updateReflectionNow`, `updateShadow`, `syncChrome`, `updateCameraView`, and `setTarget` are each wrapped in their own `try/catch`. A failure in one layer no longer prevents the others from updating. All caught errors are forwarded to `captureError()` for the monitor ring buffer.

**File:** `js/app.js` — `redraw()` function.

---

### Fix 3 — Drift loop guards (`js/app.js`)

**Root cause (Gemini MEDIUM-2 / AUDIT.md known risk):** Two issues in the idle drift system:
1. `_driftFrame()` called `map.setBearing()` and `map.setPitch()` without try/catch. MapLibre can throw for out-of-range or invalid values (e.g. if the map is in a destroyed state during teardown), which would propagate as an unhandled exception from inside a `requestAnimationFrame` callback.
2. `_startDrift()` could start a drift oscillation on top of an in-progress `flyTo` or `easeTo` (e.g. after grid mode entry/exit), causing the animations to fight each other.

**Fixes:**
- `_driftFrame()`: wrapped both `map.setBearing()` and `map.setPitch()` in `try/catch {}`. Errors are silently swallowed since a failed frame in the drift loop is inconsequential — the next RAF tick will try again.
- `_startDrift()`: added `if (map.isMoving && map.isMoving()) return;` guard before starting the RAF loop. This prevents drift from starting during active programmatic animations.

**File:** `js/app.js` — `_driftFrame()` and `_startDrift()` functions.

---

### Note on share.js NaN propagation

The GPT-5 mini audit (C3) and the internal AUDIT.md (Part 9 "Remaining known risks") both flagged `share.js` as potentially propagating NaN observer coordinates from malformed URL hashes. **On inspection, this was already fixed:** `decodeHashToState()` guards both `ll` and `tg` with `Number.isFinite(lat) && Number.isFinite(lon)` before assigning to state. The `redraw()` NaN guard added in Fix 2 provides an additional defence-in-depth layer in case any other code path sets a non-finite observer.

---

### Files changed
- `js/layers/grid.js` — render path rewrite (persistent paths)
- `js/app.js` — `redraw()` isolation, `_driftFrame()` guard, `_startDrift()` guard
- `sw.js` — cache bumped `v45` → `v46`
- `index.html` — asset strings bumped to `?v=46`


---

## Part 18 — v47: Bug fixes + DATA panel + Alignment wizard + UI polish (2026-05-08)

### Bugs fixed

**Bug 1 — Orange ray line disappears when caster height = 0 (`js/layers/shadow.js`)**
`renderOverlay()` returned early with `lineSky opacity=0` whenever `!endMarker` (i.e. caster = 0, no shadow endpoint). This hid the body→observer light ray even when the body was above the horizon.

Fix: when `!endMarker`, retrieve the live body anchor and draw a 2-point sky line from body screen position to `casterTopScreen` (which equals `groundScreen` when caster = 0). The light ray is now always visible whenever the body is above the horizon, regardless of whether a shadow endpoint exists.

**Bug 2 — Map reload goes to last camera position instead of observer (`js/app.js`)**
`initMap()` correctly initialises map center at `init.observer`, but if the user panned the map away from the observer pin before closing, the pan position was retained in memory. On reload the map showed the last panned location rather than the observer.

Fix: added `map.jumpTo({ center: [init.observer.lon, init.observer.lat] })` immediately after `await whenStyleReady(map)`. The map always opens centered on the observer.

**Bug 3 — Grid mode hides SR/SS/RAY ground lines (`js/layers/sun-path.js`)**
`body.grid-mode .maplibregl-canvas { opacity: 0 }` hides the entire MapLibre canvas, including the sunrise/sunset vector lines (SR_LINE, SS_LINE) and ray line (RAY_LINE), which are MapLibre GL layers rendered on the canvas.

Fix: added a separate SVG overlay (`gridLinesSvg`) in `sun-path.js` containing three persistent `<line>` elements mirroring SR/SS/RAY. `setLine()` now caches the last coordinates for each source. A `map.on('render', _renderGridLines)` handler reprojects cached coordinates using `map.project()` on each frame. `setGridModeLines(active)` shows/hides this SVG, called from `_enterGrid`/`_exitGrid` in `app.js`.

---

### CSS / UI fixes

**Fix 4 — Caster/floor slider label alignment (`css/style.css`)**
Added `margin: 0; padding: 0; align-self: center;` to `.elev-row input[type=range]` to fix vertical centering on iOS where the range input could add unexpected margins.

**Fix 5 — Radius slider overlaps dock on mobile (`css/style.css`)**
Increased the bottom clearance buffer from 280px to 305px in `.vslider.radius height: calc(67vh - 305px - var(--safe-bottom))`. The shadow elevation panel is always visible in map mode, adding ~100px to the dock's height; the old value of 280px was borderline and caused the slider bottom to overlap the dock on shorter phones.

**Fix 6 — Grid mode shadow slider rescale (`js/app.js`)**
On grid entry: shadow/floor slider max is changed from 1000 to 10 (metres), step to 0.1; values reset to 0. `sliderToHeight`/`heightToSlider` switch to a linear 0–10 m mapping when `_gridShadowMode = true`.
On grid exit: max/step restored to 1000/1, saved pre-entry values restored.

---

### New features

**Feature 7+8 — DATA button and panel (`index.html`, `css/style.css`, `js/app.js`)**
Replaced the clock/reminder button (`#reminder-btn`) with a DATA button (`#data-btn`). Tapping opens a glass panel above the dock showing:
- Row 1: white dot icon · observer lat, lon · caster height
- Row 2: orange or green dot icon · shadow endpoint lat, lon · height (green dot preferred when floor > 0)
- "Find Alignment" button that opens the alignment wizard

**Feature 9 — Alignment wizard (`index.html`, `css/style.css`, `js/app.js`, `js/alignment.js`)**
Two-step mode to find when the sun or moon aligns between two user-defined points:
- Step A: pre-filled from current observer lat/lon and caster height; user can tap map to adjust position; height editable via number input
- Step B: user taps map to set target point; height editable
- Search: `findAlignmentBetweenPoints()` scans forward in 5-minute steps for up to 1 year; checks both azimuth and altitude within ±1° tolerance
- Match: scrubber jumps to the result datetime; toast shows date + time
- Map click handler in `app.js` is intercepted during `_alignStep === 'a'` or `'b'`

New function in `alignment.js`:
```js
export function findAlignmentBetweenPoints(pointA, pointB, fromDate, moonMode, toleranceDeg)
```
Uses `haversineM()` for distance, `compassBearing()` for required azimuth, `atan2(hDiff, dist)` for required altitude. Imports `getMoonPos` and `bearing` from existing modules.

**Feature 10 — Tap time display to set exact time (`js/app.js`)**
Tapping `#time-hh` creates a hidden `<input type="time">` and programmatically clicks it (native time picker on all platforms). On change, updates `store.datetime` with the new hours/minutes on the current date. Cursor set to `pointer` and `:active` opacity added.

---

### Files changed
- `js/layers/shadow.js` — Bug 1 fix; added `getShadowEndLngLat()`, `getFloorDotLngLat()` exports
- `js/layers/sun-path.js` — Bug 3 fix: grid SVG overlay, `setGridModeLines()` export, `setLine()` coord cache
- `js/app.js` — Bug 2 fix; grid rescale; DATA panel; alignment wizard; time tap; updated imports
- `js/alignment.js` — Added `findAlignmentBetweenPoints()`, `haversineM()`, `getMoonPos` import
- `css/style.css` — Fixes 4, 5; DATA panel styles; alignment wizard styles; time-hh cursor
- `index.html` — DATA btn, data panel, alignment wizard HTML; bumped to `?v=47`
- `sw.js` — Cache bumped `v46` → `v47`

---

## Part 22 — v69: Photo-view rebuilt as custom three.js scene (2026-05-20)

v67/v68 photo-view fought MapLibre's camera model and lost. At pitch=85 with zoom 14, MapLibre's camera sits ~6km behind the observer — so "photo-view" was really "looking at the observer from across the city," with the sun arc collapsed to a near-flat line at horizon and no z-axis. CSS underground rotation made it worse, not better, because the projection math didn't compose with the post-render transform.

v69 abandons that approach. Photo-view is now a separate three.js scene rendered into a fullscreen canvas overlay on top of MapLibre, with:
- Virtual camera at the **yellow dot** (shadow endpoint lat/lon = where the photographer needs to stand), eye height 1.6m above the floor surface
- Camera position fixed at enter time (anchor); time scrubbing only moves the sun
- Real ENU-projected positions for the caster, sun ball, arc dots, sky line
- **Local map tiles as ground texture**: snapshotted at enter time by briefly jumping MapLibre to top-down view over the camera→caster corridor, screenshotting its canvas, restoring MapLibre's state
- **Corridor fade shader**: ground-plane alpha fades by stadium-shaped distance from the line segment between camera and caster (full opacity inside corridor, smoothstep to 0 outward)
- Drag = swivel (X→yaw, Y→pitch), pinch = FOV (out=zoom in, in=zoom out)
- Auto-orient at enter: bearing + pitch toward the caster top
- Smooth 320ms opacity transition on enter and exit

### New files
- `js/ui/photo-3d.js` (~430 lines) — the entire 3D scene, gestures, tile-snapshot pipeline, corridor shader

### Removed from `js/app.js`
- `_photoActive`, `_photoElev`, `_photoSavedPitch/Bearing/Zoom` state
- `_applyPhotoElev`, `_enterPhotoView`, `_exitPhotoView`, `_initPhotoGestures` functions
- All guards keyed on `_photoActive` switched to `isPhoto3DActive()` (the three.js scene fully overlays MapLibre, so most guards become no-ops in practice)

### Other v69 changes
- `js/layers/shadow.js`:
  - **200ms fade-out** for invalid `endMarker` / `floorDot` / sky line / pole / floor line. Replaced `.remove()` calls with opacity-toggle pattern; markers stay in DOM, fade via CSS `transition: opacity 200ms ease`.
  - Added `_endValid` / `_floorValid` validity flags so `getShadowEndLngLat()` / `getFloorDotLngLat()` (consumed by photo-3d gating) report null while a marker is fading out.
  - Helpers: `_showEndMarker()`, `_hideEndMarker()`, `_showFloorDot()`, `_hideFloorDot()`.
- `js/app.js`:
  - Imports + initialises `photo-3d` module at boot.
  - Eye-button (photo-toggle) → `enterPhoto3D` / `exitPhoto3D`; disabled state when `canEnterPhoto3D()` returns false (no valid shadow endpoint).
  - `redraw()` updates the button's `is-disabled` class per frame based on shadow validity.
- `css/style.css` — new `.floating-toggle.is-disabled` style (32% opacity, not-allowed cursor).
- `index.html` — bumped `?v=69`.
- `sw.js` — cache `v68 → v69`.

### What still doesn't work / deferred
- **Caster sphere appears at the caster's lat/lon, lifted by `casterH`.** Since the current data model locks caster lat/lon to observer lat/lon, the caster sphere is at the observer position (NOT a separate subject position). User mentioned the CN-Tower-from-200m-away workflow expects caster≠observer. That requires the data model flip discussed and explicitly deferred.
- **Tile snapshot is static**: captured at enter time, doesn't update when caster height / floor / time changes (the camera position is fixed by anchor so this is mostly fine, but a clean re-snapshot on big state changes would be nice).
- **Caster pole drawn from caster ground (y=0) up to caster top**; floor offset of camera not visualised below the photographer.
- **Floor support is partial**: photographer eye at `floorH + 1.6`, but caster ground stays at y=0 (no separate floor surface rendered).
- **No date/time scrubbing animation**: the sun jumps to its new position when the scrubber moves; could ease.

---

## Part 21 — v68: Photo-view debug pass (2026-05-20)

User testing of v67 surfaced four issues. Diagnoses + fixes:

1. **"Sun arc set at the horizon, fucking up everything."** Not actually a bug in the arc — a fundamental MapLibre constraint. Max pitch is 85° (looking 5° below horizon), so anything above ~5° elevation is off the top of the screen. The existing `_setUndergroundView` CSS rotateX hack scales only to 35° max (line: `tilt = deg * (35/85)`), giving at best ~30° above horizon. For most sun arcs this means the arc dots are clipped off-screen and only the low-altitude ends are visible at the horizon line.
   **Fix:** Bumped factor from `35/85` → `60/85` so max sky-look reaches ~55° above horizon — enough to cover most mid-latitude sun arcs.

2. **"Compass mode from perspective would be awesome."** Removed the mutex in `_enterPhotoView`. They can coexist: when compass is on, the sensor drives bearing/pitch continuously; when off, drag handlers drive them. No fight because the existing `_touching` guard in the compass subscribers pauses sensor updates while the finger is down.

3. **"Yellow dot where the camera should be / perspective should be from that point."** The yellow dot the user saw is the live sun ball (`liveMarker`, class `arc-dot head`) — it appeared near the observer because the arc was clipped to horizon level (issue 1). The "perspective from that point" complaint is partly that the user wasn't looking at anything interesting on entry — bearing was wherever it had been before, often facing empty horizon.
   **Fix:** Auto-orient on `_enterPhotoView` — set bearing = current body azimuth, photo-elev = body altitude (clamped to 60° for our underground cap). User pops into photo-view already facing the sun/moon with the arc geometry in frame.

4. **"Smooth on enter, abrupt on exit."** Pure bug: `_exitPhotoView` called `map.setPitch()` / `map.setBearing()` directly. Replaced with `map.easeTo({pitch, bearing, zoom, duration: 600})`. Also saved zoom on entry so we can restore that too.

### Files changed
- `js/app.js` — bumped underground rotation factor 35°→60°; rewrote `_enterPhotoView` (no compass mutex, auto-orient to body, deferred `_applyPhotoElev` until after `easeTo` settles); rewrote `_exitPhotoView` (smooth `easeTo` for pitch/bearing/zoom); added `_photoSavedZoom` state
- `index.html` — bumped `?v=68`
- `sw.js` — Cache `v67 → v68`

### What this enables for the use case
Entering photo-view now opens with the user already facing the sun/moon. The sky-look range is wider, so they can see arcs that previously fell off-screen. Compass mode can be enabled on top of photo-view for true "hold up phone, see the geometry through it" interaction.

### Still outstanding
- Marker drift past 30° rotation gets noticeable (pre-existing limitation of the underground CSS hack — markers are inside `#map` so they ride along with the rotation, but body-level SVGs like drop line don't).
- The MapLibre camera at pitch=85 isn't *at* the observer — it's offset slightly back/up. True eye-position perspective would need a custom camera or three.js. Acceptable for prototype.

---

## Part 20 — v67: Photographer view — drag-to-swivel + pinch zoom (2026-05-20)

**Pivot.** v66's below-view (look up through map from below) was visually epic but the use case didn't justify the work: looking up through a map adds nothing the photographer's-eye view doesn't, and MapLibre Markers stuck on the ceiling killed the geometry-readability that's the whole point. Ripped it out. Replaced with **photographer view** — stand at the observer position, drag to swivel your gaze, pinch to zoom. Same camera model as Google Street View / 360 viewers.

### What changed

1. **v66 below-view scaffolding removed:**
   - `index.html` — removed `#scene-3d` wrapper, removed `#overlays-3d`, removed `#below-toggle`. `#map` is once again a direct body child.
   - `css/style.css` — removed `#scene-3d`, `#overlays-3d`, `body.below-view`, `body.below-view .maplibregl-ctrl-bottom-left` rules. Restored `#map { position: fixed }`.
   - `js/layers/shadow.js`, `js/layers/sun-path.js`, `js/layers/grid.js` — reverted overlay reparenting; SVGs are body children again.
   - `js/app.js` — removed below-toggle click handler.
   - `.floating-toggle` CSS class kept; reused by the new photo-toggle button.

2. **Photographer view added.** New floating top-right button (`#photo-toggle`, eye icon). On activate:
   - Disables `dragPan`, `dragRotate`, `touchPitch`, `touchZoomRotate`, `scrollZoom`, `doubleClickZoom`
   - flyTo's observer position at pitch=80
   - Sets `_photoElev = -5` (slight downward gaze), `body.photo-view` class on
   - Custom gesture handlers (installed once at boot, gated by `_photoActive`):
     - **Single-touch drag** — `dx → bearing` (direct manipulation: drag right = scene slides right = bearing decreases), `dy → photo-elevation` via new `_applyPhotoElev()` (drag down = scene slides down = camera looks up)
     - **Two-touch pinch** — log2 ratio → `map.setZoom`
     - **Mouse drag + wheel** — desktop fallbacks
   - Sensitivity: 0.28°/px (full screen swipe ≈ 100° rotation)
   - Mutually exclusive with compass mode (which also drives bearing/pitch)
   - On exit: restores prior pitch+bearing, re-enables all MapLibre gestures, pops out of underground

3. **`_applyPhotoElev(degAboveHorizon)`** — continuous mapping from photo-elevation angle to MapLibre state, bypassing the existing tilt-slider mapping which has a non-physical discontinuity at the 84↔85 boundary:
   - `elev ≤ 0` (looking down/horizon): `map.setPitch(85 + elev)`, clear underground
   - `elev > 0` (looking above horizon): `_setUndergroundView(-elev)` engages existing CSS rotateX hack
   - Slider value synced for visual feedback only

4. **Guards added:**
   - `map.on('click')` handler — early return when `_photoActive` so taps don't relocate the observer in photo-view
   - Top-of-screen pan guard — skipped when `_photoActive` so swipe gestures aren't blocked in the top 28% of the screen
   - `store.subscribe('observer')` — jumpTo new observer position while in photo-view

### Use case
Photographer wants to align a subject (e.g. CN Tower) with the setting sun for a shot. Existing top-down view shows alignment numerically/geometrically but doesn't convey the *visual* lineup the photographer will actually see through their lens. Photo-view gives them the eyewitness perspective — "stand at this spot, swivel, see when the sun arc loops around the tower pod." Drives a known-novel long-exposure shot composition (sun-arc-around-tower-pod) that's only obvious from photographer perspective.

### Known limitations (Phase-2.5 work)
- **Sky line + drop line (body-level SVGs) drift slightly** when looking above horizon — the underground CSS rotateX hack on `#map` doesn't apply to body-level overlays. Pre-existing issue from v62-v65, not introduced here.
- **Caster sphere is locked to observer lng/lat** by current shadow model — so it appears above the photographer's own position, not at a separate "subject" position. For the CN-Tower-from-200m-away shot, user currently has to use the alignment wizard (separate Point A and Point B). A future iteration could add a draggable subject pin distinct from the observer.
- **CSS rotateX capped at 35°** by existing `_setUndergroundView` math (`tilt = deg * 35/85`). Limits photo-view sky-look to ~30° above horizon. Adequate for most sun arcs at mid latitudes but could be extended.

### Files changed
- `index.html` — removed below-view wrappers; replaced `#below-toggle` with `#photo-toggle` (eye icon); bumped `?v=67`
- `css/style.css` — removed below-view CSS; restored `#map { position: fixed }`; kept `.floating-toggle`
- `js/layers/shadow.js`, `js/layers/sun-path.js`, `js/layers/grid.js` — reverted overlay reparenting
- `js/app.js` — removed below-toggle handler; added `_photoActive`/`_photoElev` state, `_applyPhotoElev()`, `_enterPhotoView()`, `_exitPhotoView()`, `_initPhotoGestures()`; wired photo-toggle button; added click + pan-guard + observer-subscribe guards
- `sw.js` — Cache `v66 → v67`

---

## Part 19 — v66: Below-view 3D prototype (Phase 2 spike) (2026-05-20)

**Goal.** Test feasibility of a true "look up through the map from below" view using CSS `transform-style: preserve-3d`, where body-level SVG overlays float above the (now-ceiling) map plane in genuine 3D space.

### What changed

1. **3D scene wrapper.** `#map` is now wrapped in `#scene-3d` (preserve-3d + perspective). A sibling `#overlays-3d` div sits as a +Z plane (translateZ(140px)) and hosts the lifted SVG overlays.
2. **Overlay reparenting.** SVG overlays previously appended to `document.body` now mount on `#overlays-3d` when available:
   - `js/layers/shadow.js` — sky/pole/floor SVG (`svgOverlay`)
   - `js/layers/sun-path.js` — drop-line SVG + grid-mode SR/SS/RAY mirror SVG
   - `js/layers/grid.js` — perspective grid SVG
   Each call retains a body fallback so the change is non-breaking if the wrapper is absent.
3. **Below-view toggle.** New floating top-right button `#below-toggle`. Adds `body.below-view`, which sets `#scene-3d { transform: rotateX(170deg); }`. While active: forces underground tilt back to neutral (~30° above-ground) since the underground hack transforms `#map` directly and would compose badly with the scene rotateX.

### Known limitations (intentional — Phase-2.5 work)
- **MapLibre's own markers stay on the map plane.** Arc dots, caster sphere, observer dot, shadow endpoint dot, and floor dot are MapLibre Markers living inside `.maplibregl-canvas-container`. In below-view they appear *on the ceiling with the map tiles*, not floating above the camera. Lifting these to the +Z plane requires re-implementing them outside MapLibre's marker system (or hacking translateZ into their inline styles).
- **Line/marker alignment in below-view is imperfect.** SVG line coordinates are computed via `mapRef.project()` in 2D screen space against the un-transformed map projection. Drawing those lines on a +Z plane that then gets rotateX'd means the lines render at the right pixel positions on the +Z plane, but those positions don't line up with where map features visually appear under the combined transform.
- **No gesture mapping yet.** Below-view is on/off only — no adjustable view angle, no orbit. Slider/pan/zoom still act on MapLibre's underlying view.

### Files changed
- `index.html` — wrapped `#map` in `#scene-3d`; added `#overlays-3d` sibling; added `#below-toggle` button; bumped `?v=66`
- `css/style.css` — `#scene-3d`, `#map`, `#overlays-3d` rules; `body.below-view #scene-3d` transform; `.floating-toggle` styles
- `js/layers/shadow.js` — mount `svgOverlay` on `#overlays-3d` (body fallback)
- `js/layers/sun-path.js` — same for `dropSvg` and `gridLinesSvg`
- `js/layers/grid.js` — same for `gridSvg`
- `js/app.js` — wire `#below-toggle` click handler; force tilt to neutral on activate; toast feedback
- `sw.js` — Cache bumped `v65` → `v66`
