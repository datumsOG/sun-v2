// Sun arrow view: 3D arrow (Three.js) + optional AR camera mode.
// In 3D mode: big 3D arrow points at the sun using device orientation.
// In AR mode: rear camera feed as background, sun projected as AR overlay,
//             small 2D guide arrow fades in/out as sun enters/leaves frame.

import * as THREE from 'three';
import { getPosition, getMoonPos, getMoonIllumination } from '../solar.js';

// ───── Orientation matrix math (same convention as arrow.html) ─────
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

// ───── Module state ─────
let R = id3();                   // device→world rotation matrix
let headingSmoothed = null;
let sensorsAttached = false;
let arMode = false;
let videoStream = null;
let visible = false;
let animId = null;
let datetime = new Date();
let observer = { lat: 43.6532, lon: -79.3832 };
let moonMode = false;

// AR stability: calibration offset applied to heading
let calibrationOffset = 0;
const HEADING_SMOOTHING = 0.15;  // lower = more stable (was 0.25)
const HEADING_SPIKE = 40;        // degrees — discard orientation jumps above this

// ───── DOM refs ─────
let elView, elCanvas, elVideo, elGuide, elSunDisk;
let elSensorBtn, elCamBtn, elAzVal, elElVal, elHudStats;
let elCaptureBtn, elCalibrateBtn;

// ───── Three.js objects ─────
let renderer, scene, cam3;
let arrowPivot, arrowGroup, sunMesh;
let goldMat, cyanMat, moonMat, sunMat3;
const tgtQ = new THREE.Quaternion();
const xAxis = new THREE.Vector3(1, 0, 0);

// Rear camera approximate half-FOV tangent (assuming ~68° horizontal FOV)
const HALF_HFOV_TAN = Math.tan(34 * Math.PI / 180);

// ───── Public API ─────

export function initArrowView() {
  elView        = document.getElementById('arrow-view');
  elCanvas      = document.getElementById('arrow-canvas');
  elVideo       = document.getElementById('arrow-video');
  elGuide       = document.getElementById('guide-arrow');
  elSunDisk     = document.getElementById('sun-disk');
  elSensorBtn   = document.getElementById('arrow-sensor-btn');
  elCamBtn      = document.getElementById('arrow-cam-btn');
  elAzVal       = document.getElementById('arrow-az-val');
  elElVal       = document.getElementById('arrow-el-val');
  elHudStats    = document.getElementById('arrow-hud-stats');
  elCaptureBtn  = document.getElementById('arrow-capture-btn');
  elCalibrateBtn = document.getElementById('arrow-calibrate-btn');

  buildThreeScene();

  elSensorBtn.addEventListener('click', enableSensors);
  elCamBtn.addEventListener('click', toggleCamera);
  if (elCaptureBtn)    elCaptureBtn.addEventListener('click', captureFrame);
  if (elCalibrateBtn)  elCalibrateBtn.addEventListener('click', calibrate);

  window.addEventListener('resize', onResize);
}

export function showArrowView() {
  visible = true;
  elView.hidden = false;
  if (!animId) animId = requestAnimationFrame(tick);
}

export function hideArrowView() {
  visible = false;
  elView.hidden = true;
  if (arMode) stopCamera();
  if (animId) { cancelAnimationFrame(animId); animId = null; }
}

export function updateArrowView(newDatetime, newObserver, newMoonMode = false) {
  datetime = newDatetime;
  observer = newObserver;
  moonMode = newMoonMode;
}

// ───── Sensor setup ─────

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
    elHudStats.hidden = false;
    elCamBtn.hidden = false;
    if (elCaptureBtn)   elCaptureBtn.hidden = false;
    if (elCalibrateBtn) elCalibrateBtn.hidden = false;
  } catch (e) {
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
    if (Math.abs(d) > HEADING_SPIKE) return; // discard spike
    headingSmoothed = (headingSmoothed + d * HEADING_SMOOTHING + 360) % 360;
  }

  const alpha = (360 - headingSmoothed) * Math.PI / 180;
  const beta  = e.beta  * Math.PI / 180;
  const gamma = e.gamma * Math.PI / 180;
  let Rm = mm3(Rz(alpha), mm3(Rx(beta), Ry(gamma)));
  if (so) Rm = mm3(Rm, Rz(-so * Math.PI / 180));
  R = Rm;
}

// ───── Camera toggle ─────

async function toggleCamera() {
  if (!arMode) {
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }, audio: false,
      });
      elVideo.srcObject = videoStream;
      await elVideo.play().catch(() => {});
      arMode = true;
      elCamBtn.textContent = '✕ Camera';
      elVideo.hidden = false;
      elCanvas.hidden = true;
    } catch (e) {
      console.error('Camera error:', e);
    }
  } else {
    stopCamera();
  }
}

