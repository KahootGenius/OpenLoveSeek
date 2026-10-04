import { extractPatMarker, makeOwnLineMarker } from '../lib/markers';
import { buildRealismRules } from '../lib/pro';
import { renderPrompt } from '../lib/prompts';

describe('makeOwnLineMarker', () => {
  const m = makeOwnLineMarker('测试');

  it('pulls an own-line marker and cleans without leaving a blank line', () => {
    const r = m.extract('你好呀\n[测试:一个值]\n晚安');
    expect(r.values).toEqual(['一个值']);
    expect(r.clean).toBe('你好呀\n晚安');
  });

  it('tolerates full-width brackets and colon', () => {
    const r = m.extract('【测试：另一个值】');
    expect(r.values).toEqual(['另一个值']);
    expect(r.clean).toBe('');
  });

  it('ignores inline mentions (must own the line)', () => {
    const src = '我才不会写[测试:值]这种东西';
    const r = m.extract(src);
    expect(r.values).toEqual([]);
    expect(r.clean).toBe(src);
  });

  it('collects multiple markers in order', () => {
    const r = m.extract('[测试:甲]\n中间\n[测试:乙]');
    expect(r.values).toEqual(['甲', '乙']);
    expect(r.clean).toBe('中间');
  });

  it('allows full-width brackets INSIDE a half-width marker value', () => {
    const r = m.extract('晚安\n[测试:拍了拍你的【小脑袋】]');
    expect(r.values).toEqual(['拍了拍你的【小脑袋】']);
    expect(r.clean).toBe('晚安');
  });
});

describe('extractPatMarker', () => {
  it('extracts an own-line 拍一拍 and keeps the last one', () => {
    const r = extractPatMarker('想你了\n[拍一拍:摸了摸你的头]');
    expect(r.pat).toBe('摸了摸你的头');
    expect(r.clean).toBe('想你了');
  });

  it('returns null when absent and leaves text alone', () => {
    const r = extractPatMarker('普通的一句话');
    expect(r.pat).toBeNull();
    expect(r.clean).toBe('普通的一句话');
  });

  it('ignores an inline 拍一拍 mention', () => {
    const src = '你的[拍一拍:xx]功能真好玩';
    const r = extractPatMarker(src);
    expect(r.pat).toBeNull();
    expect(r.clean).toBe(src);
  });
});

describe('拍一拍 prompt grammar (v2.0)', () => {
  const rules = buildRealismRules(false, false, '你拍了拍他');

  it('teaches the own-line action marker, not the envelope field', () => {
    expect(rules).toContain('[拍一拍:动作短句]');
    expect(rules).not.toContain('|拍一拍');
  });

  it('names 拍一拍 and 转账 in the shared 标记通则, which bans markers from the state tag', () => {
    // v2.9: the marker list + the smuggling ban moved from realism.tag to the
    // shared block; the tag's own grammar keeps a one-line reinforcement.
    const shared = renderPrompt('markers.rules');
    expect(shared).toContain('[拍一拍:…]');
    expect(shared).toContain('[转账:…]');
    expect(shared).toContain('塞进末尾的状态标签');
    expect(rules).toContain('其他标记不得塞进标签');
  });
});
