import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/theme-context';

/** A command from 主人 that blocks the chat until the user taps 遵命. */
export function CommandCard(props: { command: string | null; onObey: () => void }) {
  const { th } = useTheme();
  return (
    <Modal visible={props.command !== null} transparent animationType="fade">
      <View style={s.backdrop}>
        <View style={s.card}>
          <Text style={s.label}>命令</Text>
          <Text style={s.cmd}>{props.command}</Text>
          <Pressable style={[s.obey, { backgroundColor: th.accent }]} onPress={props.onObey}>
            <Text style={s.obeyTxt}>遵命</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 24, width: '100%', alignItems: 'center' },
  label: { fontSize: 12, color: '#a32d2d', letterSpacing: 4, marginBottom: 12 },
  cmd: { fontSize: 20, color: '#222', textAlign: 'center', lineHeight: 30, marginBottom: 24 },
  obey: { borderRadius: 12, paddingHorizontal: 40, paddingVertical: 14 },
  obeyTxt: { color: '#fff', fontSize: 17, letterSpacing: 4 },
});
