import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { messageApi, dramaApi } from '../api';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme, ThemeColors } from '../theme/ThemeContext';
import EnvelopeIcon from '../components/EnvelopeIcon';

const PAGE_SIZE = 20;

// 时间格式化为 MM-DD HH:mm
function formatTime(value?: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

// 根据当前主题色板生成样式，保证浅色 / 深色模式都能正确取色
function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.elevated,
    },
    markAll: { color: colors.primary, fontSize: 13, fontWeight: 'bold' },
    // 未读角标：标题文字已按需求移除，只留这个红底白字小胶囊
    unreadBadge: {
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      paddingHorizontal: 6,
      backgroundColor: colors.danger,
      alignItems: 'center',
      justifyContent: 'center',
    },
    unreadBadgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
    // 顶部右侧的红色「删除」/「取消」按钮
    deleteToggle: {
      paddingHorizontal: 12,
      minHeight: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    deleteToggleActive: { backgroundColor: colors.danger },
    deleteToggleIdle: { backgroundColor: colors.surfaceAlt },
    deleteToggleText: { fontSize: 12, fontWeight: 'bold' },
    // 删除模式下的操作条
    actionBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: colors.elevated,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    actionHint: { color: colors.muted, fontSize: 13, flexShrink: 1, marginRight: 8 },
    batchDeleteBtn: {
      paddingHorizontal: 14,
      minHeight: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    batchDeleteText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
    // 勾选框
    checkBox: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: colors.muted,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 10,
      flexShrink: 0,
    },
    checkBoxOn: { borderColor: colors.danger, backgroundColor: colors.danger },
    checkMark: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
    // 选中态卡片：红边 + 淡红底（淡红用半透明红，明暗主题下都成立）
    itemSelected: { borderWidth: 1.5, borderColor: colors.danger },
    itemSelectedBg: { backgroundColor: 'rgba(248,113,113,0.15)' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    emptyText: { color: colors.muted },
    listContent: { padding: 16 },
    item: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      marginBottom: 10,
      // 保证整行可点区域不小于 44pt
      minHeight: 44,
    },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.danger,
      marginTop: 5,
      marginRight: 8,
    },
    itemTitle: { color: colors.text, fontSize: 14, fontWeight: 'bold' },
    itemBody: { color: colors.textSecondary, fontSize: 13, marginTop: 6, lineHeight: 19 },
    itemTime: { color: colors.subtle, fontSize: 11, marginTop: 8 },
    loadMore: { alignItems: 'center', paddingVertical: 14 },
    loadMoreText: { color: colors.primary, fontSize: 13, fontWeight: 'bold' },
  });
}

