// Shadow + sun-ray visualization for Shadow mode.
//
// Shadow ray: cast from observer in the OPPOSITE sun direction.
// Flat-ground fallback renders instantly; async terrain + building refinement updates after.
// Sun ray: long dashed line toward sun direction.

import { getPosition, getMoonPos } from '../solar.js';
import { destination } from '../util.js';
import { sampleElevationAlongLine, getElevation } from '../terrain.js';
import { findBuildingObstruction } from '../buildings.js';

const SHADOW_SRC      = 'shadow-src';
const SHADOW_LINE     = 'shadow-line';
const SHADOW_END_SRC  = 'shadow-end-src';
const SHADOW_END_DOT  = 'shadow-end-dot';
const LONG_RAY_SRC    = 'shadow-ray-src';
const LONG_RAY_LINE   = 'shadow-ray-line';

const OBJECT_H_M    = 10;    // virtual caster height in metres (generic building edge)
const MAX_SHADOW_KM = 2.0;   // max shadow ray length to march
const STEP_M        = 25;    // terrain sampling step

let pendingToken = null;

// ── Setup ─────────────────────────────────────────────────────────────────────

export function addShadowLayer(map) {
  if (map.getSource(SHADOW_SRC)) return;
  const empty = { type: 'FeatureCollection', features: [] };

  map.addSource(SHADOW_SRC,     { type: 'geojson', data: empty });
  map.addSource(SHADOW_END_SRC, { type: 'geojson', data: empty });
  map.addSource(LONG_RAY_SRC,   { type: 'geojson', data: empty });

  // Long sun/moon ray toward celestial body (dashed, warm/silver)
  map.addLayer({
    id: LONG_RAY_LINE, type: 'line', source: LONG_RAY_SRC,
    layout: { 'line-cap': 'round', visibility: 'none' },
    paint: {
      'line-color': '#fff1c2',
      'line-width': 1.5,
      'line-opacity': 0.45,
      'line-dasharray': [4, 3],
    },
  });

  // Shadow line (dark, semi-transparent)
  map.addLayer({
    id: SHADOW_LINE, type: 'line', source: SHADOW_SRC,
    layout: { 'line-cap': 'round', visibility: 'none' },
    paint: {
      'line-color': '#0d1630',
      'line-width': 5,
      'line-opacity': 0.72,
      'line-blur': 1,
    },
  });

  // Shadow endpoint dot
  map.addLayer({
    id: SHADOW_END_DOT, type: 'circle', source: SHADOW_END_SRC,
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': 5,
      'circle-color': '#0d1630',
      'circle-opacity': 0.7,
      'circle-stroke-color': '#3d5aad',
      'circle-stroke-width': 1.5,
    },
  });
}

export function setShadowVisible(map, visible) {
  const v = visible ? 'visible' : 'none';
  for (const id of [SHADOW_LINE, SHADOW_END_DOT, LONG_RAY_LINE]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
  }
}

// ── Update ────────────────────────────────────────────────────────────────────

/**
 * Update shadow + ray visualization.
 * moonMode: if true, uses moon position instead of sun.
 */
export function updateShadow(map, observer, datetime, moonMode = false) {
  const p = moonMode
    ? getMoonPos(datetime, observer.lat, observer.lon)
    : getPosition(datetime, observer.lat, observer.lon);

  const { lat, lon } = observer;

  // Long ray toward celestial body
  if (p.altitudeDeg > -2) {
    const rayEnd = destination(lat, lon, p.azimuthDeg, MAX_SHADOW_KM * 1.8);
    setLine(map, LONG_RAY_SRC, [[lon, lat], rayEnd]);
  } else {
    clear(map, LONG_RAY_SRC);
  }

  // No shadow when body is below horizon
  if (p.altitudeDeg < 0.5) {
    clear(map, SHADOW_SRC);
    clear(map, SHADOW_END_SRC);
    return;
  }

  const shadowAz = (p.azimuthDeg + 180) % 360;
  const tanEl = Math.tan(p.altitudeDeg * Math.PI / 180);
  const flatKm = Math.min((OBJECT_H_M / tanEl) / 1000, MAX_SHADOW_KM);

  // 1. Check building obstruction synchronously (uses already-rendered features)
  const building = findBuildingObstruction(map, observer, p.azimuthDeg, p.altitudeDeg, 500);
  if (building) {
    // Shadow blocked by a building: shorten to building distance
    const blockedKm = Math.min(building.distanceM / 1000, flatKm);
    const blockedEnd = destination(lat, lon, shadowAz, blockedKm);
    setLine(map, SHADOW_SRC, [[lon, lat], blockedEnd]);
    setPoint(map, SHADOW_END_SRC, blockedEnd);
    clear(map, LONG_RAY_SRC); // ray is blocked, don't show it past the building
    return;
  }

  // 2. Flat fallback renders instantly
  const flatEnd = destination(lat, lon, shadowAz, flatKm);
  setLine(map, SHADOW_SRC, [[lon, lat], flatEnd]);
  setPoint(map, SHADOW_END_SRC, flatEnd);

  // Cancel any pending async computation
  if (pendingToken) pendingToken.cancelled = true;
  const token = { cancelled: false };
  pendingToken = token;

  // 3. Async terrain-aware refinement
  computeTerrainShadow(lat, lon, p.altitudeDeg, shadowAz).then((terrainEnd) => {
    if (token.cancelled) return;
    if (terrainEnd) {
      setLine(map, SHADOW_SRC, [[lon, lat], terrainEnd]);
      setPoint(map, SHADOW_END_SRC, terrainEnd);
    }
  });
}

async function computeTerrainShadow(lat, lon, sunElDeg, shadowAzDeg) {
  try {
    const [observerElev, samples] = await Promise.all([
      getElevation(lat, lon),
      sampleElevationAlongLine(lat, lon, shadowAzDeg, MAX_SHADOW_KM * 1000, STEP_M),
    ]);

    const tanEl = Math.tan(sunElDeg * Math.PI / 180);

    for (const { distance, elevation } of samples) {
      if (distance < 1) continue;
      // Height of sun ray above observer ground level at this distance
      const rayH = observerElev + OBJECT_H_M - distance * tanEl;
      if (elevation >= rayH) {
        const [endLon, endLat] = destination(lat, lon, shadowAzDeg, distance / 1000);
        return [endLon, endLat];
      }
    }
  } catch {
    // Network error or CORS → silent fallback to flat shadow
  }
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clear(map, srcId) {
  map.getSource(srcId)?.setData({ type: 'FeatureCollection', features: [] });
}

function setLine(map, srcId, coords) {
  const src = map.getSource(srcId);
  if (!src || coords.length < 2) { clear(map, srcId); return; }
  src.setData({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }],
  });
}

function setPoint(map, srcId, lonlat) {
  const src = map.getSource(srcId);
  if (!src || !lonlat) { clear(map, srcId); return; }
  src.setData({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: lonlat }, properties: {} }],
  });
}
