import {
  chainCount, groupHomeNote, parseGroupConfig, parseGroupDirector, parseMentions, planCatchup,
  renderTranscript, GROUP_DEFAULTS, CATCHUP_MAX_LINES,
} from '../lib/groupchat';
import type { Message } from '../lib/types';

const msg = (over: Partial<Message>): Message => ({
  id: Math.random().toString(36).slice(2), conversationId: 'g1', role: 'user',
  content: 'hi', status: 'complete', kind: 'normal', reasoning: null,
  quotedId: null, speakerId: null, createdAt: 1, ...over,
});

describe('parseGroupConfig', () => {
  it('defaults ride for null/garbage and partials merge', () => {
    expect(parseGroupConfig(null)).toEqual(GROUP_DEFAULTS);
    expect(parseGroupConfig('{bad')).toEqual(GROUP_DEFAULTS);
    expect(parseGroupConfig('{"chainCap":5}').chainCap).toBe(5);
    expect(parseGroupConfig('{"chainCap":5}').maxSpeakers).toBe(GROUP_DEFAULTS.maxSpeakers);
    expect(parseGroupConfig('{"background":true}').background).toBe(true);
  });
});

describe('chainCount', () => {
  it('counts assistant lines since the last user message', () => {
    const ms = [
      msg({ role: 'user' }),
      msg({ role: 'assistant', speakerId: 'a' }),
      msg({ role: 'assistant', speakerId: 'b' }),
    ];
    expect(chainCount(ms)).toBe(2);
    expect(chainCount([...ms, msg({ role: 'user' })])).toBe(0);
    expect(chainCount([])).toBe(0);
  });
});

describe('parseGroupDirector', () => {
  it('parses {"next":[ids]}, filters unknown, dedupes, caps at maxSpeakers', () => {
    expect(parseGroupDirector('{"next":["a","zz","a","b","c"]}', ['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
    expect(parseGroupDirector('好的\n{"next":[]}\n完毕', ['a'], 2)).toEqual([]);
    expect(parseGroupDirector('乱写', ['a'], 2)).toEqual([]);
    expect(parseGroupDirector('{"next":"a"}', ['a'], 2)).toEqual([]);
  });
});

describe('renderTranscript', () => {
  const nameOf = (id: string | null) => (id === 'a' ? '沫凌' : '用户');

  it('names every line and maps stickers to labels', () => {
    const ms = [
      msg({ role: 'user', content: '大家好' }),
      msg({ role: 'assistant', speakerId: 'a', content: 'st1', kind: 'sticker' }),
      msg({ role: 'assistant', speakerId: 'a', content: '你好呀' }),
    ];
    const t = renderTranscript(ms, nameOf, (sid) => (sid === 'st1' ? '开心' : null));
    expect(t).toContain('用户：大家好');
    expect(t).toContain('沫凌：[表情：开心]');
    expect(t).toContain('沫凌：你好呀');
  });

  it('caps to the last N lines and skips meta/experience rows', () => {
    const many = Array.from({ length: 30 }, (_, i) => msg({ content: `第${i}条` }));
    const t = renderTranscript(many, () => '用户', () => null, 5);
    expect(t).not.toContain('第24条');
    expect(t).toContain('第29条');
    const withMeta = [
      msg({ content: '正常' }),
      msg({ kind: 'meta', content: '系统提示' }),
    ];
    expect(renderTranscript(withMeta, () => '用户', () => null)).not.toContain('系统提示');
  });
});

describe('planCatchup', () => {
  it('plans nothing when barely away or out of budget', () => {
    expect(planCatchup(10 * 60_000, 10, () => 0.5).length).toBe(0);
    expect(planCatchup(2 * 3600_000, 0, () => 0.5).length).toBe(0);
  });

  it('plans a bounded, increasing schedule strictly inside the away window', () => {
    const leaveAt = 1_000_000;
    const now = leaveAt + 3 * 3600_000;
    const plan = planCatchup(now - leaveAt, 10, () => 0.5);
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.length).toBeLessThanOrEqual(CATCHUP_MAX_LINES);
    const stamps = plan.map((f) => leaveAt + Math.floor(f * (now - leaveAt)));
    for (let i = 1; i < stamps.length; i++) expect(stamps[i]).toBeGreaterThan(stamps[i - 1]);
    for (const s of stamps) {
      expect(s).toBeGreaterThan(leaveAt);
      expect(s).toBeLessThan(now);
    }
  });

  it('never exceeds the daily budget', () => {
    expect(planCatchup(5 * 3600_000, 2, () => 0.99).length).toBeLessThanOrEqual(2);
  });
});

describe('parseMentions', () => {
  const roster = [{ id: 'a', name: '沫凌' }, { id: 'b', name: '小樱' }];

  it('finds @Name anywhere, deduped, in order', () => {
    expect(parseMentions('@沫凌 你怎么看？', roster)).toEqual(['a']);
    expect(parseMentions('@沫凌@小樱 都说说', roster)).toEqual(['a', 'b']);
    expect(parseMentions('@沫凌 …… @沫凌 在吗', roster)).toEqual(['a']);
  });

  it('longest name wins on prefix collisions', () => {
    const tricky = [{ id: 'x', name: '小樱' }, { id: 'y', name: '小樱桃' }];
    expect(parseMentions('@小樱桃 来', tricky)).toEqual(['y']);
  });

  it('ignores unknown names and bare @', () => {
    expect(parseMentions('@路人 好', roster)).toEqual([]);
    expect(parseMentions('发到 a@b.com', roster)).toEqual([]);
  });
});

describe('groupHomeNote', () => {
  it('is first-person, names the group, excerpts her line, stays short', () => {
    const n = groupHomeNote('深夜食堂', '我刚吃了碗面，好满足～'.repeat(5));
    expect(n).toContain('〔群聊〕');
    expect(n).toContain('深夜食堂');
    expect(n).toContain('我在');
    expect(n.length).toBeLessThan(90);
  });
});
