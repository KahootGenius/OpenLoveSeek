import { useCallback, useEffect, useState } from 'react';
import {
  Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import {
  carryOverConversation, ConversationListItem, createConversation, deleteConversation,
  getPersona, listConversations, listPersonas, renameConversation,
} from '../lib/db';
import { parseProConfig } from '../lib/pro';
import { subscribeMessages } from '../lib/engine';
import { useTheme } from '../lib/theme-context';
import { Avatar } from '../components/Avatar';
import { MessageActionMenu, MenuAnchor } from '../components/MessageActionMenu';
import type { Persona } from '../lib/types';

export default function ConversationsScreen() {
  const [items, setItems] = useState<ConversationListItem[]>([]);
  const [picker, setPicker] = useState<Persona[] | null>(null);
  const [renaming, setRenaming] = useState<ConversationListItem | null>(null);
  const [renameText, setRenameText] = useState('');
  // MessageActionMenu (v2.8 T4 Alert audit finding): this row's long-press
  // sheet was a 4-button Alert.alert for any non-group item (重命名/开启新篇章
  // /删除/取消) — past Android's 3-button cap, same class of bug as the chat
  // screens' message sheets, just undiscovered until this task's sweep.
  const [actionMenu, setActionMenu] = useState<{ item: ConversationListItem; anchor: MenuAnchor } | null>(null);
  const { th } = useTheme();

  useFocusEffect(useCallback(() => setItems(listConversations()), []));
  // auto-reach can land messages while this screen is visible
  useEffect(() => subscribeMessages(() => setItems(listConversations())), []);

  const startChat = (personaId: string) => {
    setPicker(null);
    const c = createConversation(personaId);
    router.push(`/chat/${c.id}`);
  };

  const doDelete = (item: ConversationListItem) => {
    deleteConversation(item.id);
    setItems(listConversations());
  };

  const confirmDelete = (item: ConversationListItem) => {
    const cfg = parseProConfig(getPersona(item.personaId)?.proConfig ?? null);
    if (cfg?.yandere) {
      // Delete-guard: she pleads before you can go through with it.
      Alert.alert(
        `${item.personaName}：你……要删掉我吗？`,
        '别这样好不好，我会乖的……真的要抛下我？',
        [
          { text: '算了，留下', style: 'cancel' },
          {
            text: '狠心删除',
            style: 'destructive',
            onPress: () =>
              Alert.alert('确认删除？', '所有消息将被删除，无法恢复。', [
                { text: '取消', style: 'cancel' },
                { text: '删除', style: 'destructive', onPress: () => doDelete(item) },
              ]),
          },
        ],
      );
      return;
    }
    Alert.alert('删除对话？', '所有消息将被删除，无法恢复。', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => doDelete(item) },
    ]);
  };

  const startNewChapter = (item: ConversationListItem) => {
    Alert.alert(
      '开启新篇章？',
      '她会带着你们的总结、记忆库、心情、所有关系状态和最近几条对话搬进一个全新的对话；' +
        '旧对话保留为档案（她说话的老习惯会留在那里）。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '开启',
          onPress: () => {
            const c = carryOverConversation(item.id);
            setItems(listConversations());
            if (c) router.push(`/chat/${c.id}`);
          },
        },
      ],
    );
  };

  const onLongPress = (item: ConversationListItem, anchor: MenuAnchor) => {
    setActionMenu({ item, anchor });
  };

  const handleMenuAction = (key: string) => {
    const item = actionMenu?.item;
    setActionMenu(null);
    if (!item) return;
    if (key === 'rename') { setRenameText(item.title); setRenaming(item); }
    else if (key === 'chapter') startNewChapter(item);
    else if (key === 'delete') confirmDelete(item);
  };

  const menuActions = actionMenu
    ? [
        { key: 'rename', label: '重命名' },
        ...(actionMenu.item.kind !== 'group'
          ? [{ key: 'chapter', label: '开启新篇章（带记忆搬家）' }]
          : []),
        { key: 'delete', label: '删除', destructive: true },
      ]
    : [];

  return (
    <View style={s.root}>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        ListEmptyComponent={<Text style={s.empty}>点击 ＋ 开始新对话</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={s.row}
            onPress={() =>
              router.push(item.kind === 'group' ? `/group/${item.id}` : `/chat/${item.id}`)
            }
            onLongPress={(e) =>
              onLongPress(item, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, width: 0, height: 0 })
            }
          >
            <Avatar
              uri={item.kind === 'group' ? item.avatarUri : item.personaAvatar}
              name={item.kind === 'group' ? '群' : item.personaName}
              size={44}
            />
            <View style={s.rowTexts}>
              <Text style={s.title}>{item.title}</Text>
              <Text style={s.sub} numberOfLines={1}>
                {item.kind === 'group' ? '群聊' : item.personaName} ·{' '}
                {item.lastSnippet ?? '（还没有消息）'}
              </Text>
            </View>
          </Pressable>
        )}
      />
      <View style={s.bar}>
        <Pressable style={s.barBtn} onPress={() => router.push('/personas')}>
          <Text style={[s.barTxt, { color: th.accent }]}>人设</Text>
        </Pressable>
        <Pressable style={s.barBtn} onPress={() => router.push('/moments')}>
          <Text style={[s.barTxt, { color: th.accent }]}>朋友圈</Text>
        </Pressable>
        <Pressable
          style={[s.fab, { backgroundColor: th.accent }]}
          onPress={() => setPicker(listPersonas())}
        >
          <Text style={s.fabTxt}>＋</Text>
        </Pressable>
        <Pressable style={s.barBtn} onPress={() => router.push('/settings')}>
          <Text style={[s.barTxt, { color: th.accent }]}>设置</Text>
        </Pressable>
      </View>
      <Modal visible={picker !== null} transparent animationType="fade">
        <Pressable style={s.backdrop} onPress={() => setPicker(null)}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>选择人设</Text>
            {picker?.map((p) => (
              <Pressable key={p.id} style={s.sheetRow} onPress={() => startChat(p.id)}>
                <Text style={s.title}>{p.name}</Text>
              </Pressable>
            ))}
            <Pressable
              style={s.sheetRow}
              onPress={() => {
                setPicker(null);
                router.push('/group-new');
              }}
            >
              <Text style={[s.title, { color: th.accent }]}>👥 发起群聊…</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
      <Modal visible={renaming !== null} transparent animationType="fade">
        <Pressable style={s.backdrop} onPress={() => setRenaming(null)}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>重命名对话</Text>
            <TextInput
              style={s.renameInput}
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
            />
            <Pressable
              style={[s.renameBtn, { backgroundColor: th.accent }]}
              onPress={() => {
                if (renaming && renameText.trim()) {
                  renameConversation(renaming.id, renameText.trim());
                  setItems(listConversations());
                }
                setRenaming(null);
              }}
            >
              <Text style={s.renameBtnTxt}>确定</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
      <MessageActionMenu
        visible={actionMenu !== null}
        anchor={actionMenu?.anchor ?? null}
        actions={menuActions}
        onAction={handleMenuAction}
        onClose={() => setActionMenu(null)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  empty: { textAlign: 'center', marginTop: 60, color: '#999' },
  row: {
    padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#e5e5e5',
  },
  rowTexts: { flex: 1 },
  title: { fontSize: 16, fontWeight: '600' },
  sub: { fontSize: 13, color: '#888', marginTop: 4 },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#e5e5e5',
  },
  barBtn: { padding: 8 },
  barTxt: { fontSize: 15 },
  fab: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center', elevation: 3,
  },
  fabTxt: { color: '#fff', fontSize: 26, lineHeight: 30 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 14, borderTopRightRadius: 14,
    padding: 16, paddingBottom: 32,
  },
  sheetTitle: { fontSize: 14, color: '#888', marginBottom: 8 },
  sheetRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#eee' },
  renameInput: { fontSize: 16, padding: 10, backgroundColor: '#f2f2f2', borderRadius: 10 },
  renameBtn: {
    marginTop: 12, borderRadius: 10,
    alignItems: 'center', paddingVertical: 10,
  },
  renameBtnTxt: { color: '#fff', fontSize: 15 },
});
