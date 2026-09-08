import {
  buildT2AInput, MINIMAX_HOSTS, MINIMAX_MODEL, parseT2AResponse, userMessageForMiniMax,
} from '../lib/minimax';

describe('buildT2AInput', () => {
  it('builds the url-mode request with voice settings', () => {
    expect(buildT2AInput({ text: '你好', voiceId: 'v1', speed: 1.2 })).toEqual({
      model: MINIMAX_MODEL,
      text: '你好',
      output_format: 'url',
      voice_setting: { voice_id: 'v1', speed: 1.2, vol: 1.0, pitch: 0 },
      audio_setting: { format: 'mp3', sample_rate: 32000, bitrate: 128000 },
    });
  });
  it('includes emotion only when provided', () => {
    expect(buildT2AInput({ text: 'x', voiceId: 'v', speed: 1, emotion: 'happy' })
      .voice_setting.emotion).toBe('happy');
    expect('emotion' in buildT2AInput({ text: 'x', voiceId: 'v', speed: 1 }).voice_setting)
      .toBe(false);
  });
});

describe('parseT2AResponse', () => {
  it('extracts the audio url and usage on success', () => {
    expect(parseT2AResponse({
      base_resp: { status_code: 0 }, data: { audio: 'https://a/x.mp3' },
      extra_info: { usage_characters: 42 },
    })).toEqual({ url: 'https://a/x.mp3', usageCharacters: 42 });
  });
  it('throws MiniMaxError with the status code on failure or malformed data', () => {
    expect(() => parseT2AResponse({ base_resp: { status_code: 1004 } })).toThrow();
    expect(() => parseT2AResponse({ base_resp: { status_code: 0 }, data: {} })).toThrow();
  });
});

describe('userMessageForMiniMax', () => {
  it('maps the documented codes to friendly text', () => {
    expect(userMessageForMiniMax(1004)).toContain('Key');
    expect(userMessageForMiniMax(1002)).toContain('稍后');
    expect(userMessageForMiniMax(1039)).toContain('稍后');
    expect(userMessageForMiniMax(1042)).toContain('字符');
    expect(userMessageForMiniMax(2013)).toContain('参数');
    expect(userMessageForMiniMax(1000)).toContain('服务');
  });
});
