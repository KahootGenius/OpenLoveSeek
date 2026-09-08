// v2.5 群红包. Shares are pre-split at SEND time (deterministic given rand),
// claims consume them in order; grouproles/groupflow decide WHO may claim.
export interface RedpacketClaim { charId: string; cents: number; at: number }
export interface Redpacket {
  total: number; count: number; note: string;
  shares: number[]; claims: RedpacketClaim[];
}

export const encodeRedpacket = (p: Redpacket): string => JSON.stringify(p);

export function parseRedpacket(content: string): Redpacket | null {
  try {
    const o = JSON.parse(content) as Redpacket;
    if (
      typeof o.total !== 'number' || o.total <= 0 ||
      typeof o.count !== 'number' || o.count <= 0 ||
      !Array.isArray(o.shares) || !Array.isArray(o.claims)
    ) return null;
    return {
      total: o.total, count: o.count,
      note: typeof o.note === 'string' ? o.note : '',
      shares: o.shares.filter((n): n is number => typeof n === 'number' && n > 0),
      claims: o.claims.filter(
        (c): c is RedpacketClaim =>
          !!c && typeof c.charId === 'string' && typeof c.cents === 'number' && typeof c.at === 'number',
      ),
    };
  } catch {
    return null;
  }
}

/** 二倍均值 split: uniform in (0, 2×mean], last takes the remainder; min 1 cent. */
export function splitRedpacket(
  total: number, count: number, rand: () => number = Math.random,
): number[] {
  const out: number[] = [];
  let remaining = total;
  for (let left = count; left > 1; left--) {
    const ceiling = Math.max(1, Math.floor(((remaining - (left - 1)) / left) * 2));
    const take = Math.max(1, Math.min(remaining - (left - 1), 1 + Math.floor(rand() * ceiling)));
    out.push(take);
    remaining -= take;
  }
  out.push(remaining);
  return out;
}

export function claimNextShare(
  p: Redpacket, charId: string, at: number,
): { packet: Redpacket; claim: RedpacketClaim } | null {
  if (p.claims.length >= p.count || p.claims.length >= p.shares.length) return null;
  if (p.claims.some((c) => c.charId === charId)) return null;
  const claim = { charId, cents: p.shares[p.claims.length], at };
  return { packet: { ...p, claims: [...p.claims, claim] }, claim };
}
