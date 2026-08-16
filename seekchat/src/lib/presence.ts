import type { AppRef } from './native';

/**
 * App presence + catch-up-on-return. True background execution is unreliable
 * on de-Googled CN ROMs (RN freezes JS in the background, and the ROM kills
 * the process), so the RELIABLE 屏幕窥视 path is: when the user returns to
 * LoveSeek, replay what they did while away and let her react. Pure selection
 * logic here; the AppState wiring lives in _layout.tsx.
 */

/** Below this, the trip away was too short to be worth a catch-up remark. */
export const CATCHUP_MIN_AWAY_MS = 90_000;

/**
 * Pick the app worth commenting on from the apps opened while away. Native
 * returns them most-recent LAST and already drops system/self, so the last
 * entry is the freshest real app. null when there's nothing.
 */
export function pickCatchupApp(apps: AppRef[]): AppRef | null {
  return apps.length ? apps[apps.length - 1] : null;
}

/**
 * Should a return fire a catch-up reaction? Needs: away long enough, a real
 * app seen, and past the per-persona cooldown (shared with live watch).
 */
export function shouldCatchup(args: {
  awayMs: number;
  app: AppRef | null;
  lastReactAt: number;
  cooldownMs: number;
  now: number;
}): boolean {
  if (args.awayMs < CATCHUP_MIN_AWAY_MS) return false;
  if (!args.app) return false;
  return args.now - args.lastReactAt >= args.cooldownMs;
}
