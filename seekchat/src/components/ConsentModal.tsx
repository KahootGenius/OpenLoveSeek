import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/theme-context';

/** Serious-setting consent: explicit tick box plus a 5s countdown before 确认 unlocks. */
export function ConsentModal(props: {
  visible: boolean;
  title: string;
  body: string;
  tickLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { th } = useTheme();
  const [ticked, setTicked] = useState(false);
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (!props.visible) return;
    setTicked(false);
    setCountdown(5);
    const h = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(h);
  }, [props.visible]);

  return (
    <Modal visible={props.visible} transparent animationType="fade">
      <View style={s.backdrop}>
        <View style={s.card}>
          <Text style={s.title}>{props.title}</Text>
          <Text style={s.body}>{props.body}</Text>
          <Pressable style={s.tickRow} onPress={() => setTicked((t) => !t)}>
            <View style={[s.tickBox, ticked && { backgroundColor: th.accent, borderColor: th.accent }]}>
              {ticked && <Text style={{ color: '#fff', fontSize: 12 }}>✓</Text>}
            </View>
            <Text style={s.tickTxt}>{props.tickLabel}</Text>
          </Pressable>
          <View style={s.btnRow}>
            <Pressable style={s.cancel} onPress={props.onCancel}>
              <Text style={{ color: '#666', fontSize: 15 }}>取消</Text>
            </Pressable>
            <Pressable
              style={[
                s.ok,
                { backgroundColor: th.accent },
                (countdown > 0 || !ticked) && { opacity: 0.4 },
              ]}
              disabled={countdown > 0 || !ticked}
              onPress={props.onConfirm}
            >
              <Text style={{ color: '#fff', fontSize: 15 }}>
                {countdown > 0 ? `确认（${countdown}）` : '确认开启'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 20, width: '100%' },
  title: { fontSize: 17, fontWeight: '600', marginBottom: 10 },
  body: { fontSize: 14, color: '#444', lineHeight: 21 },
  tickRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  tickBox: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: '#bbb',
    alignItems: 'center', justifyContent: 'center',
  },
  tickTxt: { fontSize: 14, color: '#333' },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 14, marginTop: 18 },
  cancel: { paddingHorizontal: 14, paddingVertical: 10 },
  ok: { borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
});
