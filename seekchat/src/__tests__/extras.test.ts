import { routeTagExtras } from '../lib/extras';

const ALL = { master: true, yandere: true, stickers: true, memory: true };

describe('routeTagExtras', () => {
  it('forwards well-formed smuggled ops as marker lines', () => {
    expect(routeTagExtras(['主人:调教:+3'], ALL)).toEqual(['[主人:调教:+3]']);
    expect(routeTagExtras(['主人:立规:昵称就是呆桃，不许改'], ALL)).toEqual([
      '[主人:立规:昵称就是呆桃，不许改]',
    ]);
    expect(routeTagExtras(['病娇:锁屏'], ALL)).toEqual(['[病娇:锁屏]']);
    expect(routeTagExtras(['记忆:他生日是3月14日'], ALL)).toEqual(['[记忆:他生日是3月14日]']);
    expect(routeTagExtras(['忘记:3'], ALL)).toEqual(['[忘记:3]']);
    expect(routeTagExtras(['表情:开心'], ALL)).toEqual(['[表情:开心]']);
  });
  it('drops ops the target grammar rejects (they would leak as visible text)', () => {
    // The五 confirmed leak cases from the adversarial review:
    expect(routeTagExtras(['主人:惩罚:跪下'], ALL)).toEqual([]); // unknown subtype
    expect(routeTagExtras(['忘记:那件事'], ALL)).toEqual([]); // non-numeric index
    expect(routeTagExtras(['病娇:关机'], ALL)).toEqual([]); // unknown kind
    expect(routeTagExtras(['主人:命令:做[俯卧撑]20个'], ALL)).toEqual([]); // ] in payload truncates
    expect(routeTagExtras(['记忆:第一行\n第二行'], ALL)).toEqual([
      '[记忆:第一行 第二行]', // newline sanitized to a space, then round-trips
    ]);
  });
  it('drops ops whose channel is inactive', () => {
    const off = { master: false, yandere: false, stickers: false, memory: false };
    expect(routeTagExtras(['主人:调教:+3', '病娇:锁屏', '记忆:x', '表情:开心'], off)).toEqual([]);
  });
  it('drops unknown keys silently', () => {
    expect(routeTagExtras(['未知频道:什么东西'], ALL)).toEqual([]);
  });
});
