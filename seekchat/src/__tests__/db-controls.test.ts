const mockDb = {
  execSync: jest.fn(),
  getFirstSync: jest.fn(),
  getAllSync: jest.fn(),
  runSync: jest.fn(),
  withTransactionSync: jest.fn((fn: () => void) => fn()),
};

jest.mock('expo-sqlite', () => ({ openDatabaseSync: () => mockDb }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-test' }));

const {
  deleteMessageAndResetContext, updateMemory, setConversationAvatar,
  setGroupMemberRole, setGroupMemberMute, recallGroupMessage,
  listRefImages, upsertRefImage, clearRefImages, setPersonaAppearance, setPersonaRefsFrozen,
  listStalePendingImages, setPersonaVoiceId, listMessages, carryOverConversation,
} = require('../lib/db') as typeof import('../lib/db');

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.getFirstSync.mockReset();
  mockDb.runSync.mockReturnValue({ changes: 1, lastInsertRowId: 0 });
  mockDb.withTransactionSync.mockImplementation((fn: () => void) => fn());
});

describe('updateMemory', () => {
  it('updates text only when both conversation and memory ids match', () => {
    expect(updateMemory('c1', 'mem1', '修正后的记忆')).toBe(true);
    expect(mockDb.runSync).toHaveBeenCalledWith(
      'UPDATE memories SET text=? WHERE id=? AND conversationId=?',
      ['修正后的记忆', 'mem1', 'c1'],
    );
  });

  it('returns false when no scoped row was updated', () => {
    mockDb.runSync.mockReturnValueOnce({ changes: 0, lastInsertRowId: 0 });
    expect(updateMemory('c1', 'missing', '内容')).toBe(false);
  });
});

describe('deleteMessageAndResetContext', () => {
  it('deletes a scoped eligible row and clears quotes plus derived context atomically', () => {
    mockDb.getFirstSync.mockReturnValueOnce({ id: 'm1', kind: 'normal' });

    expect(deleteMessageAndResetContext('c1', 'm1')).toBe(true);
    expect(mockDb.withTransactionSync).toHaveBeenCalledTimes(1);
    expect(mockDb.getFirstSync).toHaveBeenCalledWith(
      'SELECT id, kind FROM messages WHERE id=? AND conversationId=?',
      ['m1', 'c1'],
    );
    expect(mockDb.runSync).toHaveBeenCalledTimes(3);
    expect(mockDb.runSync).toHaveBeenNthCalledWith(
      1,
      'UPDATE messages SET quotedId=NULL WHERE conversationId=? AND quotedId=?',
      ['c1', 'm1'],
    );
    expect(mockDb.runSync).toHaveBeenNthCalledWith(
      2,
      'DELETE FROM messages WHERE id=? AND conversationId=?',
      ['m1', 'c1'],
    );
    expect(mockDb.runSync).toHaveBeenNthCalledWith(
      3,
      'UPDATE conversations SET summary=NULL, summaryUpToId=NULL, currentThought=NULL, updatedAt=? WHERE id=?',
      [expect.any(Number), 'c1'],
    );
  });

  it.each(['meta', 'trigger'] as const)('rejects hidden kind %s without writes', (kind) => {
    mockDb.getFirstSync.mockReturnValueOnce({ id: 'm1', kind });
    expect(deleteMessageAndResetContext('c1', 'm1')).toBe(false);
    expect(mockDb.runSync).not.toHaveBeenCalled();
  });

  it('fails closed for a missing or cross-conversation row', () => {
    mockDb.getFirstSync.mockReturnValueOnce(null);
    expect(deleteMessageAndResetContext('c1', 'other')).toBe(false);
    expect(mockDb.getFirstSync).toHaveBeenCalledWith(
      'SELECT id, kind FROM messages WHERE id=? AND conversationId=?',
      ['other', 'c1'],
    );
    expect(mockDb.runSync).not.toHaveBeenCalled();
  });

  it('keeps the rolling summary when the deleted row is after the boundary', () => {
    mockDb.getFirstSync
      .mockReturnValueOnce({ id: 'm3', kind: 'normal' })
      .mockReturnValueOnce({ summaryUpToId: 'm2' });
    mockDb.getAllSync.mockReturnValueOnce([{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }]);

    expect(deleteMessageAndResetContext('c1', 'm3')).toBe(true);
    expect(mockDb.getFirstSync).toHaveBeenCalledWith(
      'SELECT summaryUpToId FROM conversations WHERE id=?',
      ['c1'],
    );
    expect(mockDb.getAllSync).toHaveBeenCalledWith(
      'SELECT id FROM messages WHERE conversationId=? ORDER BY createdAt ASC, rowid ASC',
      ['c1'],
    );
    expect(mockDb.runSync).toHaveBeenCalledTimes(3);
    expect(mockDb.runSync).toHaveBeenNthCalledWith(
      3,
      'UPDATE conversations SET currentThought=NULL, updatedAt=? WHERE id=?',
      [expect.any(Number), 'c1'],
    );
  });

  it('clears the summary when the deleted row is the boundary itself', () => {
    mockDb.getFirstSync
      .mockReturnValueOnce({ id: 'm2', kind: 'normal' })
      .mockReturnValueOnce({ summaryUpToId: 'm2' });
    mockDb.getAllSync.mockReturnValueOnce([{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }]);

    expect(deleteMessageAndResetContext('c1', 'm2')).toBe(true);
    expect(mockDb.runSync).toHaveBeenNthCalledWith(
      3,
      'UPDATE conversations SET summary=NULL, summaryUpToId=NULL, currentThought=NULL, updatedAt=? WHERE id=?',
      [expect.any(Number), 'c1'],
    );
  });

  it('clears conservatively when no boundary exists (carried-summary chapters)', () => {
    mockDb.getFirstSync
      .mockReturnValueOnce({ id: 'm1', kind: 'normal' })
      .mockReturnValueOnce({ summaryUpToId: null });

    expect(deleteMessageAndResetContext('c1', 'm1')).toBe(true);
    expect(mockDb.getAllSync).not.toHaveBeenCalled();
    expect(mockDb.runSync).toHaveBeenNthCalledWith(
      3,
      'UPDATE conversations SET summary=NULL, summaryUpToId=NULL, currentThought=NULL, updatedAt=? WHERE id=?',
      [expect.any(Number), 'c1'],
    );
  });
});

