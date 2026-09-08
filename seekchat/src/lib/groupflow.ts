// v2.2 group orchestration. Non-streaming: each speaker line lands as a
// complete message. All caps enforced by groupchat.ts pure code. Abort guard:
// a generation counter per group (a new user send or a fresh round bumps it;
// every await re-checks) — the v1.5 outreach pattern. Delete-during-flight
// re-checks the conversation after every await (v2.1 lesson; FKs are OFF).
const Notif = () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('expo-notifications') as typeof import('expo-notifications');
import {
  deleteMemory, getConversation, getPersona, getPref, insertMemory, insertMessage,
  listCharacters, listGroupMembers, listMemories, listMessages, listStickers,
  recallGroupMessage, removeGroupMember, setCharBalance, setConversationState, setGroupConfig,
  setGroupMemberMute, setGroupMemberRole, setPref, touchConversation, updateMessageContent,
} from './db';
import type { GroupMember } from './db';
import type { Character, Conversation } from './types';
import {
  buildGroupContext, buildGroupDirectorPrompt, buildSpeakerPrompt, chainCount, groupHomeNote,
  MAX_DIRECTOR_ROUNDS, parseGroupConfig, parseGroupDirector, parseMentions, pickFallbackSpeaker,
  planCatchup, renderTranscript, splitSpeakerBurst,
} from './groupchat';
import type { GroupConfig } from './groupchat';
import { chatOnce } from './deepseek';
import { getApiKey, getModel, getMsgCut, getTemperature, getUserNickname } from './settings';
import { buildCutPrompt, needsCut, parseCut } from './cutter';
import { SUMMARIZER_MODEL } from './constants';
import { applyMemoryOps, extractMemoryMarkers } from './memory';
import { extractGroupModMarkers } from './groupmarkers';
import {
  canAnnounce, canAppoint, canMute, canRecall, canRemove, canTransfer, clampMuteMinutes,
  isMutedNow, modTargetsLabel, rankOf, recallLine, USER_SUBJECT,
} from './grouproles';
import { parseProConfig } from './pro';
import { claimNextShare, encodeRedpacket, parseRedpacket } from './redpacket';
import { soulContextFor } from './soul';
import { extractStateTag, stripEchoedTimestamps } from './statetag';
import { extractStickerMarkers, resolveSticker } from './stickers';
import { renderPrompt } from './prompts';
import { acceptRepair, buildRepairPrompt, lintMarkers, normalizeActionMarkers } from './repair';
import { cents } from './transfer';
import { logMeta, maybeSummarize, notifyConversation } from './engine';

const gens = new Map<string, number>(); // per-group generation counter
const busy = new Set<string>();
const pendingUserRound = new Set<string>(); // user sent while a flight was up
let focusedGroup: string | null = null;
const lastTick = new Map<string, number>();
const speakingNow = new Map<string, string>(); // v2.5 named typing: convo id -> her name

export const setFocusedGroup = (id: string | null): void => void (focusedGroup = id);
export const isGroupBusy = (id: string): boolean => busy.has(id);
export const getGroupSpeaker = (id: string): string | null => speakingNow.get(id) ?? null;

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

/** User-facing group system line (v2.5): unlike logMeta this is NOT dev-gated —
 *  moderation events, join/leave, and failure notices are product UI in groups. */
export function groupSystemLine(conversationId: string, text: string): void {
  insertMessage(conversationId, 'assistant', text, 'complete', 'meta');
  touchConversation(conversationId);
  notifyConversation(conversationId);
}

/** Read-modify-write groupConfig JSON (v2.5 moderation writes go through this). */
function updateGroupConfig(
  conversationId: string, mutate: (c: GroupConfig) => GroupConfig,
): void {
  const convo = getConversation(conversationId);
  if (!convo) return;
  setGroupConfig(conversationId, JSON.stringify(mutate(parseGroupConfig(convo.groupConfig))));
}

/** The user's message ALWAYS lands (never dropped because a round is running);
 *  a send aborts any in-flight round/catch-up at its next await, then a fresh
 *  round picks up the new message once `busy` frees. */
