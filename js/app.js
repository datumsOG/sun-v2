// Main wiring. Boots map, layers, UI; subscribes to state changes.

import * as store from './state.js';
import { initMap, whenStyleReady } from './map.js';
import { addObserverLayer, setObserver } from './layers/observer.js';
import { addSunPathLayer, updateSunPathDay, updateSunNow, setSunPathVisible, setArcRadiusKm } from './layers/sun-path.js';
import { addReflectionLayer, updateReflectionDay, updateReflectionNow, updateReflectionWall, setReflectionVisible } from './layers/reflection.js';
import { addTargetLayer, setTarget } from './layers/target.js';
import { addShadowLayer, updateShadow, setShadowVisible, setShadowHeight } from './layers/shadow.js';
import { initScrubber, renderScrubberTicks, setMoonPhaseMarker, setScrubberRange } from './ui/scrubber.js';
import { initSearch } from './ui/search.js';
import { enableCompass, disableCompass } from './ui/sensor.js';
import { attachHashSync } from './share.js';
import { getPosition, getMoonPos, getMoonIllumination, getMoonTimes } from './solar.js';
import { findNextAlignment } from './alignment.js';
import { bearing, formatTime, formatDate, throttleRaf, startOfLocalDay } from './util.js';
import { initCameraView, showCameraView, hideCameraView, updateCameraView } from './ui/arrow-view.js';
import { checkAndNotify, saveReminder } from './reminders.js';

const $ = (id) => document.getElementById(id);

const dom = {
  map: $('map'),
  search: $('search'),
  searchResults: $('search-results'),
  scrubber: $('scrubber'),
  scrubberTicks: $('scrubber-ticks'),
  moonPhaseMarker: $('moon-phase-marker'),
  sunAlt: $('sun-alt'),
  hh: $('time-hh'),
  dateBtn: $('date-btn'),
  dateLabel: $('date-label'),
  dateInput: $('date-input'),
  riseLabel: $('rise-label'),
  setLabel: $('set-label'),
  bodyToggle: $('body-toggle'),
  bodyIconSun: $('body-icon-sun'),
  bodyIconMoon: $('body-icon-moon'),
  viewToggle: $('view-toggle'),
  viewIconCamera: $('view-icon-camera'),
  viewIconMap: $('view-icon-map'),
  locateBtn: $('locate-btn'),
  compassToggle: $('compass-toggle'),
  shadowToggle: $('shadow-toggle'),
  reflectionToggle: $('reflection-toggle'),
  reminderBtn: $('reminder-btn'),
  shareBtn: $('share-btn'),
  shadowElevPanel: $('shadow-elev-panel'),
  shadowElev: $('shadow-elev'),
  shadowElevVal: $('shadow-elev-val'),
  hint: $('hint'),
  toast: $('toast'),
  tiltSlider: $('tilt-slider'),
  radiusSlider: $('radius-slider'),
  alignmentCard: $('alignment-card'),
  alignmentWhen: $('alignment-when'),
  alignmentJump: $('alignment-jump'),
  alignmentClear: $('alignment-clear'),
};

let map;
let lastDayKey = null;
let lastObserverKey = null;
let reflectionLine = null;

// Map slider value 0..1000 to height 1..1000 m on a log curve (default 333 → ~10 m).
function sliderToHeight(v) {
  const t = Math.max(0, Math.min(1, +v / 1000));
  return Math.max(1, Math.round(Math.pow(1000, t)));
}
// Map slider value 0..1000 to radius 0.02..50 km on a log curve.
function sliderToRadiusKm(v) {
  const t = Math.max(0, Math.min(1, +v / 1000));
  // log range: 0.02 km → 50 km. ratio = 50/0.02 = 2500.
  return 0.02 * Math.pow(2500, t);
}

