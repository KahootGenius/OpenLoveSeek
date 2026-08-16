const STRIP = /[\s，。！？、~…"'"'"'!?.,]/g;

/** Does the user's typed input satisfy the demanded phrase? Punctuation/space-insensitive. */
export function demandSatisfied(input: string, phrase: string): boolean {
  const norm = (s: string) => s.replace(STRIP, '');
  const p = norm(phrase);
  return p.length > 0 && norm(input).includes(p);
}
