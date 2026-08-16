import { renderPrompt } from './prompts';

export const LOCK_COOLDOWN_MS = 30 * 60000; // at most one biometric lock per 30 min

export const HOLD_TIMEOUT_MS = 90000; // in-app back-lock failsafe release

export interface YandereActions {
  clean: string;
  vibrate: boolean;
  lock: boolean;
  hold: boolean;
  release: boolean;
  demand: string | null; // she demands the user type this phrase to leave
}

const KIND = '(震动|锁屏|挽留|放行)';
// Tolerate half/full-width brackets and colons — Chinese models mix them.
// Own-line / own-segment ONLY, on purpose: an inline occurrence is often her
// TALKING ABOUT the action ("我才不会用[病娇:锁屏]"), and a false lock is as bad
// as a missed one. The prompt tells her to put the marker on its own line; if a
// lock still doesn't fire, it's the cooldown (surfaced in dev mode), not this.
const SINGLE_RE = new RegExp(`^[\\[【]病娇[:：]${KIND}[\\]】]$`); // a whole --- segment
const LINE_RE = new RegExp(`^[ \\t]*[\\[【]病娇[:：]${KIND}[\\]】][ \\t]*\\n?`, 'gm');
const DEMAND_RE = /[\[【]病娇[:：]索求[:：]([^\]】]*)[\]】]/g;

/**
 * Pure. Pulls `[病娇:...]` action markers out of a reply — whether they sit on
 * their own line OR occupy their own `---` message segment (the model does
 * both; the latter used to leak into a chat bubble and eat a message slot).
 */
export function extractYandereMarkers(text: string): YandereActions {
  const f = { vibrate: false, lock: false, hold: false, release: false };
  let demand: string | null = null;
  const set = (k: string) => {
    if (k === '震动') f.vibrate = true;
    else if (k === '锁屏') f.lock = true;
    else if (k === '挽留') f.hold = true;
    else f.release = true;
  };
  const withoutDemand = text.replace(DEMAND_RE, (_, p: string) => {
    const s = p.trim();
    if (s) demand = s;
    return '';
  });
  const kept = withoutDemand.split('---').filter((seg) => {
    const m = SINGLE_RE.exec(seg.trim());
    if (m) {
      set(m[1]);
      return false; // drop the whole segment; it was only a marker
    }
    return true;
  });
  const clean = kept
    .join('---')
    .replace(LINE_RE, (_, k: string) => {
      set(k);
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { clean, ...f, demand };
}

/** Pure. Prompt rules describing the (rare, in-character) yandere actions. */
export function buildYanderePromptSection(): string {
  return renderPrompt('yandere.section');
}
