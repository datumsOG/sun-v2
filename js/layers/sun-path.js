// Sun path: continuous arc from sunrise → sunset projected on the map.
// Color-graded by time-of-day (twilight → golden → midday → golden → twilight).
// Plus a moving sun marker at the current scrubber time.

import { getDayBoundaries, getPosition } from '../solar.js';
import { destination } from '../util.js';

const PATH_SRC = 'sun-path-src';
const PATH_LINE = 'sun-path-line';
const PATH_GLOW = 'sun-path-glow';
const RAY_SRC = 'sun-ray-src';
const RAY_LINE = 'sun-ray-line';
const MARKER_SRC = 'sun-marker-src';
const MARKER_GLOW = 'sun-marker-glow';
const MARKER = 'sun-marker';
const SR_SRC = 'sunrise-vec-src';
const SR_LINE = 'sunrise-vec-line';
const SS_SRC = 'sunset-vec-src';
const SS_LINE = 'sunset-vec-line';

const ARC_RADIUS_KM = 6;

export function addSunPathLayer(map) {
  if (map.getSource(PATH_SRC)) return;

  const empty = { type: 'FeatureCollection', features: [] };
  map.addSource(PATH_SRC, { type: 'geojson', data: empty, lineMetrics: true });
  map.addSource(SR_SRC, { type: 'geojson', data: empty });
  map.addSource(SS_SRC, { type: 'geojson', data: empty });
  map.addSource(RAY_SRC, { type: 'geojson', data: empty });
  map.addSource(MARKER_SRC, { type: 'geojson', data: empty });

  // Glow under the path
  map.addLayer({
    id: PATH_GLOW,
    type: 'line',
    source: PATH_SRC,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#ffb845',
      'line-width': 12,
      'line-opacity': 0.18,
      'line-blur': 6,
    },
  });

  // The path itself, gradient by line progress
  map.addLayer({
    id: PATH_LINE,
    type: 'line',
    source: PATH_SRC,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-width': 2.5,
      'line-gradient': [
        'interpolate', ['linear'], ['line-progress'],
        0.00, 'rgba(255,138,61,0.0)',
        0.04, 'rgba(255,138,61,0.6)',
        0.10, '#ff8a3d',
        0.25, '#ffb845',
        0.50, '#fff1c2',
        0.75, '#ffb845',
        0.90, '#ff5e3d',
        0.96, 'rgba(255,94,61,0.6)',
        1.00, 'rgba(255,94,61,0.0)',
      ],
    },
  });

  // Sunrise / sunset rays (straight lines, longer than arc, accented endpoints)
  map.addLayer({
    id: SR_LINE,
    type: 'line',
    source: SR_SRC,
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#ff8a3d', 'line-width': 3, 'line-opacity': 0.95, 'line-dasharray': [0.6, 1.2] },
  });
  map.addLayer({
    id: SS_LINE,
    type: 'line',
    source: SS_SRC,
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#ff5e3d', 'line-width': 3, 'line-opacity': 0.95, 'line-dasharray': [0.6, 1.2] },
  });

  // Current sun ray (live as scrubber moves)
  map.addLayer({
    id: RAY_LINE,
    type: 'line',
    source: RAY_SRC,
    layout: { 'line-cap': 'round' },
    paint: {
      'line-color': '#fff1c2',
      'line-width': 2.5,
      'line-opacity': 0.85,
    },
  });

  // Sun marker glow + dot
  map.addLayer({
    id: MARKER_GLOW,
    type: 'circle',
    source: MARKER_SRC,
    paint: {
      'circle-radius': 22,
      'circle-color': '#ffb845',
      'circle-opacity': 0.3,
      'circle-blur': 1.0,
    },
  });
  map.addLayer({
    id: MARKER,
    type: 'circle',
    source: MARKER_SRC,
    paint: {
      'circle-radius': 7,
      'circle-color': '#fff1c2',
      'circle-stroke-color': '#ffb845',
      'circle-stroke-width': 2,
    },
  });
}

/** Compute and update everything that depends on date+location only. */
export function updateSunPathDay(map, observer, datetime) {
  const { lat, lon } = observer;
  const day = new Date(datetime); day.setHours(12, 0, 0, 0);
  const t = getDayBoundaries(day, lat, lon);

  // Path: sample every 4 minutes from sunrise to sunset.
  let coords = [];
  if (t.sunrise && t.sunset && t.sunrise < t.sunset) {
    const step = 4 * 60 * 1000;
    for (let ts = t.sunrise.getTime(); ts <= t.sunset.getTime(); ts += step) {
      const d = new Date(ts);
      const p = getPosition(d, lat, lon);
      // Project at radius scaled gently by elevation so high-noon arches outward
      const r = ARC_RADIUS_KM * (0.6 + 0.4 * Math.max(0, Math.sin((p.altitudeDeg * Math.PI) / 180)));
      coords.push(destination(lat, lon, p.azimuthDeg, r));
    }
  }

  setLine(map, PATH_SRC, coords);

  // Sunrise / sunset rays
  if (t.sunrise) {
    const az = getPosition(t.sunrise, lat, lon).azimuthDeg;
    setLine(map, SR_SRC, [[lon, lat], destination(lat, lon, az, ARC_RADIUS_KM * 1.2)]);
  } else setLine(map, SR_SRC, []);
  if (t.sunset) {
    const az = getPosition(t.sunset, lat, lon).azimuthDeg;
    setLine(map, SS_SRC, [[lon, lat], destination(lat, lon, az, ARC_RADIUS_KM * 1.2)]);
  } else setLine(map, SS_SRC, []);

  return t;
}

/** Light update: just the live sun ray + marker as scrubber moves. */
export function updateSunNow(map, observer, datetime) {
  const { lat, lon } = observer;
  const p = getPosition(datetime, lat, lon);

  if (p.altitudeDeg < -1) {
    setLine(map, RAY_SRC, []);
    setPoint(map, MARKER_SRC, null);
    return p;
  }
  const r = ARC_RADIUS_KM * (0.6 + 0.4 * Math.max(0, Math.sin((p.altitudeDeg * Math.PI) / 180)));
  const end = destination(lat, lon, p.azimuthDeg, r);
  setLine(map, RAY_SRC, [[lon, lat], end]);
  setPoint(map, MARKER_SRC, end);
  return p;
}

function setLine(map, srcId, coords) {
  const src = map.getSource(srcId);
  if (!src) return;
  if (!coords || coords.length < 2) {
    src.setData({ type: 'FeatureCollection', features: [] });
    return;
  }
  src.setData({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }],
  });
}

function setPoint(map, srcId, lonlat) {
  const src = map.getSource(srcId);
  if (!src) return;
  if (!lonlat) {
    src.setData({ type: 'FeatureCollection', features: [] });
    return;
  }
  src.setData({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: lonlat }, properties: {} }],
  });
}
