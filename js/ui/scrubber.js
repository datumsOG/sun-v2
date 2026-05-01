// Time scrubber + date picker integration.

import * as store from '../state.js';
import { withMinutes, minutesOfDay, startOfLocalDay, formatDate, throttleRaf } from '../util.js';

export function initScrubber(els) {
  const { scrubber, ticks, hh, dateBtn, dateLabel, dateInput } = els;

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

function pad(n) { return String(n).padStart(2, '0'); }

function formatHHMM(totalMinutes) {
  const m = Math.round(totalMinutes);
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${pad(h)}:${pad(mm)}`;
}
