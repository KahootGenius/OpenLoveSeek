// 照片 (v2.6): pure domain for character-initiated DM photos. Pro-generated
// frozen reference images give her a consistent appearance; a chat-time
// [照片:场景] marker only ever supplies the SCENE — the app composes the full
// prompt (appearance + scene + style) and calls Seedream Lite edit
// conditioned on the frozen refs. See fal.ts for the actual API calls.

export const REF_SLOT_COUNT = 3;

// Three distinct framings so the frozen ref set covers more than one angle.
const REF_FRAMINGS = ['正面肖像，看向镜头', '半身照，自然姿态', '侧面角度，生活感抓拍'];

export const composeRefPrompts = (appearance: string): string[] =>
  REF_FRAMINGS.map((f) => `${appearance.trim()}，${f}，高质量人像摄影，柔和自然光`);

export const composeScenePrompt = (appearance: string, scene: string): string =>
  `${appearance.trim()}。${scene.trim()}。手机随手拍质感，真实生活照`;

// 实拍 (v2.8): scene-ONLY variant — no appearance at all (she isn't in the
// shot; this photographs what she's looking at, not her). Same closing style
// clause as composeScenePrompt so both read as the same "candid phone photo"
// register.
export const composeSceneOnlyPrompt = (scene: string): string =>
  `${scene.trim()}。手机随手拍质感，真实生活照`;

// Per-conversation, per-day cap key (same 'YYYYMMDD' shape as usage.ts's API counter).
export const imageDayKey = (convoId: string, d: Date): string =>
  `img.${convoId}.${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

export const canGenerateToday = (usedToday: number, cap: number): boolean => usedToday < cap;

const GENERIC_PHOTO_PLACEHOLDER = '（发送了一张照片）';

/** Pure. An 'image' row's content is JSON ({status, scene, uri?, reason?}) —
 *  it must never leak raw into a model-facing surface (context window, quote
 *  snippet, rolling summary). Same idiom as the sticker/transfer placeholders
 *  below: render the scene when it parses, else the generic line. */
export function imagePlaceholder(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed?.scene === 'string' && parsed.scene) {
      return `（发送了一张照片：${parsed.scene}）`;
    }
  } catch {
    // corrupt row — generic placeholder rides
  }
  return GENERIC_PHOTO_PLACEHOLDER;
}

const PHOTO_FAILED_TEXT = '（照片没有发出去）';

/** Pure. The context-WINDOW counterpart to imagePlaceholder above: an
 *  'image' row fed back into the model's own transcript must use the SAME
 *  format she is taught to emit ([照片:场景]) — otherwise she reads her own
 *  narrated placeholder back and mimics THAT prose instead of the marker
 *  (transcript self-mimicry). Quote snippets and the rolling summary are
 *  user/prose-facing surfaces, not the model's own voice, and keep
 *  imagePlaceholder. A failed send never gets the marker (nothing to
 *  reference); corrupt rows fall back to the generic placeholder. */
export function imageModelText(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (parsed?.status === 'failed') return PHOTO_FAILED_TEXT;
    if (typeof parsed?.scene === 'string' && parsed.scene) {
      // shot is missing on legacy (pre-v2.8) rows — those default to the
      // selfie form, exactly what they always emitted.
      return parsed.shot === 'scene' ? `[照片:实拍|${parsed.scene}]` : `[照片:${parsed.scene}]`;
    }
  } catch {
    // corrupt row — generic placeholder rides
  }
  return GENERIC_PHOTO_PLACEHOLDER;
}

export const STALE_PENDING_REASON = '生成中断了，点重试再拍一次';

/** Pure. A row still 'pending' at app launch means generation never finished
 *  last session (killed mid-call) — it would otherwise sit as a permanent
 *  spinner. Flips it to 'failed' with a retry-able reason; anything else
 *  (already done/failed, or a corrupt row) rides unchanged. See
 *  listStalePendingImages (db.ts) for the query this feeds. */
export function failStalePending(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (parsed?.status === 'pending') {
      // Spread (not a field-by-field rebuild) so shot — or any future field —
      // rides through untouched; a legacy row with no shot key stays keyless.
      return JSON.stringify({ ...parsed, status: 'failed', reason: STALE_PENDING_REASON });
    }
  } catch {
    // corrupt row — leave it exactly as found
  }
  return content;
}

export type PhotoShot = 'selfie' | 'scene';

export interface ImageMarker { scene: string | null; shot: PhotoShot; clean: string }

const IMAGE_MARKER_RE = /\[[ \t]*照片[ \t]*[:：]([^\]]*)\]/g;

// 实拍 (v2.8): a payload discriminator on the SAME 照片 head (禁言's `a|b`
// precedent) — `实拍|场景` (fullwidth ｜ too) routes to a scene-only photo
// (no appearance, no refs); any other prefix (no pipe at all, or a pipe that
// isn't the 实拍 discriminator) leaves the whole payload as the scene and the
// shot defaults to 'selfie' — byte-identical to pre-v2.8 behavior for markers
// that never use the discriminator. Splitting on the FIRST delimiter only
// (not a full split) means a scene that happens to contain a stray `|`
// degrades safely — it rides whole rather than getting truncated.
function splitShot(raw: string): { scene: string; shot: PhotoShot } {
  const idx = raw.search(/[|｜]/);
  if (idx !== -1 && raw.slice(0, idx).trim() === '实拍') {
    return { scene: raw.slice(idx + 1).trim(), shot: 'scene' };
  }
  return { scene: raw, shot: 'selfie' };
}

/** Pure. Pulls the [照片:场景] / [照片:实拍|场景] marker (inline, any position —
 *  same convention as groupmarkers.ts); first one wins, extras strip silently.
 *  "First" means the first marker whose payload resolves to a non-empty
 *  scene — an empty payload (bare [照片:] or a 实拍| prefix with nothing
 *  after it) is treated exactly like "no marker" and doesn't block a later,
 *  well-formed marker from being picked up (same tolerance as before v2.8). */
export function extractImageMarker(text: string): ImageMarker {
  let scene: string | null = null;
  let shot: PhotoShot = 'selfie';
  const clean = text.replace(IMAGE_MARKER_RE, (_, p: string) => {
    if (scene !== null) return ''; // first (non-empty) wins; extras strip
    const raw = p.trim();
    if (!raw) return '';
    const split = splitShot(raw);
    if (split.scene) {
      scene = split.scene;
      shot = split.shot;
    }
    return '';
  }).trim();
  return { scene, shot, clean };
}
