import type { GeoFix } from './native';

/**
 * Location / timezone context. The stated bug: she thought the user was "up
 * late in the US" because nothing told her WHERE (and which timezone) the user
 * is. The bulletproof fix is the device timezone; continuous location adds the
 * city on top. Pure formatting here; the native read lives in background.ts.
 */

/** Device IANA timezone, e.g. 'Asia/Shanghai'. '' if unavailable. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

/** A stale fix is worse than none — older than this, drop it (default 6h). */
export function isFreshFix(fix: GeoFix | null, maxAgeMs = 6 * 3600000): boolean {
  return !!fix && fix.ageMs <= maxAgeMs;
}

/**
 * Pure. The location/timezone line for 【当前状态】. `manualPlace` (a user-set
 * city) wins over a reverse-geocoded one. `fix` must already be vetted-fresh by
 * the caller (livestate.getLiveGeoFresh). We emit ONLY a city name, never raw
 * coordinates — consent is for city-level location, and ~1km coords would
 * exceed that promise. Timezone always emits so the model stops guessing.
 */
export function buildPlaceLine(args: {
  tz: string;
  fix: GeoFix | null;
  manualPlace?: string | null;
}): string | null {
  const place = args.manualPlace?.trim() || args.fix?.city.trim() || '';
  const bits: string[] = [];
  if (place) bits.push(`所在地：${place}`);
  if (args.tz) bits.push(`时区：${args.tz}`);
  if (bits.length === 0) return null;
  // The '当地时间' framing is the actual anti-'staying up late' fix.
  return bits.join('，') + '（上面的时间就是用户的当地时间，请据此判断早晚作息）';
}
