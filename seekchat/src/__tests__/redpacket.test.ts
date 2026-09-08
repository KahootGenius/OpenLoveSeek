import {
  claimNextShare, encodeRedpacket, parseRedpacket, splitRedpacket,
} from '../lib/redpacket';

describe('splitRedpacket', () => {
  it('sums to total, honors count, every share ≥ 1 cent', () => {
    for (const seed of [0, 0.3, 0.42, 0.77, 0.999]) {
      const shares = splitRedpacket(1000, 4, () => seed);
      expect(shares).toHaveLength(4);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(1000);
      expect(Math.min(...shares)).toBeGreaterThanOrEqual(1);
    }
    expect(splitRedpacket(4, 4, () => 0.9)).toEqual([1, 1, 1, 1]);
  });
});

describe('encode/parse/claim', () => {
  it('round-trips and claims sequentially without double-claim', () => {
    const p = { total: 500, count: 2, note: '请喝奶茶', shares: [200, 300], claims: [] };
    const parsed = parseRedpacket(encodeRedpacket(p))!;
    expect(parsed.note).toBe('请喝奶茶');
    const c1 = claimNextShare(parsed, 'ch1', 111)!;
    expect(c1.claim).toEqual({ charId: 'ch1', cents: 200, at: 111 });
    expect(claimNextShare(c1.packet, 'ch1', 222)).toBeNull(); // no double-claim
    const c2 = claimNextShare(c1.packet, 'ch2', 333)!;
    expect(c2.claim.cents).toBe(300);
    expect(claimNextShare(c2.packet, 'ch3', 444)).toBeNull(); // exhausted
    expect(parseRedpacket('not json')).toBeNull();
  });
});
