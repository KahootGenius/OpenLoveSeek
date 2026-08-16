// v2.2 group orchestration. Non-streaming: each speaker line lands as a
// complete message. All caps enforced by groupchat.ts pure code. Abort guard:
// a generation counter per group (a new user send or a fresh round bumps it;
// every await re-checks) — the v1.5 outreach pattern. Delete-during-flight
// re-checks the conversation after every await (v2.1 lesson; FKs are OFF).
const Notif = () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('expo-notifications') as typeof import('expo-notifications');
import {
  getConversation, getPersona, getPref, insertMessage, listCharacters, listGroupMembers,
  listMessages, listStickers, setConversationState, setPref, touchConversation,
} from './db';
import type { Character, Conversation } from './types';
import {
  buildGroupDirectorPrompt, buildSpeakerPrompt, chainCount, groupHomeNote,
  MAX_DIRECTOR_ROUNDS, parseGroupConfig, parseGroupDirector, parseMentions, planCatchup,
  renderTranscript,
} from './groupchat';
import { chatOnce } from './deepseek';
import { getApiKey, getModel, getMsgCut, getTemperature, getUserNickname } from './settings';
import { buildCutPrompt, needsCut, parseCut } from './cutter';
import { SUMMARIZER_MODEL } from './constants';
import { soulContextFor } from './soul';
import { extractStateTag, stripEchoedTimestamps } from './statetag';
import { extractStickerMarkers, resolveSticker } from './stickers';
import { renderPrompt } from './prompts';
import { acceptRepair, buildRepairPrompt, lintMarkers, normalizeActionMarkers } from './repair';
import { logMeta, maybeSummarize, notifyConversation } from './engine';

const gens = new Map<string, number>(); // per-group generation counter
const busy = new Set<string>();
const pendingUserRound = new Set<string>(); // user sent while a flight was up
let focusedGroup: string | null = null;
const lastTick = new Map<string, number>();

export const setFocusedGroup = (id: string | null): void => void (focusedGroup = id);
export const isGroupBusy = (id: string): boolean => busy.has(id);

const dayKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate(),
  ).padStart(2, '0')}`;
};
export const autoUsedToday = (id: string): number =>
  parseInt(getPref(`group.${id}.auto.${dayKey()}`) ?? '0', 10) || 0;
const bumpAuto = (id: string): void =>
  setPref(`group.${id}.auto.${dayKey()}`, String(autoUsedToday(id) + 1));

function bumpGen(id: string): number {
  const g = (gens.get(id) ?? 0) + 1;
  gens.set(id, g);
  return g;
}
const aborted = (id: string, g: number): boolean => (gens.get(id) ?? 0) !== g;

/** The user's message ALWAYS lands (never dropped because a round is running);
 *  a send aborts any in-flight round/catch-up at its next await, then a fresh
 *  round picks up the new message once `busy` frees. */
async function userSend(conversationId: string, insert: () => void): Promise<void> {
  insert();
  touchConversation(conversationId);
  notifyConversation(conversationId);
  bumpGen(conversationId); // abort in-flight round/catch-up at its next check
  if (busy.has(conversationId)) {
    // The aborted flight consumes this in its `finally` — guaranteed pickup
    // no matter how long its current speaker call takes.
    pendingUserRound.add(conversationId);
    return;
  }
  await runGroupRound(conversationId, { automated: false });
}

export const sendGroupMessage = (
  conversationId: string, text: string, quotedId: string | null = null,
): Promise<void> =>
  userSend(conversationId, () =>
    void insertMessage(conversationId, 'user', text, 'complete', 'normal', null, undefined, quotedId),
  );

/** Insert a user sticker into the group, then let the room react. */
export const sendGroupSticker = (conversationId: string, stickerId: string): Promise<void> =>
  userSend(conversationId, () =>
    void insertMessage(conversationId, 'user', stickerId, 'complete', 'sticker'),
  );

async function speakerLine(
  convo: Conversation, ch: Character, transcript: string,
  members: Character[], stampAt?: number,
): Promise<boolean> {
  const apiKey = await getApiKey();
  const persona = getPersona(ch.personaId);
  if (!apiKey || !persona) return false;
  const names = members.map((m) => getPersona(m.personaId)?.name ?? '她').join('、');
  const out = await chatOnce(apiKey, getModel(), [
    {
      role: 'system',
      content: buildSpeakerPrompt({
        personaPrompt: persona.systemPrompt,
        soulContext: soulContextFor(ch),
        selfName: persona.name,
        groupName: convo.title,
        memberNames: `${names}、${getUserNickname()}`,
        transcript,
      }),
    },
    { role: 'user', content: '（现在轮到你发言）' },
  ], getTemperature());
  // 格式检查: lint free, repair call only when an attempted marker is broken.
  let outText = normalizeActionMarkers(out);
  if (lintMarkers(outText).suspects.length > 0) {
    try {
      const fixed = await chatOnce(apiKey, SUMMARIZER_MODEL, [
        { role: 'user', content: buildRepairPrompt(outText) },
      ], 0);
      if (acceptRepair(outText, fixed) && fixed.trim() !== outText.trim()) outText = fixed.trim();
    } catch {
      // original rides
    }
  }
  const { clean, tag } = extractStateTag(stripEchoedTimestamps(outText));
  const stickers = listStickers();
  const st = stickers.length > 0 ? extractStickerMarkers(clean) : { clean, labels: [] as string[] };
  const body = st.clean.trim().slice(0, 500);
  if (!getConversation(convo.id)) return false; // deleted mid-flight
  let landed = false;
  if (body) {
    // 消息切割 (v2.3): groups text like real people too — same guarded cutter.
    let chunks = [body];
    if (getMsgCut() && needsCut(body)) {
      try {
        const rawCut = await chatOnce(apiKey, SUMMARIZER_MODEL, [
          { role: 'user', content: buildCutPrompt(body) },
        ], 0);
        const segs = parseCut(body, rawCut);
        if (segs) chunks = segs;
      } catch {
        // single bubble rides
      }
      if (!getConversation(convo.id)) return false; // re-check after the await
    }
    const t0 = stampAt ?? Date.now();
    chunks.forEach((c, i) => {
      insertMessage(
        convo.id, 'assistant', c, 'complete', 'normal', null,
        stampAt !== undefined || i > 0 ? t0 + i : undefined, null, ch.id,
      );
    });
    landed = true;
  }
  for (const label of st.labels) {
    const s = resolveSticker(stickers, label);
    if (s) {
      insertMessage(convo.id, 'assistant', s.id, 'complete', 'sticker', null, stampAt, null, ch.id);
      landed = true;
    }
  }
  if (landed) {
    if (tag && ch.soulSync === 1) {
      setConversationState(ch.homeConvoId, tag.mood, tag.intensity, tag.thought);
    }
    // 群聊回家 (v2.3): the group experience reaches her 1:1 soul, throttled to
    // one note per member per group per 45 min so busy rooms don't spam home.
    if (ch.soulSync === 1 && body) {
      const key = `group.${convo.id}.home.${ch.id}`;
      const last = parseInt(getPref(key) ?? '0', 10) || 0;
      if (Date.now() - last > 45 * 60_000) {
        setPref(key, String(Date.now()));
        insertMessage(
          ch.homeConvoId, 'assistant', groupHomeNote(convo.title, body),
          'complete', 'experience',
        );
        notifyConversation(ch.homeConvoId);
      }
    }
    touchConversation(convo.id);
    notifyConversation(convo.id);
    if (focusedGroup !== convo.id) {
      try {
        void Notif().scheduleNotificationAsync({
          content: {
            title: convo.title,
            body: `${persona.name}：${body || '[表情包]'}`.slice(0, 80),
          },
          trigger: null,
        });
      } catch {
        // Expo Go: require throws — notifications simply don't fire there.
      }
    }
  }
  return landed;
}

export async function runGroupRound(
  conversationId: string, opts: { automated: boolean },
): Promise<void> {
  if (busy.has(conversationId)) return;
  busy.add(conversationId);
  const gen = bumpGen(conversationId);
  try {
    const apiKey = await getApiKey();
    const convo = getConversation(conversationId);
    if (!apiKey || !convo || convo.kind !== 'group') return;
    const cfg = parseGroupConfig(convo.groupConfig);
    const members = listGroupMembers(conversationId);
    if (members.length === 0) return;
    // Names resolve from the FULL registry: a removed member's old lines keep
    // her name. `members` stays the roster for who may SPEAK next.
    const nameById = new Map(
      listCharacters().map((c) => [c.id, getPersona(c.personaId)?.name ?? '她']),
    );
    const nameOf = (sid: string | null) => (sid ? nameById.get(sid) ?? '她' : getUserNickname());
    const stickers = listStickers();
    const stickerName = (sid: string) => stickers.find((s) => s.id === sid)?.label ?? null;
    // The rolling summary is her long-term memory of this group — inject it
    // ahead of the transcript (write-only summaries are worthless).
    const withSummary = (t: string): string =>
      convo.summary ? `【此前群聊总结】${convo.summary}\n\n${t}` : t;

    for (let round = 0; round < MAX_DIRECTOR_ROUNDS; round++) {
      if (!getConversation(conversationId)) return; // deleted mid-round — stop spending
      const all = listMessages(conversationId);
      const chain = chainCount(all);
      if (chain >= cfg.chainCap) return;
      if (opts.automated && autoUsedToday(conversationId) >= cfg.dailyCap) return;
      // @提及 (v2.3): names in the user's LATEST line are guaranteed speakers
      // (round 0 only — chains after that are the director's business).
      // Resolve the last user message of ANY kind: a sticker sent after an
      // @-message must NOT re-fire the stale mention. (NOT compared against
      // the absolute tail — the pendingUserRound pickup legitimately runs
      // with assistant rows after the user's @-message.)
      const lastUser = [...all].reverse().find((m) => m.role === 'user');
      const mentioned =
        round === 0 && lastUser && lastUser.kind === 'normal' && !opts.automated
          ? parseMentions(
              lastUser.content,
              members.map((m) => ({ id: m.id, name: nameById.get(m.id) ?? '' })),
            )
          : [];
      const raw = await chatOnce(apiKey, SUMMARIZER_MODEL, [
        {
          role: 'user',
          content:
            buildGroupDirectorPrompt(
              members.map((m) => ({ id: m.id, name: nameById.get(m.id) ?? '她' })),
              withSummary(renderTranscript(all, nameOf, stickerName)),
              cfg.chainCap - chain,
              cfg.maxSpeakers,
            ) +
            (mentioned.length
              ? `\n用户@了：${mentioned.map((x) => nameById.get(x)).join('、')}——她们必须回应。`
              : ''),
        },
      ], 0.3).catch(() => '');
      if (aborted(conversationId, gen)) return;
      // Cap picks by BOTH remaining budgets: chain rows and (automated) daily.
      // Mentioned members ride ahead of director picks and always answer.
      const dailyLeft = opts.automated
        ? cfg.dailyCap - autoUsedToday(conversationId)
        : Number.POSITIVE_INFINITY;
      const budget = Math.max(0, Math.min(cfg.chainCap - chain, dailyLeft));
      const picks = [
        ...new Set([
          ...mentioned,
          ...parseGroupDirector(raw, members.map((m) => m.id), cfg.maxSpeakers),
        ]),
      ].slice(0, Math.max(mentioned.length, Math.min(cfg.maxSpeakers, budget)));
      if (picks.length === 0) return;
      for (const id of picks) {
        const ch = members.find((m) => m.id === id);
        if (!ch) continue;
        // Re-check per speaker: a text+sticker reply lands MULTIPLE assistant
        // rows, so the chain can fill mid-round; the group may also vanish.
        // @-mentioned speakers bypass the chain check — they answer the USER,
        // and replies to the user are never capped (spec §8).
        if (!getConversation(conversationId)) return;
        if (!mentioned.includes(id) && chainCount(listMessages(conversationId)) >= cfg.chainCap) {
          return;
        }
        try {
          const ok = await speakerLine(
            convo, ch,
            withSummary(renderTranscript(listMessages(conversationId), nameOf, stickerName)),
            members,
          );
          if (ok && opts.automated) bumpAuto(conversationId);
        } catch {
          logMeta(ch.homeConvoId, '🌙 她想在群里说话，但网络没让她说完');
        }
        if (aborted(conversationId, gen)) return;
      }
    }
  } finally {
    busy.delete(conversationId);
    if (pendingUserRound.delete(conversationId)) {
      // A user message landed mid-flight — answer it now.
      setTimeout(() => void runGroupRound(conversationId, { automated: false }), 0);
    }
    void maybeSummarize(conversationId); // groups summarize too (spec §8)
  }
}

/** Screen calls this every 60s while focused; internal gates do the rest. */
export function groupIdleTick(conversationId: string): void {
  const convo = getConversation(conversationId);
  if (!convo || convo.kind !== 'group' || busy.has(conversationId)) return;
  const cfg = parseGroupConfig(convo.groupConfig);
  if (!cfg.background) return;
  const last = lastTick.get(conversationId) ?? 0;
  if (Date.now() - last < 3 * 60_000) return;
  if (autoUsedToday(conversationId) >= cfg.dailyCap) return;
  lastTick.set(conversationId, Date.now());
  if (Math.random() > 0.4) return; // most ticks stay quiet — silence is realistic
  void runGroupRound(conversationId, { automated: true });
}

/** On opening a group: reconstruct what they talked about while away. */
export async function groupCatchUp(conversationId: string): Promise<void> {
  const convo = getConversation(conversationId);
  if (!convo || convo.kind !== 'group' || busy.has(conversationId)) return;
  const cfg = parseGroupConfig(convo.groupConfig);
  if (!cfg.background) return;
  const all = listMessages(conversationId);
  const lastMsg = all[all.length - 1];
  if (!lastMsg) return;
  const awayMs = Date.now() - lastMsg.createdAt;
  const remaining = cfg.dailyCap - autoUsedToday(conversationId);
  const plan = planCatchup(awayMs, remaining);
  if (plan.length === 0) return;
  busy.add(conversationId);
  const gen = bumpGen(conversationId);
  try {
    const apiKey = await getApiKey();
    if (!apiKey) return;
    const members = listGroupMembers(conversationId);
    if (members.length === 0) return;
    const nameById = new Map(
      listCharacters().map((c) => [c.id, getPersona(c.personaId)?.name ?? '她']),
    );
    const nameOf = (sid: string | null) => (sid ? nameById.get(sid) ?? '她' : getUserNickname());
    const stickers = listStickers();
    const stickerName = (sid: string) => stickers.find((s) => s.id === sid)?.label ?? null;
    const withSummary = (t: string): string =>
      convo.summary ? `【此前群聊总结】${convo.summary}\n\n${t}` : t;
    const leaveAt = lastMsg.createdAt;
    const span = Date.now() - leaveAt;
    let landedAny = false;
    for (const f of plan) {
      const raw = await chatOnce(apiKey, SUMMARIZER_MODEL, [
        {
          role: 'user',
          content:
            buildGroupDirectorPrompt(
              members.map((m) => ({ id: m.id, name: nameById.get(m.id) ?? '她' })),
              withSummary(renderTranscript(listMessages(conversationId), nameOf, stickerName)),
              1, 1,
            ) + '\n' + renderPrompt('group.catchup'),
        },
      ], 0.5).catch(() => '');
      if (aborted(conversationId, gen)) return;
      const picks = parseGroupDirector(raw, members.map((m) => m.id), 1);
      if (picks.length === 0) continue;
      const ch = members.find((m) => m.id === picks[0]);
      if (!ch) continue;
      const convoNow = getConversation(conversationId);
      if (!convoNow) return;
      try {
        const ok = await speakerLine(
          convoNow, ch,
          withSummary(renderTranscript(listMessages(conversationId), nameOf, stickerName)),
          members,
          leaveAt + Math.floor(f * span),
        );
        if (ok) {
          bumpAuto(conversationId);
          landedAny = true;
        }
      } catch {
        // skip this line; the plan continues
      }
      if (aborted(conversationId, gen)) return;
    }
    if (landedAny) logMeta(conversationId, '💬 你不在的时候，她们聊了几句');
  } finally {
    busy.delete(conversationId);
    if (pendingUserRound.delete(conversationId)) {
      setTimeout(() => void runGroupRound(conversationId, { automated: false }), 0);
    }
  }
}
