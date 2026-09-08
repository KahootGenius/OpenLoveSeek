// v2.5 group hierarchy. Owner > Admin > Member; the USER is owner by default
// and drops to admin after transferring ownership — reclaimable only if the
// owning character transfers it back (v2.8 owner-character agency).
// Every permission is decided HERE in tested code; markers only suggest.
import type { GroupConfig } from './groupchat';
import type { GroupRole } from './types';

export const USER_SUBJECT = 'user';
export const MUTE_MIN_MINUTES = 1;
export const MUTE_MAX_MINUTES = 60;
export const USER_MUTE_MAX_MINUTES = 10;

type RankedMember = { id: string; role: GroupRole };

export function rankOf(
  subject: string, cfg: GroupConfig, members: RankedMember[],
): number {
  if (cfg.owner === subject) return 3;
  if (subject === USER_SUBJECT) return 2;
  const m = members.find((x) => x.id === subject);
  if (!m) return 0;
  return m.role === 'admin' ? 2 : 1;
}

const outranks = (a: string, b: string, cfg: GroupConfig, members: RankedMember[]): boolean =>
  rankOf(a, cfg, members) > rankOf(b, cfg, members);

const userGate = (target: string, cfg: GroupConfig): boolean =>
  target !== USER_SUBJECT || cfg.modConsent;

export const canMute = (a: string, b: string, cfg: GroupConfig, members: RankedMember[]): boolean =>
  outranks(a, b, cfg, members) && userGate(b, cfg);

export const canRecall = (a: string, b: string, cfg: GroupConfig, members: RankedMember[]): boolean =>
  a === b || (outranks(a, b, cfg, members) && userGate(b, cfg));

export const canAnnounce = (a: string, cfg: GroupConfig, members: RankedMember[]): boolean =>
  rankOf(a, cfg, members) >= 2;

// v2.8 owner-character agency: appoint/dismiss grant or revoke admin rank, so
// only the owner may use them (no `b` — the target is always a roster member,
// never the user, who has no group_members row to promote/demote).
export const canAppoint = (a: string, cfg: GroupConfig, members: RankedMember[]): boolean =>
  rankOf(a, cfg, members) === 3;

// Same shape as canMute — any higher rank may remove a lower one — except the
// user, who can NEVER be removed from their own app, not even by the owner.
export const canRemove = (a: string, b: string, cfg: GroupConfig, members: RankedMember[]): boolean =>
  outranks(a, b, cfg, members) && b !== USER_SUBJECT;

// Only the CURRENT owner may transfer — target may be any member OR the user
// (by 用户昵称), reopening the door a prior transfer closed, at her initiative.
export const canTransfer = (a: string, cfg: GroupConfig): boolean => a === cfg.owner;

export function clampMuteMinutes(minutes: number, targetIsUser: boolean): number {
  const cap = targetIsUser ? USER_MUTE_MAX_MINUTES : MUTE_MAX_MINUTES;
  const n = Math.round(minutes) || MUTE_MIN_MINUTES;
  return Math.max(MUTE_MIN_MINUTES, Math.min(cap, n));
}

export const isMutedNow = (mutedUntil: number | null | undefined, now: number): boolean =>
  typeof mutedUntil === 'number' && mutedUntil > now;

/** Display line for a recalled row — the original text is gone on purpose. */
export const recallLine = (by: string, of: string | null): string =>
  of && of !== by ? `${by} 撤回了 ${of} 的一条消息` : `${by} 撤回了一条消息`;

/** The 禁言 target description a managing character is taught. */
export const modTargetsLabel = (modConsent: boolean, userName: string): string =>
  modConsent ? `比你级别低的成员（包括用户「${userName}」）` : '比你级别低的成员';
