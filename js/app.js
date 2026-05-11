// Main wiring. Boots map, layers, UI; subscribes to state changes.

import * as store from './state.js';
import { initMap, whenStyleReady } from './map.js';
import { addObserverLayer, setObserver } from './layers/observer.js';
import { addSunPathLayer, updateSunPathDay, updateSunNow, setSunPathVisible, setRayLineVisible, setBodyColor, setArcRadiusKm, getArcSamples, getArcRadiusKm, setGridModeLines } from './layers/sun-path.js';
import { addReflectionLayer, updateReflectionDay, updateReflectionNow, updateReflectionWall, setReflectionVisible } from './layers/reflection.js';
import { addTargetLayer, setTarget } from './layers/target.js';
import { addShadowLayer, updateShadow, setShadowVisible, setShadowHeight, setFloorHeight, getShadowHeight, getFloorHeight, getShadowEndLngLat, getFloorDotLngLat } from './layers/shadow.js';
import { initScrubber, renderScrubberTicks, setMoonPhaseMarker, setScrubberRange } from './ui/scrubber.js';
import { initSearch } from './ui/search.js';
import { enableCompass, disableCompass } from './ui/sensor.js';
import { attachHashSync } from './share.js';
import { getPosition, getMoonPos, getMoonIllumination, getMoonTimes } from './solar.js';
import { findNextAlignment, findAlignmentBetweenPoints } from './alignment.js';
import { bearing, formatTime, formatDate, throttleRaf, startOfLocalDay, project3D } from './util.js';
import { initCameraView, showCameraView, hideCameraView, updateCameraView } from './ui/arrow-view.js';
import { checkAndNotify } from './reminders.js';
import { initMonitor, captureError } from './monitor.js';
import { initGrid, setGridEnabled, setGridObserver, setGridImperial } from './layers/grid.js';
import { initSkyView, showSkyView, hideSkyView, renderSkyView } from './ui/sky-view.js';

const $ = (id) => document.getElementById(id);

const dom = {
  map: $('map'),
  search: $('search'),
  searchResults: $('search-results'),
  scrubber: $('scrubber'),
  scrubberTicks: $('scrubber-ticks'),
  moonPhaseMarker: $('moon-phase-marker'),
  hh: $('time-hh'),
  dateBtn: $('date-btn'),
  dateLabel: $('date-label'),
  dateInput: $('date-input'),
  bodyToggle: $('body-toggle'),
  bodyIconSun: $('body-icon-sun'),
  bodyIconMoon: $('body-icon-moon'),
  sunAlt: $('sun-alt'),
  skyViewBtn: $('sky-view-btn'),
  locateBtn: $('locate-btn'),
  compassToggle: $('compass-toggle'),
  reflectionToggle: $('reflection-toggle'),
  dataBtn: $('data-btn'),
  alignWizardBtn: $('align-wizard-btn'),
  shadowElevPanel: $('shadow-elev-panel'),
  shadowElev: $('shadow-elev'),
  shadowElevVal: $('shadow-elev-val'),
  floorElev: $('floor-elev'),
  floorElevVal: $('floor-elev-val'),
  toast: $('toast'),
  tiltSlider: $('tilt-slider'),
  radiusSlider: $('radius-slider'),
  alignPanel: $('align-panel'),
  alignACoords: $('align-a-coords'),
  alignAHeight: $('align-a-height'),
  alignAConfirm: $('align-a-confirm'),
  alignBCoords: $('align-b-coords'),
  alignBHeight: $('align-b-height'),
  alignSearchBtn: $('align-search-btn'),
  alignClose: $('align-close'),
  alignStepA: $('align-step-a'),
  alignStepB: $('align-step-b'),
};

let map;
let lastDayKey = null;
let lastObserverKey = null;
let reflectionLine = null;

// Idle perspective drift — gentle bearing+pitch oscillation when map is static.
let _driftRafId = null;
let _driftBaseBearing = 0;
let _driftBasePitch = 55;
let _driftT0 = 0;
let _lastInteract = Date.now();
const DRIFT_IDLE_MS = 4000; // start after 4 s of no interaction

function _driftFrame(ts) {
  if (!map) { _driftRafId = null; return; }
  const s = store.get();
  if (s.view === 'camera' || s.compassEnabled) { _driftRafId = null; return; }
  const t = (ts - _driftT0) / 1000;
  const maxP = (map.getMaxPitch && map.getMaxPitch()) || 85;
  const bear = _driftBaseBearing + 2.0 * Math.sin(2 * Math.PI * t / 16);
  const pitch = Math.min(maxP, _driftBasePitch + 1.5 * Math.sin(2 * Math.PI * t / 22));
  try { map.setBearing(bear); } catch {}
  try { map.setPitch(pitch); } catch {}
  _driftRafId = requestAnimationFrame(_driftFrame);
}

function stopDrift() {
  if (_driftRafId) {
    cancelAnimationFrame(_driftRafId);
    _driftRafId = null;
    if (map) map.easeTo({ bearing: _driftBaseBearing, pitch: _driftBasePitch, duration: 600, easing: (t) => t < 0.5 ? 2*t*t : -1+(4-2*t)*t });
  }
  _lastInteract = Date.now();
}

// Sky view state
let _skyActive = false;

// Pause compass bearing/pitch updates while user is touching (panning/zooming)
// to prevent programmatic setBearing() from interrupting MapLibre's gesture handler.
let _touching = false;

// Grid mode state
let _gridActive = false;
let _gridImperial = localStorage.getItem('sun_grid_unit') === 'imperial';
let _savedRadiusSliderValue = null;
// Grid mode rescales shadow sliders to 0–10 m linear for human-scale work.
let _gridShadowMode = false;
let _savedShadowH = null;   // raw slider value before grid entry
let _savedFloorH  = null;

