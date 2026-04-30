// Elevation curve chart with twilight bands and golden-hour shading.
// Vertical line tracks current scrubber time and is updated via transform
// (no SVG re-render) for cheap 60fps motion.

import { getDayBoundaries, getPosition } from '../solar.js';
import { startOfLocalDay } from '../util.js';

const W = 600;
const H = 110;
const PAD_TOP = 6;
const PAD_BOT = 6;
const ALT_MIN = -18;
const ALT_MAX = 90;

const SVG_NS = 'http://www.w3.org/2000/svg';

let cache = null; // { dayKey, observerKey }

export function renderChartDay(svg, observer, datetime) {
  const { lat, lon } = observer;
  const day = startOfLocalDay(datetime);
  const dayKey = day.toDateString();
  const observerKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (cache && cache.dayKey === dayKey && cache.observerKey === observerKey) {
    return cache.bounds;
  }

  const t = getDayBoundaries(day, lat, lon);
  const dayStart = day.getTime();
  const dayEnd = dayStart + 86400000;

  // Sample elevation every 5 minutes
  const samples = [];
  for (let m = 0; m <= 1440; m += 5) {
    const ts = new Date(dayStart + m * 60000);
    const p = getPosition(ts, lat, lon);
    samples.push({ m, alt: p.altitudeDeg });
  }

  // Build SVG
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  // Twilight bands (drawn as full-height rects spanning time ranges)
  drawBands(svg, t, dayStart, dayEnd);

  // Horizon line
  const horizonY = altToY(0);
  const horizonLine = el('line', {
    x1: 0, x2: W, y1: horizonY, y2: horizonY,
    stroke: 'rgba(255,255,255,0.18)', 'stroke-width': 1, 'stroke-dasharray': '3 3',
  });
  svg.appendChild(horizonLine);

  // Curve path
  const filled = ['M', 0, H - PAD_BOT];
  const stroke = [];
  let firstPoint = true;
  for (const s of samples) {
    const x = (s.m / 1440) * W;
    const y = altToY(s.alt);
    if (firstPoint) { stroke.push('M', x, y); firstPoint = false; }
    else stroke.push('L', x, y);
    filled.push('L', x, y);
  }
  filled.push('L', W, H - PAD_BOT, 'Z');

  const fill = el('path', {
    d: filled.join(' '),
    fill: 'url(#sunGradient)',
    opacity: '0.35',
  });
  // gradient
  const defs = el('defs');
  defs.innerHTML = `
    <linearGradient id="sunGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff1c2" stop-opacity="0.7"/>
      <stop offset="1" stop-color="#ff8a3d" stop-opacity="0.0"/>
    </linearGradient>`;
  svg.appendChild(defs);
  svg.appendChild(fill);

  const line = el('path', {
    d: stroke.join(' '),
    fill: 'none',
    stroke: '#ffb845',
    'stroke-width': '1.6',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
  svg.appendChild(line);

  // Sunrise / sunset markers
  if (t.sunrise) addEventMarker(svg, dayStart, t.sunrise, '#ff8a3d', '↑');
  if (t.sunset) addEventMarker(svg, dayStart, t.sunset, '#ff5e3d', '↓');

  // Now-line (vertical), updated via transform later
  const nowLine = el('line', {
    id: 'chart-now',
    x1: 0, x2: 0, y1: 0, y2: H,
    stroke: '#fff', 'stroke-width': 1.6,
    'stroke-opacity': 0.85,
  });
  svg.appendChild(nowLine);
  const nowDot = el('circle', {
    id: 'chart-now-dot',
    cx: 0, cy: 0, r: 4,
    fill: '#fff', stroke: '#ffb845', 'stroke-width': 1.5,
  });
  svg.appendChild(nowDot);

  cache = { dayKey, observerKey, bounds: t, samples };
  return t;
}

export function updateChartNow(svg, observer, datetime) {
  if (!cache) return;
  const { lat, lon } = observer;
  const day = startOfLocalDay(datetime);
  const dayStart = day.getTime();
  const m = (datetime.getTime() - dayStart) / 60000;
  const x = (m / 1440) * W;
  const p = getPosition(datetime, lat, lon);
  const y = altToY(p.altitudeDeg);

  const line = svg.querySelector('#chart-now');
  const dot = svg.querySelector('#chart-now-dot');
  if (line) { line.setAttribute('x1', x); line.setAttribute('x2', x); }
  if (dot) { dot.setAttribute('cx', x); dot.setAttribute('cy', y); }
}

function drawBands(svg, t, dayStart, dayEnd) {
  const bands = [];
  // Astronomical (full): everywhere where sun < -18
  // Nautical: sun -18..-12
  // Civil: -12..-6
  // Day: above -0.833 (handled by sunrise/sunset which differ but keep simple)

  // Time → x helper
  const tx = (d) => ((d.getTime() - dayStart) / 86400000) * W;

  // Layer dark base behind everything
  svg.appendChild(el('rect', {
    x: 0, y: 0, width: W, height: H,
    fill: 'rgba(8, 12, 28, 0.55)',
  }));

  // Civil twilight band (between civilDawn..sunrise and sunset..civilDusk)
  if (t.civilDawn && t.sunrise) {
    bands.push(['rgba(38,64,110,0.35)', tx(t.civilDawn), tx(t.sunrise)]);
  }
  if (t.sunset && t.civilDusk) {
    bands.push(['rgba(38,64,110,0.35)', tx(t.sunset), tx(t.civilDusk)]);
  }

  // Day region (sunrise..sunset): subtle warm wash
  if (t.sunrise && t.sunset) {
    bands.push(['rgba(255, 184, 69, 0.05)', tx(t.sunrise), tx(t.sunset)]);
  }

  // Golden hour highlights
  if (t.sunrise && t.goldenHourMorningEnd) {
    bands.push(['rgba(255, 184, 69, 0.18)', tx(t.sunrise), tx(t.goldenHourMorningEnd)]);
  }
  if (t.goldenHourEveningStart && t.sunset) {
    bands.push(['rgba(255, 184, 69, 0.18)', tx(t.goldenHourEveningStart), tx(t.sunset)]);
  }

  for (const [color, x1, x2] of bands) {
    if (!Number.isFinite(x1) || !Number.isFinite(x2) || x2 <= x1) continue;
    svg.appendChild(el('rect', {
      x: Math.max(0, x1), y: 0,
      width: Math.min(W, x2) - Math.max(0, x1), height: H,
      fill: color,
    }));
  }
}

function addEventMarker(svg, dayStart, eventDate, color, label) {
  const x = ((eventDate.getTime() - dayStart) / 86400000) * W;
  svg.appendChild(el('line', {
    x1: x, x2: x, y1: altToY(0) - 4, y2: altToY(0) + 4,
    stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round',
  }));
}

function altToY(altDeg) {
  const norm = (altDeg - ALT_MIN) / (ALT_MAX - ALT_MIN);
  return PAD_TOP + (1 - norm) * (H - PAD_TOP - PAD_BOT);
}

function el(tag, attrs) {
  const e = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
