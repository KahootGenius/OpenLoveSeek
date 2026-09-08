import { useEffect, useState } from 'react';
import { Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/theme-context';
import type { MenuAction } from '../lib/messagemenu';

export interface MenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

const GAP = 8; // space between the anchor and the card
const EDGE_PADDING = 12; // minimum clearance from the screen edges
const TOP_FLIP_THRESHOLD = 180; // anchor.y closer to the top than this flips the card below
const CARD_WIDTH = 220;

/** Long-press action sheet with NO row-count ceiling — the fix for Android's
 *  Alert.alert, which silently drops buttons past 3 and made 撤回/删除
 *  disappear whenever a row also offered 回复/朗读/@她 (see messagemenu.ts).
 *  A denied action still renders here, greyed out with its reason as a
 *  caption, rather than being omitted like the old sheet did. */
export function MessageActionMenu(props: {
  visible: boolean;
  anchor: MenuAnchor | null;
  actions: MenuAction[];
  onAction: (key: string) => void;
  onClose: () => void;
}) {
  const { th } = useTheme();
  // Card height depends on the (uncapped) row count, so position is computed
  // in two passes: render once off-screen to measure via onLayout, then place
  // it for real. Reset on every open so a new anchor/action set re-measures.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (props.visible) setSize(null);
  }, [props.visible]);

  const { anchor } = props;
  const positioned = anchor !== null && size !== null;
  let left = -9999;
  let top = -9999;
  let maxHeight = Dimensions.get('window').height * 0.6;
  if (anchor && size) {
    const screen = Dimensions.get('window');
    maxHeight = screen.height * 0.6;
    const flipBelow = anchor.y < TOP_FLIP_THRESHOLD;
    const rawTop = flipBelow
      ? anchor.y + anchor.height + GAP
      : anchor.y - GAP - size.h;
    top = Math.max(EDGE_PADDING, Math.min(rawTop, screen.height - size.h - EDGE_PADDING));
    const rawLeft = anchor.x + anchor.width / 2 - size.w / 2;
    left = Math.max(EDGE_PADDING, Math.min(rawLeft, screen.width - CARD_WIDTH - EDGE_PADDING));
  }

  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <Pressable style={s.backdrop} onPress={props.onClose}>
        <View
          style={[s.card, { width: CARD_WIDTH, maxHeight, left, top, opacity: positioned ? 1 : 0 }]}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setSize((prev) => (prev && prev.w === width && prev.h === height ? prev : { w: width, h: height }));
          }}
        >
          <ScrollView style={s.scroll}>
            {props.actions.map((a, i) => (
              <Pressable
                key={a.key}
                disabled={!!a.disabledReason}
                onPress={() => props.onAction(a.key)}
                style={({ pressed }) => [
                  s.row,
                  i > 0 && s.rowBorder,
                  a.disabledReason ? s.rowDisabled : pressed && { backgroundColor: th.accentSoft },
                ]}
              >
                <Text style={[s.label, a.destructive && s.destructiveLabel]}>{a.label}</Text>
                {a.disabledReason && <Text style={s.reason}>{a.disabledReason}</Text>}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  card: {
    position: 'absolute', backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  scroll: { flexGrow: 0 },
  row: { paddingVertical: 12, paddingHorizontal: 16 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#eee' },
  rowDisabled: { opacity: 0.4 },
  label: { fontSize: 15, color: '#222' },
  destructiveLabel: { color: '#a32d2d' },
  reason: { fontSize: 11, color: '#888', marginTop: 2 },
});
