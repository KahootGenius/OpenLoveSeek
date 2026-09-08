import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import {
  addGroupMember, clearSummary, deleteConversation, getConversation, getPersona,
  listCharacters, listGroupMembers, listMessages, listStickers, recallGroupMessage,
  removeGroupMember, renameConversation, setConversationAvatar, setGroupConfig,
  setGroupMemberMute, setGroupMemberRole,
} from '../../lib/db';
import type { Character, Message, Sticker } from '../../lib/types';
import {
  autoUsedToday, getGroupSpeaker, groupCatchUp, groupIdleTick, groupSystemLine, isGroupBusy,
  runGroupRound, sendGroupMessage, sendGroupRedpacket, sendGroupSticker, setFocusedGroup,
} from '../../lib/groupflow';
import { parseGroupConfig, GroupConfig } from '../../lib/groupchat';
import {
  canAnnounce, canMute, isMutedNow, rankOf, recallLine,
} from '../../lib/grouproles';
import { groupMessageActions, groupMuteActions } from '../../lib/messagemenu';
import { encodeRedpacket, parseRedpacket, splitRedpacket } from '../../lib/redpacket';
import { fmtMoney } from '../../lib/transfer';
import { isSummarizing, subscribeMessages } from '../../lib/engine';
import { stripLeakedStateTags } from '../../lib/statetag';
import { useTheme } from '../../lib/theme-context';
import { getUserAvatar, getUserBalance, getUserNickname, setUserBalance } from '../../lib/settings';
import { pickRawImage, RawImage } from '../../lib/avatar';
import { Avatar } from '../../components/Avatar';
import { AvatarCrop } from '../../components/AvatarCrop';
import { MessageActionMenu, MenuAnchor } from '../../components/MessageActionMenu';

interface Row {
  msg: Message;
  speakerName: string | null; // null for user rows
  speakerAvatar: string | null;
  sticker: Sticker | null;
  quote: { who: string; text: string } | null;
}

