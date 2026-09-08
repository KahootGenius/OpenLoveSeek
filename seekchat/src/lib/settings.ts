import * as SecureStore from 'expo-secure-store';
import { getPref, setPref } from './db';
import { DEFAULT_MODEL, HISTORY_BUDGET } from './constants';
import type { DeliveryMode, ModelId } from './types';
import type { UsageMode } from './usage';

const KEY_NAME = 'deepseek_api_key';

export const getApiKey = (): Promise<string | null> => SecureStore.getItemAsync(KEY_NAME);
export const setApiKey = (key: string): Promise<void> =>
  SecureStore.setItemAsync(KEY_NAME, key.trim());

// fal.ai key (v2.6): BYO, stored exactly like the DeepSeek key above.
const FAL_KEY_NAME = 'fal_api_key';

export const getFalKey = (): Promise<string | null> => SecureStore.getItemAsync(FAL_KEY_NAME);
export const setFalKey = (key: string): Promise<void> =>
  SecureStore.setItemAsync(FAL_KEY_NAME, key.trim());

// 图片功能: master switch for persona reference images + chat-time photos.
// Default off — no fal calls happen until the user opts in with their own key.
export const getImageFeature = (): boolean => getPref('imageFeature') === '1';
export const setImageFeature = (on: boolean): void => setPref('imageFeature', on ? '1' : '0');

// 每日照片上限 (per conversation). Default 5, clamped 1..50.
export const getImageDailyCap = (): number => {
  const n = parseInt(getPref('imageDailyCap') ?? '', 10);
  return Number.isNaN(n) ? 5 : Math.min(50, Math.max(1, n));
};
export const setImageDailyCap = (n: number): void =>
  setPref('imageDailyCap', String(Math.min(50, Math.max(1, n))));

const VALID_MODELS: ModelId[] = ['deepseek-v4-flash', 'deepseek-v4-pro'];

export const getModel = (): ModelId => {
  const v = getPref('model') as ModelId | null;
  // Falls back for unset AND for legacy stored values (deepseek-chat/-reasoner).
  return v && VALID_MODELS.includes(v) ? v : DEFAULT_MODEL;
};
export const setModel = (m: ModelId): void => setPref('model', m);

export const getDeliveryMode = (): DeliveryMode =>
  (getPref('deliveryMode') as DeliveryMode) ?? 'typewriter';
export const setDeliveryMode = (m: DeliveryMode): void => setPref('deliveryMode', m);

export const getUserNickname = (): string => getPref('userNickname') ?? '我';
export const setUserNickname = (n: string): void => setPref('userNickname', n.trim() || '我');

export const getUserAvatar = (): string | null => getPref('userAvatar');
export const setUserAvatar = (uri: string): void => setPref('userAvatar', uri);

export const getShowNicknames = (): boolean => getPref('showNicknames') === '1';
export const setShowNicknames = (on: boolean): void => setPref('showNicknames', on ? '1' : '0');

export const getMarkdownEnabled = (): boolean => getPref('markdown') === '1';
export const setMarkdownEnabled = (on: boolean): void => setPref('markdown', on ? '1' : '0');

export const getThinkingEnabled = (): boolean => getPref('thinking') === '1';
export const setThinkingEnabled = (on: boolean): void => setPref('thinking', on ? '1' : '0');

export const getShowThinking = (): boolean => getPref('showThinking') === '1';
export const setShowThinking = (on: boolean): void => setPref('showThinking', on ? '1' : '0');

// 合并回复: hold the reply while the user is still sending fragments. Default ON.
export const getMergeReplies = (): boolean => getPref('mergeReplies') !== '0';
export const setMergeReplies = (on: boolean): void => setPref('mergeReplies', on ? '1' : '0');

export const getMergeHoldSec = (): number => {
  const n = parseInt(getPref('mergeHoldSec') ?? '', 10);
  return Number.isNaN(n) ? 4 : Math.min(30, Math.max(1, n));
};
export const setMergeHoldSec = (sec: number): void => setPref('mergeHoldSec', String(sec));

// 转账钱包: the user's virtual balance (they top it up freely). Default 520.
export const getUserBalance = (): number => {
  const n = parseFloat(getPref('userBalance') ?? '');
  return Number.isNaN(n) ? 520 : Math.max(0, Math.round(n * 100) / 100);
};
export const setUserBalance = (n: number): void =>
  setPref('userBalance', String(Math.max(0, Math.round(n * 100) / 100)));

// 后台守护: persistent foreground service (real builds only).
export const getKeepAlive = (): boolean => getPref('keepAlive') === '1';
export const setKeepAlive = (on: boolean): void => setPref('keepAlive', on ? '1' : '0');

// 想象力 (temperature): lower = grounded/factual, higher = inventive. Default 1.0.
export const getTemperature = (): number => {
  const n = parseFloat(getPref('temperature') ?? '');
  return Number.isNaN(n) ? 1.0 : Math.min(1.5, Math.max(0.1, n));
};
export const setTemperature = (t: number): void => setPref('temperature', String(t));

// 消息切割: split a long reply into several real bubbles (external cutter
// call, char-identity guarded). Default ON.
export const getMsgCut = (): boolean => getPref('msgCut') !== '0';
export const setMsgCut = (on: boolean): void => setPref('msgCut', on ? '1' : '0');

