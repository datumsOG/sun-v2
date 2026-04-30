// Time scrubber + play button + date picker integration.

import * as store from '../state.js';
import { withMinutes, minutesOfDay, startOfLocalDay, formatDate, throttleRaf } from '../util.js';

let playing = false;
let rafId = null;
let lastTickTs = 0;

export function initScrubber(els) {
  const { scrubber, ticks, playBtn, playIcon, hh, dateBtn, dateLabel, dateInput } = els;

  // Scrubber → store.datetime (throttled)
  const apply = throttleRaf(() => {
    const v = +scrubber.value;
    const d = withMinutes(store.get().datetime, v);
    store.set({ datetime: d });
    hh.textContent = formatHHMM(v);
  });
  scrubber.addEventListener('input', apply);

  // Initial value
  scrubber.value = String(minutesOfDay(store.get().datetime));
  hh.textContent = formatHHMM(+scrubber.value);

  // Play / stop
  playBtn.addEventListener('click', () => {
    playing ? stopPlay(playIcon) : startPlay(scrubber, hh, playIcon);
  });

  // Date picker
  dateBtn.addEventListener('click', () => {
    if (typeof dateInput.showPicker === 'function') dateInput.showPicker();
    else dateInput.click();
  });
  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    const [y, m, d] = dateInput.value.split('-').map(Number);
    const cur = store.get().datetime;
    const newDate = new Date(cur);
    newDate.setFullYear(y, m - 1, d);
    store.set({ datetime: newDate });
  });

  // React to external datetime changes (e.g. from share link, alignment jump)
  store.subscribe('datetime', (d) => {
    const m = minutesOfDay(d);
    if (+scrubber.value !== m) scrubber.value = String(m);
    hh.textContent = formatHHMM(m);
    dateLabel.textContent = formatDate(startOfLocalDay(d));
    const isoDate = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    dateInput.value = isoDate;
  });

  dateLabel.textContent = formatDate(startOfLocalDay(store.get().datetime));
}

export function renderScrubberTicks(ticksEl, sunrise, sunset, day) {
  if (!ticksEl) return;
  ticksEl.innerHTML = '';
  if (!day) return;
  const dayStart = startOfLocalDay(day).getTime();
  const make = (date, cls) => {
    const x = ((date.getTime() - dayStart) / 86400000) * 100;
    const t = document.createElement('div');
    t.className = 'tick ' + cls;
    t.style.left = `${x.toFixed(2)}%`;
    ticksEl.appendChild(t);
  };
  if (sunrise) make(sunrise, 'sunrise');
  if (sunset) make(sunset, 'sunset');
}

function startPlay(scrubber, hh, icon) {
  playing = true;
  icon.innerHTML = '<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>';
  lastTickTs = 0;
  const tick = (ts) => {
    if (!playing) return;
    if (lastTickTs === 0) lastTickTs = ts;
    const dt = ts - lastTickTs;
    lastTickTs = ts;
    // Advance ~3 game-minutes per real-frame at 60fps (~3min/16ms)
    const advanceMin = (dt / 16.6) * 3;
    let v = +scrubber.value + advanceMin;
    if (v >= 1440) v = 0;
    scrubber.value = String(v);
    const d = withMinutes(store.get().datetime, v);
    store.set({ datetime: d });
    hh.textContent = formatHHMM(v);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function stopPlay(icon) {
  playing = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  icon.innerHTML = '<path d="M7 4l13 8-13 8z" fill="currentColor"/>';
}

function pad(n) { return String(n).padStart(2, '0'); }

function formatHHMM(totalMinutes) {
  const m = Math.round(totalMinutes);
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${pad(h)}:${pad(mm)}`;
}
