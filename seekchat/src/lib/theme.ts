import { getPref, setPref } from './db';
import { blendWithWhite } from './color';

export interface Theme {
  accent: string;     // buttons, links, chip text
  accentSoft: string; // chip/pill backgrounds
  userBubble: string; // the user's message bubbles
}

export const DEFAULT_ACCENT = '#3a6ea5';

// Pre-context storage kept for legacy preset ids written by the first version.
const LEGACY_PRESETS: Record<string, string> = {
  blue: '#3a6ea5', teal: '#0f6e56', purple: '#534ab7',
  pink: '#993556', amber: '#854f0b', ink: '#2c2c2a',
};

export function deriveTheme(accent: string): Theme {
  return {
    accent,
    accentSoft: blendWithWhite(accent, 0.86),
    userBubble: blendWithWhite(accent, 0.76),
  };
}

export function getStoredAccent(): string {
  const hex = getPref('accentHex');
  if (hex) return hex;
  const legacy = getPref('themeId');
  if (legacy && LEGACY_PRESETS[legacy]) return LEGACY_PRESETS[legacy];
  return DEFAULT_ACCENT;
}

export function storeAccent(hex: string): void {
  setPref('accentHex', hex);
}
