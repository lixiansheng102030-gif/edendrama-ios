import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  Pressable,
  ActivityIndicator,
  Dimensions,
  StyleSheet,
  TouchableWithoutFeedback,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  PanResponder,
  Share,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Video, ResizeMode } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dramaApi, commentApi, likeApi, favoriteApi, mediaUrl } from '../api';
import { useI18n, getCurrentLang } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';

const SCREEN = Dimensions.get('window');
const PAGE_SIZE = 10;
const LIKE_RED = '#fe2c55';
const FAV_GOLD = '#FFC107';

// 网页端视频页的真实图标（由 web 的 SVG 路径光栅化为白色 PNG、透明底），
// 用 tintColor 上色，形状与网页端 100% 一致。
const ICONS = {
  like: require('../../assets/icons/ic_like.png'),
  comment: require('../../assets/icons/ic_comment.png'),
  favorite: require('../../assets/icons/ic_favorite.png'),
  share: require('../../assets/icons/ic_share.png'),
  search: require('../../assets/icons/ic_search.png'),
};

type FeedItemData = {
  id: string;
  title?: string;
  hook?: string;
  cover?: string | null;
  trailer?: string | null;
  totalEpisodes?: number | null;
  likeCount?: number;
  favoriteCount?: number;
  commentCount?: number;
  serialStatus?: string; // upcoming 预约中 | ongoing 连载中 | finished 已完结
  tags?: { id?: string; name?: string }[];
};

const fmtCount = (n?: number) => {
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

// 星级文本（半星按实心显示）——与网页端 / 播放页一致
function starGlyphs(stars: number): string {
  let out = '';
  for (let i = 0; i < 5; i++) out += stars >= i + 0.5 ? '★' : '☆';
  return out;
}

// 归一化评论星值（后端 stars 优先，其次 rating 半星单位）
function commentStars(c: any): number {
  if (!c) return 0;
  if (typeof c.stars === 'number' && c.stars > 0) return c.stars;
  if (typeof c.rating === 'number' && c.rating > 0) return c.rating / 2;
  return 0;
}

// 日期格式化为 MM-DD
function formatDate(value?: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

// 评论 / 分享 / 搜索 / 点赞 / 收藏 图标均改用网页端 SVG 光栅化的 PNG（见 ICONS）。
// 播放图标（圆形 + 三角，白底）— 选集行用
function PlayCircleIcon({ size = 20, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 0, height: 0, borderLeftWidth: size * 0.3, borderTopWidth: size * 0.2, borderBottomWidth: size * 0.2, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: color, marginLeft: 2 }} />
    </View>
  );
}

// 全屏放大图标：对角括号（左上 border-top+border-left、右下 border-bottom+border-right）。
// 纯 View 边框绘制、不依赖手机字体（不同机型字符渲染不一致），与播放页 FullscreenGlyph 同款。
function FullscreenGlyph({ size = 16, color = '#ffffff', thickness = 1.8 }: { size?: number; color?: string; thickness?: number }) {
  const arm = size * 0.5;
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: arm,
          height: arm,
          borderTopWidth: thickness,
          borderLeftWidth: thickness,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: arm,
          height: arm,
          borderBottomWidth: thickness,
          borderRightWidth: thickness,
          borderColor: color,
        }}
      />
    </View>
  );
}

/**
 * 竖屏短视频首页（抖音 / 哔哩哔哩 / 红果式）：
 *  - 一部剧占满一屏，上下滑动切到下一部剧；每屏循环播放该剧「第 1 集」。
 *  - 【从右向左滑】进入该剧播放页；单击视频 = 暂停/播放（不进详情），进详情走「观看完整剧集」行。
 *  - 视频 COVER 铺满去黑边；底部用柔和渐变而非不透明黑条。
 *  - 右侧：点赞/评论/收藏/分享（白图标，点赞·收藏点击变红/金，评论·收藏下显真实数量）；左下：名称/标签(可点→筛选)/简介(可展开)/选集行；右上：搜索。
 *  - 底部进度条可左右拖动快进/快退。
 */
