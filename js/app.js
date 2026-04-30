// Main wiring. Boots map, layers, UI; subscribes to state changes.

import * as store from './state.js';
import { initMap, whenStyleReady } from './map.js';
import { addObserverLayer, setObserver } from './layers/observer.js';
import { addSunPathLayer, updateSunPathDay, updateSunNow } from './layers/sun-path.js';
import { addReflectionLayer, updateReflectionDay, updateReflectionNow, setReflectionVisible } from './layers/reflection.js';
import { addTargetLayer, setTarget } from './layers/target.js';
import { initScrubber, renderScrubberTicks } from './ui/scrubber.js';
import { renderChartDay, updateChartNow } from './ui/chart.js';
import { initSearch } from './ui/search.js';
import { enableCompass, disableCompass } from './ui/sensor.js';
import { attachHashSync } from './share.js';
import { getPosition, getDayBoundaries } from './solar.js';
import { reflectAzimuth } from './reflection.js';
import { findNextAlignment } from './alignment.js';
import { bearing, formatTime, formatDate, throttleRaf, startOfLocalDay } from './util.js';

const $ = (id) => document.getElementById(id);

const dom = {
  map: $('map'),
  search: $('search'),
  searchResults: $('search-results'),
  locateBtn: $('locate-btn'),
  modeButtons: document.querySelectorAll('.mode-btn'),
  compassBtn: $('compass-btn'),
  shareBtn: $('share-btn'),
  scrubber: $('scrubber'),
  scrubberTicks: $('scrubber-ticks'),
  playBtn: $('play-btn'),
  playIcon: $('play-icon'),
  hh: $('time-hh'),
  dateBtn: $('date-btn'),
  dateLabel: $('date-label'),
  dateInput: $('date-input'),
  chart: $('chart'),
  toast: $('toast'),
  hint: $('hint'),
  alignmentCard: $('alignment-card'),
  alignmentWhen: $('alignment-when'),
  alignmentJump: $('alignment-jump'),
  alignmentClear: $('alignment-clear'),
  infoSunrise: $('info-sunrise'),
  infoSunriseAz: $('info-sunrise-az'),
  infoSunset: $('info-sunset'),
  infoSunsetAz: $('info-sunset-az'),
  infoNow: $('info-now'),
  infoNowAz: $('info-now-az'),
};

let map;
let lastDayKey = null;
let lastObserverKey = null;

async function main() {
  // Hash → store first, so initial center is correct.
  attachHashSync();

  // Try geolocation if no observer set from hash
  if (!hashHasObserver()) tryGeolocate();

  const init = store.get();
  map = initMap(dom.map, init.observer);

  await whenStyleReady(map);

  addObserverLayer(map, init.observer.lat, init.observer.lon);
  addSunPathLayer(map);
  addReflectionLayer(map);
  addTargetLayer(map);

  // Map interactions
  map.on('click', (e) => {
    // Single tap moves observer (avoids interfering with pan)
    if (e.originalEvent && e.originalEvent.target && e.originalEvent.target.closest('#topbar, #info, #modes, #bottom, #search-results')) return;
    store.set({ observer: { lat: e.lngLat.lat, lon: e.lngLat.lng } });
  });

  attachLongPress(map, (lngLat) => {
    store.set({ target: { lat: lngLat.lat, lon: lngLat.lng } });
    showToast('Target set — checking next alignment');
  });

  // UI
  initScrubber({
    scrubber: dom.scrubber, ticks: dom.scrubberTicks,
    playBtn: dom.playBtn, playIcon: dom.playIcon,
    hh: dom.hh, dateBtn: dom.dateBtn, dateLabel: dom.dateLabel, dateInput: dom.dateInput,
  });
  initSearch({ input: dom.search, results: dom.searchResults }, map);

  dom.modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      store.set({ mode });
    });
  });

  dom.compassBtn.addEventListener('click', async () => {
    if (store.get().compassEnabled) {
      disableCompass();
      dom.compassBtn.classList.remove('active');
      map.easeTo({ bearing: 0, duration: 400 });
    } else {
      const ok = await enableCompass();
      if (ok) {
        dom.compassBtn.classList.add('active');
        showToast('Compass on — rotate to align');
      } else {
        showToast('Compass denied or unavailable');
      }
    }
  });

  dom.shareBtn.addEventListener('click', async () => {
    const url = location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Sun', url });
      } else {
        await navigator.clipboard.writeText(url);
        showToast('Link copied');
      }
    } catch (e) { /* user cancelled */ }
  });

  dom.locateBtn.addEventListener('click', tryGeolocate);

  dom.alignmentJump.addEventListener('click', () => {
    if (alignmentResult && alignmentResult.eventTime) {
      store.set({ datetime: new Date(alignmentResult.eventTime) });
    }
  });
  dom.alignmentClear.addEventListener('click', () => {
    store.set({ target: null });
  });

  // Compass heading updates → rotate map
  store.subscribe('compassHeading', (heading) => {
    if (heading == null) return;
    map.setBearing(-heading);
  });

  // State subscriptions
  store.subscribeAll(throttleRaf((s, changed) => {
    redraw(s, changed);
  }));

  // First draw
  redraw(store.get(), ['observer', 'datetime', 'mode', 'target']);

  // Subtle hint: show once on first load if no target
  if (!store.get().target) {
    setTimeout(() => {
      dom.hint.hidden = false;
      setTimeout(() => { dom.hint.hidden = true; }, 4500);
    }, 1500);
  }
}