export default function Messages({ navigation }: any) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // 关联剧名缓存，用于 release 消息的本地化展示
  const [dramaTitles, setDramaTitles] = useState<Record<string, string>>({});
  const titlesRef = useRef<Record<string, string>>({});
  // 未读数（顶部红底角标；标题文字已按需求移除）
  const [unread, setUnread] = useState(0);
  // 删除模式：只有点了顶部红色按钮才进入，进入后才能勾选消息批量删除
  const [deleteMode, setDeleteMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  // 预取消息关联剧集的标题（失败时回退到服务端存储的文案）
  const loadTitles = async (items: any[]) => {
    const ids: string[] = Array.from(
      new Set(items.map((m: any) => (m?.dramaId ? String(m.dramaId) : '')).filter(Boolean)),
    ).filter((dramaId) => !titlesRef.current[dramaId]);
    if (ids.length === 0) return;
    const results = await Promise.all(
      ids.map((dramaId) =>
        dramaApi
          .detail(dramaId)
          .then((d: any) => [dramaId, d?.title || ''] as [string, string])
          .catch(() => [dramaId, ''] as [string, string]),
      ),
    );
    const next = { ...titlesRef.current };
    results.forEach(([dramaId, title]) => {
      next[dramaId] = title;
    });
    titlesRef.current = next;
    setDramaTitles(next);
  };

  const load = async (nextPage: number) => {
    const token = await AsyncStorage.getItem('user_token');
    if (!token) {
      Alert.alert(t('message.needLogin'));
      navigation.navigate('Login');
      setLoading(false);
      return;
    }
    if (nextPage === 1) setLoading(true);
    else setLoadingMore(true);
    try {
      const res: any = await messageApi.list(nextPage, PAGE_SIZE);
      const items: any[] = Array.isArray(res?.list) ? res.list : [];
      setList((prev) => (nextPage === 1 ? items : [...prev, ...items]));
      setTotal(Number(res?.total) || 0);
      setPage(nextPage);
      loadTitles(items);
    } catch {
      if (nextPage === 1) setList([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // 拉取未读数用于顶部角标（与首页红点同源）
  const refreshUnread = async () => {
    try {
      const res: any = await messageApi.unreadCount();
      setUnread(Number(res?.count) || 0);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    load(1);
    refreshUnread();
  }, []);

  const onMarkAllRead = async () => {
    if (list.length === 0) return;
    // 乐观更新，失败也不回滚（与网页端一致）
    setList((prev) => prev.map((m) => ({ ...m, read: true })));
    setUnread(0);
    try {
      await messageApi.markAllRead();
    } catch {
      /* ignore */
    }
  };

  // 点击消息：标记已读，并跳转到关联剧集详情
  const onPressMessage = async (m: any) => {
    if (!m.read) {
      try {
        await messageApi.markRead(m.id);
        setList((prev) => prev.map((x) => (x.id === m.id ? { ...x, read: true } : x)));
      } catch {
        /* ignore */
      }
    }
    if (m.dramaId) navigation.navigate('DramaDetail', { id: m.dramaId });
  };

  // 退出删除模式并清空已选
  const exitDeleteMode = () => {
    setDeleteMode(false);
    setSelected(new Set());
  };

  // 勾选 / 取消勾选一条消息（只在删除模式下可用）
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 批量删除：先弹二次确认，确认后才真正删除。
  // 后端只有单条删除接口，这里并发调用（不改后端）。
  const deleteSelected = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    Alert.alert(t('message.deleteSelected'), t('message.batchConfirm', { n: ids.length }), [
      { text: t('message.cancel'), style: 'cancel' },
      {
        text: t('message.delete'),
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          // 乐观更新：先落 UI，再发请求
          const removedUnread = list.filter(
            (m: any) => ids.includes(String(m.id)) && !m.read,
          ).length;
          setList((prev) => prev.filter((m: any) => !ids.includes(String(m.id))));
          setTotal((n) => Math.max(0, n - ids.length));
          setUnread((u) => Math.max(0, u - removedUnread));
          exitDeleteMode();
          try {
            await Promise.all(ids.map((id) => messageApi.remove(id).catch(() => {})));
          } finally {
            setDeleting(false);
            // 以服务端为准再校准一次未读数
            refreshUnread();
          }
        },
      },
    ]);
  };

  // release 消息优先用本地化文案渲染，缺少剧名时回退到服务端文案
  const titleOf = (m: any) =>
    m.type === 'release' && m.dramaId && dramaTitles[m.dramaId]
      ? t('message.releaseTitle', { title: dramaTitles[m.dramaId] })
      : m.title;
  const bodyOf = (m: any) =>
    m.type === 'release' && m.dramaId && dramaTitles[m.dramaId]
      ? t('message.releaseBody', { title: dramaTitles[m.dramaId] })
      : m.content;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* 顶部：未读角标（标题文字已按需求移除） + 全部已读 + 红色删除 / 取消 */}
      <View style={styles.header}>
        {unread > 0 ? (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadBadgeText}>{unread > 99 ? '99+' : unread}</Text>
          </View>
        ) : (
          <View />
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {!deleteMode && (
            <TouchableOpacity onPress={onMarkAllRead}>
              <Text style={styles.markAll}>{t('message.markAllRead')}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => (deleteMode ? exitDeleteMode() : setDeleteMode(true))}
            style={[
              styles.deleteToggle,
              deleteMode ? styles.deleteToggleIdle : styles.deleteToggleActive,
            ]}>
            <Text
              style={[
                styles.deleteToggleText,
                { color: deleteMode ? colors.muted : '#fff' },
              ]}>
              {deleteMode ? t('message.cancel') : t('message.delete')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 删除模式下的操作条：提示文案 + 批量删除按钮（未选中任何消息时禁用） */}
      {deleteMode && (
        <View style={styles.actionBar}>
          <Text style={styles.actionHint}>{t('message.selectHint')}</Text>
          <TouchableOpacity
            onPress={deleteSelected}
            disabled={selected.size === 0 || deleting}
            style={[
              styles.batchDeleteBtn,
              {
                backgroundColor: colors.danger,
                opacity: selected.size === 0 || deleting ? 0.5 : 1,
              },
            ]}>
            <Text style={styles.batchDeleteText}>
              {t('message.deleteSelected')}
              {selected.size > 0 ? ` (${selected.size})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : list.length === 0 ? (
        <View style={styles.center}>
          <View style={{ marginBottom: 8 }}>
            {/* 与首页顶栏同一个信封简笔画组件，保证视觉一致 */}
            <EnvelopeIcon size={40} color={colors.muted} strokeWidth={2} />
          </View>
          <Text style={styles.emptyText}>{t('message.empty')}</Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item: any) => String(item.id)}
          contentContainerStyle={styles.listContent}
          renderItem={({ item: m }: any) => {
            const isSelected = selected.has(String(m.id));
            return (
              <TouchableOpacity
                style={[styles.item, isSelected && styles.itemSelected, isSelected && styles.itemSelectedBg]}
                // 普通模式：点卡片打开消息；删除模式：点卡片勾选 / 取消勾选
                onPress={() => (deleteMode ? toggleSelect(String(m.id)) : onPressMessage(m))}>
                {/* 未读小红点 */}
                {!m.read && <View style={styles.unreadDot} />}
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle} numberOfLines={1}>
                    {titleOf(m)}
                  </Text>
                  <Text style={styles.itemBody} numberOfLines={3}>
                    {bodyOf(m)}
                  </Text>
                  <Text style={styles.itemTime}>{formatTime(m.createdAt)}</Text>
                </View>
                {/* 删除模式下才出现勾选框；列表里原来的单条删除按钮已移除 */}
                {deleteMode && (
                  <View style={[styles.checkBox, isSelected && styles.checkBoxOn]}>
                    {isSelected && <Text style={styles.checkMark}>✓</Text>}
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
          ListFooterComponent={
            total > list.length ? (
              <TouchableOpacity
                style={styles.loadMore}
                disabled={loadingMore}
                onPress={() => load(page + 1)}>
                {loadingMore ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Text style={styles.loadMoreText}>{t('message.loadMore')}</Text>
                )}
              </TouchableOpacity>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}