// Perspective ground-plane grid for grid mode.
// Uses map.project() so lines get correct depth/foreshortening with map pitch.
// Three persistent <path> elements (minor/major/axis) replace per-render DOM
// creation — eliminates the 800+ element GC churn that caused mobile crashes.

let mapRef = null;
let obs = { lat: 43.6532, lon: -79.3832 };
let enabled = false;
let imperial = false;
let gridSvg = null;
let pathMinor = null, pathMajor = null, pathAxis = null;
let labelGroup = null;
let clipRect = null;

// Nice cell sizes in metres and their imperial equivalents (also expressed in m)
const NICE_M    = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const NICE_FT_M = [0.03048, 0.1524, 0.3048, 0.9144, 1.524, 3.048, 7.62, 15.24, 30.48, 91.44, 304.8];

export function initGrid(map) {
  mapRef = map;
  gridSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  gridSvg.setAttribute('style',
    'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:1;');
  gridSvg.style.display = 'none';

  // Persistent defs + clip — only clipRect width/height updated on render
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const clip  = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
  clip.setAttribute('id', 'gc');
  clipRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  clipRect.setAttribute('x', '0'); clipRect.setAttribute('y', '0');
  clip.appendChild(clipRect); defs.appendChild(clip);
  gridSvg.appendChild(defs);

  // Persistent group + 3 path elements — d attribute updated each frame,
  // no element creation/destruction during pan/zoom
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('clip-path', 'url(#gc)');
  pathMinor = _makePath(0.07, 0.4);
  pathMajor = _makePath(0.22, 0.7);
  pathAxis  = _makePath(0.50, 1.2);
  labelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.appendChild(pathMinor); g.appendChild(pathMajor);
  g.appendChild(pathAxis);  g.appendChild(labelGroup);
  gridSvg.appendChild(g);

  document.body.appendChild(gridSvg);
  map.on('render', _render);
}

function _makePath(opacity, strokeWidth) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  el.setAttribute('stroke', '#ffffff');
  el.setAttribute('stroke-width', String(strokeWidth));
  el.setAttribute('opacity', String(opacity));
  el.setAttribute('fill', 'none');
  return el;
}

export function setGridEnabled(v) {
  enabled = !!v;
  if (gridSvg) gridSvg.style.display = enabled ? '' : 'none';
  if (!enabled && pathMinor) {
    pathMinor.setAttribute('d', ''); pathMajor.setAttribute('d', '');
    pathAxis.setAttribute('d', '');
    while (labelGroup.lastChild) labelGroup.removeChild(labelGroup.lastChild);
  }
}

export function setGridObserver(lat, lon) { obs = { lat, lon }; }
export function setGridImperial(v)       { imperial = !!v; }

// ── internals ──────────────────────────────────────────────────────────────

// Flat-earth ENU → lng/lat (accurate to well under 1mm up to ~50 km)
function _toLL(eastM, northM) {
  const cosLat = Math.cos(obs.lat * Math.PI / 180);
  return [obs.lon + eastM / (111320 * cosLat), obs.lat + northM / 111320];
}
function _px(eastM, northM) { return mapRef.project(_toLL(eastM, northM)); }

// Pixels per metre at the observer's position (using 1 m north as reference)
function _ppm() {
  const p1 = mapRef.project([obs.lon, obs.lat]);
  const p2 = mapRef.project(_toLL(0, 1));
  const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  return d > 0.01 ? d : 1;
}

// Pick the cell size that puts ~60 px between grid lines
function _cellM(ppm) {
  const desired = 60 / ppm;
  const pool = imperial ? NICE_FT_M : NICE_M;
  return pool.reduce((b, s) => Math.abs(s - desired) < Math.abs(b - desired) ? s : b);
}

