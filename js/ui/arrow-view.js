// Camera view: rear-camera feed + AR overlay positioning the sun or moon.
// No 3D arrow scene any more — only the live camera + DOM-based body disk
// + an off-screen guide arrow.
//
// AR drift fix: orientation is consumed via a per-frame quaternion built
// from the smoothed Euler stream; we transform a world-frame body vector
// into the device frame, then project onto the camera plane. A small
// dead-band around the projection center reduces high-frequency jitter
// without freezing the body when you actually move.

import { getPosition, getMoonPos, getMoonIllumination } from '../solar.js';
import { getArcSamples } from '../layers/sun-path.js';
import { getShadowHeight } from '../layers/shadow.js';

// ── Orientation matrix math ──
const id3 = () => [[1,0,0],[0,1,0],[0,0,1]];
const T3 = m => [[m[0][0],m[1][0],m[2][0]],[m[0][1],m[1][1],m[2][1]],[m[0][2],m[1][2],m[2][2]]];
const mv3 = (m,v) => [
  m[0][0]*v[0]+m[0][1]*v[1]+m[0][2]*v[2],
  m[1][0]*v[0]+m[1][1]*v[1]+m[1][2]*v[2],
  m[2][0]*v[0]+m[2][1]*v[1]+m[2][2]*v[2],
];
const mm3 = (a,b) => {
  const r=[[0,0,0],[0,0,0],[0,0,0]];
  for(let i=0;i<3;i++) for(let j=0;j<3;j++)
    r[i][j]=a[i][0]*b[0][j]+a[i][1]*b[1][j]+a[i][2]*b[2][j];
  return r;
};
const Rz = t => { const c=Math.cos(t),s=Math.sin(t); return [[c,-s,0],[s,c,0],[0,0,1]]; };
const Rx = t => { const c=Math.cos(t),s=Math.sin(t); return [[1,0,0],[0,c,-s],[0,s,c]]; };
const Ry = t => { const c=Math.cos(t),s=Math.sin(t); return [[c,0,s],[0,1,0],[-s,0,c]]; };

let R = id3();
let headingSmoothed = null;
let pitchSmoothed = null;
let rollSmoothed = null;
let sensorsAttached = false;
let cameraOn = false;
let videoStream = null;
let visible = false;
let animId = null;
let datetime = new Date();
let observer = { lat: 43.6532, lon: -79.3832 };
let moonMode = false;

let calibrationOffset = 0;
const HEADING_SMOOTHING = 0.10;
const TILT_SMOOTHING = 0.15;
const HEADING_SPIKE = 30;
const HALF_HFOV_TAN = Math.tan(34 * Math.PI / 180);

let elView, elVideo, elGuide, elDisk, elDiskShadow;
let elSensorBtn, elCalibrate, elCapture, elArBtn, elArOverlay;
let arEnabled = false;
let arDots = [];
let elArCaster = null, elArObs = null, elArShadowEnd = null, arSvg = null, arShadowLine = null, arPoleLine = null;
const EYE_HEIGHT_M = 1.6;

