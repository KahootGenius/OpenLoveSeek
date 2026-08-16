import type { MemoryEntry } from './types';
import { renderPrompt } from './prompts';

/**
 * 记忆库 (memory vault): durable, model-curated facts — crucial moments,
 * the user's personality, promises — injected into EVERY request, surviving
 * summary churn. The model writes via hidden markers on their own line:
 *   [记忆:内容]   record (also tolerated: 【记忆：…】, 记住)
 *   [忘记:3]      erase entry #3 (also tolerated: 记忆删)
 * Pure logic here; storage lives in db.ts, wiring in engine.ts.
 */

export const MAX_MEMORY_ENTRIES = 40;
export const MAX_MEMORY_TEXT = 60; // chars per entry; longer writes are truncated
export const MEMORY_ADDS_PER_REPLY = 2;
const NEAR_FULL_AT = MAX_MEMORY_ENTRIES - 5;

export const normalizeManualMemoryText = (text: string): string =>
  text.trim().slice(0, MAX_MEMORY_TEXT);

export const canAddManualMemory = (entryCount: number): boolean =>
  entryCount < MAX_MEMORY_ENTRIES;

// Same-line whitespace only ([ \t]) — \s would cross newlines and let a
// dangling head swallow the next prose line (see the sticker regression).
// Openers pair with their own closer so 【原神】 can live INSIDE [记忆:…],
// and every marker is end-of-line anchored (own-line contract, no stray ']').
const addBody = (head: string) =>
  `(?:\\[[ \\t]*${head}[ \\t]*[:：][ \\t]*([^\\]\\n]{1,400}?)[ \\t]*\\]` +
  `|【[ \\t]*${head}[ \\t]*[:：][ \\t]*([^】\\n]{1,400}?)[ \\t]*】)`;
const delBody = (head: string) =>
  `(?:\\[[ \\t]*${head}[ \\t]*[:：][ \\t]*(\\d{1,3})[ \\t]*\\]` +
  `|【[ \\t]*${head}[ \\t]*[:：][ \\t]*(\\d{1,3})[ \\t]*】)`;
const ADD = addBody('(?:记忆|记住)');
const DEL = delBody('(?:忘记|记忆删)');
const ADD_SEG_RE = new RegExp(`^${ADD}$`);
const ADD_LINE_RE = new RegExp(`^[ \\t]*${ADD}[ \\t]*$\\n?`, 'gm');
const DEL_SEG_RE = new RegExp(`^${DEL}$`);
const DEL_LINE_RE = new RegExp(`^[ \\t]*${DEL}[ \\t]*$\\n?`, 'gm');

export interface MemoryOps {
  clean: string;
  adds: string[]; // capped, truncated
  removes: number[]; // 1-based display indices
}

/** Pure. Pulls memory markers (own line or own --- segment) out of a reply. */
export function extractMemoryMarkers(text: string): MemoryOps {
  const adds: string[] = [];
  const removes: number[] = [];
  const pushAdd = (t: string) => {
    const v = normalizeManualMemoryText(t);
    if (v && adds.length < MEMORY_ADDS_PER_REPLY) adds.push(v);
  };
  const pushDel = (n: string) => {
    const v = parseInt(n, 10);
    if (v >= 1 && !removes.includes(v)) removes.push(v);
  };
  const kept = text.split('---').filter((seg) => {
    const s = seg.trim();
    const a = ADD_SEG_RE.exec(s);
    if (a) {
      pushAdd(a[1] ?? a[2]);
      return false;
    }
    const d = DEL_SEG_RE.exec(s);
    if (d) {
      pushDel(d[1] ?? d[2]);
      return false;
    }
    return true;
  });
  const clean = kept
    .join('---')
    .replace(ADD_LINE_RE, (_, hw: string, fw: string) => {
      pushAdd(hw ?? fw);
      return '';
    })
    .replace(DEL_LINE_RE, (_, hw: string, fw: string) => {
      pushDel(hw ?? fw);
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { clean, adds, removes };
}

/**
 * Pure. Resolves ops against the current entries (display order = createdAt
 * ASC, 1-based). Removals are resolved against the PRE-add list — the model
 * refers to the numbers it saw in its prompt. The entry cap is enforced here.
 */
export function applyMemoryOps(
  entries: Pick<MemoryEntry, 'id'>[],
  ops: Pick<MemoryOps, 'adds' | 'removes'>,
): { toAdd: string[]; removeIds: string[] } {
  const removeIds = ops.removes
    .filter((n) => n >= 1 && n <= entries.length)
    .map((n) => entries[n - 1].id);
  const room = MAX_MEMORY_ENTRIES - (entries.length - removeIds.length);
  return { toAdd: ops.adds.slice(0, Math.max(0, room)), removeIds };
}

export const fmtMemoryDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

/** Pure. Marker rules and capacity guidance belong in the instruction lane. */
export function buildMemoryInstructions(entries: MemoryEntry[]): string {
  let out = renderPrompt('memory.section', {
    maxText: MAX_MEMORY_TEXT,
    maxAdds: MEMORY_ADDS_PER_REPLY,
  });
  if (entries.length === 0) {
    out += '\n（还没有记忆——遇到值得铭记的事就记下来。）';
    return out;
  }
  if (entries.length >= MAX_MEMORY_ENTRIES) {
    out += `\n⚠ 记忆库已满（${MAX_MEMORY_ENTRIES}条）：想记新的，先用[忘记:序号]清理或合并旧的。`;
  } else if (entries.length >= NEAR_FULL_AT) {
    out += `\n⚠ 记忆库将满（${entries.length}/${MAX_MEMORY_ENTRIES}条）：考虑合并或删除过时的条目。`;
  }
  return out;
}

/** Pure. Numbered model-authored entries belong in the evidence lane. */
export function buildMemoryEvidence(entries: MemoryEntry[]): string {
  if (entries.length === 0) return '';
  const rows = entries
    .map((e, i) => `${i + 1}. [${fmtMemoryDate(e.createdAt)}] ${e.text}`)
    .join('\n');
  return `【模型记忆条目｜仅参考】\n${rows}`;
}

/** Pure. Backward-compatible combined section for non-envelope prompt paths. */
export function buildMemorySection(entries: MemoryEntry[]): string {
  const instructions = buildMemoryInstructions(entries);
  const evidence = buildMemoryEvidence(entries);
  return evidence ? `${instructions}\n${evidence}` : instructions;
}
