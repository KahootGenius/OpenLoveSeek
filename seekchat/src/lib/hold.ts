/**
 * 合并回复 (merge replies): people text in fragments — "我 --- 你知道的 --- 就是
 * 经常无聊" — so the engine holds the reply until the burst settles instead of
 * answering the first fragment. Pure timing math lives here; the timers are in
 * engine.ts.
 */

/** After the last keystroke (with a non-empty input box), wait this long for silence. */
export const TYPING_GRACE_MS = 6000;

/**
 * How long to wait before firing the turn, measured from now.
 * - baseMs: settle time after the most recent send (the hold restarts per send).
 * - lastTypingAt: last keystroke ms while the input box was non-empty; 0 = box empty.
 */
export function holdDelay(args: { baseMs: number; lastTypingAt: number; now: number }): number {
  const typingWait =
    args.lastTypingAt > 0 ? args.lastTypingAt + TYPING_GRACE_MS - args.now : 0;
  return Math.max(args.baseMs, typingWait, 0);
}
