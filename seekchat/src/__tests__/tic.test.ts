import { detectTic, TIC_MIN_REPEATS, TIC_WINDOW } from '../lib/tic';

const TIC = [
  '你这段话，如果我是在喝水的时候看到，恐怕已经呛到了。',
  '今天好困……',
  '你这段话，比起"早安""晚安"，是你今天发过最真诚的。',
  '嗯嗯，我知道啦。',
  '你这段话，如果我是在走路的时候看到，恐怕已经绊倒了。',
];

describe('detectTic', () => {
  it('detects a repeated opening phrase (3+ of recent replies)', () => {
    expect(detectTic(TIC)).toBe('你这段话');
  });

  it('returns null for varied openings', () => {
    expect(detectTic(['早呀。', '在忙什么？', '想你了。', '晚安啦。'])).toBeNull();
  });

  it('returns null below the repeat threshold or with too few messages', () => {
    expect(detectTic(TIC.slice(0, 3))).toBeNull(); // only 2 tic openings
    expect(detectTic([])).toBeNull();
    expect(TIC_MIN_REPEATS).toBe(3);
  });

  it('ignores very short messages and only reads the recent window', () => {
    expect(detectTic(['嗯。', '嗯。', '嗯。', '嗯。'])).toBeNull();
    const old = Array.from({ length: 10 }, () => '你这段话，老的老的。');
    const recent = Array.from({ length: TIC_WINDOW }, (_, i) => `第${i}句的开头各不相同呀。`);
    expect(detectTic([...old, ...recent])).toBeNull(); // old tics outside the window
  });
});
