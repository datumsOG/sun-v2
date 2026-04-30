// MapLibre setup using OpenFreeMap (no API key, no signup).

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

export function initMap(container, center) {
  const map = new maplibregl.Map({
    container,
    style: STYLE_URL,
    center: [center.lon, center.lat],
    zoom: 12.5,
    attributionControl: false,
    pitchWithRotate: false,
    dragRotate: true,
    maxPitch: 70,
  });

  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

  return map;
}

export function whenStyleReady(map) {
  return new Promise((resolve) => {
    if (map.isStyleLoaded()) resolve();
    else map.once('styledata', () => resolve());
  });
}
