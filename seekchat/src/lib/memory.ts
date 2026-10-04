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

/** 跟进 (v3.0): entries due now (up to `graceDays` late), oldest first. */
export const FOLLOWUP_GRACE_DAYS = 2;
export function dueFollowUps(entries: MemoryEntry[], nowMs: number): MemoryEntry[] {
  const grace = FOLLOWUP_GRACE_DAYS * 86400000;
  return entries
    .filter((e) => e.followUpAt != null && e.followUpAt <= nowMs && nowMs - e.followUpAt <= grace)
    .sort((a, b) => (a.followUpAt ?? 0) - (b.followUpAt ?? 0));
}

const fmtFollowUp = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/** Pure. Marker rules and capacity guidance belong in the instruction lane.
 *  `curated` (v3.0 每轮感知 on): the observer writes the vault, so she is
 *  told to read it and may only prune — the write marker is not taught. */
export function buildMemoryInstructions(entries: MemoryEntry[], curated = false): string {
  if (curated) {
    return (
      '【记忆库】这是关于对方的长期记忆，由系统在每轮对话后自动整理，独立于聊天记录、永不遗忘。' +
      '用它记住对方的性格、喜好、经历与约定；标注了跟进日期的条目到期后主动问起。' +
      '发现某条已经过时或错误，单独一行写[忘记:序号]删除它。标签用户不可见，绝不在正文提及这套机制。'
    );
  }
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
    .map((e, i) =>
      `${i + 1}. [${fmtMemoryDate(e.createdAt)}]${e.followUpAt != null ? `[跟进 ${fmtFollowUp(e.followUpAt)}]` : ''} ${e.text}`)
    .join('\n');
  return `【模型记忆条目｜仅参考】\n${rows}`;
}

/** Pure. Backward-compatible combined section for non-envelope prompt paths. */
export function buildMemorySection(entries: MemoryEntry[]): string {
  const instructions = buildMemoryInstructions(entries);
  const evidence = buildMemoryEvidence(entries);
  return evidence ? `${instructions}\n${evidence}` : instructions;
}