export function initCameraView() {
  elView      = document.getElementById('camera-view');
  elVideo     = document.getElementById('cam-video');
  elGuide     = document.getElementById('guide-arrow');
  elDisk      = document.getElementById('body-disk');
  elDiskShadow = document.getElementById('body-disk-shadow');
  elSensorBtn = document.getElementById('cam-sensor-btn'); // may be null if removed from UI
  elCalibrate = document.getElementById('cam-calibrate');
  elCapture   = document.getElementById('cam-capture');
  elArBtn     = document.getElementById('cam-ar-btn');
  elArOverlay = document.getElementById('ar-overlay');

  if (elArBtn) {
    elArBtn.addEventListener('click', () => {
      enableSensors();
      arEnabled = !arEnabled;
      elArBtn.textContent = 'AR ' + (arEnabled ? 'on' : 'off');
      if (elArOverlay) elArOverlay.hidden = !arEnabled;
      if (!arEnabled) clearArDots();
    });
  }

  // Build AR overlay extras: caster, observer dot, shadow-end dot, line SVG
  if (elArOverlay) {
    elArCaster = document.createElement('div');
    elArCaster.className = 'ar-caster';
    elArCaster.style.display = 'none';
    elArOverlay.appendChild(elArCaster);

    elArObs = document.createElement('div');
    elArObs.style.cssText = 'position:absolute;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 0 4px rgba(0,0,0,0.6);transform:translate(-50%,-50%);pointer-events:none;display:none;';
    elArOverlay.appendChild(elArObs);

    elArShadowEnd = document.createElement('div');
    elArShadowEnd.className = 'shadow-end';
    elArShadowEnd.style.cssText += 'position:absolute;transform:translate(-50%,-50%);display:none;';
    elArOverlay.appendChild(elArShadowEnd);

    arSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arSvg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;');
    arShadowLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    arShadowLine.setAttribute('fill', 'none');
    arShadowLine.setAttribute('stroke-width', '3');
    arShadowLine.setAttribute('stroke-linecap', 'round');
    arShadowLine.setAttribute('stroke-linejoin', 'round');
    arShadowLine.setAttribute('opacity', '0');
    arSvg.appendChild(arShadowLine);

    // Blue vertical pole: caster sphere → observer ground (or screen bottom when ground is off-screen)
    arPoleLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    arPoleLine.setAttribute('stroke', '#4dd2ff');
    arPoleLine.setAttribute('stroke-width', '2');
    arPoleLine.setAttribute('stroke-linecap', 'round');
    arPoleLine.setAttribute('opacity', '0');
    arSvg.appendChild(arPoleLine);

    elArOverlay.appendChild(arSvg);
  }

  if (elSensorBtn) elSensorBtn.addEventListener('click', enableSensors);
  elCalibrate.addEventListener('click', calibrate);
  elCapture.addEventListener('click', captureFrame);
}

export function showCameraView() {
  visible = true;
  elView.hidden = false;
  startCamera();
  // Auto-request sensors on entering camera view (we're already inside a user
  // gesture from the view toggle, so iOS will accept the permission prompt).
  enableSensors();
  if (!animId) animId = requestAnimationFrame(tick);
}

export function hideCameraView() {
  visible = false;
  elView.hidden = true;
  stopCamera();
  if (animId) { cancelAnimationFrame(animId); animId = null; }
}

export function updateCameraView(newDatetime, newObserver, newMoonMode = false) {
  datetime = newDatetime;
  observer = newObserver;
  moonMode = newMoonMode;
}

async function startCamera() {
  if (cameraOn) return;
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }, audio: false,
    });
    elVideo.srcObject = videoStream;
    await elVideo.play().catch(() => {});
    cameraOn = true;
  } catch (e) {
    console.error('Camera error:', e);
  }
}

function stopCamera() {
  if (videoStream) { videoStream.getTracks().forEach(t => t.stop()); videoStream = null; }
  elVideo.srcObject = null;
  cameraOn = false;
}

async function enableSensors() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') { if (elSensorBtn) elSensorBtn.textContent = 'Permission denied'; return; }
    }
    if (!sensorsAttached) {
      window.addEventListener('deviceorientationabsolute', onOrient, true);
      window.addEventListener('deviceorientation', onOrient, true);
      sensorsAttached = true;
    }
    if (elSensorBtn) elSensorBtn.hidden = true;
    elCalibrate.hidden = false;
    elCapture.hidden = false;
  } catch {
    if (elSensorBtn) elSensorBtn.textContent = 'Sensors unavailable';
  }
}

function onOrient(e) {
  let heading = null;
  if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) {
    heading = e.webkitCompassHeading;
  } else if (typeof e.alpha === 'number') {
    heading = (360 - e.alpha) % 360;
  }
  if (heading == null || typeof e.beta !== 'number' || typeof e.gamma !== 'number') return;

  const so = (screen.orientation && screen.orientation.angle) || 0;
  heading = (heading + so) % 360;

  if (headingSmoothed == null) {
    headingSmoothed = heading;
  } else {
    const d = ((heading - headingSmoothed + 540) % 360) - 180;
    if (Math.abs(d) > HEADING_SPIKE) return;
    headingSmoothed = (headingSmoothed + d * HEADING_SMOOTHING + 360) % 360;
  }

  if (pitchSmoothed == null) pitchSmoothed = e.beta;
  else pitchSmoothed += (e.beta - pitchSmoothed) * TILT_SMOOTHING;

  if (rollSmoothed == null) rollSmoothed = e.gamma;
  else rollSmoothed += (e.gamma - rollSmoothed) * TILT_SMOOTHING;

  const alpha = (360 - headingSmoothed) * Math.PI / 180;
  const beta  = pitchSmoothed * Math.PI / 180;
  const gamma = rollSmoothed * Math.PI / 180;

  let Rm = mm3(Rz(alpha), mm3(Rx(beta), Ry(gamma)));
  if (so) Rm = mm3(Rm, Rz(-so * Math.PI / 180));
  R = Rm;
}

