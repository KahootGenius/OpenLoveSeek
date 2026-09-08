import {
  REF_SLOT_COUNT, composeRefPrompts, composeScenePrompt, composeSceneOnlyPrompt, imageDayKey,
  canGenerateToday, extractImageMarker, imagePlaceholder, imageModelText, failStalePending,
} from '../lib/imagegen';

describe('composeRefPrompts', () => {
  it('contains the appearance text in all 3 slots and the 3 differ pairwise', () => {
    const appearance = '长发，棕色眼睛，温柔的笑容';
    const prompts = composeRefPrompts(appearance);
    expect(prompts.length).toBe(REF_SLOT_COUNT);
    for (const p of prompts) expect(p).toContain(appearance);
    expect(prompts[0]).not.toBe(prompts[1]);
    expect(prompts[0]).not.toBe(prompts[2]);
    expect(prompts[1]).not.toBe(prompts[2]);
  });
});

describe('composeScenePrompt', () => {
  it('contains both the appearance and the scene', () => {
    const s = composeScenePrompt('长发，棕色眼睛', '在海边散步');
    expect(s).toContain('长发，棕色眼睛');
    expect(s).toContain('在海边散步');
  });
});

describe('composeSceneOnlyPrompt (实拍 — no appearance)', () => {
  it('is exactly the scene plus the candid-photo style suffix', () => {
    expect(composeSceneOnlyPrompt('海边日落，浪花拍岸'))
      .toBe('海边日落，浪花拍岸。手机随手拍质感，真实生活照');
  });

  it('trims the scene and never mentions appearance', () => {
    const s = composeSceneOnlyPrompt('  一盘红烧肉，冒着热气  ');
    expect(s).toBe('一盘红烧肉，冒着热气。手机随手拍质感，真实生活照');
    expect(s).not.toContain('  '); // no stray double-space from an unstripped edge
  });
});

describe('imageDayKey', () => {
  it('is namespaced by conversation and stable within the same day', () => {
    const d = new Date(2026, 6, 21, 23, 59);
    expect(imageDayKey('c1', d)).toBe('img.c1.20260721');
    expect(imageDayKey('c2', d)).toBe('img.c2.20260721');
  });

  it('rolls over at midnight', () => {
    const before = new Date(2026, 6, 21, 23, 59, 59);
    const after = new Date(2026, 6, 22, 0, 0, 1);
    expect(imageDayKey('c1', before)).not.toBe(imageDayKey('c1', after));
  });
});

describe('canGenerateToday', () => {
  it('allows under the cap and blocks at it (boundary)', () => {
    expect(canGenerateToday(4, 5)).toBe(true);
    expect(canGenerateToday(5, 5)).toBe(false);
  });
});

describe('extractImageMarker', () => {
  it('extracts a single scene marker and strips it', () => {
    const r = extractImageMarker('今天天气真好[照片:在海边]');
    expect(r.scene).toBe('在海边');
    expect(r.shot).toBe('selfie');
    expect(r.clean).toBe('今天天气真好');
  });

  it('first wins when multiple markers appear; extras strip silently', () => {
    const r = extractImageMarker('[照片:在海边]中间的话[照片:在咖啡馆]');
    expect(r.scene).toBe('在海边');
    expect(r.shot).toBe('selfie');
    expect(r.clean).toBe('中间的话');
  });

  it('recognizes the fullwidth colon', () => {
    const r = extractImageMarker('看这个[照片：在公园]');
    expect(r.scene).toBe('在公园');
    expect(r.shot).toBe('selfie');
    expect(r.clean).toBe('看这个');
  });

  it('returns scene null and leaves the text unchanged when absent', () => {
    const r = extractImageMarker('普通的一句话');
    expect(r.scene).toBeNull();
    expect(r.shot).toBe('selfie');
    expect(r.clean).toBe('普通的一句话');
  });

  it('treats an empty payload as no scene', () => {
    const r = extractImageMarker('嗯[照片:]好的');
    expect(r.scene).toBeNull();
    expect(r.shot).toBe('selfie');
    expect(r.clean).toBe('嗯好的');
  });
});

describe('extractImageMarker — 实拍|场景 discriminator (v2.8)', () => {
  it('实拍 prefix (ASCII pipe) routes to shot scene; scene is the rest', () => {
    const r = extractImageMarker('[照片:实拍|海边日落，浪花拍岸]');
    expect(r.scene).toBe('海边日落，浪花拍岸');
    expect(r.shot).toBe('scene');
    expect(r.clean).toBe('');
  });

  it('实拍 prefix via the fullwidth ｜ delimiter also routes to shot scene', () => {
    const r = extractImageMarker('闻到了[照片:实拍｜一盘红烧肉，冒着热气]好香');
    expect(r.scene).toBe('一盘红烧肉，冒着热气');
    expect(r.shot).toBe('scene');
    expect(r.clean).toBe('闻到了好香');
  });

  it('trims whitespace around the 实拍 prefix itself', () => {
    const r = extractImageMarker('[照片: 实拍 |窗外的晚霞]');
    expect(r.scene).toBe('窗外的晚霞');
    expect(r.shot).toBe('scene');
  });

  it('an unknown prefix keeps the WHOLE payload as the scene, shot stays selfie', () => {
    const r = extractImageMarker('[照片:靠窗坐着|喝咖啡]');
    expect(r.scene).toBe('靠窗坐着|喝咖啡');
    expect(r.shot).toBe('selfie');
  });

  it('absent discriminator (plain payload, no pipe) is shot selfie — default path', () => {
    const r = extractImageMarker('[照片:在海边]');
    expect(r.scene).toBe('在海边');
    expect(r.shot).toBe('selfie');
  });

  it('empty scene after the 实拍 prefix degrades to no scene at all (same as no payload)', () => {
    const r = extractImageMarker('[照片:实拍|]');
    expect(r.scene).toBeNull();
    expect(r.shot).toBe('selfie');
  });

  it('empty scene after 实拍| does not block a later, well-formed marker from winning', () => {
    const r = extractImageMarker('[照片:实拍|]然后[照片:实拍|窗外的晚霞]');
    expect(r.scene).toBe('窗外的晚霞');
    expect(r.shot).toBe('scene');
  });
});