export default function FeedScreen({ navigation }: any) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<FeedItemData[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageH, setPageH] = useState(SCREEN.height);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [ep1Map, setEp1Map] = useState<Record<string, string>>({});
  const itemsRef = useRef<FeedItemData[]>([]);
  itemsRef.current = items;
  const loadingRef = useRef(false);
  // 请求序号：一旦将来加下拉刷新 / 切 tab 重查 / 并发 load(1)，旧响应不会覆盖新列表（QA F5 加固）
  const loadSeqRef = useRef(0);
  const flatListRef = useRef<any>(null);
  const currentIndexRef = useRef(0);
  const hasMore = items.length < total;

  // 首页评论：点评论按钮 → 半屏上拉评论面板（视频同时缩到上半屏）
  const [commentDramaId, setCommentDramaId] = useState<string | null>(null);

  // 首/尾边界提示：第一部再上翻 → 已到顶；最后一部再下滑（且没有更多）→ 没有更多了
  const [feedToast, setFeedToast] = useState('');
  const feedToastTimerRef = useRef<any>(null);
  // 切 tab / 卸载后不再接受异步回调里的 setState，也不再跑遗留定时器
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      loadSeqRef.current += 1;
      if (feedToastTimerRef.current) {
        clearTimeout(feedToastTimerRef.current);
        feedToastTimerRef.current = null;
      }
    };
  }, []);
  const showFeedToast = (msg: string) => {
    if (!aliveRef.current) return;
    setFeedToast(msg);
    if (feedToastTimerRef.current) clearTimeout(feedToastTimerRef.current);
    feedToastTimerRef.current = setTimeout(() => {
      feedToastTimerRef.current = null;
      if (aliveRef.current) setFeedToast('');
    }, 1600);
  };

  // PanResponder 只创建一次，闭包会锁住首帧的值 —— 用 ref 把最新状态喂给手势回调
  const hasMoreRef = useRef(false);
  hasMoreRef.current = hasMore;
  const showFeedToastRef = useRef(showFeedToast);
  showFeedToastRef.current = showFeedToast;
  const tRef = useRef(t);
  tRef.current = t;

  // 首/尾边界提示：
  // 纵向手势会被 ScrollView 抢走 —— 卡片的 onTouchMove、外层父容器的 onTouchMove 实测都收不到，
  // 只有 touchStart 能收到。但 ScrollView 自己的拖拽事件一定会触发：
  // 一次拖拽结束后如果内容偏移几乎没变，说明用户已经在顶部继续往下拉 / 在底部继续往上滑。
  const dragStartYRef = useRef(0);
  const dragMovedRef = useRef(false);
  const onListScrollBeginDrag = (e: any) => {
    dragStartYRef.current = e?.nativeEvent?.contentOffset?.y ?? 0;
    dragMovedRef.current = false;
  };
  const onListScroll = (e: any) => {
    const y = e?.nativeEvent?.contentOffset?.y ?? 0;
    if (Math.abs(y - dragStartYRef.current) > 4) dragMovedRef.current = true;
  };
  const onListScrollEndDrag = (e: any) => {
    const ne = e?.nativeEvent || {};
    const y = ne.contentOffset?.y ?? 0;
    const maxY = Math.max(0, (ne.contentSize?.height ?? 0) - (ne.layoutMeasurement?.height ?? 0));
    if (dragMovedRef.current) return;
    if (y <= 2 && currentIndexRef.current <= 0) {
      showFeedToast(tRef.current('watch.alreadyTop') || '已经到顶了');
    } else if (
      maxY > 0 &&
      y >= maxY - 2 &&
      !hasMoreRef.current &&
      currentIndexRef.current >= itemsRef.current.length - 1
    ) {
      showFeedToast(tRef.current('home.noMore') || '没有更多了');
    }
  };

  const load = useCallback(async (p: number) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const seq = ++loadSeqRef.current;
    try {
      const r: any = await dramaApi.list({ page: p, pageSize: PAGE_SIZE });
      if (!aliveRef.current || seq !== loadSeqRef.current) return;
      const list: FeedItemData[] = Array.isArray(r) ? r : r?.list || [];
      const tt = typeof r?.total === 'number' ? r.total : list.length;
      setItems((prev) => (p === 1 ? list : [...prev, ...list]));
      setTotal(tt);
      setPage(p);
    } catch {
      if (!aliveRef.current || seq !== loadSeqRef.current) return;
      if (p === 1) setItems([]);
    } finally {
      loadingRef.current = false;
      // 只有最后一次请求才复位 loading 态；旧请求被作废时不覆盖新请求的加载指示
      if (aliveRef.current && seq === loadSeqRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    load(1);
  }, [load]);

  // 拉取第 1 集视频地址（懒加载，仅 active 屏）
  const loadEp1 = useCallback((id: string) => {
    if (ep1Map[id]) return;
    dramaApi
      .detail(id)
      .then((d: any) => {
        if (!aliveRef.current) return;
        const eps: any[] = d?.episodes || [];
        const ep1 = eps[0];
        // 优先用预告片作为首页预览（无预告再退回第一集）
        const preview = d.trailer || ep1?.videoUrl;
        if (preview) setEp1Map((m) => ({ ...m, [id]: mediaUrl(preview) }));
      })
      .catch(() => {});
  }, [ep1Map]);

  // ⑦ 从播放页「右滑回首页」带回来的续播信息：这部剧要用哪一集、从哪个位置接着播
  const [resume, setResume] = useState<{
    dramaId: string;
    episodeId: string;
    episodeNo: number;
    videoUrl: string;
    position: number;
  } | null>(null);
  const resumeAppliedRef = useRef(false);

  // ⑦ 进入首页时读一次续播信息，读过即删（避免下次进首页又被拉回同一部）
  useEffect(() => {
    AsyncStorage.getItem('feed_resume')
      .then((s: any) => {
        if (!s) return;
        if (aliveRef.current) {
          try {
            const r = JSON.parse(s);
            if (r && r.dramaId && r.videoUrl) setResume(r);
          } catch {}
        }
        AsyncStorage.removeItem('feed_resume').catch(() => {});
      })
      .catch(() => {});
  }, []);

  // ⑥ 预加载后面几张卡的封面：滑到下一屏时封面已在本地缓存，减少"闪一下"的概率。
  //    只预载封面（Image.prefetch，几乎零成本），不额外挂载播放器（多挂播放器会内存暴涨被杀）。
  useEffect(() => {
    const next = items.slice(activeIndex + 1, activeIndex + 4);
    next.forEach((it: any) => {
      const uri = mediaUrl(it.cover);
      if (uri) Image.prefetch(uri).catch(() => {});
    });
  }, [activeIndex, items]);

  // ⑦ 有续播信息时，滚到那一部并对准它（items 和 pageH 到位后执行一次）
  useEffect(() => {
    if (!resume || resumeAppliedRef.current || items.length === 0 || pageH <= 0) return;
    const idx = items.findIndex((it: any) => String(it.id) === String(resume.dramaId));
    if (idx < 0) return;
    resumeAppliedRef.current = true;
    currentIndexRef.current = idx;
    setActiveIndex(idx);
    flatListRef.current?.scrollToOffset({ offset: idx * pageH, animated: false });
  }, [resume, items, pageH]);

  useEffect(() => {
    const it = items[activeIndex];
    if (it) loadEp1(it.id);
  }, [activeIndex, items, loadEp1]);

  const loadMore = () => {
    if (!hasMore || loadingRef.current || loading) return;
    setLoadingMore(true);
    load(page + 1);
  };

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems && viewableItems.length > 0 && viewableItems[0].index != null) {
      setActiveIndex(viewableItems[0].index);
    }
  }).current;

  const goPlayer = (id: string) => navigation.navigate('Player', { dramaId: id, skipTrailer: true });
  const goDetail = (id: string) => navigation.navigate('DramaDetail', { id });
  const openSearch = () => navigation.navigate('Search');
  const onShare = (title: string) => {
    try {
      Share.share({ message: title || '' });
    } catch {}
  };

  // 横滑手势：从右往左滑 → 进入该剧第 1 集播放页；
  // 纵向在「第一部继续下拉 / 最后一部且无更多时继续上滑」这两个边界上也接管，
  // 用来弹「已经到顶了 / 没有更多了」。
  // （试过给 FlatList 挂 onTouchStart/onTouchEnd，ScrollView 会吞掉这两个事件，实测不触发，
  //   所以统一走 PanResponder —— 它和左滑进播放页用的是同一套，已验证可用。）
  // ① 横滑进播放页改为「跟手划入」：拖动时首页整屏跟着手指左右移动（和上下翻页一样的跟手感），
  //    松手达阈值才继续把整屏推出屏幕并跳播放页，未达阈值则弹回原位。
  const dragX = useRef(new Animated.Value(0)).current;
  const horizRef = useRef(false);
  const panRef = useRef<any>(null);
  if (!panRef.current) {
    panRef.current = PanResponder.create({
      onMoveShouldSetPanResponder: (_e: any, g: any) => {
        if (Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 20) {
          horizRef.current = true;
          return true;
        }
        horizRef.current = false;
        const idx = currentIndexRef.current;
        const len = itemsRef.current.length;
        if (g.dy > 30 && idx <= 0) return true; // 第一部继续往下拉
        if (g.dy < -30 && !hasMoreRef.current && idx >= len - 1) return true; // 最后一部继续往上滑
        return false;
      },
      // 拖动中实时跟随手指：只跟随向左拖（从右往左滑 = 把播放页拉进来）
      onPanResponderMove: (_e: any, g: any) => {
        if (!horizRef.current) return;
        dragX.setValue(g.dx < 0 ? g.dx : 0);
      },
      onPanResponderRelease: (_e: any, g: any) => {
        if (Math.abs(g.dx) > Math.abs(g.dy)) {
          if (g.dx < -60) {
            // 达阈值：衔接动画——把首页继续推到屏幕外，再跳播放页
            Animated.timing(dragX, { toValue: -SCREEN.width, duration: 170, useNativeDriver: true }).start(() => {
              // 动画期间若已切 tab / 卸载，不再跳播放页
              if (!aliveRef.current) return;
              const it = itemsRef.current[currentIndexRef.current];
              if (it) goPlayer(String(it.id));
              // 跳走后复位：此时首页已被播放页盖住，复位不可见，回来时首页在原位
              dragX.setValue(0);
            });
          } else {
            // 未达阈值：弹回原位
            Animated.spring(dragX, { toValue: 0, useNativeDriver: true }).start();
          }
          return;
        }
        if (g.dy > 40 && currentIndexRef.current <= 0) {
          showFeedToastRef.current(tRef.current('watch.alreadyTop') || '已经到顶了');
        } else if (
          g.dy < -40 &&
          !hasMoreRef.current &&
          currentIndexRef.current >= itemsRef.current.length - 1
        ) {
          showFeedToastRef.current(tRef.current('home.noMore') || '没有更多了');
        }
      },
      onPanResponderTerminationRequest: () => false,
    });
  }

  if (loading && items.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: '#000' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (items.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: '#000' }]}>
        <Text style={{ color: '#fff', fontSize: 15 }}>{t('home.noResults')}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: '#000', paddingTop: insets.top }]}>
      <Animated.View style={{ flex: 1, transform: [{ translateX: dragX }] }} {...panRef.current.panHandlers} onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h > 0 && Math.abs(h - pageH) > 1) setPageH(h); }}>
        <FlatList
          ref={flatListRef}
          style={{ flex: 1 }}
          data={items}
          keyExtractor={(it) => String(it.id)}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={false}
          decelerationRate="fast"
          // 滑动性能优化：固定行高 + 适度渲染窗口 + 小批量挂载
          getItemLayout={(_: any, index: number) => ({ length: pageH, offset: pageH * index, index })}
          windowSize={5}
          maxToRenderPerBatch={3}
          updateCellsBatchingPeriod={50}
          // 原生分页吸附：一次手势只翻一页且直接停在整页位置，
          // 避免「惯性滑到一半停住 → 再补一次动画滚动」的顿挫
          snapToInterval={pageH}
          snapToAlignment="start"
          disableIntervalMomentum
          onScrollBeginDrag={onListScrollBeginDrag}
          onScroll={onListScroll}
          onScrollEndDrag={onListScrollEndDrag}
          scrollEventThrottle={16}
          onMomentumScrollEnd={(e: any) => {
            const y = e.nativeEvent.contentOffset.y;
            // 单次手势最多翻一页：防止快速滑动时惯性连跳多页
            const maxIdx = Math.min(items.length - 1, currentIndexRef.current + 1);
            const minIdx = Math.max(0, currentIndexRef.current - 1);
            const idx = Math.max(minIdx, Math.min(maxIdx, Math.round(y / pageH)));
            currentIndexRef.current = idx;
            setActiveIndex(idx);
            // 原生吸附已对齐，仅在严重偏离时兜底（正常不触发，避免二次动画造成停顿）
            const target = idx * pageH;
            if (Math.abs(y - target) > pageH * 0.5) flatListRef.current?.scrollToOffset({ offset: target, animated: false });
          }}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        ListFooterComponent={hasMore ? (<View style={{ height: 60, alignItems: 'center', justifyContent: 'center' }}>{loadingMore ? <ActivityIndicator size="small" color="#fff" /> : null}</View>) : null}
        renderItem={({ item, index }) => (
          <MemoFeedCard
            drama={item}
            ep1Uri={resume && String(resume.dramaId) === String(item.id) ? resume.videoUrl : (item.trailer ? mediaUrl(item.trailer) : ep1Map[item.id])}
            resumePos={resume && String(resume.dramaId) === String(item.id) ? resume.position : 0}
            height={pageH}
            isActive={index === activeIndex}
            muted={muted}
            onPress={() => goPlayer(String(item.id))}
            onOpenSearch={openSearch}
            onOpenDetail={goDetail}
            commentOpen={commentDramaId === String(item.id)}
            onOpenComments={() => setCommentDramaId(String(item.id))}
            onShare={() => onShare(String(item.title || ''))}
            onTagPress={(tagId: string, tagName: string) =>
              navigation.navigate('Search', { tagIds: tagId, tagName })
            }
          />
        )}
      />
      </Animated.View>
      {feedToast ? (
        <View style={styles.feedToastWrap} pointerEvents="none">
          <View style={styles.feedToastBubble}>
            <Text style={styles.feedToastText}>{feedToast}</Text>
          </View>
        </View>
      ) : null}
      {commentDramaId ? (
        <FeedCommentSheet
          dramaId={commentDramaId}
          onClose={() => setCommentDramaId(null)}
        />
      ) : null}
    </View>
  );
}

