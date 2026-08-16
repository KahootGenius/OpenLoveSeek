import { useState } from 'react';
import {
  Modal, Pressable, ScrollView, SectionList, StyleSheet, Text, TextInput, View,
} from 'react-native';
import {
  extractVars, getPromptDef, getTemplate, isOverridden, listPromptGroups,
  setPromptOverride, PromptDef,
} from '../lib/prompts';
import { useTheme } from '../lib/theme-context';

export default function PromptStudioScreen() {
  const { th } = useTheme();
  // Bumped on save/reset so 已修改 badges re-render. Plain counter — no
  // dep-as-signal hooks (React Compiler discipline).
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<PromptDef | null>(null);
  const [text, setText] = useState('');

  const sections = listPromptGroups().map((g) => ({ title: g.title, data: g.prompts }));

  const openEditor = (p: PromptDef) => {
    setText(getTemplate(p.key));
    setEditing(p);
  };

  const save = () => {
    if (!editing) return;
    const t = text.trim();
    setPromptOverride(editing.key, t === editing.template.trim() ? null : t);
    setEditing(null);
    setVersion(version + 1);
  };

  const reset = () => {
    if (!editing) return;
    setPromptOverride(editing.key, null);
    setEditing(null);
    setVersion(version + 1);
  };

  const vars = editing ? extractVars(editing.template) : [];

  return (
    <View style={s.root}>
      <SectionList
        sections={sections}
        keyExtractor={(p) => p.key}
        extraData={version}
        contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
        renderSectionHeader={({ section }) => (
          <Text style={s.section}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <Pressable style={s.row} onPress={() => openEditor(item)}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{item.title}</Text>
              {!!item.desc && <Text style={s.desc}>{item.desc}</Text>}
            </View>
            {isOverridden(item.key) && (
              <Text style={[s.badge, { color: th.accent, borderColor: th.accent }]}>已修改</Text>
            )}
          </Pressable>
        )}
        ListHeaderComponent={
          <Text style={s.hint}>
            这里是她的一切行为规则。改动立刻对下一条消息生效；改坏了她可能失灵——
            打开对应条目点「恢复默认」即可回到出厂。
          </Text>
        }
      />
      <Modal visible={editing !== null} transparent animationType="slide">
        <View style={s.backdrop}>
          <View style={s.sheet}>
            <Text style={s.title}>{editing?.title}</Text>
            {vars.length > 0 && (
              <View style={s.varRow}>
                <Text style={s.varHint}>占位符会被真实数据替换，请保留：</Text>
                {vars.map((v) => (
                  <Text key={v} style={[s.varChip, { backgroundColor: th.accentSoft }]}>
                    {`{{${v}}}`}
                  </Text>
                ))}
              </View>
            )}
            <ScrollView style={s.editorScroll} keyboardShouldPersistTaps="handled">
              <TextInput
                style={s.editor}
                value={text}
                onChangeText={setText}
                multiline
                textAlignVertical="top"
              />
            </ScrollView>
            <View style={s.btnRow}>
              <Pressable style={s.btnGhost} onPress={() => setEditing(null)}>
                <Text style={{ color: '#666' }}>取消</Text>
              </Pressable>
              <Pressable style={s.btnGhost} onPress={reset}>
                <Text style={{ color: '#a32d2d' }}>恢复默认</Text>
              </Pressable>
              <Pressable style={[s.btn, { backgroundColor: th.accent }]} onPress={save}>
                <Text style={s.btnTxt}>保存</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f6f6f6' },
  hint: { fontSize: 12, color: '#888', lineHeight: 18, marginBottom: 10 },
  section: {
    fontSize: 13, fontWeight: '700', color: '#666', marginTop: 14, marginBottom: 6,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff',
    borderRadius: 10, padding: 12, marginBottom: 6,
  },
  title: { fontSize: 15, fontWeight: '600' },
  desc: { fontSize: 12, color: '#999', marginTop: 2, lineHeight: 16 },
  badge: {
    fontSize: 11, borderWidth: StyleSheet.hairlineWidth, borderRadius: 4,
    paddingHorizontal: 4, paddingVertical: 1,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    padding: 16, maxHeight: '90%',
  },
  varRow: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8,
  },
  varHint: { fontSize: 12, color: '#888' },
  varChip: {
    fontSize: 12, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
    fontFamily: 'monospace' as const,
  },
  editorScroll: { marginTop: 10, maxHeight: 380 },
  editor: {
    minHeight: 200, fontSize: 13, lineHeight: 19, padding: 10,
    backgroundColor: '#f2f2f2', borderRadius: 10, fontFamily: 'monospace' as const,
  },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 14, marginTop: 12 },
  btn: { borderRadius: 10, paddingHorizontal: 22, paddingVertical: 10 },
  btnGhost: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10 },
  btnTxt: { color: '#fff', fontSize: 15 },
});
