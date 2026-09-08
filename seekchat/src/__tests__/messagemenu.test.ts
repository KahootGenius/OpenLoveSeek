import { dmMessageActions, groupMessageActions, groupMuteActions, MenuAction } from '../lib/messagemenu';
import type { MessageKind } from '../lib/types';

const keysOf = (actions: MenuAction[]) => actions.map((a) => a.key);

describe('dmMessageActions', () => {
  it('gives normal assistant messages the full set when voice is on', () => {
    const actions = dmMessageActions({ kind: 'normal', role: 'assistant', voiceOn: true });
    expect(keysOf(actions)).toEqual(['reply', 'copy', 'speak', 'delete']);
  });

  it('omits 朗读 for the user\'s own normal messages even with voice on', () => {
    const actions = dmMessageActions({ kind: 'normal', role: 'user', voiceOn: true });
    expect(keysOf(actions)).toEqual(['reply', 'copy', 'delete']);
  });

  it('omits 朗读 when voice is off', () => {
    const actions = dmMessageActions({ kind: 'normal', role: 'assistant', voiceOn: false });
    expect(keysOf(actions)).toEqual(['reply', 'copy', 'delete']);
  });

  it.each<MessageKind>(['sticker', 'image'])(
    'gives reply+delete but no copy/speak for %s',
    (kind) => {
      const actions = dmMessageActions({ kind, role: 'assistant', voiceOn: true });
      expect(keysOf(actions)).toEqual(['reply', 'delete']);
    },
  );

  it.each<MessageKind>(['transfer', 'game', 'pat', 'experience'])(
    'gives delete only for %s (no reply/copy/speak)',
    (kind) => {
      const actions = dmMessageActions({ kind, role: 'assistant', voiceOn: true });
      expect(keysOf(actions)).toEqual(['delete']);
    },
  );

  it.each<MessageKind>(['meta', 'trigger'])(
    'gives no actions at all for hidden machinery kind %s',
    (kind) => {
      expect(dmMessageActions({ kind, role: 'assistant', voiceOn: true })).toEqual([]);
    },
  );

  it('carries the expected labels and marks delete destructive', () => {
    const actions = dmMessageActions({ kind: 'normal', role: 'assistant', voiceOn: true });
    expect(actions).toEqual([
      { key: 'reply', label: '回复' },
      { key: 'copy', label: '复制' },
      { key: 'speak', label: '朗读' },
      { key: 'delete', label: '删除', destructive: true },
    ]);
  });
});

