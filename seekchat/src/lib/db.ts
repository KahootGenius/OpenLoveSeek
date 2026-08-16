import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import type {
  Character, Conversation, MemoryEntry, Message, MessageKind, MessageStatus, Persona, Post,
  Reaction, Role, Sticker,
} from './types';
import { NEW_CHAT_TITLE, SEED_PERSONA } from './constants';
import { bindPromptStore } from './prompts';
import { bindApiCounter } from './deepseek';
import { isDeletableMessageKind } from './message-deletion';

export const db = SQLite.openDatabaseSync('seekchat.db');
const uuid = () => Crypto.randomUUID();
const now = () => Date.now();

export function migrate(): void {
  const before = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  console.log('[seekchat:db] user_version before migrate:', before?.user_version);
  let v = before?.user_version ?? 0;
  if (v < 1) {
    // Idempotent on purpose: a previously interrupted run leaves user_version
    // at 0 with some tables already present.
    db.execSync(`
      CREATE TABLE IF NOT EXISTS personas (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, systemPrompt TEXT NOT NULL,
        summaryPrompt TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, title TEXT NOT NULL,
        personaId TEXT NOT NULL REFERENCES personas(id),
        summary TEXT, summaryUpToId TEXT,
        createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversationId TEXT NOT NULL REFERENCES conversations(id),
        role TEXT NOT NULL CHECK (role IN ('user','assistant')),
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete','interrupted')),
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversationId, createdAt);
      CREATE TABLE IF NOT EXISTS prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA user_version = 1;
    `);
    const count = db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM personas');
    if ((count?.n ?? 0) === 0) {
      const t = now();
      db.runSync(
        'INSERT INTO personas (id, name, systemPrompt, summaryPrompt, createdAt, updatedAt) VALUES (?,?,?,NULL,?,?)',
        [uuid(), SEED_PERSONA.name, SEED_PERSONA.systemPrompt, t, t],
      );
    }
    v = 1;
  }
  if (v < 2) {
    try {
      db.execSync('ALTER TABLE personas ADD COLUMN avatarUri TEXT');
    } catch {
      // column already exists from an interrupted earlier run
    }
    db.execSync('PRAGMA user_version = 2');
    v = 2;
  }
  if (v < 3) {
    const alters = [
      'ALTER TABLE personas ADD COLUMN proConfig TEXT',
      'ALTER TABLE conversations ADD COLUMN lifeEnabled INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE conversations ADD COLUMN moodLabel TEXT',
      'ALTER TABLE conversations ADD COLUMN moodIntensity REAL',
      'ALTER TABLE conversations ADD COLUMN moodUpdatedAt INTEGER',
      'ALTER TABLE conversations ADD COLUMN currentThought TEXT',
      "ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'normal'",
    ];
    for (const a of alters) {
      try {
        db.execSync(a);
      } catch {
        // column already exists from an interrupted earlier run
      }
    }
    db.execSync('PRAGMA user_version = 3');
    v = 3;
  }
  if (v < 4) {
    try {
      db.execSync('ALTER TABLE conversations ADD COLUMN curveDrift TEXT');
    } catch {
      // column already exists from an interrupted earlier run
    }
    db.execSync('PRAGMA user_version = 4');
    v = 4;
  }
  if (v < 5) {
    try {
      db.execSync('ALTER TABLE messages ADD COLUMN reasoning TEXT');
    } catch {
      // column already exists from an interrupted earlier run
    }
    db.execSync(`
      CREATE TABLE IF NOT EXISTS stickers (
        id TEXT PRIMARY KEY, label TEXT NOT NULL, desc TEXT NOT NULL,
        image TEXT NOT NULL, createdAt INTEGER NOT NULL
      );
    `);
    db.execSync('PRAGMA user_version = 5');
    v = 5;
  }
  if (v < 6) {
    try {
      db.execSync('ALTER TABLE conversations ADD COLUMN discipline INTEGER');
    } catch {
      // column already exists from an interrupted earlier run
    }
    db.execSync('PRAGMA user_version = 6');
    v = 6;
  }
  if (v < 7) {
    // Character-authored (read-only to the user) 主人 terms, per conversation.
    for (const a of [
      'ALTER TABLE conversations ADD COLUMN masterHonorific TEXT',
      'ALTER TABLE conversations ADD COLUMN masterRules TEXT',
    ]) {
      try {
        db.execSync(a);
      } catch {
        // column already exists from an interrupted earlier run
      }
    }
    db.execSync('PRAGMA user_version = 7');
    v = 7;
  }
  if (v < 8) {
    // 记忆库: model-curated durable memory, injected into every request.
    try {
      db.execSync('ALTER TABLE conversations ADD COLUMN memoryEnabled INTEGER NOT NULL DEFAULT 1');
    } catch {
      // column already exists from an interrupted earlier run
    }
    db.execSync(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        conversationId TEXT NOT NULL REFERENCES conversations(id),
        text TEXT NOT NULL, createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memories_conv ON memories(conversationId, createdAt);
      PRAGMA user_version = 8;
    `);
    v = 8;
  }
  if (v < 9) {
    // 引用: the message a message replies to.
    try {
      db.execSync('ALTER TABLE messages ADD COLUMN quotedId TEXT');
    } catch {
      // column already exists from an interrupted earlier run
    }
    db.execSync('PRAGMA user_version = 9');
    v = 9;
  }
  if (v < 10) {
    // 转账: the character's per-conversation wallet (null = seed from persona).
    try {
      db.execSync('ALTER TABLE conversations ADD COLUMN charBalance REAL');
    } catch {
      // column already exists from an interrupted earlier run
    }
    db.execSync('PRAGMA user_version = 10');
    v = 10;
  }
  if (v < 11) {
    // v2.0 character registry: a persona upgraded to a community entity.
    // A POINTER, not a home — all state stays on the home conversation.
    db.execSync(`
      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY NOT NULL,
        personaId TEXT NOT NULL UNIQUE REFERENCES personas(id),
        homeConvoId TEXT NOT NULL REFERENCES conversations(id),
        soulSync INTEGER NOT NULL DEFAULT 1,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
    `);
    // Auto-register every persona with exactly one chat (its obvious home).
    // Ambiguous personas (0 or 2+ chats) register lazily via ensureCharacter.
    const singles = db.getAllSync<{ personaId: string; convoId: string }>(
      `SELECT p.id AS personaId,
              (SELECT c.id FROM conversations c WHERE c.personaId = p.id) AS convoId
       FROM personas p
       WHERE (SELECT COUNT(*) FROM conversations c WHERE c.personaId = p.id) = 1
         AND p.id NOT IN (SELECT personaId FROM characters)`,
    );
    for (const r of singles) {
      const t = now();
      db.runSync(
        'INSERT INTO characters (id, personaId, homeConvoId, soulSync, createdAt, updatedAt) VALUES (?,?,?,1,?,?)',
        [uuid(), r.personaId, r.convoId, t, t],
      );
    }
    db.execSync('PRAGMA user_version = 11');
    v = 11;
  }
  if (v < 12) {
    // v2.1 朋友圈: posts + character reactions (staggered reveal via revealAt).
    db.execSync(`
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY NOT NULL,
        authorType TEXT NOT NULL DEFAULT 'user',
        authorId TEXT,
        text TEXT NOT NULL,
        images TEXT NOT NULL DEFAULT '[]',
        postType TEXT NOT NULL DEFAULT 'moment',
        visibility TEXT NOT NULL DEFAULT 'all',
        chatReadable INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reactions (
        id TEXT PRIMARY KEY NOT NULL,
        postId TEXT NOT NULL REFERENCES posts(id),
        characterId TEXT NOT NULL REFERENCES characters(id),
        type TEXT NOT NULL,
        content TEXT,
        revealAt INTEGER NOT NULL,
        notifId TEXT,
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reactions_post ON reactions(postId, createdAt);
      PRAGMA user_version = 12;
    `);
    v = 12;
  }
  if (v < 13) {
    // v2.2 group chat: groups are conversations with kind='group',
    // personaId='' (sentinel — FK unenforced), members in group_members.
    try {
      db.execSync("ALTER TABLE conversations ADD COLUMN kind TEXT NOT NULL DEFAULT 'dm'");
    } catch {
      // column already exists from an interrupted earlier run
    }
    try {
      db.execSync('ALTER TABLE conversations ADD COLUMN groupConfig TEXT');
    } catch {
      // column already exists from an interrupted earlier run
    }
    try {
      db.execSync('ALTER TABLE messages ADD COLUMN speakerId TEXT');
    } catch {
      // column already exists from an interrupted earlier run
    }
    db.execSync(`
      CREATE TABLE IF NOT EXISTS group_members (
        conversationId TEXT NOT NULL REFERENCES conversations(id),
        characterId TEXT NOT NULL REFERENCES characters(id),
        PRIMARY KEY (conversationId, characterId)
      );
    `);
    db.execSync('PRAGMA user_version = 13');
    v = 13;
  }
  if (v < 14) {
    // v2.3 角色朋友圈: user likes/comments on character posts share the
    // reactions table; characterId is '' for user rows (FKs unenforced).
    try {
      db.execSync(
        "ALTER TABLE reactions ADD COLUMN authorType TEXT NOT NULL DEFAULT 'character'",
      );
    } catch {
      // column already exists from an interrupted earlier run
    }
    db.execSync('PRAGMA user_version = 14');
    v = 14;
  }
  const tables = db.getAllSync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  console.log('[seekchat:db] tables:', tables.map((t) => t.name).join(', '));
}

// ---- personas ----
export const listPersonas = (): Persona[] =>
  db.getAllSync<Persona>('SELECT * FROM personas ORDER BY updatedAt DESC');

export const getPersona = (id: string): Persona | null =>
  db.getFirstSync<Persona>('SELECT * FROM personas WHERE id = ?', [id]) ?? null;

export function createPersona(
  name: string,
  systemPrompt: string,
  summaryPrompt: string | null,
  avatarUri: string | null,
  proConfig: string | null,
): Persona {
  const t = now();
  const p: Persona = {
    id: uuid(), name, systemPrompt, summaryPrompt, avatarUri, proConfig, createdAt: t, updatedAt: t,
  };
  db.runSync(
    'INSERT INTO personas (id, name, systemPrompt, summaryPrompt, avatarUri, proConfig, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
    [p.id, p.name, p.systemPrompt, p.summaryPrompt, p.avatarUri, p.proConfig, p.createdAt, p.updatedAt],
  );
  return p;
}

export function updatePersona(
  id: string,
  name: string,
  systemPrompt: string,
  summaryPrompt: string | null,
  avatarUri: string | null,
  proConfig: string | null,
): void {
  db.runSync(
    'UPDATE personas SET name=?, systemPrompt=?, summaryPrompt=?, avatarUri=?, proConfig=?, updatedAt=? WHERE id=?',
    [name, systemPrompt, summaryPrompt, avatarUri, proConfig, now(), id],
  );
}

export function personaInUse(id: string): boolean {
  const r = db.getFirstSync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM conversations WHERE personaId = ?',
    [id],
  );
  return (r?.n ?? 0) > 0;
}

export function deletePersona(id: string): void {
  if (personaInUse(id)) throw new Error('persona-in-use');
  db.runSync('DELETE FROM characters WHERE personaId = ?', [id]);
  db.runSync('DELETE FROM personas WHERE id = ?', [id]);
}

// ---- characters (v2.0 registry — see spec §4) ----
export const getCharacterByPersona = (personaId: string): Character | null =>
  db.getFirstSync<Character>('SELECT * FROM characters WHERE personaId = ?', [personaId]) ?? null;

export const listCharacters = (): Character[] =>
  db.getAllSync<Character>('SELECT * FROM characters ORDER BY createdAt ASC');

/** Registry rows are created lazily. Returns null when the persona has 0 or 2+
 *  chats — that ambiguity is resolved by a picker UI in v2.1, never guessed. */
export function ensureCharacter(personaId: string): Character | null {
  const existing = getCharacterByPersona(personaId);
  if (existing) return existing;
  const convos = db.getAllSync<{ id: string }>(
    'SELECT id FROM conversations WHERE personaId = ?',
    [personaId],
  );
  if (convos.length !== 1) return null;
  const t = now();
  const ch: Character = {
    id: uuid(), personaId, homeConvoId: convos[0].id, soulSync: 1, createdAt: t, updatedAt: t,
  };
  db.runSync(
    'INSERT INTO characters (id, personaId, homeConvoId, soulSync, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
    [ch.id, ch.personaId, ch.homeConvoId, ch.soulSync, ch.createdAt, ch.updatedAt],
  );
  return ch;
}

export const setSoulSync = (characterId: string, on: boolean): void =>
  void db.runSync('UPDATE characters SET soulSync = ?, updatedAt = ? WHERE id = ?', [
    on ? 1 : 0, now(), characterId,
  ]);

/** Home-chat picker path: register a character with an explicit home chat. */
export function createCharacterWithHome(personaId: string, homeConvoId: string): Character {
  const existing = getCharacterByPersona(personaId);
  if (existing) return existing;
  const t = now();
  const ch: Character = {
    id: uuid(), personaId, homeConvoId, soulSync: 1, createdAt: t, updatedAt: t,
  };
  db.runSync(
    'INSERT INTO characters (id, personaId, homeConvoId, soulSync, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
    [ch.id, ch.personaId, ch.homeConvoId, ch.soulSync, ch.createdAt, ch.updatedAt],
  );
  return ch;
}

// ---- posts + reactions (v2.1 朋友圈 — see spec §7) ----
export function insertPost(
  text: string, images: string, postType: string, visibility: string, chatReadable: boolean,
): Post {
  const p: Post = {
    id: uuid(), authorType: 'user', authorId: null, text, images,
    postType: postType as Post['postType'], visibility,
    chatReadable: chatReadable ? 1 : 0, createdAt: now(),
  };
  db.runSync(
    'INSERT INTO posts (id, authorType, authorId, text, images, postType, visibility, chatReadable, createdAt) VALUES (?,?,?,?,?,?,?,?,?)',
    [p.id, p.authorType, p.authorId, p.text, p.images, p.postType, p.visibility, p.chatReadable, p.createdAt],
  );
  return p;
}

export const listPosts = (): Post[] =>
  db.getAllSync<Post>('SELECT * FROM posts ORDER BY createdAt DESC');

export const getPost = (id: string): Post | null =>
  db.getFirstSync<Post>('SELECT * FROM posts WHERE id = ?', [id]) ?? null;

export function deletePost(id: string): void {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM reactions WHERE postId = ?', [id]);
    db.runSync('DELETE FROM posts WHERE id = ?', [id]);
  });
}

export function insertReaction(
  postId: string, characterId: string, type: 'like' | 'comment',
  content: string | null, revealAt: number,
): Reaction {
  const r: Reaction = {
    id: uuid(), postId, characterId, authorType: 'character', type, content, revealAt,
    notifId: null, createdAt: now(),
  };
  db.runSync(
    "INSERT INTO reactions (id, postId, characterId, type, content, revealAt, notifId, authorType, createdAt) VALUES (?,?,?,?,?,?,?,'character',?)",
    [r.id, r.postId, r.characterId, r.type, r.content, r.revealAt, r.notifId, r.createdAt],
  );
  return r;
}

/** 角色朋友圈 (v2.3): a post SHE wrote. */
export function insertCharPost(authorId: string, text: string): Post {
  const p: Post = {
    id: uuid(), authorType: 'character', authorId, text, images: '[]',
    postType: 'moment', visibility: 'all', chatReadable: 0, createdAt: now(),
  };
  db.runSync(
    'INSERT INTO posts (id, authorType, authorId, text, images, postType, visibility, chatReadable, createdAt) VALUES (?,?,?,?,?,?,?,?,?)',
    [p.id, p.authorType, p.authorId, p.text, p.images, p.postType, p.visibility, p.chatReadable, p.createdAt],
  );
  return p;
}

/** The user's like/comment on a character's post — visible immediately. */
export function insertUserReaction(
  postId: string, type: 'like' | 'comment', content: string | null,
): Reaction {
  const r: Reaction = {
    id: uuid(), postId, characterId: '', authorType: 'user', type, content,
    revealAt: now(), notifId: null, createdAt: now(),
  };
  db.runSync(
    "INSERT INTO reactions (id, postId, characterId, type, content, revealAt, notifId, authorType, createdAt) VALUES (?,?,?,?,?,?,?,'user',?)",
    [r.id, r.postId, r.characterId, r.type, r.content, r.revealAt, r.notifId, r.createdAt],
  );
  return r;
}

/** Returns affected rows: 0 ⇒ the reaction was deleted while the OS
 *  notification-schedule call was in flight (caller cancels the ghost). */
export const setReactionNotif = (id: string, notifId: string): number =>
  db.runSync('UPDATE reactions SET notifId = ? WHERE id = ?', [notifId, id]).changes;

export const listReactions = (postId: string): Reaction[] =>
  db.getAllSync<Reaction>(
    'SELECT * FROM reactions WHERE postId = ? ORDER BY createdAt ASC', [postId],
  );

/** Diary posts she may bring up in chat (聊天内可读), newest first. */
export const listChatReadablePosts = (): Post[] =>
  db.getAllSync<Post>(
    "SELECT * FROM posts WHERE postType = 'diary' AND chatReadable = 1 ORDER BY createdAt DESC",
  );

// ---- conversations ----
export interface ConversationListItem extends Conversation {
  personaName: string;
  personaAvatar: string | null;
  lastSnippet: string | null;
}

export const listConversations = (): ConversationListItem[] =>
  db.getAllSync<ConversationListItem>(`
    SELECT c.*, COALESCE(p.name, c.title) AS personaName, p.avatarUri AS personaAvatar,
      (SELECT content FROM messages m WHERE m.conversationId = c.id
       AND m.kind = 'normal'
       ORDER BY m.createdAt DESC LIMIT 1) AS lastSnippet
    FROM conversations c LEFT JOIN personas p ON p.id = c.personaId
    ORDER BY c.updatedAt DESC
  `);

export function createConversation(personaId: string): Conversation {
  const t = now();
  const personaName = getPersona(personaId)?.name ?? NEW_CHAT_TITLE;
  const c: Conversation = {
    id: uuid(), title: personaName, personaId,
    summary: null, summaryUpToId: null,
    lifeEnabled: 0, memoryEnabled: 1, moodLabel: null, moodIntensity: null,
    moodUpdatedAt: null, currentThought: null, curveDrift: null, discipline: null,
    masterHonorific: null, masterRules: null, charBalance: null,
    kind: 'dm', groupConfig: null,
    createdAt: t, updatedAt: t,
  };
  db.runSync(
    'INSERT INTO conversations (id, title, personaId, summary, summaryUpToId, createdAt, updatedAt) VALUES (?,?,?,NULL,NULL,?,?)',
    [c.id, c.title, c.personaId, c.createdAt, c.updatedAt],
  );
  return c;
}

/** 开启新篇章 (v2.3, field report): a long-lived chat teaches the model its
 *  own verbal tics — the transcript IS the disease. Carry everything that
 *  matters (summary, 记忆库, mood, discipline, 主人 rules, wallet, switches)
 *  into a FRESH conversation; the tic-laden history stays behind as an
 *  archive. Her soul-home pointer moves to the new chapter. */
const CARRY_TAIL_ROWS = 12;

export function carryOverConversation(oldId: string): Conversation | null {
  const old = getConversation(oldId);
  if (!old || old.kind !== 'dm') return null;
  const personaName = getPersona(old.personaId)?.name ?? NEW_CHAT_TITLE;
  const t = now();
  const c: Conversation = {
    id: uuid(), title: personaName, personaId: old.personaId,
    summary: old.summary, summaryUpToId: null,
    lifeEnabled: old.lifeEnabled, memoryEnabled: old.memoryEnabled,
    moodLabel: old.moodLabel, moodIntensity: old.moodIntensity,
    moodUpdatedAt: old.moodUpdatedAt, currentThought: old.currentThought,
    curveDrift: old.curveDrift, discipline: old.discipline,
    masterHonorific: old.masterHonorific, masterRules: old.masterRules,
    charBalance: old.charBalance, kind: 'dm', groupConfig: null,
    createdAt: t, updatedAt: t,
  };
  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO conversations (id, title, personaId, summary, summaryUpToId,
        lifeEnabled, memoryEnabled, moodLabel, moodIntensity, moodUpdatedAt,
        currentThought, curveDrift, discipline, masterHonorific, masterRules,
        charBalance, kind, createdAt, updatedAt)
       VALUES (?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,'dm',?,?)`,
      [
        c.id, c.title, c.personaId, c.summary, c.lifeEnabled, c.memoryEnabled,
        c.moodLabel, c.moodIntensity, c.moodUpdatedAt, c.currentThought,
        c.curveDrift, c.discipline, c.masterHonorific, c.masterRules,
        c.charBalance, c.createdAt, c.updatedAt,
      ],
    );
    for (const m of listMemories(oldId)) {
      db.runSync(
        'INSERT INTO memories (id, conversationId, text, createdAt) VALUES (?,?,?,?)',
        [uuid(), c.id, m.text, m.createdAt],
      );
    }
    // The last few exchanges set the live context — carry them so the new
    // chapter opens mid-conversation, not cold. Rows, not replies: 消息切割
    // splits one reply into several rows, so 12 rows ≈ the last few exchanges.
    const tail = db
      .getAllSync<Message>(
        `SELECT * FROM messages WHERE conversationId = ?
           AND kind NOT IN ('meta','experience') AND status = 'complete'
         ORDER BY createdAt DESC, id DESC LIMIT ?`,
        [oldId, CARRY_TAIL_ROWS],
      )
      .reverse();
    for (const m of tail) {
      // quotedId dropped: it points at a message left behind in the archive.
      db.runSync(
        'INSERT INTO messages (id, conversationId, role, content, status, kind, reasoning, quotedId, speakerId, createdAt) VALUES (?,?,?,?,?,?,?,NULL,NULL,?)',
        [uuid(), c.id, m.role, m.content, 'complete', m.kind, m.reasoning, m.createdAt],
      );
    }
    // Her soul-home moves to the new chapter; group memberships follow the
    // character row automatically.
    db.runSync('UPDATE characters SET homeConvoId = ?, updatedAt = ? WHERE homeConvoId = ?', [
      c.id, t, oldId,
    ]);
    db.runSync('UPDATE conversations SET title = ? WHERE id = ?', [
      `${old.title} · 旧篇章`, oldId,
    ]);
    db.runSync(
      'INSERT INTO messages (id, conversationId, role, content, status, kind, reasoning, quotedId, speakerId, createdAt) VALUES (?,?,?,?,?,?,NULL,NULL,NULL,?)',
      [
        uuid(), c.id, 'assistant',
        '〔新篇章〕我们把过去收进了回忆里——总结、记忆和刚才的话都带着，从这里继续。',
        'complete', 'experience', t,
      ],
    );
  });
  return c;
}

