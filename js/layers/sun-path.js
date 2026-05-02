// Sun/moon path: 3D arc rendered as glowing dot markers.
// Each marker is anchored to a ground lng/lat (radial projection of body
// azimuth) and offset upward in PIXELS proportional to the altitude
// expressed as real-world metres (so the apparent height scales correctly
// with zoom — the arc keeps its shape when you pinch in/out).

import { getDayBoundaries, getPosition, getMoonPos, getMoonTimes } from '../solar.js';
import { destination } from '../util.js';

const RAY_SRC = 'sun-ray-src';
const RAY_LINE = 'sun-ray-line';
const SR_SRC = 'sunrise-vec-src';
const SR_LINE = 'sunrise-vec-line';
const SS_SRC = 'sunset-vec-src';
const SS_LINE = 'sunset-vec-line';

let arcRadiusKm = 1.5;          // adjustable via vertical slider
const SAMPLES = 60;
let mapRef = null;
let arcSamples = [];            // [{ lon, lat, altDeg }]
let arcMarkers = [];
let liveSample = null;          // { lon, lat, altDeg }
let liveMarker = null;
let visible = true;

export function setArcRadiusKm(km) {
  arcRadiusKm = Math.max(0.02, +km || 1.5);
  if (mapRef) refreshArcGeometry();
}
export function getArcRadiusKm() { return arcRadiusKm; }

export function addSunPathLayer(map) {
  mapRef = map;
  if (map.getSource(SR_SRC)) return;
  const empty = { type: 'FeatureCollection', features: [] };

  map.addSource(SR_SRC, { type: 'geojson', data: empty });
  map.addSource(SS_SRC, { type: 'geojson', data: empty });
  map.addSource(RAY_SRC, { type: 'geojson', data: empty });

  map.addLayer({ id: SR_LINE, type: 'line', source: SR_SRC,
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#ff8a3d', 'line-width': 3, 'line-opacity': 0.95, 'line-dasharray': [0.6, 1.2] },
  });
  map.addLayer({ id: SS_LINE, type: 'line', source: SS_SRC,
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#ff5e3d', 'line-width': 3, 'line-opacity': 0.95, 'line-dasharray': [0.6, 1.2] },
  });
  map.addLayer({ id: RAY_LINE, type: 'line', source: RAY_SRC,
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#fff1c2', 'line-width': 2, 'line-opacity': 0.7, 'line-dasharray': [2, 2] },
  });

  // Re-project markers when the map zooms so altitude scales with zoom.
  map.on('zoom', updateAllOffsets);
  map.on('move', updateAllOffsets);
}

export function setSunPathVisible(map, vis) {
  visible = vis;
  const v = vis ? 'visible' : 'none';
  for (const id of [SR_LINE, SS_LINE, RAY_LINE]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
  }
  for (const m of arcMarkers) m.getElement().style.display = vis ? '' : 'none';
  if (liveMarker) liveMarker.getElement().style.display = vis ? '' : 'none';
}

function clearArcMarkers() {
  for (const m of arcMarkers) m.remove();
  arcMarkers = [];
}

// Convert real-world metres at a given latitude to screen pixels at the map's current zoom.
function metresToPixels(metres, lat) {
  if (!mapRef) return 0;
  const mPerPx = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, mapRef.getZoom());
  return metres / mPerPx;
}

// Convert altitude angle (deg) at distance (km from observer) to a real-world vertical lift in metres.
// We pin the apparent height of the noon point to a fraction of the arc radius so the shape stays sane.
function altitudeToMetres(altDeg) {
  if (altDeg <= 0) return 0;
  // Arc of radius R km — at zenith we lift by 0.5*R km (1/2 the arc radius) for a balanced dome.
  const liftKm = arcRadiusKm * 0.5 * Math.sin(altDeg * Math.PI / 180);
  return liftKm * 1000;
}

function offsetForSample(s) {
  const px = metresToPixels(altitudeToMetres(s.altDeg), s.lat);
  return [0, -px];
}

function updateAllOffsets() {
  for (let i = 0; i < arcMarkers.length; i++) {
    const s = arcSamples[i];
    arcMarkers[i].setOffset(offsetForSample(s));
  }
  if (liveMarker && liveSample) {
    liveMarker.setOffset(offsetForSample(liveSample));
  }
}

