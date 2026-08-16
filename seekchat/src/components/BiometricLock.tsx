import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useTheme } from '../lib/theme-context';

/**
 * Full-screen in-app lock: the character "won't let you go". Dismissed only by
 * the device's own biometric / PIN (expo-local-authentication) — never seizes
 * the phone; the OS home button always frees the user. `line` is her taunt.
 */
export function BiometricLock(props: { visible: boolean; line: string; onUnlock: () => void }) {
  const { th } = useTheme();
  const [busy, setBusy] = useState(false);

  const tryUnlock = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const has = await LocalAuthentication.hasHardwareAsync();
      const enrolled = has && (await LocalAuthentication.isEnrolledAsync());
      if (!enrolled) {
        // No biometric/PIN configured — don't trap the user with no way out.
        props.onUnlock();
        return;
      }
      const r = await LocalAuthentication.authenticateAsync({
        promptMessage: '验证身份以继续',
        cancelLabel: '取消',
      });
      if (r.success) props.onUnlock();
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (props.visible) void tryUnlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.visible]);

  return (
    <Modal visible={props.visible} animationType="fade" onRequestClose={() => {}}>
      <View style={[s.root, { backgroundColor: th.accent }]}>
        <Text style={s.heart}>♡</Text>
        <Text style={s.line}>{props.line}</Text>
        <Pressable style={s.btn} onPress={() => void tryUnlock()}>
          <Text style={s.btnTxt}>{busy ? '验证中…' : '验证身份解锁'}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  heart: { fontSize: 64, color: 'rgba(255,255,255,0.9)', marginBottom: 20 },
  line: {
    fontSize: 20, color: '#fff', textAlign: 'center', lineHeight: 30, marginBottom: 40,
  },
  btn: {
    backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 12,
    paddingHorizontal: 28, paddingVertical: 14,
  },
  btnTxt: { color: '#fff', fontSize: 16 },
});
