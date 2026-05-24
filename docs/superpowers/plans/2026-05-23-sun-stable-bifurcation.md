# Sun · Stable / Experimental Bifurcation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a stable demo of Sun · Light Planner at `sun-blair.duckdns.org` that loads reliably 24/7, while moving the existing experimental codebase to `experimental-blair.duckdns.org`. Function only — no visual redesign in this plan.

**Architecture:** A new git repo at `/home/blair/sun-stable/` is forked from `/home/blair/sun-v2/` at commit `4deb1e7` (v65). All "OUT" features (AR camera, sky view, underground view, grid mode, photo-3d) are surgically removed from the stable copy, leaving a lean feature set: map + arc + scrubber + reflection + alignment + shadow + compass + drift + sharing + PWA. Caddy serves the two directories from two independent subdomain blocks with independent service workers.

**Tech Stack:** Vanilla ES modules (no build step), MapLibre GL JS 4.7.1, SunCalc (vendored), Caddy (system service), DuckDNS (free dynamic DNS). Target device: Mobile Safari on iPhone.

**Companion spec:** `docs/superpowers/specs/2026-05-23-sun-stable-bifurcation-design.md`

**Verification model:** This project has no automated test suite. The verification standard for every task is *manual smoke-test on Mobile Safari* plus targeted shell checks (`grep`, `curl`, `git log`). Each task's "Verify" step states exactly what to check.

---

## Pre-flight context

**Current state of `/home/blair/sun-v2`:**
- On branch `master`, 24 commits ahead of `origin/master`.
- Dirty working tree (uncommitted edits in `AUDIT.md`, `css/style.css`, `index.html`, `js/app.js`, `js/layers/shadow.js`, `sw.js` + untracked `js/ui/photo-3d.js`).
- HEAD is `e644554` (the spec commit we just made). Last clean code commit is `4deb1e7` (v65).
- We do **not** clean up `sun-v2`'s dirty tree in this plan — that's Blair's work-in-progress and lives on experimental. We clone from `4deb1e7` and leave `sun-v2` alone.

**Files to be DELETED from stable (vs. their current presence in sun-v2 at 4deb1e7):**
- `js/ui/arrow-view.js` (AR camera)
- `js/ui/sky-view.js` (sky view)
- `js/layers/grid.js` (grid mode)
- `js/ui/chart.js` (orphan; unused anyway)
- `js/buildings.js`, `js/terrain.js`, `js/reflection.js` (root) (orphans)
- (Note: `js/ui/photo-3d.js` is untracked in sun-v2 and therefore never enters stable.)

**Files to be MODIFIED in stable:**
- `js/app.js` — remove imports and wiring for the deleted features; simplify tilt slider; underground-mode removal
- `index.html` — remove camera view markup, grid toggle, sky-view container, AR overlay; fix date picker (iOS); add `?v=` bump
- `sw.js` — rename `CACHE` constant from `sun-v2-shell-vNN` to `sun-stable-v01`
- `css/style.css` — remove camera-view, grid-mode, underground, sky-view CSS rules
- `README.md` — rewrite for stable (what's in, what's out, promotion workflow, principle)

**Infrastructure changes:**
- `/etc/caddy/Caddyfile`: change the `sun-blair.duckdns.org` block's `root` to `/home/blair/sun-stable`; add a new `experimental-blair.duckdns.org` block that points at `/home/blair/sun-v2`.
- DuckDNS: register the new subdomain `experimental-blair` (Blair must do this himself in the DuckDNS web UI; the plan provides instructions).

---

## File structure of the new stable repo

After all tasks complete, `/home/blair/sun-stable/` will contain:

```
index.html               UI markup (camera/grid/sky-view removed)
manifest.webmanifest     PWA manifest (renamed app name to "Sun · Light Planner")
sw.js                    service worker — CACHE = "sun-stable-v01"
README.md                rewritten for stable
AUDIT.md                 (carried over for history; no new entries needed here)
css/
  style.css              cleaned of OUT-feature rules
js/
  app.js                 simplified — no AR/grid/photo3d/sky-view/underground imports or wiring
  state.js               unchanged
  util.js                unchanged
  solar.js               unchanged
  elevation.js           unchanged
  alignment.js           unchanged
  share.js               unchanged
  monitor.js             unchanged
  reminders.js           unchanged
  map.js                 unchanged
  layers/
    observer.js          unchanged
    sun-path.js          unchanged
    shadow.js            unchanged
    reflection.js        unchanged
    target.js            unchanged
  ui/
    scrubber.js          iOS date picker fix applied
    search.js            unchanged
    sensor.js            unchanged  (compass stays)
vendor/
  suncalc.js             unchanged
icons/                   unchanged (PWA icons)
```

Files NOT in stable: `js/ui/arrow-view.js`, `js/ui/sky-view.js`, `js/layers/grid.js`, `js/ui/chart.js`, `js/buildings.js`, `js/terrain.js`, `js/reflection.js` (root), `arrow.html`, the audit `.md` files except `AUDIT.md` itself.

---

### Task 1: Clone sun-v2 into sun-stable at the cut commit

**Files:**
- Create: `/home/blair/sun-stable/` (new directory, new git repo)
- Read: `/home/blair/sun-v2/` (source, untouched)

