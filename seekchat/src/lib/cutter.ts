// 消息切割 (v2.3, user-requested): one long reply → several real messages,
// like actual texting. The cut is EXTERNAL (a tiny separate call) so the main
// prompt carries no extra duties — the user's own design instinct, and the
// house pattern (director / classifier / repairer are all external calls).
//
// ZERO-TRUST: the cutter may ONLY insert `---` separators. parseCut verifies
// the segments re-concatenate to the ORIGINAL text character-for-character
// (whitespace at cut points aside). A misbehaving cutter can cut nothing;
// it can never rewrite her words.
import { renderPrompt } from './prompts';

export const CUT_MIN_LEN = 60; // Chinese is dense — 60+ chars is already a wall of text
export const CUT_MAX_SEGMENTS = 6;
export const CUT_MIN_SEGMENT = 4; // confetti guard

/** Long, and she didn't segment it herself. */
export function needsCut(body: string): boolean {
  const t = body.trim();
  return t.length >= CUT_MIN_LEN && !t.includes('---');
}

export function buildCutPrompt(body: string): string {
  return renderPrompt('cutter.split', { text: body });
}

const stripWs = (s: string): string => s.replace(/\s+/g, '');

/** Returns trimmed segments, or null when the cut is untrustworthy. */
export function parseCut(original: string, cut: string): string[] | null {
  const segments = cut
    .split(/\s*---\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length < 2 || segments.length > CUT_MAX_SEGMENTS) return null;
  if (segments.some((s) => s.length < CUT_MIN_SEGMENT)) return null;
  if (stripWs(segments.join('')) !== stripWs(original)) return null;
  return segments;
}
