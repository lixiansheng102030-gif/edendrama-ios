import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { coinApi } from '../api';
import { useI18n, localizeCoinTxReason } from '../i18n/LanguageContext';
import { useTheme, type ThemeColors } from '../theme/ThemeContext';

const PAGE_SIZE = 10; // ⑤ 翻页制：每页固定 10 条，用上一页 / 下一页翻看
const FETCH_PAGE_SIZE = 100; // 拉取时的分页大小（一次性拉完筛选结果，保证翻页与搜索一致）
const MAX_FETCH_PAGES = 50;

type TimeRange = 'all' | '7d' | '30d' | 'custom';

interface Transaction {
  id: string;
  delta: number;
  reason: string;
  metadata?: any;
  createdAt: string;
}

function toIsoStart(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString();
}
function toIsoEnd(date: string): string {
  return new Date(`${date}T23:59:59`).toISOString();
}
function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00`).getTime());
}
function formatDateInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 交易记录全量页（由「设置 → 交易记录」进入）：
 * - 按时间筛选（全部 / 近7天 / 近30天 / 自定义起止），时间条件走后端 from/to；
 * - 关键字搜索在已加载结果里做本地匹配（能搜到剧名、备注、本地化后的原因文案）；
 * - 翻页制：每页 PAGE_SIZE 条，上一页 / 下一页按钮，不再无限滚动。
 */
export default function WalletHistory() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [items, setItems] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);

  // 自定义日期输入框（未应用前的草稿）
  const [draftFrom, setDraftFrom] = useState(formatDateInput(new Date(Date.now() - 30 * 86400000)));
  const [draftTo, setDraftTo] = useState(formatDateInput(new Date()));
  // 实际生效并用于请求的时间范围（ISO 字符串）
  const [applied, setApplied] = useState<{ from?: string; to?: string }>({});

  // 根据时间条件一次性拉回全部记录（后端按 from/to 过滤，客户端循环分页取完）
  const loadAll = useCallback(async (opts: { from?: string; to?: string }) => {
    setLoading(true);
    try {
      const acc: Transaction[] = [];
      for (let p = 1; p <= MAX_FETCH_PAGES; p++) {
        const res: any = await coinApi.transactions(p, FETCH_PAGE_SIZE, opts);
        const list: Transaction[] = res?.list || res?.items || (Array.isArray(res) ? res : []);
        acc.push(...list);
        const total = Number(res?.total);
        if (list.length < FETCH_PAGE_SIZE || (Number.isFinite(total) && acc.length >= total)) break;
      }
      setItems(acc);
      setPage(1);
    } catch {
      setItems([]);
      setPage(1);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll({}); }, [loadAll]);

  const applyTimeRange = (range: TimeRange) => {
    setTimeRange(range);
    if (range === 'all') {
      setApplied({});
      loadAll({});
    } else if (range === '7d' || range === '30d') {
      const days = range === '7d' ? 7 : 30;
      const o = { from: new Date(Date.now() - days * 86400000).toISOString(), to: new Date().toISOString() };
      setApplied(o);
      loadAll(o);
    }
    // custom：等用户填好起止日期后点「应用」
  };

  const applyCustom = () => {
    if (!isValidDate(draftFrom) || !isValidDate(draftTo)) {
      Alert.alert(t('common.error'), t('wallet.txInvalidDate'));
      return;
    }
    if (draftFrom > draftTo) {
      Alert.alert(t('common.error'), t('wallet.txInvalidDate'));
      return;
    }
    const o = { from: toIsoStart(draftFrom), to: toIsoEnd(draftTo) };
    setApplied(o);
    loadAll(o);
  };

  const resetFilter = () => {
    setTimeRange('all');
    setKeyword('');
    setDraftFrom(formatDateInput(new Date(Date.now() - 30 * 86400000)));
    setDraftTo(formatDateInput(new Date()));
    setApplied({});
    loadAll({});
  };

  // 关键字搜索：对本地化后的展示文案、原始 reason、剧名、备注、日期、金额做包含匹配
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return items;
    return items.filter((tx) => {
      const dateText = new Date(tx.createdAt).toLocaleString();
      const haystack = [
        localizeCoinTxReason(t, tx),
        tx.reason,
        tx.metadata?.dramaTitle,
        tx.metadata?.note,
        dateText,
        String(tx.delta),
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(kw);
    });
  }, [items, keyword, t]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // 关键字变化 / 筛选变化后回到第 1 页
  useEffect(() => { setPage(1); }, [keyword, applied, items]);

  const renderRow = (item: Transaction) => (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.reason}>{localizeCoinTxReason(t, item)}</Text>
        <Text style={styles.date}>{new Date(item.createdAt).toLocaleString()}</Text>
      </View>
      <Text style={[styles.delta, { color: item.delta >= 0 ? colors.green : colors.danger }]}>
        {item.delta >= 0 ? '+' : ''}{item.delta}
      </Text>
    </View>
  );

  const timeChips: { key: TimeRange; label: string }[] = [
    { key: 'all', label: t('wallet.txTimeAll') },
    { key: '7d', label: t('wallet.txTime7') },
    { key: '30d', label: t('wallet.txTime30') },
    { key: 'custom', label: t('wallet.txTimeCustom') },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* 筛选 + 搜索区 */}
      <View style={styles.filterBox}>
        <TextInput
          value={keyword}
          onChangeText={setKeyword}
          style={styles.searchInput}
          placeholder={t('wallet.txSearch')}
          placeholderTextColor={colors.subtle}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
          {timeChips.map((c) => (
            <TouchableOpacity
              key={c.key}
              onPress={() => applyTimeRange(c.key)}
              style={[styles.chip, timeRange === c.key && styles.chipActive]}
            >
              <Text style={[styles.chipText, timeRange === c.key && styles.chipTextActive]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {timeRange === 'custom' && (
          <View style={styles.customBox}>
            <View style={styles.dateRow}>
              <TextInput
                value={draftFrom}
                onChangeText={setDraftFrom}
                style={[styles.dateInput, { flex: 1, marginRight: 8 }]}
                placeholder={t('wallet.txFrom')}
                placeholderTextColor={colors.subtle}
              />
              <TextInput
                value={draftTo}
                onChangeText={setDraftTo}
                style={[styles.dateInput, { flex: 1 }]}
                placeholder={t('wallet.txTo')}
                placeholderTextColor={colors.subtle}
              />
            </View>
            <View style={styles.dateRow}>
              <TouchableOpacity onPress={applyCustom} style={[styles.smallBtn, { flex: 1, marginRight: 8, backgroundColor: colors.primary }]}>
                <Text style={styles.smallBtnText}>{t('wallet.txApply')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={resetFilter} style={[styles.smallBtn, { flex: 1, backgroundColor: colors.surfaceAlt }]}>
                <Text style={[styles.smallBtnText, { color: colors.textSecondary }]}>{t('wallet.txReset')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <Text style={styles.totalText}>{t('wallet.txTotal', { n: filtered.length })}</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.listContent}>
          {pageItems.length === 0 ? (
            <Text style={styles.empty}>{t('wallet.txNoMatch')}</Text>
          ) : (
            pageItems.map((item, idx) => (
              <View key={item.id || `tx-${idx}`}>{renderRow(item)}</View>
            ))
          )}
        </ScrollView>
      )}

      {/* 翻页控件 */}
      <View style={styles.pager}>
        <TouchableOpacity
          onPress={() => setPage((p) => Math.max(1, p - 1))}
          disabled={safePage <= 1}
          style={[styles.pageBtn, safePage <= 1 && styles.pageBtnDisabled]}
        >
          <Text style={styles.pageBtnText}>{t('wallet.txPrev')}</Text>
        </TouchableOpacity>
        <Text style={styles.pageInfo}>{t('wallet.txPage', { p: safePage, total: totalPages })}</Text>
        <TouchableOpacity
          onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={safePage >= totalPages}
          style={[styles.pageBtn, safePage >= totalPages && styles.pageBtnDisabled]}
        >
          <Text style={styles.pageBtnText}>{t('wallet.txNext')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
    filterBox: {
      paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
      backgroundColor: colors.elevated,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    searchInput: {
      backgroundColor: colors.surfaceAlt, color: colors.text, borderRadius: 10,
      paddingHorizontal: 12, minHeight: 42, marginBottom: 10,
    },
    chipScroll: { flexGrow: 0, marginBottom: 4 },
    chip: {
      minHeight: 34, paddingHorizontal: 14, borderRadius: 17, marginRight: 8,
      borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
      alignItems: 'center', justifyContent: 'center',
    },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { color: colors.textSecondary, fontSize: 12 },
    chipTextActive: { color: '#fff', fontWeight: 'bold' },
    customBox: { marginTop: 8 },
    dateRow: { flexDirection: 'row', marginBottom: 8 },
    dateInput: {
      backgroundColor: colors.surfaceAlt, color: colors.text, borderRadius: 8,
      paddingHorizontal: 10, minHeight: 40, fontSize: 12,
    },
    smallBtn: { minHeight: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    smallBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
    totalText: { color: colors.muted, fontSize: 11, marginTop: 4 },
    listContent: { padding: 16, paddingBottom: 24 },
    row: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
      borderRadius: 12, padding: 16, marginBottom: 8, minHeight: 44,
    },
    reason: { color: colors.text, fontSize: 13 },
    date: { color: colors.muted, fontSize: 11, marginTop: 2 },
    delta: { fontWeight: 'bold', fontSize: 15, marginLeft: 12 },
    empty: { color: colors.muted, textAlign: 'center', paddingVertical: 40 },
    pager: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 10,
      backgroundColor: colors.elevated,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    },
    pageBtn: {
      minHeight: 40, paddingHorizontal: 16, borderRadius: 10,
      backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    },
    pageBtnDisabled: { opacity: 0.4 },
    pageBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
    pageInfo: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  });
