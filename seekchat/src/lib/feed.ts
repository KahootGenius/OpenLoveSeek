// v2.1 朋友圈 orchestration: publish → director picks → reactor calls →
// reactions with staggered reveals + one scheduled OS notification each.
// Reveal state is a TIME COMPARISON (revealAt <= now) — nothing to re-fire.
// Loaded lazily — evaluating expo-notifications inside Expo Go throws, and
// this module is imported by a route file (house invariant, see _layout.tsx).
const Notif = () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('expo-notifications') as typeof import('expo-notifications');
import {
  deletePost as dbDeletePost, ensureCharacter, getConversation, getPersona, getPost,
  getPref, insertCharPost, insertMessage, insertReaction, listCharacters, listPersonas,
  listReactions, setConversationState, setPref, setReactionNotif,
} from './db';
import { soulContextFor } from './soul';
import { activityAt } from './life';
import { parseProConfig } from './pro';
import { renderPrompt } from './prompts';
import type { Character, Post } from './types';
import {
  buildDirectorPrompt, buildReactorPrompt, experienceNote, parseDirectorPicks,
  postImageDescs, revealDelayMs, visibleTo,
} from './moments';
import { chatOnce } from './llm';
import { dayEventsLine, parseDayLog } from './dayseed';
import { getApiKey, getModel, getSummarizerModel, getTemperature } from './settings';
import { extractMemoryMarkers } from './memory';
import { extractStateTag } from './statetag';
import { logMeta, notifyConversation } from './engine';

/** Every registered character allowed to see this post (lazy-registers
 *  single-chat personas; ambiguous personas are skipped until the user picks
 *  a home chat in the composer's visibility sheet). */
function allowedCharacters(post: Post): Character[] {
  for (const p of listPersonas()) ensureCharacter(p.id);
  return listCharacters().filter((c) => visibleTo(post.visibility, c.id));
}

// soulContextFor moved to soul.ts (shared with group speakers, v2.2).

/** Experience rows land in her home chat: grey line in the UI, full member of
 *  her model window and summarizer (spec §4 write path). Soul-sync gated.
 *  Stamped at REVEAL time so her chat, the feed, and the notification agree
 *  on when it "happened" — chat/window/summarizer all hide future rows. */
function carryHome(ch: Character, note: string, revealAt: number): void {
  if (ch.soulSync !== 1) return;
  insertMessage(ch.homeConvoId, 'assistant', note, 'complete', 'experience', null, revealAt);
  notifyConversation(ch.homeConvoId);
}

async function scheduleReveal(
  reactionId: string, revealAt: number, title: string, body: string,
): Promise<void> {
  try {
    const notifId = await Notif().scheduleNotificationAsync({
      content: { title, body },
      trigger: {
        type: Notif().SchedulableTriggerInputTypes.DATE,
        date: new Date(revealAt),
      },
    });
    // 0 changes ⇒ the reaction was deleted while the OS call was in flight —
    // cancel the just-created notification instead of leaking a ghost.
    if (setReactionNotif(reactionId, notifId) === 0) {
      await Notif().cancelScheduledNotificationAsync(notifId);
    }
  } catch {
    // No notification permission → the reaction still appears in the feed.
  }
}

/** Fire-and-forget from the composer. Never throws. */
export async function publishPost(post: Post): Promise<void> {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) return;
    const cands = allowedCharacters(post);
    if (cands.length === 0) return;
    const personaName = (c: Character) => getPersona(c.personaId)?.name ?? '她';
    const dirRaw = await chatOnce(apiKey, getSummarizerModel(), [
      {
        role: 'user',
        content: buildDirectorPrompt(
          cands.map((c) => ({ id: c.id, name: personaName(c) })),
          post.text,
          postImageDescs(post.images),
        ),
      },
    ], 0.3).catch(() => '');
    const picks = parseDirectorPicks(dirRaw, cands.map((c) => c.id));
    const byId = new Map(cands.map((c) => [c.id, c]));
    const noun = post.postType === 'diary' ? '日记' : '动态';

    for (const id of picks.likes) {
      const ch = byId.get(id);
      if (!ch) continue;
      // The user may have deleted the post while an earlier await ran.
      if (!getPost(post.id)) return;
      const revealAt = Date.now() + revealDelayMs();
      const r = insertReaction(post.id, ch.id, 'like', null, revealAt);
      carryHome(ch, experienceNote('like', post, null), revealAt);
      await scheduleReveal(r.id, revealAt, personaName(ch), `${personaName(ch)} 赞了你的${noun} ❤️`);
    }

    for (const id of picks.comments) {
      const ch = byId.get(id);
      if (!ch) continue;
      try {
        const persona = getPersona(ch.personaId);
        if (!persona) continue;
        const out = await chatOnce(apiKey, getModel(), [
          {
            role: 'system',
            content: buildReactorPrompt({
              personaPrompt: persona.systemPrompt,
              soulContext: soulContextFor(ch),
              post,
              isDiary: post.postType === 'diary',
            }),
          },
          { role: 'user', content: '（写下你的评论）' },
        ], getTemperature());
        const { clean, tag } = extractStateTag(out);
        // 记忆 markers are taught via soulContext but moments never APPLY them —
        // strip so they can't leak as visible text.
        const comment = extractMemoryMarkers(clean).clean.trim().slice(0, 300);
        if (!comment) continue;
        // The reactor call takes seconds — re-check the post survived it.
        if (!getPost(post.id)) return;
        const revealAt = Date.now() + revealDelayMs();
        const r = insertReaction(post.id, ch.id, 'comment', comment, revealAt);
        if (ch.soulSync === 1 && tag) {
          setConversationState(ch.homeConvoId, tag.mood, tag.intensity, tag.thought);
        }
        carryHome(ch, experienceNote('comment', post, comment), revealAt);
        await scheduleReveal(
          r.id, revealAt, personaName(ch),
          `${personaName(ch)} 评论了你：${comment.slice(0, 60)}`,
        );
      } catch {
        logMeta(ch.homeConvoId, '🌙 她想评论你的动态，但网络没让她说完');
      }
    }
  } catch {
    // publish itself never surfaces errors — the post is already saved.
  }
}

