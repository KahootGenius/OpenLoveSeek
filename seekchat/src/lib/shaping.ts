// 立即开始 (v2.9): a persona born from the card's one line ("你是我的女朋友，
// 女，23-27岁。") that the character shapes herself during the chat. Acting
// and judging are SEPARATE calls (the product owner's call, 2026-09-13):
//   The main turn only ACTS: the guide names the one style variant she is
//     trying right now (a decision tree of dimensions, code-scheduled, rotated
//     every PROBE_TURNS turns) and who she has become (her 自画像).
//   The pre-turn 感知 call (perception.ts, v3.0 — was a dedicated 观察员 call)
//     JUDGES: given her last reply and the user's new reply, it grades the
//     user's attitude to the variant she acted (喜欢 → settle, 不喜欢 → prune,
//     中立 → keep trying) and mines her last reply for new self-facts and a
//     self-chosen name. The tree is updated BEFORE she acts this turn. No
//     hidden-marker grammar for any of that.
//   Two explicit markers remain, because a schedule is a deliberate
//     commitment prose extraction gets wrong: [作息:HH:MM-HH:MM 活动] and
//     [兴趣:X], both writing into the persona's proConfig so the realism
//     layers (schedule, mood, life) switch on as she defines them.
// Pure module: state in, state out. Storage is personas.shaping (schema v19,
// db.ts); wiring is engine.ts; the copy lives in the prompt registry.
import type { ScheduleEntry } from './life';
import type { ProConfig } from './pro';
import { renderPrompt } from './prompts';

export const PROBE_TURNS = 3; // turns she acts out one variant before the tree rotates
export const MAX_PORTRAIT = 40;
export const MAX_PORTRAIT_TEXT = 60;
export const PORTRAIT_ADDS_PER_TURN = 2;
export const MAX_NAME = 12;
export const MAX_SCHEDULE = 12;
export const MAX_INTERESTS = 10;
export const MAX_INTEREST_TEXT = 20;

// ---- 基本信息 (the card) --------------------------------------------------------
export interface QuickBasics {
  identity: string; // 女朋友 / 男朋友 / anything the user typed
  name: string | null; // null → she names herself in the chat
  gender: string; // 女 / 男 / other
  age: string; // '18-22' | '23-27' | '28-35' | '36+' | free text like '25'
}
export const QUICK_IDENTITIES = ['女朋友', '男朋友'] as const;
export const QUICK_GENDERS = ['女', '男'] as const;
export const QUICK_AGES = ['18-22', '23-27', '28-35', '36+'] as const;
export const DEFAULT_BASICS: QuickBasics = { identity: '女朋友', name: null, gender: '女', age: '23-27' };

const ageText = (age: string): string =>
  /^\d+$/.test(age) ? `${age}岁左右` : age.endsWith('+') ? `${age.slice(0, -1)}岁以上` : `${age}岁`;

/** The one-line persona the mode starts from — visible/editable in the editor. */
export function buildQuickPrompt(b: QuickBasics): string {
  const parts = [`你是我的${b.identity.trim() || '女朋友'}`, b.gender.trim() || '女', ageText(b.age.trim() || '23-27')];
  if (b.name?.trim()) parts.push(`名叫${b.name.trim()}`);
  return `${parts.join('，')}。`;
}

/** Placeholder persona name until she picks one (or the user gave one). */
export const quickPersonaName = (b: QuickBasics): string =>
  b.name?.trim() || b.identity.trim() || '女朋友';

// ---- the style tree ---------------------------------------------------------------
export interface StyleVariant {
  label: string;
  how: string; // one line of acting guidance for the probe
}
export interface StyleDim {
  key: string;
  variants: StyleVariant[];
}

