import { isFreshFix } from './geo';
import type { GeoFix, UsageToday } from './native';

/**
 * Volatile, process-lifetime holder for the latest device readings. background.ts
 * (real builds) writes them from the native module; engine.ts reads them when
 * assembling context. Kept native-free on purpose — engine imports this, and
 * must never transitively import expo-notifications (crashes Expo Go at load).
 */

let geo: GeoFix | null = null;
let geoReadAt = 0; // when we last cached `geo` — its own ageMs is frozen at read time
let usage: UsageToday | null = null;
let lastUsageCheckAt = 0;

export const setLiveGeo = (g: GeoFix | null): void => {
  geo = g;
  geoReadAt = Date.now();
};
export const getLiveGeo = (): GeoFix | null => geo;

/** The cached fix ONLY if it's still fresh — counts both the native fix age AND
 *  how long it has since sat in this cache (else a stale position leaks). */
export const getLiveGeoFresh = (maxAgeMs = 6 * 3600000): GeoFix | null => {
  if (!geo) return null;
  const effective: GeoFix = { ...geo, ageMs: geo.ageMs + (Date.now() - geoReadAt) };
  return isFreshFix(effective, maxAgeMs) ? geo : null;
};

export const setLiveUsage = (u: UsageToday | null): void => {
  usage = u;
};
export const getLiveUsage = (): UsageToday | null => usage;

export const getLastUsageCheckAt = (): number => lastUsageCheckAt;
export const markUsageChecked = (now: number): void => {
  lastUsageCheckAt = now;
};