// ---- groups (v2.2 — see spec §8) ----
export function createGroupConversation(title: string, characterIds: string[]): Conversation {
  const t = now();
  const c: Conversation = {
    id: uuid(), title, personaId: '', // sentinel — groups have no single persona
    summary: null, summaryUpToId: null,
    lifeEnabled: 0, memoryEnabled: 0, moodLabel: null, moodIntensity: null,
    moodUpdatedAt: null, currentThought: null, curveDrift: null, discipline: null,
    masterHonorific: null, masterRules: null, charBalance: null,
    kind: 'group', groupConfig: null,
    createdAt: t, updatedAt: t,
  };
  db.withTransactionSync(() => {
    db.runSync(
      "INSERT INTO conversations (id, title, personaId, summary, summaryUpToId, kind, createdAt, updatedAt) VALUES (?,?,?,NULL,NULL,'group',?,?)",
      [c.id, c.title, c.personaId, c.createdAt, c.updatedAt],
    );
    for (const chId of characterIds) {
      db.runSync(
        'INSERT OR IGNORE INTO group_members (conversationId, characterId) VALUES (?,?)',
        [c.id, chId],
      );
    }
  });
  return c;
}

export const listGroupMembers = (conversationId: string): Character[] =>
  db.getAllSync<Character>(
    `SELECT ch.* FROM group_members gm JOIN characters ch ON ch.id = gm.characterId
     WHERE gm.conversationId = ? ORDER BY ch.createdAt ASC`,
    [conversationId],
  );

