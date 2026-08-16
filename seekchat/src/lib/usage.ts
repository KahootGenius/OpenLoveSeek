import type { UsageToday } from './native';

/**
 * 屏幕使用 (screen-time) formatting. Pure — native reads UsageStatsManager,
 * this turns it into the compact line injected into the prompt or shown in a
 * meta note. Two delivery modes (user setting):
 *   'always'  — the line rides every request (quality; more tokens)
 *   'check'   — she只 occasionally peeks (economy; injected once in a while)
 */

export type UsageMode = 'always' | 'check' | 'off';

/** Apps under this many minutes are noise, not "usage". */
const MIN_APP_MINUTES = 3;

export function fmtDuration(min: number): string {
  if (min < 1) return '不到1分钟';
  if (min < 60) return `${min}分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}小时` : `${h}小时${m}分`;
}

/** Pure. The 【今日使用】 line; null when there's nothing worth mentioning. */
export function buildUsageLine(u: UsageToday | null): string | null {
  if (!u || u.totalMinutes < MIN_APP_MINUTES) return null;
  const apps = u.apps
    .filter((a) => a.minutes >= MIN_APP_MINUTES)
    .slice(0, 4)
    .map((a) => `${a.label} ${fmtDuration(a.minutes)}`);
  const head = `今天总屏幕使用约${fmtDuration(u.totalMinutes)}`;
  return apps.length ? `${head}；主要用了：${apps.join('、')}。` : `${head}。`;
}

/** The 【今日屏幕使用】 prompt block (used in 'always' mode). */
export function buildUsageInstructions(): string {
  return '【今日屏幕使用】（系统提供，仅供你参考；若要提起请自然，绝不提及"系统""权限"或你是怎么知道的）';
}

export function buildUsageEvidence(u: UsageToday | null): string | null {
  const line = buildUsageLine(u);
  return line ? `【屏幕使用数据】\n${line}` : null;
}

export function buildUsageSection(u: UsageToday | null): string | null {
  const evidence = buildUsageEvidence(u);
  return evidence ? `${buildUsageInstructions()}\n${evidence}` : null;
}

/**
 * Pure. In 'check' mode she only peeks now and then. Given the last-checked
 * timestamp and now, decide whether this turn is a peek. Default gap 90 min.
 */
export function shouldCheckUsage(
  mode: UsageMode,
  lastCheckedAt: number,
  now: number,
  gapMs = 90 * 60000,
): boolean {
  if (mode !== 'check') return false;
  return now - lastCheckedAt >= gapMs;
}
