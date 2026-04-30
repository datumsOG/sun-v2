// Reflection vector math.
// Assumption: a horizontal mirror surface at the observer's location
// (water surface). For a horizontal mirror, the reflected ray's azimuth
// is exactly 180 degrees from the source, and the elevation is mirrored
// across the horizontal plane.

export function reflectAzimuth(sunAzimuthDeg) {
  return (sunAzimuthDeg + 180) % 360;
}

export function reflectElevation(sunElevationDeg) {
  return -sunElevationDeg;
}
