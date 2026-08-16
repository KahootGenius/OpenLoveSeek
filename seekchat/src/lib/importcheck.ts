// 导入 (v2.3): pure validation of an export payload. The restore itself lives
// in import.ts (db-bound); this file keeps the decision logic jest-testable.
export const IMPORT_MAX_VERSION = 4;
// memories/stickers are OPTIONAL: genuine v1.0/v1.1-era backups predate them.
const REQUIRED = ['personas', 'conversations', 'messages', 'prefs'] as const;
const OPTIONAL = [
  'characters', 'groupMembers', 'posts', 'reactions', 'memories', 'stickers',
] as const;

export type BackupCheck =
  | { ok: true; payload: Record<string, unknown>; counts: Record<string, number> }
  | { ok: false; reason: string };

export function validateBackup(json: string): BackupCheck {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: '不是有效的 JSON 文件' };
  }
  if (!o || typeof o !== 'object') return { ok: false, reason: '不是有效的备份文件' };
  const v = o.schemaVersion;
  if (typeof v !== 'number' || v < 1 || v > IMPORT_MAX_VERSION) {
    return { ok: false, reason: `不支持的备份版本（${String(v)}）` };
  }
  const badRows = (rows: unknown[]): boolean =>
    rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r));
  const counts: Record<string, number> = {};
  for (const key of REQUIRED) {
    if (!Array.isArray(o[key])) return { ok: false, reason: `缺少 ${key} 数据` };
    if (badRows(o[key] as unknown[])) return { ok: false, reason: `${key} 数据格式不正确` };
    counts[key] = (o[key] as unknown[]).length;
  }
  for (const key of OPTIONAL) {
    if (!Array.isArray(o[key])) continue;
    if (badRows(o[key] as unknown[])) return { ok: false, reason: `${key} 数据格式不正确` };
    counts[key] = (o[key] as unknown[]).length;
  }
  return { ok: true, payload: o, counts };
}