describe('listMessages (v2.8 burst-ordering fix)', () => {
  it('breaks createdAt ties on insertion order (rowid), not the random uuid', () => {
    mockDb.getAllSync.mockReturnValueOnce([]);
    listMessages('c1');
    expect(mockDb.getAllSync).toHaveBeenCalledWith(
      'SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt ASC, rowid ASC',
      ['c1'],
    );
  });
});

describe('carryOverConversation tail-carry ordering (v2.8 burst-ordering fix)', () => {
  it('breaks createdAt ties on insertion order (rowid), not the random uuid', () => {
    mockDb.getFirstSync
      .mockReturnValueOnce({ id: 'old1', kind: 'dm', personaId: 'p1' }) // getConversation(oldId)
      .mockReturnValueOnce({ name: '沫凌' }); // getPersona(old.personaId)
    mockDb.getAllSync
      .mockReturnValueOnce([]) // listMemories(oldId)
      .mockReturnValueOnce([]); // the tail-carry query itself

    carryOverConversation('old1');

    expect(mockDb.getAllSync).toHaveBeenNthCalledWith(
      2,
      `SELECT * FROM messages WHERE conversationId = ?
           AND kind NOT IN ('meta','experience') AND status = 'complete'
         ORDER BY createdAt DESC, rowid DESC LIMIT ?`,
      ['old1', 12],
    );
  });
});

describe('setConversationAvatar', () => {
  it('updates only the targeted conversation', () => {
    setConversationAvatar('g1', 'file:///avatars/g1.png');
    expect(mockDb.runSync).toHaveBeenCalledWith(
      'UPDATE conversations SET avatarUri=? WHERE id=?',
      ['file:///avatars/g1.png', 'g1'],
    );
  });
});

describe('group roles and mute', () => {
  it('sets a scoped member role', () => {
    setGroupMemberRole('g1', 'ch1', 'admin');
    expect(mockDb.runSync).toHaveBeenCalledWith(
      'UPDATE group_members SET role=? WHERE conversationId=? AND characterId=?',
      ['admin', 'g1', 'ch1'],
    );
  });
  it('sets and clears a scoped mute', () => {
    setGroupMemberMute('g1', 'ch1', 12345);
    expect(mockDb.runSync).toHaveBeenCalledWith(
      'UPDATE group_members SET mutedUntil=? WHERE conversationId=? AND characterId=?',
      [12345, 'g1', 'ch1'],
    );
    setGroupMemberMute('g1', 'ch1', null);
    expect(mockDb.runSync).toHaveBeenLastCalledWith(
      'UPDATE group_members SET mutedUntil=? WHERE conversationId=? AND characterId=?',
      [null, 'g1', 'ch1'],
    );
  });
});

