import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
  Alert, RefreshControl, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { coinApi, taskApi, vipApi, userApi, mediaUrl } from '../api';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme, type ThemeColors } from '../theme/ThemeContext';

// ① 顶部预留状态栏高度（+12 留白），避免钱包内容被手机状态栏遮挡。
// 栈内屏 SafeAreaView edges=['top'] 的 inset 偏短，统一用 StatusBar.currentHeight 推下。
const STATUS_TOP = (StatusBar.currentHeight || 24) + 12;

// 星期缩写（签到横向日期条用）
const WEEK_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// ⑨ 离线兜底的基础领取方案。
// 正常路径由后台「观看时长规则 → 时长奖励档位」配置，经 /tasks/center 的
// watchDuration.tiers 下发（含每档分钟数、金币、是否已领取），客户端直接渲染。
// 只有旧后端 / 离线时才回落到下面这组内置方案。
const BASE_WATCH_PLAN = [
  { minutes: 5, coins: 5 },
  { minutes: 10, coins: 10 },
  { minutes: 20, coins: 20 },
  { minutes: 30, coins: 30 },
  { minutes: 60, coins: 50 },
  { minutes: 90, coins: 80 },
  { minutes: 120, coins: 100 },
];

// 与后端 GET /tasks/center 的返回结构保持一致
interface TaskCenter {
  newbieTasks?: any[];
  dailyTasks?: any[];
  todayProgress?: { collected?: number; total?: number };
  checkin?: {
    checkedInToday?: boolean;
    streak?: number;
    monthCount?: number;
    available?: boolean;
    limitReason?: string;
    rule?: any;
    todayReward?: any;
  };
  watchDuration?: {
    seconds?: number;
    coinsEarned?: number;
    capCoins?: number;
    segmentMinutes?: number;
    segments?: number;
    maxSegments?: number;
    rewardPerSegment?: number;
    nextReward?: number;
    capped?: boolean;
    // 后台配置的领取档位（manual 模式下为权威数据源）
    mode?: 'manual' | 'auto';
    tiers?: {
      minutes: number;
      coins: number;
      reached?: boolean;
      claimed?: boolean;
      claimable?: boolean;
    }[];
  };
}
interface VipStatus {
  // 后端 GET /vip/my：无有效订阅返回 null；有效订阅返回 tierKey/tierName/status/endAt（没有 active 字段）
  tierKey?: string;
  tierName?: string;
  status?: string;
  endAt?: string;
  expiresAt?: string;
  tier?: any;
  active?: boolean;
}

// 生成 YYYY-MM 形式的月份字符串（签到日历接口需要）
function getMonthString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
// 今日 YYYY-MM-DD（领取记录按天隔离）
function getDayString(d: Date): string {
  return `${getMonthString(d)}-${String(d.getDate()).padStart(2, '0')}`;
}

// 解析签到日历返回：兼容 数组 / {days} / {checkinDays} / {checkedDays} / {dates}
function getCheckinDays(raw: any): number[] {
  if (!raw) return [];
  let days: any[] = [];
  if (Array.isArray(raw)) days = raw;
  else if (Array.isArray(raw?.days)) days = raw.days;
  else if (Array.isArray(raw?.checkinDays)) days = raw.checkinDays;
  else if (Array.isArray(raw?.checkedDays)) days = raw.checkedDays;
  else if (Array.isArray(raw?.dates)) days = raw.dates;
  return days
    .map((d) => {
      if (typeof d === 'number') return d;
      if (typeof d === 'string') {
        const m = d.match(/(\d+)\D*$/);
        if (m) return parseInt(m[1], 10);
      }
      if (d && typeof d === 'object') {
        const v = d.day ?? d.date;
        if (typeof v === 'number') return v;
        if (typeof v === 'string') {
          const mm = v.match(/(\d+)\D*$/);
          if (mm) return parseInt(mm[1], 10);
        }
      }
      return NaN;
    })
    .filter((n) => Number.isFinite(n));
}

