export interface TextSeg {
  text: string;
  action?: boolean; // bracketed stage-direction, e.g. （轻轻笑了一下）
}

const BRACKET = /（[^（）]*）|\([^()]*\)/g;

export function splitBrackets(text: string): TextSeg[] {
  const segs: TextSeg[] = [];
  let last = 0;
  for (const m of text.matchAll(BRACKET)) {
    const i = m.index ?? 0;
    if (i > last) segs.push({ text: text.slice(last, i) });
    segs.push({ text: m[0], action: true });
    last = i + m[0].length;
  }
  if (last < text.length) segs.push({ text: text.slice(last) });
  return segs.length ? segs : [{ text }];
}
