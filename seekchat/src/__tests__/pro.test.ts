import {
  buildProSections, buildRealismRules, buildStateBlock, fmtDivider, fmtGap, fmtTimestamp,
  parseProConfig,
} from '../lib/pro';
import { stripEchoedTimestamps } from '../lib/statetag';

describe('parseProConfig', () => {
  it('parses valid json and rejects garbage', () => {
    expect(parseProConfig('{"moodBaseline":"开朗"}')).toEqual({ moodBaseline: '开朗' });
    expect(parseProConfig('not json')).toBeNull();
    expect(parseProConfig(null)).toBeNull();
    expect(parseProConfig('42')).toBeNull();
  });
});

describe('buildProSections', () => {
  it('renders schedule lines and skips empty fields', () => {
    const out = buildProSections({
      schedule: [{ start: '07:00', end: '08:00', activity: '起床' }],
      interests: '摄影',
    });
    expect(out).toContain('【作息表】');
    expect(out).toContain('07:00-08:00 起床');
    expect(out).toContain('【兴趣爱好】\n摄影');
    expect(out).not.toContain('【雷区与底线】');
    expect(out).toContain('【行为质感】');
  });
});

describe('buildStateBlock', () => {
  it('includes present lines, omits absent ones', () => {
    const out = buildStateBlock({
      now: new Date(2026, 6, 14, 22, 5),
      lastMessageAt: new Date(2026, 6, 14, 19, 5).getTime(),
      activity: '空闲',
      mood: { label: '开心', intensity: 0.42 },
      thought: '他今天怎么这么忙',
    });
    expect(out).toContain('现在时间：2026-07-14 22:05');
    expect(out).toContain('距上次对话：3小时前');
    expect(out).toContain('你当前的日程活动：空闲');
    expect(out).toContain('你当前的心情：开心（强度0.4）');
    expect(out).toContain('你刚才心里在想：他今天怎么这么忙');
    const noSched = buildStateBlock({
      now: new Date(2026, 6, 14, 22, 5),
      lastMessageAt: null,
      activity: null,
      mood: { label: '平静', intensity: 0 },
      thought: null,
    });
    expect(noSched).not.toContain('日程活动');
    expect(noSched).not.toContain('距上次对话');
    expect(noSched).toContain('你当前的心情：平静');
  });
});

describe('formatting', () => {
  it('fmtTimestamp is [MM-DD HH:mm]', () => {
    expect(fmtTimestamp(new Date(2026, 6, 14, 9, 7).getTime())).toBe('[07-14 09:07]');
  });
  it('fmtGap humanizes', () => {
    expect(fmtGap(30 * 1000)).toBe('刚刚');
    expect(fmtGap(5 * 60000)).toBe('5分钟前');
    expect(fmtGap(3 * 3600000)).toBe('3小时前');
    expect(fmtGap(49 * 3600000)).toBe('2天前');
  });
});

describe('buildRealismRules', () => {
  it('always demands the tag; trigger rules only with life', () => {
    expect(buildRealismRules(false)).toContain('【状态|心情:');
    expect(buildRealismRules(false)).not.toContain('系统触发');
    expect(buildRealismRules(true)).toContain('系统触发');
  });
  it('forbids echoing timestamp metadata', () => {
    expect(buildRealismRules(false)).toContain('时间元数据');
  });
});

describe('fmtDivider', () => {
  const now = new Date(2026, 6, 14, 22, 0).getTime();
  it('same day → HH:mm', () => {
    expect(fmtDivider(new Date(2026, 6, 14, 9, 5).getTime(), now)).toBe('09:05');
  });
  it('yesterday → 昨天 HH:mm', () => {
    expect(fmtDivider(new Date(2026, 6, 13, 23, 40).getTime(), now)).toBe('昨天 23:40');
  });
  it('same year → M月D日', () => {
    expect(fmtDivider(new Date(2026, 4, 1, 8, 0).getTime(), now)).toBe('5月1日 08:00');
  });
  it('older years include the year', () => {
    expect(fmtDivider(new Date(2025, 11, 31, 8, 0).getTime(), now)).toBe('2025年12月31日 08:00');
  });
});

describe('stripEchoedTimestamps', () => {
  it('removes echoed metadata timestamps anywhere', () => {
    expect(stripEchoedTimestamps('[07-14 09:07] 早安呀')).toBe('早安呀');
    expect(stripEchoedTimestamps('早安 --- [07-14 09:08] 吃了吗')).toBe('早安 --- 吃了吗');
  });
  it('leaves normal text and other brackets alone', () => {
    expect(stripEchoedTimestamps('我们[明天]见 3:5 比分')).toBe('我们[明天]见 3:5 比分');
  });
});
