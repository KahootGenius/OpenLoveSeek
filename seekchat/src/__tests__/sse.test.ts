import { createSSEParser } from '../lib/sse';

const frame = (content: string) =>
  `data: {"choices":[{"delta":{"content":${JSON.stringify(content)}}}]}\n\n`;

describe('createSSEParser', () => {
  it('parses complete frames', () => {
    const p = createSSEParser();
    expect(p.push(frame('你好') + frame('呀'))).toEqual([
      { type: 'delta', text: '你好' },
      { type: 'delta', text: '呀' },
    ]);
  });
  it('buffers a frame split mid-line across pushes', () => {
    const p = createSSEParser();
    const f = frame('hello');
    expect(p.push(f.slice(0, 15))).toEqual([]);
    expect(p.push(f.slice(15))).toEqual([{ type: 'delta', text: 'hello' }]);
  });
  it('emits done on [DONE]', () => {
    const p = createSSEParser();
    expect(p.push('data: [DONE]\n\n')).toEqual([{ type: 'done' }]);
  });
  it('ignores keep-alives, empty deltas, and non-data lines', () => {
    const p = createSSEParser();
    const rolePayload = 'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n';
    expect(p.push(': keep-alive\n\n' + rolePayload)).toEqual([]);
  });
  it('emits reasoning events for thinking-mode deltas', () => {
    const p = createSSEParser();
    const frame =
      'data: {"choices":[{"delta":{"content":null,"reasoning_content":"她为什么这么问…"}}]}\n\n';
    expect(p.push(frame)).toEqual([{ type: 'reasoning', text: '她为什么这么问…' }]);
  });
  it('mid-multibyte chunk splits are safe once decoded with a streaming TextDecoder', () => {
    const bytes = new TextEncoder().encode(frame('好'));
    const cut = 22; // inside the 3-byte 好
    const d = new TextDecoder();
    const p = createSSEParser();
    const events = [
      ...p.push(d.decode(bytes.slice(0, cut), { stream: true })),
      ...p.push(d.decode(bytes.slice(cut), { stream: true })),
    ];
    expect(events).toEqual([{ type: 'delta', text: '好' }]);
  });
});
