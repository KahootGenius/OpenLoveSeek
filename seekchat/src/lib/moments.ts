// v2.1 朋友圈 pure logic. The DIRECTOR (spec §6) is one cheap call that decides
// who reacts; every rule that must hold is enforced HERE in code, not in the
// model: caps, unknown-id filtering, fail-closed visibility, silence-allowed.
import type { Post, PostImage } from './types';
import { renderPrompt } from './prompts';

export const REVEAL_MIN_MS = 60_000; // 1 min
export const REVEAL_MAX_MS = 30 * 60_000; // 30 min
export const MAX_COMMENTS = 2;
export const MAX_LIKES = 3;
export const DIARY_INJECT_COUNT = 3;
// The NEWEST readable diary rides whole (long diaries are the point — a
// 300-char excerpt left her knowing only the first half, field-reported);
// older entries are excerpted, and every cut is MARKED so she never claims
// to know text she wasn't given.
export const DIARY_FULL_LEN = 2000;
export const DIARY_EXCERPT_LEN = 300;

export interface DirectorCandidate {
  id: string;
  name: string;
}

export interface DirectorPicks {
  likes: string[];
  comments: string[];
}

export function parseDirectorPicks(raw: string, knownIds: string[]): DirectorPicks {
  const none: DirectorPicks = { likes: [], comments: [] };
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return none;
  try {
    const o = JSON.parse(m[0]) as { likes?: unknown; comments?: unknown };
    const clean = (v: unknown, cap: number): string[] =>
      Array.isArray(v)
        ? [...new Set(v.filter((x): x is string => typeof x === 'string' && knownIds.includes(x)))]
            .slice(0, cap)
        : [];
    return { likes: clean(o.likes, MAX_LIKES), comments: clean(o.comments, MAX_COMMENTS) };
  } catch {
    return none;
  }
}

/** Fail CLOSED: a diary leaking to the wrong character is worse than silence. */
export function visibleTo(visibility: string, characterId: string): boolean {
  if (visibility === 'all') return true;
  try {
    const list = JSON.parse(visibility);
    return Array.isArray(list) && list.includes(characterId);
  } catch {
    return false;
  }
}

export function revealDelayMs(rand: () => number = Math.random): number {
  return REVEAL_MIN_MS + Math.floor(rand() * (REVEAL_MAX_MS - REVEAL_MIN_MS));
}

export function buildDirectorPrompt(
  candidates: DirectorCandidate[], text: string, imageDescs: string[],
): string {
  return renderPrompt('moments.director', {
    roster: candidates.map((c) => `- ${c.id}：${c.name}`).join('\n'),
    text,
    imgs: imageDescs.length ? `\n[配图] ${imageDescs.join('；')}` : '',
    maxLikes: MAX_LIKES,
    maxComments: MAX_COMMENTS,
  });
}

export function postImageDescs(imagesJson: string): string[] {
  try {
    const arr = JSON.parse(imagesJson) as PostImage[];
    return Array.isArray(arr) ? arr.map((i) => i.desc).filter(Boolean) : [];
  } catch {
    return [];
  }
}

const fmtDiaryDate = (ts: number): string => {
  const d = new Date(ts);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};

const diaryEvidenceBlock = (
  post: Pick<Post, 'text' | 'createdAt'>,
  index: number,
  cap: number,
  collisionBodies?: readonly string[],
): string => {
  const cut = post.text.length > cap;
  const completeness = cut ? '节选（后文未提供）' : '完整';
  const body = post.text.slice(0, cap);
  const baseLabel = `日记${index}`;
  let label = baseLabel;
  let suffix = 0;
  const bodies = collisionBodies ?? [body];
  while (bodies.some((visibleBody) => visibleBody.includes(`【${label}｜`))) {
    suffix++;
    label = `${baseLabel}#${suffix}`;
  }
  return (
    `【${label}｜${fmtDiaryDate(post.createdAt)}｜${completeness}｜原文开始】\n` +
    body +
    `\n【${label}｜原文结束】`
  );
};

export function buildReactorPrompt(args: {
  personaPrompt: string;
  soulContext: string; // summary/memories/mood when soulSync ON, else brief
  post: Post;
  isDiary: boolean;
}): string {
  const descs = postImageDescs(args.post.images);
  const sourceRule = args.isDiary ? renderPrompt('moments.source') + '\n\n' : '';
  const text = args.isDiary
    ? diaryEvidenceBlock(args.post, 1, args.post.text.length)
    : args.post.text;
  return (
    `${args.personaPrompt}\n\n${args.soulContext}\n\n${sourceRule}` +
    renderPrompt('moments.reactor', {
      what: args.isDiary ? '他写的一篇日记（他允许你读）' : '他发的一条朋友圈动态',
      text,
      imgs: descs.length ? `\n[配图] ${descs.join('；')}` : '',
    })
  );
}

export function buildDiaryInstructions(): string {
  return [renderPrompt('moments.source'), renderPrompt('moments.diary')].join('\n\n');
}

/** 聊天内可读 injection for the 1:1 chat (spec §7.6). Input newest-first. */
export function buildDiarySection(posts: Post[], characterId: string): string {
  const readable = posts
    .filter((p) => p.postType === 'diary' && p.chatReadable === 1)
    .filter((p) => visibleTo(p.visibility, characterId))
    .slice(0, DIARY_INJECT_COUNT);
  if (readable.length === 0) return '';
  const visibleBodies = readable.map((p, i) =>
    p.text.slice(0, i === 0 ? DIARY_FULL_LEN : DIARY_EXCERPT_LEN),
  );
  const blocks = readable.map((p, i) =>
    diaryEvidenceBlock(
      p,
      i + 1,
      i === 0 ? DIARY_FULL_LEN : DIARY_EXCERPT_LEN,
      visibleBodies,
    ),
  );
  return blocks.join('\n\n');
}

/** Carried home to her 1:1 chat (kind='experience') — HER perspective. */
export function experienceNote(
  type: 'like' | 'comment', post: Post, comment: string | null,
): string {
  const excerpt = post.text.replace(/\s+/g, ' ').slice(0, 40);
  const what = post.postType === 'diary' ? '日记' : '动态';
  // First person: this row lives in HER chat as HER line — both the model
  // window and the grey UI line read it as something she did.
  return type === 'like'
    ? `〔朋友圈〕我赞了你的${what}「${excerpt}」`
    : `〔朋友圈〕我评论了你的${what}「${excerpt}」：${comment ?? ''}`;
}
