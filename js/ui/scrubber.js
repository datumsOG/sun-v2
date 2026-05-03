// Time scrubber + date picker.
//
// In sun mode the slider runs 0..1439 (minutes of local day).
// In moon mode the slider runs 0..(set - rise in minutes), with the value
// representing the number of minutes after the active moonrise — so the
// left edge = moonrise and the right edge = moonset.

import * as store from '../state.js';
import { withMinutes, minutesOfDay, startOfLocalDay, formatDate, throttleRaf } from '../util.js';

let scrubberRange = { mode: 'sun', moonRise: null, moonSet: null };

export function setScrubberRange(els, mode, moonRise = null, moonSet = null) {
  scrubberRange = { mode, moonRise, moonSet };
  if (!els || !els.scrubber) return;
  if (mode === 'moon' && moonRise && moonSet && moonSet > moonRise) {
    const span = Math.max(1, Math.round((moonSet - moonRise) / 60000));
    els.scrubber.min = '0';
    els.scrubber.max = String(span);
    els.scrubber.step = '1';
  } else {
    els.scrubber.min = '0';
    els.scrubber.max = '1439';
    els.scrubber.step = '1';
  }
}

export function initScrubber(els) {
  const { scrubber, hh, dateBtn, dateLabel, dateInput } = els;

  const apply = throttleRaf(() => {
    const v = +scrubber.value;
    let d;
    if (scrubberRange.mode === 'moon' && scrubberRange.moonRise) {
      d = new Date(scrubberRange.moonRise.getTime() + v * 60000);
    } else {
      d = withMinutes(store.get().datetime, v);
    }
    store.set({ datetime: d });
    hh.textContent = formatHHMM(d);
  });
  scrubber.addEventListener('input', apply);

  // Default scrubber to current time
  scrubber.value = String(minutesOfDay(store.get().datetime));
  hh.textContent = formatHHMM(store.get().datetime);

  // dateBtn is a <label for="date-input"> — native label activation opens the
  // date picker on all platforms without JS. No click handler needed here.
  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    const [y, m, d] = dateInput.value.split('-').map(Number);
    const cur = store.get().datetime;
    const newDate = new Date(cur);
    newDate.setFullYear(y, m - 1, d);
    store.set({ datetime: newDate });
  });

  store.subscribe('datetime', (d) => {
    let v;
    if (scrubberRange.mode === 'moon' && scrubberRange.moonRise) {
      v = Math.round((d - scrubberRange.moonRise) / 60000);
    } else {
      v = minutesOfDay(d);
    }
    if (+scrubber.value !== v) scrubber.value = String(v);
    hh.textContent = formatHHMM(d);
    dateLabel.textContent = formatDate(startOfLocalDay(d));
    const isoDate = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    dateInput.value = isoDate;
  });

  dateLabel.textContent = formatDate(startOfLocalDay(store.get().datetime));
}

export function renderScrubberTicks(ticksEl, rise, set, day) {
  if (!ticksEl) return;
  ticksEl.innerHTML = '';
  if (!day) return;

  if (scrubberRange.mode === 'moon' && scrubberRange.moonRise && scrubberRange.moonSet) {
    // In moon mode the slider IS rise→set, so left tick = 0% and right tick = 100%
    addTick(ticksEl, 0, 'sunrise');
    addTick(ticksEl, 100, 'sunset');
    return;
  }
  const dayStart = startOfLocalDay(day).getTime();
  const dayMs = 86400000;
  const make = (date, cls) => {
    if (!date) return;
    const offset = date.getTime() - dayStart;
    if (offset < 0 || offset > dayMs) return;
    addTick(ticksEl, (offset / dayMs) * 100, cls);
  };
  make(rise, 'sunrise');
  make(set, 'sunset');
}

function addTick(ticksEl, pct, cls) {
  const t = document.createElement('div');
  t.className = 'tick ' + cls;
  t.style.left = `${pct.toFixed(2)}%`;
  ticksEl.appendChild(t);
}

export function setMoonPhaseMarker(el, illum) {
  if (!el) return;
  if (!illum) { el.hidden = true; return; }
  el.hidden = false;
  const p = illum.phase;
  let clip;
  if (p < 0.25) {
    const k = (0.25 - p) / 0.25;
    clip = `inset(0 0 0 ${50 - 50 * k}%)`;
  } else if (p < 0.5) {
    const k = (0.5 - p) / 0.25;
    clip = `inset(0 ${100 - 50 * k}% 0 0)`;
  } else if (p < 0.75) {
    const k = (p - 0.5) / 0.25;
    clip = `inset(0 0 0 ${100 - 50 * k}%)`;
  } else {
    const k = (p - 0.75) / 0.25;
    clip = `inset(0 ${50 - 50 * k}% 0 0)`;
  }
  el.style.setProperty('--moon-clip', clip);
}

function pad(n) { return String(n).padStart(2, '0'); }

function formatHHMM(d) {
  if (!(d instanceof Date)) {
    const m = Math.round(d);
    const h = Math.floor(m / 60) % 24;
    const mm = m % 60;
    return `${pad(h)}:${pad(mm)}`;
  }
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
