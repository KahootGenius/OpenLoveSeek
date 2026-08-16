import {
  appendRule, buildMasterPromptSection, clampDiscipline, extractMasterMarkers, hasHonorific,
} from '../lib/master';

describe('extractMasterMarkers', () => {
  it('parses command, countdown, and discipline delta; strips them', () => {
    const r = extractMasterMarkers('跪下\n[主人:命令:去接杯水]\n[主人:倒计时:15]\n[主人:调教:-5]');
    expect(r.command).toBe('去接杯水');
    expect(r.countdown).toBe(15);
    expect(r.disciplineDelta).toBe(-5);
    expect(r.clean).toBe('跪下');
  });
  it('parses self-authored honorific and rule', () => {
    const r = extractMasterMarkers('从今天起\n[主人:称呼:主人]\n[主人:立规:回复前先说是的主人]');
    expect(r.honorific).toBe('主人');
    expect(r.newRule).toBe('回复前先说是的主人');
    expect(r.clean).toBe('从今天起');
  });
  it('parses a 索求 demand', () => {
    expect(extractMasterMarkers('打出来\n[主人:索求:我错了主人]').demand).toBe('我错了主人');
  });
  it('clamps countdown and discipline, accepts fullwidth colon', () => {
    expect(extractMasterMarkers('[主人：倒计时：999]').countdown).toBe(120);
    expect(extractMasterMarkers('[主人:倒计时:1]').countdown).toBe(3);
    expect(extractMasterMarkers('[主人:调教:+50]').disciplineDelta).toBe(20);
  });
  it('strips an own-segment command without leaking or wasting a slot', () => {
    const r = extractMasterMarkers('乖---[主人:命令:说谢谢主人]---做得好');
    expect(r.command).toBe('说谢谢主人');
    expect(r.clean).toBe('乖\n---\n做得好');
  });
  it('returns nulls when absent', () => {
    expect(extractMasterMarkers('普通回复')).toEqual({
      clean: '普通回复', command: null, countdown: null, disciplineDelta: null,
      honorific: null, newRule: null, demand: null,
    });
  });
});

describe('appendRule', () => {
  it('appends, dedupes, and caps', () => {
    expect(appendRule(null, '规矩一')).toBe('规矩一');
    expect(appendRule('规矩一', '规矩二')).toBe('规矩一\n规矩二');
    expect(appendRule('规矩一', '规矩一')).toBe('规矩一');
    const many = Array.from({ length: 10 }, (_, i) => `r${i}`).join('\n');
    expect(appendRule(many, 'r10').split('\n')).toHaveLength(8);
  });
});

describe('clampDiscipline', () => {
  it('bounds and rounds to 0..100', () => {
    expect(clampDiscipline(-5)).toBe(0);
    expect(clampDiscipline(140)).toBe(100);
    expect(clampDiscipline(72.6)).toBe(73);
  });
});

describe('hasHonorific', () => {
  it('detects the honorific; empty means always satisfied', () => {
    expect(hasHonorific('主人早上好', '主人')).toBe(true);
    expect(hasHonorific('早上好', '主人')).toBe(false);
    expect(hasHonorific('随便说', '')).toBe(true);
    expect(hasHonorific('随便说', undefined)).toBe(true);
  });
});

describe('buildMasterPromptSection', () => {
  it('includes discipline, honorific, rules, and marker grammar', () => {
    const out = buildMasterPromptSection({ honorific: '主人', rules: '不许撒谎', discipline: 62 });
    expect(out).toContain('【主人模式】');
    expect(out).toContain('主人');
    expect(out).toContain('62/100');
    expect(out).toContain('不许撒谎');
    expect(out).toContain('[主人:命令:');
    expect(out).toContain('[主人:倒计时:');
  });
  it('prompts her to author her own honorific when none is set', () => {
    const out = buildMasterPromptSection({ discipline: 50 });
    expect(out).toContain('[主人:称呼:');
    expect(out).toContain('[主人:立规:');
  });
});