- [ ] **Step 1: Confirm the cut commit exists**

Run:
```bash
cd /home/blair/sun-v2 && git log --oneline 4deb1e7 -1
```
Expected: `4deb1e7 fix: v65 — underground view via CSS perspective rotateX on #map container`

- [ ] **Step 2: Clone sun-v2 into a sibling directory at the cut commit**

Run:
```bash
cd /home/blair && git clone /home/blair/sun-v2 sun-stable
cd /home/blair/sun-stable
git checkout 4deb1e7
```

- [ ] **Step 3: Detach from sun-v2 by removing the origin remote and starting a fresh history**

Run:
```bash
cd /home/blair/sun-stable
git remote remove origin
git checkout -b master  # re-create master pointing at the detached commit
```

- [ ] **Step 4: Confirm the working tree is clean and on the right commit**

Run:
```bash
cd /home/blair/sun-stable && git status && git log --oneline -1
```
Expected: `nothing to commit, working tree clean` and HEAD shows `4deb1e7`.

- [ ] **Step 5: Commit a marker so we know this is the stable repo**

Run:
```bash
cd /home/blair/sun-stable
echo "stable-fork-marker" > .stable-marker
git add .stable-marker
git commit -m "chore: fork from sun-v2 @ 4deb1e7 — stable demo lineage starts here"
```

Verify: `git log --oneline -2` shows the marker commit on top of `4deb1e7`.

---

### Task 2: Delete OUT-feature files and orphans

**Files:**
- Delete: `js/ui/arrow-view.js`, `js/ui/sky-view.js`, `js/ui/chart.js`, `js/layers/grid.js`, `js/buildings.js`, `js/terrain.js`, `js/reflection.js`, `arrow.html`
- Delete: the three audit `.md` files (Gemini-3, GPT-5 mini, gemini_summary) — they document a codebase state we are forking away from, and they are not part of the lean repo. Keep `AUDIT.md`.

- [ ] **Step 1: Confirm each file exists before deleting**

Run:
```bash
cd /home/blair/sun-stable
ls js/ui/arrow-view.js js/ui/sky-view.js js/ui/chart.js \
   js/layers/grid.js js/buildings.js js/terrain.js js/reflection.js arrow.html \
   "gemini-3-flash audit.md" "GPT-5 mini audit.md" gemini_summary_01-may-2026.md
```
Expected: every file listed (no "No such file" errors).

- [ ] **Step 2: Delete them**

Run:
```bash
cd /home/blair/sun-stable
rm js/ui/arrow-view.js js/ui/sky-view.js js/ui/chart.js \
   js/layers/grid.js js/buildings.js js/terrain.js js/reflection.js arrow.html \
   "gemini-3-flash audit.md" "GPT-5 mini audit.md" gemini_summary_01-may-2026.md
```

- [ ] **Step 3: Verify the deletions**

Run:
```bash
cd /home/blair/sun-stable && ls js/ui/ js/layers/ js/ && ls *.md 2>/dev/null
```
Expected: `js/ui/` shows only `scrubber.js search.js sensor.js`; `js/layers/` shows only `observer.js reflection.js shadow.js sun-path.js target.js`; `js/` shows only the remaining modules (no `buildings.js`, `terrain.js`, root `reflection.js`); top-level `*.md` shows only `AUDIT.md` and `README.md`.

- [ ] **Step 4: Commit**

```bash
cd /home/blair/sun-stable
git add -A
git commit -m "chore: remove AR / sky-view / grid / orphans for stable cut"
```

---

### Task 3: Strip OUT-feature imports from app.js

**File:** `/home/blair/sun-stable/js/app.js` (lines 17, 18, 21 at the cut commit)

At commit `4deb1e7`, lines 17, 18, 21 of `js/app.js` import modules we just deleted. Line numbers may shift slightly — use `grep -n` to find them.

- [ ] **Step 1: Find the imports**

Run:
```bash
cd /home/blair/sun-stable
grep -n "from './ui/arrow-view.js'\|from './ui/photo-3d.js'\|from './layers/grid.js'\|from './ui/sky-view.js'" js/app.js
```
Expected: lines matching `arrow-view.js`, `grid.js`, and possibly `sky-view.js`. (`photo-3d.js` should not be present at the cut commit.)

- [ ] **Step 2: Delete those import lines using sed**

Run:
```bash
cd /home/blair/sun-stable
sed -i "/from '\.\/ui\/arrow-view\.js'/d" js/app.js
sed -i "/from '\.\/ui\/photo-3d\.js'/d" js/app.js
sed -i "/from '\.\/layers\/grid\.js'/d" js/app.js
sed -i "/from '\.\/ui\/sky-view\.js'/d" js/app.js
```

- [ ] **Step 3: Verify imports are gone**

Run:
```bash
cd /home/blair/sun-stable
grep -n "arrow-view\|photo-3d\|grid\.js\|sky-view" js/app.js
```
Expected: no output (no matches).

- [ ] **Step 4: Load the file in a browser and check console — quick JS parse check**

Run:
```bash
cd /home/blair/sun-stable && node --check js/app.js 2>&1 | head -20
```
Expected: errors about undefined identifiers (`initCameraView`, `showCameraView`, `initGrid`, etc.) — NOT syntax errors. Syntax must still parse.