// After flyTo settles, rebuild day-level arc + live body so they reproject
// against the new zoom/centre. project3D depends on camera altitude, which
// changes drastically with zoom — without this, dots collapse to ground.
function _refreshLayers(map) {
  const cur = store.get();
  try {
    updateSunPathDay(map, cur.observer, cur.datetime, cur.mode === 'moon');
    updateSunNow(map, cur.observer, cur.datetime,
      cur.mode === 'moon' ? getMoonPos(cur.datetime, cur.observer.lat, cur.observer.lon) : null);
  } catch (e) { console.error('layer refresh failed', e); }
}

function _enterGrid(map, s) {
  _gridActive = true;
  stopDrift();
  setGridObserver(s.observer.lat, s.observer.lon);
  setGridImperial(_gridImperial);
  document.body.classList.add('grid-mode');
  setGridEnabled(true);
  setGridModeLines(true);

  // Rescale shadow sliders to 0–10 m linear for human-scale work.
  _gridShadowMode = true;
  if (dom.shadowElev) {
    _savedShadowH = dom.shadowElev.value;
    dom.shadowElev.max = '10'; dom.shadowElev.step = '0.1'; dom.shadowElev.value = '0';
    setShadowHeight(0);
    if (dom.shadowElevVal) dom.shadowElevVal.value = '0';
  }
  if (dom.floorElev) {
    _savedFloorH = dom.floorElev.value;
    dom.floorElev.max = '10'; dom.floorElev.step = '0.1'; dom.floorElev.value = '0';
    setFloorHeight(0);
    if (dom.floorElevVal) dom.floorElevVal.value = '0';
  }

  // Save current radius slider value; force a backyard-scale arc (10 m) so
  // all arc altitudes stay below camera altitude at the entry zoom.
  if (dom.radiusSlider) _savedRadiusSliderValue = dom.radiusSlider.value;
  setArcRadiusKm(0.01);

  map.flyTo({
    center: [s.observer.lon, s.observer.lat],
    zoom: 21, // ~21 m wide; camera ≈ 54 m AGL, well above 10 m arc apex
    pitch: map.getPitch(),
    bearing: map.getBearing(),
    duration: 1200,
  });
  map.once('moveend', () => { if (_gridActive) _refreshLayers(map); });
}

function _exitGrid(map) {
  _gridActive = false;
  document.body.classList.remove('grid-mode');
  setGridEnabled(false);
  setGridModeLines(false);

  // Restore shadow sliders to full 0–1000 m log-curve range.
  _gridShadowMode = false;
  if (dom.shadowElev) {
    dom.shadowElev.max = '1000'; dom.shadowElev.step = '1';
    if (_savedShadowH != null) {
      dom.shadowElev.value = _savedShadowH;
      const h = sliderToHeight(_savedShadowH);
      setShadowHeight(h);
      if (dom.shadowElevVal) dom.shadowElevVal.value = String(h);
    }
    _savedShadowH = null;
  }
  if (dom.floorElev) {
    dom.floorElev.max = '1000'; dom.floorElev.step = '1';
    if (_savedFloorH != null) {
      dom.floorElev.value = _savedFloorH;
      const h = sliderToHeight(_savedFloorH);
      setFloorHeight(h);
      if (dom.floorElevVal) dom.floorElevVal.value = String(h);
    }
    _savedFloorH = null;
  }

  // Restore the user's arc radius from their slider position.
  if (_savedRadiusSliderValue != null && dom.radiusSlider) {
    dom.radiusSlider.value = _savedRadiusSliderValue;
    setArcRadiusKm(sliderToRadiusKm(_savedRadiusSliderValue));
    _savedRadiusSliderValue = null;
  }

  map.flyTo({ zoom: 14, duration: 800 });
  map.once('moveend', () => _refreshLayers(map));
}

function _startDrift() {
  if (_driftRafId) return;
  const s = store.get();
  if (s.view === 'camera' || s.compassEnabled) return;
  // Don't start drift while a flyTo/easeTo is in progress — would conflict
  if (map.isMoving && map.isMoving()) return;
  _driftBaseBearing = map.getBearing();
  _driftBasePitch = map.getPitch();
  _driftT0 = performance.now();
  _driftRafId = requestAnimationFrame(_driftFrame);
}

// Map slider value 0..1000 to height 0..1000 m on a log curve (default 333 → ~10 m).
// 0 → 0 m exactly, otherwise log-curved from 1 m up to 1000 m.
// In grid mode, sliders are rescaled to 0–10 m linear (slider value = metres).
function sliderToHeight(v) {
  if (_gridShadowMode) return Math.round(+v * 10) / 10;  // 0–10 linear
  const n = +v;
  if (n <= 0) return 0;
  const t = Math.min(1, n / 1000);
  return Math.max(1, Math.round(Math.pow(1000, t)));
}
// Inverse: metres → slider value (for syncing the number input back to the slider).
function heightToSlider(h) {
  if (_gridShadowMode) return Math.max(0, Math.min(10, +h));
  if (h <= 0) return 0;
  const clamped = Math.max(1, Math.min(1000, h));
  return Math.max(1, Math.min(1000, Math.round(1000 * Math.log(clamped) / Math.log(1000))));
}
// Map slider value 0..1000 to radius 0.02..50 km on a log curve.
function sliderToRadiusKm(v) {
  const t = Math.max(0, Math.min(1, +v / 1000));
  // log range: 0.02 km → 50 km. ratio = 50/0.02 = 2500.
  return 0.02 * Math.pow(2500, t);
}

// ── Alignment wizard ────────────────────────────────────────────────────────
let _alignStep = null;   // null | 'a' | 'b'
let _alignA = null;      // {lat, lon, height}
let _alignB = null;      // {lat, lon, height}

function _fmtCoords(pt) {
  if (!pt) return '—';
  return `${pt.lat.toFixed(5)}, ${pt.lon.toFixed(5)}`;
}

function _updateAlignADisplay() {
  if (!dom.alignACoords || !_alignA) return;
  dom.alignACoords.textContent = _fmtCoords(_alignA);
}

