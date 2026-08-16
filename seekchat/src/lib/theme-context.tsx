import { createContext, ReactNode, useContext, useMemo, useState } from 'react';
import { deriveTheme, getStoredAccent, storeAccent, Theme } from './theme';

interface ThemeValue {
  th: Theme;
  accent: string;
  setAccent: (hex: string) => void;
}

const Ctx = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [accent, setAccentState] = useState(getStoredAccent());
  const value = useMemo<ThemeValue>(
    () => ({
      th: deriveTheme(accent),
      accent,
      setAccent: (hex: string) => {
        storeAccent(hex);
        setAccentState(hex);
      },
    }),
    [accent],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme must be used inside ThemeProvider');
  return v;
}
