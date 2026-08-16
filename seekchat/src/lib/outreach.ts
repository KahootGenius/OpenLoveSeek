import type { ScheduleEntry } from './life';
import type { ProConfig } from './pro';
import { reachAllowedNow, reachIntervalMinutes } from './reach';

/**
 * 预生成主动消息 (scheduled outreach): the phone freezes the app in the
 * background (CN ROM 冻结), so live background messaging is impossible — but
 * SYSTEM-held scheduled notifications deliver even while the app is frozen.
 * While the app is in use we pre-write a few of her outreach lines and hand
 * them to the OS with delivery times inside her 主动 schedule windows; on the
 * next app open the delivered ones are folded into the conversation history.
 * Pure planning/parsing here; notifications and storage live in background.ts.
 */

export interface ScheduledMsg {
  conversationId: string;
  text: string;
  fireAt: number;
  notifId: string;
  generatedAt: number;
}

export const OUTREACH_HORIZON_MS = 12 * 3600000; // plan at most this far ahead
export const OUTREACH_COUNT = 2; // pre-written lines held by the OS at a time

/**
 * Pure. Next K delivery times inside 主动-marked schedule windows, spaced by
 * the persona's rate interval with jitter (never a metronome). `rand` is
 * injectable for tests.
 */
export function pickFireTimes(args: {
  schedule: ScheduleEntry[] | undefined;
  rate: ProConfig['reachRate'];
  now: number;
  count?: number;
  horizonMs?: number;
  rand?: () => number;
}): number[] {
  const rand = args.rand ?? Math.random;
  const count = args.count ?? OUTREACH_COUNT;
  const horizon = args.horizonMs ?? OUTREACH_HORIZON_MS;
  const intervalMs = reachIntervalMinutes(args.rate) * 60000;
  const out: number[] = [];
  let t = args.now + intervalMs * (0.6 + 0.8 * rand());
  while (out.length < count && t < args.now + horizon) {
    if (reachAllowedNow(args.schedule, new Date(t))) {
      out.push(Math.round(t));
      t += intervalMs * (0.8 + 0.4 * rand());
    } else {
      t += 5 * 60000; // step to the next allowed window
    }
  }
  return out;
}

// Not empty, not a leaked control marker / instruction echo (starts with a
// bracket or brace). Length floor is applied only to the prose fallback.
const notMarker = (l: string): boolean =>
  l.length >= 1 && !l.startsWith('[') && !l.startsWith('【') && !l.startsWith('{');

/** Pure. Tolerant parse of the model's pre-written lines (JSON array first,
 *  fenced or not; falls back to non-empty prose lines). Filters marker/
 *  instruction echoes on BOTH paths so nothing leaks into a notification. */
export function parseOutreachLines(raw: string, max: number): string[] {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const j = JSON.parse(stripped);
    if (Array.isArray(j)) {
      return j
        .filter((x): x is string => typeof x === 'string' && notMarker(x.trim()))
        .map((x) => x.trim().slice(0, 120))
        .slice(0, max);
    }
  } catch {
    // not JSON — fall through to line splitting
  }
  return stripped
    .split('\n')
    .map((l) => l.replace(/^[\s\-*\d.、)）"']+/, '').trim())
    .filter((l) => l.length >= 2 && notMarker(l)) // stricter for noisy prose splits
    .slice(0, max)
    .map((l) => l.slice(0, 120));
}

/** Pure. Split stored items into due-now (fold into history) and future (keep). */
export function splitDue(
  items: ScheduledMsg[],
  now: number,
): { due: ScheduledMsg[]; future: ScheduledMsg[] } {
  return {
    due: items.filter((i) => i.fireAt <= now).sort((a, b) => a.fireAt - b.fireAt),
    future: items.filter((i) => i.fireAt > now),
  };
}

export function partitionScheduledConversation(
  items: ScheduledMsg[],
  conversationId: string,
): { removed: ScheduledMsg[]; remaining: ScheduledMsg[] } {
  return {
    removed: items.filter((item) => item.conversationId === conversationId),
    remaining: items.filter((item) => item.conversationId !== conversationId),
  };
}

export function createOutreachCancellationGate(): {
  isActive(): boolean;
  run<T>(operation: () => Promise<T>): Promise<T>;
} {
  let cancellationDepth = 0;
  return {
    isActive: () => cancellationDepth > 0,
    async run<T>(operation: () => Promise<T>): Promise<T> {
      cancellationDepth++;
      try {
        return await operation();
      } finally {
        cancellationDepth--;
      }
    },
  };
}

/** Pre-written lines go stale the moment the user says something new. */
export const isStaleSchedule = (generatedAt: number, lastUserMsgAt: number): boolean =>
  lastUserMsgAt > generatedAt;
