/**
 * 屏幕窥视 (app watch): while the keep-alive service runs, the native module
 * reports the foreground app; the character may react ("在听什么啊？耳机分我
 * 一半呗"). Pure gating logic here — the native calls and timers live in
 * background.ts so this stays unit-testable.
 */

/** System surfaces that are never "the user using an app".
 *  Deliberately does NOT include 'settings': the LIVE path may tease the user
 *  for poking around 系统设置 (field-loved behavior), while the catch-up path
 *  filters it natively (isSystemish) — "the notable app from your time away"
 *  shouldn't be Settings. The asymmetry is intentional. */
const IGNORED_PKG_PARTS = [
  'launcher', 'home', 'systemui', 'inputmethod', 'keyboard', 'recents', 'packageinstaller',
];

export const WATCH_COOLDOWN_DEFAULT_MIN = 30;

export interface WatchGateArgs {
  pkg: string; // current foreground package
  ownPkg: boolean; // is it LoveSeek itself?
  prevPkg: string | null; // foreground package at the previous tick
  lastReactAt: number; // last reaction ms (global — she comments occasionally, not per-app)
  cooldownMs: number;
  now: number;
}

/** React only when the user SWITCHES to a real app, and not too often. */
export function shouldReactToApp(a: WatchGateArgs): boolean {
  if (!a.pkg || a.ownPkg) return false;
  const low = a.pkg.toLowerCase();
  if (IGNORED_PKG_PARTS.some((part) => low.includes(part))) return false;
  if (a.pkg === a.prevPkg) return false; // still in the same app — already reacted or ignored
  return a.now - a.lastReactAt >= a.cooldownMs;
}

// Stable signatures: let reach.ts tell watch reactions apart from auto-reach
// triggers (watch has its own cooldown and must not eat the reach daily cap).
const WATCH_TRIGGER_SIGN = '你注意到用户此刻正把手机切到了';
const CATCHUP_TRIGGER_SIGN = '你留意到用户刚才离开时用了';

export const isWatchTrigger = (content: string): boolean =>
  content.includes(WATCH_TRIGGER_SIGN) || content.includes(CATCHUP_TRIGGER_SIGN);

/** The hidden trigger turn injected when she notices the user's current app. */
export function watchTriggerText(appLabel: string): string {
  return (
    `[系统触发：${WATCH_TRIGGER_SIGN}「${appLabel}」在用。` +
    '你对此有点在意——以你的性格自然地发一两句话（可以吃醋、好奇、撒娇或借题发挥），' +
    '绝不提及你是怎么知道的，也不提"系统"或"权限"。]'
  );
}

/** Catch-up-on-return: she reacts to what the user did while away from the app. */
export function catchupTriggerText(appLabel: string): string {
  return (
    `[系统触发：${CATCHUP_TRIGGER_SIGN}「${appLabel}」。` +
    '你刚发现这件事，有点在意——以你的性格自然地开个话头（吃醋、好奇、撒娇或调侃都行），' +
    '绝不提及你是怎么知道的，也不提"系统"或"权限"。]'
  );
}