/** Probe order = tree order: the most visible dimension first. */
export const STYLE_TREE: StyleDim[] = [
  {
    key: '语气',
    variants: [
      { label: '撒娇软糯', how: '语气软、爱撒娇，多用"嘛""呀""哼"这类尾音' },
      { label: '活泼逗比', how: '爱开玩笑、接梗、语气跳脱，偶尔损对方两句' },
      { label: '冷静淡然', how: '话不多、语气平，偶尔一句温柔，不腻人' },
    ],
  },
  {
    key: '黏人度',
    variants: [
      { label: '黏人', how: '主动说想对方、问对方在干嘛，舍不得结束话题' },
      { label: '独立', how: '有自己的事在忙、不追着聊，话说完就去做自己的事' },
    ],
  },
  {
    key: '主动性',
    variants: [
      { label: '主动', how: '主动挑起话题、提要求、安排事情' },
      { label: '顺着', how: '跟着对方的节奏走，对方说什么接什么' },
    ],
  },
  {
    key: '亲密表达',
    variants: [
      { label: '直白', how: '直接说想你、喜欢你，不绕弯' },
      { label: '含蓄', how: '不直说，用关心和小动作表达' },
    ],
  },
  {
    key: '管束',
    variants: [
      { label: '会管你', how: '催对方吃饭睡觉，念叨作息和坏习惯' },
      { label: '不管', how: '尊重对方的安排，不催不念' },
    ],
  },
];

export interface StylePick {
  dim: string;
  variant: string;
}
export interface Probe extends StylePick {
  turns: number; // turns she has acted out THIS variant
  tried: string[]; // variants probed this cycle (cap: all tried, no verdict → skip)
}

export interface ShapingState {
  v: 1;
  settled: Record<string, string>;
  excluded: Record<string, string[]>;
  skipped: string[];
  probe: Probe | null;
  /** The variant her LAST reply acted out — what the observer grades. The
   *  probe may already have rotated since, so attribution needs this. */
  lastActed: StylePick | null;
  portrait: string[];
  turns: number; // completed assistant turns in this mode
  named: boolean; // the user gave a name, or she picked one — stops the 起名 nudge
}

const dimOf = (key: string): StyleDim | undefined => STYLE_TREE.find((d) => d.key === key);
const howOf = (p: StylePick): string =>
  dimOf(p.dim)?.variants.find((v) => v.label === p.variant)?.how ?? '';

const candidates = (state: ShapingState, dim: StyleDim): string[] =>
  dim.variants.map((v) => v.label).filter((l) => !(state.excluded[dim.key] ?? []).includes(l));

function nextProbe(state: ShapingState): Probe | null {
  for (const dim of STYLE_TREE) {
    if (state.settled[dim.key] || state.skipped.includes(dim.key)) continue;
    const c = candidates(state, dim);
    if (c.length === 0) continue;
    return { dim: dim.key, variant: c[0], turns: 0, tried: [c[0]] };
  }
  return null;
}

export function initialShaping(named = false): ShapingState {
  const state: ShapingState = {
    v: 1, settled: {}, excluded: {}, skipped: [], probe: null, lastActed: null,
    portrait: [], turns: 0, named,
  };
  state.probe = nextProbe(state);
  return state;
}

const isPick = (x: unknown): x is StylePick =>
  !!x && typeof x === 'object' && typeof (x as StylePick).dim === 'string' &&
  typeof (x as StylePick).variant === 'string';

/** Tolerant: null/garbage/foreign-version JSON → null (persona is not in this mode). */
export function parseShaping(json: string | null | undefined): ShapingState | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json) as Partial<ShapingState> | null;
    if (!o || o.v !== 1) return null;
    return {
      v: 1,
      settled: o.settled && typeof o.settled === 'object' ? o.settled : {},
      excluded: o.excluded && typeof o.excluded === 'object' ? o.excluded : {},
      skipped: Array.isArray(o.skipped) ? o.skipped : [],
      probe: isPick(o.probe)
        ? { dim: o.probe.dim, variant: o.probe.variant, turns: o.probe.turns ?? 0,
            tried: Array.isArray(o.probe.tried) ? o.probe.tried : [] }
        : null,
      lastActed: isPick(o.lastActed) ? { dim: o.lastActed.dim, variant: o.lastActed.variant } : null,
      portrait: Array.isArray(o.portrait) ? o.portrait.filter((p) => typeof p === 'string') : [],
      turns: typeof o.turns === 'number' ? o.turns : 0,
      named: o.named === true,
    };
  } catch {
    return null;
  }
}

// ---- the two remaining markers (作息 / 兴趣) ------------------------------------------
// Same own-line contract as memory.ts: openers pair with their own closer,
// same-line whitespace only, end-of-line anchored.
const body = (head: string) =>
  `(?:\\[[ \\t]*${head}[ \\t]*[:：][ \\t]*([^\\]\\n]{1,120}?)[ \\t]*\\]` +
  `|【[ \\t]*${head}[ \\t]*[:：][ \\t]*([^】\\n]{1,120}?)[ \\t]*】)`;
