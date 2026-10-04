import { useCallback, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { createQuickPersona, listPersonas } from '../lib/db';
import { useTheme } from '../lib/theme-context';
import {
  buildQuickPrompt, DEFAULT_BASICS, QUICK_AGES, QUICK_GENDERS, QUICK_IDENTITIES,
} from '../lib/shaping';
import type { QuickBasics } from '../lib/shaping';
import type { Persona } from '../lib/types';

function Chips(props: {
  options: readonly string[];
  value: string;
  accent: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={s.chips}>
      {props.options.map((o) => (
        <Pressable
          key={o}
          style={[s.chip, props.value === o && { backgroundColor: props.accent }]}
          onPress={() => props.onChange(o)}
        >
          <Text style={[s.chipTxt, props.value === o && { color: '#fff' }]}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function PersonasScreen() {
  const [items, setItems] = useState<Persona[]>([]);
  useFocusEffect(useCallback(() => setItems(listPersonas()), []));
  const { th } = useTheme();
  // 立即开始 (v2.9): a four-field card (身份/名字/性别/年龄) → a one-line persona;
  // she shapes everything else herself in the chat that opens right away.
  const [quickOpen, setQuickOpen] = useState(false);
  const [basics, setBasics] = useState<QuickBasics>(DEFAULT_BASICS);
  const [customIdentity, setCustomIdentity] = useState('');
  const identityIsPreset = (QUICK_IDENTITIES as readonly string[]).includes(basics.identity);
  const startQuick = () => {
    const identity = (identityIsPreset ? basics.identity : customIdentity).trim() || '女朋友';
    const { conversation } = createQuickPersona({
      ...basics, identity, name: basics.name?.trim() || null,
    });
    setQuickOpen(false);
    router.push(`/chat/${conversation.id}`);
  };
  return (
    <View style={s.root}>
      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={
          <Pressable style={[s.quick, { borderColor: th.accent }]} onPress={() => setQuickOpen(true)}>
            <Text style={[s.quickTitle, { color: th.accent }]}>⚡ 立即开始</Text>
            <Text style={s.quickSub}>
              只填身份、名字、性别、年龄这几样，其余不用写：她在聊天里试风格、看你的反应、给自己添生活，慢慢变成你想要的样子。
            </Text>
          </Pressable>
        }
        renderItem={({ item }) => (
          <Pressable style={s.row} onPress={() => router.push(`/persona/${item.id}`)}>
            <View style={s.titleRow}>
              <Text style={s.title}>{item.name}</Text>
              {item.shaping && (
                <Text style={[s.badge, { backgroundColor: th.accentSoft, color: th.accent }]}>
                  塑造中
                </Text>
              )}
              {item.proConfig && (
                <Text style={[s.badge, { backgroundColor: th.accentSoft, color: th.accent }]}>
                  Pro
                </Text>
              )}
            </View>
            <Text style={s.sub} numberOfLines={2}>{item.systemPrompt}</Text>
          </Pressable>
        )}
      />
      <Pressable
        style={[s.fab, { backgroundColor: th.accent }]}
        onPress={() => router.push('/persona/new')}
      >
        <Text style={s.fabTxt}>＋</Text>
      </Pressable>

      <Modal visible={quickOpen} transparent animationType="fade" onRequestClose={() => setQuickOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setQuickOpen(false)}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <Text style={s.sheetTitle}>⚡ 立即开始</Text>
            <Text style={s.field}>身份</Text>
            <Chips
              options={[...QUICK_IDENTITIES, '自定义']}
              value={identityIsPreset ? basics.identity : '自定义'}
              accent={th.accent}
              onChange={(v) => {
                if (v === '自定义') setBasics({ ...basics, identity: '' });
                else setBasics({ ...basics, identity: v, gender: v === '男朋友' ? '男' : '女' });
              }}
            />
            {!identityIsPreset && (
              <TextInput
                style={s.input}
                value={customIdentity}
                onChangeText={setCustomIdentity}
                placeholder="例如：青梅竹马、同居室友、学姐"
              />
            )}
            <Text style={s.field}>名字（留空让她自己起）</Text>
            <TextInput
              style={s.input}
              value={basics.name ?? ''}
              onChangeText={(v) => setBasics({ ...basics, name: v })}
              placeholder="例如：小雨"
              maxLength={12}
            />
            <Text style={s.field}>性别</Text>
            <Chips
              options={QUICK_GENDERS}
              value={basics.gender}
              accent={th.accent}
              onChange={(v) => setBasics({ ...basics, gender: v })}
            />
            <Text style={s.field}>年龄（大约）</Text>
            <Chips
              options={QUICK_AGES}
              value={basics.age}
              accent={th.accent}
              onChange={(v) => setBasics({ ...basics, age: v })}
            />
            <Text style={s.preview}>
              她的起点：{buildQuickPrompt({
                ...basics,
                identity: (identityIsPreset ? basics.identity : customIdentity).trim() || '女朋友',
                name: basics.name?.trim() || null,
              })}
            </Text>
            <Pressable style={[s.startBtn, { backgroundColor: th.accent }]} onPress={startQuick}>
              <Text style={s.startTxt}>开始聊天</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  row: { padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#e5e5e5' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: {
    fontSize: 11, fontWeight: '600', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden',
  },
  title: { fontSize: 16, fontWeight: '600' },
  quick: {
    margin: 16, marginBottom: 4, padding: 14, borderRadius: 12, borderWidth: 1.5,
  },
  quickTitle: { fontSize: 16, fontWeight: '700' },
  quickSub: { fontSize: 12, color: '#888', marginTop: 6, lineHeight: 17 },
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18,
    padding: 20, paddingBottom: 32,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  field: { fontSize: 13, color: '#888', marginTop: 14, marginBottom: 6 },
  input: { fontSize: 16, padding: 12, backgroundColor: '#f2f2f2', borderRadius: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#f2f2f2' },
  chipTxt: { fontSize: 14, color: '#444' },
  preview: { fontSize: 12, color: '#999', marginTop: 14, lineHeight: 17 },
  startBtn: { marginTop: 14, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  startTxt: { color: '#fff', fontSize: 16, fontWeight: '600' },
  sub: { fontSize: 13, color: '#888', marginTop: 4 },
  fab: {
    position: 'absolute', right: 20, bottom: 30, width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center', elevation: 3,
  },
  fabTxt: { color: '#fff', fontSize: 26, lineHeight: 30 },
});
