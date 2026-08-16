const mockDb = {
  execSync: jest.fn(),
  getFirstSync: jest.fn(),
  getAllSync: jest.fn(),
  runSync: jest.fn(),
  withTransactionSync: jest.fn((fn: () => void) => fn()),
};

jest.mock('expo-sqlite', () => ({ openDatabaseSync: () => mockDb }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-test' }));

const { deleteMessageAndResetContext, updateMemory } = require('../lib/db') as typeof import('../lib/db');

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
});
