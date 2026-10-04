import {
  calendarLines, daysUntilBirthday, holidaysOn, normalizeBirthday, upcomingHoliday,
} from '../lib/calendar';
import {
  buildPerceptionPrompt, CLOSENESS_START, clampCloseness, closenessLine, emptyPerception,
  followUpAtFor, parsePerception, shouldPerceive, toJudgement,
} from '../lib/perception';
import {
  availabilityAt, busyDirective, computeReadAt, decideRhythm, deferDeliveryAt, deferredDirective,
  newestReadUserId,
} from '../lib/rhythm';
import {
  buildDayPrompt, dayEventsLine, dayKeyOf, needsDaySeed, parseDayEvents, parseDayLog, todaysEvents,
} from '../lib/dayseed';
import {
  extractQuote, extractRecall, maybeTypo, recallTombstone, resolveQuoteTarget, TYPO_PAIRS,
} from '../lib/texture';
import { extractStateTag } from '../lib/statetag';
import { buildStateBlock } from '../lib/pro';
import { buildMemoryEvidence, buildMemoryInstructions, dueFollowUps } from '../lib/memory';
import { initialShaping, advanceTurn } from '../lib/shaping';
import type { MemoryEntry } from '../lib/types';

const seq = (...vals: number[]) => {
  let i = 0;
  return () => vals[Math.min(i++, vals.length - 1)];
};
const at = (h: number, m = 0, base = new Date(2026, 8, 13)) =>
  new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m, 0, 0);
const SCHED = [
  { start: '23:00', end: '07:00', activity: '睡觉' },
  { start: '09:00', end: '18:00', activity: '上班' },
  { start: '19:00', end: '20:00', activity: '健身' },
];

describe('calendar', () => {
  it('knows fixed and lunar holidays through the table, and nothing on a plain day', () => {
    expect(holidaysOn(new Date(2026, 1, 17))).toEqual(['春节']);
    expect(holidaysOn(new Date(2026, 1, 14))).toEqual(['情人节']);
    expect(holidaysOn(new Date(2027, 8, 15))).toEqual(['中秋节']);
    expect(holidaysOn(new Date(2026, 8, 13))).toEqual([]);
    expect(holidaysOn(new Date(2030, 1, 3))).toEqual([]); // beyond the table: silent
    expect(upcomingHoliday(new Date(2026, 8, 22))).toBe('中秋节（3天后）');
    expect(upcomingHoliday(new Date(2026, 8, 13))).toBeNull();
  });

  it('normalizes birthdays and counts down, wrapping the year', () => {
    expect(normalizeBirthday('5-20')).toBe('05-20');
    expect(normalizeBirthday('12月25日')).toBe('12-25');
    expect(normalizeBirthday('13-01')).toBeNull();
    expect(normalizeBirthday('明天')).toBeNull();
    expect(daysUntilBirthday('09-13', new Date(2026, 8, 13))).toBe(0);
    expect(daysUntilBirthday('09-20', new Date(2026, 8, 13))).toBe(7);
    expect(daysUntilBirthday('01-01', new Date(2026, 11, 30))).toBe(2);
    expect(daysUntilBirthday(null, new Date())).toBeNull();
  });

  it('renders state lines only when there is something to say', () => {
    expect(calendarLines(new Date(2026, 8, 13), null)).toEqual([]);
    expect(calendarLines(new Date(2026, 8, 25), '09-30')).toEqual(['今天是中秋节', '对方的生日还有5天']);
    expect(calendarLines(new Date(2026, 8, 13), '09-13')).toEqual(['今天是对方的生日']);
  });
});