export const addGroupMember = (conversationId: string, characterId: string): void =>
  void db.runSync(
    'INSERT OR IGNORE INTO group_members (conversationId, characterId) VALUES (?,?)',
    [conversationId, characterId],
  );

export const removeGroupMember = (conversationId: string, characterId: string): void =>
  void db.runSync(
    'DELETE FROM group_members WHERE conversationId = ? AND characterId = ?',
    [conversationId, characterId],
  );

export const setGroupConfig = (id: string, json: string): void =>
  void db.runSync('UPDATE conversations SET groupConfig = ? WHERE id = ?', [json, id]);

export const getConversation = (id: string): Conversation | null =>
  db.getFirstSync<Conversation>('SELECT * FROM conversations WHERE id = ?', [id]) ?? null;

export const renameConversation = (id: string, title: string): void =>
  void db.runSync('UPDATE conversations SET title=?, updatedAt=? WHERE id=?', [title, now(), id]);

export function deleteConversation(id: string): void {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM messages WHERE conversationId = ?', [id]);
    db.runSync('DELETE FROM memories WHERE conversationId = ?', [id]);
    // A deleted home chat un-registers the character; it re-registers lazily
    // against a remaining chat (v2.0 registry). Her group seats go too —
    // BEFORE the characters delete, while the subquery can still see her.
    db.runSync(
      'DELETE FROM group_members WHERE characterId IN (SELECT id FROM characters WHERE homeConvoId = ?)',
      [id],
    );
    db.runSync('DELETE FROM characters WHERE homeConvoId = ?', [id]);
    db.runSync('DELETE FROM group_members WHERE conversationId = ?', [id]);
    db.runSync('DELETE FROM conversations WHERE id = ?', [id]);
  });
}