function tick() {
  if (!visible) return;
  animId = requestAnimationFrame(tick);

  const body = moonMode
    ? getMoonPos(datetime, observer.lat, observer.lon)
    : getPosition(datetime, observer.lat, observer.lon);

  const calibAz = ((body.azimuthDeg + calibrationOffset) % 360) * Math.PI / 180;
  const el = body.altitudeDeg * Math.PI / 180;

  const bodyWorld = [
    Math.cos(el) * Math.sin(calibAz),
    Math.cos(el) * Math.cos(calibAz),
    Math.sin(el),
  ];

  const v = mv3(T3(R), bodyWorld);
  const below = body.altitudeDeg < -1;

  // Project onto camera image plane.
  // Sun/moon stays visible regardless of where it falls — we let the browser
  // clip naturally so the disk doesn't pop when half-off-screen.
  const W = window.innerWidth, H = window.innerHeight;
  const halfVfovTan = HALF_HFOV_TAN * (H / W);
  const depth = -v[2]; // > 0 when body is in front of rear camera
  let inFront = depth > 0.01;
  let sx = W/2, sy = H/2, guideAngle = 0;

  if (inFront) {
    const ndcX = (v[0] / depth) / HALF_HFOV_TAN;
    const ndcY = (v[1] / depth) / halfVfovTan;
    sx = (ndcX + 1) / 2 * W;
    sy = (1 - ndcY) / 2 * H;
    guideAngle = Math.atan2(v[0] / depth, v[1] / depth);
  } else {
    guideAngle = Math.atan2(v[0], v[1]);
  }

  if (inFront && !below) {
    elDisk.hidden = false;
    elDisk.style.left = sx + 'px';
    elDisk.style.top = sy + 'px';
    elGuide.style.opacity = '0';
    if (moonMode) updateMoonShadow();
  } else {
    elDisk.hidden = true;
    elGuide.style.opacity = '1';
    elGuide.style.transform = `translate(-50%, -50%) rotate(${guideAngle * 180 / Math.PI}deg)`;
  }

  if (arEnabled) renderAR(W, H, halfVfovTan);
}

// ─── Experimental AR overlay: render the sun/moon arc as dots in the sky ───
function clearArDots() {
  for (const d of arDots) d.remove();
  arDots = [];
}
// Project a unit-direction vector (infinite distance) into screen space.
function projectUnit(world, W, H, halfVfovTan) {
  const v = mv3(T3(R), world);
  const depth = -v[2];
  if (depth <= 0.01) return null;
  const ndcX = (v[0] / depth) / HALF_HFOV_TAN;
  const ndcY = (v[1] / depth) / halfVfovTan;
  return { x: (ndcX + 1) / 2 * W, y: (1 - ndcY) / 2 * H };
}

// Project a finite-distance point in metres (ENU). Returns {x, y, dist}.
function projectPoint(worldM, W, H, halfVfovTan) {
  const v = mv3(T3(R), worldM);
  const depth = -v[2];
  if (depth <= 0.01) return null;
  const ndcX = (v[0] / depth) / HALF_HFOV_TAN;
  const ndcY = (v[1] / depth) / halfVfovTan;
  const dist = Math.hypot(v[0], v[1], v[2]);
  return { x: (ndcX + 1) / 2 * W, y: (1 - ndcY) / 2 * H, dist };
}

// Extend the ray from p1 through p2, continuing from p2 until it hits a screen edge.
function extendRayToScreenEdge(p1, p2, W, H) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  if (Math.hypot(dx, dy) < 0.01) return null;
  let t = Infinity;
  if (Math.abs(dy) > 0.01) {
    const ty = dy > 0 ? (H - p2.y) / dy : -p2.y / dy;
    if (ty > 0) t = Math.min(t, ty);
  }
  if (Math.abs(dx) > 0.01) {
    const tx = dx > 0 ? (W - p2.x) / dx : -p2.x / dx;
    if (tx > 0) t = Math.min(t, tx);
  }
  if (!isFinite(t) || t <= 0) return null;
  return { x: Math.round(p2.x + t * dx), y: Math.round(p2.y + t * dy) };
}

