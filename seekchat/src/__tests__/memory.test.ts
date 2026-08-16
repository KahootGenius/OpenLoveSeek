import {
  applyMemoryOps, buildMemorySection, canAddManualMemory, extractMemoryMarkers,
  MAX_MEMORY_ENTRIES, MAX_MEMORY_TEXT, MEMORY_ADDS_PER_REPLY,
  normalizeManualMemoryText,
} from '../lib/memory';
import * as memory from '../lib/memory';
import type { MemoryEntry } from '../lib/types';

let seq = 0;
const entry = (text: string): MemoryEntry => ({
  id: `e${++seq}`, conversationId: 'c1', text, createdAt: 1770000000000 + seq * 1000,
});

describe('extractMemoryMarkers', () => {
  it('pulls an own-line add marker and cleans the reply', () => {
    const r = extractMemoryMarkers('今天聊得好开心\n[记忆:他说想养一只橘猫]\n明天见啦');
    expect(r.adds).toEqual(['他说想养一只橘猫']);
    expect(r.removes).toEqual([]);
    expect(r.clean).toBe('今天聊得好开心\n明天见啦');
  });
  it('tolerates fullwidth brackets/colon and the 记住 alias', () => {
    expect(extractMemoryMarkers('【记忆：他生日是3月14日】').adds).toEqual(['他生日是3月14日']);
    expect(extractMemoryMarkers('[记住: 他怕黑]').adds).toEqual(['他怕黑']);
  });
  it('pulls forget markers (忘记 / 记忆删) with 1-based indices', () => {
    const r = extractMemoryMarkers('好，那件事就翻篇啦\n[忘记:3]\n【记忆删：1】');
    expect(r.removes).toEqual([3, 1]);
    expect(r.clean).toBe('好，那件事就翻篇啦');
  });
  it('strips markers occupying their own --- segment', () => {
    const r = extractMemoryMarkers('第一句\n---\n[记忆:重要的事]\n---\n第二句');
    expect(r.adds).toEqual(['重要的事']);
    expect(r.clean).toBe('第一句\n---\n第二句');
  });
  it('leaves inline mentions alone and never crosses newlines', () => {
    const inline = extractMemoryMarkers('我才不会把[记忆:这个]写进去');
    expect(inline.adds).toEqual([]);
    expect(inline.clean).toBe('我才不会把[记忆:这个]写进去');
    const dangling = '在吗\n[记忆:\n今天有点想你了]\n晚点聊';
    const r = extractMemoryMarkers(dangling);
    expect(r.adds).toEqual([]);
    expect(r.clean).toBe(dangling);
  });
  it('preserves paired inner brackets and leaves no stray closer', () => {
    const r = extractMemoryMarkers('今晚聊游戏聊得开心\n[记忆:他最爱的游戏是【原神】]');
    expect(r.adds).toEqual(['他最爱的游戏是【原神】']);
    expect(r.clean).toBe('今晚聊游戏聊得开心');
  });
  it('own-line contract is strict: trailing prose or a second marker means no match', () => {
    const trailing = extractMemoryMarkers('[记忆:他表白了]然后我哭了');
    expect(trailing.adds).toEqual([]);
    expect(trailing.clean).toBe('[记忆:他表白了]然后我哭了');
    const double = extractMemoryMarkers('[记忆:A][记忆:B]');
    expect(double.adds).toEqual([]);
  });
  it('caps adds per reply and truncates long entries', () => {
    const r = extractMemoryMarkers('[记忆:一]\n[记忆:二]\n[记忆:三]');
    expect(r.adds).toEqual(['一', '二']);
    expect(r.adds.length).toBe(MEMORY_ADDS_PER_REPLY);
    const long = extractMemoryMarkers(`[记忆:${'长'.repeat(100)}]`);
    expect(long.adds[0]).toHaveLength(MAX_MEMORY_TEXT);
  });
});