function refreshArcGeometry() {
  // Re-place markers at the current radius using stored sample altitudes/azimuths.
  // For simplicity we only re-trigger via the next updateSunPathDay call.
  // Kept as a hook for future incremental updates.
}

/**
 * Day-level recompute. moonMode → use moon arc.
 * Returns { rise, set }.
 */
export function updateSunPathDay(map, observer, datetime, moonMode = false) {
  const { lat, lon } = observer;

  let rise, set;
  if (moonMode) {
    const now = datetime;
    const today = getMoonTimes(now, lat, lon);
    if (today.rise && today.set && today.rise < today.set && now >= today.rise && now <= today.set) {
      rise = today.rise; set = today.set;
    } else if (today.rise && now < today.rise) {
      const after = getMoonTimes(new Date(today.rise.getTime() + 60000), lat, lon);
      rise = today.rise;
      set = after.set || today.set;
    } else {
      const tomorrow = getMoonTimes(new Date(now.getTime() + 24 * 3600 * 1000), lat, lon);
      rise = today.rise || tomorrow.rise;
      set = tomorrow.set || today.set;
    }
  } else {
    const t = getDayBoundaries(datetime, lat, lon);
    rise = t.sunrise; set = t.sunset;
  }

  clearArcMarkers();
  arcSamples = [];
  if (rise && set && rise < set) {
    const total = set.getTime() - rise.getTime();
    const stepMs = total / SAMPLES;
    const getPos = moonMode ? getMoonPos : getPosition;
    for (let i = 0; i <= SAMPLES; i++) {
      const ts = rise.getTime() + i * stepMs;
      const d = new Date(ts);
      const p = getPos(d, lat, lon);
      if (p.altitudeDeg < 0) continue;
      const [glon, glat] = destination(lat, lon, p.azimuthDeg, arcRadiusKm);
      const sample = { lon: glon, lat: glat, altDeg: p.altitudeDeg };
      const dot = document.createElement('div');
      dot.className = 'arc-dot';
      const m = new maplibregl.Marker({ element: dot, offset: offsetForSample(sample) })
        .setLngLat([glon, glat])
        .addTo(map);
      arcMarkers.push(m);
      arcSamples.push(sample);
    }
  }

  const getPos = moonMode ? getMoonPos : getPosition;
  if (rise) {
    const az = getPos(rise, lat, lon).azimuthDeg;
    setLine(map, SR_SRC, [[lon, lat], destination(lat, lon, az, arcRadiusKm * 1.4)]);
  } else setLine(map, SR_SRC, []);
  if (set) {
    const az = getPos(set, lat, lon).azimuthDeg;
    setLine(map, SS_SRC, [[lon, lat], destination(lat, lon, az, arcRadiusKm * 1.4)]);
  } else setLine(map, SS_SRC, []);

  return { rise, set };
}

export function updateSunNow(map, observer, datetime, posOverride = null) {
  const { lat, lon } = observer;
  const p = posOverride || getPosition(datetime, lat, lon);

  if (p.altitudeDeg < -1) {
    setLine(map, RAY_SRC, []);
    if (liveMarker) { liveMarker.remove(); liveMarker = null; }
    liveSample = null;
    return p;
  }
  const [glon, glat] = destination(lat, lon, p.azimuthDeg, arcRadiusKm);
  setLine(map, RAY_SRC, [[lon, lat], [glon, glat]]);

  liveSample = { lon: glon, lat: glat, altDeg: p.altitudeDeg };
  if (!liveMarker) {
    const dot = document.createElement('div');
    dot.className = 'arc-dot head';
    liveMarker = new maplibregl.Marker({ element: dot, offset: offsetForSample(liveSample) })
      .setLngLat([glon, glat])
      .addTo(map);
  }
  liveMarker.setLngLat([glon, glat]);
  liveMarker.setOffset(offsetForSample(liveSample));
  if (!visible) liveMarker.getElement().style.display = 'none';
  return p;
}

/** Live position of the body (used by shadow renderer for the sky→caster line). */
export function getLiveBodyAnchor() {
  if (!liveSample) return null;
  return { ...liveSample, offsetPx: offsetForSample(liveSample) };
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
