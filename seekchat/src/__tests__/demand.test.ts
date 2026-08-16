import { demandSatisfied } from '../lib/demand';

describe('demandSatisfied', () => {
  it('matches ignoring punctuation and spaces', () => {
    expect(demandSatisfied('我爱你', '我爱你')).toBe(true);
    expect(demandSatisfied('我爱你！！', '我爱你')).toBe(true);
    expect(demandSatisfied('我 爱 你', '我爱你')).toBe(true);
    expect(demandSatisfied('嗯……我爱你啦', '我爱你')).toBe(true);
  });
  it('rejects when the phrase is not present or empty', () => {
    expect(demandSatisfied('我不爱你', '我爱你')).toBe(false);
    expect(demandSatisfied('随便打的', '我爱你')).toBe(false);
    expect(demandSatisfied('anything', '')).toBe(false);
  });
});
