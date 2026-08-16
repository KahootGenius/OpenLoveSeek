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
const HEADS = ['拍一拍', '转账', '表情包', '表情', '病娇', '主人', '记忆', '记住', '忘记'];

// Syntax characters that signal "this was meant to be a marker".
const SYNTAX = /[\[\]【】()（）:：|｜]/;

// Complete, well-formed bracket groups WITH a colon (a bracketed head missing
// its colon is exactly the breakage we hunt) — own-line markers AND inline
// mentions both count as healthy (the mention doctrine: a well-formed inline
// marker is her talking ABOUT the feature; firing it is as bad as missing one).
const WELL_FORMED = /\[[^\[\]\n]{1,40}[:：][^\[\]\n]{0,80}\]|【[^【】\n]{1,40}[:：][^【】\n]{0,80}】/g;

export interface LintResult {
  suspects: string[]; // offending lines, for dev-mode diagnostics
}

export function lintMarkers(text: string): LintResult {
  const suspects: string[] = [];
  for (const line of text.split('\n')) {
    // Remove healthy bracket groups; whatever heads remain are exposed.
    const stripped = line.replace(WELL_FORMED, '');
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

export function buildRepairPrompt(reply: string): string {
  return renderPrompt('repair.checker', { text: reply });
}

// Heads whose OWN-LINE bracket variants are unambiguous intent (状态 has its
// own normalizer in statetag.ts; 表情 is served by the tolerant sticker regex).
const ACTION_HEADS = '(?:拍一拍|转账|病娇|主人|记忆|记住|忘记)';
const ALT_ACTION_RE = new RegExp(
  `^[ \\t]*[\\[【（(](${ACTION_HEADS}[:：][^\\n\\]】）)]+?)[\\]】）)][ \\t]*$`,
  'gm',
);

/** Pure. Own-line action markers in wrong brackets → canonical [头:值].
 *  Same medicine as the 状态 envelope normalizer: deterministic, no model. */
export function normalizeActionMarkers(text: string): string {
  return text.replace(ALT_ACTION_RE, (_, inner: string) => `[${inner.trim()}]`);
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