describe('recallGroupMessage', () => {
  it('rewrites a recalled group row in place', () => {
    recallGroupMessage('g1', 'm9', '沫凌 撤回了一条消息');
    expect(mockDb.runSync).toHaveBeenCalledWith(
      "UPDATE messages SET kind='recall', content=?, quotedId=NULL WHERE id=? AND conversationId=?",
      ['沫凌 撤回了一条消息', 'm9', 'g1'],
    );
  });
});

describe('ref images (v2.6 照片)', () => {
  it('lists a persona\'s ref images ordered by slot', () => {
    mockDb.getAllSync.mockReturnValueOnce([{ id: 'p1:0', slot: 0 }]);
    expect(listRefImages('p1')).toEqual([{ id: 'p1:0', slot: 0 }]);
    expect(mockDb.getAllSync).toHaveBeenCalledWith(
      'SELECT * FROM ref_images WHERE personaId = ? ORDER BY slot ASC',
      ['p1'],
    );
  });

  it('upserts a slot with a deterministic id', () => {
    upsertRefImage('p1', 1, 'file:///refimg/p1-1.jpg', '长发女生，半身照，自然姿态');
    expect(mockDb.runSync).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO ref_images (id, personaId, slot, uri, prompt, createdAt) VALUES (?,?,?,?,?,?)',
      ['p1:1', 'p1', 1, 'file:///refimg/p1-1.jpg', '长发女生，半身照，自然姿态', expect.any(Number)],
    );
  });

  it('clears all ref images for a persona', () => {
    clearRefImages('p1');
    expect(mockDb.runSync).toHaveBeenCalledWith(
      'DELETE FROM ref_images WHERE personaId = ?',
      ['p1'],
    );
  });
});

describe('persona appearance + freeze (v2.6 照片)', () => {
  it('sets the appearance prompt', () => {
    setPersonaAppearance('p1', '长发，棕色眼睛');
    expect(mockDb.runSync).toHaveBeenCalledWith(
      'UPDATE personas SET appearancePrompt=? WHERE id=?',
      ['长发，棕色眼睛', 'p1'],
    );
  });

  it('sets and clears refsFrozen', () => {
    setPersonaRefsFrozen('p1', 1);
    expect(mockDb.runSync).toHaveBeenCalledWith(
      'UPDATE personas SET refsFrozen=? WHERE id=?',
      [1, 'p1'],
    );
    setPersonaRefsFrozen('p1', 0);
    expect(mockDb.runSync).toHaveBeenLastCalledWith(
      'UPDATE personas SET refsFrozen=? WHERE id=?',
      [0, 'p1'],
    );
  });
});

describe('persona voice (v2.7 语音)', () => {
  it('sets the voice id', () => {
    setPersonaVoiceId('p1', 'voice-abc');
    expect(mockDb.runSync).toHaveBeenCalledWith(
      'UPDATE personas SET voiceId=? WHERE id=?',
      ['voice-abc', 'p1'],
    );
  });

  it('clears the voice id back to the global default (null)', () => {
    setPersonaVoiceId('p1', null);
    expect(mockDb.runSync).toHaveBeenLastCalledWith(
      'UPDATE personas SET voiceId=? WHERE id=?',
      [null, 'p1'],
    );
  });
});

describe('listStalePendingImages (v2.6 照片 launch sweep)', () => {
  it('selects image rows still stuck pending', () => {
    mockDb.getAllSync.mockReturnValueOnce([
      { id: 'm1', content: '{"status":"pending","scene":"在海边"}' },
    ]);
    expect(listStalePendingImages()).toEqual([
      { id: 'm1', content: '{"status":"pending","scene":"在海边"}' },
    ]);
    expect(mockDb.getAllSync).toHaveBeenCalledWith(
      "SELECT id, content FROM messages WHERE kind='image' AND content LIKE '%\"status\":\"pending\"%'",
    );
  });
});
