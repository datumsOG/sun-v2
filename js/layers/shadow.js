// Shadow visualisation:
//
//   • White dot at true ground level (observer lat/lon, 0 m). Never moves.
//   • Light-blue caster sphere at OBJECT_H_M above the white dot. Never moves
//     when the floor slider changes — only moves when the caster slider changes.
//   • Light-blue vertical pole from white dot → caster sphere.
//   • Body-coloured shadow endpoint dot, elevated to FLOOR_H_M above the ground
//     at the shadow landing position (not at the observer).
//   • Green dot at ground level directly below the shadow endpoint (only when
//     floor > 0 — shows the ground projection of where shadow lands on the floor).
//   • Green vertical line from green dot up to shadow endpoint.
//   • Body-coloured sky line from sun/moon body → caster → shadow endpoint.
//
// Shadow geometry:
//   The caster casts a shadow onto a horizontal surface (the "floor") at
//   FLOOR_H_M above ground. The effective height that produces the shadow is
//   shadowH = OBJECT_H_M − FLOOR_H_M (only the portion of the caster above the
//   floor contributes). If floor ≥ caster, or the shadow distance exceeds
//   MAX_SHADOW_KM, or the body is below 0.5°, the shadow is hidden entirely
//   rather than showing a misleading capped or geometrically invalid position.
//
// All lines are drawn in a single full-screen SVG overlay that re-renders on
// every map render frame so geometry stays glued to the map.

import { getPosition, getMoonPos } from '../solar.js';
import { destination, project3D } from '../util.js';
import { getLiveBodyAnchor, setAnchorLiftMetres } from './sun-path.js';

let OBJECT_H_M = 0;   // caster height above ground
let FLOOR_H_M = 0;    // floor surface elevation above ground (shadow lands here)
const MAX_SHADOW_KM = 4.0;
const FLOOR_COLOR = '#4dff9a';

let mapRef = null;
let svgOverlay = null, lineSky = null, linePole = null, lineFloor = null;
let casterMarker = null;
let groundDot = null;   // white dot at observer ground (no offset, never moves)
let floorDot = null;    // green dot at ground level below elevated shadow endpoint
let endMarker = null;   // shadow endpoint dot, offset up to FLOOR_H_M

let mode = 'sun';
let observerCache = null;
let datetimeCache = null;
let visible = false;

export function setShadowHeight(h) {
  const n = Number(h);
  OBJECT_H_M = Number.isFinite(n) && n >= 0 ? n : 0;
  if (visible) {
    // Arc lift = caster height only; floor does not affect the arc's anchor.
    setAnchorLiftMetres(OBJECT_H_M);
    update();
  }
}
export function getShadowHeight() { return OBJECT_H_M; }

export function setFloorHeight(h) {
  const n = Number(h);
  FLOOR_H_M = Number.isFinite(n) && n >= 0 ? n : 0;
  if (visible) {
    setAnchorLiftMetres(OBJECT_H_M);
    update();
  }
}
export function getFloorHeight() { return FLOOR_H_M; }

export function addShadowLayer(map) {
  mapRef = map;
  if (svgOverlay) return;

  svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgOverlay.id = 'shadow-svg';
  svgOverlay.setAttribute('style',
    'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2;');

  // Sky line: body → caster top → shadow endpoint (polyline forces intersection
  // with the caster sphere regardless of project3D approximation error).
  lineSky = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  lineSky.setAttribute('fill', 'none');
  lineSky.setAttribute('stroke-width', '3');
  lineSky.setAttribute('stroke-linecap', 'round');
  lineSky.setAttribute('stroke-linejoin', 'round');
  lineSky.setAttribute('opacity', '0');
  svgOverlay.appendChild(lineSky);

  // Green vertical line: ground ref → elevated shadow endpoint (shown when floor > 0).
  lineFloor = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  lineFloor.setAttribute('stroke', FLOOR_COLOR);
  lineFloor.setAttribute('stroke-width', '2');
  lineFloor.setAttribute('stroke-linecap', 'round');
  lineFloor.setAttribute('opacity', '0');
  svgOverlay.appendChild(lineFloor);

  // Blue pole: white ground dot → caster sphere.
  linePole = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  linePole.setAttribute('stroke', '#4dd2ff');
  linePole.setAttribute('stroke-width', '2');
  linePole.setAttribute('stroke-linecap', 'round');
  linePole.setAttribute('opacity', '0');
  svgOverlay.appendChild(linePole);

  document.body.appendChild(svgOverlay);
  svgOverlay.style.display = 'none';

  map.on('render', renderOverlay);
}