export const touchConversation = (id: string): void =>
  void db.runSync('UPDATE conversations SET updatedAt=? WHERE id=?', [now(), id]);

export const setSummary = (id: string, summary: string, upToId: string): void =>
  void db.runSync('UPDATE conversations SET summary=?, summaryUpToId=? WHERE id=?', [
    summary, upToId, id,
  ]);

// Recovery hatch: a hallucination baked into the rolling summary would be
// re-fed to the model forever — this wipes it so it rebuilds from history.
export const clearSummary = (id: string): void =>
  void db.runSync('UPDATE conversations SET summary=NULL, summaryUpToId=NULL WHERE id=?', [id]);

// ---- messages ----
export const listMessages = (conversationId: string): Message[] =>
  db.getAllSync<Message>(
    'SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt ASC, id ASC',
    [conversationId],
  );

export const getMessage = (id: string): Message | null =>
  db.getFirstSync<Message>('SELECT * FROM messages WHERE id = ?', [id]) ?? null;

export function deleteMessageAndResetContext(
  conversationId: string,
  messageId: string,
): boolean {
  let deleted = false;
  db.withTransactionSync(() => {
    const target = db.getFirstSync<Pick<Message, 'id' | 'kind'>>(
      'SELECT id, kind FROM messages WHERE id=? AND conversationId=?',
      [messageId, conversationId],
    );
    if (!target || !isDeletableMessageKind(target.kind)) return;
    db.runSync(
      'UPDATE messages SET quotedId=NULL WHERE conversationId=? AND quotedId=?',
      [conversationId, messageId],
    );
    db.runSync(
      'DELETE FROM messages WHERE id=? AND conversationId=?',
      [messageId, conversationId],
    );
    db.runSync(
      'UPDATE conversations SET summary=NULL, summaryUpToId=NULL, currentThought=NULL, updatedAt=? WHERE id=?',
      [now(), conversationId],
    );
    deleted = true;
  });
  return deleted;
}

