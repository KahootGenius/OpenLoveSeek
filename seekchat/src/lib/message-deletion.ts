import type { MessageKind } from './types';

const DELETABLE = new Set<MessageKind>([
  'normal', 'sticker', 'transfer', 'game', 'pat', 'experience', 'image',
]);

export const isDeletableMessageKind = (kind: MessageKind): boolean =>
  DELETABLE.has(kind);

export function messageActionsForKind(kind: MessageKind): ('reply' | 'delete')[] {
  if (!isDeletableMessageKind(kind)) return [];
  return kind === 'normal' || kind === 'sticker' || kind === 'image'
    ? ['reply', 'delete']
    : ['delete'];
}

// The rolling summary covers rows up to and INCLUDING the boundary row, so a
// deletion at or before the boundary may be paraphrased by the summary text and
// forces a reset. A null boundary can mean a 开启新篇章 carry-over whose copied
// tail rows the old summary may still describe — fail closed there too.
export function mustClearSummaryOnDeletion(
  orderedIds: string[],
  deletedId: string,
  summaryUpToId: string | null,
): boolean {
  if (!summaryUpToId) return true;
  const anchor = orderedIds.indexOf(summaryUpToId);
  if (anchor < 0) return true;
  const deleted = orderedIds.indexOf(deletedId);
  return deleted < 0 || deleted <= anchor;
}
