import { useState } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router } from 'expo-router';
import {
  createCharacterWithHome, createGroupConversation, db, ensureCharacter, listPersonas,
} from '../lib/db';
import type { Persona } from '../lib/types';
import { useTheme } from '../lib/theme-context';

interface Row {
  persona: Persona;
  characterId: string | null; // null = needs home-chat pick (0 or 2+ chats)
  convoCount: number;
}

export default function GroupNewScreen() {
  const { th } = useTheme();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [homePickFor, setHomePickFor] = useState<Persona | null>(null);
  const [rows, setRows] = useState<Row[]>(() =>
    listPersonas().map((persona) => {
      const ch = ensureCharacter(persona.id);
      const n = db.getFirstSync<{ n: number }>(
        'SELECT COUNT(*) AS n FROM conversations WHERE personaId = ?', [persona.id],
      );
      return { persona, characterId: ch?.id ?? null, convoCount: n?.n ?? 0 };
    }),
  );

  const toggle = (characterId: string) =>
    setPicked((old) => {
      const next = new Set(old);
      if (next.has(characterId)) next.delete(characterId);
      else next.add(characterId);
      return next;
    });

  const pickHome = (persona: Persona, convoId: string) => {
    const ch = createCharacterWithHome(persona.id, convoId);
    setRows((rs) => rs.map((r) => (r.persona.id === persona.id ? { ...r, characterId: ch.id } : r)));
    setHomePickFor(null);
  };

  const canCreate = picked.size >= 1 && name.trim().length > 0;

  const create = () => {
    if (!canCreate) return;
    const c = createGroupConversation(name.trim(), [...picked]);
    router.replace(`/group/${c.id}`);
  };

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  };

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 16 }}>
      <Text style={s.label}>群名</Text>
      <TextInput
        style={s.input}
        value={name}
        onChangeText={setName}
        placeholder="比如：深夜食堂"
      />
      <Text style={s.label}>拉谁进群（角色会带着她的记忆进来）</Text>
      {rows.map((r) => (
        <View key={r.persona.id} style={s.row}>
          {r.characterId ? (
            <Pressable style={s.rowTap} onPress={() => toggle(r.characterId!)}>
              <Text style={s.rowTxt}>
                {picked.has(r.characterId) ? '☑' : '☐'} {r.persona.name}
              </Text>
            </Pressable>
          ) : r.convoCount === 0 ? (
            <Text style={[s.rowTxt, { color: '#bbb' }]}>{r.persona.name}（还没有聊天）</Text>
          ) : (
            <Pressable style={s.rowTap} onPress={() => setHomePickFor(r.persona)}>
              <Text style={[s.rowTxt, { color: th.accent }]}>
                {r.persona.name} — 有多个聊天，点这里选择她的主聊天
              </Text>
            </Pressable>
          )}
        </View>
      ))}
      <Pressable
        style={[s.btn, { backgroundColor: canCreate ? th.accent : '#ccc' }]}
        onPress={create}
      >
        <Text style={s.btnTxt}>创建群聊</Text>
      </Pressable>
      <Text style={s.hint}>
        群里由「导演」决定谁接话：她们会互相聊，也会回应你。上限、后台闲聊都在群设置里。
      </Text>

      <Modal visible={homePickFor !== null} transparent animationType="fade">
        <Pressable style={s.backdrop} onPress={() => setHomePickFor(null)}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>哪个聊天是真正的她？</Text>
            <Text style={s.hint}>她的记忆、心情都住在这个聊天里；群聊发言会以它为准。</Text>
            {homePickFor &&
              db
                .getAllSync<{ id: string; title: string; updatedAt: number }>(
                  'SELECT id, title, updatedAt FROM conversations WHERE personaId = ? ORDER BY updatedAt DESC',
                  [homePickFor.id],
                )
                .map((c) => (
                  <Pressable key={c.id} style={s.homeRow} onPress={() => pickHome(homePickFor, c.id)}>
                    <Text style={s.rowTxt}>{c.title}</Text>
                    <Text style={s.hint}>{fmtTime(c.updatedAt)}</Text>
                  </Pressable>
                ))}
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  label: { fontSize: 13, fontWeight: '600', color: '#666', marginTop: 16, marginBottom: 6 },
  input: {
    fontSize: 15, padding: 10, backgroundColor: '#f2f2f2', borderRadius: 10,
  },
  row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#eee' },
  rowTap: { paddingVertical: 2 },
  rowTxt: { fontSize: 15 },
  btn: { borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 20 },
  btnTxt: { color: '#fff', fontSize: 15, fontWeight: '600' },
  hint: { fontSize: 12, color: '#888', lineHeight: 17, marginTop: 10 },
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  sheet: { backgroundColor: '#fff', borderRadius: 14, padding: 16, width: '86%' },
  sheetTitle: { fontSize: 16, fontWeight: '700' },
  homeRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#eee' },
});
