import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Image, TouchableOpacity, Dimensions, Pressable, TextInput, ActivityIndicator, PanResponder, RefreshControl, Animated, Easing, Keyboard, FlatList } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { dramaApi, reservationApi, bannerApi, filterApi, mediaUrl } from '../api';
import { useI18n, localizeCategory } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// 搜索图标：与首页 feed / 播放页同一枚（网页端 SVG 光栅化的白色透明 PNG，用 tintColor 上色）。
// 原来是纯 View 手画的简笔画放大镜，风格和播放页不一致，按需求统一成同一枚。
function MagnifierIcon({ size = 18, color }: { size?: number; color: string }) {
  return (
    <Image
      source={require('../../assets/icons/ic_search.png')}
      style={{ width: size, height: size, tintColor: color }}
      resizeMode="contain"
    />
  );
}

// 剧集卡片尺寸：剧场界面每排 2 个视频，封面等比放大（保持 2:3 比例）。
// 卡片宽度按「两列铺满内容区」反算：内容区宽 = 屏宽 - 左右内边距(各16) - 列间距(CARD_GAP)。
const CARD_GAP = 12;
// Hero 大屏高度：比原来的 0.62 屏宽更矮（用户要求"变短一点"），兼顾文案+按钮的留白
const HERO_HEIGHT = Math.round(SCREEN_WIDTH * 0.52);
// 大屏宽度：剧场页内容区左右各有 16 padding，大屏正好铺满剩余宽度
const HERO_WIDTH = SCREEN_WIDTH - 32;

/**
 * 渐变竖线：RN 无内置渐变库，用「上淡 / 中浓 / 下淡」三段不同透明度拼出上下渐隐的竖线。
 * 颜色跟随当前主题的主色，用来替代分类导航栏原来的文字底框。
 */
function GradientRule({ color, height = 18, width = 1 }: { color: string; height?: number; width?: number }) {
  return (
    <View style={{ width, height, marginHorizontal: 9 }}>
      <View style={{ flex: 1, backgroundColor: color, opacity: 0.12 }} />
      <View style={{ flex: 2, backgroundColor: color, opacity: 0.55 }} />
      <View style={{ flex: 1, backgroundColor: color, opacity: 0.12 }} />
    </View>
  );
}
// 顶部栏搜索框宽度（给 nav header 用）
const SEARCH_WIDTH = SCREEN_WIDTH - 36;
// 剧集网格：剧场界面固定每排 2 个视频
const GRID_PADDING = 16;
const GRID_COLUMNS = 2;
const CARD_WIDTH = Math.floor((SCREEN_WIDTH - GRID_PADDING * 2 - CARD_GAP) / GRID_COLUMNS);
const CARD_HEIGHT = Math.round(CARD_WIDTH * 1.5);

// 剧集网格：**按行渲染 + 行内 space-between**，实现手机端"分散对齐"（每行卡片均匀铺满、左右撑到边缘）。
// ⚠️ 不要改成 `flexWrap:'wrap' + justifyContent:'space-between'`：Yoga 这个组合会无限重新布局
//    （实测 App CPU 持续 80%+、界面永不 idle、uiautomator dump 直接失败）。按行渲染可完全绕开。
export function DramaGrid({
  items,
  renderItem,
  limit,
  ListHeaderComponent,
  ListFooterComponent,
  onEndReached,
  refreshControl,
  scrollEnabled = true,
  contentContainerStyle,
  style,
}: any) {
  const list = typeof limit === 'number' && limit >= 0 ? items.slice(0, limit) : items;
  if (list.length === 0 && !ListHeaderComponent && !ListFooterComponent) return null;

  // 显式传入 style（通常是 flex:1）时：以 FlatList 作为滚动容器，获得列表虚拟化（长列表不再一次性全量渲染）。
  // 未传 style（如 SearchScreen 把 DramaGrid 嵌在自家 ScrollView 里）：退化为按行渲染的普通网格，
  // 行为与重构前完全一致，避免 FlatList 嵌在 ScrollView 中只剩首屏高度 / 抢占滚动手势而把页面滚动手势吞掉。
  if (style) {
    const rowHeight = CARD_HEIGHT + CARD_GAP;
    return (
      <FlatList
        style={style}
        data={list}
        numColumns={GRID_COLUMNS}
        keyExtractor={(item: any) => String(item.id)}
        columnWrapperStyle={{ justifyContent: 'space-between' }}
        renderItem={({ item, index }: any) => renderItem(item, index)}
        getItemLayout={(_data: any, index: number) => {
          const rowIndex = Math.floor(index / GRID_COLUMNS);
          return { length: rowHeight, offset: rowIndex * rowHeight, index };
        }}
        windowSize={5}
        maxToRenderPerBatch={6}
        initialNumToRender={6}
        ListHeaderComponent={ListHeaderComponent}
        ListFooterComponent={ListFooterComponent}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.2}
        refreshControl={refreshControl}
        scrollEnabled={scrollEnabled}
        contentContainerStyle={[{ padding: GRID_PADDING, paddingBottom: 32 }, contentContainerStyle]}
        showsVerticalScrollIndicator={false}
      />
    );
  }

  // 兼容路径：按行渲染（与原实现相同），用于嵌在父 ScrollView 的调用方
  const rows: any[][] = [];
  for (let i = 0; i < list.length; i += GRID_COLUMNS) {
    rows.push(list.slice(i, i + GRID_COLUMNS));
  }
  return (
    <View style={{ padding: GRID_PADDING, paddingBottom: 32 }}>
      {rows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {row.map((d, ci) => renderItem(d, ri * GRID_COLUMNS + ci))}
        </View>
      ))}
    </View>
  );
}

