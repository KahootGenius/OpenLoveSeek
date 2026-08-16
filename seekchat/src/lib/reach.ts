import type { ScheduleEntry } from './life';
import type { Message } from './types';
import type { ProConfig } from './pro';
import { isWatchTrigger } from './watch';

export const REACH_PRESETS: Record<string, number> = {
  健谈: 60,
  中等: 180,
  冷淡: 480,
};
export const REACH_DAILY_CAP = 8;
const MIN_INTERVAL_MIN = 30;

export function reachIntervalMinutes(rate: ProConfig['reachRate']): number {
  if (typeof rate === 'number' && rate > 0) {
    return Math.max(MIN_INTERVAL_MIN, Math.round((24 * 60) / rate));
  }
  return REACH_PRESETS[String(rate)] ?? REACH_PRESETS['中等'];
}

const mins = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Is the character in a schedule period explicitly marked 可主动联系? */
export function reachAllowedNow(
  schedule: ScheduleEntry[] | undefined,
  now: Date,
): boolean {
  if (!schedule?.length) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  for (const e of schedule) {
    const s = mins(e.start);
    const en = mins(e.end);
    const hit = s <= en ? t >= s && t < en : t >= s || t < en;
    if (hit) return e.reach === true;
  }
  return false;
}

const sameLocalDay = (a: number, b: number): boolean => {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
};

/** Count today's outreach turns (excludes 屏幕窥视 catch-ups) — for the daily cap. */
export function countTodayReaches(messages: Message[], nowMs: number): number {
  return messages.filter(
    (m) => m.kind === 'trigger' && !isWatchTrigger(m.content) && sameLocalDay(m.createdAt, nowMs),
  ).length;
}

export function autoReachDue(args: {
  cfg: ProConfig | null;
  messages: Message[];
  now: Date;
}): boolean {
  const { cfg, messages, now } = args;
  if (!cfg?.autoReach || cfg.autoReachConsent !== true) return false;
  if (!reachAllowedNow(cfg.schedule, now)) return false;
  const nowMs = now.getTime();
  // Watch (屏幕窥视) reactions are trigger rows too but have their own cooldown;
  // they must not silently consume the auto-reach daily cap.
  const triggers = messages.filter((m) => m.kind === 'trigger' && !isWatchTrigger(m.content));
  if (triggers.filter((m) => sameLocalDay(m.createdAt, nowMs)).length >= REACH_DAILY_CAP) {
    return false;
  }
  const interval = reachIntervalMinutes(cfg.reachRate) * 60000;
  const lastAt = Math.max(
    triggers.length ? triggers[triggers.length - 1].createdAt : 0,
    messages.length ? messages[messages.length - 1].createdAt : 0,
  );
  // Spacing is measured from the last activity of any kind: she reaches out
  // after a lull, not mid-conversation.
  return lastAt === 0 || nowMs - lastAt >= interval;
}
