import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { demandSatisfied } from '../lib/demand';
import { useTheme } from '../lib/theme-context';

/**
 * Full-screen in-app demand: she makes the user type a required phrase to leave.
 * Not a device lock — the OS home button always frees the user.
 */
export function DemandGate(props: { phrase: string | null; onSatisfied: () => void }) {
  const { th } = useTheme();
  const [input, setInput] = useState('');

  useEffect(() => {
    if (props.phrase) setInput('');
  }, [props.phrase]);

  const ok = props.phrase !== null && demandSatisfied(input, props.phrase);

  return (
    <Modal visible={props.phrase !== null} animationType="fade" onRequestClose={() => {}}>
      <View style={[s.root, { backgroundColor: th.accent }]}>
        <Text style={s.hint}>说出这句话，才准走……</Text>
        <Text style={s.phrase}>「{props.phrase}」</Text>
        <TextInput
          style={s.input}
          value={input}
          onChangeText={setInput}
          placeholder="在这里亲手打出来"
          placeholderTextColor="rgba(255,255,255,0.6)"
          autoFocus
          multiline
        />
        <Pressable
          style={[s.btn, !ok && { opacity: 0.4 }]}
          disabled={!ok}
          onPress={props.onSatisfied}
        >
          <Text style={s.btnTxt}>说完了</Text>
        </Pressable>
        <Text style={s.escape}>（按手机 Home 键可随时退出应用）</Text>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  hint: { fontSize: 15, color: 'rgba(255,255,255,0.85)', marginBottom: 16 },
  phrase: { fontSize: 26, color: '#fff', textAlign: 'center', lineHeight: 38, marginBottom: 28 },
  input: {
    alignSelf: 'stretch', minHeight: 52, backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 12, padding: 14, fontSize: 18, color: '#fff', textAlign: 'center',
  },
  btn: {
    marginTop: 24, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 12,
    paddingHorizontal: 32, paddingVertical: 14,
  },
  btnTxt: { color: '#fff', fontSize: 16 },
  escape: { marginTop: 28, fontSize: 12, color: 'rgba(255,255,255,0.6)' },
});
