import { buildPlaceLine, isFreshFix } from '../lib/geo';

const fix = (over = {}) => ({ lat: 31.23, lng: 121.47, city: '上海', ageMs: 60000, ...over });

describe('isFreshFix', () => {
  it('rejects null and stale fixes', () => {
    expect(isFreshFix(null)).toBe(false);
    expect(isFreshFix(fix({ ageMs: 60000 }))).toBe(true);
    expect(isFreshFix(fix({ ageMs: 7 * 3600000 }))).toBe(false);
  });
});

describe('buildPlaceLine', () => {
  it('prefers a manual place over the geocoded city', () => {
    const line = buildPlaceLine({ tz: 'Asia/Shanghai', fix: fix(), manualPlace: '北京' });
    expect(line).toContain('所在地：北京');
    expect(line).toContain('时区：Asia/Shanghai');
    expect(line).toContain('当地时间');
  });
  it('uses the geocoded city when no manual place', () => {
    expect(buildPlaceLine({ tz: 'Asia/Shanghai', fix: fix() })).toContain('所在地：上海');
  });
  it('emits timezone-only when the city is empty — never raw coordinates', () => {
    const line = buildPlaceLine({ tz: 'Asia/Shanghai', fix: fix({ city: '' }) });
    expect(line).toContain('时区：Asia/Shanghai');
    expect(line).not.toContain('所在');
    expect(line).not.toContain('31.23'); // coords must never leak under city-level consent
  });
  it('still emits timezone alone when there is no location', () => {
    const line = buildPlaceLine({ tz: 'Asia/Shanghai', fix: null });
    expect(line).toContain('时区：Asia/Shanghai');
    expect(line).not.toContain('所在');
  });
  it('is null when there is nothing at all', () => {
    expect(buildPlaceLine({ tz: '', fix: null })).toBeNull();
  });
});