describe('perception', () => {
  const mem = (text: string): MemoryEntry => ({ id: text, conversationId: 'c', text, createdAt: 1 });
  const base = {
    herLast: '今天好累', userReply: '辛苦啦，周五我要体检', memories: [mem('对方养了一只猫')],
    personaName: '小雨', now: new Date(2026, 8, 13), shaping: null,
  };

  it('is skipped only when nobody has said anything', () => {
    expect(shouldPerceive({ herLast: '', userReply: '' })).toBe(false);
    expect(shouldPerceive({ herLast: 'x', userReply: '' })).toBe(true);
    expect(shouldPerceive({ herLast: '', userReply: 'x' })).toBe(true);
  });

  it('builds the observer prompt with both sides, the vault, the date, and shaping extras only when shaping', () => {
    const p = buildPerceptionPrompt(base);
    expect(p).toContain('今天好累');
    expect(p).toContain('周五我要体检');
    expect(p).toContain('1. 对方养了一只猫');
    expect(p).toContain('2026-09-13（周日）');
    expect(p).not.toContain('attitude');
    const s = advanceTurn(initialShaping()).state;
    const ps = buildPerceptionPrompt({ ...base, shaping: s });
    expect(ps).toContain('「语气=撒娇软糯」');
    expect(ps).toContain('"attitude":null');
    expect(ps).toContain('如果她在上一条里给自己起了名字');
    const silent = buildPerceptionPrompt({ ...base, userReply: '', herLast: '' });
    expect(silent).toContain('对方还没有回复');
    expect(silent).toContain('她还没说过话');
  });

  it('parses a full verdict, dedupes facts against the vault, validates follow-ups and birthday', () => {
    const raw = '判断如下：' + JSON.stringify({
      register: '严谨', length: '长', userMood: '有点累',
      facts: ['对方养了一只猫', '对方周五要体检', '对方在做设计', '溢出'],
      followUps: [{ text: '周五体检', days: 2 }, { text: '太远', days: 90 }, { text: '', days: 1 }, { text: '周五体检', days: 2 }],
      closeness: 1, birthday: '5月20日',
    });
    const p = parsePerception(raw, { userReplied: true, knownMemories: ['对方养了一只猫'], shaping: null });
    expect(p).toEqual({
      register: '严谨', length: '长', userMood: '有点累',
      facts: ['对方周五要体检', '对方在做设计'],
      followUps: [{ text: '周五体检', days: 2 }],
      closeness: 1, birthday: '05-20', attitude: null, selfFacts: [], name: null,
    });
  });

  it('degrades garbage and wrong types field by field, and drops register/length on a trigger turn', () => {
    expect(parsePerception('无法判断', { userReplied: true, knownMemories: [], shaping: null })).toEqual(emptyPerception());
    const p = parsePerception(
      JSON.stringify({ register: '狂野', length: '短', userMood: 7, facts: 'x', followUps: 'y', closeness: '5', birthday: '昨天' }),
      { userReplied: true, knownMemories: [], shaping: null },
    );
    expect(p).toMatchObject({ register: null, length: '短', userMood: null, facts: [], followUps: [], closeness: 0, birthday: null });
    const t = parsePerception(JSON.stringify({ register: '严谨', length: '长', closeness: -1 }), { userReplied: false, knownMemories: [], shaping: null });
    expect(t).toMatchObject({ register: null, length: null, closeness: -1 });
  });

  it('reads the shaping fields only in shaping mode, honoring named and known self-facts', () => {
    const s = { ...advanceTurn(initialShaping()).state, portrait: ['我在读设计'] };
    const raw = JSON.stringify({ attitude: '喜欢', selfFacts: ['我在读设计', '我今年22岁'], name: '小雨' });
    const p = parsePerception(raw, { userReplied: true, knownMemories: [], shaping: s });
    expect(toJudgement(p)).toEqual({ attitude: '喜欢', facts: ['我今年22岁'], name: '小雨' });
    const named = parsePerception(raw, { userReplied: true, knownMemories: [], shaping: { ...s, named: true } });
    expect(named.name).toBeNull();
    const notShaping = parsePerception(raw, { userReplied: true, knownMemories: [], shaping: null });
    expect(toJudgement(notShaping)).toEqual({ attitude: null, facts: [], name: null });
  });

  it('closeness helpers: clamp, start value, tiered meaning, follow-up due at 10:00', () => {
    expect(CLOSENESS_START).toBe(40);
    expect(clampCloseness(140)).toBe(100);
    expect(clampCloseness(-3)).toBe(0);
    expect(closenessLine(10)).toContain('互相试探');
    expect(closenessLine(90)).toContain('老夫老妻');
    const due = new Date(followUpAtFor(new Date(2026, 8, 13, 22, 30), 2));
    expect([due.getMonth(), due.getDate(), due.getHours()]).toEqual([8, 15, 10]);
    expect(new Date(followUpAtFor(new Date(2026, 8, 13), 500)).getDate()).toBe(new Date(2026, 8, 13 + 60).getDate());
  });
});

