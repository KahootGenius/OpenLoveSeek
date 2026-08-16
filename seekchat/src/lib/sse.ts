export type SSEEvent =
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'done' };

export function createSSEParser() {
  let buf = '';
  return {
    push(text: string): SSEEvent[] {
      buf += text;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      const events: SSEEvent[] = [];
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') {
          events.push({ type: 'done' });
          continue;
        }
        try {
          const d = JSON.parse(payload)?.choices?.[0]?.delta;
          if (typeof d?.content === 'string' && d.content.length > 0)
            events.push({ type: 'delta', text: d.content });
          if (typeof d?.reasoning_content === 'string' && d.reasoning_content.length > 0)
            events.push({ type: 'reasoning', text: d.reasoning_content });
        } catch {
          // a complete line that isn't valid JSON: skip defensively
        }
      }
      return events;
    },
  };
}
