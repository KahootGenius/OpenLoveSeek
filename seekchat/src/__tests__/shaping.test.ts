import {
  advanceTurn, applyJudgement, bakeShapingIntoPrompt, buildOpeningTrigger, buildQuickPrompt,
  buildShapingIdentity, buildShapingSection, DEFAULT_BASICS, extractLifeMarkers, initialShaping,
  MAX_PORTRAIT, mergeLifeIntoConfig, parseScheduleLine, parseShaping, PROBE_TURNS,
  quickPersonaName, shapingSummary, STYLE_TREE,
} from '../lib/shaping';
import type { Judgement, ShapingState } from '../lib/shaping';
import { lintMarkers, normalizeActionMarkers } from '../lib/repair';

const silent: Judgement = { attitude: null, facts: [], name: null };
const like: Judgement = { attitude: '喜欢', facts: [], name: null };
const dislike: Judgement = { attitude: '不喜欢', facts: [], name: null };
/** She acts N turns with no verdict from the observer. */
const act = (s: ShapingState, n: number): ShapingState => {
  let cur = s;
  for (let i = 0; i < n; i++) cur = advanceTurn(cur).state;
  return cur;
};
/** One full cycle: she acts, then the observer grades that act at the next turn. */
const actThen = (s: ShapingState, j: Judgement) => applyJudgement(advanceTurn(s).state, j);

describe('STYLE_TREE', () => {
  it('has unique dimensions, each with 2+ uniquely labeled variants and acting guidance', () => {
    const keys = STYLE_TREE.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of STYLE_TREE) {
      expect(d.variants.length).toBeGreaterThanOrEqual(2);
      const labels = d.variants.map((v) => v.label);
      expect(new Set(labels).size).toBe(labels.length);
      for (const v of d.variants) expect(v.how.length).toBeGreaterThan(5);
    }
  });
});

describe('基本信息 (the card)', () => {
  it('renders the one-line persona from identity/gender/age and an optional name', () => {
    expect(buildQuickPrompt(DEFAULT_BASICS)).toBe('你是我的女朋友，女，23-27岁。');
    expect(buildQuickPrompt({ identity: '男朋友', name: '阿泽', gender: '男', age: '36+' }))
      .toBe('你是我的男朋友，男，36岁以上，名叫阿泽。');
    expect(buildQuickPrompt({ identity: '学姐', name: null, gender: '女', age: '25' }))
      .toBe('你是我的学姐，女，25岁左右。');
    expect(buildQuickPrompt({ identity: '  ', name: '  ', gender: '', age: '' })).toBe('你是我的女朋友，女，23-27岁。');
  });

  it('names the persona after the given name, else the identity, and seeds the named flag', () => {
    expect(quickPersonaName(DEFAULT_BASICS)).toBe('女朋友');
    expect(quickPersonaName({ ...DEFAULT_BASICS, name: '小雨' })).toBe('小雨');
    expect(initialShaping(true).named).toBe(true);
    expect(initialShaping().named).toBe(false);
  });
});

describe('initialShaping / parseShaping', () => {
  it('starts probing the first dimension with its first variant, nothing acted yet', () => {
    const s = initialShaping();
    expect(s.probe).toEqual({ dim: '语气', variant: '撒娇软糯', turns: 0, tried: ['撒娇软糯'] });
    expect(s.lastActed).toBeNull();
    expect(s.settled).toEqual({});
    expect(s.portrait).toEqual([]);
  });

  it('round-trips through JSON and rejects garbage / foreign versions', () => {
    const s = act(initialShaping(), 1);
    expect(parseShaping(JSON.stringify(s))).toEqual(s);
    expect(parseShaping(null)).toBeNull();
    expect(parseShaping('')).toBeNull();
    expect(parseShaping('not json')).toBeNull();
    expect(parseShaping(JSON.stringify({ v: 2 }))).toBeNull();
    expect(parseShaping(JSON.stringify({ v: 1 }))).toMatchObject({
      settled: {}, probe: null, lastActed: null, turns: 0, named: false,
    });
  });
});

