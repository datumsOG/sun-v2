# LOG — sun-v2

Append-only. One entry per change session: date, what changed, why.
Format: `## YYYY-MM-DD` followed by a summary of what changed and the reasoning.

---

## 2026-06-12

Doc standard applied. Created HANDOFF.md, CHARTER.md, LOG.md (seeded from AUDIT.md).
Archived AUDIT.md, gemini-3-flash audit.md, gemini_summary_01-may-2026.md, GPT-5 mini audit.md
to docs/archive/. No code changes.

---

## 2026-05-23

docs: spec + implementation plan for sun-stable/experimental bifurcation.
Three commits: spec (`e644554`), plan (`4f85456`), execution outcome + v02/v03 fixes (`838260a`).
Established that sun-stable forks from sun-v2 @ v65 (commit `4deb1e7`) and the two repos
diverge independently from that point.

---

## 2026-05-20

v66–v69: photographer's-eye view development arc.

- **v66** (commit `4f2...`): Below-view 3D prototype spike — CSS `preserve-3d` scene wrapper,
  SVG overlays reparented to a +Z plane, below-toggle button. Proved feasibility; MapLibre
  markers on map ceiling was the blocker.
- **v67**: Replaced below-view with photographer view — stand-at-observer, drag-to-swivel,
  pinch-to-zoom. New `_photoActive` state, `_applyPhotoElev()`, `_enterPhotoView()`.
  Mutually exclusive with compass. Caster locked to observer lat/lon (deferred to later).
- **v68**: Debug pass on photo-view: bumped underground rotation factor 35°→60° (arc visible
  to 55° above horizon), removed compass mutex (can coexist), auto-orient on entry (opens
  facing sun), smooth `easeTo` on exit.
- **v69**: Photo-view rebuilt as three.js scene (`js/ui/photo-3d.js`, ~430 lines). Virtual
  camera at shadow endpoint position (photographer's anchor), real ENU-projected caster +
  sun arc, local map tile texture snapshotted at entry, corridor-fade shader. Replaced all
  `_photoActive` CSS-hack code in app.js. shadow.js: 200ms fade-out for invalid markers
  (`opacity` pattern instead of `.remove()`). Eye-button gated on shadow endpoint validity.

---

## 2026-05-08

v46–v47: stability pass + DATA panel + alignment wizard.

- **v46**: Three fixes from cross-audit: grid.js DOM thrashing fixed (800+ nodes/frame →
  3 `<path>` attribute writes); `redraw()` per-layer try/catch isolation + NaN observer guard;
  drift loop guards (`map.isMoving()` before start, try/catch in frame).
- **v47**: Bug fixes (orange ray line at caster=0, map reload centering, grid mode hiding
  SR/SS/RAY lines via separate SVG mirror). DATA button + panel (observer + shadow endpoint
  coordinates). Alignment wizard (two-step, `findAlignmentBetweenPoints()`, ±1° tolerance,
  5-min steps, 1-year scan). Tap time display to open native time picker.

---

## 2026-05-06

v41–v45: polish pass + grid mode.

- **v41**: Arc dot z-ordering (screen-Y-based depth cue), perspective size scaling (5–10 px by
  altitude), solid SR/SS lines with gradient fade at ends, wider vslider touch area (44 px),
  scale bar (MapLibre ScaleControl), invert mode double-invert fix.
- **v42**: Grid mode (`js/layers/grid.js`) — graph-paper SVG overlay, auto-scaling cells,
  metric/imperial toggle, zoom-21 fly-in, observer as origin. Top-of-screen pan guard (28%
  zone blocked for single-touch drag at high pitch).
- **v43**: Camera mode 2.0 phase 1 — visual two-axis calibration (camera-forward method,
  az+el offsets persisted), FOV preset toggle (0.5×/1×/2×), centre crosshair, long-press
  to clear calibration.
- **v44**: Grid mode bugfixes — zoom 24→21 (camera AGL now above arc apex), arc radius
  auto-shrunk to 10 m on grid entry, `moveend` refresh to rebuild arc at new scale, unit
  toggle moved from dock to floating pill.
- **v45**: Arc dot density-aware sizing (caps rendered size when zoomed out), drift jitter
  fix (sub-pixel offset cache skips DOM writes < 1px).

---

## 2026-05-05

v36–v40: shadow geometry redesign + UI persistence + monitoring.

- **v36**: Sky line changed from `<line>` to `<polyline>` with three explicit waypoints
  (body → caster → shadow end) to force visual intersection with caster sphere regardless of
  `project3D` approximation error near the horizon.
- **v37**: Error monitoring (`js/monitor.js`) — localStorage ring buffer (last 50 entries),
  optional Sentry hook. Crash hardening: null guards in arrow-view.js (elCalibrate, elCapture,
  elView, elVideo, AR elements), `isFinite` guards in shadow.js and sun-path.js.
- **v38**: Shadow geometry redesign — caster fixed at OBJECT_H_M, floor surface at FLOOR_H_M,
  effective shadow height = caster − floor, shadow hidden when distance > 4 km, green
  ground-ref indicator. AR shadow updated to match. UI persistence: caster/floor/radius/tilt
  to `localStorage['sun_ui']`.
- **v39**: Tap-to-edit number inputs for Caster and Floor height rows (borderless input,
  log-curve inverse `heightToSlider`).
- **v40**: Spherical slider thumbs (radial gradient, 24 px circle). Idle perspective drift
  (±2° bearing, ±1.5° pitch, 4 s idle, stops on interaction, 600 ms ease-back).

---

## 2026-05-04

v32–v35: shadow always-on + floor slider + regression fixes.

- **v32** (Part 5b): N1–N4 from new work plan executed — reflection mode no longer hides arc,
  drop line + moon-mode ray recolouring, shadow on by default (caster default 0 m), floor
  slider (observer on floor surface, shadow lands on floor).
- **v33** (Part 6): Shadow toggle removed (always on), green floor dot + green ground→floor
  line, SVG element order revised.
- **v34** (Part 7): Shadow graphics regression fix (endMarker null-check instead of
  display style), drop line sync on slider move (renderDropLine called in updateAllOffsets).

---

## 2026-05-03

v30–v31: initial audit + critical fixes.

- **v30** (Part 3): Five fixes from audit — null crash in arrow-view.js (elSensorBtn),
  date picker iOS fix (label→input approach), AR shadow line to screen edge when endP null,
  blue pole line added to AR overlay, dead code removed (attachLongPress, dom.hint).
- **v31** (Part 3b): Three follow-up fixes — orange ray line always visible (independent of
  sun-path visibility), reflection mode works in moon mode, date picker third attempt
  (input overlay inside button, touch lands directly on input).

---

## 2026-05-01 and earlier

v1–v29: initial feature development (pre-audit). Key milestones from git log:

- v65 (commit `4deb1e7`): underground view via CSS perspective rotateX — this is the fork
  point for sun-stable.
- v58–v63: sky view, compass panning, tilt slider, underground/upward perspective work.
- v57: altitude readout, compass panning, camera button hidden.
- v39: tap-to-edit height inputs (earlier iteration).
- v38: shadow geometry redesign (earlier iteration).
- v37: error monitoring.
- v36: polyline sky line fix.
- Earlier: shadow always-on, floor concept, reflection improvements, arc dot improvements.

Full detail for pre-v30 work is in `docs/archive/AUDIT.md`.
