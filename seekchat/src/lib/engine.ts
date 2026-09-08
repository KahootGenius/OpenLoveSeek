import * as FileSystem from 'expo-file-system/legacy';
import {
  deleteMemory, getCharacterByPersona, getConversation, getMessage, getPersona, getPref,
  insertMemory, insertMessage, listCharacters, listChatReadablePosts, listMemories, listMessages,
  listRefImages, listStalePendingImages, listStickers, setCharBalance, setConversationState,
  setCurveDrift, setDiscipline, setMasterHonorific, setMasterRules, setPref, setSummary,
  touchConversation, updateMessageContent,
} from './db';
import { buildDiaryInstructions, buildDiarySection } from './moments';
import {
  buildTransferSection, cents, encodeTransfer, extractTransferMarker, parseTransfer,
  transferModelText,
} from './transfer';
import { extractPatMarker } from './markers';
import {
  applyMemoryOps, buildMemoryEvidence, buildMemoryInstructions, extractMemoryMarkers,
} from './memory';
import { routeTagExtras } from './extras';
import { buildStickerPromptSection, extractStickerMarkers, resolveSticker } from './stickers';
import {
  buildFalInput, FAL_LITE_EDIT, FAL_LITE_T2I, FalError, falGenerate, userMessageForFal,
} from './fal';
import {
  canGenerateToday, composeSceneOnlyPrompt, composeScenePrompt, extractImageMarker,
  failStalePending, imageDayKey, imageModelText, imagePlaceholder, PhotoShot,
} from './imagegen';
import { buildYanderePromptSection, extractYandereMarkers } from './yandere';
import {
  appendRule, buildMasterPromptSection, clampDiscipline, DISCIPLINE_START, extractMasterMarkers,
  hasHonorific, HONORIFIC_PENALTY,
} from './master';
import { applyGrowth, buildCurveLine, dayPartAt, parseDrift } from './curve';
import {
  getApiKey, getDevMode, getFalKey, getHistoryBudget, getImageDailyCap, getImageFeature,
  getLocationEnabled, getManualPlace, getMergeHoldSec, getMergeReplies, getModel, getMsgCut,
  getTemperature, getTempMode, getThinkingEnabled, getUsageMode, getUserBalance, getUserNickname,
  setUserBalance,
} from './settings';
import {
  buildTempClassifierPrompt, currentUserBurst, parseTempChoice, TEMP_BY_CHOICE,
} from './temp';
import { renderPrompt } from './prompts';
import { composeDmPrompt, type DmPromptParts } from './prompt-envelope';
import {
  acceptRepair, buildRepairPrompt, lintMarkers, narrationSuspects, normalizeActionMarkers,
} from './repair';
import { buildCutPrompt, needsCut, parseCut } from './cutter';
import { detectTic, pickVarietyNudge, recentAssistantTurnBodies } from './tic';
import { holdDelay } from './hold';
import { catchupTriggerText, watchTriggerText } from './watch';
import { buildPlaceLine, deviceTimeZone } from './geo';
import {
  buildUsageEvidence, buildUsageInstructions, shouldCheckUsage,
} from './usage';
import {
  getLastUsageCheckAt, getLiveGeoFresh, getLiveUsage, markUsageChecked,
} from './livestate';
import { buildRequestMessages, selectWindow, shouldSummarize } from './context';
import {
  SUMMARIZER_MODEL, SUMMARY_PREFIX,
  TRIGGER_CATCHUP, TRIGGER_NUDGE,
} from './constants';
import { ApiError, chatOnce, streamChat } from './deepseek';
import {
  activityAt, canFireTrigger, decayedMood, isAsleepAt, TriggerPath,
} from './life';
import {
  buildExampleSection, buildProSections, buildRealismRules, buildStateBlock,
  fmtTimestamp, hasRealismConfig, parseProConfig,
} from './pro';
import {
  cleanDraftForDisplay, extractStateTag, stripEchoedTimestamps, stripLeakedStateTags,
} from './statetag';
import type { Message } from './types';

export interface TurnCallbacks {
  onUserSaved?: () => void;
  onDelta: (fullDraft: string) => void;
  onDone: (message: Message) => void;
  onError: (error: ApiError, partialSaved: boolean) => void;
  /** A newer user message superseded this stream — the partial is discarded silently. */
  onSuperseded?: () => void;
}

const controllers = new Map<string, AbortController>();
const summarizing = new Set<string>();
const activeTurns = new Set<string>();

// Real builds install a guard that runs a foreground service while a turn
// streams, so backgrounding the app no longer kills the generation.
let turnGuard: { begin: () => void; end: () => void } | null = null;
export function setTurnGuard(g: { begin: () => void; end: () => void } | null): void {
  turnGuard = g;
}

// ---- 合并回复 (merge replies): hold the turn while the user's burst settles ----
const holdTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingHold = new Map<string, TurnCallbacks>();
const lastTypingAt = new Map<string, number>();
const supersededAborts = new Set<string>();

/** The chat screen reports keyboard activity; a non-empty input box delays the reply. */
export function noteTyping(conversationId: string, hasText: boolean): void {
  if (hasText) lastTypingAt.set(conversationId, Date.now());
  else lastTypingAt.delete(conversationId);
}

export function isHoldPending(conversationId: string): boolean {
  return pendingHold.has(conversationId);
}

function cancelHold(conversationId: string): void {
  const t = holdTimers.get(conversationId);
  if (t) clearTimeout(t);
  holdTimers.delete(conversationId);
  pendingHold.delete(conversationId);
}

function armHold(conversationId: string, cb: TurnCallbacks): void {
  pendingHold.set(conversationId, cb);
  const t = holdTimers.get(conversationId);
  if (t) clearTimeout(t);
  const delay = holdDelay({
    baseMs: getMergeHoldSec() * 1000,
    lastTypingAt: lastTypingAt.get(conversationId) ?? 0,
    now: Date.now(),
  });
  holdTimers.set(conversationId, setTimeout(() => fireHold(conversationId), delay));
}