export default function GroupChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { th } = useTheme();
  const [rows, setRows] = useState<Row[]>([]);
  const [input, setInput] = useState('');
  const [busyLine, setBusyLine] = useState(false);
  const [speakerName, setSpeakerName] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  // MessageActionMenu (v2.8 T4): replaces the old Alert.alert message sheet
  // (Android's 3-button cap silently hid 撤回 whenever 回复/@她 were also
  // offered) and the 禁言 duration Alert (取消/5/30/60/解除 = 5 buttons,
  // truncated the same way). Both hold only identity + the long-press touch
  // point; the action list itself is derived fresh at render time below.
  const [actionMenu, setActionMenu] = useState<{ row: Row; anchor: MenuAnchor } | null>(null);
  const [muteMenu, setMuteMenu] = useState<{ memberId: string; anchor: MenuAnchor } | null>(null);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cfg, setCfg] = useState<GroupConfig>(() =>
    parseGroupConfig(getConversation(id)?.groupConfig ?? null),
  );
  const [title, setTitle] = useState(() => getConversation(id)?.title ?? '群聊');
  const [avatarUri, setAvatarUri] = useState(() => getConversation(id)?.avatarUri ?? null);
  const [cropImage, setCropImage] = useState<RawImage | null>(null);
  const [memberVersion, setMemberVersion] = useState(0);
  const [announceText, setAnnounceText] = useState(cfg.announcement?.text ?? '');
  const [notepadOpen, setNotepadOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [redpacketOpen, setRedpacketOpen] = useState(false);
  const [rpAmount, setRpAmount] = useState('');
  const [rpCount, setRpCount] = useState('1');
  const [rpNote, setRpNote] = useState('');
  const sending = useRef(false);

  const reload = useCallback(() => {
    // Maps built inside reload — stable identity, fresh names (v2.1 lesson).
    // FULL registry, not current membership — a removed member's old lines
    // keep her name and avatar (review finding, v2.2).
    const charById = new Map<string, Character>(listCharacters().map((c) => [c.id, c]));
    const personaOf = (chId: string | null) =>
      chId ? getPersona(charById.get(chId)?.personaId ?? '') : null;
    const stickers = listStickers();
    const stickerById = new Map(stickers.map((st) => [st.id, st]));
    const msgs = listMessages(id).filter((m) => m.kind !== 'trigger');
    const byId = new Map(msgs.map((m) => [m.id, m]));
    setRows(
      msgs.map((m) => {
        const p = m.role === 'assistant' ? personaOf(m.speakerId) : null;
        const q = m.quotedId ? byId.get(m.quotedId) : null;
        const qPersona = q && q.role === 'assistant' ? personaOf(q.speakerId) : null;
        return {
          msg: m,
          speakerName: p?.name ?? (m.role === 'assistant' ? '她' : null),
          speakerAvatar: p?.avatarUri ?? null,
          sticker: m.kind === 'sticker' ? stickerById.get(m.content) ?? null : null,
          quote: q
            ? {
                who: q.role === 'user' ? '我' : qPersona?.name ?? '她',
                text:
                  q.kind === 'sticker'
                    ? '[表情包]'
                    : stripLeakedStateTags(q.content).replace(/\s+/g, ' ').slice(0, 40),
              }
            : null,
        };
      }),
    );
    setBusyLine(isGroupBusy(id));
    // Markers (moderation, mid-chat) write groupConfig straight to the db —
    // this state only learns about it by re-reading (v2.5).
    setCfg(parseGroupConfig(getConversation(id)?.groupConfig ?? null));
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      setFocusedGroup(id);
      reload();
      void groupCatchUp(id).then(reload);
      const tick = setInterval(() => {
        groupIdleTick(id);
        setBusyLine(isGroupBusy(id));
      }, 60_000);
      const busyPoll = setInterval(() => {
        setBusyLine(isGroupBusy(id));
        setSpeakerName(getGroupSpeaker(id));
      }, 2_000);
      const unsub = subscribeMessages((convId) => {
        if (convId === id) reload();
      });
      return () => {
        setFocusedGroup(null);
        clearInterval(tick);
        clearInterval(busyPoll);
        unsub();
      };
    }, [id, reload]),
  );

  // Sheet-keyed memos: the React Compiler would otherwise freeze these db
  // reads for the screen's lifetime (v2.1 lesson — explicit deps are honored).
  const stickerList = useMemo(() => listStickers(), [stickerOpen]);
  const autoUsed = useMemo(() => autoUsedToday(id), [id, settingsOpen]);

  const send = () => {
    const text = input.trim();
    if (!text || sending.current) return;
    sending.current = true;
    setInput('');
    const quoted = replyingTo?.id ?? null;
    setReplyingTo(null);
    void sendGroupMessage(id, text, quoted).finally(() => {
      sending.current = false;
      reload();
    });
  };

  const saveCfg = (next: GroupConfig) => {
    setCfg(next);
    setGroupConfig(id, JSON.stringify(next));
  };

  // 群红包 (v2.5): total/count/shares/claims live in 分 (integer minor-unit,
  // like `cents` elsewhere in this file just means "the smallest coin"); the
  // user wallet (getUserBalance/setUserBalance) stays in 元 like DM transfers
  // — convert between the two, same as claimForSpeaker does on the credit side.
  const rpCents = Math.round((parseFloat(rpAmount) || 0) * 100);
  const rpN = parseInt(rpCount, 10) || 0;
  const rpHint =
    rpCents > 0 && rpN > 0
      ? rpCents < rpN
        ? '金额不能少于每人1分'
        : `每人约 ${(rpCents / rpN / 100).toFixed(2)}元`
      : '';

  const sendRedpacket = () => {
    if (!(rpCents >= rpN && rpN >= 1)) {
      Alert.alert('金额不能少于每人1分');
      return;
    }
    if (getUserBalance() < rpCents / 100) {
      Alert.alert('余额不足', `你的钱包只有 ${fmtMoney(getUserBalance())}，去设置里充值吧。`);
      return;
    }
    setUserBalance(getUserBalance() - rpCents / 100);
    const note = rpNote.trim() || '恭喜发财';
    void sendGroupRedpacket(
      id,
      encodeRedpacket({
        total: rpCents, count: rpN, note, shares: splitRedpacket(rpCents, rpN), claims: [],
      }),
    ).finally(reload);
    setRedpacketOpen(false);
    setRpAmount('');
    setRpCount('1');
    setRpNote('');
  };

  // 禁言倒计时 (v2.5): ticks once a second only while the user is actually
  // muted; clears itself (and the persisted flag) the moment it lapses.
  // Reads/writes groupConfig fresh from the db rather than closing over
  // `cfg` — a stale `cfg` spread here would silently revert any
  // announcement/notepad/settings change that landed during the mute
  // (review finding, v2.5).
  const [now, setNow] = useState(() => Date.now());
  const clearExpiredMute = useCallback(() => {
    const fresh = parseGroupConfig(getConversation(id)?.groupConfig ?? null);
    if (fresh.userMutedUntil !== null && fresh.userMutedUntil <= Date.now()) {
      setGroupConfig(id, JSON.stringify({ ...fresh, userMutedUntil: null }));
    }
    setCfg(parseGroupConfig(getConversation(id)?.groupConfig ?? null));
  }, [id]);
  useEffect(() => {
    const muteUntil = cfg.userMutedUntil;
    if (!muteUntil) return undefined;
    if (muteUntil <= Date.now()) {
      // Already lapsed by the time we got here (e.g. app reopened later) —
      // defer the clear to a callback rather than setState mid-effect.
      const done = setTimeout(clearExpiredMute, 0);
      return () => clearTimeout(done);
    }
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (muteUntil <= n) clearExpiredMute();
    }, 1000);
    return () => clearInterval(t);
  }, [cfg.userMutedUntil, clearExpiredMute]);
  const mutedLeft = cfg.userMutedUntil ? Math.max(0, cfg.userMutedUntil - now) : 0;
  const formatMuted = (ms: number): string => {
    const total = Math.ceil(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };

  // 编辑者署名 (v2.5): 'user' shows as 你; a character shows her persona name.
  const nameOfEditor = (by: string): string => {
    if (by === 'user') return '你';
    const ch = listCharacters().find((c) => c.id === by);
    return ch ? getPersona(ch.personaId)?.name ?? '她' : '她';
  };
  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  };
  const openSettings = () => {
    setAnnounceText(cfg.announcement?.text ?? '');
    setSettingsOpen(true);
  };
  const openNotepad = () => {
    setNoteText(cfg.notepad?.text ?? '');
    setNotepadOpen(true);
  };

  const members = listGroupMembers(id);
  const addable = listCharacters().filter((c) => !members.some((m) => m.id === c.id));
  const roleRows = members.map((r) => ({ id: r.id, role: r.role }));
  const myRank = rankOf('user', cfg, roleRows);

  const messageActions = (item: Row, anchor: MenuAnchor) => {
    if (item.msg.kind !== 'normal' && item.msg.kind !== 'sticker') return; // no action sheet on meta/recall/experience rows
    setActionMenu({ row: item, anchor });
  };

  // consentGate = target-is-user && !modConsent (see messagemenu.ts). This
  // screen's presser is ALWAYS the human user — there is no path for a
  // character to long-press here — so a non-mine row's target is always
  // another CHARACTER, never 'user' itself; the consent gate can therefore
  // never actually apply to what this presser recalls. Passed false always;
  // the param stays wired for whenever a non-user presser exists (e.g. a
  // character's own moderation UI, if one is ever built).
  const handleMenuAction = (key: string) => {
    const row = actionMenu?.row;
    setActionMenu(null);
    if (!row) return;
    const m = row.msg;
    const mine = m.role === 'user';
    if (key === 'reply') setReplyingTo(m);
    else if (key === 'mention') setInput((i) => `${i}@${row.speakerName ?? ''} `);
    else if (key === 'copy') void Clipboard.setStringAsync(m.content);
    else if (key === 'recall') {
      recallGroupMessage(id, m.id, recallLine(getUserNickname(), mine ? null : row.speakerName));
      reload();
    }
  };

  const handleMuteAction = (key: string) => {
    const target = muteMenu;
    setMuteMenu(null);
    if (!target) return;
    const ms = key === 'mute5' ? 5 * 60_000 : key === 'mute30' ? 30 * 60_000 : key === 'mute60' ? 60 * 60_000 : null;
    setGroupMemberMute(id, target.memberId, ms !== null ? Date.now() + ms : null);
    setMemberVersion((v) => v + 1);
  };

  const renderItem = ({ item }: { item: Row }) => {
    const m = item.msg;
    if (m.kind === 'meta' || m.kind === 'experience' || m.kind === 'recall') {
      return <Text style={s.metaLine}>{m.content}</Text>;
    }
    const mine = m.role === 'user';
    if (m.kind === 'redpacket') {
      // Both roles render (characters can't send yet, but the card doesn't
      // assume 'mine' — mirrors every other kind's mine/hers handling).
      const packet = parseRedpacket(m.content);
      const claimed = packet?.claims.length ?? 0;
      const total = packet?.count ?? 0;
      const done = !!packet && claimed >= total;
      return (
        <Pressable
          style={[s.rowWrap, mine ? s.rowMine : s.rowHers]}
          onLongPress={(e) =>
            messageActions(item, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, width: 0, height: 0 })
          }
        >
          {!mine && (
            <Avatar uri={item.speakerAvatar} name={item.speakerName ?? '她'} size={32} />
          )}
          <Pressable
            style={[s.rpCard, done ? s.rpDone : s.rpPending]}
            onPress={() => {
              if (!packet || packet.claims.length === 0) {
                Alert.alert('红包', '还没有人领取');
                return;
              }
              const top = Math.max(...packet.claims.map((c) => c.cents));
              const lines = packet.claims
                .map((c) =>
                  `${nameOfEditor(c.charId)} ${(c.cents / 100).toFixed(2)}元${c.cents === top ? ' 👑手气王' : ''}`)
                .join('\n');
              Alert.alert('红包', lines);
            }}
          >
            <Text style={s.rpEmoji}>🧧</Text>
            <Text style={s.rpNoteTxt}>{packet?.note || '红包'}</Text>
            <Text style={s.rpProgress}>已领 {claimed}/{total}</Text>
            <Text style={s.rpLeft}>还剩 {Math.max(0, total - claimed)} 份</Text>
          </Pressable>
          {mine && <Avatar uri={getUserAvatar()} name={getUserNickname()} size={32} />}
        </Pressable>
      );
    }
    return (
      <Pressable
        style={[s.rowWrap, mine ? s.rowMine : s.rowHers]}
        onLongPress={(e) =>
          messageActions(item, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, width: 0, height: 0 })
        }
      >
        {!mine && (
          <Pressable onLongPress={() => setInput((i) => `${i}@${item.speakerName ?? ''} `)}>
            <Avatar uri={item.speakerAvatar} name={item.speakerName ?? '她'} size={32} />
          </Pressable>
        )}
        <View style={{ maxWidth: '78%', flexShrink: 1 }}>
          {!mine && <Text style={s.speaker}>{item.speakerName}</Text>}
          {item.quote && (
            <View style={s.quoteBlock}>
              <Text style={s.quoteTxt} numberOfLines={1}>
                {item.quote.who}：{item.quote.text}
              </Text>
            </View>
          )}
          {item.sticker ? (
            <Image source={item.sticker.image} style={s.stickerImg} contentFit="contain" />
          ) : (
            <View
              style={[
                s.bubble,
                mine ? { backgroundColor: th.userBubble } : { backgroundColor: '#fff' },
              ]}
            >
              <Text style={s.bubbleTxt}>{m.content}</Text>
            </View>
          )}
        </View>
        {mine && <Avatar uri={getUserAvatar()} name={getUserNickname()} size={32} />}
      </Pressable>
    );
  };

  // Derived fresh every render (mirrors chat/[id].tsx's own `menuActions`)
  // rather than baked in at open-time, so a rank/consent change that lands
  // while the sheet happens to be open is reflected immediately.
  const menuActions = actionMenu
    ? groupMessageActions({
        kind: actionMenu.row.msg.kind,
        mine: actionMenu.row.msg.role === 'user',
        myRank,
        targetRank: actionMenu.row.msg.role === 'user'
          ? myRank
          : rankOf(actionMenu.row.msg.speakerId ?? '', cfg, roleRows),
        consentGate: false,
      })
    : [];
  const muteTarget = muteMenu ? members.find((mm) => mm.id === muteMenu.memberId) : undefined;
  const muteActions = muteTarget ? groupMuteActions(isMutedNow(muteTarget.mutedUntil, now)) : [];

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={s.header}>
        <Avatar uri={avatarUri} name={title || '群'} size={28} />
        <Text style={s.headerTitle} numberOfLines={1}>
          {title}（{members.length + 1}）
        </Text>
        <Pressable onPress={openNotepad} hitSlop={8}>
          <Text style={{ fontSize: 18 }}>📓</Text>
        </Pressable>
        <Pressable onPress={openSettings} hitSlop={8}>
          <Text style={{ fontSize: 18 }}>⚙️</Text>
        </Pressable>
      </View>
      {cfg.announcement && (
        <Pressable
          style={s.announceBar}
          onPress={() => {
            const a = cfg.announcement;
            if (!a) return;
            const options: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
              { text: '关闭', style: 'cancel' },
            ];
            if (canAnnounce('user', cfg, roleRows)) {
              options.push({ text: '编辑', onPress: openSettings });
            }
            Alert.alert('群公告', `${a.text}\n\n— ${nameOfEditor(a.by)} ${fmtTime(a.at)}`, options);
          }}
        >
          <Text style={s.announceTxt} numberOfLines={1}>📢 {cfg.announcement.text}</Text>
        </Pressable>
      )}
      <FlatList
        data={[...rows].reverse()}
        inverted
        keyExtractor={(r) => r.msg.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12 }}
        extraData={memberVersion}
      />
      {busyLine && <Text style={s.typing}>{speakerName ?? '有人'}正在输入…</Text>}
      {replyingTo && (
        <View style={s.replyChip}>
          <Text style={s.replyTxt} numberOfLines={1}>
            回复：{replyingTo.kind === 'sticker' ? '[表情包]' : replyingTo.content}
          </Text>
          <Pressable onPress={() => setReplyingTo(null)} hitSlop={8}>
            <Text style={{ color: '#999', fontSize: 16 }}>✕</Text>
          </Pressable>
        </View>
      )}
      {mutedLeft > 0 ? (
        <View style={s.mutedBar}>
          <Text style={s.mutedTxt}>🔇 你被禁言了，还剩 {formatMuted(mutedLeft)}</Text>
        </View>
      ) : (
        <>
          {input.endsWith('@') && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={s.mentionBar}
              contentContainerStyle={s.mentionBarContent}
            >
              {members.map((m) => {
                const name = getPersona(m.personaId)?.name ?? '她';
                return (
                  <Pressable
                    key={m.id}
                    style={s.mentionChip}
                    onPress={() => setInput(input + name + ' ')}
                  >
                    <Avatar uri={getPersona(m.personaId)?.avatarUri ?? null} name={name} size={24} />
                    <Text style={s.mentionChipTxt} numberOfLines={1}>{name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          <View style={s.inputBar}>
            <Pressable
              style={[s.iconBtn, { backgroundColor: th.accentSoft }]}
              onPress={() => {
                Keyboard.dismiss();
                setStickerOpen(true);
              }}
            >
              <Text style={{ fontSize: 16 }}>🙂</Text>
            </Pressable>
            <Pressable
              style={[s.iconBtn, { backgroundColor: th.accentSoft }]}
              onPress={() => {
                Keyboard.dismiss();
                setRpAmount('');
                setRpCount('1');
                setRpNote('');
                setRedpacketOpen(true);
              }}
            >
              <Text style={{ fontSize: 16 }}>🧧</Text>
            </Pressable>
            <TextInput
              style={s.input}
              value={input}
              onChangeText={setInput}
              placeholder="说点什么…"
              multiline
            />
            <Pressable style={[s.send, { backgroundColor: th.accent }]} onPress={send}>
              <Text style={s.sendTxt}>发送</Text>
            </Pressable>
          </View>
        </>
      )}

      <Modal visible={stickerOpen} transparent animationType="fade">
        <Pressable style={s.backdrop} onPress={() => setStickerOpen(false)}>
          <View style={s.sheet}>
            <FlatList
              data={stickerList}
              numColumns={4}
              keyExtractor={(st) => st.id}
              style={{ maxHeight: 320 }}
              renderItem={({ item: st }) => (
                <Pressable
                  style={s.stickerCell}
                  onPress={() => {
                    setStickerOpen(false);
                    void sendGroupSticker(id, st.id).then(reload);
                  }}
                >
                  <Image source={st.image} style={s.stickerThumb} contentFit="contain" />
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>

      <Modal visible={redpacketOpen} transparent animationType="fade">
        <View style={s.backdrop}>
          <View style={[s.sheet, s.rpSheet]}>
            <Text style={s.rpTitle}>发红包</Text>
            <Text style={s.label}>金额（元）</Text>
            <View style={s.rpAmountRow}>
              <Text style={[s.rpYuan, { color: th.accent }]}>¥</Text>
              <TextInput
                style={[s.rpAmountInput, { color: th.accent }]}
                value={rpAmount}
                onChangeText={setRpAmount}
                placeholder="0.00"
                keyboardType="decimal-pad"
              />
            </View>
            <Text style={s.label}>个数</Text>
            <TextInput
              style={s.fieldInput}
              value={rpCount}
              onChangeText={setRpCount}
              placeholder="1"
              keyboardType="number-pad"
            />
            <Text style={s.label}>祝福语</Text>
            <TextInput
              style={s.fieldInput}
              value={rpNote}
              onChangeText={setRpNote}
              placeholder="恭喜发财"
            />
            {!!rpHint && <Text style={s.rpHint}>{rpHint}</Text>}
            <View style={s.rpActions}>
              <Pressable style={s.notepadCancel} onPress={() => setRedpacketOpen(false)}>
                <Text style={s.notepadCancelTxt}>取消</Text>
              </Pressable>
              <Pressable style={[s.send, s.rpSendBtn, { backgroundColor: th.accent }]} onPress={sendRedpacket}>
                <Text style={s.sendTxt}>塞钱进红包</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={settingsOpen} transparent animationType="slide">
        <View style={s.backdropBottom}>
          <View style={s.settings}>
            <ScrollView>
              <Text style={s.label}>群头像</Text>
              <Pressable
                style={{ alignSelf: 'flex-start' }}
                onPress={() => void pickRawImage().then((img) => img && setCropImage(img))}
              >
                <Avatar uri={avatarUri} name={title || '群'} size={56} />
              </Pressable>
              <Text style={s.label}>群名</Text>
              <TextInput
                style={s.fieldInput}
                value={title}
                onChangeText={setTitle}
                onEndEditing={() => {
                  if (title.trim()) renameConversation(id, title.trim());
                }}
              />
              {canAnnounce('user', cfg, roleRows) && (
                <>
                  <Text style={s.label}>群公告</Text>
                  <TextInput
                    style={s.fieldInput}
                    value={announceText}
                    onChangeText={setAnnounceText}
                    placeholder="暂无公告"
                    multiline
                  />
                  <Pressable
                    style={[s.send, { backgroundColor: th.accent, alignSelf: 'flex-end', marginTop: 6 }]}
                    onPress={() => {
                      const next = announceText.trim();
                      saveCfg({
                        ...cfg,
                        announcement: next ? { text: next, by: 'user', at: Date.now() } : null,
                      });
                    }}
                  >
                    <Text style={s.sendTxt}>保存</Text>
                  </Pressable>
                </>
              )}
              <Text style={s.label}>成员（{members.length}）</Text>
              {members.map((m) => {
                const name = getPersona(m.personaId)?.name ?? '她';
                // `now` (not a fresh Date.now() read) keeps this render pure;
                // it re-derives on every reload()/memberVersion-driven render.
                const muted = isMutedNow(m.mutedUntil, now);
                // v2.5 群主/管理员: a member can't show both — owner badge wins
                // (e.g. a former admin who was just handed ownership keeps her
                // stored 'admin' role row, but 群主 is what renders).
                const roleBadge = cfg.owner === m.id ? '群主' : m.role === 'admin' ? '管理员' : null;
                const openRoleMenu = () => {
                  const options: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
                    { text: '取消', style: 'cancel' },
                    {
                      text: m.role === 'admin' ? '取消管理员' : '设为管理员',
                      onPress: () => {
                        setGroupMemberRole(id, m.id, m.role === 'admin' ? 'member' : 'admin');
                        setMemberVersion((v) => v + 1);
                      },
                    },
                    {
                      text: '转让群主',
                      style: 'destructive',
                      onPress: () => {
                        Alert.alert('转让群主？', '『转让后不可收回，你将成为管理员。』', [
                          { text: '取消', style: 'cancel' },
                          {
                            text: '确定',
                            style: 'destructive',
                            onPress: () => {
                              saveCfg({ ...cfg, owner: m.id });
                              groupSystemLine(id, `👑 你把群主转让给了 ${name}`);
                              void runGroupRound(id, { automated: false });
                              setSettingsOpen(false);
                            },
                          },
                        ]);
                      },
                    },
                  ];
                  Alert.alert(name, undefined, options);
                };
                return (
                  <View key={m.id} style={s.memberRow}>
                    <Pressable
                      style={s.memberNameWrap}
                      disabled={rankOf('user', cfg, roleRows) !== 3}
                      onPress={openRoleMenu}
                    >
                      <Text style={s.memberTxt}>{name}{muted ? ' 🔇' : ''}</Text>
                      {roleBadge && (
                        <Text style={[s.badge, { backgroundColor: th.accentSoft, color: th.accent }]}>
                          {roleBadge}
                        </Text>
                      )}
                    </Pressable>
                    <View style={{ flexDirection: 'row', gap: 14 }}>
                      {canMute('user', m.id, cfg, roleRows) && (
                        <Pressable
                          onPress={(e) =>
                            setMuteMenu({
                              memberId: m.id,
                              anchor: {
                                x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, width: 0, height: 0,
                              },
                            })
                          }
                        >
                          <Text style={{ color: '#a37a2d', fontSize: 13 }}>禁言</Text>
                        </Pressable>
                      )}
                      {members.length > 1 && m.id !== cfg.owner &&
                        rankOf('user', cfg, roleRows) > rankOf(m.id, cfg, roleRows) && (
                        <Pressable
                          onPress={() => {
                            removeGroupMember(id, m.id);
                            setMemberVersion((v) => v + 1);
                            groupSystemLine(id, `「${name}」被移出了群聊`);
                          }}
                        >
                          <Text style={{ color: '#a32d2d', fontSize: 13 }}>移出</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                );
              })}
              {addable.map((c) => (
                <Pressable
                  key={c.id}
                  style={s.memberRow}
                  onPress={() => {
                    const name = getPersona(c.personaId)?.name ?? '她';
                    addGroupMember(id, c.id);
                    setMemberVersion((v) => v + 1);
                    groupSystemLine(id, `👋 你把「${name}」拉进了群聊`);
                    void runGroupRound(id, { automated: false });
                  }}
                >
                  <Text style={[s.memberTxt, { color: th.accent }]}>
                    ＋ 拉 {getPersona(c.personaId)?.name ?? '她'} 进群
                  </Text>
                </Pressable>
              ))}
              <View style={s.cfgRow}>
                <Text style={s.cfgLabel}>后台闲聊（你不在时她们也会聊；离开再回来会补上）</Text>
                <Switch
                  value={cfg.background}
                  onValueChange={(v) => saveCfg({ ...cfg, background: v })}
                  trackColor={{ true: th.accent }}
                />
              </View>
              <View style={s.cfgRow}>
                <Text style={s.cfgLabel}>连续接话上限（你的消息之后她们最多接几条；被@到的成员不受限）</Text>
                <TextInput
                  style={s.numInput}
                  keyboardType="number-pad"
                  defaultValue={String(cfg.chainCap)}
                  onEndEditing={(e) => {
                    const n = parseInt(e.nativeEvent.text, 10);
                    if (!Number.isNaN(n)) saveCfg({ ...cfg, chainCap: Math.max(1, Math.min(10, n)) });
                  }}
                />
              </View>
              <View style={s.cfgRow}>
                <Text style={s.cfgLabel}>每轮最多发言人数</Text>
                <TextInput
                  style={s.numInput}
                  keyboardType="number-pad"
                  defaultValue={String(cfg.maxSpeakers)}
                  onEndEditing={(e) => {
                    const n = parseInt(e.nativeEvent.text, 10);
                    if (!Number.isNaN(n)) saveCfg({ ...cfg, maxSpeakers: Math.max(1, Math.min(4, n)) });
                  }}
                />
              </View>
              <View style={s.cfgRow}>
                <Text style={s.cfgLabel}>
                  每日自动发言上限（今天已用 {autoUsed}/{cfg.dailyCap}）
                </Text>
                <TextInput
                  style={s.numInput}
                  keyboardType="number-pad"
                  defaultValue={String(cfg.dailyCap)}
                  onEndEditing={(e) => {
                    const n = parseInt(e.nativeEvent.text, 10);
                    if (!Number.isNaN(n)) saveCfg({ ...cfg, dailyCap: Math.max(0, Math.min(200, n)) });
                  }}
                />
              </View>
              <Pressable
                style={s.deleteBtn}
                onPress={() => {
                  if (isSummarizing(id)) {
                    Alert.alert('稍等一下', '正在生成总结，请稍后再试。');
                    return;
                  }
                  Alert.alert('重置总结？', '清除这个群的长期总结（聊天记录不受影响），下次从近期消息重建。', [
                    { text: '取消', style: 'cancel' },
                    { text: '重置', style: 'destructive', onPress: () => clearSummary(id) },
                  ]);
                }}
              >
                <Text style={{ color: '#a37a2d' }}>重置总结（清除混入的不实内容）</Text>
              </Pressable>
              <Pressable
                style={s.deleteBtn}
                onPress={() =>
                  Alert.alert('删除群聊？', '聊天记录会一起消失（成员的1对1聊天不受影响）。', [
                    { text: '取消', style: 'cancel' },
                    {
                      text: '删除', style: 'destructive',
                      onPress: () => {
                        deleteConversation(id);
                        router.back();
                      },
                    },
                  ])
                }
              >
                <Text style={{ color: '#a32d2d' }}>删除群聊</Text>
              </Pressable>
            </ScrollView>
            <Pressable
              style={[s.send, { backgroundColor: th.accent, alignSelf: 'flex-end', marginTop: 8 }]}
              onPress={() => {
                setSettingsOpen(false);
                reload(); // pick up any moderation markers that landed while the sheet was open
              }}
            >
              <Text style={s.sendTxt}>完成</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={notepadOpen} animationType="slide">
        <View style={s.notepadRoot}>
          <View style={s.notepadHeader}>
            <Text style={s.notepadTitle}>群笔记</Text>
            <Text style={s.notepadCount}>{noteText.length} / 2000</Text>
          </View>
          <TextInput
            style={s.notepadInput}
            value={noteText}
            onChangeText={setNoteText}
            maxLength={2000}
            multiline
            textAlignVertical="top"
            placeholder="记点大家都能看到的事…"
          />
          {cfg.notepad && (
            <Text style={s.notepadMeta}>最后由 {nameOfEditor(cfg.notepad.by)} 编辑</Text>
          )}
          <View style={s.notepadActions}>
            <Pressable style={s.notepadCancel} onPress={() => setNotepadOpen(false)}>
              <Text style={s.notepadCancelTxt}>取消</Text>
            </Pressable>
            <Pressable
              style={[s.send, { backgroundColor: th.accent }]}
              onPress={() => {
                const next = noteText.trim();
                saveCfg({ ...cfg, notepad: next ? { text: next, by: 'user', at: Date.now() } : null });
                setNotepadOpen(false);
              }}
            >
              <Text style={s.sendTxt}>保存</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <AvatarCrop
        image={cropImage}
        onDone={(uri) => {
          setCropImage(null);
          if (uri) {
            setConversationAvatar(id, uri);
            setAvatarUri(uri);
          }
        }}
      />

      <MessageActionMenu
        visible={actionMenu !== null}
        anchor={actionMenu?.anchor ?? null}
        actions={menuActions}
        onAction={handleMenuAction}
        onClose={() => setActionMenu(null)}
      />
      <MessageActionMenu
        visible={muteMenu !== null}
        anchor={muteMenu?.anchor ?? null}
        actions={muteActions}
        onAction={handleMuteAction}
        onClose={() => setMuteMenu(null)}
      />
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f6f6f6' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#fff',
  },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '600' },
  announceBar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: '#fff8e6',
  },
  announceTxt: { flex: 1, fontSize: 13, color: '#8a6d1d' },
  rowWrap: { flexDirection: 'row', gap: 8, marginBottom: 10, alignItems: 'flex-start' },
  rowMine: { justifyContent: 'flex-end' },
  rowHers: { justifyContent: 'flex-start' },
  speaker: { fontSize: 11, color: '#999', marginBottom: 2, marginLeft: 4 },
  bubble: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleTxt: { fontSize: 15, lineHeight: 21 },
  stickerImg: { width: 110, height: 110 },
  metaLine: {
    textAlign: 'center', color: '#999', fontSize: 12, marginVertical: 6,
  },
  quoteBlock: {
    backgroundColor: '#eee', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
    marginBottom: 3,
  },
  quoteTxt: { fontSize: 12, color: '#777' },
  typing: { fontSize: 12, color: '#999', paddingHorizontal: 16, paddingBottom: 4 },
  replyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#eee',
    marginHorizontal: 8, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
  },
  replyTxt: { flex: 1, fontSize: 12, color: '#666' },
  mentionBar: {
    maxHeight: 64, backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#eee',
  },
  mentionBarContent: {
    flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12, paddingVertical: 8,
  },
  mentionChip: { alignItems: 'center', width: 48 },
  mentionChipTxt: { fontSize: 11, color: '#666', marginTop: 2 },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', padding: 8, backgroundColor: '#fff',
  },
  mutedBar: {
    alignItems: 'center', justifyContent: 'center', padding: 12, backgroundColor: '#fff',
  },
  mutedTxt: { fontSize: 14, color: '#a32d2d' },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, marginRight: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  input: {
    flex: 1, maxHeight: 120, fontSize: 16, padding: 8,
    backgroundColor: '#f2f2f2', borderRadius: 10,
  },
  send: { marginLeft: 8, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  sendTxt: { color: '#fff', fontSize: 15 },
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  backdropBottom: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderRadius: 14, padding: 12, width: '90%' },
  stickerCell: { width: '25%', aspectRatio: 1, padding: 6 },
  stickerThumb: { width: '100%', height: '100%' },
  settings: {
    backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    padding: 16, maxHeight: '85%',
  },
  label: { fontSize: 13, fontWeight: '600', color: '#666', marginTop: 12, marginBottom: 6 },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#eee',
  },
  memberTxt: { fontSize: 14 },
  memberNameWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: {
    fontSize: 11, fontWeight: '600', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden',
  },
  cfgRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  cfgLabel: { flex: 1, fontSize: 13, color: '#444', lineHeight: 18 },
  numInput: {
    width: 60, fontSize: 15, padding: 6, backgroundColor: '#f2f2f2',
    borderRadius: 8, textAlign: 'center',
  },
  deleteBtn: { marginTop: 20, alignSelf: 'center', padding: 10 },
  notepadRoot: { flex: 1, backgroundColor: '#fff', padding: 16 },
  notepadHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10,
  },
  notepadTitle: { fontSize: 17, fontWeight: '600' },
  notepadCount: { fontSize: 12, color: '#999' },
  notepadInput: {
    flex: 1, fontSize: 15, lineHeight: 21, padding: 10,
    backgroundColor: '#f2f2f2', borderRadius: 10,
  },
  notepadMeta: { fontSize: 12, color: '#999', marginTop: 8 },
  notepadActions: {
    flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 12,
  },
  notepadCancel: { paddingHorizontal: 16, paddingVertical: 10 },
  notepadCancelTxt: { color: '#999', fontSize: 15 },
  rpTitle: { fontSize: 16, fontWeight: '600', marginBottom: 10 },
  // 红包 sheet (v2.8 redesign, layout-only): 金额 becomes a big centered
  // centerpiece (echoes xferCard's amount emphasis from chat/[id].tsx's DM
  // 转账 sheet).
  rpSheet: { padding: 20 },
  rpAmountRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: '#f6f6f6', borderRadius: 14, paddingVertical: 18, marginBottom: 4,
  },
  rpYuan: { fontSize: 20, fontWeight: '700' },
  rpAmountInput: {
    fontSize: 28, fontWeight: '700', minWidth: 100, textAlign: 'center', padding: 0,
  },
  // Shared stacked-field style (v2.8): used by 红包's 个数/祝福语 AND the
  // 群设置 sheet's 群名/群公告 below — all four are plain TextInputs stacked
  // in a column layout, and all four used to reuse this file's `input`
  // (flex:1/maxHeight:120, sized for the ROW-shaped chat compose bar at the
  // top of this file), which flattens a stacked field's height instead of
  // just filling a row. Not "rp"-prefixed since it's no longer red-packet-
  // specific.
  fieldInput: {
    fontSize: 16, padding: 12, backgroundColor: '#f2f2f2', borderRadius: 10,
  },
  rpActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  rpSendBtn: { flex: 1, alignItems: 'center', paddingVertical: 13, marginLeft: 0 },
  rpHint: { fontSize: 12, color: '#a37a2d', marginTop: 6 },
  rpCard: {
    minWidth: 160, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    borderTopLeftRadius: 6,
  },
  rpPending: { backgroundColor: '#F9A825' }, // WeChat-style orange — shares still open
  rpDone: { backgroundColor: '#E4B06A' }, // fully claimed
  rpEmoji: { fontSize: 20 },
  rpNoteTxt: { color: '#fff', fontSize: 14, fontWeight: '600', marginTop: 2 },
  rpProgress: { color: '#fff', fontSize: 12, marginTop: 4, opacity: 0.92 },
  rpLeft: { color: '#fff', fontSize: 11, marginTop: 1, opacity: 0.85 },
});
