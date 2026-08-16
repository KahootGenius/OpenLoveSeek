import type { ScheduleEntry } from './life';
import type { MoodCurve } from './curve';
import { renderPrompt } from './prompts';

export interface ProConfig {
  schedule?: ScheduleEntry[];
  interests?: string;
  boundaries?: string;
  goals?: string;
  moodBaseline?: string;
  moodCurve?: MoodCurve;
  curveGrowth?: boolean; // default true when moodCurve present
  patText?: string; // user→character pat content (avatar double-tap)
  patByChar?: string; // character→user pat default wording (user-edited, QQ-style)
  patEmoji?: string; // pat line prefix when the user pats, default 👋
  patEmojiChar?: string; // pat line prefix when the character pats, falls back to patEmoji
  autoReach?: boolean; // scheduled proactive outreach master switch
  autoReachConsent?: boolean; // 5s-delayed money-consent, stored once given
  reachRate?: '健谈' | '中等' | '冷淡' | number; // number = 次/天
  yandere?: boolean; // 病娇 mode: model may vibrate / raise a biometric lock overlay
  yandereConsent?: boolean; // 5s-delayed consent, stored once given
  lockCooldownMin?: number; // biometric-lock cooldown in minutes (0 = no limit); default 30
  watchApps?: boolean; // 屏幕窥视: react to the user's foreground app (real builds, usage access)
  watchConsent?: boolean; // 5s-delayed consent, stored once given
  watchCooldownMin?: number; // minutes between reactions; default 30
  transfers?: boolean; // 转账: enable the virtual wallet + her ability to send money
  initBalance?: number; // her starting wallet balance (seeds conversations.charBalance)
  master?: boolean; // 主人 mode: dominance layer (commands, countdown, discipline)
  masterConsent?: boolean;
  exampleGood?: string; // 示例对话: how she SHOULD sound (few-shot anchor)
  exampleBad?: string; // …and how she must NEVER sound (negative anchor)
  // honorific & rules are NOT here — the character authors them per-conversation
  // (conversations.masterHonorific / masterRules), read-only to the user.
}

/**
 * True when the config carries character-simulation content that justifies
 * injecting the realism layers. patText/autoReach flags alone do not.
 */
export function hasRealismConfig(cfg: ProConfig | null): boolean {
  return !!(
    cfg &&
    ((cfg.schedule && cfg.schedule.length > 0) ||
      cfg.interests?.trim() ||
      cfg.boundaries?.trim() ||
      cfg.goals?.trim() ||
      cfg.moodBaseline?.trim() ||
      cfg.moodCurve)
  );
}

export function parseProConfig(json: string | null): ProConfig | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json);
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as ProConfig) : null;
  } catch {
    return null;
  }
}

const TEXTURE_RULES = `【行为质感】
- 若当前处于睡眠时段被吵醒，回复应简短、迷糊，甚至有点起床气。
- 像真人发消息：一次1-3条，条与条之间用---分隔，避免长篇大论。
- 雷区与底线是硬约束：被冒犯时以你的性格方式拒绝、记住这件事。`;

export function buildProSections(cfg: ProConfig): string {
  const parts: string[] = [];
  if (cfg.schedule && cfg.schedule.length > 0) {
    parts.push(
      '【作息表】\n' + cfg.schedule.map((e) => `${e.start}-${e.end} ${e.activity}`).join('\n'),
    );
  }
  if (cfg.interests?.trim()) parts.push('【兴趣爱好】\n' + cfg.interests.trim());
  if (cfg.boundaries?.trim()) parts.push('【雷区与底线】\n' + cfg.boundaries.trim());
  if (cfg.goals?.trim()) parts.push('【当前目标】\n' + cfg.goals.trim());
  parts.push(TEXTURE_RULES);
  return parts.join('\n\n');
}

/** Pure. 示例对话: few-shot voice anchors — the good example sets the register,
 *  the bad example marks the forbidden one. Empty config renders nothing. */
export function buildExampleSection(
  cfg: Pick<ProConfig, 'exampleGood' | 'exampleBad'>,
): string {
  const good = cfg.exampleGood?.trim();
  const bad = cfg.exampleBad?.trim();
  if (!good && !bad) return '';
  return renderPrompt('persona.examples', {
    good: good ? `这是符合你的说话方式的示例：\n${good}\n` : '',
    bad: bad ? `这是你绝不会有的说话方式（不要模仿，不要靠近这种语气）：\n${bad}\n` : '',
  });
}

const two = (n: number) => String(n).padStart(2, '0');

export function fmtTimestamp(ms: number): string {
  const d = new Date(ms);
  return `[${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}]`;
}

/** WeChat-style divider label: HH:mm today, 昨天 HH:mm, else M月D日 HH:mm. */
export function fmtDivider(ms: number, nowMs: number): string {
  const d = new Date(ms);
  const n = new Date(nowMs);
  const hm = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const sameDay =
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate();
  if (sameDay) return hm;
  const y = new Date(nowMs - 86400000);
  const yesterday =
    d.getFullYear() === y.getFullYear() &&
    d.getMonth() === y.getMonth() &&
    d.getDate() === y.getDate();
  if (yesterday) return `昨天 ${hm}`;
  if (d.getFullYear() === n.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

export function fmtGap(ms: number): string {
  const min = Math.floor(ms / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min}分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}小时前`;
  return `${Math.floor(h / 24)}天前`;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function buildStateBlock(args: {
  now: Date;
  lastMessageAt: number | null;
  activity: string | null;
  mood: { label: string; intensity: number };
  thought: string | null;
  lastReply?: string | null;
}): string {
  const d = args.now;
  const lines = [
    `现在时间：${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}（${WEEKDAYS[d.getDay()]}）`,
  ];
  if (args.lastMessageAt != null) {
    lines.push(`距上次对话：${fmtGap(d.getTime() - args.lastMessageAt)}`);
  }
  if (args.activity) lines.push(`你当前的日程活动：${args.activity}`);
  lines.push(
    args.mood.intensity > 0
      ? `你当前的心情：${args.mood.label}（强度${args.mood.intensity.toFixed(1)}）`
      : `你当前的心情：${args.mood.label}`,
  );
  if (args.thought?.trim()) lines.push(`你刚才心里在想：${args.thought.trim()}`);
  // Her own last utterance, made salient so she stays consistent with it
  // (models otherwise drift from what they just said).
  if (args.lastReply?.trim()) {
    const r = args.lastReply.trim().replace(/\s+/g, ' ').slice(0, 80);
    lines.push(`你上一条对他说的是：${r}`);
  }
  return '【当前状态】\n' + lines.join('\n');
}

// Prompt TEXT lives in the registry (提示词工作室, prompts.ts) — resolved at
// build time so dev-mode overrides apply to the very next request.
export function buildRealismRules(
  lifeEnabled: boolean,
  growthEnabled = false,
  patTemplate?: string,
): string {
  let out = renderPrompt('realism.grounding') + '\n\n' + renderPrompt('realism.tag');
  if (growthEnabled) out += '\n\n' + renderPrompt('realism.growth');
  if (patTemplate) {
    out += '\n\n' + renderPrompt('realism.pat', { patTemplate });
  }
  if (lifeEnabled) out += '\n\n' + renderPrompt('realism.life');
  return out;
}
