# Sun · Light Planner (V2) - Technical Project Summary
**Date:** May 1, 2026
**Location:** `/home/blair/sun-v2`

## 1. Project Overview
"Sun · Light Planner" is a mobile-first, high-performance Progressive Web App (PWA) designed for photographers, cinematographers, and light planners. It enables precise visualization of sun positions, alignment calculations, and light reflection vectors using an interactive map and a 3D AR-style overlay.

### Key Technical Pillars:
- **Vanilla Tech Stack:** Pure ES Modules, no frameworks, no build step.
- **High Performance:** 60fps UI updates for time scrubbing using `requestAnimationFrame` and CSS transforms.
- **Privacy & Speed:** Client-side only; no backend, no API keys for tiles/search.
- **Reactive State:** A tiny (~80 line) custom pub/sub state manager (`state.js`).

---

## 2. Architecture & File Structure
```text
/sun-v2
├── index.html              # Main entry point & UI structure
├── manifest.webmanifest    # PWA configuration
├── sw.js                   # Service Worker (Cache-first for app shell)
├── css/
│   └── style.css           # Comprehensive design system (Glassmorphism)
├── js/
│   ├── app.js              # Central orchestration & event wiring
│   ├── state.js            # Reactive store (observer, datetime, mode, target)
│   ├── solar.js            # Wrapper for SunCalc with custom math (azimuth/elevation)
│   ├── reflection.js       # Vector math for mirrored light
│   ├── alignment.js        # Brute-force search for future sun alignments
│   ├── share.js            # URL hash synchronization (state persistence)
│   ├── map.js              # MapLibre GL initialization (OpenFreeMap)
│   ├── util.js             # Geodesic math (destination, bearing) & UI helpers
│   ├── layers/             # MapLibre GeoJSON layers
│   │   ├── observer.js     # User's current location pin
│   │   ├── sun-path.js     # Arc path, rays, and sun marker
│   │   ├── reflection.js   # Incident/Reflected rays & wall drawing
│   │   └── target.js       # Alignment target pin & dashed line
│   └── ui/                 # UI Component logic
│       ├── scrubber.js     # Time slider & date picker logic
│       ├── chart.js        # SVG elevation chart with twilight bands
│       ├── search.js       # Geocoding via Photon API
│       ├── sensor.js       # Device orientation/compass logic
│       └── arrow-view.js   # Three.js 3D Arrow & AR Camera view
└── vendor/
    └── suncalc.js          # Underlying solar position library
```

---

## 3. Core Functional Specifications

### A. Solar Math (`solar.js`)
- Uses `SunCalc` to get raw position.
- **Azimuth Correction:** Normalizes SunCalc's (South=0) to Compass (North=0, clockwise).
- **Day Boundaries:** Calculates Sunrise, Sunset, Civil/Nautical/Astronomical Dawn/Dusk, and Golden Hour ranges.
- **Elevation Curve:** Generates samples for the 24h chart.

### B. Interactive Map (`map.js` + `layers/`)
- **Engine:** MapLibre GL JS.
- **Style:** OpenFreeMap (Dark).
- **Sun Path Arc:** A continuous GeoJSON `LineString` projected at a fixed radius (~6km) from the observer. The arc is color-graded using `line-gradient` based on elevation (Sunrise: Orange → Noon: Yellow → Sunset: Red).
- **Time Scrubbing:** As the user drags the scrubber, only the "live" sun ray and marker update on the map (no full GeoJSON re-gen).

### C. Alignment Search (`alignment.js`)
- ** Brute-force Algorithm:** When a target is set, the app searches the next **365 days** to find when the sun (at sunrise or sunset) aligns with the bearing from observer to target within a **±1.5° tolerance**.
- Returns the exact date and time of the next alignment for the "Jump" feature.

### D. Reflection Mode (`reflection.js` + `layers/reflection.js`)
- **2D Mirroring:** User draws a "wall" line on the map.
- **Formula:** Reflected Azimuth $R = (2 \times \text{WallBearing} - \text{SunAzimuth} + 180) \pmod{360}$.
- Visualizes the incident ray (Sun → Wall) and reflected ray (Wall → Outward).

### E. 3D Arrow & AR View (`ui/arrow-view.js`)
- **Engine:** Three.js.
- **Sensors:** Uses `deviceorientationabsolute` (with iOS permission flow) to calculate a 3D rotation matrix ($R$).
- **3D Mode:** A volumetric arrow points at the sun in real-world space. Shading and girth change based on sun elevation and sensor uncertainty.
- **AR Mode:** Activates rear camera. Projects the sun position into Screen Space using the device orientation matrix and camera FOV constants. Fades in a "Guide Arrow" if the sun is out of frame.

---

## 4. UI/UX Design System (`style.css`)
- **Aesthetic:** Dark "Glassmorphism" (Blur: 24px, Saturation: 140%).
- **Color Palette:**
  - Gold (`#ffb845`): Sun / Alignment.
  - Cyan (`#4dd2ff`): Reflection.
  - Sunrise/Set (`#ff8a3d` / `#ff5e3d`).
- **Elevation Chart:** Custom SVG with twilight bands (Civil, Nautical, Astronomical) and Golden Hour shading.
- **Responsive:** Mobile-first with safe-area handling for notches/home bars.

---

## 5. State Management & Persistence (`state.js`, `share.js`)
- **Global State:**
  ```javascript
  {
    observer: { lat, lon },
    datetime: Date(),
    mode: 'sun' | 'reflection' | 'arrow',
    target: { lat, lon } | null,
    compassEnabled: boolean,
    compassHeading: number | null
  }
  ```
- **Sync:** Every change to `observer`, `datetime`, `mode`, or `target` is debounced and encoded into the URL hash (e.g., `#ll=...&t=...&m=...`). This allows instant sharing of specific planning moments.

---

## 6. Implementation Notes for Future Development
1. **Terrain Dip:** Currently assumes a flat horizon. Future versions should sample terrain elevation tiles to calculate visible sunrise/sunset.
2. **Offline Support:** The Service Worker caches all assets, but map tiles require a network. Consider a limited MBTiles/offline region feature.
3. **Surface Normals:** Reflection mode currently assumes a vertical wall. Adding a "Tilt" parameter to the wall would allow for glass building reflections.
4. **AR Calibration:** Add a manual "Lock to Sun" feature to compensate for magnetic interference (implemented in `arrow.html` but needs full port to `sun-v2`).