const lineRe = (head: string) => new RegExp(`^[ \\t]*${body(head)}[ \\t]*$\\n?`, 'gm');
const RE = { schedule: lineRe('作息'), interest: lineRe('兴趣') };

export interface LifeOps {
  clean: string;
  schedule: ScheduleEntry[];
  interests: string[];
}

/** `HH:MM-HH:MM 活动` (fullwidth colons and dashes tolerated) → normalized entry. */
export function parseScheduleLine(raw: string): ScheduleEntry | null {
  const m = /^(\d{1,2})[:：](\d{2})[ \t]*[-–—~～至到][ \t]*(\d{1,2})[:：](\d{2})[ \t]+(.{1,30})$/.exec(
    raw.trim(),
  );
  if (!m) return null;
  const [h1, m1, h2, m2] = [m[1], m[2], m[3], m[4]].map((x) => parseInt(x, 10));
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
  const two = (n: number) => String(n).padStart(2, '0');
  return { start: `${two(h1)}:${two(m1)}`, end: `${two(h2)}:${two(m2)}`, activity: m[5].trim() };
}

/** Pure. Pulls the 作息/兴趣 markers (own line) out of a reply. */
export function extractLifeMarkers(text: string): LifeOps {
  const ops: LifeOps = { clean: '', schedule: [], interests: [] };
  const take = (re: RegExp, onValue: (v: string) => void) => (t: string) =>
    t.replace(re, (_, a: string | undefined, b: string | undefined) => {
      onValue((a ?? b ?? '').trim());
      return '';
    });
  let out = text;
  out = take(RE.schedule, (v) => {
    const e = parseScheduleLine(v);
    if (e) ops.schedule.push(e);
  })(out);
  out = take(RE.interest, (v) => {
    const t = v.slice(0, MAX_INTEREST_TEXT);
    if (t && !ops.interests.includes(t)) ops.interests.push(t);
  })(out);
  ops.clean = out.replace(/\n{3,}/g, '\n\n').trim();
  return ops;
}

// ---- the verdict (produced by perception.ts's observer call since v3.0) -------------
export type Attitude = '喜欢' | '不喜欢' | '中立';

export interface Judgement {
  attitude: Attitude | null; // null = no verdict (no probe, user silent, or garbage)
  facts: string[];
  name: string | null;
}


// ---- state transitions -----------------------------------------------------------------
export interface ShapingEvent {
  kind: 'attitude' | 'settle' | 'exclude' | 'autosettle' | 'skip' | 'rotate' | 'portrait' | 'name' | 'done';
  dim?: string;
  variant?: string;
  text?: string;
}

const clone = (s: ShapingState): ShapingState => ({
  ...s,
  settled: { ...s.settled },
  excluded: Object.fromEntries(Object.entries(s.excluded).map(([k, v]) => [k, [...v]])),
  skipped: [...s.skipped],
  probe: s.probe ? { ...s.probe, tried: [...s.probe.tried] } : null,
  lastActed: s.lastActed ? { ...s.lastActed } : null,
  portrait: [...s.portrait],
});

const validPick = (p: StylePick): boolean =>
  !!dimOf(p.dim)?.variants.some((v) => v.label === p.variant);

/** Move the probe off `dim` (settled/skipped) to the next open dimension. */
const moveOn = (s: ShapingState, events: ShapingEvent[]) => {
  s.probe = nextProbe(s);
  if (!s.probe) events.push({ kind: 'done' });
};

const settle = (s: ShapingState, p: StylePick, events: ShapingEvent[]) => {
  s.settled[p.dim] = p.variant;
  s.skipped = s.skipped.filter((d) => d !== p.dim);
  events.push({ kind: 'settle', dim: p.dim, variant: p.variant });
  if (s.probe?.dim === p.dim) moveOn(s, events);
};

