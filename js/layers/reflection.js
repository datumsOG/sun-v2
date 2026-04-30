// Reflection vector: mirror of the sun's azimuth, in cyan.

import { getPosition, getDayBoundaries } from '../solar.js';
import { reflectAzimuth } from '../reflection.js';
import { destination } from '../util.js';

const PATH_SRC = 'reflect-path-src';
const PATH_LINE = 'reflect-path-line';
const PATH_GLOW = 'reflect-path-glow';
const RAY_SRC = 'reflect-ray-src';
const RAY_LINE = 'reflect-ray-line';
const MARKER_SRC = 'reflect-marker-src';
const MARKER = 'reflect-marker';
const MARKER_GLOW = 'reflect-marker-glow';

const ARC_RADIUS_KM = 6;

export function addReflectionLayer(map) {
  if (map.getSource(PATH_SRC)) return;
  const empty = { type: 'FeatureCollection', features: [] };

  map.addSource(PATH_SRC, { type: 'geojson', data: empty, lineMetrics: true });
  map.addSource(RAY_SRC, { type: 'geojson', data: empty });
  map.addSource(MARKER_SRC, { type: 'geojson', data: empty });

  map.addLayer({
    id: PATH_GLOW,
    type: 'line',
    source: PATH_SRC,
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: {
      'line-color': '#4dd2ff',
      'line-width': 12,
      'line-opacity': 0.18,
      'line-blur': 6,
    },
  });
  map.addLayer({
    id: PATH_LINE,
    type: 'line',
    source: PATH_SRC,
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: {
      'line-color': '#4dd2ff',
      'line-width': 2.5,
      'line-opacity': 0.85,
      'line-dasharray': [2, 2],
    },
  });
  map.addLayer({
    id: RAY_LINE,
    type: 'line',
    source: RAY_SRC,
    layout: { 'line-cap': 'round', visibility: 'none' },
    paint: {
      'line-color': '#4dd2ff',
      'line-width': 2.5,
      'line-opacity': 0.95,
      'line-dasharray': [1.5, 1.2],
    },
  });
  map.addLayer({
    id: MARKER_GLOW,
    type: 'circle',
    source: MARKER_SRC,
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': 18,
      'circle-color': '#4dd2ff',
      'circle-opacity': 0.3,
      'circle-blur': 1.0,
    },
  });
  map.addLayer({
    id: MARKER,
    type: 'circle',
    source: MARKER_SRC,
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': 6,
      'circle-color': '#bbeeff',
      'circle-stroke-color': '#4dd2ff',
      'circle-stroke-width': 2,
    },
  });
}

export function setReflectionVisible(map, visible) {
  const v = visible ? 'visible' : 'none';
  for (const id of [PATH_GLOW, PATH_LINE, RAY_LINE, MARKER_GLOW, MARKER]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
  }
}

export function updateReflectionDay(map, observer, datetime) {
  const { lat, lon } = observer;
  const day = new Date(datetime); day.setHours(12, 0, 0, 0);
  const t = getDayBoundaries(day, lat, lon);
  let coords = [];
  if (t.sunrise && t.sunset && t.sunrise < t.sunset) {
    const step = 4 * 60 * 1000;
    for (let ts = t.sunrise.getTime(); ts <= t.sunset.getTime(); ts += step) {
      const d = new Date(ts);
      const p = getPosition(d, lat, lon);
      const r = ARC_RADIUS_KM * (0.6 + 0.4 * Math.max(0, Math.sin((p.altitudeDeg * Math.PI) / 180)));
      coords.push(destination(lat, lon, reflectAzimuth(p.azimuthDeg), r));
    }
  }
  setLine(map, PATH_SRC, coords);
}

export function updateReflectionNow(map, observer, datetime) {
  const { lat, lon } = observer;
  const p = getPosition(datetime, lat, lon);
  if (p.altitudeDeg < -1) {
    setLine(map, RAY_SRC, []);
    setPoint(map, MARKER_SRC, null);
    return;
  }
  const az = reflectAzimuth(p.azimuthDeg);
  const r = ARC_RADIUS_KM * (0.6 + 0.4 * Math.max(0, Math.sin((p.altitudeDeg * Math.PI) / 180)));
  const end = destination(lat, lon, az, r);
  setLine(map, RAY_SRC, [[lon, lat], end]);
  setPoint(map, MARKER_SRC, end);
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
