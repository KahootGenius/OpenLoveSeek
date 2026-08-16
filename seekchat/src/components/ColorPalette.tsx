import { useEffect, useState } from 'react';
import { GestureResponderEvent, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { hexToHsv, hsvToHex } from '../lib/color';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * HSV palette: a saturation/value square plus a hue bar. Drag updates the
 * local preview live; the accent is committed (onChange) on finger release.
 */
export function ColorPalette(props: { value: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = useState(() => hexToHsv(props.value));
  const [svSize, setSvSize] = useState({ w: 1, h: 1 });
  const [hueW, setHueW] = useState(1);

  // Sync when the accent changes elsewhere (hex input) — but never against
  // our own committed value, or grays would reset the hue slider.
  useEffect(() => {
    if (props.value !== hsvToHex(hsv.h, hsv.s, hsv.v)) setHsv(hexToHsv(props.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value]);

  const svTouch = (e: GestureResponderEvent, commit: boolean) => {
    const { locationX, locationY } = e.nativeEvent;
    const next = {
      ...hsv,
      s: clamp(locationX / svSize.w, 0, 1),
      v: clamp(1 - locationY / svSize.h, 0, 1),
    };
    setHsv(next);
    if (commit) props.onChange(hsvToHex(next.h, next.s, next.v));
  };

  const hueTouch = (e: GestureResponderEvent, commit: boolean) => {
    const h = clamp(e.nativeEvent.locationX / hueW, 0, 0.9999) * 360;
    const next = { ...hsv, h };
    setHsv(next);
    if (commit) props.onChange(hsvToHex(next.h, next.s, next.v));
  };

  const pureHue = hsvToHex(hsv.h, 1, 1);
  const preview = hsvToHex(hsv.h, hsv.s, hsv.v);

  return (
    <View>
      <View
        style={[s.sv, { backgroundColor: pureHue }]}
        onLayout={(e) =>
          setSvSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
        }
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => svTouch(e, false)}
        onResponderMove={(e) => svTouch(e, false)}
        onResponderRelease={(e) => svTouch(e, true)}
      >
        <LinearGradient
          colors={['#ffffff', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={['rgba(0,0,0,0)', '#000000']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View
          pointerEvents="none"
          style={[
            s.cross,
            {
              left: hsv.s * svSize.w - 9,
              top: (1 - hsv.v) * svSize.h - 9,
              backgroundColor: preview,
            },
          ]}
        />
      </View>
      <View
        style={s.hue}
        onLayout={(e) => setHueW(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => hueTouch(e, false)}
        onResponderMove={(e) => hueTouch(e, false)}
        onResponderRelease={(e) => hueTouch(e, true)}
      >
        <LinearGradient
          colors={['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={s.hueFill}
        />
        <View
          pointerEvents="none"
          style={[s.hueThumb, { left: (hsv.h / 360) * hueW - 3, backgroundColor: pureHue }]}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  sv: { height: 180, borderRadius: 10, overflow: 'hidden' },
  cross: {
    position: 'absolute', width: 18, height: 18, borderRadius: 9,
    borderWidth: 2.5, borderColor: '#fff', elevation: 2,
  },
  hue: { height: 26, marginTop: 10, justifyContent: 'center' },
  hueFill: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 13,
  },
  hueThumb: {
    position: 'absolute', width: 6, height: 26, borderRadius: 3,
    borderWidth: 1.5, borderColor: '#fff', elevation: 2,
  },
});
