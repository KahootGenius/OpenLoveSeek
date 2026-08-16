// v2.2 group chat pure logic. Same philosophy as moments.ts: the director
// only SUGGESTS; every cap and filter is enforced HERE in tested code.
import type { Message } from './types';
import { renderPrompt } from './prompts';

export interface GroupConfig {
  chainCap: number; // char→char lines since the user's last message
  maxSpeakers: number; // per director pick
  dailyCap: number; // automated lines (idle ticks + catch-up) per day
  background: boolean; // may the group move without the user?
}

export const GROUP_DEFAULTS: GroupConfig = {
  chainCap: 3, maxSpeakers: 2, dailyCap: 30, background: false,
};

export const CATCHUP_MIN_AWAY_MS = 30 * 60_000;
export const CATCHUP_MAX_LINES = 6;
export const MAX_DIRECTOR_ROUNDS = 3;

export function parseGroupConfig(json: string | null): GroupConfig {
  if (!json) return { ...GROUP_DEFAULTS };
  try {
    const o = JSON.parse(json) as Partial<GroupConfig>;
    return {
      chainCap: typeof o.chainCap === 'number' ? o.chainCap : GROUP_DEFAULTS.chainCap,
      maxSpeakers: typeof o.maxSpeakers === 'number' ? o.maxSpeakers : GROUP_DEFAULTS.maxSpeakers,
      dailyCap: typeof o.dailyCap === 'number' ? o.dailyCap : GROUP_DEFAULTS.dailyCap,
      background: o.background === true,
    };
  } catch {
    return { ...GROUP_DEFAULTS };
  }
}

/** Assistant lines since the user's last message — the chain the cap bounds. */
export function chainCount(messages: Message[]): number {
  let n = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') break;
    if (messages[i].role === 'assistant') n++;
  }
  return n;
}

export function parseGroupDirector(
  raw: string, knownIds: string[], maxSpeakers: number,
): string[] {
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return [];
  try {
    const o = JSON.parse(m[0]) as { next?: unknown };
    if (!Array.isArray(o.next)) return [];
    return [...new Set(
      o.next.filter((x): x is string => typeof x === 'string' && knownIds.includes(x)),
    )].slice(0, maxSpeakers);
  } catch {
    return [];
  }
}

/** "名字：内容" lines for the model; stickers by label; meta/experience skipped. */
export function renderTranscript(
  messages: Message[],
  nameOf: (speakerId: string | null) => string,
  stickerLabel: (stickerId: string) => string | null,
  cap = 20,
): string {
  return messages
    .filter((m) => m.kind === 'normal' || m.kind === 'sticker')
    .slice(-cap)
    .map((m) => {
      const who = nameOf(m.role === 'user' ? null : m.speakerId);
      const body =
        m.kind === 'sticker' ? `[表情：${stickerLabel(m.content) ?? '表情'}]` : m.content;
      return `${who}：${body}`;
    })
    .join('\n');
}

/** Carried to her HOME chat (kind='experience') — first person (v2.1 lesson:
 *  this row lives in HER chat as HER memory). */
export function groupHomeNote(groupTitle: string, herLine: string): string {
  const excerpt = herLine.replace(/\s+/g, ' ').slice(0, 30);
  return `〔群聊〕我在「${groupTitle}」里聊了几句：「${excerpt}」`;
}

/** Pure. @名字 anywhere in the text; longest name wins on prefix collisions. */
export function parseMentions(
  text: string, roster: { id: string; name: string }[],
): string[] {
  const byLen = [...roster].filter((r) => r.name).sort((x, y) => y.name.length - x.name.length);
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '@') continue;
    const rest = text.slice(i + 1);
    const hit = byLen.find((r) => rest.startsWith(r.name));
    if (hit && !out.includes(hit.id)) out.push(hit.id);
  }
  return out;
}

/** Fractions (0..1) of the away window where catch-up lines land, ordered. */
export function planCatchup(
  awayMs: number, dailyRemaining: number, rand: () => number = Math.random,
): number[] {
  if (awayMs < CATCHUP_MIN_AWAY_MS || dailyRemaining <= 0) return [];
  const n = Math.min(CATCHUP_MAX_LINES, dailyRemaining, 2 + Math.floor(rand() * 4));
  const fractions: number[] = [];
  for (let i = 0; i < n; i++) {
    // Ordered jittered slots keep chronology without clustering at the edges.
    fractions.push((i + 0.2 + rand() * 0.6) / (n + 0.4));
  }
  return fractions;
}

export function buildGroupDirectorPrompt(
  members: { id: string; name: string }[], transcript: string,
  remainingChain: number, maxSpeakers: number,
): string {
  return renderPrompt('group.director', {
    roster: members.map((c) => `- ${c.id}：${c.name}`).join('\n'),
    transcript,
    remainingChain,
    maxSpeakers,
  });
}

export function buildSpeakerPrompt(args: {
  personaPrompt: string; soulContext: string; selfName: string;
  groupName: string; memberNames: string; transcript: string;
}): string {
  return (
    `${args.personaPrompt}\n\n${args.soulContext}\n\n` +
    renderPrompt('group.speaker', {
      selfName: args.selfName,
      groupName: args.groupName,
      memberNames: args.memberNames,
      transcript: args.transcript,
    })
  );
}
