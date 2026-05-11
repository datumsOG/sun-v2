// Horizon panorama canvas — the sun/moon arc as seen from the observer.
// Azimuth 0–360° across X (N on left), altitude –6° to 82° up Y.
// Rendered each redraw(); reads live data directly from sun-path.js.

import { getArcSamples, getLiveBodyAnchor } from '../layers/sun-path.js';

const ALT_MIN = -6;
const ALT_MAX = 82;
const ML = 38, MR = 14, MT = 40, MB = 56;  // plot margins in CSS pixels

let _el = null;
let _canvas = null;
let _ctx = null;
export let visible = false;

// Stable star field — seeded so it never flickers on re-render.
const STARS = (() => {
  let s = 0xdeadbeef | 0;
  const rng = () => { s = Math.imul(s, 1664525) + 1013904223 | 0; return (s >>> 0) / 0xffffffff; };
  const out = [];
  for (let i = 0; i < 200; i++) {
    out.push({ af: rng(), hf: rng(), sz: 0.4 + rng() * 1.3, op: 0.15 + rng() * 0.55 });
  }
  return out;
})();

export function initSkyView() {
  _el = document.createElement('div');
  _el.id = 'sky-view';
  document.body.appendChild(_el);
  _canvas = document.createElement('canvas');
  _el.appendChild(_canvas);
  _ctx = _canvas.getContext('2d');
}

export function showSkyView() {
  visible = true;
  if (_el) _el.style.display = '';
}

export function hideSkyView() {
  visible = false;
  if (_el) _el.style.display = 'none';
}

