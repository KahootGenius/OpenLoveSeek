// 动态想象力 (v2.1.1) + 动态篇幅 (v2.9): one tiny pre-turn classifier picks
// her register for THIS reply — precision for factual/diary talk, imagination
// for play — and, since v2.9, its length tier (短/中/长), which rides into
// the prompt as a one-line 【这条回复的篇幅】 directive. The model only gets
// two words to say; every fallback lives in code (garbage → the user's manual
// 想象力 setting rides, and no length line is injected).

import { renderPrompt } from './prompts';
import type { Message } from './types';

export type TempChoice = '严谨' | '平衡' | '奔放';
export type LengthChoice = '短' | '中' | '长';

const CHOICES: readonly TempChoice[] = ['严谨', '平衡', '奔放'];
const LENGTHS: readonly LengthChoice[] = ['短', '中', '长'];

/** Prompt-registry key of the directive injected for each tier. */
export const LENGTH_PROMPT_KEY: Record<LengthChoice, string> = {
  短: 'length.short',
  中: 'length.medium',
  长: 'length.long',
};

type TempMessage = Pick<Message, 'role' | 'kind' | 'content'>;

export function currentUserBurst(messages: readonly TempMessage[]): string {
  const parts: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (parts.length === 0) {
      if (m.role === 'assistant') break;
      if (m.role !== 'user' || m.kind !== 'normal') continue;
    } else if (m.role !== 'user' || m.kind !== 'normal') {
      break;
    }
    parts.unshift(m.content);
  }
  return parts.join('\n');
}

/** Same values as the manual 想象力 chips in Settings. */
export const TEMP_BY_CHOICE: Record<TempChoice, number> = {
  严谨: 0.6,
  平衡: 1.0,
  奔放: 1.3,
};

const CLASSIFIER_TEXT_BUDGET = 500;
const OMISSION_MARKER = '\n…（中间省略）…\n';

const classifierExcerpt = (text: string): string => {
  if (text.length <= CLASSIFIER_TEXT_BUDGET) return text;
  const kept = CLASSIFIER_TEXT_BUDGET - OMISSION_MARKER.length;
  const headLength = Math.ceil(kept / 2);
  const tailLength = Math.floor(kept / 2);
  return text.slice(0, headLength) + OMISSION_MARKER + text.slice(-tailLength);
};

export function buildTempClassifierPrompt(userText: string): string {
  return renderPrompt('temp.classifier', { text: classifierExcerpt(userText) });
}

/** Tolerant read: exact word, else the LAST register named (models put their
 *  conclusion at the end when they chat around the instruction). */
export function parseTempChoice(raw: string): TempChoice | null {
  const t = raw.trim();
  for (const c of CHOICES) if (t === c) return c;
  let best: { c: TempChoice; i: number } | null = null;
  for (const c of CHOICES) {
    const i = raw.lastIndexOf(c);
    if (i >= 0 && (!best || i > best.i)) best = { c, i };
  }
  return best?.c ?? null;
}

// A chatty answer longer than this is not a two-word verdict; the single-
// character tiers (中/长) would false-match inside prose, so give up instead.
const LENGTH_FALLBACK_MAX = 20;

/** The 篇幅 half of the verdict: an exact token (split on |, whitespace or
 *  punctuation), else the last tier named in a SHORT answer. Null otherwise. */
export function parseLengthChoice(raw: string): LengthChoice | null {
  const tokens = raw.split(/[|｜\s，,、:：]+/).map((t) => t.trim());
  for (const t of tokens) for (const l of LENGTHS) if (t === l) return l;
  if (raw.trim().length > LENGTH_FALLBACK_MAX) return null;
  let best: { l: LengthChoice; i: number } | null = null;
  for (const l of LENGTHS) {
    const i = raw.lastIndexOf(l);
    if (i >= 0 && (!best || i > best.i)) best = { l, i };
  }
  return best?.l ?? null;
}
