# Sun · Light Planner — Code Audit & Fix Log

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

*(appended after implementation)*

---

## Part 4 — App Description for Future Sessions

*(appended after implementation)*
