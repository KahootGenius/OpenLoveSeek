import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { db } from './db';

export function buildExportPayload(): Record<string, unknown> {
  return {
    schemaVersion: 4,
    exportedAt: new Date().toISOString(),
    personas: db.getAllSync('SELECT * FROM personas'),
    characters: db.getAllSync('SELECT * FROM characters'),
    conversations: db.getAllSync('SELECT * FROM conversations'),
    groupMembers: db.getAllSync('SELECT * FROM group_members'),
    messages: db.getAllSync('SELECT * FROM messages'),
    memories: db.getAllSync('SELECT * FROM memories'),
    posts: db.getAllSync('SELECT * FROM posts'),
    reactions: db.getAllSync('SELECT * FROM reactions'),
    stickers: db.getAllSync('SELECT * FROM stickers'),
    prefs: db.getAllSync("SELECT * FROM prefs WHERE key != 'userAvatar'"),
    userAvatar: db.getFirstSync<{ value: string }>(
      "SELECT value FROM prefs WHERE key = 'userAvatar'",
    )?.value ?? null,
  };
}

/** Writes a backup file WITHOUT the share sheet; returns its uri.
 *  (导入 uses this as the automatic safety net before overwriting.) */
export function writeBackupFile(suffix = ''): string {
  const date = new Date().toISOString().slice(0, 10);
  const file = new File(Paths.document, `seekchat-export-${date}${suffix}.json`);
  file.write(JSON.stringify(buildExportPayload(), null, 2));
  return file.uri;
}

export async function exportAll(): Promise<void> {
  await Sharing.shareAsync(writeBackupFile(), { mimeType: 'application/json' });
}
