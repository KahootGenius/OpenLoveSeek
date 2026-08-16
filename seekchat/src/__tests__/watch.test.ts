import { isWatchTrigger, shouldReactToApp, watchTriggerText } from '../lib/watch';

const base = {
  pkg: 'com.netease.cloudmusic',
  ownPkg: false,
  prevPkg: null as string | null,
  lastReactAt: 0,
  cooldownMs: 30 * 60000,
  now: 10_000_000,
};

describe('shouldReactToApp', () => {
  it('reacts to a fresh switch into a real app', () => {
    expect(shouldReactToApp(base)).toBe(true);
  });
  it('never reacts to LoveSeek itself', () => {
    expect(shouldReactToApp({ ...base, ownPkg: true })).toBe(false);
  });
  it('ignores launchers, system UI and keyboards', () => {
    for (const pkg of [
      'com.miui.home', 'com.android.systemui', 'com.oppo.launcher',
      'com.baidu.inputmethod', 'com.sohu.keyboard',
    ]) {
      expect(shouldReactToApp({ ...base, pkg })).toBe(false);
    }
  });
  it('reacts only on a CHANGE of foreground app', () => {
    expect(shouldReactToApp({ ...base, prevPkg: base.pkg })).toBe(false);
    expect(shouldReactToApp({ ...base, prevPkg: 'com.tencent.mm' })).toBe(true);
  });
  it('enforces the cooldown', () => {
    expect(shouldReactToApp({ ...base, lastReactAt: base.now - 60_000 })).toBe(false);
    expect(shouldReactToApp({ ...base, lastReactAt: base.now - 31 * 60000 })).toBe(true);
  });
  it('rejects an empty package', () => {
    expect(shouldReactToApp({ ...base, pkg: '' })).toBe(false);
  });
});

describe('watchTriggerText', () => {
  it('names the app and forbids revealing the mechanism', () => {
    const t = watchTriggerText('网易云音乐');
    expect(t).toContain('网易云音乐');
    expect(t).toContain('[系统触发');
    expect(t).toContain('绝不提及你是怎么知道的');
  });
  it('is recognizable by isWatchTrigger; ordinary triggers are not', () => {
    expect(isWatchTrigger(watchTriggerText('微信'))).toBe(true);
    expect(isWatchTrigger('[系统触发：用户离开了一段时间，刚刚回来…]')).toBe(false);
  });
});