export function insertMessage(
  conversationId: string,
  role: Role,
  content: string,
  status: MessageStatus = 'complete',
  kind: MessageKind = 'normal',
  reasoning: string | null = null,
  createdAt?: number, // scheduled-outreach ingestion backdates to delivery time
  quotedId: string | null = null, // 引用 target
  speakerId: string | null = null, // group speaker (v2.2)
): Message {
  const m: Message = {
    id: uuid(), conversationId, role, content, status, kind, reasoning, quotedId, speakerId,
    createdAt: createdAt ?? now(),
  };
  db.runSync(
    'INSERT INTO messages (id, conversationId, role, content, status, kind, reasoning, quotedId, speakerId, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [m.id, m.conversationId, m.role, m.content, m.status, m.kind, m.reasoning, m.quotedId, m.speakerId, m.createdAt],
  );
  return m;
}

// ---- stickers ----
export const listStickers = (): Sticker[] =>
  db.getAllSync<Sticker>('SELECT * FROM stickers ORDER BY createdAt ASC');

export const getStickerByLabel = (label: string): Sticker | null =>
  db.getFirstSync<Sticker>('SELECT * FROM stickers WHERE label = ?', [label]) ?? null;

export function insertSticker(label: string, desc: string, image: string): void {
  db.runSync('DELETE FROM stickers WHERE label = ?', [label]); // re-import replaces
  db.runSync(
    'INSERT INTO stickers (id, label, desc, image, createdAt) VALUES (?,?,?,?,?)',
    [uuid(), label, desc, image, now()],
  );
}