describe('rhythm', () => {
  it('classifies availability from the schedule, with wake/until times in the future', () => {
    const asleep = availabilityAt(SCHED, at(2));
    expect(asleep).toMatchObject({ state: 'asleep', activity: '睡觉' });
    expect(new Date((asleep as { wakeAt: number }).wakeAt).getHours()).toBe(7);
    const busy = availabilityAt(SCHED, at(10));
    expect(busy).toMatchObject({ state: 'busy', activity: '上班' });
    expect(new Date((busy as { until: number }).until).getHours()).toBe(18);
    expect(availabilityAt(SCHED, at(21))).toEqual({ state: 'free', activity: '空闲' });
    expect(availabilityAt(undefined, at(10))).toEqual({ state: 'free', activity: null });
    // an overnight slot crossing midnight, checked before midnight
    expect(availabilityAt(SCHED, at(23, 30)).state).toBe('asleep');
  });

  it('computes 已读 stamps per state', () => {
    const now = at(10).getTime();
    const free = computeReadAt({ state: 'free', activity: null }, now, seq(0.5));
    expect(free - now).toBeGreaterThanOrEqual(3000);
    expect(free - now).toBeLessThanOrEqual(45000);
    const until = at(18).getTime();
    const busy = computeReadAt({ state: 'busy', activity: '上班', until }, now, seq(0.5));
    expect(busy - now).toBeCloseTo(9 * 60000, -3);
    const wakeAt = at(7).getTime();
    const asleep = computeReadAt({ state: 'asleep', activity: '睡觉', wakeAt }, at(2).getTime(), seq(0));
    expect(asleep).toBe(wakeAt + 2 * 60000);
  });

  it('decides short-then-defer while busy, defer while asleep, and never on a trigger turn or when disabled', () => {
    const now = at(10).getTime();
    const busy = availabilityAt(SCHED, at(10));
    const d = decideRhythm({ avail: busy, enabled: true, triggerTurn: false, lastShortUntil: null, nowMs: now, rand: seq(0.5) });
    expect(d.mode).toBe('short');
    expect(d.deliverAt).toBeGreaterThan(at(18).getTime());
    const again = decideRhythm({ avail: busy, enabled: true, triggerTurn: false, lastShortUntil: (busy as { until: number }).until, nowMs: now, rand: seq(0.5) });
    expect(again.mode).toBe('defer');
    expect(decideRhythm({ avail: availabilityAt(SCHED, at(2)), enabled: true, triggerTurn: false, lastShortUntil: null, nowMs: at(2).getTime(), rand: seq(0.5) }).mode).toBe('defer');
    expect(decideRhythm({ avail: busy, enabled: false, triggerTurn: false, lastShortUntil: null, nowMs: now, rand: seq(0.5) }).mode).toBe('now');
    expect(decideRhythm({ avail: busy, enabled: true, triggerTurn: true, lastShortUntil: null, nowMs: now, rand: seq(0.5) }).mode).toBe('now');
    expect(decideRhythm({ avail: availabilityAt(SCHED, at(21)), enabled: true, triggerTurn: false, lastShortUntil: null, nowMs: now, rand: seq(0.5) }).mode).toBe('now');
    expect(deferDeliveryAt({ state: 'free', activity: null }, now, seq(0.5))).toBe(now);
    expect(busyDirective('上班')).toContain('不超过15个字');
    expect(deferredDirective('上班', at(18, 7))).toContain('18:07');
  });

  it('finds the newest read user row, skipping triggers and unread rows', () => {
    const rows = [
      { id: 'a', role: 'user', kind: 'normal', readAt: 100 },
      { id: 'b', role: 'assistant', kind: 'normal', readAt: null },
      { id: 'c', role: 'user', kind: 'normal', readAt: 500 },
      { id: 'd', role: 'user', kind: 'trigger', readAt: 1 },
    ];
    expect(newestReadUserId(rows, 200)).toBe('a');
    expect(newestReadUserId(rows, 600)).toBe('c');
    expect(newestReadUserId(rows, 50)).toBeNull();
  });
});

