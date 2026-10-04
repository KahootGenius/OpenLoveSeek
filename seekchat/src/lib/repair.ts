// 格式检查 (v2.2, user field report): models sometimes write ATTEMPTED markers
// with broken syntax — wrong brackets, lost closers, missing colons — and the
// deliberately-strict extractors then ignore them (a silent labeling failure).
// Two stages: a FREE pure lint on every reply spots near-misses; only flagged
// replies pay for one small repair call. The repair may fix FORMAT ONLY —
// acceptRepair rejects anything that smells like a rewrite, and the original
// always rides on any doubt.
import { renderPrompt } from './prompts';
import { extractStateTag } from './statetag';

// Marker heads she is actually taught. 状态 is handled separately (envelope).
// v2.5: 群管理 heads (grouproles.ts decides permission; this only spots breaks).
// v2.8: owner-character agency adds 任命/罢免/移出/转让群主.
// v2.9: 立即开始's 作息/兴趣 are everyday words — a colon after them in prose
// is common, so they stay OUT of the lint and only get the wrong-bracket
// normalizer below.
const HEADS = [
  '拍一拍', '转账', '表情包', '表情', '病娇', '主人', '记忆', '记住', '忘记',
  '禁言', '解除禁言', '公告', '笔记+', '撤回', '任命', '罢免', '移出', '转让群主', '照片',
];

// Syntax characters that signal "this was meant to be a marker".
const SYNTAX = /[\[\]【】()（）:：|｜]/;

// Complete, well-formed bracket groups WITH a colon (a bracketed head missing
// its colon is exactly the breakage we hunt) — own-line markers AND inline
// mentions both count as healthy (the mention doctrine: a well-formed inline
// marker is her talking ABOUT the feature; firing it is as bad as missing one).
const WELL_FORMED = /\[[^\[\]\n]{1,40}[:：][^\[\]\n]{0,80}\]|【[^【】\n]{1,40}[:：][^【】\n]{0,80}】/g;

// 撤回 (v2.5) carries no value, so it never has a colon — a bare complete
// bracket group is already healthy on its own; without this it would look
// like a head with a missing colon (exactly the breakage WELL_FORMED hunts).
const WELL_FORMED_BARE = /\[撤回\]|【撤回】/g;

export interface LintResult {
  suspects: string[]; // offending lines, for dev-mode diagnostics
}

export function lintMarkers(text: string): LintResult {
  const suspects: string[] = [];
  for (const line of text.split('\n')) {
    // Remove healthy bracket groups; whatever heads remain are exposed.
    const stripped = line.replace(WELL_FORMED, '').replace(WELL_FORMED_BARE, '');
    for (const head of HEADS) {
      const i = stripped.indexOf(head);
      if (i < 0) continue;
      // A head is only suspicious when marker syntax sits right next to it —
      // plain prose (帮你转账去交水费) has no adjacent brackets/colons/pipes.
      const win =
        stripped.slice(Math.max(0, i - 4), i) +
        stripped.slice(i + head.length, i + head.length + 6);
      if (SYNTAX.test(win)) {
        suspects.push(line);
        break;
      }
    }
  }
  // Broken 状态 envelope: opener present but the parser finds nothing.
  if (/【?状态[|｜]/.test(text) && !extractStateTag(text).found) {
    suspects.push('【状态…（未闭合或字段损坏）');
  }
  return { suspects };
}

// narration: true only when a narration-rescue feature (照片/病娇锁屏) was
// actually taught this turn — otherwise the checker's OWN conversion advice
// could inject a marker the (gated-off) extractor won't consume, leaving it
// to render raw. repair.narration is its own studio-editable template entry
// rather than baked into repair.checker, so it can be toggled per call.
export function buildRepairPrompt(
  reply: string, opts?: { narration?: boolean },
): string {
  return renderPrompt('repair.checker', {
    text: reply,
    narrationNote: opts?.narration ? renderPrompt('repair.narration') : '',
  });
}

