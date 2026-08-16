import {
  applyGrowth, buildCurveLine, dayPartAt, DayPart, effectiveOpenness, parseDrift,
} from '../lib/curve';

const at = (h: number, m = 0) => new Date(2026, 6, 14, h, m);
const DAY = 86400000;

describe('dayPartAt', () => {
  it('maps hours to fixed day-parts, wrapping midnight', () => {
    expect(dayPartAt(at(6))).toBe('清晨');
    expect(dayPartAt(at(10))).toBe('上午');
    expect(dayPartAt(at(15))).toBe('下午');
    expect(dayPartAt(at(20))).toBe('傍晚');
    expect(dayPartAt(at(23, 30))).toBe('深夜');
    expect(dayPartAt(at(2))).toBe('深夜');
  });
});

describe('drift lifecycle', () => {
  it('applies, rate-limits, caps, and decays growth', () => {
    const t0 = at(23, 30).getTime();
    let drift = parseDrift(null);
    let r = applyGrowth(drift, 0.1, '深夜', t0);
    expect(r.accepted).toBe(true);
    drift = r.drift;
    expect(drift.parts['深夜']!.d).toBeCloseTo(0.1, 5);

    // same day-part within 24h → rejected
    r = applyGrowth(drift, 0.1, '深夜', t0 + 3600000);
    expect(r.accepted).toBe(false);

    // oversized step clamps to 0.1
    r = applyGrowth(parseDrift(null), 5, '深夜', t0);
    expect(r.drift.parts['深夜']!.d).toBeCloseTo(0.1, 5);

    // cumulative cap at ±0.3 (reinforced daily)
    let d2 = parseDrift(null);
    let t = t0;
    for (let i = 0; i < 6; i++) {
      const rr = applyGrowth(d2, 0.1, '深夜', t);
      if (rr.accepted) d2 = rr.drift;
      t += DAY + 1;
    }
    expect(d2.parts['深夜']!.d).toBeLessThanOrEqual(0.3);

    // decay: half after 14 days
    expect(effectiveOpenness(0.5, { d: 0.2, at: t0 }, t0 + 14 * DAY)).toBeCloseTo(0.6, 2);
    // prune: tiny decayed drift treated as zero
    expect(effectiveOpenness(0.5, { d: 0.04, at: t0 }, t0 + 60 * DAY)).toBe(0.5);
  });

  it('keeps a bounded log', () => {
    let drift = parseDrift(null);
    let t = at(9).getTime();
    const parts: DayPart[] = ['清晨', '上午', '下午', '傍晚', '深夜', '清晨', '上午'];
    for (const part of parts) {
      const r = applyGrowth(drift, 0.05, part, t);
      if (r.accepted) drift = r.drift;
      t += DAY + 1;
    }
    expect(drift.log.length).toBeLessThanOrEqual(5);
  });
});

describe('buildCurveLine', () => {
  const curve = { 深夜: { openness: 0.8, tone: '防备放下' }, 清晨: { openness: 0.2 } };
  it('renders the active part with gloss and tone', () => {
    const line = buildCurveLine(curve, parseDrift(null), at(23, 40));
    expect(line).toContain('时段倾向（深夜）');
    expect(line).toContain('卸下防备');
    expect(line).toContain('防备放下');
  });
  it('renders low-openness gloss without drift note', () => {
    const line = buildCurveLine(curve, parseDrift(null), at(6));
    expect(line).toContain('干脆简短');
    expect(line).not.toContain('最近你');
  });
  it('acknowledges positive drift', () => {
    const drift = parseDrift(JSON.stringify({
      parts: { 深夜: { d: 0.2, at: at(23).getTime() } }, log: [],
    }));
    const line = buildCurveLine(curve, drift, at(23, 40));
    expect(line).toContain('更敞开');
  });
  it('returns null when the active part is not configured', () => {
    expect(buildCurveLine({ 深夜: { openness: 0.8 } }, parseDrift(null), at(10))).toBeNull();
  });
});