describe('dayseed', () => {
  it('keys days, parses logs, and only counts today', () => {
    const today = new Date(2026, 8, 13);
    expect(dayKeyOf(today)).toBe('20260913');
    const log = parseDayLog(JSON.stringify({ day: '20260913', events: ['洒了咖啡', 7] }));
    expect(log).toEqual({ day: '20260913', events: ['洒了咖啡'] });
    expect(todaysEvents(log, today)).toEqual(['洒了咖啡']);
    expect(todaysEvents(log, new Date(2026, 8, 14))).toEqual([]);
    expect(needsDaySeed(log, today)).toBe(false);
    expect(needsDaySeed(log, new Date(2026, 8, 14))).toBe(true);
    expect(needsDaySeed(null, today)).toBe(true);
    expect(parseDayLog('x')).toBeNull();
    expect(dayEventsLine(log, today)).toBe('你今天到目前为止的小事：洒了咖啡');
    expect(dayEventsLine(log, new Date(2026, 8, 14))).toBeNull();
  });

  it('builds the day prompt and parses JSON or line answers, capped and cleaned', () => {
    const p = buildDayPrompt({
      persona: '你是我的女朋友', schedule: SCHED, interests: '摄影', now: new Date(2026, 8, 25), holidays: ['中秋节'], yesterday: ['地铁晚点'],
    });
    expect(p).toContain('09:00-18:00 上班');
    expect(p).toContain('9月25日 周五，中秋节');
    expect(p).toContain('地铁晚点');
    expect(parseDayEvents('["洒了咖啡","同事请假了","想吃火锅","第四件"]')).toEqual(['洒了咖啡', '同事请假了', '想吃火锅']);
    expect(parseDayEvents('1. 洒了咖啡\n- 同事请假了\n• 想吃火锅')).toEqual(['洒了咖啡', '同事请假了', '想吃火锅']);
    expect(parseDayEvents('')).toEqual([]);
  });
});

