import type { MessageKind } from './types';

const DELETABLE = new Set<MessageKind>([
  'normal', 'sticker', 'transfer', 'game', 'pat', 'experience',
]);

export const isDeletableMessageKind = (kind: MessageKind): boolean =>
  DELETABLE.has(kind);

export function messageActionsForKind(kind: MessageKind): ('reply' | 'delete')[] {
  if (!isDeletableMessageKind(kind)) return [];
  return kind === 'normal' || kind === 'sticker'
    ? ['reply', 'delete']
    : ['delete'];
}
