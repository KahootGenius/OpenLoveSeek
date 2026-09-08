import { useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import {
  ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { buildFalInput, FAL_PRO_T2I, falGenerate, FalError, userMessageForFal } from '../lib/fal';
import { composeRefPrompts, REF_SLOT_COUNT } from '../lib/imagegen';
import { clearRefImages, listRefImages, setPersonaRefsFrozen, upsertRefImage } from '../lib/db';
import { getFalKey } from '../lib/settings';
import { useTheme } from '../lib/theme-context';
import type { RefImage } from '../lib/types';

function slotsFromRows(rows: RefImage[]): (RefImage | null)[] {
  const arr: (RefImage | null)[] = [null, null, null];
  for (const r of rows) if (r.slot >= 0 && r.slot < REF_SLOT_COUNT) arr[r.slot] = r;
  return arr;
}

/** 形象设定 gallery (v2.6 照片): the 3 frozen reference-image slots, generation,
 *  per-slot regenerate, and the freeze/清空重来 lifecycle. Props-driven like
 *  ChatInspector — owns its own generation state, reports frozen changes up
 *  so the parent screen can disable the appearance TextInput. */
export function RefGallery(props: {
  personaId: string;
  appearance: string;
  refsFrozen: boolean;
  falKeyPresent: boolean;
  onFrozenChange: (frozen: boolean) => void;
}) {
  const { th } = useTheme();
  const { personaId, appearance, refsFrozen } = props;
  const [slots, setSlots] = useState<(RefImage | null)[]>(() =>
    slotsFromRows(listRefImages(personaId)),
  );
  const [loadingSlot, setLoadingSlot] = useState<number | null>(null);
  const busy = loadingSlot !== null;
  const canGenerate = props.falKeyPresent && appearance.trim().length > 0 && !refsFrozen;
  const allFilled = slots.every((s) => s !== null);

  const runSlot = async (slot: number) => {
    const key = await getFalKey();
    if (!key) return;
    setLoadingSlot(slot);
    try {
      const prompt = composeRefPrompts(appearance)[slot];
      const urls = await falGenerate(key, FAL_PRO_T2I, buildFalInput({ prompt, size: 'portrait_4_3' }));
      if (!urls[0]) throw new FalError(0, '未返回图片');
      const dir = `${FileSystem.documentDirectory}refimg/`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      // eslint-disable-next-line react-hooks/purity -- filename suffix; only runs from a button press, never during render
      const dest = `${dir}${personaId}-${slot}-${Date.now()}.jpg`;
      await FileSystem.downloadAsync(urls[0], dest);
      const old = slots[slot];
      if (old) await FileSystem.deleteAsync(old.uri, { idempotent: true }).catch(() => {});
      upsertRefImage(personaId, slot, dest, prompt);
      setSlots((prev) => {
        const next = [...prev];
        next[slot] = { id: `${personaId}:${slot}`, personaId, slot, uri: dest, prompt, createdAt: Date.now() };
        return next;
      });
    } catch (e) {
      Alert.alert('生成失败', userMessageForFal(e instanceof FalError ? e.status : 0));
    } finally {
      setLoadingSlot(null);
    }
  };

  const runAll = async () => {
    for (let slot = 0; slot < REF_SLOT_COUNT; slot++) {
      await runSlot(slot);
    }
  };

  const confirmFreeze = () => {
    Alert.alert('确认冻结？', '这将成为她固定的样子；冻结后只能清空重来。', [
      { text: '取消', style: 'cancel' },
      {
        text: '确认冻结',
        onPress: () => {
          setPersonaRefsFrozen(personaId, 1);
          props.onFrozenChange(true);
        },
      },
    ]);
  };

  const confirmClear = () => {
    Alert.alert('清空重来？', '将删除全部参考图，形象设定可重新编辑。此操作不可撤销。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: async () => {
          for (const r of slots) {
            if (r) await FileSystem.deleteAsync(r.uri, { idempotent: true }).catch(() => {});
          }
          clearRefImages(personaId);
          setPersonaRefsFrozen(personaId, 0);
          setSlots([null, null, null]);
          props.onFrozenChange(false);
        },
      },
    ]);
  };

  return (
    <View>
      {refsFrozen ? (
        <Text style={[s.badge, { backgroundColor: th.accentSoft, color: th.accent }]}>已冻结</Text>
      ) : !props.falKeyPresent ? (
        <Text style={s.hint}>在设置里填入 fal.ai Key 后可生成参考图</Text>
      ) : null}
      <View style={s.row}>
        {slots.map((slot, i) => (
          <View key={i} style={s.cell}>
            {loadingSlot === i ? (
              <View style={[s.thumb, s.placeholder]}>
                <ActivityIndicator color={th.accent} />
              </View>
            ) : slot ? (
              <Image source={{ uri: slot.uri }} style={s.thumb} />
            ) : (
              <View style={[s.thumb, s.placeholder]} />
            )}
            {!refsFrozen && props.falKeyPresent && (
              <Pressable
                style={[s.regen, (busy || !canGenerate) && { opacity: 0.4 }]}
                disabled={busy || !canGenerate}
                onPress={() => void runSlot(i)}
              >
                <Text style={[s.regenTxt, { color: th.accent }]}>{slot ? '重新生成' : '生成'}</Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>
      {!refsFrozen && (
        <Pressable
          style={[s.action, { backgroundColor: th.accent }, (busy || !canGenerate) && { opacity: 0.4 }]}
          disabled={busy || !canGenerate}
          onPress={() => void runAll()}
        >
          <Text style={s.actionTxt}>{busy ? '生成中…' : '生成参考图'}</Text>
        </Pressable>
      )}
      {allFilled && !refsFrozen && (
        <Pressable
          style={[s.action, { backgroundColor: th.accentSoft }, busy && { opacity: 0.4 }]}
          disabled={busy}
          onPress={confirmFreeze}
        >
          <Text style={[s.actionTxt, { color: th.accent }]}>确认冻结</Text>
        </Pressable>
      )}
      {refsFrozen && (
        <Pressable style={[s.action, s.danger]} onPress={confirmClear}>
          <Text style={[s.actionTxt, { color: '#a32d2d' }]}>清空重来</Text>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  hint: { fontSize: 12, color: '#996a00', lineHeight: 17, marginBottom: 8 },
  badge: {
    alignSelf: 'flex-start', fontSize: 12, fontWeight: '600',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8,
  },
  row: { flexDirection: 'row', gap: 10 },
  cell: { flex: 1, alignItems: 'center' },
  thumb: { width: '100%', aspectRatio: 3 / 4, borderRadius: 10, backgroundColor: '#f2f2f2' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  regen: { marginTop: 6, paddingVertical: 4 },
  regenTxt: { fontSize: 12 },
  action: {
    marginTop: 10, borderRadius: 10, alignItems: 'center', paddingVertical: 12,
  },
  actionTxt: { color: '#fff', fontSize: 15 },
  danger: { backgroundColor: '#fdecea' },
});
