import { cleanDraftForDisplay, extractStateTag, stripLeakedStateTags } from '../lib/statetag';

describe('extractStateTag', () => {
  it('extracts and strips a complete tag', () => {
    const r = extractStateTag('好啦好啦~\n【状态|心情:开心|强度:0.6|心想:他还挺可爱】');
    expect(r.clean).toBe('好啦好啦~');
    expect(r.tag).toEqual({ mood: '开心', intensity: 0.6, thought: '他还挺可爱' });
  });
  it('returns null tag when absent', () => {
    expect(extractStateTag('普通回复')).toEqual({
      clean: '普通回复', tag: null, growth: null, pat: null, extras: [], found: false,
    });
  });
  it('strips the envelope even when smuggled ops break the field grammar (field report)', () => {
    // Exact shape from the field screenshot: 主人 ops folded INTO the tag.
    const r = extractStateTag(
      '对了，你觉得我叫你"桃子"好还是"呆桃"好？\n' +
        '【状态|心情:调戏欲旺盛|强度:0.85|心想:这个笨蛋太可爱|主人:立规:以后你在我这的昵称就是呆桃，不许改】',
    );
    expect(r.clean).toBe('对了，你觉得我叫你"桃子"好还是"呆桃"好？');
    expect(r.tag).toEqual({ mood: '调戏欲旺盛', intensity: 0.85, thought: '这个笨蛋太可爱' });
    expect(r.extras).toEqual(['主人:立规:以后你在我这的昵称就是呆桃，不许改']);
  });
  it('strips the envelope even when every field is garbage (colon-less junk drops silently)', () => {
    const r = extractStateTag('嗯【状态|完全不像话的内容】');
    expect(r.clean).toBe('嗯');
    expect(r.tag).toBeNull();
    expect(r.extras).toEqual([]);
  });
  it('tolerates shuffled field order and fullwidth colons', () => {
    const r = extractStateTag('好【状态|强度：0.4|心情：平静|心想：还行】');
    expect(r.tag).toEqual({ mood: '平静', intensity: 0.4, thought: '还行' });
  });
  it('tolerates nested 】 inside a field value', () => {
    const r = extractStateTag('好啦好啦。【状态|心情:开心|强度:0.7|心想:他说【好】就够了】');
    expect(r.clean).toBe('好啦好啦。');
    expect(r.tag).toEqual({ mood: '开心', intensity: 0.7, thought: '他说【好】就够了' });
  });
  it('reports found for a present-but-garbage envelope (engine hides it)', () => {
    expect(extractStateTag('嗯【状态|乱写的】').found).toBe(true);
    expect(extractStateTag('普通回复').found).toBe(false);
  });
  it('parses the optional pat field, alone or after growth', () => {
    const r = extractStateTag('乖啦【状态|心情:得意|强度:0.5|心想:嘿嘿|拍一拍:你戳了戳桃子的脸并说好软】');
    expect(r.clean).toBe('乖啦');
    expect(r.pat).toBe('你戳了戳桃子的脸并说好软');
    const both = extractStateTag('x【状态|心情:a|强度:0.4|心想:b|成长:+0.1|拍一拍:你拍了拍桃子】');
    expect(both.growth).toBeCloseTo(0.1, 5);
    expect(both.pat).toBe('你拍了拍桃子');
  });
  it('strips but nulls a malformed intensity', () => {
    const r = extractStateTag('嗯【状态|心情:平静|强度:abc|心想:x】');
    expect(r.clean).toBe('嗯');
    expect(r.tag).toBeNull();
  });
  it('clamps intensity into 0..1', () => {
    expect(extractStateTag('a【状态|心情:怒|强度:1.8|心想:x】').tag?.intensity).toBe(1);
  });
  it('parses the optional growth field', () => {
    const r = extractStateTag('聊得真好【状态|心情:感动|强度:0.6|心想:记很久|成长:+0.1】');
    expect(r.clean).toBe('聊得真好');
    expect(r.tag?.thought).toBe('记很久');
    expect(r.growth).toBeCloseTo(0.1, 5);
  });
  it('a malformed growth field never invalidates the rest', () => {
    const r = extractStateTag('嗯【状态|心情:平静|强度:0.3|心想:x|成长:abc】');
    expect(r.tag?.mood).toBe('平静');
    expect(r.growth).toBeNull();
  });
});

describe('stripLeakedStateTags', () => {
  it('removes historical envelopes anywhere in saved content', () => {
    expect(
      stripLeakedStateTags('前半句\n【状态|心情:愉悦|强度:0.75|心想:x|主人:调教:+3】\n后半句'),
    ).toBe('前半句\n后半句');
  });
  it('leaves normal brackets alone', () => {
    expect(stripLeakedStateTags('你好【括号无关】啊')).toBe('你好【括号无关】啊');
  });
  it('removes an envelope with nested 】 without leaving a remnant', () => {
    expect(stripLeakedStateTags('前半句\n【状态|心情:开心|心想:他说【好】就够了】')).toBe('前半句');
    expect(stripLeakedStateTags('好啦。【状态|心想:他说【好】了】')).toBe('好啦。');
  });
});

describe('cleanDraftForDisplay', () => {
  it('hides a complete tag', () => {
    expect(cleanDraftForDisplay('你好【状态|心情:开心|强度:0.5|心想:嗯】')).toBe('你好');
  });
  it('hides a half-arrived tag', () => {
    expect(cleanDraftForDisplay('你好【状态|心情:开')).toBe('你好');
  });
  it('hides a complete tag whose 心想 contains nested 】', () => {
    expect(cleanDraftForDisplay('你好【状态|心情:开|心想:他说【好】就够了】')).toBe('你好');
  });
  it('leaves tagless drafts alone', () => {
    expect(cleanDraftForDisplay('你好【括号无关】啊')).toBe('你好【括号无关】啊');
  });
});

describe('half-width envelope tolerance (v2.2.1 field report)', () => {
  it('parses the EXACT field case: [状态|...] with half-width brackets', () => {
    const raw =
      '晚安。\n[状态|心情:宠溺|强度:0.6|心想:我确实习惯了——不是戏谑，而是每一天都在习惯他的存在。]';
    const r = extractStateTag(raw);
    expect(r.found).toBe(true);
    expect(r.tag?.mood).toBe('宠溺');
    expect(r.tag?.intensity).toBe(0.6);
    expect(r.tag?.thought).toContain('习惯他的存在');
    expect(r.clean).toBe('晚安。');
  });

  it('parses mixed brackets and full-width pipes', () => {
    expect(extractStateTag('好。\n[状态|心情:x|强度:0.3|心想:y】').tag?.mood).toBe('x');
    expect(extractStateTag('好。\n【状态｜心情:z｜强度:0.5｜心想:w】').tag?.mood).toBe('z');
  });

  it('does NOT treat field-less prose brackets as an envelope', () => {
    const r = extractStateTag('别再写[状态|这种东西]');
    expect(r.found).toBe(false);
    expect(r.clean).toBe('别再写[状态|这种东西]');
  });

  it('stripLeakedStateTags removes half-width envelopes from history', () => {
    expect(stripLeakedStateTags('前半句\n[状态|心情:开心|强度:0.6|心想:嗯]')).toBe('前半句');
  });

  it('cleanDraftForDisplay hides a streaming half-width tag', () => {
    expect(cleanDraftForDisplay('你好\n[状态|心情:开')).toBe('你好');
  });
});
