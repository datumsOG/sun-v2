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
// Grid-mode SVG overlay: mirrors SR/SS/RAY lines when the MapLibre canvas is hidden.
let gridLinesSvg = null;
let gridSrEl = null, gridSsEl = null, gridRayEl = null;
let srCoords = null, ssCoords = null, rayCoords = null;
let gridLinesActive = false;

let arcSamples = [];            // [{ lon, lat, altDeg }]
let arcMarkers = [];
let arcDotBaseSizes = [];       // base size (px) set at arc build time, before density scaling
let _lastOffsets = [];          // cached [dx,dy] per marker — skip DOM write if sub-pixel change
let _lastZIndex = [];           // cached zIndex string per marker
let liveSample = null;          // { lon, lat, altDeg }
let liveMarker = null;
let visible = true;
let dropSvg = null;
let dropLine = null;
let dropLineColor = '#ffb845';  // yellow sun, white moon

export function setArcRadiusKm(km) {
  // Floor lowered to 5 m so grid mode can use a backyard-scale arc.
  arcRadiusKm = Math.max(0.005, +km || 1.5);
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

export function setGridModeLines(active) {
  gridLinesActive = !!active;
  if (gridLinesSvg) gridLinesSvg.style.display = active ? '' : 'none';
}

function _makeGridSvgLine(color, width) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  el.setAttribute('stroke', color); el.setAttribute('stroke-width', String(width));
  el.setAttribute('stroke-linecap', 'round'); el.setAttribute('opacity', '0');
  return el;
}

function _projectGridLine(el, coords) {
  if (!el || !coords || !mapRef) { if (el) el.setAttribute('opacity', '0'); return; }
  const a = mapRef.project(coords[0]), b = mapRef.project(coords[coords.length - 1]);
  if (!Number.isFinite(a.x) || !Number.isFinite(b.x)) { el.setAttribute('opacity', '0'); return; }
  el.setAttribute('x1', String(a.x|0)); el.setAttribute('y1', String(a.y|0));
  el.setAttribute('x2', String(b.x|0)); el.setAttribute('y2', String(b.y|0));
  el.setAttribute('opacity', '0.9');
}

function _renderGridLines() {
  if (!gridLinesActive || !mapRef) return;
  _projectGridLine(gridSrEl, srCoords);
  _projectGridLine(gridSsEl, ssCoords);
  _projectGridLine(gridRayEl, rayCoords);
}

