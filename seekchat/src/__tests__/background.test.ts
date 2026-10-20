const mockPrefs = new Map<string, string>();
const mockConvos = new Set(['c1', 'c2']); // conversations that still exist
const mockDb = {
  execSync: jest.fn(),
  getFirstSync: jest.fn(),
  getAllSync: jest.fn(),
  runSync: jest.fn(() => ({ changes: 1, lastInsertRowId: 0 })),
  withTransactionSync: jest.fn((fn: () => void) => fn()),
};

jest.mock('expo-sqlite', () => ({ openDatabaseSync: () => mockDb }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-test' }));
jest.mock('expo-notifications', () => ({
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('notif-new')),
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('expo-background-task', () => ({
  registerTaskAsync: jest.fn(() => Promise.resolve()),
  unregisterTaskAsync: jest.fn(() => Promise.resolve()),
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  BackgroundTaskStatus: { Available: 1, Restricted: 2 },
}));
jest.mock('../lib/db', () => ({
  ...jest.requireActual('../lib/db'),
  getPref: jest.fn((key: string) => mockPrefs.get(key) ?? null),
  setPref: jest.fn((key: string, value: string) => void mockPrefs.set(key, value)),
  getConversation: jest.fn((id: string) => (mockConvos.has(id) ? { id } : null)),
}));

const Notifications = require('expo-notifications');
const { getPref, setPref } = require('../lib/db') as typeof import('../lib/db');
const {
  cancelAllOutreach, cancelConversationOutreach, ingestDueOutreach, scheduleDeferredReply,
  syncScheduledOutreach,
} = require('../lib/background') as typeof import('../lib/background');

const sched = (conversationId: string, notifId: string, fireAt = 100) => ({
  conversationId, notifId, text: notifId, fireAt, generatedAt: 50,
});
// 节奏 (v3.0): a held reply — written when the user sent, delivered later.
const reply = (conversationId: string, notifId: string, generatedAt = 50) => ({
  ...sched(conversationId, notifId), generatedAt, kind: 'reply' as const,
});
const stored = (): { notifId: string }[] => JSON.parse(mockPrefs.get('scheduledOutreach') ?? '[]');
const cancelled = (): unknown[] =>
  (Notifications.cancelScheduledNotificationAsync as jest.Mock).mock.calls.map((c: unknown[]) => c[0]);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  mockPrefs.clear();
  jest.clearAllMocks();
});

describe('cancelConversationOutreach wiring', () => {
  it('cancels only the target conversation notifications and rebases storage', async () => {
    mockPrefs.set('scheduledOutreach', JSON.stringify([
      sched('c1', 'n1'), sched('c2', 'n2'), sched('c1', 'n3'),
    ]));

    await cancelConversationOutreach('c1');

    const cancel = Notifications.cancelScheduledNotificationAsync as jest.Mock;
    expect(cancel.mock.calls.map((c: unknown[]) => c[0])).toEqual(['n1', 'n3']);
    const stored = JSON.parse(mockPrefs.get('scheduledOutreach')!) as { notifId: string }[];
    expect(stored.map((i) => i.notifId)).toEqual(['n2']);
  });

  it('leaves storage untouched when the conversation has no plan', async () => {
    mockPrefs.set('scheduledOutreach', JSON.stringify([sched('c2', 'n2')]));

    await cancelConversationOutreach('c1');

    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(setPref).not.toHaveBeenCalled();
    expect(JSON.parse(mockPrefs.get('scheduledOutreach')!)).toHaveLength(1);
  });

  it('holds the planner gate until cancellation completes', async () => {
    let release!: () => void;
    (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockReturnValueOnce(
      new Promise<void>((resolve) => { release = resolve; }),
    );
    mockPrefs.set('scheduledOutreach', JSON.stringify([sched('c1', 'n1')]));
    const cancelling = cancelConversationOutreach('c1');

    await syncScheduledOutreach(true);
    expect(getPref).not.toHaveBeenCalledWith('backgroundReach');

    release();
    await cancelling;
    await syncScheduledOutreach(true);
    expect(getPref).toHaveBeenCalledWith('backgroundReach');
  });
});

describe('opting out of 后台主动联系 spares held replies', () => {
  it('cancels outreach only — a held reply keeps its notification and its place', async () => {
    mockPrefs.set('scheduledOutreach', JSON.stringify([
      sched('c1', 'n1'), reply('c1', 'r1'), sched('c2', 'n2'),
    ]));

    await cancelAllOutreach();

    expect(cancelled()).toEqual(['n1', 'n2']);
    expect(stored().map((i) => i.notifId)).toEqual(['r1']);
  });

  it('keeps held replies through the launch/background sync while the switch is off', async () => {
    mockPrefs.set('backgroundReach', '0');
    mockPrefs.set('scheduledOutreach', JSON.stringify([reply('c1', 'r1'), sched('c1', 'n1')]));

    await syncScheduledOutreach(true);
    await flush(); // the off branch fires cancelAllOutreach without awaiting it

    expect(cancelled()).toEqual(['n1']);
    expect(stored().map((i) => i.notifId)).toEqual(['r1']);
  });

  it('still folds the held reply into the chat on resume after an opt-out', async () => {
    mockPrefs.set('scheduledOutreach', JSON.stringify([reply('c1', 'r1')])); // fireAt 100: due
    mockDb.getAllSync.mockReturnValueOnce([]); // the chat's messages

    await cancelAllOutreach();

    expect(ingestDueOutreach()).toBe(1);
    expect(stored()).toEqual([]);
  });

  it('does not lose a reply held while the cancel loop is still awaiting', async () => {
    let release!: () => void;
    (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockReturnValueOnce(
      new Promise<void>((resolve) => { release = resolve; }),
    );
    (Notifications.scheduleNotificationAsync as jest.Mock).mockResolvedValueOnce('r-late');
    mockPrefs.set('scheduledOutreach', JSON.stringify([sched('c1', 'n1')]));
    const cancelling = cancelAllOutreach();

    await scheduleDeferredReply({ conversationId: 'c1', text: '早', fireAt: 999, title: '林夏' });
    release();
    await cancelling;

    expect(stored().map((i) => i.notifId)).toEqual(['r-late']);
  });

  it("cancels a deleted chat's held reply", async () => {
    mockPrefs.set('scheduledOutreach', JSON.stringify([reply('gone', 'r9'), reply('c1', 'r1')]));

    await cancelAllOutreach();

    expect(cancelled()).toEqual(['r9']);
    expect(stored().map((i) => i.notifId)).toEqual(['r1']);
  });
});

describe('message deletion and the held reply', () => {
  it('keeps the held reply when the deleted message was already read', async () => {
    mockPrefs.set('scheduledOutreach', JSON.stringify([sched('c1', 'n1'), reply('c1', 'r1')]));

    await cancelConversationOutreach('c1');

    expect(cancelled()).toEqual(['n1']);
    expect(stored().map((i) => i.notifId)).toEqual(['r1']);
  });

  it('drops only the replies written after a withdrawn (still unread) message', async () => {
    mockPrefs.set('scheduledOutreach', JSON.stringify([
      reply('c1', 'r-old', 40), reply('c1', 'r-new', 60), reply('c2', 'r-c2', 60),
    ]));

    await cancelConversationOutreach('c1', 55); // the deleted message was sent at 55

    expect(cancelled()).toEqual(['r-new']);
    expect(stored().map((i) => i.notifId)).toEqual(['r-old', 'r-c2']);
  });
});