function _updateAlignBDisplay() {
  if (!dom.alignBCoords || !_alignB) return;
  dom.alignBCoords.textContent = _fmtCoords(_alignB);
}

function _openAlignWizard() {
  if (!dom.alignPanel) return;
  if (dom.alignWizardBtn) { dom.alignWizardBtn.classList.add('active'); dom.alignWizardBtn.setAttribute('aria-pressed', 'true'); }
  const s = store.get();
  _alignStep = 'a';
  const casterH = getShadowHeight();
  const floorH  = getFloorHeight();
  _alignA = { lat: s.observer.lat, lon: s.observer.lon, height: casterH };
  _alignB = null;
  _updateAlignADisplay();
  if (dom.alignAHeight) dom.alignAHeight.value = String(casterH);
  if (dom.alignBCoords) dom.alignBCoords.textContent = 'Tap map to set';
  if (dom.alignBHeight) dom.alignBHeight.value = String(floorH);
  if (dom.alignSearchBtn) dom.alignSearchBtn.disabled = true;
  if (dom.alignStepA) dom.alignStepA.hidden = false;
  if (dom.alignStepB) dom.alignStepB.hidden = true;
  dom.alignPanel.hidden = false;
  showToast('Tap map to adjust Point A, or confirm as-is');
}

function _closeAlignWizard() {
  _alignStep = null;
  _alignA = null;
  _alignB = null;
  if (dom.alignPanel) dom.alignPanel.hidden = true;
  if (dom.alignWizardBtn) { dom.alignWizardBtn.classList.remove('active'); dom.alignWizardBtn.setAttribute('aria-pressed', 'false'); }
}

function _runAlignmentSearch() {
  if (!_alignA || !_alignB) return;
  // Sync heights from inputs in case user typed without tapping map again.
  if (dom.alignAHeight) _alignA.height = parseFloat(dom.alignAHeight.value) || 0;
  if (dom.alignBHeight) _alignB.height = parseFloat(dom.alignBHeight.value) || 0;
  const s = store.get();
  const moonMode = s.mode === 'moon';
  if (dom.alignSearchBtn) dom.alignSearchBtn.textContent = 'Searching…';
  setTimeout(() => {
    const result = findAlignmentBetweenPoints(_alignA, _alignB, s.datetime, moonMode);
    if (dom.alignSearchBtn) dom.alignSearchBtn.textContent = 'Search';
    if (!result) {
      const reqAz = bearing(_alignA.lat, _alignA.lon, _alignB.lat, _alignB.lon).toFixed(1);
      showToast(`No alignment found — need sun/moon at bearing ${reqAz}°`);
      return;
    }
    _closeAlignWizard();
    store.set({ datetime: result.datetime });
    const dateStr = formatDate(result.datetime);
    const timeStr = formatTime(result.datetime);
    showToast(`Aligned: ${dateStr} ${timeStr}`);
  }, 0);
}

// ── Coord label overlays (DATA mode) ────────────────────────────────────────
let _dataActive = false;
let _coordLabelObserver  = null;
let _coordLabelShadow    = null;
let _coordLabelCaster    = null;
let _coordLabelDatetime  = null;
let _coordLabelEndHeight = null;

function _initCoordLabels(mapInstance) {
  const makeLabel = () => {
    const el = document.createElement('div');
    el.className = 'coord-label';
    el.hidden = true;
    document.body.appendChild(el);
    return el;
  };
  _coordLabelObserver  = makeLabel();
  _coordLabelShadow    = makeLabel();
  _coordLabelCaster    = makeLabel();
  _coordLabelDatetime  = makeLabel();
  _coordLabelEndHeight = makeLabel();

  mapInstance.on('render', () => {
    if (!_dataActive) return;
    const s = store.get();
    if (!s.observer) return;

    const obsScr = mapInstance.project([s.observer.lon, s.observer.lat]);

    // Observer label (white dot) — lat/lon below the dot
    if (Number.isFinite(obsScr.x)) {
      _coordLabelObserver.style.left = (obsScr.x + 14) + 'px';
      _coordLabelObserver.style.top  = (obsScr.y + 4) + 'px';
      _coordLabelObserver.textContent = `${s.observer.lat.toFixed(5)}, ${s.observer.lon.toFixed(5)}`;
      _coordLabelObserver.hidden = false;
    }

    // Caster (blue dot) height label + datetime above it
    const casterH = getShadowHeight();
    const casterScr = casterH > 0.01
      ? project3D(mapInstance, s.observer.lon, s.observer.lat, casterH)
      : obsScr;
    if (Number.isFinite(casterScr.x)) {
      _coordLabelDatetime.style.left = (casterScr.x + 14) + 'px';
      _coordLabelDatetime.style.top  = (casterScr.y - 32) + 'px';
      _coordLabelDatetime.textContent = `${formatDate(s.datetime)} ${formatTime(s.datetime)}`;
      _coordLabelDatetime.hidden = false;

      if (casterH > 0.01) {
        _coordLabelCaster.style.left = (casterScr.x + 14) + 'px';
        _coordLabelCaster.style.top  = (casterScr.y - 12) + 'px';
        _coordLabelCaster.textContent = `${casterH}m`;
        _coordLabelCaster.hidden = false;
      } else {
        _coordLabelCaster.hidden = true;
      }
    }

    // Shadow/floor dot label — green dot (ground-level coords)
    const floorPt = getFloorDotLngLat();
    const endPt   = getShadowEndLngLat();
    const pt = floorPt || endPt;
    if (pt) {
      const scr = mapInstance.project([pt.lon, pt.lat]);
      if (Number.isFinite(scr.x)) {
        _coordLabelShadow.style.left = (scr.x + 14) + 'px';
        _coordLabelShadow.style.top  = (scr.y + 4) + 'px';
        _coordLabelShadow.textContent = `${pt.lat.toFixed(5)}, ${pt.lon.toFixed(5)}`;
        _coordLabelShadow.hidden = false;
      } else {
        _coordLabelShadow.hidden = true;
      }
    } else {
      _coordLabelShadow.hidden = true;
    }

    // Elevated yellow dot (endMarker) height label — shown only when floor > 0
    const endPt2 = getShadowEndLngLat();
    const floorH = getFloorHeight();
    if (endPt2 && floorH > 0.01) {
      const elevScr = project3D(mapInstance, endPt2.lon, endPt2.lat, floorH);
      if (Number.isFinite(elevScr.x)) {
        _coordLabelEndHeight.style.left = (elevScr.x + 14) + 'px';
        _coordLabelEndHeight.style.top  = (elevScr.y - 8) + 'px';
        _coordLabelEndHeight.textContent = `${floorH}m`;
        _coordLabelEndHeight.hidden = false;
      } else {
        _coordLabelEndHeight.hidden = true;
      }
    } else {
      _coordLabelEndHeight.hidden = true;
    }
  });
}