describe('groupMessageActions', () => {
  const recallOf = (actions: MenuAction[]) => actions.find((a) => a.key === 'recall')!;

  it('never omits 撤回, even when denied', () => {
    const denied = groupMessageActions({
      kind: 'normal', mine: false, targetRank: 2, myRank: 1, consentGate: false,
    });
    expect(keysOf(denied)).toContain('recall');
  });

  it('always includes 回复 regardless of kind', () => {
    expect(keysOf(groupMessageActions({
      kind: 'normal', mine: true, targetRank: 3, myRank: 3, consentGate: false,
    }))).toContain('reply');
    expect(keysOf(groupMessageActions({
      kind: 'sticker', mine: true, targetRank: 3, myRank: 3, consentGate: false,
    }))).toContain('reply');
  });

  it('includes 复制 only for kind normal', () => {
    expect(keysOf(groupMessageActions({
      kind: 'normal', mine: true, targetRank: 3, myRank: 3, consentGate: false,
    }))).toContain('copy');
    expect(keysOf(groupMessageActions({
      kind: 'sticker', mine: true, targetRank: 3, myRank: 3, consentGate: false,
    }))).not.toContain('copy');
  });

  it('sticker kind in group: keeps reply/mention/recall, drops copy', () => {
    const a = groupMessageActions({
      kind: 'sticker', mine: false, targetRank: 1, myRank: 3, consentGate: false,
    });
    expect(keysOf(a)).toEqual(['reply', 'mention', 'recall']);
  });

  it('includes @她 only when the message is not the viewer\'s own', () => {
    expect(keysOf(groupMessageActions({
      kind: 'normal', mine: false, targetRank: 1, myRank: 3, consentGate: false,
    }))).toContain('mention');
    expect(keysOf(groupMessageActions({
      kind: 'normal', mine: true, targetRank: 3, myRank: 3, consentGate: false,
    }))).not.toContain('mention');
  });

  it('allows 撤回 on your own message unconditionally, even with a consent gate set', () => {
    const a = groupMessageActions({
      kind: 'normal', mine: true, targetRank: 3, myRank: 3, consentGate: true,
    });
    expect(recallOf(a).disabledReason).toBeUndefined();
  });

  it('allows 撤回 when you outrank the target and there is no consent gate', () => {
    const a = groupMessageActions({
      kind: 'normal', mine: false, targetRank: 1, myRank: 3, consentGate: false,
    });
    expect(recallOf(a).disabledReason).toBeUndefined();
  });

  it('denies 撤回 with the rank reason when you do not outrank the target', () => {
    const a = groupMessageActions({
      kind: 'normal', mine: false, targetRank: 2, myRank: 2, consentGate: false,
    });
    expect(recallOf(a).disabledReason).toBe('只能撤回比你级别低的成员');
  });

  it('denies 撤回 with the consent reason when you outrank but consent is not granted', () => {
    const a = groupMessageActions({
      kind: 'normal', mine: false, targetRank: 2, myRank: 3, consentGate: true,
    });
    expect(recallOf(a).disabledReason).toBe('需要在群设置开启对用户的管理许可');
  });

  it('prioritizes the rank reason when both rank and consent would deny it', () => {
    const a = groupMessageActions({
      kind: 'normal', mine: false, targetRank: 2, myRank: 2, consentGate: true,
    });
    expect(recallOf(a).disabledReason).toBe('只能撤回比你级别低的成员');
  });

  it('marks 撤回 destructive whether enabled or disabled', () => {
    const enabled = recallOf(groupMessageActions({
      kind: 'normal', mine: true, targetRank: 3, myRank: 3, consentGate: false,
    }));
    const disabled = recallOf(groupMessageActions({
      kind: 'normal', mine: false, targetRank: 2, myRank: 1, consentGate: false,
    }));
    expect(enabled.destructive).toBe(true);
    expect(disabled.destructive).toBe(true);
  });

  it('carries the expected labels for reply/copy/mention/recall', () => {
    const a = groupMessageActions({
      kind: 'normal', mine: false, targetRank: 1, myRank: 3, consentGate: false,
    });
    expect(a).toEqual([
      { key: 'reply', label: '回复' },
      { key: 'copy', label: '复制' },
      { key: 'mention', label: '@她' },
      { key: 'recall', label: '撤回', destructive: true },
    ]);
  });

  it('full rank/consent matrix: 回复/复制/@她 stay constant, only 撤回 gating varies', () => {
    const matrix: { myRank: number; targetRank: number; consentGate: boolean; denied: boolean }[] = [
      { myRank: 3, targetRank: 1, consentGate: false, denied: false },
      { myRank: 3, targetRank: 2, consentGate: false, denied: false },
      { myRank: 3, targetRank: 2, consentGate: true, denied: true },
      { myRank: 2, targetRank: 1, consentGate: false, denied: false },
      { myRank: 2, targetRank: 2, consentGate: false, denied: true },
      { myRank: 1, targetRank: 1, consentGate: false, denied: true },
      { myRank: 1, targetRank: 2, consentGate: false, denied: true },
    ];
    for (const row of matrix) {
      const a = groupMessageActions({
        kind: 'normal', mine: false, targetRank: row.targetRank, myRank: row.myRank,
        consentGate: row.consentGate,
      });
      expect(keysOf(a)).toEqual(['reply', 'copy', 'mention', 'recall']);
      const recall = recallOf(a);
      if (row.denied) expect(recall.disabledReason).toBeTruthy();
      else expect(recall.disabledReason).toBeUndefined();
    }
  });
});

describe('groupMuteActions', () => {
  it('offers the three fixed durations when not muted', () => {
    expect(groupMuteActions(false)).toEqual([
      { key: 'mute5', label: '5分钟' },
      { key: 'mute30', label: '30分钟' },
      { key: 'mute60', label: '60分钟' },
    ]);
  });

  it('adds a destructive 解除禁言 row only when currently muted', () => {
    expect(groupMuteActions(true)).toEqual([
      { key: 'mute5', label: '5分钟' },
      { key: 'mute30', label: '30分钟' },
      { key: 'mute60', label: '60分钟' },
      { key: 'unmute', label: '解除禁言', destructive: true },
    ]);
  });
});
