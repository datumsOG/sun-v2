// Utility helpers.

const EARTH_RADIUS_KM = 6371;

/** Project from (lat, lon) by `distanceKm` along compass `bearingDeg`. */
export function destination(lat, lon, bearingDeg, distanceKm) {
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const brng = (bearingDeg * Math.PI) / 180;
  const ang = distanceKm / EARTH_RADIUS_KM;
  const sinLat1 = Math.sin(lat1), cosLat1 = Math.cos(lat1);
  const sinAng = Math.sin(ang), cosAng = Math.cos(ang);
  const sinLat2 = sinLat1 * cosAng + cosLat1 * sinAng * Math.cos(brng);
  const lat2 = Math.asin(sinLat2);
  const lon2 = lon1 + Math.atan2(
    Math.sin(brng) * sinAng * cosLat1,
    cosAng - sinLat1 * sinLat2,
  );
  return [((lon2 * 180 / Math.PI) + 540) % 360 - 180, (lat2 * 180) / Math.PI];
}

/** Compass bearing from (lat1, lon1) to (lat2, lon2). */
export function bearing(lat1, lon1, lat2, lon2) {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

/** Smallest signed delta from a→b in degrees, in (-180, 180]. */
export function azDelta(a, b) {
  let d = ((b - a + 540) % 360) - 180;
  return d;
}

export function formatTime(date) {
  if (!date || isNaN(date)) return '—';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatDate(date) {
  if (!date || isNaN(date)) return '—';
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return 'Today';
  // "01 Feb 2026" format
  const dd = String(date.getDate()).padStart(2, '0');
  const mon = date.toLocaleString('en', { month: 'short' });
  const yyyy = date.getFullYear();
  return `${dd} ${mon} ${yyyy}`;
}

export function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

export function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function throttleRaf(fn) {
  let pending = false, lastArgs = null;
  return (...args) => {
    lastArgs = args;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      fn(...lastArgs);
    });
  };
}

/** Replace today's date with the given Date's HH:MM, returning a new Date. */
export function withTime(baseDate, hours, minutes) {
  const d = new Date(baseDate);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

export function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

export function withMinutes(baseDate, totalMinutes) {
  const d = new Date(baseDate);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(totalMinutes);
  return d;
}

export function startOfLocalDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
