// 节奏 (v3.0 真实感): schedule-aware availability. A real person at work sends
// one short line and comes back later; asleep means silence until morning;
// and messages get "read" when she would actually look at her phone. Pure
// timing math; engine.ts/background.ts do the scheduling.
import type { ScheduleEntry } from './life';

export type Availability =
  | { state: 'free'; activity: string | null }
  | { state: 'busy'; activity: string; until: number }
  | { state: 'asleep'; activity: string; wakeAt: number };

// Activities during which she only glances at her phone.
export const BUSY_RE = /上班|工作|开会|会议|上课|上学|课|考试|健身|洗澡|做饭|开车|通勤|加班|实习|面试|忙/;
const ASLEEP_RE = /睡/;

const mins = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Epoch ms of the next moment today/tomorrow at HH:mm strictly after `now`. */
const nextAt = (hhmm: string, now: Date): number => {
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  t.setMinutes(mins(hhmm));
  if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
  return t.getTime();
};

export function availabilityAt(schedule: ScheduleEntry[] | undefined, now: Date): Availability {
  if (!schedule || schedule.length === 0) return { state: 'free', activity: null };
  const t = now.getHours() * 60 + now.getMinutes();
  for (const e of schedule) {
    const s = mins(e.start);
    const en = mins(e.end);
    const hit = s <= en ? t >= s && t < en : t >= s || t < en;
    if (!hit) continue;
    if (ASLEEP_RE.test(e.activity)) return { state: 'asleep', activity: e.activity, wakeAt: nextAt(e.end, now) };
    if (BUSY_RE.test(e.activity)) return { state: 'busy', activity: e.activity, until: nextAt(e.end, now) };
    return { state: 'free', activity: e.activity };
  }
  return { state: 'free', activity: '空闲' };
}

const between = (rand: () => number, lo: number, hi: number): number => lo + rand() * (hi - lo);

/** When she "reads" a message sent now — the 已读 stamp. */
export function computeReadAt(avail: Availability, nowMs: number, rand: () => number): number {
  switch (avail.state) {
    case 'asleep':
      return avail.wakeAt + between(rand, 2, 10) * 60000;
    case 'busy':
      return Math.min(avail.until, nowMs + between(rand, 3, 15) * 60000);
    default:
      return nowMs + between(rand, 3, 45) * 1000;
  }
}

/** When a deferred full reply should land. */
export function deferDeliveryAt(avail: Availability, nowMs: number, rand: () => number): number {
  switch (avail.state) {
    case 'asleep':
      return Math.max(nowMs + 60000, avail.wakeAt + between(rand, 3, 20) * 60000);
    case 'busy':
      return Math.max(nowMs + 60000, avail.until + between(rand, 1, 5) * 60000);
    default:
      return nowMs;
  }
}

export interface RhythmDecision {
  /** 'now' = ordinary turn; 'short' = one short line now + full reply deferred; 'defer' = silence now, full reply deferred. */
  mode: 'now' | 'short' | 'defer';
  deliverAt: number | null; // for short/defer
  activity: string | null;
}

/** Pure. What this turn should do, given her availability. A short line is
 *  sent at most once per busy slot (`lastShortUntil` = the slot it was sent
 *  in); a second message in the same slot is silently deferred. Trigger turns
 *  (she initiates) never defer — she chose to speak. */
export function decideRhythm(args: {
  avail: Availability;
  enabled: boolean;
  triggerTurn: boolean;
  lastShortUntil: number | null;
  nowMs: number;
  rand: () => number;
}): RhythmDecision {
  const { avail } = args;
  if (!args.enabled || args.triggerTurn || avail.state === 'free') {
    return { mode: 'now', deliverAt: null, activity: avail.activity };
  }
  const deliverAt = deferDeliveryAt(avail, args.nowMs, args.rand);
  if (avail.state === 'asleep') return { mode: 'defer', deliverAt, activity: avail.activity };
  const alreadyShort = args.lastShortUntil != null && args.lastShortUntil === avail.until;
  return { mode: alreadyShort ? 'defer' : 'short', deliverAt, activity: avail.activity };
}

/** Instruction lane line for the short reply. */
export const busyDirective = (activity: string): string =>
  `【此刻】你正在${activity}，只能偷空回一句很短的话（不超过15个字）：说你在忙、等会儿再细聊，` +
  '别展开、别问问题、别用标记。';

/** Instruction lane line for the deferred full reply (written now, delivered later). */
export const deferredDirective = (activity: string, deliverAt: Date): string =>
  `【此刻】你刚忙完${activity}（现在约 ${String(deliverAt.getHours()).padStart(2, '0')}:` +
  `${String(deliverAt.getMinutes()).padStart(2, '0')}），回过头来认真回复对方之前发来的消息。` +
  '可以先提一句刚才在忙什么。';

/** Which user rows to stamp 已读 under: the newest one whose readAt has passed. */
export function newestReadUserId(
  rows: { id: string; role: string; kind: string; readAt?: number | null }[],
  nowMs: number,
): string | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.role !== 'user' || r.kind === 'trigger') continue;
    if (r.readAt != null && r.readAt <= nowMs) return r.id;
    // The newest user row not yet read hides the receipt of older ones? No —
    // WeChat shows 已读 only on the last read message; keep scanning.
  }
  return null;
}
