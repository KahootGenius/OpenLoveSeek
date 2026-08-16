// 动态想象力 (v2.1.1): a tiny pre-turn classifier picks her register for THIS
// reply — precision for factual/diary talk, imagination for play. The model
// only gets one word to say; every fallback lives in code (garbage → the
// user's manual 想象力 setting rides).

import { renderPrompt } from './prompts';
import type { Message } from './types';

export type TempChoice = '严谨' | '平衡' | '奔放';

const CHOICES: readonly TempChoice[] = ['严谨', '平衡', '奔放'];

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