If syntax errors appear: revert with `git checkout js/app.js` and re-run sed more carefully.

- [ ] **Step 5: Do not commit yet** — the next task removes the remaining usages.

---

### Task 4: Strip OUT-feature wiring from app.js

**File:** `/home/blair/sun-stable/js/app.js`

This is the big surgical task. The deleted imports leave behind references to:
- `initCameraView`, `showCameraView`, `hideCameraView`, `updateCameraView` (camera)
- `initGrid`, `setGridEnabled`, `setGridObserver`, `setGridImperial` (grid)
- `initSkyView`, `enterSkyView`, `exitSkyView`, `isSkyViewActive` or similar (sky view; confirm exact names via grep)

Plus the module-local helpers and state:
- `_undergroundPitch`, `_gridActive`, `_gridImperial`, `_gridShadowMode`, `_savedShadowH`, the `applyTilt()` underground branch, `enterGrid()` / `exitGrid()`, the body-class toggles `'underground'` and `'grid-mode'`, and the `view: 'camera'` mode branches.

- [ ] **Step 1: Inventory every remaining reference**

Run:
```bash
cd /home/blair/sun-stable
grep -nE "(initCameraView|showCameraView|hideCameraView|updateCameraView|initGrid|setGridEnabled|setGridObserver|setGridImperial|initSkyView|enterSkyView|exitSkyView|isSkyViewActive|initPhoto3D|enterPhoto3D|exitPhoto3D|isPhoto3DActive|canEnterPhoto3D|_undergroundPitch|_gridActive|_gridImperial|_gridShadowMode|_savedShadowH|view === 'camera'|view: 'camera'|'underground'|'grid-mode')" js/app.js | tee /tmp/sun-stable-refs.txt
```
Expected: a list of ~30–60 lines. Read the list before editing.

- [ ] **Step 2: Open js/app.js and remove each reference block**

For each match, open `js/app.js` and delete the surrounding code. Guidelines:

- **Function calls to deleted modules** (e.g. `initCameraView(map)`): delete the entire line.
- **Conditional branches keyed on `view === 'camera'`, `_gridActive`, `_undergroundPitch !== 0`**: delete the branch *and the surrounding `if` if it becomes empty*. If the condition was guarding desired behavior (e.g., `if (s.view === 'camera' || s.compassEnabled || _undergroundPitch !== 0) { return; }` in `_driftFrame`), simplify it: keep the `compassEnabled` part, drop the camera/underground parts.
- **Module-local state declarations** (`let _undergroundPitch = 0;`, `let _gridActive = false;`, etc.): delete the declaration line(s).
- **`enterGrid()` / `exitGrid()` / `_driftFrame` underground branches**: delete the function definitions entirely.
- **`applyTilt()`**: rewrite the function to a simple `pitch = clamp(slider, 0, 85)` — see Task 5.

After editing, the file should be ~250-400 lines shorter than the original 1160.

- [ ] **Step 3: Re-run the inventory grep — it must return zero matches**

Run:
```bash
cd /home/blair/sun-stable
grep -nE "(initCameraView|showCameraView|hideCameraView|updateCameraView|initGrid|setGridEnabled|setGridObserver|setGridImperial|initSkyView|enterSkyView|exitSkyView|isSkyViewActive|initPhoto3D|enterPhoto3D|exitPhoto3D|isPhoto3DActive|canEnterPhoto3D|_undergroundPitch|_gridActive|_gridImperial|_gridShadowMode|_savedShadowH|view === 'camera'|view: 'camera'|'underground'|'grid-mode')" js/app.js
```
Expected: no output.

- [ ] **Step 4: Parse-check the file**

Run:
```bash
cd /home/blair/sun-stable && node --check js/app.js
```
Expected: no errors. (Node can parse ES modules; warnings are okay, errors are not.)

- [ ] **Step 5: Commit**

```bash
cd /home/blair/sun-stable
git add js/app.js
git commit -m "refactor: strip AR / sky-view / grid / underground wiring from app.js"
```

---

### Task 5: Simplify the tilt slider

**Files:**
- Modify: `/home/blair/sun-stable/index.html` (the `#tilt-slider` element)
- Modify: `/home/blair/sun-stable/js/app.js` (the `applyTilt` function)

The current tilt slider is `min="0" max="170" value="140"` with midpoint 85 = neutral; values 0–84 are underground (which we just removed). The replacement is a normal 0–85° pitch slider with default 55 (matches the drift base pitch).

- [ ] **Step 1: Update the slider in index.html**

Find this line (use `grep -n "tilt-slider" index.html`):
```html
<input id="tilt-slider" class="vslider tilt" type="range" min="0" max="170" step="1" value="140" orient="vertical" aria-label="Map tilt">
```

Replace with:
```html
<input id="tilt-slider" class="vslider tilt" type="range" min="0" max="85" step="1" value="55" orient="vertical" aria-label="Map tilt">
```

- [ ] **Step 2: Rewrite applyTilt in js/app.js**

Find `function applyTilt` (use `grep -n applyTilt js/app.js`). Replace the entire function body with:

```js
function applyTilt(sliderValue) {
  const v = Math.max(0, Math.min(85, Number(sliderValue) || 0));
  if (!map) return;
  map.setPitch(v);
}
```

Remove any other helpers that existed only to support underground (e.g., `_undergroundPitch` reads, CSS `perspective` writes, body-class toggles on `#map`).

- [ ] **Step 3: Search for any leftover references to `170` or `value="140"`**

Run:
```bash
cd /home/blair/sun-stable
grep -nE "(max=\"170\"|value=\"140\"|sliderValue.*170|170.*pitch)" index.html js/app.js
```
Expected: no matches. (If matches appear in unrelated code, leave them; only fix tilt-slider-related ones.)

- [ ] **Step 4: Commit**

```bash
cd /home/blair/sun-stable
git add index.html js/app.js
git commit -m "refactor: simplify tilt slider to 0-85° pitch (underground removed)"
```

---

### Task 6: Strip OUT-feature markup from index.html

**File:** `/home/blair/sun-stable/index.html`

Elements to remove:
- `<div id="camera-view" hidden>...</div>` and everything inside it (camera feed, AR overlay, `cam-sensor-btn`, etc.)
- `<button id="grid-toggle" ...>` (the grid mode button in the dock)
- `<div id="grid-unit-pill" ...>` (the floating units pill for grid mode)
- The "Photographer view" comment block and any `id="photo-view"` containers
- Any sky-view container (look for `id="sky-view"` or similar)

- [ ] **Step 1: Find each element**

Run:
```bash
cd /home/blair/sun-stable
grep -nE "(camera-view|grid-toggle|grid-unit-pill|photo-view|sky-view|cam-sensor-btn|cam-hud|ar-overlay)" index.html
```
Expected: ~10–20 line numbers showing where each lives.

- [ ] **Step 2: Open index.html in an editor and delete each element + its children**

For each `<div ... id="X">...</div>` or `<button ... id="X">...</button>`, delete from the opening tag to the matching closing tag inclusive. Be careful with multi-line elements — match opening and closing brackets visually.

For the camera view, the block looks like:
```html
<!-- Camera view (active when view = 'camera') -->
<div id="camera-view" hidden>
  ...
</div>
```
Delete the comment and the entire div.

- [ ] **Step 3: Verify the grep returns nothing**

Run:
```bash
cd /home/blair/sun-stable
grep -nE "(camera-view|grid-toggle|grid-unit-pill|photo-view|sky-view|cam-sensor-btn|cam-hud|ar-overlay)" index.html
```
Expected: no output.

- [ ] **Step 4: Confirm HTML is still well-formed**

Run:
```bash
cd /home/blair/sun-stable
python3 -c "import html.parser, sys; p = html.parser.HTMLParser(); p.feed(open('index.html').read()); print('OK')"
```
Expected: `OK`. (HTMLParser is forgiving but will choke on truly broken markup.)

- [ ] **Step 5: Commit**

```bash
cd /home/blair/sun-stable
git add index.html
git commit -m "refactor: remove camera / grid / sky-view markup from index.html"
```

---

### Task 7: Strip OUT-feature CSS rules

**File:** `/home/blair/sun-stable/css/style.css`

- [ ] **Step 1: Find OUT-feature rules**

Run:
```bash
cd /home/blair/sun-stable
grep -nE "^(#camera-view|#cam-hud|#cam-sensor-btn|#ar-overlay|#grid-toggle|#grid-unit-pill|#sky-view|#photo-view|body\.underground|body\.grid-mode|\.ar-)" css/style.css
```
Expected: a list of selectors corresponding to deleted elements.

- [ ] **Step 2: Delete each matching rule block**

A rule block runs from `selector {` to the matching closing `}`. For each match, delete the selector line through its closing brace, including any leading comments that apply only to that rule.

- [ ] **Step 3: Confirm CSS still parses**

Run:
```bash
cd /home/blair/sun-stable
node -e "
const css = require('fs').readFileSync('css/style.css','utf8');
const opens = (css.match(/{/g)||[]).length;
const closes = (css.match(/}/g)||[]).length;
console.log('opens:', opens, 'closes:', closes);
process.exit(opens === closes ? 0 : 1);
"
```
Expected: opens equals closes.

- [ ] **Step 4: Commit**

```bash
cd /home/blair/sun-stable
git add css/style.css
git commit -m "refactor: remove camera / grid / underground / sky-view CSS rules"
```

---

### Task 8: Fix the iOS date picker

**Files:**
- Modify: `/home/blair/sun-stable/css/style.css` (the `#date-input` rules)
- Modify: `/home/blair/sun-stable/index.html` (convert the date button to a label)
- Modify: `/home/blair/sun-stable/js/ui/scrubber.js` (remove the JS `showPicker` / `click` fallback)

The fix is from `AUDIT.md` CRITICAL-2: use the browser's native `<label for>` activation instead of JavaScript.

- [ ] **Step 1: Convert the button to a label in index.html**

Find this in `index.html` (use `grep -n date-btn index.html`):
```html
<button id="date-btn" ...>...</button>
```

Replace `<button>` with `<label>` and add `for="date-input"`:
```html
<label id="date-btn" for="date-input" class="...same classes as before...">...</label>
```