function fireHold(conversationId: string): void {
  holdTimers.delete(conversationId);
  const cb = pendingHold.get(conversationId);
  if (!cb) return;
  const stillTyping =
    holdDelay({ baseMs: 0, lastTypingAt: lastTypingAt.get(conversationId) ?? 0, now: Date.now() }) > 0;
  if (stillTyping || activeTurns.has(conversationId)) {
    armHold(conversationId, cb); // wait some more
    return;
  }
  pendingHold.delete(conversationId);
  void runTurn(conversationId, cb);
}

/** Merge mode queues the turn behind a hold; otherwise it runs immediately. */
function scheduleOrRun(conversationId: string, cb: TurnCallbacks): Promise<void> {
  if (!getMergeReplies()) return runTurn(conversationId, cb);
  // The controller exists for the WHOLE turn (created before any await), so a
  // mid-turn fragment can always supersede — no stale-flag window.
  const c = controllers.get(conversationId);
  if (c) {
    supersededAborts.add(conversationId);
    c.abort();
  }
  armHold(conversationId, cb);
  return Promise.resolve();
}

// Screens subscribe to learn about turns they did not initiate
// (auto-reach fires from the app-level scheduler).
const messageListeners = new Set<(conversationId: string) => void>();
export function subscribeMessages(fn: (conversationId: string) => void): () => void {
  messageListeners.add(fn);
  return () => messageListeners.delete(fn);
}
const notifyMessage = (conversationId: string): void =>
  messageListeners.forEach((fn) => fn(conversationId));

/** Public notifier so background ingest can refresh an open chat screen. */
export const notifyConversation = (conversationId: string): void => notifyMessage(conversationId);

// Yandere device actions (vibrate / biometric lock) the model triggered.
export interface YandereAction {
  conversationId: string;
  vibrate: boolean;
  lock: boolean;
  hold: boolean;
  release: boolean;
  command?: string | null;
  countdown?: number | null;
  demand?: string | null;
}
const actionListeners = new Set<(a: YandereAction) => void>();
export function subscribeYandere(fn: (a: YandereAction) => void): () => void {
  actionListeners.add(fn);
  return () => actionListeners.delete(fn);
}
const notifyAction = (a: YandereAction): void => actionListeners.forEach((fn) => fn(a));

export function stopTurn(conversationId: string): void {
  controllers.get(conversationId)?.abort();
}

/**
 * Developer-mode transparency line ('👀 她注意到你切到了…'). Persisted as a
 * 'meta' row — kept out of the model window, shown in chat only when 开发者模式
 * is on. No-op when the toggle is off, so the DB isn't cluttered in immersive
 * mode. Callers pass devMode explicitly (avoids a settings import cycle here).
 */
export function logMeta(conversationId: string, text: string): void {
  if (!getDevMode()) return;
  insertMessage(conversationId, 'assistant', text, 'complete', 'meta');
  notifyMessage(conversationId);
}

export function isStreaming(conversationId: string): boolean {
  return controllers.has(conversationId);
}

/** True while a rolling-summary API call is in flight — the 重置总结 button
 *  disables itself so the reset can't be overwritten by a landing summary. */
export function isSummarizing(conversationId: string): boolean {
  return summarizing.has(conversationId);
}

/** newText === null means "retry": re-send with the last user message already stored. */
export async function sendTurn(
  conversationId: string,
  newText: string | null,
  cb: TurnCallbacks,
  quotedId?: string | null,
): Promise<void> {
  const convo = getConversation(conversationId);
  if (!convo) return;

  // Persist before transmit — and before the first await, so the screen can
  // render the user's bubble immediately and nothing is lost on any failure.
  if (newText === null) {
    await runTurn(conversationId, cb); // explicit retry — no hold
    return;
  }
  insertMessage(conversationId, 'user', newText, 'complete', 'normal', null, undefined, quotedId ?? null);
  touchConversation(conversationId);
  cb.onUserSaved?.();
  await scheduleOrRun(conversationId, cb);
}

/** Life outreach: inserts a hidden trigger turn if eligibility passes. */
export async function fireTrigger(
  conversationId: string,
  path: TriggerPath,
  cb: TurnCallbacks,
): Promise<boolean> {
  const convo = getConversation(conversationId);
  if (!convo) return false;
  const persona = getPersona(convo.personaId);
  const cfg = persona ? parseProConfig(persona.proConfig) : null;
  // meta/experience rows are ambience, not conversation — they must not mask
  // an unanswered outreach or reset the catch-up clock.
  const all = listMessages(conversationId).filter(
    (m) => m.kind !== 'meta' && m.kind !== 'experience',
  );
  const last = all[all.length - 1] ?? null;
  const prevKind = all.length >= 2 ? all[all.length - 2].kind : null;
  const ok = canFireTrigger({
    path,
    lifeEnabled: convo.lifeEnabled === 1,
    streaming: activeTurns.has(conversationId),
    lastMessage: last ? { kind: last.kind, role: last.role, createdAt: last.createdAt } : null,
    prevKind,
    asleep: isAsleepAt(cfg?.schedule, new Date()),
    nowMs: Date.now(),
  });
  if (!ok) return false;
  insertMessage(
    conversationId, 'user',
    path === 'catchup' ? TRIGGER_CATCHUP : TRIGGER_NUDGE,
    'complete', 'trigger',
  );
  cb.onUserSaved?.();
  await runTurn(conversationId, cb);
  return true;
}

/** 病娇 leave-negotiation: the user asks to leave; she may hold ([病娇:挽留]) or let go. */
export async function requestLeave(conversationId: string, cb: TurnCallbacks): Promise<void> {
  if (activeTurns.has(conversationId)) return;
  const convo = getConversation(conversationId);
  if (!convo) return;
  insertMessage(
    conversationId, 'user',
    '[系统：用户想结束这次聊天、返回列表。以你的方式回应。若你不舍得、想留住他，必须单独一行明确写出[病娇:挽留]；否则视为同意他离开。]',
    'complete', 'trigger',
  );
  cb.onUserSaved?.();
  await runTurn(conversationId, cb, { leaveRequest: true });
}

