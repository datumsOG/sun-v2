// Shadow visualisation:
//
//   • White dot at true ground level (observer lat/lon, 0 m).
//   • Green dot at floor height + green line connecting it to ground dot
//     (only shown when floor > 0 — represents shooting from a building, etc.)
//   • Light-blue caster sphere above the floor dot.
//   • Light-blue vertical pole from floor level → caster top.
//   • Body-coloured sky line from sun/moon body through caster top to shadow end.
//   • Body-coloured shadow endpoint dot on the ground.
//
// All lines are drawn in a single full-screen SVG overlay that re-renders on
// every map render frame so geometry stays glued to the map.

import { getPosition, getMoonPos } from '../solar.js';
import { destination, project3D } from '../util.js';
import { getLiveBodyAnchor, setAnchorLiftMetres } from './sun-path.js';

let OBJECT_H_M = 0;   // caster height above floor
let FLOOR_H_M = 0;    // floor elevation above ground (e.g. top of a building)
const MAX_SHADOW_KM = 4.0;
const FLOOR_COLOR = '#4dff9a';  // green for floor dot + line

let mapRef = null;
let svgOverlay = null, lineSky = null, linePole = null, lineFloor = null;
let casterMarker = null;
let groundDot = null;   // white dot at true ground level (never offset)
let floorDot = null;    // green dot at floor height (shown when floor > 0)
let endMarker = null;

let mode = 'sun';
let observerCache = null;
let datetimeCache = null;
let visible = false;

export function setShadowHeight(h) {
  const n = Number(h);
  OBJECT_H_M = Number.isFinite(n) && n >= 0 ? n : 0;
  if (visible) {
    setAnchorLiftMetres(FLOOR_H_M + OBJECT_H_M);
    update();
  }
}
export function getShadowHeight() { return OBJECT_H_M; }

export function setFloorHeight(h) {
  const n = Number(h);
  FLOOR_H_M = Number.isFinite(n) && n >= 0 ? n : 0;
  if (visible) {
    setAnchorLiftMetres(FLOOR_H_M + OBJECT_H_M);
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

  // Sky line: body → caster top → shadow endpoint.
  lineSky = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  lineSky.setAttribute('stroke-width', '3');
  lineSky.setAttribute('stroke-linecap', 'round');
  lineSky.setAttribute('opacity', '0');
  svgOverlay.appendChild(lineSky);

  // Green line: ground dot → floor dot (only visible when floor > 0).
  lineFloor = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  lineFloor.setAttribute('stroke', FLOOR_COLOR);
  lineFloor.setAttribute('stroke-width', '2');
  lineFloor.setAttribute('stroke-linecap', 'round');
  lineFloor.setAttribute('opacity', '0');
  svgOverlay.appendChild(lineFloor);

  // Blue pole: floor level → caster top.
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
  setAnchorLiftMetres(vis ? FLOOR_H_M + OBJECT_H_M : 0);
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

  // Green floor dot — only when floor > 0.
  if (FLOOR_H_M > 0.01) {
    if (!floorDot) {
      const dot = document.createElement('div');
      dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${FLOOR_COLOR};box-shadow:0 0 6px rgba(77,255,154,0.55);pointer-events:none;`;
      floorDot = new maplibregl.Marker({ element: dot, offset: [0, 0] })
        .setLngLat([lon, lat]).addTo(mapRef);
    } else {
      floorDot.setLngLat([lon, lat]);
    }
  } else {
    if (floorDot) { floorDot.remove(); floorDot = null; }
  }

  // Caster sphere.
  if (!casterMarker) {
    const sphere = document.createElement('div');
    sphere.className = 'caster-sphere';
    casterMarker = new maplibregl.Marker({ element: sphere, offset: [0, 0] })
      .setLngLat([lon, lat]).addTo(mapRef);
  }
  casterMarker.setLngLat([lon, lat]);

  // Shadow ground endpoint — distance uses total height above ground.
  if (p.altitudeDeg > 0.5) {
    const tanEl = Math.tan(p.altitudeDeg * Math.PI / 180);
    const totalH = FLOOR_H_M + OBJECT_H_M;
    const flatKm = Math.min(totalH > 0 ? (totalH / tanEl) / 1000 : 0, MAX_SHADOW_KM);
    const shadowAz = (p.azimuthDeg + 180) % 360;
    const endLngLat = destination(lat, lon, shadowAz, flatKm);

    if (!endMarker) {
      const e = document.createElement('div');
      e.className = 'shadow-end';
      endMarker = new maplibregl.Marker({ element: e }).setLngLat(endLngLat).addTo(mapRef);
    } else {
      endMarker.setLngLat(endLngLat);
    }
    endMarker.getElement().style.background = colour;
    endMarker.getElement().style.display = totalH > 0 ? '' : 'none';
  } else {
    if (endMarker) { endMarker.remove(); endMarker = null; }
  }

  renderOverlay();
}

function renderOverlay() {
  if (!visible || !svgOverlay || !mapRef || !observerCache) return;
  const colour = mode === 'moon' ? '#d0d8e8' : '#ffb845';
  lineSky.setAttribute('stroke', colour);

  const groundScreen = mapRef.project([observerCache.lon, observerCache.lat]);
  const floorScreen = FLOOR_H_M > 0.01
    ? project3D(mapRef, observerCache.lon, observerCache.lat, FLOOR_H_M)
    : groundScreen;
  const casterTopScreen = project3D(mapRef, observerCache.lon, observerCache.lat, FLOOR_H_M + OBJECT_H_M);

  // Floor dot: offset from ground marker position to floor height.
  if (floorDot) {
    floorDot.setOffset([
      floorScreen.x - groundScreen.x,
      floorScreen.y - groundScreen.y,
    ]);
  }

  // Caster sphere: offset to floor + caster height.
  if (casterMarker) {
    casterMarker.setOffset([
      casterTopScreen.x - groundScreen.x,
      casterTopScreen.y - groundScreen.y,
    ]);
  }

  // Green line: ground → floor (only when floor > 0).
  if (FLOOR_H_M > 0.01) {
    lineFloor.setAttribute('x1', groundScreen.x); lineFloor.setAttribute('y1', groundScreen.y);
    lineFloor.setAttribute('x2', floorScreen.x);  lineFloor.setAttribute('y2', floorScreen.y);
    lineFloor.setAttribute('opacity', '0.85');
  } else {
    lineFloor.setAttribute('opacity', '0');
  }

  // Blue pole: floor → caster top (only when caster > 0).
  linePole.setAttribute('x1', floorScreen.x); linePole.setAttribute('y1', floorScreen.y);
  linePole.setAttribute('x2', casterTopScreen.x); linePole.setAttribute('y2', casterTopScreen.y);
  linePole.setAttribute('opacity', OBJECT_H_M > 0.01 ? '0.85' : '0');

  const body = getLiveBodyAnchor();
  if (!body || !endMarker || endMarker.getElement().style.display === 'none') {
    lineSky.setAttribute('opacity', '0');
    return;
  }
  const bodyScreen = mapRef.project([body.lon, body.lat]);
  const bx = bodyScreen.x + body.offsetPx[0];
  const by = bodyScreen.y + body.offsetPx[1];
  const endLngLat = endMarker.getLngLat();
  const endPt = mapRef.project([endLngLat.lng, endLngLat.lat]);

  lineSky.setAttribute('x1', bx); lineSky.setAttribute('y1', by);
  lineSky.setAttribute('x2', endPt.x); lineSky.setAttribute('y2', endPt.y);
  lineSky.setAttribute('opacity', '0.95');
}