function renderAR(W, H, halfVfovTan) {
  if (!elArOverlay) return;
  const colour = moonMode ? '#d0d8e8' : '#ffb845';

  // ---- Arc dots (infinite distance, unit vectors) ----
  const samples = getArcSamples();
  while (arDots.length < samples.length) {
    const d = document.createElement('div');
    d.className = 'ar-dot';
    elArOverlay.appendChild(d);
    arDots.push(d);
  }
  while (arDots.length > samples.length) arDots.pop().remove();

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const az = ((s.azDeg + calibrationOffset) % 360) * Math.PI / 180;
    const el = s.altDeg * Math.PI / 180;
    const world = [
      Math.cos(el) * Math.sin(az),
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
    ];
    const p = projectUnit(world, W, H, halfVfovTan);
    const dot = arDots[i];
    if (p) { dot.style.left = p.x + 'px'; dot.style.top = p.y + 'px'; dot.style.display = ''; }
    else dot.style.display = 'none';
  }

  // ---- Body position (live sun/moon) — used as the sky end of the shadow line ----
  const body = moonMode
    ? getMoonPos(datetime, observer.lat, observer.lon)
    : getPosition(datetime, observer.lat, observer.lon);
  const bAz = ((body.azimuthDeg + calibrationOffset) % 360) * Math.PI / 180;
  const bEl = body.altitudeDeg * Math.PI / 180;
  const bodyDir = [Math.cos(bEl)*Math.sin(bAz), Math.cos(bEl)*Math.cos(bAz), Math.sin(bEl)];
  const bodyScreen = projectUnit(bodyDir, W, H, halfVfovTan);

  // ---- Caster sphere (2 m diameter, at observer position, altitude H) ----
  const casterH = getShadowHeight();
  // World position relative to user's eyes (assumed at observer, eye height 1.6 m)
  const casterWorld = [0, 0, casterH - EYE_HEIGHT_M];
  const casterP = projectPoint(casterWorld, W, H, halfVfovTan);
  if (casterP) {
    // Pixel size: 2 m sphere → diameter ≈ (2/dist) * (W/2) / HALF_HFOV_TAN
    const px = Math.max(8, (2 / Math.max(0.5, casterP.dist)) * (W / 2) / HALF_HFOV_TAN);
    elArCaster.style.display = '';
    elArCaster.style.left = casterP.x + 'px';
    elArCaster.style.top  = casterP.y + 'px';
    elArCaster.style.width = px + 'px';
    elArCaster.style.height = px + 'px';
  } else {
    elArCaster.style.display = 'none';
  }

  // ---- White observer ground dot (at observer's feet) ----
  const obsWorld = [0, 0, -EYE_HEIGHT_M];
  const obsP = projectPoint(obsWorld, W, H, halfVfovTan);
  if (obsP) {
    elArObs.style.display = '';
    elArObs.style.left = obsP.x + 'px';
    elArObs.style.top  = obsP.y + 'px';
  } else {
    elArObs.style.display = 'none';
  }

  // ---- Shadow ground end (in opposite-azimuth direction, at distance casterH/tan(el)) ----
  let endP = null;
  if (body.altitudeDeg > 0.5) {
    const tanEl = Math.tan(bEl);
    const dist = Math.min(casterH / tanEl, 4000); // metres, cap 4 km
    const shadowAz = (body.azimuthDeg + calibrationOffset + 180) % 360;
    const shAzRad = shadowAz * Math.PI / 180;
    const endWorld = [dist * Math.sin(shAzRad), dist * Math.cos(shAzRad), -EYE_HEIGHT_M];
    endP = projectPoint(endWorld, W, H, halfVfovTan);
    if (endP) {
      elArShadowEnd.style.display = '';
      elArShadowEnd.style.left = endP.x + 'px';
      elArShadowEnd.style.top  = endP.y + 'px';
      elArShadowEnd.style.background = colour;
    } else {
      elArShadowEnd.style.display = 'none';
    }
  } else {
    elArShadowEnd.style.display = 'none';
  }

  // ---- Shadow line: body → caster → shadow end (or screen edge when ground is off-screen) ----
  // When endP is null (ground behind camera), extend the ray to the nearest screen edge so
  // the shadow direction remains visible even when the camera is pointing at the sky.
  let effectiveEndP = endP;
  if (!effectiveEndP && bodyScreen && casterP) {
    effectiveEndP = extendRayToScreenEdge(bodyScreen, casterP, W, H);
    // Show shadow-end indicator at screen edge to mark the shadow direction
    if (effectiveEndP) {
      elArShadowEnd.style.display = '';
      elArShadowEnd.style.left = effectiveEndP.x + 'px';
      elArShadowEnd.style.top  = effectiveEndP.y + 'px';
      elArShadowEnd.style.background = colour;
    }
  }

  if (bodyScreen && casterP) {
    const pts = effectiveEndP
      ? `${bodyScreen.x},${bodyScreen.y} ${casterP.x},${casterP.y} ${effectiveEndP.x},${effectiveEndP.y}`
      : `${bodyScreen.x},${bodyScreen.y} ${casterP.x},${casterP.y}`;
    arShadowLine.setAttribute('points', pts);
    arShadowLine.setAttribute('stroke', colour);
    arShadowLine.setAttribute('opacity', '0.95');
  } else {
    arShadowLine.setAttribute('opacity', '0');
  }

  // ---- Blue pole: caster sphere → observer ground (or screen bottom) ----
  if (casterP) {
    const poleEndY = obsP ? obsP.y : H;
    const poleEndX = obsP ? obsP.x : casterP.x;
    arPoleLine.setAttribute('x1', casterP.x);
    arPoleLine.setAttribute('y1', casterP.y);
    arPoleLine.setAttribute('x2', poleEndX);
    arPoleLine.setAttribute('y2', poleEndY);
    arPoleLine.setAttribute('opacity', '0.85');
  } else {
    arPoleLine.setAttribute('opacity', '0');
  }
}

