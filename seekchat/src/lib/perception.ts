// 感知 (v3.0 真实感): ONE cheap pre-turn call that reads the moment before she
// acts. It replaces the 动态想象力 classifier (register + length) and the
// 立即开始 observer (attitude / self-facts / name), and adds what a partner
// would notice: the user's mood, facts worth remembering (记忆库 adds — the
// hidden [记忆:] write marker becomes a fallback), things to follow up on in
// a few days, a slow 亲密度 nudge, and the user's birthday. Pure: prompt in,
// parsed verdict out; engine.ts applies it.
import type { MemoryEntry } from './types';
import { renderPrompt } from './prompts';
import { normalizeBirthday } from './calendar';
import type { Attitude, Judgement, ShapingState } from './shaping';
import { MAX_PORTRAIT_TEXT, PORTRAIT_ADDS_PER_TURN } from './shaping';
import { MAX_MEMORY_TEXT, MEMORY_ADDS_PER_REPLY } from './memory';
import type { LengthChoice, TempChoice } from './temp';

export const CLOSENESS_START = 40;
export const MAX_FOLLOWUPS_PER_TURN = 2;
export const MAX_FOLLOWUP_TEXT = 40;
export const MAX_FOLLOWUP_DAYS = 60;
export const PERCEPTION_TEXT_BUDGET = 600;

export interface FollowUp {
  text: string;
  days: number; // from today
}

export interface Perception {
  register: TempChoice | null;
  length: LengthChoice | null;
  userMood: string | null;
  facts: string[]; // about the USER → memory adds
  followUps: FollowUp[];
  closeness: -1 | 0 | 1;
  birthday: string | null; // 'MM-DD'
  /** 立即开始 only */
  attitude: Attitude | null;
  selfFacts: string[];
  name: string | null;
}

export interface PerceptionInput {
  herLast: string; // her whole last turn, tags stripped; '' if she hasn't spoken
  userReply: string; // the user's new burst; '' on a trigger turn
  memories: Pick<MemoryEntry, 'text'>[];
  personaName: string;
  now: Date;
  shaping: ShapingState | null;
}

const REGISTERS: readonly TempChoice[] = ['严谨', '平衡', '奔放'];
const LENGTHS: readonly LengthChoice[] = ['短', '中', '长'];
const ATTITUDES: readonly Attitude[] = ['喜欢', '不喜欢', '中立'];

const excerpt = (text: string, budget = PERCEPTION_TEXT_BUDGET): string => {
  const t = text.trim();
  if (t.length <= budget) return t;
  const half = Math.floor((budget - 10) / 2);
  return `${t.slice(0, half)}\n…（中间省略）…\n${t.slice(-half)}`;
};