export function renderSkyView(moonMode) {
  if (!visible || !_canvas || !_ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth, H = window.innerHeight;
  const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
  if (_canvas.width !== cw || _canvas.height !== ch) {
    _canvas.width = cw; _canvas.height = ch;
  }

  const ctx = _ctx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const pw = W - ML - MR;
  const ph = H - MT - MB;
  const ax  = (az)  => ML + (az  / 360)                                 * pw;
  const ay  = (alt) => MT + ph * (1 - (alt - ALT_MIN) / (ALT_MAX - ALT_MIN));
  const horizY = ay(0);

  // ── Backgrounds ────────────────────────────────────────────────────────
  // Sky
  const skyG = ctx.createLinearGradient(0, MT, 0, horizY);
  if (moonMode) {
    skyG.addColorStop(0, '#010208'); skyG.addColorStop(0.65, '#030b16'); skyG.addColorStop(1, '#0a1a32');
  } else {
    skyG.addColorStop(0, '#010208'); skyG.addColorStop(0.65, '#060810'); skyG.addColorStop(1, '#1e0d04');
  }
  ctx.fillStyle = skyG;
  ctx.fillRect(ML, MT, pw, horizY - MT);

  // Ground
  const gndG = ctx.createLinearGradient(0, horizY, 0, H);
  gndG.addColorStop(0, '#12161c'); gndG.addColorStop(1, '#080b0e');
  ctx.fillStyle = gndG;
  ctx.fillRect(ML, horizY, pw, H - horizY);

  // Margin gutters
  ctx.fillStyle = '#0b0e14';
  ctx.fillRect(0, 0, ML, H); ctx.fillRect(W - MR, 0, MR, H);
  ctx.fillRect(0, 0, W, MT); ctx.fillRect(0, H - MB, W, MB);

  // ── Stars ───────────────────────────────────────────────────────────────
  for (const st of STARS) {
    const x = ML + st.af * pw;
    const y = MT + st.hf * (horizY - MT) * 0.88;
    ctx.beginPath();
    ctx.arc(x, y, st.sz, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(215,225,255,${st.op})`;
    ctx.fill();
  }

  // ── Altitude grid ────────────────────────────────────────────────────────
  ctx.font = '10px Inter,system-ui,sans-serif';
  ctx.textAlign = 'right';
  for (let alt = 15; alt < ALT_MAX; alt += 15) {
    const y = ay(alt);
    ctx.strokeStyle = 'rgba(255,255,255,0.055)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ML, y); ctx.lineTo(W - MR, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillText(alt + '°', ML - 5, y + 4);
  }

  // ── Horizon line ─────────────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(ML, horizY); ctx.lineTo(W - MR, horizY); ctx.stroke();

  // ── Cardinal ticks & labels ───────────────────────────────────────────────
  const CARDS = [[0,'N'],[45,'NE'],[90,'E'],[135,'SE'],[180,'S'],[225,'SW'],[270,'W'],[315,'NW'],[360,'N']];
  for (const [az, lbl] of CARDS) {
    const x = ax(az), major = az % 90 === 0;
    ctx.strokeStyle = major ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.11)';
    ctx.lineWidth = major ? 1.5 : 1;
    ctx.beginPath(); ctx.moveTo(x, horizY - 4); ctx.lineTo(x, horizY + 8); ctx.stroke();
    ctx.fillStyle   = major ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.28)';
    ctx.font        = major ? 'bold 12px Inter,system-ui,sans-serif' : '10px Inter,system-ui,sans-serif';
    ctx.textAlign   = 'center';
    ctx.fillText(lbl, x, horizY + 22);
  }
  // Degree ticks between cardinals (every 30°)
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.font = '9px Inter,system-ui,sans-serif';
  for (let az = 30; az < 360; az += 30) {
    if (az % 45 === 0) continue;
    ctx.textAlign = 'center';
    ctx.fillText(az + '°', ax(az), horizY + 22);
  }

  // ── Arc ──────────────────────────────────────────────────────────────────
  const samples = getArcSamples();
  const arcColor = moonMode ? '#d0d8e8' : '#ffb845';
  if (samples.length > 1) {
    // Wide glow
    ctx.save();
    ctx.shadowColor = arcColor; ctx.shadowBlur = 14;
    ctx.strokeStyle = arcColor + '44'; ctx.lineWidth = 6; ctx.lineJoin = 'round';
    _drawArc(ctx, samples, ax, ay);
    ctx.restore();
    // Core line
    ctx.save();
    ctx.shadowColor = arcColor; ctx.shadowBlur = 5;
    ctx.strokeStyle = arcColor + 'dd'; ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
    _drawArc(ctx, samples, ax, ay);
    ctx.restore();
  }

  // ── Live body dot ─────────────────────────────────────────────────────────
  const live = getLiveBodyAnchor();
  if (live) {
    const x = ax(live.azDeg), y = ay(live.altDeg);
    const col = moonMode ? '#d0d8e8' : '#ffb845', inner = moonMode ? '#f0f3fa' : '#fff1c2';

    // Dashed drop line to horizon
    if (live.altDeg > 1 && y < horizY - 16) {
      ctx.strokeStyle = col + '38'; ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, y + 13); ctx.lineTo(x, horizY); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Radial glow halo
    const halo = ctx.createRadialGradient(x, y, 5, x, y, 26);
    halo.addColorStop(0, col + '50'); halo.addColorStop(1, col + '00');
    ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI * 2);
    ctx.fillStyle = halo; ctx.fill();

    // Core
    ctx.save();
    ctx.shadowColor = col; ctx.shadowBlur = 22;
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fillStyle = inner; ctx.fill();
    ctx.restore();

    // Alt readout (next to dot)
    const above = live.altDeg >= 0;
    ctx.font = 'bold 12px Inter,system-ui,sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.textAlign = 'left';
    ctx.fillText((above ? '↑' : '↓') + Math.abs(live.altDeg).toFixed(1) + '°', x + 14, y + 5);

    // Azimuth tick on horizon
    if (Math.abs(y - horizY) > 20) {
      ctx.fillStyle = col;
      ctx.font = 'bold 11px Inter,system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(Math.round(live.azDeg) + '°', x, horizY + 36);
      ctx.strokeStyle = col + 'aa'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, horizY + 2); ctx.lineTo(x, horizY + 10); ctx.stroke();
    }
  }
}

function _drawArc(ctx, samples, ax, ay) {
  ctx.beginPath();
  let pen = false, lastAz = null;
  for (const s of samples) {
    const x = ax(s.azDeg), y = ay(s.altDeg);
    // Lift pen when azimuth wraps (crosses 0°/360° boundary)
    if (!pen || (lastAz !== null && Math.abs(s.azDeg - lastAz) > 180)) {
      ctx.moveTo(x, y); pen = true;
    } else {
      ctx.lineTo(x, y);
    }
    lastAz = s.azDeg;
  }
  ctx.stroke();
}