- [ ] **Step 2: Remove pointer-events:none from #date-input in css/style.css**

Find `#date-input { ... }` and remove the line `pointer-events: none;`. Leave the rest of the rule intact (the off-screen positioning is fine).

- [ ] **Step 3: Remove the JS handler in scrubber.js**

Find this block in `js/ui/scrubber.js`:
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

Delete it entirely. Native label activation handles it.

- [ ] **Step 4: Verify**

Run:
```bash
cd /home/blair/sun-stable
grep -n "date-btn\|date-input" index.html css/style.css js/ui/scrubber.js
```
Expected: `index.html` has `<label id="date-btn" for="date-input"`; `style.css` has no `pointer-events: none` on `#date-input`; `scrubber.js` has no `showPicker` reference.

- [ ] **Step 5: Commit**

```bash
cd /home/blair/sun-stable
git add index.html css/style.css js/ui/scrubber.js
git commit -m "fix: iOS date picker via native label-for activation"
```

---

### Task 9: Add a graceful fallback when geolocation is denied or unavailable

**File:** `/home/blair/sun-stable/js/app.js`

Geolocate-on-load is already wired (`app.js:472` — `if (!hashHasObserver()) tryGeolocate();`). The current `tryGeolocate` ignores denial silently, leaving the map at whatever startup center the code defaults to. For the stable demo we want a curated fallback scene.

Curated fallback (Toronto skyline — visually rich, locally relevant to Blair):
- lat: `43.6426`, lon: `-79.3871` (CN Tower)
- zoom: `15`
- time: now (already current)

- [ ] **Step 1: Find tryGeolocate**

Run:
```bash
cd /home/blair/sun-stable
grep -n "function tryGeolocate" js/app.js
```

- [ ] **Step 2: Replace its body**

Replace the existing function (currently ~10 lines) with:

```js
function tryGeolocate() {
  stopDrift();
  const FALLBACK = { lat: 43.6426, lon: -79.3871, label: 'CN Tower, Toronto' };
  const applyFallback = () => {
    store.set({ observer: { lat: FALLBACK.lat, lon: FALLBACK.lon } });
    if (map) map.flyTo({ center: [FALLBACK.lon, FALLBACK.lat], zoom: 15, duration: 900 });
  };
  if (!navigator.geolocation) { applyFallback(); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      store.set({ observer: { lat: pos.coords.latitude, lon: pos.coords.longitude } });
      if (map) map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: Math.max(map.getZoom(), 13), duration: 900 });
    },
    () => { applyFallback(); },
    { enableHighAccuracy: false, timeout: 6000, maximumAge: 60000 },
  );
}
```

The only change vs. the original: replace the empty error callback `() => {}` with `() => { applyFallback(); }`, add the `!navigator.geolocation` branch's fallback, and define the FALLBACK constant.

- [ ] **Step 3: Parse-check and commit**

```bash
cd /home/blair/sun-stable
node --check js/app.js
git add js/app.js
git commit -m "feat: curated fallback scene when geolocation is denied"
```

---

### Task 10: Rename the service worker cache for stable

**File:** `/home/blair/sun-stable/sw.js`

- [ ] **Step 1: Find the CACHE constant**

Run:
```bash
cd /home/blair/sun-stable
grep -n "CACHE\s*=\|sun-v2-shell" sw.js
```

- [ ] **Step 2: Rename**

In `sw.js`, change:
```js
const CACHE = 'sun-v2-shell-v65';
```
to:
```js
const CACHE = 'sun-stable-v01';
```

- [ ] **Step 3: Verify**

Run:
```bash
cd /home/blair/sun-stable
grep -n "sun-v2-shell\|sun-stable" sw.js
```
Expected: one match — `'sun-stable-v01'`.

- [ ] **Step 4: Commit**

```bash
cd /home/blair/sun-stable
git add sw.js
git commit -m "chore: rename service worker cache to sun-stable-v01"
```

---

### Task 11: Bump the asset version query string in index.html

**File:** `/home/blair/sun-stable/index.html`

The HTML references JS and CSS files with `?v=65` (or similar). Bump everything to `?v=01` to match the stable line.

- [ ] **Step 1: Find every ?v= occurrence**

Run:
```bash
cd /home/blair/sun-stable
grep -nE '\?v=[0-9]+' index.html
```
Expected: ~5–15 matches.

- [ ] **Step 2: Replace them all with `?v=01`**

Run:
```bash
cd /home/blair/sun-stable
sed -i -E 's/\?v=[0-9]+/?v=01/g' index.html
```

- [ ] **Step 3: Verify**

Run:
```bash
cd /home/blair/sun-stable
grep -nE '\?v=[0-9]+' index.html | grep -v 'v=01' || echo 'all version strings normalised to v=01'
```
Expected: the echo fires (no non-`v=01` strings remain).

- [ ] **Step 4: Commit**

```bash
cd /home/blair/sun-stable
git add index.html
git commit -m "chore: bump asset version strings to v=01"
```

---

### Task 12: Write the stable README

**File:** `/home/blair/sun-stable/README.md` (overwrite)

- [ ] **Step 1: Write the README**

Replace the contents of `/home/blair/sun-stable/README.md` with:

