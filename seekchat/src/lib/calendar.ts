// 日历感 (v3.0 真实感): what today IS — a holiday, the user's birthday coming
// up — so she can mention it the way a real partner would. Pure. Lunar
// holidays cannot be computed without a table; they are hardcoded through
// 2028 (revisit then — the state block simply shows nothing after that).
export interface Holiday {
  name: string;
  month: number; // 1-12
  day: number;
}

const FIXED: Holiday[] = [
  { name: '元旦', month: 1, day: 1 },
  { name: '情人节', month: 2, day: 14 },
  { name: '妇女节', month: 3, day: 8 },
  { name: '劳动节', month: 5, day: 1 },
  { name: '520', month: 5, day: 20 },
  { name: '儿童节', month: 6, day: 1 },
  { name: '国庆节', month: 10, day: 1 },
  { name: '光棍节', month: 11, day: 11 },
  { name: '平安夜', month: 12, day: 24 },
  { name: '圣诞节', month: 12, day: 25 },
];

// Lunar-calendar holidays by Gregorian date, per year.
const LUNAR: Record<number, { name: string; month: number; day: number }[]> = {
  2026: [
    { name: '除夕', month: 2, day: 16 }, { name: '春节', month: 2, day: 17 },
    { name: '元宵节', month: 3, day: 3 }, { name: '清明节', month: 4, day: 5 },
    { name: '端午节', month: 6, day: 19 }, { name: '七夕', month: 8, day: 19 },
    { name: '中秋节', month: 9, day: 25 },
  ],
  2027: [
    { name: '除夕', month: 2, day: 5 }, { name: '春节', month: 2, day: 6 },
    { name: '元宵节', month: 2, day: 20 }, { name: '清明节', month: 4, day: 5 },
    { name: '端午节', month: 6, day: 9 }, { name: '七夕', month: 8, day: 8 },
    { name: '中秋节', month: 9, day: 15 },
  ],
  2028: [
    { name: '除夕', month: 1, day: 25 }, { name: '春节', month: 1, day: 26 },
    { name: '元宵节', month: 2, day: 9 }, { name: '清明节', month: 4, day: 4 },
    { name: '端午节', month: 5, day: 28 }, { name: '七夕', month: 8, day: 26 },
    { name: '中秋节', month: 10, day: 3 },
  ],
};

const sameDay = (h: { month: number; day: number }, d: Date): boolean =>
  h.month === d.getMonth() + 1 && h.day === d.getDate();

/** Holidays falling on `d` (fixed-date ones every year, lunar ones from the table). */
export function holidaysOn(d: Date): string[] {
  const out = FIXED.filter((h) => sameDay(h, d)).map((h) => h.name);
  for (const h of LUNAR[d.getFullYear()] ?? []) if (sameDay(h, d)) out.push(h.name);
  return out;
}

/** The next holiday within `withinDays` (exclusive of today), as "name（N天后）". */
export function upcomingHoliday(d: Date, withinDays = 3): string | null {
  for (let n = 1; n <= withinDays; n++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    const names = holidaysOn(day);
    if (names.length) return `${names[0]}（${n}天后）`;
  }
  return null;
}

/** 'MM-DD' (also accepts 'M-D', 'MM/DD', '5月20日') → normalized 'MM-DD' or null. */
export function normalizeBirthday(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d{1,2})[-/月.]\s*(\d{1,2})日?$/.exec(raw.trim());
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Days from `d` to the next occurrence of an 'MM-DD' birthday (0 = today). */
export function daysUntilBirthday(birthday: string | null, d: Date): number | null {
  const b = normalizeBirthday(birthday);
  if (!b) return null;
  const [mm, dd] = b.split('-').map((x) => parseInt(x, 10));
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  let next = new Date(d.getFullYear(), mm - 1, dd);
  if (next < today) next = new Date(d.getFullYear() + 1, mm - 1, dd);
  return Math.round((next.getTime() - today.getTime()) / 86400000);
}

/** State-block lines for today's calendar facts; empty when there are none. */
export function calendarLines(d: Date, birthday: string | null): string[] {
  const lines: string[] = [];
  const today = holidaysOn(d);
  if (today.length) lines.push(`今天是${today.join('、')}`);
  const soon = upcomingHoliday(d);
  if (soon) lines.push(`快到${soon}`);
  const n = daysUntilBirthday(birthday, d);
  if (n === 0) lines.push('今天是对方的生日');
  else if (n != null && n <= 7) lines.push(`对方的生日还有${n}天`);
  return lines;
}
