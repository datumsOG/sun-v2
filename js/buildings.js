// Building obstruction: approximate sun-ray intersection test using
// map-rendered building polygons (OpenMapTiles source-layer "building").
// No external API — uses features already loaded in the visible viewport.

import { destination } from './util.js';

const LEVEL_H    = 3;   // metres per floor
const DEFAULT_H  = 12;  // fallback height when no data

function buildingHeight(props) {
  if (!props) return DEFAULT_H;
  for (const k of ['height', 'building:height', 'render_height']) {
    if (props[k] && +props[k] > 0) return +props[k];
  }
  for (const k of ['levels', 'building:levels', 'render_min_height']) {
    if (props[k] && +props[k] > 0) return +props[k] * LEVEL_H;
  }
  return DEFAULT_H;
}

/**
 * Walk the sun ray from observer and return the first building that blocks it.
 * Returns { distanceM, height } or null.
 *
 * sunAzDeg  — compass bearing TOWARD the sun
 * sunElDeg  — sun elevation above horizon
 * maxDistM  — metres to search along the ray (default 500)
 */
export function findBuildingObstruction(map, observer, sunAzDeg, sunElDeg, maxDistM = 500) {
  if (sunElDeg < 0.5) return null;

  // Query buildings from the full visible canvas
  const { width: cw, height: ch } = map.getCanvas();
  const allFeatures = map.queryRenderedFeatures([[0, 0], [cw, ch]]);
  const buildings = allFeatures.filter((f) => f.sourceLayer === 'building');
  if (!buildings.length) return null;

  const stepM = 15;
  const steps = Math.ceil(maxDistM / stepM);
  const tanEl = Math.tan(sunElDeg * Math.PI / 180);

  for (let i = 1; i <= steps; i++) {
    const d = i * stepM;
    const [pLon, pLat] = destination(observer.lat, observer.lon, sunAzDeg, d / 1000);
    const rayH = d * tanEl; // height of ray above observer at distance d

    for (const feat of buildings) {
      const h = buildingHeight(feat.properties);
      if (h <= rayH) continue; // building too short to block ray here
      if (pointInFeature(pLon, pLat, feat.geometry)) {
        return { distanceM: d, height: h };
      }
    }
  }
  return null;
}

function pointInFeature(lon, lat, geom) {
  if (!geom) return false;
  const pt = [lon, lat];
  if (geom.type === 'Polygon') return pip(pt, geom.coordinates[0]);
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.some((poly) => pip(pt, poly[0]));
  }
  return false;
}

// Ray-casting point-in-polygon (Jordan curve theorem)
function pip([px, py], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
