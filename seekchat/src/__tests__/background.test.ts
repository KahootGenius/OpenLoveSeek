const mockPrefs = new Map<string, string>();
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
}));

const Notifications = require('expo-notifications');
const { getPref, setPref } = require('../lib/db') as typeof import('../lib/db');
const {
  cancelConversationOutreach, syncScheduledOutreach,
} = require('../lib/background') as typeof import('../lib/background');

const sched = (conversationId: string, notifId: string, fireAt = 100) => ({
  conversationId, notifId, text: notifId, fireAt, generatedAt: 50,
});

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
