import { isExpoGo } from './env';

/**
 * Guarded access to the LoveseekNative local module (Kotlin, modules/loveseek-native).
 * The module exists only in real APK builds — Expo Go and jest get `null`, and
 * every caller must handle that.
 */

export interface ForegroundApp {
  packageName: string;
  label: string;
  self: boolean; // is LoveSeek itself in front?
}

export interface AppRef {
  packageName: string;
  label: string;
}

export interface UsageToday {
  totalMinutes: number;
  apps: { label: string; minutes: number }[];
}

export interface GeoFix {
  lat: number;
  lng: number;
  city: string; // '' when reverse-geocode failed (common on de-Googled ROMs)
  ageMs: number;
}

export interface LoveseekNative {
  startKeepAlive(title: string, text: string): boolean;
  stopKeepAlive(): void;
  isKeepAliveRunning(): boolean;
  hasUsageAccess(): boolean;
  openUsageAccessSettings(): void;
  getForegroundApp(): ForegroundApp | null;
  getForegroundAppsSince(startMs: number): AppRef[];
  getUsageToday(): UsageToday | null;
  getLocation(): GeoFix | null;
  isIgnoringBatteryOptimizations(): boolean;
  requestIgnoreBatteryOptimizations(): boolean;
  isInteractive(): boolean; // screen on?
  addListener(event: 'onTick', fn: () => void): { remove(): void };
}

let mod: LoveseekNative | null = null;
if (!isExpoGo) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireNativeModule } = require('expo-modules-core') as typeof import('expo-modules-core');
    mod = requireNativeModule('LoveseekNative');
  } catch {
    mod = null; // build without the module (jest, older APK)
  }
}

export const native = mod;
