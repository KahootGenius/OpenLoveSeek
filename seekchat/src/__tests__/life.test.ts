import { activityAt, canFireTrigger, decayedMood, isAsleepAt } from '../lib/life';

const sched = [
  { start: '07:00', end: '08:00', activity: '起床洗漱' },
  { start: '08:00', end: '17:00', activity: '上课' },
  { start: '23:30', end: '07:00', activity: '睡觉' },
];
const at = (h: number, m = 0) => new Date(2026, 6, 14, h, m);

describe('activityAt', () => {
  it('finds the active range', () => expect(activityAt(sched, at(9))).toBe('上课'));
  it('handles overnight ranges', () => {
    expect(activityAt(sched, at(1))).toBe('睡觉');
    expect(activityAt(sched, at(23, 45))).toBe('睡觉');
  });
  it('returns 空闲 for gaps and null without schedule', () => {
    expect(activityAt(sched, at(20))).toBe('空闲');
    expect(activityAt(undefined, at(20))).toBeNull();
  });
});

describe('isAsleepAt', () => {
  it('detects sleep; empty schedules never sleep', () => {
    expect(isAsleepAt(sched, at(2))).toBe(true);
    expect(isAsleepAt(sched, at(12))).toBe(false);
    expect(isAsleepAt(undefined, at(2))).toBe(false);
  });
});

describe('decayedMood', () => {
  const H = 3600000;
  it('halves after one half-life', () => {
    const r = decayedMood('开心', 0.8, 0, '平静', 12 * H);
    expect(r.label).toBe('开心');
    expect(r.intensity).toBeCloseTo(0.4, 5);
  });
  it('reverts to baseline below floor', () => {
    expect(decayedMood('开心', 0.8, 0, '平静', 60 * H)).toEqual({ label: '平静', intensity: 0 });
  });
  it('is baseline when no state stored', () => {
    expect(decayedMood(null, null, null, '高冷', 0)).toEqual({ label: '高冷', intensity: 0 });
  });
});

describe('canFireTrigger', () => {
  const H = 3600000;
  const base = {
    path: 'manual' as const,
    lifeEnabled: true,
    streaming: false,
    lastMessage: { kind: 'normal' as const, role: 'assistant' as const, createdAt: 0 },
    prevKind: 'normal' as const,
    asleep: false,
    nowMs: 100 * H,
  };
  it('denies without life or during streaming', () => {
    expect(canFireTrigger({ ...base, lifeEnabled: false })).toBe(false);
    expect(canFireTrigger({ ...base, streaming: true })).toBe(false);
  });
  it('denies when the last reply was trigger-born and unanswered', () => {
    expect(canFireTrigger({ ...base, prevKind: 'trigger' })).toBe(false);
  });
  it('auto paths respect sleep; manual may wake', () => {
    expect(canFireTrigger({ ...base, path: 'idle', asleep: true })).toBe(false);
    expect(canFireTrigger({ ...base, path: 'manual', asleep: true })).toBe(true);
  });
  it('catchup requires the gap; empty chat counts as gap', () => {
    expect(canFireTrigger({ ...base, path: 'catchup' })).toBe(true);
    expect(
      canFireTrigger({
        ...base,
        path: 'catchup',
        lastMessage: { ...base.lastMessage, createdAt: 99 * H },
      }),
    ).toBe(false);
    expect(canFireTrigger({ ...base, path: 'catchup', lastMessage: null, prevKind: null })).toBe(true);
  });
  it('a dangling trigger row blocks auto but allows manual retry', () => {
    const dangling = { ...base, lastMessage: { ...base.lastMessage, kind: 'trigger' as const } };
    expect(canFireTrigger({ ...dangling, path: 'idle' })).toBe(false);
    expect(canFireTrigger({ ...dangling, path: 'manual' })).toBe(true);
  });
});
