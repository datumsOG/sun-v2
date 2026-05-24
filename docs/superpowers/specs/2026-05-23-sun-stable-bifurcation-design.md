# Sun · Light Planner — Stable / Experimental Bifurcation

**Date:** 2026-05-23
**Status:** Design (awaiting implementation plan)
**Scope:** Function only — visual design pass deferred to a separate session

---

## Why this exists

`sun-v2` has matured into an impressive PWA, but it is permanently in flux. Experimental features (sky view, underground view, grid mode, AR camera, drift, photo-3d) co-exist with mature features (map, scrubber, sun/moon arc, shadows, reflection, alignment) in a single tree that is almost always somewhere between "broken" and "half-done."

That state is the right state for an R&D codebase. It is the wrong state for the URL Blair shares with hiring managers.

This design bifurcates the project so that:

- A **stable demo** lives at `sun-blair.duckdns.org` (the URL already in circulation) and works 24/7 with no surprises.
- An **experimental playground** lives at `experimental-blair.duckdns.org` and continues to be a workshop where things break.

The two are physically separated — separate git repos, separate directories, separate Caddy blocks, separate service workers. They share nothing at runtime.

## Guiding principle: more division is more better

Wherever the design could choose between "share infrastructure" and "duplicate infrastructure," it duplicates. The cost of disk space and duplicated config is trivial; the cost of an experimental bug breaking the demo URL during a recruiter visit is not. This principle is non-negotiable and should be preserved by any future change to this architecture.

## Target

- **Primary device:** Mobile Safari on iPhone. Every decision that requires picking sides picks Mobile Safari first.
- **Time-to-wow:** 30 seconds. A cold visitor with no instructions should, within half a minute, have felt "this is delightful to touch."
- **Reliability bar:** the stable URL must not crash, white-screen, or hang under any reasonable input. If a feature cannot meet that bar, it does not belong in stable.

## Feature scope — stable

**IN:**

- Interactive map (MapLibre)
- Sun / moon arc with full-day sweep, drop lines, live body dot
- Time scrubber + date picker (with the iOS fix from the audit)
- Reflection mode
- Alignment search
- Shadow geometry (caster sphere, floor concept, sky line)
- Tap-to-edit heights
- URL hash sharing
- PWA shell + service worker
- Compass mode (device orientation → bearing + pitch; stays even if "useless" because it feels special)
- Idle perspective drift (gentle map motion when no input; preserves the 3D illusion)
- Error monitoring (the existing localStorage ring buffer)

**OUT (live on experimental only):**

- AR camera overlay — a real project of its own; stays out until it can be its own polished product
- Sky view
- Underground / below view
- Grid mode
- `photo-3d` (the untracked experimental file)
- Any other feature added to experimental after the cut

## Opening scene — the 30-second wow

On first load:

1. App prompts for geolocation immediately. No splash, no marketing copy, no "tap to start." The prompt itself is the first interaction.
2. On grant → map zooms to the user's current position, sets time to "now," renders the live sun/moon arc, and begins the idle perspective drift. The arc is already moving subtly. The scrubber sits at the current minute. The user has not touched anything yet and the app already looks alive.
3. On deny / unavailable → fall back to a curated scene. Pick one striking, photogenic default (e.g., a recognisable landmark with clean sightlines and a dramatic arc) and use it. Do not surface an error — the user should not feel they "failed" the prompt.

Earlier iterations of the app reportedly nailed this feel. Reference those moments when polishing.

## Bifurcation architecture

### Filesystem layout

```
/home/blair/sun-v2/           # experimental (existing); served at experimental-blair.duckdns.org
/home/blair/sun-stable/       # new, standalone git repo; served at sun-blair.duckdns.org
```

### Why a separate repo (not a branch or worktree)

A branch invites accidental merges. A worktree shares history and `.git`. A separate clone with its own `.git` is the hardest physical boundary git permits, and matches the guiding principle above. The cost is one rebase ceremony per promotion, which is the right friction — it makes "what's in stable" a deliberate choice rather than a default.

### Caddy

Two independent server blocks. Each block serves only one directory. Neither block knows about the other. Both terminate TLS via the existing Caddy ACME flow.

### Service workers

Separate `CACHE` names — `sun-stable-vNN` for stable, `sun-v2-shell-vNN` (existing) for experimental. The two PWAs must never share a service worker; this has caused pain before. Browsers scope service workers by origin, so the separate subdomains give us this for free, but the cache names are also distinct as belt-and-suspenders.

### Versioning

Each repo bumps its own `?v=NN` query strings and SW cache name on deploy. They are not synchronised. Stable is on its own version line; experimental keeps the v65+ progression.

## Cut point

Fork stable from current `master` HEAD (`4deb1e7`, v65). Before the cut:

- The dirty working tree on `sun-v2` (uncommitted `shadow.js` / `app.js` / `index.html` / `css/style.css` / `AUDIT.md` / `sw.js` and untracked `photo-3d.js`) is **not** part of the cut. That work stays on experimental and gets committed there separately.
- After the cut, the stable repo has the surgical removals from the "OUT" list applied, plus the iOS date picker fix from the audit (CRITICAL-2: convert `#date-btn` to `<label for="date-input">`, drop `pointer-events: none`). Other audit findings that touch only OUT features (e.g. the AR null-deref) are moot because the affected code is removed.

The 24 commits ahead of `origin/master` on the experimental repo are independent of this work and should be pushed by Blair at his convenience.

## Promotion workflow

Promotion is a deliberate human action, not automation.

1. A feature reaches "stable quality" on experimental (works on Mobile Safari, no crash paths, no hidden states, no half-finished UI).
2. Blair signals: "promote feature X."
3. Manual port: copy the relevant files into `sun-stable`, resolve any drift, smoke-test on Mobile Safari, commit, deploy.
4. Bump `?v=NN` and the SW cache name in `sun-stable`.

No scripts, no cherry-picks across repos, no shared submodules. Friction is the feature.

## Out of scope for this session

- **Visual / chrome redesign.** Blair will run the stable code through Claude Design as a separate pass once function is locked. Do not redesign panels, sliders, or layout in this session.
- **AR rework.** A real product on its own; will be a separate spec.
- **Performance refactor.** Grid mode perf is out because grid mode itself is out. No god-object refactor on `app.js` in this pass — the audits flag it but it works.
- **Build step / bundler.** Stable stays vanilla ES modules, same as experimental. No tooling additions.
- **Tests.** No test suite added in this pass. Manual smoke-test on Mobile Safari is the verification standard.

## Definition of done

- `sun-blair.duckdns.org` resolves to the stable build and loads on Mobile Safari without errors.
- `experimental-blair.duckdns.org` resolves to the experimental build (current `sun-v2` repo) and loads.
- The two service workers do not interfere; clearing one does not affect the other.
- The stable opening scene works as specified: geolocate → current position + time → arc visible + drift active.
- All "OUT" features are absent from the stable build (no hidden buttons, no dead code paths, no references in HTML or JS).
- All "IN" features work on Mobile Safari, including the iOS date picker.
- A README in `sun-stable` documents: what's in, what's out, the promotion workflow, and the "more division is more better" principle.
- The existing `sun-v2` AUDIT.md gets an entry recording the bifurcation.

## Open follow-ups (next sessions, not now)

- Visual / chrome redesign pass on the stable build.
- AR camera as a standalone product.
- Curated landmark scene for the geolocate-denied fallback — pick the specific landmark.
- Decide whether `sun-blair.duckdns.org` should later move to a more brandable subdomain once Blair is ready to circulate it widely.
