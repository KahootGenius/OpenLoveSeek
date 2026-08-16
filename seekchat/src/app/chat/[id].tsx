import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, BackHandler, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Switch, Text, TextInput, Vibration, View,
} from 'react-native';
// expo-image (not RN Image) so GIF/WebP stickers ANIMATE on Android.
import { Image } from 'expo-image';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  clearMemories, clearSummary, deleteMemory, deleteMessageAndResetContext, deleteSticker,
  getConversation, getPersona, insertMemory, listMemories, listMessages, listStickers,
  setCurveDrift, setLifeEnabled, setMemoryEnabled, updateMemory,
} from '../../lib/db';
import {
  canAddManualMemory, extractMemoryMarkers, fmtMemoryDate, MAX_MEMORY_ENTRIES,
  MAX_MEMORY_TEXT, normalizeManualMemoryText,
} from '../../lib/memory';
import { messageActionsForKind } from '../../lib/message-deletion';
import { cancelConversationOutreach } from '../../lib/background';

import { DAY_PARTS, effectiveOpenness, parseDrift } from '../../lib/curve';
import {
  fireTrigger, isHoldPending, isStreaming, isSummarizing, logMeta, noteTyping, receiveTransfer,
  requestLeave, sendGame, sendPat, sendSticker, sendTransfer, sendTurn, stopTurn,
  subscribeMessages, subscribeYandere,
} from '../../lib/engine';
import { GAMES, GameDef, RpsMove } from '../../lib/games';
import { fmtMoney, parseTransfer, TransferStatus } from '../../lib/transfer';
import { extractYandereMarkers, HOLD_TIMEOUT_MS } from '../../lib/yandere';
import { clampDiscipline, extractMasterMarkers } from '../../lib/master';
import { extractStickerMarkers } from '../../lib/stickers';
import { setDiscipline } from '../../lib/db';
import { BiometricLock } from '../../components/BiometricLock';
import { CommandCard } from '../../components/CommandCard';
import { DemandGate } from '../../components/DemandGate';
import { splitBrackets } from '../../lib/brackets';
import { ApiError, userMessageFor } from '../../lib/deepseek';
import {
  buildRequestMessages, countUnsummarized, estimateTokens, selectWindow,
} from '../../lib/context';
import { LIFE_IDLE_MINUTES, SUMMARY_PREFIX } from '../../lib/constants';
import {
  getDeliveryMode, getDevMode, getMarkdownEnabled, getMergeReplies, getShowNicknames,
  getShowThinking, getUserAvatar, getUserBalance, getUserNickname,
} from '../../lib/settings';
import { activityAt, decayedMood, TriggerPath } from '../../lib/life';
import { fmtDivider, hasRealismConfig, parseProConfig } from '../../lib/pro';
import { extractPatMarker } from '../../lib/markers';
import {
  cleanDraftForDisplay, stripEchoedTimestamps, stripLeakedStateTags,
} from '../../lib/statetag';
import { useTheme } from '../../lib/theme-context';
import { Avatar } from '../../components/Avatar';
import { Markdown } from '../../lib/markdown';
import type { Message } from '../../lib/types';

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
  reasoning?: string;
  srcId?: string; // the source message id (for 引用 long-press)
  quote?: { who: string; text: string }; // 引用 target, shown above the first bubble
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
  const [, forceRender] = useState(0);
  const busy = useRef(false);
  const firedThisFocus = useRef(false);

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
  const [stickerVersion, setStickerVersion] = useState(0);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [gameOpen, setGameOpen] = useState(false);
  const [rpsFor, setRpsFor] = useState<GameDef | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferAmt, setTransferAmt] = useState('');
  const [plusOpen, setPlusOpen] = useState(false);
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set());
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
    if (stickers.length > 0) d = extractStickerMarkers(d).clean;
    if (yandereOn) d = extractYandereMarkers(d).clean;
    if (masterOn) d = extractMasterMarkers(d).clean;
    if (realismOn) d = extractPatMarker(d).clean;
    return d;
  }, [draft, memoryOn, stickers.length, yandereOn, masterOn, realismOn]);

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
      if (!firedThisFocus.current) {
        firedThisFocus.current = true;
        beginTrigger('catchup');
      }
      return () => {
        firedThisFocus.current = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reload]),
  );

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

  const openMessageActions = (messageId: string) => {
    const message = msgById.get(messageId);
    if (!message) return;
    const actions = messageActionsForKind(message.kind);
    if (actions.length === 0) return;
    Alert.alert('消息操作', undefined, [
      ...(actions.includes('reply')
        ? [{ text: '回复', onPress: () => setReplyingTo(message) }]
        : []),
      {
        text: '删除',
        style: 'destructive' as const,
        onPress: () => confirmDeleteMessage(message),
      },
      { text: '取消', style: 'cancel' as const },
    ]);
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
    const window = selectWindow(all);
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
              <Pressable onLongPress={() => item.srcId && openMessageActions(item.srcId)}>
                {line}
              </Pressable>
            ) : line;
          }
          if (item.game) {
            return (
              <Pressable
                style={s.gameCard}
                onLongPress={() => item.srcId && openMessageActions(item.srcId)}
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
                  onLongPress={() => item.srcId && openMessageActions(item.srcId)}
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
              <Pressable onLongPress={() => item.srcId && openMessageActions(item.srcId)}>
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
                  onLongPress={() => item.srcId && openMessageActions(item.srcId)}
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
                  onLongPress={() => item.srcId && openMessageActions(item.srcId)}
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
                  {!mine && mdOn ? (
                    <Markdown text={item.text} />
                  ) : (
                    <BubbleText text={item.text} />
                  )}
                  {item.interrupted && <Text style={s.cut}>⚠ 已截断</Text>}
                </Pressable>
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
        visible={inspector}
        animationType="slide"
        onRequestClose={() => {
          if (memoryEdit) setMemoryEdit(null);
          else setInspector(false);
        }}
      >
        <View style={s.insModalRoot}>
          <ScrollView style={s.insRoot} contentContainerStyle={{ padding: 16 }}>
          <Text style={s.insTitle}>上下文检查器（下一次请求将发送）</Text>
          {inspectorData && (
            <>
              <Text style={s.insHead}>
                共 {inspectorData.totalMessages} 条消息 → 发送 {inspectorData.apiCount} 段：
                人设 + {inspectorData.summary ? '总结 + ' : ''}
                最近 {inspectorData.windowCount} 条（约 {inspectorData.windowTokens} tokens）；
                仅存在于总结中的旧消息 {inspectorData.summarizedOnly} 条
              </Text>
              <View style={s.lifeRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.lifeTitle}>生活（Life）</Text>
                  <Text style={s.lifeNotice}>
                    ⚠ 开启后：主动消息会产生额外 API 请求，注入的状态上下文也会增加每次请求的
                    token 用量，请留意 DeepSeek 余额。
                  </Text>
                </View>
                <Switch
                  value={convo?.lifeEnabled === 1}
                  onValueChange={(v) => {
                    setLifeEnabled(id, v);
                    forceRender((x) => x + 1);
                  }}
                  trackColor={{ true: th.accent }}
                />
              </View>
              <View style={s.lifeRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.lifeTitle}>记忆库（她亲手记下的长期记忆）</Text>
                  <Text style={s.lifeNotice}>
                    独立于聊天记录、永不遗忘，注入每次请求（越多越贵，上限 {MAX_MEMORY_ENTRIES} 条，
                    由她自己增删维护）。手动添加、编辑或删除仅在开发者模式下可用。
                  </Text>
                </View>
                <Switch
                  value={inspectorData.memoryOn}
                  onValueChange={(v) => {
                    setMemoryEnabled(id, v);
                    forceRender((x) => x + 1);
                  }}
                  trackColor={{ true: th.accent }}
                />
              </View>
              {(devMode || inspectorData.memoryOn || inspectorData.memories.length > 0) && (
                <>
                  {devMode && canAddManualMemory(inspectorData.memories.length) && (
                    <Pressable
                      style={[s.retry, { backgroundColor: th.accentSoft }]}
                      onPress={() => openMemoryEditor(null)}
                    >
                      <Text style={[s.retryTxt, { color: th.accent }]}>＋ 添加记忆</Text>
                    </Pressable>
                  )}
                  {inspectorData.memories.length === 0 ? (
                    <Text style={s.insBlock}>（还没有记忆——聊到重要的事她会记下来）</Text>
                  ) : (
                    inspectorData.memories.map((m, i) => (
                      <View key={m.id} style={s.memRow}>
                        <Text style={s.memText}>
                          {i + 1}. [{fmtMemoryDate(m.createdAt)}] {m.text}
                        </Text>
                        {devMode && (
                          <View style={s.memActions}>
                            <Pressable
                              style={s.memEdit}
                              onPress={() => openMemoryEditor(m.id, m.text)}
                            >
                              <Text style={{ color: th.accent, fontSize: 14 }}>编辑</Text>
                            </Pressable>
                            <Pressable
                              style={s.memDel}
                              onPress={() => {
                                if (!canMutateManualMemory()) return;
                                Alert.alert('删除这条记忆？', '删除后不会再注入后续请求。', [
                                  { text: '取消', style: 'cancel' },
                                  {
                                    text: '删除',
                                    style: 'destructive',
                                    onPress: () => {
                                      if (!canMutateManualMemory()) return;
                                      deleteMemory(m.id);
                                      forceRender((x) => x + 1);
                                    },
                                  },
                                ]);
                              }}
                            >
                              <Text style={{ color: '#a32d2d', fontSize: 14 }}>✕</Text>
                            </Pressable>
                          </View>
                        )}
                      </View>
                    ))
                  )}
                  {devMode && inspectorData.memories.length > 0 && (
                    <Pressable
                      style={[s.retry, { backgroundColor: '#fdecea', marginTop: 6 }]}
                      onPress={() => {
                        if (!canMutateManualMemory()) return;
                        Alert.alert('清空她的全部记忆？', '此操作不可撤销。', [
                          { text: '取消', style: 'cancel' },
                          {
                            text: '清空',
                            style: 'destructive',
                            onPress: () => {
                              if (!canMutateManualMemory()) return;
                              clearMemories(id);
                              forceRender((x) => x + 1);
                            },
                          },
                        ]);
                      }}
                    >
                      <Text style={[s.retryTxt, { color: '#a32d2d' }]}>清空记忆库</Text>
                    </Pressable>
                  )}
                </>
              )}
              {inspectorData.realism && (
                <>
                  <Text style={s.insLabel}>当前状态（注入下一次请求）</Text>
                  <Text style={s.insBlock}>
                    心情：{inspectorData.mood.label}
                    {inspectorData.mood.intensity > 0
                      ? `（强度${inspectorData.mood.intensity.toFixed(1)}）`
                      : ''}
                    {inspectorData.activity ? `\n日程：${inspectorData.activity}` : ''}
                    {inspectorData.thought ? `\n心想：${inspectorData.thought}` : ''}
                  </Text>
                </>
              )}
              {inspectorData.curveRows && (
                <>
                  <Text style={s.insLabel}>情绪曲线（基线 → 现值，含成长漂移）</Text>
                  <Text style={s.insBlock}>
                    {inspectorData.curveRows
                      .map((r) =>
                        r.base === r.eff
                          ? `${r.part} ${r.base.toFixed(1)}`
                          : `${r.part} ${r.base.toFixed(1)} → ${r.eff.toFixed(2)}`,
                      )
                      .join('\n')}
                    {inspectorData.driftLog.length > 0
                      ? '\n成长记录：' +
                        inspectorData.driftLog
                          .map((l) => {
                            const d = new Date(l.at);
                            return `${d.getMonth() + 1}月${d.getDate()}日 ${l.part}${l.step > 0 ? '+' : ''}${l.step}`;
                          })
                          .join('；')
                      : ''}
                  </Text>
                  {inspectorData.driftLog.length > 0 && (
                    <Pressable
                      style={[s.retry, { backgroundColor: th.accentSoft, marginTop: 6 }]}
                      onPress={() => {
                        setCurveDrift(id, null);
                        forceRender((x) => x + 1);
                      }}
                    >
                      <Text style={[s.retryTxt, { color: th.accent }]}>重置成长</Text>
                    </Pressable>
                  )}
                </>
              )}
              {inspectorData.masterOn && (
                <>
                  <Text style={s.insLabel}>调教值</Text>
                  <Text style={s.insBlock}>{inspectorData.discipline} / 100</Text>
                  <Text style={s.insLabel}>她定的称呼与规矩（她自己设定，你只能遵从）</Text>
                  <Text style={s.insBlock}>
                    称呼：{inspectorData.honorific ?? '（她还没定）'}
                    {inspectorData.rules ? `\n规矩：\n${inspectorData.rules}` : '\n规矩：（她还没立）'}
                  </Text>
                </>
              )}
              <Text style={s.insLabel}>人设（system）</Text>
              <Text style={s.insBlock}>{inspectorData.personaText}</Text>
              <Text style={s.insLabel}>滚动总结（system）</Text>
              <Text style={s.insBlock}>{inspectorData.summary ?? '（尚无总结）'}</Text>
              {inspectorData.summary != null && (
                <Pressable
                  style={[s.retry, { backgroundColor: '#fdecea', marginTop: 6 }]}
                  onPress={() => {
                    if (isSummarizing(id)) {
                      Alert.alert('稍等一下', '正在生成总结，请几秒后再重置。');
                      return;
                    }
                    Alert.alert(
                      '重置总结？',
                      '她对旧对话的"大概记得"会清空并从历史重新生成。若总结里混入了不实内容（幻觉），用这个恢复。',
                      [
                        { text: '取消', style: 'cancel' },
                        {
                          text: '重置',
                          style: 'destructive',
                          onPress: () => {
                            clearSummary(id);
                            forceRender((x) => x + 1);
                          },
                        },
                      ],
                    );
                  }}
                >
                  <Text style={[s.retryTxt, { color: '#a32d2d' }]}>重置总结（清除混入的不实内容）</Text>
                </Pressable>
              )}
            </>
          )}
          <Pressable
            style={[s.insClose, { backgroundColor: th.accent }]}
            onPress={() => setInspector(false)}
          >
            <Text style={s.sendTxt}>关闭</Text>
          </Pressable>
          </ScrollView>
          {devMode && memoryEdit && (
            <KeyboardAvoidingView
              style={s.memoryModalBackdrop}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
              <View style={s.memoryModalCard}>
                <Text style={s.insTitle}>{memoryEdit.id ? '编辑记忆' : '添加记忆'}</Text>
                <TextInput
                  style={s.memoryInput}
                  multiline
                  maxLength={MAX_MEMORY_TEXT}
                  value={memoryEdit.text}
                  onChangeText={(text) =>
                    setMemoryEdit((prev) => prev ? { ...prev, text } : prev)
                  }
                  placeholder="输入她应该记住的内容"
                  placeholderTextColor="#999"
                />
                <Text style={s.memoryCount}>
                  {memoryEdit.text.length} / {MAX_MEMORY_TEXT}
                </Text>
                <View style={s.memoryButtons}>
                  <Pressable style={s.retry} onPress={() => setMemoryEdit(null)}>
                    <Text style={s.retryTxt}>取消</Text>
                  </Pressable>
                  <Pressable
                    style={[s.retry, { backgroundColor: th.accentSoft }]}
                    disabled={!normalizeManualMemoryText(memoryEdit.text)}
                    onPress={saveMemoryEdit}
                  >
                    <Text style={[s.retryTxt, { color: th.accent }]}>保存</Text>
                  </Pressable>
                </View>
              </View>
            </KeyboardAvoidingView>
          )}
        </View>
      </Modal>
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
  lifeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16,
    padding: 10, backgroundColor: '#f6f6f6', borderRadius: 8,
  },
  lifeTitle: { fontSize: 14, fontWeight: '600' },
  lifeNotice: { fontSize: 11, color: '#996a00', marginTop: 4, lineHeight: 15 },
  memRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f6f6f6', borderRadius: 8, padding: 8, marginTop: 6,
  },
  memText: { flex: 1, fontSize: 13, lineHeight: 18, color: '#333' },
  memActions: { flexDirection: 'row', alignItems: 'center' },
  memEdit: { padding: 4 },
  memDel: { padding: 4 },
  memoryModalBackdrop: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    justifyContent: 'center', alignItems: 'center', padding: 20,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  memoryModalCard: {
    width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 14, padding: 16,
  },
  memoryInput: {
    minHeight: 110, borderRadius: 10, backgroundColor: '#f2f2f2', padding: 10,
    fontSize: 16, lineHeight: 22, textAlignVertical: 'top',
  },
  memoryCount: { fontSize: 11, color: '#999', textAlign: 'right', marginTop: 4 },
  memoryButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
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
  insModalRoot: { flex: 1, backgroundColor: '#fff' },
  insRoot: { flex: 1, backgroundColor: '#fff' },
  insTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
  insHead: { fontSize: 14, color: '#444', marginBottom: 12, lineHeight: 20 },
  insLabel: { fontSize: 13, color: '#888', marginTop: 12, marginBottom: 4 },
  insBlock: { fontSize: 14, backgroundColor: '#f6f6f6', borderRadius: 8, padding: 10, lineHeight: 20 },
  insClose: {
    alignSelf: 'center', marginTop: 20,
    borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10,
  },
});