function stopCamera() {
  if (videoStream) { videoStream.getTracks().forEach(t => t.stop()); videoStream = null; }
  elVideo.srcObject = null;
  arMode = false;
  elCamBtn.textContent = '📷 Camera';
  elVideo.hidden = true;
  elCanvas.hidden = false;
  elGuide.style.opacity = '0';
  elSunDisk.hidden = true;
}

// ───── Render loop ─────

function tick() {
  if (!visible) return;
  animId = requestAnimationFrame(tick);

  const body = moonMode
    ? getMoonPos(datetime, observer.lat, observer.lon)
    : getPosition(datetime, observer.lat, observer.lon);

  const az = body.azimuthDeg * Math.PI / 180;
  const el = body.altitudeDeg * Math.PI / 180;

  // Apply calibration offset
  const calibAz = ((body.azimuthDeg + calibrationOffset) % 360) * Math.PI / 180;

  // Body direction in ENU world frame (x=East, y=North, z=Up)
  const bodyWorld = [
    Math.cos(el) * Math.sin(calibAz),
    Math.cos(el) * Math.cos(calibAz),
    Math.sin(el),
  ];

  // Transform to device frame: x=right, y=toward phone top, z=out of screen
  const v = mv3(T3(R), bodyWorld);
  const below = body.altitudeDeg < -1;

  const icon = moonMode ? '🌙' : '☀';
  if (elAzVal) elAzVal.textContent = `${icon} ${body.azimuthDeg.toFixed(1)}°`;
  if (elElVal) elElVal.textContent = `${below ? '↓' : '↑'} ${Math.abs(body.altitudeDeg).toFixed(1)}°`;

  if (moonMode && !below) {
    const illum = getMoonIllumination(datetime);
    if (elHudStats && !elHudStats.hidden) {
      const phaseLabel = moonPhaseLabel(illum.phase);
      elHudStats.dataset.moonInfo = `${phaseLabel} · ${Math.round(illum.fraction * 100)}%`;
    }
  }

  if (!arMode) {
    render3D(v, below);
  } else {
    renderAR(v, below);
  }
}

function render3D(v, below) {
  const dir = new THREE.Vector3(v[0], v[1], v[2]).normalize();
  tgtQ.setFromUnitVectors(xAxis, dir);
  arrowPivot.quaternion.slerp(tgtQ, 0.35);

  sunMesh.position.set(v[0] * 4, v[1] * 4, v[2] * 4);
  sunMat3.emissiveIntensity = 1.4 + 0.3 * Math.sin(Date.now() / 600);

  const mat = below ? cyanMat : (moonMode ? moonMat : goldMat);
  arrowGroup.children.forEach(m => { if (m.isMesh && m.material !== mat) m.material = mat; });

  goldMat.emissiveIntensity = 0.35;
  elGuide.style.opacity = '0';
  elSunDisk.hidden = true;

  renderer.render(scene, cam3);
}

function renderAR(v, below) {
  const W = window.innerWidth, H = window.innerHeight;
  const halfVfovTan = HALF_HFOV_TAN * (H / W);

  // Rear camera faces -Z in device frame → sun in front when v[2] < 0
  const depth = -v[2]; // positive when sun is in front of rear camera

  let sunOnScreen = false;
  let screenX = W / 2, screenY = H / 2;
  let guideAngle = 0;

  if (depth > 0.01) {
    // Project sun onto camera image plane
    const ndcX =  (v[0] / depth) / HALF_HFOV_TAN;
    const ndcY =  (v[1] / depth) / halfVfovTan;

    sunOnScreen = Math.abs(ndcX) < 0.92 && Math.abs(ndcY) < 0.92;
    screenX = (ndcX + 1) / 2 * W;
    screenY = (1 - ndcY) / 2 * H;
    // Guide angle: point from screen center toward projected sun position
    guideAngle = Math.atan2(v[0] / depth, v[1] / depth);
  } else {
    // Sun is behind camera (facing screen). Point toward sun azimuth in horizontal plane.
    guideAngle = Math.atan2(v[0], v[1]);
  }

  // Sun disk: visible only when sun is on screen
  elSunDisk.hidden = !sunOnScreen;
  if (sunOnScreen) {
    elSunDisk.style.left = screenX + 'px';
    elSunDisk.style.top  = screenY + 'px';
  }

  // Guide arrow: visible when sun is NOT on screen; fades out when it is
  if (sunOnScreen) {
    elGuide.style.opacity = '0';
  } else {
    elGuide.style.opacity = '1';
    elGuide.style.transform = `translate(-50%, -50%) rotate(${guideAngle * 180 / Math.PI}deg)`;
  }
}

// ───── Three.js scene ─────

