import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Image, TouchableOpacity, Alert, Modal, Share, Dimensions, FlatList } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Video } from 'expo-av';
import { dramaApi, paymentApi, coinApi, favoriteApi, reservationApi, likeApi, mediaUrl } from '../api';
import { useI18n, localizeCategory, getCurrentLang } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import ReviewSection from '../components/ReviewSection';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// 封面缩略图：按屏宽 30%，3:4 比例（对齐网页端「左封面 + 右信息」布局）
const COVER_W = Math.round(SCREEN_WIDTH * 0.3);
const COVER_H = Math.round((COVER_W * 4) / 3);
// 选集网格：移动端 5 列（网页端桌面 6 列）
const EP_COLS = 5;
const EP_GAP = 8;
const EP_INNER = SCREEN_WIDTH - 32;
const EP_CELL_W = Math.floor((EP_INNER - (EP_COLS - 1) * EP_GAP) / EP_COLS);
const EP_CELL_H = 50;
// 猜你喜欢：3 列卡片
const RECO_GAP = 12;
const RECO_W = Math.floor((EP_INNER - 2 * RECO_GAP) / 3);
// 猜你喜欢横向 FlatList 的固定高度（封面 3:4 + 两行标题 + 间距 + 卡片底部 marginBottom）
const RECO_CARD_H = Math.round((RECO_W * 4) / 3) + 54;

// 热度值格式化：中文 1 万以上按「x.x万」显示；其它语言用 K/M/B（与网页端一致）
function formatHot(n?: number): string {
  const v = Number(n) || 0;
  if (getCurrentLang() !== 'zh') {
    if (v >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(v);
  }
  return v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v);
}

// 猜你喜欢卡片（对齐网页端卡片网格）
function RecoCard({ drama, onPress }: { drama: any; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={onPress} style={{ width: RECO_W, marginBottom: RECO_GAP }}>
      <View style={{ width: RECO_W, aspectRatio: 3 / 4, borderRadius: 8, backgroundColor: colors.surface, overflow: 'hidden' }}>
        {drama.cover ? (
          <Image source={{ uri: mediaUrl(drama.cover) }} style={{ width: '100%', height: '100%' }} />
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Image source={require('../../assets/logo_mark.png')} style={{ width: 36, height: 36, opacity: 0.6 }} resizeMode="contain" />
          </View>
        )}
      </View>
      <Text style={{ color: colors.text, fontSize: 13, marginTop: 6 }} numberOfLines={2}>{drama.title}</Text>
    </TouchableOpacity>
  );
}

