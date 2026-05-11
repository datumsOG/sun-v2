// MapLibre setup using OpenFreeMap (no API key, no signup).
// Terrain elevation uses AWS Terrain Tiles (Terrarium format, public, no key).

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export function initMap(container, center) {
  const map = new maplibregl.Map({
    container,
    style: STYLE_URL,
    center: [center.lon, center.lat],
    zoom: 14,
    pitch: 55,
    attributionControl: false,
    dragRotate: true,
    pitchWithRotate: true,
    maxPitch: 75,
    maxZoom: 24, // allows ~4 m view in grid mode
  });
  if (map.touchPitch && typeof map.touchPitch.enable === 'function') {
    try { map.touchPitch.enable(); } catch {}
  }
  // Brighten labels (pure white with dark halo) once the style is up.
  map.on('load', () => brightenLabels(map));
  map.on('styledata', () => brightenLabels(map));
  return map;
}

function brightenLabels(map) {
  // Only override label text colour — leave all line/fill/background paint
  // properties from the upstream style untouched.
  try {
    const layers = map.getStyle().layers || [];
    for (const layer of layers) {
      if (layer.type !== 'symbol') continue;
      try { map.setPaintProperty(layer.id, 'text-color', '#ffffff'); } catch {}
      try { map.setPaintProperty(layer.id, 'text-halo-color', 'rgba(0,0,0,0.85)'); } catch {}
      try { map.setPaintProperty(layer.id, 'text-halo-width', 1.4); } catch {}
    }
  } catch {}
}

/**
 * Add Terrarium DEM source for elevation queries.
 * exaggeration:0 keeps the map visually flat so SVG overlays stay aligned,
 * while still allowing queryTerrainElevation() for terrain-aware shadows.
 * Safe to call multiple times; no-op if terrain already set.
 */
export function addTerrain(map) {
  try {
    if (!map.getSource('terrain-dem')) {
      map.addSource('terrain-dem', {
        type: 'raster-dem',
        tiles: [TERRAIN_TILES],
        tileSize: 256,
        encoding: 'terrarium',
        maxzoom: 14,
      });
    }
    map.setTerrain({ source: 'terrain-dem', exaggeration: 0 });
  } catch (e) {
    console.warn('terrain setup failed', e);
  }
}

export function whenStyleReady(map) {
  return new Promise((resolve) => {
    if (map.isStyleLoaded()) resolve();
    else map.once('styledata', () => resolve());
  });
}