async function userSend(conversationId: string, insert: () => void): Promise<void> {
  // Data-layer mute guard (v2.5): the input-bar banner is the primary UI, but
  // a marker-mute can land between the banner's tick and a send already in
  // flight — enforce it here too, not just on screen.
  const muteCfg = parseGroupConfig(getConversation(conversationId)?.groupConfig ?? null);
  if (muteCfg.userMutedUntil !== null && muteCfg.userMutedUntil > Date.now()) return;
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

/** Insert a user 红包 into the group, then let the room react (and grab it). */
export const sendGroupRedpacket = (conversationId: string, content: string): Promise<void> =>
  userSend(conversationId, () =>
    void insertMessage(conversationId, 'user', content, 'complete', 'redpacket'),
  );

async function speakerLine(
  convo: Conversation, ch: Character, transcript: string,
  members: GroupMember[], cfg: GroupConfig, stampAt?: number, grabNote?: string | null,
): Promise<boolean> {
  try {
    // Defense (v2.5): even if a caller's roster filtering missed it, a muted
    // member never gets to speak.
    if (isMutedNow(members.find((m) => m.id === ch.id)?.mutedUntil ?? null, Date.now())) return false;
    const apiKey = await getApiKey();
    const persona = getPersona(ch.personaId);
    if (!apiKey || !persona) return false;
    // 记忆回家 (v2.4): same gates both directions — 灵魂同步 on AND home 记忆库 on.
    // The list is captured HERE so her [忘记:n] indices match the numbering she saw.
    const homeConvo = getConversation(ch.homeConvoId);
    const memoryOn = ch.soulSync === 1 && homeConvo?.memoryEnabled === 1;
    const homeMems = memoryOn ? listMemories(ch.homeConvoId) : [];
    const names = members.map((m) => getPersona(m.personaId)?.name ?? '她').join('、');
    speakingNow.set(convo.id, persona.name);
    // 群操作标记教学 (final-review fix): she only ever learns the powers her
    // rank actually has — grouproles is still the law that enforces them.
    const rank = rankOf(ch.id, cfg, members.map((m) => ({ id: m.id, role: m.role })));
    const modPowers =
      renderPrompt('group.modmember') +
      (rank >= 2
        ? '\n' + renderPrompt('group.modadmin', { targets: modTargetsLabel(cfg.modConsent, getUserNickname()) })
        : '') +
      // v2.8: 任命/罢免/移出/转让群主 are owner-only — taught at rank 3 alone.
      (rank === 3 ? '\n' + renderPrompt('group.modowner', { userName: getUserNickname() }) : '');
    const out = await chatOnce(apiKey, getModel(), [
      {
        role: 'system',
        content: buildSpeakerPrompt({
          personaPrompt: persona.systemPrompt,
          soulContext: soulContextFor(ch, memoryOn ? homeMems : undefined),
          selfName: persona.name,
          groupName: convo.title,
          memberNames: `${names}、${getUserNickname()}`,
          transcript,
          modPowers,
        }),
      },
      { role: 'user', content: grabNote ? `（${grabNote}。现在轮到你发言）` : '（现在轮到你发言）' },
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
    let afterMemory = clean;
    if (memoryOn) {
      const mo = extractMemoryMarkers(clean);
      afterMemory = mo.clean;
      if (mo.adds.length > 0 || mo.removes.length > 0) {
        const { toAdd, removeIds } = applyMemoryOps(homeMems, mo);
        for (const rid of removeIds) deleteMemory(rid);
        for (const t of toAdd) insertMemory(ch.homeConvoId, t);
      }
    }
    // 群管理 markers (v2.5): she may ACT — rank decides. grouproles is the law.
    const mod = extractGroupModMarkers(afterMemory);
    let afterMod = mod.clean;
    const nickname = getUserNickname();
    const resolveTarget = (name: string): string | null => {
      if (name === nickname) return USER_SUBJECT;
      const hit = members.find((m) => (getPersona(m.personaId)?.name ?? '') === name);
      return hit ? hit.id : null;
    };
    const modLines: string[] = [];
    const roleRows = members.map((m) => ({ id: m.id, role: m.role }));
    for (const mu of mod.mute) {
      const target = resolveTarget(mu.name);
      if (!target || !canMute(ch.id, target, cfg, roleRows)) continue;
      const mins = clampMuteMinutes(mu.minutes, target === USER_SUBJECT);
      const until = Date.now() + mins * 60_000;
      if (target === USER_SUBJECT) {
        updateGroupConfig(convo.id, (c) => ({ ...c, userMutedUntil: until }));
      } else {
        setGroupMemberMute(convo.id, target, until);
      }
      modLines.push(`${persona.name} 禁言了 ${mu.name} ${mins}分钟`);
    }
    for (const name of mod.unmute) {
      const target = resolveTarget(name);
      if (!target || !canMute(ch.id, target, cfg, roleRows)) continue;
      if (target === USER_SUBJECT) {
        updateGroupConfig(convo.id, (c) => ({ ...c, userMutedUntil: null }));
      } else {
        setGroupMemberMute(convo.id, target, null);
      }
      modLines.push(`${persona.name} 解除了 ${name} 的禁言`);
    }
    if (mod.recallSelf) {
      const mine = [...listMessages(convo.id)]
        .reverse()
        .find((m) => m.kind === 'normal' && m.speakerId === ch.id);
      if (mine) recallGroupMessage(convo.id, mine.id, recallLine(persona.name, null));
    }
    if (mod.announce && canAnnounce(ch.id, cfg, roleRows)) {
      updateGroupConfig(convo.id, (c) => ({
        ...c, announcement: { text: mod.announce!, by: ch.id, at: Date.now() },
      }));
      modLines.push(`${persona.name} 更新了群公告`);
    }
    for (const line of mod.noteAppends) {
      updateGroupConfig(convo.id, (c) => ({
        ...c,
        notepad: {
          text: (((c.notepad?.text ?? '') + '\n' + line).trim()).slice(0, 2000),
          by: ch.id, at: Date.now(),
        },
      }));
    }
    // v2.8 owner-character agency: appoint/dismiss/remove batch into the same
    // 📣 modLines as the loops above; transfer gets its own 👑 line below (the
    // one exception to the shared glyph).
    for (const name of mod.recallOthers) {
      const target = resolveTarget(name);
      if (!target || !canRecall(ch.id, target, cfg, roleRows)) continue;
      const row = [...listMessages(convo.id)].reverse().find((m) => m.kind === 'normal'
        && (target === USER_SUBJECT ? m.role === 'user' : m.speakerId === target));
      if (!row) continue;
      // No modLines push here (review fix): recallGroupMessage already
      // rewrites the target row into a tombstone naming who recalled whom —
      // pushing the same text again would double it into a second 📣 line.
      // Matches recallSelf's existing single-line behavior.
      recallGroupMessage(convo.id, row.id, recallLine(persona.name, name));
    }
    for (const name of mod.appoint) {
      const target = resolveTarget(name);
      if (!target || target === USER_SUBJECT || !canAppoint(ch.id, cfg, roleRows)) continue;
      setGroupMemberRole(convo.id, target, 'admin');
      modLines.push(`${persona.name} 任命了 ${name} 为管理员`);
    }
    for (const name of mod.dismiss) {
      const target = resolveTarget(name);
      if (!target || target === USER_SUBJECT || !canAppoint(ch.id, cfg, roleRows)) continue;
      setGroupMemberRole(convo.id, target, 'member');
      modLines.push(`${persona.name} 罢免了 ${name} 的管理员身份`);
    }
    for (const name of mod.remove) {
      const target = resolveTarget(name);
      if (!target || !canRemove(ch.id, target, cfg, roleRows)) continue;
      removeGroupMember(convo.id, target);
      modLines.push(`「${name}」被移出了群聊`);
    }
    for (const line of modLines) groupSystemLine(convo.id, `📣 ${line}`);
    // 转让群主 (v2.8): owner-only, and the ONE target the user themselves can
    // hold — the character's own gesture reopens the door a prior transfer
    // closed. First-wins already enforced by extractGroupModMarkers.
    if (mod.transfer) {
      const target = resolveTarget(mod.transfer);
      if (target && canTransfer(ch.id, cfg)) {
        updateGroupConfig(convo.id, (c) => ({ ...c, owner: target }));
        groupSystemLine(convo.id, `👑 ${persona.name} 把群主之位转让给了 ${mod.transfer}`);
      }
    }
    const st = stickers.length > 0
      ? extractStickerMarkers(afterMod)
      : { clean: afterMod, labels: [] as string[] };
    const body = st.clean.trim().slice(0, 500);
    if (!getConversation(convo.id)) return false; // deleted mid-flight
    let landed = false;
    if (body) {
      // '---' burst first (v2.4): she split it herself — honor it as real rows.
      // 消息切割 (v2.3) only runs when she sent one unbroken block.
      let chunks = splitSpeakerBurst(body);
      if (chunks.length === 0) chunks = [body];
      if (chunks.length === 1 && getMsgCut() && needsCut(chunks[0])) {
        try {
          const rawCut = await chatOnce(apiKey, SUMMARIZER_MODEL, [
            { role: 'user', content: buildCutPrompt(chunks[0]) },
          ], 0);
          const segs = parseCut(chunks[0], rawCut);
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
          t0 + i, null, ch.id, // strictly increasing stamps — every chunk, including 0
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
  } finally {
    speakingNow.delete(convo.id);
  }
}

/** Latest live 红包: claim one share for the speaker, credit her home wallet.
 *  A claim's `cents` is the redpacket module's own integer 分 minor-unit;
 *  charBalance/initBalance are 元 like the rest of the DM transfer system
 *  (see engine.ts sendTransfer) — convert on credit, same as `cents()` there. */
function claimForSpeaker(conversationId: string, ch: GroupMember): string | null {
  const packetRow = [...listMessages(conversationId)].reverse().find(
    (m) => m.kind === 'redpacket',
  );
  if (!packetRow) return null;
  const packet = parseRedpacket(packetRow.content);
  if (!packet) return null;
  const res = claimNextShare(packet, ch.id, Date.now());
  if (!res) return null;
  updateMessageContent(packetRow.id, encodeRedpacket(res.packet));
  const home = getConversation(ch.homeConvoId);
  if (home) {
    const cfgPro = parseProConfig(getPersona(ch.personaId)?.proConfig ?? null);
    setCharBalance(
      ch.homeConvoId,
      cents((home.charBalance ?? cfgPro?.initBalance ?? 0) + res.claim.cents / 100),
    );
  }
  return `你刚在群里抢到了 ${(res.claim.cents / 100).toFixed(2)} 元红包` +
    (res.packet.note ? `（备注「${res.packet.note}」）` : '') +
    '——自然地反应一下';
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
    let members = listGroupMembers(conversationId);
    if (members.length === 0) return;
    // Names resolve from the FULL registry: a removed member's old lines keep
    // her name. `members` is current membership (refreshed each round below —
    // 禁言 can land mid-round via markers); `active` (unmuted) is who may
    // actually SPEAK next.
    const nameById = new Map(
      listCharacters().map((c) => [c.id, getPersona(c.personaId)?.name ?? '她']),
    );
    const nameOf = (sid: string | null) => (sid ? nameById.get(sid) ?? '她' : getUserNickname());
    const stickers = listStickers();
    const stickerName = (sid: string) => stickers.find((s) => s.id === sid)?.label ?? null;
    // Standing context (公告/笔记/总结) ahead of the transcript — write-only
    // summaries/announcements/notes are worthless if she never sees them.
    const withCtx = (t: string): string => buildGroupContext(t, cfg, convo.summary);
    const mutedMentionNotified = new Set<string>(); // once per muted-mention per call

    let landedAny = false;
    for (let round = 0; round < MAX_DIRECTOR_ROUNDS; round++) {
      if (!getConversation(conversationId)) return; // deleted mid-round — stop spending
      members = listGroupMembers(conversationId); // 禁言/角色 can change mid-round via markers
      const active = members.filter((m) => !isMutedNow(m.mutedUntil, Date.now()));
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
      // Mentions resolve against the FULL roster (a muted member's name must
      // still match, so we can tell the user why she's silent) — v2.5.
      // `mentioned` then narrows to `active`: a muted mention is a guaranteed
      // non-reply, surfaced via the 🔇 notice below.
      const lastUser = [...all].reverse().find((m) => m.role === 'user');
      const mentionedAll =
        round === 0 && lastUser && lastUser.kind === 'normal' && !opts.automated
          ? parseMentions(
              lastUser.content,
              members.map((m) => ({ id: m.id, name: nameById.get(m.id) ?? '' })),
            )
          : [];
      const mentioned = mentionedAll.filter((id) => active.some((m) => m.id === id));
      for (const id of mentionedAll) {
        if (mentioned.includes(id) || mutedMentionNotified.has(id)) continue;
        mutedMentionNotified.add(id);
        groupSystemLine(conversationId, `🔇 ${nameById.get(id) ?? '她'} 被禁言中，暂时不能回应`);
      }
      const raw = await chatOnce(apiKey, SUMMARIZER_MODEL, [
        {
          role: 'user',
          content:
            buildGroupDirectorPrompt(
              active.map((m) => ({ id: m.id, name: nameById.get(m.id) ?? '她' })),
              withCtx(renderTranscript(all, nameOf, stickerName)),
              cfg.chainCap - chain,
              cfg.maxSpeakers,
            ) +
            (mentioned.length
              ? `\n用户@了：${mentioned.map((x) => nameById.get(x)).join('、')}——她们必须回应。`
              : '') +
            (round === 0 && !opts.automated ? '\n' + renderPrompt('group.mustreply') : ''),
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
          ...parseGroupDirector(
            raw,
            active.map((m) => ({ id: m.id, name: nameById.get(m.id) ?? '' })),
            cfg.maxSpeakers,
          ),
        ]),
      ].slice(0, Math.max(mentioned.length, Math.min(cfg.maxSpeakers, budget)));
      if (picks.length === 0) break;
      for (const id of picks) {
        const ch = active.find((m) => m.id === id);
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
          const grabNote = claimForSpeaker(conversationId, ch);
          const ok = await speakerLine(
            convo, ch,
            withCtx(renderTranscript(listMessages(conversationId), nameOf, stickerName)),
            members, cfg, undefined, grabNote,
          );
          if (ok) {
            landedAny = true;
            if (opts.automated) bumpAuto(conversationId);
          }
        } catch {
          if (opts.automated) {
            logMeta(ch.homeConvoId, '🌙 她想在群里说话，但网络没让她说完');
          } else {
            groupSystemLine(conversationId, '🌙 她想在群里说话，但网络没让她说完');
          }
        }
        if (aborted(conversationId, gen)) return;
      }
    }

    if (!opts.automated && !landedAny) {
      if (aborted(conversationId, gen) || !getConversation(conversationId)) return;
      const active = members.filter((m) => !isMutedNow(m.mutedUntil, Date.now()));
      const lastUserMsg = [...listMessages(conversationId)].reverse().find((m) => m.role === 'user');
      const mentionedNow = lastUserMsg && lastUserMsg.kind === 'normal'
        ? parseMentions(lastUserMsg.content, active.map((m) => ({ id: m.id, name: nameById.get(m.id) ?? '' })))
        : [];
      // 兜底 (v2.5): the director failed or chose silence after the user spoke —
      // someone answers anyway, no director involved. Muted members are not
      // eligible fallback speakers either.
      const pick = pickFallbackSpeaker(active, mentionedNow);
      if (pick) {
        try {
          const ok = await speakerLine(
            convo, pick,
            withCtx(renderTranscript(listMessages(conversationId), nameOf, stickerName)),
            members, cfg,
          );
          if (ok) landedAny = true;
        } catch {
          // visible line below
        }
      }
      if (aborted(conversationId, gen)) return;
      if (!landedAny && getConversation(conversationId)) {
        groupSystemLine(conversationId, '🌙 网络开小差了，她们没能接上话——再发一句试试');
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
    const withCtx = (t: string): string => buildGroupContext(t, cfg, convo.summary);
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
              withCtx(renderTranscript(listMessages(conversationId), nameOf, stickerName)),
              1, 1,
            ) + '\n' + renderPrompt('group.catchup'),
        },
      ], 0.5).catch(() => '');
      if (aborted(conversationId, gen)) return;
      const picks = parseGroupDirector(
        raw,
        members.map((m) => ({ id: m.id, name: nameById.get(m.id) ?? '' })),
        1,
      );
      if (picks.length === 0) continue;
      const ch = members.find((m) => m.id === picks[0]);
      if (!ch) continue;
      const convoNow = getConversation(conversationId);
      if (!convoNow) return;
      try {
        const ok = await speakerLine(
          convoNow, ch,
          withCtx(renderTranscript(listMessages(conversationId), nameOf, stickerName)),
          members, cfg,
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
