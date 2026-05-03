// Sun/moon path: 3D arc rendered as glowing dot markers.
// Each marker is anchored to a ground lng/lat (radial projection of body
// azimuth) and offset upward in PIXELS proportional to the altitude
// expressed as real-world metres (so the apparent height scales correctly
// with zoom — the arc keeps its shape when you pinch in/out).

import { getDayBoundaries, getPosition, getMoonPos, getMoonTimes } from '../solar.js';
import { destination, project3D } from '../util.js';

const RAY_SRC = 'sun-ray-src';
const RAY_LINE = 'sun-ray-line';
const SR_SRC = 'sunrise-vec-src';
const SR_LINE = 'sunrise-vec-line';
const SS_SRC = 'sunset-vec-src';
const SS_LINE = 'sunset-vec-line';

let arcRadiusKm = 1.5;          // adjustable via vertical slider
let anchorLiftMetres = 0;       // baseline lift added to every sample (caster height when shadow on)
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

/**
 * Re-anchor the arc to a different vertical baseline (in metres).
 * When non-zero (e.g. caster height in shadow mode), the entire arc lifts by
 * that amount in screen pixels — putting the body on a sphere centred on
 * the caster top instead of the observer's feet, so a body→caster→shadow ray
 * is genuinely collinear.
 */
export function setAnchorLiftMetres(m) {
  anchorLiftMetres = Math.max(0, +m || 0);
  if (mapRef) updateAllOffsets();
}
export function getAnchorLiftMetres() { return anchorLiftMetres; }

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
    paint: { 'line-color': '#ffb845', 'line-width': 2.5, 'line-opacity': 0.9 },
  });

  // Re-project markers when the map zooms so altitude scales with zoom.
  map.on('zoom', updateAllOffsets);
  map.on('move', updateAllOffsets);
}

export function setSunPathVisible(map, vis) {
  visible = vis;
  const v = vis ? 'visible' : 'none';
  for (const id of [SR_LINE, SS_LINE]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
  }
  for (const m of arcMarkers) m.getElement().style.display = vis ? '' : 'none';
  if (liveMarker) liveMarker.getElement().style.display = vis ? '' : 'none';
}

// Ray line is controlled independently so it stays visible in reflection mode.
export function setRayLineVisible(map, vis) {
  if (map.getLayer(RAY_LINE)) map.setLayoutProperty(RAY_LINE, 'visibility', vis ? 'visible' : 'none');
}

function clearArcMarkers() {
  for (const m of arcMarkers) m.remove();
  arcMarkers = [];
}

// True spherical projection: place the body on a sphere of radius arcRadius
// around the anchor (observer ground, or caster top in shadow mode).
// Horizontal distance = R*cos(alt), vertical lift = R*sin(alt).
function liftMetresAtAltitude(altDeg) {
  if (altDeg <= 0) return anchorLiftMetres;
  return arcRadiusKm * 1000 * Math.sin(altDeg * Math.PI / 180) + anchorLiftMetres;
}
function horizontalKmAtAltitude(altDeg) {
  return arcRadiusKm * Math.max(0, Math.cos(altDeg * Math.PI / 180));
}

/**
 * Marker offset = (true-3D screen projection of the elevated body) minus
 * (ground projection of the body's lng/lat). Using MapLibre's actual
 * projection matrix means the offset is correct under any pitch/bearing/zoom,
 * and (critically) collinear 3D points stay collinear on screen — so a ray
 * from the body through the caster top hits the ground shadow point exactly.
 */
function offsetForSample(s) {
  if (!mapRef) return [0, 0];
  const altM = liftMetresAtAltitude(s.altDeg);
  const ground = mapRef.project([s.lon, s.lat]);
  const elevated = project3D(mapRef, s.lon, s.lat, altM);
  return [elevated.x - ground.x, elevated.y - ground.y];
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
      const [glon, glat] = destination(lat, lon, p.azimuthDeg, horizontalKmAtAltitude(p.altitudeDeg));
      const sample = { lon: glon, lat: glat, altDeg: p.altitudeDeg, azDeg: p.azimuthDeg };
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
  const horizKm = horizontalKmAtAltitude(p.altitudeDeg);
  const [glon, glat] = destination(lat, lon, p.azimuthDeg, horizKm);
  // Ray goes from the arc dot's ground position back to the observer — i.e. the
  // direction from sun to ground, always at the current arc radius length.
  setLine(map, RAY_SRC, [[glon, glat], [lon, lat]]);

  liveSample = { lon: glon, lat: glat, altDeg: p.altitudeDeg, azDeg: p.azimuthDeg };
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

/** Snapshot of the arc samples (for AR overlay rendering). */
export function getArcSamples() {
  return arcSamples.slice();
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
