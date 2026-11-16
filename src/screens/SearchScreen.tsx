import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, Modal, Dimensions, RefreshControl } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dramaApi, filterApi } from '../api';
import { useI18n, getCurrentLang } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { DramaCard, DramaGrid } from './Home';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PAGE_SIZE = 24;
// 搜索历史折叠阈值：超过则只显示前 N 条，点右侧下拉图标展开
const HISTORY_COLLAPSE = 8;

// 简体画放大镜（与 Home 一致，纯 View 绘制）
function MagnifierIcon({ size = 18, color }: { size?: number; color: string }) {
  const ring = Math.round(size * 0.62);
  const t = Math.max(2, Math.round(size * 0.12));
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: 'absolute', left: 0, top: 0, width: ring, height: ring, borderRadius: ring / 2, borderWidth: t, borderColor: color }} />
      <View style={{ position: 'absolute', left: ring - t * 0.6, top: ring - t * 0.6, width: t, height: size * 0.36, backgroundColor: color, borderRadius: t / 2, transform: [{ rotate: '-45deg' }] }} />
    </View>
  );
}

// 简体画删除（垃圾桶）图标
function TrashIcon({ size = 18, color }: { size?: number; color: string }) {
  const t = Math.max(1.5, size * 0.09);
  return (
    <View style={{ width: size, height: size, alignItems: 'center' }}>
      <View style={{ width: size * 0.66, height: t, backgroundColor: color, borderRadius: t / 2 }} />
      <View style={{ width: size * 0.34, height: t, backgroundColor: color, borderRadius: t / 2, marginTop: t * 0.6 }} />
      <View style={{ width: size * 0.56, height: size * 0.5, borderWidth: t * 0.7, borderColor: color, borderTopLeftRadius: 1, borderTopRightRadius: 1, marginTop: t * 0.6 }} />
    </View>
  );
}

// 下拉/收起小图标（向下三角，展开时朝上）
function ChevronIcon({ size = 14, color, up }: { size?: number; color: string; up?: boolean }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: up ? '180deg' : '0deg' }] }}>
      <View style={{ width: 0, height: 0, borderLeftWidth: size * 0.32, borderRightWidth: size * 0.32, borderTopWidth: size * 0.3, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: color }} />
    </View>
  );
}

// 搜索发现右侧的刷新图标（圆形箭头，简体绘制）
function RefreshIcon({ size = 16, color }: { size?: number; color: string }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1.6, borderColor: color, borderTopColor: 'transparent', transform: [{ rotate: '-30deg' }] }} />
  );
}

const fmtCount = (n: number) => {
  if (!n || n <= 0) return '';
  // 中文用 万/亿；其它语言用 K/M/B，避免俄语/西语界面里冒出中文单位
  if (getCurrentLang() !== 'zh') {
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }
  if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '亿';
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  return String(n);
};

/**
 * 独立搜索界面（item5）：搜索框 → 筛选列表 → 搜索历史（长按删单个 / 删除全部弹窗 / 超两行折叠）→ 搜索发现（无历史填 12 个热度剧集）。
 */