async function main() {
  attachHashSync();
  // Always default to current time on open (overrides any t= in the hash).
  store.set({ datetime: new Date() });
  if (!hashHasObserver()) tryGeolocate();

  const init = store.get();
  map = initMap(dom.map, init.observer);
  await whenStyleReady(map);

  // Try each layer add separately so a bad layer doesn't kill all overlays.
  const safe = (label, fn) => {
    try { fn(); } catch (e) { console.error(label, e); showToast(label + ': ' + e.message); }
  };
  safe('observer', () => addObserverLayer(map, init.observer.lat, init.observer.lon));
  safe('sun-path', () => addSunPathLayer(map));
  safe('reflection', () => addReflectionLayer(map));
  safe('target', () => addTargetLayer(map));
  safe('shadow', () => addShadowLayer(map));
  safe('camera', () => initCameraView());

  const due = checkAndNotify();
  if (due.length && Notification.permission !== 'granted') {
    showToast(`Reminder: ${due[0].mode} shot at ${formatTime(new Date(due[0].datetime))}`);
  }

  let suppressClick = false;
  map.on('click', (e) => {
    if (store.get().reflectionEnabled) return;
    if (suppressClick) { suppressClick = false; return; }
    if (e.originalEvent && e.originalEvent.target && e.originalEvent.target.closest('#dock,#search-results,#cam-hud')) return;
    store.set({ observer: { lat: e.lngLat.lat, lon: e.lngLat.lng } });
  });

  attachLongPress(map, (lngLat) => {
    if (store.get().reflectionEnabled) return;
    suppressClick = true;
    store.set({ target: { lat: lngLat.lat, lon: lngLat.lng } });
    showToast('Target set — checking next alignment');
  });

  initReflectionDraw(map);

  initScrubber({
    scrubber: dom.scrubber, ticks: dom.scrubberTicks,
    hh: dom.hh, dateBtn: dom.dateBtn, dateLabel: dom.dateLabel, dateInput: dom.dateInput,
  });
  initSearch({ input: dom.search, results: dom.searchResults }, map);

  // Body toggle: sun ↔ moon. Icon shows the mode you would switch TO.
  dom.bodyToggle.addEventListener('click', () => {
    const s = store.get();
    const next = s.mode === 'sun' ? 'moon' : 'sun';
    const update = { mode: next };
    if (next === 'moon') {
      // Jump scrubber to start of the relevant moon arc
      const now = new Date();
      const today = getMoonTimes(now, s.observer.lat, s.observer.lon);
      let anchor;
      if (today.rise && today.set && today.rise < today.set && now >= today.rise && now <= today.set) {
        anchor = today.rise;          // moon currently up — scrub from this rise
      } else if (today.rise && now < today.rise) {
        anchor = new Date(today.rise.getTime() - 5 * 60 * 1000); // a little before next rise
      } else {
        const tomorrow = getMoonTimes(new Date(now.getTime() + 24*3600*1000), s.observer.lat, s.observer.lon);
        anchor = tomorrow.rise ? new Date(tomorrow.rise.getTime() - 5*60*1000) : now;
      }
      update.datetime = anchor;
    }
    store.set(update);
  });

  // View toggle: map ↔ camera.
  dom.viewToggle.addEventListener('click', () => {
    const next = store.get().view === 'map' ? 'camera' : 'map';
    store.set({ view: next });
  });

  dom.locateBtn.addEventListener('click', tryGeolocate);

  dom.compassToggle.addEventListener('click', async () => {
    if (store.get().compassEnabled) {
      disableCompass();
      dom.compassToggle.classList.remove('active');
      dom.compassToggle.setAttribute('aria-pressed', 'false');
      map.easeTo({ bearing: 0, duration: 400 });
    } else {
      const ok = await enableCompass();
      if (ok) {
        dom.compassToggle.classList.add('active');
        dom.compassToggle.setAttribute('aria-pressed', 'true');
        showToast('Compass on — rotate to align');
      } else {
        showToast('Compass denied');
      }
    }
  });

  dom.shadowToggle.addEventListener('click', () => {
    const next = !store.get().shadowEnabled;
    store.set({ shadowEnabled: next });
  });

  dom.shadowElev.addEventListener('input', () => {
    const h = sliderToHeight(dom.shadowElev.value);
    setShadowHeight(h);
    dom.shadowElevVal.textContent = `${h} m`;
    const s = store.get();
    if (s.shadowEnabled) updateShadow(map, s.observer, s.datetime, s.mode === 'moon');
  });
  // Initialise from default slider value
  setShadowHeight(sliderToHeight(dom.shadowElev.value));
  dom.shadowElevVal.textContent = `${sliderToHeight(dom.shadowElev.value)} m`;

  // Vertical sliders (right edge)
  if (dom.tiltSlider) {
    dom.tiltSlider.addEventListener('input', () => {
      map.easeTo({ pitch: +dom.tiltSlider.value, duration: 80 });
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
    dom.radiusSlider.addEventListener('input', applyRadius);
    applyRadius();
  }
  // Sync tilt slider when user drags the map
  map.on('pitch', () => {
    if (dom.tiltSlider) dom.tiltSlider.value = String(Math.round(map.getPitch()));
  });

  dom.reflectionToggle.addEventListener('click', () => {
    const s = store.get();
    // Reflection only valid in sun + map mode
    if (s.mode !== 'sun' || s.view !== 'map') return;
    store.set({ reflectionEnabled: !s.reflectionEnabled });
  });

  dom.reminderBtn.addEventListener('click', () => {
    const s = store.get();
    saveReminder(s.observer, s.datetime, s.mode);
    showToast('Reminder saved');
  });

  dom.shareBtn.addEventListener('click', async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Sun', url: location.href });
      else { await navigator.clipboard.writeText(location.href); showToast('Link copied'); }
    } catch {}
  });

  dom.alignmentJump.addEventListener('click', () => {
    if (alignmentResult && alignmentResult.eventTime) {
      store.set({ datetime: new Date(alignmentResult.eventTime) });
    }
  });
  dom.alignmentClear.addEventListener('click', () => store.set({ target: null }));

  store.subscribe('compassHeading', (heading) => {
    if (heading == null) return;
    map.setBearing(heading);
  });

  store.subscribeAll(throttleRaf((s, changed) => {
    try { redraw(s, changed); } catch (e) { console.error('redraw failed', e); showToast('Error: ' + e.message); }
  }));

  // First draw
  try {
    redraw(store.get(), ['observer', 'datetime', 'mode', 'view', 'target', 'shadowEnabled', 'reflectionEnabled']);
  } catch (e) {
    console.error('Initial redraw failed:', e);
    showToast('Init error: ' + e.message);
  }

  // Brief hint on first load
  if (dom.hint) {
    dom.hint.hidden = false;
    setTimeout(() => { if (dom.hint) dom.hint.hidden = true; }, 4500);
  }
}