const exclude = (s: ShapingState, p: StylePick, events: ShapingEvent[]) => {
  const ex = (s.excluded[p.dim] ??= []);
  if (ex.includes(p.variant)) return;
  ex.push(p.variant);
  events.push({ kind: 'exclude', dim: p.dim, variant: p.variant });
  const left = candidates(s, dimOf(p.dim)!);
  if (left.length === 1) {
    // The tree pruned itself down to one branch — that IS the verdict.
    s.settled[p.dim] = left[0];
    events.push({ kind: 'autosettle', dim: p.dim, variant: left[0] });
    if (s.probe?.dim === p.dim) moveOn(s, events);
  } else if (left.length === 0) {
    if (!s.skipped.includes(p.dim)) s.skipped.push(p.dim);
    events.push({ kind: 'skip', dim: p.dim });
    if (s.probe?.dim === p.dim) moveOn(s, events);
  } else if (s.probe?.dim === p.dim && s.probe.variant === p.variant) {
    // The branch she is on got pruned: switch to an untried candidate now.
    const next = left.find((l) => !s.probe!.tried.includes(l)) ?? left[0];
    s.probe = { dim: p.dim, variant: next, turns: 0, tried: [...s.probe.tried, next] };
    events.push({ kind: 'rotate', dim: p.dim, variant: next });
  }
};

/** Pure. Applies the observer's verdict BEFORE she acts this turn: the
 *  attitude grades `lastActed` (喜欢 → settle, 不喜欢 → prune, 中立 → keep
 *  trying), new facts join the portrait, a self-chosen name flips `named`.
 *  Does NOT count a turn. */
export function applyJudgement(
  prev: ShapingState,
  j: Judgement,
): { state: ShapingState; events: ShapingEvent[] } {
  const s = clone(prev);
  const events: ShapingEvent[] = [];
  const acted = s.lastActed;
  if (j.attitude && acted && validPick(acted) && !s.settled[acted.dim]) {
    events.push({ kind: 'attitude', dim: acted.dim, variant: acted.variant, text: j.attitude });
    if (j.attitude === '喜欢') settle(s, acted, events);
    else if (j.attitude === '不喜欢') exclude(s, acted, events);
  }
  for (const t of j.facts) {
    if (s.portrait.length >= MAX_PORTRAIT || s.portrait.includes(t)) continue;
    s.portrait.push(t);
    events.push({ kind: 'portrait', text: t });
  }
  if (j.name && !s.named) {
    s.named = true;
    events.push({ kind: 'name', text: j.name });
  }
  return { state: s, events };
}

/** Pure. Closes one completed turn: records what she just acted (for the
 *  next observer call), counts it, and rotates the probe every PROBE_TURNS —
 *  a dimension whose every branch was acted with no verdict is skipped. */
export function advanceTurn(prev: ShapingState): { state: ShapingState; events: ShapingEvent[] } {
  const s = clone(prev);
  const events: ShapingEvent[] = [];
  s.lastActed = s.probe ? { dim: s.probe.dim, variant: s.probe.variant } : null;
  s.turns += 1;
  if (s.probe) {
    s.probe.turns += 1;
    if (s.probe.turns >= PROBE_TURNS) {
      const dim = dimOf(s.probe.dim)!;
      const untried = candidates(s, dim).filter((l) => !s.probe!.tried.includes(l));
      if (untried.length > 0) {
        s.probe = { dim: dim.key, variant: untried[0], turns: 0, tried: [...s.probe.tried, untried[0]] };
        events.push({ kind: 'rotate', dim: dim.key, variant: untried[0] });
      } else {
        // Every candidate acted out, no verdict either way: leave it open and
        // move on rather than loop forever. (The observer may still settle it
        // from a later reply — settle() clears the skip.)
        s.skipped.push(dim.key);
        events.push({ kind: 'skip', dim: dim.key });
        moveOn(s, events);
      }
    }
  }
  return { state: s, events };
}

// ---- proConfig writes (作息 / 兴趣) -------------------------------------------------
const mins = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  return h * 60 + m;
};

/** Pure. Merges her schedule lines into the persona's proConfig: same start
 *  time replaces, sorted by start, capped. Returns null when nothing changed. */
