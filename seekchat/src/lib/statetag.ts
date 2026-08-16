export interface StateTag {
  mood: string;
  intensity: number;
  thought: string;
}

// Envelope FIRST, fields second: the entire 【状态|…】 tag is a hidden channel,
// so it must be stripped from display even when its fields are malformed or
// carry smuggled ops (models love folding |主人:调教:+3 into the tag instead
// of writing a separate marker line — the field-strict regex used to fail on
// that and leak the whole tag as a visible bubble). The envelope is located
// by its LAST opener and the FINAL 】, so nested 【好】 inside 心想 parses fine.
const OPENER = '【状态|';

// v2.2.1 (field report): models sometimes write the envelope with half-width
// brackets/pipes — [状态|心情:…] — and the strict opener then misses it, so the
// tag leaks into the visible bubble and the mood never updates. Unlike action
// markers there is NO mention-doctrine ambiguity here: an envelope carrying
// 心情/强度/心想 fields is unmistakable intent. Normalize the variants to the
// canonical form DETERMINISTICALLY before parsing — no model in the loop.
const ALT_OPENER_RE = /[\[［]状态[|｜]|【状态｜/g;

export function normalizeStateEnvelope(full: string): string {
  let last = -1;
  let lastLen = 0;
  ALT_OPENER_RE.lastIndex = 0;
  for (let m = ALT_OPENER_RE.exec(full); m; m = ALT_OPENER_RE.exec(full)) {
    last = m.index;
    lastLen = m[0].length;
  }
  if (last < 0) return full;
  // Canonical envelope already closes the text after this point? Leave it.
  const canon = full.lastIndexOf(OPENER);
  if (canon > last) return full;
  const tail = full.slice(last);
  const closer = /[\]】］]\s*$/.exec(tail);
  if (!closer) return full; // unclosed — the streaming hider handles display
  const inner = tail.slice(lastLen, closer.index);
  // Intent check: a real envelope names at least one of its fields.
  if (!/心情|强度|心想|成长/.test(inner)) return full;
  return (
    full.slice(0, last) + OPENER + inner.replace(/｜/g, '|') + '】' +
    tail.slice(closer.index + 1)
  );
}

export function extractStateTag(full: string): {
  clean: string;
  tag: StateTag | null;
  growth: number | null;
  pat: string | null;
  /** Unknown key:value fields found inside the tag (e.g. "主人:调教:+3") — the
   *  engine re-routes them into their proper marker channels. */
  extras: string[];
  /** An envelope was present (even if every field was garbage). */
  found: boolean;
} {
  full = normalizeStateEnvelope(full);
  const start = full.lastIndexOf(OPENER);
  if (start < 0 || !/】\s*$/.test(full.slice(start))) {
    return { clean: full, tag: null, growth: null, pat: null, extras: [], found: false };
  }
  const inner = full.slice(start + OPENER.length);
  const body = inner.slice(0, inner.lastIndexOf('】'));
  const clean = full.slice(0, start).trimEnd();
  let mood: string | null = null;
  let intensity: number | null = null;
  let thought = '';
  let growth: number | null = null;
  let pat: string | null = null;
  const extras: string[] = [];
  for (const field of body.split('|')) {
    const cm = /[:：]/.exec(field);
    if (!cm) continue;
    const key = field.slice(0, cm.index).trim();
    const val = field.slice(cm.index + 1).trim();
    if (key === '心情') mood = val;
    else if (key === '强度') {
      const p = parseFloat(val);
      intensity = Number.isNaN(p) ? null : Math.min(1, Math.max(0, p));
    } else if (key === '心想') thought = val;
    else if (key === '成长') {
      const g = parseFloat(val);
      if (!Number.isNaN(g)) growth = g;
    } else if (key === '拍一拍') {
      if (val) pat = val;
    } else if (field.trim()) extras.push(field.trim());
  }
  return {
    clean,
    tag: mood !== null && intensity !== null ? { mood, intensity, thought } : null,
    growth,
    pat,
    extras,
    found: true,
  };
}

export function cleanDraftForDisplay(draft: string): string {
  const iCanon = draft.lastIndexOf('【状态');
  let iAlt = -1;
  ALT_OPENER_RE.lastIndex = 0;
  for (let m = ALT_OPENER_RE.exec(draft); m; m = ALT_OPENER_RE.exec(draft)) iAlt = m.index;
  const i = Math.max(iCanon, iAlt);
  if (i < 0) return draft;
  const rest = draft.slice(i);
  // Complete tag at the end (nested closers tolerated, any bracket width) or
  // a still-streaming unclosed tag → hide from the opener on. A closed tag
  // with prose after it isn't the end-tag — leave it.
  if (/[】\]］]\s*$/.test(rest) || !/[】\]］]/.test(rest)) return draft.slice(0, i).trimEnd();
  return draft;
}

/**
 * Historical leak scrub: replies saved before the envelope parser landed may
 * carry a raw 【状态|…】 in their content. A state tag NEVER belongs in
 * visible text or in the transcript we feed back (it teaches the model the
 * broken combined format) — remove every envelope, wherever it sits.
 */
export function stripLeakedStateTags(text: string): string {
  return text
    .replace(/^[ \t]*[\[［【]状态[|｜].*[\]】］][ \t]*$\n?/gm, '') // own line, greedy to the line's LAST closer
    .replace(/[ \t]*[\[［【]状态[|｜].*[\]】］][ \t]*$/gm, '') // line tail after prose
    .replace(/[\[［【]状态[|｜][^\]】］\n]*[\]】］]/g, '') // conservative inline remnant
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The window injects "[MM-DD HH:mm]" prefixes as metadata; models sometimes
 * echo the format back. Real timestamps are rendered by the UI from
 * createdAt, so any such pattern in model output is noise — strip it.
 */
export function stripEchoedTimestamps(text: string): string {
  return text.replace(/\[\d{2}-\d{2} \d{2}:\d{2}\]\s*/g, '');
}
