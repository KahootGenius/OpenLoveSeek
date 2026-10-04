import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, BackHandler, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable,
  StyleSheet, Text, TextInput, Vibration, View,
} from 'react-native';
// expo-image (not RN Image) so GIF/WebP stickers ANIMATE on Android.
import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  deleteMessageAndResetContext, deleteSticker,
  getConversation, getPersona, getPref, insertMemory, listMemories, listMessages, listStickers,
  setPref, updateMemory, updateMessageContent,
} from '../../lib/db';
import {
  canAddManualMemory, extractMemoryMarkers, MAX_MEMORY_ENTRIES, normalizeManualMemoryText,
} from '../../lib/memory';
import { canGenerateToday, extractImageMarker, imageDayKey, PhotoShot } from '../../lib/imagegen';
import { dmMessageActions } from '../../lib/messagemenu';
import { cancelConversationOutreach } from '../../lib/background';
import { MiniMaxError, userMessageForMiniMax } from '../../lib/minimax';
import { moodToEmotion } from '../../lib/voicetext';
import { enqueueFiles, playFile, stopVoice, synthesizeToCache, VoiceCapError } from '../../lib/voice';

import { DAY_PARTS, effectiveOpenness, parseDrift } from '../../lib/curve';
import {
  fireOpening, fireSilence, fireTrigger, generatePhoto, isHoldPending, isStreaming, isSummarizing,
  logMeta, noteTyping,
  receiveTransfer, requestLeave, sendGame, sendPat, sendSticker, sendTransfer, sendTurn, stopTurn,
  subscribeMessages, subscribeYandere,
} from '../../lib/engine';
import { GAMES, GameDef, RpsMove } from '../../lib/games';
import { fmtMoney, parseTransfer, TransferStatus } from '../../lib/transfer';
import { extractYandereMarkers, HOLD_TIMEOUT_MS } from '../../lib/yandere';
import { clampDiscipline, extractMasterMarkers } from '../../lib/master';
import { extractStickerMarkers } from '../../lib/stickers';
import { setDiscipline } from '../../lib/db';
import { BiometricLock } from '../../components/BiometricLock';
import { ChatInspector } from '../../components/ChatInspector';
import { CommandCard } from '../../components/CommandCard';
import { DemandGate } from '../../components/DemandGate';
import { MessageActionMenu, MenuAnchor } from '../../components/MessageActionMenu';
import { splitBrackets } from '../../lib/brackets';
import { ApiError, userMessageFor } from '../../lib/llm';
import {
  buildRequestMessages, countUnsummarized, estimateTokens, selectWindow,
} from '../../lib/context';
import { LIFE_IDLE_MINUTES, SUMMARY_PREFIX } from '../../lib/constants';
import {
  getDeliveryMode, getDevMode, getFalKey, getHistoryBudget, getImageDailyCap, getImageFeature,
  getMarkdownEnabled, getMergeReplies, getMiniMaxKey, getShowNicknames, getShowThinking,
  getUserAvatar, getUserBalance, getUserNickname, getVoiceAutoplay, getVoiceFeature, getVoiceId,
  getVoiceReadParens, getVoiceRegion, getVoiceSpeed,
} from '../../lib/settings';
import { activityAt, decayedMood, TriggerPath } from '../../lib/life';
import { fmtDivider, hasRealismConfig, parseProConfig } from '../../lib/pro';
import { newestReadUserId } from '../../lib/rhythm';
import { extractPatMarker } from '../../lib/markers';
import {
  cleanDraftForDisplay, stripEchoedTimestamps, stripLeakedStateTags,
} from '../../lib/statetag';
import { useTheme } from '../../lib/theme-context';
import { Avatar } from '../../components/Avatar';
import { Markdown } from '../../lib/markdown';
import type { Message } from '../../lib/types';

// 照片 (v2.6): parsed kind='image' content — pending while she's "taking" it,
// done with a local file uri, or failed with a user-facing reason (重试 re-fires
// the same generatePhoto the engine used). A corrupt row parses to 'failed'
// rather than throwing — the list must never crash on bad content.
interface ImageContent {
  status: 'pending' | 'done' | 'failed';
  scene: string;
  shot?: PhotoShot; // absent on pre-v2.8 rows — 重试 defaults those to 'selfie'
  uri?: string;
  reason?: string;
}

function parseImageContent(raw: string): ImageContent {
  try {
    const o = JSON.parse(raw);
    if (
      o && typeof o.scene === 'string' &&
      (o.status === 'pending' || o.status === 'done' || o.status === 'failed')
    ) {
      return o as ImageContent;
    }
  } catch {
    // corrupt row — fall through to the failed sentinel below
  }
  return { status: 'failed', scene: '', reason: '图片数据损坏' };
}

interface Bubble {
  key: string;
  role: 'user' | 'assistant';
  text: string;
  interrupted?: boolean;
  streaming?: boolean;
  divider?: boolean;
  pat?: boolean;
  sticker?: boolean; // text holds the sticker id
  meta?: boolean; // dev-mode machinery note
  game?: boolean; // RNG mini-game result card
  transfer?: { amount: number; status: TransferStatus }; // 转账 card
  image?: ImageContent; // 照片 card (v2.6)
  reasoning?: string;
  srcId?: string; // the source message id (for 引用 long-press)
  quote?: { who: string; text: string }; // 引用 target, shown above the first bubble
  voice?: { text: string; status: 'pending' | 'done' | 'failed'; path?: string }; // 语音 (v3.0)
  read?: boolean; // 已读 (v3.0): the newest user bubble she has read
}

/** Bracketed stage-directions render gray-italic. */
function BubbleText(props: { text: string }) {
  return (
    <Text style={s.bubbleTxt}>
      {splitBrackets(props.text).map((sg, i) => (
        <Text key={i} style={sg.action ? s.action : undefined}>
          {sg.text}
        </Text>
      ))}
    </Text>
  );
}

const DIVIDER_GAP_MS = 5 * 60000;

