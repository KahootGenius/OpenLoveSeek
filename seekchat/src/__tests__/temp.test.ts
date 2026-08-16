import {
  buildTempClassifierPrompt, currentUserBurst, parseTempChoice, TEMP_BY_CHOICE,
} from '../lib/temp';

describe('buildTempClassifierPrompt', () => {
  it('contains the message, all three registers, and the one-word instruction', () => {
    const s = buildTempClassifierPrompt('我们聊聊我日记里写的那件事吧');
    expect(s).toContain('日记里写的那件事');
    expect(s).toContain('严谨');
    expect(s).toContain('平衡');
    expect(s).toContain('奔放');
    expect(s).toContain('只输出一个词');
  });

  it('truncates very long messages', () => {
    const s = buildTempClassifierPrompt('长'.repeat(800));
    expect(s.length).toBeLessThan(800);
  });

  it('keeps leading context and the newest question within the 500-character excerpt', () => {
    const firstFragment =
      '日记事实：我只写了下雨。' +
      '中'.repeat(700) +
      'MIDDLE_SENTINEL' +
      '填'.repeat(700);
    const finalQuestion = '最后我问：日记里有没有写我去了巴黎？';
    const s = buildTempClassifierPrompt(`${firstFragment}\n${finalQuestion}`);
    const excerpt = s.match(/消息：「([\s\S]*)」\n只输出一个词/)?.[1];

    expect(excerpt).toBeDefined();
    expect(excerpt).toContain('日记事实：我只写了下雨。');
    expect(excerpt).toContain(finalQuestion);
    expect(excerpt).not.toContain('MIDDLE_SENTINEL');
    expect(excerpt!.length).toBeLessThanOrEqual(500);
  });
});

describe('parseTempChoice', () => {
  it('accepts the exact word', () => {
    expect(parseTempChoice('严谨')).toBe('严谨');
    expect(parseTempChoice(' 奔放\n')).toBe('奔放');
  });

  it('finds the conclusion when the model chats around it (last occurrence wins)', () => {
    expect(parseTempChoice('我觉得应该是严谨。')).toBe('严谨');
    expect(parseTempChoice('平衡还是奔放？我选奔放')).toBe('奔放');
  });

  it('garbage → null (caller falls back to the manual setting)', () => {
    expect(parseTempChoice('无法判断')).toBeNull();
    expect(parseTempChoice('')).toBeNull();
  });
});

describe('TEMP_BY_CHOICE', () => {
  it('matches the manual 想象力 values', () => {
    expect(TEMP_BY_CHOICE.严谨).toBe(0.6);
    expect(TEMP_BY_CHOICE.平衡).toBe(1.0);
    expect(TEMP_BY_CHOICE.奔放).toBe(1.3);
  });
});

describe('currentUserBurst', () => {
  const row = (
    content: string,
    role: 'user' | 'assistant' = 'user',
    kind: 'normal' | 'sticker' = 'normal',
  ) => ({ content, role, kind });

  it('joins the trailing consecutive normal user fragments in order', () => {
    const text = currentUserBurst([
      row('之前的话', 'assistant'),
      row('我日记里写的那件事'),
      row('你怎么看'),
    ]);
    expect(text).toBe('我日记里写的那件事\n你怎么看');
  });

  it('stops at the previous assistant turn and ignores non-prose tail rows', () => {
    const text = currentUserBurst([
      row('旧问题'),
      row('旧回答', 'assistant'),
      row('新的事实问题'),
      row('贴纸id', 'user', 'sticker'),
    ]);
    expect(text).toBe('新的事实问题');
  });

  it('returns empty when there is no normal user prose', () => {
    expect(currentUserBurst([row('贴纸id', 'user', 'sticker')])).toBe('');
  });

  it('does not cross an assistant turn before finding normal user prose', () => {
    expect(currentUserBurst([
      row('旧问题'),
      row('旧回答', 'assistant'),
      row('贴纸id', 'user', 'sticker'),
    ])).toBe('');
  });
});
