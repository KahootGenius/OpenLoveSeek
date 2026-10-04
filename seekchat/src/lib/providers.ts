// 模型服务商 (v2.9): the catalog plus every pure rule that differs between
// DeepSeek and GLM (智谱 — Z.ai 国际 / open.bigmodel.cn 国内). Kept db-free
// so jest covers each branch; llm.ts applies these rules around fetch and
// settings.ts is the pref glue.
import { DEFAULT_MODEL } from './constants';
import type { ApiMessage, ModelId, Provider } from './types';

export const PROVIDER_ORDER: Provider[] = ['deepseek', 'glm'];

export const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

// A GLM key is bound to the platform that issued it — exactly MiniMax's
// situation (minimax.ts MINIMAX_HOSTS): a Z.ai key is rejected by
// open.bigmodel.cn and vice versa. Both hosts serve the same model ids.
// Verified 2026-09-13 against docs.z.ai and docs.bigmodel.cn.
export const GLM_HOSTS = {
  global: 'https://api.z.ai/api/paas/v4/chat/completions',
  cn: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
} as const;
export type GlmRegion = keyof typeof GLM_HOSTS;

export interface ModelOption {
  value: ModelId;
  label: string;
}

export interface ProviderSpec {
  label: string;
  /** Picker order; the first entry is the cheap default. */
  models: ModelOption[];
  defaultModel: ModelId;
  /** Summarizer / cutter / repair / classifier calls — the cheapest fast model. */
  utilityModel: ModelId;
  keyPlaceholder: string;
  /** Tail of the 余额不足 message: where to top up. */
  topUpHint: string;
  /** Hard API ceiling on `temperature`; undefined = passed through untouched. */
  temperatureCap?: number;
}

export const PROVIDERS: Record<Provider, ProviderSpec> = {
  deepseek: {
    label: 'DeepSeek',
    // V4.1 Flash (2026-09-10) is `deepseek-flash`; V4 Pro stays served after
    // 2026-09-14 (DeepSeek reversed the retirement). Prices: flash $0.15/$0.6
    // off-peak, $0.3/$1.2 peak; v4-pro $0.66/$1.98 off-peak, $1.32/$3.96 peak.
    models: [
      { value: 'deepseek-flash', label: 'flash（V4.1，快，便宜）' },
      { value: 'deepseek-v4-pro', label: 'v4-pro（更强）' },
    ],
    defaultModel: DEFAULT_MODEL,
    utilityModel: DEFAULT_MODEL,
    keyPlaceholder: 'sk-…',
    topUpHint: '请前往 platform.deepseek.com 充值',
  },
  glm: {
    // Prices (2026-09-13, per 1M tokens in/out): 5.3-flash ¥0.8/¥2.8 ($0.15/$0.5),
    // 4.7 ¥2–4/¥8–16 ($0.6/$2.2), 5.3 ¥8/¥28 ($1.4/$4.4), 4.7-flashx ¥0.5/¥3
    // ($0.07/$0.4), 4.7-flash free but concurrency-limited — fine for a slow
    // DM, brittle under the utility bursts.
    label: 'GLM',
    models: [
      { value: 'glm-5.3-flash', label: '5.3-flash（快，便宜）' },
      { value: 'glm-4.7', label: '4.7（均衡）' },
      { value: 'glm-5.3', label: '5.3（旗舰）' },
      { value: 'glm-4.7-flash', label: '4.7-flash（免费，限速）' },
    ],
    defaultModel: 'glm-5.3-flash',
    // Utility calls (cutter/repair/perception/summary) want NO reasoning at
    // all; the 5.3 family cannot switch thinking off (field report,
    // 2026-09-14: "this model always uses think mode"), so the utility model
    // is the cheapest 4.7 that can. Not in the picker — a tool, not a voice.
    utilityModel: 'glm-4.7-flashx',
    keyPlaceholder: 'GLM API Key',
    topUpHint: '请前往 z.ai（国内为 open.bigmodel.cn）充值',
    temperatureCap: 1.0,
  },
};

/** Total on the ModelId union: every id belongs to exactly one provider. */
export const providerOf = (model: ModelId): Provider =>
  model.startsWith('glm-') ? 'glm' : 'deepseek';

// GLM thinking policy (verified 2026-09-14, docs.z.ai + docs.bigmodel.cn):
// GLM-5.3 / GLM-5.3-Flash can ONLY run with thinking enabled — sending
// `thinking.type: "disabled"` is rejected outright — and depth is set by a
// top-level `reasoning_effort` (they accept low / high / max; the default is
// max, the most expensive). Every other GLM model takes enabled/disabled and
// decides on its own how much to think.
export type GlmThinkingPolicy = 'switchable' | 'always';
const GLM_ALWAYS_THINK = new Set<string>(['glm-5.3', 'glm-5.3-flash']);
export const glmThinkingPolicy = (model: ModelId): GlmThinkingPolicy =>
  GLM_ALWAYS_THINK.has(model) ? 'always' : 'switchable';
/** 思考 on → a real reasoning budget; off (and every utility call) → the floor. */
export const GLM_EFFORT_ON = 'high';
export const GLM_EFFORT_OFF = 'low';

