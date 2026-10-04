import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { router } from 'expo-router';
import {
  Alert, PermissionsAndroid, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import {
  getProviderKey, setProviderKey, getProvider, setProvider, getGlmRegion, setGlmRegion,
  getModel, setModel, getDeliveryMode, setDeliveryMode,
  getDevMode, setDevMode, getFalKey, setFalKey,
  getHistoryBudget, setHistoryBudget,
  getImageDailyCap, setImageDailyCap,
  getImageFeature, setImageFeature, getKeepAlive, setKeepAlive,
  getLocationEnabled, setLocationEnabled,
  getManualPlace, setManualPlace, getMarkdownEnabled, setMarkdownEnabled,
  getMergeHoldSec, setMergeHoldSec, getMergeReplies, setMergeReplies,
  getMiniMaxKey, setMiniMaxKey,
  getShowNicknames, setShowNicknames, getShowThinking, setShowThinking,
  getTemperature, setTemperature, getTempMode, setTempMode,
  getMsgCut, setMsgCut, getThinkingEnabled, setThinkingEnabled,
  getUsageConsent, setUsageConsent, getUsageMode, setUsageMode,
  getUserAvatar, setUserAvatar, getUserBalance, setUserBalance,
  getUserNickname, setUserNickname,
  getVoiceAutoplay, setVoiceAutoplay, getVoiceDailyCap, setVoiceDailyCap,
  getVoiceFeature, setVoiceFeature, getVoiceId, setVoiceId,
  getVoiceReadParens, setVoiceReadParens, getVoiceRegion, setVoiceRegion,
  getVoiceSpeed, setVoiceSpeed,
  getPerceptionEnabled, setPerceptionEnabled, getRhythmEnabled, setRhythmEnabled,
  getTextureEnabled, setTextureEnabled, getUserBirthday, setUserBirthday,
} from '../lib/settings';
import { normalizeBirthday } from '../lib/calendar';
import { BIG_BALANCE, fmtMoney, LOVE_REMINDER } from '../lib/transfer';
import { native } from '../lib/native';
import type { UsageMode } from '../lib/usage';
import { importStickerZip } from '../lib/stickers';
import { clearStickers, listStickers } from '../lib/db';
import { pickRawImage, RawImage } from '../lib/avatar';
import { AvatarCrop } from '../components/AvatarCrop';
import { exportAll, writeBackupFile } from '../lib/export';
import { validateBackup } from '../lib/importcheck';
import { restoreBackup } from '../lib/import';

/** 导入 (v2.3): pick file → validate → auto safety export → double confirm →
 *  restore in one transaction → restart hint. Never touches data on any early
 *  exit. DocumentPicker/File follow the sticker-import precedent. */
async function importBackupFlow(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const DocumentPicker = require('expo-document-picker') as typeof import('expo-document-picker');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { File } = require('expo-file-system') as typeof import('expo-file-system');
  try {
    const res = await DocumentPicker.getDocumentAsync({
      // octet-stream included: Android SAF often tags .json files that way and
      // would grey out the user's own export. validateBackup rejects non-JSON.
      type: ['application/json', 'application/octet-stream'],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const json = await new File(res.assets[0].uri).text();
    const check = validateBackup(json);
    if (!check.ok) {
      Alert.alert('无法导入', check.reason);
      return;
    }
    Alert.alert(
      '导入备份？',
      `将覆盖现有全部数据（确认后会先自动备份当前数据）。\n备份含 ${check.counts.messages} 条消息、${check.counts.personas} 个人设。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认覆盖',
          style: 'destructive',
          onPress: () => {
            try {
              // Timestamped + written only on CONFIRM: a same-day second
              // import can never overwrite the previous safety snapshot,
              // and a canceled flow writes nothing.
              writeBackupFile(
                `-导入前自动备份-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`,
              );
              // Pre-restore scheduled notifications (reveals, outreach) all
              // belong to the world being deleted — cancel the ghosts.
              try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const Notifications = require('expo-notifications') as typeof import('expo-notifications');
                void Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
              } catch {
                // Expo Go — module unavailable, nothing scheduled
              }
              restoreBackup(check.payload);
              Alert.alert('导入完成', '请完全关闭并重新打开应用，让所有数据重新加载。');
            } catch (e) {
              Alert.alert('导入失败', String(e));
            }
          },
        },
      ],
    );
  } catch (e) {
    Alert.alert('导入失败', String(e));
  }
}
import { isExpoGo } from '../lib/env';
import { apiCallsToday, getPref, setPref } from '../lib/db';

// Loaded lazily — evaluating expo-notifications inside Expo Go throws.
const bg = () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../lib/background') as typeof import('../lib/background');
import { Avatar } from '../components/Avatar';
import { ConsentModal } from '../components/ConsentModal';
import { ApiError, chatOnce, userMessageFor } from '../lib/llm';
import { PROVIDER_ORDER, PROVIDERS } from '../lib/providers';
import type { GlmRegion } from '../lib/providers';
import { WINDOW_TIERS } from '../lib/context';
import { useTheme } from '../lib/theme-context';
import { normalizeHex } from '../lib/color';
import { ColorPalette } from '../components/ColorPalette';
import type { DeliveryMode, ModelId, Provider } from '../lib/types';
import type { VoiceRegion } from '../lib/settings';

function Choice<T extends string>(props: {
  options: { value: T; label: string }[];
  value: T;
  accent: string;
  onChange: (v: T) => void;
}) {
  return (
    <View style={s.choiceRow}>
      {props.options.map((o) => (
        <Pressable
          key={o.value}
          style={[s.choice, props.value === o.value && { backgroundColor: props.accent }]}
          onPress={() => props.onChange(o.value)}
        >
          <Text style={[s.choiceTxt, props.value === o.value && s.choiceTxtOn]}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function DiagRow(props: { label: string; ok: boolean; muted?: boolean }) {
  return (
    <View style={s.diagRow}>
      <Text style={[s.diagLabel, props.muted && { color: '#bbb' }]}>{props.label}</Text>
      <Text style={[s.diagPill, props.ok ? s.diagOk : s.diagBad]}>
        {props.muted ? '—' : props.ok ? '✓' : '✗'}
      </Text>
    </View>
  );
}

/** Collapsible group (v2.8 settings overhaul): header Pressable + title +
 *  chevron, children render only while open. Local and tiny on purpose —
 *  this screen doesn't need a shared/exported version yet. */
function Section(props: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <View style={s.section}>
      <Pressable style={s.sectionHeader} onPress={props.onToggle}>
        <Text style={s.sectionTitle}>{props.title}</Text>
        <Text style={s.sectionChevron}>{props.open ? '▾' : '▸'}</Text>
      </Pressable>
      {props.open && <View>{props.children}</View>}
    </View>
  );
}

export default function SettingsScreen() {
  const [keyInput, setKeyInput] = useState('');
  const [savedTail, setSavedTail] = useState<string | null>(null);
  // 模型服务商 (v2.9): DeepSeek/GLM each keep their own key slot, saved-tail,
  // test result and remembered model; only the active one is called.
  const [provider, setProviderState] = useState<Provider>(getProvider());
  const [glmKeyInput, setGlmKeyInput] = useState('');
  const [glmSavedTail, setGlmSavedTail] = useState<string | null>(null);
  const [glmRegion, setGlmRegionState] = useState<GlmRegion>(getGlmRegion());
  const [glmTestResult, setGlmTestResult] = useState<string | null>(null);
  const [falKeyInput, setFalKeyInput] = useState('');
  const [falSavedTail, setFalSavedTail] = useState<string | null>(null);
  const [imageFeatureOn, setImageFeatureOnState] = useState(getImageFeature());
  const [imageCapInput, setImageCapInput] = useState(String(getImageDailyCap()));
  const [minimaxKeyInput, setMinimaxKeyInput] = useState('');
  const [minimaxSavedTail, setMinimaxSavedTail] = useState<string | null>(null);
  const [voiceRegion, setVoiceRegionState] = useState<VoiceRegion>(getVoiceRegion());
  const [voiceFeatureOn, setVoiceFeatureOnState] = useState(getVoiceFeature());
  const [voiceIdInput, setVoiceIdInput] = useState(getVoiceId());
  const [voiceSpeedInput, setVoiceSpeedInput] = useState(String(getVoiceSpeed()));
  const [voiceAutoplayOn, setVoiceAutoplayOnState] = useState(getVoiceAutoplay());
  const [voiceReadParensOn, setVoiceReadParensOnState] = useState(getVoiceReadParens());
  const [voiceCapInput, setVoiceCapInput] = useState(String(getVoiceDailyCap()));
  const [model, setModelState] = useState<ModelId>(getModel());
  const [mode, setModeState] = useState<DeliveryMode>(getDeliveryMode());
  const [hexInput, setHexInput] = useState('');
  const [hexError, setHexError] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [nickname, setNickname] = useState(getUserNickname());
  const [userAvatar, setUserAvatarState] = useState<string | null>(getUserAvatar());
  const [showNicks, setShowNicks] = useState(getShowNicknames());
  const [mdOn, setMdOn] = useState(getMarkdownEnabled());
  const [thinkOn, setThinkOn] = useState(getThinkingEnabled());
  const [bgReach, setBgReach] = useState(getPref('backgroundReach') === '1');
  const [bgConsentOpen, setBgConsentOpen] = useState(false);
  const [showThink, setShowThink] = useState(getShowThinking());
  const [stickerCount, setStickerCount] = useState(listStickers().length);
  const [mergeOn, setMergeOn] = useState(getMergeReplies());
  const [holdSec, setHoldSec] = useState(String(getMergeHoldSec()));
  const [keepAlive, setKeepAliveState] = useState(getKeepAlive());
  const [batteryOk, setBatteryOk] = useState(() => (isExpoGo ? false : bg().batteryOptIgnored()));
  const [watchDebug, setWatchDebug] = useState(() => (isExpoGo ? null : bg().getWatchDebug()));
  const [devMode, setDevModeState] = useState(getDevMode());
  const [temp, setTempState] = useState(getTemperature());
  const [tempMode, setTempModeState] = useState(getTempMode());
  const [msgCut, setMsgCutState] = useState(getMsgCut());
  const [balance, setBalanceState] = useState(String(getUserBalance()));
  const [usageMode, setUsageModeState] = useState<UsageMode>(getUsageMode());
  const [usageAccess, setUsageAccess] = useState(() => native?.hasUsageAccess() ?? false);
  const [locOn, setLocOn] = useState(getLocationEnabled());
  const [locConsentOpen, setLocConsentOpen] = useState(false);
  const [usageConsentOpen, setUsageConsentOpen] = useState(false);
  const [pendingUsage, setPendingUsage] = useState<UsageMode>('check');
  const [place, setPlaceState] = useState(getManualPlace() ?? '');
  const [notifOk, setNotifOk] = useState(false);
  const [locPermOk, setLocPermOk] = useState(false);
  const [selfTest, setSelfTest] = useState<string | null>(null);
  // 上下文长度 (v2.8): numeric field mirrors getHistoryBudget/setHistoryBudget;
  // the tier chips below (WINDOW_TIERS) write through the same setter.
  const [historyBudgetInput, setHistoryBudgetInput] = useState(String(getHistoryBudget()));
  // 真实感 (v3.0)
  const [perceptionOn, setPerceptionOnState] = useState(getPerceptionEnabled());
  const [rhythmOn, setRhythmOnState] = useState(getRhythmEnabled());
  const [textureOn, setTextureOnState] = useState(getTextureEnabled());
  const [birthdayInput, setBirthdayInput] = useState(getUserBirthday() ?? '');
  // Section open/closed (v2.8 settings overhaul): 聊天 defaults open (the
  // most frequently touched group), the rest default closed to minimize
  // scrolling for the common case.
  const [apiKeysOpen, setApiKeysOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const { th, accent, setAccent } = useTheme();

  const refreshDiag = () => {
    if (isExpoGo) return;
    setBatteryOk(bg().batteryOptIgnored());
    setUsageAccess(native?.hasUsageAccess() ?? false);
    setWatchDebug(bg().getWatchDebug());
    void bg().getDiagnostics().then((d) => setNotifOk(d.notif));
    void PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION).then(
      setLocPermOk,
    );
  };

  const grantUsageAccess = () => {
    native?.openUsageAccessSettings();
    setTimeout(() => setUsageAccess(native?.hasUsageAccess() ?? false), 800);
  };

  const applyUsageMode = (m: UsageMode) => {
    if (m !== 'off' && native && !native.hasUsageAccess()) grantUsageAccess();
    setUsageMode(m);
    setUsageModeState(m);
  };

  const chooseUsageMode = (m: UsageMode) => {
    if (m !== 'off' && !getUsageConsent()) {
      setPendingUsage(m);
      setUsageConsentOpen(true); // usage data leaves the device — consent first
      return;
    }
    applyUsageMode(m);
  };

  const enableLocation = async () => {
    const res = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    );
    if (res === PermissionsAndroid.RESULTS.GRANTED) {
      setLocationEnabled(true);
      setLocOn(true);
      setLocPermOk(true);
      bg().refreshLiveReadings();
    } else {
      Alert.alert('需要定位权限', '未授予定位权限，她无法知道你在哪。可在系统设置里手动开启。');
    }
  };

  useEffect(() => {
    if (isExpoGo) return;
    // Self-heal: pref says 后台守护 on but the service died (ROM kill) — restart.
    if (getKeepAlive() && !bg().keepAliveRunning()) bg().startKeepAliveService();
    refreshDiag();
    const h = setInterval(() => {
      setWatchDebug(bg().getWatchDebug());
      void bg().getDiagnostics().then((d) => setNotifOk(d.notif));
    }, 3000);
    return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleKeepAlive = (on: boolean) => {
    if (on) {
      if (isExpoGo || !bg().keepAliveSupported()) {
        Alert.alert(
          '需要正式版本',
          '后台守护（常驻前台服务）只在正式 APK 中可用。请重新构建并安装最新版本。',
        );
        return;
      }
      const ok = bg().startKeepAliveService();
      if (!ok) {
        Alert.alert('启动失败', '系统拒绝了前台服务，请稍后在应用打开时重试。');
        return;
      }
      // Watch/reach notifications ride this service — get permission now.
      void bg().ensureNotifPermission();
    } else if (!isExpoGo && bg().keepAliveSupported()) {
      bg().stopKeepAliveService();
    }
    // Turning OFF always persists, even when the module is absent — otherwise
    // a stale pref leaves the switch stuck ON forever.
    setKeepAlive(on);
    setKeepAliveState(on);
  };

  const toggleBgReach = (on: boolean) => {
    if (isExpoGo) {
      Alert.alert(
        '需要正式版本',
        '后台主动联系在 Expo Go 中不可用（系统限制会在加载通知模块时崩溃）。安装正式 APK 后即可开启。',
      );
      return;
    }
    if (!on) {
      setPref('backgroundReach', '0');
      setBgReach(false);
      void bg().disableBackgroundReach();
      void bg().cancelAllOutreach(); // stop any already-scheduled notifications
      return;
    }
    setBgConsentOpen(true); // serious setting — always re-consent
  };

  const [cropImage, setCropImage] = useState<RawImage | null>(null);
  const changeAvatar = async () => {
    const img = await pickRawImage();
    if (img) setCropImage(img);
  };

  const applyHex = () => {
    const n = normalizeHex(hexInput);
    if (!n) {
      setHexError(true);
      return;
    }
    setHexError(false);
    setHexInput('');
    setAccent(n);
  };

  useEffect(() => {
    void getProviderKey('deepseek').then((k) => setSavedTail(k ? k.slice(-4) : null));
  }, []);

  useEffect(() => {
    void getProviderKey('glm').then((k) => setGlmSavedTail(k ? k.slice(-4) : null));
  }, []);

  useEffect(() => {
    void getFalKey().then((k) => setFalSavedTail(k ? k.slice(-4) : null));
  }, []);

  useEffect(() => {
    void getMiniMaxKey().then((k) => setMinimaxSavedTail(k ? k.slice(-4) : null));
  }, []);

  const saveKey = async (p: Provider) => {
    const k = (p === 'glm' ? glmKeyInput : keyInput).trim();
    if (!k) return;
    await setProviderKey(p, k);
    if (p === 'glm') {
      setGlmSavedTail(k.slice(-4));
      setGlmKeyInput('');
      setGlmTestResult(null);
    } else {
      setSavedTail(k.slice(-4));
      setKeyInput('');
      setTestResult(null);
    }
  };

  const saveFalKey = async () => {
    const k = falKeyInput.trim();
    if (!k) return;
    await setFalKey(k);
    setFalSavedTail(k.slice(-4));
    setFalKeyInput('');
  };

  const saveMiniMaxKey = async () => {
    const k = minimaxKeyInput.trim();
    if (!k) return;
    await setMiniMaxKey(k);
    setMinimaxSavedTail(k.slice(-4));
    setMinimaxKeyInput('');
  };

  const showVoiceIdGuide = () => {
    Alert.alert(
      '如何获得 Voice ID',
      '1. 打开 MiniMax 官网 platform.minimax.io（国内为 platform.minimaxi.com）\n' +
        '2. 进入语音 / 音色克隆 playground\n' +
        '3. 生成或克隆一个音色\n' +
        '4. 复制该音色的 voice_id，粘贴到这里\n\n' +
        '注意：Key 和音色都绑定所在平台区域，国际 Key 配国内音色（或反之）无法使用。',
    );
  };

  // Tests THAT provider's own key against its default model — works for the
  // inactive provider too, so a second key can be checked before switching.
  const testKey = async (p: Provider) => {
    const report = p === 'glm' ? setGlmTestResult : setTestResult;
    report('测试中…');
    const k = await getProviderKey(p);
    if (!k) {
      report('尚未保存 API Key');
      return;
    }
    try {
      await chatOnce(k, PROVIDERS[p].defaultModel, [{ role: 'user', content: '回复：OK' }]);
      report('✓ 连接正常');
    } catch (e) {
      report(e instanceof ApiError ? userMessageFor(e) : String(e));
    }
  };

  const budgetTierKeys = Object.keys(WINDOW_TIERS) as Array<keyof typeof WINDOW_TIERS>;
  const budgetTier = budgetTierKeys.find((k) => WINDOW_TIERS[k] === Number(historyBudgetInput)) ?? '';

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 16 }}>
      <Section title="API Keys" open={apiKeysOpen} onToggle={() => setApiKeysOpen((v) => !v)}>
        <Text style={s.subLabel}>模型服务商（聊天、群聊、朋友圈与后台主动消息都走这一家）</Text>
        <Choice
          accent={th.accent}
          options={PROVIDER_ORDER.map((p) => ({ value: p, label: PROVIDERS[p].label }))}
          value={provider}
          onChange={(p: Provider) => {
            setProvider(p);
            setProviderState(p);
            setModelState(getModel()); // each provider remembers its own model
          }}
        />
        <Text style={s.stickerHint}>
          DeepSeek：v4 模型，想象力可到 1.5，账单单一。GLM（智谱）：有免费档，5.3 系列更强但不能关思考
          （关闭=低强度），工具调用走 4.7-flashx；想象力上限 1.0（奔放≈平衡），Key 绑定区域（国际 Z.ai / 国内 bigmodel.cn）。
          两家各自保存 Key 与模型选择，随时切换。
        </Text>

        <Text style={s.label}>
          DeepSeek API Key {savedTail ? `（已保存，尾号 ${savedTail}）` : '（未设置）'}
          {provider === 'deepseek' ? ' · 使用中' : ''}
        </Text>
        <TextInput
          style={s.input}
          value={keyInput}
          onChangeText={setKeyInput}
          placeholder="sk-…"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={s.btnRow}>
          <Pressable
            style={[s.btn, { backgroundColor: th.accent }]}
            onPress={() => void saveKey('deepseek')}
          >
            <Text style={s.btnTxt}>保存</Text>
          </Pressable>
          <Pressable
            style={[s.btn, { backgroundColor: th.accentSoft }]}
            onPress={() => void testKey('deepseek')}
          >
            <Text style={[s.btnTxt, { color: th.accent }]}>测试连接</Text>
          </Pressable>
        </View>
        {testResult && <Text style={s.test}>{testResult}</Text>}

        <Text style={s.label}>
          GLM API Key {glmSavedTail ? `（已保存，尾号 ${glmSavedTail}）` : '（未设置）'}
          {provider === 'glm' ? ' · 使用中' : ''}
        </Text>
        <Text style={s.subLabel}>区域（Key 绑定签发平台：国际 z.ai，国内 open.bigmodel.cn）</Text>
        <Choice
          accent={th.accent}
          options={[
            { value: 'global', label: '国际' },
            { value: 'cn', label: '国内' },
          ]}
          value={glmRegion}
          onChange={(r: GlmRegion) => {
            setGlmRegion(r);
            setGlmRegionState(r);
            setGlmTestResult(null);
          }}
        />
        <TextInput
          style={s.input}
          value={glmKeyInput}
          onChangeText={setGlmKeyInput}
          placeholder={PROVIDERS.glm.keyPlaceholder}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={s.btnRow}>
          <Pressable
            style={[s.btn, { backgroundColor: th.accent }]}
            onPress={() => void saveKey('glm')}
          >
            <Text style={s.btnTxt}>保存</Text>
          </Pressable>
          <Pressable
            style={[s.btn, { backgroundColor: th.accentSoft }]}
            onPress={() => void testKey('glm')}
          >
            <Text style={[s.btnTxt, { color: th.accent }]}>测试连接</Text>
          </Pressable>
        </View>
        {glmTestResult && <Text style={s.test}>{glmTestResult}</Text>}

        <Text style={s.label}>
          fal.ai Key {falSavedTail ? `（已保存，尾号 ${falSavedTail}）` : '（未设置）'}
        </Text>
        <TextInput
          style={s.input}
          value={falKeyInput}
          onChangeText={setFalKeyInput}
          placeholder="fal.ai Key"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={s.btnRow}>
          <Pressable style={[s.btn, { backgroundColor: th.accent }]} onPress={() => void saveFalKey()}>
            <Text style={s.btnTxt}>保存</Text>
          </Pressable>
        </View>

        <Text style={s.label}>
          MiniMax Key {minimaxSavedTail ? `（已保存，尾号 ${minimaxSavedTail}）` : '（未设置）'}
        </Text>
        <TextInput
          style={s.input}
          value={minimaxKeyInput}
          onChangeText={setMinimaxKeyInput}
          placeholder="MiniMax API Key"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={s.btnRow}>
          <Pressable style={[s.btn, { backgroundColor: th.accent }]} onPress={() => void saveMiniMaxKey()}>
            <Text style={s.btnTxt}>保存</Text>
          </Pressable>
        </View>
      </Section>

      <Section title="聊天" open={chatOpen} onToggle={() => setChatOpen((v) => !v)}>
        <Text style={s.label}>我的资料</Text>
        <View style={s.profileRow}>
          <Pressable onPress={() => void changeAvatar()}>
            <Avatar uri={userAvatar} name={nickname} size={56} />
          </Pressable>
          <TextInput
            style={[s.input, s.nickInput]}
            value={nickname}
            onChangeText={setNickname}
            onEndEditing={() => setUserNickname(nickname)}
            placeholder="昵称"
          />
        </View>
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>在聊天中显示昵称</Text>
          <Switch
            value={showNicks}
            onValueChange={(v) => {
              setShowNicknames(v);
              setShowNicks(v);
            }}
            trackColor={{ true: th.accent }}
          />
        </View>

        <Text style={s.label}>
          模型（{PROVIDERS[provider].label}
          {provider === 'deepseek' ? '；flash 即 V4.1（2026-09-10 起），旧 v4-flash 已退役' : ''}）
        </Text>
        <Choice
          accent={th.accent}
          options={PROVIDERS[provider].models}
          value={model}
          onChange={(m: ModelId) => {
            setModel(m);
            setModelState(m);
          }}
        />

        <Text style={s.label}>
          想象力（低=更贴合事实，少编造；高=更有戏剧性；动态=每条消息自动判断语气与篇幅：谈正事时严谨、玩闹时奔放、闲聊时短回——需开启下方的每轮感知）
        </Text>
        <Choice
          accent={th.accent}
          options={[
            { value: '0.6', label: '严谨' },
            { value: '1.0', label: '平衡' },
            { value: '1.3', label: '奔放' },
            { value: 'dyn', label: '动态' },
          ]}
          value={tempMode === 'dynamic' ? 'dyn' : temp.toFixed(1)}
          onChange={(v: string) => {
            if (v === 'dyn') {
              setTempMode('dynamic');
              setTempModeState('dynamic');
              return;
            }
            const n = parseFloat(v);
            setTempMode('manual');
            setTempModeState('manual');
            setTemperature(n);
            setTempState(n);
          }}
        />
        <Text style={s.stickerHint}>
          今日 API 调用 {apiCallsToday()} 次（DeepSeek {apiCallsToday('deepseek')} · GLM{' '}
          {apiCallsToday('glm')}；每条消息≈1次；导演/评论/修复/分类/总结各计1次）
        </Text>

        <Text style={s.label}>真实感</Text>
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>
            每轮感知（回复前读一眼：对方的情绪与需要的语气/篇幅、值得记住的事、几天后要跟进的事、亲密度；每轮多一次小调用）
          </Text>
          <Switch
            value={perceptionOn}
            onValueChange={(v) => {
              setPerceptionEnabled(v);
              setPerceptionOnState(v);
            }}
            trackColor={{ true: th.accent }}
          />
        </View>
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>
            作息感知（已读回执；她忙时先回一句再补完整回复、睡着时等醒来再回——需要人设有作息表）
          </Text>
          <Switch
            value={rhythmOn}
            onValueChange={(v) => {
              setRhythmEnabled(v);
              setRhythmOnState(v);
            }}
            trackColor={{ true: th.accent }}
          />
        </View>
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>
            小动作（偶尔打错字再纠正、撤回一句、引用你的话、发语音条、你没回时追问一句）
          </Text>
          <Switch
            value={textureOn}
            onValueChange={(v) => {
              setTextureEnabled(v);
              setTextureOnState(v);
            }}
            trackColor={{ true: th.accent }}
          />
        </View>
        <Text style={s.subLabel}>你的生日（MM-DD；你聊到时她会自动记下，也可手填）</Text>
        <TextInput
          style={[s.input, s.holdInput]}
          value={birthdayInput}
          onChangeText={setBirthdayInput}
          onEndEditing={() => {
            const n = normalizeBirthday(birthdayInput);
            setUserBirthday(n);
            setBirthdayInput(n ?? '');
          }}
          placeholder="05-20"
          autoCapitalize="none"
        />

        <Text style={s.label}>上下文长度（每轮发给她的历史消息预算）</Text>
        <View style={s.holdRow}>
          <TextInput
            style={[s.input, s.holdInput]}
            value={historyBudgetInput}
            onChangeText={setHistoryBudgetInput}
            onEndEditing={() => {
              const n = parseInt(historyBudgetInput, 10);
              setHistoryBudget(Number.isNaN(n) ? getHistoryBudget() : n);
              setHistoryBudgetInput(String(getHistoryBudget()));
            }}
            keyboardType="number-pad"
            maxLength={5}
          />
          <Choice
            accent={th.accent}
            options={budgetTierKeys.map((k) => ({ value: k, label: k }))}
            value={budgetTier as keyof typeof WINDOW_TIERS}
            onChange={(tier: keyof typeof WINDOW_TIERS) => {
              setHistoryBudget(WINDOW_TIERS[tier]);
              setHistoryBudgetInput(String(WINDOW_TIERS[tier]));
            }}
          />
        </View>
        <Text style={s.stickerHint}>更短更省钱——旧对话会更快进入滚动总结，由她的长期记忆接管。</Text>

        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>消息切割（长回复切成多条短消息，像真人连发；切割绝不改动她的原文）</Text>
          <Switch
            value={msgCut}
            onValueChange={(v) => {
              setMsgCut(v);
              setMsgCutState(v);
            }}
            trackColor={{ true: th.accent }}
          />
        </View>

        <Text style={s.label}>消息呈现</Text>
        <Choice
          accent={th.accent}
          options={[
            { value: 'typewriter', label: '打字机式' },
            { value: 'simulated', label: '仿真短信式' },
          ]}
          value={mode}
          onChange={(m: DeliveryMode) => {
            setDeliveryMode(m);
            setModeState(m);
          }}
        />
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>Markdown 渲染（AI 消息）</Text>
          <Switch
            value={mdOn}
            onValueChange={(v) => {
              setMarkdownEnabled(v);
              setMdOn(v);
            }}
            trackColor={{ true: th.accent }}
          />
        </View>
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>思考模式（深度推理，回复更慢、输出费更高）</Text>
          <Switch
            value={thinkOn}
            onValueChange={(v) => {
              setThinkingEnabled(v);
              setThinkOn(v);
            }}
            trackColor={{ true: th.accent }}
          />
        </View>
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>显示思考内容（AI 消息上方可展开）</Text>
          <Switch
            value={showThink}
            onValueChange={(v) => {
              setShowThinking(v);
              setShowThink(v);
            }}
            trackColor={{ true: th.accent }}
          />
        </View>
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>等你打完再回（她会等你把零碎消息发完，再一起回复）</Text>
          <Switch
            value={mergeOn}
            onValueChange={(v) => {
              setMergeReplies(v);
              setMergeOn(v);
            }}
            trackColor={{ true: th.accent }}
          />
        </View>
        {mergeOn && (
          <View style={s.holdRow}>
            <Text style={s.toggleLabel}>发完最后一条后等待</Text>
            <TextInput
              style={[s.input, s.holdInput]}
              value={holdSec}
              onChangeText={setHoldSec}
              onEndEditing={() => {
                const n = parseInt(holdSec, 10);
                const v = Number.isNaN(n) ? 4 : Math.min(30, Math.max(1, n));
                setMergeHoldSec(v);
                setHoldSec(String(v));
              }}
              keyboardType="number-pad"
              maxLength={2}
            />
            <Text style={s.toggleLabel}>秒（打字中会继续等）</Text>
          </View>
        )}

        {/* ---- 她能感知什么 ---- */}
        <Text style={s.label}>她能感知什么</Text>
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>位置感知（她会知道你所在的城市与时区，作息判断更准）</Text>
          <Switch
            value={locOn}
            onValueChange={(v) => {
              if (isExpoGo || !native) {
                Alert.alert('需要正式版本', '位置功能只在正式 APK 中可用。');
                return;
              }
              if (v) setLocConsentOpen(true);
              else {
                setLocationEnabled(false);
                setLocOn(false);
              }
            }}
            trackColor={{ true: th.accent }}
          />
        </View>
        {locOn && native && !locPermOk && (
          <Pressable style={[s.btn, { backgroundColor: th.accentSoft, alignSelf: 'flex-start' }]} onPress={() => void enableLocation()}>
            <Text style={[s.btnTxt, { color: th.accent }]}>授予定位权限</Text>
          </Pressable>
        )}
        <View style={s.holdRow}>
          <Text style={s.toggleLabel}>手动城市（可选，优先于定位）</Text>
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={place}
            onChangeText={setPlaceState}
            onEndEditing={() => setManualPlace(place)}
            placeholder="如：上海"
          />
        </View>

        <Text style={s.subLabel}>今日屏幕使用（她可提起你在用什么、用了多久）</Text>
        <Choice
          accent={th.accent}
          options={[
            { value: 'off', label: '关闭' },
            { value: 'check', label: '偶尔查看（省）' },
            { value: 'always', label: '常驻感知（贵）' },
          ]}
          value={usageMode}
          onChange={chooseUsageMode}
        />
        {usageMode !== 'off' && native && !usageAccess && (
          <Pressable style={[s.btn, { backgroundColor: th.accentSoft, alignSelf: 'flex-start', marginTop: 8 }]} onPress={grantUsageAccess}>
            <Text style={[s.btnTxt, { color: th.accent }]}>授予「使用情况访问」</Text>
          </Pressable>
        )}

        <Text style={s.label}>表情包（当前 {stickerCount} 个）</Text>
        <View style={s.btnRow}>
          <Pressable
            style={[s.btn, { backgroundColor: th.accent }]}
            onPress={() =>
              void importStickerZip().then((r) => {
                if (r) {
                  setStickerCount(listStickers().length);
                  Alert.alert('导入完成', `成功 ${r.imported} 个，跳过 ${r.skipped} 个。`);
                }
              })
            }
          >
            <Text style={s.btnTxt}>导入表情包（zip）</Text>
          </Pressable>
          {stickerCount > 0 && (
            <Pressable
              style={[s.btn, { backgroundColor: '#fdecea' }]}
              onPress={() =>
                Alert.alert('清空全部表情包？', undefined, [
                  { text: '取消', style: 'cancel' },
                  {
                    text: '清空',
                    style: 'destructive',
                    onPress: () => {
                      clearStickers();
                      setStickerCount(0);
                    },
                  },
                ])
              }
            >
              <Text style={[s.btnTxt, { color: '#a32d2d' }]}>清空</Text>
            </Pressable>
          )}
        </View>
        <Text style={s.stickerHint}>
          zip 内需包含 stickers.json（[{'{'}file,label,desc{'}'}] 数组）与图片文件；描述会注入每次请求，越多越长则越贵。可用仓库里的
          tools/sticker-packer.html 快速制作。
        </Text>

        <Text style={s.label}>钱包（虚拟转账 · 想充多少都行）</Text>
        <View style={s.hexRow}>
          <TextInput
            style={[s.input, s.hexInput]}
            value={balance}
            onChangeText={setBalanceState}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
          <Pressable
            style={[s.btn, { backgroundColor: th.accent }]}
            onPress={() => {
              const n = parseFloat(balance);
              // Empty/invalid field keeps the current balance — never silently
              // wipe the wallet to 0 just because the input was cleared to retype.
              const v = Number.isNaN(n) ? getUserBalance() : Math.max(0, Math.round(n * 100) / 100);
              setUserBalance(v);
              setBalanceState(String(v));
              if (v >= BIG_BALANCE) Alert.alert('💛', LOVE_REMINDER);
            }}
          >
            <Text style={s.btnTxt}>保存</Text>
          </Pressable>
        </View>
        <Text style={s.stickerHint}>
          当前余额 {fmtMoney(getUserBalance())}。这些都是虚拟的——在开启「转账」的人设里可以互相转账。
        </Text>
      </Section>

      <Section title="照片" open={photoOpen} onToggle={() => setPhotoOpen((v) => !v)}>
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>图片功能（她可能在聊天中主动发照片，基于形象设定生成的参考图）</Text>
          <Switch
            value={imageFeatureOn}
            onValueChange={(v) => {
              setImageFeature(v);
              setImageFeatureOnState(v);
            }}
            trackColor={{ true: th.accent }}
          />
        </View>
        <View style={s.holdRow}>
          <Text style={s.toggleLabel}>每日照片上限（每个对话每天）</Text>
          <TextInput
            style={[s.input, s.holdInput]}
            value={imageCapInput}
            onChangeText={setImageCapInput}
            onEndEditing={() => {
              const n = parseInt(imageCapInput, 10);
              const v = Number.isNaN(n) ? 5 : Math.min(50, Math.max(1, n));
              setImageDailyCap(v);
              setImageCapInput(String(v));
            }}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={s.toggleLabel}>张</Text>
        </View>
        <Text style={s.stickerHint}>每张约 $0.035，用你自己的 fal.ai 余额。</Text>
      </Section>

      <Section title="语音" open={voiceOpen} onToggle={() => setVoiceOpen((v) => !v)}>
        <Text style={s.subLabel}>区域（Key 与音色都绑定所在平台区域）</Text>
        <Choice
          accent={th.accent}
          options={[
            { value: 'global', label: '国际' },
            { value: 'cn', label: '国内' },
          ]}
          value={voiceRegion}
          onChange={(r: VoiceRegion) => {
            setVoiceRegion(r);
            setVoiceRegionState(r);
          }}
        />
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>语音功能（她的消息可朗读；开启后才会调用 MiniMax）</Text>
          <Switch
            value={voiceFeatureOn}
            onValueChange={(v) => {
              setVoiceFeature(v);
              setVoiceFeatureOnState(v);
            }}
            trackColor={{ true: th.accent }}
          />
        </View>
        <View style={s.holdRow}>
          <Text style={s.toggleLabel}>默认 Voice ID</Text>
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={voiceIdInput}
            onChangeText={setVoiceIdInput}
            onEndEditing={() => setVoiceId(voiceIdInput)}
            placeholder="留空则不可朗读"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable onPress={showVoiceIdGuide} hitSlop={8}>
            <Text style={[s.infoIcon, { color: th.accent }]}>ⓘ</Text>
          </Pressable>
        </View>
        <View style={s.holdRow}>
          <Text style={s.toggleLabel}>语速</Text>
          <TextInput
            style={[s.input, s.holdInput]}
            value={voiceSpeedInput}
            onChangeText={setVoiceSpeedInput}
            onEndEditing={() => {
              const n = parseFloat(voiceSpeedInput);
              const v = Number.isNaN(n) ? 1.0 : Math.min(2.0, Math.max(0.5, n));
              setVoiceSpeed(v);
              setVoiceSpeedInput(String(v));
            }}
            keyboardType="decimal-pad"
            maxLength={4}
          />
        </View>
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>自动朗读（新回复到达且聊天在前台时自动播放）</Text>
          <Switch
            value={voiceAutoplayOn}
            onValueChange={(v) => {
              setVoiceAutoplay(v);
              setVoiceAutoplayOnState(v);
            }}
            trackColor={{ true: th.accent }}
          />
        </View>
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>括号内容也朗读（默认跳过（…）舞台提示）</Text>
          <Switch
            value={voiceReadParensOn}
            onValueChange={(v) => {
              setVoiceReadParens(v);
              setVoiceReadParensOnState(v);
            }}
            trackColor={{ true: th.accent }}
          />
        </View>
        <View style={s.holdRow}>
          <Text style={s.toggleLabel}>每日字符上限</Text>
          <TextInput
            style={[s.input, s.holdInput]}
            value={voiceCapInput}
            onChangeText={setVoiceCapInput}
            onEndEditing={() => {
              const n = parseInt(voiceCapInput, 10);
              const v = Number.isNaN(n) ? 20000 : Math.min(200000, Math.max(1000, n));
              setVoiceDailyCap(v);
              setVoiceCapInput(String(v));
            }}
            keyboardType="number-pad"
            maxLength={6}
          />
          <Text style={s.toggleLabel}>字</Text>
        </View>
        <Text style={s.stickerHint}>按字符计费，用你自己的 MiniMax 余额。</Text>
      </Section>

      <Text style={s.label}>后台</Text>
      <View style={s.toggleRow}>
        <Text style={s.toggleLabel}>后台主动联系（应用不在前台也可发消息+通知）</Text>
        <Switch value={bgReach} onValueChange={toggleBgReach} trackColor={{ true: th.accent }} />
      </View>
      <View style={s.toggleRow}>
        <Text style={s.toggleLabel}>后台守护（常驻通知保活：切走不断线、主动消息更可靠、屏幕窥视生效）</Text>
        <Switch value={keepAlive} onValueChange={toggleKeepAlive} trackColor={{ true: th.accent }} />
      </View>
      {!isExpoGo && (
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>
            电池优化豁免 {batteryOk ? '✓ 已豁免' : '（未豁免，后台易被系统清理）'}
          </Text>
          {!batteryOk && (
            <Pressable
              style={[s.btn, { backgroundColor: th.accentSoft }]}
              onPress={() => {
                bg().requestBatteryOptExemption();
                setTimeout(() => setBatteryOk(bg().batteryOptIgnored()), 1000);
              }}
            >
              <Text style={[s.btnTxt, { color: th.accent }]}>去设置</Text>
            </Pressable>
          )}
        </View>
      )}
      <Text style={s.stickerHint}>
        国产 ROM（MIUI/ColorOS/EMUI 等）还需在系统设置中允许本应用「自启动」与「后台运行」，
        并把 LoveSeek 在最近任务里「上锁」——从最近任务划掉会终止她的后台活动（通知栏的
        守护通知还在，但心脏已经停了；重新打开应用即可复活）。真正可靠的是「回归感知」：
        你切回应用时，她会立刻发现你刚才用了什么。
      </Text>

      <View style={s.toggleRow}>
        <Text style={s.toggleLabel}>开发者模式（在聊天里显示"她查看了你的屏幕"等系统提示；沉浸模式则隐藏）</Text>
        <Switch
          value={devMode}
          onValueChange={(v) => {
            setDevMode(v);
            setDevModeState(v);
          }}
          trackColor={{ true: th.accent }}
        />
      </View>
      {devMode && (
        <Pressable
          style={[s.btn, { backgroundColor: th.accentSoft, marginTop: 8 }]}
          onPress={() => router.push('/prompts')}
        >
          <Text style={[s.btnTxt, { color: th.accent }]}>提示词工作室 →（她的一切行为规则，均可编辑）</Text>
        </Pressable>
      )}

      {/* ---- 系统自检（截图给作者排查用） ---- */}
      <Text style={s.label}>系统自检</Text>
      <View style={s.diagBox}>
        <DiagRow label="通知权限" ok={notifOk} />
        <DiagRow label="使用情况访问（窥屏/屏幕使用需要）" ok={usageAccess} />
        <DiagRow label="电池优化豁免" ok={batteryOk} />
        <DiagRow label="定位权限" ok={locPermOk} muted={!locOn} />
        <DiagRow label="后台守护服务运行中" ok={watchDebug?.keepAlive ?? false} />
        <View style={s.diagRow}>
          <Text style={s.diagLabel}>后台心跳</Text>
          <Text style={s.diagVal}>
            {watchDebug?.lastTickAt
              ? new Date(watchDebug.lastTickAt).toLocaleTimeString('zh-CN', { hour12: false })
              : '从未'}
          </Text>
        </View>
        <Text style={s.diagNote}>窥屏最近判定：{watchDebug?.note ?? '（无）'}</Text>
      </View>
      <View style={s.btnRow}>
        <Pressable style={[s.btn, { backgroundColor: th.accentSoft }]} onPress={refreshDiag}>
          <Text style={[s.btnTxt, { color: th.accent }]}>刷新</Text>
        </Pressable>
        <Pressable
          style={[s.btn, { backgroundColor: th.accentSoft }]}
          onPress={() => {
            if (isExpoGo) return setSelfTest('自检需要正式 APK（Expo Go 不支持）');
            setSelfTest('测试中…');
            void bg().testNotify().then(setSelfTest);
          }}
        >
          <Text style={[s.btnTxt, { color: th.accent }]}>测试通知</Text>
        </Pressable>
        <Pressable
          style={[s.btn, { backgroundColor: th.accentSoft }]}
          onPress={() =>
            setSelfTest(isExpoGo ? '自检需要正式 APK（Expo Go 不支持）' : bg().testFireWatch())
          }
        >
          <Text style={[s.btnTxt, { color: th.accent }]}>测试窥屏</Text>
        </Pressable>
        <Pressable
          style={[s.btn, { backgroundColor: th.accentSoft }]}
          onPress={() => {
            if (isExpoGo) return setSelfTest('自检需要正式 APK（Expo Go 不支持）');
            setSelfTest('测试中…');
            void bg().testFireReach().then(setSelfTest);
          }}
        >
          <Text style={[s.btnTxt, { color: th.accent }]}>测试主动</Text>
        </Pressable>
      </View>
      {selfTest && <Text style={s.test}>{selfTest}</Text>}

      <Text style={s.label}>界面颜色</Text>
      <ColorPalette value={accent} onChange={setAccent} />
      <View style={s.hexRow}>
        <View style={[s.hexPreview, { backgroundColor: th.accent }]} />
        <TextInput
          style={[s.input, s.hexInput, hexError && s.hexInputBad]}
          value={hexInput}
          onChangeText={(t) => {
            setHexInput(t);
            setHexError(false);
          }}
          placeholder={accent}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable style={[s.btn, { backgroundColor: th.accent }]} onPress={applyHex}>
          <Text style={s.btnTxt}>应用</Text>
        </Pressable>
      </View>
      {hexError && <Text style={s.hexErrTxt}>无效颜色——请输入如 #3a6ea5 的十六进制值</Text>}

      <Text style={s.label}>数据</Text>
      <Pressable
        style={[s.btn, { backgroundColor: th.accent, alignSelf: 'flex-start' }]}
        onPress={() => void exportAll()}
      >
        <Text style={s.btnTxt}>导出全部数据（JSON）</Text>
      </Pressable>
      <Pressable
        style={[s.btn, { backgroundColor: '#a32d2d', alignSelf: 'flex-start', marginTop: 10, marginBottom: 32 }]}
        onPress={() => void importBackupFlow()}
      >
        <Text style={s.btnTxt}>导入备份（覆盖现有数据）</Text>
      </Pressable>

      <ConsentModal
        visible={usageConsentOpen}
        title="开启屏幕使用感知前请确认"
        body={
          '开启后，应用会读取你今天各应用的使用时长与名称，并发送给你所选的模型服务商（DeepSeek 或 GLM），' +
          '让她能自然地提起你在用什么、用了多久。\n\n这意味着：你的应用使用信息会离开设备。随时可关闭。'
        }
        tickLabel="我理解并接受我的应用使用信息会发送给模型服务商"
        onCancel={() => setUsageConsentOpen(false)}
        onConfirm={() => {
          setUsageConsent(true);
          setUsageConsentOpen(false);
          applyUsageMode(pendingUsage);
        }}
      />
      <ConsentModal
        visible={locConsentOpen}
        title="开启位置感知前请确认"
        body={
          '开启后，应用会持续读取你的大致位置（城市级）与时区，并发送给你所选的模型服务商（DeepSeek 或 GLM），' +
          '让她知道你在哪、判断你的作息早晚。\n\n这意味着：你的位置信息会离开设备。' +
          '为省电，位置只在你打开应用或后台心跳时刷新，不会持续开启 GPS。随时可关闭。'
        }
        tickLabel="我理解并接受我的大致位置会发送给模型服务商"
        onCancel={() => setLocConsentOpen(false)}
        onConfirm={() => {
          setLocConsentOpen(false);
          void enableLocation();
        }}
      />
      <ConsentModal
        visible={bgConsentOpen}
        title="开启后台主动联系前请确认"
        body={
          '开启后，即使你不在应用里，她也会主动给你发消息：应用会在你使用时提前准备好她想说的话，' +
          '由系统在她作息表中勾选「主动」的时段作为通知送达（应用被系统冻结也能送达）；你回到应用时这些消息会出现在聊天里。\n\n' +
          '此开关还会启用系统定期唤醒与后台实时联系：条件满足时她可能在后台真实调用模型服务商（DeepSeek 或 GLM）主动发消息。\n\n' +
          '这意味着：准备与发送消息都会真实调用模型服务商 API 并产生费用，即使你之后没有查看。'
        }
        tickLabel="我明白这会在我不使用应用时自动产生费用"
        onCancel={() => setBgConsentOpen(false)}
        onConfirm={() => {
          setBgConsentOpen(false);
          void bg().enableBackgroundReach().then((ok) => {
            if (ok) {
              setPref('backgroundReach', '1');
              setBgReach(true);
            } else {
              setTestResult('通知权限被拒绝，无法开启后台主动联系');
            }
          });
        }}
      />
      <AvatarCrop
        image={cropImage}
        onDone={(uri) => {
          setCropImage(null);
          if (uri) {
            setUserAvatar(uri);
            setUserAvatarState(uri);
          }
        }}
      />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  section: { marginTop: 20 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#eee',
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#333' },
  sectionChevron: { fontSize: 14, color: '#999' },
  label: { fontSize: 13, color: '#888', marginTop: 20, marginBottom: 6 },
  input: { fontSize: 16, padding: 10, backgroundColor: '#f2f2f2', borderRadius: 10 },
  btnRow: { flexDirection: 'row', marginTop: 10, gap: 10 },
  btn: { borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  btnTxt: { color: '#fff', fontSize: 15 },
  test: { marginTop: 10, fontSize: 14, color: '#444' },
  stickerHint: { marginTop: 8, fontSize: 11, color: '#999', lineHeight: 15 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  choice: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#f2f2f2' },
  choiceTxt: { fontSize: 14, color: '#444' },
  choiceTxtOn: { color: '#fff' },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nickInput: { flex: 1 },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12,
  },
  toggleLabel: { fontSize: 14, color: '#444', flexShrink: 1 },
  holdRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  holdInput: { width: 56, textAlign: 'center' },
  infoIcon: { fontSize: 18, paddingHorizontal: 4 },
  subLabel: { fontSize: 13, color: '#888', marginTop: 14, marginBottom: 6 },
  diagBox: { backgroundColor: '#f6f6f6', borderRadius: 10, padding: 12, marginTop: 4 },
  diagRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4,
  },
  diagLabel: { fontSize: 13, color: '#444', flex: 1, marginRight: 10 },
  diagVal: { fontSize: 13, color: '#444', fontVariant: ['tabular-nums'] },
  diagPill: { fontSize: 15, fontWeight: '700', width: 22, textAlign: 'center' },
  diagOk: { color: '#2f9e77' },
  diagBad: { color: '#a32d2d' },
  diagNote: { fontSize: 12, color: '#888', marginTop: 8, lineHeight: 16 },
  hexRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  hexPreview: { width: 34, height: 34, borderRadius: 17 },
  hexInput: { flex: 1 },
  hexInputBad: { borderWidth: 1, borderColor: '#a32d2d' },
  hexErrTxt: { marginTop: 6, fontSize: 12, color: '#a32d2d' },
});
