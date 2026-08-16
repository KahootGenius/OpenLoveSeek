import { Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/theme-context';

/** Round avatar: shows the image if set, else the name's first character. */
export function Avatar(props: { uri: string | null | undefined; name: string; size?: number }) {
  const { th } = useTheme();
  const size = props.size ?? 36;
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (props.uri) {
    return <Image source={{ uri: props.uri }} style={round} />;
  }
  return (
    <View style={[round, s.fallback, { backgroundColor: th.accentSoft }]}>
      <Text style={[s.initial, { color: th.accent, fontSize: size * 0.45 }]}>
        {props.name.trim().charAt(0) || '?'}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initial: { fontWeight: '600' },
});