export function isModelOf(provider: Provider, value: string | null | undefined): value is ModelId {
  return !!value && PROVIDERS[provider].models.some((m) => m.value === value);
}

/** A stored pref is trusted only when it names one of `provider`'s CURRENT
 *  models — unset, retired (deepseek-chat/-reasoner, deepseek-v4-flash) and
 *  foreign-provider ids all fall back to the provider default. */
export const coerceModel = (provider: Provider, stored: string | null | undefined): ModelId =>
  isModelOf(provider, stored) ? stored : PROVIDERS[provider].defaultModel;

export const endpointFor = (provider: Provider, region: GlmRegion): string =>
  provider === 'glm' ? GLM_HOSTS[region] : DEEPSEEK_API_URL;

/** GLM accepts two decimals in [0, 1]; DeepSeek has no cap (passthrough). */
export const clampTemperature = (t: number, cap: number | undefined): number =>
  cap == null ? t : Math.round(Math.min(cap, Math.max(0, t)) * 100) / 100;

export interface ChatBodyOpts {
  model: ModelId;
  messages: ApiMessage[];
  thinking?: boolean;
  temperature?: number;
}

export function buildChatBody(opts: ChatBodyOpts): Record<string, unknown> {
  const base = { model: opts.model, messages: opts.messages, stream: true };
  if (providerOf(opts.model) === 'glm') {
    // GLM-4.5+ defaults thinking ON, so it is named on EVERY call — otherwise
    // each summarizer/cutter/repair round trip would pay for a hidden
    // reasoning chain. The 5.3 family cannot be switched off: keep it enabled
    // and steer depth with reasoning_effort instead. 奔放 (1.3) and dynamic
    // picks above 1.0 clamp to 1.0.
    const thinking =
      glmThinkingPolicy(opts.model) === 'always'
        ? { thinking: { type: 'enabled' }, reasoning_effort: opts.thinking ? GLM_EFFORT_ON : GLM_EFFORT_OFF }
        : { thinking: { type: opts.thinking ? 'enabled' : 'disabled' } };
    return {
      ...base,
      ...thinking,
      ...(opts.temperature != null
        ? { temperature: clampTemperature(opts.temperature, PROVIDERS.glm.temperatureCap) }
        : {}),
    };
  }
  // DeepSeek: thinking is ON by default at `high` effort (thinking-mode guide,
  // verified 2026-09-14), so it is named on EVERY call exactly like GLM's
  // switchable models — omitting the field used to leave every utility call
  // reasoning silently. No temperature cap.
  return {
    ...base,
    thinking: { type: opts.thinking ? 'enabled' : 'disabled' },
    ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
  };
}

export type ApiErrorKind =
  | 'auth'
  | 'balance'
  | 'rate'
  | 'bad_request'
  | 'server'
  | 'network'
  | 'aborted';

/** `{error:{code,message}}` (both providers) or a bare `{code,message}` —
 *  Z.ai's docs show both shapes. Anything else yields nulls. */
export function parseErrorBody(body: string): { code: string | null; message: string | null } {
  try {
    const j: unknown = JSON.parse(body);
    const outer = j as { error?: unknown; code?: unknown; message?: unknown } | null;
    const e = (outer?.error && typeof outer.error === 'object' ? outer.error : outer) as
      | { code?: unknown; message?: unknown }
      | null;
    return {
      code: e?.code != null ? String(e.code) : null,
      message: typeof e?.message === 'string' ? e.message : null,
    };
  } catch {
    return { code: null, message: null };
  }
}

// GLM signals money problems as HTTP 429 with a body code (1113 欠费;
// 1316/1317 usage-window cap + insufficient balance) — the same status as a
// plain rate limit, so the body decides. 1301 (HTTP 400) is content safety.
const GLM_BALANCE_CODES = new Set(['1113', '1316', '1317']);
const GLM_CONTENT_CODE = '1301';

export function classifyError(
  provider: Provider,
  status: number,
  body: string,
): { kind: ApiErrorKind; message: string } {
  if (provider === 'glm') {
    const { code, message } = parseErrorBody(body);
    const text = message ?? body;
    if (status === 401 || status === 403) return { kind: 'auth', message: text };
    if (status === 429) {
      const kind = GLM_BALANCE_CODES.has(code ?? '') ? 'balance' : 'rate';
      return { kind, message: text };
    }
    if (status === 400) {
      return {
        kind: 'bad_request',
        message: code === GLM_CONTENT_CODE ? '内容触发了 GLM 的安全策略' : text.slice(0, 200),
      };
    }
    return { kind: 'server', message: `HTTP ${status}` };
  }
  // DeepSeek: unchanged from the pre-v2.9 client.
  if (status === 401) return { kind: 'auth', message: body };
  if (status === 402) return { kind: 'balance', message: body };
  if (status === 429) return { kind: 'rate', message: body };
  if (status === 400) return { kind: 'bad_request', message: body.slice(0, 200) };
  return { kind: 'server', message: `HTTP ${status}` };
}