// Heads whose OWN-LINE bracket variants are unambiguous intent (状态 has its
// own normalizer in statetag.ts; 表情 is served by the tolerant sticker regex).
// v2.5: 撤回 is excluded — even though v2.8 lets it carry a name (recall
// others), its bare form has no value and mixing the two shapes here would
// complicate the head:value pattern below for no real gain; ANY wrong-bracket
// 撤回 (bare or named) still rides the model repair call instead.
// '+' in 笔记+ is escaped — it is a literal character here, not a quantifier.
// v2.8: 任命/罢免/移出/转让群主 (owner-character agency) are always value-bearing.
const ACTION_HEADS =
  '(?:拍一拍|转账|病娇|主人|记忆|记住|忘记|禁言|解除禁言|公告|笔记\\+|任命|罢免|移出|转让群主|照片' +
  '|作息|兴趣)';
const ALT_ACTION_RE = new RegExp(
  `^[ \\t]*[\\[【（(](${ACTION_HEADS}[:：][^\\n\\]】）)]+?)[\\]】）)][ \\t]*$`,
  'gm',
);

/** Pure. Own-line action markers in wrong brackets → canonical [头:值].
 *  Same medicine as the 状态 envelope normalizer: deterministic, no model. */
export function normalizeActionMarkers(text: string): string {
  return text.replace(ALT_ACTION_RE, (_, inner: string) => `[${inner.trim()}]`);
}

// 叙事救援 (narration rescue, field report): models sometimes narrate a
// committed action in PROSE instead of writing the marker at all — a stage
// direction like （给你拍了张照片） or a bare "锁屏" line, with no marker
// syntax anywhere for lintMarkers above to catch (that lint only flags
// ATTEMPTED-but-broken syntax). Gated per-feature, same doctrine as the
// extractors themselves: an untaught feature makes coincidental prose
// harmless, never a false rescue trigger. Fullwidth parens only — the app's
// stage-direction convention.
const PHOTO_NARRATION_RE =
  /（[^（）]*拍[了张]{1,2}[^（）]*照片[^（）]*）|（[^（）]*照片[^（）]*拍[^（）]*）/g;
const LOCK_NARRATION_RE = /（[^（）]*锁屏[^（）]*）/g;
// Desire/conditional phrasing never committed the action — "要是能拍张照片
// 就好了" or "她想拍张照片" or "真想把你锁屏困住你" didn't happen; rescuing
// it would fabricate a marker (a REAL biometric lock, in 锁屏's case) for
// something she never actually did. Applies to BOTH paren checks below —
// review finding: the lock loop used to push unconditionally, asymmetric
// with the photo loop, and yandere desire-prose is common enough that it
// would have fired an unearned lock.
const DESIRE_GUARD = /想|要是|如果/;
// 拍一拍 (the pat feature) collides with the photo pattern — "他拍了拍我的
// 照片墙" ("he patted my photo wall") matches 拍...照片 but is not a photo
// send at all. Skipped photo-only (the pat words don't appear in lock
// narration).
const PAT_COLLISION_GUARD = /拍了拍|拍拍/;

export function narrationSuspects(
  text: string, features: { photo?: boolean; lock?: boolean },
): string[] {
  const suspects: string[] = [];
  if (features.photo) {
    for (const m of text.matchAll(PHOTO_NARRATION_RE)) {
      if (!DESIRE_GUARD.test(m[0]) && !PAT_COLLISION_GUARD.test(m[0])) suspects.push(m[0]);
    }
  }
  if (features.lock) {
    for (const m of text.matchAll(LOCK_NARRATION_RE)) {
      if (!DESIRE_GUARD.test(m[0])) suspects.push(m[0]);
    }
    // A bare committed line ("锁屏"/"锁屏了" alone) is not desire prose —
    // there's no room for 想/要是/如果 in two characters — so it stays
    // unguarded.
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (t === '锁屏' || t === '锁屏了') suspects.push(t);
    }
  }
  return suspects;
}

/** The no-rewrite guard: format fixes barely change length; anything else is
 *  the checker overstepping. Reject and let the original ride. */
export function acceptRepair(original: string, repaired: string): boolean {
  const r = repaired.trim();
  if (!r) return false;
  if (/^(好的|已修复|修复后|以下是|这是修复)/.test(r)) return false; // explainer leak
  const lo = original.trim().length;
  if (r.length < lo * 0.7 || r.length > lo * 1.3 + 10) return false;
  return true;
}