/** Sends one of the imported stickers as a user turn. */
export async function sendSticker(
  conversationId: string,
  stickerId: string,
  cb: TurnCallbacks,
): Promise<void> {
  if (!getMergeReplies() && isStreaming(conversationId)) return;
  insertMessage(conversationId, 'user', stickerId, 'complete', 'sticker');
  touchConversation(conversationId);
  cb.onUserSaved?.();
  await scheduleOrRun(conversationId, cb);
}

/** 转账: user → character. Deducts the user's wallet, credits hers (she accepts),
 *  inserts a received card, and she reacts. Returns false if funds are short. */
export async function sendTransfer(
  conversationId: string,
  amount: number,
  cb: TurnCallbacks,
): Promise<boolean> {
  const amt = cents(amount);
  if (amt <= 0 || getUserBalance() < amt) return false;
  const convo = getConversation(conversationId);
  if (!convo) return false;
  if (!getMergeReplies() && isStreaming(conversationId)) return false;
  const persona = getPersona(convo.personaId);
  const cfg = persona ? parseProConfig(persona.proConfig) : null;
  setUserBalance(getUserBalance() - amt);
  setCharBalance(conversationId, cents((convo.charBalance ?? cfg?.initBalance ?? 0) + amt));
  insertMessage(
    conversationId, 'user',
    encodeTransfer({ amount: amt, status: 'received' }),
    'complete', 'transfer',
  );
  touchConversation(conversationId);
  cb.onUserSaved?.();
  await scheduleOrRun(conversationId, cb);
  return true;
}

/** 领取: user taps her pending transfer card. Credits the user; marks received. */
export function receiveTransfer(messageId: string): number {
  const m = getMessage(messageId);
  if (!m || m.kind !== 'transfer') return 0;
  const t = parseTransfer(m.content);
  if (!t || t.status !== 'pending') return 0;
  setUserBalance(getUserBalance() + t.amount);
  updateMessageContent(messageId, encodeTransfer({ amount: t.amount, status: 'received' }));
  notifyMessage(m.conversationId);
  return t.amount;
}

/** 小游戏: sends an RNG game result as a user turn; she reacts to the outcome. */
export async function sendGame(
  conversationId: string,
  resultText: string,
  cb: TurnCallbacks,
): Promise<void> {
  if (!getMergeReplies() && isStreaming(conversationId)) return;
  insertMessage(conversationId, 'user', resultText, 'complete', 'game');
  touchConversation(conversationId);
  cb.onUserSaved?.();
  await scheduleOrRun(conversationId, cb);
}

/** 拍一拍: sends the persona's pat text as a user turn rendered as a system line. */
export async function sendPat(conversationId: string, cb: TurnCallbacks): Promise<void> {
  const convo = getConversation(conversationId);
  if (!convo || (!getMergeReplies() && isStreaming(conversationId))) return;
  const persona = getPersona(convo.personaId);
  const cfg = persona ? parseProConfig(persona.proConfig) : null;
  const patText = cfg?.patText?.trim() || '我拍了拍你';
  insertMessage(conversationId, 'user', patText, 'complete', 'pat');
  touchConversation(conversationId);
  cb.onUserSaved?.();
  await scheduleOrRun(conversationId, cb);
}

/** Shared body for the two 屏幕窥视 reactions (live switch / catch-up on return). */
async function fireReaction(
  conversationId: string,
  triggerText: string,
  metaNote: string,
  cb: TurnCallbacks,
): Promise<boolean> {
  if (activeTurns.has(conversationId)) return false;
  const convo = getConversation(conversationId);
  if (!convo) return false;
  logMeta(conversationId, metaNote);
  insertMessage(conversationId, 'user', triggerText, 'complete', 'trigger');
  cb.onUserSaved?.();
  await runTurn(conversationId, cb);
  return true;
}

/** 屏幕窥视: she noticed which app the user switched to right now. */
export const fireWatch = (conversationId: string, appLabel: string, cb: TurnCallbacks) =>
  fireReaction(conversationId, watchTriggerText(appLabel), `👀 她注意到你切到了「${appLabel}」`, cb);

/** Catch-up: on return to the app, she reacts to what you did while away. */
export const fireCatchup = (conversationId: string, appLabel: string, cb: TurnCallbacks) =>
  fireReaction(conversationId, catchupTriggerText(appLabel), `👀 她发现你刚才用了「${appLabel}」`, cb);

async function runTurn(
  conversationId: string,
  cb: TurnCallbacks,
  opts?: { leaveRequest?: boolean },
): Promise<void> {
  // Any directly-run turn (trigger, retry, leave request) answers the queued
  // fragments too — they're already in the window. Kill the pending hold so it
  // can't fire a second reply.
  cancelHold(conversationId);
  const convo = getConversation(conversationId);
  if (!convo) return;
  const persona = getPersona(convo.personaId);
  if (!persona) return;
  activeTurns.add(conversationId);
  // Controller exists for the whole turn — before any await — so supersede,
  // stopTurn and isStreaming see a consistent picture from the first tick.
  const controller = new AbortController();
  controllers.set(conversationId, controller);
  turnGuard?.begin();
  try {
    await runTurnInner(conversationId, convo, persona, controller, cb, opts);
  } finally {
    controllers.delete(conversationId);
    activeTurns.delete(conversationId);
    supersededAborts.delete(conversationId);
    turnGuard?.end();
    // Messages queued while this turn streamed (supersede race, or a fragment
    // that arrived post-abort): give them their own hold cycle.
    const queued = pendingHold.get(conversationId);
    if (queued) armHold(conversationId, queued);
  }
}

