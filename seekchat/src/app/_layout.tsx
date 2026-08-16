import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { getPref, migrate, setPref } from '../lib/db';
import { runAutoReachSweep } from '../lib/autoreach';
import { isExpoGo } from '../lib/env';
import { getKeepAlive } from '../lib/settings';
import { ThemeProvider } from '../lib/theme-context';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const bg = () => require('../lib/background') as typeof import('../lib/background');

// Module scope on purpose: side effects must not live in useMemo — the React
// Compiler (on by default in SDK 57) may drop "pure" callbacks whose result
// is unused. Here it runs once at bundle load, before any screen can render.
migrate();
// Background machinery must never be EVALUATED in Expo Go: expo-notifications
// throws at import time there (Android push removal, SDK 53+). In real builds
// the synchronous require also defines the headless task at bundle load.
if (!isExpoGo) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const bg = require('../lib/background') as typeof import('../lib/background');
  if (getPref('backgroundReach') === '1') void bg.enableBackgroundReach();
  bg.installTurnGuard(); // foreground service while a reply streams
  bg.startAppWatch(); // 屏幕窥视 + backgrounded auto-reach, via native ticks
  bg.installOutreachListener(); // fold a notification that fires while alive
  if (getKeepAlive()) bg.startKeepAliveService();
  bg.ingestDueOutreach(); // fold OS-delivered outreach into history FIRST
  void bg.syncScheduledOutreach();
}

/**
 * Foreground auto-reach ticker: once a minute, while the app is active, at
 * most ONE Life conversation whose persona allows outreach right now (and is
 * past its rate interval) may fire. The 1/15 roll turns "due" into "fires
 * within ~15 minutes of due" — jitter, so she never texts on a metronome.
 */
function useAutoReach() {
  useEffect(() => {
    const tick = () => {
      if (AppState.currentState !== 'active') return;
      if (Math.random() > 1 / 15) return;
      void runAutoReachSweep(new Date()); // one per tick, app-wide
    };
    const h = setInterval(tick, 60000);
    return () => clearInterval(h);
  }, []);
}

/**
 * Presence + catch-up on return. True background is unreliable on CN ROMs, so
 * the moment the user comes BACK we refresh device readings and let her react
 * to what they did while away — this runs in the foreground where JS is alive.
 */
function usePresence() {
  const leftAt = useRef(0);
  useEffect(() => {
    if (isExpoGo) return;
    bg().refreshLiveReadings(); // warm location/usage at launch
    // Cold start after a ROM kill: the in-memory ref died with the process, so
    // the leave time only survives in a pref. This is the whole point of
    // catch-up — the ROM-kill case — so read it here at mount.
    const persisted = Number(getPref('leftAt') || 0);
    if (persisted > 0) {
      setPref('leftAt', '0');
      const awayMs = Date.now() - persisted;
      if (awayMs > 0) bg().runCatchupOnReturn(awayMs);
    }
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        const awayMs = leftAt.current ? Date.now() - leftAt.current : 0;
        leftAt.current = 0;
        setPref('leftAt', '0');
        bg().ingestDueOutreach(); // delivered-while-away lines enter history first
        bg().refreshLiveReadings();
        // 角色朋友圈 (v2.3): daily-capped, probabilistic — most foregrounds no-op.
        void import('../lib/feed').then((f) => f.maybeCharPosts());
        if (awayMs > 0) bg().runCatchupOnReturn(awayMs);
      } else if (state === 'background' || state === 'inactive') {
        if (!leftAt.current) {
          leftAt.current = Date.now();
          setPref('leftAt', String(leftAt.current)); // survive a background process kill
          // Plan her outreach for the trip away (throttled; force so a real
          // leave always refreshes if stale).
          void bg().syncScheduledOutreach(true);
        }
      }
    });
    return () => sub.remove();
  }, []);
}

export default function RootLayout() {
  useAutoReach();
  usePresence();
  return (
    <ThemeProvider>
      <Stack>
        <Stack.Screen name="index" options={{ title: '对话' }} />
        <Stack.Screen name="chat/[id]" options={{ title: '' }} />
        <Stack.Screen name="personas" options={{ title: '人设' }} />
        <Stack.Screen name="persona/[id]" options={{ title: '编辑人设' }} />
        <Stack.Screen name="settings" options={{ title: '设置' }} />
        <Stack.Screen name="moments" options={{ title: '朋友圈' }} />
        <Stack.Screen name="prompts" options={{ title: '提示词工作室' }} />
        <Stack.Screen name="group-new" options={{ title: '发起群聊' }} />
        <Stack.Screen name="group/[id]" options={{ title: '' }} />
      </Stack>
    </ThemeProvider>
  );
}
