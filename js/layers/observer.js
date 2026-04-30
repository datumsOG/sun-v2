// Observer pin: a glowing white dot with concentric ring.

const SRC = 'observer-src';
const RING = 'observer-ring';
const PIN = 'observer-pin';

export function addObserverLayer(map, lat, lon) {
  if (map.getSource(SRC)) return;
  map.addSource(SRC, {
    type: 'geojson',
    data: pointFC(lon, lat),
  });
  map.addLayer({
    id: RING,
    type: 'circle',
    source: SRC,
    paint: {
      'circle-radius': 18,
      'circle-color': '#ffffff',
      'circle-opacity': 0.10,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.2,
      'circle-stroke-opacity': 0.4,
    },
  });
  map.addLayer({
    id: PIN,
    type: 'circle',
    source: SRC,
    paint: {
      'circle-radius': 7,
      'circle-color': '#ffffff',
      'circle-stroke-color': '#0b0e14',
      'circle-stroke-width': 2,
    },
  });
}

export function setObserver(map, lat, lon) {
  const src = map.getSource(SRC);
  if (src) src.setData(pointFC(lon, lat));
}

function pointFC(lon, lat) {
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {} }],
  };
}
