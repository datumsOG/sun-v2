# CHARTER — sun-v2 (Sun · Light Planner, experimental)

## Purpose

sun-v2 is the **experimental development branch** of the Sun · Light Planner PWA lineage.
It is the place where new features are designed, spiked, and tested before being selectively
promoted to `sun-stable` (the live demo). It is always ahead of sun-stable in features and
always behind it in stability guarantees.

---

## Relationship to sun-stable

| Property | sun-v2 (this repo) | sun-stable |
|---|---|---|
| Role | Experimental, active development | Live 24/7 demo |
| URL | `experimental-blair.duckdns.org` | `sun-blair.duckdns.org` |
| Fork point | — (the source) | Forked from sun-v2 @ commit `4deb1e7` (v65) |
| Stability | Best-effort; may break | Stable; mirror mode removed, auto-reflection planned |
| Feature set | Full + experimental | Lean, curated subset |
| Versioning | Independent (currently v69+) | Independent (its own counter) |

**Feature flow:** new ideas originate in sun-v2, get proven here, then are manually
cherry-picked or rebuilt in sun-stable. Features are NOT automatically mirrored.

---

## Goals

1. **Explore photographer's-eye perspective.** Photo-3d view (three.js scene, tile texture,
   drag-to-swivel) — ongoing. End goal: standing-at-observer, seeing the caster and sun arc
   as a photographer would through their lens.

2. **Prove out the caster-as-separate-subject model.** Currently caster lat/lon is locked to
   the observer position. The intended final model: a draggable subject pin (e.g. CN Tower
   rooftop) distinct from the observer (e.g. street corner 200m away).

3. **Test AR camera mode improvements.** Camera 2.0 with two-axis calibration and FOV presets
   is implemented; pending UX pass before the UI button is un-hidden.

4. **Backyard / close-range use case.** Grid mode (graph-paper overlay at zoom 21, sub-10m
   radius arc) is the scaffold. Goal: a complete close-range planning mode without needing a
   street-map context.

5. **Alignment tooling.** DATA panel + alignment wizard (find next sun/moon alignment between
   two user-defined points) is active. Future: results history, share-alignment URLs.

---

## Anti-Goals

- **No stability guarantees.** sun-v2 may have experimental features that break on older
  iOS or Android versions. Stability is a sun-stable concern.

- **No backend, no accounts, no server state.** The app is and will remain pure front-end,
  static files, no API keys. If a feature requires a server, it belongs in a different project.

- **Do not touch sun-stable from sun-v2 commits.** The two repos are independent. Changes
  intended for sun-stable must be explicitly ported there.

- **No build toolchain.** No webpack, no Vite, no TypeScript compile step. The constraint
  "edit and refresh" is a feature, not a limitation — it keeps the dev loop fast and the
  codebase auditable.

- **No terrain elevation integration (yet).** Rise/set times assume a flat horizon. This is
  a known gap; terrain-aware horizon is out of scope until the core photographer-view workflow
  is stable.

- **No offline map tiles.** Service worker caches the app shell; map tiles require a network.
  A limited offline region feature is plausible but not planned.

---

## What Belongs Here vs. sun-stable

| Feature | sun-v2 | sun-stable |
|---|---|---|
| Experimental three.js photo-view | Yes | No |
| AR camera mode (arrow-view.js) | Yes | No |
| Below-view / photographer-view spikes | Yes | No |
| Core arc + shadow + reflection | Yes | Yes (curated) |
| Alignment wizard | Yes | TODO(blair) — decide if it graduates |
| Grid mode | Yes | TODO(blair) — decide if it graduates |
| Auto-reflection (planned) | No | Planned there |

---

## Definition of Done (per feature)

A feature in sun-v2 is "done" when:
- It works on iOS Safari (PWA) and Android Chrome without crashing.
- It does not break existing features (arc, shadow, reflection still function).
- AUDIT.md (now LOG.md) is updated with what changed and why.
- Service worker cache version is bumped.
- If it's a candidate for sun-stable: a note is added here or in LOG.md describing what
  a port would require.
