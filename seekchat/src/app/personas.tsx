import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { listPersonas } from '../lib/db';
import { useTheme } from '../lib/theme-context';
import type { Persona } from '../lib/types';

export default function PersonasScreen() {
  const [items, setItems] = useState<Persona[]>([]);
  useFocusEffect(useCallback(() => setItems(listPersonas()), []));
  const { th } = useTheme();
  return (
    <View style={s.root}>
      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <Pressable style={s.row} onPress={() => router.push(`/persona/${item.id}`)}>
            <View style={s.titleRow}>
              <Text style={s.title}>{item.name}</Text>
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
  sub: { fontSize: 13, color: '#888', marginTop: 4 },
  fab: {
    position: 'absolute', right: 20, bottom: 30, width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center', elevation: 3,
  },
  fabTxt: { color: '#fff', fontSize: 26, lineHeight: 30 },
});