// Mirrors groupflow's focusedGroup gate: no banner+sound for a post that is
// appearing on the very screen the user is looking at.
let momentsFocused = false;
export const setMomentsFocused = (on: boolean): void => void (momentsFocused = on);

/** 角色朋友圈 (v2.3): on app foreground / moments focus, each registered
 *  character may post once a day with 30% probability per first check.
 *  Fire-and-forget; the daily pref is spent even on failure (one attempt). */
export async function maybeCharPosts(): Promise<void> {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) return;
    for (const p of listPersonas()) ensureCharacter(p.id);
    const d = new Date();
    const dayKey = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    for (const ch of listCharacters()) {
      if (getPref(`charpost.${ch.id}.${dayKey}`) === '1') continue;
      if (Math.random() > 0.3) continue;
      const persona = getPersona(ch.personaId);
      const convo = getConversation(ch.homeConvoId);
      if (!persona || !convo) continue;
      const cfg = parseProConfig(persona.proConfig);
      const activity = activityAt(cfg?.schedule, new Date()) ?? '过着自己的一天';
      setPref(`charpost.${ch.id}.${dayKey}`, '1');
      try {
        const out = await chatOnce(apiKey, getModel(), [
          {
            role: 'system',
            content:
              `${persona.systemPrompt}\n\n${soulContextFor(ch)}\n\n` +
              renderPrompt('moments.charpost', {
                activity,
                today: dayEventsLine(parseDayLog(persona.dayLog), new Date()) ?? '',
              }),
          },
          { role: 'user', content: '（写下你的动态）' },
        ], getTemperature());
        const text = extractMemoryMarkers(extractStateTag(out).clean).clean.trim().slice(0, 200);
        if (!text) continue;
        const post = insertCharPost(ch.id, text);
        carryHome(ch, `〔朋友圈〕我发了条动态：「${post.text.slice(0, 30)}」`, Date.now());
        if (!momentsFocused) {
          try {
            void Notif().scheduleNotificationAsync({
              content: { title: '朋友圈', body: `${persona.name} 发了一条动态` },
              trigger: null,
            });
          } catch {
            // Expo Go
          }
        }
      } catch {
        // this character skips today
      }
    }
  } catch {
    // never surfaces
  }
}

// One reply flight per post + a 2-min cooldown + no stacking on an unrevealed
// reply — a burst of comments yields ONE coherent reply, not N racing ones
// (every AI-triggering loop in this codebase is guarded; this one is too).
const replyBusy = new Set<string>();

/** User commented on HER post → she may reply (one reactor call, quick reveal). */
export async function charCommentReply(post: Post, userComment: string): Promise<void> {
  if (replyBusy.has(post.id)) return;
  replyBusy.add(post.id);
  try {
    const apiKey = await getApiKey();
    if (!apiKey || post.authorType !== 'character' || !post.authorId) return;
    const cd = Number(getPref(`commentreply.${post.id}`) ?? 0);
    if (Date.now() - cd < 2 * 60_000) return;
    if (
      listReactions(post.id).some(
        (r) => r.authorType === 'character' && r.type === 'comment' && r.revealAt > Date.now(),
      )
    ) {
      return; // she already has a reply on the way — don't stack another
    }
    const ch = listCharacters().find((c) => c.id === post.authorId);
    const persona = ch ? getPersona(ch.personaId) : null;
    if (!ch || !persona) return;
    const out = await chatOnce(apiKey, getModel(), [
      {
        role: 'system',
        content:
          `${persona.systemPrompt}\n\n${soulContextFor(ch)}\n\n` +
          renderPrompt('moments.commentreply', {
            post: post.text.slice(0, 200),
            comment: userComment.slice(0, 200),
          }),
      },
      { role: 'user', content: '（写下你的回复）' },
    ], getTemperature());
    const { clean, tag } = extractStateTag(out);
    const reply = extractMemoryMarkers(clean).clean.trim().slice(0, 300);
    if (!reply || !getPost(post.id)) return;
    const revealAt = Date.now() + 60_000 + Math.floor(Math.random() * 9 * 60_000); // 1-10 min
    const r = insertReaction(post.id, ch.id, 'comment', reply, revealAt);
    setPref(`commentreply.${post.id}`, String(Date.now()));
    if (ch.soulSync === 1 && tag) {
      setConversationState(ch.homeConvoId, tag.mood, tag.intensity, tag.thought);
    }
    carryHome(ch, `〔朋友圈〕他评论了我的动态，我回了他：「${reply.slice(0, 30)}」`, revealAt);
    await scheduleReveal(r.id, revealAt, persona.name, `${persona.name} 回复了你：${reply.slice(0, 60)}`);
  } catch {
    // silent
  } finally {
    replyBusy.delete(post.id);
  }
}

/** Delete a post + its reactions, cancelling any unfired reveal notifications. */
export function removePost(postId: string): void {
  for (const r of listReactions(postId)) {
    try {
      if (r.notifId) Notif().cancelScheduledNotificationAsync(r.notifId).catch(() => {});
    } catch {
      // Expo Go: require throws — but notifId is only ever set where it can't.
    }
  }
  dbDeletePost(postId);
}
