GPT-5 mini audit — Sun · Light Planner (sun-v2)

Date: 2026-05-07
Auditor: GPT-5 mini (automated review)

Summary
-------
This document is a comprehensive, pragmatic audit of the Sun · Light Planner (sun-v2) codebase located at /home/blair/sun-v2. The review covers architecture, security, performance, correctness, UX/accessibility, PWA/offline behaviour, third-party usage, and maintainability. Findings are prioritized: Critical → High → Medium → Low. For each item there's a short description, the risk, files/lines where relevant, and recommended actions.

High-level verdict
------------------
The app is thoughtfully designed (no build step, ES modules, PWA-first). It has clever geometry and UX. However, there are a number of critical/major issues that will affect reliability on devices, AR usability, cross-platform date/time handling, and maintainability. Several quick, surgical fixes will restore robust AR and picker behaviour; medium-term work will improve performance and correctness (terrain, reflections, alignment algorithm). See prioritized list and recommended next steps below.

Critical issues (must fix before release)
-----------------------------------------
C1 — AR/camera module null dereferences and missing guards
- Symptom: AR camera initialization can throw due to null DOM refs (e.g. elSensorBtn) and missing guards; breaks camera/AR UI.
- Files: js/ui/arrow-view.js (observed null writes and addEventListener on possibly null elements), js/app.js uses safe wrappers.
- Risk: Entire AR feature unusable; runtime exceptions kill UI flows and degrade user trust.
- Fix: Guard any DOM access with existence checks. Remove unconditional addEventListener calls that assume the element exists. Ensure initCameraView() tolerates missing optional DOM nodes.

C2 — Date picker unreliable on iOS / PWA
- Symptom: Date picker not opening reliably in iOS PWA mode because input was made non-interactive or programmatic activation is blocked.
- Files: index.html, css/style.css, js/ui/scrubber.js
- Risk: Core UX (selecting date) broken on iOS, leading to user confusion and inability to schedule future shots.
- Fix: Prefer native activation patterns: ensure the <input type="date"> is directly tappable (overlay input inside label/button), remove pointer-events:none, remove programmatic-only fallbacks. The codebase already contains alternate patterns; choose the approach that lands touches on the input itself.

C3 — URL share format ambiguity / timezone handling
- Symptom: encodeStateToHash formats a local date/time string without timezone. decodeHashToState uses new Date(t) which may be parsed inconsistently across environments and can produce unexpected datetime shifts when a link is opened in a different timezone or browser.
- Files: js/share.js
- Risk: Shared links may not reproduce exact intended local moment across recipients. For a photography planning tool this is high-risk (missed golden hour).
- Fix: Store times in an unambiguous form: either UTC ISO (d.toISOString()) plus explicit offset, or store date components plus timezone offset. When showing to users, convert to their local time. Consider adding an explicit timezone component (e.g., t=2026-05-07T18:30:00+02:00) or store epoch millis (t=1650000000000).

High-priority issues
--------------------
H1 — Brute-force alignment: performance and accuracy
- Symptom: alignment.js scans day-by-day for up to 365 days calling getDayBoundaries() and getPosition() per day.
- Files: js/alignment.js
- Risk: On lower-end devices this may be slow or block UI if run on the main thread; it lacks progressive feedback and doesn't use a worker.
- Fix: Move alignment computation into a Web Worker. Use early-exit heuristics and a root-finding approach for better accuracy (binary search around candidate dates or interpolation) and reduce days scanned. Provide a cancel token and show progress UI.

H2 — Map markers implemented as DOM Markers (performance)
- Symptom: sun-path.js creates 60+ DOM maplibregl.Marker elements for arc dots and updates offsets on every render.
- Files: js/layers/sun-path.js
- Risk: Markers are expensive on low-end phones; heavy zoom/pitch interactions may drop frames.
- Fix: Replace many DOM markers with a single lightweight WebGL layer or MapLibre styling (circle layers with data-driven styling) whenever possible. If DOM is required for advanced offsetting, reduce sample count adaptively by device capability (~20 samples on weak devices) and reuse marker elements rather than recreating them.

