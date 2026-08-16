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
