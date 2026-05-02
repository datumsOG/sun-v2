// Shadow visualization (Shadow mode):
//   - Caster sphere (light blue) at observer position, lifted to caster height in metres.
//   - Vertical pole (light blue) from caster ground point up to the sphere.
//   - Sky→caster line: from the live sun/moon arc point through the caster.
//   - Caster→ground extension: continues to the shadow-end ground point.
//   - Solid filled circle at the shadow endpoint, in body colour.
//
// Lines are drawn with a maplibre line layer for the GROUND segment, and an
// HTML+SVG overlay tied to map.project() for the 3D portions.

import { getPosition, getMoonPos } from '../solar.js';
import { destination } from '../util.js';
import { getLiveBodyAnchor } from './sun-path.js';

const SHADOW_SRC      = 'shadow-src';
const SHADOW_LINE     = 'shadow-line';

let OBJECT_H_M      = 10;
const MAX_SHADOW_KM = 4.0;
let mapRef = null;
let casterMarker = null;
let casterPole = null;
let endMarker = null;
let svgOverlay = null;     // SVG overlay for the 3D sky→caster line
let mode = 'sun';
let observerCache = null;
let datetimeCache = null;
let visible = false;

export function setShadowHeight(h) {
  OBJECT_H_M = Math.max(0.5, +h || 10);
  if (visible) update();
}

export function addShadowLayer(map) {
  mapRef = map;
  if (map.getSource(SHADOW_SRC)) return;
  const empty = { type: 'FeatureCollection', features: [] };
  map.addSource(SHADOW_SRC, { type: 'geojson', data: empty });

  // Ground shadow line (caster→endpoint), colour swapped per mode at runtime.
  map.addLayer({
    id: SHADOW_LINE, type: 'line', source: SHADOW_SRC,
    layout: { 'line-cap': 'round', visibility: 'none' },
    paint: { 'line-color': '#ffb845', 'line-width': 4, 'line-opacity': 0.9 },
  });

  // Build SVG overlay for the 3D sky→caster line
  svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgOverlay.id = 'shadow-svg';
  svgOverlay.setAttribute('style', 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2;');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('id', 'shadow-3d-line');
  line.setAttribute('stroke', '#ffb845');
  line.setAttribute('stroke-width', '3');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('opacity', '0.9');
  svgOverlay.appendChild(line);
  document.body.appendChild(svgOverlay);
  svgOverlay.style.display = 'none';

  map.on('move', renderOverlay);
  map.on('zoom', renderOverlay);
}

export function setShadowVisible(map, vis) {
  visible = !!vis;
  const v = vis ? 'visible' : 'none';
  if (map.getLayer(SHADOW_LINE)) map.setLayoutProperty(SHADOW_LINE, 'visibility', v);
  if (svgOverlay) svgOverlay.style.display = vis ? '' : 'none';
  toggleMarkers(vis);
  if (vis) update();
}

function toggleMarkers(show) {
  if (!show) {
    if (casterMarker) { casterMarker.remove(); casterMarker = null; }
    if (casterPole) { casterPole.remove(); casterPole = null; }
    if (endMarker) { endMarker.remove(); endMarker = null; }
  }
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
  const aboveHorizon = p.altitudeDeg > 0.5;

  // Update ground shadow line colour
  mapRef.setPaintProperty(SHADOW_LINE, 'line-color', colour);

  // Caster marker (light blue sphere) — vertical offset = caster height in pixels at current zoom
  const offsetPx = metresToPixels(OBJECT_H_M, lat);
  if (!casterMarker) {
    const dot = document.createElement('div');
    dot.className = 'caster-sphere';
    casterMarker = new maplibregl.Marker({ element: dot, offset: [0, -offsetPx] })
      .setLngLat([lon, lat]).addTo(mapRef);
  } else {
    casterMarker.setLngLat([lon, lat]);
    casterMarker.setOffset([0, -offsetPx]);
  }

  // Caster pole (vertical light blue line below the sphere down to ground)
  if (!casterPole) {
    const pole = document.createElement('div');
    pole.className = 'caster-pole';
    casterPole = new maplibregl.Marker({ element: pole, offset: [0, -offsetPx / 2], anchor: 'center' })
      .setLngLat([lon, lat]).addTo(mapRef);
  } else {
    casterPole.setLngLat([lon, lat]);
    casterPole.setOffset([0, -offsetPx / 2]);
  }
  casterPole.getElement().style.height = Math.max(0, offsetPx) + 'px';

  // Shadow endpoint on ground
  if (aboveHorizon) {
    const tanEl = Math.tan(p.altitudeDeg * Math.PI / 180);
    const flatKm = Math.min((OBJECT_H_M / tanEl) / 1000, MAX_SHADOW_KM);
    const shadowAz = (p.azimuthDeg + 180) % 360;
    const endLngLat = destination(lat, lon, shadowAz, flatKm);

    // Ground line (caster ground point → endpoint)
    setLine(mapRef, SHADOW_SRC, [[lon, lat], endLngLat]);

    if (!endMarker) {
      const dot = document.createElement('div');
      dot.className = 'shadow-end';
      endMarker = new maplibregl.Marker({ element: dot }).setLngLat(endLngLat).addTo(mapRef);
    } else {
      endMarker.setLngLat(endLngLat);
      endMarker.getElement().style.background = colour;
    }
  } else {
    setLine(mapRef, SHADOW_SRC, []);
    if (endMarker) { endMarker.remove(); endMarker = null; }
  }

  renderOverlay();
}

function renderOverlay() {
  if (!visible || !svgOverlay || !mapRef || !observerCache) return;
  const line = svgOverlay.querySelector('#shadow-3d-line');
  if (!line) return;
  const colour = mode === 'moon' ? '#d0d8e8' : '#ffb845';
  line.setAttribute('stroke', colour);

  // 3D sky→caster line: from the live body anchor (sun/moon dot in arc)
  // through the caster sphere, in screen space.
  const body = getLiveBodyAnchor();
  if (!body) { line.setAttribute('opacity', '0'); return; }

  const bodyScreen = mapRef.project([body.lon, body.lat]);
  const casterGround = mapRef.project([observerCache.lon, observerCache.lat]);
  const casterPx = metresToPixels(OBJECT_H_M, observerCache.lat);

  const x1 = bodyScreen.x + body.offsetPx[0];
  const y1 = bodyScreen.y + body.offsetPx[1];
  const x2 = casterGround.x;
  const y2 = casterGround.y - casterPx;

  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
  line.setAttribute('opacity', '0.9');
}

function setLine(map, srcId, coords) {
  const src = map.getSource(srcId);
  if (!src) return;
  if (!coords || coords.length < 2) { src.setData({ type: 'FeatureCollection', features: [] }); return; }
  src.setData({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }],
  });
}
