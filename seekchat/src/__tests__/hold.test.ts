import { holdDelay, TYPING_GRACE_MS } from '../lib/hold';

describe('holdDelay', () => {
  const now = 1_000_000;

  it('waits the base settle time after a send when the input box is empty', () => {
    expect(holdDelay({ baseMs: 4000, lastTypingAt: 0, now })).toBe(4000);
  });

  it('extends the wait while the user is mid-composition', () => {
    // typed 1s ago → keyboard silence completes in TYPING_GRACE_MS - 1000
    const d = holdDelay({ baseMs: 4000, lastTypingAt: now - 1000, now });
    expect(d).toBe(TYPING_GRACE_MS - 1000);
    expect(d).toBeGreaterThan(4000);
  });

  it('falls back to the base when the last keystroke is old', () => {
    expect(holdDelay({ baseMs: 4000, lastTypingAt: now - TYPING_GRACE_MS - 1, now })).toBe(4000);
  });

  it('never returns negative (used as the re-check at fire time)', () => {
    expect(holdDelay({ baseMs: 0, lastTypingAt: now - TYPING_GRACE_MS - 999, now })).toBe(0);
    expect(holdDelay({ baseMs: 0, lastTypingAt: 0, now })).toBe(0);
  });

  it('reports remaining typing wait at fire time (base 0)', () => {
    expect(holdDelay({ baseMs: 0, lastTypingAt: now - 2000, now })).toBe(TYPING_GRACE_MS - 2000);
  });
});