describe('applyMemoryOps', () => {
  it('maps display indices to ids against the pre-add list', () => {
    const entries = [entry('a'), entry('b'), entry('c')];
    const r = applyMemoryOps(entries, { adds: ['d'], removes: [2] });
    expect(r.removeIds).toEqual([entries[1].id]);
    expect(r.toAdd).toEqual(['d']);
  });
  it('ignores out-of-range removals', () => {
    const entries = [entry('a')];
    expect(applyMemoryOps(entries, { adds: [], removes: [0, 5] }).removeIds).toEqual([]);
  });
  it('enforces the entry cap, counting removals as freed room', () => {
    const entries = Array.from({ length: MAX_MEMORY_ENTRIES }, (_, i) => entry(`m${i}`));
    const blocked = applyMemoryOps(entries, { adds: ['新的'], removes: [] });
    expect(blocked.toAdd).toEqual([]);
    const swapped = applyMemoryOps(entries, { adds: ['新的'], removes: [1] });
    expect(swapped.toAdd).toEqual(['新的']);
  });
});

describe('buildMemorySection', () => {
  it('lists entries numbered with dates and states the write format', () => {
    const out = buildMemorySection([entry('他喜欢下雨天')]);
    expect(out).toContain('【记忆库】');
    expect(out).toContain('[记忆:内容]');
    expect(out).toContain('[忘记:序号]');
    expect(out).toMatch(/1\. \[\d{1,2}月\d{1,2}日\] 他喜欢下雨天/);
  });
  it('invites a first memory when empty', () => {
    expect(buildMemorySection([])).toContain('还没有记忆');
  });
  it('warns when near and at capacity', () => {
    const near = Array.from({ length: MAX_MEMORY_ENTRIES - 3 }, (_, i) => entry(`m${i}`));
    expect(buildMemorySection(near)).toContain('将满');
    const full = Array.from({ length: MAX_MEMORY_ENTRIES }, (_, i) => entry(`m${i}`));
    expect(buildMemorySection(full)).toContain('已满');
  });
  it('separates marker rules from model-authored memory evidence', () => {
    const entries = [entry('他喜欢下雨天')];
    const api = memory as typeof memory & {
      buildMemoryInstructions?: (items: MemoryEntry[]) => string;
      buildMemoryEvidence?: (items: MemoryEntry[]) => string;
    };

    expect(api.buildMemoryInstructions).toBeDefined();
    expect(api.buildMemoryEvidence).toBeDefined();
    const instructions = api.buildMemoryInstructions!(entries);
    const evidence = api.buildMemoryEvidence!(entries);

    expect(instructions).toContain('[记忆:内容]');
    expect(instructions).not.toContain('他喜欢下雨天');
    expect(evidence).toMatch(/^【模型记忆条目｜仅参考】\n/);
    expect(evidence).toContain('他喜欢下雨天');
    expect(evidence).not.toContain('[记忆:内容]');

    const combined = buildMemorySection(entries);
    expect(combined.indexOf('【记忆库】')).toBeLessThan(
      combined.indexOf('【模型记忆条目｜仅参考】'),
    );
  });
});

describe('manual memory input', () => {
  it('trims input and rejects whitespace-only text', () => {
    expect(normalizeManualMemoryText('  他喜欢下雨天  ')).toBe('他喜欢下雨天');
    expect(normalizeManualMemoryText('   \n  ')).toBe('');
  });

  it('caps text at the existing per-entry limit', () => {
    expect(normalizeManualMemoryText('长'.repeat(100))).toHaveLength(MAX_MEMORY_TEXT);
  });

  it('allows additions only below the existing vault cap', () => {
    expect(canAddManualMemory(MAX_MEMORY_ENTRIES - 1)).toBe(true);
    expect(canAddManualMemory(MAX_MEMORY_ENTRIES)).toBe(false);
    expect(canAddManualMemory(MAX_MEMORY_ENTRIES + 1)).toBe(false);
  });
});
