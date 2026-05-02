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
let elSensorBtn, elCalibrate, elCapture;

export function initCameraView() {
  elView      = document.getElementById('camera-view');
  elVideo     = document.getElementById('cam-video');
  elGuide     = document.getElementById('guide-arrow');
  elDisk      = document.getElementById('body-disk');
  elDiskShadow = document.getElementById('body-disk-shadow');
  elSensorBtn = document.getElementById('cam-sensor-btn');
  elCalibrate = document.getElementById('cam-calibrate');
  elCapture   = document.getElementById('cam-capture');

  elSensorBtn.addEventListener('click', enableSensors);
  elCalibrate.addEventListener('click', calibrate);
  elCapture.addEventListener('click', captureFrame);
}

export function showCameraView() {
  visible = true;
  elView.hidden = false;
  startCamera();
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
      if (res !== 'granted') { elSensorBtn.textContent = 'Permission denied'; return; }
    }
    if (!sensorsAttached) {
      window.addEventListener('deviceorientationabsolute', onOrient, true);
      window.addEventListener('deviceorientation', onOrient, true);
      sensorsAttached = true;
    }
    elSensorBtn.hidden = true;
    elCalibrate.hidden = false;
    elCapture.hidden = false;
  } catch {
    elSensorBtn.textContent = 'Sensors unavailable';
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
