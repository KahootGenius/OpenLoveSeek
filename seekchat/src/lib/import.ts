// 导入 (v2.3) — the inverse of export.ts. SAFETY LADDER: (1) validateBackup,
// (2) the CALLER writes an automatic safety export of current data first,
// (3) the destructive confirm happens in the UI before restoreBackup runs,
// (4) one transaction, column-intersection inserts so old backups restore
// into newer schemas (missing columns fall to SQLite defaults; the current
// user_version stays — migrate() has already shaped the tables).
import { db, setPref } from './db';

const TABLES: { table: string; key: string }[] = [
  { table: 'personas', key: 'personas' },
  { table: 'characters', key: 'characters' },
  { table: 'conversations', key: 'conversations' },
  { table: 'group_members', key: 'groupMembers' },
  { table: 'messages', key: 'messages' },
  { table: 'memories', key: 'memories' },
  { table: 'posts', key: 'posts' },
  { table: 'reactions', key: 'reactions' },
  { table: 'stickers', key: 'stickers' },
];

function tableColumns(table: string): Set<string> {
  return new Set(
    db.getAllSync<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name),
  );
}

/** Replaces ALL app data with the payload. Caller has confirmed (twice). */
export function restoreBackup(payload: Record<string, unknown>): void {
  db.withTransactionSync(() => {
    for (const { table, key } of TABLES) {
      db.runSync(`DELETE FROM ${table}`);
      const rows = (payload[key] as Record<string, unknown>[] | undefined) ?? [];
      if (!rows.length) continue;
      const cols = tableColumns(table);
      for (const row of rows) {
        const keys = Object.keys(row).filter((k) => cols.has(k));
        if (!keys.length) continue;
        db.runSync(
          `INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${keys
            .map(() => '?')
            .join(',')})`,
          keys.map((k) => row[k] as never),
        );
      }
    }
    db.runSync('DELETE FROM prefs');
    for (const row of (payload.prefs as { key: string; value: string }[] | undefined) ?? []) {
      if (row?.key) setPref(row.key, row.value ?? '');
    }
    const avatar = payload.userAvatar;
    if (typeof avatar === 'string' && avatar) setPref('userAvatar', avatar);
  });
}
