import {
  createOutreachCancellationGate, isStaleSchedule, OUTREACH_COUNT, parseOutreachLines,
  partitionScheduledConversation, pickFireTimes, splitDue,
} from '../lib/outreach';

// 17:00–23:00 is the only 主动 window (mirrors the reach tests).
const sched = [
  { start: '08:00', end: '17:00', activity: '上课' },
  { start: '17:00', end: '23:00', activity: '空闲', reach: true },
  { start: '23:00', end: '08:00', activity: '睡觉' },
];
const at = (h: number, m = 0) => new Date(2026, 6, 15, h, m).getTime();
const fixedRand = () => 0.5; // deterministic jitter

describe('partitionScheduledConversation', () => {
  it('removes only the selected conversation plan', () => {
    const item = (conversationId: string, notifId: string) => ({
      conversationId, notifId, text: notifId, fireAt: 100, generatedAt: 50,
    });
    const result = partitionScheduledConversation([
      item('c1', 'n1'), item('c2', 'n2'), item('c1', 'n3'),
    ], 'c1');
    expect(result.removed.map((x) => x.notifId)).toEqual(['n1', 'n3']);
    expect(result.remaining.map((x) => x.notifId)).toEqual(['n2']);
  });
});

describe('createOutreachCancellationGate', () => {
  it('stays active until overlapping cancellation lifetimes both settle', async () => {
    const gate = createOutreachCancellationGate();
    let releaseFirst!: () => void;
    const first = gate.run(() => new Promise<void>((resolve) => {
      releaseFirst = resolve;
    }));
    expect(gate.isActive()).toBe(true);

    const failure = new Error('cancel failed');
    await expect(gate.run(async () => {
      throw failure;
    })).rejects.toBe(failure);
    expect(gate.isActive()).toBe(true);

    releaseFirst();
    await first;
    expect(gate.isActive()).toBe(false);
  });
});

describe('pickFireTimes', () => {
  it('plans K times inside the 主动 window, spaced by the rate interval', () => {
    const times = pickFireTimes({ schedule: sched, rate: '健谈', now: at(17, 0), rand: fixedRand });
    expect(times).toHaveLength(OUTREACH_COUNT);
    for (const t of times) {
      const d = new Date(t);
      const min = d.getHours() * 60 + d.getMinutes();
      expect(min).toBeGreaterThanOrEqual(17 * 60);
      expect(min).toBeLessThan(23 * 60);
    }
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(0.8 * 60 * 60000);
  });
  it('skips forward past non-主动 hours into the window', () => {
    const times = pickFireTimes({ schedule: sched, rate: '健谈', now: at(15, 0), rand: fixedRand });
    expect(times.length).toBeGreaterThan(0);
    expect(new Date(times[0]).getHours()).toBeGreaterThanOrEqual(17);
  });
  it('returns empty when no 主动 window exists in the horizon', () => {
    const noReach = sched.map((s) => ({ ...s, reach: false }));
    expect(
      pickFireTimes({ schedule: noReach, rate: '健谈', now: at(9, 0), rand: fixedRand }),
    ).toEqual([]);
    expect(pickFireTimes({ schedule: undefined, rate: '健谈', now: at(9), rand: fixedRand })).toEqual([]);
  });
});

describe('parseOutreachLines', () => {
  it('parses a JSON array, fenced or bare', () => {
    expect(parseOutreachLines('["想你了","在干嘛？"]', 2)).toEqual(['想你了', '在干嘛？']);
    expect(parseOutreachLines('```json\n["嘿"]\n```', 2)).toEqual(['嘿']);
  });
  it('falls back to prose lines, stripping bullets and skipping markers', () => {
    expect(parseOutreachLines('1. 想你了\n- 在干嘛？\n[表情:开心]', 3)).toEqual([
      '想你了', '在干嘛？',
    ]);
  });
  it('caps count and length', () => {
    const lines = parseOutreachLines(JSON.stringify(['a'.repeat(300), '二', '三']), 2);
    expect(lines).toHaveLength(2);
    expect(lines[0].length).toBeLessThanOrEqual(120);
  });
  it('drops marker/instruction echoes on the JSON path too (no leak into notifications)', () => {
    expect(parseOutreachLines('["[系统：好的]","[表情:开心]","想你了","【状态|x】"]', 4)).toEqual([
      '想你了',
    ]);
  });
});

describe('splitDue / isStaleSchedule', () => {
  const item = (fireAt: number) => ({
    conversationId: 'c1', text: 'x', fireAt, notifId: 'n', generatedAt: 0,
  });
  it('splits by fire time, due sorted ascending', () => {
    const { due, future } = splitDue([item(300), item(100), item(900)], 500);
    expect(due.map((i) => i.fireAt)).toEqual([100, 300]);
    expect(future.map((i) => i.fireAt)).toEqual([900]);
  });
  it('marks the plan stale once the user has spoken after generation', () => {
    expect(isStaleSchedule(1000, 2000)).toBe(true);
    expect(isStaleSchedule(1000, 500)).toBe(false);
  });
});