export function DramaCard({ drama, onPress }: { drama: any; onPress: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={onPress} style={{ width: CARD_WIDTH, marginBottom: CARD_GAP }}>
      <View style={{ width: CARD_WIDTH, height: CARD_HEIGHT, borderRadius: 8, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' }}>
        {drama.cover ? (
          <Image source={{ uri: mediaUrl(drama.cover) }} style={{ width: '100%', height: '100%', borderRadius: 8 }} />
        ) : (
          <Image source={require('../../assets/logo_mark.png')} style={{ width: 36, height: 36, opacity: 0.6 }} resizeMode="contain" />
        )}
        {drama.isPilot && (
          <View style={{ position: 'absolute', top: 4, left: 4, backgroundColor: colors.gold, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 }}>
            {/* 角标叠在强调色底上，文字固定用白色以保证对比度 */}
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold' }}>{t('home.pilotBadge')}</Text>
          </View>
        )}
      </View>
      <Text style={{ color: colors.text, fontSize: 13, marginTop: 6, fontWeight: '500' }} numberOfLines={1}>{drama.title}</Text>
      <Text style={{ color: colors.muted, fontSize: 11 }}>{t('home.epsCount', { n: drama.totalEpisodes })}</Text>
    </TouchableOpacity>
  );
}

// 预约剧集卡片：展示预告角标与预约人数
function UpcomingCard({ drama, onPress }: { drama: any; onPress: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={onPress} style={{ width: CARD_WIDTH, marginBottom: CARD_GAP }}>
      <View style={{ width: CARD_WIDTH, height: CARD_HEIGHT, borderRadius: 8, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' }}>
        {drama.cover ? (
          <Image source={{ uri: mediaUrl(drama.cover) }} style={{ width: '100%', height: '100%', borderRadius: 8 }} />
        ) : (
          <Image source={require('../../assets/logo_mark.png')} style={{ width: 36, height: 36, opacity: 0.6 }} resizeMode="contain" />
        )}
        <View style={{ position: 'absolute', top: 4, left: 4, backgroundColor: colors.primary, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 }}>
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold' }}>{t('reservation.trailer')}</Text>
        </View>
      </View>
      <Text style={{ color: colors.text, fontSize: 13, marginTop: 6, fontWeight: '500' }} numberOfLines={1}>{drama.title}</Text>
      <Text style={{ color: colors.muted, fontSize: 11 }}>{t('reservation.count', { n: Number(drama.reservationCount) || 0 })}</Text>
    </TouchableOpacity>
  );
}

// 首页大屏轮播：与网页端共用同一套后台配置（/banners，后台可配标题/副标题/图/视频/排序），
// 无配置时回退「热门首条」；每 5 秒自动轮换，指示点可手动切换。
// 背景用「轮播图 imageUrl → 剧集封面」（用户要求用封面铺满大屏；视频需额外依赖，这里不播）。
function HeroCarousel({ slides, onPress, width }: { slides: any[]; onPress: (dramaId: string) => void; width: number }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [idx, setIdx] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  // 多于一条时自动轮换；条数变化时重置定时器
  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(() => {
      setIdx((i) => {
        const next = (i + 1) % slides.length;
        // 自动轮换时同步滚动，保证画面与指示点一致
        scrollRef.current?.scrollTo({ x: next * width, animated: true });
        return next;
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [slides.length, width]);

  if (slides.length === 0) return null;

  return (
    <View style={{ marginBottom: 16 }}>
      <View style={{ height: HERO_HEIGHT, backgroundColor: colors.elevated, borderRadius: 12, overflow: 'hidden' }}>
        {/* 横向分页：在大屏上左右滑动只切换大屏本身，不会带动分类切换
            （ScrollView 自己接管横向手势，外层切分类的 PanResponder 拿不到这次手势） */}
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onMomentumScrollEnd={(e) => {
            const next = Math.round(e.nativeEvent.contentOffset.x / width);
            if (next >= 0 && next < slides.length) setIdx(next);
          }}
        >
          {slides.map((s: any, i: number) => {
            const drama = s.drama || s;
            const title = s.title || drama.title || '';
            const subtitle = s.subtitle || drama.hook || '';
            const bg = mediaUrl(s.imageUrl || drama.cover || '');
            const dramaId = s.dramaId || drama.id;
            return (
              <TouchableOpacity
                key={s.id || i}
                activeOpacity={0.9}
                onPress={() => dramaId && onPress(dramaId)}
                style={{ width, height: HERO_HEIGHT, justifyContent: 'flex-end', padding: 16 }}
              >
                {bg ? (
                  <Image source={{ uri: bg }} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} resizeMode="cover" />
                ) : null}
                {/* 整体压暗 + 底部再加一层，保证白字可读 */}
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' }} />
                <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: HERO_HEIGHT * 0.62, backgroundColor: 'rgba(0,0,0,0.45)' }} />

                <Text style={{ color: colors.primary, fontSize: 12, fontWeight: 'bold', marginBottom: 4 }}>{t('home.trendingHero')}</Text>
                <Text style={{ color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 6 }} numberOfLines={2}>{title}</Text>
                {subtitle ? (
                  <Text style={{ color: '#fff', fontSize: 13, marginBottom: 10 }} numberOfLines={2}>{subtitle}</Text>
                ) : null}
                <View style={{ backgroundColor: colors.primary, minHeight: 40, paddingHorizontal: 18, borderRadius: 20, alignSelf: 'flex-start', justifyContent: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: 'bold' }}>{t('home.watchFree')}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* 轮换指示点：与网页端一致，点击可手动切换 */}
        {slides.length > 1 && (
          <View style={{ position: 'absolute', top: 12, right: 12, flexDirection: 'row', gap: 6 }}>
            {slides.map((x: any, i: number) => (
              <TouchableOpacity
                key={x.id || i}
                onPress={() => {
                  setIdx(i);
                  scrollRef.current?.scrollTo({ x: i * width, animated: true });
                }}
                hitSlop={8}
                style={{ width: i === idx ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === idx ? '#fff' : 'rgba(255,255,255,0.5)' }}
              />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

// 栏目内容渲染（模块级，供主内容 / 邻页预览复用）。
// item4：各分类页不再重复渲染大标题（"热播分类下还有个热播"问题），标题行已去掉。
function renderTabContentFor(key: string, ctx: any) {
  const { colors, t, data, recommend, upcoming, heroSlides, catEntry, goDrama, goDramaDetail, markHorizontalZone, onLoadMore, refreshControl, scrollEnabled } = ctx;

  // 各 tab 把剧集网格本身作为整页滚动容器（虚拟化的 FlatList）；
  // 顶部 Hero / 底部「加载更多」分别交给 DramaGrid 的 ListHeaderComponent / ListFooterComponent，
  // 从而把原来包住它们的外层 ScrollView 收敛进来（避免双重纵向滚动冲突）。
  const grid = (gridItems: any[], gridRender: (d: any) => React.ReactElement, extra?: any) => (
    <DramaGrid
      items={gridItems}
      renderItem={gridRender}
      style={{ flex: 1 }}
      ListFooterComponent={extra?.footer}
      onEndReached={onLoadMore}
      refreshControl={refreshControl}
      scrollEnabled={scrollEnabled}
    />
  );

  if (key === 'recommend') {
    const header = (
      <View {...(markHorizontalZone || {})}>
        <HeroCarousel slides={heroSlides} onPress={goDrama} width={HERO_WIDTH} />
      </View>
    );
    if (recommend.length === 0) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      );
    }
    return (
      <DramaGrid
        items={recommend}
        renderItem={(d: any) => <DramaCard key={d.id} drama={d} onPress={() => goDrama(d.id)} />}
        style={{ flex: 1 }}
        ListHeaderComponent={header}
        onEndReached={onLoadMore}
        refreshControl={refreshControl}
        scrollEnabled={scrollEnabled}
      />
    );
  }

  if (key === 'trending') {
    return grid(data.trending || [], (d: any) => <DramaCard key={d.id} drama={d} onPress={() => goDrama(d.id)} />);
  }

  if (key === 'new') {
    return grid(data.newReleases || [], (d: any) => <DramaCard key={d.id} drama={d} onPress={() => goDrama(d.id)} />);
  }

  if (key === 'upcoming') {
    if (upcoming.length === 0) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 }}>
          <Image source={require('../../assets/logo_mark.png')} style={{ width: 40, height: 40, opacity: 0.6 }} resizeMode="contain" />
          <Text style={{ color: colors.muted, marginTop: 8 }}>{t('reservation.empty')}</Text>
        </View>
      );
    }
    return grid(upcoming, (d: any) => <UpcomingCard key={d.id} drama={d} onPress={() => goDramaDetail(d.id)} />);
  }

  // 具体分类：数据来源：active 用实时 state，邻页预览用缓存。
  const dramas = catEntry?.dramas || [];
  const total = catEntry?.total || 0;
  const loadingMore = catEntry?.loadingMore || false;
  const footer = (
    <View style={{ paddingVertical: 20, alignItems: 'center' }}>
      {loadingMore ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : dramas.length >= total ? (
        <Text style={{ color: colors.subtle, fontSize: 12 }}>{t('home.noMore')}</Text>
      ) : null}
    </View>
  );
  if (dramas.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 }}>
        <Text style={{ fontSize: 40 }}>🔍</Text>
        <Text style={{ color: colors.muted, marginTop: 8 }}>{t('home.emptyCategory')}</Text>
      </View>
    );
  }
  return grid(dramas, (d: any) => <DramaCard key={d.id} drama={d} onPress={() => goDrama(d.id)} />, { footer });
}

// 单个栏目的可滚动容器（竖向滚动 + 上拉加载 + 下拉刷新）。
// 作为分类横向分页（item7）的每一页使用。
function TabContent({ tabKey, colors, t, data, recommend, upcoming, heroSlides, catEntry, goDrama, goDramaDetail, onLoadMore, onRefresh, refreshing, scrollEnabled = true, markHorizontalZone }: any) {
  // 下拉刷新交给网格 FlatList 的 refreshControl；上拉加载交给 FlatList 的 onEndReached。
  // 这里不再用外层 ScrollView，避免与网格自身的滚动冲突（双重纵向滚动会把页面滚动手势吞掉）。
  const refreshControl = onRefresh ? (
    <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
  ) : undefined;
  return renderTabContentFor(tabKey, {
    colors,
    t,
    data,
    recommend,
    upcoming,
    heroSlides,
    catEntry,
    goDrama,
    goDramaDetail,
    markHorizontalZone,
    onLoadMore,
    refreshControl,
    scrollEnabled,
  });
}

export default function Home({ navigation }: any) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [data, setData] = useState<any>({ trending: [], newReleases: [], categories: [] });
  // 首页轮播大屏配置（后台 /banners，与网页端共用）
  const [banners, setBanners] = useState<any[]>([]);
  // ============ 列表按需加载：先加载一页，滚动到底部再加载下一页 ============
  const PAGE_SIZE = 24; // 每页剧集数（首屏展示数），剩余滚动到底部再加载
  // 分类页签分页
  const [catPage, setCatPage] = useState(1);
  const [catTotal, setCatTotal] = useState(0);
  const [catLoadingMore, setCatLoadingMore] = useState(false);
  // 搜索结果分页
  const [searchPage, setSearchPage] = useState(1);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  // item8：主页面顶部搜索栏的下拉框开关（筛选信息 + 历史搜索）
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  // item7：邻页预览缓存填充后强制重渲染
  const [neighborTick, setNeighborTick] = useState(0);
  const [recommend, setRecommend] = useState<any[]>([]);
  const [catDramas, setCatDramas] = useState<any[]>([]);
  // 下拉刷新
  const [refreshing, setRefreshing] = useState(false);
  const [searchRefreshing, setSearchRefreshing] = useState(false);
  // 筛选面板（与网页端同一套 /filters 数据：内容标签多选 + 黀认筛选单选）
  const [filters, setFilters] = useState<any[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<Record<string, string>>({});
  const [filterOpen, setFilterOpen] = useState(false);
  // 搜索历史（与网页端同一套规则：按账户隔离 / 最多 10 条 / 长按进入删除）
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [historyEditing, setHistoryEditing] = useState(false);
  // 预约专区
  const [upcoming, setUpcoming] = useState<any[]>([]);
  // 当前激活页签：'recommend' | 'trending' | 'new' | 'upcoming' | <catId>
  const [activeTab, setActiveTab] = useState<string>('recommend');
  // 当前页签是否为「具体分类」（推荐/热门/新剧/预约 为内置页签）
  const isCategory = !['recommend', 'trending', 'new', 'upcoming'].includes(activeTab);

  // 登录态：用于剧集页顶部在未登录时展示品牌 logo + 登录入口（每次聚焦刷新）
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      AsyncStorage.getItem('user_token')
        .then((tk) => {
          if (mounted) setIsLoggedIn(!!tk);
        })
        .catch(() => {});
      return () => {
        mounted = false;
      };
    }, []),
  );

  useEffect(() => {
    dramaApi.home().then(setData).catch(() => {});
  }, []);

  // 筛选面板数据：与网页端同一个 /filters 接口
  useEffect(() => {
    filterApi
      .list()
      .then((r: any) => setFilters(Array.isArray(r) ? r : Array.isArray(r?.list) ? r.list : []))
      .catch(() => setFilters([]));
  }, []);

  // ===== 搜索历史（AsyncStorage，按账户隔离，与网页端规则一致） =====
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
      .then((v: any) => {
        if (v) setSearchHistory(JSON.parse(v));
      })
      .catch(() => {});
  }, []);

  const addSearchHistory = (text: string) => {
    const q = text.trim();
    if (!q) return;
    setSearchHistory((prev) => {
      const next = [q, ...prev.filter((x) => x !== q)].slice(0, 10);
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

  // 已选默认筛选项 → 查询参数（推荐排序 / 上架时间 / 总时长），与网页端逻辑一致
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

  // 首页轮播大屏配置：与网页端同一个后台接口（/banners），后台统一管理
  useEffect(() => {
    bannerApi
      .list()
      .then((r: any) => setBanners(Array.isArray(r?.list) ? r.list : []))
      .catch(() => setBanners([]));
  }, []);

  // 大屏轮播数据：后台 Banner（关联了剧集）优先；无配置时回退「热门首条」——与网页端规则一致
  const heroSlides = useMemo(() => {
    const list = (banners || []).filter((b: any) => b && b.drama);
    if (list.length > 0) return list;
    return data.trending?.[0]
      ? [{ id: '__fallback', dramaId: data.trending[0].id, drama: data.trending[0] }]
      : [];
  }, [banners, data.trending]);

  // 加载个性化推荐
  useEffect(() => {
    dramaApi.recommend({ pageSize: 12 })
      .then((r: any) => setRecommend(r.list || []))
      .catch(() => setRecommend([]));
  }, []);

  // 分类 Tab 切换：首页内筛选
  useEffect(() => {
    if (activeTab === 'upcoming') {
      reservationApi
        .upcoming()
        .then((r: any) => setUpcoming(r.list || []))
        .catch(() => setUpcoming([]));
    } else if (isCategory) {
      // 具体分类 id：先重置分页、加载第一页（后续滚动到底部再加载下一页）
      loadCategory(activeTab, 1);
    }
  }, [activeTab, isCategory]);

  // 加载指定分类的某一页：写入 catDramas 实时 state，并缓存供邻页预览（item7）
  const loadCategory = (key: string, page: number) => {
    if (page === 1) {
      setCatPage(1);
      setCatTotal(0);
      setCatLoadingMore(true);
    } else {
      setCatLoadingMore(true);
    }
    dramaApi
      .list({ categoryId: key, page, pageSize: PAGE_SIZE })
      .then((r: any) => {
        const list: any[] = r.list || [];
        if (page === 1) {
          setCatDramas(list);
          catCacheRef.current[key] = {
            dramas: list,
            total: typeof r.total === 'number' ? r.total : list.length,
            loadingMore: false,
          };
        } else {
          setCatDramas((prev) => [...prev, ...list]);
        }
        setCatTotal((prev) => (typeof r.total === 'number' ? r.total : prev + (page === 1 ? 0 : list.length)));
        setCatPage(page);
      })
      .catch(() => {
        if (page === 1) setCatDramas([]);
      })
      .finally(() => setCatLoadingMore(false));
  };

  // 分类列表滚动到底部时加载下一页
  const loadMoreCat = useCallback(() => {
    if (catLoadingMore || catDramas.length >= catTotal) return;
    const next = catPage + 1;
    loadCategory(activeTab, next);
  }, [catLoadingMore, catPage, catTotal, catDramas.length, activeTab]);

  // 搜索结果滚动到底部时加载下一页
  const loadMoreSearch = useCallback(() => {
    if (searchLoadingMore || results.length >= searchTotal) return;
    const next = searchPage + 1;
    setSearchLoadingMore(true);
    const params: any = { page: next, pageSize: PAGE_SIZE };
    if (searchText) params.keyword = searchText;
    if (selectedTags.length > 0) params.tagIds = selectedTags.join(',');
    Object.entries(activeFilterParams).forEach(([k, v]) => { params[k] = String(v); });
    dramaApi
      .list(params)
      .then((r: any) => {
        const list: any[] = r.list || [];
        setResults((prev) => [...prev, ...list]);
        setSearchTotal((prev) => (typeof r.total === 'number' ? r.total : prev + list.length));
        setSearchPage(next);
      })
      .catch(() => {})
      .finally(() => setSearchLoadingMore(false));
  }, [searchLoadingMore, searchPage, searchTotal, results.length, searchText, selectedTags, activeFilterParams]);

  // ScrollView 滚动到底部（阈值 200px）时按需加载下一页
  const handleListScroll = (e: any, kind: 'cat' | 'search') => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const reachedBottom =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - 200;
    if (!reachedBottom) return;
    if (kind === 'cat') {
      if (isCategory) loadMoreCat();
    } else {
      loadMoreSearch();
    }
  };

  const doSearch = (text: string) => {
    const hasFilter = selectedTags.length > 0 || Object.keys(activeFilterParams).length > 0;
    if (!text.trim() && !hasFilter) {
      setShowResults(false);
      return Promise.resolve();
    }
    if (text.trim()) addSearchHistory(text);
    setLoading(true);
    setShowResults(true);
    setSearchDropdownOpen(false);
    setHistoryEditing(false);
    setSearchPage(1);
    setSearchTotal(0);
    setSearchLoadingMore(false);
    const params: any = { page: 1, pageSize: PAGE_SIZE };
    if (text.trim()) params.keyword = text.trim();
    if (selectedTags.length > 0) params.tagIds = selectedTags.join(',');
    Object.entries(activeFilterParams).forEach(([k, v]) => { params[k] = String(v); });
    return dramaApi
      .list(params)
      .then((r: any) => {
        setResults(r.list || []);
        setSearchTotal(typeof r.total === 'number' ? r.total : (r.list || []).length);
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  };

  // ===== 下拉刷新：重新拉取当前页签数据（顶部出现刷新动画） =====
  const onRefreshMain = useCallback(() => {
    setRefreshing(true);
    const jobs: Promise<any>[] = [];
    if (activeTab === 'recommend') {
      jobs.push(dramaApi.home().then(setData).catch(() => {}));
      jobs.push(bannerApi.list().then((r: any) => setBanners(Array.isArray(r?.list) ? r.list : [])).catch(() => {}));
      jobs.push(dramaApi.recommend({ pageSize: 12 }).then((r: any) => setRecommend(r.list || [])).catch(() => {}));
    } else if (activeTab === 'upcoming') {
      jobs.push(reservationApi.upcoming().then((r: any) => setUpcoming(r.list || [])).catch(() => {}));
    } else if (isCategory) {
      jobs.push(
        new Promise<void>((resolve) => {
          loadCategory(activeTab, 1);
          resolve();
        }),
      );
    } else {
      jobs.push(dramaApi.home().then(setData).catch(() => {}));
    }
    Promise.all(jobs).finally(() => setRefreshing(false));
  }, [activeTab, isCategory]);

  // 搜索结果下拉刷新
  const onRefreshSearch = useCallback(() => {
    setSearchRefreshing(true);
    Promise.resolve(doSearch(searchText)).finally(() => setSearchRefreshing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, selectedTags, activeFilterParams]);

  // 筛选/标签变化时自动按当前条件重搜（与网页端行为一致）
  const showResultsRef = useRef(showResults);
  showResultsRef.current = showResults;
  const searchTextRef = useRef(searchText);
  searchTextRef.current = searchText;
  const doSearchRef = useRef(doSearch);
  doSearchRef.current = doSearch;
  useEffect(() => {
    if (showResultsRef.current) doSearchRef.current(searchTextRef.current);
    // 仅在筛选条件变化时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTags, filterTags]);

  // ============ 顶部栏：搜索栏已移到页面内容区顶部（item8），这里隐藏原生 header ============
  useFocusEffect(
    useCallback(() => {
      navigation.setOptions({ headerShown: false });
      // 离开剧场页时收起搜索下拉框，避免再次进入时仍处于展开状态
      return () => {
        setSearchDropdownOpen(false);
      };
    }, [navigation]),
  );

  // 点击剧集卡片进入播放页：不传 epId，由播放页决定（有则先播，否则第 1 集）
  const goDrama = (id: string) => navigation.navigate('Player', { dramaId: id });
  // 预约剧集暂无正片，进入详情页而非播放页
  const goDramaDetail = (id: string) => navigation.navigate('DramaDetail', { id });

  // 页签：与网页端一致——推荐 / 热门 / 新剧 / 预约 / 后台分类
  const tabs = useMemo(() => {
    const cats: any[] = Array.isArray(data.categories) ? data.categories : [];
    return [
      { key: 'recommend', label: t('home.recommendTitle') },
      { key: 'trending', label: t('home.trendingNow') },
      { key: 'new', label: t('home.newReleases') },
      { key: 'upcoming', label: t('nav.reservation') },
      ...cats.map((c: any) => ({ key: String(c.id), label: localizeCategory(t, c) })),
    ];
  }, [data.categories, t]);

  const onTabPress = (key: string) => {
    setActiveTab(key);
    setShowResults(false);
    setSearchDropdownOpen(false);
    setSearchText('');
  };

  // 当前处于第几格（用于左右滑动切页签）
  const activeTabIndex = Math.max(0, tabs.findIndex((tb) => tb.key === activeTab));

  // ============ 切换分类的「拉动」过渡动画 ============
  // 内容区从切换方向的一侧滑入 + 淡入：往后切从右边进，往前切从左边进，
  // 让横滑/点击切分类时都能看到画面被「拉」过来的效果。
  const tabAnim = useRef(new Animated.Value(0)).current;
  const prevTabRef = useRef(activeTab);
  useEffect(() => {
    const prevIdx = tabs.findIndex((tb: any) => tb.key === prevTabRef.current);
    const curIdx = tabs.findIndex((tb: any) => tb.key === activeTab);
    const dir = curIdx >= prevIdx ? 1 : -1;
    prevTabRef.current = activeTab;
    tabAnim.setValue(dir * 56);
    Animated.timing(tabAnim, {
      toValue: 0,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [activeTab, tabAnim, tabs]);

  // ============ 左右滑动切换分类（抖音 / 哔哩哔哩式：手指跟随 + 邻页预览 + 橡皮筋回弹，item7） ============
  const tabsScrollRef = useRef<any>(null);
  const tabRectsRef = useRef<Record<string, { x: number; width: number }>>({});
  // 横线指示器位置 / 宽度（主题色，item6；随手指同步插值，item7）
  const ulX = useRef(new Animated.Value(0)).current;
  const ulW = useRef(new Animated.Value(0)).current;
  // 翻页拖拽：内容随手指平移 + 邻页预览 + 回弹（item7）
  const dragX = useRef(new Animated.Value(0)).current;
  const neighborBaseX = useRef(new Animated.Value(0)).current;
  const [dragDir, setDragDir] = useState<0 | 1 | -1>(0);
  const [neighborKey, setNeighborKey] = useState<string | null>(null);
  // 分类 Tab 内容缓存：邻页预览用（拖动时先看到已加载过的分类内容，item7）
  const catCacheRef = useRef<Record<string, { dramas: any[]; total: number; loadingMore: boolean }>>({});
  // 邻页预览：只写缓存、不动 active 的 catDramas 实时 state（item7）
  const loadCategoryPreview = (key: string) => {
    if (!key) return;
    if (['recommend', 'trending', 'new', 'upcoming'].includes(key)) return;
    if (catCacheRef.current[key]) return;
    dramaApi
      .list({ categoryId: key, page: 1, pageSize: PAGE_SIZE })
      .then((r: any) => {
        const list: any[] = r.list || [];
        catCacheRef.current[key] = {
          dramas: list,
          total: typeof r.total === 'number' ? r.total : list.length,
          loadingMore: false,
        };
        setNeighborTick((n) => n + 1);
      })
      .catch(() => {});
  };
  const loadCategoryPreviewRef = useRef<any>(null);
  loadCategoryPreviewRef.current = loadCategoryPreview;
  // 动态值用 ref 持有，避免重创 PanResponder 导致手势中断
  const tabsRef = useRef<any[]>(tabs);
  const activeTabIndexRef = useRef(activeTabIndex);
  const activeTabRef = useRef(activeTab);
  const onTabPressRef = useRef(onTabPress);
  const dragDirRef = useRef<0 | 1 | -1>(0);
  const neighborKeyRef = useRef<string | null>(null);
  tabsRef.current = tabs;
  activeTabIndexRef.current = activeTabIndex;
  onTabPressRef.current = onTabPress;
  activeTabRef.current = activeTab;
  dragDirRef.current = dragDir;
  neighborKeyRef.current = neighborKey;

  // 翻到新分类：横线平滑落位 + 分类 Tab 自动滚动使当前分类可见（item6）
  useEffect(() => {
    const r = tabRectsRef.current[activeTab];
    if (r && r.width > 0) {
      Animated.spring(ulX, { toValue: r.x, useNativeDriver: false, tension: 140, friction: 20 }).start();
      Animated.spring(ulW, { toValue: r.width, useNativeDriver: false, tension: 140, friction: 20 }).start();
    }
    const scroll = tabsScrollRef.current;
    if (scroll && r) {
      scroll.scrollTo({ x: Math.max(0, r.x + r.width / 2 - SCREEN_WIDTH / 2), animated: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // 标记分类 Tab / Hero 横滑区，避免被切分类的手势抢走
  const blockSwipeRef = useRef(false);
  const markHorizontalZone = {
    onStartShouldSetResponder: () => {
      blockSwipeRef.current = true;
      return false;
    },
  };

  // 横线弹回当前激活分类（橡皮筋回弹时用，item7）
  const snapUnderlineToActive = () => {
    const r = tabRectsRef.current[activeTabRef.current];
    if (r && r.width > 0) {
      Animated.spring(ulX, { toValue: r.x, useNativeDriver: false, tension: 140, friction: 20 }).start();
      Animated.spring(ulW, { toValue: r.width, useNativeDriver: false, tension: 140, friction: 20 }).start();
    }
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => {
          blockSwipeRef.current = false;
          return false;
        },
        // 用「冒泡阶段」：子级 ScrollView 在 touchStart 抢到 responder 后再问到我们
        onMoveShouldSetPanResponder: (_e: any, g: any) => {
          if (blockSwipeRef.current) return false; // 横滑区（Hero / 分类 Tab 行）不接管
          return Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2;
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_e: any, g: any) => {
          if (blockSwipeRef.current) return;
          const tabsL = tabsRef.current;
          const aIdx = activeTabIndexRef.current;
          if (!tabsL || tabsL.length < 2) { dragX.setValue(0); return; }
          const dir: 1 | -1 = g.dx < 0 ? 1 : -1;
          const nIdx = Math.max(0, Math.min(tabsL.length - 1, aIdx + dir));
          if (nIdx === aIdx) { dragX.setValue(0); return; }
          const nKey = tabsL[nIdx].key;
          if (dir !== dragDirRef.current) {
            dragDirRef.current = dir; setDragDir(dir);
            neighborKeyRef.current = nKey; setNeighborKey(nKey);
            neighborBaseX.setValue(dir === 1 ? SCREEN_WIDTH : -SCREEN_WIDTH);
            loadCategoryPreviewRef.current?.(nKey);
          }
          dragX.setValue(g.dx);
          // 横线随手指同步插值（item7）
          const cur = tabRectsRef.current[activeTabRef.current];
          const nxt = tabRectsRef.current[nKey];
          if (cur && nxt && cur.width > 0 && nxt.width > 0) {
            const f = Math.min(1, Math.abs(g.dx) / SCREEN_WIDTH);
            ulX.setValue(cur.x + (nxt.x - cur.x) * f);
            ulW.setValue(cur.width + (nxt.width - cur.width) * f);
          }
        },
        onPanResponderRelease: (_e: any, g: any) => {
          const tabsL = tabsRef.current;
          const aIdx = activeTabIndexRef.current;
          const onTab = onTabPressRef.current;
          const dir = dragDirRef.current;
          const nKey = neighborKeyRef.current;
          dragDirRef.current = 0; setDragDir(0);
          neighborKeyRef.current = null; setNeighborKey(null);
          if (!tabsL || tabsL.length < 2 || !dir || !nKey) { dragX.setValue(0); return; }
          const threshold = SCREEN_WIDTH * 0.22;
          if (Math.abs(g.dx) > threshold) {
            // 翻页：内容瞬间归位（新 active 即当前邻页，视觉无跳变），再切分类
            dragX.setValue(0); neighborBaseX.setValue(0);
            const nIdx = Math.max(0, Math.min(tabsL.length - 1, aIdx + dir));
            onTab(tabsL[nIdx].key);
          } else {
            // 没滑过去：橡皮筋回弹到当前页（item7）
            Animated.spring(dragX, { toValue: 0, useNativeDriver: true, tension: 60, friction: 9 }).start();
            snapUnderlineToActive();
          }
        },
        onPanResponderTerminate: () => {
          dragDirRef.current = 0; setDragDir(0);
          neighborKeyRef.current = null; setNeighborKey(null);
          Animated.spring(dragX, { toValue: 0, useNativeDriver: true, tension: 60, friction: 9 }).start();
          snapUnderlineToActive();
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // 搜索 / 分类结果视图
  if (showResults) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <View style={{ flex: 1 }}>
          {/* 搜索栏：返回 + 输入框 + 放大镜 + 筛选按钮 */}
          <View style={{ flexDirection: 'row', padding: 12, gap: 8, alignItems: 'center' }}>
            <Pressable
              onPress={() => {
                setShowResults(false);
                setActiveCat(null);
                setSearchText('');
                setFilterOpen(false);
              }}
              style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ color: colors.muted, fontSize: 16 }}>←</Text>
            </Pressable>
            {/* 与网页版一致的胶囊搜索栏：保留左侧返回箭头，输入框 + 简笔画放大镜图标按钮 */}
            <View
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                height: 44,
                backgroundColor: colors.surfaceAlt,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 999,
                paddingLeft: 14,
                paddingRight: 6,
              }}
            >
              <TextInput
                value={searchText}
                onChangeText={setSearchText}
                onSubmitEditing={() => doSearch(searchText)}
                placeholder={t('home.searchPlaceholder')}
                placeholderTextColor={colors.subtle}
                style={{ flex: 1, color: colors.text, fontSize: 14, padding: 0, margin: 0 }}
                returnKeyType="search"
              />
              <Pressable
                onPress={() => doSearch(searchText)}
                hitSlop={10}
                style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 999 }}
              >
                <MagnifierIcon size={18} color={colors.subtle} />
              </Pressable>
            </View>
            {/* 筛选按钮：与网页端同一套筛选面板入口 */}
            <Pressable
              onPress={() => setFilterOpen((v) => !v)}
              style={{
                minHeight: 44,
                paddingHorizontal: 12,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: filterOpen || selectedTags.length > 0 || Object.keys(filterTags).length > 0 ? colors.primary : colors.border,
                backgroundColor: filterOpen || selectedTags.length > 0 || Object.keys(filterTags).length > 0 ? colors.primary : colors.surfaceAlt,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                style={{
                  color: filterOpen || selectedTags.length > 0 || Object.keys(filterTags).length > 0 ? '#fff' : colors.textSecondary,
                  fontSize: 13,
                  fontWeight: 'bold',
                }}
              >
                {t('filter.title')}
              </Text>
            </Pressable>
          </View>

          {/* 筛选面板：与网页端一致——每个主题一行，主题标签 + 该主题分类 chips */}
          {filterOpen && (
            <ScrollView
              style={{ maxHeight: 280 }}
              contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8 }}
              nestedScrollEnabled
            >
              {filters.map((g: any) => {
                const tags: any[] = g.tags || [];
                if (tags.length === 0) return null;
                return (
                  <View key={g.id || g.slug} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <View
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        borderRadius: 8,
                        backgroundColor: filterTags[g.slug] ? colors.primary : colors.surfaceAlt,
                      }}
                    >
                      <Text
                        style={{
                          color: filterTags[g.slug] ? '#fff' : colors.primary,
                          fontSize: 12,
                          fontWeight: 'bold',
                        }}
                      >
                        {g.name || g.slug}
                      </Text>
                    </View>
                    {tags.map((tag: any) => {
                      const on =
                        g.kind === 'filter'
                          ? filterTags[g.slug] === tag.id
                          : selectedTags.includes(tag.id);
                      return (
                        <Pressable
                          key={tag.id}
                          onPress={() => {
                            if (g.kind === 'filter') {
                              setFilterTags((prev) => {
                                const next = { ...prev };
                                if (next[g.slug] === tag.id) delete next[g.slug];
                                else next[g.slug] = tag.id;
                                return next;
                              });
                            } else {
                              setSelectedTags((prev) =>
                                prev.includes(tag.id) ? prev.filter((x) => x !== tag.id) : [...prev, tag.id],
                              );
                            }
                          }}
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            minHeight: 32,
                            borderRadius: 8,
                            backgroundColor: on ? colors.primary : colors.surfaceAlt,
                            borderWidth: 1,
                            borderColor: on ? colors.primary : colors.border,
                          }}
                        >
                          <Text style={{ color: on ? '#fff' : colors.muted, fontSize: 12 }}>{tag.name}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })}
              {(selectedTags.length > 0 || Object.keys(filterTags).length > 0) && (
                <Pressable
                  onPress={() => {
                    setSelectedTags([]);
                    setFilterTags({});
                  }}
                  style={{ alignSelf: 'flex-end', paddingHorizontal: 10, paddingVertical: 6, marginBottom: 6 }}
                >
                  <Text style={{ color: colors.primary, fontSize: 12, fontWeight: 'bold' }}>{t('filter.reset')}</Text>
                </Pressable>
              )}
            </ScrollView>
          )}

          {/* 结果：网格本身作为滚动容器（虚拟化），把原外层 ScrollView 收敛进来 */}
          {searchText.trim() === '' ? (
            /* 输入为空时展示最近搜索历史 */
            searchHistory.length === 0 ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <MagnifierIcon size={44} color={colors.muted} />
                <Text style={{ color: colors.muted, fontSize: 16, marginTop: 12 }}>{t('home.noResults')}</Text>
                <Text style={{ color: colors.subtle, fontSize: 12, marginTop: 6 }}>{t('home.noResultsHint')}</Text>
              </View>
            ) : (
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                  <Text style={{ color: colors.text, fontSize: 15, fontWeight: 'bold' }}>{t('search.recentHistory')}</Text>
                  <View style={{ flex: 1 }} />
                  {historyEditing && (
                    <Pressable onPress={() => setHistoryEditing(false)} hitSlop={8}>
                      <Text style={{ color: colors.primary, fontSize: 13, fontWeight: 'bold' }}>{t('search.historyDone')}</Text>
                    </Pressable>
                  )}
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {searchHistory.map((q) => (
                    <Pressable
                      key={q}
                      onPress={() => {
                        if (historyEditing) {
                          removeSearchHistory(q);
                        } else {
                          setSearchText(q);
                          doSearch(q);
                        }
                      }}
                      onLongPress={() => setHistoryEditing(true)}
                      delayLongPress={400}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        backgroundColor: colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: 999,
                        paddingHorizontal: 12,
                        minHeight: 36,
                      }}
                    >
                      <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{q}</Text>
                      {historyEditing && (
                        <Text style={{ color: colors.danger, marginLeft: 6, fontWeight: 'bold' }}>×</Text>
                      )}
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            )
          ) : loading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : results.length === 0 ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
              <MagnifierIcon size={44} color={colors.muted} />
              <Text style={{ color: colors.muted, fontSize: 16, marginTop: 12 }}>{t('home.noResults')}</Text>
              <Text style={{ color: colors.subtle, fontSize: 12, marginTop: 6 }}>{t('home.noResultsHint')}</Text>
            </View>
          ) : (
            <DramaGrid
              items={results}
              renderItem={(d: any) => <DramaCard key={d.id} drama={d} onPress={() => goDrama(d.id)} />}
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 12 }}
              ListFooterComponent={
                <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                  {searchLoadingMore ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : results.length >= searchTotal ? (
                    <Text style={{ color: colors.subtle, fontSize: 12 }}>{t('home.noMore')}</Text>
                  ) : null}
                </View>
              }
              onEndReached={loadMoreSearch}
              onEndReachedThreshold={0.2}
              refreshControl={
                <RefreshControl refreshing={searchRefreshing} onRefresh={onRefreshSearch} tintColor={colors.primary} colors={[colors.primary]} />
              }
            />
          )}
        </View>
      </SafeAreaView>
    );
  }

  // 单个栏目的内容：委托给模块级 renderTabContentFor（已去掉冗余标题，item4）
  const renderTabContent = () =>
    renderTabContentFor(activeTab, {
      colors,
      t,
      data,
      recommend,
      upcoming,
      heroSlides,
      catEntry: { dramas: catDramas, total: catTotal, loadingMore: catLoadingMore },
      goDrama,
      goDramaDetail,
    });

  const searchInputRef = useRef<any>(null);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      {/* 未登录时：剧集页顶部品牌区（软件图标 + 项目名 + 登录按钮） */}
      {!isLoggedIn && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 12,
            paddingTop: 8,
            paddingBottom: 6,
            backgroundColor: colors.bg,
          }}
        >
          <Image
            source={require('../../assets/logo_mark.png')}
            style={{ width: 40, height: 40 }}
          />
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: 'bold', marginLeft: 6, flex: 1 }}>
            EdenDrama
          </Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('Login')}
            style={{
              height: 40,
              paddingHorizontal: 18,
              borderRadius: 20,
              backgroundColor: colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: 'bold', textAlign: 'center' }}>{t('login.logIn')}</Text>
          </TouchableOpacity>
        </View>
      )}
      {/* item5：搜索栏点击进入独立搜索界面 */}
      <Pressable
        onPress={() => navigation.navigate('Search')}
        style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: 4, backgroundColor: colors.bg }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            height: 44,
            backgroundColor: colors.surfaceAlt,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 999,
            paddingLeft: 14,
            paddingRight: 6,
          }}
        >
          <MagnifierIcon size={18} color={colors.subtle} />
          <Text style={{ flex: 1, color: colors.subtle, fontSize: 14, marginLeft: 8 }}>{t('home.searchPlaceholder')}</Text>
        </View>
      </Pressable>

      {/* item8：搜索下拉框（筛选信息 + 历史搜索），覆盖在内容之上。
          包裹层用全屏 absolute overlay：这样子面板的 top:54 相对屏幕顶部计算，
          才能紧贴在搜索栏正下方（否则会落到分类 Tab 之下）。 */}
      {searchDropdownOpen && (
        <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 }}>
          <Pressable
            style={{ position: 'absolute', top: 54, left: 0, right: 0, bottom: 0, zIndex: 5 }}
            onPress={() => {
              searchInputRef.current?.blur();
              Keyboard.dismiss();
              setSearchDropdownOpen(false);
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: 54,
              left: 0,
              right: 0,
              zIndex: 10,
              backgroundColor: colors.bg,
              borderBottomWidth: 1,
              borderColor: colors.border,
              maxHeight: SCREEN_HEIGHT * 0.6,
              paddingTop: 6,
              paddingBottom: 12,
              paddingHorizontal: 12,
            }}
          >
            <ScrollView>
              {/* 筛选信息（与网页端同一套 /filters） */}
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: 'bold', marginBottom: 10 }}>{t('filter.title')}</Text>
              {filters.map((g: any) => {
                const tags: any[] = g.tags || [];
                if (tags.length === 0) return null;
                return (
                  <View key={g.id || g.slug} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <View
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        borderRadius: 8,
                        backgroundColor: filterTags[g.slug] ? colors.primary : colors.surfaceAlt,
                      }}
                    >
                      <Text style={{ color: filterTags[g.slug] ? '#fff' : colors.primary, fontSize: 12, fontWeight: 'bold' }}>{g.name || g.slug}</Text>
                    </View>
                    {tags.map((tag: any) => {
                      const on = g.kind === 'filter' ? filterTags[g.slug] === tag.id : selectedTags.includes(tag.id);
                      return (
                        <Pressable
                          key={tag.id}
                          onPress={() => {
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
                          }}
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            minHeight: 32,
                            borderRadius: 8,
                            backgroundColor: on ? colors.primary : colors.surfaceAlt,
                            borderWidth: 1,
                            borderColor: on ? colors.primary : colors.border,
                          }}
                        >
                          <Text style={{ color: on ? '#fff' : colors.muted, fontSize: 12 }}>{tag.name}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })}
              {(selectedTags.length > 0 || Object.keys(filterTags).length > 0) && (
                <Pressable
                  onPress={() => {
                    setSelectedTags([]);
                    setFilterTags({});
                  }}
                  style={{ alignSelf: 'flex-end', paddingHorizontal: 10, paddingVertical: 6, marginBottom: 12 }}
                >
                  <Text style={{ color: colors.primary, fontSize: 12, fontWeight: 'bold' }}>{t('filter.reset')}</Text>
                </Pressable>
              )}

              {/* 历史搜索 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: 'bold' }}>{t('search.recentHistory')}</Text>
                <View style={{ flex: 1 }} />
                {historyEditing && (
                  <Pressable onPress={() => setHistoryEditing(false)} hitSlop={8}>
                    <Text style={{ color: colors.primary, fontSize: 13, fontWeight: 'bold' }}>{t('search.historyDone')}</Text>
                  </Pressable>
                )}
              </View>
              {searchHistory.length === 0 ? (
                <Text style={{ color: colors.subtle, fontSize: 12 }}>{t('home.noResultsHint')}</Text>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {searchHistory.map((q) => (
                    <Pressable
                      key={q}
                      onPress={() => {
                        if (historyEditing) removeSearchHistory(q);
                        else {
                          setSearchText(q);
                          doSearch(q);
                        }
                      }}
                      onLongPress={() => setHistoryEditing(true)}
                      delayLongPress={400}
                      style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, minHeight: 36 }}
                    >
                      <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{q}</Text>
                      {historyEditing && <Text style={{ color: colors.danger, marginLeft: 6, fontWeight: 'bold' }}>×</Text>}
                    </Pressable>
                  ))}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      )}

      {/* item6：分类横线 Tab（可横滑 + 自动滚动到当前 + 主题色横线，去掉竖线） */}
      <View {...markHorizontalZone} style={{ backgroundColor: colors.bg, position: 'relative' }}>
        <ScrollView
          ref={tabsScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ paddingHorizontal: 12 }}
          contentContainerStyle={{ alignItems: 'center' }}
        >
          {tabs.map((tb: any) => {
            const active = tb.key === activeTab;
            return (
              <Pressable
                key={tb.key}
                onLayout={(e: any) => {
                  const r = e.nativeEvent.layout;
                  tabRectsRef.current[tb.key] = { x: r.x, width: r.width };
                  // 首屏/切换后立刻把横线落到当前分类（避免闪烁）
                  if (tb.key === activeTabRef.current) {
                    ulX.setValue(r.x);
                    ulW.setValue(r.width);
                  }
                }}
                onPress={() => onTabPress(tb.key)}
                style={{ paddingHorizontal: 8, paddingVertical: 10, marginRight: 2 }}
              >
                <Text
                  style={{
                    color: active ? colors.primary : colors.muted,
                    fontSize: 14,
                    fontWeight: active ? 'bold' : 'normal',
                  }}
                >
                  {tb.label}
                </Text>
              </Pressable>
            );
          })}
          {/* 主题色横线指示器（随手指插值，item7） */}
          <Animated.View
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              height: 2,
              width: ulW,
              backgroundColor: colors.primary,
              transform: [{ translateX: ulX }],
            }}
          />
        </ScrollView>
      </View>

      {/* item7：横向分页（自定义 PanResponder：手指跟随 + 邻页预览 + 橡皮筋回弹。
          容器直接接管横滑手势，避免与卡片点击/竖向滚动冲突） */}
      <View style={{ flex: 1, overflow: 'hidden' }} {...panResponder.panHandlers}>
        {/* 主内容页 */}
        <Animated.View
          style={{ position: 'absolute', top: 0, left: 0, width: SCREEN_WIDTH, height: '100%', transform: [{ translateX: dragX }] }}
        >
          <TabContent
            tabKey={activeTab}
            colors={colors}
            t={t}
            data={data}
            recommend={recommend}
            upcoming={upcoming}
            heroSlides={heroSlides}
            catEntry={{ dramas: catDramas, total: catTotal, loadingMore: catLoadingMore }}
            goDrama={goDrama}
            goDramaDetail={goDramaDetail}
            onLoadMore={isCategory ? loadMoreCat : undefined}
            onRefresh={onRefreshMain}
            refreshing={refreshing}
            scrollEnabled={dragDir === 0}
            markHorizontalZone={markHorizontalZone}
          />
        </Animated.View>
        {/* 邻页预览（横滑时显示，跟随手指；松手未过阈值则橡皮筋回弹） */}
        {dragDir !== 0 && neighborKey && (
          <Animated.View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: SCREEN_WIDTH,
              height: '100%',
              transform: [{ translateX: Animated.add(neighborBaseX, dragX) }],
            }}
          >
            <TabContent
              tabKey={neighborKey}
              colors={colors}
              t={t}
              data={data}
              recommend={recommend}
              upcoming={upcoming}
              heroSlides={heroSlides}
              catEntry={catCacheRef.current[neighborKey]}
              goDrama={goDrama}
              goDramaDetail={goDramaDetail}
              onLoadMore={undefined}
              onRefresh={undefined}
              refreshing={false}
              scrollEnabled={false}
              markHorizontalZone={markHorizontalZone}
            />
          </Animated.View>
        )}
      </View>
    </SafeAreaView>
  );
}
