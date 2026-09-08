import { fetch } from 'expo/fetch';

// MiniMax t2a_v2 (v2.7): region-bound hosts — Key and voice_id are each tied
// to whichever region they were issued on (verified against MiniMax's docs,
// see spec). Global is the default; 国内 (cn) is opt-in for CN-region users.
export const MINIMAX_HOSTS = {
  global: 'https://api.minimax.io',
  cn: 'https://api.minimaxi.chat',
} as const;

export const MINIMAX_MODEL = 'speech-2.8-turbo';

export class MiniMaxError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function userMessageForMiniMax(code: number): string {
  if (code === 1004) return 'MiniMax Key 无效或区域不匹配——请在设置中检查 Key 与区域。';
  if (code === 1002 || code === 1039) return '请求太多，请稍后再试。';
  if (code === 1042) return '文本包含过多无效字符——请检查内容。';
  if (code === 2013) return '参数有误——请重试或更换设置。';
  return 'MiniMax 服务错误——请重试。';
}

export interface T2AInputOpts {
  text: string;
  voiceId: string;
  speed: number;
  emotion?: string;
}

export interface T2AInput {
  model: string;
  text: string;
  output_format: 'url';
  voice_setting: {
    voice_id: string;
    speed: number;
    vol: number;
    pitch: number;
    emotion?: string;
  };
  audio_setting: {
    format: 'mp3';
    sample_rate: number;
    bitrate: number;
  };
}

export function buildT2AInput(opts: T2AInputOpts): T2AInput {
  return {
    model: MINIMAX_MODEL,
    text: opts.text,
    output_format: 'url',
    voice_setting: {
      voice_id: opts.voiceId,
      speed: opts.speed,
      vol: 1.0,
      pitch: 0,
      ...(opts.emotion ? { emotion: opts.emotion } : {}),
    },
    audio_setting: { format: 'mp3', sample_rate: 32000, bitrate: 128000 },
  };
}

export interface T2AResult {
  url: string;
  usageCharacters?: number;
}

// url mode only (output_format: 'url') — data.audio is a 24h-expiring URL,
// never a hex payload; extra_info.usage_characters feeds the daily cap.
export function parseT2AResponse(json: unknown): T2AResult {
  const obj = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const baseResp = obj.base_resp as { status_code?: unknown; status_msg?: unknown } | undefined;
  const statusCode = typeof baseResp?.status_code === 'number' ? baseResp.status_code : -1;
  if (statusCode !== 0) {
    const msg = typeof baseResp?.status_msg === 'string' ? baseResp.status_msg : `status ${statusCode}`;
    throw new MiniMaxError(statusCode, msg);
  }
  const data = obj.data as { audio?: unknown } | undefined;
  const url = data?.audio;
  if (typeof url !== 'string' || !url) {
    throw new MiniMaxError(statusCode, 'MiniMax 返回数据缺少音频地址');
  }
  const extra = obj.extra_info as { usage_characters?: unknown } | undefined;
  const usageCharacters = typeof extra?.usage_characters === 'number' ? extra.usage_characters : undefined;
  return { url, usageCharacters };
}

// 生成 (v2.7): thin fetch wrapper mirroring fal.ts's falGenerate — untested by
// design (I/O). host is one of MINIMAX_HOSTS[region]; no GroupId needed, just
// a Bearer key.
export async function ttsGenerate(
  apiKey: string,
  host: string,
  input: T2AInput,
): Promise<T2AResult> {
  const res = await fetch(`${host}/v1/t2a_v2`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new MiniMaxError(res.status, body || `HTTP ${res.status}`);
  }
  const json = await res.json();
  return parseT2AResponse(json);
}