/** Nothing to perceive until someone has said something. */
export const shouldPerceive = (input: Pick<PerceptionInput, 'herLast' | 'userReply'>): boolean =>
  input.userReply.trim().length > 0 || input.herLast.trim().length > 0;

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function buildPerceptionPrompt(input: PerceptionInput): string {
  const d = input.now;
  const known = input.memories.length
    ? input.memories.map((m, i) => `${i + 1}. ${m.text}`).join('\n')
    : '（还没有记录）';
  let shapingSection = '';
  let shapingFields = '';
  let shapingJson = '';
  if (input.shaping) {
    const acted = input.shaping.lastActed;
    const probe = acted
      ? `她正在按「${acted.dim}=${acted.variant}」的风格试探对方。`
      : '她的风格已定型，attitude 填 null。';
    const selfKnown = input.shaping.portrait.length
      ? input.shaping.portrait.map((p, i) => `${i + 1}. ${p}`).join('\n')
      : '（还没有记录）';
    shapingSection =
      `【塑造中】${probe}\n已记录的关于她自己的事实：\n${selfKnown}`;
    shapingFields =
      `- attitude：对方对她这种风格的态度——喜欢（接得热情、顺着说、笑了、也撒娇回去）、不喜欢（敷衍、拧着、回避、明显不适）、中立（看不出来）；只看对方的反应。\n` +
      `- selfFacts：她上一条里说出的关于她自己的新事实（年龄、职业、在做什么、习惯、喜好），每条一句话、不超过${MAX_PORTRAIT_TEXT}字，最多${PORTRAIT_ADDS_PER_TURN}条，已记录的不要重复；没有给 []。\n` +
      (input.shaping.named
        ? '- name：她已经有名字了，填 null。'
        : '- name：如果她在上一条里给自己起了名字，写出来，否则 null。');
    shapingJson = ',"attitude":null,"selfFacts":[],"name":null';
  }
  return renderPrompt('perception.observe', {
    herName: input.personaName,
    herLast: input.herLast.trim() ? excerpt(input.herLast) : '（她还没说过话）',
    userReply: input.userReply.trim() ? excerpt(input.userReply) : '（对方还没有回复——register/length/attitude 都填 null）',
    today: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}（${WEEKDAYS[d.getDay()]}）`,
    known,
    maxText: MAX_MEMORY_TEXT,
    maxAdds: MEMORY_ADDS_PER_REPLY,
    maxFollow: MAX_FOLLOWUPS_PER_TURN,
    shapingSection,
    shapingFields,
    shapingJson,
  });
}

export const emptyPerception = (): Perception => ({
  register: null, length: null, userMood: null, facts: [], followUps: [], closeness: 0,
  birthday: null, attitude: null, selfFacts: [], name: null,
});

const pickStrings = (
  v: unknown, max: number, maxLen: number, known: string[],
): string[] => {
  const out: string[] = [];
  if (!Array.isArray(v)) return out;
  for (const f of v) {
    if (typeof f !== 'string') continue;
    const t = f.trim().slice(0, maxLen);
    if (!t || out.includes(t) || known.includes(t)) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
};

/** Tolerant read of the observer's answer: the first {…} in the text; every
 *  field degrades independently to "no verdict". On a trigger turn (no user
 *  reply) register/length/attitude are discarded outright. */
export function parsePerception(
  raw: string,
  opts: { userReplied: boolean; knownMemories: string[]; shaping: ShapingState | null },
): Perception {
  const out = emptyPerception();
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return out;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return out;
  }
  if (!j || typeof j !== 'object') return out;
  if (opts.userReplied) {
    if (typeof j.register === 'string' && REGISTERS.includes(j.register.trim() as TempChoice)) {
      out.register = j.register.trim() as TempChoice;
    }
    if (typeof j.length === 'string' && LENGTHS.includes(j.length.trim() as LengthChoice)) {
      out.length = j.length.trim() as LengthChoice;
    }
  }
  if (typeof j.userMood === 'string' && j.userMood.trim()) out.userMood = j.userMood.trim().slice(0, 6);
  out.facts = pickStrings(j.facts, MEMORY_ADDS_PER_REPLY, MAX_MEMORY_TEXT, opts.knownMemories);
  if (Array.isArray(j.followUps)) {
    for (const f of j.followUps as unknown[]) {
      if (!f || typeof f !== 'object') continue;
      const { text, days } = f as { text?: unknown; days?: unknown };
      const t = typeof text === 'string' ? text.trim().slice(0, MAX_FOLLOWUP_TEXT) : '';
      const n = typeof days === 'number' ? Math.round(days) : typeof days === 'string' ? parseInt(days, 10) : NaN;
      if (!t || Number.isNaN(n) || n < 1 || n > MAX_FOLLOWUP_DAYS) continue;
      if (out.followUps.some((x) => x.text === t)) continue;
      out.followUps.push({ text: t, days: n });
      if (out.followUps.length >= MAX_FOLLOWUPS_PER_TURN) break;
    }
  }
  if (j.closeness === 1 || j.closeness === -1 || j.closeness === 0) out.closeness = j.closeness;
  else if (typeof j.closeness === 'string') {
    const c = parseInt(j.closeness, 10);
    if (c === 1 || c === -1) out.closeness = c;
  }
  if (typeof j.birthday === 'string') out.birthday = normalizeBirthday(j.birthday);
  if (opts.shaping) {
    if (opts.userReplied && typeof j.attitude === 'string' && ATTITUDES.includes(j.attitude.trim() as Attitude)) {
      out.attitude = j.attitude.trim() as Attitude;
    }
    out.selfFacts = pickStrings(j.selfFacts, PORTRAIT_ADDS_PER_TURN, MAX_PORTRAIT_TEXT, opts.shaping.portrait);
    if (!opts.shaping.named && typeof j.name === 'string') {
      const n = j.name.trim();
      if (n.length >= 1 && n.length <= 12 && !/[\[\]【】\n]/.test(n)) out.name = n;
    }
  }
  return out;
}

/** The shaping half, in the shape shaping.applyJudgement expects. */
export const toJudgement = (p: Perception): Judgement => ({
  attitude: p.attitude, facts: p.selfFacts, name: p.name,
});

export const clampCloseness = (n: number): number => Math.min(100, Math.max(0, Math.round(n)));

/** Due at 10:00 local on the target day. */
export function followUpAtFor(now: Date, days: number): number {
  const n = Math.min(MAX_FOLLOWUP_DAYS, Math.max(1, Math.round(days)));
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, 10, 0, 0, 0).getTime();
}

/** One line of meaning for the state block — the number alone tells her nothing. */
export function closenessLine(closeness: number): string {
  const c = clampCloseness(closeness);
  const tier =
    c < 25 ? '还在互相试探，别太黏、别交浅言深'
    : c < 50 ? '熟了一些，可以偶尔主动、分享一点私事'
    : c < 75 ? '很亲近了，可以撒娇、依赖、说心里话'
    : '像老夫老妻一样自在，可以调侃、可以沉默、不用讨好';
  return `你们的亲密度：${c}/100（${tier}）`;
}