export default function DramaDetail({ route, navigation }: any) {
  const { t } = useI18n();
  const { colors } = useTheme();
  // 底部固定栏需要自己处理底部安全区（绝对定位不受父级 padding 影响）
  const insets = useSafeAreaInsets();
  const { id } = route.params;
  const [drama, setDrama] = useState<any>(null);
  const [unlockedIds, setUnlockedIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [coinBalance, setCoinBalance] = useState<number>(0);
  const [buying, setBuying] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  // 批量购买模式（默认关闭，默认不显示任何勾选框）
  const [batchMode, setBatchMode] = useState(false);
  // 待确认解锁的单集（非空时展示确认弹窗）
  const [confirmEp, setConfirmEp] = useState<any>(null);
  // 预约剧集相关状态（仅 status === 'reservation' 时使用）
  const [reserved, setReserved] = useState(false);
  const [reservationCount, setReservationCount] = useState(0);
  const [favorited, setFavorited] = useState(false);
  // 预约剧无分集，点赞挂在整部剧上
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [reserving, setReserving] = useState(false);
  // 猜你喜欢
  const [recoList, setRecoList] = useState<any[]>([]);

  useEffect(() => {
    let alive = true;

    // 读取本地登录态，已登录则加载已解锁分集与金币余额
    (async () => {
      const token = await AsyncStorage.getItem('user_token');
      if (!alive) return;
      setLoggedIn(!!token);

      dramaApi
        .detail(id)
        .then((d) => {
          if (!alive) return;
          setDrama(d);
          // 详情接口会附带预约人数与当前用户是否已预约
          setReserved(!!d?.reserved);
          setReservationCount(Number(d?.reservationCount) || 0);
        })
        .catch(() => {});

      if (token) {
        paymentApi
          .unlockedEpisodes(id)
          .then((res: any) => {
            if (alive) setUnlockedIds(res?.episodeIds || []);
          })
          .catch(() => {});
        coinApi
          .balance()
          .then((res: any) => {
            if (!alive) return;
            // 余额字段可能是数字、{coins} 或 {balance}
            const n = typeof res === 'number' ? res : res?.coins ?? res?.balance ?? 0;
            setCoinBalance(typeof n === 'number' ? n : 0);
          })
          .catch(() => {});
      }
    })();

    // 猜你喜欢：按当前剧推荐（对齐网页端「猜你喜欢」）
    dramaApi
      .recommend({ dramaId: id, pageSize: 12 })
      .then((r: any) => {
        if (alive) setRecoList(Array.isArray(r?.list) ? r.list : []);
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [id]);

  // 预约剧集：已登录时读取收藏状态（不影响其他状态剧集的行为）
  useEffect(() => {
    if (drama?.status !== 'reservation') return;
    let alive = true;
    (async () => {
      const token = await AsyncStorage.getItem('user_token');
      if (!alive || !token) return;
      favoriteApi
        .check(id)
        .then((res: any) => {
          if (alive) setFavorited(!!(res?.favorited ?? res?.isFavorited));
        })
        .catch(() => {});
      likeApi
        .checkDrama(id)
        .then((res: any) => {
          if (!alive) return;
          setLiked(!!res?.liked);
          if (typeof res?.likeCount === 'number') setLikeCount(res.likeCount);
        })
        .catch(() => {});
    })();
    return () => {
      alive = false;
    };
  }, [drama?.status, id]);

  if (!drama) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: colors.text }}>{t('common.loading')}</Text></View>;

  // 预约剧集：仅发布预告片，无正片分集
  const isReservation = drama.status === 'reservation';
  const episodes: any[] = drama.episodes || [];
  const freeEp = episodes.find((e: any) => e.isFree);

  const priceOf = (ep: any) => (ep?.priceCoins > 0 ? ep.priceCoins : (drama?.priceCoins || 0));
  const isLocked = (ep: any) => !ep.isFree && !unlockedIds.includes(ep.id);
  const lockedPaid = episodes.filter((e: any) => isLocked(e));
  const allSelected = lockedPaid.length > 0 && lockedPaid.every((e: any) => selected.includes(e.id));
  const selectedCoins = episodes
    .filter((e: any) => selected.includes(e.id))
    .reduce((sum: number, e: any) => sum + priceOf(e), 0);

  // 切换批量购买模式；退出批量模式时清空已选
  const toggleBatchMode = () => {
    if (batchMode) setSelected([]);
    setBatchMode(!batchMode);
  };

  // 仅在批量模式下切换锁定付费集的勾选状态
  const toggleSelect = (epId: string) => {
    setSelected((prev) => (prev.includes(epId) ? prev.filter((x) => x !== epId) : [...prev, epId]));
  };

  // 全选 / 清空所有锁定付费集
  const onToggleAll = () => {
    if (allSelected) setSelected([]);
    else setSelected(lockedPaid.map((e: any) => e.id));
  };

  // 点击剧集：批量模式仅对锁定集切换勾选；默认模式（含付费锁定集）统一进播放页，
  // 付费集由 Player.tsx 的 paywallLocked 派生模糊遮罩 + 立即弹付费提示处理，不再弹单集确认框。
  const onPressEpisode = (ep: any) => {
    if (batchMode) {
      if (isLocked(ep)) toggleSelect(ep.id);
      return;
    }
    navigation.navigate('Player', { dramaId: id, epId: ep.id, fromDetail: true });
  };

  // 购买指定分集（批量购买与单集确认购买共用）
  const purchase = async (ids: string[]) => {
    if (ids.length === 0 || buying) return;
    setBuying(true);
    try {
      const res: any = await paymentApi.unlockEpisodes(id, ids);
      if (res?.success) {
        // 成功后刷新已解锁分集与余额
        const un: any = await paymentApi.unlockedEpisodes(id).catch(() => null);
        setUnlockedIds(un?.episodeIds || []);
        const bal: any = await coinApi.balance().catch(() => null);
        const n = typeof bal === 'number' ? bal : bal?.coins ?? bal?.balance ?? coinBalance;
        setCoinBalance(typeof n === 'number' ? n : coinBalance);
        Alert.alert(t('detail.unlockSuccess'));
        const firstId = res?.unlocked?.[0] || ids[0];
        setSelected([]);
        if (firstId) navigation.replace('Player', { dramaId: id, epId: firstId, fromDetail: true });
      } else {
        Alert.alert(res?.message || t('detail.insufficientCoins'));
      }
    } catch {
      Alert.alert(t('detail.insufficientCoins'));
    } finally {
      setBuying(false);
    }
  };

  const handleBuy = () => purchase(selected);

  // 切换预约状态：未登录先提示登录；乐观更新后用返回值校正
  const onToggleReserve = async () => {
    if (reserving) return;
    const token = await AsyncStorage.getItem('user_token');
    if (!token) {
      Alert.alert(t('message.needLogin'));
      navigation.navigate('Login');
      return;
    }
    const next = !reserved;
    const prevCount = reservationCount;
    setReserved(next);
    setReservationCount(Math.max(0, prevCount + (next ? 1 : -1)));
    setReserving(true);
    try {
      const res: any = await reservationApi.toggle(id);
      if (typeof res?.reserved === 'boolean') setReserved(res.reserved);
      if (typeof res?.count === 'number') setReservationCount(res.count);
    } catch {
      // 失败回滚
      setReserved(!next);
      setReservationCount(prevCount);
    } finally {
      setReserving(false);
    }
  };

  // 收藏 / 取消收藏
  const onToggleFavorite = async () => {
    const token = await AsyncStorage.getItem('user_token');
    if (!token) {
      Alert.alert(t('message.needLogin'));
      navigation.navigate('Login');
      return;
    }
    const next = !favorited;
    setFavorited(next);
    try {
      const res: any = await favoriteApi.toggle(id);
      const val = res?.favorited ?? res?.isFavorited;
      if (typeof val === 'boolean') setFavorited(val);
    } catch {
      setFavorited(!next);
    }
  };

  // 剧集级点赞（预约剧无分集）
  const onToggleLike = async () => {
    const token = await AsyncStorage.getItem('user_token');
    if (!token) {
      Alert.alert(t('message.needLogin'));
      navigation.navigate('Login');
      return;
    }
    const next = !liked;
    const prevCount = likeCount;
    setLiked(next);
    setLikeCount(Math.max(0, prevCount + (next ? 1 : -1)));
    try {
      const res: any = await likeApi.toggleDrama(id);
      if (res && typeof res.liked === 'boolean') {
        setLiked(res.liked);
        if (typeof res.likeCount === 'number') setLikeCount(res.likeCount);
      }
    } catch {
      // 失败回滚
      setLiked(!next);
      setLikeCount(prevCount);
    }
  };

  // 分享剧集
  const onShare = async () => {
    try {
      await Share.share({ message: `${drama.title} — EdenDrama` });
    } catch {
      /* ignore */
    }
  };

  // 单个选集格（对齐网页端：免费/已购/未解锁 三态配色 + 角标）
  const renderEpisodeCell = (ep: any) => {
    const locked = isLocked(ep);
    const owned = !ep.isFree && unlockedIds.includes(ep.id);
    const isSel = selected.includes(ep.id);

    let bg = colors.surface;
    let txt = colors.text;
    let borderColor = 'transparent';
    let borderW = 0;
    if (ep.isFree) {
      borderColor = colors.green;
      borderW = 1;
      txt = colors.green;
    }
    // 已解锁（已购）集：保持原色（不铺主色黄底，避免整片变黄），用绿色对勾表明可看
    if (batchMode && isSel) {
      borderColor = colors.primary;
      borderW = 2;
    }

    return (
      <TouchableOpacity
        onPress={() => onPressEpisode(ep)}
        disabled={batchMode && !locked}
        style={{
          width: EP_CELL_W,
          height: EP_CELL_H,
          backgroundColor: bg,
          borderRadius: 8,
          borderWidth: borderW,
          borderColor,
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: EP_GAP,
          opacity: batchMode && !locked ? 0.5 : 1,
        }}>
        <Text style={{ color: txt, fontWeight: 'bold', fontSize: 14 }}>{ep.episodeNo}</Text>
        {/* 右上角角标：免费=✓(绿) / 已购=✓(白) / 未解锁=🔒 */}
        <View style={{ position: 'absolute', top: 2, right: 3 }}>
          {locked ? (
            <Text style={{ fontSize: 10 }}>🔒</Text>
          ) : (
            <Text style={{ fontSize: 10, color: colors.green }}>✓</Text>
          )}
        </View>
        {locked && (
          <Text style={{ color: colors.gold, fontSize: 10, marginTop: 2 }}>🪙{priceOf(ep)}</Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: batchMode ? 120 + insets.bottom : 0 }}>
        {/* 信息区：左封面缩略图 + 右信息列（对齐网页端） */}
        <View style={{ flexDirection: 'row', padding: 16, gap: 12 }}>
          <Image
            source={drama.cover ? { uri: mediaUrl(drama.cover) } : undefined}
            style={{ width: COVER_W, height: COVER_H, borderRadius: 12, backgroundColor: colors.surface }}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: 'bold', lineHeight: 26 }} numberOfLines={2}>
              {drama.title}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 6 }}>
              {t('detail.episodesCount', { n: drama.totalEpisodes })} ·{' '}
              {t('drama.hotValue', { n: formatHot(drama.hot ?? drama.viewCount) })}
            </Text>
            {/* 分类 + 标签 chips（对齐网页端） */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {drama.category && (
                <View style={{ backgroundColor: colors.surface, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{localizeCategory(t, drama.category)}</Text>
                </View>
              )}
              {(drama.tags || []).map((tag: any) => (
                <View key={tag.id} style={{ backgroundColor: colors.surface, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{tag.name}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* 剧情简介 */}
        <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>
            {t('drama.synopsis')}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 22 }}>
            {drama.description || drama.hook || ''}
          </Text>
        </View>

        {/* 剧评区块：评分汇总 + 星级评分 + 评论入口（无分集时按剧集维度评论） */}
        {(isReservation || episodes[0]?.id) && (
          <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
            <ReviewSection
              dramaId={drama.id}
              dramaTitle={drama.title}
              episodeId={episodes[0]?.id}
            />
          </View>
        )}

        {/* 预约剧集：预告片 + 预约开关 + 点赞/收藏/分享 + 即将上线 */}
        {isReservation && (
          <>
            {drama.trailer && (
              <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
                <Text style={{ color: colors.text, fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>
                  {t('reservation.trailer')}
                </Text>
                <View style={{ borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' }}>
                  <Video
                    source={{ uri: mediaUrl(drama.trailer) }}
                    style={{ width: '100%', height: Math.round(((SCREEN_WIDTH - 32) * 9) / 16), backgroundColor: '#000' }}
                    useNativeControls
                  />
                </View>
              </View>
            )}

            <View style={{ paddingHorizontal: 16 }}>
              <TouchableOpacity
                onPress={onToggleReserve}
                disabled={reserving}
                style={{
                  backgroundColor: reserved ? colors.surface : colors.primary,
                  paddingVertical: 14,
                  minHeight: 48,
                  justifyContent: 'center',
                  borderRadius: 30,
                  alignItems: 'center',
                  marginBottom: 12,
                  borderWidth: reserved ? 1 : 0,
                  borderColor: colors.primary,
                  opacity: reserving ? 0.6 : 1,
                }}>
                <Text style={{ color: reserved ? colors.text : '#fff', fontWeight: 'bold', fontSize: 16 }}>
                  {reserved ? t('reservation.reserved') : t('reservation.reserve')}
                </Text>
              </TouchableOpacity>

              <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', marginBottom: 16 }}>
                {t('reservation.count', { n: reservationCount })}
              </Text>

              <View style={{ flexDirection: 'row', marginBottom: 20 }}>
                <TouchableOpacity
                  onPress={onToggleLike}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingVertical: 12, backgroundColor: colors.surface, borderRadius: 12, marginRight: 8 }}>
                  <Text style={{ fontSize: 16, marginRight: 6 }}>{liked ? '❤️' : '🤍'}</Text>
                  <Text style={{ color: liked ? '#ec4899' : colors.text, fontSize: 13 }}>{likeCount}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={onToggleFavorite}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingVertical: 12, backgroundColor: colors.surface, borderRadius: 12, marginRight: 8 }}>
                  <Text style={{ fontSize: 16, marginRight: 6 }}>{favorited ? '⭐' : '☆'}</Text>
                  <Text style={{ color: colors.text, fontSize: 13 }}>{t('player.favorite')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={onShare}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingVertical: 12, backgroundColor: colors.surface, borderRadius: 12 }}>
                  <Text style={{ fontSize: 16, marginRight: 6 }}>🔗</Text>
                  <Text style={{ color: colors.text, fontSize: 13 }}>{t('player.share')}</Text>
                </TouchableOpacity>
              </View>

              <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', marginBottom: 20 }}>
                {t('reservation.comingSoon')}
              </Text>
            </View>
          </>
        )}

        {/* 非预约剧集：选集网格 + 猜你喜欢 */}
        {!isReservation && episodes.length > 0 && (
          <>
            {/* 选集标题栏 + 批量购买 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12 }}>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: 'bold' }}>{t('detail.episodesHeader')}</Text>
              <TouchableOpacity onPress={toggleBatchMode} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ color: colors.primary, fontSize: 13, fontWeight: 'bold' }}>
                  {batchMode ? t('detail.cancelBatch') : t('detail.batchBuy')}
                </Text>
              </TouchableOpacity>
            </View>

            {batchMode && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12 }}>
                <Text style={{ color: colors.muted, fontSize: 12, flexShrink: 1, marginRight: 8 }}>{t('detail.batchHint')}</Text>
                {lockedPaid.length > 0 && (
                  <TouchableOpacity onPress={onToggleAll} style={{ minHeight: 44, justifyContent: 'center' }}>
                    <Text style={{ color: colors.primary, fontSize: 13, fontWeight: 'bold' }}>
                      {allSelected ? t('detail.clearSelection') : t('detail.selectAll')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* 预告片行：排在第 1 集之前 */}
            {drama.trailer && (
              <TouchableOpacity
                onPress={() => navigation.navigate('Player', { dramaId: id, epId: 'trailer', fromDetail: true })}
                style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.surface, borderRadius: 8, marginHorizontal: 16, marginBottom: 8 }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                  <Text style={{ color: '#fff', fontSize: 13 }}>▶</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '500' }}>{t('reservation.trailer')}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{t('drama.trailerHint')}</Text>
                </View>
                <Text style={{ color: colors.primary, fontSize: 12, fontWeight: 'bold' }}>▶</Text>
              </TouchableOpacity>
            )}

            {/* 选集网格（5 列，虚拟化为 FlatList，三态配色 + 角标） */}
            <FlatList
              data={episodes}
              numColumns={EP_COLS}
              keyExtractor={(item: any) => String(item.id)}
              columnWrapperStyle={{ justifyContent: 'flex-start', gap: EP_GAP }}
              renderItem={({ item }: any) => renderEpisodeCell(item)}
              getItemLayout={(_data: any, index: number) => {
                const rowIndex = Math.floor(index / EP_COLS);
                const rowH = EP_CELL_H + EP_GAP;
                return { length: rowH, offset: rowIndex * rowH, index };
              }}
              style={{ height: Math.max(EP_CELL_H, Math.ceil(episodes.length / EP_COLS) * (EP_CELL_H + EP_GAP) - EP_GAP), marginBottom: 8 }}
              contentContainerStyle={{ paddingHorizontal: 16 }}
              scrollEnabled={episodes.length > EP_COLS}
              showsVerticalScrollIndicator={false}
            />

            {/* 猜你喜欢（对齐网页端） */}
            {recoList.length > 0 && (
              <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
                <Text style={{ color: colors.text, fontSize: 18, fontWeight: 'bold', marginBottom: 12 }}>
                  {t('drama.guessYouLike')}
                </Text>
                {/* 猜你喜欢：虚拟化为横向 FlatList（keyExtractor + getItemLayout 固定项宽） */}
                <FlatList
                  data={recoList}
                  horizontal
                  keyExtractor={(item: any) => String(item.id)}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingRight: 16 }}
                  style={{ height: RECO_CARD_H }}
                  getItemLayout={(_data: any, index: number) => ({ length: RECO_W + RECO_GAP, offset: index * (RECO_W + RECO_GAP), index })}
                  renderItem={({ item }: any) => (
                    <View style={{ marginRight: RECO_GAP }}>
                      <RecoCard drama={item} onPress={() => navigation.navigate('DramaDetail', { id: item.id })} />
                    </View>
                  )}
                />
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* 固定底部购买栏：批量模式下始终显示（未勾选时按钮禁用） */}
      {batchMode && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.elevated,
            padding: 16,
            // 绝对定位不受 SafeAreaView 内边距影响，单独补上底部安全区
            paddingBottom: 16 + insets.bottom,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: 'bold' }}>
              {t('detail.selectedCount', { n: selected.length })}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
              {t('detail.balance', { balance: coinBalance })}
            </Text>
          </View>
          {loggedIn ? (
            <TouchableOpacity
              disabled={buying || selected.length === 0}
              onPress={handleBuy}
              style={{
                backgroundColor: colors.primary,
                paddingVertical: 10,
                paddingHorizontal: 18,
                minHeight: 44,
                justifyContent: 'center',
                borderRadius: 24,
                opacity: buying || selected.length === 0 ? 0.5 : 1,
              }}>
              <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>
                {selected.length > 1
                  ? t('detail.unlockSelected', { n: selected.length, coins: selectedCoins })
                  : t('detail.unlockOne', { coins: selectedCoins })}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => navigation.navigate('Login')}
              style={{ backgroundColor: colors.primary, paddingVertical: 10, paddingHorizontal: 18, minHeight: 44, justifyContent: 'center', borderRadius: 24 }}>
              <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>{t('detail.loginToBuy')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* 单集解锁确认弹窗（默认模式点击锁定集时出现） */}
      <Modal
        visible={!!confirmEp}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmEp(null)}>
        <View style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 32 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 20 }}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: 'bold', marginBottom: 12 }}>
              {t('detail.confirmUnlock')}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, marginBottom: 20 }}>
              {t('detail.confirmUnlockBody', {
                no: confirmEp?.episodeNo,
                coins: confirmEp ? priceOf(confirmEp) : 0,
              })}
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <TouchableOpacity
                onPress={() => setConfirmEp(null)}
                style={{ paddingVertical: 10, paddingHorizontal: 18, minHeight: 44, justifyContent: 'center', borderRadius: 24, marginRight: 10 }}>
                <Text style={{ color: colors.muted, fontWeight: 'bold', fontSize: 14 }}>{t('detail.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const ep = confirmEp;
                  setConfirmEp(null);
                  if (ep) purchase([ep.id]);
                }}
                style={{ backgroundColor: colors.primary, paddingVertical: 10, paddingHorizontal: 18, minHeight: 44, justifyContent: 'center', borderRadius: 24 }}>
                <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>{t('detail.confirm')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
