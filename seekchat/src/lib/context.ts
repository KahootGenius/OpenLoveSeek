import type { ApiMessage, Message } from './types';
import { HISTORY_BUDGET, SUMMARIZE_THRESHOLD } from './constants';

const CJK = /[⺀-鿿豈-﫿＀-￯]/;

export function estimateTokens(text: string): number {
  let latin = 0;
  let cjk = 0;
  for (const ch of text) {
    if (CJK.test(ch)) cjk++;
    else latin++;
  }
  return Math.ceil(0.35 * latin + 0.7 * cjk);
}

// 上下文长度 (v2.8): user-facing tiers for the per-turn history budget —
// 短/长 are derived from HISTORY_BUDGET so they track it if it ever moves;
// 中 IS HISTORY_BUDGET, not a duplicate, so there's one source of truth.
export const WINDOW_TIERS = {
  短: Math.round(HISTORY_BUDGET / 2),
  中: HISTORY_BUDGET,
  长: HISTORY_BUDGET * 2,
} as const;

export function selectWindow(
  messages: Message[],
  budget: number = HISTORY_BUDGET,
): Message[] {
  const out: Message[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = estimateTokens(messages[i].content);
    if (out.length > 0 && used + cost > budget) break;
    out.unshift(messages[i]);
    used += cost;
  }
  return out;
}

export function buildRequestMessages(
  instructionPrompt: string,
  evidencePrompt: string | null,
  window: Message[],
  evidencePrefix: string,
): ApiMessage[] {
  const msgs: ApiMessage[] = [{ role: 'system', content: instructionPrompt }];
  if (evidencePrompt) {
    msgs.push({ role: 'system', content: evidencePrefix + evidencePrompt });
  }
  for (const m of window) {
    const prev = msgs[msgs.length - 1];
    // Fragment bursts (合并回复) produce consecutive same-role messages; the API
    // wants alternating roles, and joining also presents the burst as one thought.
    // (Window roles are only user/assistant, so system heads never merge.)
    if (prev && prev.role === m.role) prev.content += '\n' + m.content;
    else msgs.push({ role: m.role, content: m.content });
  }
  return msgs;
}

export function countUnsummarized(
  all: Message[],
  window: Message[],
  summaryUpToId: string | null,
): number {
  const oldestInWindow = window.length
    ? all.findIndex((m) => m.id === window[0].id)
    : all.length;
  let coveredUpTo = 0;
  if (summaryUpToId) {
    const i = all.findIndex((m) => m.id === summaryUpToId);
    if (i >= 0) coveredUpTo = i + 1;
  }
  return Math.max(0, oldestInWindow - coveredUpTo);
}

export function shouldSummarize(
  all: Message[],
  window: Message[],
  summaryUpToId: string | null,
  threshold: number = SUMMARIZE_THRESHOLD,
): boolean {
  return countUnsummarized(all, window, summaryUpToId) > threshold;
}
