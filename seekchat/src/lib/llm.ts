import { fetch } from 'expo/fetch';
import { createSSEParser } from './sse';
import {
  buildChatBody, classifyError, endpointFor, PROVIDERS, providerOf,
} from './providers';
import type { ApiErrorKind, GlmRegion } from './providers';
import type { ApiMessage, ModelId, Provider } from './types';

export type { ApiErrorKind } from './providers';

// One streaming client for both providers (v2.9 — was deepseek.ts). The
// provider is a total function of the model id, so call sites keep passing
// `getApiKey()` + a model and never name a provider; providers.ts owns every
// rule that differs (endpoint, thinking default, temperature cap, error codes).

export class ApiError extends Error {
  constructor(
    public kind: ApiErrorKind,
    message: string,
    public provider?: Provider, // absent only for errors raised before a call (e.g. no key)
  ) {
    super(message);
  }
}

export function userMessageFor(e: ApiError): string {
  const spec = e.provider ? PROVIDERS[e.provider] : null;
  const who = spec?.label ?? 'API';
  switch (e.kind) {
    case 'auth':
      return e.provider === 'glm'
        ? 'GLM API Key 无效或区域不匹配——请在设置中检查 Key 与区域。'
        : 'API Key 无效——请在设置中检查。';
    case 'balance':
      return `${who} 余额不足——${spec?.topUpHint ?? '请充值'}。`;
    case 'rate':
      return '服务器繁忙（限流）——稍后重试。';
    case 'bad_request':
      return `请求被拒绝：${e.message}`;
    case 'server':
      return `${who} 服务器错误——请重试。`;
    case 'aborted':
      return '已停止。';
    default:
      return '网络错误——请检查网络后重试。';
  }
}

export interface StreamChatOptions {
  apiKey: string;
  model: ModelId;
  messages: ApiMessage[];
  signal: AbortSignal;
  onDelta: (text: string) => void;
  onReasoning?: (text: string) => void; // thinking-mode chain deltas
  thinking?: boolean; // DeepSeek v4 / GLM thinking mode
  temperature?: number; // 想象力 — lower = more grounded, higher = more inventive
}

// API 用量计数 (v2.3): injected like bindPromptStore so this module stays
// db-free (jest imports it via pure suites). db.ts binds the pref counter;
// since v2.9 it receives the provider so the daily count splits per provider.
let onApiCall: (provider: Provider) => void = () => {};
export const bindApiCounter = (fn: (provider: Provider) => void): void =>
  void (onApiCall = fn);

// GLM 区域 (v2.9): injected the same way — settings.ts binds getGlmRegion at
// load. 'global' until bound, matching the pref default.
let glmRegion: () => GlmRegion = () => 'global';
export const bindLlmRegion = (fn: () => GlmRegion): void => void (glmRegion = fn);

export async function streamChat(opts: StreamChatOptions): Promise<string> {
  const provider = providerOf(opts.model);
  onApiCall(provider);
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(endpointFor(provider, glmRegion()), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(
        buildChatBody({
          model: opts.model,
          messages: opts.messages,
          thinking: opts.thinking,
          temperature: opts.temperature,
        }),
      ),
      signal: opts.signal,
    });
  } catch (e: unknown) {
    if (opts.signal.aborted) throw new ApiError('aborted', 'aborted', provider);
    throw new ApiError('network', String(e), provider);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const { kind, message } = classifyError(provider, res.status, body);
    throw new ApiError(kind, message, provider);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder('utf-8');
  const parser = createSSEParser();
  let full = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
        if (ev.type === 'delta') {
          full += ev.text;
          opts.onDelta(ev.text);
        } else if (ev.type === 'reasoning') {
          opts.onReasoning?.(ev.text);
        } else {
          return full;
        }
      }
    }
  } catch (e: unknown) {
    if (opts.signal.aborted) throw new ApiError('aborted', 'aborted', provider);
    throw new ApiError('network', String(e), provider);
  }
  return full;
}

export async function chatOnce(
  apiKey: string,
  model: ModelId,
  messages: ApiMessage[],
  temperature?: number,
): Promise<string> {
  return streamChat({
    apiKey,
    model,
    messages,
    temperature,
    signal: new AbortController().signal,
    onDelta: () => {},
  });
}