export const deleteSticker = (id: string): void =>
  void db.runSync('DELETE FROM stickers WHERE id = ?', [id]);

export const clearStickers = (): void => void db.runSync('DELETE FROM stickers');

export const setCurveDrift = (id: string, driftJson: string | null): void =>
  void db.runSync('UPDATE conversations SET curveDrift=? WHERE id=?', [driftJson, id]);

export const setDiscipline = (id: string, value: number): void =>
  void db.runSync('UPDATE conversations SET discipline=? WHERE id=?', [value, id]);

export const setMasterHonorific = (id: string, honorific: string): void =>
  void db.runSync('UPDATE conversations SET masterHonorific=? WHERE id=?', [honorific, id]);

export const setMasterRules = (id: string, rules: string): void =>
  void db.runSync('UPDATE conversations SET masterRules=? WHERE id=?', [rules, id]);

export const setLifeEnabled = (id: string, on: boolean): void =>
  void db.runSync('UPDATE conversations SET lifeEnabled=? WHERE id=?', [on ? 1 : 0, id]);

export const setMemoryEnabled = (id: string, on: boolean): void =>
  void db.runSync('UPDATE conversations SET memoryEnabled=? WHERE id=?', [on ? 1 : 0, id]);

export const setCharBalance = (id: string, balance: number): void =>
  void db.runSync('UPDATE conversations SET charBalance=? WHERE id=?', [balance, id]);

