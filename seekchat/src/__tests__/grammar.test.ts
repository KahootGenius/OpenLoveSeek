// v2.0 unified marker grammar contract. One table, every channel — a net that
// catches any extractor drifting away from the shared own-line grammar.
import { extractPatMarker } from '../lib/markers';
import { extractTransferMarker } from '../lib/transfer';
import { extractYandereMarkers } from '../lib/yandere';
import { extractMemoryMarkers } from '../lib/memory';
import { extractMasterMarkers } from '../lib/master';
import { extractStickerMarkers } from '../lib/stickers';
import { extractStateTag } from '../lib/statetag';

type Out = { clean: string } & Record<string, any>;
type Case = {
  channel: string;
  line: string; // a valid own-line marker
  extract: (t: string) => Out;
  fired: (o: Out) => boolean; // did the op register?
};

const OWN_LINE: Case[] = [
  {
    channel: '拍一拍',
    line: '[拍一拍:摸摸头]',
    extract: extractPatMarker,
    fired: (o) => o.pat === '摸摸头',
  },
  {
    channel: '转账',
    line: '[转账:5.20]',
    extract: extractTransferMarker,
    fired: (o) => o.amount === 5.2,
  },
  {
    channel: '病娇',
    line: '[病娇:锁屏]',
    extract: extractYandereMarkers,
    fired: (o) => o.lock === true,
  },
  {
    channel: '记忆',
    line: '[记忆:他喜欢下雨天]',
    extract: extractMemoryMarkers,
    fired: (o) => o.adds?.[0] === '他喜欢下雨天',
  },
  {
    channel: '表情',
    line: '[表情:开心]',
    extract: extractStickerMarkers,
    fired: (o) => o.labels?.[0] === '开心',
  },
];

describe('unified marker grammar', () => {
  it.each(OWN_LINE)('$channel: own-line fires and is cleaned', ({ line, extract, fired }) => {
    const out = extract(`正文第一句\n${line}`);
    expect(fired(out)).toBe(true);
    expect(out.clean).toContain('正文第一句');
    expect(out.clean).not.toContain(line);
  });

  it.each(OWN_LINE.filter((c) => c.channel !== '表情'))(
    '$channel: inline mention does NOT fire',
    ({ line, extract, fired }) => {
      const src = `她说${line}这不是真的操作`;
      const out = extract(src);
      expect(fired(out)).toBe(false);
      expect(out.clean).toBe(src);
    },
  );

  it('主人: fires anywhere (documented legacy tolerance, master.ts RE has no anchors)', () => {
    const out = extractMasterMarkers('顺便[主人:调教:+3]说一句');
    expect(out.disciplineDelta).toBe(3);
  });

  it('状态 envelope carries state only; a smuggled action surfaces in extras', () => {
    const { tag, extras } = extractStateTag('好呀\n【状态|心情:开心|强度:0.6|心想:嗯|表情:开心】');
    expect(tag?.mood).toBe('开心');
    expect(extras).toContain('表情:开心');
  });
});