export default function SearchScreen() {
  // 项目各屏的 navigation 都是 any（Home/Player 等均从 props 取 any），这里显式指定，
  // 否则无参 useNavigation() 会落到空的 ReactNavigation.RootParamList，navigate 的参数元组被推断为 never。
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [searchText, setSearchText] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);

  // 搜索请求序号：连续输入 / 连点搜索 / 快速切筛选时，只采纳最后一次请求的结果。
  // 卸载时把序号 +1，让仍在途的旧请求回调全部失效，避免对已卸载页面 setState。
  const searchReqIdRef = useRef(0);
  // 「搜索发现」独立于主搜索链路，连续搜索会因 searchHistory 变化被反复触发，需单独的请求序号
  const discoveryReqIdRef = useRef(0);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      searchReqIdRef.current += 1;
      discoveryReqIdRef.current += 1;
    };
  }, []);

  // 筛选（与网页端同一套 /filters）
  const [filters, setFilters] = useState<any[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<Record<string, string>>({});

  // 搜索历史
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [historyEditing, setHistoryEditing] = useState(false); // 长按进入：每个小框右上角出 ×
  const [historyExpanded, setHistoryExpanded] = useState(false); // 折叠 / 展开
  const [deleteAllOpen, setDeleteAllOpen] = useState(false); // 删除全部弹窗

  // 搜索发现（热度剧集）
  const [discovery, setDiscovery] = useState<any[]>([]);

  const historyKeyRef = useRef('edendrama_search_history_guest');
  useEffect(() => {
    AsyncStorage.getItem('user_info')
      .then((u: any) => {
        let acct = 'guest';
        try {
          const o = u ? JSON.parse(u) : null;
          acct = String(o?.email || o?.nickname || o?.id || 'guest');
        } catch {}
        historyKeyRef.current = `edendrama_search_history_${acct}`;
        return AsyncStorage.getItem(historyKeyRef.current);
      })
      .then((v: any) => { if (v && aliveRef.current) setSearchHistory(JSON.parse(v)); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    filterApi
      .list()
      .then((r: any) => { if (aliveRef.current) setFilters(Array.isArray(r) ? r : Array.isArray(r?.list) ? r.list : []); })
      .catch(() => { if (aliveRef.current) setFilters([]); });
  }, []);

  // 从首页视频点标签进入：自动按该标签筛选剧集
  const [tagSearchApplied, setTagSearchApplied] = useState(false);
  useEffect(() => {
    const p: any = (route.params as any) || {};
    const ids = p.tagIds ? String(p.tagIds).split(',') : [];
    if (ids.length && !tagSearchApplied) {
      setSelectedTags(ids);
      setTagSearchApplied(true);
      setShowResults(true);
      setLoading(true);
      const reqId = ++searchReqIdRef.current;
      const params: any = { page: 1, pageSize: PAGE_SIZE, tagIds: ids.join(',') };
      dramaApi
        .list(params)
        .then((r: any) => {
          if (reqId !== searchReqIdRef.current) return;
          setResults(r.list || []);
          setSearchTotal(typeof r.total === 'number' ? r.total : (r.list || []).length);
        })
        .catch(() => { if (reqId === searchReqIdRef.current) setResults([]); })
        .finally(() => { if (reqId === searchReqIdRef.current) setLoading(false); });
    }
  }, [route.params, tagSearchApplied]);

  // 搜索发现：优先按本账号常搜词推荐相似剧集，否则按热度；统一再按热度排序取 12
  const loadDiscovery = useCallback(() => {
    // 连续搜索会因 searchHistory 变化反复触发本函数；只采纳最后一次请求（及它的补量请求）的结果
    const reqId = ++discoveryReqIdRef.current;
    const recent = searchHistory[0];
    const base: any = { page: 1, pageSize: 24 };
    if (recent) base.keyword = recent;
    dramaApi
      .list(base)
      .then((r: any) => {
        if (!aliveRef.current || reqId !== discoveryReqIdRef.current) return;
        const list: any[] = r.list || [];
        let picked = [...list].sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
        if (picked.length < 12) {
          return dramaApi.list({ page: 1, pageSize: 24 }).then((r2: any) => {
            if (!aliveRef.current || reqId !== discoveryReqIdRef.current) return;
            const more: any[] = (r2.list || []).sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
            const seen = new Set(picked.map((x) => x.id));
            for (const d of more) { if (picked.length >= 12) break; if (!seen.has(d.id)) { picked.push(d); seen.add(d.id); } }
            setDiscovery(picked.slice(0, 12));
          });
        }
        setDiscovery(picked.slice(0, 12));
      })
      .catch(() => {
        if (aliveRef.current && reqId === discoveryReqIdRef.current) setDiscovery([]);
      });
  }, [searchHistory]);
  useEffect(() => { loadDiscovery(); }, [loadDiscovery]);

  const addSearchHistory = (text: string) => {
    const q = text.trim();
    if (!q) return;
    setSearchHistory((prev) => {
      const next = [q, ...prev.filter((x) => x !== q)].slice(0, 30);
      AsyncStorage.setItem(historyKeyRef.current, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };
  const removeSearchHistory = (q: string) => {
    setSearchHistory((prev) => {
      const next = prev.filter((x) => x !== q);
      AsyncStorage.setItem(historyKeyRef.current, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };
  const clearAllHistory = () => {
    setSearchHistory([]);
    AsyncStorage.setItem(historyKeyRef.current, JSON.stringify([])).catch(() => {});
    setHistoryEditing(false);
    setHistoryExpanded(false);
    setDeleteAllOpen(false);
  };

  // 已选默认筛选项 → 查询参数
  const activeFilterParams = useMemo(() => {
    const out: Record<string, string | number> = {};
    for (const g of filters.filter((x: any) => x.kind === 'filter')) {
      const tagId = filterTags[g.slug];
      if (!tagId) continue;
      const tag = (g.tags || []).find((x: any) => x.id === tagId);
      if (!tag) continue;
      if (tag.sortBy) out.sortBy = tag.sortBy;
      if (tag.days !== null && tag.days !== undefined) out.days = tag.days;
      if (tag.minMinutes !== null && tag.minMinutes !== undefined) out.minMinutes = tag.minMinutes;
      if (tag.maxMinutes !== null && tag.maxMinutes !== undefined) out.maxMinutes = tag.maxMinutes;
    }
    return out;
  }, [filters, filterTags]);

  const doSearch = (text: string) => {
    const hasFilter = selectedTags.length > 0 || Object.keys(activeFilterParams).length > 0;
    // 清空关键词时也要让在途旧请求失效，否则它返回后会重新把结果填回来
    if (!text.trim() && !hasFilter) {
      searchReqIdRef.current += 1;
      setShowResults(false);
      return Promise.resolve();
    }
    if (text.trim()) addSearchHistory(text);
    setLoading(true);
    // 新搜索期间旧翻页可能仍在途；先复位标志，避免旧翻页的 finally 落地前无法翻页
    setSearchLoadingMore(false);
    setShowResults(true);
    setHistoryEditing(false);
    setSearchPage(1);
    setSearchTotal(0);
    const reqId = ++searchReqIdRef.current;
    const params: any = { page: 1, pageSize: PAGE_SIZE };
    if (text.trim()) params.keyword = text.trim();
    if (selectedTags.length > 0) params.tagIds = selectedTags.join(',');
    Object.entries(activeFilterParams).forEach(([k, v]) => { params[k] = String(v); });
    return dramaApi
      .list(params)
      .then((r: any) => {
        if (reqId !== searchReqIdRef.current) return;
        setResults(r.list || []);
        setSearchTotal(typeof r.total === 'number' ? r.total : (r.list || []).length);
      })
      .catch(() => { if (reqId === searchReqIdRef.current) setResults([]); })
      .finally(() => { if (reqId === searchReqIdRef.current) setLoading(false); });
  };

  const loadMoreSearch = useCallback(() => {
    if (searchLoadingMore || results.length >= searchTotal) return;
    const next = searchPage + 1;
    setSearchLoadingMore(true);
    // 记住本次翻页属于哪一代搜索：期间若用户换了关键词 / 切了筛选，旧页结果就不再追加
    const reqId = searchReqIdRef.current;
    const params: any = { page: next, pageSize: PAGE_SIZE };
    if (searchText) params.keyword = searchText;
    if (selectedTags.length > 0) params.tagIds = selectedTags.join(',');
    Object.entries(activeFilterParams).forEach(([k, v]) => { params[k] = String(v); });
    dramaApi
      .list(params)
      .then((r: any) => {
        if (reqId !== searchReqIdRef.current) return;
        const list: any[] = r.list || [];
        setResults((prev) => [...prev, ...list]);
        setSearchTotal((prev) => (typeof r.total === 'number' ? r.total : prev + list.length));
        setSearchPage(next);
      })
      .catch(() => {})
      // finally 不加守卫：即使这次翻页已被新搜索作废，也要把 loadingMore 标志复位，否则会卡住后续翻页
      .finally(() => setSearchLoadingMore(false));
  }, [searchLoadingMore, searchPage, searchTotal, results.length, searchText, selectedTags, activeFilterParams]);

  const goDrama = (id: string) => navigation.navigate('Player', { dramaId: id });
  const visibleHistory = historyExpanded ? searchHistory : searchHistory.slice(0, HISTORY_COLLAPSE);

  // 结果页顶部筛选条：按给定状态直接重查（切换标签后立即生效）
  const refilter = (nextTags: string[], nextFilterTags: Record<string, string>) => {
    const out: Record<string, string | number> = {};
    for (const g of filters.filter((x: any) => x.kind === 'filter')) {
      const tagId = nextFilterTags[g.slug];
      if (!tagId) continue;
      const tag = (g.tags || []).find((x: any) => x.id === tagId);
      if (!tag) continue;
      if (tag.sortBy) out.sortBy = tag.sortBy;
      if (tag.days !== null && tag.days !== undefined) out.days = tag.days;
      if (tag.minMinutes !== null && tag.minMinutes !== undefined) out.minMinutes = tag.minMinutes;
      if (tag.maxMinutes !== null && tag.maxMinutes !== undefined) out.maxMinutes = tag.maxMinutes;
    }
    setLoading(true);
    // 新筛选期间旧翻页可能仍在途；先复位标志，避免旧翻页的 finally 落地前无法翻页
    setSearchLoadingMore(false);
    setShowResults(true);
    setSearchPage(1);
    const reqId = ++searchReqIdRef.current;
    const params: any = { page: 1, pageSize: PAGE_SIZE };
    if (searchText.trim()) params.keyword = searchText.trim();
    if (nextTags.length > 0) params.tagIds = nextTags.join(',');
    Object.entries(out).forEach(([k, v]) => { params[k] = String(v); });
    dramaApi
      .list(params)
      .then((r: any) => {
        if (reqId !== searchReqIdRef.current) return;
        setResults(r.list || []);
        setSearchTotal(typeof r.total === 'number' ? r.total : (r.list || []).length);
      })
      .catch(() => { if (reqId === searchReqIdRef.current) setResults([]); })
      .finally(() => { if (reqId === searchReqIdRef.current) setLoading(false); });
  };

  // 筛选分组 UI（筛选页与结果页顶部共用）；onToggle 由调用方决定「只改状态」还是「改完即搜」
  const renderFilterGroups = (onToggle: (g: any, tag: any) => void) => (
    <>
      {filters.map((g: any) => {
        const tags: any[] = g.tags || [];
        if (tags.length === 0) return null;
        return (
          <View key={g.id || g.slug} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: filterTags[g.slug] ? colors.primary : colors.surfaceAlt }}>
              <Text style={{ color: filterTags[g.slug] ? '#fff' : colors.primary, fontSize: 12, fontWeight: 'bold' }}>{g.name || g.slug}</Text>
            </View>
            {tags.map((tag: any) => {
              const on = g.kind === 'filter' ? filterTags[g.slug] === tag.id : selectedTags.includes(tag.id);
              return (
                <Pressable
                  key={tag.id}
                  onPress={() => onToggle(g, tag)}
                  style={{ paddingHorizontal: 10, paddingVertical: 4, minHeight: 28, borderRadius: 8, backgroundColor: on ? colors.primary : colors.surfaceAlt, borderWidth: 1, borderColor: on ? colors.primary : colors.border }}
                >
                  <Text style={{ color: on ? '#fff' : colors.muted, fontSize: 12 }}>{tag.name}</Text>
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </>
  );

  // 结果页顶部：切换标签/筛选项并立即重查
  const toggleFromResults = (g: any, tag: any) => {
    if (g.kind === 'filter') {
      const next: Record<string, string> = { ...filterTags };
      if (next[g.slug] === tag.id) delete next[g.slug];
      else next[g.slug] = tag.id;
      setFilterTags(next);
      refilter(selectedTags, next);
    } else {
      const next = selectedTags.includes(tag.id) ? selectedTags.filter((x) => x !== tag.id) : [...selectedTags, tag.id];
      setSelectedTags(next);
      refilter(next, filterTags);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      {/* 顶部：返回 + 搜索框 + 搜索按钮 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 }}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={{ minWidth: 30, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors.text, fontSize: 26, fontWeight: '600', marginTop: -2 }}>{'<'}</Text>
        </Pressable>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', height: 42, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingLeft: 14, paddingRight: 5 }}>
          <MagnifierIcon size={17} color={colors.subtle} />
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            onSubmitEditing={() => doSearch(searchText)}
            placeholder={t('home.searchPlaceholder')}
            placeholderTextColor={colors.subtle}
            style={{ flex: 1, color: colors.text, fontSize: 14, padding: 0, margin: 0, marginLeft: 8 }}
            returnKeyType="search"
          />
          <Pressable onPress={() => doSearch(searchText)} hitSlop={8} style={{ paddingHorizontal: 12, height: 34, borderRadius: 999, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: 'bold' }}>{t('filter.search') || '搜索'}</Text>
          </Pressable>
        </View>
      </View>

      {showResults ? (
        loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 60 }} />
        ) : results.length === 0 ? (
          <View style={{ alignItems: 'center', marginTop: 80 }}>
            <MagnifierIcon size={44} color={colors.muted} />
            <Text style={{ color: colors.muted, fontSize: 15, marginTop: 12 }}>{t('home.noResults')}</Text>
          </View>
        ) : (
          // 复用 Home 的 DramaGrid 虚拟化路径（传入 style 即启用 FlatList 回收），长搜索结果不再一次性全量渲染。
          <DramaGrid
            items={results}
            renderItem={(d: any) => <DramaCard key={d.id} drama={d} onPress={() => goDrama(d.id)} />}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
            onEndReached={loadMoreSearch}
            onEndReachedThreshold={0.2}
            ListHeaderComponent={
              (selectedTags.length > 0 || Object.keys(filterTags).length > 0) ? (
                <View style={{ marginBottom: 10 }}>
                  <Text style={{ color: colors.text, fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>{t('filter.title')}</Text>
                  {renderFilterGroups(toggleFromResults)}
                </View>
              ) : null
            }
            ListFooterComponent={
              <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                {searchLoadingMore ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : results.length >= searchTotal ? (
                  <Text style={{ color: colors.subtle, fontSize: 12 }}>{t('home.noMore')}</Text>
                ) : null}
              </View>
            }
          />
        )
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          {/* 筛选功能列表 */}
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>{t('filter.title')}</Text>
          {renderFilterGroups((g, tag) => {
            if (g.kind === 'filter') {
              setFilterTags((prev) => {
                const next = { ...prev };
                if (next[g.slug] === tag.id) delete next[g.slug];
                else next[g.slug] = tag.id;
                return next;
              });
            } else {
              setSelectedTags((prev) => (prev.includes(tag.id) ? prev.filter((x) => x !== tag.id) : [...prev, tag.id]));
            }
          })}

          {/* 搜索历史 */}
          {searchHistory.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: 'bold' }}>{t('search.recentHistory')}</Text>
                <View style={{ flex: 1 }} />
                {historyEditing && (
                  <Pressable onPress={() => setHistoryEditing(false)} hitSlop={8} style={{ marginRight: 12 }}>
                    <Text style={{ color: colors.primary, fontSize: 13, fontWeight: 'bold' }}>{t('search.historyDone')}</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => setDeleteAllOpen(true)} hitSlop={10} style={{ padding: 4, marginRight: 10 }}>
                  <TrashIcon size={18} color={colors.muted} />
                </Pressable>
                {searchHistory.length > HISTORY_COLLAPSE && (
                  <Pressable onPress={() => setHistoryExpanded((v) => !v)} hitSlop={10} style={{ padding: 4 }}>
                    <ChevronIcon size={16} color={colors.muted} up={historyExpanded} />
                  </Pressable>
                )}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {visibleHistory.map((q) => (
                  <Pressable
                    key={q}
                    onLongPress={() => setHistoryEditing(true)}
                    delayLongPress={350}
                    onPress={() => { setSearchText(q); doSearch(q); }}
                    style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, minHeight: 32, marginTop: historyEditing ? 6 : 0 }}
                  >
                    <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{q}</Text>
                    {historyEditing && (
                      <Pressable
                        onPress={() => removeSearchHistory(q)}
                        hitSlop={10}
                        style={{ position: 'absolute', top: -7, right: -7, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold', lineHeight: 18 }}>×</Text>
                      </Pressable>
                    )}
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* 搜索发现 */}
          <View style={{ marginTop: 20 }}>
            <View style={{ marginBottom: 10 }}>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: 'bold' }}>{t('search.discover') || '搜索发现'}</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {discovery.map((d: any) => (
                <Pressable
                  key={d.id}
                  onPress={() => { setSearchText(d.title); doSearch(d.title); }}
                  style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, minHeight: 32 }}
                >
                  <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{d.title}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      )}

      {/* 删除全部历史弹窗 */}
      <Modal transparent visible={deleteAllOpen} animationType="fade" onRequestClose={() => setDeleteAllOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <View style={{ width: '100%', backgroundColor: colors.elevated, borderRadius: 14, overflow: 'hidden' }}>
            <View style={{ paddingVertical: 22, alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>{t('search.deleteAllTitle') || '删除全部搜索历史？'}</Text>
            </View>
            <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border }}>
              <Pressable onPress={() => setDeleteAllOpen(false)} style={{ flex: 1, paddingVertical: 14, alignItems: 'center', borderRightWidth: 1, borderRightColor: colors.border }}>
                <Text style={{ color: colors.textSecondary, fontSize: 15 }}>{t('common.cancel') || '取消'}</Text>
              </Pressable>
              <Pressable onPress={clearAllHistory} style={{ flex: 1, paddingVertical: 14, alignItems: 'center' }}>
                <Text style={{ color: colors.danger, fontSize: 15, fontWeight: 'bold' }}>{t('search.deleteAll') || '全部删除'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