// Distance label: positive axis offset n*cellM in metres
function _label(n, cellM) {
  const absM = Math.abs(n * cellM);
  if (imperial) {
    const ft = absM * 3.28084;
    if (ft < 1)    return `${Math.round(ft * 12)}"`;
    if (ft < 1000) return `${Math.round(ft * 10) / 10}'`;
    return `${Math.round(ft / 528) / 10}mi`;
  }
  if (absM < 1)    return `${Math.round(absM * 100)}cm`;
  if (absM < 1000) return `${Math.round(absM * 10) / 10}m`;
  return `${Math.round(absM / 100) / 10}km`;
}

function _text(g, x, y, txt) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  el.setAttribute('x', x); el.setAttribute('y', y);
  el.setAttribute('fill', 'rgba(255,255,255,0.32)');
  el.setAttribute('font-size', '10');
  el.setAttribute('font-family', 'Inter,-apple-system,system-ui,sans-serif');
  el.setAttribute('text-anchor', 'middle');
  el.setAttribute('dominant-baseline', 'middle');
  el.textContent = txt;
  g.appendChild(el);
}

function _render() {
  if (!enabled || !mapRef || !gridSvg) return;

  const W = window.innerWidth, H = window.innerHeight;
  clipRect.setAttribute('width', W); clipRect.setAttribute('height', H);

  const ppm   = _ppm();
  const cellM = _cellM(ppm);
  const MAJOR = 10;
  const viewM = 1.5 * Math.max(W, H) / ppm;
  const halfN = Math.min(Math.ceil(viewM / cellM) + 2, 400);
  const rangeM = halfN * cellM;

  // Build path data strings — one M...L segment per line, no DOM nodes created
  let dMinor = '', dMajor = '', dAxis = '';

  // E-W lines (constant northM, extend east–west)
  for (let n = -halfN; n <= halfN; n++) {
    const northM = n * cellM;
    const p1 = _px(-rangeM, northM), p2 = _px(rangeM, northM);
    if (!Number.isFinite(p1.x + p1.y + p2.x + p2.y)) continue;
    // Bitwise |0 truncates to integer — screen coords don't need sub-pixel precision
    const seg = `M${p1.x|0},${p1.y|0}L${p2.x|0},${p2.y|0}`;
    if (n === 0) dAxis += seg;
    else if (n % MAJOR === 0) dMajor += seg;
    else dMinor += seg;
  }

  // N-S lines (constant eastM, extend north–south)
  for (let n = -halfN; n <= halfN; n++) {
    const eastM = n * cellM;
    const p1 = _px(eastM, -rangeM), p2 = _px(eastM, rangeM);
    if (!Number.isFinite(p1.x + p1.y + p2.x + p2.y)) continue;
    const seg = `M${p1.x|0},${p1.y|0}L${p2.x|0},${p2.y|0}`;
    if (n === 0) dAxis += seg;
    else if (n % MAJOR === 0) dMajor += seg;
    else dMinor += seg;
  }

  pathMinor.setAttribute('d', dMinor);
  pathMajor.setAttribute('d', dMajor);
  pathAxis.setAttribute('d', dAxis);

  // Distance labels along E and N axes near observer's screen position.
  // Small count per frame (~5–15 visible labels) — recreate is acceptable.
  while (labelGroup.lastChild) labelGroup.removeChild(labelGroup.lastChild);
  const obsScr = mapRef.project([obs.lon, obs.lat]);
  const lblY   = Math.max(18, Math.min(H - 18, obsScr.y + 22));
  const lblX   = Math.max(18, Math.min(W - 18, obsScr.x + 22));

  for (let n = -halfN; n <= halfN; n++) {
    if (n === 0 || n % MAJOR !== 0) continue;
    const p = _px(n * cellM, 0);
    if (!Number.isFinite(p.x) || p.x < 14 || p.x > W - 14) continue;
    _text(labelGroup, p.x, lblY, _label(n, cellM));
  }
  for (let n = -halfN; n <= halfN; n++) {
    if (n === 0 || n % MAJOR !== 0) continue;
    const p = _px(0, n * cellM);
    if (!Number.isFinite(p.y) || p.y < 14 || p.y > H - 14) continue;
    _text(labelGroup, lblX, p.y, _label(n, cellM));
  }
}