async function main() {
  // Init error monitor first so it captures everything that follows.
  initMonitor(() => store.get());

  attachHashSync();
  // Always default to current time on open (overrides any t= in the hash).
  store.set({ datetime: new Date() });
  if (!hashHasObserver()) tryGeolocate();

  const init = store.get();
  map = initMap(dom.map, init.observer);
  await whenStyleReady(map);
  // Always center on the observer at startup — the map may have drifted if the
  // user panned without moving the observer pin before last closing the app.
  try { map.jumpTo({ center: [init.observer.lon, init.observer.lat] }); } catch {}

  // Try each layer add separately so a bad layer doesn't kill all overlays.
  const safe = (label, fn) => {
    try { fn(); } catch (e) { console.error(label, e); showToast(label + ': ' + e.message); }
  };
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 80, unit: 'metric' }), 'bottom-left');
  safe('observer', () => addObserverLayer(map, init.observer.lat, init.observer.lon));
  safe('sun-path', () => addSunPathLayer(map));
  safe('reflection', () => addReflectionLayer(map));
  safe('target', () => addTargetLayer(map));
  safe('shadow', () => addShadowLayer(map));
  safe('camera',   () => initCameraView());
  safe('grid',     () => initGrid(map));
  safe('sky-view', () => initSkyView());

  // Pause compass updates while finger is down so drag-pan gestures aren't interrupted
  map.getCanvas().addEventListener('touchstart',  () => { _touching = true;  }, { passive: true });
  map.getCanvas().addEventListener('touchend',    () => { _touching = false; }, { passive: true });
  map.getCanvas().addEventListener('touchcancel', () => { _touching = false; }, { passive: true });

  _initCoordLabels(map);
  const due = checkAndNotify();
  if (due.length && Notification.permission !== 'granted') {
    showToast(`Reminder: ${due[0].mode} shot at ${formatTime(new Date(due[0].datetime))}`);
  }

  let suppressClick = false;
  map.on('click', (e) => {
    if (store.get().reflectionEnabled) return;
    if (suppressClick) { suppressClick = false; return; }
    if (e.originalEvent && e.originalEvent.target && e.originalEvent.target.closest('#dock,#search-results,#cam-hud,#data-panel,#align-panel')) return;

    // Alignment wizard intercepts taps for point A/B selection.
    if (_alignStep === 'a') {
      _alignA = { lat: e.lngLat.lat, lon: e.lngLat.lng, height: parseFloat(dom.alignAHeight?.value) || 0 };
      _updateAlignADisplay();
      return;
    }
    if (_alignStep === 'b') {
      _alignB = { lat: e.lngLat.lat, lon: e.lngLat.lng, height: parseFloat(dom.alignBHeight?.value) || 0 };
      _updateAlignBDisplay();
      if (dom.alignSearchBtn) dom.alignSearchBtn.disabled = false;
      return;
    }

    store.set({ observer: { lat: e.lngLat.lat, lon: e.lngLat.lng } });
  });

  // Long-press alignment finder removed — the gold card was confusing.

  initReflectionDraw(map);

  initScrubber({
    scrubber: dom.scrubber, ticks: dom.scrubberTicks,
    hh: dom.hh, dateBtn: dom.dateBtn, dateLabel: dom.dateLabel, dateInput: dom.dateInput,
  });
  initSearch({ input: dom.search, results: dom.searchResults }, map);

  // Body toggle: sun ↔ moon. Each mode keeps its own datetime memory.
  dom.bodyToggle.addEventListener('click', () => {
    const s = store.get();
    const next = s.mode === 'sun' ? 'moon' : 'sun';
    // Stash the current datetime under the mode you're leaving
    const update = {
      mode: next,
      [s.mode === 'sun' ? 'sunDatetime' : 'moonDatetime']: s.datetime,
    };
    if (next === 'moon') {
      // Restore last moon time, or compute a sensible anchor at the active arc
      if (s.moonDatetime) {
        update.datetime = s.moonDatetime;
      } else {
        const now = new Date();
        const today = getMoonTimes(now, s.observer.lat, s.observer.lon);
        let anchor;
        if (today.rise && today.set && today.rise < today.set && now >= today.rise && now <= today.set) {
          anchor = today.rise;
        } else if (today.rise && now < today.rise) {
          anchor = new Date(today.rise.getTime() - 5 * 60 * 1000);
        } else {
          const tomorrow = getMoonTimes(new Date(now.getTime() + 24*3600*1000), s.observer.lat, s.observer.lon);
          anchor = tomorrow.rise ? new Date(tomorrow.rise.getTime() - 5*60*1000) : now;
        }
        update.datetime = anchor;
      }
    } else {
      // Restore last sun time, or fall back to now
      update.datetime = s.sunDatetime || new Date();
    }
    store.set(update);
  });

  // Grid mode toggle
  const gridBtn = document.getElementById('grid-toggle');
  const unitBtn = document.getElementById('unit-toggle');

  function _syncUnitBtn() {
    if (unitBtn) unitBtn.textContent = _gridImperial ? 'ft' : 'm';
  }
  _syncUnitBtn();

  if (gridBtn) {
    gridBtn.addEventListener('click', () => {
      if (_gridActive) {
        _exitGrid(map);
        gridBtn.classList.remove('active');
        gridBtn.setAttribute('aria-pressed', 'false');
      } else {
        _enterGrid(map, store.get());
        gridBtn.classList.add('active');
        gridBtn.setAttribute('aria-pressed', 'true');
      }
    });
  }
  if (unitBtn) {
    unitBtn.addEventListener('click', () => {
      _gridImperial = !_gridImperial;
      localStorage.setItem('sun_grid_unit', _gridImperial ? 'imperial' : 'metric');
      setGridImperial(_gridImperial);
      _syncUnitBtn();
    });
  }

  // Keep grid centred on observer when observer changes
  store.subscribe('observer', (obs) => {
    if (_gridActive) setGridObserver(obs.lat, obs.lon);
  });

  dom.locateBtn.addEventListener('click', tryGeolocate);

  dom.compassToggle.addEventListener('click', async () => {
    if (store.get().compassEnabled) {
      disableCompass();
      dom.compassToggle.classList.remove('active');
      dom.compassToggle.setAttribute('aria-pressed', 'false');
      // Re-enable user gesture handlers
      try { map.dragRotate.enable(); } catch {}
      try { map.touchPitch && map.touchPitch.enable(); } catch {}
      try { map.touchZoomRotate.enableRotation(); } catch {}
      map.easeTo({ bearing: 0, duration: 400 });
    } else {
      const ok = await enableCompass();
      if (ok) {
        dom.compassToggle.classList.add('active');
        dom.compassToggle.setAttribute('aria-pressed', 'true');
        // Sensor drives bearing+pitch; disable manual rotation/pitch gestures so
        // two-finger pinch is interpreted purely as zoom (not rotate-or-pitch).
        // dragPan stays enabled so the user can reposition the map freely.
        try { map.dragPan.enable(); } catch {}
        try { map.dragRotate.disable(); } catch {}
        try { map.touchPitch && map.touchPitch.disable(); } catch {}
        try { map.touchZoomRotate.disableRotation(); } catch {}
        // Center on observer so the bearing snap doesn't disorient.
        const s = store.get();
        map.easeTo({ center: [s.observer.lon, s.observer.lat], duration: 500 });
        showToast('Compass on — pan freely, pinch to zoom');
      } else {
        showToast('Compass denied');
      }
    }
  });

  // Slider → updates number input + height
  dom.shadowElev.addEventListener('input', () => {
    const h = sliderToHeight(dom.shadowElev.value);
    setShadowHeight(h);
    if (dom.shadowElevVal) dom.shadowElevVal.value = String(h);
    const s = store.get();
    if (s.shadowEnabled) updateShadow(map, s.observer, s.datetime, s.mode === 'moon');
    saveUI();
  });
  // Number input → updates slider + height (fires on blur / Enter)
  if (dom.shadowElevVal) {
    dom.shadowElevVal.addEventListener('change', () => {
      const h = Math.max(0, Math.min(1000, Math.round(+dom.shadowElevVal.value) || 0));
      dom.shadowElevVal.value = String(h);
      dom.shadowElev.value = String(heightToSlider(h));
      setShadowHeight(h);
      const s = store.get();
      if (s.shadowEnabled) updateShadow(map, s.observer, s.datetime, s.mode === 'moon');
      saveUI();
    });
  }
  // Initialise from default slider value
  setShadowHeight(sliderToHeight(dom.shadowElev.value));
  if (dom.shadowElevVal) dom.shadowElevVal.value = String(sliderToHeight(dom.shadowElev.value));

  if (dom.floorElev) {
    dom.floorElev.addEventListener('input', () => {
      const h = sliderToHeight(dom.floorElev.value);
      setFloorHeight(h);
      if (dom.floorElevVal) dom.floorElevVal.value = String(h);
      const s = store.get();
      if (s.shadowEnabled) updateShadow(map, s.observer, s.datetime, s.mode === 'moon');
      saveUI();
    });
    if (dom.floorElevVal) {
      dom.floorElevVal.addEventListener('change', () => {
        const h = Math.max(0, Math.min(1000, Math.round(+dom.floorElevVal.value) || 0));
        dom.floorElevVal.value = String(h);
        dom.floorElev.value = String(heightToSlider(h));
        setFloorHeight(h);
        const s = store.get();
        if (s.shadowEnabled) updateShadow(map, s.observer, s.datetime, s.mode === 'moon');
        saveUI();
      });
    }
    setFloorHeight(sliderToHeight(dom.floorElev.value));
    if (dom.floorElevVal) dom.floorElevVal.value = String(sliderToHeight(dom.floorElev.value));
  }

  // Vertical sliders (right edge)
  if (dom.tiltSlider) {
    dom.tiltSlider.addEventListener('input', () => {
      map.setPitch(+dom.tiltSlider.value);
      saveUI();
    });
  }
  if (dom.radiusSlider) {
    const applyRadius = () => {
      const km = sliderToRadiusKm(dom.radiusSlider.value);
      setArcRadiusKm(km);
      // Force a day-level recompute so markers reposition.
      const s = store.get();
      const t = updateSunPathDay(map, s.observer, s.datetime, s.mode === 'moon');
      updateSunNow(map, s.observer, s.datetime, s.mode === 'moon' ? getMoonPos(s.datetime, s.observer.lat, s.observer.lon) : null);
      renderScrubberTicks(dom.scrubberTicks, t.rise, t.set, s.datetime);
    };
    // Restore persisted slider values before first applyRadius() so they take effect immediately.
    restoreUI(map);
    dom.radiusSlider.addEventListener('input', () => { applyRadius(); saveUI(); });
    applyRadius();
  }
  // Sync tilt slider when user drags the map (skip during drift)
  map.on('pitch', () => {
    if (_driftRafId) return;
    if (dom.tiltSlider) dom.tiltSlider.value = String(Math.round(map.getPitch()));
  });

  // Idle drift — stop on any map interaction
  const _onInteract = () => stopDrift();
  map.getCanvas().addEventListener('mousedown', _onInteract, { passive: true });
  map.getCanvas().addEventListener('touchstart', _onInteract, { passive: true });
  map.getCanvas().addEventListener('wheel', _onInteract, { passive: true });
  // Poll for idle; start drift after DRIFT_IDLE_MS of no interaction
  setInterval(() => {
    if (!_driftRafId && Date.now() - _lastInteract > DRIFT_IDLE_MS) _startDrift();
  }, 1000);

  // Top-of-screen pan guard: block single-touch map drag in top 28% of the screen.
  // At high pitch, that zone maps to distant horizon where 1 mm of drag = kilometres.
  // Multi-touch (pinch-to-zoom) and taps pass through unaffected.
  map.getCanvas().addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && e.touches[0].clientY < window.innerHeight * 0.28) {
      e.stopImmediatePropagation();
    }
  }, { capture: true, passive: true });

  dom.reflectionToggle.addEventListener('click', () => {
    const s = store.get();
    if (s.view !== 'map') return;
    store.set({ reflectionEnabled: !s.reflectionEnabled });
  });

  // DATA button: toggle coordinate labels beside dots on the map
  if (dom.dataBtn) {
    dom.dataBtn.addEventListener('click', () => {
      _dataActive = !_dataActive;
      dom.dataBtn.classList.toggle('active', _dataActive);
      dom.dataBtn.setAttribute('aria-pressed', _dataActive ? 'true' : 'false');
      if (!_dataActive) {
        if (_coordLabelObserver)  _coordLabelObserver.hidden  = true;
        if (_coordLabelShadow)    _coordLabelShadow.hidden    = true;
        if (_coordLabelCaster)    _coordLabelCaster.hidden    = true;
        if (_coordLabelDatetime)  _coordLabelDatetime.hidden  = true;
        if (_coordLabelEndHeight) _coordLabelEndHeight.hidden = true;
      }
    });
  }

  // Sky view toggle
  if (dom.skyViewBtn) {
    dom.skyViewBtn.addEventListener('click', () => {
      _skyActive = !_skyActive;
      document.body.classList.toggle('sky-active', _skyActive);
      dom.skyViewBtn.classList.toggle('active', _skyActive);
      dom.skyViewBtn.setAttribute('aria-pressed', _skyActive ? 'true' : 'false');
      if (_skyActive) {
        showSkyView();
        stopDrift();
        // Hide map arc so it doesn't show through the canvas overlay
        setSunPathVisible(map, false);
        setRayLineVisible(map, false);
        renderSkyView(store.get().mode === 'moon');
      } else {
        hideSkyView();
        const _s = store.get();
        if (_s.view !== 'camera') {
          setSunPathVisible(map, true);
          setRayLineVisible(map, true);
        }
      }
    });
  }

  // Alignment wizard: crosshair button on control row
  if (dom.alignWizardBtn) {
    dom.alignWizardBtn.addEventListener('click', () => {
      if (!dom.alignPanel || !dom.alignPanel.hidden) {
        _closeAlignWizard();
      } else {
        _openAlignWizard();
      }
    });
  }
  if (dom.alignClose) {
    dom.alignClose.addEventListener('click', _closeAlignWizard);
  }
  if (dom.alignAConfirm) {
    dom.alignAConfirm.addEventListener('click', () => {
      // Accept Point A and move to Step B
      _alignStep = 'b';
      if (dom.alignStepA) dom.alignStepA.hidden = true;
      if (dom.alignStepB) dom.alignStepB.hidden = false;
      showToast('Tap map to set Point B');
    });
  }
  if (dom.alignSearchBtn) {
    dom.alignSearchBtn.addEventListener('click', _runAlignmentSearch);
  }

  // Transparent time input overlaid on #time-hh — native picker on direct tap
  const timeExactInput = $('time-exact-input');
  if (timeExactInput) {
    timeExactInput.addEventListener('change', () => {
      const [hh, mm] = (timeExactInput.value || '').split(':').map(Number);
      if (!Number.isFinite(hh)) return;
      const s = store.get();
      const d = new Date(s.datetime);
      d.setHours(hh, mm || 0, 0, 0);
      store.set({ datetime: d });
    });
  }

  // Invert map colours
  const invertBtn = document.getElementById('invert-btn');
  if (invertBtn) {
    invertBtn.addEventListener('click', () => {
      document.body.classList.toggle('invert');
    });
  }

  store.subscribe('compassHeading', (heading) => {
    if (heading == null || _touching) return;
    map.setBearing(heading);
  });

  store.subscribe('compassPitch', (pitch) => {
    if (pitch == null || _touching) return;
    const clamped = Math.max(0, Math.min(map.getMaxPitch ? map.getMaxPitch() : 85, pitch));
    map.setPitch(clamped);
    if (dom.tiltSlider) dom.tiltSlider.value = String(Math.round(clamped));
  });

  store.subscribeAll(throttleRaf((s, changed) => {
    try { redraw(s, changed); } catch (e) {
      console.error('redraw failed', e);
      captureError(e, { phase: 'redraw', changed });
      showToast('Error: ' + e.message);
    }
  }));

  // First draw
  try {
    redraw(store.get(), ['observer', 'datetime', 'mode', 'view', 'target', 'shadowEnabled', 'reflectionEnabled']);
  } catch (e) {
    console.error('Initial redraw failed:', e);
    captureError(e, { phase: 'init-redraw' });
    showToast('Init error: ' + e.message);
  }

}


