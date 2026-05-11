// Lightweight DEM elevation lookup using AWS Terrarium tiles.
// Fetches tiles on demand, decodes Terrarium RGB encoding, caches results.
//
// Usage pattern:
//   getElevationSync(lng, lat)  → cached metres, or 0 while tile loading
//   prefetchElevation(lng, lat) → fire-and-forget; warms the cache
//   setElevationCallback(cb)    → cb() called when new data arrives so
//                                 callers can re-run calculations

const ZOOM = 11; // ~38 m/px at equator; tile covers ~20 km × 20 km
const TILE_BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

const _tileCache   = new Map(); // url  → ImageData | null
const _tilePromise = new Map(); // url  → Promise<ImageData|null>
const _elevCache   = new Map(); // pixel-key → metres

let _onUpdate = null;

function _tileXY(lng, lat) {
  const n = 1 << ZOOM;
  const x = Math.floor((lng + 180) / 360 * n);
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

function _pixelXY(lng, lat) {
  const n = 1 << ZOOM;
  const fx = (lng + 180) / 360 * n;
  const latRad = lat * Math.PI / 180;
  const fy = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  return { px: Math.floor((fx % 1) * 256), py: Math.floor((fy % 1) * 256) };
}

function _key(lng, lat) {
  const { x, y } = _tileXY(lng, lat);
  const { px, py } = _pixelXY(lng, lat);
  return `${x}:${y}:${px}:${py}`;
}

async function _loadTile(url) {
  if (_tileCache.has(url)) return _tileCache.get(url);
  if (_tilePromise.has(url)) return _tilePromise.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, 256, 256));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  _tilePromise.set(url, p);
  const data = await p;
  _tilePromise.delete(url);
  _tileCache.set(url, data);
  return data;
}

async function _fetch(lng, lat) {
  const key = _key(lng, lat);
  if (_elevCache.has(key)) return;
  const { x, y } = _tileXY(lng, lat);
  const data = await _loadTile(`${TILE_BASE}/${ZOOM}/${x}/${y}.png`);
  if (!data) { _elevCache.set(key, 0); return; }
  const { px, py } = _pixelXY(lng, lat);
  const i = (py * 256 + px) * 4;
  const d = data.data;
  _elevCache.set(key, d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768);
  if (_onUpdate) _onUpdate();
}

/** Returns cached elevation in metres, or 0 if not yet loaded. */
export function getElevationSync(lng, lat) {
  return _elevCache.get(_key(lng, lat)) ?? 0;
}

/** Start fetching elevation; fires the registered callback when ready. */
export function prefetchElevation(lng, lat) {
  _fetch(lng, lat).catch(() => {});
}

/** Register a callback to fire when new elevation data is cached. */
export function setElevationCallback(cb) {
  _onUpdate = cb;
}
