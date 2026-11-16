import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
  Alert, RefreshControl, Image, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { watchApi, favoriteApi, likeApi, reservationApi, paymentApi, mediaUrl } from '../api';
import { useI18n, localizeCategory } from '../i18n/LanguageContext';
import { useTheme, ThemeColors } from '../theme/ThemeContext';
import { useFocusEffect } from '@react-navigation/native';

// 页签类型：观看记录 / 收藏 / 点赞 / 预约 / 购买记录
type TabKey = 'history' | 'favorites' | 'likes' | 'reservations' | 'purchased';
// 观看记录子筛选：全部 / 已看完 / 未看完
type HistorySub = 'all' | 'completed' | 'uncompleted';

const HISTORY_SUBS: HistorySub[] = ['all', 'completed', 'uncompleted'];

// 预约日期格式化为 YYYY-MM-DD
function formatDate(value?: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// 历史观看时间格式化为 MM-DD HH:mm（右侧展示，与 Profile 一致）
function formatDateTime(value?: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 根据当前主题色板生成样式，保证浅色 / 深色模式都能正确取色
const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
    // 历史子筛选 + 批量操作工具条
    historyToolbar: {
      paddingHorizontal: 16, paddingTop: 12, flexDirection: 'row', flexWrap: 'wrap',
      alignItems: 'center', gap: 8,
    },
    pill: {
      minHeight: 44, paddingHorizontal: 12, borderRadius: 22, borderWidth: 1,
      borderColor: colors.border, backgroundColor: colors.surfaceAlt,
      alignItems: 'center', justifyContent: 'center',
    },
    pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    pillText: { color: colors.muted, fontSize: 13 },
    pillTextActive: { color: '#fff', fontWeight: 'bold' },
    toolbarSpacer: { flex: 1 },
    actionBtn: {
      minHeight: 44, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1,
      borderColor: colors.border, backgroundColor: colors.surface,
      alignItems: 'center', justifyContent: 'center',
    },
    actionBtnText: { color: colors.textSecondary, fontSize: 13 },
    dangerBtn: { backgroundColor: colors.danger, borderColor: colors.danger },
    dangerBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
    selectedCount: { color: colors.muted, fontSize: 12 },
    // 列表项（与网页端 library 一致：横向行 = 左封面 + 右信息）
    listItem: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceAlt,
      borderRadius: 10, padding: 10, marginBottom: 10,
    },
    listCover: {
      width: 64, height: 96, borderRadius: 6, backgroundColor: colors.surface,
      overflow: 'hidden', marginRight: 12, justifyContent: 'center', alignItems: 'center',
    },
    listCoverSelected: { borderWidth: 2, borderColor: colors.primary },
    listCoverImg: { width: '100%', height: '100%' },
    listInfo: { flex: 1 },
    listTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
    listMeta: { color: colors.muted, fontSize: 12, marginTop: 3 },
    listMetaPrimary: { color: colors.primary, fontSize: 12, marginTop: 3 },
    listMetaGreen: { color: colors.green, fontSize: 12, marginTop: 3 },
    // 历史卡片右侧「最新播放时间」（与 Profile.tsx 一致）
    listTimeWrap: { marginLeft: 10, alignItems: 'flex-end', justifyContent: 'center' },
    listTime: { color: colors.muted, fontSize: 12 },
    // 单条删除按钮（放在行右侧，视觉 32 + hitSlop 保证点击区域 >= 44pt）
    deleteOne: {
      width: 32, height: 32, borderRadius: 16, marginLeft: 8,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      alignItems: 'center', justifyContent: 'center',
    },
    deleteOneText: { color: colors.danger, fontSize: 14, lineHeight: 16, fontWeight: 'bold' },
    // 选择模式勾选框（放在行左侧）
    checkbox: {
      width: 24, height: 24, borderRadius: 12, marginRight: 10,
      borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface,
      justifyContent: 'center', alignItems: 'center',
    },
    checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    checkboxMark: { color: '#fff', fontSize: 13, fontWeight: 'bold', lineHeight: 15 },
    empty: { alignItems: 'center', padding: 40 },
    emptyText: { color: colors.muted },
  });