function redraw(s, changed) {
  // Guard: skip entirely if observer coordinates are invalid (e.g. malformed hash)
  if (!s.observer || !Number.isFinite(s.observer.lat) || !Number.isFinite(s.observer.lon)) return;

  const observerChanged   = changed.includes('observer');
  const modeChanged       = changed.includes('mode');
  const viewChanged       = changed.includes('view');
  const targetChanged     = changed.includes('target');
  const shadowChanged     = changed.includes('shadowEnabled');
  const reflectionChanged = changed.includes('reflectionEnabled');
  const moonMode = s.mode === 'moon';

  if (observerChanged) {
    try { setObserver(map, s.observer.lat, s.observer.lon); } catch (e) { captureError(e, { phase: 'setObserver' }); }
  }

  // Day-level recompute — each call isolated so one failure doesn't block others
  const dayKey      = startOfLocalDay(s.datetime).toDateString();
  const observerKey = `${s.observer.lat.toFixed(4)},${s.observer.lon.toFixed(4)}`;
  const dayLevelChanged = (dayKey !== lastDayKey) || (observerKey !== lastObserverKey);
  if (dayLevelChanged || observerChanged || modeChanged) {
    let t = { rise: null, set: null };
    try { t = updateSunPathDay(map, s.observer, s.datetime, moonMode); } catch (e) { captureError(e, { phase: 'sunPathDay' }); }
    try { updateReflectionDay(map, s.observer, s.datetime); } catch (e) { captureError(e, { phase: 'reflectionDay' }); }
    // Sync scrubber range to active arc in moon mode (rise→set as 0..N minutes)
    setScrubberRange(
      { scrubber: dom.scrubber },
      moonMode ? 'moon' : 'sun',
      moonMode ? t.rise : null,
      moonMode ? t.set  : null,
    );
    renderScrubberTicks(dom.scrubberTicks, t.rise, t.set, s.datetime);
    updateRiseSet(s, t);
    lastDayKey = dayKey;
    lastObserverKey = observerKey;
  }

  // Per-frame body position — each layer isolated so one crash doesn't kill others
  const moonPos = moonMode ? getMoonPos(s.datetime, s.observer.lat, s.observer.lon) : null;
  try { updateSunNow(map, s.observer, s.datetime, moonPos); } catch (e) { captureError(e, { phase: 'sunNow' }); }
  try { updateReflectionNow(map, s.observer, s.datetime, reflectionLine, moonMode); } catch (e) { captureError(e, { phase: 'reflection' }); }
  try { if (s.shadowEnabled) updateShadow(map, s.observer, s.datetime, moonMode); } catch (e) { captureError(e, { phase: 'shadow' }); }
  updateNowText(s);
  setMoonPhaseMarker(dom.moonPhaseMarker, moonMode ? getMoonIllumination(s.datetime) : null);

  if (modeChanged || viewChanged || shadowChanged || reflectionChanged) {
    try { syncChrome(s); } catch (e) { captureError(e, { phase: 'syncChrome' }); }
  }

  if (s.view === 'camera') {
    try { updateCameraView(s.datetime, s.observer, moonMode); } catch (e) { captureError(e, { phase: 'cameraView' }); }
  }

  if (targetChanged || observerChanged) {
    try { setTarget(map, s.observer, s.target); } catch (e) { captureError(e, { phase: 'target' }); }
  }

  if (_skyActive) {
    try { renderSkyView(moonMode); } catch (e) { captureError(e, { phase: 'skyView' }); }
  }
}