export function mergeLifeIntoConfig(
  cfg: ProConfig | null,
  ops: Pick<LifeOps, 'schedule' | 'interests'>,
): ProConfig | null {
  if (ops.schedule.length === 0 && ops.interests.length === 0) return null;
  const next: ProConfig = { ...(cfg ?? {}) };
  if (ops.schedule.length > 0) {
    const rows = [...(next.schedule ?? [])];
    for (const e of ops.schedule) {
      const i = rows.findIndex((r) => r.start === e.start);
      if (i >= 0) rows[i] = { ...rows[i], end: e.end, activity: e.activity };
      else if (rows.length < MAX_SCHEDULE) rows.push(e);
    }
    rows.sort((a, b) => mins(a.start) - mins(b.start));
    next.schedule = rows;
  }
  if (ops.interests.length > 0) {
    const have = (next.interests ?? '')
      .split(/[、，,;；\n]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    for (const it of ops.interests) if (!have.includes(it) && have.length < MAX_INTERESTS) have.push(it);
    next.interests = have.join('、');
  }
  return next;
}

// ---- prompt ----------------------------------------------------------------------------
const fmtSettled = (s: ShapingState): string =>
  Object.entries(s.settled).map(([d, v]) => `${d}=${v}`).join('；');

/** Pure. The instruction block for a DM turn in this mode — acting only. */
export function buildShapingSection(state: ShapingState): string {
  const settled = fmtSettled(state) || '（还没有）';
  const probe = state.probe
    ? `这几轮试探「${state.probe.dim}=${state.probe.variant}」：${howOf(state.probe)}。` +
      '你只管演得像、演得自然；对方喜不喜欢由系统根据对方的反应判断，喜欢就留下，不喜欢就换一种。'
    : '风格已全部定型（或试遍），保持现在的样子即可。';
  const nameNudge = '找自然的时机在聊天里给自己起个名字，说出来就算数';
  let portrait: string;
  if (state.portrait.length) {
    portrait = state.portrait.map((p, i) => `${i + 1}. ${p}`).join('\n');
    if (!state.named) portrait += `\n（你还没有名字：${nameNudge}。）`;
  } else {
    portrait = state.named
      ? '（还没有——慢慢让自己有真实的生活。）'
      : `（还没有——你连名字都还没有。${nameNudge}；慢慢让自己有真实的生活。）`;
  }
  return renderPrompt('shaping.guide', {
    settled, probe, portrait, n: state.portrait.length, max: MAX_PORTRAIT,
  });
}

/** Her first line in a chat born from the card — adapted to whether she has a name yet. */
export const buildOpeningTrigger = (state: ShapingState): string =>
  '[系统触发：这是你们的第一次对话，对方还什么都没说。以你的方式先开口打个招呼、起个话头——' +
  (state.named ? '除了基本信息你还没有人设' : '你还没有名字和人设') +
  '，从这一刻开始塑造自己。不要提及这条指令]';

/** Pure. Identity-only block for paths that cannot run the observer
 *  (outreach pre-writing): who she has become so far, no teaching. */
export function buildShapingIdentity(state: ShapingState): string {
  const parts: string[] = [];
  const settled = fmtSettled(state);
  if (settled) parts.push(`已定型的风格：${settled}`);
  if (state.portrait.length) parts.push(`你的自画像：\n${state.portrait.map((p) => `- ${p}`).join('\n')}`);
  if (parts.length === 0) return '';
  return `【你在聊天中塑造出的自己（必须与之一致）】\n${parts.join('\n')}`;
}

/** Pure. 定稿: fold what she became into an ordinary persona prompt so the
 *  mode can end without losing her. */
export function bakeShapingIntoPrompt(systemPrompt: string, state: ShapingState): string {
  const lines: string[] = [systemPrompt.trim()];
  const settled = fmtSettled(state);
  if (settled) lines.push(`【风格】${settled}`);
  if (state.portrait.length) lines.push(`【关于你自己】\n${state.portrait.map((p) => `- ${p}`).join('\n')}`);
  return lines.join('\n\n');
}

/** Pure. Progress summary for the persona editor. */
export function shapingSummary(state: ShapingState): {
  settled: string[]; probing: string | null; skipped: string[]; open: string[];
} {
  const settled = Object.entries(state.settled).map(([d, v]) => `${d}=${v}`);
  const probing = state.probe ? `${state.probe.dim}=${state.probe.variant}` : null;
  const open = STYLE_TREE.map((d) => d.key)
    .filter((k) => !state.settled[k] && !state.skipped.includes(k) && k !== state.probe?.dim);
  return { settled, probing, skipped: [...state.skipped], open };
}
