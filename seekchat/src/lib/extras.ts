import { extractMasterMarkers } from './master';
import { extractYandereMarkers } from './yandere';
import { extractMemoryMarkers } from './memory';
import { extractStickerMarkers } from './stickers';

export interface ExtraGates {
  master: boolean;
  yandere: boolean;
  stickers: boolean;
  memory: boolean;
}

/**
 * Re-route ops the model smuggled INSIDE the state tag (|主人:调教:+3 etc.)
 * back into their marker channels — but only ops that PROVABLY round-trip
 * through the target channel's extractor. A synthesized line the extractor
 * would reject (unknown subtype, non-numeric 忘记 index, `]` inside the
 * payload…) would otherwise leak verbatim into a visible bubble. Anything
 * that doesn't round-trip is dropped silently: tag content is a hidden
 * channel, so nothing from it may ever display.
 */
export function routeTagExtras(extras: string[], gates: ExtraGates): string[] {
  const out: string[] = [];
  for (const raw of extras) {
    const ex = raw.replace(/\s+/g, ' ').trim(); // envelope bodies may span lines
    const key = ex.slice(0, /[:：]/.exec(ex)?.index ?? ex.length).trim();
    const line = `[${ex}]`;
    let ok = false;
    if (key === '主人' && gates.master) {
      const r = extractMasterMarkers(line);
      ok =
        r.clean === '' &&
        (r.command !== null || r.countdown !== null || r.disciplineDelta !== null ||
          r.honorific !== null || r.newRule !== null || r.demand !== null);
    } else if (key === '病娇' && gates.yandere) {
      const r = extractYandereMarkers(line);
      ok = r.clean === '' && (r.vibrate || r.lock || r.hold || r.release || r.demand !== null);
    } else if ((key === '表情' || key === '表情包') && gates.stickers) {
      const r = extractStickerMarkers(line);
      ok = r.clean === '' && r.labels.length > 0;
    } else if (['记忆', '记住', '忘记', '记忆删'].includes(key) && gates.memory) {
      const r = extractMemoryMarkers(line);
      ok = r.clean === '' && (r.adds.length > 0 || r.removes.length > 0);
    }
    if (ok) out.push(line);
  }
  return out;
}
