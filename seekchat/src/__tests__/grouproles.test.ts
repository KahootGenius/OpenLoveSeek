import {
  canAnnounce, canAppoint, canMute, canRecall, canRemove, canTransfer, clampMuteMinutes,
  isMutedNow, modTargetsLabel, rankOf, USER_MUTE_MAX_MINUTES,
} from '../lib/grouproles';
import { GROUP_DEFAULTS } from '../lib/groupchat';

const members = [
  { id: 'admin1', role: 'admin' as const },
  { id: 'mem1', role: 'member' as const },
  { id: 'mem2', role: 'member' as const },
];
const userOwner = { ...GROUP_DEFAULTS };
const charOwner = { ...GROUP_DEFAULTS, owner: 'admin1' };
const consent = { ...GROUP_DEFAULTS, owner: 'admin1', modConsent: true };

describe('rankOf', () => {
  it('ranks owner 3, admin 2, member 1, stranger 0; user is admin when not owner', () => {
    expect(rankOf('user', userOwner, members)).toBe(3);
    expect(rankOf('admin1', userOwner, members)).toBe(2);
    expect(rankOf('mem1', userOwner, members)).toBe(1);
    expect(rankOf('ghost', userOwner, members)).toBe(0);
    expect(rankOf('admin1', charOwner, members)).toBe(3);
    expect(rankOf('user', charOwner, members)).toBe(2);
  });
});

describe('permissions', () => {
  it('mute needs strictly higher rank', () => {
    expect(canMute('user', 'mem1', userOwner, members)).toBe(true);
    expect(canMute('admin1', 'mem1', userOwner, members)).toBe(true);
    expect(canMute('mem1', 'mem2', userOwner, members)).toBe(false);
    expect(canMute('admin1', 'user', userOwner, members)).toBe(false);
  });
  it('moderating the user requires consent even for a character owner', () => {
    expect(canMute('admin1', 'user', charOwner, members)).toBe(false);
    expect(canMute('admin1', 'user', consent, members)).toBe(true);
    expect(canRecall('admin1', 'user', charOwner, members)).toBe(false);
    expect(canRecall('admin1', 'user', consent, members)).toBe(true);
  });
  it('recall allows self at any rank', () => {
    expect(canRecall('mem1', 'mem1', userOwner, members)).toBe(true);
    expect(canRecall('mem1', 'admin1', userOwner, members)).toBe(false);
  });
  it('announce needs rank ≥ admin', () => {
    expect(canAnnounce('admin1', userOwner, members)).toBe(true);
    expect(canAnnounce('mem1', userOwner, members)).toBe(false);
    expect(canAnnounce('user', charOwner, members)).toBe(true);
  });
});

describe('canAppoint (v2.8 owner-character agency)', () => {
  it('is rank-3 (owner) only — an admin-char cannot appoint', () => {
    expect(canAppoint('user', userOwner, members)).toBe(true);
    expect(canAppoint('admin1', userOwner, members)).toBe(false);
    expect(canAppoint('mem1', userOwner, members)).toBe(false);
    expect(canAppoint('admin1', charOwner, members)).toBe(true);
    expect(canAppoint('user', charOwner, members)).toBe(false);
  });
});

describe('canRemove (v2.8 owner-character agency)', () => {
  it('needs strictly higher rank, same as mute', () => {
    expect(canRemove('user', 'mem1', userOwner, members)).toBe(true);
    expect(canRemove('admin1', 'mem1', userOwner, members)).toBe(true);
    expect(canRemove('mem1', 'mem2', userOwner, members)).toBe(false);
  });
  it('the user is NEVER removable — even by the owner', () => {
    expect(canRemove('admin1', 'user', charOwner, members)).toBe(false);
    expect(canRemove('admin1', 'user', consent, members)).toBe(false);
    expect(canRemove('user', 'user', userOwner, members)).toBe(false);
  });
});

describe('canTransfer (v2.8 owner-character agency)', () => {
  it('only the current owner may transfer', () => {
    expect(canTransfer('user', userOwner)).toBe(true);
    expect(canTransfer('admin1', userOwner)).toBe(false);
    expect(canTransfer('admin1', charOwner)).toBe(true);
    expect(canTransfer('user', charOwner)).toBe(false);
  });
  it('round-trips: an owner-char transferring to the user by 昵称 restores rank 3', () => {
    expect(canTransfer('admin1', charOwner)).toBe(true);
    const afterTransfer = { ...charOwner, owner: 'user' };
    expect(afterTransfer.owner).toBe('user');
    expect(rankOf('user', afterTransfer, members)).toBe(3);
  });
});

describe('modTargetsLabel', () => {
  it('describes admin targets per consent', () => {
    expect(modTargetsLabel(false, '老板')).toBe('比你级别低的成员');
    expect(modTargetsLabel(true, '老板')).toBe('比你级别低的成员（包括用户「老板」）');
  });
});

describe('mute helpers', () => {
  it('clamps duration and caps user mutes tighter', () => {
    expect(clampMuteMinutes(999, false)).toBe(60);
    expect(clampMuteMinutes(0, false)).toBe(1);
    expect(clampMuteMinutes(999, true)).toBe(USER_MUTE_MAX_MINUTES);
  });
  it('isMutedNow respects the clock', () => {
    expect(isMutedNow(100, 50)).toBe(true);
    expect(isMutedNow(100, 100)).toBe(false);
    expect(isMutedNow(null, 50)).toBe(false);
  });
});
