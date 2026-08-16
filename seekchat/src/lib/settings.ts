import * as SecureStore from 'expo-secure-store';
import { getPref, setPref } from './db';
import { DEFAULT_MODEL } from './constants';
import type { DeliveryMode, ModelId } from './types';
import type { UsageMode } from './usage';

const KEY_NAME = 'deepseek_api_key';

export const getApiKey = (): Promise<string | null> => SecureStore.getItemAsync(KEY_NAME);
export const setApiKey = (key: string): Promise<void> =>
  SecureStore.setItemAsync(KEY_NAME, key.trim());

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
