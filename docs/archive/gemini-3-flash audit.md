# Sun · Light Planner — Comprehensive Code Audit
**Date:** May 7, 2026
**Audited by:** Gemini-3-Flash (Interactive CLI Agent)

---

## 1. Executive Summary
The "Sun · Light Planner" is a remarkably sophisticated and highly functional PWA. Its implementation of 3D projection on a 2D map and AR overlays using vanilla DOM/SVG elements is clever and performs surprisingly well for a "no-framework" app. The lack of dependencies (other than MapLibre and SunCalc) makes it extremely fast to load and easy to deploy.

However, as the app has grown in complexity (Shadows, Reflections, Grid Mode, AR 2.0), the "vanilla" architecture is reaching its limits. There are significant performance bottlenecks in the new Grid Mode, architectural coupling in the main controller, and potential stability issues with state management and memory.

---

## 2. Critical Performance & Architectural Flaws

### [CRITICAL-P1] Grid Mode DOM Thrashing
**File:** `js/layers/grid.js`
The `_render()` function in Grid Mode is a significant performance bottleneck. It clears and **re-creates hundreds of SVG elements** (`<line>`, `<text>`) on every single `map.on('render')` event.
*   **The Flaw:** During a map pan or zoom, this happens up to 60 times per second. This causes massive garbage collection pressure and layout thrashing, which will make the app stutter or even crash on mid-range mobile devices.
*   **Recommendation:** Use a **persistent pool** of SVG elements and update their attributes (`x1`, `y1`, etc.) instead of re-creating them. Alternatively, use a single `<path>` element with a concatenated `d` attribute for all grid lines of the same type.

### [CRITICAL-A1] The `app.js` "God Object"
**File:** `js/app.js`
`app.js` has grown into a 500+ line monolith that manages:
1.  Map initialization and styling.
2.  Direct DOM references for almost the entire UI.
3.  Complex event handling for multiple modes (Reflection, Grid, Drift).
4.  Persistence (Save/Restore).
5.  State subscription and the main `redraw` loop.
*   **The Flaw:** This high coupling makes the app fragile. A small error in the reflection drawing logic can crash the entire `syncChrome` update, leaving the UI in an inconsistent state.
*   **Recommendation:** Modularize. Break `app.js` into distinct controllers: `MapController`, `UIController`, `PersistenceController`, and a thin `Main` entry point.

---

## 3. Technical Design & Stability Issues

### [HIGH-1] Unsafe State Mutation
**File:** `js/state.js`
The store uses `Object.is` for change detection.
*   **The Flaw:** Several state properties are objects (e.g., `observer: { lat, lon }`). If a developer accidentally mutates `state.observer.lat` directly and then calls `store.set({ observer: state.observer })`, the store will **not** detect the change because the object reference is identical. Listeners (including the map update) will not fire.
*   **Recommendation:** Enforce immutability. Use `Object.freeze` on the state during development or use a deep-clone/spread pattern in `set()`: `state[k] = typeof partial[k] === 'object' ? { ...partial[k] } : partial[k];`.

### [HIGH-2] Memory Leaks & Event Listener Bloat
**Files:** `js/layers/*.js`, `js/ui/*.js`
Almost every module attaches listeners to `window` or `map` during initialization, but **none provide a cleanup/destroy function**.
*   **The Flaw:** If the app were to implement a "Reset" or "Reload Style" feature, listeners would be duplicated. In a long-running PWA session, this can lead to memory bloat and degraded performance.
*   **Recommendation:** Standardize a `destroy()` or `cleanup()` method for every module and call them when tearing down or re-initializing views.

### [MEDIUM-1] Manual PWA Versioning (The "v44" Problem)
**Files:** `sw.js`, `index.html`
Versioning is handled by manually bumping strings like `v44` in two places.
*   **The Flaw:** This is extremely prone to human error. Forgetting to bump the SW version means users stay on old cached code even after a fix. Forgetting to bump the query string in `index.html` means the browser might serve a stale `app.js`.
*   **Recommendation:** Use a simple build script (even a 5-line bash script) to generate a unique hash for assets and inject it into the `sw.js` and `index.html`.

### [MEDIUM-2] Perspective Drift vs. User Interaction
**File:** `js/app.js`
The "Idle perspective drift" uses `requestAnimationFrame` to gently move the map.
*   **The Flaw:** While it stops on `mousedown`/`touchstart`, it doesn't account for programmatic movements (like `flyTo` from search or geolocation) unless explicitly called. It also doesn't check if the map is currently moving for other reasons.
*   **Recommendation:** Check `map.isMoving()` or `map.isZooming()` before applying drift.

---

## 4. UI/UX & Field Reliability

### [LOW-1] Timezone Ambiguity
**File:** `js/solar.js`, `js/ui/scrubber.js`
The app uses the browser's local time for all calculations and displays.
*   **The Issue:** A photographer in London planning a shoot for Tokyo will see times in GMT (their current browser time) unless they manually change their system clock. This is a common source of planning errors.
*   **Recommendation:** Explicitly display the timezone being used (e.g., "All times in [Local Timezone]") and consider adding a toggle to plan in the target location's local time.

### [LOW-2] AR Calibration Assumptions
**File:** `js/ui/arrow-view.js`
The AR view assumes a fixed eye height (`1.6m`) and hardcoded FOV presets.
*   **The Issue:** On devices with unusual focal lengths or for users of different heights (e.g., tripod vs. handheld), the AR overlay will have a consistent offset.
*   **Recommendation:** Allow the user to "fine-tune" the FOV and Eye Height in a settings panel. The current "Align" calibration is great for heading/pitch, but doesn't fix scale issues.

### [LOW-3] Shadow "Hard Capping"
**File:** `js/layers/shadow.js`
Shadows are hidden entirely if the distance exceeds `4km`.
*   **The Issue:** At sunset/sunrise, shadows are infinitely long. Hiding them completely at `4km` might be jarring if the user is looking for a general direction.
*   **Recommendation:** Instead of hiding, show the shadow line fading out or truncated with a "Long Shadow" indicator.

---

## 5. Coding Style & Maintenance

*   **Orphaned Files:** `js/buildings.js`, `js/terrain.js`, `js/reflection.js` (root), `js/ui/chart.js` are still in the repo but not used. **Delete them.**
*   **Dead Code:** The `attachLongPress` function was removed, but its CSS might still be present.
*   **Consistency:** Some modules use `export function`, others use `let ... export function`. Standardizing on a consistent module pattern would improve readability.

---

## 6. Final Verdict
The app is a technical "tour de force" for vanilla JS. It is 90% "feature complete" for its monetization goal. To cross the finish line, focus on **Grid Mode performance** and **Architectural modularity** to prevent the app from collapsing under its own weight as you add the final polish.

**Overall Health:** 8.5/10
**Maintenance Risk:** High (due to coupling)
**Performance Risk:** High (in Grid Mode)
