// Shadow visualisation (Shadow mode):
//
//   • White ground dot at the observer (caster's ground projection).
//   • Light-blue caster sphere lifted by caster height (in metres).
//   • Light-blue vertical pole connecting the two.
//   • Sun→caster line (in body colour) ending exactly at the sphere edge.
//   • White-dot→ground-end line (same body colour, same vector continued)
//     ending in a filled body-coloured circle.
//
// All lines are drawn in a single full-screen SVG overlay that re-renders on
// every map render frame so the geometry stays glued to the map regardless
// of zoom/tilt/pan.

import { getPosition, getMoonPos } from '../solar.js';
import { destination, project3D } from '../util.js';
import { getLiveBodyAnchor, setAnchorLiftMetres } from './sun-path.js';

let OBJECT_H_M = 10;
const MAX_SHADOW_KM = 4.0;
const SPHERE_RADIUS_PX = 8;     // half the visual diameter of the caster sphere

let mapRef = null;
let svgOverlay = null, lineSky = null, linePole = null, lineGround = null;
let casterMarker = null;
let observerDot = null;
let endMarker = null;

let mode = 'sun';
let observerCache = null;
let datetimeCache = null;
let visible = false;

export function setShadowHeight(h) {
  // Allow 0 (caster on the ground); only reject NaN.
  const n = Number(h);
  OBJECT_H_M = Number.isFinite(n) && n >= 0 ? n : 10;
  if (visible) {
    setAnchorLiftMetres(OBJECT_H_M); // keep arc anchored to caster top
    update();
  }
}
export function getShadowHeight() { return OBJECT_H_M; }

export function addShadowLayer(map) {
  mapRef = map;
  if (svgOverlay) return;

  svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgOverlay.id = 'shadow-svg';
  svgOverlay.setAttribute('style',
    'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2;');
  // Single straight ray from the body through the caster top to the ground
  // shadow point. The arc is re-anchored to the caster top while shadow mode
  // is active (see setAnchorLiftMetres in sun-path.js), so this line is
  // genuinely collinear — it visibly passes through the sphere.
  lineSky = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  lineSky.setAttribute('stroke-width', '3');
  lineSky.setAttribute('stroke-linecap', 'round');
  lineSky.setAttribute('opacity', '0.95');
  svgOverlay.appendChild(lineSky);
  // Vertical pole: observer ground point → caster top, in caster colour (light blue).
  linePole = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  linePole.setAttribute('stroke', '#4dd2ff');
  linePole.setAttribute('stroke-width', '2');
  linePole.setAttribute('stroke-linecap', 'round');
  linePole.setAttribute('opacity', '0.85');
  svgOverlay.appendChild(linePole);
  document.body.appendChild(svgOverlay);
  svgOverlay.style.display = 'none';

  // Re-render every animation frame so SVG stays in lockstep with the map.
  map.on('render', renderOverlay);
}

export function setShadowVisible(map, vis) {
  visible = !!vis;
  if (svgOverlay) svgOverlay.style.display = vis ? '' : 'none';
  // Re-anchor the arc to the caster top while shadow mode is active so the
  // body→caster→ground ray is geometrically collinear. Reset to 0 when off.
  setAnchorLiftMetres(vis ? OBJECT_H_M : 0);
  if (!vis) clearMarkers();
  if (vis) update();
}

function clearMarkers() {
  if (casterMarker) { casterMarker.remove(); casterMarker = null; }
  if (observerDot)  { observerDot.remove();  observerDot = null; }
  if (endMarker)    { endMarker.remove();    endMarker = null; }
}

export function updateShadow(map, observer, datetime, moonMode = false) {
  observerCache = observer;
  datetimeCache = datetime;
  mode = moonMode ? 'moon' : 'sun';
  if (!visible) return;
  update();
}

function metresToPixels(metres, lat) {
  if (!mapRef) return 0;
  const mPerPx = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, mapRef.getZoom());
  return metres / mPerPx;
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

  // White ground dot at observer
  if (!observerDot) {
    const dot = document.createElement('div');
    dot.style.cssText = 'width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 0 4px rgba(0,0,0,0.6);pointer-events:none;';
    observerDot = new maplibregl.Marker({ element: dot }).setLngLat([lon, lat]).addTo(mapRef);
  } else {
    observerDot.setLngLat([lon, lat]);
  }

  // Caster sphere
  if (!casterMarker) {
    const sphere = document.createElement('div');
    sphere.className = 'caster-sphere';
    casterMarker = new maplibregl.Marker({ element: sphere, offset: [0, 0] })
      .setLngLat([lon, lat]).addTo(mapRef);
  }
  casterMarker.setLngLat([lon, lat]);

  // Shadow ground endpoint
  if (p.altitudeDeg > 0.5) {
    const tanEl = Math.tan(p.altitudeDeg * Math.PI / 180);
    const flatKm = Math.min((OBJECT_H_M / tanEl) / 1000, MAX_SHADOW_KM);
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
  } else {
    if (endMarker) { endMarker.remove(); endMarker = null; }
  }

  renderOverlay();
}

function renderOverlay() {
  if (!visible || !svgOverlay || !mapRef || !observerCache) return;
  const colour = mode === 'moon' ? '#d0d8e8' : '#ffb845';
  lineSky.setAttribute('stroke', colour);

  // True 3D screen position of the caster top (matches the same projection
  // used for arc dots, so the line passes through the sphere exactly).
  const obsScreen = mapRef.project([observerCache.lon, observerCache.lat]);
  const casterTopScreen = project3D(mapRef, observerCache.lon, observerCache.lat, OBJECT_H_M);
  if (casterMarker) {
    casterMarker.setOffset([
      casterTopScreen.x - obsScreen.x,
      casterTopScreen.y - obsScreen.y,
    ]);
  }
  const casterTopX = casterTopScreen.x;
  const casterTopY = casterTopScreen.y;

  // Vertical pole: observer dot → caster sphere centre.
  linePole.setAttribute('x1', obsScreen.x); linePole.setAttribute('y1', obsScreen.y);
  linePole.setAttribute('x2', casterTopX);  linePole.setAttribute('y2', casterTopY);
  linePole.setAttribute('opacity', OBJECT_H_M > 0.01 ? '0.85' : '0');

  const body = getLiveBodyAnchor();
  if (!body || !endMarker) {
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
