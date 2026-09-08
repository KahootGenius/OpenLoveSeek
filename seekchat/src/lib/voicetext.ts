// v2.7 语音: pure domain for turning her stored DM text into what MiniMax
// should actually speak. Nothing here touches the network or expo-audio —
// see minimax.ts for the API client and voice.ts for the playback service.
import { stripEchoedTimestamps } from './statetag';

export interface SpeechPrepOpts { readParens: boolean }

// Same head:value bracket shape as repair.ts's WELL_FORMED lint pattern —
// [头:内容] / 【头:内容】 hidden-channel markers (表情/照片/转账/状态/…) that must
// never be spoken. This isn't gated per-feature the way engine.ts's own
// extractors are: an untaught marker rides the stored content literally (see
// imagegen.ts's doc comment on that), and a pre-v2.7 row may carry one too —
// voice has to scrub defensively regardless of which features were on when
// the row was written.
const COMPLETE_MARKER_RE =
  /\[[^[\]\n]{1,40}[:：][^[\]\n]{0,80}\]|【[^【】\n]{1,40}[:：][^【】\n]{0,80}】/g;

// A burst cut mid-marker (cutter.ts splits a long reply into several rows)
// can leave a half-written head with no closer at the very end of a row —
// e.g. "[照片:半截". COMPLETE_MARKER_RE never matches that (no closing
// bracket), so it needs its own end-anchored pass. Requires a colon, same
// "unmistakable intent" bar as the complete form — a bare stray "[" in
// prose is left alone.
const DANGLING_MARKER_RE = /[[【][^[\]【】\n]*[:：][^[\]【】\n]*\s*$/;

// （…）is this app's stage-direction convention (see repair.ts's
// PHOTO_NARRATION_RE comment); models emit the half-width form too even
// though it's not the taught convention, so both get the same treatment —
// consistent handling beats a surprise leak either way.
const FULLWIDTH_PARENS_RE = /（([^（）]*)）/g;
const HALFWIDTH_PARENS_RE = /\(([^()]*)\)/g;

// Mirrors markdown.tsx's INLINE precedent (code, then bold, then italic —
// same precedence order, so "**bold**" is consumed whole before the italic
// pattern can see a lone leftover "*"). Speech keeps the emphasized words,
// not the delimiter characters.
function stripMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+?)\*\*/g, '$1')
    .replace(/\*([^*\s][^*]*?)\*/g, '$1');
}

// No existing emoji-handling precedent in this repo (grepped for "emoji" and
// common pictographic-range names — none found), so this is deliberately
// conservative rather than exhaustive: the surrogate-pair range covers the
// modern pictograph/emoticon/transport/symbol blocks (U+1F300–U+1FBFF,
// roughly) that make up the vast majority of emoji in the wild, plus the
// BMP dingbat/misc-symbol/misc-technical blocks (☀✅❤⏰ etc., U+2600–U+27BF /
// U+2B00–U+2BFF / U+2300–U+23FF) and the joiner/variation-selector
// characters (U+200D, U+FE0F) that ride along with them.
const EMOJI_RE =
  /[\uD83C-\uD83E][\uDC00-\uDFFF]|[☀-➿⬀-⯿⌀-⏿‍️]/g;

/** Pure. What her message sounds like: strips residual markers/heads,
 *  markdown, emoji, leaked timestamps; （…）stage directions obey the
 *  readParens toggle (segment dropped when off, inner text kept when on). */
export function prepareSpeechText(text: string, opts: SpeechPrepOpts): string {
  let out = stripEchoedTimestamps(text);
  out = out.replace(COMPLETE_MARKER_RE, '');
  out = out.replace(DANGLING_MARKER_RE, '');
  out = opts.readParens
    ? out.replace(FULLWIDTH_PARENS_RE, '$1').replace(HALFWIDTH_PARENS_RE, '$1')
    : out.replace(FULLWIDTH_PARENS_RE, '').replace(HALFWIDTH_PARENS_RE, '');
  out = stripMarkdown(out);
  out = out.replace(EMOJI_RE, '');
  return out.replace(/\s+/g, ' ').trim();
}

// moodLabel has no fixed vocabulary in this app (statetag.ts's 心情 field is
// whatever free-form word the model writes; life.ts/pro.ts only hardcode the
// '平静' baseline default) — map what cleanly corresponds to MiniMax's
// emotion enum, everything else omits the param (see minimax.ts's
// buildT2AInput, which only sets voice_setting.emotion when defined).
const MOOD_TO_EMOTION: Record<string, string> = {
  开心: 'happy', 高兴: 'happy',
  难过: 'sad', 伤心: 'sad',
  生气: 'angry', 愤怒: 'angry',
  平静: 'calm',
  惊讶: 'surprised',
  害怕: 'fearful',
  厌恶: 'disgusted',
};

export function moodToEmotion(moodLabel: string | null): string | undefined {
  if (!moodLabel) return undefined;
  return MOOD_TO_EMOTION[moodLabel.trim()];
}

// GLOBAL day counter — unlike imagegen.ts's per-conversation imageDayKey,
// MiniMax spend is billed once against the whole account's key, not per
// conversation, so there is no conversationId segment here.
export const voiceDayKey = (d: Date): string =>
  `voice.chars.${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

export const canSpeakToday = (usedChars: number, addChars: number, cap: number): boolean =>
  usedChars + addChars <= cap;