let alignmentResult = null;

function redraw(s, changed) {
  const observerChanged = changed.includes('observer');
  const datetimeChanged = changed.includes('datetime');
  const modeChanged = changed.includes('mode');
  const targetChanged = changed.includes('target');

  if (observerChanged) {
    setObserver(map, s.observer.lat, s.observer.lon);
  }

  // Day-level recompute when date or location changes
  const dayKey = startOfLocalDay(s.datetime).toDateString();
  const observerKey = `${s.observer.lat.toFixed(4)},${s.observer.lon.toFixed(4)}`;
  const dayLevelChanged = (dayKey !== lastDayKey) || (observerKey !== lastObserverKey);
  if (dayLevelChanged || observerChanged) {
    const t = updateSunPathDay(map, s.observer, s.datetime);
    updateReflectionDay(map, s.observer, s.datetime);
    renderChartDay(dom.chart, s.observer, s.datetime);
    renderScrubberTicks(dom.scrubberTicks, t.sunrise, t.sunset, s.datetime);
    updateInfoCard(s, t);
    lastDayKey = dayKey;
    lastObserverKey = observerKey;
  }

  // Per-frame: live sun + reflection + chart now-line
  updateSunNow(map, s.observer, s.datetime);
  updateReflectionNow(map, s.observer, s.datetime);
  updateChartNow(dom.chart, s.observer, s.datetime);
  updateNowText(s);

  if (modeChanged) {
    setReflectionVisible(map, s.mode === 'reflection');
    document.querySelectorAll('.mode-btn').forEach((b) => {
      const active = b.dataset.mode === s.mode;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  if (targetChanged || observerChanged) {
    setTarget(map, s.observer, s.target);
    refreshAlignment(s);
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
  const kind = result.kind === 'sunrise' ? '↑ Sunrise' : '↓ Sunset';
  const when = `${kind} · ${formatDate(ev)} ${formatTime(ev)}`;
  const days = result.deltaDays;
  const daysLabel = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  dom.alignmentWhen.innerHTML = `${escapeHtml(when)}<br><span style="color:rgba(243,244,246,0.5);font-size:11px;">${daysLabel} · az ${result.azimuth.toFixed(1)}°</span>`;
  dom.alignmentCard.hidden = false;
}

function updateInfoCard(s, t) {
  if (t.sunrise) {
    dom.infoSunrise.textContent = formatTime(t.sunrise);
    const az = getPosition(t.sunrise, s.observer.lat, s.observer.lon).azimuthDeg;
    dom.infoSunriseAz.textContent = `${Math.round(az)}°`;
  } else {
    dom.infoSunrise.textContent = '—';
    dom.infoSunriseAz.textContent = '';
  }
  if (t.sunset) {
    dom.infoSunset.textContent = formatTime(t.sunset);
    const az = getPosition(t.sunset, s.observer.lat, s.observer.lon).azimuthDeg;
    dom.infoSunsetAz.textContent = `${Math.round(az)}°`;
  } else {
    dom.infoSunset.textContent = '—';
    dom.infoSunsetAz.textContent = '';
  }
}

function updateNowText(s) {
  const p = getPosition(s.datetime, s.observer.lat, s.observer.lon);
  dom.infoNow.textContent = formatTime(s.datetime);
  if (s.mode === 'reflection') {
    const ra = reflectAzimuth(p.azimuthDeg);
    dom.infoNowAz.textContent = `↻ ${Math.round(ra)}° · ${p.altitudeDeg > 0 ? 'above' : 'below'}`;
  } else {
    dom.infoNowAz.textContent = `${Math.round(p.azimuthDeg)}° · ${p.altitudeDeg > 0 ? p.altitudeDeg.toFixed(1) + '°' : 'below'}`;
  }
}

function tryGeolocate() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      store.set({ observer: { lat: pos.coords.latitude, lon: pos.coords.longitude } });
      if (map) map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: Math.max(map.getZoom(), 13), duration: 900 });
    },
    () => { /* ignore */ },
    { enableHighAccuracy: false, timeout: 6000, maximumAge: 60000 },
  );
}

function hashHasObserver() {
  return /[#&]ll=/.test(location.hash);
}

function attachLongPress(map, cb) {
  let timer = null;
  let startPos = null;
  let cancelled = false;

  const start = (e) => {
    cancelled = false;
    const lngLat = e.lngLat;
    const point = e.point;
    startPos = point;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (!cancelled) cb(lngLat);
    }, 550);
  };
  const move = (e) => {
    if (!startPos) return;
    const dx = e.point.x - startPos.x;
    const dy = e.point.y - startPos.y;
    if (Math.hypot(dx, dy) > 6) cancelled = true;
  };
  const end = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    startPos = null;
  };

  map.on('mousedown', start);
  map.on('mousemove', move);
  map.on('mouseup', end);
  map.on('touchstart', start);
  map.on('touchmove', move);
  map.on('touchend', end);
  map.on('dragstart', () => { cancelled = true; if (timer) { clearTimeout(timer); timer = null; } });
}

let toastTimer = null;
function showToast(msg) {
  dom.toast.textContent = msg;
  dom.toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { dom.toast.hidden = true; }, 2200);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

main().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<div style="padding:20px;color:#fff;">Failed to start: ${e.message}</div>`;
});
