import {
  buildGroupContext, buildSpeakerPrompt, chainCount, groupHomeNote, parseGroupConfig,
  parseGroupDirector, parseMentions, pickFallbackSpeaker, planCatchup, renderTranscript,
  splitSpeakerBurst, GROUP_DEFAULTS, CATCHUP_MAX_LINES,
} from '../lib/groupchat';
import { encodeRedpacket } from '../lib/redpacket';
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

  it('parses v2.5 fields with safe defaults', () => {
    const cfg = parseGroupConfig('{}');
    expect(cfg.owner).toBe('user');
    expect(cfg.modConsent).toBe(false);
    expect(cfg.announcement).toBeNull();
    expect(cfg.notepad).toBeNull();
    expect(cfg.userMutedUntil).toBeNull();
    const full = parseGroupConfig(JSON.stringify({
      owner: 'ch1', modConsent: true,
      announcement: { text: '每天打卡', by: 'ch1', at: 5 },
      notepad: { text: '备忘', by: 'user', at: 6 },
      userMutedUntil: 99,
    }));
    expect(full.owner).toBe('ch1');
    expect(full.announcement?.text).toBe('每天打卡');
    expect(full.userMutedUntil).toBe(99);
    expect(parseGroupConfig('{"announcement":{"text":""}}').announcement).toBeNull();
    expect(parseGroupConfig('{"chainCap":0}').chainCap).toBe(1);
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

  it('counts only real character speech, not system or recalled rows', () => {
    const ms = [
      msg({ role: 'user', content: '在吗' }),
      msg({ role: 'assistant', content: '在的' }),
      msg({ role: 'assistant', kind: 'meta', content: '🌙 网络开小差了' }),
      msg({ role: 'assistant', kind: 'recall', content: '沫凌 撤回了一条消息' }),
      msg({ role: 'assistant', kind: 'sticker', content: 'stk1' }),
    ];
    expect(chainCount(ms)).toBe(2);
  });
});

describe('parseGroupDirector', () => {
  it('parses {"next":[ids]}, filters unknown, dedupes, caps at maxSpeakers', () => {
    const roster = [{ id: 'a', name: '沫凌' }, { id: 'b', name: '小雨' }, { id: 'c', name: '阿明' }];
    expect(parseGroupDirector('{"next":["a","zz","a","b","c"]}', roster, 2)).toEqual(['a', 'b']);
    expect(parseGroupDirector('好的\n{"next":[]}\n完毕', [{ id: 'a', name: '沫凌' }], 2)).toEqual([]);
    expect(parseGroupDirector('乱写', [{ id: 'a', name: '沫凌' }], 2)).toEqual([]);
    expect(parseGroupDirector('{"next":"a"}', [{ id: 'a', name: '沫凌' }], 2)).toEqual([]);
  });

  it('accepts member names in next and maps them to ids', () => {
    const roster = [{ id: 'a', name: '沫凌' }, { id: 'b', name: '小雨' }];
    expect(parseGroupDirector('{"next":["沫凌","b"]}', roster, 2)).toEqual(['a', 'b']);
    expect(parseGroupDirector('{"next":["路人"]}', roster, 2)).toEqual([]);
  });
});

describe('pickFallbackSpeaker', () => {
  const members = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('prefers a mentioned member, else picks by rand', () => {
    expect(pickFallbackSpeaker(members, ['b'])).toEqual({ id: 'b' });
    expect(pickFallbackSpeaker(members, [], () => 0.99)).toEqual({ id: 'c' });
    expect(pickFallbackSpeaker([], [])).toBeNull();
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

  it('caps to the last N lines and skips experience rows', () => {
    const many = Array.from({ length: 30 }, (_, i) => msg({ content: `第${i}条` }));
    const t = renderTranscript(many, () => '用户', () => null, 5);
    expect(t).not.toContain('第24条');
    expect(t).toContain('第29条');
    const withExperience = [
      msg({ content: '正常' }),
      msg({ kind: 'experience', content: '经验条目' }),
    ];
    expect(renderTranscript(withExperience, () => '用户', () => null)).not.toContain('经验条目');
  });

  it('renders recall and meta rows as 系统 lines', () => {
    const msgs = [
      msg({ role: 'user', content: '在吗' }),
      msg({ role: 'assistant', kind: 'recall', content: '沫凌 撤回了一条消息' }),
      msg({ role: 'assistant', kind: 'meta', content: '📣 沫凌 禁言了 小雨 5分钟' }),
    ];
    const out = renderTranscript(msgs, () => '我', () => null);
    expect(out).toContain('系统：沫凌 撤回了一条消息');
    expect(out).toContain('系统：📣 沫凌 禁言了 小雨 5分钟');
  });

  it('renders a redpacket row with its note, or [红包] when malformed', () => {
    const packet = encodeRedpacket({
      total: 500, count: 2, note: '请喝奶茶', shares: [200, 300], claims: [],
    });
    const ms = [
      msg({ role: 'assistant', speakerId: 'a', kind: 'redpacket', content: packet }),
      msg({ role: 'user', kind: 'redpacket', content: 'not json' }),
    ];
    const out = renderTranscript(ms, nameOf, () => null);
    expect(out).toContain('沫凌：[发了一个红包：请喝奶茶]');
    expect(out).toContain('用户：[红包]');
  });
});

describe('buildGroupContext', () => {
  it('prefixes announcement, notepad, then summary', () => {
    const out = buildGroupContext('聊天', {
      announcement: { text: '十点后安静', by: 'a', at: 1 },
      notepad: { text: '奶茶清单', by: 'user', at: 2 },
    } as never, '旧总结');
    expect(out.indexOf('【群公告】十点后安静')).toBe(0);
    expect(out).toContain('【群笔记】奶茶清单');
    expect(out).toContain('【此前群聊总结】旧总结');
    expect(out.endsWith('聊天')).toBe(true);
    expect(buildGroupContext('聊天', { announcement: null, notepad: null } as never, null)).toBe('聊天');
  });
});

describe('buildSpeakerPrompt', () => {
  const base = {
    personaPrompt: '人设', soulContext: '灵魂', selfName: '沫凌', groupName: '深夜食堂',
    memberNames: '沫凌、用户', transcript: '用户：在吗',
  };

  it('appends modPowers after a blank line; empty modPowers leaves the prompt unchanged', () => {
    const withoutPowers = buildSpeakerPrompt({ ...base, modPowers: '' });
    const withPowers = buildSpeakerPrompt({ ...base, modPowers: 'X' });
    expect(withPowers).toBe(withoutPowers + '\n\nX');
    expect(withPowers.endsWith('\n\nX')).toBe(true);
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

describe('splitSpeakerBurst', () => {
  it('splits on --- into trimmed non-empty chunks', () => {
    expect(splitSpeakerBurst('早呀---今天去哪玩？')).toEqual(['早呀', '今天去哪玩？']);
    expect(splitSpeakerBurst('一句话而已')).toEqual(['一句话而已']);
  });

  it('drops whitespace-only segments and survives dash-only bodies', () => {
    expect(splitSpeakerBurst('嗯嗯--- ---好呀')).toEqual(['嗯嗯', '好呀']);
    expect(splitSpeakerBurst('---')).toEqual([]);
    expect(splitSpeakerBurst('   ')).toEqual([]);
  });
});
