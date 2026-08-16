import { buildCutPrompt, needsCut, parseCut, CUT_MIN_LEN } from '../lib/cutter';

const LONG =
  '今天真的好累，加班到十点才回家。路上买了碗关东煮，坐在便利店门口吃完才觉得活过来。' +
  '你呢？记得你说今天要交那个报告，顺利吗？别又熬夜了，听到没。';

describe('needsCut', () => {
  it('wants a cut for long, unsegmented replies only', () => {
    expect(needsCut(LONG)).toBe(true);
    expect(needsCut('短的。')).toBe(false);
    expect(needsCut(LONG + '\n---\n她自己已经切好了')).toBe(false);
    expect(LONG.length).toBeGreaterThanOrEqual(CUT_MIN_LEN);
  });
});

describe('buildCutPrompt', () => {
  it('carries the text and the insert-only instruction', () => {
    const s = buildCutPrompt(LONG);
    expect(s).toContain('关东煮');
    expect(s).toContain('---');
    expect(s).toMatch(/不改动|不要改|一字不差/);
  });
});

describe('parseCut — the zero-trust guard', () => {
  it('accepts a pure separator insertion and returns the segments', () => {
    const cut =
      '今天真的好累，加班到十点才回家。\n---\n路上买了碗关东煮，坐在便利店门口吃完才觉得活过来。\n---\n' +
      '你呢？记得你说今天要交那个报告，顺利吗？别又熬夜了，听到没。';
    const segs = parseCut(LONG, cut);
    expect(segs).not.toBeNull();
    expect(segs!.length).toBe(3);
    expect(segs![0]).toBe('今天真的好累，加班到十点才回家。');
  });

  it('rejects ANY text alteration — rewrites, additions, deletions', () => {
    expect(parseCut(LONG, LONG.replace('关东煮', '麻辣烫'))).toBeNull();
    expect(parseCut(LONG, '好的，切好了：\n' + LONG)).toBeNull();
    expect(parseCut(LONG, LONG.slice(0, 30) + '\n---\n' + LONG.slice(40))).toBeNull();
  });

  it('rejects no-op output (no --- inserted) and absurd cuts', () => {
    expect(parseCut(LONG, LONG)).toBeNull(); // nothing to do → caller keeps original
    const shredded = LONG.split('').join('\n---\n'); // 1-char confetti
    expect(parseCut(LONG, shredded)).toBeNull();
  });

  it('tolerates whitespace shuffling around cut points only', () => {
    const cut = LONG.slice(0, 20) + ' \n--- \n ' + LONG.slice(20);
    const segs = parseCut(LONG, cut);
    expect(segs).not.toBeNull();
    expect(segs!.join('')).toBe(LONG.replace(/\s+/g, ''));
  });
});
