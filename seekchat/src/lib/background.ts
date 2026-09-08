import { AppState } from 'react-native';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import {
  getConversation, getPersona, getPref, insertMessage, listConversations,
  listMemories, listMessages, setPref, touchConversation,
} from './db';
import {
  fireCatchup, fireWatch, isStreaming, notifyConversation, setTurnGuard,
} from './engine';
import { runAutoReachSweep } from './autoreach';
import {
  getApiKey, getKeepAlive, getLocationEnabled, getModel, getTemperature, getUsageMode,
} from './settings';
import { chatOnce } from './deepseek';
import { SUMMARY_PREFIX, TRIGGER_NUDGE } from './constants';
import { buildMemoryEvidence, buildMemoryInstructions } from './memory';
import { composeOutreachPrompt } from './prompt-envelope';
import { buildExampleSection, buildProSections, hasRealismConfig, parseProConfig } from './pro';
import { renderPrompt } from './prompts';
import { stripLeakedStateTags } from './statetag';
import { countTodayReaches, REACH_DAILY_CAP } from './reach';
import { native } from './native';
import { setLiveGeo, setLiveUsage } from './livestate';
import {
  createOutreachCancellationGate, isStaleSchedule, parseOutreachLines,
  partitionScheduledConversation, pickFireTimes, ScheduledMsg, splitDue,
} from './outreach';
import { pickCatchupApp, shouldCatchup } from './presence';
import { shouldReactToApp, WATCH_COOLDOWN_DEFAULT_MIN } from './watch';

const TASK = 'seekchat-auto-reach';
const CHANNEL = 'reach';

function notifyReach(title: string, body: string): void {
  void Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null,
  });
}

// Must be defined at module scope; the module is imported by the root layout
// so the definition exists even when the app is launched headless by the OS.
TaskManager.defineTask(TASK, async () => {
  try {
    console.log('[seekchat:bg] background task woke');
    await runAutoReachSweep(new Date(), notifyReach);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    console.log('[seekchat:bg] failed:', e);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Permission + channel + handler — every notification-posting path needs this,
 *  not just 后台主动联系 (watch and keep-alive reach notify too). */
export async function ensureNotifPermission(): Promise<boolean> {
  const perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return false;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: '主动消息',
    importance: Notifications.AndroidImportance.MAX,
  });
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  return true;
}

export async function enableBackgroundReach(): Promise<boolean> {
  if (!(await ensureNotifPermission())) return false;
  await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 });
  console.log('[seekchat:bg] registered');
  return true;
}

export async function disableBackgroundReach(): Promise<void> {
  try {
    await BackgroundTask.unregisterTaskAsync(TASK);
  } catch {
    // not registered — fine
  }
}

// ---- keep-alive foreground service (real builds only) ----

export const keepAliveSupported = (): boolean => native != null;
export const keepAliveRunning = (): boolean => native?.isKeepAliveRunning() ?? false;
export const startKeepAliveService = (): boolean =>
  native?.startKeepAlive('LoveSeek', '守护中——她在后台陪着你') ?? false;
export const stopKeepAliveService = (): void => native?.stopKeepAlive();
export const batteryOptIgnored = (): boolean =>
  native?.isIgnoringBatteryOptimizations() ?? false;
export const requestBatteryOptExemption = (): boolean =>
  native?.requestIgnoreBatteryOptimizations() ?? false;

/**
 * Turn guard: while a reply streams, run the foreground service so switching
 * apps no longer freezes the process mid-generation. If 后台守护 is off, the
 * service stops again when the turn ends.
 */
let guardDepth = 0;
let guardStarted = false;
export function installTurnGuard(): void {
  const n = native;
  if (!n) return;
  setTurnGuard({
    begin: () => {
      guardDepth++;
      if (guardDepth === 1 && !n.isKeepAliveRunning()) {
        guardStarted = n.startKeepAlive('LoveSeek', '正在回复…');
      }
    },
    end: () => {
      guardDepth = Math.max(0, guardDepth - 1);
      if (guardDepth === 0 && guardStarted) {
        guardStarted = false;
        if (!getKeepAlive()) n.stopKeepAlive();
      }
    },
  });
}