export default function CategoryList({ navigation, route }: any) {
  const type: TabKey = route.params?.type ?? 'history';
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [historySub, setHistorySub] = useState<HistorySub>('all');
  const [history, setHistory] = useState<any[]>([]);
  const [favorites, setFavorites] = useState<any[]>([]);
  const [likes, setLikes] = useState<any[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);
  const [purchased, setPurchased] = useState<any[]>([]);
  // 批量删除：选择模式 + 已选记录 id
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  // 当前页签对应的数据数组
  const data =
    type === 'history'
      ? history
      : type === 'favorites'
      ? favorites
      : type === 'likes'
      ? likes
      : type === 'reservations'
      ? reservations
      : purchased;

  // 观看记录：按子筛选拉取（全部 / 已看完 / 未看完），兼容数组与 { list } / { items }
  const fetchHistory = useCallback(async (sub: HistorySub) => {
    try {
      const res: any =
        sub === 'all' ? await watchApi.history() : await watchApi.history(sub === 'completed');
      const list = Array.isArray(res) ? res : res?.list ?? res?.items ?? [];
      setHistory(Array.isArray(list) ? list : []);
    } catch {
      setHistory([]);
    }
  }, []);

  // 加载非历史页签数据
  const loadOthers = useCallback(async () => {
    try {
      const [favs, likeItems, resvs, orders] = await Promise.all([
        favoriteApi.list().catch(() => []),
        likeApi.list().catch(() => []),
        reservationApi.myList().catch(() => []),
        paymentApi.myOrders().catch(() => []),
      ]);
      setFavorites(Array.isArray(favs) ? favs : (favs as any)?.list ?? (favs as any)?.items ?? []);
      setLikes(Array.isArray(likeItems) ? likeItems : (likeItems as any)?.list ?? (likeItems as any)?.items ?? []);
      setReservations(Array.isArray(resvs) ? resvs : (resvs as any)?.list ?? (resvs as any)?.items ?? []);
      setPurchased(Array.isArray(orders) ? orders : (orders as any)?.list ?? (orders as any)?.items ?? []);
    } catch {}
  }, []);

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    try {
      if (type === 'history') {
        await fetchHistory(historySub);
      } else {
        await loadOthers();
      }
    } finally {
      if (showLoader) setLoading(false);
    }
  }, [type, historySub, fetchHistory, loadOthers]);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  // 子筛选变化时重新拉取观看记录
  React.useEffect(() => {
    if (type === 'history') fetchHistory(historySub);
  }, [type, historySub, fetchHistory]);

  // 切换子筛选时退出选择模式并清空选择
  React.useEffect(() => {
    setSelectMode(false);
    setSelectedIds([]);
  }, [historySub]);

  const onRefresh = () => {
    setRefreshing(true);
    Promise.all([load(false), type === 'history' ? fetchHistory(historySub) : Promise.resolve()])
      .finally(() => setRefreshing(false));
  };

  // 勾选 / 取消勾选单条历史
  const toggleSelect = (id: any) => {
    const key = id != null ? String(id) : '';
    if (!key) return;
    setSelectedIds((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  };

  const allSelected = history.length > 0 && selectedIds.length === history.length;

  const toggleSelectAll = () =>
    setSelectedIds(
      allSelected
        ? []
        : history.map((i: any) => (i?.id != null ? String(i.id) : '')).filter(Boolean),
    );

  // 删除单条观看记录（先二次确认）
  const handleDeleteOne = (item: any) => {
    const id = item?.id;
    if (id == null) return;
    Alert.alert(t('profile.deleteConfirm'), undefined, [
      { text: t('wallet.cancel'), style: 'cancel' },
      {
        text: t('message.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await watchApi.deleteProgress(String(id));
            setHistory((prev) => prev.filter((x: any) => String(x.id) !== String(id)));
            setSelectedIds((prev) => prev.filter((x) => x !== String(id)));
            Alert.alert(t('profile.deleted'));
          } catch {
            Alert.alert(t('profile.deleteFailed'));
          }
        },
      },
    ]);
  };

  // 批量删除选中的观看记录（先二次确认）
  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    const n = selectedIds.length;
    Alert.alert(t('profile.deleteBatchConfirm', { n }), undefined, [
      { text: t('wallet.cancel'), style: 'cancel' },
      {
        text: t('message.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            setDeleting(true);
            await watchApi.deleteBatch(selectedIds);
            setHistory((prev) => prev.filter((x: any) => !selectedIds.includes(String(x.id))));
            setSelectedIds([]);
            setSelectMode(false);
            Alert.alert(t('profile.deleted'));
          } catch {
            Alert.alert(t('profile.deleteFailed'));
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  // 各页签空状态文案
  const emptyText =
    type === 'history'
      ? t('wallet.noHistory')
      : type === 'favorites'
      ? t('wallet.noFavorites')
      : type === 'likes'
      ? t('wallet.noLikes')
      : type === 'reservations'
      ? t('profile.noReservations')
      : t('profile.noPurchased');

  // 用稳定 id 作为 key，必要时回退到索引
  const keyExtractor = (item: any, index: number) => {
    const base =
      type === 'history'
        ? item.id
        : type === 'likes'
        ? item.id ?? item.episode?.id ?? item.drama?.id
        : item.drama?.id ?? item.id;
    return base != null ? String(base) : `idx-${index}`;
  };

  // 列表式渲染（与网页端 library 一致：横向行 = 左封面 + 右标题/分类/元信息）
  const renderDramaCard = ({ item }: { item: any }) => {
    const drama = item?.drama ?? item ?? {};
    const itemId = item?.id != null ? String(item.id) : '';
    const selected = selectMode && itemId !== '' && selectedIds.includes(itemId);
    // 点赞页签：点击直接进入被点赞的那一集，其余页签仍进入剧集详情
    const onPressCard = () => {
      if (!drama?.id) return;
      // 选择模式下点击行只做勾选，不跳转
      if (type === 'history' && selectMode) {
        toggleSelect(item.id);
        return;
      }
      if (type === 'likes' && item.episode) {
        navigation.navigate('Player', { dramaId: drama.id, epId: item.episode.id });
      } else {
        navigation.navigate('DramaDetail', { id: drama.id });
      }
    };
    const pos: number = Number(item?.position) || 0;
    const catName = drama?.category ? localizeCategory(t, drama.category) : '';
    return (
      <TouchableOpacity onPress={onPressCard} activeOpacity={0.85} style={styles.listItem}>
        {/* 选择模式勾选框（行左侧） */}
        {type === 'history' && selectMode && (
          <View style={[styles.checkbox, selected && styles.checkboxOn]}>
            {selected && <Text style={styles.checkboxMark}>✓</Text>}
          </View>
        )}
        {/* 封面（左） */}
        <View style={[styles.listCover, selected && styles.listCoverSelected]}>
          {drama.cover ? (
            <Image source={{ uri: mediaUrl(drama.cover) }} style={styles.listCoverImg} />
          ) : (
            <Image source={require('../../assets/logo_mark.png')} style={{ width: 28, height: 28, opacity: 0.6 }} resizeMode="contain" />
          )}
        </View>
        {/* 信息（右） */}
        <View style={styles.listInfo}>
          <Text style={styles.listTitle} numberOfLines={1}>{drama.title}</Text>
          {!!catName && <Text style={styles.listMeta} numberOfLines={1}>{catName}</Text>}
          {item.episodeNo != null && <Text style={styles.listMeta}>EP{item.episodeNo}</Text>}
          {type === 'likes' && item.episode && (
            <Text style={styles.listMetaPrimary}>
              {t('profile.likedEpisode', { no: item.episode.episodeNo })}
            </Text>
          )}
          {type === 'reservations' && (
            <Text style={styles.listMetaPrimary}>
              {item.online ? t('reservation.online') : t('reservation.trailer')}
              {item.reservedAt ? ` · ${formatDate(item.reservedAt)}` : ''}
            </Text>
          )}
          {type === 'history' && pos > 0 && (
            <Text style={styles.listMetaPrimary}>
              {t('library.continueFrom', {
                m: Math.floor(pos / 60),
                s: String(Math.floor(pos % 60)).padStart(2, '0'),
              })}
            </Text>
          )}
          {type === 'purchased' && item.amount != null && (
            <Text style={styles.listMetaGreen}>{t('library.paid', { amount: item.amount })}</Text>
          )}
        </View>
        {type === 'history' && (
          <View style={styles.listTimeWrap}>
            <Text style={styles.listTime}>{formatDateTime(item.updatedAt)}</Text>
          </View>
        )}
        {/* 单条删除按钮（行右侧，批量模式下隐藏） */}
        {type === 'history' && !selectMode && (
          <TouchableOpacity
            onPress={() => handleDeleteOne(item)}
            disabled={deleting}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.deleteOne}
          >
            <Text style={styles.deleteOneText}>✕</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        style={{ flex: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* 观看记录子筛选 + 批量选择 */}
        {type === 'history' && (
          <View style={styles.historyToolbar}>
            {HISTORY_SUBS.map((k) => (
              <TouchableOpacity
                key={k}
                onPress={() => setHistorySub(k)}
                style={[styles.pill, historySub === k && styles.pillActive]}
              >
                <Text style={[styles.pillText, historySub === k && styles.pillTextActive]}>
                  {k === 'all'
                    ? t('profile.historyAll')
                    : k === 'completed'
                    ? t('profile.historyCompleted')
                    : t('profile.historyUncompleted')}
                </Text>
              </TouchableOpacity>
            ))}
            <View style={styles.toolbarSpacer} />
            {!selectMode ? (
              <TouchableOpacity
                onPress={() => { setSelectMode(true); setSelectedIds([]); }}
                disabled={history.length === 0 || deleting}
                style={[styles.actionBtn, (history.length === 0 || deleting) && { opacity: 0.4 }]}
              >
                <Text style={styles.actionBtnText}>{t('profile.selectMode')}</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity onPress={toggleSelectAll} style={styles.actionBtn}>
                  <Text style={styles.actionBtnText}>{t('profile.selectAll')}</Text>
                </TouchableOpacity>
                <Text style={styles.selectedCount}>{selectedIds.length}/{history.length}</Text>
                <TouchableOpacity
                  onPress={handleDeleteSelected}
                  disabled={selectedIds.length === 0 || deleting}
                  style={[styles.actionBtn, styles.dangerBtn, (selectedIds.length === 0 || deleting) && { opacity: 0.4 }]}
                >
                  <Text style={styles.dangerBtnText}>
                    {t('profile.deleteSelected')}{selectedIds.length ? ` (${selectedIds.length})` : ''}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setSelectMode(false); setSelectedIds([]); }}
                  style={styles.actionBtn}
                >
                  <Text style={styles.actionBtnText}>{t('profile.cancelSelect')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* 内容 */}
        {data.length === 0 ? (
          <View style={styles.empty}>
            <Text style={{ fontSize: 40, marginBottom: 8 }}>
              {type === 'history' ? '📺' : type === 'favorites' ? '⭐' : type === 'likes' ? '❤️' : type === 'reservations' ? '🔖' : '🧾'}
            </Text>
            <Text style={styles.emptyText}>{emptyText}</Text>
          </View>
        ) : (
          <FlatList
            data={data}
            renderItem={renderDramaCard}
            keyExtractor={keyExtractor}
            scrollEnabled={false}
            contentContainerStyle={{ padding: 12 }}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
