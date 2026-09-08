import type { Dispatch, SetStateAction } from 'react';
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet,
  Switch, Text, TextInput, View,
} from 'react-native';
import {
  clearMemories, clearSummary, deleteMemory, setCurveDrift, setLifeEnabled, setMemoryEnabled,
} from '../lib/db';
import {
  canAddManualMemory, fmtMemoryDate, MAX_MEMORY_ENTRIES, MAX_MEMORY_TEXT,
  normalizeManualMemoryText,
} from '../lib/memory';
import { isSummarizing } from '../lib/engine';
import { useTheme } from '../lib/theme-context';
import type { MemoryEntry } from '../lib/types';

export interface InspectorData {
  personaText: string;
  summary: string | null;
  memoryOn: boolean;
  memories: MemoryEntry[];
  windowCount: number;
  windowTokens: number;
  summarizedOnly: number;
  totalMessages: number;
  apiCount: number;
  realism: boolean;
  mood: { label: string; intensity: number };
  activity: string | null;
  thought: string | null;
  curveRows: { part: string; base: number; eff: number }[] | null;
  driftLog: { at: number; part: string; step: number }[];
  masterOn: boolean;
  discipline: number;
  honorific: string | null;
  rules: string | null;
}

export interface MemoryEditState {
  id: string | null;
  text: string;
}

/** 上下文检查器 modal: what the next request will send, the Life/记忆库
 *  switches, dev-only manual memory CRUD, and the in-modal memory editor. */
