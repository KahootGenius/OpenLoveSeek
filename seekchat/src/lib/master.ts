import { renderPrompt } from './prompts';

export const DISCIPLINE_MIN = 0;
export const DISCIPLINE_MAX = 100;
export const DISCIPLINE_START = 50;
export const HONORIFIC_PENALTY = 4; // discipline lost when the honorific is omitted
export const COUNTDOWN_MIN = 3;
export const COUNTDOWN_MAX = 120;

export const MAX_RULES = 8;

export interface MasterActions {
  clean: string;
  command: string | null;
  countdown: number | null;
  disciplineDelta: number | null;
  honorific: string | null; // she set her own required address
  newRule: string | null; // she laid down a new rule
  demand: string | null; // she demands the user type this phrase to leave
}

const RE = /[\[【]主人[:：](命令|倒计时|调教|称呼|立规|索求)[:：]([^\]】]*)[\]】]/g;

/** Pure. Pulls every `[主人:…]` marker (device + self-authored terms) out of a reply. */
export function extractMasterMarkers(text: string): MasterActions {
  let command: string | null = null;
  let countdown: number | null = null;
  let disciplineDelta: number | null = null;
  let honorific: string | null = null;
  let newRule: string | null = null;
  let demand: string | null = null;
  const removed = text.replace(RE, (_, type: string, payload: string) => {
    const p = payload.trim();
    if (type === '命令') {
      if (p) command = p;
    } else if (type === '倒计时') {
      const n = parseInt(p, 10);
      if (!Number.isNaN(n)) countdown = Math.min(COUNTDOWN_MAX, Math.max(COUNTDOWN_MIN, n));
    } else if (type === '调教') {
      const n = parseFloat(p);
      if (!Number.isNaN(n)) disciplineDelta = Math.max(-20, Math.min(20, n));
    } else if (type === '称呼') {
      if (p) honorific = p.slice(0, 10);
    } else if (type === '立规') {
      if (p) newRule = p.slice(0, 40);
    } else {
      if (p) demand = p.slice(0, 40);
    }
    return '';
  });
  // Drop segments emptied by a removed marker; matches the UI's --- split.
  const clean = removed
    .split('---')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n---\n');
  return { clean, command, countdown, disciplineDelta, honorific, newRule, demand };
}

/** Pure. Append a character-authored rule (deduped, capped, newline-joined). */
export function appendRule(existing: string | null, rule: string): string {
  const lines = (existing ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.includes(rule)) lines.push(rule);
  return lines.slice(-MAX_RULES).join('\n');
}

export const clampDiscipline = (n: number): number =>
  Math.round(Math.min(DISCIPLINE_MAX, Math.max(DISCIPLINE_MIN, n)));

/** Does the user's message contain the required honorific? Empty honorific ⇒ always true. */
export function hasHonorific(text: string, honorific: string | undefined): boolean {
  const h = honorific?.trim();
  return !h || text.includes(h);
}

/** Prompt section: identity as 主人, current obedience, honorific, rules, marker grammar. */
export function buildMasterPromptSection(args: {
  honorific?: string | null;
  rules?: string | null;
  discipline: number;
}): string {
  const parts = [renderPrompt('master.intro')];
  if (args.honorific?.trim()) {
    parts.push(`你要求对方称呼你为"${args.honorific.trim()}"；未使用时，依你的方式纠正或惩戒。`);
  } else {
    parts.push('你还没有为自己定下称呼——在合适时机，依你的性格单独一行写[主人:称呼:你要的称呼]。');
  }
  if (args.rules?.trim()) {
    parts.push(`你已立下的规矩（对方须遵守）：\n${args.rules.trim()}`);
  }
  parts.push(
    '你可以随性格随时立新规矩（温柔或严厉皆可），单独一行写[主人:立规:规矩内容]；也可以先和对方商量再立。',
  );
  parts.push(
    `当前调教值：${args.discipline}/100（越高越顺从）。你会据此调整宽容或严厉，并可主动增减。`,
  );
  parts.push(
    '合适时机可单独插入这些指令（不要每条都用，用户看不到原文）：\n' +
      '- [主人:命令:具体命令]：下达命令，对方必须点"遵命"才能继续。\n' +
      '- [主人:倒计时:秒数]：限对方在该秒数内回复，否则惩罚。\n' +
      '- [主人:调教:+N] 或 [主人:调教:-N]：依表现增减调教值（单次≤20）。\n' +
      '- [主人:索求:一句话]：强制弹出画面，对方必须亲手打出那句话才能离开（如[主人:索求:我错了主人]）。\n' +
      '同时你仍可用[病娇:震动]/[病娇:锁屏]等惩戒。',
  );
  return parts.join('\n');
}