describe('extractLifeMarkers — the only two markers left', () => {
  it('pulls 作息/兴趣 off their own lines, tolerating fullwidth forms', () => {
    const r = extractLifeMarkers('今天想你了\n【作息：08：00-09：00 晨跑】\n[兴趣:摄影]\n晚安');
    expect(r.clean).toBe('今天想你了\n晚安');
    expect(r.schedule).toEqual([{ start: '08:00', end: '09:00', activity: '晨跑' }]);
    expect(r.interests).toEqual(['摄影']);
  });

  it('leaves inline mentions and the retired heads alone; a well-formed marker with a bad payload is hidden but ignored', () => {
    const r = extractLifeMarkers('我把[兴趣:摄影]写在句子里\n[定型:语气=撒娇软糯]\n[自画像:我叫小雨]\n[作息:25:00-26:00 睡]');
    expect(r.clean).toBe('我把[兴趣:摄影]写在句子里\n[定型:语气=撒娇软糯]\n[自画像:我叫小雨]');
    expect(r.schedule).toEqual([]);
    expect(r.interests).toEqual([]);
  });
});

describe('parseScheduleLine', () => {
  it('normalizes hours and accepts several dashes', () => {
    expect(parseScheduleLine('8:00-9:30 晨跑')).toEqual({ start: '08:00', end: '09:30', activity: '晨跑' });
    expect(parseScheduleLine('23:00～07:00 睡觉')).toEqual({ start: '23:00', end: '07:00', activity: '睡觉' });
    expect(parseScheduleLine('12:00 午饭')).toBeNull();
    expect(parseScheduleLine('08:00-09:00')).toBeNull();
  });
});

describe('advanceTurn — she acts', () => {
  it('records what she acted and rotates the variant every PROBE_TURNS, then skips a dimension nobody judged', () => {
    let s = advanceTurn(initialShaping()).state;
    expect(s.lastActed).toEqual({ dim: '语气', variant: '撒娇软糯' });
    expect(s.turns).toBe(1);
    s = act(s, PROBE_TURNS - 1);
    expect(s.probe).toMatchObject({ dim: '语气', variant: '活泼逗比', turns: 0 });
    expect(s.lastActed).toEqual({ dim: '语气', variant: '撒娇软糯' }); // acted BEFORE the rotation
    s = act(s, PROBE_TURNS);
    expect(s.probe).toMatchObject({ dim: '语气', variant: '冷静淡然' });
    const r = advanceTurn(act(s, PROBE_TURNS - 1));
    expect(r.state.skipped).toEqual(['语气']);
    expect(r.state.probe?.dim).toBe('黏人度');
    expect(r.events.map((e) => e.kind)).toEqual(['skip']);
    expect(r.state.turns).toBe(PROBE_TURNS * 3);
  });
});