H3 — AR ray/ground logic: missing graceful fallbacks
- Symptom: AR overlay skips drawing connecting lines (body→caster→shadow) when the ground endpoint is behind the camera. Several rendering functions assume projectPoint returns a value.
- Files: js/ui/arrow-view.js, js/layers/shadow.js, js/layers/sun-path.js
- Risk: AR feels broken when pointing at the sky; important cues missing.
- Fix: Extrapolate the body→caster ray to the nearest screen edge when the ground point is not projectable; draw guide arrows and edge markers. Add explicit guard paths instead of silently hiding elements.

Medium issues
-------------
M1 — Service worker: network-first strategy and cache policy
- Symptom: SW is network-first for same-origin resources; cross-origin requests are passed through. SHELL includes only './', './index.html', './manifest.webmanifest'. The fetch handler caches successful fetches of same-origin requests.
- Files: sw.js
- Risk: Network-first means offline UX is degraded (map tiles still remote). On poor networks initial load is slow; also deploying file changes requires clients to re-fetch (but that is an intentional choice).
- Fix: Consider using stale-while-revalidate for static assets and cache-first for core shell CSS/JS to improve offline UX. Keep a short network-first for index.html if immediate deploys are desired, but cache static assets for offline viewing and add a visible "offline" indicator if map tiles not available.

M2 — External CDN usage and supply chain risk
- Symptom: maplibre and three (importmap) are loaded from unpkg.com, importmap points to unpkg three module.
- Files: index.html (external scripts/importmap)
- Risk: External CDN content can change or be blocked; supply-chain risk for production. importmap can fetch a remote module at runtime.
- Fix: Vendor lock critical libs into /vendor/ or pin exact versions and serve from your origin or a trusted CDN with subresource integrity where possible. For importmap modules there's no SRI; consider serving a local copy.

M3 — Error monitor stores potentially large or sensitive states
- Symptom: monitor.js writes a ring buffer to localStorage including state snapshots, userAgent, stack traces and optionally sends to Sentry if configured.
- Files: js/monitor.js
- Risk: Error payloads could contain location and datetime data; if forwarded to a third-party (Sentry) this contains PII-sensitive location/time data. Also localStorage size and serialisation may fail.
- Fix: Avoid storing raw lat/lon or user-sensitive fields in external reports. Redact or hash precise location info before sending. Consider a user opt-in for sending location data to Sentry.

M4 — project3D assumptions brittle across MapLibre versions
- Symptom: project3D reads map.getFreeCameraOptions and uses transform.cameraToCenterDistance as fallback; these internals may change.
- Files: js/util.js
- Risk: Breaking changes in MapLibre could break 3D projection and AR alignment.
- Fix: Encapsulate fallbacks and feature-detect carefully. Provide a clear capability boolean (mapSupportsFreeCamera) and degrade gracefully if unavailable (use centre projection without elevation, and notify users when extreme parameters are used).

M5 — geocoding error handling swallows failures
- Symptom: search.js hides results on any fetch error with no user-visible feedback.
- Files: js/ui/search.js
- Risk: Silent failure; user thinks search didn't find anything.
- Fix: Show an inline status ("Search failed — check network") when the fetch fails. Provide exponential backoff or cached last-results.

Low/maintenance issues
----------------------
L1 — Duplicate helper functions and minor code smells
- Files: js/solar.js has local startOfLocalDay duplicate of util.startOfLocalDay; js/solar.js misplaced JSDoc blocks.
- Fix: Consolidate utilities in util.js and reduce duplicated code.

L2 — Orphaned files
- Files: js/buildings.js, js/terrain.js, js/reflection.js (root), js/ui/chart.js (not imported)
- Risk: Confusion for maintainers; unused code may rot.
- Fix: Move to /archive/ or delete if not required. Add a short README about these remnants.

L3 — Missing tests and CI
- Symptom: No unit tests, no linting, no CI.
- Risk: Regressions during refactors; manual testing required.
- Fix: Add lightweight CI: ESLint (recommended rules), unit tests for pure math (solar.js util functions), and a headless integration test that loads index.html with Puppeteer to verify key flows (map loads, scrubber works, AR permission flow simulated). Minimal first step: add a GitHub Action to run lint + tests on PRs.