let alignmentResult = null;

function redraw(s, changed) {
  const observerChanged = changed.includes('observer');
  const modeChanged = changed.includes('mode');
  const viewChanged = changed.includes('view');
  const targetChanged = changed.includes('target');
  const shadowChanged = changed.includes('shadowEnabled');
  const reflectionChanged = changed.includes('reflectionEnabled');
  const moonMode = s.mode === 'moon';

  if (observerChanged) setObserver(map, s.observer.lat, s.observer.lon);

  // Day-level recompute
  const dayKey = startOfLocalDay(s.datetime).toDateString();
  const observerKey = `${s.observer.lat.toFixed(4)},${s.observer.lon.toFixed(4)}`;
  const dayLevelChanged = (dayKey !== lastDayKey) || (observerKey !== lastObserverKey);
  if (dayLevelChanged || observerChanged || modeChanged) {
    const t = updateSunPathDay(map, s.observer, s.datetime, moonMode);
    updateReflectionDay(map, s.observer, s.datetime);
    // Sync scrubber range to active arc in moon mode (rise→set as 0..N minutes)
    setScrubberRange(
      { scrubber: dom.scrubber },
      moonMode ? 'moon' : 'sun',
      moonMode ? t.rise : null,
      moonMode ? t.set : null,
    );
    renderScrubberTicks(dom.scrubberTicks, t.rise, t.set, s.datetime);
    updateRiseSet(s, t);
    lastDayKey = dayKey;
    lastObserverKey = observerKey;
  }

  // Per-frame body position
  const moonPos = moonMode ? getMoonPos(s.datetime, s.observer.lat, s.observer.lon) : null;
  updateSunNow(map, s.observer, s.datetime, moonPos);
  updateReflectionNow(map, s.observer, s.datetime, reflectionLine);
  if (s.shadowEnabled) updateShadow(map, s.observer, s.datetime, moonMode);
  updateNowText(s);
  setMoonPhaseMarker(dom.moonPhaseMarker, moonMode ? getMoonIllumination(s.datetime) : null);

  if (modeChanged || viewChanged || shadowChanged || reflectionChanged) {
    syncChrome(s);
  }

  if (s.view === 'camera') {
    updateCameraView(s.datetime, s.observer, moonMode);
  }

  if (targetChanged || observerChanged) {
    setTarget(map, s.observer, s.target);
    refreshAlignment(s);
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

  setSunPathVisible(map, !inCamera && !s.reflectionEnabled);
  setReflectionVisible(map, !inCamera && s.reflectionEnabled);
  setShadowVisible(map, !inCamera && s.shadowEnabled);

  // Body icon: shows what you'd switch TO. In sun mode → show moon icon.
  if (dom.bodyIconSun)  dom.bodyIconSun.classList.toggle('hide', inSun);
  if (dom.bodyIconMoon) dom.bodyIconMoon.classList.toggle('hide', !inSun);

  // View icon: shows what you'd switch TO. In map view → show camera icon.
  if (dom.viewIconCamera) dom.viewIconCamera.classList.toggle('hide', inCamera);
  if (dom.viewIconMap)    dom.viewIconMap.classList.toggle('hide', !inCamera);

  // Toggle button visual states
  dom.shadowToggle.classList.toggle('active', s.shadowEnabled);
  dom.shadowToggle.setAttribute('aria-pressed', s.shadowEnabled ? 'true' : 'false');
  dom.reflectionToggle.classList.toggle('active', s.reflectionEnabled);
  dom.reflectionToggle.setAttribute('aria-pressed', s.reflectionEnabled ? 'true' : 'false');

  // Reflection only enabled in sun + map mode
  const reflectionAvail = inSun && !inCamera;
  dom.reflectionToggle.classList.toggle('disabled', !reflectionAvail);
  if (!reflectionAvail && s.reflectionEnabled) {
    store.set({ reflectionEnabled: false });
    return;
  }

  // Shadow elevation panel visibility
  if (dom.shadowElevPanel) dom.shadowElevPanel.hidden = !s.shadowEnabled || inCamera;

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

function refreshAlignment(s) {
  if (!s.target) {
    dom.alignmentCard.hidden = true;
    alignmentResult = null;
    return;
  }
  const targetAz = bearing(s.observer.lat, s.observer.lon, s.target.lat, s.target.lon);
  const result = findNextAlignment(s.observer, targetAz, 1.5, new Date(), 'either');
  alignmentResult = result;
  if (!result) {
    dom.alignmentCard.hidden = false;
    dom.alignmentWhen.textContent = 'No alignment within a year';
    return;
  }
  const ev = result.eventTime;
  const kind = result.kind === 'sunrise' ? '↑' : '↓';
  dom.alignmentWhen.textContent = `${kind} ${formatDate(ev)} ${formatTime(ev)} · az ${result.azimuth.toFixed(1)}°`;
  dom.alignmentCard.hidden = false;
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
  dom.sunAlt.textContent = above ? `↑${alt.toFixed(1)}° · ${Math.round(p.azimuthDeg)}°` : `↓${Math.abs(alt).toFixed(1)}°`;
  dom.sunAlt.classList.toggle('below', !above);
}

function tryGeolocate() {
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
      updateReflectionNow(map, s.observer, s.datetime, reflectionLine);
    }
    drawStart = null;
    drawEnd = null;
  };

  map.on('mousedown', onDown);  map.on('mousemove', onMove);  map.on('mouseup', onUp);
  map.on('touchstart', onDown); map.on('touchmove', onMove); map.on('touchend', onUp);
  map.on('touchcancel', onUp);
}

