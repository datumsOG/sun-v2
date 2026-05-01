// Terrain elevation sampling via AWS Open Terrain Tiles (Terrarium RGB format, no API key).
// Terrarium encoding: elevation = (R * 256 + G + B / 256) - 32768 meters.

import { destination } from './util.js';

const TILE_Z = 12;          // ~10m/px at equator — good balance of resolution vs tile count
const tileCache = new Map(); // key → ImageData | Promise<ImageData|null>

// ── Tile coordinate math ──────────────────────────────────────────────────────

function lonLatToTile(lon, lat, z) {
  const n = 1 << z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = lat * Math.PI / 180;
  const y = Math.floor(
    (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n,
  );
  return { x, y, z };
}

function pixelInTile(lon, lat, z, tileX, tileY, size = 256) {
  const n = 1 << z;
  const px = (((lon + 180) / 360) * n - tileX) * size;
  const latRad = lat * Math.PI / 180;
  const py = (
    (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n - tileY
  ) * size;
  return {
    px: Math.max(0, Math.min(size - 1, px | 0)),
    py: Math.max(0, Math.min(size - 1, py | 0)),
  };
}

// ── Tile loading ──────────────────────────────────────────────────────────────

async function loadTile(x, y, z) {
  const key = `${z}/${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);

  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height);
      tileCache.set(key, data); // replace promise with resolved data
      resolve(data);
    };
    img.onerror = () => { tileCache.delete(key); resolve(null); };
    img.src = url;
  });

  tileCache.set(key, p);
  return p;
}

function samplePixel(data, px, py) {
  const i = (py * data.width + px) * 4;
  const r = data.data[i], g = data.data[i + 1], b = data.data[i + 2];
  return (r * 256 + g + b / 256) - 32768;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Fetch elevation (meters) at a single lat/lon. */
export async function getElevation(lat, lon) {
  const { x, y, z } = lonLatToTile(lon, lat, TILE_Z);
  const data = await loadTile(x, y, z);
  if (!data || !(data instanceof ImageData)) return 0;
  const { px, py } = pixelInTile(lon, lat, z, x, y);
  return samplePixel(data, px, py);
}

/**
 * Sample elevation along a ray from (lat, lon) in bearingDeg direction.
 * Prefetches all needed tiles in parallel for performance.
 * Returns Array of { distance (m), elevation (m) }.
 */
export async function sampleElevationAlongLine(lat, lon, bearingDeg, distanceM, stepM = 25) {
  const steps = Math.ceil(distanceM / stepM) + 1;

  // Build point list and collect unique tiles
  const points = [];
  const tilesToFetch = new Map();
  for (let i = 0; i < steps; i++) {
    const d = Math.min(i * stepM, distanceM);
    const [pLon, pLat] = destination(lat, lon, bearingDeg, d / 1000);
    const tile = lonLatToTile(pLon, pLat, TILE_Z);
    const key = `${tile.z}/${tile.x}/${tile.y}`;
    if (!tilesToFetch.has(key)) tilesToFetch.set(key, tile);
    points.push({ d, lat: pLat, lon: pLon });
  }

  // Prefetch all tiles in parallel
  await Promise.all([...tilesToFetch.values()].map(({ x, y, z }) => loadTile(x, y, z)));

  // Sample synchronously from cached data
  return points.map(({ d, lat: pLat, lon: pLon }) => {
    const { x, y, z } = lonLatToTile(pLon, pLat, TILE_Z);
    const key = `${z}/${x}/${y}`;
    const data = tileCache.get(key);
    if (!data || !(data instanceof ImageData)) return { distance: d, elevation: 0 };
    const { px, py } = pixelInTile(pLon, pLat, z, x, y);
    return { distance: d, elevation: samplePixel(data, px, py) };
  });
}