export default function Wallet({ navigation }: any) {
  const { t, vipScreenEnabled } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [coinBalance, setCoinBalance] = useState(0);
  const [taskCenter, setTaskCenter] = useState<TaskCenter | null>(null);
  const [vip, setVip] = useState<VipStatus | null>(null);
  const [claimingKey, setClaimingKey] = useState<string | null>(null);
  const [claimingWatch, setClaimingWatch] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  // 本月已签到日期（当月第几天）
  const [calendar, setCalendar] = useState<number[]>([]);
  // ⑨ 今日已点击领取的时长档位（分钟），按天存 AsyncStorage
  const [claimedMinutes, setClaimedMinutes] = useState<number[]>([]);

  const today = useMemo(() => new Date(), []);
  const todayDay = today.getDate();
  const daysInMonth = useMemo(
    () => new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate(),
    [today],
  );
  const claimStorageKey = `watch_claims_${getDayString(today)}`;
  const checkedSet = useMemo(() => new Set(calendar), [calendar]);
  const checkinScrollRef = useRef<any>(null);

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    try {
      const u = await AsyncStorage.getItem('user_info');
      const token = await AsyncStorage.getItem('user_token');
      // 必须「有 user_info 且有 token」才算已登录，避免退出后残留串号
      if (!u || !token) {
        setUser(null);
        setCoinBalance(0);
        setTaskCenter(null);
        setVip(null);
        setCalendar([]);
        setClaimedMinutes([]);
        return;
      }
      let userInfo = JSON.parse(u);

      const [balance, center, vipRes, calendarRes, savedClaims, remoteProfile] = await Promise.all([
        coinApi.balance().catch(() => ({ balance: 0 })),
        taskApi.center().catch(() => null),
        vipScreenEnabled ? vipApi.my().catch(() => null) : Promise.resolve(null),
        taskApi.checkinCalendar(getMonthString(new Date())).catch(() => null),
        AsyncStorage.getItem(claimStorageKey).catch(() => null),
        // 头像/昵称以服务端为准（与 Profile.tsx 一致）：本地 user_info 只是登录时快照
        userApi.profile().catch(() => null),
      ]);
      if (remoteProfile && typeof remoteProfile === 'object') {
        userInfo = { ...userInfo, ...remoteProfile };
        await AsyncStorage.setItem('user_info', JSON.stringify(userInfo)).catch(() => {});
      }
      setUser(userInfo);
      // 后端 /coins/balance 返回的是 { coins }，不是 { balance }。
      setCoinBalance(balance?.coins ?? balance?.balance ?? 0);
      setTaskCenter(center);
      setVip(vipRes || null);
      setCalendar(getCheckinDays(calendarRes));
      try {
        const parsed = savedClaims ? JSON.parse(savedClaims) : [];
        setClaimedMinutes(Array.isArray(parsed) ? parsed : []);
      } catch {
        setClaimedMinutes([]);
      }
    } catch {}
    finally {
      if (showLoader) setLoading(false);
    }
  }, [vipScreenEnabled, claimStorageKey]);

  React.useEffect(() => { load(); }, [load]);

  // ② 签到日期条：加载后自动滚到「今天」附近，方便直接看到今日格
  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => {
      const x = Math.max(0, (todayDay - 3) * 52);
      checkinScrollRef.current?.scrollTo({ x, animated: false });
    }, 120);
    return () => clearTimeout(timer);
  }, [loading, todayDay, calendar.length]);

  const onRefresh = () => {
    setRefreshing(true);
    load(false).finally(() => setRefreshing(false));
  };

  const claimTask = async (taskKey: string) => {
    setClaimingKey(taskKey);
    try {
      const res: any = await taskApi.claim(taskKey);
      const gained = res?.reward ?? res?.granted ?? 0;
      Alert.alert(t('wallet.rewardClaimed'), t('wallet.coinsAdded', { n: gained }));
      load(false);
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.response?.data?.message || t('wallet.claimFailed'));
    } finally {
      setClaimingKey(null);
    }
  };

  const doCheckin = async () => {
    setCheckingIn(true);
    try {
      const res: any = await taskApi.checkin();
      const gained = res?.totalCoins ?? res?.granted ?? 0;
      Alert.alert(t('wallet.checkedIn'), t('wallet.coinsAdded', { n: gained }));
      load(false);
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.response?.data?.message || t('wallet.checkinFailed'));
    } finally {
      setCheckingIn(false);
    }
  };

  // ⑨ 时长奖励档位：后台 watchDuration.tiers 优先，旧后端按规则换算，离线回落内置方案
  const watchPlan = useMemo(() => {
    const wd = taskCenter?.watchDuration;
    const tiers = wd?.tiers;
    if (Array.isArray(tiers) && tiers.length > 0) {
      return tiers
        .map((x) => ({ minutes: Number(x.minutes) || 0, coins: Number(x.coins) || 0 }))
        .filter((x) => x.minutes > 0);
    }
    const per = Number(wd?.rewardPerSegment) || 0;
    const seg = Number(wd?.segmentMinutes) || 5;
    if (per > 0) {
      return BASE_WATCH_PLAN.map((p) => ({
        minutes: p.minutes,
        coins: Math.max(1, Math.round(per * (p.minutes / seg))),
      }));
    }
    return BASE_WATCH_PLAN;
  }, [taskCenter]);

  const watchSeconds = Number(taskCenter?.watchDuration?.seconds) || 0;
  const watchedMinutes = Math.floor(watchSeconds / 60);
  // 已领状态以后端为准（换设备/重装 App 不会重复领），本地 AsyncStorage 仅作离线补充
  const claimedSet = useMemo(() => {
    const s = new Set(claimedMinutes);
    const tiers = taskCenter?.watchDuration?.tiers;
    if (Array.isArray(tiers)) {
      tiers.forEach((x) => {
        if (x.claimed) s.add(Number(x.minutes));
      });
    }
    return s;
  }, [claimedMinutes, taskCenter]);

  const isAchieved = (minutes: number) => watchSeconds >= minutes * 60;
  const isClaimed = (minutes: number) => claimedSet.has(minutes);
  const canClaim = (minutes: number) => isAchieved(minutes) && !isClaimed(minutes);
  const claimableList = watchPlan.filter((p) => canClaim(p.minutes));

  const persistClaims = async (next: number[]) => {
    setClaimedMinutes(next);
    await AsyncStorage.setItem(claimStorageKey, JSON.stringify(next)).catch(() => {});
  };

  // 单个时长框：调用后端领取接口真实加币（后端保证每天每档只发一次）
  const claimWatch = async (plan: { minutes: number; coins: number }) => {
    if (!canClaim(plan.minutes) || claimingWatch) return;
    setClaimingWatch(true);
    try {
      const res: any = await taskApi.claimWatch({ minutes: plan.minutes });
      const got = Number(res?.coins) || 0;
      if (got > 0) {
        await persistClaims([...claimedSet, plan.minutes]);
        Alert.alert(t('wallet.rewardClaimed'), t('wallet.watchClaimOk', { n: got }));
      } else {
        Alert.alert(t('wallet.watchRewards'), t('wallet.watchNoClaimable'));
      }
      load(false);
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.response?.data?.message || t('common.error'));
    } finally {
      setClaimingWatch(false);
    }
  };

  // ⑨ 右侧「一键领取」：把已达成档位一次性交给后端结算
  const claimAllWatch = async () => {
    if (claimableList.length === 0) {
      Alert.alert(t('wallet.watchRewards'), t('wallet.watchNoClaimable'));
      return;
    }
    if (claimingWatch) return;
    setClaimingWatch(true);
    try {
      const res: any = await taskApi.claimWatch({ all: true });
      const got = Number(res?.coins) || 0;
      const list: number[] = Array.isArray(res?.claimed)
        ? res.claimed.map((x: any) => Number(x.minutes))
        : [];
      if (list.length > 0) await persistClaims([...claimedSet, ...list]);
      if (got > 0) {
        Alert.alert(
          t('wallet.rewardClaimed'),
          t('wallet.claimAllSuccess', { n: list.length, c: got }),
        );
      } else {
        Alert.alert(t('wallet.watchRewards'), t('wallet.watchNoClaimable'));
      }
      load(false);
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.response?.data?.message || t('common.error'));
    } finally {
      setClaimingWatch(false);
    }
  };

  // 单个任务行：区分「未完成 / 可领取 / 已领取」三种状态
  const renderTask = (task: any) => {
    const claimed = !!task.claimed;
    const completed = !!task.completed;
    const busy = claimingKey === task.key;
    const nameKey = `wallet.taskName_${task.key}`;
    const descKey = `wallet.taskDesc_${task.key}`;
    const name = t(nameKey) === nameKey ? task.name : t(nameKey);
    const description = task.description && t(descKey) !== descKey ? t(descKey) : task.description;
    const label = claimed ? t('wallet.claimed') : completed ? t('wallet.claim') : t('wallet.goComplete');
    const bg = claimed ? colors.borderStrong : completed ? colors.primary : colors.surfaceAlt;
    const fg = claimed ? colors.muted : completed ? '#fff' : colors.textSecondary;
    return (
      <View key={task.key} style={styles.card}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: 'bold' }}>{name}</Text>
          {!!description && (
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{description}</Text>
          )}
          <Text style={{ color: colors.gold, marginTop: 4 }}>+{task.reward} {t('wallet.coinsUnit')}</Text>
        </View>
        <TouchableOpacity
          onPress={() => claimTask(task.key)}
          disabled={claimed || !completed || busy}
          style={{
            backgroundColor: bg, paddingHorizontal: 16, minHeight: 44,
            borderRadius: 22, justifyContent: 'center', alignItems: 'center',
            opacity: busy ? 0.6 : 1,
          }}
        >
          <Text style={{ color: fg }}>{label}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <View style={[styles.center, { paddingTop: STATUS_TOP }]}>
          <Text style={{ color: colors.muted, marginBottom: 16 }}>{t('wallet.pleaseLogin')}</Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('Login')}
            style={{ backgroundColor: colors.primary, paddingHorizontal: 24, minHeight: 44, borderRadius: 22, justifyContent: 'center' }}
          >
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>{t('wallet.logIn')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const ci = taskCenter?.checkin;
  const done = !!ci?.checkedInToday;
  const blocked = ci && ci.available === false;
  const checkinDisabled = checkingIn || done || !!blocked;
  const checkinLabel = checkingIn
    ? t('wallet.checkingIn')
    : done
      ? t('wallet.checkedIn')
      : blocked
        ? t('wallet.checkinUnavailable')
        : t('wallet.checkIn');
  const todayRewardCoins = Number(ci?.todayReward?.total) || 0;
  // 后端 /vip/my 返回 { tierKey, tierName, status, endAt, tier }（没有 active 字段），
  // 无有效订阅返回 null。徽章严格按真实订阅数据展示：等级名按 tierKey 本地化，
  // 只有 status=active 且未过期才算有效；未开通 / 已过期显示「未开通 VIP」。
  const vipTierKey = vip?.tierKey || vip?.tier?.key || '';
  const tierLabelKey = vipTierKey ? `tier.${vipTierKey}` : '';
  const tierLabel = tierLabelKey ? t(tierLabelKey) : '';
  const vipName = tierLabel && tierLabel !== tierLabelKey
    ? tierLabel
    : (vip?.tierName || vip?.tier?.name || '');
  const vipEndAt = vip?.endAt ?? vip?.expiresAt ?? null;
  const vipActive = !!vip && !!vipName
    && (!vip.status || vip.status === 'active')
    && (!vipEndAt || new Date(vipEndAt).getTime() > Date.now());
  const vipExpireLabel = (() => {
    if (!vipActive || !vipEndAt) return '';
    const d = new Date(vipEndAt);
    if (isNaN(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return t('vip.expiresOn', { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` });
  })();

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingTop: STATUS_TOP, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* 任务中心：新人任务 / 每日任务（签到合并到下方「每日签到」）/ 我的金币 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('wallet.taskCenter')}</Text>
          {taskCenter?.todayProgress && (
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>
              {t('wallet.todayProgress', {
                collected: taskCenter.todayProgress.collected ?? 0,
                total: taskCenter.todayProgress.total ?? 0,
              })}
            </Text>
          )}
          {/* 我的金币：Hero 移到「我的」页后，任务中心仍展示余额 */}
          <View style={styles.myCoinsBox}>
            <Text style={styles.myCoinsLabel}>{t('wallet.myCoins')}</Text>
            <Text style={styles.myCoinsValue}>🪙 {coinBalance.toLocaleString()} {t('wallet.coinsUnit')}</Text>
          </View>
          {(taskCenter?.newbieTasks?.length ?? 0) > 0 && (
            <>
              <Text style={styles.subTitle}>{t('wallet.newbieTasks')}</Text>
              {taskCenter.newbieTasks.map((task: any) => renderTask(task))}
            </>
          )}
          {/* 每日任务：key=checkin 的签到任务已合并到下方「每日签到」，此处不再重复 */}
          {(taskCenter?.dailyTasks?.length ?? 0) > 0 && (
            <>
              <Text style={styles.subTitle}>{t('wallet.dailyTasks')}</Text>
              {taskCenter.dailyTasks
                .filter((task: any) => task.key !== 'checkin')
                .map((task: any) => renderTask(task))}
            </>
          )}
        </View>

        {/* 每日签到：与「每日任务」里的 checkin 任务合并，放在每日任务下方，沿用原签到卡片样式 */}
        <View style={styles.section}>
          <View style={styles.checkinBox}>
            {/* 右上角：今日日期 */}
            <View style={styles.checkinHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.checkinTitle}>{t('wallet.checkinTitle')}</Text>
                <Text style={styles.checkinSub}>
                  {t('wallet.checkinStreak', { n: ci?.streak ?? 0 })} · {t('wallet.checkinMonth', { n: ci?.monthCount ?? 0 })}
                </Text>
              </View>
              <View style={styles.todayBadge}>
                <Text style={styles.todayBadgeText}>
                  {t('wallet.checkinToday', { date: `${today.getMonth() + 1}-${String(todayDay).padStart(2, '0')}` })}
                </Text>
              </View>
            </View>

            {/* 日期条：横向可左右滑动 */}
            <ScrollView
              ref={checkinScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.dateStrip}
            >
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                const checked = checkedSet.has(day);
                const isToday = day === todayDay;
                const future = day > todayDay;
                const week = WEEK_LABELS[new Date(today.getFullYear(), today.getMonth(), day).getDay()];
                return (
                  <View
                    key={`d-${day}`}
                    style={[
                      styles.dateCell,
                      checked && styles.dateCellChecked,
                      !checked && isToday && styles.dateCellToday,
                      future && styles.dateCellFuture,
                    ]}
                  >
                    <Text style={[styles.dateWeek, checked && styles.dateTextChecked]}>{week}</Text>
                    <Text style={[styles.dateNum, checked && styles.dateTextChecked]}>{day}</Text>
                    <Text style={[styles.dateMark, checked && styles.dateTextChecked]}>
                      {checked ? '✓' : isToday ? '•' : ''}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          </View>

          {/* 签到按钮：放在签到框下方 */}
          <TouchableOpacity
            onPress={doCheckin}
            disabled={checkinDisabled}
            style={[styles.checkinAction, { opacity: checkinDisabled ? 0.5 : 1 }]}
          >
            <Text style={styles.checkinActionText}>{checkinLabel}</Text>
          </TouchableOpacity>
          {todayRewardCoins > 0 && !done && (
            <Text style={styles.checkinRewardHint}>
              {t('wallet.checkinTodayReward', { n: todayRewardCoins })}
            </Text>
          )}
        </View>

        {/* ⑨ 按时间获得金币：多个方形圆框，列表放在页面最下方，可左右滑动，右侧一键领取 */}
        <View style={styles.section}>
          <View style={styles.watchHead}>
            <View style={{ flex: 1, marginRight: 10 }}>
              <Text style={styles.watchTitle}>{t('wallet.watchRewards')}</Text>
              <Text style={styles.watchProgress}>
                {t('wallet.watchProgress', { n: watchedMinutes })}
              </Text>
            </View>
            <TouchableOpacity
              onPress={claimAllWatch}
              style={[styles.claimAllBtn, { opacity: claimableList.length > 0 ? 1 : 0.5 }]}
              activeOpacity={0.8}
            >
              <Text style={styles.claimAllText}>{t('wallet.claimAll')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.watchHint}>{t('wallet.watchRewardsHint')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.watchStrip}>
            {watchPlan.map((p) => {
              const achieved = isAchieved(p.minutes);
              const claimed = isClaimed(p.minutes);
              const ready = achieved && !claimed;
              return (
                <TouchableOpacity
                  key={`w-${p.minutes}`}
                  onPress={() => claimWatch(p)}
                  disabled={!ready}
                  activeOpacity={0.8}
                  style={[
                    styles.watchCell,
                    ready && styles.watchCellReady,
                    claimed && styles.watchCellClaimed,
                  ]}
                >
                  <Text style={[styles.watchCellMin, (ready || claimed) && styles.watchCellTextActive]}>
                    {t('wallet.minuteShort', { n: p.minutes })}
                  </Text>
                  <Text style={[styles.watchCellCoins, (ready || claimed) && styles.watchCellTextActive]}>
                    +{p.coins}
                  </Text>
                  <Text style={[styles.watchCellState, ready && styles.watchCellStateReady]}>
                    {claimed
                      ? t('wallet.watchClaimed')
                      : ready
                        ? t('wallet.watchReady')
                        : t('wallet.watchNeed', { n: p.minutes })}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* ⑤ 交易记录已从钱包移除，改为「设置 → 交易记录」菜单入口 */}
      </ScrollView>
    </SafeAreaView>
  );
}

// 按当前主题色板生成样式，浅色 / 深色模式复用同一套结构
const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
    // 钱包 Hero：对齐网页端（头像 + 账号 + 真实 VIP 状态 + 金币 + 单个 VIP 按钮），整体缩小
    walletHero: {
      marginHorizontal: 16, marginBottom: 4,
      padding: 12, borderRadius: 14,
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.gold,
    },
    walletAvatar: {
      width: 56, height: 56, borderRadius: 28,
      borderWidth: 1.5, borderColor: colors.gold, backgroundColor: colors.surfaceAlt,
    },
    walletAvatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
    walletAvatarText: { color: colors.gold, fontSize: 22, fontWeight: 'bold' },
    walletHeroBody: { flex: 1, marginLeft: 12 },
    walletEmail: { color: colors.muted, fontSize: 11 },
    walletTitleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
    walletHeroTitle: { color: colors.text, fontSize: 16, fontWeight: 'bold' },
    vipBadge: {
      backgroundColor: colors.gold, borderRadius: 8,
      paddingHorizontal: 6, paddingVertical: 1, marginLeft: 6, flexShrink: 1,
    },
    vipBadgeText: { color: '#1a1200', fontSize: 10, fontWeight: 'bold' },
    vipBadgeInactive: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderStrong },
    vipBadgeInactiveText: { color: colors.muted },
    vipExpireText: { color: colors.gold, fontSize: 10, marginTop: 2 },
    coinRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4 },
    coinAmount: { color: colors.gold, fontSize: 30, fontWeight: 'bold', flexShrink: 1 },
    coinDot: { color: colors.gold, fontSize: 10, marginLeft: 4 },
    coinUnit: { color: colors.gold, fontSize: 11, fontWeight: 'bold', marginLeft: 2 },
    heroActions: { flexDirection: 'row', marginTop: 8 },
    heroBtnPrimary: {
      backgroundColor: colors.gold, minHeight: 28, paddingHorizontal: 12,
      borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    },
    heroBtnPrimaryText: { color: '#1a1200', fontWeight: 'bold', fontSize: 11 },
    section: { padding: 16, paddingTop: 12 },
    sectionTitle: { color: colors.text, fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
    // 任务中心标题下方：我的金币余额（金边小卡）
    myCoinsBox: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.gold,
      borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12,
    },
    myCoinsLabel: { color: colors.text, fontSize: 14, fontWeight: 'bold' },
    myCoinsValue: { color: colors.gold, fontSize: 18, fontWeight: 'bold' },
    subTitle: { color: colors.textSecondary, fontWeight: 'bold', marginTop: 10, marginBottom: 6 },
    card: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
      borderRadius: 12, padding: 16, marginBottom: 8,
    },

    // ② 签到长方形圆框
    checkinBox: {
      backgroundColor: colors.surface, borderRadius: 16, padding: 14,
      borderWidth: 1, borderColor: colors.borderStrong,
    },
    checkinHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
    checkinTitle: { color: colors.text, fontSize: 16, fontWeight: 'bold' },
    checkinSub: { color: colors.muted, fontSize: 11, marginTop: 4 },
    todayBadge: {
      backgroundColor: colors.surfaceAlt, borderRadius: 12,
      paddingHorizontal: 10, paddingVertical: 5, marginLeft: 8,
    },
    todayBadgeText: { color: colors.gold, fontSize: 11, fontWeight: 'bold' },
    dateStrip: { paddingVertical: 2 },
    dateCell: {
      width: 44, height: 62, borderRadius: 10, marginRight: 8,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
    },
    dateCellChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
    dateCellToday: { borderColor: colors.primary },
    dateCellFuture: { opacity: 0.45 },
    dateWeek: { color: colors.subtle, fontSize: 10 },
    dateNum: { color: colors.text, fontSize: 16, fontWeight: 'bold', marginTop: 2 },
    dateMark: { color: colors.muted, fontSize: 10, marginTop: 2 },
    dateTextChecked: { color: '#fff' },
    checkinAction: {
      backgroundColor: colors.primary, minHeight: 46, borderRadius: 14,
      alignItems: 'center', justifyContent: 'center', marginTop: 12,
    },
    checkinActionText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
    checkinRewardHint: { color: colors.gold, fontSize: 12, textAlign: 'center', marginTop: 8 },

    // ④ VIP 入口已并入上方 Hero 的「开通 VIP」胶囊按钮

    // ⑨ 时长领取框
    watchHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
    claimAllBtn: {
      backgroundColor: colors.primary, minHeight: 40, paddingHorizontal: 14,
      borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    },
    claimAllText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
    watchTitle: { color: colors.text, fontSize: 17, fontWeight: 'bold' },
    watchProgress: { color: colors.muted, fontSize: 11, marginTop: 2 },
    watchHint: { color: colors.muted, fontSize: 11, marginBottom: 10 },
    watchStrip: { paddingVertical: 4 },
    watchCell: {
      width: 92, height: 104, borderRadius: 14, marginRight: 10, padding: 8,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
      opacity: 0.6,
    },
    watchCellReady: {
      backgroundColor: colors.primary, borderColor: colors.primary, opacity: 1,
    },
    watchCellClaimed: {
      backgroundColor: colors.surface, borderColor: colors.green, opacity: 0.85,
    },
    watchCellMin: { color: colors.text, fontSize: 15, fontWeight: 'bold' },
    watchCellCoins: { color: colors.gold, fontSize: 18, fontWeight: 'bold', marginTop: 4 },
    watchCellState: { color: colors.muted, fontSize: 10, marginTop: 6, textAlign: 'center' },
    watchCellTextActive: { color: '#fff' },
    watchCellStateReady: { color: '#fff', fontWeight: 'bold' },
  });