export function addSunPathLayer(map) {
  mapRef = map;
  if (map.getSource(SR_SRC)) return;
  const empty = { type: 'FeatureCollection', features: [] };

  map.addSource(SR_SRC, { type: 'geojson', data: empty, lineMetrics: true });
  map.addSource(SS_SRC, { type: 'geojson', data: empty, lineMetrics: true });
  map.addSource(RAY_SRC, { type: 'geojson', data: empty });

  // Solid lines with gradient fade at both ends (lineMetrics required for line-gradient).
  map.addLayer({ id: SR_LINE, type: 'line', source: SR_SRC,
    layout: { 'line-cap': 'round' },
    paint: { 'line-width': 2.5,
      'line-gradient': ['interpolate', ['linear'], ['line-progress'],
        0, 'rgba(255,138,61,0)', 0.18, 'rgba(255,138,61,0.55)',
        0.82, 'rgba(255,138,61,0.55)', 1, 'rgba(255,138,61,0)'] },
  });
  map.addLayer({ id: SS_LINE, type: 'line', source: SS_SRC,
    layout: { 'line-cap': 'round' },
    paint: { 'line-width': 2.5,
      'line-gradient': ['interpolate', ['linear'], ['line-progress'],
        0, 'rgba(255,94,61,0)', 0.18, 'rgba(255,94,61,0.55)',
        0.82, 'rgba(255,94,61,0.55)', 1, 'rgba(255,94,61,0)'] },
  });
  map.addLayer({ id: RAY_LINE, type: 'line', source: RAY_SRC,
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#ffb845', 'line-width': 2.5, 'line-opacity': 0.9 },
  });

  // Drop line: vertical SVG from elevated arc dot to its ground anchor.
  dropSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  dropSvg.setAttribute('style', 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2;');
  dropLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  dropLine.setAttribute('stroke', dropLineColor);
  dropLine.setAttribute('stroke-width', '2');
  dropLine.setAttribute('stroke-linecap', 'round');
  dropLine.setAttribute('opacity', '0');
  dropSvg.appendChild(dropLine);
  document.body.appendChild(dropSvg);

  // Grid-mode SVG: mirrors SR/SS/RAY lines when the MapLibre canvas is hidden.
  gridLinesSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  gridLinesSvg.setAttribute('style', 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:3;');
  gridLinesSvg.style.display = 'none';
  gridSrEl  = _makeGridSvgLine('#ff8a3d', 3.0);
  gridSsEl  = _makeGridSvgLine('#ff5e3d', 3.0);
  gridRayEl = _makeGridSvgLine('#ffb845', 2.5);
  gridLinesSvg.appendChild(gridSrEl); gridLinesSvg.appendChild(gridSsEl); gridLinesSvg.appendChild(gridRayEl);
  document.body.appendChild(gridLinesSvg);

  // Re-project markers when the map zooms so altitude scales with zoom.
  map.on('zoom', updateAllOffsets);
  map.on('move', updateAllOffsets);
  map.on('render', renderDropLine);
  map.on('render', _renderGridLines);
}

export function setSunPathVisible(map, vis) {
  visible = vis;
  const v = vis ? 'visible' : 'none';
  for (const id of [SR_LINE, SS_LINE]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
  }
  for (const m of arcMarkers) m.getElement().style.display = vis ? '' : 'none';
  if (liveMarker) liveMarker.getElement().style.display = vis ? '' : 'none';
  if (dropSvg) dropSvg.style.display = vis ? '' : 'none';
}

export function setBodyColor(map, moonMode) {
  dropLineColor = moonMode ? '#d0d8e8' : '#ffb845';
  if (dropLine) dropLine.setAttribute('stroke', dropLineColor);
  if (map && map.getLayer(RAY_LINE)) map.setPaintProperty(RAY_LINE, 'line-color', dropLineColor);
  if (map && map.getLayer(SR_LINE)) {
    const [r, g, b] = moonMode ? [208, 216, 232] : [255, 138, 61];
    map.setPaintProperty(SR_LINE, 'line-gradient', ['interpolate', ['linear'], ['line-progress'],
      0, `rgba(${r},${g},${b},0)`, 0.18, `rgba(${r},${g},${b},0.55)`,
      0.82, `rgba(${r},${g},${b},0.55)`, 1, `rgba(${r},${g},${b},0)`]);
  }
  if (map && map.getLayer(SS_LINE)) {
    const [r, g, b] = moonMode ? [208, 216, 232] : [255, 94, 61];
    map.setPaintProperty(SS_LINE, 'line-gradient', ['interpolate', ['linear'], ['line-progress'],
      0, `rgba(${r},${g},${b},0)`, 0.18, `rgba(${r},${g},${b},0.55)`,
      0.82, `rgba(${r},${g},${b},0.55)`, 1, `rgba(${r},${g},${b},0)`]);
  }
}

// Ray line is controlled independently so it stays visible in reflection mode.
export function setRayLineVisible(map, vis) {
  if (map.getLayer(RAY_LINE)) map.setLayoutProperty(RAY_LINE, 'visibility', vis ? 'visible' : 'none');
}

function clearArcMarkers() {
  for (const m of arcMarkers) m.remove();
  arcMarkers = [];
  arcDotBaseSizes = [];
  _lastOffsets = [];
  _lastZIndex = [];
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
  const dx = elevated.x - ground.x;
  const dy = elevated.y - ground.y;
  return [Number.isFinite(dx) ? dx : 0, Number.isFinite(dy) ? dy : 0];
}

function updateAllOffsets() {
  const n = arcMarkers.length;
  if (!n) {
    if (liveMarker && liveSample) {
      liveMarker.setOffset(offsetForSample(liveSample));
      liveMarker.getElement().style.zIndex = '9999';
    }
    renderDropLine();
    return;
  }

  // Density-aware dot sizing: measure average screen-space gap between adjacent dots
  // and shrink dots so they don't overlap when zoomed out.
  let totalGap = 0, gapCount = 0;
  const screenPts = arcSamples.map(s => {
    try { return mapRef ? mapRef.project([s.lon, s.lat]) : null; } catch { return null; }
  });
  for (let i = 1; i < n; i++) {
    const a = screenPts[i - 1], b = screenPts[i];
    if (a && b && Number.isFinite(a.x) && Number.isFinite(b.x)) {
      const dx = b.x - a.x, dy = b.y - a.y;
      totalGap += Math.sqrt(dx * dx + dy * dy);
      gapCount++;
    }
  }
  // avgGap in screen px between adjacent dots; max dot size = avgGap so dots just touch.
  const avgGap = gapCount ? totalGap / gapCount : 999;
  const maxAllowed = Math.max(3, Math.min(10, avgGap));

  for (let i = 0; i < n; i++) {
    const s = arcSamples[i];
    const [dx, dy] = offsetForSample(s);

    // Jitter fix: skip setOffset if sub-pixel change from last write.
    const last = _lastOffsets[i];
    if (!last || Math.abs(dx - last[0]) >= 1 || Math.abs(dy - last[1]) >= 1) {
      arcMarkers[i].setOffset([dx, dy]);
      _lastOffsets[i] = [dx, dy];
    }

    // Density-aware size.
    const base = arcDotBaseSizes[i] ?? 5;
    const sized = Math.round(Math.min(base, maxAllowed));
    const el = arcMarkers[i].getElement();
    if (el._lastSized !== sized) {
      el.style.width = el.style.height = sized + 'px';
      el._lastSized = sized;
    }

    // Z-order (skip if unchanged).
    const px = screenPts[i];
    if (px && Number.isFinite(px.y)) {
      const zi = String(Math.round(px.y));
      if (_lastZIndex[i] !== zi) {
        el.style.zIndex = zi;
        _lastZIndex[i] = zi;
      }
    }
  }

  if (liveMarker && liveSample) {
    liveMarker.setOffset(offsetForSample(liveSample));
    liveMarker.getElement().style.zIndex = '9999'; // live dot always in front
  }
  // Slider changes don't trigger a map render event, so sync the drop line now.
  renderDropLine();
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

  if (liveMarker) { liveMarker.remove(); liveMarker = null; }
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
      // Perspective size: overhead dots (high alt) are closer → appear larger
      const sizePx = Math.round(5 + 5 * Math.sin(Math.min(90, p.altitudeDeg) * Math.PI / 180));
      dot.style.width = dot.style.height = sizePx + 'px';
      dot._lastSized = sizePx;
      const m = new maplibregl.Marker({ element: dot, offset: offsetForSample(sample) })
        .setLngLat([glon, glat])
        .addTo(map);
      arcMarkers.push(m);
      arcSamples.push(sample);
      arcDotBaseSizes.push(sizePx);
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

function renderDropLine() {
  if (!dropLine) return;
  if (!visible || !mapRef || !liveSample) {
    dropLine.setAttribute('opacity', '0');
    return;
  }
  const offset = offsetForSample(liveSample);
  // Only draw if the arc dot is meaningfully elevated off the ground (≥3 px).
  if (Math.abs(offset[1]) < 3 && Math.abs(offset[0]) < 3) {
    dropLine.setAttribute('opacity', '0');
    return;
  }
  let ground;
  try { ground = mapRef.project([liveSample.lon, liveSample.lat]); } catch { dropLine.setAttribute('opacity', '0'); return; }
  if (!Number.isFinite(ground?.x) || !Number.isFinite(ground?.y)) {
    dropLine.setAttribute('opacity', '0');
    return;
  }
  dropLine.setAttribute('x1', ground.x + offset[0]);
  dropLine.setAttribute('y1', ground.y + offset[1]);
  dropLine.setAttribute('x2', ground.x);
  dropLine.setAttribute('y2', ground.y);
  dropLine.setAttribute('opacity', '0.85');
}

function setLine(map, srcId, coords) {
  // Cache coords for grid-mode SVG reprojection.
  const valid = coords && coords.length >= 2;
  if (srcId === SR_SRC)  srCoords  = valid ? coords : null;
  else if (srcId === SS_SRC)  ssCoords  = valid ? coords : null;
  else if (srcId === RAY_SRC) rayCoords = valid ? coords : null;

  const src = map.getSource(srcId);
  if (!src) return;
  if (!valid) {
    src.setData({ type: 'FeatureCollection', features: [] });
    return;
  }
  src.setData({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }],
  });
}