function syncChrome(s) {
  const inCamera = s.view === 'camera';
  const inSun = s.mode === 'sun';

  document.body.classList.toggle('view-camera', inCamera);
  document.body.classList.toggle('view-map', !inCamera);
  document.body.classList.toggle('mode-sun', inSun);
  document.body.classList.toggle('mode-moon', !inSun);

  if (inCamera) showCameraView(); else hideCameraView();

  setSunPathVisible(map, !inCamera && !_skyActive);
  setRayLineVisible(map, !inCamera && !_skyActive);
  setBodyColor(map, !inSun);
  setReflectionVisible(map, !inCamera && s.reflectionEnabled);
  setShadowVisible(map, !inCamera);

  // Body icon: shows what you'd switch TO. In sun mode → show moon icon.
  if (dom.bodyIconSun)  dom.bodyIconSun.classList.toggle('hide', inSun);
  if (dom.bodyIconMoon) dom.bodyIconMoon.classList.toggle('hide', !inSun);

  // Toggle button visual states
  dom.reflectionToggle.classList.toggle('active', s.reflectionEnabled);
  dom.reflectionToggle.setAttribute('aria-pressed', s.reflectionEnabled ? 'true' : 'false');

  // Reflection available in both sun and moon map mode
  const reflectionAvail = !inCamera;
  dom.reflectionToggle.classList.toggle('disabled', !reflectionAvail);
  if (!reflectionAvail && s.reflectionEnabled) {
    store.set({ reflectionEnabled: false });
    return;
  }

  // Shadow elevation panel: always visible in map mode.
  if (dom.shadowElevPanel) {
    dom.shadowElevPanel.hidden = inCamera;
  }

  if (s.reflectionEnabled) {
    reflectionLine = null;
    updateReflectionWall(map, null);
    showToast('Hold & drag to draw a building line');
  } else {
    map.dragPan.enable();
    reflectionLine = null;
    updateReflectionWall(map, null);
  }
}


