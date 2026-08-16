import { fetch } from 'expo/fetch';
import { createSSEParser } from './sse';
import { API_URL } from './constants';
import type { ApiMessage } from './types';

export type ApiErrorKind =
  | 'auth'
  | 'balance'
  | 'rate'
  | 'bad_request'
  | 'server'
  | 'network'
  | 'aborted';

export class ApiError extends Error {
  constructor(
    public kind: ApiErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export function userMessageFor(e: ApiError): string {
  switch (e.kind) {
    case 'auth':
      return 'API Key 无效——请在设置中检查。';
    case 'balance':
      return 'DeepSeek 余额不足——请前往 platform.deepseek.com 充值。';
    case 'rate':
      return '服务器繁忙（限流）——稍后重试。';
    case 'bad_request':
      return `请求被拒绝：${e.message}`;
    case 'server':
      return 'DeepSeek 服务器错误——请重试。';
    case 'aborted':
      return '已停止。';
    default:
      return '网络错误——请检查网络后重试。';
  }
}

export interface StreamChatOptions {
  apiKey: string;
  model: string;
  messages: ApiMessage[];
  signal: AbortSignal;
  onDelta: (text: string) => void;
  onReasoning?: (text: string) => void; // thinking-mode chain deltas
  thinking?: boolean; // DeepSeek v4 thinking mode
  temperature?: number; // 想象力 — lower = more grounded, higher = more inventive
}

// API 用量计数 (v2.3): injected like bindPromptStore so this module stays
// db-free (jest imports it via pure suites). db.ts binds the pref counter.
let onApiCall: () => void = () => {};
export const bindApiCounter = (fn: () => void): void => void (onApiCall = fn);

export async function streamChat(opts: StreamChatOptions): Promise<string> {
  onApiCall();
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        stream: true,
        ...(opts.thinking ? { thinking: { type: 'enabled' } } : {}),
        ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      }),
      signal: opts.signal,
    });
  } catch (e: unknown) {
    if (opts.signal.aborted) throw new ApiError('aborted', 'aborted');
    throw new ApiError('network', String(e));
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401) throw new ApiError('auth', body);
    if (res.status === 402) throw new ApiError('balance', body);
    if (res.status === 429) throw new ApiError('rate', body);
    if (res.status === 400) throw new ApiError('bad_request', body.slice(0, 200));
    throw new ApiError('server', `HTTP ${res.status}`);
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
    if (opts.signal.aborted) throw new ApiError('aborted', 'aborted');
    throw new ApiError('network', String(e));
  }
  return full;
}

export async function chatOnce(
  apiKey: string,
  model: string,
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
