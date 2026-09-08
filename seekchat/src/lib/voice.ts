// v2.7 语音: playback + synthesis service. One shared expo-audio player,
// sequential queue, per-message mp3 cache under voicecache/. All MiniMax
// spend flows through synthesizeToCache; the pure prep/mood/cap logic lives
// in voicetext.ts and the fetch client in minimax.ts — this file is just the
// I/O glue (untested by design, same class as minimax.ts's ttsGenerate /
// engine.ts's generatePhoto) and stays React-free.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { getPref, setPref } from './db';
import { buildT2AInput, MINIMAX_HOSTS, ttsGenerate } from './minimax';
import { getVoiceDailyCap, type VoiceRegion } from './settings';
import { canSpeakToday, prepareSpeechText, voiceDayKey } from './voicetext';

const VOICE_DIR = `${FileSystem.documentDirectory}voicecache/`;

export class VoiceCapError extends Error {}

export interface SynthesizeOpts {
  apiKey: string;
  region: VoiceRegion;
  voiceId: string;
  speed: number;
  emotion?: string;
  readParens: boolean;
}

/** messageId → cached mp3 path, or null when there's nothing worth speaking.
 *  A cache hit costs nothing (no MiniMax call, no cap bump). A miss checks
 *  today's cap BEFORE spending, then bumps it by the API's own
 *  usage_characters (falling back to the prepared text's length when the
 *  response omits it) — never by the raw, unspoken text. */
export async function synthesizeToCache(
  messageId: string,
  rawText: string,
  opts: SynthesizeOpts,
): Promise<string | null> {
  const dest = `${VOICE_DIR}${messageId}.mp3`;
  const cached = await FileSystem.getInfoAsync(dest);
  if (cached.exists) return dest;
  const speech = prepareSpeechText(rawText, { readParens: opts.readParens });
  if (!speech) return null;
  const dayKey = voiceDayKey(new Date());
  const used = parseInt(getPref(dayKey) ?? '0', 10) || 0;
  if (!canSpeakToday(used, speech.length, getVoiceDailyCap())) {
    throw new VoiceCapError('今天的朗读额度用完了，明天再听吧。');
  }
  const input = buildT2AInput({
    text: speech, voiceId: opts.voiceId, speed: opts.speed, emotion: opts.emotion,
  });
  const res = await ttsGenerate(opts.apiKey, MINIMAX_HOSTS[opts.region], input);
  await FileSystem.makeDirectoryAsync(VOICE_DIR, { intermediates: true }).catch(() => {});
  await FileSystem.downloadAsync(res.url, dest);
  setPref(dayKey, String(used + (res.usageCharacters ?? speech.length)));
  return dest;
}

// ---- playback ----
// One shared player, created lazily on first use, plus a generation counter
// (mirrors background.ts's outreachGen). playFile/enqueueFiles/stopVoice all
// bump it; enqueueFiles' loop checks it before advancing to the next file, so
// a later call supersedes an earlier one instead of stacking on top of it.
let sharedPlayer: AudioPlayer | null = null;
let audioModeReady: Promise<void> | null = null;
let generation = 0;
let onFinish: (() => void) | null = null;

function ensureAudioMode(): Promise<void> {
  if (!audioModeReady) {
    // Android-only app: audible over silent/vibrate like any other media
    // playback; no background session for a short foreground-triggered clip.
    audioModeReady = setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false });
  }
  return audioModeReady;
}

function getPlayer(): AudioPlayer {
  if (!sharedPlayer) {
    sharedPlayer = createAudioPlayer(null);
    // error is AudioStatus's real failure signal ("Playback error message, or
    // null if no error" — playbackState/reasonForWaitingToPlay are plain
    // state/wait-reason strings, not error carriers). A corrupt/undecodable
    // file surfaces here instead of didJustFinish, so both wake the waiter.
    sharedPlayer.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish || status.error) onFinish?.();
    });
  }
  return sharedPlayer;
}

// Bumping always resolves whatever wait is pending first — an enqueueFiles
// loop that's mid-`await` wakes up, rechecks its own generation, and exits
// instead of hanging forever on a resolver nobody will ever call again.
function bumpGeneration(): number {
  generation++;
  const finish = onFinish;
  onFinish = null;
  finish?.();
  return generation;
}

// Defensive fallback — a corrupt/undecodable file might never signal
// didJustFinish or error at all. Without this a burst would stall on that
// one row until the next generation bump (silent truncation); a flat 60s
// cap instead lets enqueueFiles skip the bad row and keep going.
const FINISH_TIMEOUT_MS = 60_000;

function waitForFinish(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      onFinish = null;
      resolve();
    }, FINISH_TIMEOUT_MS);
    onFinish = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

/** Replaces the current source and plays it — stops/discards anything queued or playing. */
export async function playFile(path: string): Promise<void> {
  const myGen = bumpGeneration();
  await ensureAudioMode();
  if (myGen !== generation) return; // superseded while the audio-mode call was in flight
  const player = getPlayer();
  player.replace(path);
  player.play();
}

/** Plays paths in order, awaiting each file's finish before advancing. A
 *  later playFile/enqueueFiles/stopVoice bumps the generation; this loop
 *  notices at its two checkpoints and stops rather than fight the newer call. */
export async function enqueueFiles(paths: string[]): Promise<void> {
  const myGen = bumpGeneration();
  await ensureAudioMode();
  const player = getPlayer();
  for (const path of paths) {
    if (myGen !== generation) return;
    const finished = waitForFinish();
    player.replace(path);
    player.play();
    await finished;
    if (myGen !== generation) return;
  }
}

/** Stops playback and abandons any in-flight queue. */
export function stopVoice(): void {
  bumpGeneration();
  sharedPlayer?.pause();
}