function attachLongPress(map, cb) {
  let timer = null, startPos = null, cancelled = false;
  const start = (e) => {
    cancelled = false;
    startPos = e.point;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { if (!cancelled) cb(e.lngLat); }, 550);
  };
  const move = (e) => {
    if (!startPos) return;
    if (Math.hypot(e.point.x - startPos.x, e.point.y - startPos.y) > 6) cancelled = true;
  };
  const end = () => { if (timer) clearTimeout(timer); timer = null; startPos = null; };
  map.on('mousedown', start); map.on('mousemove', move); map.on('mouseup', end);
  map.on('touchstart', start); map.on('touchmove', move); map.on('touchend', end);
  map.on('dragstart', () => { cancelled = true; if (timer) { clearTimeout(timer); timer = null; } });
}

let toastTimer = null;
function showToast(msg) {
  dom.toast.textContent = msg;
  dom.toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { dom.toast.hidden = true; }, 2200);
}

// Global error trap → show in toast (so we can see what's broken on mobile)
window.addEventListener('error', (e) => {
  const msg = (e && e.message) || 'unknown error';
  const t = document.getElementById('toast');
  if (t) { t.textContent = 'JS: ' + msg; t.hidden = false; }
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = (e.reason && (e.reason.message || e.reason.toString())) || 'rejection';
  const t = document.getElementById('toast');
  if (t) { t.textContent = 'Promise: ' + msg; t.hidden = false; }
});

main().catch((e) => {
  console.error(e);
  const t = document.getElementById('toast');
  if (t) { t.textContent = 'main(): ' + e.message; t.hidden = false; }
  else document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;top:60px;left:10px;right:10px;padding:12px;background:#400;color:#fff;z-index:99;border-radius:8px;font:13px monospace;">main(): ${e.message}</div>`);
});
