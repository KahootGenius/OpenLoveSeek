import { extractGroupModMarkers } from '../lib/groupmarkers';

describe('extractGroupModMarkers', () => {
  it('extracts and strips every marker family', () => {
    const r = extractGroupModMarkers(
      '都安静点[禁言:小雨|30]，我说了算[公告:每晚十点后禁止刷屏]好了[笔记+:小雨欠我一杯奶茶]',
    );
    expect(r.mute).toEqual([{ name: '小雨', minutes: 30 }]);
    expect(r.announce).toBe('每晚十点后禁止刷屏');
    expect(r.noteAppends).toEqual(['小雨欠我一杯奶茶']);
    expect(r.clean).toBe('都安静点，我说了算好了');
  });
  it('handles 解除禁言, bare 撤回, and the fullwidth separator', () => {
    const r = extractGroupModMarkers('算了[解除禁言:小雨]刚才那句当我没说[撤回][禁言:阿明｜5]');
    expect(r.unmute).toEqual(['小雨']);
    expect(r.recallSelf).toBe(true);
    expect(r.mute).toEqual([{ name: '阿明', minutes: 5 }]);
  });
  it('keeps only the first note append and defaults bad minutes', () => {
    const r = extractGroupModMarkers('[笔记+:一]x[笔记+:二][禁言:小雨|abc]');
    expect(r.noteAppends).toEqual(['一']);
    expect(r.mute).toEqual([{ name: '小雨', minutes: 0 }]);
  });
  it('recognizes a fullwidth-bracket 【撤回】 as well as the ASCII form', () => {
    const r = extractGroupModMarkers('说错了【撤回】');
    expect(r.recallSelf).toBe(true);
    expect(r.clean).toBe('说错了');
  });

  it('routes a named 撤回 to recallOthers, keeping bare 撤回 as recallSelf (v2.8 coexistence)', () => {
    const r = extractGroupModMarkers('[撤回][撤回:小雨]');
    expect(r.recallSelf).toBe(true);
    expect(r.recallOthers).toEqual(['小雨']);
  });

  it('collects multiple recallOthers targets, incl. the fullwidth colon', () => {
    const r = extractGroupModMarkers('[撤回：小雨][撤回:阿明]');
    expect(r.recallSelf).toBe(false);
    expect(r.recallOthers).toEqual(['小雨', '阿明']);
  });

  it('extracts 任命/罢免/移出 as string arrays (v2.8 owner-character agency)', () => {
    const r = extractGroupModMarkers('[任命:小雨][罢免:阿明][移出:小雨][任命:小美]');
    expect(r.appoint).toEqual(['小雨', '小美']);
    expect(r.dismiss).toEqual(['阿明']);
    expect(r.remove).toEqual(['小雨']);
    expect(r.clean).toBe('');
  });

  it('extracts 转让群主 with first-wins semantics and the fullwidth colon', () => {
    const r = extractGroupModMarkers('[转让群主：小雨][转让群主:阿明]');
    expect(r.transfer).toBe('小雨');
  });

  it('defaults the new v2.8 fields to empty/null when no agency markers are present', () => {
    const r = extractGroupModMarkers('只是普通聊天');
    expect(r.recallOthers).toEqual([]);
    expect(r.appoint).toEqual([]);
    expect(r.dismiss).toEqual([]);
    expect(r.remove).toEqual([]);
    expect(r.transfer).toBeNull();
  });
});
