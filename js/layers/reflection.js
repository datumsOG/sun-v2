// Reflection mode: user draws a building-face line, then sees:
//   • the sun marker at its current position
//   • an incident ray from sun → midpoint of the drawn line
//   • a reflected ray from midpoint outward (2D mirror off the wall)
// Reflected azimuth formula: R = (2*wallBearing − sunAzimuth + 180) % 360

import { getPosition, getMoonPos } from '../solar.js';
import { destination, bearing } from '../util.js';

const WALL_SRC      = 'reflect-wall-src';
const WALL_LINE     = 'reflect-wall-line';
const INCIDENT_SRC  = 'reflect-incident-src';
const INCIDENT_LINE = 'reflect-incident-line';
const REFLECT_SRC   = 'reflect-out-src';
const REFLECT_LINE  = 'reflect-out-line';
const SUN_SRC       = 'reflect-sun-src';
const SUN_GLOW      = 'reflect-sun-glow';
const SUN_DOT       = 'reflect-sun-dot';
const MID_SRC       = 'reflect-mid-src';
const MID_DOT       = 'reflect-mid-dot';

const ARC_KM     = 6;
const REFLECT_KM = 12;

export function addReflectionLayer(map) {
  if (map.getSource(WALL_SRC)) return;
  const empty = { type: 'FeatureCollection', features: [] };

  map.addSource(WALL_SRC,     { type: 'geojson', data: empty });
  map.addSource(INCIDENT_SRC, { type: 'geojson', data: empty });
  map.addSource(REFLECT_SRC,  { type: 'geojson', data: empty });
  map.addSource(SUN_SRC,      { type: 'geojson', data: empty });
  map.addSource(MID_SRC,      { type: 'geojson', data: empty });

  // Wall line drawn by user
  map.addLayer({
    id: WALL_LINE, type: 'line', source: WALL_SRC,
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: { 'line-color': '#ffffff', 'line-width': 3, 'line-opacity': 0.85, 'line-dasharray': [4, 2] },
  });

  // Incident ray: sun → midpoint, warm orange dashed
  map.addLayer({
    id: INCIDENT_LINE, type: 'line', source: INCIDENT_SRC,
    layout: { 'line-cap': 'round', visibility: 'none' },
    paint: { 'line-color': '#ffb845', 'line-width': 2.5, 'line-opacity': 0.9, 'line-dasharray': [2, 2] },
  });

  // Reflected ray: midpoint → outward, solid cyan
  map.addLayer({
    id: REFLECT_LINE, type: 'line', source: REFLECT_SRC,
    layout: { 'line-cap': 'round', visibility: 'none' },
    paint: { 'line-color': '#4dd2ff', 'line-width': 2.5, 'line-opacity': 0.95 },
  });

  // Sun marker (glow + dot)
  map.addLayer({
    id: SUN_GLOW, type: 'circle', source: SUN_SRC,
    layout: { visibility: 'none' },
    paint: { 'circle-radius': 22, 'circle-color': '#ffb845', 'circle-opacity': 0.3, 'circle-blur': 1.0 },
  });
  map.addLayer({
    id: SUN_DOT, type: 'circle', source: SUN_SRC,
    layout: { visibility: 'none' },
    paint: { 'circle-radius': 7, 'circle-color': '#fff1c2', 'circle-stroke-color': '#ffb845', 'circle-stroke-width': 2 },
  });

  // Midpoint marker
  map.addLayer({
    id: MID_DOT, type: 'circle', source: MID_SRC,
    layout: { visibility: 'none' },
    paint: { 'circle-radius': 5, 'circle-color': '#ffffff', 'circle-stroke-color': '#aaaaaa', 'circle-stroke-width': 1.5 },
  });
}

export function setReflectionVisible(map, visible) {
  const v = visible ? 'visible' : 'none';
  for (const id of [WALL_LINE, INCIDENT_LINE, REFLECT_LINE, SUN_GLOW, SUN_DOT, MID_DOT]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
  }
}

/** Update the wall line drawn by the user. line = { start:{lat,lon}, end:{lat,lon} } | null */
export function updateReflectionWall(map, line) {
  if (!line) {
    clear(map, WALL_SRC);
    clear(map, MID_SRC);
    return;
  }
  setLine(map, WALL_SRC, [[line.start.lon, line.start.lat], [line.end.lon, line.end.lat]]);
  setPoint(map, MID_SRC, midpoint(line));
}

/** Update sun/moon marker + incident + reflected rays. line = { start, end } | null */
export function updateReflectionNow(map, observer, datetime, line, moonMode = false) {
  if (!line) {
    clear(map, INCIDENT_SRC);
    clear(map, REFLECT_SRC);
    clear(map, SUN_SRC);
    return;
  }

  // All geometry is anchored to the midpoint so incident and reflected angles are consistent
  const midLat = (line.start.lat + line.end.lat) / 2;
  const midLon = (line.start.lon + line.end.lon) / 2;
  const mid = [midLon, midLat];

  const p = moonMode ? getMoonPos(datetime, midLat, midLon) : getPosition(datetime, midLat, midLon);

  if (p.altitudeDeg < -1) {
    clear(map, INCIDENT_SRC);
    clear(map, REFLECT_SRC);
    clear(map, SUN_SRC);
    return;
  }

  // Sun marker: project from midpoint in the sun's direction
  const r = ARC_KM * (0.6 + 0.4 * Math.max(0, Math.sin((p.altitudeDeg * Math.PI) / 180)));
  const sunPos = destination(midLat, midLon, p.azimuthDeg, r);

  // Wall bearing (symmetric: adding 180° to θ gives same R since 2*(θ+180)=2θ+360)
  const wallBrng = bearing(line.start.lat, line.start.lon, line.end.lat, line.end.lon);

  // 2D mirror reflection: R = (2θ − φ + 180) mod 360
  const reflAz = ((2 * wallBrng - p.azimuthDeg) + 180 + 720) % 360;
  const reflEnd = destination(midLat, midLon, reflAz, REFLECT_KM);

  setPoint(map, SUN_SRC, sunPos);
  setLine(map, INCIDENT_SRC, [sunPos, mid]);   // incident: sun → wall
  setLine(map, REFLECT_SRC,  [mid, reflEnd]);  // reflected: wall → outward
}

/** No-op: arc view removed in new design */
export function updateReflectionDay() {}

function midpoint(line) {
  return [(line.start.lon + line.end.lon) / 2, (line.start.lat + line.end.lat) / 2];
}

function clear(map, srcId) {
  const src = map.getSource(srcId);
  if (src) src.setData({ type: 'FeatureCollection', features: [] });
}

function setLine(map, srcId, coords) {
  const src = map.getSource(srcId);
  if (!src || coords.length < 2) { clear(map, srcId); return; }
  src.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }] });
}

function setPoint(map, srcId, lonlat) {
  const src = map.getSource(srcId);
  if (!src || !lonlat) { clear(map, srcId); return; }
  src.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: lonlat }, properties: {} }] });
}
