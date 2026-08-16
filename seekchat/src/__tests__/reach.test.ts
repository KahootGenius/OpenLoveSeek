import { autoReachDue, reachAllowedNow, reachIntervalMinutes } from '../lib/reach';
import { splitBrackets } from '../lib/brackets';
import type { Message } from '../lib/types';

const at = (h: number, m = 0) => new Date(2026, 6, 14, h, m);
const H = 3600000;

const sched = [
  { start: '08:00', end: '17:00', activity: '上课' },
  { start: '17:00', end: '23:00', activity: '空闲', reach: true },
  { start: '23:00', end: '08:00', activity: '睡觉' },
];

let seq = 0;
const msg = (createdAt: number, kind: Message['kind'] = 'normal', content = 'x'): Message => ({
  id: `m${++seq}`, conversationId: 'c1', role: 'user', content,
  status: 'complete', kind, reasoning: null, quotedId: null, speakerId: null, createdAt,
});

describe('reachIntervalMinutes', () => {
  it('maps presets and custom counts', () => {
    expect(reachIntervalMinutes('健谈')).toBe(60);
    expect(reachIntervalMinutes('冷淡')).toBe(480);
    expect(reachIntervalMinutes(12)).toBe(120); // 12/day
    expect(reachIntervalMinutes(100)).toBe(30); // floor at 30min
    expect(reachIntervalMinutes(undefined)).toBe(180); // default 中等
  });
});

describe('reachAllowedNow', () => {
  it('requires an active period explicitly marked reach', () => {
    expect(reachAllowedNow(sched, at(19))).toBe(true);
    expect(reachAllowedNow(sched, at(10))).toBe(false); // 上课 unmarked
    expect(reachAllowedNow(sched, at(2))).toBe(false); // asleep unmarked
    expect(reachAllowedNow(undefined, at(19))).toBe(false);
  });
});

describe('autoReachDue', () => {
  const cfg = {
    schedule: sched, autoReach: true, autoReachConsent: true, reachRate: '健谈' as const,
  };
  const now = at(19);
  it('requires switch, consent, and an allowed period', () => {
    expect(autoReachDue({ cfg, messages: [], now })).toBe(true);
    expect(autoReachDue({ cfg: { ...cfg, autoReach: false }, messages: [], now })).toBe(false);
    expect(autoReachDue({ cfg: { ...cfg, autoReachConsent: undefined }, messages: [], now })).toBe(false);
    expect(autoReachDue({ cfg, messages: [], now: at(10) })).toBe(false);
  });
  it('respects spacing from the last activity', () => {
    const recent = [msg(now.getTime() - 0.5 * H)];
    const stale = [msg(now.getTime() - 2 * H)];
    expect(autoReachDue({ cfg, messages: recent, now })).toBe(false);
    expect(autoReachDue({ cfg, messages: stale, now })).toBe(true);
  });
  it('enforces the daily cap', () => {
    const triggers = Array.from({ length: 8 }, (_, i) =>
      msg(at(9 + i).getTime(), 'trigger'),
    );
    expect(autoReachDue({ cfg, messages: triggers, now })).toBe(false);
  });
  it('watch (屏幕窥视) reactions do not consume the daily cap', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { watchTriggerText } = require('../lib/watch');
    const watchTriggers = Array.from({ length: 8 }, (_, i) =>
      msg(at(9 + i).getTime() - 2 * H, 'trigger', watchTriggerText('网易云音乐')),
    );
    expect(autoReachDue({ cfg, messages: watchTriggers, now })).toBe(true);
  });
});

describe('cropRectFor', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { cropRectFor } = require('../lib/crop');
  it('square image, no zoom/pan → full frame', () => {
    expect(cropRectFor(1000, 1000, 280, 1, 0, 0)).toEqual({
      originX: 0, originY: 0, width: 1000, height: 1000,
    });
  });
  it('wide image centers horizontally', () => {
    expect(cropRectFor(2000, 1000, 280, 1, 0, 0)).toEqual({
      originX: 500, originY: 0, width: 1000, height: 1000,
    });
  });
  it('zoom narrows the crop; pan clamps at edges', () => {
    const r = cropRectFor(1000, 1000, 280, 2, 0, 0);
    expect(r).toEqual({ originX: 250, originY: 250, width: 500, height: 500 });
    const clamped = cropRectFor(2000, 1000, 280, 1, 99999, 0);
    expect(clamped.originX).toBe(0);
  });
});

describe('splitBrackets', () => {
  it('marks bracketed stage directions', () => {
    expect(splitBrackets('好啦（轻轻拍了拍你的头）别闹')).toEqual([
      { text: '好啦' },
      { text: '（轻轻拍了拍你的头）', action: true },
      { text: '别闹' },
    ]);
  });
  it('handles ascii brackets and plain text', () => {
    expect(splitBrackets('嗯(点头)')).toEqual([{ text: '嗯' }, { text: '(点头)', action: true }]);
    expect(splitBrackets('没有括号')).toEqual([{ text: '没有括号' }]);
  });
});
