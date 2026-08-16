import { CATCHUP_MIN_AWAY_MS, pickCatchupApp, shouldCatchup } from '../lib/presence';

const apps = [
  { packageName: 'com.tencent.mm', label: '微信' },
  { packageName: 'com.netease.cloudmusic', label: '网易云音乐' },
];

describe('pickCatchupApp', () => {
  it('picks the most recent (last) app', () => {
    expect(pickCatchupApp(apps)?.label).toBe('网易云音乐');
    expect(pickCatchupApp([])).toBeNull();
  });
});

describe('shouldCatchup', () => {
  const now = 10_000_000;
  const base = { awayMs: 5 * 60000, app: apps[1], lastReactAt: 0, cooldownMs: 30 * 60000, now };
  it('fires for a real app after a long-enough absence, past cooldown', () => {
    expect(shouldCatchup(base)).toBe(true);
  });
  it('skips very short trips away', () => {
    expect(shouldCatchup({ ...base, awayMs: CATCHUP_MIN_AWAY_MS - 1 })).toBe(false);
  });
  it('skips when no real app was seen', () => {
    expect(shouldCatchup({ ...base, app: null })).toBe(false);
  });
  it('respects the cooldown', () => {
    expect(shouldCatchup({ ...base, lastReactAt: now - 60000 })).toBe(false);
  });
});