async function runTurnInner(
  conversationId: string,
  convo: NonNullable<ReturnType<typeof getConversation>>,
  persona: NonNullable<ReturnType<typeof getPersona>>,
  controller: AbortController,
  cb: TurnCallbacks,
  opts?: { leaveRequest?: boolean },
): Promise<void> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    cb.onError(new ApiError('auth', 'no key'), false);
    return;
  }

  const cfg = parseProConfig(persona.proConfig);
  const realism = convo.lifeEnabled === 1 || hasRealismConfig(cfg);

  // 照片 (v2.6): teach the marker only when a generation could actually fire —
  // frozen refs + the global switch + a usable fal key (sticker-pattern
  // gating: never teach what can't work). One await here, alongside apiKey
  // above, rather than re-fetching later — the reply-side gate below reuses it.
  const photosOn = getImageFeature() && persona.refsFrozen === 1;
  const falKey = photosOn ? await getFalKey() : null;
  // meta rows are for the user's eyes only (dev-mode transparency) — they must
  // never reach the model or count as a turn. Experience rows stamped in the
  // FUTURE (staggered 朋友圈 reveals) stay hidden until their moment arrives.
  const all = listMessages(conversationId).filter(
    (m) => m.kind !== 'meta' && !(m.kind === 'experience' && m.createdAt > Date.now()),
  );
  const window = selectWindow(all, getHistoryBudget());
  const nowD = new Date();

  const promptParts: DmPromptParts = {
    persona: persona.systemPrompt,
    coreTruth: renderPrompt('core.truth'),
    examples: buildExampleSection(cfg ?? {}),
  };

  let usagePeeked = false; // 'check'-mode screen-usage peek, committed only on success
  if (hasRealismConfig(cfg)) promptParts.profile = buildProSections(cfg!);
  if (realism) {
    const tailId = all[all.length - 1]?.id;
    const prevNormal = [...all].reverse().find((m) => m.kind === 'normal' && m.id !== tailId);
    const lastReply = [...all]
      .reverse()
      .find((m) => m.kind === 'normal' && m.role === 'assistant')?.content;
    const mood = decayedMood(
      convo.moodLabel, convo.moodIntensity, convo.moodUpdatedAt,
      cfg?.moodBaseline ?? '平静', nowD.getTime(),
    );
    promptParts.state = buildStateBlock({
      now: nowD,
      lastMessageAt: prevNormal ? prevNormal.createdAt : null,
      activity: activityAt(cfg?.schedule, nowD),
      mood,
      thought: convo.currentThought,
      lastReply: lastReply ? stripLeakedStateTags(lastReply) : null,
    });
    if (cfg?.moodCurve) {
      promptParts.curve = buildCurveLine(cfg.moodCurve, parseDrift(convo.curveDrift), nowD);
    }
    // Timezone always (the cheap, bulletproof 'staying up late' fix); a fresh
    // GPS city only when the user enabled 位置感知; a manual city needs neither.
    promptParts.place = buildPlaceLine({
      tz: deviceTimeZone(),
      fix: getLocationEnabled() ? getLiveGeoFresh() : null,
      manualPlace: getManualPlace(),
    });
    const growthEnabled = !!cfg?.moodCurve && cfg.curveGrowth !== false;
    const patTemplate = cfg?.patByChar?.trim() || `你拍了拍${getUserNickname()}`;
    promptParts.realism =
      buildRealismRules(convo.lifeEnabled === 1, growthEnabled, patTemplate);

    // 今日屏幕使用: 'always' rides every request; 'check' peeks occasionally.
    // The 'check' side effects (spend the window, log the meta note) are
    // COMMITTED only if the turn succeeds — see usagePeeked below.
    const usageMode = getUsageMode();
    if (usageMode === 'always') {
      const usage = buildUsageEvidence(getLiveUsage());
      if (usage) {
        promptParts.usageInstructions = buildUsageInstructions();
        promptParts.usage = usage;
      }
    } else if (shouldCheckUsage(usageMode, getLastUsageCheckAt(), nowD.getTime())) {
      const usage = buildUsageEvidence(getLiveUsage());
      if (usage) {
        promptParts.usageInstructions = buildUsageInstructions();
        promptParts.usage = usage;
        usagePeeked = true;
      }
    }
  }

  if (convo.summary) promptParts.summary = SUMMARY_PREFIX + convo.summary;

  // 记忆库: durable model-curated memory, injected every request. The list is
  // captured HERE so the [忘记:n] indices she writes match the numbering she saw.
  const memoryOn = convo.memoryEnabled === 1;
  const memories = memoryOn ? listMemories(conversationId) : [];
  if (memoryOn) {
    promptParts.memoryInstructions = buildMemoryInstructions(memories);
    promptParts.memory = buildMemoryEvidence(memories);
  }

  // 复读检测 (v2.3): when 3+ of her recent replies open with the same phrase,
  // one nudge line rides along. Deterministic, self-clearing.
  // Turn-level bodies: the cutter stores one reply as several rows — rejoin
  // them so 变化检测 measures what she actually authored, not storage shape.
  const recentBodies = recentAssistantTurnBodies(all)
    .slice(-8)
    .map((s) => stripLeakedStateTags(s));
  const ticPhrase = detectTic(recentBodies);
  if (ticPhrase) {
    promptParts.tic = renderPrompt('tic.nudge', { phrase: ticPhrase });
  } else {
    // 变化检测 (v2.4): one corrective line max — 复读 > 结构 > 长度.
    const nudge = pickVarietyNudge(recentBodies);
    if (nudge) {
      promptParts.variety =
        nudge.kind === 'structure'
          ? renderPrompt('variety.structure', { pattern: nudge.pattern })
          : renderPrompt('variety.length');
    }
  }

  // 聊天内可读 diary (v2.1): the user marked these readable — she can bring
  // them up in chat herself. Only in HER home chat, only posts she may see.
  const meChar = getCharacterByPersona(convo.personaId);
  if (meChar && meChar.homeConvoId === conversationId) {
    const diary = buildDiarySection(listChatReadablePosts(), meChar.id);
    if (diary) {
      promptParts.diaryInstructions = buildDiaryInstructions();
      promptParts.diary = diary;
    }
  }

  const stickers = listStickers();
  if (stickers.length > 0) {
    promptParts.stickers = buildStickerPromptSection(stickers);
  }
  if (photosOn && falKey) {
    promptParts.photos = renderPrompt('image.section', { cap: getImageDailyCap() });
  }
  const yandereOn = cfg?.yandere === true && cfg.yandereConsent === true;
  if (yandereOn) promptParts.yandere = buildYanderePromptSection();

  const masterOn = cfg?.master === true && cfg.masterConsent === true;
  let discipline = convo.discipline ?? DISCIPLINE_START;
  // honorific & rules are CHARACTER-authored (conversation state), read-only to the user.
  const honorific = convo.masterHonorific;
  if (masterOn) {
    // App-enforced honorific — only once she has actually set one.
    const lastUser = [...all].reverse().find((m) => m.kind === 'normal' && m.role === 'user');
    if (honorific && lastUser && !hasHonorific(lastUser.content, honorific)) {
      discipline = clampDiscipline(discipline - HONORIFIC_PENALTY);
      setDiscipline(conversationId, discipline);
      promptParts.masterCorrection =
        `[注意：用户刚才没有用称呼"${honorific}"，请纠正并惩戒。]`;
    }
    promptParts.master =
      buildMasterPromptSection({ honorific, rules: convo.masterRules, discipline });
  }

  // 转账: her per-conversation wallet (seeded from the persona's initial balance).
  const transfersOn = cfg?.transfers === true;
  const charBal = cents(convo.charBalance ?? cfg?.initBalance ?? 0);
  if (transfersOn) promptParts.transfer = buildTransferSection(charBal);

  const stickerLabel = new Map(stickers.map((s) => [s.id, s.label]));
  const byId = new Map(all.map((m) => [m.id, m]));
  const quoteSnippet = (m: Message): string => {
    const q = m.quotedId ? byId.get(m.quotedId) : null;
    if (!q) return '';
    const who = q.role === 'user' ? '用户' : persona.name;
    const txt = (
      q.kind === 'image'
        ? imagePlaceholder(q.content)
        : q.kind === 'sticker'
          ? '[表情包]'
          : stripLeakedStateTags(q.content)
    )
      .replace(/\s+/g, ' ')
      .slice(0, 40);
    return `（回复${who}的「${txt}」）`;
  };
  const windowMapped = window.map((m) => {
    // Assistant sticker AND photo history is serialized in the SAME format
    // she is told to emit — otherwise she mimics the transcript's narrated
    // form ("[发送了表情包:…]" / "（发送了一张照片：…）") and her sends stop
    // parsing. Historical rows with a leaked 【状态|…】 (saved before the
    // envelope parser) are scrubbed — feeding them back teaches the model
    // the broken combined format.
    const transfer = m.kind === 'transfer' ? parseTransfer(m.content) : null;
    const base =
      m.kind === 'sticker'
        ? m.role === 'assistant'
          ? `[表情:${stickerLabel.get(m.content) ?? '表情'}]`
          : `[发送了表情包：${stickerLabel.get(m.content) ?? '表情'}]`
        : m.kind === 'pat' && m.role === 'assistant'
          ? `[拍一拍:${m.content}]`
          : transfer
            ? transferModelText(m.role, transfer)
            : m.kind === 'image'
              ? imageModelText(m.content)
              : m.role === 'assistant'
                ? stripLeakedStateTags(m.content)
                : m.content;
    // 引用: tell her exactly which message this one is answering.
    const content = m.quotedId ? `${quoteSnippet(m)}${base}` : base;
    return {
      ...m,
      content: realism ? `${fmtTimestamp(m.createdAt)} ${content}` : content,
    };
  });
  const prompt = composeDmPrompt(promptParts);
  const messages = buildRequestMessages(
    prompt.instructions, prompt.evidence, windowMapped, '',
  );

  // 动态想象力: one tiny classifier call picks THIS reply's register from the
  // user's latest message — 严谨 when precision matters (diary talk, facts,
  // questions), 奔放 when play does. Any failure → the manual setting rides.
  let temperature = getTemperature();
  if (getTempMode() === 'dynamic') {
    // kind==='normal' only: sticker/transfer/game rows carry ids/JSON, not prose.
    const userBurst = currentUserBurst(window);
    if (userBurst.trim()) {
      try {
        const raw = await chatOnce(apiKey, SUMMARIZER_MODEL, [
          { role: 'user', content: buildTempClassifierPrompt(userBurst) },
        ], 0);
        const choice = parseTempChoice(raw);
        if (choice) {
          temperature = TEMP_BY_CHOICE[choice];
          logMeta(conversationId, `🌡 动态想象力：这条按「${choice}」回复（temperature ${temperature}）`);
        }
      } catch {
        // classifier down → manual setting rides
      }
    }
  }

  let draft = '';
  let deltaCount = 0;
  let reasoningAcc = '';
  try {
    const full = await streamChat({
      apiKey,
      model: getModel(),
      messages,
      thinking: getThinkingEnabled(),
      temperature,
      signal: controller.signal,
      onReasoning: (t) => {
        reasoningAcc += t;
      },
      onDelta: (t) => {
        deltaCount++;
        if (deltaCount === 1) console.log('[seekchat:stream] first delta arrived');
        draft += t;
        cb.onDelta(draft);
      },
    });
    console.log('[seekchat:stream] done, deltas:', deltaCount);
    // 格式检查 (v2.2): the free lint flags ATTEMPTED-but-broken markers; only
    // then does one small repair call run — format fixes only, original rides
    // on any doubt (acceptRepair). Extraction then sees functioning labels.
    // 叙事救援 (field report): narrationSuspects flags committed mechanics
    // narrated as prose with NO marker syntax at all (（给你拍了张照片）,
    // a bare "锁屏" line) — same repair call rescues those into the marker
    // the checker template now knows to write. Gated per-feature so an
    // untaught feature's coincidental prose never triggers a rescue.
    let fullText = normalizeActionMarkers(full);
    const narrationGate = { photo: photosOn && !!falKey, lock: yandereOn };
    if (
      lintMarkers(fullText).suspects.length > 0 ||
      narrationSuspects(fullText, narrationGate).length > 0
    ) {
      try {
        const fixed = await chatOnce(apiKey, SUMMARIZER_MODEL, [
          {
            role: 'user',
            content: buildRepairPrompt(fullText, { narration: narrationGate.photo || narrationGate.lock }),
          },
        ], 0);
        if (acceptRepair(fullText, fixed) && fixed.trim() !== fullText.trim()) {
          fullText = fixed.trim();
          logMeta(conversationId, '🧰 修复了一条格式跑偏的标记');
        }
      } catch {
        // checker down → the original reply rides untouched
      }
    }
    const { clean, tag, growth, pat, extras, found: tagFound } = extractStateTag(fullText);
    let stripped = stripEchoedTimestamps(clean).trim();
    // Ops the model smuggled INSIDE the state tag (|主人:调教:+3 etc.) are
    // re-routed into their channels — only ones that provably round-trip
    // through the target extractor; the rest drop silently (hidden channel).
    for (const line of routeTagExtras(extras, {
      master: masterOn,
      yandere: yandereOn,
      stickers: stickers.length > 0,
      memory: memoryOn,
    })) {
      stripped += `\n${line}`;
    }
    // 记忆库 writes: apply against the pre-request list (index consistency),
    // and only when the feature that taught her the marker is on.
    let afterMemory = stripped;
    let memoryOpsApplied = false;
    if (memoryOn) {
      const mo = extractMemoryMarkers(stripped);
      afterMemory = mo.clean;
      if (mo.adds.length > 0 || mo.removes.length > 0) {
        memoryOpsApplied = true;
        const { toAdd, removeIds } = applyMemoryOps(memories, mo);
        for (const rid of removeIds) deleteMemory(rid);
        for (const t of toAdd) insertMemory(conversationId, t);
      }
    }
    // 照片 (v2.6): only extracted when the marker was actually taught this
    // turn — same DM philosophy as stickers below: an untaught marker is
    // literal text she wrote, never a send.
    const im = photosOn && falKey
      ? extractImageMarker(afterMemory)
      : { scene: null as string | null, shot: 'selfie' as PhotoShot, clean: afterMemory };
    // Without imported stickers she was never taught the marker — 【表情：冷漠】
    // is then a stage direction, not a send. Don't strip it.
    const { clean: afterStickers, labels } =
      stickers.length > 0
        ? extractStickerMarkers(im.clean)
        : { clean: im.clean, labels: [] as string[] };
    const ya = yandereOn
      ? extractYandereMarkers(afterStickers)
      : { clean: afterStickers, vibrate: false, lock: false, hold: false, release: false, demand: null };
    let bodyText = ya.clean;
    let command: string | null = null;
    let countdown: number | null = null;
    let demand: string | null = ya.demand;
    let maOps = false;
    if (masterOn) {
      const ma = extractMasterMarkers(bodyText);
      bodyText = ma.clean;
      command = ma.command;
      countdown = ma.countdown;
      demand = demand ?? ma.demand;
      maOps =
        ma.command !== null || ma.countdown !== null || ma.disciplineDelta != null ||
        ma.honorific !== null || ma.newRule !== null || ma.demand !== null;
      if (ma.disciplineDelta != null) {
        discipline = clampDiscipline(discipline + ma.disciplineDelta);
        setDiscipline(conversationId, discipline);
      }
      if (ma.honorific) setMasterHonorific(conversationId, ma.honorific);
      if (ma.newRule) setMasterRules(conversationId, appendRule(convo.masterRules, ma.newRule));
    }
    // 转账: she can gift money (own-line [转账:金额]) up to her balance.
    let transferAmount: number | null = null;
    if (transfersOn) {
      const tr = extractTransferMarker(bodyText);
      bodyText = tr.clean;
      if (tr.amount != null && charBal >= tr.amount) transferAmount = tr.amount;
    }
    // 拍一拍 (v2.0 grammar): own-line action marker. The legacy in-envelope
    // |拍一拍: field still arrives via extractStateTag's `pat` — tolerant read,
    // strict write.
    let patAction: string | null = null;
    if (realism) {
      const pm = extractPatMarker(bodyText);
      bodyText = pm.clean;
      patAction = pm.pat;
    }
    // Leave-request fail-safe: allow leaving unless she EXPLICITLY held us.
    // (Models often agree in words but forget the marker — never trap the user.)
    const release = opts?.leaveRequest ? !ya.hold : ya.release;
    if (ya.vibrate || ya.lock || ya.hold || release || command || countdown || demand) {
      notifyAction({
        conversationId, vibrate: ya.vibrate, lock: ya.lock, hold: ya.hold, release,
        command, countdown, demand,
      });
    }
    // bodyText is the fully-extracted text — never fall back to an earlier
    // pipeline stage (afterMemory still carries the markers later stages ate,
    // e.g. a synthesized [主人:…] line on a tag-only reply).
    let saved: Message | null = null;
    if (bodyText.trim().length > 0) {
      // 消息切割 (v2.3): one long reply → several real bubbles. External call
      // may ONLY insert --- (parseCut verifies char-identity); any doubt →
      // the single bubble rides.
      let chunks = [bodyText.trim()];
      if (getMsgCut() && needsCut(bodyText)) {
        try {
          const rawCut = await chatOnce(apiKey, SUMMARIZER_MODEL, [
            { role: 'user', content: buildCutPrompt(bodyText.trim()) },
          ], 0);
          const segs = parseCut(bodyText.trim(), rawCut);
          if (segs) chunks = segs;
        } catch {
          // cutter down → single bubble
        }
      }
      const t0 = Date.now();
      chunks.forEach((c, i) => {
        const row = insertMessage(
          conversationId, 'assistant', c, 'complete', 'normal',
          i === 0 ? reasoningAcc.trim() || null : null,
          t0 + i, // strictly increasing stamps keep order — every chunk, including 0
        );
        saved = saved ?? row;
      });
    }
    for (const label of labels) {
      const st = resolveSticker(stickers, label);
      if (st) {
        const row = insertMessage(conversationId, 'assistant', st.id, 'complete', 'sticker');
        saved = saved ?? row;
      }
    }
    if (transferAmount != null) {
      setCharBalance(conversationId, cents(charBal - transferAmount));
      const row = insertMessage(
        conversationId, 'assistant',
        encodeTransfer({ amount: transferAmount, status: 'pending' }),
        'complete', 'transfer',
      );
      saved = saved ?? row;
    }
    // 照片 (v2.6): cap is checked BEFORE any row or fal call, and bumped ONLY
    // when a generation actually fires. Over cap: the marker is already
    // stripped above — she simply doesn't send one (the cap line she was
    // taught makes her decline in character; DMs have no ungated system-line
    // lane to post an extra notice on).
    if (im.scene) {
      const dayKey = imageDayKey(conversationId, new Date());
      const used = parseInt(getPref(dayKey) ?? '0', 10) || 0;
      if (canGenerateToday(used, getImageDailyCap())) {
        const scene = im.scene;
        const shot = im.shot;
        setPref(dayKey, String(used + 1));
        const row = insertMessage(
          conversationId, 'assistant',
          JSON.stringify({ status: 'pending', scene, shot }),
          'complete', 'image',
        );
        saved = saved ?? row;
        notifyMessage(conversationId); // the pending bubble appears immediately
        void generatePhoto(
          conversationId, row.id, persona.id, persona.appearancePrompt ?? '', scene, shot, falKey!,
        );
      }
    }
    if (!saved) {
      // Never resurrect marker/tag text: a hidden-channel-only reply (memory
      // write, unresolvable sticker, state tag alone, yandere/master op)
      // already had its effect — show a beat instead of the raw channel.
      const hadOps =
        memoryOpsApplied || labels.length > 0 || tagFound || maOps ||
        transferAmount != null || patAction != null || im.scene !== null ||
        ya.vibrate || ya.lock || ya.hold || ya.release || ya.demand !== null;
      saved = insertMessage(
        conversationId, 'assistant',
        hadOps ? '……' : fullText,
        'complete', 'normal', reasoningAcc.trim() || null,
      );
    }
    const patOut = patAction ?? pat;
    if (patOut && realism) insertMessage(conversationId, 'assistant', patOut, 'complete', 'pat');
    // Screen-usage 'check' peek only counts now that the turn actually landed —
    // a failed/aborted turn must not burn the window or log a false peek note.
    if (usagePeeked) {
      markUsageChecked(Date.now());
      logMeta(conversationId, '🔍 她看了眼你今天的屏幕使用');
    }
    touchConversation(conversationId);
    if (tag) setConversationState(conversationId, tag.mood, tag.intensity, tag.thought);
    if (growth != null && cfg?.moodCurve && cfg.curveGrowth !== false) {
      const r = applyGrowth(
        parseDrift(convo.curveDrift), growth, dayPartAt(new Date()), Date.now(),
      );
      if (r.accepted) setCurveDrift(conversationId, JSON.stringify(r.drift));
    }
    cb.onDone(saved!);
    notifyMessage(conversationId);
    void maybeSummarize(conversationId);
  } catch (e: unknown) {
    if (supersededAborts.has(conversationId)) {
      // A newer fragment superseded this stream — drop the partial silently;
      // the re-armed hold will regenerate a reply that covers everything.
      supersededAborts.delete(conversationId);
      cb.onSuperseded?.();
      return;
    }
    const err = e instanceof ApiError ? e : new ApiError('network', String(e));
    let partialSaved = false;
    if (draft.length > 0) {
      // Scrub completed control markers from the partial — they'd otherwise
      // pop into a permanent bubble AND re-enter future context windows.
      // (Ops are NOT applied from partials; only completed turns write state.)
      let cleaned = stripEchoedTimestamps(cleanDraftForDisplay(draft)).trim();
      if (memoryOn) cleaned = extractMemoryMarkers(cleaned).clean;
      if (photosOn && falKey) cleaned = extractImageMarker(cleaned).clean;
      if (stickers.length > 0) cleaned = extractStickerMarkers(cleaned).clean;
      if (yandereOn) cleaned = extractYandereMarkers(cleaned).clean;
      if (masterOn) cleaned = extractMasterMarkers(cleaned).clean;
      if (realism) cleaned = extractPatMarker(cleaned).clean;
      insertMessage(
        conversationId, 'assistant',
        cleaned.length > 0 ? cleaned : draft,
        'interrupted',
      );
      touchConversation(conversationId);
      partialSaved = true;
    }
    cb.onError(err, partialSaved);
    if (partialSaved) notifyMessage(conversationId);
  }
}