// ---- 屏幕窥视 (app watch) + background auto-reach via native ticks ----
//
// While the keep-alive service runs, the native module delivers "onTick"
// (Handler-driven — reliable in background where JS timers may freeze).

let prevPkg: string | null = null;
let lastReactAt = 0;
let watchSub: { remove(): void } | null = null;

// Diagnostics: the field can't attach a debugger, so the settings screen
// shows exactly how far each tick got.
let lastTickAt = 0;
let lastWatchNote = '还没有收到心跳（需开启「后台守护」）';
export interface WatchDebug {
  keepAlive: boolean;
  lastTickAt: number;
  note: string;
}
export const getWatchDebug = (): WatchDebug => ({
  keepAlive: keepAliveRunning(),
  lastTickAt,
  note: lastWatchNote,
});

/** Refresh the volatile device readings (location, today's usage) that the
 *  engine injects into context. Cheap; called on foreground and each tick. */
export function refreshLiveReadings(): void {
  const n = native;
  if (!n) return;
  if (getLocationEnabled()) setLiveGeo(n.getLocation());
  if (getUsageMode() !== 'off' && n.hasUsageAccess()) setLiveUsage(n.getUsageToday());
}

/**
 * Catch-up on return (the RELIABLE 屏幕窥视 path): when the user reopens the
 * app after `awayMs`, replay the apps they used while away and let the most
 * recent watch-enabled persona react. Runs in the foreground where JS is alive.
 */
const CATCHUP_WINDOW_CAP_MS = 6 * 3600000; // don't scan more than 6h of UsageStats

export function runCatchupOnReturn(awayMs: number): void {
  const n = native;
  if (!n || !n.hasUsageAccess()) return;
  if (awayMs < 90_000) return; // too short to be worth a native query (mirrors shouldCatchup)
  const apps = n.getForegroundAppsSince(Date.now() - Math.min(awayMs, CATCHUP_WINDOW_CAP_MS));
  const app = pickCatchupApp(apps);
  if (!app) return;
  for (const c of listConversations()) {
    const persona = getPersona(c.personaId);
    const cfg = persona ? parseProConfig(persona.proConfig) : null;
    if (!(cfg?.yandere && cfg.yandereConsent && cfg.watchApps && cfg.watchConsent)) continue;
    const cooldownMs = (cfg.watchCooldownMin ?? WATCH_COOLDOWN_DEFAULT_MIN) * 60000;
    if (!shouldCatchup({ awayMs, app, lastReactAt, cooldownMs, now: Date.now() })) return;
    if (isStreaming(c.id)) return; // a turn is in flight — don't spend the cooldown on a no-op
    lastReactAt = Date.now();
    lastWatchNote = `窥屏（回归）：对「${app.label}」做出反应`;
    void fireCatchup(c.id, app.label, {
      onDelta: () => {},
      onDone: (m) => {
        // Catch-up runs on return to the foreground; the reply is already on
        // screen, so only notify if the user has since left again.
        if (AppState.currentState !== 'active') {
          notifyReach(
            c.title,
            (m.kind === 'image' ? '[照片]' : m.kind === 'sticker' ? '[表情包]' : m.content)
              .split('---')[0].trim().slice(0, 80),
          );
        }
      },
      onError: () => {},
    });
    return;
  }
}

/** Send a test notification (self-test). */
export async function testNotify(): Promise<string> {
  if (!(await ensureNotifPermission())) return '通知权限被拒绝——去系统设置里允许通知';
  notifyReach('LoveSeek 测试', '看到这条就说明通知通道正常 ✓');
  return '已发送测试通知，看一眼通知栏';
}

/** One-shot status snapshot for the self-test panel (notif perm is async). */
export async function getDiagnostics(): Promise<{
  notif: boolean;
  usage: boolean;
  battery: boolean;
  keepAlive: boolean;
  lastTickAt: number;
  note: string;
}> {
  const perm = await Notifications.getPermissionsAsync().catch(() => null);
  return {
    notif: perm?.granted ?? false,
    usage: native?.hasUsageAccess() ?? false,
    battery: batteryOptIgnored(),
    keepAlive: keepAliveRunning(),
    lastTickAt,
    note: lastWatchNote,
  };
}

