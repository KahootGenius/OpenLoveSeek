import {
  buildStickerPromptSection, extractStickerMarkers, parseManifest, resolveSticker,
} from '../lib/stickers';
import { b64ToU8, u8ToB64 } from '../lib/base64';

describe('parseManifest', () => {
  it('accepts valid entries and drops broken ones', () => {
    const json = JSON.stringify([
      { file: '01.png', label: '开心', desc: '她开心地跳起来' },
      { file: '02.png', label: '', desc: 'no label' },
      { notEven: 'close' },
    ]);
    expect(parseManifest(json)).toEqual([
      { file: '01.png', label: '开心', desc: '她开心地跳起来' },
    ]);
  });
  it('rejects non-arrays and garbage', () => {
    expect(parseManifest('{"a":1}')).toBeNull();
    expect(parseManifest('not json')).toBeNull();
    expect(parseManifest('[]')).toBeNull();
  });
});

describe('extractStickerMarkers', () => {
  it('pulls marker lines out of the reply', () => {
    const r = extractStickerMarkers('好呀好呀\n[表情:开心]\n那就这么定了');
    expect(r.labels).toEqual(['开心']);
    expect(r.clean).toBe('好呀好呀\n那就这么定了');
  });
  it('caps at two and accepts fullwidth colon', () => {
    const r = extractStickerMarkers('[表情：一]\n[表情:二]\n[表情:三]');
    expect(r.labels).toEqual(['一', '二']);
  });
  it('leaves inline mentions alone', () => {
    const r = extractStickerMarkers('我发的不是[表情:假的]这种');
    expect(r.labels).toEqual([]);
    expect(r.clean).toBe('我发的不是[表情:假的]这种');
  });
  it('tolerates the [发送了表情包:X] drift the model copies from its transcript', () => {
    // the exact failure from the field report (hex label, space after colon)
    const r = extractStickerMarkers('不许催我换衣服\n[发送了表情包: 35B074C5C9519245967B]');
    expect(r.labels).toEqual(['35B074C5C9519245967B']);
    expect(r.clean).toBe('不许催我换衣服');
  });
  it('tolerates [表情包:X] and fullwidth 【表情：X】 variants', () => {
    expect(extractStickerMarkers('[表情包:开心]').labels).toEqual(['开心']);
    expect(extractStickerMarkers('【表情：开心】').labels).toEqual(['开心']);
    expect(extractStickerMarkers('好耶\n---\n[发送了表情包：开心]').labels).toEqual(['开心']);
  });
  it('strips a marker occupying its own --- segment', () => {
    const r = extractStickerMarkers('第一句\n---\n[表情:开心]\n---\n第二句');
    expect(r.labels).toEqual(['开心']);
    expect(r.clean).toBe('第一句\n---\n第二句');
  });
  it('never crosses newlines: a dangling head must not swallow the next prose line', () => {
    const text = '在吗\n[表情：\n今天有点想你了]\n晚点聊';
    const r = extractStickerMarkers(text);
    expect(r.labels).toEqual([]);
    expect(r.clean).toBe(text);
  });
  it('pairs openers with their own closer (【】 allowed inside a half-width label)', () => {
    expect(extractStickerMarkers('[表情:【原神】款贴纸]').labels).toEqual(['【原神】款贴纸']);
    const trailing = extractStickerMarkers('[表情:开心]哈哈哈');
    expect(trailing.labels).toEqual([]);
    expect(trailing.clean).toBe('[表情:开心]哈哈哈');
  });
});

describe('resolveSticker', () => {
  const packs = [
    { label: '35B074C5C9519245967B', desc: '她刚睡醒眨眼wink' },
    { label: '开心', desc: '她开心地跳起来' },
  ];
  it('resolves exact and trimmed labels', () => {
    expect(resolveSticker(packs, '开心')?.label).toBe('开心');
    expect(resolveSticker(packs, ' 35B074C5C9519245967B ')?.desc).toContain('wink');
  });
  it('resolves case-insensitively (hex filename labels)', () => {
    expect(resolveSticker(packs, '35b074c5c9519245967b')?.label).toBe('35B074C5C9519245967B');
  });
  it('resolves when the marker embeds the label in extra text', () => {
    expect(resolveSticker(packs, '发送开心表情')?.label).toBe('开心');
  });
  it('containment prefers the most specific label, not import order', () => {
    const overlapPack = [
      { label: '心', desc: '一颗爱心' },
      { label: '开心', desc: '她开心地跳起来' },
    ];
    expect(resolveSticker(overlapPack, '开心的')?.label).toBe('开心');
  });
  it('falls back to description containment', () => {
    expect(resolveSticker(packs, '她开心地跳起来')?.label).toBe('开心');
  });
  it('returns null for unknown and empty', () => {
    expect(resolveSticker(packs, '不存在的东西')).toBeNull();
    expect(resolveSticker(packs, '  ')).toBeNull();
  });
});

describe('buildStickerPromptSection', () => {
  it('lists labels with descriptions', () => {
    const out = buildStickerPromptSection([{ label: '开心', desc: '她开心地跳起来' }]);
    expect(out).toContain('【表情包】');
    expect(out).toContain('- 开心：她开心地跳起来');
    expect(out).toContain('[表情:标签]');
  });
});

describe('base64', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 137, 80, 78, 71]);
    expect(Array.from(b64ToU8(u8ToB64(bytes)))).toEqual(Array.from(bytes));
  });
  it('handles lengths not divisible by three', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const bytes = new Uint8Array(Array.from({ length: n }, (_, i) => i * 37 % 256));
      expect(Array.from(b64ToU8(u8ToB64(bytes)))).toEqual(Array.from(bytes));
    }
  });
});
