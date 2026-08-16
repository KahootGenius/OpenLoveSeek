/**
 * 转账 (virtual transfers): a WeChat-style money card between the user and the
 * character. All money is virtual — the user tops up their own balance freely
 * in Settings. The character has a per-conversation balance seeded from the
 * persona's initial balance. Pure logic here (marker, encode/parse, format,
 * the reminder); the balance movement lives in engine.ts / db.ts.
 */
import { renderPrompt } from './prompts';

export type TransferStatus = 'pending' | 'received';
export interface TransferData {
  amount: number;
  status: TransferStatus;
}

/** Above this, gently remind the user that love isn't a number. */
export const BIG_BALANCE = 10000;

/** The kind reminder — love as resonance, not an exchange of worth. */
export const LOVE_REMINDER =
  '想设多少都随你。\n只是想温柔地提醒一句：爱更像是一种共鸣，而不是价值的交换。' +
  '这串数字可以很大，却永远称量不出"被珍惜"这件事。愿你被爱，是因为你就是你——而不是因为某个数目。💛';

export function fmtMoney(n: number): string {
  return '¥' + (Math.round(n * 100) / 100).toFixed(2);
}

/** Round to cents, clamp to non-negative. */
export const cents = (n: number): number => Math.max(0, Math.round(n * 100) / 100);

// The character sends money by writing [转账:金额] on its own line. [ \t] (not
// \s) so it can't cross newlines; $\n? consumes the whole line, no blank left.
const MARK = /^[ \t]*[\[【]转账[:：][ \t]*([0-9]{1,7}(?:\.[0-9]{1,2})?)[ \t]*[\]】][ \t]*$\n?/gm;

/** Pure. Pull the FIRST [转账:金额] marker (own line) from her reply; capped at one. */
export function extractTransferMarker(text: string): { clean: string; amount: number | null } {
  let amount: number | null = null;
  const clean = text
    .replace(MARK, (_, a: string) => {
      const v = parseFloat(a);
      if (amount === null && !Number.isNaN(v) && v > 0) amount = cents(v);
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { clean, amount };
}

export const encodeTransfer = (t: TransferData): string => JSON.stringify(t);

export function parseTransfer(content: string): TransferData | null {
  try {
    const o = JSON.parse(content);
    if (
      o && typeof o.amount === 'number' && o.amount > 0 &&
      (o.status === 'pending' || o.status === 'received')
    ) {
      return { amount: o.amount, status: o.status };
    }
  } catch {
    // not a transfer payload
  }
  return null;
}

/** Readable form of a transfer message for the model window. */
export function transferModelText(role: 'user' | 'assistant', t: TransferData): string {
  return role === 'user'
    ? `[用户给你转账 ${fmtMoney(t.amount)}${t.status === 'received' ? '，你已收下' : ''}]`
    : `[你给用户转账 ${fmtMoney(t.amount)}${t.status === 'received' ? '，对方已领取' : '，待对方领取'}]`;
}

/** The prompt section telling her she has a wallet and may (rarely) transfer. */
export function buildTransferSection(balance: number): string {
  return renderPrompt('transfer.section', { balance: fmtMoney(balance) });
}
