jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execSync: jest.fn(), getFirstSync: jest.fn(), getAllSync: jest.fn(),
    runSync: jest.fn(() => ({ changes: 1, lastInsertRowId: 0 })),
    withTransactionSync: jest.fn((fn: () => void) => fn()),
  }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-test' }));
jest.mock('../lib/db', () => ({
  ...jest.requireActual('../lib/db'),
  getConversation: jest.fn(),
  getPersona: jest.fn(),
  listMemories: jest.fn(() => []),
}));

const { getConversation, getPersona, listMemories } =
  require('../lib/db') as typeof import('../lib/db');
const { soulContextFor } = require('../lib/soul') as typeof import('../lib/soul');
import type { Character, MemoryEntry } from '../lib/types';

const CH = {
  id: 'ch1', personaId: 'p1', homeConvoId: 'home1', soulSync: 1,
} as unknown as Character;
const mem = (id: string, text: string): MemoryEntry =>
  ({ id, conversationId: 'home1', text, createdAt: 1700000000000 });

beforeEach(() => {
  jest.clearAllMocks();
  (getPersona as jest.Mock).mockReturnValue(null);
});

describe('soulContextFor memory rules', () => {
  it('teaches the markers even when the vault is empty', () => {
    (getConversation as jest.Mock).mockReturnValue({
      summary: null, memoryEnabled: 1, moodLabel: null,
    });
    expect(soulContextFor(CH)).toContain('记忆');
  });

  it('withholds memory when 灵魂同步 is off or 记忆库 is off', () => {
    (getConversation as jest.Mock).mockReturnValue({
      summary: null, memoryEnabled: 1, moodLabel: null,
    });
    expect(soulContextFor({ ...CH, soulSync: 0 } as Character)).toBe('');
    (getConversation as jest.Mock).mockReturnValue({
      summary: null, memoryEnabled: 0, moodLabel: null,
    });
    expect(soulContextFor(CH)).toBe('');
  });

  it('numbers from the caller-pinned list so 忘记 indices match', () => {
    (getConversation as jest.Mock).mockReturnValue({
      summary: null, memoryEnabled: 1, moodLabel: null,
    });
    const out = soulContextFor(CH, [mem('m1', '他爱喝美式'), mem('m2', '他怕猫')]);
    expect(out).toContain('1. ');
    expect(out).toContain('他怕猫');
    expect(listMemories).not.toHaveBeenCalled();
  });
});
