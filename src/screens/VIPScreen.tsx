import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { vipApi } from '../api';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme, type ThemeColors } from '../theme/ThemeContext';

type Tier = {
  id: string;
  key?: string;
  name: string;
  price?: number;
  priceCoins?: number;
  priceMoney?: number | null;
  priceCny?: number | null;
  grantedCoins?: number;
  durationDays?: number;
  duration?: string;
  benefits?: {
    checkinBonus?: number;
    multiplier?: number;
    [k: string]: any;
  };
  checkinBonusCoins?: number;
  checkinBonusMultiplier?: number;
  watchCapBonusCoins?: number;
  watchRewardMultiplier?: number;
  // 后台「VIP 套餐」可配置的赠送物品 / 权益（与 VIPTier 表字段一一对应）
  unlimitedWatch?: boolean;
  unlimitedWatchHours?: number | null;
  giftDurationHours?: number | null;
  color?: string | null;
  description?: string;
};

/**
 * Decide which currency to use based on stored app language.
 * Returns {amount, symbol, currency} or null if neither price configured.
 */
function getDisplayPrice(tier: Tier): { amount: number; symbol: string; currency: 'usd' | 'cny' } | null {
  let lang = 'en';
  try {
    // Best-effort synchronous check; AsyncStorage is async-only, so we cache lang in module-level state
    lang = (global as any).__appLang || 'en';
  } catch {
    lang = 'en';
  }
  const usd = tier.priceMoney;
  const cny = tier.priceCny;
  const wantCny = lang === 'zh';
  const primary = wantCny ? cny : usd;
  const fallback = wantCny ? usd : cny;
  if (primary != null && Number(primary) > 0) {
    return { amount: Number(primary), symbol: wantCny ? '¥' : '$', currency: wantCny ? 'cny' : 'usd' };
  }
  if (fallback != null && Number(fallback) > 0) {
    return { amount: Number(fallback), symbol: wantCny ? '$' : '¥', currency: wantCny ? 'usd' : 'cny' };
  }
  return null;
}

type MyVip = {
  // 后端 /vip/my 实际返回 { tierId, tierKey, tierName, status, endAt, tier }，没有 active/expiresAt
  tierId?: string;
  tierKey?: string;
  tierName?: string;
  status?: string;
  endAt?: string;
  expiresAt?: string;
  tier?: any;
};

// 档位名称本地化：优先取 tier.{key}，没有翻译时回落后台名称
function localizeTier(t: (key: string, vars?: Record<string, string | number>) => string, tier: Tier): string {
  if (tier.key) {
    const i18nKey = `tier.${tier.key}`;
    const translated = t(i18nKey);
    if (translated && translated !== i18nKey) return translated;
  }
  return tier.name;
}

function formatDate(iso?: string) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}

