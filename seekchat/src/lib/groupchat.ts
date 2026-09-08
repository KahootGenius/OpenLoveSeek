// v2.2 group chat pure logic. Same philosophy as moments.ts: the director
// only SUGGESTS; every cap and filter is enforced HERE in tested code.
import type { Message } from './types';
import { renderPrompt } from './prompts';
import { parseRedpacket } from './redpacket';

export interface GroupStamp { text: string; by: string; at: number }
export interface GroupConfig {
  chainCap: number; // char→char lines since the user's last message
  maxSpeakers: number; // per director pick
  dailyCap: number; // automated lines (idle ticks + catch-up) per day
  background: boolean; // may the group move without the user?
  owner: string; // 'user' or a characterId — single owner
  modConsent: boolean; // characters may moderate the USER
  announcement: GroupStamp | null;
  notepad: GroupStamp | null;
  userMutedUntil: number | null;
}

export const GROUP_DEFAULTS: GroupConfig = {
  chainCap: 3, maxSpeakers: 2, dailyCap: 30, background: false,
  owner: 'user', modConsent: false, announcement: null, notepad: null, userMutedUntil: null,
};

export const CATCHUP_MIN_AWAY_MS = 30 * 60_000;
export const CATCHUP_MAX_LINES = 6;
export const MAX_DIRECTOR_ROUNDS = 3;

export function parseGroupConfig(json: string | null): GroupConfig {
  if (!json) return { ...GROUP_DEFAULTS };
  try {
    const o = JSON.parse(json) as Partial<GroupConfig>;
    const stamp = (x: unknown): GroupStamp | null => {
      const s = x as GroupStamp;
      return s && typeof s.text === 'string' && s.text.trim()
        && typeof s.by === 'string' && typeof s.at === 'number'
        ? { text: s.text, by: s.by, at: s.at } : null;
    };
    return {
      chainCap: typeof o.chainCap === 'number' ? Math.max(1, o.chainCap) : GROUP_DEFAULTS.chainCap,
      maxSpeakers: typeof o.maxSpeakers === 'number' ? o.maxSpeakers : GROUP_DEFAULTS.maxSpeakers,
      dailyCap: typeof o.dailyCap === 'number' ? o.dailyCap : GROUP_DEFAULTS.dailyCap,
      background: o.background === true,
      owner: typeof o.owner === 'string' && o.owner ? o.owner : GROUP_DEFAULTS.owner,
      modConsent: o.modConsent === true,
      announcement: stamp(o.announcement),
      notepad: stamp(o.notepad),
      userMutedUntil: typeof o.userMutedUntil === 'number' ? o.userMutedUntil : null,
    };
  } catch {
    return { ...GROUP_DEFAULTS };
  }
}

/** Real character speech since the user's last message — the chain the cap
 *  bounds. v2.5 system lines (meta) and recalled rows don't consume it. */
export function chainCount(messages: Message[]): number {
  let n = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') break;
    if (messages[i].role === 'assistant' && (messages[i].kind === 'normal' || messages[i].kind === 'sticker')) n++;
  }
  return n;
}

export function parseGroupDirector(
  raw: string, roster: { id: string; name: string }[], maxSpeakers: number,
): string[] {
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return [];
  try {
    const o = JSON.parse(m[0]) as { next?: unknown };
    if (!Array.isArray(o.next)) return [];
    const ids = new Set(roster.map((r) => r.id));
    const byName = new Map(roster.filter((r) => r.name).map((r) => [r.name, r.id]));
    return [...new Set(
      o.next
        .filter((x): x is string => typeof x === 'string')
        .map((x) => (ids.has(x) ? x : byName.get(x)))
        .filter((x): x is string => typeof x === 'string'),
    )].slice(0, maxSpeakers);
  } catch {
    return [];
  }
}

/** Pure. Reply-guarantee fallback: the @-mentioned member first, else random. */
export function pickFallbackSpeaker<T extends { id: string }>(
  members: T[], mentionedIds: string[], rand: () => number = Math.random,
): T | null {
  if (members.length === 0) return null;
  return members.find((m) => mentionedIds.includes(m.id))
    ?? members[Math.floor(rand() * members.length)];
}

/** "名字：内容" lines for the model; stickers by label; recall/meta ride as
 *  "系统：…" lines (v2.5 — she should see mutes/recalls happen); experience
 *  rows (her home-chat diary carry-over) stay skipped. */
export function renderTranscript(
  messages: Message[],
  nameOf: (speakerId: string | null) => string,
  stickerLabel: (stickerId: string) => string | null,
  cap = 20,
): string {
  return messages
    .filter((m) => ['normal', 'sticker', 'recall', 'meta', 'redpacket'].includes(m.kind))
    .slice(-cap)
    .map((m) => {
      if (m.kind === 'recall' || m.kind === 'meta') return `系统：${m.content}`;
      const who = nameOf(m.role === 'user' ? null : m.speakerId);
      if (m.kind === 'redpacket') {
        const packet = parseRedpacket(m.content);
        const body = packet ? `[发了一个红包${packet.note ? '：' + packet.note : ''}]` : '[红包]';
        return `${who}：${body}`;
      }
      const body =
        m.kind === 'sticker' ? `[表情：${stickerLabel(m.content) ?? '表情'}]` : m.content;
      return `${who}：${body}`;
    })
    .join('\n');
}

/** Pure. Standing group context (公告/笔记/总结) ahead of the transcript. */
export function buildGroupContext(
  transcript: string,
  cfg: Pick<GroupConfig, 'announcement' | 'notepad'>,
  summary: string | null,
): string {
  const parts: string[] = [];
  if (cfg.announcement) parts.push(`【群公告】${cfg.announcement.text}`);
  if (cfg.notepad) parts.push(`【群笔记】${cfg.notepad.text}`);
  if (summary) parts.push(`【此前群聊总结】${summary}`);
  parts.push(transcript);
  return parts.join('\n\n');
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

/** Pure. A speaker's own '---' burst becomes real message rows (v2.4);
 *  segments trim, empties drop, a dash-only body yields nothing to land. */
export function splitSpeakerBurst(body: string): string[] {
  return body.split('---').map((p) => p.trim()).filter(Boolean);
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
  groupName: string; memberNames: string; transcript: string; modPowers: string;
}): string {
  return (
    `${args.personaPrompt}\n\n${args.soulContext}\n\n` +
    renderPrompt('group.speaker', {
      selfName: args.selfName,
      groupName: args.groupName,
      memberNames: args.memberNames,
      transcript: args.transcript,
    }) +
    (args.modPowers ? '\n\n' + args.modPowers : '')
  );
}
