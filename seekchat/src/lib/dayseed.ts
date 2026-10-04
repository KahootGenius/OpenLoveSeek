// 生成的一天 (v3.0 真实感): once per calendar day, 2–3 concrete small events in
// her life — the coffee she spilled, a colleague's drama — so what she
// mentions at 10am is still true at 8pm. Stored on the persona as JSON; rides
// in the state block, the outreach pre-write and the 朋友圈 char post. Pure.
import type { ScheduleEntry } from './life';
import { renderPrompt } from './prompts';

export interface DayLog {
  day: string; // 'YYYYMMDD'
  events: string[];
}

export const MAX_DAY_EVENTS = 3;
export const MAX_DAY_EVENT_TEXT = 40;

export const dayKeyOf = (d: Date): string =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

export function parseDayLog(json: string | null | undefined): DayLog | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json) as Partial<DayLog> | null;
    if (!o || typeof o.day !== 'string' || !Array.isArray(o.events)) return null;
    return { day: o.day, events: o.events.filter((e): e is string => typeof e === 'string') };
  } catch {
    return null;
  }
}

/** A log is "today's" only when its day key matches. */
export const todaysEvents = (log: DayLog | null, d: Date): string[] =>
  log && log.day === dayKeyOf(d) ? log.events : [];

export const needsDaySeed = (log: DayLog | null, d: Date): boolean =>
  todaysEvents(log, d).length === 0;

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function buildDayPrompt(args: {
  persona: string;
  schedule: ScheduleEntry[] | undefined;
  interests: string | null | undefined;
  now: Date;
  holidays: string[];
  yesterday: string[];
}): string {
  const d = args.now;
  const sched = args.schedule?.length
    ? args.schedule.map((e) => `${e.start}-${e.end} ${e.activity}`).join('；')
    : '（没有固定作息）';
  return renderPrompt('life.day', {
    persona: args.persona.slice(0, 600),
    schedule: sched,
    interests: args.interests?.trim() || '（未填）',
    today: `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}${args.holidays.length ? '，' + args.holidays.join('、') : ''}`,
    yesterday: args.yesterday.length ? args.yesterday.join('；') : '（无）',
    max: MAX_DAY_EVENTS,
  });
}

/** JSON array, or one event per line; bullets/numbering stripped; capped. */
export function parseDayEvents(raw: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.replace(/^[\s\-•·*\d.、)）]+/, '').trim().slice(0, MAX_DAY_EVENT_TEXT);
    if (t && !out.includes(t) && out.length < MAX_DAY_EVENTS) out.push(t);
  };
  const m = /\[[\s\S]*\]/.exec(raw);
  if (m) {
    try {
      const arr = JSON.parse(m[0]) as unknown;
      if (Array.isArray(arr)) {
        for (const x of arr) if (typeof x === 'string') push(x);
        if (out.length) return out;
      }
    } catch {
      // fall through to line mode
    }
  }
  for (const line of raw.split('\n')) push(line);
  return out;
}

/** State-block line; null when today has no log yet. */
export function dayEventsLine(log: DayLog | null, d: Date): string | null {
  const ev = todaysEvents(log, d);
  return ev.length ? `你今天到目前为止的小事：${ev.join('；')}` : null;
}