export const updateMessageContent = (id: string, content: string): void =>
  void db.runSync('UPDATE messages SET content=? WHERE id=?', [content, id]);

// ---- memories (记忆库) ----
export const listMemories = (conversationId: string): MemoryEntry[] =>
  db.getAllSync<MemoryEntry>(
    'SELECT * FROM memories WHERE conversationId = ? ORDER BY createdAt ASC, id ASC',
    [conversationId],
  );

export function insertMemory(conversationId: string, text: string): MemoryEntry {
  const m: MemoryEntry = { id: uuid(), conversationId, text, createdAt: now() };
  db.runSync(
    'INSERT INTO memories (id, conversationId, text, createdAt) VALUES (?,?,?,?)',
    [m.id, m.conversationId, m.text, m.createdAt],
  );
  return m;
}

export function updateMemory(conversationId: string, id: string, text: string): boolean {
  const result = db.runSync(
    'UPDATE memories SET text=? WHERE id=? AND conversationId=?',
    [text, id, conversationId],
  );
  return result.changes > 0;
}

export const deleteMemory = (id: string): void =>
  void db.runSync('DELETE FROM memories WHERE id = ?', [id]);

export const clearMemories = (conversationId: string): void =>
  void db.runSync('DELETE FROM memories WHERE conversationId = ?', [conversationId]);

export const setConversationState = (
  id: string,
  moodLabel: string,
  moodIntensity: number,
  currentThought: string,
): void =>
  void db.runSync(
    'UPDATE conversations SET moodLabel=?, moodIntensity=?, moodUpdatedAt=?, currentThought=? WHERE id=?',
    [moodLabel, moodIntensity, now(), currentThought, id],
  );

// ---- prefs ----
export const getPref = (key: string): string | null =>
  db.getFirstSync<{ value: string }>('SELECT value FROM prefs WHERE key = ?', [key])?.value ?? null;

export const setPref = (key: string, value: string): void =>
  void db.runSync('INSERT OR REPLACE INTO prefs (key, value) VALUES (?,?)', [key, value]);

// 提示词工作室: prompts.ts stays db-free (pure modules import it); the real
// prefs storage is bound here, at first db import — before any screen renders.
bindPromptStore({ get: getPref, set: setPref });

// API 用量计数 (v2.3): every streamChat/chatOnce bumps today's pref counter.
bindApiCounter(() => {
  const d = new Date();
  const k = `api.${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate(),
  ).padStart(2, '0')}`;
  setPref(k, String((parseInt(getPref(k) ?? '0', 10) || 0) + 1));
});