function updateRiseSet(s, t) {
  const fmt = (d, prefix) => d ? `${prefix} ${formatTime(d)}` : `${prefix} —`;
  if (dom.riseLabel) dom.riseLabel.textContent = fmt(t.rise, '↑');
  if (dom.setLabel)  dom.setLabel.textContent  = fmt(t.set, '↓');
}

function updateNowText(s) {
  const isMoon = s.mode === 'moon';
  const p = isMoon
    ? getMoonPos(s.datetime, s.observer.lat, s.observer.lon)
    : getPosition(s.datetime, s.observer.lat, s.observer.lon);
  const alt = p.altitudeDeg;
  const above = alt > 0;
  if (dom.sunAlt) {
    dom.sunAlt.textContent = above ? `↑${alt.toFixed(1)}°` : `↓${Math.abs(alt).toFixed(1)}°`;
    dom.sunAlt.classList.toggle('below', !above);
  }
  // Keep the time input's value current so it shows the right time when tapped
  const ti = document.getElementById('time-exact-input');
  if (ti && document.activeElement !== ti) {
    const d = s.datetime;
    ti.value = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }
}

function tryGeolocate() {
  stopDrift();
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      store.set({ observer: { lat: pos.coords.latitude, lon: pos.coords.longitude } });
      if (map) map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: Math.max(map.getZoom(), 13), duration: 900 });
    },
    () => {},
    { enableHighAccuracy: false, timeout: 6000, maximumAge: 60000 },
  );
}

