export function normalizeHex(input: string): string | null {
  const m = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(m)) return '#' + m.toLowerCase();
  if (/^[0-9a-fA-F]{3}$/.test(m)) {
    return (
      '#' +
      m
        .toLowerCase()
        .split('')
        .map((c) => c + c)
        .join('')
    );
  }
  return null;
}

function blend(hex: string, target: number, ratio: number): string {
  const v = hex.replace('#', '');
  const parts = [0, 2, 4].map((i) => {
    const c = parseInt(v.slice(i, i + 2), 16);
    return Math.round(c * (1 - ratio) + target * ratio)
      .toString(16)
      .padStart(2, '0');
  });
  return '#' + parts.join('');
}

export const blendWithWhite = (hex: string, ratio: number): string => blend(hex, 255, ratio);
export const blendWithBlack = (hex: string, ratio: number): string => blend(hex, 0, ratio);

export function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r1, g1, b1] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  const toHex = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return '#' + toHex(r1) + toHex(g1) + toHex(b1);
}

export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const v6 = hex.replace('#', '');
  const r = parseInt(v6.slice(0, 2), 16) / 255;
  const g = parseInt(v6.slice(2, 4), 16) / 255;
  const b = parseInt(v6.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}
