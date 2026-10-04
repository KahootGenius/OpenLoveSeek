// 小动作 (v3.0 真实感): the little imperfections that read as a person —
// an occasional homophone slip followed by a *correction, recalling a bubble
// she regrets, quoting the user's earlier line. Deterministic (injectable
// rand), no model in the loop for the typo. Pure.

/** Common IME homophone slips (wrong → right). Chosen so the slip is a real
 *  everyday typo, not gibberish. */
export const TYPO_PAIRS: { right: string; wrong: string }[] = [
  { right: '在', wrong: '再' },
  { right: '再', wrong: '在' },
  { right: '那', wrong: '哪' },
  { right: '哪', wrong: '那' },
  { right: '做', wrong: '作' },
  { right: '已', wrong: '以' },
  { right: '像', wrong: '想' },
  { right: '的', wrong: '得' },
];

export const TYPO_RATE = 0.04; // per casual-register turn
const TYPO_MIN_LEN = 6;

/** Pure. Maybe plants ONE typo in one chunk and appends a "*正确字" bubble
 *  right after it. Never touches bracketed text (markers, stage directions). */
export function maybeTypo(
  chunks: string[],
  opts: { rand: () => number; casual: boolean; rate?: number },
): string[] {
  if (!opts.casual || chunks.length === 0) return chunks;
  if (opts.rand() >= (opts.rate ?? TYPO_RATE)) return chunks;
  const candidates: { i: number; pair: { right: string; wrong: string }; at: number }[] = [];
  chunks.forEach((c, i) => {
    if (c.length < TYPO_MIN_LEN || /[\[【（(]/.test(c)) return;
    for (const pair of TYPO_PAIRS) {
      const at = c.indexOf(pair.right);
      if (at >= 0) candidates.push({ i, pair, at });
    }
  });
  if (candidates.length === 0) return chunks;
  const pick = candidates[Math.min(candidates.length - 1, Math.floor(opts.rand() * candidates.length))];
  const c = chunks[pick.i];
  const slipped = c.slice(0, pick.at) + pick.pair.wrong + c.slice(pick.at + pick.pair.right.length);
  const out = [...chunks];
  out.splice(pick.i, 1, slipped, `*${pick.pair.right}`);
  return out;
}

// ---- 撤回 / 引用 markers (own line) ----------------------------------------------
const RECALL_LINE = /^[ \t]*[\[【]撤回[\]】][ \t]*$/m;
const QUOTE_LINE = /^[ \t]*(?:\[引用[:：][ \t]*([^\]\n]{1,80}?)[ \t]*\]|【引用[:：][ \t]*([^】\n]{1,80}?)[ \t]*】)[ \t]*$\n?/gm;

/** Pure. `[撤回]` on its own line: everything ABOVE it (from the start or the
 *  previous ---) becomes a bubble she recalls; the rest is the reply that
 *  stays. One recall per reply. */
export function extractRecall(text: string): { recalled: string | null; rest: string } {
  const m = RECALL_LINE.exec(text);
  if (!m || m.index == null) return { recalled: null, rest: text };
  const before = text.slice(0, m.index);
  const after = text.slice(m.index + m[0].length);
  const cut = before.lastIndexOf('---');
  const recalled = (cut >= 0 ? before.slice(cut + 3) : before).trim();
  const kept = (cut >= 0 ? before.slice(0, cut) : '').trim();
  const rest = [kept, after.trim()].filter(Boolean).join('\n---\n').replace(/\n{3,}/g, '\n\n').trim();
  return { recalled: recalled || null, rest };
}

/** Pure. `[引用:片段]` on its own line: the fragment to quote (last one wins). */
export function extractQuote(text: string): { clean: string; fragment: string | null } {
  let fragment: string | null = null;
  const clean = text
    .replace(QUOTE_LINE, (_, a: string | undefined, b: string | undefined) => {
      const v = (a ?? b ?? '').trim();
      if (v) fragment = v;
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { clean, fragment };
}

/** Pure. The newest user message containing the fragment (exact substring,
 *  then a loose prefix match on the first 6 chars). Null when nothing fits. */
export function resolveQuoteTarget(
  fragment: string,
  userRows: { id: string; content: string }[],
): string | null {
  const f = fragment.replace(/\s+/g, '');
  if (!f) return null;
  for (let i = userRows.length - 1; i >= 0; i--) {
    if (userRows[i].content.replace(/\s+/g, '').includes(f)) return userRows[i].id;
  }
  const head = f.slice(0, 6);
  if (head.length < 4) return null;
  for (let i = userRows.length - 1; i >= 0; i--) {
    if (userRows[i].content.replace(/\s+/g, '').includes(head)) return userRows[i].id;
  }
  return null;
}

export const recallTombstone = (personaName: string): string => `${personaName}撤回了一条消息`;