function hashHasObserver() { return /[#&]ll=/.test(location.hash); }

function initReflectionDraw(map) {
  const HOLD_MS = 350, CANCEL_PX = 10;
  const UI_SEL = '#dock,#search-results,#cam-hud,#toast';

  let holdTimer = null, holdOrigin = null;
  let drawing = false, drawStart = null, drawEnd = null;

  const cancelHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } holdOrigin = null; };

  const onDown = (e) => {
    if (!store.get().reflectionEnabled) return;
    if (e.originalEvent && e.originalEvent.target && e.originalEvent.target.closest(UI_SEL)) return;
    if (e.originalEvent.touches && e.originalEvent.touches.length !== 1) { cancelHold(); return; }
    cancelHold();
    holdOrigin = { lngLat: e.lngLat, point: { x: e.point.x, y: e.point.y } };
    holdTimer = setTimeout(() => {
      holdTimer = null;
      if (!holdOrigin) return;
      drawing = true;
      drawStart = { lat: holdOrigin.lngLat.lat, lon: holdOrigin.lngLat.lng };
      drawEnd = drawStart;
      map.dragPan.disable();
      reflectionLine = null;
      updateReflectionWall(map, null);
      updateReflectionNow(map, store.get().observer, store.get().datetime, null);
    }, HOLD_MS);
  };

  const onMove = (e) => {
    if (!store.get().reflectionEnabled) return;
    if (holdOrigin && !drawing) {
      const dx = e.point.x - holdOrigin.point.x;
      const dy = e.point.y - holdOrigin.point.y;
      if (Math.hypot(dx, dy) > CANCEL_PX) cancelHold();
    }
    if (drawing && drawStart) {
      drawEnd = { lat: e.lngLat.lat, lon: e.lngLat.lng };
      updateReflectionWall(map, { start: drawStart, end: drawEnd });
    }
  };

  const onUp = () => {
    cancelHold();
    if (!drawing) return;
    drawing = false;
    map.dragPan.enable();
    if (drawStart && drawEnd) {
      reflectionLine = { start: drawStart, end: drawEnd };
      updateReflectionWall(map, reflectionLine);
      const s = store.get();
      updateReflectionNow(map, s.observer, s.datetime, reflectionLine, s.mode === 'moon');
    }
    drawStart = null;
    drawEnd = null;
  };

  map.on('mousedown', onDown);  map.on('mousemove', onMove);  map.on('mouseup', onUp);
  map.on('touchstart', onDown); map.on('touchmove', onMove); map.on('touchend', onUp);
  map.on('touchcancel', onUp);
}


let toastTimer = null;
function showToast(msg) {
  dom.toast.textContent = msg;
  dom.toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { dom.toast.hidden = true; }, 2200);
}

// ── UI state persistence ─────────────────────────────────────────────────────
// Saves slider positions to localStorage so a crash or close restores them.
// Observer / datetime / mode are persisted by attachHashSync via the URL hash.

function saveUI() {
  try {
    localStorage.setItem('sun_ui', JSON.stringify({
      casterH: dom.shadowElev?.value,
      floorH:  dom.floorElev?.value,
      radius:  dom.radiusSlider?.value,
      tilt:    dom.tiltSlider?.value,
    }));
  } catch {}
}

function restoreUI(mapInstance) {
  let saved;
  try { saved = JSON.parse(localStorage.getItem('sun_ui') || 'null'); } catch {}
  if (!saved) return;

  if (saved.casterH != null && dom.shadowElev) {
    dom.shadowElev.value = saved.casterH;
    const h = sliderToHeight(saved.casterH);
    setShadowHeight(h);
    if (dom.shadowElevVal) dom.shadowElevVal.value = String(h);
  }
  if (saved.floorH != null && dom.floorElev) {
    dom.floorElev.value = saved.floorH;
    const h = sliderToHeight(saved.floorH);
    setFloorHeight(h);
    if (dom.floorElevVal) dom.floorElevVal.value = String(h);
  }
  if (saved.tilt != null && dom.tiltSlider) {
    dom.tiltSlider.value = saved.tilt;
    try { mapInstance.setPitch(+saved.tilt); } catch {}
  }
  if (saved.radius != null && dom.radiusSlider) {
    // Value is read directly by applyRadius() which runs immediately after restoreUI().
    dom.radiusSlider.value = saved.radius;
    setArcRadiusKm(sliderToRadiusKm(saved.radius));
  }
}

// Global error trap → show in toast so crashes are visible on mobile.
// Logging to the persistent ring buffer is handled by initMonitor above.
window.addEventListener('error', (e) => {
  const t = document.getElementById('toast');
  if (t) { t.textContent = 'JS: ' + ((e && e.message) || 'unknown error'); t.hidden = false; }
});
window.addEventListener('unhandledrejection', (e) => {
  const t = document.getElementById('toast');
  if (t) { t.textContent = 'Promise: ' + ((e.reason && (e.reason.message || e.reason.toString())) || 'rejection'); t.hidden = false; }
});

main().catch((e) => {
  console.error(e);
  captureError(e, { phase: 'main' });
  const t = document.getElementById('toast');
  if (t) { t.textContent = 'main(): ' + e.message; t.hidden = false; }
  else document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;top:60px;left:10px;right:10px;padding:12px;background:#400;color:#fff;z-index:99;border-radius:8px;font:13px monospace;">main(): ${e.message}</div>`);
});
