import {
  buildUsageLine, buildUsageSection, fmtDuration, shouldCheckUsage,
} from '../lib/usage';
import * as usageModule from '../lib/usage';

describe('fmtDuration', () => {
  it('formats minutes and hours', () => {
    expect(fmtDuration(0)).toBe('不到1分钟');
    expect(fmtDuration(45)).toBe('45分钟');
    expect(fmtDuration(60)).toBe('1小时');
    expect(fmtDuration(133)).toBe('2小时13分');
  });
});

describe('buildUsageLine', () => {
  it('summarizes total + notable apps, dropping noise', () => {
    const line = buildUsageLine({
      totalMinutes: 195,
      apps: [
        { label: '抖音', minutes: 133 },
        { label: '微信', minutes: 48 },
        { label: '某后台', minutes: 1 },
      ],
    });
    expect(line).toContain('今天总屏幕使用约3小时15分');
    expect(line).toContain('抖音 2小时13分');
    expect(line).toContain('微信 48分钟');
    expect(line).not.toContain('某后台');
  });
  it('returns null for empty or trivial usage', () => {
    expect(buildUsageLine(null)).toBeNull();
    expect(buildUsageLine({ totalMinutes: 1, apps: [] })).toBeNull();
  });
  it('handles usage with no notable apps', () => {
    const line = buildUsageLine({ totalMinutes: 40, apps: [{ label: 'x', minutes: 1 }] });
    expect(line).toBe('今天总屏幕使用约40分钟。');
  });
});

describe('buildUsageSection', () => {
  it('wraps the line with concealment framing', () => {
    const s = buildUsageSection({ totalMinutes: 40, apps: [{ label: '微信', minutes: 40 }] });
    expect(s).toContain('【今日屏幕使用】');
    expect(s).toContain('绝不提及');
    expect(s).toContain('微信');
  });
  it('is null when there is nothing to say', () => {
    expect(buildUsageSection(null)).toBeNull();
  });
  it('separates privacy instructions from usage evidence', () => {
    const usage = { totalMinutes: 40, apps: [{ label: '微信', minutes: 40 }] };
    const api = usageModule as typeof usageModule & {
      buildUsageInstructions?: () => string;
      buildUsageEvidence?: (value: typeof usage) => string | null;
    };

    expect(api.buildUsageInstructions).toBeDefined();
    expect(api.buildUsageEvidence).toBeDefined();
    expect(api.buildUsageInstructions!()).toContain('绝不提及"系统""权限"');
    const evidence = api.buildUsageEvidence!(usage);
    expect(evidence).toMatch(/^【屏幕使用数据】\n/);
    expect(evidence).toContain('微信');
    expect(evidence).not.toContain('绝不提及');

    const combined = buildUsageSection(usage)!;
    expect(combined.indexOf('【今日屏幕使用】')).toBeLessThan(
      combined.indexOf('【屏幕使用数据】'),
    );
  });
});

describe('shouldCheckUsage', () => {
  const now = 10_000_000;
  it('only peeks in check mode, past the gap', () => {
    expect(shouldCheckUsage('off', 0, now)).toBe(false);
    expect(shouldCheckUsage('always', 0, now)).toBe(false);
    expect(shouldCheckUsage('check', now - 30 * 60000, now)).toBe(false);
    expect(shouldCheckUsage('check', now - 120 * 60000, now)).toBe(true);
  });
});