/** Force a watch reaction now (self-test), bypassing cooldown. */
export function testFireWatch(): string {
  const n = native;
  if (!n) return '原生模块不可用（需正式 APK）';
  if (!n.hasUsageAccess()) return '未获得「使用情况访问」权限';
  const fg = n.getForegroundApp();
  const label = fg && !fg.self ? fg.label : '（刚才用过的应用）';
  for (const c of listConversations()) {
    const persona = getPersona(c.personaId);
    const cfg = persona ? parseProConfig(persona.proConfig) : null;
    if (!(cfg?.yandere && cfg.yandereConsent && cfg.watchApps && cfg.watchConsent)) continue;
    lastReactAt = Date.now();
    void fireCatchup(c.id, label, {
      onDelta: () => {},
      onDone: (m) =>
        notifyReach(
          c.title,
          (m.kind === 'image' ? '[照片]' : m.kind === 'sticker' ? '[表情包]' : m.content)
            .split('---')[0].slice(0, 80),
        ),
      onError: () => {},
    });
    return `已让「${c.title}」对「${label}」做出反应`;
  }
  return '没有开启了「屏幕窥视」的对话（在人设里开病娇+屏幕窥视并保存）';
}

/** Force an auto-reach now (self-test), ignoring schedule/rate gating. */
export async function testFireReach(): Promise<string> {
  for (const c of listConversations()) {
    if (c.lifeEnabled !== 1) continue;
    let ok = false;
    const { fireTrigger } = await import('./engine');
    await fireTrigger(c.id, 'manual', {
      onDelta: () => {},
      onDone: (m) => {
        ok = true;
        notifyReach(
          c.title,
          (m.kind === 'image' ? '[照片]' : m.kind === 'sticker' ? '[表情包]' : m.content)
            .split('---')[0].slice(0, 80),
        );
      },
      onError: () => {},
    });
    if (ok) return `已让「${c.title}」主动发了一条`;
  }
  return '没有开启了「生活」的对话';
}

function onNativeTick(): void {
  const n = native;
  if (!n) return;
  lastTickAt = Date.now();
  refreshLiveReadings(); // keep location / today's usage current for the engine
  // Backgrounded auto-reach: the foreground minute-ticker is frozen, so the
  // native tick stands in, with the same 1/15 jitter roll — but only when the
  // user actually enabled 后台主动联系 (keep-alive alone must not spend money).
  if (
    AppState.currentState !== 'active' &&
    getPref('backgroundReach') === '1' &&
    Math.random() <= 1 / 15
  ) {
    void runAutoReachSweep(new Date(), notifyReach);
  }
  if (!n.hasUsageAccess()) {
    lastWatchNote = '窥屏：未获得「使用情况访问」权限';
    return;
  }
  const fg = n.getForegroundApp();
  if (!fg) {
    lastWatchNote = '窥屏：近2分钟无前台应用切换事件';
    return;
  }
  const prev = prevPkg;
  prevPkg = fg.packageName;
  // Screen off (usage events lag up to 2 min) or LoveSeek itself in front:
  // the user isn't "using another app" — track the package, don't react.
  if (AppState.currentState === 'active' || !n.isInteractive()) {
    lastWatchNote = `窥屏：待机（本应用在前台或已息屏；最近看到：${fg.label}）`;
    return;
  }
  for (const c of listConversations()) {
    const persona = getPersona(c.personaId);
    const cfg = persona ? parseProConfig(persona.proConfig) : null;
    if (!(cfg?.yandere && cfg.yandereConsent && cfg.watchApps && cfg.watchConsent)) continue;
    const cooldownMs = (cfg.watchCooldownMin ?? WATCH_COOLDOWN_DEFAULT_MIN) * 60000;
    const react = shouldReactToApp({
      pkg: fg.packageName,
      ownPkg: fg.self,
      prevPkg: prev,
      lastReactAt,
      cooldownMs,
      now: Date.now(),
    });
    if (!react) {
      lastWatchNote = `窥屏：看到「${fg.label}」但未触发（冷却中、系统应用或未切换）`;
      return;
    }
    if (isStreaming(c.id)) {
      lastWatchNote = '窥屏：她正在回复，稍后再看';
      return; // don't spend the cooldown while a turn is active (fireWatch would no-op)
    }
    lastReactAt = Date.now();
    lastWatchNote = `窥屏：已对「${fg.label}」做出反应`;
    console.log('[seekchat:watch] reacting to', fg.label);
    void fireWatch(c.id, fg.label, {
      onDelta: () => {},
      onDone: (m) =>
        notifyReach(
          c.title,
          (m.kind === 'image' ? '[照片]' : m.kind === 'sticker' ? '[表情包]' : m.content)
            .split('---')[0].trim().slice(0, 80),
        ),
      onError: () => {},
    });
    return; // the most recent watch-enabled conversation reacts; one per tick
  }
  lastWatchNote = '窥屏：没有开启了「屏幕窥视」的对话（需在人设里开病娇+屏幕窥视并保存）';
}