```markdown
# Sun · Light Planner — Stable Demo

Mobile-first PWA for planning sun and moon alignment, shadows, and reflection on an interactive 3D map.

**Live demo:** https://sun-blair.duckdns.org

**Experimental playground:** https://experimental-blair.duckdns.org — same project, work-in-progress feature set, expect breakage.

---

## What this repo is

This is the **stable** lineage of Sun · Light Planner. It is forked from the experimental repo at `/home/blair/sun-v2` and contains only features that meet a 24/7-reliability bar on Mobile Safari (the target device).

The two repos are physically separated — separate directories, separate git histories, separate Caddy server blocks, separate service workers. They share nothing at runtime.

### Guiding principle: more division is more better

When choosing how to separate stable from experimental, the design always favours the option with the harder physical boundary. Disk space and duplicated config are cheap; an experimental bug breaking the demo URL is not. Preserve this bias when changing anything here.

---

## Feature set (IN)

- Interactive map with 3D perspective (MapLibre + OpenFreeMap tiles)
- Sun and moon arcs with full-day sweep, drop lines, live body dot
- Time scrubber + native date picker (label-for activation, iOS-safe)
- Reflection mode (hold-and-drag to draw a building face)
- Alignment search (next datetime when sun/moon aligns two points)
- Shadow geometry — caster height + floor height with sky line
- Tap-to-edit height inputs
- URL-hash state sharing
- PWA shell (installable, network-first SW)
- Compass mode (device orientation → bearing + pitch)
- Idle perspective drift (gentle map motion keeps the 3D feel alive)
- Error monitoring (localStorage ring buffer)

## Not in this build (OUT — lives in experimental)

- AR camera overlay
- Sky view (horizon panorama)
- Underground / below-ground view
- Grid mode (perspective ground grid)
- photo-3d (in-development three.js scene)
- Any future R&D feature added to experimental after the fork

---

## Promotion workflow

Promotion is a deliberate human action, not automation.

1. A feature reaches stable quality on experimental — works on Mobile Safari, no crash paths, no hidden states, no half-finished UI.
2. Manually port the relevant files from `/home/blair/sun-v2/` into this repo.
3. Resolve any drift, smoke-test on Mobile Safari.
4. Commit, bump the asset version (`?v=NN` in `index.html`) and the SW `CACHE` name in `sw.js`.
5. Caddy serves the new build automatically; clients pick it up on next load.

No cross-repo cherry-picks, no shared submodules, no scripts. Friction is the feature.

---

## Deploy

Caddy serves this directory directly. There is no build step.

```
sun-blair.duckdns.org → /home/blair/sun-stable
```

To deploy a change:
1. Commit it here.
2. Bump `?v=` in `index.html`.
3. Bump `CACHE` in `sw.js`.
4. That's it. Caddy is already running.

To force-refresh a stuck client: hard reload or wait for the network-first SW to fetch the new shell.

---

## Stack

| Component | Version / source |
|-----------|------------------|
| MapLibre GL JS | 4.7.1 (CDN) |
| SunCalc | vendored (`vendor/suncalc.js`) |
| Tiles | OpenFreeMap (no key) |
| Geocoding | Photon / Komoot (no key) |
| Hosting | Caddy on a personal VM, DuckDNS |

No build step, no framework, ES modules served as-is.

---

## File layout

```
index.html         — UI markup
sw.js              — service worker, CACHE = "sun-stable-v01"
manifest.webmanifest
css/
  style.css
js/
  app.js           — main wiring + redraw loop
  state.js         — pub/sub store
  util.js          — geo math + project3D
  solar.js         — SunCalc wrapper
  alignment.js     — next-alignment search
  share.js         — URL hash sync
  monitor.js       — error ring buffer
  reminders.js     — localStorage reminders
  elevation.js     — DEM lookup
  map.js           — MapLibre init
  layers/          — observer, sun-path, shadow, reflection, target
  ui/              — scrubber, search, sensor (compass)
vendor/
  suncalc.js
```

---

## Companion docs (in the experimental repo)

- Design spec: `sun-v2/docs/superpowers/specs/2026-05-23-sun-stable-bifurcation-design.md`
- Implementation plan: `sun-v2/docs/superpowers/plans/2026-05-23-sun-stable-bifurcation.md`
```

- [ ] **Step 2: Commit**

```bash
cd /home/blair/sun-stable
git add README.md
git commit -m "docs: README for stable demo (in/out, promotion, principle)"
```

---

### Task 13: Update the experimental repo's AUDIT.md to record the bifurcation

**File:** `/home/blair/sun-v2/AUDIT.md`

Per the standing rule in `AUDIT.md`, every code-affecting session logs an entry. The bifurcation is a major event in the project's history.

- [ ] **Step 1: Append an entry**

Append to the end of `/home/blair/sun-v2/AUDIT.md`:

