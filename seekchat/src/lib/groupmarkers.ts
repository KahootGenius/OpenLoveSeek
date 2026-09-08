// v2.5 character-initiated moderation. Extraction only strips and reports —
// grouproles.ts decides whether each op is allowed; groupflow.ts executes.
// v2.8: owner-character agency adds recallOthers/appoint/dismiss/remove/transfer
// beside the original member/admin set.
export interface GroupModOps {
  mute: { name: string; minutes: number }[];
  unmute: string[];
  recallSelf: boolean;
  recallOthers: string[];
  appoint: string[];
  dismiss: string[];
  remove: string[];
  transfer: string | null;
  announce: string | null;
  noteAppends: string[];
  clean: string;
}

const RE =
  /\[[ \t]*(禁言|解除禁言|公告|笔记\+|撤回|任命|罢免|移出|转让群主)[ \t]*(?:[:：]([^\]]*))?\]/g;
// 撤回 now optionally carries a payload (v2.8: recall a NAMED other member) —
// bare stays recallSelf, unlike the other heads it still isn't bracket-
// normalized to ASCII upstream when bare (repair.ts only fixes value-bearing
// markers), so a bare fullwidth 【撤回】 needs its own pass here.
const RECALL_FULLWIDTH_RE = /【[ \t]*撤回[ \t]*】/g;

export function extractGroupModMarkers(text: string): GroupModOps {
  const ops: GroupModOps = {
    mute: [], unmute: [], recallSelf: false, recallOthers: [], appoint: [], dismiss: [],
    remove: [], transfer: null, announce: null, noteAppends: [], clean: text,
  };
  ops.clean = text.replace(RE, (_, head: string, payload?: string) => {
    const p = (payload ?? '').trim();
    if (head === '撤回') {
      if (p) ops.recallOthers.push(p);
      else ops.recallSelf = true;
    } else if (head === '禁言' && p) {
      const [name, mins] = p.split(/[|｜]/).map((s) => s.trim());
      if (name) ops.mute.push({ name, minutes: parseInt(mins ?? '', 10) || 0 });
    } else if (head === '解除禁言' && p) ops.unmute.push(p);
    else if (head === '公告' && p) ops.announce = p;
    else if (head === '笔记+' && p && ops.noteAppends.length === 0) ops.noteAppends.push(p);
    else if (head === '任命' && p) ops.appoint.push(p);
    else if (head === '罢免' && p) ops.dismiss.push(p);
    else if (head === '移出' && p) ops.remove.push(p);
    else if (head === '转让群主' && p && ops.transfer === null) ops.transfer = p;
    return '';
  }).replace(RECALL_FULLWIDTH_RE, () => {
    ops.recallSelf = true;
    return '';
  }).trim();
  return ops;
}
