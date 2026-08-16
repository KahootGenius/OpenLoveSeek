import { parseBlocks, parseInline } from '../lib/markdown';

describe('parseInline', () => {
  it('splits bold', () => {
    expect(parseInline('a **b** c')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' c' },
    ]);
  });
  it('handles code and italic', () => {
    expect(parseInline('`x` and *y*')).toEqual([
      { text: 'x', code: true },
      { text: ' and ' },
      { text: 'y', italic: true },
    ]);
  });
  it('leaves unclosed markers literal', () => {
    expect(parseInline('**a')).toEqual([{ text: '**a' }]);
  });
  it('passes plain text through', () => {
    expect(parseInline('你好呀')).toEqual([{ text: '你好呀' }]);
  });
});

describe('parseBlocks', () => {
  it('parses headers, paragraphs, bullets', () => {
    expect(parseBlocks('# 标题\ntext\n- one\n- two')).toEqual([
      { type: 'h', level: 1, text: '标题' },
      { type: 'p', text: 'text' },
      { type: 'bullet', text: 'one' },
      { type: 'bullet', text: 'two' },
    ]);
  });
  it('parses fenced code blocks', () => {
    expect(parseBlocks('前面\n```\nconst a = 1;\nconst b = 2;\n```\n后面')).toEqual([
      { type: 'p', text: '前面' },
      { type: 'code', text: 'const a = 1;\nconst b = 2;' },
      { type: 'p', text: '后面' },
    ]);
  });
  it('skips blank lines', () => {
    expect(parseBlocks('a\n\nb')).toEqual([
      { type: 'p', text: 'a' },
      { type: 'p', text: 'b' },
    ]);
  });
  it('treats an unclosed fence as code to the end', () => {
    expect(parseBlocks('```\nabc')).toEqual([{ type: 'code', text: 'abc' }]);
  });
});