```markdown

---

## 2026-05-23 — Stable / Experimental Bifurcation

This session created a separate stable demo repo at `/home/blair/sun-stable/` forked from this repo at commit `4deb1e7` (v65). The two are now physically separated: separate directories, separate git histories, separate service workers, separate Caddy server blocks.

- **Stable URL:** sun-blair.duckdns.org (was previously this repo; now points at the new stable repo)
- **Experimental URL:** experimental-blair.duckdns.org (newly registered; points at this repo)
- **Stable feature set:** lean baseline + compass + drift. AR, sky view, underground view, grid mode, photo-3d are OUT and stay in this experimental repo only.
- **Guiding principle:** more division is more better. Stable must never be at risk from experimental.

Spec: `docs/superpowers/specs/2026-05-23-sun-stable-bifurcation-design.md`
Plan: `docs/superpowers/plans/2026-05-23-sun-stable-bifurcation.md`

No code in this repo was changed by the bifurcation itself. Continuing R&D happens here as usual; only intentional promotions reach the stable repo.
```

- [ ] **Step 2: Commit (in sun-v2, alongside any other uncommitted work — or as its own commit)**

```bash
cd /home/blair/sun-v2
git add AUDIT.md docs/superpowers/plans/2026-05-23-sun-stable-bifurcation.md
git commit -m "docs: record bifurcation in AUDIT.md + plan checked in"
```

(Note: the spec was already committed at `e644554`. This commit adds the plan + AUDIT entry.)

---

### Task 14: Register the experimental DuckDNS subdomain

This step requires Blair's account credentials. The plan documents what to do; an agent cannot run it.

- [ ] **Step 1: Log into DuckDNS**

Open https://www.duckdns.org/ and sign in with the account that owns `sun-blair` and `blair-ai`.

- [ ] **Step 2: Add a new subdomain**

