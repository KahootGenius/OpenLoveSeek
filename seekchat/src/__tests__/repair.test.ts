import {
  acceptRepair, buildRepairPrompt, lintMarkers, narrationSuspects, normalizeActionMarkers,
} from '../lib/repair';

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

  it('flags a photo marker missing its colon (v2.6)', () => {
    expect(lintMarkers('[照片 在海边]').suspects.length).toBe(1);
  });

  it('flags a broken 任命 marker missing its colon (v2.8)', () => {
    expect(lintMarkers('[任命 小雨]').suspects.length).toBe(1);
  });

  it('flags wrong-bracket 转让群主 (v2.8)', () => {
    expect(lintMarkers('（转让群主：小雨）').suspects.length).toBe(1);
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

  it('well-formed group moderation markers pass (v2.5)', () => {
    expect(lintMarkers('[禁言:小雨|30][公告:安静][撤回]').suspects).toEqual([]);
  });

  it('well-formed owner-character agency markers pass (v2.8)', () => {
    expect(lintMarkers('[任命:小雨][罢免:阿明][移出:小美][转让群主:小雨]').suspects).toEqual([]);
  });

  it('a named 撤回 passes lint alongside the bare form — no regression (v2.8)', () => {
    expect(lintMarkers('[撤回][撤回:小雨]').suspects).toEqual([]);
  });

  it('well-formed image marker passes (v2.6)', () => {
    expect(lintMarkers('[照片:在海边]').suspects).toEqual([]);
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

  it('omits the narration-to-marker conversion rule by default (no gated feature rescued it)', () => {
    expect(buildRepairPrompt('x')).not.toContain('改写成对应的标记');
  });

  it('includes the narration-to-marker conversion rule only when narration rescue is active', () => {
    expect(buildRepairPrompt('x', { narration: true })).toContain('改写成对应的标记');
  });

  it('teaches the v2.8 owner-character agency canonical grammar', () => {
    const s = buildRepairPrompt('x');
    expect(s).toContain('[任命:名字]');
    expect(s).toContain('[罢免:名字]');
    expect(s).toContain('[移出:名字]');
    expect(s).toContain('[转让群主:名字]');
    expect(s).toContain('[撤回]'); // bare form still taught, unregressed
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

  it('normalizes wrong-bracket 任命/罢免/移出/转让群主 (v2.8)', () => {
    expect(normalizeActionMarkers('（任命：小雨）')).toBe('[任命：小雨]');
    expect(normalizeActionMarkers('(罢免:阿明)')).toBe('[罢免:阿明]');
    expect(normalizeActionMarkers('【移出:小美]')).toBe('[移出:小美]');
    expect(normalizeActionMarkers('（转让群主：小雨）')).toBe('[转让群主：小雨]');
  });

  it('leaves 撤回 (bare or named) untouched — still rides the model repair call, unregressed', () => {
    expect(normalizeActionMarkers('（撤回）')).toBe('（撤回）');
    expect(normalizeActionMarkers('（撤回：小雨）')).toBe('（撤回：小雨）');
  });
});

describe('narrationSuspects — committed narration that should have been a marker', () => {
  it('flags committed photo narration in parens', () => {
    expect(narrationSuspects('（给你拍了张照片）', { photo: true }))
      .toEqual(['（给你拍了张照片）']);
  });

  it('flags the reordered committed-photo phrasing too', () => {
    expect(narrationSuspects('（拍了一张自拍照片给你）', { photo: true }))
      .toEqual(['（拍了一张自拍照片给你）']);
  });

  it('does not flag photo prose with no parens at all', () => {
    expect(narrationSuspects('我想给你拍张照片', { photo: true })).toEqual([]);
  });

  it('does not flag desire/conditional phrasing even inside parens (想/要是/如果 guard)', () => {
    expect(narrationSuspects('（要是能拍张照片就好了）', { photo: true })).toEqual([]);
    expect(narrationSuspects('（她想拍张照片给你）', { photo: true })).toEqual([]);
    expect(narrationSuspects('（如果能拍张照片就好了）', { photo: true })).toEqual([]);
  });

  it('ignores half-width parens (fullwidth-only stage-direction convention)', () => {
    expect(narrationSuspects('(给你拍了张照片)', { photo: true })).toEqual([]);
  });

  it('flags committed lock narration in parens', () => {
    expect(narrationSuspects('（帮你把手机锁屏）', { lock: true }))
      .toEqual(['（帮你把手机锁屏）']);
  });

  it('flags a bare 锁屏/锁屏了 line (trimmed)', () => {
    expect(narrationSuspects('锁屏', { lock: true })).toEqual(['锁屏']);
    expect(narrationSuspects('好啦\n  锁屏了  ', { lock: true })).toEqual(['锁屏了']);
  });

  it('a feature that is off never contributes suspects, regardless of content', () => {
    expect(narrationSuspects('（给你拍了张照片）', {})).toEqual([]);
    expect(narrationSuspects('（帮你把手机锁屏）', {})).toEqual([]);
    expect(narrationSuspects('锁屏', {})).toEqual([]);
    expect(narrationSuspects('（给你拍了张照片）（帮你把手机锁屏）锁屏', { photo: false, lock: false }))
      .toEqual([]);
  });

  it('applies the same desire/conditional guard to lock paren narration (field report: 真想 collision)', () => {
    expect(narrationSuspects('（真想把你锁屏困住你）', { lock: true })).toEqual([]);
  });

  it('does not flag the 拍一拍 pat-feature collision (他拍了拍我的照片墙)', () => {
    expect(narrationSuspects('（他拍了拍我的照片墙）', { photo: true })).toEqual([]);
  });
});
