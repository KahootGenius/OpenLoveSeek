import { messageActionsForKind } from './message-deletion';
import type { MessageKind, Role } from './types';

// Pure action-builders for MessageActionMenu (v2.8 T3): Android's Alert.alert
// silently drops buttons past 3, which made 撤回/删除 invisible whenever a
// row also offered 回复/朗读/@她. The menu component has no such ceiling, and
// a denied action is PRESENT-but-disabled with a reason rather than omitted —
// that's the fix, so these builders must never silently drop a gated action.
export interface MenuAction {
  key: string;            // 'reply' | 'copy' | 'speak' | 'recall' | 'delete' | 'mention' | …
  label: string;          // 回复 / 复制 / 朗读 / 撤回 / 删除 / @她
  destructive?: boolean;
  disabledReason?: string; // present ⇒ render disabled with this caption
}

const RANK_DENIED_REASON = '只能撤回比你级别低的成员';
const CONSENT_DENIED_REASON = '需要在群设置开启对用户的管理许可';

/** 1:1 chat action sheet. Reply/delete follow messageActionsForKind's existing
 *  policy; 复制 is text-only (kind 'normal'); 朗读 needs voice on, her turn,
 *  and plain text (matches the old canSpeak check in chat/[id].tsx). */
export function dmMessageActions(opts: {
  kind: MessageKind; role: Role; voiceOn: boolean;
}): MenuAction[] {
  const base = messageActionsForKind(opts.kind);
  const actions: MenuAction[] = [];
  if (base.includes('reply')) actions.push({ key: 'reply', label: '回复' });
  if (opts.kind === 'normal') actions.push({ key: 'copy', label: '复制' });
  if (opts.voiceOn && opts.role === 'assistant' && opts.kind === 'normal') {
    actions.push({ key: 'speak', label: '朗读' });
  }
  if (base.includes('delete')) actions.push({ key: 'delete', label: '删除', destructive: true });
  return actions;
}

/** Group chat action sheet. 回复 and (kind-gated) 复制 are unconditional;
 *  @她 shows for anyone else's message; 撤回 is ALWAYS present (never
 *  silently dropped) — enabled for your own message or when you outrank the
 *  target and (for a user-target row) the user has granted mod consent,
 *  otherwise disabled with the reason that would have been true either way. */
export function groupMessageActions(opts: {
  kind: MessageKind; mine: boolean; targetRank: number; myRank: number; consentGate: boolean;
}): MenuAction[] {
  const actions: MenuAction[] = [{ key: 'reply', label: '回复' }];
  if (opts.kind === 'normal') actions.push({ key: 'copy', label: '复制' });
  if (!opts.mine) actions.push({ key: 'mention', label: '@她' });

  const recall: MenuAction = { key: 'recall', label: '撤回', destructive: true };
  if (!opts.mine) {
    const outranks = opts.myRank > opts.targetRank;
    if (!outranks) recall.disabledReason = RANK_DENIED_REASON;
    else if (opts.consentGate) recall.disabledReason = CONSENT_DENIED_REASON;
  }
  actions.push(recall);
  return actions;
}

/** 禁言 duration sheet (group screen, v2.8 T4): the OTHER Android-Alert
 *  casualty here — 取消/5分钟/30分钟/60分钟/解除禁言 is 5 buttons, past the
 *  3-button cap, so the picker silently truncated. 解除禁言 only shows when
 *  the target is actually muted right now (the old Alert always offered it,
 *  even as a no-op against an unmuted member). */
export function groupMuteActions(muted: boolean): MenuAction[] {
  const actions: MenuAction[] = [
    { key: 'mute5', label: '5分钟' },
    { key: 'mute30', label: '30分钟' },
    { key: 'mute60', label: '60分钟' },
  ];
  if (muted) actions.push({ key: 'unmute', label: '解除禁言', destructive: true });
  return actions;
}
