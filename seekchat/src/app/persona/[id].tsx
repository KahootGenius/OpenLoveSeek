import { useEffect, useState } from 'react';
import {
  Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { createPersona, deletePersona, getPersona, updatePersona } from '../../lib/db';
import { useTheme } from '../../lib/theme-context';
import { pickRawImage, RawImage } from '../../lib/avatar';
import { Avatar } from '../../components/Avatar';
import { AvatarCrop } from '../../components/AvatarCrop';
import { ConsentModal } from '../../components/ConsentModal';
import { parseProConfig, ProConfig } from '../../lib/pro';
import { DAY_PARTS, DayPart, MoodCurve } from '../../lib/curve';
import { DEFAULT_MOOD_CURVE } from '../../lib/constants';
import { native } from '../../lib/native';
import type { ScheduleEntry } from '../../lib/life';

const BASELINES = ['平静', '开朗', '高冷', '黏人', '忧郁'];
const REACH_RATES = ['健谈', '中等', '冷淡', '自定义'] as const;
const OPENNESS_LEVELS: { v: number; label: string }[] = [
  { v: 0.1, label: '低' }, { v: 0.3, label: '较低' }, { v: 0.5, label: '中' },
  { v: 0.7, label: '较高' }, { v: 0.9, label: '高' },
];
const nearestLevel = (v: number): number =>
  OPENNESS_LEVELS.reduce((a, b) => (Math.abs(b.v - v) < Math.abs(a - v) ? b.v : a), 0.5);

export default function PersonaEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const existing = isNew ? null : getPersona(id);
  const [name, setName] = useState(existing?.name ?? '');
  const [prompt, setPrompt] = useState(existing?.systemPrompt ?? '');
  const [sumPrompt, setSumPrompt] = useState(existing?.summaryPrompt ?? '');
  const [avatar, setAvatar] = useState<string | null>(existing?.avatarUri ?? null);
  const initialCfg = parseProConfig(existing?.proConfig ?? null);
  const [proOpen, setProOpen] = useState(initialCfg !== null);
  const [scheduleRows, setScheduleRows] = useState<ScheduleEntry[]>(initialCfg?.schedule ?? []);
  const [interests, setInterests] = useState(initialCfg?.interests ?? '');
  const [boundaries, setBoundaries] = useState(initialCfg?.boundaries ?? '');
  const [goals, setGoals] = useState(initialCfg?.goals ?? '');
  const [baseline, setBaseline] = useState(initialCfg?.moodBaseline ?? '');
  const [curveOn, setCurveOn] = useState(!!initialCfg?.moodCurve);
  const [curve, setCurve] = useState<MoodCurve>(() => {
    const src = initialCfg?.moodCurve ?? (DEFAULT_MOOD_CURVE as MoodCurve);
    const c: MoodCurve = {};
    for (const p of DAY_PARTS) {
      const e = src[p];
      if (e) c[p] = { openness: nearestLevel(e.openness), tone: e.tone };
    }
    return c;
  });
  const [growthOn, setGrowthOn] = useState(initialCfg?.curveGrowth !== false);
  const [patText, setPatText] = useState(initialCfg?.patText ?? '');
  const [exampleGood, setExampleGood] = useState(initialCfg?.exampleGood ?? '');
  const [exampleBad, setExampleBad] = useState(initialCfg?.exampleBad ?? '');
  const [patByChar, setPatByChar] = useState(initialCfg?.patByChar ?? '');
  const [patEmoji, setPatEmoji] = useState(initialCfg?.patEmoji ?? '');
  const [patEmojiChar, setPatEmojiChar] = useState(initialCfg?.patEmojiChar ?? '');
  const [autoReach, setAutoReach] = useState(initialCfg?.autoReach === true);
  const [consentGiven, setConsentGiven] = useState(initialCfg?.autoReachConsent === true);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentTicked, setConsentTicked] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [rateSel, setRateSel] = useState<string>(() =>
    typeof initialCfg?.reachRate === 'number'
      ? '自定义'
      : ((initialCfg?.reachRate as string) ?? '中等'),
  );
  const [yandere, setYandere] = useState(initialCfg?.yandere === true);
  const [yandereConsent, setYandereConsent] = useState(initialCfg?.yandereConsent === true);
  const [yandereConsentOpen, setYandereConsentOpen] = useState(false);
  const [lockCooldownMin, setLockCooldownMin] = useState(
    String(initialCfg?.lockCooldownMin ?? 30),
  );
  const toggleYandere = (on: boolean) => {
    if (on && !yandereConsent) {
      setYandereConsentOpen(true);
      return;
    }
    setYandere(on);
  };
  const [watchApps, setWatchApps] = useState(initialCfg?.watchApps === true);
  const [watchConsent, setWatchConsent] = useState(initialCfg?.watchConsent === true);
  const [watchConsentOpen, setWatchConsentOpen] = useState(false);
  const [watchCooldownMin, setWatchCooldownMin] = useState(
    String(initialCfg?.watchCooldownMin ?? 30),
  );
  const [usageOk, setUsageOk] = useState(() => native?.hasUsageAccess() ?? false);
  const toggleWatch = (on: boolean) => {
    if (on && !watchConsent) {
      setWatchConsentOpen(true);
      return;
    }
    setWatchApps(on);
  };
  const [transfers, setTransfers] = useState(initialCfg?.transfers === true);
  const [initBalance, setInitBalance] = useState(
    initialCfg?.initBalance != null ? String(initialCfg.initBalance) : '',
  );
  const [master, setMaster] = useState(initialCfg?.master === true);
  const [masterConsent, setMasterConsent] = useState(initialCfg?.masterConsent === true);
  const [masterConsentOpen, setMasterConsentOpen] = useState(false);
  const toggleMaster = (on: boolean) => {
    if (on && !masterConsent) {
      setMasterConsentOpen(true);
      return;
    }
    setMaster(on);
  };
  const [customN, setCustomN] = useState(
    typeof initialCfg?.reachRate === 'number' ? String(initialCfg.reachRate) : '3',
  );
  const { th } = useTheme();

  useEffect(() => {
    if (!consentOpen) return;
    setCountdown(5);
    setConsentTicked(false);
    const h = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(h);
  }, [consentOpen]);

  const toggleAutoReach = (on: boolean) => {
    if (on && !consentGiven) {
      setConsentOpen(true); // switch turns on only after consent confirms
      return;
    }
    setAutoReach(on);
  };

  const setPart = (p: DayPart, patch: Partial<{ openness: number; tone: string }>) =>
    setCurve((c) => ({ ...c, [p]: { openness: 0.5, ...c[p], ...patch } }));

  const setRow = (i: number, patch: Partial<ScheduleEntry>) =>
    setScheduleRows((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const [cropImage, setCropImage] = useState<RawImage | null>(null);
  const changeAvatar = async () => {
    const img = await pickRawImage();
    if (img) setCropImage(img);
  };

  const save = () => {
    if (!name.trim() || !prompt.trim()) {
      Alert.alert('名称和人设内容不能为空');
      return;
    }
    const sp = sumPrompt.trim() || null;
    const cfg: ProConfig = {};
    const rows = scheduleRows.filter((r) => r.start && r.end && r.activity);
    if (rows.length) cfg.schedule = rows;
    if (interests.trim()) cfg.interests = interests.trim();
    if (boundaries.trim()) cfg.boundaries = boundaries.trim();
    if (goals.trim()) cfg.goals = goals.trim();
    if (baseline.trim()) cfg.moodBaseline = baseline.trim();
    if (curveOn) {
      cfg.moodCurve = curve;
      if (!growthOn) cfg.curveGrowth = false;
    }
    if (patText.trim()) cfg.patText = patText.trim();
    if (exampleGood.trim()) cfg.exampleGood = exampleGood.trim();
    if (exampleBad.trim()) cfg.exampleBad = exampleBad.trim();
    if (patByChar.trim()) cfg.patByChar = patByChar.trim();
    if (patEmoji.trim()) cfg.patEmoji = patEmoji.trim();
    if (patEmojiChar.trim()) cfg.patEmojiChar = patEmojiChar.trim();
    if (consentGiven) cfg.autoReachConsent = true;
    if (yandereConsent) cfg.yandereConsent = true;
    if (yandere) cfg.yandere = true;
    const cd = parseInt(lockCooldownMin, 10);
    if (!Number.isNaN(cd) && cd !== 30) cfg.lockCooldownMin = Math.max(0, cd);
    if (watchConsent) cfg.watchConsent = true;
    if (watchApps) cfg.watchApps = true;
    const wcd = parseInt(watchCooldownMin, 10);
    if (!Number.isNaN(wcd) && wcd !== 30) cfg.watchCooldownMin = Math.max(1, wcd);
    if (masterConsent) cfg.masterConsent = true;
    if (master) cfg.master = true;
    if (transfers) {
      cfg.transfers = true;
      const ib = parseFloat(initBalance);
      if (!Number.isNaN(ib) && ib > 0) cfg.initBalance = Math.round(ib * 100) / 100;
    }
    if (autoReach) {
      cfg.autoReach = true;
      cfg.reachRate =
        rateSel === '自定义'
          ? Math.max(1, parseInt(customN, 10) || 3)
          : (rateSel as ProConfig['reachRate']);
    }
    const pro = Object.keys(cfg).length ? JSON.stringify(cfg) : null;
    if (isNew) createPersona(name.trim(), prompt.trim(), sp, avatar, pro);
    else updatePersona(id, name.trim(), prompt.trim(), sp, avatar, pro);
    router.back();
  };

  const remove = () => {
    Alert.alert('删除人设？', undefined, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          try {
            deletePersona(id);
            router.back();
          } catch {
            Alert.alert('无法删除', '仍有对话在使用此人设。请先删除或改建那些对话。');
          }
        },
      },
    ]);
  };

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 16 }}>
      <Text style={s.label}>头像（点击更换）</Text>
      <Pressable style={s.avatarWrap} onPress={() => void changeAvatar()}>
        <Avatar uri={avatar} name={name || '?'} size={72} />
      </Pressable>
      <Text style={s.label}>名称</Text>
      <TextInput style={s.input} value={name} onChangeText={setName} placeholder="例如：沫凌" />
      <Text style={s.label}>人设 / 系统提示词（身份、性格、行为准则、示例对话…）</Text>
      <TextInput
        style={[s.input, s.area]}
        value={prompt}
        onChangeText={setPrompt}
        multiline
        textAlignVertical="top"
        placeholder="[身份] …"
      />
      <Text style={s.label}>总结提示词（可选，留空使用全局默认）</Text>
      <TextInput
        style={[s.input, s.area, { minHeight: 120 }]}
        value={sumPrompt}
        onChangeText={setSumPrompt}
        multiline
        textAlignVertical="top"
        placeholder="自定义滚动总结的结构与规则…"
      />
      <Pressable style={s.proHeader} onPress={() => setProOpen((o) => !o)}>
        <Text style={s.proTitle}>{proOpen ? '▾' : '▸'} 高级设置（Pro）</Text>
      </Pressable>
      {proOpen && (
        <View>
          <Text style={s.proNotice}>
            ⚠ Pro 设定会为每次请求附加约 150–250 token 的上下文；配合「生活」的主动消息，总用量会明显增加。
          </Text>
          <Text style={s.label}>作息表</Text>
          {scheduleRows.map((r, i) => (
            <View key={i} style={s.schedRow}>
              <TextInput
                style={[s.input, s.schedTime]} value={r.start}
                onChangeText={(t) => setRow(i, { start: t })}
                placeholder="07:00" autoCapitalize="none"
              />
              <TextInput
                style={[s.input, s.schedTime]} value={r.end}
                onChangeText={(t) => setRow(i, { end: t })}
                placeholder="08:00" autoCapitalize="none"
              />
              <TextInput
                style={[s.input, s.schedAct]} value={r.activity}
                onChangeText={(t) => setRow(i, { activity: t })}
                placeholder="活动"
              />
              <Pressable
                style={[s.reachBox, r.reach && { backgroundColor: th.accent, borderColor: th.accent }]}
                onPress={() => setRow(i, { reach: !r.reach })}
              >
                <Text style={[s.reachBoxTxt, r.reach && { color: '#fff' }]}>主动</Text>
              </Pressable>
              <Pressable
                style={s.schedDel}
                onPress={() => setScheduleRows((rows) => rows.filter((_, j) => j !== i))}
              >
                <Text style={{ color: '#a32d2d', fontSize: 16 }}>✕</Text>
              </Pressable>
            </View>
          ))}
          <Pressable
            style={[s.schedAdd, { backgroundColor: th.accentSoft }]}
            onPress={() =>
              setScheduleRows((rows) => [...rows, { start: '', end: '', activity: '' }])
            }
          >
            <Text style={{ color: th.accent, fontSize: 14 }}>＋ 添加时间段</Text>
          </Pressable>
          <Text style={s.label}>兴趣爱好（可选）</Text>
          <TextInput
            style={[s.input, s.proArea]} value={interests} onChangeText={setInterests}
            multiline textAlignVertical="top"
          />
          <Text style={s.label}>雷区与底线（可选，硬约束）</Text>
          <TextInput
            style={[s.input, s.proArea]} value={boundaries} onChangeText={setBoundaries}
            multiline textAlignVertical="top"
          />
          <Text style={s.label}>当前目标（可选）</Text>
          <TextInput
            style={[s.input, s.proArea]} value={goals} onChangeText={setGoals}
            multiline textAlignVertical="top"
          />
          <Text style={s.label}>示例对话 · 好例（可选——她该有的语气，只定语气不会被复述）</Text>
          <TextInput
            style={[s.input, s.proArea]} value={exampleGood} onChangeText={setExampleGood}
            multiline textAlignVertical="top"
            placeholder={'用户：累了\n她：过来，靠着我。'}
          />
          <Text style={s.label}>示例对话 · 坏例（可选——她绝不能有的语气）</Text>
          <TextInput
            style={[s.input, s.proArea]} value={exampleBad} onChangeText={setExampleBad}
            multiline textAlignVertical="top"
            placeholder="亲爱的用户您好！很高兴为您服务～"
          />
          <Text style={s.label}>情绪基线</Text>
          <View style={s.chipRow}>
            {BASELINES.map((b) => (
              <Pressable
                key={b}
                style={[s.chip, baseline === b && { backgroundColor: th.accent }]}
                onPress={() => setBaseline(baseline === b ? '' : b)}
              >
                <Text style={[s.chipTxt, baseline === b && { color: '#fff' }]}>{b}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={s.input} value={BASELINES.includes(baseline) ? '' : baseline}
            onChangeText={setBaseline} placeholder="或自定义基线，如：慵懒"
          />

          <View style={s.curveHead}>
            <Text style={s.label}>情绪曲线（一天中的敞开程度随时间变化）</Text>
            <Switch
              value={curveOn}
              onValueChange={setCurveOn}
              trackColor={{ true: th.accent }}
            />
          </View>
          {curveOn && (
            <View>
              {DAY_PARTS.map((p) => (
                <View key={p} style={s.curveRow}>
                  <Text style={s.curvePart}>{p}</Text>
                  <View style={s.chipRow}>
                    {OPENNESS_LEVELS.map((l) => (
                      <Pressable
                        key={l.v}
                        style={[
                          s.chipSm,
                          curve[p]?.openness === l.v && { backgroundColor: th.accent },
                        ]}
                        onPress={() => setPart(p, { openness: l.v })}
                      >
                        <Text
                          style={[
                            s.chipTxt,
                            curve[p]?.openness === l.v && { color: '#fff' },
                          ]}
                        >
                          {l.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <TextInput
                    style={[s.input, s.curveTone]}
                    value={curve[p]?.tone ?? ''}
                    onChangeText={(t) => setPart(p, { tone: t })}
                    placeholder="语气注记（可选，如：防备放下）"
                    maxLength={20}
                  />
                </View>
              ))}
              <View style={s.curveHead}>
                <Text style={s.toggleLabel}>允许角色成长（模型可小幅调整曲线）</Text>
                <Switch
                  value={growthOn}
                  onValueChange={setGrowthOn}
                  trackColor={{ true: th.accent }}
                />
              </View>
            </View>
          )}

          <Text style={s.label}>拍一拍 · 我拍她时（双击头像发送）</Text>
          <TextInput
            style={s.input}
            value={patText}
            onChangeText={setPatText}
            placeholder="我拍了拍你（如：我拍了拍你的头并说乖）"
            maxLength={40}
          />
          <Text style={s.label}>拍一拍 · 她拍我时的默认写法（她可偶尔自行改写）</Text>
          <TextInput
            style={s.input}
            value={patByChar}
            onChangeText={setPatByChar}
            placeholder="如：你戳了戳桃子的脸并说好软（写上你的昵称）"
            maxLength={40}
          />
          <View style={s.emojiRow}>
            <View style={s.emojiCol}>
              <Text style={s.label}>我拍她的表情</Text>
              <TextInput
                style={[s.input, s.emojiInput]}
                value={patEmoji}
                onChangeText={setPatEmoji}
                placeholder="👋"
                maxLength={4}
              />
            </View>
            <View style={s.emojiCol}>
              <Text style={s.label}>她拍我的表情</Text>
              <TextInput
                style={[s.input, s.emojiInput]}
                value={patEmojiChar}
                onChangeText={setPatEmojiChar}
                placeholder="👉"
                maxLength={4}
              />
            </View>
          </View>

          <View style={s.curveHead}>
            <Text style={s.toggleLabel}>主动联系（按作息自动发起对话）</Text>
            <Switch
              value={autoReach}
              onValueChange={toggleAutoReach}
              trackColor={{ true: th.accent }}
            />
          </View>
          {autoReach && (
            <View>
              <Text style={s.proNotice}>
                在作息表中勾选「主动」的时段内，她会按下方频率主动发消息；配合设置里的「后台主动联系」，
                不在应用时也会以通知送达。每次主动消息都是一次真实 API 请求。
              </Text>
              <View style={s.chipRow}>
                {REACH_RATES.map((r) => (
                  <Pressable
                    key={r}
                    style={[s.chip, rateSel === r && { backgroundColor: th.accent }]}
                    onPress={() => setRateSel(r)}
                  >
                    <Text style={[s.chipTxt, rateSel === r && { color: '#fff' }]}>
                      {r === '健谈' ? '健谈（约1小时）' : r === '中等' ? '中等（约3小时）' : r === '冷淡' ? '冷淡（约8小时）' : '自定义'}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {rateSel === '自定义' && (
                <View style={s.customRateRow}>
                  <TextInput
                    style={[s.input, s.customRateInput]}
                    value={customN}
                    onChangeText={setCustomN}
                    keyboardType="number-pad"
                    maxLength={2}
                  />
                  <Text style={s.toggleLabel}>次 / 天（上限 8）</Text>
                </View>
              )}
            </View>
          )}

          <View style={s.curveHead}>
            <Text style={s.toggleLabel}>病娇模式（角色可震动手机、弹出需指纹/密码解锁的锁定画面）</Text>
            <Switch
              value={yandere}
              onValueChange={toggleYandere}
              trackColor={{ true: '#a32d2d' }}
            />
          </View>
          {yandere && (
            <View>
              <Text style={s.proNotice}>
                角色会在情绪强烈时偶尔越界：震动你的手机，弹出需指纹/面容/密码解锁的画面，或要你亲手打出一句话才放行
                （始终可按 Home 键离开，不会真正锁住手机）。
              </Text>
              <View style={s.customRateRow}>
                <Text style={s.toggleLabel}>锁屏冷却</Text>
                <TextInput
                  style={[s.input, s.customRateInput]}
                  value={lockCooldownMin}
                  onChangeText={setLockCooldownMin}
                  keyboardType="number-pad"
                  maxLength={4}
                />
                <Text style={s.toggleLabel}>分钟（0=不限制）</Text>
              </View>

              <View style={s.curveHead}>
                <Text style={s.toggleLabel}>
                  屏幕窥视（她能注意到你切到了哪个 App，并借题发挥）
                </Text>
                <Switch
                  value={watchApps}
                  onValueChange={toggleWatch}
                  trackColor={{ true: '#a32d2d' }}
                />
              </View>
              {watchApps && (
                <View>
                  <Text style={s.proNotice}>
                    需要正式 APK + 系统「使用情况访问」授权 + 设置中的「后台守护」开启。
                    仅在你离开本应用时生效；她的每次反应都是一次真实 API 请求并可能弹通知。
                  </Text>
                  <View style={s.customRateRow}>
                    <Text style={s.toggleLabel}>反应冷却</Text>
                    <TextInput
                      style={[s.input, s.customRateInput]}
                      value={watchCooldownMin}
                      onChangeText={setWatchCooldownMin}
                      keyboardType="number-pad"
                      maxLength={4}
                    />
                    <Text style={s.toggleLabel}>分钟</Text>
                  </View>
                  {native && !usageOk && (
                    <Pressable
                      style={[s.schedAdd, { backgroundColor: th.accentSoft }]}
                      onPress={() => {
                        native?.openUsageAccessSettings();
                        setTimeout(() => setUsageOk(native?.hasUsageAccess() ?? false), 1000);
                      }}
                    >
                      <Text style={{ color: th.accent, fontSize: 14 }}>
                        去授予「使用情况访问」权限
                      </Text>
                    </Pressable>
                  )}
                  {native && usageOk && (
                    <Text style={s.proNotice}>✓ 已获得「使用情况访问」权限</Text>
                  )}
                  {!native && (
                    <Text style={s.proNotice}>当前运行环境没有原生模块——需安装最新正式 APK。</Text>
                  )}
                </View>
              )}
            </View>
          )}

          <View style={s.curveHead}>
            <Text style={s.toggleLabel}>转账（虚拟红包：你俩可以互相转账，纯属心意）</Text>
            <Switch value={transfers} onValueChange={setTransfers} trackColor={{ true: th.accent }} />
          </View>
          {transfers && (
            <View style={s.customRateRow}>
              <Text style={s.toggleLabel}>她的初始余额</Text>
              <TextInput
                style={[s.input, s.customRateInput]}
                value={initBalance}
                onChangeText={setInitBalance}
                keyboardType="decimal-pad"
                placeholder="520"
              />
              <Text style={s.toggleLabel}>元（虚拟）</Text>
            </View>
          )}

          <View style={s.curveHead}>
            <Text style={s.toggleLabel}>主人模式（支配层：命令、限时服从、调教值、规矩）</Text>
            <Switch
              value={master}
              onValueChange={toggleMaster}
              trackColor={{ true: '#a32d2d' }}
            />
          </View>
          {master && (
            <Text style={s.proNotice}>
              更强的支配层，建议配合病娇模式使用。称呼与规矩由角色依自己的性格自行设定（你无法编辑，
              只能在对话中遵从）——温柔或严厉皆由她定。她会下达命令、限时服从、增减调教值、执行规矩，
              并可越界惩戒（复用病娇的震动/锁定）。设备权限上限与病娇一致，始终可按 Home 键离开。
            </Text>
          )}
        </View>
      )}

      <ConsentModal
        visible={yandereConsentOpen}
        title="开启病娇模式前请确认"
        body={
          '开启后，角色会在情绪强烈时偶尔（低频）主动做出越界举动：让你的手机震动，或弹出一个需要你的指纹/面容/密码才能解开的锁定画面。\n\n' +
          '这些由 AI 判断触发，可能在你不期望的时刻发生。锁定画面只是应用内的遮罩——你随时可以按 Home 键离开，它永远不会真正锁住或控制你的手机。'
        }
        tickLabel="我理解并接受角色可能震动手机、弹出锁定画面"
        onCancel={() => setYandereConsentOpen(false)}
        onConfirm={() => {
          setYandereConsent(true);
          setYandere(true);
          setYandereConsentOpen(false);
        }}
      />
      <ConsentModal
        visible={watchConsentOpen}
        title="开启屏幕窥视前请确认"
        body={
          '开启后，应用会通过系统「使用情况访问」权限读取你当前正在使用的应用名称（仅应用名，不读取任何内容），' +
          '并把它发给 DeepSeek，让角色即时做出反应（例如你打开音乐 App 时她发来"在听什么啊？"）。\n\n' +
          '这意味着：你的前台应用名称会离开设备发送到 DeepSeek 服务器；每次反应都是一次真实 API 请求并产生费用。' +
          '随时可关闭本开关或收回系统权限。'
        }
        tickLabel="我理解并接受前台应用名称会被发送给 DeepSeek"
        onCancel={() => setWatchConsentOpen(false)}
        onConfirm={() => {
          setWatchConsent(true);
          setWatchApps(true);
          setWatchConsentOpen(false);
        }}
      />
      <ConsentModal
        visible={masterConsentOpen}
        title="开启主人模式前请确认"
        body={
          '这是一个更强烈的支配/服从角色扮演模式，仅适合你本人自愿的成人向扮演。开启后角色会下达命令、' +
          '限时要求你回复、按表现增减"调教值"、执行你设定的规矩，并可能震动手机或弹出需生物识别解锁的画面。\n\n' +
          '所有设备行为都可逆、受频率限制，你随时可按 Home 键离开应用。这些由 AI 判断触发，可能在你不期望时发生。'
        }
        tickLabel="我自愿开启，并理解上述所有行为"
        onCancel={() => setMasterConsentOpen(false)}
        onConfirm={() => {
          setMasterConsent(true);
          setMaster(true);
          setMasterConsentOpen(false);
        }}
      />

      <Modal visible={consentOpen} transparent animationType="fade">
        <View style={s.consentBackdrop}>
          <View style={s.consentCard}>
            <Text style={s.consentTitle}>开启主动联系前请确认</Text>
            <Text style={s.consentBody}>
              开启后，角色会在你标记的时段内按所选频率自动发起对话。每一次主动消息都会真实调用
              DeepSeek API 并产生费用（按 token 计费），即使你没有在看这个聊天。
            </Text>
            <Pressable
              style={s.consentTickRow}
              onPress={() => setConsentTicked((t) => !t)}
            >
              <View style={[s.tickBox, consentTicked && { backgroundColor: th.accent, borderColor: th.accent }]}>
                {consentTicked && <Text style={{ color: '#fff', fontSize: 12 }}>✓</Text>}
              </View>
              <Text style={s.consentTickTxt}>我明白这会自动产生费用</Text>
            </Pressable>
            <View style={s.consentBtnRow}>
              <Pressable style={s.consentCancel} onPress={() => setConsentOpen(false)}>
                <Text style={{ color: '#666', fontSize: 15 }}>取消</Text>
              </Pressable>
              <Pressable
                style={[
                  s.consentOk,
                  { backgroundColor: th.accent },
                  (countdown > 0 || !consentTicked) && { opacity: 0.4 },
                ]}
                disabled={countdown > 0 || !consentTicked}
                onPress={() => {
                  setConsentGiven(true);
                  setAutoReach(true);
                  setConsentOpen(false);
                }}
              >
                <Text style={{ color: '#fff', fontSize: 15 }}>
                  {countdown > 0 ? `确认（${countdown}）` : '确认开启'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Pressable style={[s.save, { backgroundColor: th.accent }]} onPress={save}>
        <Text style={s.saveTxt}>保存</Text>
      </Pressable>
      {!isNew && (
        <Pressable style={s.del} onPress={remove}>
          <Text style={s.delTxt}>删除人设</Text>
        </Pressable>
      )}
      <AvatarCrop
        image={cropImage}
        onDone={(uri) => {
          setCropImage(null);
          if (uri) setAvatar(uri);
        }}
      />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  avatarWrap: { alignSelf: 'flex-start' },
  label: { fontSize: 13, color: '#888', marginTop: 16, marginBottom: 6 },
  input: { fontSize: 15, padding: 10, backgroundColor: '#f2f2f2', borderRadius: 10 },
  area: { minHeight: 200, lineHeight: 21 },
  proHeader: { marginTop: 24, paddingVertical: 8 },
  proTitle: { fontSize: 15, fontWeight: '600' },
  proNotice: { fontSize: 12, color: '#996a00', lineHeight: 17, marginBottom: 4 },
  proArea: { minHeight: 80, lineHeight: 21 },
  schedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  schedTime: { width: 64, textAlign: 'center', paddingHorizontal: 4 },
  reachBox: {
    borderWidth: 1, borderColor: '#ccc', borderRadius: 8,
    paddingHorizontal: 6, paddingVertical: 6,
  },
  reachBoxTxt: { fontSize: 11, color: '#888' },
  emojiRow: { flexDirection: 'row', gap: 16 },
  emojiCol: { flex: 1 },
  emojiInput: { textAlign: 'center' },
  customRateRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  customRateInput: { width: 60, textAlign: 'center' },
  consentBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  consentCard: { backgroundColor: '#fff', borderRadius: 14, padding: 20, width: '100%' },
  consentTitle: { fontSize: 17, fontWeight: '600', marginBottom: 10 },
  consentBody: { fontSize: 14, color: '#444', lineHeight: 21 },
  consentTickRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  tickBox: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: '#bbb',
    alignItems: 'center', justifyContent: 'center',
  },
  consentTickTxt: { fontSize: 14, color: '#333' },
  consentBtnRow: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: 14, marginTop: 18,
  },
  consentCancel: { paddingHorizontal: 14, paddingVertical: 10 },
  consentOk: { borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  schedAct: { flex: 1 },
  schedDel: { padding: 6 },
  schedAdd: {
    alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8,
    marginTop: 2,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#f2f2f2' },
  chipSm: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#f2f2f2' },
  chipTxt: { fontSize: 13, color: '#444' },
  curveHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8,
  },
  curveRow: { marginBottom: 10 },
  curvePart: { fontSize: 14, fontWeight: '600', marginBottom: 4 },
  curveTone: { marginTop: 2, fontSize: 13, paddingVertical: 8 },
  toggleLabel: { fontSize: 14, color: '#444', flex: 1, marginRight: 10 },
  save: {
    marginTop: 24, borderRadius: 10,
    alignItems: 'center', paddingVertical: 12,
  },
  saveTxt: { color: '#fff', fontSize: 16 },
  del: { marginTop: 12, alignItems: 'center', paddingVertical: 12 },
  delTxt: { color: '#a32d2d', fontSize: 14 },
});
