import { buildYanderePromptSection, extractYandereMarkers } from '../lib/yandere';

describe('extractYandereMarkers', () => {
  it('detects both actions on their own lines and strips them', () => {
    const r = extractYandereMarkers('你去哪了\n[病娇:震动]\n不许走\n[病娇:锁屏]');
    expect(r.vibrate).toBe(true);
    expect(r.lock).toBe(true);
    expect(r.clean).toBe('你去哪了\n不许走');
  });
  it('accepts fullwidth colon and no action when absent', () => {
    expect(extractYandereMarkers('[病娇：震动]').vibrate).toBe(true);
    const none = extractYandereMarkers('普通的回复');
    expect(none).toEqual({
      clean: '普通的回复', vibrate: false, lock: false, hold: false, release: false, demand: null,
    });
  });
  it('detects the 挽留 hold marker', () => {
    const r = extractYandereMarkers('别走\n[病娇:挽留]');
    expect(r.hold).toBe(true);
    expect(r.clean).toBe('别走');
  });
  it('strips a marker that occupies its own --- segment (no leak, no wasted slot)', () => {
    const r = extractYandereMarkers('你好---[病娇:震动]---再见');
    expect(r.vibrate).toBe(true);
    expect(r.clean).toBe('你好---再见');
  });
  it('detects the 放行 release marker', () => {
    const r = extractYandereMarkers('好吧……你走吧\n[病娇:放行]');
    expect(r.release).toBe(true);
    expect(r.clean).toBe('好吧……你走吧');
  });
  it('tolerates fullwidth brackets', () => {
    expect(extractYandereMarkers('走吧\n【病娇：放行】').release).toBe(true);
  });
  it('extracts a 索求 demand phrase and strips it', () => {
    const r = extractYandereMarkers('不说就别想走[病娇:索求:我爱你]');
    expect(r.demand).toBe('我爱你');
    expect(r.clean).toBe('不说就别想走');
  });
  it('ignores inline mentions (must be its own line)', () => {
    const r = extractYandereMarkers('我才不会用[病娇:锁屏]这种东西呢');
    expect(r.lock).toBe(false);
    expect(r.clean).toBe('我才不会用[病娇:锁屏]这种东西呢');
  });
});

describe('buildYanderePromptSection', () => {
  it('documents both markers and the rarity rule', () => {
    const out = buildYanderePromptSection();
    expect(out).toContain('[病娇:震动]');
    expect(out).toContain('[病娇:锁屏]');
    expect(out).toContain('低频');
  });
});
