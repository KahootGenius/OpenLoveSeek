import {
  blendWithBlack, blendWithWhite, hexToHsv, hsvToHex, normalizeHex,
} from '../lib/color';

describe('normalizeHex', () => {
  it('accepts 6-digit hex with or without #, lowercases', () => {
    expect(normalizeHex('#3A6EA5')).toBe('#3a6ea5');
    expect(normalizeHex('3a6ea5')).toBe('#3a6ea5');
  });
  it('expands 3-digit shorthand', () => {
    expect(normalizeHex('abc')).toBe('#aabbcc');
    expect(normalizeHex('#F00')).toBe('#ff0000');
  });
  it('rejects invalid input', () => {
    expect(normalizeHex('12345')).toBeNull();
    expect(normalizeHex('#ggg000')).toBeNull();
    expect(normalizeHex('')).toBeNull();
  });
});

describe('blending', () => {
  it('blendWithWhite moves toward white', () => {
    expect(blendWithWhite('#000000', 0.5)).toBe('#808080');
    expect(blendWithWhite('#3a6ea5', 0)).toBe('#3a6ea5');
    expect(blendWithWhite('#3a6ea5', 1)).toBe('#ffffff');
  });
  it('blendWithBlack moves toward black', () => {
    expect(blendWithBlack('#ffffff', 0.5)).toBe('#808080');
    expect(blendWithBlack('#3a6ea5', 1)).toBe('#000000');
  });
});

describe('HSV conversion', () => {
  it('converts primary hues', () => {
    expect(hsvToHex(0, 1, 1)).toBe('#ff0000');
    expect(hsvToHex(120, 1, 1)).toBe('#00ff00');
    expect(hsvToHex(240, 1, 1)).toBe('#0000ff');
  });
  it('handles grayscale extremes', () => {
    expect(hsvToHex(0, 0, 1)).toBe('#ffffff');
    expect(hsvToHex(180, 0, 0)).toBe('#000000');
  });
  it('extracts hsv from hex', () => {
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
    const blue = hexToHsv('#3a6ea5');
    expect(blue.h).toBeGreaterThan(205);
    expect(blue.h).toBeLessThan(215);
  });
  it('round-trips within 1 per channel', () => {
    const { h, s, v } = hexToHsv('#3a6ea5');
    const back = hsvToHex(h, s, v);
    const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
    for (const i of [0, 1, 2]) {
      expect(Math.abs(ch(back, i) - ch('#3a6ea5', i))).toBeLessThanOrEqual(1);
    }
  });
});