export function startAppWatch(): void {
  if (!native || watchSub) return;
  watchSub = native.addListener('onTick', onNativeTick);
}

// ---- 预生成主动消息 (scheduled outreach) ----
//
// The ROM freezes the app in the background (measured: heartbeat stops, thaws
// on return), so nothing in-process runs while away. But SYSTEM-scheduled
// notifications deliver even while frozen. Lifecycle (redesigned after review):
//   PLAN on background-leave / launch (throttled) — pre-write her lines and
//     hand them to the OS for 主动 windows while away.
//   INGEST on foreground-return — fold delivered lines into history stamped as
//     the NEWEST messages (never backdated behind existing history), then let
//     live outreach take over.
// This keeps planning off the per-turn path and keeps history ordered.

const SCHED_KEY = 'scheduledOutreach';
const SYNC_THROTTLE_MS = 15 * 60000;

function readSched(): ScheduledMsg[] {
  try {
    const v = JSON.parse(getPref(SCHED_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
const writeSched = (items: ScheduledMsg[]): void => setPref(SCHED_KEY, JSON.stringify(items));
const cancelNotif = (id: string): Promise<void> =>
  Notifications.cancelScheduledNotificationAsync(id).catch(() => {});

/**
 * Fold OS-delivered outreach into conversation history (call BEFORE anything
 * reads the conversation, on launch/resume, and from the fire listener). Each
 * pair is stamped as the NEWEST message (max of fire time and last message +1)
 * so it never sorts behind later chat or past the summary boundary. Idempotent
 * via a fresh read + write of the remaining future items.
 */
export function ingestDueOutreach(): number {
  const items = readSched();
  if (items.length === 0) return 0;
  const { due } = splitDue(items, Date.now());
  let folded = 0;
  for (const d of due) {
    if (!getConversation(d.conversationId)) continue;
    const msgs = listMessages(d.conversationId);
    const lastUserAt =
      [...msgs].reverse().find((m) => m.role === 'user' && m.kind === 'normal')?.createdAt ?? 0;
    // A line the user has already outdated (chatted after it was written) would
    // read as her ignoring what was just said — the notification fired, but
    // don't fold a stale line into the chat.
    if (isStaleSchedule(d.generatedAt, lastUserAt)) continue;
    const lastAt = msgs.length ? msgs[msgs.length - 1].createdAt : 0;
    const at = Math.max(d.fireAt, lastAt + 1); // always the newest — never backdated behind history
    insertMessage(d.conversationId, 'user', TRIGGER_NUDGE, 'complete', 'trigger', null, at);
    insertMessage(d.conversationId, 'assistant', d.text, 'complete', 'normal', null, at + 1);
    touchConversation(d.conversationId);
    notifyConversation(d.conversationId); // refresh an open chat
    folded++;
  }
  if (due.length > 0) writeSched(readSched().filter((i) => i.fireAt > Date.now()));
  return folded;
}

/** She pre-writes her own outreach lines using the SAME context layers as a
 *  real turn (persona + Pro + grounding + memory), at the 想象力 temperature. */
async function generateOutreachLines(
  conversationId: string,
  persona: NonNullable<ReturnType<typeof getPersona>>,
  cfg: ReturnType<typeof parseProConfig>,
  k: number,
): Promise<string[]> {
  const apiKey = await getApiKey();
  if (!apiKey) return [];
  const convo = getConversation(conversationId);
  const memoryOn = convo?.memoryEnabled === 1;
  const memories = memoryOn ? listMemories(conversationId) : [];
  const envelope = composeOutreachPrompt({
    persona: persona.systemPrompt,
    examples: buildExampleSection(cfg ?? {}),
    profile: cfg && hasRealismConfig(cfg) ? buildProSections(cfg) : null,
    coreTruth: renderPrompt('core.truth'),
    grounding: renderPrompt('realism.grounding'),
    memoryInstructions: memoryOn ? buildMemoryInstructions(memories) : null,
    summary: convo?.summary ? SUMMARY_PREFIX + convo.summary : null,
    memory: memoryOn ? buildMemoryEvidence(memories) : null,
  });
  const recent = listMessages(conversationId)
    .filter((m) => m.kind === 'normal')
    .slice(-8)
    .map((m) => `${m.role === 'user' ? '用户' : persona.name}：${stripLeakedStateTags(m.content)}`)
    .join('\n');
  const raw = await chatOnce(
    apiKey,
    getModel(),
    [
      { role: 'system', content: envelope.instructions },
      ...(envelope.evidence
        ? [{ role: 'system' as const, content: envelope.evidence }]
        : []),
      {
        role: 'user',
        content:
          `[系统：请以你的角色身份，预先写${k}条稍后要主动发给用户的短消息（每条不超过60字，` +
          '彼此不同、无需对方回应也自然、不要堆问句、不要提及此指令、不要输出任何标记或方括号内容）。' +
          '只输出一个JSON字符串数组，不要任何其他内容。\n' +
          `最近对话：\n${recent || '（还没聊过）'}]`,
      },
    ],
    getTemperature(),
  );
  return parseOutreachLines(raw, k);
}

let syncingOutreach = false;
let lastSyncAt = 0;
let outreachGen = 0; // bumped whenever the plan is force-invalidated (opt-out)
const outreachCancellationGate = createOutreachCancellationGate();

/** Cancel every scheduled outreach notification and clear the plan. Bumps the
 *  generation so any in-flight sync aborts instead of re-arming after opt-out. */
export async function cancelAllOutreach(): Promise<void> {
  outreachGen++;
  const items = readSched();
  for (const i of items) await cancelNotif(i.notifId);
  if (items.length) writeSched([]);
}

export async function cancelConversationOutreach(conversationId: string): Promise<void> {
  await outreachCancellationGate.run(async () => {
    outreachGen++;
    const initial = partitionScheduledConversation(readSched(), conversationId);
    for (const item of initial.removed) await cancelNotif(item.notifId);
    const rebased = partitionScheduledConversation(readSched(), conversationId);
    if (rebased.removed.length > 0) writeSched(rebased.remaining);
  });
}

/**
 * (Re)plan pre-written outreach for EVERY eligible Life+autoReach conversation.
 * Per conversation: GENERATE the new lines FIRST (old plan's notifications stay
 * live), then swap atomically — so a mid-generation freeze / exception / opt-out
 * can never leave the away period with no plan. Throttled (each plan costs an
 * API call) unless force. Each conversation is isolated (own try/catch + own
 * rebased write) and honors a mid-flight opt-out via the generation counter.
 */
export async function syncScheduledOutreach(force = false): Promise<void> {
  if (outreachCancellationGate.isActive()) return;
  if (syncingOutreach) return;
  if (getPref('backgroundReach') !== '1') return void cancelAllOutreach();
  const now = Date.now();
  if (!force && now - lastSyncAt < SYNC_THROTTLE_MS) return;
  syncingOutreach = true;
  const myGen = outreachGen;
  const aborted = () => outreachGen !== myGen || getPref('backgroundReach') !== '1';
  try {
    const eligible = new Map<string, { persona: NonNullable<ReturnType<typeof getPersona>>; cfg: NonNullable<ReturnType<typeof parseProConfig>> }>();
    for (const c of listConversations()) {
      if (c.lifeEnabled !== 1) continue;
      const persona = getPersona(c.personaId);
      const cfg = persona ? parseProConfig(persona.proConfig) : null;
      if (persona && cfg?.autoReach && cfg.autoReachConsent === true) {
        eligible.set(c.id, { persona, cfg });
      }
    }
    // Drop plans for conversations no longer eligible / deleted.
    const orphans = readSched().filter((i) => !eligible.has(i.conversationId));
    if (orphans.length) {
      for (const i of orphans) await cancelNotif(i.notifId);
      writeSched(readSched().filter((i) => eligible.has(i.conversationId)));
    }
    for (const [cid, { persona, cfg }] of eligible) {
      if (aborted()) return; // opted out mid-sync — stop; don't pay for more convos
      // `fresh` lives outside the try so the catch can undo OS-scheduled notifs
      // that were never persisted (a scheduleNotificationAsync throw mid-loop).
      const fresh: ScheduledMsg[] = [];
      try {
        const c = getConversation(cid);
        if (!c) continue; // deleted mid-sync — orphan cleanup above / next run handles it
        const msgs = listMessages(cid);
        const lastUserAt =
          [...msgs].reverse().find((m) => m.role === 'user' && m.kind === 'normal')?.createdAt ?? 0;
        const mine = readSched().filter((i) => i.conversationId === cid);
        const hasFreshFuture =
          mine.some((i) => i.fireAt > now) &&
          !isStaleSchedule(Math.min(...mine.map((i) => i.generatedAt)), lastUserAt);
        if (hasFreshFuture) continue; // current plan still fits — leave it (no API call)
        const dropStale = () => {
          const ids = new Set(mine.map((i) => i.notifId));
          writeSched(readSched().filter((i) => !ids.has(i.notifId)));
        };
        const room = REACH_DAILY_CAP - countTodayReaches(msgs, now);
        const times =
          room > 0
            ? pickFireTimes({ schedule: cfg.schedule, rate: cfg.reachRate, now, count: Math.min(2, room) })
            : [];
        if (times.length === 0) {
          for (const i of mine) await cancelNotif(i.notifId); // no window/cap — retire stale plan
          dropStale();
          continue;
        }
        // Generate BEFORE cancelling: if this fails/freezes, the old plan lives.
        const texts = await generateOutreachLines(cid, persona, cfg, times.length);
        if (texts.length === 0 || aborted()) continue;
        const generatedAt = Date.now();
        for (let k = 0; k < times.length && k < texts.length; k++) {
          const notifId = await Notifications.scheduleNotificationAsync({
            content: { title: c.title, body: texts[k].split('---')[0].trim().slice(0, 80) },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(times[k]) },
          });
          fresh.push({ conversationId: cid, text: texts[k], fireAt: times[k], notifId, generatedAt });
        }
        for (const i of mine) await cancelNotif(i.notifId); // now retire the old plan
        // Final abort re-check: no await between here and the persist, so an
        // opt-out landing during the cancel loop above can't slip past.
        if (aborted()) {
          for (const f of fresh) await cancelNotif(f.notifId);
          return;
        }
        writeSched([...readSched().filter((i) => i.conversationId !== cid), ...fresh]);
      } catch (e) {
        // A throw after some notifs were scheduled would orphan them (fire but
        // never fold, never cancellable) — undo them here.
        for (const f of fresh) await cancelNotif(f.notifId);
        console.log('[seekchat:outreach] convo plan failed:', e); // isolate — other convos proceed
      }
    }
    lastSyncAt = now;
  } catch (e) {
    console.log('[seekchat:outreach] sync failed:', e);
  } finally {
    syncingOutreach = false;
  }
}

/** Fold a notification that fired while the app is alive (foreground or the
 *  brief pre-freeze window) straight into history — no lost line, no backdate. */
let outreachFireSub: { remove(): void } | null = null;
export function installOutreachListener(): void {
  if (outreachFireSub) return;
  outreachFireSub = Notifications.addNotificationReceivedListener(() => {
    ingestDueOutreach();
  });
}
