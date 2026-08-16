import { LIFE_CATCHUP_HOURS, MOOD_FLOOR, MOOD_HALF_LIFE_HOURS } from './constants';
import type { MessageKind, Role } from './types';

export interface ScheduleEntry {
  start: string; // 'HH:mm'
  end: string;
  activity: string;
  reach?: boolean; // may the character initiate contact during this period
}

const mins = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

export function activityAt(schedule: ScheduleEntry[] | undefined, now: Date): string | null {
  if (!schedule || schedule.length === 0) return null;
  const t = now.getHours() * 60 + now.getMinutes();
  for (const e of schedule) {
    const s = mins(e.start);
    const en = mins(e.end);
    const hit = s <= en ? t >= s && t < en : t >= s || t < en;
    if (hit) return e.activity;
  }
  return '空闲';
}

export function isAsleepAt(schedule: ScheduleEntry[] | undefined, now: Date): boolean {
  const a = activityAt(schedule, now);
  return !!a && /睡/.test(a);
}

export function decayedMood(
  label: string | null,
  intensity: number | null,
  updatedAt: number | null,
  baseline: string,
  nowMs: number,
): { label: string; intensity: number } {
  if (!label || intensity == null || updatedAt == null) return { label: baseline, intensity: 0 };
  const hours = Math.max(0, (nowMs - updatedAt) / 3600000);
  const decayed = intensity * Math.pow(0.5, hours / MOOD_HALF_LIFE_HOURS);
  if (decayed < MOOD_FLOOR) return { label: baseline, intensity: 0 };
  return { label, intensity: decayed };
}

export type TriggerPath = 'catchup' | 'idle' | 'manual' | 'auto';

export function canFireTrigger(opts: {
  path: TriggerPath;
  lifeEnabled: boolean;
  streaming: boolean;
  lastMessage: { kind: MessageKind; role: Role; createdAt: number } | null;
  prevKind: MessageKind | null;
  asleep: boolean;
  nowMs: number;
}): boolean {
  if (!opts.lifeEnabled || opts.streaming) return false;
  const last = opts.lastMessage;
  if (last?.kind === 'trigger') return opts.path === 'manual'; // dangling trigger row
  if (last?.role === 'assistant' && opts.prevKind === 'trigger') return false; // unanswered outreach
  if (opts.asleep && opts.path !== 'manual') return false;
  if (opts.path === 'catchup') {
    if (!last) return true;
    return opts.nowMs - last.createdAt > LIFE_CATCHUP_HOURS * 3600000;
  }
  return true;
}