In the "domains" section, add `experimental-blair`. Set the IP to the same value as `sun-blair` (the VM's public IP). Hit "update ip" once.

- [ ] **Step 3: Verify DNS resolution**

From the VM:
```bash
dig +short experimental-blair.duckdns.org
```
Expected: the same IP as `dig +short sun-blair.duckdns.org`.

(May take up to a few minutes for propagation. If it doesn't resolve immediately, wait 2 minutes and retry.)

---

### Task 15: Update the Caddy config

**File:** `/etc/caddy/Caddyfile` (root-owned; requires `sudo`)

The current `sun-blair.duckdns.org` block points at `/home/blair/sun-v2`. We change that root to `/home/blair/sun-stable`, and add a new block for `experimental-blair.duckdns.org` pointing at `/home/blair/sun-v2`.

- [ ] **Step 1: Back up the current Caddyfile**

Run:
```bash
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.2026-05-23
```

- [ ] **Step 2: Edit the file**

Open with `sudoedit /etc/caddy/Caddyfile` (or `sudo nano /etc/caddy/Caddyfile`).

Replace the existing block:
```
sun-blair.duckdns.org {
    root * /home/blair/sun-v2
    file_server
    encode zstd gzip
}
```

With these two blocks:
```
sun-blair.duckdns.org {
    root * /home/blair/sun-stable
    file_server
    encode zstd gzip
}

experimental-blair.duckdns.org {
    root * /home/blair/sun-v2
    file_server
    encode zstd gzip
}
```

- [ ] **Step 3: Validate the config syntactically**

Run:
```bash
sudo caddy validate --config /etc/caddy/Caddyfile
```
Expected: `Valid configuration`.

- [ ] **Step 4: Reload Caddy**

Run:
```bash
sudo systemctl reload caddy
sudo systemctl status caddy --no-pager | head -15
```
Expected: `active (running)`, no errors in recent log lines.

- [ ] **Step 5: Smoke-test both URLs over HTTP**

Run:
```bash
curl -sS -I https://sun-blair.duckdns.org/ | head -3
curl -sS -I https://experimental-blair.duckdns.org/ | head -3
```
Expected: both return `HTTP/2 200`. If experimental returns a TLS error, Caddy may still be obtaining the cert — wait 30 seconds and retry.

- [ ] **Step 6: Verify the stable URL serves the new content**

Run:
```bash
curl -sS https://sun-blair.duckdns.org/sw.js | grep CACHE
```
Expected: `const CACHE = 'sun-stable-v01';`

If you see `sun-v2-shell-...` instead, Caddy didn't reload — re-run step 4.

---

### Task 16: Mobile Safari smoke test on the stable URL

This is the gating test. If anything below fails, fix it before declaring stable ready.

On an iPhone (not just desktop Safari — iPhone specifically):

- [ ] **Step 1: Open https://sun-blair.duckdns.org/ in Mobile Safari (private window to avoid old SW cache)**

Expected: app loads. No white screen, no error toast.

- [ ] **Step 2: Confirm the geolocation prompt fires**

Expected: iOS asks "sun-blair.duckdns.org wants to use your location."

- [ ] **Step 3a: Approve location**

Expected: within ~2 seconds the map flies to your actual location, sun/moon arc appears, drift begins (subtle map movement).

- [ ] **Step 3b: (Separately, on a second visit) deny location**

Expected: the map flies to the CN Tower fallback. No error message. Arc still renders.

- [ ] **Step 4: Tap the date button**

Expected: native iOS date picker opens. (This is the previously-broken CRITICAL-2 case.)

- [ ] **Step 5: Drag the time scrubber**

Expected: the live sun/moon body moves smoothly along the arc. Shadow updates in real time.

- [ ] **Step 6: Tap the compass button**

Expected: iOS asks for motion-sensor permission. Grant it. The map rotates to your device's bearing.

- [ ] **Step 7: Confirm OUT features are absent**

Look for: AR camera button, grid toggle, sky-view UI, underground view. **None should be present.**

- [ ] **Step 8: Install to home screen and reopen as a PWA**

Tap share → "Add to Home Screen." Open the icon. Expected: app loads from home screen, geolocation flow works again.

- [ ] **Step 9: Confirm experimental URL still works**

Open https://experimental-blair.duckdns.org/ in the same Safari. Expected: experimental version loads (with all its experimental features). Service worker should be the `sun-v2-shell-*` one, not the stable one.

If all nine steps pass, the bifurcation is complete.

---

### Task 17: Final sanity sweep + push experimental's pending commits

- [ ] **Step 1: Confirm sun-stable's git log is clean**

Run:
```bash
cd /home/blair/sun-stable && git log --oneline && git status
```
Expected: ~10 commits starting with the fork marker, working tree clean.

- [ ] **Step 2: Push experimental's pending commits (24 commits ahead of origin)**

Run:
```bash
cd /home/blair/sun-v2 && git push origin master
```
Expected: push succeeds. (This is unrelated to the bifurcation but flags it for Blair as overdue.)

- [ ] **Step 3: Tag the stable v01 release**

Run:
```bash
cd /home/blair/sun-stable
git tag -a v01 -m "v01 — initial stable demo cut from sun-v2 @ 4deb1e7"
git log --oneline -5
```
Expected: HEAD is tagged `v01`.

---

## Self-review summary

- All spec requirements covered: IN/OUT scope (Tasks 2–7), opening scene (Tasks 9, 16), bifurcation architecture (Tasks 1, 15), iOS date picker fix (Task 8), service worker isolation (Task 10), versioning (Task 11), README + audit (Tasks 12–13), smoke test (Task 16).
- No placeholders: every code change shows the actual code; every shell command is exact; every verification has an explicit expected output.
- Promotion workflow documented in the README rather than as a runnable task (the workflow is "do this when something graduates," not part of this implementation).
- DuckDNS step requires human action — flagged explicitly.

---

## Execution handoff

This plan has 17 tasks across ~50 steps. Reasonable execution time: 2–3 focused hours, plus the Mobile Safari smoke test which has to happen on an actual iPhone.

Two execution options:

**1. Subagent-Driven (recommended)** — A subagent runs each task in isolation; the human reviews between tasks. Best when you want frequent checkpoints, especially for the surgical edits in Tasks 3–7.

**2. Inline Execution** — Run tasks in the current session with periodic checkpoints. Faster if you trust the plan and want to watch it go.

---

## Execution outcome (2026-05-23 → 2026-05-24)

Executed inline. All 17 tasks landed. Final sun-stable git history:

```
2037dc0 feat: pick opening scene by sky state — sun→moon→solar noon   (v03)
e514547 fix: horizon-tap guard + default tilt 45°                     (v02)
5b9298b docs: README for stable demo
387b8db feat: iOS date picker label-for + geolocate fallback + v01
fdcf12a refactor: simplify tilt slider + strip OUT-feature markup and CSS
c332388 refactor: strip AR / sky-view / grid / underground wiring from app.js
d5d32eb chore: remove AR / sky-view / grid / orphans for stable cut
cec4ea0 chore: fork from sun-v2 @ 4deb1e7 — stable demo lineage starts here
```

Tagged `v01`, `v02`, `v03`. Both URLs live:

- `https://sun-blair.duckdns.org` → `/home/blair/sun-stable/` (stable demo)
- `https://experimental-blair.duckdns.org` → `/home/blair/sun-v2/` (this repo, experimental)

### Deviations from the plan

1. **Task 13 (sun-v2 AUDIT.md entry)**: skipped. The experimental repo had a dirty working tree (other in-flight changes), and inserting a bifurcation entry would have entangled this work with it. The full history of the bifurcation lives in this spec + plan + `sun-stable/AUDIT.md`; the experimental `AUDIT.md` can be updated when Blair commits his own WIP.
2. **Task 17 (push sun-v2 origin)**: skipped. The experimental repo is still 24 commits ahead of origin; pushing them is Blair's call, not part of stable's definition of done.
3. **iPhone smoke test** surfaced two issues not anticipated by the plan; fixes were applied immediately and tagged as v02 and v03 (see below).

### Post-deploy fixes from iPhone smoke test

**v02 — Horizon-tap guard + softer default tilt.** At high pitch, taps in the upper portion of the screen map to world coordinates kilometres away; tapping there accidentally flung the observer pin across the world. The existing top-of-screen pan guard only blocked drags, not single taps. Added a click-handler guard: when `pitch > 35°` and screen-Y is in the upper 35% of canvas, ignore the click. Default tilt slider dropped from 55° to 45°.

**v03 — Opening scene picker.** App loaded at current time regardless of sky state; opening after sunset showed an empty map with no live body. Added `pickOpeningScene(lat, lon)` called from both `tryGeolocate` paths: sun-above → sun mode at now; sun-below, moon-above → moon mode at now; both below → sun mode at today's solar noon. Imports updated to include `getDayBoundaries` from `solar.js`.
