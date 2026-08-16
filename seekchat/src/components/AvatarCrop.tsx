import { useRef, useState } from 'react';
import {
  GestureResponderEvent, Image, Modal, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { RawImage, renderAvatar } from '../lib/avatar';
import { cropRectFor } from '../lib/crop';
import { useTheme } from '../lib/theme-context';

const V = 280; // viewport square

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Drag to position, slide to zoom — replaces the fixed center crop. */
export function AvatarCrop(props: {
  image: RawImage | null;
  onDone: (dataUri: string | null) => void;
}) {
  const { th } = useTheme();
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rendering, setRendering] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, px: 0, py: 0 });
  const [trackW, setTrackW] = useState(1);

  const img = props.image;
  if (!img) return null;
  const hasDims = img.width > 0 && img.height > 0;
  const base = hasDims ? V / Math.min(img.width, img.height) : 1;
  const S = base * zoom;
  const dw = img.width * S;
  const dh = img.height * S;
  const maxPanX = Math.max(0, (dw - V) / 2);
  const maxPanY = Math.max(0, (dh - V) / 2);

  const grant = (e: GestureResponderEvent) => {
    dragStart.current = {
      x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, px: pan.x, py: pan.y,
    };
  };
  const move = (e: GestureResponderEvent) => {
    setPan({
      x: clamp(dragStart.current.px + e.nativeEvent.pageX - dragStart.current.x, -maxPanX, maxPanX),
      y: clamp(dragStart.current.py + e.nativeEvent.pageY - dragStart.current.y, -maxPanY, maxPanY),
    });
  };

  const zoomTouch = (e: GestureResponderEvent) => {
    const z = 1 + clamp(e.nativeEvent.locationX / trackW, 0, 1) * 2; // 1..3
    setZoom(z);
    setPan((p) => ({ x: clamp(p.x, -maxPanX, maxPanX), y: clamp(p.y, -maxPanY, maxPanY) }));
  };

  const confirm = async () => {
    if (rendering) return;
    setRendering(true);
    const rect = hasDims
      ? cropRectFor(img.width, img.height, V, zoom, pan.x, pan.y)
      : null;
    const uri = await renderAvatar(img.uri, rect);
    setRendering(false);
    setPan({ x: 0, y: 0 });
    setZoom(1);
    props.onDone(uri);
  };

  return (
    <Modal visible transparent animationType="fade">
      <View style={s.backdrop}>
        <View style={s.card}>
          <Text style={s.title}>调整头像（拖动位置，滑动缩放）</Text>
          <View
            style={s.stage}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={grant}
            onResponderMove={move}
          >
            <Image
              source={{ uri: img.uri }}
              style={{
                position: 'absolute',
                width: hasDims ? dw : V,
                height: hasDims ? dh : V,
                left: hasDims ? (V - dw) / 2 + pan.x : 0,
                top: hasDims ? (V - dh) / 2 + pan.y : 0,
              }}
            />
            <View pointerEvents="none" style={s.circleMask} />
          </View>
          {hasDims && (
            <View
              style={s.zoomTrack}
              onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={zoomTouch}
              onResponderMove={zoomTouch}
            >
              <View style={s.zoomRail} />
              <View
                pointerEvents="none"
                style={[s.zoomThumb, { left: ((zoom - 1) / 2) * trackW - 9, backgroundColor: th.accent }]}
              />
            </View>
          )}
          <View style={s.btnRow}>
            <Pressable style={s.cancel} onPress={() => props.onDone(null)}>
              <Text style={{ color: '#666', fontSize: 15 }}>取消</Text>
            </Pressable>
            <Pressable
              style={[s.ok, { backgroundColor: th.accent }, rendering && { opacity: 0.5 }]}
              disabled={rendering}
              onPress={() => void confirm()}
            >
              <Text style={{ color: '#fff', fontSize: 15 }}>{rendering ? '处理中…' : '使用'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, alignItems: 'center' },
  title: { fontSize: 15, fontWeight: '600', marginBottom: 12 },
  stage: { width: V, height: V, overflow: 'hidden', borderRadius: 10, backgroundColor: '#eee' },
  circleMask: {
    position: 'absolute', left: 0, top: 0, width: V, height: V,
    borderRadius: V / 2, borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)',
  },
  zoomTrack: { width: V, height: 28, marginTop: 12, justifyContent: 'center' },
  zoomRail: { height: 4, borderRadius: 2, backgroundColor: '#ddd' },
  zoomThumb: { position: 'absolute', width: 18, height: 18, borderRadius: 9 },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 14, marginTop: 14, alignSelf: 'stretch' },
  cancel: { paddingHorizontal: 14, paddingVertical: 10 },
  ok: { borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
});