function buildThreeScene() {
  renderer = new THREE.WebGLRenderer({ canvas: elCanvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  cam3 = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  cam3.position.set(0, 0, 9);
  cam3.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xfff1c2, 0x1a1d28, 0.55));
  const kl = new THREE.DirectionalLight(0xffffff, 1.6); kl.position.set(3, 5, 4); scene.add(kl);
  const rl = new THREE.DirectionalLight(0x4dd2ff, 0.45); rl.position.set(-3,-2,-3); scene.add(rl);
  const fl = new THREE.DirectionalLight(0xff8a3d, 0.35); fl.position.set(-2, 0, 4); scene.add(fl);

  goldMat = new THREE.MeshStandardMaterial({ color: 0xffb845, metalness: 0.55, roughness: 0.32, emissive: 0x6e2b00, emissiveIntensity: 0.35 });
  cyanMat = new THREE.MeshStandardMaterial({ color: 0x4dd2ff, metalness: 0.4, roughness: 0.40, emissive: 0x0a4055, emissiveIntensity: 0.30, transparent: true, opacity: 0.62 });
  moonMat = new THREE.MeshStandardMaterial({ color: 0xd0d8e8, metalness: 0.2, roughness: 0.55, emissive: 0x1a2040, emissiveIntensity: 0.25 });
  sunMat3 = new THREE.MeshStandardMaterial({ color: 0xfff1c2, emissive: 0xffb845, emissiveIntensity: 1.6, metalness: 0, roughness: 0.3 });

  const SHAFT = 2.4, HEAD = 1.0;

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, SHAFT, 28), goldMat);
  shaft.rotation.z = -Math.PI / 2;
  shaft.position.x = SHAFT / 2;

  const head = new THREE.Mesh(new THREE.ConeGeometry(0.42, HEAD, 28), goldMat);
  head.rotation.z = -Math.PI / 2;
  head.position.x = SHAFT + HEAD / 2;

  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.20, 18, 14), goldMat);

  arrowGroup = new THREE.Group();
  arrowGroup.add(tail, shaft, head);
  arrowGroup.position.x = -(SHAFT + HEAD) / 2;

  arrowPivot = new THREE.Group();
  arrowPivot.add(arrowGroup);
  scene.add(arrowPivot);

  sunMesh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), sunMat3);
  scene.add(sunMesh);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.5, 2.55, 64),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, side: THREE.DoubleSide }),
  );
  ring.rotation.x = Math.PI / 2;
  scene.add(ring);
}

// ───── Capture ─────

function captureFrame() {
  try {
    const W = window.innerWidth, H = window.innerHeight;
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d');

    // Background: video or Three.js canvas
    if (arMode && elVideo && !elVideo.hidden) {
      ctx.drawImage(elVideo, 0, 0, W, H);
    } else {
      ctx.drawImage(elCanvas, 0, 0, W, H);
    }

    // Overlay text
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
    ctx.roundRect(pad - 8, H - boxH - pad, W - pad * 2, boxH, 10);
    ctx.fill();
    ctx.fillStyle = '#f3f4f6';
    lines.forEach((l, i) => ctx.fillText(l, pad, H - boxH - pad + pad / 2 + (i + 1) * lineH));

    // Trigger download
    const link = document.createElement('a');
    link.download = `sunlight-${Date.now()}.png`;
    link.href = out.toDataURL('image/png');
    link.click();
  } catch (e) {
    console.error('Capture failed:', e);
  }
}

// ───── Manual calibration ─────

function calibrate() {
  // Compute the difference between where the arrow is pointing and the true sun azimuth
  // User taps when the arrow visually aligns with the actual sun — this stores the correction
  const body = moonMode
    ? getMoonPos(datetime, observer.lat, observer.lon)
    : getPosition(datetime, observer.lat, observer.lon);
  const currentHeading = headingSmoothed || 0;
  calibrationOffset = (body.azimuthDeg - currentHeading + 360) % 360;
  if (elCalibrateBtn) {
    elCalibrateBtn.textContent = 'Aligned ✓';
    setTimeout(() => { elCalibrateBtn.textContent = 'Align'; }, 1500);
  }
}

// ───── Helpers ─────

function moonPhaseLabel(phase) {
  if (phase < 0.03 || phase > 0.97) return 'New';
  if (phase < 0.22) return 'Waxing crescent';
  if (phase < 0.28) return 'First quarter';
  if (phase < 0.47) return 'Waxing gibbous';
  if (phase < 0.53) return 'Full';
  if (phase < 0.72) return 'Waning gibbous';
  if (phase < 0.78) return 'Last quarter';
  return 'Waning crescent';
}

function onResize() {
  if (!renderer) return;
  cam3.aspect = window.innerWidth / window.innerHeight;
  cam3.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}