describe('texture', () => {
  it('plants one homophone slip and a *correction only in casual register, deterministically', () => {
    const chunks = ['我现在在公司加班呢', '晚点找你'];
    expect(maybeTypo(chunks, { rand: seq(0.01, 0), casual: false })).toBe(chunks);
    expect(maybeTypo(chunks, { rand: seq(0.5), casual: true })).toBe(chunks); // rand ≥ rate → no typo
    const out = maybeTypo(chunks, { rand: seq(0.01, 0), casual: true });
    expect(out).toHaveLength(3);
    expect(out[0]).toBe('我现再在公司加班呢'); // the first 在 slips
    expect(out[1]).toBe('*在');
    expect(out[2]).toBe('晚点找你');
    // bracketed text is never touched
    expect(maybeTypo(['[表情:开心] 我在这里等你呀'], { rand: seq(0.01, 0), casual: true })).toEqual(['[表情:开心] 我在这里等你呀']);
    expect(TYPO_PAIRS.length).toBeGreaterThan(4);
  });

  it('撤回 recalls the bubble above the marker, one per reply', () => {
    expect(extractRecall('你真烦\n[撤回]\n开玩笑的啦')).toEqual({ recalled: '你真烦', rest: '开玩笑的啦' });
    expect(extractRecall('早安\n---\n你真烦\n【撤回】\n开玩笑的')).toEqual({ recalled: '你真烦', rest: '早安\n---\n开玩笑的' });
    expect(extractRecall('没有撤回')).toEqual({ recalled: null, rest: '没有撤回' });
    expect(extractRecall('[撤回]\n只有后面')).toEqual({ recalled: null, rest: '只有后面' });
    expect(recallTombstone('小雨')).toBe('小雨撤回了一条消息');
  });

  it('引用 pulls the fragment and resolves the newest matching user row', () => {
    expect(extractQuote('[引用:明天去爬山]\n好呀几点出发')).toEqual({ clean: '好呀几点出发', fragment: '明天去爬山' });
    expect(extractQuote('我说[引用:x]不算')).toEqual({ clean: '我说[引用:x]不算', fragment: null });
    const rows = [{ id: 'u1', content: '我们明天去爬山吧' }, { id: 'u2', content: '晚上吃什么' }, { id: 'u3', content: '明天 去爬山 几点' }];
    expect(resolveQuoteTarget('明天去爬山', rows)).toBe('u3');
    expect(resolveQuoteTarget('晚上吃什么', rows)).toBe('u2');
    expect(resolveQuoteTarget('完全无关的话', rows)).toBeNull();
    expect(resolveQuoteTarget('', rows)).toBeNull();
  });
});

describe('state tag 想聊 + state block + memory follow-ups', () => {
  it('parses 想聊 and treats 无 as a clear', () => {
    expect(extractStateTag('嗯\n【状态|心情:开心|强度:0.6|心想:想他|想聊:周末去哪玩】').tag).toEqual({
      mood: '开心', intensity: 0.6, thought: '想他', agenda: '周末去哪玩',
    });
    expect(extractStateTag('嗯\n【状态|心情:开心|强度:0.6|心想:x|想聊:无】').tag?.agenda).toBe('');
    expect(extractStateTag('嗯\n【状态|心情:开心|强度:0.6|心想:x】').tag?.agenda).toBeNull();
  });

  it('renders the new state lines only when given', () => {
    const base = { now: new Date(2026, 8, 13, 10), lastMessageAt: null, activity: '上班', mood: { label: '平静', intensity: 0 }, thought: null };
    const plain = buildStateBlock(base);
    expect(plain).not.toContain('想找机会聊');
    const full = buildStateBlock({
      ...base, agenda: '周末去哪玩', closenessLine: closenessLine(55), calendarLines: ['今天是中秋节'],
      dayEventsLine: '你今天到目前为止的小事：洒了咖啡', dueFollowUps: ['周五体检'], userMood: '有点累',
    });
    for (const s of ['你想找机会聊的：周末去哪玩', '洒了咖啡', '今天是中秋节', '到了该问问的事：周五体检', '亲密度：55/100', '对方此刻看起来：有点累']) {
      expect(full).toContain(s);
    }
  });

  it('marks follow-up dates in evidence, lists due ones within the grace window, and teaches read-only when curated', () => {
    const now = new Date(2026, 8, 15, 12).getTime();
    const e = (text: string, followUpAt: number | null): MemoryEntry => ({ id: text, conversationId: 'c', text, followUpAt, createdAt: now - 86400000 });
    const entries = [e('周五体检', now - 3600000), e('太久了', now - 5 * 86400000), e('未来', now + 86400000), e('普通', null)];
    expect(dueFollowUps(entries, now).map((x) => x.text)).toEqual(['周五体检']);
    expect(buildMemoryEvidence(entries)).toContain('[跟进 9/15] 周五体检');
    expect(buildMemoryInstructions(entries, true)).toContain('由系统在每轮对话后自动整理');
    expect(buildMemoryInstructions(entries, true)).not.toContain('[记忆:');
    expect(buildMemoryInstructions(entries)).toContain('[记忆:');
  });
});
