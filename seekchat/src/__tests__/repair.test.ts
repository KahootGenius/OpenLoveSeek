import { acceptRepair, buildRepairPrompt, lintMarkers, normalizeActionMarkers } from '../lib/repair';

describe('lintMarkers — flags ATTEMPTED markers with broken syntax', () => {
  it('flags a pat missing its closer', () => {
    expect(lintMarkers('想你了\n[拍一拍：摸了摸你的头').suspects.length).toBe(1);
  });

  it('flags wrong (full-width paren) brackets', () => {
    expect(lintMarkers('（转账：5.20）').suspects.length).toBe(1);
  });

  it('flags a missing colon inside brackets', () => {
    expect(lintMarkers('[表情 开心]').suspects.length).toBe(1);
  });

  it('flags a broken/unclosed 状态 envelope', () => {
    expect(lintMarkers('晚安啦\n【状态|心情:开心|强度:0.6').suspects.length).toBeGreaterThan(0);
  });
});

describe('lintMarkers — never flags healthy text', () => {
  it('well-formed own-line markers pass', () => {
    const t = '想你了\n[拍一拍:摸摸头]\n[转账:5.20]\n【状态|心情:开心|强度:0.6|心想:嗯】';
    expect(lintMarkers(t).suspects).toEqual([]);
  });

  it('well-formed INLINE mention passes (the mention doctrine — she is talking ABOUT it)', () => {
    expect(lintMarkers('我才不会用[病娇:锁屏]这种东西').suspects).toEqual([]);
  });

  it('plain prose containing head words passes (记忆/转账 appear in normal talk)', () => {
    expect(lintMarkers('我把这件事记忆得很清楚，明天帮你转账去交水费').suspects).toEqual([]);
    expect(lintMarkers('今天的表情好可爱').suspects).toEqual([]);
  });

  it('marker-free text passes', () => {
    expect(lintMarkers('普通的一句晚安。').suspects).toEqual([]);
  });
});

describe('buildRepairPrompt', () => {
  it('carries the reply, the canonical grammar, and the no-rewrite rule', () => {
    const s = buildRepairPrompt('[拍一拍：摸摸头');
    expect(s).toContain('[拍一拍:动作短句]');
    expect(s).toContain('【状态|');
    expect(s).toContain('绝不改写正文');
    expect(s).toContain('[拍一拍：摸摸头');
  });
});

describe('acceptRepair — the no-rewrite guard', () => {
  const orig = '想你了想你了想你了\n[拍一拍：摸摸头';

  it('accepts a same-scale fix', () => {
    expect(acceptRepair(orig, '想你了想你了想你了\n[拍一拍:摸摸头]')).toBe(true);
  });

  it('rejects empty, tiny, or bloated outputs (her words are not the checker\'s to change)', () => {
    expect(acceptRepair(orig, '')).toBe(false);
    expect(acceptRepair(orig, '修好了')).toBe(false);
    expect(acceptRepair(orig, orig + '顺便我再补充几句完全是新写的话'.repeat(8))).toBe(false);
  });

  it('rejects apologetic-explainer outputs', () => {
    expect(acceptRepair(orig, '好的，我已修复格式：\n' + orig)).toBe(false);
  });
});

describe('normalizeActionMarkers — own-line bracket variants become canonical', () => {
  it('fixes full-width parens, half parens, and mixed closers', () => {
    expect(normalizeActionMarkers('想你\n（转账：5.20）')).toBe('想你\n[转账：5.20]');
    expect(normalizeActionMarkers('(拍一拍:摸摸头)')).toBe('[拍一拍:摸摸头]');
    expect(normalizeActionMarkers('【转账:5.20]')).toBe('[转账:5.20]');
  });

  it('leaves canonical markers, inline mentions, and prose alone', () => {
    const ok = '好\n[拍一拍:摸摸头]';
    expect(normalizeActionMarkers(ok)).toBe(ok);
    const inline = '她说（转账：5.20）这种话';
    expect(normalizeActionMarkers(inline)).toBe(inline);
    expect(normalizeActionMarkers('帮你转账去交水费')).toBe('帮你转账去交水费');
  });

  it('requires head + colon + non-empty value', () => {
    expect(normalizeActionMarkers('（转账）')).toBe('（转账）');
    expect(normalizeActionMarkers('（转账：)')).toBe('（转账：)');
  });
});
