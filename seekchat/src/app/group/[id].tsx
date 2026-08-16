import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import {
  addGroupMember, clearSummary, deleteConversation, getConversation, getPersona,
  listCharacters, listGroupMembers, listMessages, listStickers, removeGroupMember,
  renameConversation, setGroupConfig,
} from '../../lib/db';
import type { Character, Message, Sticker } from '../../lib/types';
import {
  autoUsedToday, groupCatchUp, groupIdleTick, isGroupBusy, sendGroupMessage,
  sendGroupSticker, setFocusedGroup,
} from '../../lib/groupflow';
import { parseGroupConfig, GroupConfig } from '../../lib/groupchat';
import { isSummarizing, subscribeMessages } from '../../lib/engine';
import { stripLeakedStateTags } from '../../lib/statetag';
import { useTheme } from '../../lib/theme-context';
import { Avatar } from '../../components/Avatar';

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
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cfg, setCfg] = useState<GroupConfig>(() =>
    parseGroupConfig(getConversation(id)?.groupConfig ?? null),
  );
  const [title, setTitle] = useState(() => getConversation(id)?.title ?? '群聊');
  const [memberVersion, setMemberVersion] = useState(0);
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
      const busyPoll = setInterval(() => setBusyLine(isGroupBusy(id)), 2_000);
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

  const members = listGroupMembers(id);
  const addable = listCharacters().filter((c) => !members.some((m) => m.id === c.id));

  const renderItem = ({ item }: { item: Row }) => {
    const m = item.msg;
    if (m.kind === 'meta' || m.kind === 'experience') {
      return <Text style={s.metaLine}>{m.content}</Text>;
    }
    const mine = m.role === 'user';
    return (
      <Pressable
        style={[s.rowWrap, mine ? s.rowMine : s.rowHers]}
        onLongPress={() => setReplyingTo(m)}
      >
        {!mine && (
          <Avatar uri={item.speakerAvatar} name={item.speakerName ?? '她'} size={32} />
        )}
        <View style={{ maxWidth: '78%' }}>
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
      </Pressable>
    );
  };

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={s.header}>
        <Text style={s.headerTitle} numberOfLines={1}>
          {title}（{members.length + 1}）
        </Text>
        <Pressable onPress={() => setSettingsOpen(true)} hitSlop={8}>
          <Text style={{ fontSize: 18 }}>⚙️</Text>
        </Pressable>
      </View>
      <FlatList
        data={[...rows].reverse()}
        inverted
        keyExtractor={(r) => r.msg.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12 }}
        extraData={memberVersion}
      />
      {busyLine && <Text style={s.typing}>…有人正在输入</Text>}
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

      <Modal visible={settingsOpen} transparent animationType="slide">
        <View style={s.backdropBottom}>
          <View style={s.settings}>
            <ScrollView>
              <Text style={s.label}>群名</Text>
              <TextInput
                style={s.input}
                value={title}
                onChangeText={setTitle}
                onEndEditing={() => {
                  if (title.trim()) renameConversation(id, title.trim());
                }}
              />
              <Text style={s.label}>成员（{members.length}）</Text>
              {members.map((m) => (
                <View key={m.id} style={s.memberRow}>
                  <Text style={s.memberTxt}>{getPersona(m.personaId)?.name ?? '她'}</Text>
                  {members.length > 1 && (
                    <Pressable
                      onPress={() => {
                        removeGroupMember(id, m.id);
                        setMemberVersion((v) => v + 1);
                      }}
                    >
                      <Text style={{ color: '#a32d2d', fontSize: 13 }}>移出</Text>
                    </Pressable>
                  )}
                </View>
              ))}
              {addable.map((c) => (
                <Pressable
                  key={c.id}
                  style={s.memberRow}
                  onPress={() => {
                    addGroupMember(id, c.id);
                    setMemberVersion((v) => v + 1);
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
              onPress={() => setSettingsOpen(false)}
            >
              <Text style={s.sendTxt}>完成</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  rowWrap: { flexDirection: 'row', gap: 8, marginBottom: 10, alignItems: 'flex-end' },
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
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', padding: 8, backgroundColor: '#fff',
  },
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
  cfgRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  cfgLabel: { flex: 1, fontSize: 13, color: '#444', lineHeight: 18 },
  numInput: {
    width: 60, fontSize: 15, padding: 6, backgroundColor: '#f2f2f2',
    borderRadius: 8, textAlign: 'center',
  },
  deleteBtn: { marginTop: 20, alignSelf: 'center', padding: 10 },
});