describe('applyJudgement — the observer decides', () => {
  it('喜欢 settles the acted variant and moves the probe on', () => {
    const r = actThen(initialShaping(), like);
    expect(r.state.settled).toEqual({ 语气: '撒娇软糯' });
    expect(r.state.probe?.dim).toBe('黏人度');
    expect(r.events.map((e) => e.kind)).toEqual(['attitude', 'settle']);
    expect(r.events[0]).toEqual({ kind: 'attitude', dim: '语气', variant: '撒娇软糯', text: '喜欢' });
  });

  it('不喜欢 prunes the acted variant and switches to an untried branch', () => {
    const r = actThen(initialShaping(), dislike);
    expect(r.state.excluded).toEqual({ 语气: ['撒娇软糯'] });
    expect(r.state.probe).toMatchObject({ dim: '语气', variant: '活泼逗比', turns: 0 });
    expect(r.state.probe?.tried).toEqual(['撒娇软糯', '活泼逗比']);
  });

  it('中立 / no verdict changes nothing about the tree', () => {
    const base = advanceTurn(initialShaping()).state;
    expect(applyJudgement(base, { ...silent, attitude: '中立' }).state).toEqual(base);
    expect(applyJudgement(base, silent).state).toEqual(base);
    expect(applyJudgement(base, silent).events).toEqual([]);
  });

  it('grades the variant she ACTED even after the probe rotated underneath it', () => {
    // three silent acts → the probe rotated to 活泼逗比, but her last reply was 撒娇软糯
    const s = act(initialShaping(), PROBE_TURNS);
    expect(s.probe?.variant).toBe('活泼逗比');
    const r = applyJudgement(s, like);
    expect(r.state.settled).toEqual({ 语气: '撒娇软糯' });
    expect(r.state.probe?.dim).toBe('黏人度');
  });

  it('auto-settles the last remaining branch of a two-way dimension', () => {
    let s = actThen(initialShaping(), like).state; // 语气 settled, probing 黏人度=黏人
    const r = actThen(s, dislike);
    expect(r.state.settled['黏人度']).toBe('独立');
    expect(r.events.map((e) => e.kind)).toEqual(['attitude', 'exclude', 'autosettle']);
    expect(r.state.probe?.dim).toBe('主动性');
  });

  it('ignores a verdict with nothing acted, or on an already-settled dimension', () => {
    expect(applyJudgement(initialShaping(), like).events).toEqual([]);
    const settled = actThen(initialShaping(), like).state;
    const again = applyJudgement({ ...settled, lastActed: { dim: '语气', variant: '冷静淡然' } }, dislike);
    expect(again.state.settled).toEqual({ 语气: '撒娇软糯' });
    expect(again.events).toEqual([]);
  });

  it('reports done after the last dimension settles', () => {
    let s = initialShaping();
    let last: ReturnType<typeof applyJudgement> | null = null;
    for (let i = 0; i < STYLE_TREE.length; i++) {
      last = actThen(s, like);
      s = last.state;
    }
    expect(s.probe).toBeNull();
    expect(Object.keys(s.settled)).toHaveLength(STYLE_TREE.length);
    expect(last!.events.map((e) => e.kind)).toContain('done');
  });

  it('appends facts up to the cap without duplicates and flips named on a self-chosen name', () => {
    let s = applyJudgement(initialShaping(), { ...silent, facts: ['我叫小雨', '我叫小雨'], name: '小雨' }).state;
    expect(s.portrait).toEqual(['我叫小雨']);
    expect(s.named).toBe(true);
    s = { ...s, portrait: Array.from({ length: MAX_PORTRAIT }, (_, i) => `f${i}`) };
    s = applyJudgement(s, { ...silent, facts: ['溢出'] }).state;
    expect(s.portrait).toHaveLength(MAX_PORTRAIT);
    expect(s.portrait).not.toContain('溢出');
    // a second name never re-fires
    expect(applyJudgement(s, { ...silent, name: '小晴' }).events).toEqual([]);
  });

  it('never mutates its input', () => {
    const s = advanceTurn(initialShaping()).state;
    const snapshot = JSON.stringify(s);
    applyJudgement(s, { attitude: '喜欢', facts: ['x'], name: '小雨' });
    advanceTurn(s);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe('mergeLifeIntoConfig', () => {
  it('returns null when nothing to merge, else replaces same-start rows, sorts, and dedupes interests', () => {
    expect(mergeLifeIntoConfig(null, { schedule: [], interests: [] })).toBeNull();
    const cfg = mergeLifeIntoConfig(
      { schedule: [{ start: '08:00', end: '09:00', activity: '晨跑' }], interests: '摄影' },
      {
        schedule: [
          { start: '07:00', end: '07:30', activity: '早饭' },
          { start: '08:00', end: '09:30', activity: '游泳' },
        ],
        interests: ['摄影', '烘焙'],
      },
    );
    expect(cfg?.schedule).toEqual([
      { start: '07:00', end: '07:30', activity: '早饭' },
      { start: '08:00', end: '09:30', activity: '游泳' },
    ]);
    expect(cfg?.interests).toBe('摄影、烘焙');
  });

  it('starts a config from nothing so the realism layers switch on', () => {
    const cfg = mergeLifeIntoConfig(null, { schedule: [{ start: '23:00', end: '07:00', activity: '睡觉' }], interests: [] });
    expect(cfg).toEqual({ schedule: [{ start: '23:00', end: '07:00', activity: '睡觉' }] });
  });
});

describe('prompt blocks', () => {
  it('teaches acting only: the current probe, no verdict grammar, the two life markers', () => {
    const fresh = buildShapingSection(initialShaping());
    expect(fresh).toContain('【塑造模式】');
    expect(fresh).toContain('「语气=撒娇软糯」');
    expect(fresh).toContain('由系统根据对方的反应判断');
    expect(fresh).not.toMatch(/\[定型|\[排除|\[自画像|\[名字/);
    expect(fresh).toContain('[作息:08:00-09:00 晨跑]');
    expect(fresh).toContain('[兴趣:摄影]');
    expect(fresh).toContain('你连名字都还没有');
    const mid = applyJudgement(actThen(initialShaping(), like).state, { ...silent, facts: ['我叫小雨'], name: '小雨' }).state;
    const text = buildShapingSection(mid);
    expect(text).toContain('已定型的风格：语气=撒娇软糯');
    expect(text).toContain('「黏人度=黏人」');
    expect(text).toContain('1. 我叫小雨');
    expect(text).toContain('1/40');
    expect(text).not.toContain('你还没有名字');
  });

  it('adapts the opening trigger and the name nudge to whether she has a name', () => {
    expect(buildOpeningTrigger(initialShaping())).toContain('你还没有名字和人设');
    expect(buildOpeningTrigger(initialShaping(true))).toContain('除了基本信息你还没有人设');
    expect(buildShapingSection(initialShaping(true))).not.toContain('起个名字');
    const withPortraitNoName = applyJudgement(initialShaping(), { ...silent, facts: ['我在读设计'] }).state;
    expect(buildShapingSection(withPortraitNoName)).toContain('你还没有名字');
  });

  it('says so when the tree is exhausted', () => {
    let s = initialShaping();
    for (let i = 0; i < STYLE_TREE.length; i++) s = actThen(s, like).state;
    expect(buildShapingSection(s)).toContain('风格已全部定型');
  });

  it('identity block carries who she became and nothing to teach; empty when blank', () => {
    expect(buildShapingIdentity(initialShaping())).toBe('');
    const s = applyJudgement(actThen(initialShaping(), like).state, { ...silent, facts: ['我叫小雨'] }).state;
    const id = buildShapingIdentity(s);
    expect(id).toContain('语气=撒娇软糯');
    expect(id).toContain('- 我叫小雨');
    expect(id).not.toContain('作息');
  });

  it('bakes the shaped self into an ordinary prompt', () => {
    const s = applyJudgement(actThen(initialShaping(), like).state, { ...silent, facts: ['我叫小雨', '我在读设计'] }).state;
    expect(bakeShapingIntoPrompt('你是我的女朋友，女，23-27岁。', s)).toBe(
      '你是我的女朋友，女，23-27岁。\n\n【风格】语气=撒娇软糯\n\n【关于你自己】\n- 我叫小雨\n- 我在读设计',
    );
    expect(bakeShapingIntoPrompt('你是我的女朋友。', initialShaping())).toBe('你是我的女朋友。');
  });

  it('summarizes progress for the editor', () => {
    const s = actThen(initialShaping(), like).state;
    expect(shapingSummary(s)).toEqual({
      settled: ['语气=撒娇软糯'], probing: '黏人度=黏人', skipped: [], open: ['主动性', '亲密表达', '管束'],
    });
  });
});

describe('repair integration', () => {
  it('keeps the everyday-word heads out of the lint but normalizes their wrong brackets', () => {
    expect(lintMarkers('她的名字：小雨，兴趣：摄影，作息：早睡').suspects).toHaveLength(0);
    expect(lintMarkers('[定型 语气=撒娇软糯]').suspects).toHaveLength(0); // retired head, plain text now
    expect(normalizeActionMarkers('（兴趣:摄影）')).toBe('[兴趣:摄影]');
    expect(normalizeActionMarkers('【作息:08:00-09:00 晨跑】')).toBe('[作息:08:00-09:00 晨跑]');
    expect(normalizeActionMarkers('（自画像:我叫小雨）')).toBe('（自画像:我叫小雨）');
  });
});
