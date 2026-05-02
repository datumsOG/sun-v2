// MapLibre setup using OpenFreeMap (no API key, no signup).

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

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

export function whenStyleReady(map) {
  return new Promise((resolve) => {
    if (map.isStyleLoaded()) resolve();
    else map.once('styledata', () => resolve());
  });
}