export function setShadowVisible(map, vis) {
  visible = !!vis;
  if (svgOverlay) svgOverlay.style.display = vis ? '' : 'none';
  setAnchorLiftMetres(vis ? OBJECT_H_M : 0);
  if (!vis) clearMarkers();
  if (vis) update();
}

function clearMarkers() {
  if (casterMarker) { casterMarker.remove(); casterMarker = null; }
  if (groundDot)    { groundDot.remove();    groundDot = null; }
  if (floorDot)     { floorDot.remove();     floorDot = null; }
  if (endMarker)    { endMarker.remove();    endMarker = null; }
}

export function updateShadow(map, observer, datetime, moonMode = false) {
  observerCache = observer;
  datetimeCache = datetime;
  mode = moonMode ? 'moon' : 'sun';
  if (!visible) return;
  update();
}

function update() {
  if (!observerCache || !mapRef) return;
  const observer = observerCache;
  const datetime = datetimeCache;
  const moonMode = mode === 'moon';
  const colour = moonMode ? '#d0d8e8' : '#ffb845';
  const p = moonMode
    ? getMoonPos(datetime, observer.lat, observer.lon)
    : getPosition(datetime, observer.lat, observer.lon);

  const { lat, lon } = observer;

  // White ground dot — always at true ground, no pixel offset.
  if (!groundDot) {
    const dot = document.createElement('div');
    dot.style.cssText = 'width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 0 4px rgba(0,0,0,0.6);pointer-events:none;';
    groundDot = new maplibregl.Marker({ element: dot }).setLngLat([lon, lat]).addTo(mapRef);
  } else {
    groundDot.setLngLat([lon, lat]);
  }

  // Caster sphere — always at observer lat/lon, offset to OBJECT_H_M in renderOverlay.
  // Does NOT move when floor changes — only when caster slider changes.
  if (!casterMarker) {
    const sphere = document.createElement('div');
    sphere.className = 'caster-sphere';
    casterMarker = new maplibregl.Marker({ element: sphere, offset: [0, 0] })
      .setLngLat([lon, lat]).addTo(mapRef);
  }
  casterMarker.setLngLat([lon, lat]);

  // Effective shadow height = caster above floor surface.
  // Shadow is only possible when caster is above the floor.
  const shadowH = OBJECT_H_M - FLOOR_H_M;

  if (shadowH > 0.01 && p.altitudeDeg > 0.5) {
    const tanEl = Math.tan(p.altitudeDeg * Math.PI / 180);
    const flatKm = shadowH / tanEl / 1000;

    if (flatKm < MAX_SHADOW_KM) {
      // Shadow reaches the floor within the useful range — show it.
      const shadowAz = (p.azimuthDeg + 180) % 360;
      const endLngLat = destination(lat, lon, shadowAz, flatKm);

      // Shadow endpoint dot — elevated to FLOOR_H_M by renderOverlay.
      if (!endMarker) {
        const e = document.createElement('div');
        e.className = 'shadow-end';
        endMarker = new maplibregl.Marker({ element: e }).setLngLat(endLngLat).addTo(mapRef);
      } else {
        endMarker.setLngLat(endLngLat);
      }
      endMarker.getElement().style.background = colour;

      // Green ground reference dot — at shadow endpoint lat/lon, ground level (no offset).
      // Only shown when there is a floor to create a visual height difference.
      if (FLOOR_H_M > 0.01) {
        if (!floorDot) {
          const dot = document.createElement('div');
          dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${FLOOR_COLOR};box-shadow:0 0 6px rgba(77,255,154,0.55);pointer-events:none;`;
          floorDot = new maplibregl.Marker({ element: dot, offset: [0, 0] })
            .setLngLat(endLngLat).addTo(mapRef);
        } else {
          floorDot.setLngLat(endLngLat);
        }
      } else {
        if (floorDot) { floorDot.remove(); floorDot = null; }
      }
    } else {
      // Shadow is too long — hide rather than show a misleading capped position.
      // This also handles the near-horizon geometry-break case.
      if (endMarker) { endMarker.remove(); endMarker = null; }
      if (floorDot)  { floorDot.remove();  floorDot = null; }
    }
  } else {
    // Body below horizon, or floor is at/above caster level — no shadow possible.
    if (endMarker) { endMarker.remove(); endMarker = null; }
    if (floorDot)  { floorDot.remove();  floorDot = null; }
  }

  renderOverlay();
}

function renderOverlay() {
  if (!visible || !svgOverlay || !mapRef || !observerCache) return;
  if (!Number.isFinite(observerCache.lat) || !Number.isFinite(observerCache.lon)) return;

  const colour = mode === 'moon' ? '#d0d8e8' : '#ffb845';
  lineSky.setAttribute('stroke', colour);

  const { lon, lat } = observerCache;
  const groundScreen = mapRef.project([lon, lat]);
  if (!Number.isFinite(groundScreen.x) || !Number.isFinite(groundScreen.y)) return;

  // Caster top — always at OBJECT_H_M above observer, independent of floor.
  const casterTopScreen = OBJECT_H_M > 0.01
    ? project3D(mapRef, lon, lat, OBJECT_H_M)
    : groundScreen;

  if (casterMarker) {
    const dx = casterTopScreen.x - groundScreen.x;
    const dy = casterTopScreen.y - groundScreen.y;
    casterMarker.setOffset([Number.isFinite(dx) ? dx : 0, Number.isFinite(dy) ? dy : 0]);
  }

  // Blue pole: ground (white dot) → caster sphere.
  if (Number.isFinite(casterTopScreen.x)) {
    linePole.setAttribute('x1', groundScreen.x); linePole.setAttribute('y1', groundScreen.y);
    linePole.setAttribute('x2', casterTopScreen.x); linePole.setAttribute('y2', casterTopScreen.y);
    linePole.setAttribute('opacity', OBJECT_H_M > 0.01 ? '0.85' : '0');
  } else {
    linePole.setAttribute('opacity', '0');
  }

  if (!endMarker) {
    lineSky.setAttribute('opacity', '0');
    lineFloor.setAttribute('opacity', '0');
    return;
  }
  const body = getLiveBodyAnchor();
  if (!body) {
    lineSky.setAttribute('opacity', '0');
    lineFloor.setAttribute('opacity', '0');
    return;
  }
  const bodyScreen = mapRef.project([body.lon, body.lat]);
  const bx = bodyScreen.x + body.offsetPx[0];
  const by = bodyScreen.y + body.offsetPx[1];
  if (!Number.isFinite(bx) || !Number.isFinite(by)) {
    lineSky.setAttribute('opacity', '0');
    lineFloor.setAttribute('opacity', '0');
    return;
  }

  const endLngLat = endMarker.getLngLat();
  const endGroundScreen = mapRef.project([endLngLat.lng, endLngLat.lat]);
  if (!Number.isFinite(endGroundScreen.x)) {
    lineSky.setAttribute('opacity', '0');
    lineFloor.setAttribute('opacity', '0');
    return;
  }

  // Shadow endpoint elevated to FLOOR_H_M above the ground at shadow lat/lon.
  const endElevatedScreen = FLOOR_H_M > 0.01
    ? project3D(mapRef, endLngLat.lng, endLngLat.lat, FLOOR_H_M)
    : endGroundScreen;
  const endScreenPt = Number.isFinite(endElevatedScreen.x) ? endElevatedScreen : endGroundScreen;

  // Lift endMarker to floor height.
  endMarker.setOffset([
    Number.isFinite(endElevatedScreen.x - endGroundScreen.x) ? endElevatedScreen.x - endGroundScreen.x : 0,
    Number.isFinite(endElevatedScreen.y - endGroundScreen.y) ? endElevatedScreen.y - endGroundScreen.y : 0,
  ]);

  // Green floor indicator: vertical line at shadow endpoint from ground to floor height.
  // floorDot has no offset — it sits at ground level directly below the shadow dot.
  if (floorDot && FLOOR_H_M > 0.01 && Number.isFinite(endElevatedScreen.x)) {
    lineFloor.setAttribute('x1', endGroundScreen.x); lineFloor.setAttribute('y1', endGroundScreen.y);
    lineFloor.setAttribute('x2', endElevatedScreen.x); lineFloor.setAttribute('y2', endElevatedScreen.y);
    lineFloor.setAttribute('opacity', '0.85');
  } else {
    lineFloor.setAttribute('opacity', '0');
  }

  // Sky line: body → caster top (OBJECT_H_M) → shadow endpoint (FLOOR_H_M).
  // These three points are geometrically collinear (all on the same sun ray).
  lineSky.setAttribute('points',
    `${bx},${by} ${casterTopScreen.x},${casterTopScreen.y} ${endScreenPt.x},${endScreenPt.y}`);
  lineSky.setAttribute('opacity', '0.95');
}
