import { fetch } from 'expo/fetch';

// Seedream v5 model ids (fal.ai). Lite ids are given by fal's own naming
// convention; the Pro slug was verified from its model page
// (https://fal.ai/models/bytedance/seedream/v5/pro/text-to-image/api,
// cross-checked via its queue endpoint_id) — Pro is published under the
// owner's own namespace with NO fal-ai/ prefix, unlike the Lite models.
export const FAL_PRO_T2I = 'bytedance/seedream/v5/pro/text-to-image';
export const FAL_LITE_T2I = 'fal-ai/bytedance/seedream/v5/lite/text-to-image';
export const FAL_LITE_EDIT = 'fal-ai/bytedance/seedream/v5/lite/edit';

export class FalError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function userMessageForFal(status: number): string {
  if (status === 401) return 'fal.ai Key 无效——请在设置中检查。';
  if (status === 403) return '内容被拦截——请调整描述后重试。';
  if (status === 422) return '参数有误——请重试或更换描述。';
  if (status === 429) return '请求太多，稍后再试。';
  if (status >= 500) return 'fal.ai 服务错误——请重试。';
  return '生成失败——请重试。';
}

export interface FalInputOpts {
  prompt: string;
  size: string;
  refDataUris?: string[];
}

export interface FalInput {
  prompt: string;
  image_size: string;
  num_images: number;
  enable_safety_checker: boolean;
  image_urls?: string[];
}

export function buildFalInput(opts: FalInputOpts): FalInput {
  return {
    prompt: opts.prompt,
    image_size: opts.size,
    num_images: 1,
    enable_safety_checker: true,
    ...(opts.refDataUris ? { image_urls: opts.refDataUris } : {}),
  };
}

export function parseFalImages(json: unknown): string[] {
  if (!json || typeof json !== 'object') return [];
  const images = (json as { images?: unknown }).images;
  if (!Array.isArray(images)) return [];
  return images
    .map((img) => (img && typeof img === 'object' ? (img as { url?: unknown }).url : undefined))
    .filter((u): u is string => typeof u === 'string');
}

// 生成 (v2.6): thin fetch wrapper mirroring llm.ts's streamChat — untested
// by design (I/O). Callers pass one of the model-id constants above plus an
// input built with buildFalInput.
export async function falGenerate(
  apiKey: string,
  model: string,
  input: FalInput,
): Promise<string[]> {
  const res = await fetch('https://fal.run/' + model, {
    method: 'POST',
    headers: {
      Authorization: 'Key ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new FalError(res.status, body || `HTTP ${res.status}`);
  }
  const json = await res.json();
  return parseFalImages(json);
}
