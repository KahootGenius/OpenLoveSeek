import {
  isDeletableMessageKind, messageActionsForKind, mustClearSummaryOnDeletion,
} from '../lib/message-deletion';
import type { MessageKind } from '../lib/types';

describe('direct-chat message deletion', () => {
  it.each<MessageKind>(['normal', 'sticker', 'transfer', 'game', 'pat', 'experience', 'image'])(
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
    expect(messageActionsForKind('image')).toEqual(['reply', 'delete']);
    expect(messageActionsForKind('meta')).toEqual([]);
    expect(messageActionsForKind('trigger')).toEqual([]);
  });
});

describe('mustClearSummaryOnDeletion', () => {
  const ids = ['m1', 'm2', 'm3', 'm4'];

  it('preserves the summary when the deleted row is strictly after the boundary', () => {
    expect(mustClearSummaryOnDeletion(ids, 'm3', 'm2')).toBe(false);
    expect(mustClearSummaryOnDeletion(ids, 'm4', 'm2')).toBe(false);
  });

  it('clears when the deleted row is the boundary or inside the summarized range', () => {
    expect(mustClearSummaryOnDeletion(ids, 'm2', 'm2')).toBe(true);
    expect(mustClearSummaryOnDeletion(ids, 'm1', 'm2')).toBe(true);
  });

  it('fails closed when the boundary cannot be located', () => {
    expect(mustClearSummaryOnDeletion(ids, 'm3', null)).toBe(true);
    expect(mustClearSummaryOnDeletion(ids, 'm3', 'ghost')).toBe(true);
    expect(mustClearSummaryOnDeletion(ids, 'ghost', 'm2')).toBe(true);
  });
});