// 动态想象力: a per-message classifier picks 严谨/平衡/奔放 before each reply;
// the manual temperature above is the fallback when the classifier fails.
export type TempMode = 'manual' | 'dynamic';
export const getTempMode = (): TempMode =>
  getPref('tempMode') === 'dynamic' ? 'dynamic' : 'manual';
export const setTempMode = (m: TempMode): void => setPref('tempMode', m);

// 开发者模式: surface machinery events ('她查看了你的屏幕…') as chat meta lines.
export const getDevMode = (): boolean => getPref('devMode') === '1';
export const setDevMode = (on: boolean): void => setPref('devMode', on ? '1' : '0');

// 今日屏幕使用注入模式: off | always (quality, every request) | check (economy).
export const getUsageMode = (): UsageMode => {
  const v = getPref('usageMode');
  return v === 'always' || v === 'check' ? v : 'off';
};
export const setUsageMode = (m: UsageMode): void => setPref('usageMode', m);
// One-time consent: screen-usage (app names + durations) leaves the device to DeepSeek.
export const getUsageConsent = (): boolean => getPref('usageConsent') === '1';
export const setUsageConsent = (on: boolean): void => setPref('usageConsent', on ? '1' : '0');

// 位置感知: continuous coarse location into her context (consent-gated).
export const getLocationEnabled = (): boolean => getPref('locationEnabled') === '1';
export const setLocationEnabled = (on: boolean): void =>
  setPref('locationEnabled', on ? '1' : '0');
export const getManualPlace = (): string | null => getPref('manualPlace');
export const setManualPlace = (place: string): void =>
  setPref('manualPlace', place.trim());

// MiniMax key (v2.7): BYO, stored exactly like the DeepSeek/fal keys above.
const MINIMAX_KEY_NAME = 'minimax_api_key';

export const getMiniMaxKey = (): Promise<string | null> =>
  SecureStore.getItemAsync(MINIMAX_KEY_NAME);
export const setMiniMaxKey = (key: string): Promise<void> =>
  SecureStore.setItemAsync(MINIMAX_KEY_NAME, key.trim());

// 语音功能: master switch for MiniMax TTS (朗读 action + auto-play). Default
// off — no MiniMax calls happen until the user opts in with their own key.
export const getVoiceFeature = (): boolean => getPref('voiceFeature') === '1';
export const setVoiceFeature = (on: boolean): void => setPref('voiceFeature', on ? '1' : '0');

// 区域: MiniMax Key and voice_id are each bound to whichever region issued
// them — 国际 (global, default) vs 国内 (cn). See MINIMAX_HOSTS in minimax.ts.
export type VoiceRegion = 'global' | 'cn';
export const getVoiceRegion = (): VoiceRegion =>
  getPref('voiceRegion') === 'cn' ? 'cn' : 'global';
export const setVoiceRegion = (r: VoiceRegion): void => setPref('voiceRegion', r);

// 默认 Voice ID: global fallback when a persona has no voiceId of its own
// (schema v18). Empty string means "not configured yet".
export const getVoiceId = (): string => getPref('voiceId') ?? '';
export const setVoiceId = (id: string): void => setPref('voiceId', id.trim());

// 语速: passed straight through to voice_setting.speed. Default 1.0, clamped
// to MiniMax's documented 0.5–2.0 range.
export const getVoiceSpeed = (): number => {
  const n = parseFloat(getPref('voiceSpeed') ?? '');
  return Number.isNaN(n) ? 1.0 : Math.min(2.0, Math.max(0.5, n));
};
export const setVoiceSpeed = (speed: number): void =>
  setPref('voiceSpeed', String(Math.min(2.0, Math.max(0.5, speed))));

// 括号内容也朗读: （…）stage directions are skipped by default (off); when on,
// the inner text is read (parens dropped). See voicetext.ts's prepareSpeechText.
export const getVoiceReadParens = (): boolean => getPref('voiceReadParens') === '1';
export const setVoiceReadParens = (on: boolean): void =>
  setPref('voiceReadParens', on ? '1' : '0');

// 自动朗读: new completed replies play automatically while the chat is
// focused (burst-aware). Default off.
export const getVoiceAutoplay = (): boolean => getPref('voiceAutoplay') === '1';
export const setVoiceAutoplay = (on: boolean): void => setPref('voiceAutoplay', on ? '1' : '0');

// 每日字符上限: global day counter (voiceDayKey in voicetext.ts), not per
// conversation. Default 20000, clamped 1000..200000.
export const getVoiceDailyCap = (): number => {
  const n = parseInt(getPref('voiceDailyCap') ?? '', 10);
  return Number.isNaN(n) ? 20000 : Math.min(200000, Math.max(1000, n));
};
export const setVoiceDailyCap = (n: number): void =>
  setPref('voiceDailyCap', String(Math.min(200000, Math.max(1000, n))));

// 上下文长度 (v2.8): per-turn history budget (estimated tokens) fed to
// selectWindow — the cost knob. Default HISTORY_BUDGET, clamped
// [500, HISTORY_BUDGET*4] (covers the 短/中/长 tiers in context.ts's
// WINDOW_TIERS with headroom for a custom value).
export const getHistoryBudget = (): number => {
  const n = parseInt(getPref('historyBudget') ?? '', 10);
  return Number.isNaN(n) ? HISTORY_BUDGET : Math.min(HISTORY_BUDGET * 4, Math.max(500, n));
};
export const setHistoryBudget = (n: number): void =>
  setPref('historyBudget', String(Math.min(HISTORY_BUDGET * 4, Math.max(500, n))));