function FeedCard({
  drama,
  ep1Uri,
  resumePos,
  height,
  isActive,
  muted,
  onPress,
  onOpenSearch,
  onOpenDetail,
  onShare,
  onTagPress,
  commentOpen,
  onOpenComments,
}: {
  drama: FeedItemData;
  ep1Uri?: string;
  resumePos?: number;
  height: number;
  isActive: boolean;
  muted: boolean;
  onPress: () => void;
  onOpenSearch: () => void;
  onOpenDetail: (id?: any) => void;
  onShare: () => void;
  onTagPress?: (tagId: string, tagName: string) => void;
  commentOpen?: boolean;
  onOpenComments?: () => void;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const cardInsets = useSafeAreaInsets();
  // 评论面板打开时，视频只占上半屏（面板从底部上拉占下半屏）
  const contentH = commentOpen ? Math.max(120, SCREEN.height / 2 - cardInsets.top) : height;
  const coverUri = mediaUrl(drama.cover);
  // 关键修复：只给「当前正在观看的卡」挂载 expo-av Video。
  // 之前 useVideo = !!ep1Uri，滑动后 ep1Map 缓存了大量 URL，windowSize 内多张卡同时挂 Video，
  // 多个 ExoPlayer 实例常驻缓冲不释放，内存随滑动一路涨到 ~890MB 被系统杀掉（滑动一会就闪退）。
  // 现在非 active 的卡只渲染封面 Image（已缓存、几乎零成本），任意时刻最多 1 个播放器，内存稳定在 ~400MB。
  const useVideo = !!ep1Uri && isActive;

  const [liked, setLiked] = useState(false);
  const [favd, setFavd] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [introTruncated, setIntroTruncated] = useState(false);
  const [paused, setPaused] = useState(false);
  const [videoLandscape, setVideoLandscape] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [barW, setBarW] = useState(0);
  const [commentCount, setCommentCount] = useState<number>(drama.commentCount || 0);
  const [likeCount, setLikeCount] = useState<number>(drama.likeCount || 0);
  const [favCount, setFavCount] = useState<number>(drama.favoriteCount || 0);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const videoRef = useRef<any>(null);

  // ⑥ 视频淡入：首帧就绪（onReadyForDisplay）后才把视频显示出来。
  //    切换 / 挂载播放器时先用封面顶着，避免露出黑底形成"闪屏"。
  const videoReadyAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    videoReadyAnim.setValue(0);
  }, [useVideo]);

  // ⑤ 双击点赞的爱心动效
  const likeBurst = useRef(new Animated.Value(0)).current;
  const showLikeBurst = () => {
    likeBurst.setValue(0);
    Animated.sequence([
      Animated.timing(likeBurst, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(likeBurst, { toValue: 0, duration: 450, useNativeDriver: true }),
    ]).start();
  };

  // ⑤ 单击 = 暂停 / 播放；双击（300ms 内两次）= 点赞。
  //    单击延后 300ms 执行，期间若来了第二次点击就判定为双击并取消单击（避免双击时先闪一下暂停）。
  const lastTapRef = useRef(0);
  const tapTimerRef = useRef<any>(null);
  // 切 tab / 卡片被 FlatList 回收后：清掉单击延时定时器、停掉动画，并不再对已卸载卡片 setState
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }
      likeBurst.stopAnimation();
      videoReadyAnim.stopAnimation();
      progressAnim.stopAnimation();
    };
  }, []);
  const onVideoTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }
      lastTapRef.current = 0;
      // ④ 双击切换点赞：已赞则取消、未赞则点赞
      onLikePress();
      showLikeBurst();
      return;
    }
    lastTapRef.current = now;
    tapTimerRef.current = setTimeout(() => {
      tapTimerRef.current = null;
      if (!aliveRef.current) return;
      setPaused((p) => !p);
    }, 300);
  };

  // ⑦ 续播：视频就绪后跳到播放页带回来的进度位置（每换一次片源只跳一次）
  const resumedRef = useRef(false);
  useEffect(() => {
    resumedRef.current = false;
  }, [ep1Uri]);
  useEffect(() => {
    if (!isActive || !resumePos || resumePos <= 0 || resumedRef.current || !durationMs) return;
    resumedRef.current = true;
    videoRef.current?.setPositionAsync(resumePos).catch(() => {});
  }, [isActive, resumePos, durationMs]);
  const tags: { id?: string; name?: string }[] = Array.isArray(drama.tags)
    ? (drama.tags.filter((x: any) => x?.name).map((x: any) => ({ id: x.id, name: x.name })) as any)
    : [];

  // 播出状态文案：预约中 / 连载中 / 已完结
  const serialText =
    drama.serialStatus === 'upcoming' ? (t('feed.serialUpcoming') || '预约中')
    : drama.serialStatus === 'ongoing' ? (t('feed.serialOngoing') || '连载中')
    : drama.serialStatus === 'finished' ? (t('feed.serialFinished') || '已完结')
    : '';

  // 评论数：列表未带 commentCount 时，仅当本卡 active 时拉一次（避免一屏多卡狂发请求）
  useEffect(() => {
    if (isActive && !drama.commentCount) {
      commentApi
        .summary(String(drama.id))
        .then((s: any) => {
          if (!aliveRef.current) return;
          const c = Number(s?.commentCount) || 0;
          if (c > 0) setCommentCount(c);
        })
        .catch(() => {});
    }
  }, [isActive, drama.id]);

  // 点赞 / 收藏：本卡 active 时同步一次我在后台的真实状态（跨设备一致）
  useEffect(() => {
    if (!isActive) return;
    likeApi
      .checkDrama(String(drama.id))
      .then((r: any) => { if (aliveRef.current && r && typeof r.liked === 'boolean') setLiked(r.liked); })
      .catch(() => {});
    favoriteApi
      .check(String(drama.id))
      .then((r: any) => { if (aliveRef.current && r && typeof r.favorited === 'boolean') setFavd(r.favorited); })
      .catch(() => {});
  }, [isActive, drama.id]);

  // 滑到别的卡时取消暂停，保证当前卡自动播放
  useEffect(() => {
    if (!isActive) setPaused(false);
  }, [isActive]);

  // 点赞：乐观更新 + 服务端同步（失败时保留乐观值，下次 active 会重新校准）
  const onLikePress = () => {
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => Math.max(0, c + (next ? 1 : -1)));
    likeApi
      .toggleDrama(String(drama.id))
      .then((r: any) => {
        if (!aliveRef.current) return;
        if (r && typeof r.liked === 'boolean') setLiked(r.liked);
        if (r && typeof r.likeCount === 'number') setLikeCount(r.likeCount);
      })
      .catch(() => {});
  };

  // 收藏：同上（后端 toggle 返回 { favorited, favoriteCount }）
  const onFavPress = () => {
    const next = !favd;
    setFavd(next);
    setFavCount((c) => Math.max(0, c + (next ? 1 : -1)));
    favoriteApi
      .toggle(String(drama.id))
      .then((r: any) => {
        if (!aliveRef.current) return;
        if (r && typeof r.favorited === 'boolean') setFavd(r.favorited);
        if (r && typeof r.favoriteCount === 'number') setFavCount(r.favoriteCount);
      })
      .catch(() => {});
  };

  const seekTo = (frac: number) => {
    const f = Math.max(0, Math.min(1, frac));
    progressAnim.setValue(f);
    // expo-av 没有 seekAsync，进度跳转用 setPositionAsync
    if (durationMs > 0 && videoRef.current) videoRef.current.setPositionAsync(f * durationMs).catch(() => {});
  };
  const onTrackTouch = (e: any) => {
    const x = e.nativeEvent.locationX;
    if (barW > 0) seekTo(x / barW);
  };

  return (
    <View style={{ height, width: '100%', backgroundColor: '#000' }}>
      {/* 内容区：默认整卡（铺满一屏）；评论面板打开时缩到上半屏，下半屏让给评论 */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: contentH }}>
      {/* 视频铺满整卡（延伸到观看栏 / 进度条后面，底部栏透明） */}
      <View style={StyleSheet.absoluteFill}>
        {/* 单击视频 = 暂停 / 播放 */}
        <TouchableWithoutFeedback onPress={onVideoTap}>
          <View style={StyleSheet.absoluteFill}>
            {/* ⑥ 封面常驻垫底：播放器挂载 / 切换 / 起播前不再露出黑底，消除上下滑动的闪屏 */}
            {coverUri ? (
              <Image source={{ uri: coverUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : null}
            {useVideo ? (
              <View style={[StyleSheet.absoluteFill, videoLandscape && { backgroundColor: '#000', paddingBottom: 160 }]}>
                {/* ⑥ 首帧就绪（onReadyForDisplay）后才淡入，避免起播瞬间闪一下黑 */}
                <Animated.View style={[StyleSheet.absoluteFill, { opacity: videoReadyAnim }]}>
                <Video
                  ref={videoRef}
                  source={{ uri: ep1Uri! }}
                  style={StyleSheet.absoluteFill}
                  resizeMode={videoLandscape ? ResizeMode.CONTAIN : ResizeMode.COVER}
                  shouldPlay={isActive && !paused}
                  isLooping
                  isMuted={muted}
                  useNativeControls={false}
                  onPlaybackStatusUpdate={(s: any) => {
                    if (!aliveRef.current) return;
                    if (s && s.durationMillis) setDurationMs(s.durationMillis);
                    // 依据视频原始尺寸判断横/竖屏：横屏改用 CONTAIN（不裁剪、四周黑边）并上移，竖屏仍 COVER 铺满
                    const nat = s && s.naturalSize;
                    if (nat && nat.width && nat.height) setVideoLandscape(nat.width > nat.height);
                    if (!seeking && s && s.durationMillis) {
                      progressAnim.setValue(Math.max(0, Math.min(1, (s.positionMillis || 0) / s.durationMillis)));
                    }
                  }}
                  // 🚨 naturalSize 只在 onLoad / onReadyForDisplay 的 nativeEvent 里可靠提供，
                  // onPlaybackStatusUpdate 周期回调里没有 → 必须在这两个回调里判横竖屏
                  onLoad={(s: any) => {
                    if (!aliveRef.current) return;
                    const nat = s && s.naturalSize;
                    if (nat && nat.width && nat.height) setVideoLandscape(nat.width > nat.height);
                  }}
                  onReadyForDisplay={(e: any) => {
                    if (!aliveRef.current) return;
                    const nat = e && e.naturalSize;
                    if (nat && nat.width && nat.height) setVideoLandscape(nat.width > nat.height);
                    // ⑥ 首帧就绪 → 淡入显示（此时下层封面已被视频盖住，不再有黑闪）
                    Animated.timing(videoReadyAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
                  }}
                />
                </Animated.View>
                {/* 暂停时视频中央的播放按钮 = 网页端按钮原样导出的 PNG，不再用字符 ▶ 硬画。
                    来源：web/app/watch/[id]/page.tsx:1250-1259
                      className="w-16 h-16 rounded-full bg-black/50 text-white text-3xl flex items-center justify-center"
                      内容就是字符 ▶
                    导出方式：Chromium 以 deviceScaleFactor=3 渲染同一份样式，omitBackground 截图，
                      得到 192×192 透明 PNG（= 64dp），字形实测 63×71、中心 (95,100)，与网页端截图逐像素一致。
                    好处：不依赖手机字体（各机型字体不同会把 ▶ 画成 52×51 等不同大小）。
                    注意：50% 黑底已烘进 PNG 的 alpha，不要再叠一层 View 底色。 */}
                {paused ? (
                  <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
                    <Image
                      source={require('../../assets/icons/ic_pause_overlay.png')}
                      style={{ width: 64, height: 64 }}
                      resizeMode="contain"
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
            {/* ⑤ 双击点赞：中央爱心放大后淡出 */}
            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                {
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: likeBurst,
                  transform: [
                    { scale: likeBurst.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.3] }) },
                  ],
                },
              ]}
            >
              <Image source={ICONS.like} style={{ width: 100, height: 100, tintColor: LIKE_RED }} />
            </Animated.View>
          </View>
        </TouchableWithoutFeedback>

        {/* 底部不再叠加任何半透明黑渐变——文字区完全透明（2026-10-20 用户要求去掉浅黑框） */}

        {/* 右上角：搜索图标 */}
        <Pressable onPress={onOpenSearch} hitSlop={12} style={{ position: 'absolute', top: 10, right: 14, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <Image source={ICONS.search} style={{ width: 24, height: 24, tintColor: '#fff' }} />
        </Pressable>

        {/* 右侧操作列：点赞/评论/收藏/分享 —— 与左侧简介底部对齐（抬起 64px 避让底部观看栏） */}
        <View style={{ position: 'absolute', right: 8, bottom: 72, alignItems: 'center' }}>
          <Pressable onPress={onLikePress} hitSlop={8} style={{ alignItems: 'center', marginBottom: 24 }}>
            <Image source={ICONS.like} style={{ width: 34, height: 34, tintColor: liked ? LIKE_RED : '#fff' }} />
            <Text style={{ color: '#fff', fontSize: 11, marginTop: 2 }}>{fmtCount(likeCount) || '0'}</Text>
          </Pressable>
          {/* 评论：打开半屏上拉评论面板（不再跳详情页） */}
          <Pressable onPress={() => onOpenComments && onOpenComments()} hitSlop={8} style={{ alignItems: 'center', marginBottom: 24 }}>
            <Image source={ICONS.comment} style={{ width: 32, height: 32, tintColor: commentOpen ? colors.primary : '#fff' }} />
            <Text style={{ color: '#fff', fontSize: 11, marginTop: 2 }}>{fmtCount(commentCount) || '0'}</Text>
          </Pressable>
          <Pressable onPress={onFavPress} hitSlop={8} style={{ alignItems: 'center', marginBottom: 24 }}>
            <Image source={ICONS.favorite} style={{ width: 34, height: 34, tintColor: favd ? FAV_GOLD : '#fff' }} />
            <Text style={{ color: '#fff', fontSize: 11, marginTop: 2 }}>{fmtCount(favCount) || '0'}</Text>
          </Pressable>
          <Pressable onPress={onShare} hitSlop={8} style={{ alignItems: 'center' }}>
            <Image source={ICONS.share} style={{ width: 34, height: 34, tintColor: '#fff' }} />
          </Pressable>
        </View>

        {/* 左下内容：名称 / 标签(可点筛选) / 简介(可展开)——抬起避让透明观看栏 */}
        <View style={{ position: 'absolute', left: 14, right: 92, bottom: 80 }}>
          <Text style={{ color: '#fff', fontSize: 17, fontWeight: 'bold' }} numberOfLines={1}>
            {drama.title || ''}
          </Text>
          {tags.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 5 }}>
              {tags.map((tag) => (
                <Pressable
                  key={tag.id || tag.name}
                  onPress={() => onTagPress && tag.id && onTagPress(String(tag.id), String(tag.name))}
                  hitSlop={6}
                  style={{ backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginRight: 6, marginBottom: 6 }}
                >
                  <Text style={{ color: '#fff', fontSize: 12 }}>{tag.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {drama.hook ? (
            <Pressable
              onPress={() => {
                if (introTruncated) setIntroOpen((v) => !v);
              }}
              style={{ marginTop: 6, flexDirection: 'row', alignItems: 'flex-start' }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={{ position: 'absolute', opacity: 0, fontSize: 13, lineHeight: 18, width: '100%' }}
                  onTextLayout={(e: any) => setIntroTruncated(((e.nativeEvent.lines as any[]) || []).length > 1)}
                >
                  {drama.hook}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.88)', fontSize: 13, lineHeight: 18 }} numberOfLines={introOpen ? undefined : 1}>
                  {drama.hook}
                </Text>
              </View>
              {introTruncated && (
                <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, marginLeft: 4 }}>
                  {introOpen ? t('feed.collapse') : t('feed.expand')}
                </Text>
              )}
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* 底部透明栏（视频延伸到其后，去掉黑边）：观看完整剧集行 + 播出状态 + 可拖动进度条 */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        {/* ① 观看完整剧集：改为直接跳播放页（原来进剧集详情页） */}
        <Pressable onPress={onPress} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11 }}>
          <PlayCircleIcon size={15} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', marginLeft: 7 }}>{t('feed.watchFull') || '观看完整剧集'}</Text>
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#fff', marginHorizontal: 7 }} />
          {serialText ? (
            <>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>{serialText}</Text>
              <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#fff', marginHorizontal: 7 }} />
            </>
          ) : null}
          <Text style={{ color: '#fff', fontSize: 13 }}>{t('watch.totalEpisodes', { n: drama.totalEpisodes || 0 })}</Text>
          <View style={{ flex: 1 }} />
          <FullscreenGlyph size={18} color="#ffffff" thickness={2} />
        </Pressable>
        {useVideo ? (
          <View
            style={{ height: 20, justifyContent: 'center' }}
            onLayout={(e: any) => setBarW(e.nativeEvent.layout.width)}
            // 用 Responder 接管拖动，拒绝被外层横滑手势（进播放页）抢占
            onStartShouldSetResponder={() => true}
            onResponderTerminationRequest={() => false}
            onResponderGrant={(e: any) => {
              setSeeking(true);
              onTrackTouch(e);
            }}
            onResponderMove={onTrackTouch}
            onResponderRelease={() => setSeeking(false)}
          >
            <View style={{ height: 4, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 2 }}>
              <Animated.View style={{ height: 4, backgroundColor: colors.primary, width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
            </View>
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 3,
                width: 14,
                height: 14,
                borderRadius: 7,
                backgroundColor: '#fff',
                transform: [{ translateX: progressAnim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(0, barW - 14)] }) }],
              }}
            />
          </View>
        ) : (
          <View style={{ height: 2, backgroundColor: 'rgba(255,255,255,0.18)' }}>
            <Animated.View style={{ height: 2, backgroundColor: colors.primary, width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
          </View>
        )}
      </View>
      </View>
    </View>
  );
}

/**
 * 首页半屏评论面板：点评论按钮从屏幕底部自然上拉，占下半屏（视频同时缩到上半屏）。
 * 界面与功能对齐网页端：头像 + 昵称 + 星级 + 日期 + 内容 + 回复 + 点赞，底部「说点什么…」+ 发送。
 */
function FeedCommentSheet({ dramaId, onClose }: { dramaId: string; onClose: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const SHEET_H = Math.round(SCREEN.height / 2);
  const slide = useRef(new Animated.Value(SHEET_H)).current;
  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyPosting, setReplyPosting] = useState(false);
  // 评论面板关闭 / 切 tab 后不再接受异步回调里的 setState
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  // 上拉入场；卸载时停掉入场动画，避免动画回调继续跑
  useEffect(() => {
    Animated.timing(slide, { toValue: 0, duration: 260, useNativeDriver: true }).start();
    return () => { slide.stopAnimation(); };
  }, [slide]);

  const load = useCallback(() => {
    setLoading(true);
    commentApi
      .list({ dramaId, pageSize: 50 })
      .then((res: any) => {
        if (!aliveRef.current) return;
        setList(Array.isArray(res?.list) ? res.list : []);
        setTotal(Number(res?.total) || 0);
      })
      .catch(() => { if (aliveRef.current) setList([]); })
      .then(() => { if (aliveRef.current) setLoading(false); });
  }, [dramaId]);

  useEffect(() => {
    load();
  }, [load]);

  // 下拉退场（动画结束后再卸载）
  const close = useCallback(() => {
    Animated.timing(slide, { toValue: SHEET_H, duration: 200, useNativeDriver: true }).start(() => {
      if (aliveRef.current) onClose();
    });
  }, [slide, SHEET_H, onClose]);

  const requireLogin = async () => {
    const token = await AsyncStorage.getItem('user_token');
    if (!token) {
      Alert.alert(t('review.needLogin'));
      return false;
    }
    return true;
  };

  const submit = async () => {
    const content = text.trim();
    if (!content || posting) return;
    if (!(await requireLogin())) return;
    setPosting(true);
    try {
      await commentApi.create({ dramaId, content });
      if (!aliveRef.current) return;
      setText('');
      await load();
    } catch {}
    if (aliveRef.current) setPosting(false);
  };

  const submitReply = async (parent: any) => {
    const content = replyText.trim();
    if (!content || replyPosting) return;
    if (!(await requireLogin())) return;
    setReplyPosting(true);
    try {
      const created: any = await commentApi.reply(parent.id, content);
      if (!aliveRef.current) return;
      setList((prev) =>
        prev.map((c) => (c.id === parent.id ? { ...c, replies: [...(c.replies || []), created] } : c)),
      );
      setReplyingTo(null);
      setReplyText('');
    } catch {}
    if (aliveRef.current) setReplyPosting(false);
  };

  const toggleLike = async (c: any) => {
    if (!(await requireLogin())) return;
    const next = !c.likedByMe;
    const prevLiked = !!c.likedByMe;
    const prevCount = Number(c.likeCount) || 0;
    const patch = (o: any) => {
      if (!aliveRef.current) return;
      setList((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...o } : x)));
    };
    patch({ likedByMe: next, likeCount: Math.max(0, prevCount + (next ? 1 : -1)) });
    try {
      const res: any = await commentApi.like(c.id);
      patch({ likedByMe: !!res?.liked, likeCount: Number(res?.likeCount) || 0 });
    } catch {
      patch({ likedByMe: prevLiked, likeCount: prevCount });
    }
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={close}>
    <View style={StyleSheet.absoluteFill}>
      {/* 点击面板以外区域关闭 */}
      <TouchableWithoutFeedback onPress={close}>
        <View style={StyleSheet.absoluteFill} />
      </TouchableWithoutFeedback>
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: SHEET_H,
          transform: [{ translateY: slide }],
          backgroundColor: colors.surface,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: 'bold' }}>
            {(t('player.comments') || '评论') + (total > 0 ? ` ${total}` : '')}
          </Text>
          <TouchableOpacity onPress={close} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colors.muted, fontSize: 16 }}>✕</Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
          {loading && list.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 30 }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : list.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 30 }}>
              <Text style={{ color: colors.muted, fontSize: 14 }}>{t('player.noComments') || '暂无评论'}</Text>
            </View>
          ) : (
            list.map((c: any) => {
              const stars = commentStars(c);
              return (
                <View key={c.id} style={{ flexDirection: 'row', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                    <Text style={{ color: colors.muted, fontSize: 14 }}>{(c.user?.nickname || '?').slice(0, 1)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>
                        {c.user?.nickname || '—'}
                      </Text>
                      <Text style={{ color: colors.subtle, fontSize: 11, marginLeft: 8 }}>{formatDate(c.createdAt)}</Text>
                    </View>
                    {stars > 0 ? <Text style={{ color: colors.gold, fontSize: 12, marginTop: 2 }}>{starGlyphs(stars)}</Text> : null}
                    <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 6, lineHeight: 19 }}>{c.content}</Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 2 }}>
                      <TouchableOpacity
                        style={{ minHeight: 40, justifyContent: 'center' }}
                        onPress={() => {
                          setReplyingTo(replyingTo === c.id ? null : c.id);
                          setReplyText('');
                        }}
                      >
                        <Text style={{ color: colors.muted, fontSize: 12 }}>{t('review.reply') || '回复'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={{ minHeight: 40, justifyContent: 'center', marginLeft: 18 }} onPress={() => toggleLike(c)}>
                        <Text style={{ color: c.likedByMe ? '#ec4899' : colors.muted, fontSize: 12 }}>
                          {c.likedByMe ? '♥' : '♡'} {Number(c.likeCount) || 0}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {Array.isArray(c.replies) && c.replies.length > 0 ? (
                      <View style={{ marginTop: 6, paddingLeft: 10, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border }}>
                        {c.replies.map((r: any) => (
                          <Text key={r.id} style={{ color: colors.muted, fontSize: 12, lineHeight: 18, marginBottom: 4 }}>
                            <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>{r.user?.nickname || '—'}{' '}</Text>
                            {r.content}
                          </Text>
                        ))}
                      </View>
                    ) : null}

                    {replyingTo === c.id ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                        <TextInput
                          style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, color: colors.text, fontSize: 13, minHeight: 40 }}
                          value={replyText}
                          onChangeText={setReplyText}
                          placeholder={t('review.replyPlaceholder')}
                          placeholderTextColor={colors.subtle}
                        />
                        <TouchableOpacity
                          style={{ backgroundColor: colors.primary, borderRadius: 18, paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', marginLeft: 8, opacity: !replyText.trim() || replyPosting ? 0.5 : 1 }}
                          disabled={!replyText.trim() || replyPosting}
                          onPress={() => submitReply(c)}
                        >
                          <Text style={{ color: '#fff', fontSize: 13, fontWeight: 'bold' }}>{t('review.publish') || '发布'}</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>

        {/* 底部输入框：与网页端一致「说点什么…」+ 发送 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: insets.bottom + 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
          <TextInput
            style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 9, color: colors.text, fontSize: 14, minHeight: 42 }}
            value={text}
            onChangeText={setText}
            placeholder={t('player.commentPlaceholder') || '说点什么…'}
            placeholderTextColor={colors.subtle}
            maxLength={1000}
          />
          <TouchableOpacity
            style={{ backgroundColor: colors.primary, borderRadius: 20, paddingHorizontal: 18, minHeight: 42, justifyContent: 'center', marginLeft: 8, opacity: !text.trim() || posting ? 0.5 : 1 }}
            disabled={!text.trim() || posting}
            onPress={submit}
          >
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>{t('player.send') || '发送'}</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
    </Modal>
  );
}

// 滑动性能优化：卡片 memo，props 不变不重渲
const MemoFeedCard = React.memo(FeedCard);

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  feedToastWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  feedToastBubble: { backgroundColor: 'rgba(0,0,0,0.75)', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999 },
  feedToastText: { color: '#fff', fontSize: 13 },
});
