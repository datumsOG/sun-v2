// Find next date when sunrise (or sunset) azimuth aligns with a target bearing.
// Brute-force one day at a time. Sub-millisecond per call so 365 days is fine.

import { getDayBoundaries, getPosition } from './solar.js';

const ONE_DAY = 86400000;

/**
 * @param {{lat:number, lon:number}} observer
 * @param {number} targetAzDeg compass bearing 0..360
 * @param {number} toleranceDeg
 * @param {Date} fromDate
 * @param {'sunrise'|'sunset'|'either'} kind
 * @returns {{date: Date, eventTime: Date, kind: string, azimuth: number, deltaDays: number} | null}
 */
export function findNextAlignment(observer, targetAzDeg, toleranceDeg, fromDate, kind = 'either') {
  const { lat, lon } = observer;
  const start = new Date(fromDate); start.setHours(12, 0, 0, 0);
  let bestSunrise = null, bestSunset = null;

  for (let d = 0; d < 366; d++) {
    const day = new Date(start.getTime() + d * ONE_DAY);
    const t = getDayBoundaries(day, lat, lon);

    if ((kind === 'sunrise' || kind === 'either') && t.sunrise && !bestSunrise) {
      const az = getPosition(t.sunrise, lat, lon).azimuthDeg;
      if (Math.abs(angDelta(targetAzDeg, az)) <= toleranceDeg) {
        bestSunrise = { date: day, eventTime: t.sunrise, kind: 'sunrise', azimuth: az, deltaDays: d };
      }
    }
    if ((kind === 'sunset' || kind === 'either') && t.sunset && !bestSunset) {
      const az = getPosition(t.sunset, lat, lon).azimuthDeg;
      if (Math.abs(angDelta(targetAzDeg, az)) <= toleranceDeg) {
        bestSunset = { date: day, eventTime: t.sunset, kind: 'sunset', azimuth: az, deltaDays: d };
      }
    }
    if (bestSunrise && bestSunset) break;
    if (kind === 'sunrise' && bestSunrise) break;
    if (kind === 'sunset' && bestSunset) break;
  }

  // Pick the soonest if both
  const candidates = [bestSunrise, bestSunset].filter(Boolean);
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.deltaDays - b.deltaDays);
  return candidates[0];
}

function angDelta(a, b) {
  return ((b - a + 540) % 360) - 180;
}