Security & privacy review
-------------------------
- No server-side components so attack surface is smaller. However:
  - Third-party CDN code is executed in client context (MapLibre, Three.js). Consider vendoring.
  - Sentry integration (optional/configured by env) can leak location/time snapshots. Don't forward exact lat/lon or ISO datetimes unless user consents.
  - localStorage is used for error logs and reminders: no encryption; warn users in privacy policy.
  - Geocoding & tile providers: ensure the tile server (OpenFreeMap) terms allow your expected traffic and caching.

PWA & offline experience
------------------------
- Service worker design is intentional (network-first) but should be tuned for user expectations: provide clear offline UX, cache core assets for offline load, and handle tiles gracefully.
- Map tiles are cross-origin and currently bypass SW caching. If you plan offline region download, implement MBTiles or tile cache with explicit user consent and storage quotas.

Performance suggestions
-----------------------
- Replace many DOM Markers with MapLibre vector layers or a single canvas overlay for arc dots.
- Throttle heavy geometry recalculations: alignment scan, elevation curve generation, and per-frame updates should yield to requestAnimationFrame and be cancellable.
- Profile on lower-end Android devices. Consider an "economy mode" with fewer samples and simplified overlays.

UX & accessibility
------------------
- Many controls have aria-labels (good). Ensure keyboard accessibility: map is interactive but AR/camera features require gestures — provide fallback keyboard flows for desktop.
- Color contrast: test with WCAG tools for the main controls (glass backgrounds +/-). Add visible focus outlines for keyboard users.
- Provide language/localization hooks if you plan to ship internationally: date/time formatting currently uses toLocaleTimeString which is good, but shared URL semantics must be unambiguous.

Testing & monitoring recommendations
-----------------------------------
- Add unit tests for all deterministic math (util.bearing, util.destination, solar.azimuth conversions, alignment angDelta). These are easy to test.
- Add an automated smoke test (Puppeteer) that loads index.html, sets observer, scrubs time, and asserts UI updates (rise/set labels visible).
- Keep the error ring buffer but add an opt-in to forward to Sentry and strip sensitive fields before sending.

Priority action plan (short-term)
---------------------------------
1. Fix AR null refs and guard DOM accesses in js/ui/arrow-view.js (Critical).
2. Fix date picker iOS behaviour by making input directly interactive and removing pointer-events:none; ensure label/input activation is reliable (Critical).
3. Change share URL encoding to UTC epoch or ISO with offset (Critical).
4. Move alignment calculation into a Web Worker and add cancel/progress UI (High).
5. Reduce DOM marker count or move to WebGL vector layers in sun-path (High).
6. Add small unit tests for util and solar math (Medium).
7. Evaluate service worker caching strategy and decide between fast deploy vs offline UX (Medium).

Longer-term roadmap
-------------------
- Terrain modeling (sample elevation tiles) to compute true visible horizon and dip adjustments.
- Reflection improvements: model non-vertical surfaces (tilt) and 3D reflection with normals for glass facades.
- Offline tile region export with MBTiles and storage quota UI.
- A/B tested onboarding for AR permission flow and sensor alignment calibration.

Appendix: Notable code snippets and suggested edits
--------------------------------------------------
- js/share.js: encodeStateToHash: replace the iso construction with either:
  - isoUtc = date.toISOString(); parts.push(`t=${isoUtc}`) — when decoding, new Date(isoUtc) is unambiguous; or
  - epoch = date.getTime(); parts.push(`t=${epoch}`); decode with new Date(Number(epoch)).

- js/alignment.js: use worker + binary search instead of purely brute-force day loop. Use getDayBoundaries once per day, then if azimuths cross tolerance, refine with smaller step interpolation.

- js/layers/sun-path.js: create a deviceCapability check; if weak device set SAMPLES = 24 and reduce DOM operations.

- sw.js: consider a two-tier cache: CACHE_STATIC = 'sun-shell-vNN' (cache-first), CACHE_RUNTIME = 'sun-runtime-vNN' (network-first for index). Use stale-while-revalidate for app shell assets.

Deliverable
-----------
A copy of this audit has been written to /home/blair/sun-v2/GPT-5 mini audit.md.

If preferred next step: apply the critical fixes now (I can implement the JS/HTML edits, run a quick smoke test in the VM, and prepare a tidy commit with the Co-authored-by trailer). Which action should be taken next?

