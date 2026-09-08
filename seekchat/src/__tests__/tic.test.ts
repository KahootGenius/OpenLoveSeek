import {
  detectLengthRut, detectStructureRut, detectTic, pickVarietyNudge,
  recentAssistantTurnBodies, replySignature,
  RUT_MIN_RUN, TIC_MIN_REPEATS, TIC_WINDOW,
} from '../lib/tic';

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

const LONG = '这是一条超过一百二十个字的超长回复，'.repeat(8); // ≥120 chars
const MID =
  '这是一条长度刚好落在四十到一百一十九个字之间的中等长度回复，用来测试中间档位的判定，大概就是这么长吧。'; // 40–119
const TWO_FRAG_LONG = `${LONG}---${MID}`;

describe('replySignature', () => {
  it('buckets fragments and length', () => {
    expect(replySignature('嗯嗯。')).toBe('1段·短');
    expect(replySignature(MID)).toBe('1段·中');
    expect(replySignature(TWO_FRAG_LONG)).toBe('2段·长');
    expect(replySignature(`${MID}---${MID}---${MID}`)).toBe('3段+·长');
  });

  it('locks the bucket boundaries at 40 and 120', () => {
    expect(replySignature('字'.repeat(39))).toBe('1段·短');
    expect(replySignature('字'.repeat(40))).toBe('1段·中');
    expect(replySignature('字'.repeat(119))).toBe('1段·中');
    expect(replySignature('字'.repeat(120))).toBe('1段·长');
  });
});

describe('detectStructureRut', () => {
  it('fires when the last consecutive replies share a non-trivial signature', () => {
    expect(detectStructureRut(Array.from({ length: RUT_MIN_RUN }, () => TWO_FRAG_LONG)))
      .toBe('2段·长');
  });

  it('never nags natural short chatter', () => {
    expect(detectStructureRut(['嗯。', '哦哦。', '好呀。', '行。'])).toBeNull();
    expect(detectStructureRut(Array.from({ length: RUT_MIN_RUN }, () => MID))).toBeNull();
  });

  it('stays quiet for varied tails or short histories', () => {
    expect(detectStructureRut([TWO_FRAG_LONG, TWO_FRAG_LONG, TWO_FRAG_LONG, MID])).toBeNull();
    expect(detectStructureRut([TWO_FRAG_LONG, TWO_FRAG_LONG, TWO_FRAG_LONG])).toBeNull();
  });
});

describe('detectLengthRut', () => {
  it('fires when the last consecutive replies are all 长 even with varied structure', () => {
    expect(detectLengthRut([LONG, TWO_FRAG_LONG, LONG, `${LONG}---${LONG}`])).toBe(true);
  });

  it('clears as soon as one recent reply is not 长', () => {
    expect(detectLengthRut([LONG, LONG, LONG, MID])).toBe(false);
    expect(detectLengthRut([LONG, LONG, LONG])).toBe(false);
  });
});

describe('pickVarietyNudge', () => {
  it('prefers the structure rut and falls back to the length rut', () => {
    expect(pickVarietyNudge(Array.from({ length: RUT_MIN_RUN }, () => TWO_FRAG_LONG)))
      .toEqual({ kind: 'structure', pattern: '2段·长' });
    expect(pickVarietyNudge([LONG, TWO_FRAG_LONG, LONG, `${LONG}---${LONG}`]))
      .toEqual({ kind: 'length' });
    expect(pickVarietyNudge(['早呀。', MID, '想你了。', '晚安。'])).toBeNull();
  });
});

describe('recentAssistantTurnBodies', () => {
  const row = (role: 'user' | 'assistant', kind: string, content: string) =>
    ({ role, kind, content }) as Parameters<typeof recentAssistantTurnBodies>[0][number];

  it('rejoins a cutter burst into the turn she actually authored', () => {
    const bodies = recentAssistantTurnBodies([
      row('user', 'normal', '早'),
      row('assistant', 'normal', '第一段。'),
      row('assistant', 'normal', '第二段。'),
      row('assistant', 'normal', '第三段。'),
      row('user', 'normal', '嗯'),
      row('assistant', 'normal', '单独一条。'),
    ]);
    expect(bodies).toEqual(['第一段。---第二段。---第三段。', '单独一条。']);
  });

  it('does not let stickers or meta rows split a turn, and skips them as bodies', () => {
    const bodies = recentAssistantTurnBodies([
      row('user', 'normal', '早'),
      row('assistant', 'normal', 'A段。'),
      row('assistant', 'sticker', 'sticker-id'),
      row('assistant', 'normal', 'B段。'),
      row('user', 'sticker', 'sticker-id2'),
      row('assistant', 'normal', 'C段。'),
    ]);
    expect(bodies).toEqual(['A段。---B段。', 'C段。']);
  });

  it('handles leading assistant turns and empty input', () => {
    expect(recentAssistantTurnBodies([row('assistant', 'normal', '开场白。')]))
      .toEqual(['开场白。']);
    expect(recentAssistantTurnBodies([])).toEqual([]);
  });
});
