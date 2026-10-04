import {
  buildChatBody, clampTemperature, classifyError, coerceModel, DEEPSEEK_API_URL, endpointFor,
  GLM_HOSTS, glmThinkingPolicy, isModelOf, parseErrorBody, PROVIDER_ORDER, PROVIDERS, providerOf,
} from '../lib/providers';
import { ApiError, userMessageFor } from '../lib/llm';
import type { ApiMessage, ModelId, Provider } from '../lib/types';

const msgs: ApiMessage[] = [{ role: 'user', content: 'hi' }];
const glmErr = (code: number | string, message = 'm') =>
  JSON.stringify({ error: { code, message } });

describe('catalog', () => {
  it('lists both providers in picker order and every id routes to its own provider', () => {
    expect(PROVIDER_ORDER).toEqual(['deepseek', 'glm']);
    for (const p of PROVIDER_ORDER) {
      const spec = PROVIDERS[p];
      const ids = spec.models.map((m) => m.value);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain(spec.defaultModel);
      expect(providerOf(spec.utilityModel)).toBe(p); // may sit outside the picker (GLM's does)
      for (const id of ids) expect(providerOf(id)).toBe(p);
    }
  });

  it('defaults DeepSeek to V4.1 Flash (`deepseek-flash`) for chat and utility, uncapped temperature', () => {
    expect(PROVIDERS.deepseek.defaultModel).toBe('deepseek-flash');
    expect(PROVIDERS.deepseek.utilityModel).toBe('deepseek-flash');
    expect(PROVIDERS.deepseek.temperatureCap).toBeUndefined();
  });

  it('coerces stored prefs: valid stays, unset/retired/foreign fall back per provider', () => {
    expect(coerceModel('deepseek', 'deepseek-v4-pro')).toBe('deepseek-v4-pro');
    expect(coerceModel('deepseek', null)).toBe('deepseek-flash');
    expect(coerceModel('deepseek', 'deepseek-chat')).toBe('deepseek-flash');
    expect(coerceModel('deepseek', 'deepseek-v4-flash')).toBe('deepseek-flash'); // retired 2026-09-10 alias
    expect(coerceModel('deepseek', 'glm-5.3')).toBe('deepseek-flash');
    expect(coerceModel('glm', 'glm-5.3')).toBe('glm-5.3');
    expect(coerceModel('glm', 'deepseek-v4-pro')).toBe(PROVIDERS.glm.defaultModel);
    expect(coerceModel('glm', undefined)).toBe(PROVIDERS.glm.defaultModel);
    expect(isModelOf('glm', 'glm-4.7-flash')).toBe(true);
    expect(isModelOf('glm', '')).toBe(false);
  });

  it('routes DeepSeek to one host and GLM by region', () => {
    expect(endpointFor('deepseek', 'global')).toBe(DEEPSEEK_API_URL);
    expect(endpointFor('deepseek', 'cn')).toBe(DEEPSEEK_API_URL);
    expect(endpointFor('glm', 'global')).toBe(GLM_HOSTS.global);
    expect(endpointFor('glm', 'cn')).toBe(GLM_HOSTS.cn);
    expect(GLM_HOSTS.global).toMatch(/^https:\/\/api\.z\.ai\//);
    expect(GLM_HOSTS.cn).toMatch(/^https:\/\/open\.bigmodel\.cn\//);
  });
});

describe('clampTemperature', () => {
  it('passes through without a cap and clamps to [0, cap] at two decimals', () => {
    expect(clampTemperature(1.3, undefined)).toBe(1.3);
    expect(clampTemperature(1.3, 1)).toBe(1);
    expect(clampTemperature(0.6, 1)).toBe(0.6);
    expect(clampTemperature(-0.5, 1)).toBe(0);
    expect(clampTemperature(0.666, 1)).toBe(0.67);
  });
});

describe('buildChatBody — DeepSeek', () => {
  it('names thinking on every call (its default is ON at high effort), omits temperature unless given, never clamps', () => {
    expect(buildChatBody({ model: 'deepseek-flash', messages: msgs })).toEqual({
      model: 'deepseek-flash', messages: msgs, stream: true, thinking: { type: 'disabled' },
    });
    expect(buildChatBody({ model: 'deepseek-flash', messages: msgs, thinking: false })).toEqual({
      model: 'deepseek-flash', messages: msgs, stream: true, thinking: { type: 'disabled' },
    });
    expect(
      buildChatBody({ model: 'deepseek-v4-pro', messages: msgs, thinking: true, temperature: 1.3 }),
    ).toEqual({
      model: 'deepseek-v4-pro', messages: msgs, stream: true,
      thinking: { type: 'enabled' }, temperature: 1.3,
    });
    expect(buildChatBody({ model: 'deepseek-v4-pro', messages: msgs })).not.toHaveProperty('reasoning_effort');
  });
});

describe('buildChatBody — GLM', () => {
  it('switchable models name thinking on every call (their default is ON) and cap temperature at 1.0', () => {
    expect(buildChatBody({ model: 'glm-4.7-flashx', messages: msgs })).toEqual({
      model: 'glm-4.7-flashx', messages: msgs, stream: true, thinking: { type: 'disabled' },
    });
    expect(buildChatBody({ model: 'glm-4.7', messages: msgs, thinking: true, temperature: 1.3 }))
      .toEqual({
        model: 'glm-4.7', messages: msgs, stream: true, thinking: { type: 'enabled' }, temperature: 1,
      });
    expect(buildChatBody({ model: 'glm-4.7', messages: msgs, temperature: 0.6 })).toMatchObject({
      thinking: { type: 'disabled' }, temperature: 0.6,
    });
    expect(buildChatBody({ model: 'glm-4.7' , messages: msgs })).not.toHaveProperty('reasoning_effort');
  });

  it('the 5.3 family can never be disabled: thinking stays enabled and reasoning_effort carries the toggle', () => {
    expect(glmThinkingPolicy('glm-5.3')).toBe('always');
    expect(glmThinkingPolicy('glm-5.3-flash')).toBe('always');
    expect(glmThinkingPolicy('glm-4.7')).toBe('switchable');
    expect(buildChatBody({ model: 'glm-5.3-flash', messages: msgs })).toEqual({
      model: 'glm-5.3-flash', messages: msgs, stream: true,
      thinking: { type: 'enabled' }, reasoning_effort: 'low',
    });
    expect(buildChatBody({ model: 'glm-5.3', messages: msgs, thinking: true, temperature: 1.3 })).toEqual({
      model: 'glm-5.3', messages: msgs, stream: true,
      thinking: { type: 'enabled' }, reasoning_effort: 'high', temperature: 1,
    });
    // the utility model is one that CAN switch thinking off
    expect(glmThinkingPolicy(PROVIDERS.glm.utilityModel)).toBe('switchable');
  });
});

describe('parseErrorBody', () => {
  it('reads nested and bare shapes, stringifies numeric codes, nulls on garbage', () => {
    expect(parseErrorBody(glmErr(1113, '欠费'))).toEqual({ code: '1113', message: '欠费' });
    expect(parseErrorBody(JSON.stringify({ code: 1302, message: 'rl' })))
      .toEqual({ code: '1302', message: 'rl' });
    expect(parseErrorBody('<html>502</html>')).toEqual({ code: null, message: null });
    expect(parseErrorBody('')).toEqual({ code: null, message: null });
  });
});

describe('classifyError — GLM', () => {
  it('maps auth, the 429 money-vs-rate split, content safety and server errors', () => {
    expect(classifyError('glm', 401, glmErr(1000, 'bad key'))).toEqual({ kind: 'auth', message: 'bad key' });
    expect(classifyError('glm', 403, glmErr(1220, 'no access'))).toMatchObject({ kind: 'auth' });
    expect(classifyError('glm', 429, glmErr(1113, '欠费'))).toEqual({ kind: 'balance', message: '欠费' });
    expect(classifyError('glm', 429, glmErr(1316, 'cap'))).toMatchObject({ kind: 'balance' });
    expect(classifyError('glm', 429, glmErr(1302, 'rl'))).toEqual({ kind: 'rate', message: 'rl' });
    expect(classifyError('glm', 429, 'not json')).toEqual({ kind: 'rate', message: 'not json' });
    expect(classifyError('glm', 400, glmErr(1301, 'sensitive'))).toEqual({
      kind: 'bad_request', message: '内容触发了 GLM 的安全策略',
    });
    expect(classifyError('glm', 400, glmErr(1214, 'bad param'))).toEqual({
      kind: 'bad_request', message: 'bad param',
    });
    expect(classifyError('glm', 500, glmErr(500, 'x'))).toEqual({ kind: 'server', message: 'HTTP 500' });
    expect(classifyError('glm', 503, '')).toEqual({ kind: 'server', message: 'HTTP 503' });
  });
});

describe('classifyError — DeepSeek (unchanged mapping)', () => {
  it('401 auth, 402 balance, 429 rate, 400 bad_request (raw body), else server', () => {
    expect(classifyError('deepseek', 401, 'b')).toEqual({ kind: 'auth', message: 'b' });
    expect(classifyError('deepseek', 402, 'b')).toEqual({ kind: 'balance', message: 'b' });
    expect(classifyError('deepseek', 429, 'b')).toEqual({ kind: 'rate', message: 'b' });
    expect(classifyError('deepseek', 400, 'x'.repeat(300)).message).toHaveLength(200);
    expect(classifyError('deepseek', 502, 'b')).toEqual({ kind: 'server', message: 'HTTP 502' });
  });
});

describe('userMessageFor', () => {
  const m = (kind: ApiError['kind'], provider?: Provider, message = 'm') =>
    userMessageFor(new ApiError(kind, message, provider));

  it('keeps the pre-v2.9 DeepSeek wording exactly', () => {
    expect(m('balance', 'deepseek')).toBe('DeepSeek 余额不足——请前往 platform.deepseek.com 充值。');
    expect(m('server', 'deepseek')).toBe('DeepSeek 服务器错误——请重试。');
    expect(m('auth', 'deepseek')).toBe('API Key 无效——请在设置中检查。');
    expect(m('rate', 'deepseek')).toBe('服务器繁忙（限流）——稍后重试。');
    expect(m('aborted', 'deepseek')).toBe('已停止。');
    expect(m('network', 'deepseek')).toBe('网络错误——请检查网络后重试。');
  });

  it('names GLM and its region binding, and stays generic with no provider', () => {
    expect(m('balance', 'glm')).toContain('GLM 余额不足');
    expect(m('balance', 'glm')).toContain('z.ai');
    expect(m('auth', 'glm')).toContain('区域');
    expect(m('server', 'glm')).toBe('GLM 服务器错误——请重试。');
    expect(m('bad_request', 'glm', '内容触发了 GLM 的安全策略')).toBe('请求被拒绝：内容触发了 GLM 的安全策略');
    expect(m('auth')).toBe('API Key 无效——请在设置中检查。'); // engine's "no key" path
  });
});

// Type-level: every catalog id must be a ModelId (tsc guards this; runtime restates it).
it('catalog ids are ModelIds', () => {
  const all: ModelId[] = PROVIDER_ORDER.flatMap((p) => PROVIDERS[p].models.map((x) => x.value));
  expect(all.length).toBe(6);
});