/**
 * 照片 (v2.6): the actual Lite-edit call + local download, run fire-and-forget
 * after the pending row is already visible. Every path is caught — a fal
 * failure must never surface as a turn error, only flip the row to 'failed'
 * with a reason (Task 5 renders a retry). EXPORTED so the retry button can
 * re-fire the identical call.
 *
 * 实拍 (v2.8): `shot` picks the endpoint. 'selfie' is the original path,
 * byte-identical — frozen refs read off disk, composeScenePrompt (appearance
 * + scene), FAL_LITE_EDIT conditioned on refDataUris. 'scene' is scene-ONLY:
 * no ref read, no appearance, composeSceneOnlyPrompt, plain FAL_LITE_T2I.
 */
export async function generatePhoto(
  conversationId: string,
  messageId: string,
  personaId: string,
  appearance: string,
  scene: string,
  shot: PhotoShot,
  falKey: string,
): Promise<void> {
  try {
    let urls: string[];
    if (shot === 'scene') {
      urls = await falGenerate(
        falKey, FAL_LITE_T2I,
        buildFalInput({ prompt: composeSceneOnlyPrompt(scene), size: 'auto_2K' }),
      );
    } else {
      const refDataUris: string[] = [];
      for (const ref of listRefImages(personaId)) {
        const b64 = await FileSystem.readAsStringAsync(ref.uri, { encoding: 'base64' });
        refDataUris.push(`data:image/jpeg;base64,${b64}`);
      }
      urls = await falGenerate(
        falKey, FAL_LITE_EDIT,
        buildFalInput({ prompt: composeScenePrompt(appearance, scene), size: 'auto_2K', refDataUris }),
      );
    }
    if (!urls[0]) throw new FalError(0, '未返回图片');
    const dir = `${FileSystem.documentDirectory}chatimg/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const dest = `${dir}${messageId}.jpg`;
    await FileSystem.downloadAsync(urls[0], dest);
    updateMessageContent(messageId, JSON.stringify({ status: 'done', scene, shot, uri: dest }));
  } catch (e) {
    const reason = e instanceof FalError ? userMessageForFal(e.status) : '网络不稳定，稍后重试';
    updateMessageContent(messageId, JSON.stringify({ status: 'failed', scene, shot, reason }));
  } finally {
    notifyMessage(conversationId);
  }
}

/**
 * 照片 (v2.6): a row can be orphaned mid-generation — the app killed between
 * the 'pending' insert and generatePhoto's async fal call landing — and would
 * otherwise sit as a permanent spinner forever. Run once at app launch (see
 * _layout.tsx, right after migrate()), BEFORE any conversation renders, so a
 * dead spinner is never shown; the row lands 'failed' with a retry-able reason
 * (Task 5's retry button re-fires generatePhoto against it).
 */
export function sweepStalePendingImages(): void {
  for (const row of listStalePendingImages()) {
    const next = failStalePending(row.content);
    if (next !== row.content) updateMessageContent(row.id, next);
  }
}

export async function maybeSummarize(conversationId: string): Promise<void> {
  if (summarizing.has(conversationId)) return;
  const convo = getConversation(conversationId);
  if (!convo) return;
  // Same exclusions as the request window — dev-mode notes must never reach
  // the summarizer, and future-stamped experience rows aren't real yet.
  const all = listMessages(conversationId).filter(
    (m) => m.kind !== 'meta' && !(m.kind === 'experience' && m.createdAt > Date.now()),
  );
  const window = selectWindow(all, getHistoryBudget());
  if (!shouldSummarize(all, window, convo.summaryUpToId)) return;

  summarizing.add(conversationId);
  try {
    const isGroup = convo.kind === 'group';
    const persona = getPersona(convo.personaId);
    const apiKey = await getApiKey();
    // Groups have no single persona (sentinel personaId='') — speaker names
    // come from the member registry instead.
    if ((!persona && !isGroup) || !apiKey) return;
    // Full registry, not current membership — removed members keep their
    // names in history and in the summary.
    const memberName = new Map(
      isGroup
        ? listCharacters().map((c) => [c.id, getPersona(c.personaId)?.name ?? '她'])
        : [],
    );

    const oldestInWindow = window.length
      ? all.findIndex((m) => m.id === window[0].id)
      : all.length;
    let start = 0;
    if (convo.summaryUpToId) {
      const i = all.findIndex((m) => m.id === convo.summaryUpToId);
      if (i >= 0) start = i + 1;
    }
    const excerpt = all.slice(start, oldestInWindow);
    if (excerpt.length === 0) return;

    // Render special kinds the SAME way the model context window does
    // (windowMapped) — otherwise the summarizer sees opaque payloads (a
    // transfer's JSON, a sticker's id) and bakes them into the persistent
    // summary, which is then re-injected on every future request.
    const stickerLabel = new Map(listStickers().map((s) => [s.id, s.label]));
    const lines = excerpt
      .map((m) => {
        const who =
          m.role === 'user'
            ? '用户'
            : isGroup
              ? memberName.get(m.speakerId ?? '') ?? '她'
              : persona!.name;
        const transfer = m.kind === 'transfer' ? parseTransfer(m.content) : null;
        const body =
          m.kind === 'sticker'
            ? m.role === 'assistant'
              ? `[表情:${stickerLabel.get(m.content) ?? '表情'}]`
              : `[发送了表情包：${stickerLabel.get(m.content) ?? '表情'}]`
            : transfer
              ? transferModelText(m.role, transfer)
              : m.kind === 'image'
                ? imagePlaceholder(m.content)
                : m.role === 'assistant'
                  ? stripLeakedStateTags(m.content)
                  : m.content;
        return `${who}：${body}`;
      })
      .join('\n');
    const summary = await chatOnce(apiKey, SUMMARIZER_MODEL, [
      { role: 'system', content: persona?.summaryPrompt ?? renderPrompt('summary.rolling') },
      {
        role: 'user',
        content: `此前总结：\n${convo.summary ?? '（无）'}\n\n新增对话节选：\n${lines}`,
      },
    ]);
    // The user may have hit 重置总结 (clearSummary) while this API call was in
    // flight — re-read and bail if the summary state moved, else we'd resurrect
    // the very hallucinated summary they just purged.
    const cur = getConversation(conversationId);
    if (!cur || cur.summary !== convo.summary || cur.summaryUpToId !== convo.summaryUpToId) return;
    if (summary.trim()) {
      setSummary(conversationId, summary.trim(), excerpt[excerpt.length - 1].id);
    }
  } catch {
    // silent by design; next completed turn retries (spec §5)
  } finally {
    summarizing.delete(conversationId);
  }
}