export default function VIPScreen({ navigation }: any) {
  const { t } = useI18n();
  const { colors } = useTheme();
  // 主题色随模式切换，样式在渲染时按当前色板动态生成
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [myVip, setMyVip] = useState<MyVip | null>(null);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);

  // 按真实订阅数据判断（/vip/my 无 active 字段）；已开通时当前档位可再次购买，后端按 endAt 顺延续费
  const vipEndAt: string | null = myVip?.endAt ?? myVip?.expiresAt ?? null;
  const vipActive = !!myVip && (!!myVip.tierKey || !!myVip.tierId)
    && (!myVip.status || myVip.status === 'active')
    && (!vipEndAt || new Date(vipEndAt).getTime() > Date.now());
  const vipName = (() => {
    const key = myVip?.tierKey || myVip?.tier?.key || '';
    if (!key) return myVip?.tierName || 'VIP';
    const k = `tier.${key}`;
    const label = t(k);
    return label && label !== k ? label : (myVip?.tierName || 'VIP');
  })();

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    setError(null);
    try {
      // Cache app language for getDisplayPrice (sync access required in render)
      const storedLang = await AsyncStorage.getItem('app_lang');
      (global as any).__appLang = storedLang === 'zh' ? 'zh' : 'en';

      const u = await AsyncStorage.getItem('user_info');
      if (!u) {
        setUser(null);
        return;
      }
      setUser(JSON.parse(u));

      const [t, mine] = await Promise.all([
        vipApi.tiers(),
        vipApi.my().catch(() => null),
      ]);
      setTiers(Array.isArray(t) ? t : t?.items || []);
      setMyVip(mine || null);
    } catch (e: any) {
      // 这里不调用 t()：load 通过 useCallback 缓存，闭包里的 t 会是旧语言；
      // 文案在渲染时再翻译
      setError(e?.message || '');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(true);
    }, [load]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    load(false);
  };

  const handlePurchase = async (tier: Tier) => {
    const priceInfo = getDisplayPrice(tier);
    if (!priceInfo) {
      Alert.alert(t('vip.unavailable'), t('vip.unavailableMsg'));
      return;
    }
    setPurchasingId(tier.id);
    try {
      // Step 1: create order
      const order = await vipApi.createOrder(tier.id, priceInfo.currency);
      // Step 2: confirm order (mock payment)
      const res = await vipApi.confirmOrder(order.orderId);
      const granted = res?.grantedCoins
        ? `\n${t('vip.grantedCoinsShort', { n: res.grantedCoins })}`
        : '';
      // 后端返回顺延后的 endAt：已开通 VIP 再购买时明确提示「已续费至 ...」
      const renewed = res?.endAt
        ? `\n${t('vip.renewedUntil', { date: formatDate(res.endAt) })}`
        : '';
      Alert.alert(
        t('vip.purchaseSuccessTitle'),
        `${t('vip.purchaseSuccessMsg', { tier: localizeTier(t, tier) })}${granted}${renewed}`,
      );
      await load(false);
    } catch (e: any) {
      Alert.alert(
        t('vip.purchaseFailedTitle'),
        e?.response?.data?.message || t('vip.purchaseFailedMsg'),
      );
    } finally {
      setPurchasingId(null);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={{ color: colors.muted, marginTop: 12 }}>{t('common.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <View style={styles.center}>
          <Text style={{ color: colors.muted, marginBottom: 16, fontSize: 16 }}>
            {t('vip.loginRequired')}
          </Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('Login')}
            style={styles.loginBtn}
          >
            <Text style={styles.loginBtnText}>{t('vip.logIn')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (error !== null && tiers.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <View style={styles.center}>
          <Text style={{ color: colors.danger, marginBottom: 16 }}>
            {error || t('vip.failedToLoad')}
          </Text>
          <TouchableOpacity onPress={() => load(true)} style={styles.retryBtn}>
            <Text style={styles.retryBtnText}>{t('vip.retry')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
      <Text style={styles.title}>{t('vip.title')}</Text>
      <Text style={styles.subtitle}>{t('vip.subtitle')}</Text>

      {/* Current VIP status */}
      {vipActive && (
        <View style={styles.activeCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ fontSize: 28 }}>{'\u2B50'}</Text>
            <View style={{ marginLeft: 12, flex: 1 }}>
              <Text style={styles.activeLabel}>{t('vip.activeVip')}</Text>
              <Text style={styles.activeTier}>
                {t('vip.member', { tier: vipName })}
              </Text>
            </View>
          </View>
          {!!vipEndAt && (
            <Text style={styles.activeExpiry}>
              {t('vip.expiresOn', { date: formatDate(vipEndAt || undefined) })}
            </Text>
          )}
        </View>
      )}

      {tiers.length === 0 && (
        <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 40 }}>
          {t('vip.noPlans')}
        </Text>
      )}

      {tiers.map((tier) => {
        // 当前档位允许再次购买 → 走续费（后端从 active 订阅的 endAt 顺延）
        const isCurrentTier = vipActive && (myVip?.tierId === tier.id || myVip?.tierKey === tier.key);
        const b = tier.benefits || {};
        const priceInfo = getDisplayPrice(tier);
        const unavailable = !priceInfo;
        const priceText = priceInfo
          ? `${priceInfo.symbol}${priceInfo.amount.toFixed(2)} ${priceInfo.currency.toUpperCase()}`
          : t('vip.unavailable');
        return (
          <View key={tier.id} style={styles.tierCard}>
            <View style={styles.tierHeader}>
              <Text style={styles.tierName}>{localizeTier(t, tier)}</Text>
              <Text style={styles.tierPrice}>{priceText}</Text>
            </View>
            {tier.durationDays ? (
              <Text style={styles.tierDuration}>
                {t('vip.durationDays', { n: tier.durationDays })}
              </Text>
            ) : tier.duration ? (
              <Text style={styles.tierDuration}>
                {t('vip.duration', { d: tier.duration })}
              </Text>
            ) : null}
            {/* 金币购买价（后台可配 priceCoins）：法币价之外的另一种支付方式展示 */}
            {tier.priceCoins ? (
              <Text style={styles.tierCoinsPrice}>{t('vip.priceCoins', { n: tier.priceCoins })}</Text>
            ) : null}
            {tier.description && (
              <Text style={styles.tierDesc}>{tier.description}</Text>
            )}

            {/* ④ 按后台套餐配置展示「可获得哪些物品 / 权益」 */}
            {(tier.grantedCoins ||
              b.checkinBonus !== undefined ||
              tier.checkinBonusCoins ||
              b.multiplier !== undefined ||
              tier.watchRewardMultiplier !== undefined ||
              tier.watchCapBonusCoins !== undefined ||
              tier.unlimitedWatch ||
              tier.unlimitedWatchHours ||
              tier.giftDurationHours) && (
              <View style={styles.benefitsBox}>
                <Text style={styles.benefitsTitle}>{t('vip.benefitsTitle')}</Text>
                {tier.unlimitedWatch ? (
                  <Text style={styles.benefitItem}>
                    {'\u2713'} {tier.unlimitedWatchHours && tier.unlimitedWatchHours > 0
                      ? t('vip.unlimitedHours', { n: tier.unlimitedWatchHours })
                      : t('vip.unlimitedWatch')}
                  </Text>
                ) : null}
                {tier.giftDurationHours ? (
                  <Text style={styles.benefitItem}>
                    {'\u2713'} {t('vip.giftHours', { n: tier.giftDurationHours })}
                  </Text>
                ) : null}
                {tier.grantedCoins ? (
                  <Text style={styles.benefitItem}>
                    {'\u2713'} {t('vip.grantedCoinsShort', { n: tier.grantedCoins })}
                  </Text>
                ) : null}
                {tier.checkinBonusCoins ? (
                  <Text style={styles.benefitItem}>
                    {'\u2713'} {t('vip.checkinBonus', { n: tier.checkinBonusCoins })}
                  </Text>
                ) : b.checkinBonus !== undefined ? (
                  <Text style={styles.benefitItem}>
                    {'\u2713'} {t('vip.checkinBonus', { n: b.checkinBonus })}
                  </Text>
                ) : null}
                {tier.checkinBonusMultiplier && tier.checkinBonusMultiplier !== 1 ? (
                  <Text style={styles.benefitItem}>
                    {'\u2713'} {t('vip.checkinMultiplier', { n: tier.checkinBonusMultiplier })}
                  </Text>
                ) : null}
                {b.multiplier !== undefined && (
                  <Text style={styles.benefitItem}>
                    {'\u2713'} {t('vip.earningMultiplier', { n: b.multiplier })}
                  </Text>
                )}
                {tier.watchRewardMultiplier !== undefined &&
                tier.watchRewardMultiplier !== 1 ? (
                  <Text style={styles.benefitItem}>
                    {'\u2713'} {t('vip.watchRewardMultiplier', { n: tier.watchRewardMultiplier })}
                  </Text>
                ) : null}
                {tier.watchCapBonusCoins ? (
                  <Text style={styles.benefitItem}>
                    {'\u2713'} {t('vip.watchCapBonus', { n: tier.watchCapBonusCoins })}
                  </Text>
                ) : null}
              </View>
            )}

            <TouchableOpacity
              onPress={() => handlePurchase(tier)}
              disabled={purchasingId === tier.id || unavailable}
              style={[
                styles.purchaseBtn,
                (purchasingId === tier.id || unavailable) && { opacity: 0.5 },
              ]}
            >
              <Text style={styles.purchaseBtnText}>
                {purchasingId === tier.id
                  ? t('vip.processing')
                  : isCurrentTier
                    ? t('vip.renew')
                    : unavailable
                      ? t('vip.unavailable')
                      : t('vip.purchase', { price: priceText })}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })}
      </ScrollView>
    </SafeAreaView>
  );
}

// 按当前主题色板生成样式，浅色 / 深色模式复用同一套结构
const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.bg },
    container: { flex: 1, backgroundColor: colors.bg },
    center: {
      flex: 1,
      backgroundColor: colors.bg,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    title: {
      color: colors.gold,
      fontSize: 26,
      fontWeight: 'bold',
      textAlign: 'center',
      marginTop: 8,
    },
    subtitle: {
      color: colors.muted,
      fontSize: 13,
      textAlign: 'center',
      marginVertical: 12,
      paddingHorizontal: 8,
    },
    activeCard: {
      backgroundColor: 'rgba(251,191,36,0.12)',
      borderWidth: 1,
      borderColor: colors.gold,
      borderRadius: 16,
      padding: 16,
      marginVertical: 16,
    },
    activeLabel: { color: colors.gold, fontSize: 12, fontWeight: 'bold' },
    activeTier: { color: colors.text, fontSize: 18, fontWeight: 'bold' },
    activeExpiry: { color: colors.muted, fontSize: 12, marginTop: 8 },
    tierCard: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
    },
    tierHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    // 名称可收缩换行，价格不收缩，避免窄屏横向溢出
    tierName: {
      color: colors.text,
      fontSize: 20,
      fontWeight: 'bold',
      flexShrink: 1,
      marginRight: 8,
    },
    tierPrice: { color: colors.gold, fontSize: 18, fontWeight: 'bold', flexShrink: 0 },
    tierDuration: { color: colors.muted, fontSize: 12, marginBottom: 8 },
    tierCoinsPrice: { color: colors.gold, fontSize: 13, fontWeight: '600', marginBottom: 6 },
    tierDesc: { color: colors.textSecondary, fontSize: 13, marginBottom: 12 },
    benefitsBox: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 12,
      padding: 12,
      marginBottom: 16,
    },
    benefitsTitle: { color: colors.text, fontSize: 13, fontWeight: 'bold', marginBottom: 6 },
    benefitItem: { color: colors.green, fontSize: 13, marginVertical: 4 },
    purchaseBtn: {
      backgroundColor: colors.gold,
      minHeight: 44,
      paddingVertical: 12,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    purchaseBtnText: { color: '#000', fontWeight: 'bold', fontSize: 15 },
    loginBtn: {
      backgroundColor: colors.primary,
      minHeight: 44,
      paddingHorizontal: 28,
      paddingVertical: 12,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    loginBtnText: { color: '#fff', fontWeight: 'bold' },
    retryBtn: {
      backgroundColor: colors.primary,
      minHeight: 44,
      paddingHorizontal: 24,
      paddingVertical: 10,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    retryBtnText: { color: '#fff', fontWeight: 'bold' },
  });

