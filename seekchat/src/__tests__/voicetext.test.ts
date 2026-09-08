import {
  prepareSpeechText, moodToEmotion, voiceDayKey, canSpeakToday,
} from '../lib/voicetext';

describe('prepareSpeechText', () => {
  it('strips a complete half-width marker', () => {
    expect(prepareSpeechText('你好[表情:开心]呀', { readParens: false })).toBe('你好呀');
  });

  it('strips a complete fullwidth marker', () => {
    expect(prepareSpeechText('看这个【照片:海边】真好看', { readParens: false })).toBe('看这个真好看');
  });

  it('strips a dangling half-marker at the end of the string', () => {
    expect(prepareSpeechText('[照片:半截', { readParens: false })).toBe('');
  });

  it('strips a dangling half-marker trailing real prose', () => {
    expect(prepareSpeechText('今天天气不错[照片:半截', { readParens: false })).toBe('今天天气不错');
  });

  it('strips markdown emphasis, bold, and code but keeps the inner text', () => {
    expect(prepareSpeechText('这是*重点*，**非常重要**，用`code`试试', { readParens: false }))
      .toBe('这是重点，非常重要，用code试试');
  });

  it('strips emoji (supplementary-plane pictographs)', () => {
    expect(prepareSpeechText('今天好开心😊🎉！', { readParens: false })).toBe('今天好开心！');
  });

  it('strips emoji (BMP dingbat/symbol block, incl. a variation selector)', () => {
    expect(prepareSpeechText('搞定了✅约好了⏰', { readParens: false })).toBe('搞定了约好了');
  });

  it('removes fullwidth paren segments when readParens is false', () => {
    expect(prepareSpeechText('她笑了（甜甜地笑着）', { readParens: false })).toBe('她笑了');
  });

  it('keeps the inner text of fullwidth parens (parens dropped) when readParens is true', () => {
    expect(prepareSpeechText('她笑了（甜甜地笑着）', { readParens: true })).toBe('她笑了甜甜地笑着');
  });

  it('treats half-width parens the same as fullwidth (both stage-direction conventions)', () => {
    expect(prepareSpeechText('她笑了(甜甜地笑着)', { readParens: false })).toBe('她笑了');
    expect(prepareSpeechText('她笑了(甜甜地笑着)', { readParens: true })).toBe('她笑了甜甜地笑着');
  });

  it('collapses whitespace and trims', () => {
    expect(prepareSpeechText('你好    呀\n\n再见', { readParens: false })).toBe('你好 呀 再见');
  });

  it('reduces a whitespace-only string to empty', () => {
    expect(prepareSpeechText('   \n\t  ', { readParens: false })).toBe('');
  });

  it('strips a leaked leading timestamp', () => {
    expect(prepareSpeechText('[07-22 10:30]早上好', { readParens: false })).toBe('早上好');
  });
});

describe('moodToEmotion', () => {
  it.each([
    ['开心', 'happy'], ['高兴', 'happy'],
    ['难过', 'sad'], ['伤心', 'sad'],
    ['生气', 'angry'], ['愤怒', 'angry'],
    ['平静', 'calm'],
    ['惊讶', 'surprised'],
    ['害怕', 'fearful'],
    ['厌恶', 'disgusted'],
  ])('maps %s to %s', (label, emotion) => {
    expect(moodToEmotion(label)).toBe(emotion);
  });

  it('returns undefined for a real but unmapped mood word (委屈)', () => {
    expect(moodToEmotion('委屈')).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(moodToEmotion(null)).toBeUndefined();
  });
});

describe('voiceDayKey', () => {
  it('is a global YYYYMMDD key (no conversation scoping)', () => {
    expect(voiceDayKey(new Date(2026, 6, 22, 23, 59))).toBe('voice.chars.20260722');
  });

  it('rolls over at midnight', () => {
    const before = new Date(2026, 6, 21, 23, 59, 59);
    const after = new Date(2026, 6, 22, 0, 0, 1);
    expect(voiceDayKey(before)).not.toBe(voiceDayKey(after));
  });
});

describe('canSpeakToday', () => {
  it('allows exactly at the cap and blocks one char over', () => {
    expect(canSpeakToday(18000, 2000, 20000)).toBe(true);
    expect(canSpeakToday(18000, 2001, 20000)).toBe(false);
  });
});