describe('imagePlaceholder', () => {
  it('renders the scene from a done row', () => {
    const content = JSON.stringify({ status: 'done', scene: '在海边散步', uri: 'file:///x.jpg' });
    expect(imagePlaceholder(content)).toBe('（发送了一张照片：在海边散步）');
  });

  it('falls back to a generic placeholder on corrupt JSON', () => {
    expect(imagePlaceholder('{not json')).toBe('（发送了一张照片）');
  });

  it('falls back to a generic placeholder when the scene is missing', () => {
    expect(imagePlaceholder(JSON.stringify({ status: 'pending' }))).toBe('（发送了一张照片）');
  });
});

describe('imageModelText', () => {
  it('renders a done row in the SAME marker form she is taught to emit', () => {
    const content = JSON.stringify({ status: 'done', scene: '靠窗喝咖啡', uri: 'file:///x.jpg' });
    expect(imageModelText(content)).toBe('[照片:靠窗喝咖啡]');
  });

  it('renders a pending row the same way', () => {
    const content = JSON.stringify({ status: 'pending', scene: '靠窗喝咖啡' });
    expect(imageModelText(content)).toBe('[照片:靠窗喝咖啡]');
  });

  it('renders a failed row as a failure line, never the marker', () => {
    const content = JSON.stringify({ status: 'failed', scene: '靠窗喝咖啡', reason: 'x' });
    expect(imageModelText(content)).toBe('（照片没有发出去）');
  });

  it('falls back to the generic placeholder on corrupt JSON', () => {
    expect(imageModelText('{not json')).toBe('（发送了一张照片）');
  });

  it('falls back to the generic placeholder when the scene is missing', () => {
    expect(imageModelText(JSON.stringify({ status: 'done' }))).toBe('（发送了一张照片）');
  });
});

describe('imageModelText — shot round-trip (v2.8)', () => {
  it('re-serializes a shot:scene row with the 实拍| discriminator — the EXACT emit form', () => {
    const content = JSON.stringify({
      status: 'done', scene: '一盘红烧肉，冒着热气', shot: 'scene', uri: 'file:///x.jpg',
    });
    expect(imageModelText(content)).toBe('[照片:实拍|一盘红烧肉，冒着热气]');
  });

  it('re-serializes a shot:selfie row unchanged (no discriminator)', () => {
    const content = JSON.stringify({
      status: 'done', scene: '靠窗喝咖啡', shot: 'selfie', uri: 'file:///x.jpg',
    });
    expect(imageModelText(content)).toBe('[照片:靠窗喝咖啡]');
  });

  it('a pending shot:scene row round-trips the same as done', () => {
    const content = JSON.stringify({ status: 'pending', scene: '窗外的晚霞', shot: 'scene' });
    expect(imageModelText(content)).toBe('[照片:实拍|窗外的晚霞]');
  });

  it('legacy rows with no shot field at all default to the selfie form (pre-v2.8 rows)', () => {
    const content = JSON.stringify({ status: 'done', scene: '靠窗喝咖啡', uri: 'file:///x.jpg' });
    expect(imageModelText(content)).toBe('[照片:靠窗喝咖啡]');
  });
});

describe('failStalePending', () => {
  it('flips a pending row to failed with a retry reason, keeping the scene', () => {
    const input = JSON.stringify({ status: 'pending', scene: '在海边' });
    expect(JSON.parse(failStalePending(input))).toEqual({
      status: 'failed', scene: '在海边', reason: '生成中断了，点重试再拍一次',
    });
  });

  it('returns non-pending content unchanged', () => {
    const input = JSON.stringify({ status: 'done', scene: '在海边', uri: 'file:///x.jpg' });
    expect(failStalePending(input)).toBe(input);
  });

  it('returns corrupt content unchanged', () => {
    expect(failStalePending('{not json')).toBe('{not json');
  });
});

describe('failStalePending — preserves the shot field (v2.8, unknown fields ride)', () => {
  it('carries shot:scene through the pending→failed flip untouched', () => {
    const input = JSON.stringify({ status: 'pending', scene: '一盘红烧肉', shot: 'scene' });
    expect(JSON.parse(failStalePending(input))).toEqual({
      status: 'failed', scene: '一盘红烧肉', shot: 'scene', reason: '生成中断了，点重试再拍一次',
    });
  });

  it('legacy pending rows with no shot field do not gain one', () => {
    const input = JSON.stringify({ status: 'pending', scene: '在海边' });
    const out = JSON.parse(failStalePending(input));
    expect(out).toEqual({
      status: 'failed', scene: '在海边', reason: '生成中断了，点重试再拍一次',
    });
    expect('shot' in out).toBe(false);
  });
});
