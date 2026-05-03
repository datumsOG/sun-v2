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

/**
 * Project a 3D world point (lng, lat, altitude in METRES) to screen pixels.
 *
 * Strategy: work entirely in METRES. Find the camera's lng/lat and altitude,
 * convert both camera and body to local east/north metres around the body's
 * ground point, cast a ray from camera through the body to the z=0 plane,
 * convert the apparent ground point back to lng/lat, and project that with
 * map.project(). Final pixel comes from MapLibre's own projection on a ground
 * point, so perspective is correct by definition.
 */
const EARTH_R_M = 6371008.8;
const EARTH_CIRC_M = 2 * Math.PI * EARTH_R_M;

function _cameraPosition(map) {
  // Preferred: public free-camera API; convert position.z (mercator units) → metres.
  try {
    if (typeof map.getFreeCameraOptions === 'function') {
      const o = map.getFreeCameraOptions();
      if (o && o.position && typeof o.position.toLngLat === 'function') {
        const ll = o.position.toLngLat();
        const circAtLat = EARTH_CIRC_M * Math.cos(ll.lat * Math.PI / 180);
        const altM = o.position.z * circAtLat;
        if (Number.isFinite(altM) && altM > 0) {
          return { lng: ll.lng, lat: ll.lat, altM };
        }
      }
    }
  } catch (_) {}

  // Fallback: derive camera from transform (cameraToCenterDistance + pitch + bearing).
  const t = map.transform;
  const center = map.getCenter();
  const camDistPx = t && t.cameraToCenterDistance;
  if (!camDistPx || !center) return null;
  const pitchRad = map.getPitch() * Math.PI / 180;
  const mPerPx = 156543.03392 * Math.cos(center.lat * Math.PI / 180) / Math.pow(2, map.getZoom());
  const altM = camDistPx * Math.cos(pitchRad) * mPerPx;
  const offsetM = camDistPx * Math.sin(pitchRad) * mPerPx;
  // Camera ground point sits behind the map center along (bearing + 180).
  const back = (map.getBearing() + 180) % 360;
  const [lng, lat] = destination(center.lat, center.lng, back, offsetM / 1000);
  return { lng, lat, altM };
}

export function project3D(map, lng, lat, altMeters) {
  if (!altMeters || Math.abs(altMeters) < 1e-6) return map.project([lng, lat]);

  const cam = _cameraPosition(map);
  if (!cam) return map.project([lng, lat]);

  // Camera must be above body for the ground-intersection trick to make sense.
  if (cam.altM <= altMeters + 1e-3) return map.project([lng, lat]);

  // Convert camera offset from body's ground point into local east/north metres.
  const cosLat = Math.cos(lat * Math.PI / 180);
  const M_PER_DEG = EARTH_CIRC_M / 360; // ≈ 111195
  const camDx = (cam.lng - lng) * M_PER_DEG * cosLat;
  const camDy = (cam.lat - lat) * M_PER_DEG;

  // Ray (cam) → (body at altMeters above body-ground = origin), continued to z=0:
  // apparent_xy = camDxy * (1 - t) with t = camAltM / (camAltM - altMeters)
  const tParam = cam.altM / (cam.altM - altMeters);
  const apX = camDx * (1 - tParam);
  const apY = camDy * (1 - tParam);

  const apLng = lng + apX / (M_PER_DEG * cosLat);
  const apLat = lat + apY / M_PER_DEG;
  return map.project([apLng, apLat]);
}
