import type { Message } from './types';

// 复读检测 (v2.3, field report): long-lived chats teach the model its own
// verbal tics — she sees her past replies every turn and the pattern
// self-reinforces (「你这段话，如果我是在…恐怕已经…」). Deterministic detector:
// when 3+ of her recent replies open with the same phrase, a one-line nudge
// rides the next prompt. Self-clearing — once she varies, the nudge stops.

export const TIC_WINDOW = 8; // her most recent replies considered
export const TIC_MIN_REPEATS = 3;
const PREFIX_LEN = 4; // 4 Chinese chars is a solid signature (你这段话…)

/** Pure. Returns the repeated opening phrase, or null when she's varied. */
export function detectTic(recentAssistantBodies: string[]): string | null {
  const openings = recentAssistantBodies
    .slice(-TIC_WINDOW)
    .map((s) => s.trim())
    .filter((s) => s.length >= PREFIX_LEN + 2) // one-word replies aren't tics
    .map((s) => s.slice(0, PREFIX_LEN));
  const counts = new Map<string, number>();
  for (const o of openings) counts.set(o, (counts.get(o) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [o, n] of counts) {
    if (n > bestN) {
      best = o;
      bestN = n;
    }
  }
  return bestN >= TIC_MIN_REPEATS ? best : null;
}

// 变化检测 (v2.4): the same self-reinforcement that breeds verbal tics also
// breeds structural ones — she copies her own last reply's SHAPE, and long
// replies teach longer replies. Same cure: deterministic, self-clearing nudge.

export const RUT_MIN_RUN = 4; // consecutive recent replies sharing one mold
const LEN_MID = 40;
const LEN_LONG = 120;
// Plain short/medium single bubbles are how real people text — never nag those.
const HARMLESS_SIGNATURES = new Set(['1段·短', '1段·中']);

const lenBucket = (n: number): string => (n >= LEN_LONG ? '长' : n >= LEN_MID ? '中' : '短');
const fragBucket = (n: number): string => (n >= 3 ? '3段+' : `${n}段`);

/** Pure. One reply's structural fingerprint, e.g. '2段·长'. */
export function replySignature(body: string): string {
  const trimmed = body.trim();
  const frags = trimmed.split('---').map((p) => p.trim()).filter(Boolean).length || 1;
  return `${fragBucket(frags)}·${lenBucket(trimmed.length)}`;
}

/** Pure. The shared non-trivial signature of her last RUT_MIN_RUN replies, or null. */
export function detectStructureRut(recent: string[]): string | null {
  const tail = recent.slice(-RUT_MIN_RUN).map((s) => s.trim()).filter(Boolean);
  if (tail.length < RUT_MIN_RUN) return null;
  const sigs = tail.map(replySignature);
  if (!sigs.every((sg) => sg === sigs[0])) return null;
  return HARMLESS_SIGNATURES.has(sigs[0]) ? null : sigs[0];
}

/** Pure. True when her last RUT_MIN_RUN replies are all 长 (structure may vary). */
export function detectLengthRut(recent: string[]): boolean {
  const tail = recent.slice(-RUT_MIN_RUN).map((s) => s.trim()).filter(Boolean);
  return tail.length >= RUT_MIN_RUN && tail.every((s) => s.length >= LEN_LONG);
}

export type VarietyNudge = { kind: 'structure'; pattern: string } | { kind: 'length' };

/** Pure. Structure rut outranks length rut; null when she's varied. */
export function pickVarietyNudge(recent: string[]): VarietyNudge | null {
  const pattern = detectStructureRut(recent);
  if (pattern) return { kind: 'structure', pattern };
  return detectLengthRut(recent) ? { kind: 'length' } : null;
}

type TurnRow = Pick<Message, 'role' | 'kind' | 'content'>;

/** Pure. Rebuild the replies she actually authored: the v2.3 cutter stores one
 *  long reply as several rows (只插入---，绝不改字), so consecutive normal
 *  assistant rows rejoin with '---'. Any user row closes the turn; assistant
 *  stickers/meta riding inside a burst don't split it. */
export function recentAssistantTurnBodies(all: TurnRow[]): string[] {
  const turns: string[] = [];
  let current: string[] = [];
  const close = () => {
    if (current.length) {
      turns.push(current.join('---'));
      current = [];
    }
  };
  for (const m of all) {
    if (m.role === 'user') close();
    else if (m.kind === 'normal') current.push(m.content);
  }
  close();
  return turns;
}