function updateMoonShadow() {
  if (!elDiskShadow) return;
  const illum = getMoonIllumination(datetime);
  const p = illum.phase;
  let clip;
  if (p < 0.25) {
    const k = (0.25 - p) / 0.25;
    clip = `inset(0 0 0 ${50 - 50*k}%)`;
  } else if (p < 0.5) {
    const k = (0.5 - p) / 0.25;
    clip = `inset(0 ${100 - 50*k}% 0 0)`;
  } else if (p < 0.75) {
    const k = (p - 0.5) / 0.25;
    clip = `inset(0 0 0 ${100 - 50*k}%)`;
  } else {
    const k = (p - 0.75) / 0.25;
    clip = `inset(0 ${50 - 50*k}% 0 0)`;
  }
  elDiskShadow.style.clipPath = clip;
}

function calibrate() {
  const body = moonMode
    ? getMoonPos(datetime, observer.lat, observer.lon)
    : getPosition(datetime, observer.lat, observer.lon);
  const currentHeading = headingSmoothed || 0;
  calibrationOffset = (body.azimuthDeg - currentHeading + 360) % 360;
  elCalibrate.textContent = 'Aligned ✓';
  setTimeout(() => { elCalibrate.textContent = 'Align'; }, 1500);
}

function captureFrame() {
  try {
    const W = window.innerWidth, H = window.innerHeight;
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d');
    if (cameraOn && elVideo) ctx.drawImage(elVideo, 0, 0, W, H);

    const body = moonMode
      ? getMoonPos(datetime, observer.lat, observer.lon)
      : getPosition(datetime, observer.lat, observer.lon);

    const lines = [
      datetime.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      `${observer.lat.toFixed(5)}, ${observer.lon.toFixed(5)}`,
      `Az ${body.azimuthDeg.toFixed(1)}°  El ${body.altitudeDeg.toFixed(1)}°`,
      moonMode ? 'Moon' : 'Sun',
    ];

    ctx.font = 'bold 15px -apple-system, system-ui, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 6;
    const pad = 18, lineH = 22;
    const boxH = lines.length * lineH + pad;
    ctx.fillStyle = 'rgba(11,14,20,0.6)';
    ctx.fillRect(pad - 8, H - boxH - pad, W - pad * 2, boxH);
    ctx.fillStyle = '#f3f4f6';
    lines.forEach((l, i) => ctx.fillText(l, pad, H - boxH - pad + pad / 2 + (i + 1) * lineH));

    const link = document.createElement('a');
    link.download = `sunlight-${Date.now()}.png`;
    link.href = out.toDataURL('image/png');
    link.click();
  } catch (e) {
    console.error('Capture failed:', e);
  }
}
