import {
  cents, encodeTransfer, extractTransferMarker, fmtMoney, parseTransfer, transferModelText,
} from '../lib/transfer';

describe('fmtMoney / cents', () => {
  it('formats to 2 decimals with ¥', () => {
    expect(fmtMoney(5.2)).toBe('¥5.20');
    expect(fmtMoney(1314)).toBe('¥1314.00');
    expect(fmtMoney(0.1 + 0.2)).toBe('¥0.30'); // float safety
  });
  it('cents rounds and clamps', () => {
    expect(cents(5.199)).toBe(5.2);
    expect(cents(-3)).toBe(0);
  });
});

describe('extractTransferMarker', () => {
  it('pulls an own-line marker and cleans the reply', () => {
    const r = extractTransferMarker('给你买杯奶茶\n[转账:5.20]\n喝了别熬夜');
    expect(r.amount).toBe(5.2);
    expect(r.clean).toBe('给你买杯奶茶\n喝了别熬夜');
  });
  it('accepts fullwidth brackets and integer amounts', () => {
    expect(extractTransferMarker('【转账：1314】').amount).toBe(1314);
  });
  it('caps at one transfer and ignores inline mentions', () => {
    expect(extractTransferMarker('[转账:5]\n[转账:10]').amount).toBe(5);
    const inline = extractTransferMarker('我才不会用[转账:100]这种方式');
    expect(inline.amount).toBeNull();
    expect(inline.clean).toBe('我才不会用[转账:100]这种方式');
  });
  it('rejects zero / malformed amounts', () => {
    expect(extractTransferMarker('[转账:0]').amount).toBeNull();
    expect(extractTransferMarker('[转账:abc]').amount).toBeNull();
  });
});

describe('encode / parse', () => {
  it('round-trips a transfer payload', () => {
    const t = { amount: 5.2, status: 'pending' as const };
    expect(parseTransfer(encodeTransfer(t))).toEqual(t);
  });
  it('rejects non-transfer content', () => {
    expect(parseTransfer('你好呀')).toBeNull();
    expect(parseTransfer('{"amount":-1,"status":"pending"}')).toBeNull();
    expect(parseTransfer('{"amount":5,"status":"x"}')).toBeNull();
  });
});

describe('transferModelText', () => {
  it('reads naturally from each side', () => {
    expect(transferModelText('user', { amount: 5.2, status: 'received' })).toContain('用户给你转账 ¥5.20');
    expect(transferModelText('assistant', { amount: 10, status: 'pending' })).toContain('待对方领取');
    expect(transferModelText('assistant', { amount: 10, status: 'received' })).toContain('对方已领取');
  });
});
