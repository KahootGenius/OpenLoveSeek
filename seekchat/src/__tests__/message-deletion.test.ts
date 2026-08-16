import {
  isDeletableMessageKind, messageActionsForKind,
} from '../lib/message-deletion';
import type { MessageKind } from '../lib/types';

describe('direct-chat message deletion', () => {
  it.each<MessageKind>(['normal', 'sticker', 'transfer', 'game', 'pat', 'experience'])(
    'allows stored visible kind %s',
    (kind) => expect(isDeletableMessageKind(kind)).toBe(true),
  );

  it.each<MessageKind>(['meta', 'trigger'])(
    'rejects hidden machinery kind %s',
    (kind) => expect(isDeletableMessageKind(kind)).toBe(false),
  );

  it('preserves reply only for the kinds that already supported it', () => {
    expect(messageActionsForKind('normal')).toEqual(['reply', 'delete']);
    expect(messageActionsForKind('sticker')).toEqual(['reply', 'delete']);
    expect(messageActionsForKind('transfer')).toEqual(['delete']);
    expect(messageActionsForKind('game')).toEqual(['delete']);
    expect(messageActionsForKind('pat')).toEqual(['delete']);
    expect(messageActionsForKind('experience')).toEqual(['delete']);
    expect(messageActionsForKind('meta')).toEqual([]);
    expect(messageActionsForKind('trigger')).toEqual([]);
  });
});
