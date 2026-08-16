// v2.0 unified marker grammar: every hidden-channel ACTION is an own-line
// [名字:值] marker (half/full-width brackets and colons interchangeable).
// The 【状态|…】 envelope is NOT an action marker and keeps its parser
// (statetag.ts). Own-line ONLY, on purpose: an inline occurrence is usually
// her TALKING ABOUT the action, and a false fire is as bad as a miss.

export interface MarkerHit {
  clean: string;
  values: string[];
}

export function makeOwnLineMarker(name: string, maxLen = 120) {
  // Openers pair with their OWN closer (same as memory.ts/stickers.ts) so
  // full-width quoting like 【小脑袋】 can live inside a half-width marker's
  // value — observed model behavior, not hypothetical.
  const re = new RegExp(
    `^[ \\t]*(?:\\[${name}[:：][ \\t]*([^\\]\\n]{1,${maxLen}}?)[ \\t]*\\]` +
      `|【${name}[:：][ \\t]*([^】\\n]{1,${maxLen}}?)[ \\t]*】)[ \\t]*$\\n?`,
    'gm',
  );
  return {
    extract(text: string): MarkerHit {
      const values: string[] = [];
      const clean = text
        .replace(re, (_, a: string | undefined, b: string | undefined) => {
          values.push((a ?? b ?? '').trim());
          return '';
        })
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return { clean, values };
    },
  };
}

const PAT = makeOwnLineMarker('拍一拍');

/** Pure. Pulls own-line `[拍一拍:动作短句]` markers; last one wins. */
export function extractPatMarker(text: string): { clean: string; pat: string | null } {
  const { clean, values } = PAT.extract(text);
  return { clean, pat: values.length ? values[values.length - 1] : null };
}
