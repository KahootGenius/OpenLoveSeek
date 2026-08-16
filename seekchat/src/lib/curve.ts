import {
  DRIFT_CAP, DRIFT_HALF_LIFE_DAYS, DRIFT_PRUNE_BELOW, GROWTH_RATE_LIMIT_MS, GROWTH_STEP_MAX,
} from './constants';

export type DayPart = '清晨' | '上午' | '下午' | '傍晚' | '深夜';
export const DAY_PARTS: DayPart[] = ['清晨', '上午', '下午', '傍晚', '深夜'];

// minutes since midnight; 深夜 wraps
const BOUNDS: Record<DayPart, [number, number]> = {
  清晨: [300, 540],
  上午: [540, 720],
  下午: [720, 1080],
  傍晚: [1080, 1380],
  深夜: [1380, 300],
};

export interface CurvePart { openness: number; tone?: string }
export type MoodCurve = Partial<Record<DayPart, CurvePart>>;
export interface DriftEntry { d: number; at: number }
export interface CurveDrift {
  parts: Partial<Record<DayPart, DriftEntry>>;
  log: { part: DayPart; step: number; at: number }[];
}

export function dayPartAt(now: Date): DayPart {
  const t = now.getHours() * 60 + now.getMinutes();
  for (const p of DAY_PARTS) {
    const [s, e] = BOUNDS[p];
    if (s <= e ? t >= s && t < e : t >= s || t < e) return p;
  }
  return '下午'; // unreachable; bounds cover 24h
}

export function parseDrift(json: string | null): CurveDrift {
  if (json) {
    try {
      const o = JSON.parse(json);
      if (o && typeof o === 'object' && o.parts) {
        return { parts: o.parts, log: Array.isArray(o.log) ? o.log : [] };
      }
    } catch {
      // fall through to empty drift
    }
  }
  return { parts: {}, log: [] };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function decayed(entry: DriftEntry | undefined, nowMs: number): number {
  if (!entry) return 0;
  const days = Math.max(0, (nowMs - entry.at) / 86400000);
  const d = entry.d * Math.pow(0.5, days / DRIFT_HALF_LIFE_DAYS);
  return Math.abs(d) < DRIFT_PRUNE_BELOW ? 0 : d;
}

export function effectiveOpenness(
  base: number,
  entry: DriftEntry | undefined,
  nowMs: number,
): number {
  return clamp(base + decayed(entry, nowMs), 0, 1);
}

export function applyGrowth(
  drift: CurveDrift,
  rawStep: number,
  part: DayPart,
  nowMs: number,
): { drift: CurveDrift; accepted: boolean } {
  if (Number.isNaN(rawStep)) return { drift, accepted: false };
  const prev = drift.parts[part];
  if (prev && nowMs - prev.at < GROWTH_RATE_LIMIT_MS) return { drift, accepted: false };
  const step = clamp(rawStep, -GROWTH_STEP_MAX, GROWTH_STEP_MAX);
  const newD = clamp(decayed(prev, nowMs) + step, -DRIFT_CAP, DRIFT_CAP);
  return {
    accepted: true,
    drift: {
      parts: { ...drift.parts, [part]: { d: newD, at: nowMs } },
      log: [...drift.log, { part, step, at: nowMs }].slice(-5),
    },
  };
}

function gloss(openness: number): string {
  if (openness < 0.25) return '干脆简短，不欲深谈';
  if (openness < 0.5) return '正常寒暄，聊浅层话题';
  if (openness < 0.75) return '放松，可聊感受与心事';
  return '卸下防备，愿聊更深更私人的话题';
}

/** One state-block line for the active day-part; null when unconfigured. */
export function buildCurveLine(
  curve: MoodCurve,
  drift: CurveDrift,
  now: Date,
): string | null {
  const part = dayPartAt(now);
  const cfg = curve[part];
  if (!cfg) return null;
  const entry = drift.parts[part];
  const d = decayed(entry, now.getTime());
  const eff = effectiveOpenness(cfg.openness, entry, now.getTime());
  let line = `时段倾向（${part}）：${gloss(eff)}`;
  if (cfg.tone?.trim()) line += `（${cfg.tone.trim()}）`;
  if (d >= 0.1) line += '（最近你在这个时段比以往更敞开一些，是这段相处慢慢带来的变化）';
  else if (d <= -0.1) line += '（最近你在这个时段比以往更收敛一些）';
  return line;
}