export function ChatInspector(props: {
  visible: boolean;
  conversationId: string;
  data: InspectorData | null;
  lifeEnabled: boolean;
  devMode: boolean;
  memoryEdit: MemoryEditState | null;
  setMemoryEdit: Dispatch<SetStateAction<MemoryEditState | null>>;
  onOpenMemoryEditor: (id: string | null, text?: string) => void;
  onSaveMemoryEdit: () => void;
  canMutateManualMemory: () => boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { th } = useTheme();
  const { data, devMode, memoryEdit, setMemoryEdit, conversationId } = props;
  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      onRequestClose={() => {
        if (memoryEdit) setMemoryEdit(null);
        else props.onClose();
      }}
    >
      <View style={s.insModalRoot}>
        <ScrollView style={s.insRoot} contentContainerStyle={{ padding: 16 }}>
        <Text style={s.insTitle}>上下文检查器（下一次请求将发送）</Text>
        {data && (
          <>
            <Text style={s.insHead}>
              共 {data.totalMessages} 条消息 → 发送 {data.apiCount} 段：
              人设 + {data.summary ? '总结 + ' : ''}
              最近 {data.windowCount} 条（约 {data.windowTokens} tokens）；
              仅存在于总结中的旧消息 {data.summarizedOnly} 条
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
                value={props.lifeEnabled}
                onValueChange={(v) => {
                  setLifeEnabled(conversationId, v);
                  props.onChanged();
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
                value={data.memoryOn}
                onValueChange={(v) => {
                  setMemoryEnabled(conversationId, v);
                  props.onChanged();
                }}
                trackColor={{ true: th.accent }}
              />
            </View>
            {(devMode || data.memoryOn || data.memories.length > 0) && (
              <>
                {devMode && canAddManualMemory(data.memories.length) && (
                  <Pressable
                    style={[s.retry, { backgroundColor: th.accentSoft }]}
                    onPress={() => props.onOpenMemoryEditor(null)}
                  >
                    <Text style={[s.retryTxt, { color: th.accent }]}>＋ 添加记忆</Text>
                  </Pressable>
                )}
                {data.memories.length === 0 ? (
                  <Text style={s.insBlock}>（还没有记忆——聊到重要的事她会记下来）</Text>
                ) : (
                  data.memories.map((m, i) => (
                    <View key={m.id} style={s.memRow}>
                      <Text style={s.memText}>
                        {i + 1}. [{fmtMemoryDate(m.createdAt)}] {m.text}
                      </Text>
                      {devMode && (
                        <View style={s.memActions}>
                          <Pressable
                            style={s.memEdit}
                            onPress={() => props.onOpenMemoryEditor(m.id, m.text)}
                          >
                            <Text style={{ color: th.accent, fontSize: 14 }}>编辑</Text>
                          </Pressable>
                          <Pressable
                            style={s.memDel}
                            onPress={() => {
                              if (!props.canMutateManualMemory()) return;
                              Alert.alert('删除这条记忆？', '删除后不会再注入后续请求。', [
                                { text: '取消', style: 'cancel' },
                                {
                                  text: '删除',
                                  style: 'destructive',
                                  onPress: () => {
                                    if (!props.canMutateManualMemory()) return;
                                    deleteMemory(m.id);
                                    props.onChanged();
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
                {devMode && data.memories.length > 0 && (
                  <Pressable
                    style={[s.retry, { backgroundColor: '#fdecea', marginTop: 6 }]}
                    onPress={() => {
                      if (!props.canMutateManualMemory()) return;
                      Alert.alert('清空她的全部记忆？', '此操作不可撤销。', [
                        { text: '取消', style: 'cancel' },
                        {
                          text: '清空',
                          style: 'destructive',
                          onPress: () => {
                            if (!props.canMutateManualMemory()) return;
                            clearMemories(conversationId);
                            props.onChanged();
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
            {data.realism && (
              <>
                <Text style={s.insLabel}>当前状态（注入下一次请求）</Text>
                <Text style={s.insBlock}>
                  心情：{data.mood.label}
                  {data.mood.intensity > 0
                    ? `（强度${data.mood.intensity.toFixed(1)}）`
                    : ''}
                  {data.activity ? `\n日程：${data.activity}` : ''}
                  {data.thought ? `\n心想：${data.thought}` : ''}
                </Text>
              </>
            )}
            {data.curveRows && (
              <>
                <Text style={s.insLabel}>情绪曲线（基线 → 现值，含成长漂移）</Text>
                <Text style={s.insBlock}>
                  {data.curveRows
                    .map((r) =>
                      r.base === r.eff
                        ? `${r.part} ${r.base.toFixed(1)}`
                        : `${r.part} ${r.base.toFixed(1)} → ${r.eff.toFixed(2)}`,
                    )
                    .join('\n')}
                  {data.driftLog.length > 0
                    ? '\n成长记录：' +
                      data.driftLog
                        .map((l) => {
                          const d = new Date(l.at);
                          return `${d.getMonth() + 1}月${d.getDate()}日 ${l.part}${l.step > 0 ? '+' : ''}${l.step}`;
                        })
                        .join('；')
                    : ''}
                </Text>
                {data.driftLog.length > 0 && (
                  <Pressable
                    style={[s.retry, { backgroundColor: th.accentSoft, marginTop: 6 }]}
                    onPress={() => {
                      setCurveDrift(conversationId, null);
                      props.onChanged();
                    }}
                  >
                    <Text style={[s.retryTxt, { color: th.accent }]}>重置成长</Text>
                  </Pressable>
                )}
              </>
            )}
            {data.masterOn && (
              <>
                <Text style={s.insLabel}>调教值</Text>
                <Text style={s.insBlock}>{data.discipline} / 100</Text>
                <Text style={s.insLabel}>她定的称呼与规矩（她自己设定，你只能遵从）</Text>
                <Text style={s.insBlock}>
                  称呼：{data.honorific ?? '（她还没定）'}
                  {data.rules ? `\n规矩：\n${data.rules}` : '\n规矩：（她还没立）'}
                </Text>
              </>
            )}
            <Text style={s.insLabel}>人设（system）</Text>
            <Text style={s.insBlock}>{data.personaText}</Text>
            <Text style={s.insLabel}>滚动总结（system）</Text>
            <Text style={s.insBlock}>{data.summary ?? '（尚无总结）'}</Text>
            {data.summary != null && (
              <Pressable
                style={[s.retry, { backgroundColor: '#fdecea', marginTop: 6 }]}
                onPress={() => {
                  if (isSummarizing(conversationId)) {
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
                          clearSummary(conversationId);
                          props.onChanged();
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
          onPress={props.onClose}
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
                  onPress={props.onSaveMemoryEdit}
                >
                  <Text style={[s.retryTxt, { color: th.accent }]}>保存</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
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
  // Local copies of the three shared chat-screen styles the modal reuses.
  retry: {
    alignSelf: 'center', marginVertical: 6, paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 14,
  },
  retryTxt: { fontSize: 13 },
  sendTxt: { color: '#fff', fontSize: 15 },
});