function toBubbles(
  messages: Message[],
  draft: string | null,
  resolveQuote: (m: Message) => { who: string; text: string } | null,
): Bubble[] {
  const bubbles: Bubble[] = [];
  const nowMs = Date.now();
  const readId = newestReadUserId(messages, nowMs);
  let prevAt: number | null = null;
  for (const m of messages) {
    // Future-stamped experience rows (staggered 朋友圈 reveals) aren't real yet.
    if (m.kind === 'experience' && m.createdAt > nowMs) continue;
    if (prevAt === null || m.createdAt - prevAt > DIVIDER_GAP_MS) {
      bubbles.push({
        key: `div:${m.id}`, role: 'assistant', divider: true,
        text: fmtDivider(m.createdAt, nowMs),
      });
    }
    prevAt = m.createdAt;
    if (m.kind === 'meta' || m.kind === 'experience') {
      // experience (v2.1): community moments carried home — same grey line as
      // meta, but always visible (it's her lived memory, not a dev note).
      bubbles.push({
        key: m.id,
        role: 'assistant',
        text: m.content,
        meta: true,
        srcId: m.kind === 'experience' ? m.id : undefined,
      });
      continue;
    }
    if (m.kind === 'recall') {
      // 撤回 (v3.0): the tombstone line, always visible.
      bubbles.push({ key: m.id, role: 'assistant', text: m.content, meta: true });
      continue;
    }
    if (m.kind === 'game') {
      bubbles.push({ key: m.id, role: m.role, text: m.content, game: true, srcId: m.id });
      continue;
    }
    if (m.kind === 'transfer') {
      const t = parseTransfer(m.content);
      if (t) {
        bubbles.push({ key: m.id, role: m.role, text: '', transfer: t, srcId: m.id });
        continue;
      }
    }
    const quote = m.quotedId ? resolveQuote(m) ?? undefined : undefined;
    if (m.kind === 'pat') {
      bubbles.push({ key: m.id, role: m.role, text: m.content, pat: true, srcId: m.id });
      continue;
    }
    if (m.kind === 'sticker') {
      bubbles.push({ key: m.id, role: m.role, text: m.content, sticker: true, srcId: m.id, quote });
      continue;
    }
    if (m.kind === 'image') {
      bubbles.push({
        key: m.id, role: m.role, text: '', image: parseImageContent(m.content), srcId: m.id, quote,
      });
      continue;
    }
    if (m.kind === 'voice') {
      let voice: NonNullable<Bubble['voice']> = { text: m.content, status: 'failed' };
      try {
        const j = JSON.parse(m.content) as { text?: unknown; status?: unknown; path?: unknown };
        if (j && typeof j.text === 'string') {
          voice = {
            text: j.text,
            status: j.status === 'done' ? 'done' : j.status === 'pending' ? 'pending' : 'failed',
            path: typeof j.path === 'string' ? j.path : undefined,
          };
        }
      } catch {
        // legacy/garbage content: show as failed with the raw text
      }
      bubbles.push({ key: m.id, role: m.role, text: voice.text, voice, srcId: m.id, quote });
      continue;
    }
    // Retro-scrub: replies saved before the envelope parser may carry a raw
    // leaked 【状态|…】 — never display it (nor a bubble of only that).
    const content = m.role === 'assistant' ? stripLeakedStateTags(m.content) : m.content;
    const parts = m.role === 'assistant' ? content.split('---') : [content];
    const shown = parts.map((p) => p.trim()).filter(Boolean);
    (shown.length ? shown : ['……']).forEach((p, i) => {
      bubbles.push({
        key: `${m.id}:${i}`,
        role: m.role,
        text: p,
        srcId: m.id,
        quote: i === 0 ? quote : undefined, // quote block only above the first bubble
        interrupted: m.status === 'interrupted' && i === shown.length - 1,
        reasoning: m.role === 'assistant' && i === 0 ? (m.reasoning ?? undefined) : undefined,
        read: m.role === 'user' && m.id === readId && i === shown.length - 1,
      });
    });
  }
  if (draft !== null) {
    const parts = draft.split('---').map((p) => p.trim()).filter(Boolean);
    (parts.length ? parts : ['…']).forEach((p, i) =>
      bubbles.push({ key: `draft:${i}`, role: 'assistant', text: p, streaming: true }),
    );
  }
  return bubbles.reverse(); // for the inverted FlatList
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState<string | null>(null);
  const [draftDone, setDraftDone] = useState(false);
  const [revealed, setRevealed] = useState(0);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [inspector, setInspector] = useState(false);
  const [memoryEdit, setMemoryEdit] = useState<{ id: string | null; text: string } | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [actionMenu, setActionMenu] = useState<{ message: Message; anchor: MenuAnchor } | null>(null);
  const [, forceRender] = useState(0);
  const busy = useRef(false);
  const firedThisFocus = useRef(false);
  // 语音自动朗读: focused-only gate (set true/false by the useFocusEffect
  // below) and a high-water mark so history at mount never auto-plays — only
  // rows strictly newer than the moment this screen was opened qualify.
  const voiceFocusedRef = useRef(false);
  const lastSpokenAtRef = useRef(Date.now());

  const convo = getConversation(id);
  const persona = convo ? getPersona(convo.personaId) : null;
  const mode = getDeliveryMode();
  const mergeOn = getMergeReplies();
  const showNick = getShowNicknames();
  const userNick = getUserNickname();
  const userAvatar = getUserAvatar();
  const mdOn = getMarkdownEnabled();
  const showThinking = getShowThinking();
  const chatCfg = parseProConfig(persona?.proConfig ?? null);
  const yandereOn = chatCfg?.yandere === true && chatCfg.yandereConsent === true;
  const transfersOn = chatCfg?.transfers === true;
  const lockCooldownMs = (chatCfg?.lockCooldownMin ?? 30) * 60000;
  const patEmojiMine = chatCfg?.patEmoji?.trim() || '👋';
  const patEmojiHer = chatCfg?.patEmojiChar?.trim() || patEmojiMine;
  // 照片 (v2.6 field report): falKey lives in SecureStore (async-only read) —
  // unlike the other gates here it needs actual state, loaded once. Same
  // idiom as persona/[id].tsx's 形象设定 editor.
  const [falKeyPresent, setFalKeyPresent] = useState(false);
  useEffect(() => {
    void getFalKey().then((k) => setFalKeyPresent(!!k));
  }, []);
  const photosOn = getImageFeature() && persona?.refsFrozen === 1 && falKeyPresent;
  // 语音 (v2.7): same async-key idiom as falKeyPresent above — MiniMax key
  // lives in SecureStore, checked once at mount for presence only (the actual
  // value is re-fetched at each speak site, since it may change mid-session).
  const [minimaxKeyPresent, setMinimaxKeyPresent] = useState(false);
  useEffect(() => {
    void getMiniMaxKey().then((k) => setMinimaxKeyPresent(!!k));
  }, []);
  const effectiveVoiceId = persona?.voiceId?.trim() || getVoiceId();
  const voiceOn = getVoiceFeature() && minimaxKeyPresent && effectiveVoiceId.length > 0;
  const [stickerVersion, setStickerVersion] = useState(0);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [gameOpen, setGameOpen] = useState(false);
  const [rpsFor, setRpsFor] = useState<GameDef | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferAmt, setTransferAmt] = useState('');
  const [photoViewer, setPhotoViewer] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set());
  const [voiceShown, setVoiceShown] = useState<Set<string>>(new Set()); // 语音 → 文字 toggles
  const [locked, setLocked] = useState(false);
  const [held, setHeld] = useState(false);
  const [askingLeave, setAskingLeave] = useState(false);
  const [command, setCommand] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [demand, setDemand] = useState<string | null>(null);
  const lastLockAt = useRef(0);
  const leaving = useRef(false);
  const stickers = useMemo(() => listStickers(), [stickerVersion]);
  const stickerMap = useMemo(() => new Map(stickers.map((st) => [st.id, st])), [stickers]);
  const { th } = useTheme();

  const reload = useCallback(() => setMessages(listMessages(id)), [id]);

  const devMode = getDevMode();
  const visible = useMemo(
    () => messages.filter((m) => m.kind !== 'trigger' && (devMode || m.kind !== 'meta')),
    [messages, devMode],
  );
  const msgById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const resolveQuote = useCallback(
    (m: Message): { who: string; text: string } | null => {
      const q = m.quotedId ? msgById.get(m.quotedId) : null;
      if (!q) return null;
      const who = q.role === 'user' ? getUserNickname() : (persona?.name ?? '对方');
      const text =
        q.kind === 'sticker'
          ? '[表情包]'
          : stripLeakedStateTags(q.content).replace(/\s+/g, ' ').slice(0, 50);
      return { who, text };
    },
    [msgById, persona?.name],
  );
  const masterOn = chatCfg?.master === true && chatCfg.masterConsent === true;
  const memoryOn = convo?.memoryEnabled === 1;
  const realismOn = convo?.lifeEnabled === 1 || hasRealismConfig(chatCfg);
  // Control-channel lines are "用户不可见" — scrub completed marker lines from
  // the streaming draft too (gated like the engine's extraction), so they
  // don't flash raw and then vanish at finalize.
  const displayDraft = useMemo(() => {
    if (draft === null) return null;
    let d = stripEchoedTimestamps(cleanDraftForDisplay(draft));
    if (memoryOn) d = extractMemoryMarkers(d).clean;
    if (photosOn) d = extractImageMarker(d).clean;
    if (stickers.length > 0) d = extractStickerMarkers(d).clean;
    if (yandereOn) d = extractYandereMarkers(d).clean;
    if (masterOn) d = extractMasterMarkers(d).clean;
    if (realismOn) d = extractPatMarker(d).clean;
    return d;
  }, [draft, memoryOn, photosOn, stickers.length, yandereOn, masterOn, realismOn]);

  const draftSegments = useMemo(
    () => (displayDraft ?? '').split('---').map((p) => p.trim()).filter(Boolean),
    [displayDraft],
  );
  // Once the stream is done, every segment counts as fully typed.
  const completedSegments =
    displayDraft === null
      ? 0
      : draftDone
        ? draftSegments.length
        : Math.max(0, draftSegments.length - (displayDraft.trimEnd().endsWith('---') ? 0 : 1));

  useEffect(() => {
    if (mode !== 'simulated' || draft === null) {
      setRevealed(0);
      return;
    }
    if (revealed < completedSegments) {
      // typing-time simulation: longer messages take longer to "type"
      const nextLen = draftSegments[revealed]?.length ?? 0;
      const delay = Math.min(600 + nextLen * 80, 4000);
      const t = setTimeout(() => setRevealed((r) => r + 1), delay);
      return () => clearTimeout(t);
    }
  }, [mode, draft, completedSegments, revealed, draftSegments]);

  const finalizeTurn = useCallback(() => {
    setDraft(null);
    setDraftDone(false);
    setRevealed(0);
    setAskingLeave(false); // if she refused, drop the "asking" banner; user stays
    reload();
    busy.current = false;
  }, [reload]);

  const makeCallbacks = () => ({
    onUserSaved: reload,
    onDelta: (d: string) => setDraft(d),
    onDone: () => {
      // Simulated mode: let the reveal queue finish "typing" the remaining
      // bubbles before swapping to database rendering (else they all pop at
      // once). The drain effect below calls finalizeTurn. Take the busy lock
      // so the engine's post-onDone notifyMessage can't reload() mid-reveal
      // and double-render the reply (merge mode leaves busy false).
      if (getDeliveryMode() === 'simulated') {
        busy.current = true;
        setDraftDone(true);
      } else finalizeTurn();
    },
    onError: (e: ApiError, partialSaved: boolean) => {
      finalizeTurn();
      if (e.kind !== 'aborted' || !partialSaved) setError(userMessageFor(e));
    },
    onSuperseded: () => {
      // A newer fragment took over — drop the half-typed bubbles silently.
      setDraft(null);
      setDraftDone(false);
      setRevealed(0);
      busy.current = false;
    },
  });

  useEffect(() => {
    if (draftDone && revealed >= draftSegments.length) finalizeTurn();
  }, [draftDone, revealed, draftSegments.length, finalizeTurn]);

  // Merge mode queues fragments in the engine — no busy lock, and no "…"
  // placeholder until she actually starts typing (first delta). A completed
  // reply still mid-reveal is flushed first, NOT re-typed from zero.
  const preMergeSend = () => {
    if (draftDone) finalizeTurn();
  };

  const begin = (text: string | null, quotedId?: string | null) => {
    if (!mergeOn || text === null) {
      if (busy.current) return;
      busy.current = true;
      setDraft('');
      setRevealed(0);
    } else {
      preMergeSend();
    }
    setError(null);
    if (text !== null) {
      setInput('');
      noteTyping(id, false);
      setReplyingTo(null);
    }
    void sendTurn(id, text, makeCallbacks(), quotedId);
  };

  const beginSticker = (stickerId: string) => {
    setStickerOpen(false); // close first — a dropped tap should still dismiss the sheet
    // isStreaming guard: a turn she started (outreach/catch-up) leaves busy false
    // but the engine would drop the send, wedging busy=true forever.
    if (!mergeOn) {
      if (busy.current || isStreaming(id)) return;
      busy.current = true;
      setDraft('');
      setRevealed(0);
    } else {
      preMergeSend();
    }
    setError(null);
    setReplyingTo(null); // any send consumes a pending reply (else it leaks onto the next text)
    void sendSticker(id, stickerId, makeCallbacks());
  };

  const playGame = (g: GameDef, move?: RpsMove) => {
    setGameOpen(false);
    setRpsFor(null);
    if (!mergeOn) {
      if (busy.current || isStreaming(id)) return;
      busy.current = true;
      setDraft('');
      setRevealed(0);
    } else {
      preMergeSend();
    }
    setError(null);
    setReplyingTo(null);
    void sendGame(id, g.play(move).text, makeCallbacks());
  };

  const doTransfer = (amount: number) => {
    if (amount <= 0) return;
    if (amount > getUserBalance()) {
      Alert.alert('余额不足', `你的钱包只有 ${fmtMoney(getUserBalance())}，去设置里充值吧。`);
      return;
    }
    setTransferOpen(false);
    setTransferAmt('');
    if (!mergeOn) {
      if (busy.current || isStreaming(id)) return;
      busy.current = true;
      setDraft('');
      setRevealed(0);
    } else {
      preMergeSend();
    }
    setError(null);
    setReplyingTo(null);
    void sendTransfer(id, amount, makeCallbacks());
  };

  const lastAvatarTap = useRef(0);
  const onAvatarTap = () => {
    const now = Date.now();
    if (now - lastAvatarTap.current < 300) {
      lastAvatarTap.current = 0;
      if (!mergeOn) {
        if (busy.current || isStreaming(id)) return;
        busy.current = true;
        setDraft('');
        setRevealed(0);
      } else {
        preMergeSend();
      }
      setError(null);
      setReplyingTo(null);
      void sendPat(id, makeCallbacks());
    } else {
      lastAvatarTap.current = now;
    }
  };

  useEffect(
    () =>
      subscribeMessages((cid) => {
        if (cid === id && !busy.current) reload();
      }),
    [id, reload],
  );

  const askToLeave = () => {
    // Mid-stream/mid-hold taps are ignored (merge mode leaves busy false, so
    // check the engine too) — else the UI mutates while requestLeave no-ops.
    if (busy.current || !yandereOn || isStreaming(id) || isHoldPending(id)) return;
    busy.current = true;
    setAskingLeave(true);
    setError(null);
    setDraft('');
    setRevealed(0);
    void requestLeave(id, makeCallbacks());
  };

  useEffect(
    () =>
      subscribeYandere((a) => {
        if (a.conversationId !== id) return;
        if (a.vibrate) Vibration.vibrate([0, 200, 100, 300]);
        if (a.hold) setHeld(true);
        if (a.release && !a.hold) {
          // she let you go (or didn't actively hold you) — leave the chat
          setAskingLeave(false);
          leaving.current = true;
          setTimeout(() => {
            if (router.canGoBack()) router.back();
            else router.replace('/');
          }, 0);
        }
        if (a.lock) {
          if (Date.now() - lastLockAt.current >= lockCooldownMs) {
            lastLockAt.current = Date.now();
            Vibration.vibrate([0, 400]);
            setLocked(true);
          } else {
            // She DID emit [病娇:锁屏] — it's the cooldown swallowing it, not a
            // model failure. Surface it (dev mode) so it isn't a silent no-op.
            logMeta(id, '🔒 她想锁屏，但锁屏冷却未到（可在人设里把「锁屏冷却」调小或设为 0）');
          }
        }
        if (a.command) setCommand(a.command);
        if (a.countdown) setCountdown(a.countdown);
        if (a.demand) setDemand(a.demand);
      }),
    [id],
  );

  // 主人 obedience countdown: tick down; on expiry, punish (vibrate + discipline drop).
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      Vibration.vibrate([0, 300, 100, 300]);
      const convo2 = getConversation(id);
      if (convo2) setDiscipline(id, clampDiscipline((convo2.discipline ?? 50) - 8));
      setCountdown(null);
      return;
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown, id]);

  // 病娇: leaving this chat (back to list) needs her permission by default.
  // The OS home button is never intercepted — the user can always leave the app.
  useEffect(() => {
    if (!yandereOn) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (leaving.current) return false; // she released us — allow
      askToLeave();
      return true; // otherwise ask her first
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yandereOn]);

  // 病娇 proactive hold ([病娇:挽留]) shows a banner; failsafe auto-clears it.
  useEffect(() => {
    if (!held) return;
    const t = setTimeout(() => setHeld(false), HOLD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [held]);

  const beginTrigger = (path: TriggerPath) => {
    if (busy.current) return;
    if (getConversation(id)?.lifeEnabled !== 1) return;
    busy.current = true;
    setError(null);
    setDraft('');
    setRevealed(0);
    void fireTrigger(id, path, makeCallbacks()).then((fired) => {
      if (!fired) {
        setDraft(null);
        busy.current = false;
      }
    });
  };

  // 立即开始 (v2.9): in a chat born from one sentence she speaks first.
  // fireOpening refuses once anything has been said; then the ordinary
  // catch-up trigger gets its turn as before.
  const beginOpening = () => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setDraft('');
    setRevealed(0);
    void fireOpening(id, makeCallbacks()).then((fired) => {
      if (!fired) {
        setDraft(null);
        busy.current = false;
        beginTrigger('catchup');
      }
    });
  };

  // "还在吗" (v3.0): she asked, the chat stayed open, the user went quiet.
  // One nudge per question, 4–8 minutes later, only while this chat is focused.
  const silenceFired = useRef<string | null>(null);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || last.kind !== 'normal') return;
    if (!/[?？]\s*$/.test(stripLeakedStateTags(last.content).trim())) return;
    if (silenceFired.current === last.id) return;
    const delay = (4 + Math.random() * 4) * 60000;
    const t = setTimeout(() => {
      if (!voiceFocusedRef.current || busy.current) return;
      silenceFired.current = last.id;
      busy.current = true;
      setError(null);
      setDraft('');
      setRevealed(0);
      void fireSilence(id, makeCallbacks()).then((fired) => {
        if (!fired) {
          setDraft(null);
          busy.current = false;
        }
      });
    }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // ➕ panel registry (v2.0): future features add ENTRIES here, not buttons.
  const plusItems: {
    key: string; icon: string; label: string; show: boolean; onPress: () => void;
  }[] = [
    { key: 'sticker', icon: '🙂', label: '表情包', show: true, onPress: () => setStickerOpen(true) },
    { key: 'game', icon: '🎲', label: '小游戏', show: true,
      onPress: () => { setRpsFor(null); setGameOpen(true); } },
    { key: 'transfer', icon: '🧧', label: '转账', show: transfersOn,
      onPress: () => { setTransferAmt(''); setTransferOpen(true); } },
    { key: 'trigger', icon: '✨', label: '让她主动', show: convo?.lifeEnabled === 1,
      onPress: () => beginTrigger('manual') },
  ];

  useFocusEffect(
    useCallback(() => {
      reload();
      voiceFocusedRef.current = true;
      if (!firedThisFocus.current) {
        firedThisFocus.current = true;
        if (persona?.shaping) beginOpening();
        else beginTrigger('catchup');
      }
      return () => {
        firedThisFocus.current = false;
        voiceFocusedRef.current = false;
        stopVoice(); // leaving this chat — never keep talking over whatever's next
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reload]),
  );

  // 自动朗读 (v2.7, screen-driven, burst-aware): runs off `messages` itself
  // rather than hooking every individual reload() call site (send/receive/
  // subscribeMessages/retry all funnel through the same setMessages) — one
  // effect covers all of them. lastSpokenAtRef is bumped to the newest
  // candidate's createdAt BEFORE the synth work starts, so a second effect
  // run racing in (e.g. two reloads back to back) recomputes against the
  // already-advanced watermark instead of re-queueing the same rows.
  // voiceFocusedRef (set by the useFocusEffect above) gates the whole thing
  // off while this chat isn't the focused screen; a message that arrives
  // while blurred is simply left for whenever focus returns (its createdAt
  // is never consumed here, so it still qualifies then).
  useEffect(() => {
    if (!getVoiceAutoplay() || !voiceOn || !voiceFocusedRef.current) return;
    const candidates = messages.filter(
      (m) =>
        m.role === 'assistant' && m.kind === 'normal' && m.status === 'complete' &&
        m.createdAt > lastSpokenAtRef.current,
    );
    if (candidates.length === 0) return;
    lastSpokenAtRef.current = candidates[candidates.length - 1].createdAt;
    const emotion = moodToEmotion(convo?.moodLabel ?? null);
    void (async () => {
      const apiKey = await getMiniMaxKey();
      if (!apiKey) return; // auto-play never Alert-spams — just stays silent
      const paths: string[] = [];
      for (const m of candidates) {
        try {
          const path = await synthesizeToCache(m.id, m.content, {
            apiKey, region: getVoiceRegion(), voiceId: effectiveVoiceId,
            speed: getVoiceSpeed(), emotion, readParens: getVoiceReadParens(),
          });
          if (path) paths.push(path);
        } catch {
          break; // per-row error — stop the batch silently, no Alert spam
        }
      }
      if (paths.length > 0) void enqueueFiles(paths);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, voiceOn, convo?.moodLabel]);

  useEffect(() => {
    if (draft !== null || convo?.lifeEnabled !== 1) return;
    const t = setTimeout(() => beginTrigger('idle'), LIFE_IDLE_MINUTES * 60000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, draft, convo?.lifeEnabled]);

  const send = () => {
    const text = input.trim();
    if (!text) return;
    if (!mergeOn && isStreaming(id)) return; // merge mode may send mid-stream (supersedes)
    if (held) setHeld(false); // replying releases her proactive hold
    setAskingLeave(false);
    if (countdown !== null) setCountdown(null); // replied in time
    begin(text, replyingTo?.id ?? null);
  };

  const canMutateManualMemory = () => {
    if (!getDevMode()) return false;
    if (isStreaming(id)) {
      Alert.alert('暂时不能修改记忆', '请等待当前回复完成后再试。');
      return false;
    }
    return true;
  };

  const openMemoryEditor = (idToEdit: string | null, text = '') => {
    if (!canMutateManualMemory()) return;
    setMemoryEdit({ id: idToEdit, text });
  };

  const saveMemoryEdit = () => {
    if (!memoryEdit || !canMutateManualMemory()) return;
    const text = normalizeManualMemoryText(memoryEdit.text);
    if (!text) return;
    if (memoryEdit.id) {
      if (!updateMemory(id, memoryEdit.id, text)) {
        Alert.alert('记忆已变化', '这条记忆可能已被删除，请刷新后重试。');
      }
    } else {
      const current = listMemories(id);
      if (!canAddManualMemory(current.length)) {
        Alert.alert('记忆库已满', `最多只能保存 ${MAX_MEMORY_ENTRIES} 条记忆。`);
        forceRender((x) => x + 1);
        return;
      }
      insertMemory(id, text);
    }
    setMemoryEdit(null);
    forceRender((x) => x + 1);
  };

  const confirmDeleteMessage = (message: Message) => {
    if (isStreaming(id) || isSummarizing(id)) {
      Alert.alert('暂时不能删除', '请先等待当前回复或上下文总结完成。');
      return;
    }
    Alert.alert(
      '删除这条消息？',
      '原消息、引用和滚动总结会从后续上下文移除。记忆库不会自动清空；转账、游戏等已发生效果也不会撤销。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            if (isStreaming(id) || isSummarizing(id)) {
              Alert.alert('暂时不能删除', '请先等待当前回复或上下文总结完成。');
              return;
            }
            try {
              if (!deleteMessageAndResetContext(id, message.id)) {
                Alert.alert('消息已变化', '这条消息可能已被删除，请刷新后重试。');
                return;
              }
            } catch {
              Alert.alert('删除失败', '消息未删除，请稍后重试。');
              return;
            }
            try {
              await cancelConversationOutreach(id);
            } catch {
              Alert.alert(
                '消息已删除',
                '但预生成的主动消息可能没有完全清除。',
              );
            } finally {
              setReplyingTo((current) => current?.id === message.id ? null : current);
              reload();
            }
          },
        },
      ],
    );
  };

  // 朗读 (v2.7): voice.ts's synthesizeToCache caches by messageId, so a
  // repeat tap after a completed play just replays the same mp3 at no extra
  // MiniMax cost. The key is re-fetched here (not read off minimaxKeyPresent)
  // since it may have been cleared/added since that boolean was last computed.
  const speakMessage = async (message: Message) => {
    const apiKey = await getMiniMaxKey();
    if (!apiKey) {
      Alert.alert('无法朗读', '请先在设置里填入 MiniMax Key。');
      return;
    }
    const emotion = moodToEmotion(convo?.moodLabel ?? null);
    try {
      const path = await synthesizeToCache(message.id, message.content, {
        apiKey, region: getVoiceRegion(), voiceId: effectiveVoiceId,
        speed: getVoiceSpeed(), emotion, readParens: getVoiceReadParens(),
      });
      if (path) await playFile(path);
    } catch (e) {
      if (e instanceof VoiceCapError) Alert.alert('今天的朗读额度用完了', e.message);
      else if (e instanceof MiniMaxError) Alert.alert('朗读失败', userMessageForMiniMax(e.statusCode));
      else Alert.alert('朗读失败', '网络不太稳定，稍后再试');
    }
  };

  // MessageActionMenu (v2.8 T3) replaces the old Alert.alert sheet: Android's
  // Alert renders at most 3 buttons and silently drops the rest, which made
  // 撤回/删除 disappear whenever 回复/朗读 were also offered. The anchor is the
  // long-press touch point itself (pageX/pageY, zero-size) — simplest reliable
  // idiom, and the menu card positions itself just above that point.
  const openMessageActions = (messageId: string, anchor: MenuAnchor) => {
    const message = msgById.get(messageId);
    if (!message) return;
    if (dmMessageActions({ kind: message.kind, role: message.role, voiceOn }).length === 0) return;
    setActionMenu({ message, anchor });
  };

  const handleMenuAction = (key: string) => {
    const { message } = actionMenu ?? {};
    setActionMenu(null);
    if (!message) return;
    if (key === 'reply') setReplyingTo(message);
    else if (key === 'speak') void speakMessage(message);
    else if (key === 'delete') confirmDeleteMessage(message);
    else if (key === 'copy') {
      let text = message.content;
      if (message.kind === 'voice') {
        try {
          const j = JSON.parse(message.content) as { text?: unknown };
          if (typeof j.text === 'string') text = j.text;
        } catch {
          // raw content
        }
      }
      void Clipboard.setStringAsync(text);
    }
  };

  // 照片重试 (v2.6): a failed image row's 重试 button re-fires the SAME
  // generatePhoto path the engine used. Cap re-checked with a fresh pref read
  // (time may have passed since the original failure) before anything is
  // mutated; the fal key is re-checked too (it may have been cleared since).
  // 实拍 (v2.8): re-fire with the SAME shot the row was generated with — a
  // legacy row with no shot field predates the discriminator and can only
  // have meant 'selfie'.
  const retryPhoto = async (messageId: string, image: ImageContent) => {
    if (!persona) return;
    const dayKey = imageDayKey(id, new Date());
    const used = parseInt(getPref(dayKey) ?? '0', 10) || 0;
    if (!canGenerateToday(used, getImageDailyCap())) {
      Alert.alert('今天的额度用完了', `每天最多生成 ${getImageDailyCap()} 张，明天再来吧。`);
      return;
    }
    const falKey = await getFalKey();
    if (!falKey) {
      Alert.alert('无法重试', '请先在设置里填入 fal.ai Key。');
      return;
    }
    const shot: PhotoShot = image.shot ?? 'selfie';
    setPref(dayKey, String(used + 1));
    updateMessageContent(messageId, JSON.stringify({ status: 'pending', scene: image.scene, shot }));
    reload();
    void generatePhoto(
      id, messageId, persona.id, persona.appearancePrompt ?? '', image.scene, shot, falKey,
    );
  };

  const bubbles = useMemo(() => {
    if (displayDraft === null) return toBubbles(visible, null, resolveQuote);
    if (mode === 'typewriter') return toBubbles(visible, displayDraft, resolveQuote);
    const shown = draftSegments.slice(0, revealed);
    const base = toBubbles(visible, null, resolveQuote);
    const extra: Bubble[] = shown.map((text, i) => ({
      key: `draft:${i}`, role: 'assistant' as const, text, streaming: true,
    }));
    return [...extra.reverse(), ...base];
  }, [visible, displayDraft, mode, draftSegments, revealed, resolveQuote]);

  const last = visible[visible.length - 1];
  const showRetry =
    !isStreaming(id) && !isHoldPending(id) && draft === null && last?.role === 'user';

  const inspectorData = useMemo(() => {
    if (!inspector || !convo || !persona) return null;
    const all = listMessages(id);
    const window = selectWindow(all, getHistoryBudget());
    const api = buildRequestMessages(persona.systemPrompt, convo.summary, window, SUMMARY_PREFIX);
    const cfg = parseProConfig(persona.proConfig);
    const nowD = new Date();
    const mood = decayedMood(
      convo.moodLabel, convo.moodIntensity, convo.moodUpdatedAt,
      cfg?.moodBaseline ?? '平静', nowD.getTime(),
    );
    const drift = parseDrift(convo.curveDrift);
    const curveRows = cfg?.moodCurve
      ? DAY_PARTS.filter((p) => cfg.moodCurve![p]).map((p) => {
          const base = cfg.moodCurve![p]!.openness;
          const eff = effectiveOpenness(base, drift.parts[p], nowD.getTime());
          return { part: p, base, eff };
        })
      : null;
    return {
      personaText: persona.systemPrompt,
      summary: convo.summary,
      memoryOn: convo.memoryEnabled === 1,
      memories: listMemories(id),
      windowCount: window.length,
      windowTokens: window.reduce((n, m) => n + estimateTokens(m.content), 0),
      summarizedOnly: countUnsummarized(all, window, convo.summaryUpToId),
      totalMessages: all.length,
      apiCount: api.length,
      realism: convo.lifeEnabled === 1 || cfg !== null,
      mood,
      activity: activityAt(cfg?.schedule, nowD),
      thought: convo.currentThought,
      curveRows,
      driftLog: drift.log,
      masterOn: cfg?.master === true && cfg.masterConsent === true,
      discipline: convo.discipline ?? 50,
      honorific: convo.masterHonorific,
      rules: convo.masterRules,
    };
  }, [inspector, convo, persona, id, messages]);

  const menuActions = actionMenu
    ? dmMessageActions({
        kind: actionMenu.message.kind, role: actionMenu.message.role, voiceOn,
      })
    : [];

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen
        options={{
          title:
            draft !== null && mode === 'simulated'
              ? '对方正在键入…'
              : (convo?.title ?? ''),
          headerLeft: yandereOn
            ? () => (
                <Pressable onPress={askToLeave} style={{ paddingHorizontal: 8 }}>
                  <Text style={{ color: th.accent, fontSize: 22 }}>‹</Text>
                </Pressable>
              )
            : undefined,
          gestureEnabled: !yandereOn,
          headerRight: () => (
            <Pressable
              style={[s.chip, { backgroundColor: th.accentSoft }]}
              onPress={() => setInspector(true)}
            >
              <Text style={[s.chipTxt, { color: th.accent }]}>{persona?.name ?? ''}</Text>
            </Pressable>
          ),
        }}
      />
      <FlatList
        inverted
        data={bubbles}
        keyExtractor={(b) => b.key}
        contentContainerStyle={{ padding: 12 }}
        renderItem={({ item }) => {
          if (item.divider) {
            return <Text style={s.divider}>{item.text}</Text>;
          }
          if (item.meta) {
            const line = <Text style={s.metaLine}>{item.text}</Text>;
            return item.srcId ? (
              <Pressable
                onLongPress={(e) =>
                  item.srcId && openMessageActions(item.srcId, {
                    x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, width: 0, height: 0,
                  })
                }
              >
                {line}
              </Pressable>
            ) : line;
          }
          if (item.game) {
            return (
              <Pressable
                style={s.gameCard}
                onLongPress={(e) =>
                  item.srcId && openMessageActions(item.srcId, {
                    x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, width: 0, height: 0,
                  })
                }
              >
                <Text style={s.gameTxt}>{item.text}</Text>
              </Pressable>
            );
          }
          if (item.transfer) {
            const tMine = item.role === 'user';
            const pending = item.transfer.status === 'pending';
            // Her pending transfer is the "orange card you tap to receive".
            const claimable = !tMine && pending;
            return (
              <View style={[s.msgRow, tMine && s.rowMine]}>
                {!tMine && <Avatar uri={persona?.avatarUri} name={persona?.name ?? '?'} />}
                <Pressable
                  style={[s.xferCard, pending ? s.xferPending : s.xferDone]}
                  onPress={() => {
                    if (!claimable) return;
                    if (item.srcId && receiveTransfer(item.srcId) > 0) reload();
                  }}
                  onLongPress={(e) =>
                    item.srcId && openMessageActions(item.srcId, {
                      x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, width: 0, height: 0,
                    })
                  }
                >
                  <Text style={s.xferAmt}>{fmtMoney(item.transfer.amount)}</Text>
                  <Text style={s.xferLabel}>
                    {claimable
                      ? '转账给你 · 点击领取'
                      : tMine
                        ? '你的转账 · 已收款'
                        : '转账给你 · 已领取'}
                  </Text>
                </Pressable>
                {tMine && <Avatar uri={userAvatar} name={userNick} />}
              </View>
            );
          }
          if (item.pat) {
            return (
              <Pressable
                onLongPress={(e) =>
                  item.srcId && openMessageActions(item.srcId, {
                    x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, width: 0, height: 0,
                  })
                }
              >
                <Text style={s.patLine}>
                  {item.role === 'user' ? patEmojiMine : patEmojiHer} {item.text}
                </Text>
              </Pressable>
            );
          }
          const mine = item.role === 'user';
          if (item.sticker) {
            const st = stickerMap.get(item.text);
            return (
              <View style={[s.msgRow, mine && s.rowMine]}>
                {!mine && (
                  <Pressable onPress={onAvatarTap}>
                    <Avatar uri={persona?.avatarUri} name={persona?.name ?? '?'} />
                  </Pressable>
                )}
                <Pressable
                  onLongPress={(e) =>
                    item.srcId && openMessageActions(item.srcId, {
                      x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, width: 0, height: 0,
                    })
                  }
                >
                  {st ? (
                    <Image source={st.image} style={s.stickerImg} contentFit="contain" />
                  ) : (
                    <View style={[s.bubble, s.theirs]}>
                      <Text style={s.bubbleTxt}>[表情包]</Text>
                    </View>
                  )}
                </Pressable>
                {mine && <Avatar uri={userAvatar} name={userNick} />}
              </View>
            );
          }
          if (item.image) {
            const img = item.image;
            return (
              <View style={[s.msgRow, mine && s.rowMine]}>
                {!mine && (
                  <Pressable onPress={onAvatarTap}>
                    <Avatar uri={persona?.avatarUri} name={persona?.name ?? '?'} />
                  </Pressable>
                )}
                <Pressable
                  onPress={() => img.status === 'done' && img.uri && setPhotoViewer(img.uri)}
                  onLongPress={(e) =>
                    item.srcId && openMessageActions(item.srcId, {
                      x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, width: 0, height: 0,
                    })
                  }
                >
                  {img.status === 'pending' && (
                    <View style={s.photoPending}>
                      <Text style={s.photoPendingIcon}>⏳</Text>
                      <Text style={s.photoPendingLabel}>正在拍…</Text>
                      <Text style={s.photoScene} numberOfLines={2}>{img.scene}</Text>
                    </View>
                  )}
                  {img.status === 'done' && (
                    <Image source={img.uri} style={s.photoImg} contentFit="cover" />
                  )}
                  {img.status === 'failed' && (
                    <View style={s.photoFailed}>
                      <Text style={s.photoFailedTxt}>📷 {img.reason ?? '生成失败'}</Text>
                      <Pressable
                        hitSlop={8}
                        onPress={() => item.srcId && void retryPhoto(item.srcId, img)}
                      >
                        <Text style={[s.photoRetryTxt, { color: th.accent }]}>重试</Text>
                      </Pressable>
                    </View>
                  )}
                </Pressable>
                {mine && <Avatar uri={userAvatar} name={userNick} />}
              </View>
            );
          }
          return (
            <View style={[s.msgRow, mine && s.rowMine]}>
              {!mine && (
                <Pressable onPress={onAvatarTap}>
                  <Avatar uri={persona?.avatarUri} name={persona?.name ?? '?'} />
                </Pressable>
              )}
              <View style={s.msgCol}>
                {showNick && (
                  <Text style={[s.nick, mine && s.nickMine]}>
                    {mine ? userNick : persona?.name}
                  </Text>
                )}
                <Pressable
                  onLongPress={(e) =>
                    item.srcId && openMessageActions(item.srcId, {
                      x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, width: 0, height: 0,
                    })
                  }
                  style={[
                    s.bubble,
                    mine ? [s.mine, { backgroundColor: th.userBubble }] : s.theirs,
                  ]}
                >
                  {item.quote && (
                    <View style={[s.quoteBlock, { borderLeftColor: th.accent }]}>
                      <Text style={s.quoteWho}>{item.quote.who}</Text>
                      <Text style={s.quoteTxt} numberOfLines={2}>{item.quote.text}</Text>
                    </View>
                  )}
                  {showThinking && item.reasoning && (
                    <Pressable
                      onPress={() =>
                        setExpandedThinking((prev) => {
                          const next = new Set(prev);
                          if (next.has(item.key)) next.delete(item.key);
                          else next.add(item.key);
                          return next;
                        })
                      }
                    >
                      <Text style={s.thinkToggle}>
                        {expandedThinking.has(item.key) ? '▾' : '▸'} 思考过程
                      </Text>
                      {expandedThinking.has(item.key) && (
                        <Text style={s.thinkBody}>{item.reasoning}</Text>
                      )}
                    </Pressable>
                  )}
                  {item.voice ? (
                    <View>
                      <Pressable
                        onPress={() => {
                          if (item.voice?.status === 'done' && item.voice.path) void playFile(item.voice.path);
                        }}
                      >
                        <Text style={s.voiceLine}>
                          {item.voice.status === 'pending'
                            ? '🔊 语音 · 生成中…'
                            : item.voice.status === 'failed'
                              ? '🔊 语音 · 生成失败'
                              : '▶  语音'}
                        </Text>
                      </Pressable>
                      {(item.voice.status === 'failed' || voiceShown.has(item.key)) && (
                        <Text style={s.voiceText}>{item.voice.text}</Text>
                      )}
                      {item.voice.status !== 'failed' && (
                        <Pressable
                          hitSlop={6}
                          onPress={() =>
                            setVoiceShown((prev) => {
                              const next = new Set(prev);
                              if (next.has(item.key)) next.delete(item.key);
                              else next.add(item.key);
                              return next;
                            })
                          }
                        >
                          <Text style={s.voiceToggle}>{voiceShown.has(item.key) ? '收起文字' : '转文字'}</Text>
                        </Pressable>
                      )}
                    </View>
                  ) : !mine && mdOn ? (
                    <Markdown text={item.text} />
                  ) : (
                    <BubbleText text={item.text} />
                  )}
                  {item.interrupted && <Text style={s.cut}>⚠ 已截断</Text>}
                </Pressable>
                {item.read && <Text style={s.readTag}>已读</Text>}
              </View>
              {mine && <Avatar uri={userAvatar} name={userNick} />}
            </View>
          );
        }}
      />
      {askingLeave && (
        <View style={s.heldBar}>
          <Text style={s.heldTxt}>正在征求她的同意才能离开…（按手机 Home 键可随时退出应用）</Text>
        </View>
      )}
      {held && !askingLeave && (
        <View style={s.heldBar}>
          <Text style={s.heldTxt}>她拉住了你，先回复她吧…</Text>
        </View>
      )}
      {countdown !== null && (
        <View style={s.countdownBar}>
          <Text style={s.countdownTxt}>限你 {countdown} 秒内回复……</Text>
        </View>
      )}
      {error && (
        <View style={s.errorBar}>
          <Text style={s.errorTxt}>{error}</Text>
        </View>
      )}
      {showRetry && (
        <Pressable
          style={[s.retry, { backgroundColor: th.accentSoft }]}
          onPress={() => begin(null)}
        >
          <Text style={[s.retryTxt, { color: th.accent }]}>重试上一条</Text>
        </Pressable>
      )}
      {replyingTo && (
        <View style={[s.replyChip, { backgroundColor: th.accentSoft }]}>
          <View style={{ flex: 1 }}>
            <Text style={[s.replyChipWho, { color: th.accent }]}>
              回复 {replyingTo.role === 'user' ? userNick : persona?.name}
            </Text>
            <Text style={s.replyChipTxt} numberOfLines={1}>
              {replyingTo.kind === 'sticker'
                ? '[表情包]'
                : stripLeakedStateTags(replyingTo.content)}
            </Text>
          </View>
          <Pressable onPress={() => setReplyingTo(null)} hitSlop={8}>
            <Text style={{ color: '#999', fontSize: 18 }}>✕</Text>
          </Pressable>
        </View>
      )}
      <View style={s.inputBar}>
        <Pressable
          style={[s.sparkle, { backgroundColor: th.accentSoft }]}
          onPress={() => {
            // WeChat pattern: panel replaces the keyboard rather than stacking
            // under it (also makes the input's onFocus close-path reachable).
            if (!plusOpen) Keyboard.dismiss();
            setPlusOpen((o) => !o);
          }}
        >
          <Text style={{ fontSize: 18, color: th.accent }}>{plusOpen ? '✕' : '＋'}</Text>
        </Pressable>
        <TextInput
          style={s.input}
          value={input}
          onChangeText={(t) => {
            setInput(t);
            noteTyping(id, t.trim().length > 0);
          }}
          onFocus={() => setPlusOpen(false)}
          placeholder="输入消息…"
          multiline
        />
        {isStreaming(id) && (!mergeOn || !input.trim()) ? (
          <Pressable style={[s.send, s.stop]} onPress={() => stopTurn(id)}>
            <Text style={s.sendTxt}>停止</Text>
          </Pressable>
        ) : (
          <Pressable style={[s.send, { backgroundColor: th.accent }]} onPress={send}>
            <Text style={s.sendTxt}>发送</Text>
          </Pressable>
        )}
      </View>
      {plusOpen && (
        <View style={s.plusPanel}>
          {plusItems.filter((it) => it.show).map((it) => (
            <Pressable
              key={it.key}
              style={s.plusItem}
              onPress={() => {
                setPlusOpen(false);
                it.onPress();
              }}
            >
              <View style={[s.plusIcon, { backgroundColor: th.accentSoft }]}>
                <Text style={{ fontSize: 22 }}>{it.icon}</Text>
              </View>
              <Text style={s.plusLabel}>{it.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <BiometricLock
        visible={locked}
        line={`不许走……先证明你只属于我，${userNick}。`}
        onUnlock={() => setLocked(false)}
      />
      <CommandCard command={command} onObey={() => setCommand(null)} />
      <DemandGate phrase={demand} onSatisfied={() => setDemand(null)} />
      <Modal visible={stickerOpen} transparent animationType="fade">
        <Pressable style={s.stickerBackdrop} onPress={() => setStickerOpen(false)}>
          <View style={s.stickerSheet}>
            <Text style={s.stickerTitle}>
              {stickers.length ? '表情包（长按删除）' : '还没有表情包——在设置中导入 zip 表情包'}
            </Text>
            <FlatList
              data={stickers}
              numColumns={4}
              keyExtractor={(st) => st.id}
              style={{ maxHeight: 320 }}
              renderItem={({ item: st }) => (
                <Pressable
                  style={s.stickerCell}
                  onPress={() => beginSticker(st.id)}
                  onLongPress={() =>
                    Alert.alert('删除表情包？', st.desc || st.label, [
                      { text: '取消', style: 'cancel' },
                      {
                        text: '删除',
                        style: 'destructive',
                        onPress: () => {
                          deleteSticker(st.id);
                          setStickerVersion((x) => x + 1);
                        },
                      },
                    ])
                  }
                >
                  <Image source={st.image} style={s.stickerThumb} contentFit="contain" />
                  <Text style={s.stickerLabel} numberOfLines={2}>
                    {st.desc || st.label}
                  </Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
      <Modal visible={gameOpen} transparent animationType="fade">
        <Pressable
          style={s.stickerBackdrop}
          onPress={() => {
            setGameOpen(false);
            setRpsFor(null);
          }}
        >
          <View style={s.stickerSheet}>
            {rpsFor ? (
              <>
                <Text style={s.stickerTitle}>{rpsFor.label}——出什么？</Text>
                <View style={s.gameRow}>
                  {rpsFor.moves?.map((mv) => (
                    <Pressable
                      key={mv.key}
                      style={[s.gameMove, { backgroundColor: th.accentSoft }]}
                      onPress={() => playGame(rpsFor, mv.key)}
                    >
                      <Text style={{ fontSize: 30 }}>{mv.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : (
              <>
                <Text style={s.stickerTitle}>小游戏（结果她也会看到并回应）</Text>
                <View style={s.gameRow}>
                  {GAMES.map((g) => (
                    <Pressable
                      key={g.id}
                      style={[s.gameBtn, { backgroundColor: th.accentSoft }]}
                      onPress={() => (g.kind === 'move' ? setRpsFor(g) : playGame(g))}
                    >
                      <Text style={[s.gameBtnTxt, { color: th.accent }]}>{g.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </View>
        </Pressable>
      </Modal>
      <Modal visible={transferOpen} transparent animationType="fade">
        <Pressable style={s.stickerBackdrop} onPress={() => setTransferOpen(false)}>
          <View style={s.stickerSheet}>
            <Text style={s.stickerTitle}>转账给她（余额 {fmtMoney(getUserBalance())}）</Text>
            <View style={s.gameRow}>
              {[5.2, 13.14, 52, 520].map((a) => (
                <Pressable
                  key={a}
                  style={[s.gameBtn, { backgroundColor: th.accentSoft }]}
                  onPress={() => doTransfer(a)}
                >
                  <Text style={[s.gameBtnTxt, { color: th.accent }]}>{fmtMoney(a)}</Text>
                </Pressable>
              ))}
            </View>
            <View style={s.xferInputRow}>
              <TextInput
                style={[s.input, { flex: 1 }]}
                value={transferAmt}
                onChangeText={setTransferAmt}
                placeholder="自定义金额"
                keyboardType="decimal-pad"
              />
              <Pressable
                style={[s.send, { backgroundColor: th.accent }]}
                onPress={() => doTransfer(parseFloat(transferAmt) || 0)}
              >
                <Text style={s.sendTxt}>转账</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
      <Modal
        visible={photoViewer !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPhotoViewer(null)}
      >
        <Pressable style={s.viewerBackdrop} onPress={() => setPhotoViewer(null)}>
          {photoViewer && <Image source={photoViewer} style={s.viewerImg} contentFit="contain" />}
        </Pressable>
      </Modal>
      <ChatInspector
        visible={inspector}
        conversationId={id}
        data={inspectorData}
        lifeEnabled={convo?.lifeEnabled === 1}
        devMode={devMode}
        memoryEdit={memoryEdit}
        setMemoryEdit={setMemoryEdit}
        onOpenMemoryEditor={openMemoryEditor}
        onSaveMemoryEdit={saveMemoryEdit}
        canMutateManualMemory={canMutateManualMemory}
        onClose={() => setInspector(false)}
        onChanged={() => forceRender((x) => x + 1)}
      />
      <MessageActionMenu
        visible={actionMenu !== null}
        anchor={actionMenu?.anchor ?? null}
        actions={menuActions}
        onAction={handleMenuAction}
        onClose={() => setActionMenu(null)}
      />
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f6f6f6' },
  chip: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  chipTxt: { fontSize: 13 },
  divider: {
    alignSelf: 'center', fontSize: 11, color: '#b0b0b0',
    marginVertical: 10, textAlign: 'center',
  },
  msgRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginVertical: 4 },
  rowMine: { justifyContent: 'flex-end' },
  msgCol: { flexShrink: 1, maxWidth: '75%' },
  nick: { fontSize: 11, color: '#999', marginBottom: 2, marginLeft: 4 },
  nickMine: { textAlign: 'right', marginRight: 4, marginLeft: 0 },
  bubble: { borderRadius: 18, paddingHorizontal: 12, paddingVertical: 9 },
  mine: { alignSelf: 'flex-end', borderTopRightRadius: 6 },
  theirs: {
    alignSelf: 'flex-start', backgroundColor: '#fff', borderTopLeftRadius: 6,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#e8e8e8',
  },
  bubbleTxt: { fontSize: 16, lineHeight: 22 },
  action: { color: '#9a9a9a', fontStyle: 'italic' },
  patLine: {
    alignSelf: 'center', fontSize: 12, color: '#999',
    marginVertical: 8, textAlign: 'center',
  },
  readTag: { fontSize: 10, color: '#aaa', alignSelf: 'flex-end', marginTop: 2, marginRight: 4 },
  voiceLine: { fontSize: 15, color: '#333' },
  voiceText: { fontSize: 13, color: '#666', marginTop: 6, lineHeight: 18 },
  voiceToggle: { fontSize: 11, color: '#999', marginTop: 4 },
  metaLine: {
    alignSelf: 'center', fontSize: 11, color: '#a06a80', marginVertical: 6,
    textAlign: 'center', backgroundColor: '#f6eaf0', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 3, overflow: 'hidden',
  },
  gameCard: {
    alignSelf: 'center', backgroundColor: '#f0e9f5', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 8, marginVertical: 8, maxWidth: '85%',
  },
  gameTxt: { fontSize: 14, color: '#5b4a63', textAlign: 'center', lineHeight: 20 },
  gameRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  gameBtn: { borderRadius: 12, paddingHorizontal: 18, paddingVertical: 14, marginBottom: 4 },
  gameBtnTxt: { fontSize: 16 },
  gameMove: {
    width: 72, height: 72, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
  },
  xferInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  xferCard: {
    minWidth: 180, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    borderTopLeftRadius: 6,
  },
  xferPending: { backgroundColor: '#F9A825' }, // WeChat-style orange, tap to receive
  xferDone: { backgroundColor: '#E4B06A' },
  xferAmt: { color: '#fff', fontSize: 20, fontWeight: '700' },
  xferLabel: { color: '#fff', fontSize: 12, marginTop: 3, opacity: 0.92 },
  quoteBlock: {
    borderLeftWidth: 2, paddingLeft: 8, marginBottom: 6, opacity: 0.85,
  },
  quoteWho: { fontSize: 11, fontWeight: '600', color: '#888' },
  quoteTxt: { fontSize: 12.5, color: '#888', lineHeight: 17 },
  replyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 8, marginBottom: 4, paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 10,
  },
  replyChipWho: { fontSize: 12, fontWeight: '600' },
  replyChipTxt: { fontSize: 12.5, color: '#777', marginTop: 1 },
  stickerImg: { width: 110, height: 110, borderRadius: 10 },
  photoPending: {
    width: 200, height: 150, borderRadius: 14, backgroundColor: '#eee',
    alignItems: 'center', justifyContent: 'center', padding: 10,
  },
  photoPendingIcon: { fontSize: 26, marginBottom: 4 },
  photoPendingLabel: { fontSize: 13, color: '#888', marginBottom: 4 },
  photoScene: { fontSize: 11, color: '#aaa', textAlign: 'center' },
  photoImg: { width: 220, height: 240, borderRadius: 14, backgroundColor: '#eee' },
  photoFailed: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#eee',
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, maxWidth: 240,
  },
  photoFailedTxt: { fontSize: 13, color: '#888', flexShrink: 1 },
  photoRetryTxt: { fontSize: 13, fontWeight: '600' },
  viewerBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center',
  },
  viewerImg: { width: '100%', height: '80%' },
  thinkToggle: { fontSize: 12, color: '#8a8a8a', marginBottom: 4 },
  thinkBody: {
    fontSize: 13, color: '#8a8a8a', lineHeight: 18, marginBottom: 6,
    borderLeftWidth: 2, borderLeftColor: '#ddd', paddingLeft: 8,
  },
  stickerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  stickerSheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 14, borderTopRightRadius: 14,
    padding: 16, paddingBottom: 32,
  },
  stickerTitle: { fontSize: 14, color: '#888', marginBottom: 10 },
  stickerCell: { flex: 1 / 4, alignItems: 'center', marginBottom: 12 },
  stickerThumb: { width: 64, height: 64, borderRadius: 8 },
  stickerLabel: { fontSize: 11, color: '#888', marginTop: 2, maxWidth: 70 },
  cut: { fontSize: 11, color: '#b58900', marginTop: 4 },
  errorBar: { backgroundColor: '#fdecea', padding: 10 },
  errorTxt: { color: '#a32d2d', fontSize: 13 },
  heldBar: { backgroundColor: '#fbeaf0', padding: 10 },
  heldTxt: { color: '#993556', fontSize: 13, textAlign: 'center' },
  countdownBar: { backgroundColor: '#a32d2d', padding: 10 },
  countdownTxt: { color: '#fff', fontSize: 14, textAlign: 'center', fontWeight: '600' },
  retry: {
    alignSelf: 'center', marginVertical: 6, paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 14,
  },
  retryTxt: { fontSize: 13 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', padding: 8, backgroundColor: '#fff' },
  sparkle: {
    width: 40, height: 40, borderRadius: 20, marginRight: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  input: {
    flex: 1, maxHeight: 120, fontSize: 16, padding: 8,
    backgroundColor: '#f2f2f2', borderRadius: 10,
  },
  plusPanel: {
    flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#fff',
    paddingHorizontal: 12, paddingTop: 4, paddingBottom: 14,
  },
  plusItem: { width: '25%', alignItems: 'center', paddingVertical: 10 },
  plusIcon: {
    width: 52, height: 52, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  plusLabel: { fontSize: 11, color: '#666' },
  send: { marginLeft: 8, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  stop: { backgroundColor: '#a32d2d' },
  sendTxt: { color: '#fff', fontSize: 15 },
});
