import { StyleSheet, Text, View } from 'react-native';
import { splitBrackets } from './brackets';

export interface InlineSeg {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+?\*\*)|(\*[^*\s][^*]*?\*)/g;

export function parseInline(text: string): InlineSeg[] {
  const segs: InlineSeg[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) segs.push({ text: text.slice(last, idx) });
    if (m[1]) segs.push({ text: m[1].slice(1, -1), code: true });
    else if (m[2]) segs.push({ text: m[2].slice(2, -2), bold: true });
    else if (m[3]) segs.push({ text: m[3].slice(1, -1), italic: true });
    last = idx + m[0].length;
  }
  if (last < text.length) segs.push({ text: text.slice(last) });
  return segs;
}

export type Block =
  | { type: 'p'; text: string }
  | { type: 'code'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'h'; level: number; text: string };

export function parseBlocks(src: string): Block[] {
  const out: Block[] = [];
  const lines = src.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence (or run past the end)
      out.push({ type: 'code', text: buf.join('\n') });
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      out.push({ type: 'h', level: h[1].length, text: h[2] });
    } else {
      const b = /^\s*[-*]\s+(.*)$/.exec(line);
      if (b) out.push({ type: 'bullet', text: b[1] });
      else if (line.trim().length > 0) out.push({ type: 'p', text: line });
    }
    i++;
  }
  return out;
}

export function Markdown(props: { text: string }) {
  const blocks = parseBlocks(props.text);
  return (
    <View>
      {blocks.map((b, i) => {
        if (b.type === 'code') {
          return (
            <Text key={i} style={m.codeBlock}>
              {b.text}
            </Text>
          );
        }
        const inner = parseInline(b.text).map((sg, j) => (
          <Text
            key={j}
            style={[sg.bold && m.b, sg.italic && m.i, sg.code && m.code]}
          >
            {sg.code
              ? sg.text
              : splitBrackets(sg.text).map((br, k) => (
                  <Text key={k} style={br.action ? m.action : undefined}>
                    {br.text}
                  </Text>
                ))}
          </Text>
        ));
        if (b.type === 'h') {
          return (
            <Text key={i} style={[m.p, m.h, b.level === 1 && m.h1]}>
              {inner}
            </Text>
          );
        }
        if (b.type === 'bullet') {
          return (
            <Text key={i} style={m.p}>
              {'•  '}
              {inner}
            </Text>
          );
        }
        return (
          <Text key={i} style={m.p}>
            {inner}
          </Text>
        );
      })}
    </View>
  );
}

const m = StyleSheet.create({
  p: { fontSize: 16, lineHeight: 22 },
  h: { fontWeight: '700', fontSize: 17, marginTop: 2 },
  h1: { fontSize: 18 },
  b: { fontWeight: '700' },
  i: { fontStyle: 'italic' },
  action: { color: '#9a9a9a', fontStyle: 'italic' },
  code: { fontFamily: 'monospace', backgroundColor: '#f0f0f0', fontSize: 14 },
  codeBlock: {
    fontFamily: 'monospace', fontSize: 13, lineHeight: 18,
    backgroundColor: '#f5f5f5', borderRadius: 6, padding: 8, marginVertical: 2,
  },
});
