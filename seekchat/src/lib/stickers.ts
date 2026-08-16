import { Alert } from 'react-native';
import { strFromU8, unzipSync } from 'fflate';
import { b64ToU8, u8ToB64 } from './base64';
import { renderPrompt } from './prompts';
import type { Sticker } from './types';

// Native deps (expo-document-picker, expo-file-system, ./db) are require()d
// lazily inside importStickerZip so this module's pure functions stay
// unit-testable without a native SQLite / picker runtime.

export interface StickerManifestEntry {
  file: string;
  label: string;
  desc: string;
}

const MAX_LABEL = 20;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB — GIFs run larger than static stickers
export const MAX_STICKERS_PER_REPLY = 2;

/** Pure. Accepts the stickers.json content; null when structurally invalid. */
export function parseManifest(json: string): StickerManifestEntry[] | null {
  try {
    const o = JSON.parse(json);
    if (!Array.isArray(o)) return null;
    const out: StickerManifestEntry[] = [];
    for (const e of o) {
      if (
        e &&
        typeof e.file === 'string' &&
        typeof e.label === 'string' &&
        typeof e.desc === 'string' &&
        e.label.trim().length > 0 &&
        e.label.trim().length <= MAX_LABEL
      ) {
        out.push({ file: e.file, label: e.label.trim(), desc: e.desc.trim() });
      }
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

// Tolerant on purpose: the model drifts into [表情包:X]、[发送了表情包:X]、【表情：X】
// (it mimics the transcript serialization of the user's own sticker sends), so
// every variant of the head must extract — but only on its own line/segment.
// Whitespace inside a marker is [ \t] only: \s would cross newlines and let a
// dangling "[表情：" swallow the next prose line as a bogus label. Openers pair
// with their own closer (【】 may appear inside a half-width marker's label),
// and line matches are end-anchored so no partial-line match can fire.
const STICKER_BODY =
  '(?:\\[[ \\t]*(?:发送了)?表情包?[ \\t]*[:：][ \\t]*([^\\]\\n]{1,40}?)[ \\t]*\\]' +
  '|【[ \\t]*(?:发送了)?表情包?[ \\t]*[:：][ \\t]*([^】\\n]{1,40}?)[ \\t]*】)';
const SINGLE_STICKER_RE = new RegExp(`^${STICKER_BODY}$`); // a whole --- segment
const LINE_STICKER_RE = new RegExp(`^[ \\t]*${STICKER_BODY}[ \\t]*$\\n?`, 'gm');

/** Pure. Pulls `[表情:标签]` markers (own line or own --- segment) out of a reply; capped. */
export function extractStickerMarkers(text: string): { clean: string; labels: string[] } {
  const labels: string[] = [];
  const push = (l: string) => {
    if (labels.length < MAX_STICKERS_PER_REPLY) labels.push(l.trim());
  };
  const kept = text.split('---').filter((seg) => {
    const m = SINGLE_STICKER_RE.exec(seg.trim());
    if (m) {
      push(m[1] ?? m[2]);
      return false;
    }
    return true;
  });
  const clean = kept
    .join('---')
    .replace(LINE_STICKER_RE, (_, hw: string, fw: string) => {
      push(hw ?? fw);
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { clean, labels };
}

/** Pure. Maps a marker's raw label onto an imported sticker, forgivingly. */
export function resolveSticker<T extends Pick<Sticker, 'label' | 'desc'>>(
  stickers: T[],
  raw: string,
): T | null {
  const q = raw.trim();
  if (!q) return null;
  const exact =
    stickers.find((s) => s.label === q) ??
    stickers.find((s) => s.label.toLowerCase() === q.toLowerCase());
  if (exact) return exact;
  // Containment picks the MOST SPECIFIC label (longest), not import order —
  // else [表情:开心的] resolves to a sticker labeled 心 instead of 开心.
  const overlapping = stickers.filter((s) => q.includes(s.label) || s.label.includes(q));
  if (overlapping.length > 0) {
    return overlapping.reduce((a, b) => (b.label.length > a.label.length ? b : a));
  }
  return (
    stickers.find((s) => s.desc.length >= 2 && (s.desc.includes(q) || q.includes(s.desc))) ?? null
  );
}

/** Pure. The prompt section listing available stickers. */
export function buildStickerPromptSection(stickers: Pick<Sticker, 'label' | 'desc'>[]): string {
  return renderPrompt('stickers.section', {
    example: stickers[0]?.label ?? '开心',
    max: MAX_STICKERS_PER_REPLY,
    list: stickers.map((s) => `- ${s.label}：${s.desc}`).join('\n'),
  });
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif',
};

/** Picks a zip (stickers.json + images), imports entries into the DB. */
export async function importStickerZip(): Promise<{ imported: number; skipped: number } | null> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const DocumentPicker = require('expo-document-picker') as typeof import('expo-document-picker');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { File } = require('expo-file-system') as typeof import('expo-file-system');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { insertSticker } = require('./db') as typeof import('./db');
  try {
    const res = await DocumentPicker.getDocumentAsync({
      type: 'application/zip',
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.[0]) return null;
    // Documented path for DocumentPicker cache files: the new File API's
    // async base64(). (The legacy reader can't open Expo Go's cache path on
    // some ROMs; .bytes() must be awaited — earlier attempts got both wrong.)
    console.log('[seekchat:stickers] reading', res.assets[0].uri);
    const b64 = await new File(res.assets[0].uri).base64();
    const files = unzipSync(b64ToU8(b64));
    const manifestName = Object.keys(files).find((n) => n.endsWith('stickers.json'));
    const manifest = manifestName ? parseManifest(strFromU8(files[manifestName])) : null;
    if (!manifest) {
      Alert.alert('导入失败', '压缩包中未找到有效的 stickers.json（[{file,label,desc}] 数组）。');
      return null;
    }
    const dir = manifestName!.slice(0, manifestName!.length - 'stickers.json'.length);
    let imported = 0;
    let skipped = 0;
    for (const entry of manifest) {
      const img = files[dir + entry.file] ?? files[entry.file];
      const ext = entry.file.split('.').pop()?.toLowerCase() ?? '';
      if (!img || !MIME[ext] || img.length > MAX_IMAGE_BYTES) {
        skipped++;
        continue;
      }
      insertSticker(entry.label, entry.desc, `data:${MIME[ext]};base64,${u8ToB64(img)}`);
      imported++;
    }
    console.log('[seekchat:stickers] imported', imported, 'skipped', skipped);
    return { imported, skipped };
  } catch (e) {
    console.log('[seekchat:stickers] import failed:', e);
    Alert.alert('导入失败', String(e));
    return null;
  }
}
