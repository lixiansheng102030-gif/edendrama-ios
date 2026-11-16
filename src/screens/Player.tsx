import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  View,
  Text,
  Image,
  Pressable,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
  StyleSheet,
  Dimensions,
  NativeModules,
  useWindowDimensions,
  FlatList,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Alert,
  AppState,
  PanResponder,
  Share,
  StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Video, ResizeMode } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dramaApi, paymentApi, likeApi, favoriteApi, commentApi, watchApi, taskApi, videoApi, mediaUrl } from '../api';
import { useI18n, getCurrentLang } from '../i18n/LanguageContext';
import { useTheme, ThemeColors } from '../theme/ThemeContext';
import { requireNativeModule } from 'expo';

const SCREEN = Dimensions.get('window');
// ② 真实横屏：原生方向控制模块（进入全屏锁横屏 / 退出恢复竖屏）。
// 安卓为等价 RN 原生模块（经 NativeModules 暴露）；iOS 为 Expo 本地模块（经 requireNativeModule 暴露）。
// 两种情况任一可用即可；缺失时下方用 ?. 调用，不会崩。
const OrientationModule: any =
  (NativeModules as any).OrientationModule ?? (() => {
    try { return requireNativeModule('OrientationModule'); } catch { return undefined; }
  })();
const LIKE_RED = '#fe2c55';
const FAV_GOLD = '#FFC107';

// ⑤ 清晰度选项：1080P = 原始片源（直接播放）；480P/720P = 后端按需 ffmpeg 转码
// （见 backend VideosService.getQualityUrl），返回的转码地址通过 videoApi.getQuality 拉取。
const QUALITY_OPTS = ['480P', '720P', '1080P'];
// ④/⑥ 全屏右侧抽屉宽度（评论 / 选集从右滑出，横屏 1600 坐标系）
const FS_DRAWER_W = 560;

// 右侧操作列图标：与首页 feed 完全同一套（网页端 SVG 光栅化的白色 PNG，tintColor 上色）
const ICONS = {
  like: require('../../assets/icons/ic_like.png'),
  comment: require('../../assets/icons/ic_comment.png'),
  favorite: require('../../assets/icons/ic_favorite.png'),
  share: require('../../assets/icons/ic_share.png'),
  // 暂停时画面中央的播放按钮：与首页 feed 同一张（网页端 ▶ 按钮光栅化的透明 PNG，50% 黑底已烘进 alpha）
  pauseOverlay: require('../../assets/icons/ic_pause_overlay.png'),
};

// 左上角返回箭头：两根 45° 细线拼成 90° 开口的「‹」。
// 用字体字符（右尖括号）各机型字形差异大、粗细/角度不可控，这里改用两个旋转 45° 的 View 精确画出。
function BackChevron({ size = 20, color = '#ffffff' }: { size?: number; color?: string }) {
  const len = size * 0.74;
  const th = Math.max(2, size * 0.13);
  const bar = (rot: string, top: number) => (
    <View
      style={{
        position: 'absolute',
        left: size * 0.05,
        top,
        width: len,
        height: th,
        borderRadius: th / 2,
        backgroundColor: color,
        transform: [{ rotate: rot }],
      }}
    />
  );
  return (
    <View style={{ width: size, height: size }}>
      {bar('-45deg', size * 0.28 - th / 2)}
      {bar('45deg', size * 0.72 - th / 2)}
    </View>
  );
}

// 暂停圆：半透明黑圆 + 正中白色三角。
// 之前用 PNG，三角形实测中心 (95,100) 略偏右下；改为 View 现画，按重心补偿 marginLeft 保证视觉居中。
function PauseCircle({ size = 64 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: 'rgba(0,0,0,0.5)',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <View
        style={{
          width: 0,
          height: 0,
          marginLeft: size * 0.05,
          borderTopWidth: size * 0.185,
          borderBottomWidth: size * 0.185,
          borderLeftWidth: size * 0.3,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderLeftColor: '#ffffff',
        }}
      />
    </View>
  );
}

// ③ 横屏「暂停时」中央显示的符号：不带外圈的实心三角形（▶，点它继续播放）
function PlainPause({ size = 56 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 0,
          height: 0,
          borderTopWidth: size * 0.42,
          borderBottomWidth: size * 0.42,
          borderLeftWidth: size * 0.62,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderLeftColor: 'rgba(255,255,255,0.92)',
        }}
      />
    </View>
  );
}

// ⑫ 全屏「下一集」符号：两个右向小三角 + 一根竖线（View 现画，避免字符字形差异）
function NextGlyph({ size = 15, color = '#ffffff' }: { size?: number; color?: string }) {
  const tri = (key: string, ml: number) => (
    <View
      key={key}
      style={{
        width: 0,
        height: 0,
        marginLeft: ml,
        borderTopWidth: size * 0.3,
        borderBottomWidth: size * 0.3,
        borderLeftWidth: size * 0.42,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        borderLeftColor: color,
      }}
    />
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {tri('a', 0)}
      <View style={{ width: 2, height: size * 0.62, backgroundColor: color, marginLeft: 3, borderRadius: 1 }} />
    </View>
  );
}

// 全屏进度行左侧的 播放/暂停 切换图标：
// 播放中 → 显示「暂停」双竖条（点击暂停）；已暂停 → 显示「播放」三角（点击继续）。
function PlayPauseGlyph({ playing, size = 16 }: { playing: boolean; size?: number }) {
  if (!playing) {
    // 暂停态 → 播放三角
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View
          style={{
            width: 0,
            height: 0,
            borderTopWidth: size * 0.42,
            borderBottomWidth: size * 0.42,
            borderLeftWidth: size * 0.62,
            borderTopColor: 'transparent',
            borderBottomColor: 'transparent',
            borderLeftColor: '#ffffff',
          }}
        />
      </View>
    );
  }
  // 播放态 → 暂停双竖条
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: size * 0.28, height: size * 0.84, backgroundColor: '#ffffff', marginRight: size * 0.2 }} />
      <View style={{ width: size * 0.28, height: size * 0.84, backgroundColor: '#ffffff' }} />
    </View>
  );
}

// ③ 「隐藏信息」图标：圆角方框 + 斜杠，表示隐藏画面上的所有信息（取代原全屏图标）。
function HideInfoGlyph({ size = 16, color = '#ffffff' }: { size?: number; color?: string }) {
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size * 0.2,
        borderWidth: 1.8, borderColor: color,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: size * 0.82, height: 1.8, backgroundColor: color,
          transform: [{ rotate: '-45deg' }],
        }}
      />
    </View>
  );
}

// 全屏图标：方形圆框内的两个 90° 角括号（左上 + 右下），比字符 ⛶ 更规整。
// ③ 全屏功能暂时停用后此图标不再使用，保留定义以免影响其它引用。
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
// 每页占满整屏（短视频竖屏样式）。原先用 min(屏高, 屏宽*16/9)，在 20:9 手机上小于屏高，
// 导致画面贴顶、底部留黑，而且和下面按 SCREEN.height 计算的分页偏移对不上、翻页会漂。
// 现在整页等于屏高，视频本身按 contain 居中，既有黑边也是上下对称。
const PLAYER_PAGE_H = SCREEN.height;

// 星级文本（半星按实心显示）
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

// 毫秒格式化为 mm:ss，用于常驻进度条的时间显示
function fmtTime(ms: number): string {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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

export default function Player({ route, navigation }: any) {
  const { t } = useI18n();
  const { colors } = useTheme();
  // 顶部返回栏与底部信息区均为绝对定位，需要自行避让安全区（刘海 / 手势条）
  const insets = useSafeAreaInsets();
  // 按当前主题色板 + 安全区生成样式，浅色 / 深色模式都能正确取色
  const styles = useMemo(() => createStyles(colors, insets), [colors, insets]);
  // ② 真实横屏：实时窗口尺寸（手机旋转后会更新）。全屏时取「长边 × 短边」作为横屏几何，
  // 这样无论旋转动画进行到哪一步，播放器容器都是横屏比例（1600×900），不会闪成竖屏尺寸。
  const { width: WIN_W, height: WIN_H } = useWindowDimensions();
  const FS_W = Math.max(WIN_W, WIN_H);
  const FS_H = Math.min(WIN_W, WIN_H);
  // fromDetail 为 true 表示从详情页进入，此时禁用横滑与标题跳转
  // skipTrailer 为 true 表示从首页 feed 进入，直接播第 1 集（跳过预告片）
  const { dramaId, epId, fromDetail, skipTrailer } = route.params;
  const videoRef = useRef<Video>(null);
  const [drama, setDrama] = useState<any>(null);
  const [currentEp, setCurrentEp] = useState<any>(null);
  const [showUnlock, setShowUnlock] = useState(false);
  const [showTrialLimit, setShowTrialLimit] = useState(false);
  // 「进入锁定集立即弹付费提示」的独立 visible：刻意不放进 closePlayerModals() 的清理范围，
  // 否则 detail.then 的 closePlayerModals() / 380ms cancelPendingModal() 会把立即弹吃掉
  // （实测：switchEpisode 路径 0.34s 能弹，详情页 navigate 进入 0~10s 全程不弹）。
  const [showPaywallPrompt, setShowPaywallPrompt] = useState(false);
  const [paywallBlur, setPaywallBlur] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  // B1: 记录「进入后台前是否在播放」，用于回到前台时决定是否自动恢复
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;
  const wasPlayingRef = useRef(false);
  const [showComments, setShowComments] = useState(false);
  // 选集面板：底部栏点击「选集」后上拉弹出
  const [showEpisodes, setShowEpisodes] = useState(false);

  // 四个 Modal 互斥：同一时刻只允许一个 visible。
  // 已有弹窗要切到另一个时，先关第一个、延时 380ms 等它卸载完再开第二个，
  // 避免 Android 上两层透明 Modal 同时挂载抢触摸、返回键只关最上层。
  // 卸载后不再接受异步回调与延时定时器里的 setState
  const aliveRef = useRef(true);
  // 只闩「试看弹窗提示」一次，与 trialLimitRef 解耦。暂停 / 回钉 / 进度这组付费墙 enforcement
  // 必须每次状态回调都执行，否则关掉弹窗再点播放就能从试看边界一路播到本集结束。
  const trialModalShownRef = useRef(false);
  const toastTimerRef = useRef<any>(null);
  const tapTimerRef = useRef<any>(null);
  const scrollTimerRef = useRef<any>(null);

  type PlayerModalName = 'unlock' | 'trial' | 'comments' | 'episodes';
  const activeModalRef = useRef<PlayerModalName | null>(null);
  const modalSwitchTimerRef = useRef<any>(null);
  // 已提交、但仍在 380ms「先关后开」窗口内的下一个弹窗。closePlayerModals() 不能清掉它，
  // 否则选集面板点锁定集后，任何一次关闭（含 detail 返回 / 点遮罩）都会让解锁框永远不出现（QA F2）。
  const pendingModalRef = useRef<PlayerModalName | null>(null);

  // 只有「剧集上下文变化」或「卸载」才显式取消已排队的延时切换
  const cancelPendingModal = () => {
    if (modalSwitchTimerRef.current) {
      clearTimeout(modalSwitchTimerRef.current);
      modalSwitchTimerRef.current = null;
    }
    pendingModalRef.current = null;
  };

  const closePlayerModals = () => {
    // 只清 visible 状态与 active 记账；不动 pending timer，保证延时切换是已提交的意图
    activeModalRef.current = null;
    setShowUnlock(false);
    setShowTrialLimit(false);
    setShowComments(false);
    setShowEpisodes(false);
  };

  const showPlayerModal = (name: PlayerModalName, delayMs = 0) => {
    // onPlaybackStatusUpdate 会周期性回调；同一弹窗（含正在延时等待的那个）重复请求时直接忽略，
    // 否则每次状态回调都会清掉并重建延时定时器，导致弹窗永远弹不出来
    if (activeModalRef.current === name || pendingModalRef.current === name) return;
    cancelPendingModal();
    const hadOpen = activeModalRef.current !== null;
    // 切到「非试看」弹窗时顺手收起立即付费提示，避免两层 Modal 叠显（同一时刻只允许一个 visible）
    if (name !== 'trial') setShowPaywallPrompt(false);
    // 先无条件关掉全部，保证任何时刻最多只有一个 visible
    closePlayerModals();
    activeModalRef.current = name;
    pendingModalRef.current = name;
    const apply = () => {
      modalSwitchTimerRef.current = null;
      // 已被剧集上下文变化 / 卸载显式取消，不再落地
      if (pendingModalRef.current !== name) return;
      pendingModalRef.current = null;
      // 写回 active：closePlayerModals() 会把它置 null，不写回会让同名 dedupe 永久失效
      activeModalRef.current = name;
      if (!aliveRef.current) return;
      setShowUnlock(name === 'unlock');
      setShowTrialLimit(name === 'trial');
      setShowComments(name === 'comments');
      setShowEpisodes(name === 'episodes');
    };
    if (delayMs > 0 || hadOpen) {
      modalSwitchTimerRef.current = setTimeout(apply, delayMs > 0 ? delayMs : 380);
    } else {
      apply();
    }
  };

  // 卸载统一清理：延时弹窗、toast、单击、选集滚动四类定时器 + 异步回调守卫
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      cancelPendingModal();
      [toastTimerRef, tapTimerRef, scrollTimerRef].forEach((r) => {
        if (r.current) {
          clearTimeout(r.current);
          r.current = null;
        }
      });
    };
  }, []);

  const [liked, setLiked] = useState(false);
  const [favorited, setFavorited] = useState(false);
  const [favCount, setFavCount] = useState(0);
  const [likeCount, setLikeCount] = useState(0);
  // ③ 视频全屏暂时停用：isFullscreen 恒为 false（保留变量以兼容已有的横屏分支代码，
  //    它们全部不可达），原「全屏」按钮改为进入「纯净观看」模式：隐藏视频上所有信息。
  const [isFullscreen] = useState(false);
  // 纯净观看模式：隐藏全部信息层，双击视频恢复显示所有信息。
  const [cleanMode, setCleanMode] = useState(false);
  // ⑧ 全屏禁用整页横滑（不能拉动换集 / 误触返回）：PanResponder 闭包读不到 state，用 ref 同步
  const isFullscreenRef = useRef(false);
  isFullscreenRef.current = isFullscreen;
  // 控件显隐：单击画面时切换。隐藏后进度条与操作栏一起收起（竖屏 / 横屏都生效）
  const [controlsVisible, setControlsVisible] = useState(true);
  // ⑤ 清晰度：默认 1080P = 原始片源（不触发转码，首屏直接可播）；
  // 选 480P/720P 时由后端按需转码，返回的转码地址写入 qualityUrl。
  const [quality, setQuality] = useState('1080P');
  const [qualityUrl, setQualityUrl] = useState('');
  const [transcoding, setTranscoding] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  // ⑤ 按需拉取所选清晰度的播放地址：1080P 直接用原始片源；480P/720P 向后端请求
  // （后端可能实时 ffmpeg 转码，需要等待；转码完成地址会写回 episode.qualities 并缓存到磁盘）。
  // 切集（currentEp.id 变化）或切清晰度（quality 变化）都会自动重新拉取。
  useEffect(() => {
    if (quality === '1080P') {
      setQualityUrl('');
      setTranscoding(false);
      return;
    }
    if (!currentEp?.id) return;
    let cancelled = false;
    setQualityUrl('');
    setTranscoding(true);
    videoApi
      .getQuality(currentEp.id, quality)
      .then((r: any) => {
        if (cancelled) return;
        setQualityUrl(r?.url || '');
        setTranscoding(false);
      })
      .catch(() => {
        if (cancelled) return;
        setQualityUrl(''); // 失败则回落原始片源
        setTranscoding(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentEp?.id, quality]);
  // ④/⑥ 全屏右侧抽屉：评论 / 选集（横屏从右滑出；竖屏仍走底部 Modal）
  const [showFsComments, setShowFsComments] = useState(false);
  const [showFsEpisodes, setShowFsEpisodes] = useState(false);
  const [unlockedIds, setUnlockedIds] = useState<string[]>([]);
  // 已解锁分集列表是否已加载完成：列表回来前不派生模糊，避免 VIP 用户闪一下模糊。
  const [unlockedLoaded, setUnlockedLoaded] = useState(false);
  // 只读派生：当前集是「需付费但未解锁」的锁定集（口径与 isEpUnlocked 一致）。
  // 刻意不新增 blur state，避免与现有 setPaywallBlur（试看边界 enforcement）打架。
  const paywallLocked = !!(
    unlockedLoaded &&
    drama &&
    currentEp &&
    !currentEp.isTrailer &&
    !currentEp.isFree &&
    drama.paymentType !== 'free' &&
    !unlockedIds.includes(currentEp.id)
  );
  // 模糊遮罩的 Image source 必须保持稳定：onPlaybackStatusUpdate 每次回调都会触发重渲染，
  // 若每帧都新建 {uri} 对象，RN 会反复重新解码/模糊整屏封面，与回钉风暴叠加会加剧卡顿。
  const paywallBlurSource = useMemo(() => ({ uri: mediaUrl(drama?.cover) }), [drama?.cover]);
  // 按 currentEp.id 记录「进入锁定集已弹过付费提示」，避免同一集重复弹窗。
  const paywallPromptedRef = useRef<string>('');
  // 进入锁定集立即弹一次付费提示。用独立 visible（showPaywallPrompt）而不走 showPlayerModal('trial')：
  // 后者的 visible（showTrialLimit）归 closePlayerModals() 管，会被 detail.then 的
  // cancelPendingModal() / closePlayerModals() 在 380ms 窗口内作废或直接关掉。
  // 同时预置 trialModalShownRef=true，使越过试看边界时不再二次弹窗（F1 门控保持独立）。
  useEffect(() => {
    if (!currentEp?.id) return;
    // 非锁定集（切到免费集 / 解锁成功 / VIP / 整剧免费）→ 立即收起，保证不残留
    if (!paywallLocked) {
      setShowPaywallPrompt(false);
      return;
    }
    if (paywallPromptedRef.current === currentEp.id) return;
    paywallPromptedRef.current = currentEp.id;
    trialModalShownRef.current = true;
    setShowPaywallPrompt(true);
  }, [paywallLocked, currentEp?.id]);
  // 视频宽高比（width/height），0 表示尚未拿到，按 16:9 兜底；
  // 用于竖屏下把视频按真实比例缩放成居中的小框，而不是铺满被裁切/拉伸。
  const [videoAspect, setVideoAspect] = useState(0);
  // 加载/缓冲中：在视频中央显示转圈，避免切换剧集时看到黑屏闪烁
  const [isBuffering, setIsBuffering] = useState(true);
  // ⑥ 是否已成功出首帧：未出帧或缓冲中，都在屏幕中央显示加载动画
  const [isLoaded, setIsLoaded] = useState(false);
  // B2: 加载失败 / 缓冲超时 → 显示重试按钮
  const [loadError, setLoadError] = useState(false);
  const bufferTimerRef = useRef<any>(null);
  // 播放位置与总时长（毫秒），供常驻进度条使用
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  // 等待解锁的目标剧集。下滑到未解锁集时 currentEp 仍是上一集，
  // 必须记住真正想看的那一集，否则解锁会解错集、看着像"点了没反应"。
  const [pendingEp, setPendingEp] = useState<any>(null);
  const [unlocking, setUnlocking] = useState(false);
  // 进度条宽度，用于把点击位置换算成跳转进度
  const barWidthRef = useRef(0);
  const flatListRef = useRef<FlatList>(null);
  // 播放列表：有预告片时首项为预告片，其后依次为分集
  const [playList, setPlayList] = useState<any[]>([]);
  const playListRef = useRef<any[]>([]);

  // 分集评论（所有用户可见，可点赞与回复）
  const [comments, setComments] = useState<any[]>([]);
  const [commentTotal, setCommentTotal] = useState(0);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [commentPosting, setCommentPosting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyPosting, setReplyPosting] = useState(false);

  // 用 ref 存储最新值，避免 onPlaybackStatusUpdate 闭包陷阱
  const dramaRef = useRef<any>(null);
  const epRef = useRef<any>(null);
  const trialLimitRef = useRef(false);
  const unlockedIdsRef = useRef<string[]>([]);
  // 最近一次播放位置（秒），用于定时上报观看进度
  const lastPosRef = useRef(0);

  // 首尾集提示
  const [toast, setToast] = useState('');
  const touchStartYRef = useRef<number | null>(null);
  // 首/尾集边界提示：纵向手势会被 ScrollView 独占（onTouchStart/onTouchEnd 收不到 move/end），
  // 必须改用 ScrollView 自己的拖拽事件判断：记录起始 offset + 期间是否真的滚动过。
  const dragStartYRef = useRef<number>(0);
  const didScrollRef = useRef(false);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null;
      if (aliveRef.current) setToast('');
    }, 1600);
  };

  // 上报每日任务完成（daily_like / daily_comment / daily_share）。
  // 以前 App 从未调用 /tasks/:key/complete，导致每日任务永远是"未完成"，
  // 在钱包里点领取必然报"任务未完成"。失败静默忽略（任务可能在后台被关掉）。
  const completeTask = (key: string) => {
    taskApi.complete(key).catch(() => {});
  };

  // 横滑手势：从右往左滑 → 进剧集详情页（从详情页进入时禁用）；
  //         从左往右滑 → 回首页，并把「当前剧集 + 播放进度」带给首页接着播。
  // 用 ref 保存最新参数，避免手势闭包读到过期的 fromDetail / dramaId
  const gestureParamsRef = useRef({ fromDetail, dramaId });
  gestureParamsRef.current = { fromDetail, dramaId };
  // 回首页要带上的续播信息（剧集 id / 集号 / 视频地址 / 播放位置）
  const resumeRef = useRef({ dramaId: '', episodeId: '', episodeNo: 1, videoUrl: '', position: 0 });
  // ① 右滑回首页的跟手动画：整屏跟手指右移，松手过阈值再滑出屏幕并返回（与首页左滑进播放页对称）
  const dragX = useRef(new Animated.Value(0)).current;
  const horizontalRef = useRef(false);
  const panResponderRef = useRef<any>(null);
  if (!panResponderRef.current) {
    panResponderRef.current = PanResponder.create({
      // 仅在明显横向移动时接管手势，纵向移动仍交给 FlatList 翻页
      onMoveShouldSetPanResponder: (_e, g) => {
        // ⑧ 全屏（横屏）禁用整页横滑：不能拉动换集 / 误触返回详情
        if (isFullscreenRef.current) return false;
        const horizontal = Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 20;
        horizontalRef.current = horizontal;
        return horizontal;
      },
      // 拖动中实时跟随手指：只跟随向右拖（从左往右滑 = 把播放页推走、露出首页）
      onPanResponderMove: (_e, g) => {
        if (!horizontalRef.current) return;
        dragX.setValue(g.dx > 0 ? g.dx : 0);
      },
      onPanResponderRelease: (_e, g) => {
        const p = gestureParamsRef.current;
        // 从左往右滑 → 先写续播信息，滑出屏幕后返回首页
        if (g.dx > 60) {
          AsyncStorage.setItem('feed_resume', JSON.stringify({ ...resumeRef.current, ts: Date.now() })).catch(() => {});
          Animated.timing(dragX, { toValue: SCREEN.width, duration: 220, useNativeDriver: true }).start(() => {
            if (navigation.canGoBack?.()) navigation.goBack();
            else navigation.navigate('Home');
          });
          return;
        }
        // 从右往左滑 → 进剧集详情页（从详情页进入时不重复跳）
        if (!p.fromDetail && g.dx < -60) {
          dragX.setValue(0);
          navigation.navigate('DramaDetail', { id: p.dramaId });
          return;
        }
        // 未达阈值：弹回原位
        Animated.spring(dragX, { toValue: 0, useNativeDriver: true }).start();
      },
      onPanResponderTerminationRequest: () => false,
    });
  }

  // 续播信息随当前集 / 播放进度实时刷新（供上面右滑回首页时读取）
  useEffect(() => {
    resumeRef.current = {
      dramaId,
      episodeId: currentEp?.id || '',
      episodeNo: currentEp?.episodeNo || 1,
      videoUrl: currentEp?.videoUrl ? mediaUrl(currentEp.videoUrl) : '',
      position,
    };
  }, [dramaId, currentEp, position]);

  // 已解锁分集变化时同步到 ref
  useEffect(() => {
    unlockedIdsRef.current = unlockedIds;
  }, [unlockedIds]);

  // ===== ⑦ 金币任务浮条 =====
  // 有「已完成未领取」的任务时，在视频上方浮出提示条：
  //   · 点击 → 跳「我的钱包」任务页领取
  //   · 左右滑 / 上滑 → 划走（自带手势，只在浮条范围内接管，不抢视频手势）
  //   · 不点它时完全不影响播放与滑动（浮条不拦截视频区触摸）
  const [coinTip, setCoinTip] = useState<{ key: string; name: string; reward: number } | null>(null);
  const coinTipPos = useRef(new Animated.ValueXY({ x: 0, y: -170 })).current;

  // ⑦ 浮条手势判定：不另建 PanResponder。
  // 实测自建 PanResponder（含 Capture 阶段）会被播放页根手势在半路抢走 —— 表现为
  // "划不动浮条，反而直接跳进了剧集详情页"。改为在根手势里按「手指起始落点」判断：
  // 落在浮条区域就划走浮条，否则照常走视频手势，两者互不抢占。
  //
  // 落点来源：浮条自己的 onStartShouldSetResponderCapture（捕获阶段，只有手指
  // 真的落在浮条上才会触发）记录 pageX/pageY；根手势再用 g.y0 反查是不是同一次触摸。
  // ⑦ 金币任务浮条手势：浮条自己接管落在它上面的触摸（onStartShouldSetResponder: true）。
  // 这样点击与滑动都在浮条内部自己判定，播放页根手势（左滑进详情 / 右滑回首页 / 上下翻页）
  // 根本不会收到这次触摸，两者物理上不可能冲突；浮条之外的区域完全不受影响。
  //   · 位移 < 10px  → 当点击，跳「我的钱包」任务页领取
  //   · 左右滑 > 70px / 上滑 > 40px → 划走（跟手 + 顺原方向滑出）
  //   · 其余 → 弹回原位
  const coinTipPan = useRef(
    PanResponder.create({
      // 刻意不用 onStartShouldSetResponder：点击要留给内部 Pressable；
      // 捕获阶段先拦：横向 / 上滑都由本 PanResponder 接管（ Pressable 放行、竖向翻页的 FlatList 也抢不走），
      // 只有纯点击不拦，仍交给内部 Pressable 跳领取页。
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dx) > 8 || g.dy < -8,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 8 || g.dy < -8,
      onPanResponderMove: (_e, g) => {
        // 跟手：横向左右移；纵向只跟随上滑（下滑不响应）
        if (Math.abs(g.dx) > Math.abs(g.dy)) coinTipPos.setValue({ x: g.dx, y: 0 });
        else coinTipPos.setValue({ x: 0, y: Math.min(0, g.dy) });
      },
      onPanResponderRelease: (_e, g) => {
        // 几乎没动 → 点击，跳领取页
        if (Math.abs(g.dx) < 10 && Math.abs(g.dy) < 10) {
          navigation.navigate('Main', { screen: 'WalletTab' });
          return;
        }
        const horizontal = Math.abs(g.dx) > Math.abs(g.dy);
        const dismiss = horizontal ? Math.abs(g.dx) > 70 : g.dy < -40;
        if (dismiss) {
          // 划走：顺着原方向滑出屏幕后卸载
          Animated.timing(coinTipPos, {
            toValue: { x: horizontal ? Math.sign(g.dx) * 420 : 0, y: horizontal ? 0 : -420 },
            duration: 180,
            useNativeDriver: true,
          }).start(() => setCoinTip(null));
        } else {
          // 没划够：弹回原位
          Animated.spring(coinTipPos, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
        }
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  // 进场拉一次任务中心，有可领取任务就浮出提示
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = await AsyncStorage.getItem('user_token');
        if (!token) return;
        const center: any = await taskApi.center().catch(() => null);
        if (!alive || !center) return;
        const all: any[] = [
          ...(center.newbieTasks || []),
          ...(center.dailyTasks || []),
          ...(center.tasks || []),
        ];
        const claimable = all.find((tk) => tk && tk.completed && !tk.claimed);
        if (claimable) {
          // 任务名走 i18n（与钱包页同一套键），缺键时回落后端原文
          const nameKey = `wallet.taskName_${claimable.key}`;
          const i18nName = t(nameKey);
          setCoinTip({
            key: String(claimable.key),
            name: i18nName === nameKey ? (claimable.name || String(claimable.key)) : i18nName,
            reward: Number(claimable.reward) || 0,
          });
        }
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 浮条出现时滑入；进全屏先收起（全屏不看浮条），退回竖屏再滑回来
  useEffect(() => {
    if (!coinTip) return;
    if (isFullscreen) {
      Animated.timing(coinTipPos, { toValue: { x: 0, y: -170 }, duration: 160, useNativeDriver: true }).start();
    } else {
      Animated.spring(coinTipPos, { toValue: { x: 0, y: 0 }, useNativeDriver: true, damping: 18 }).start();
    }
  }, [coinTip, isFullscreen]);

  // 加载该剧已解锁的分集
  useEffect(() => {
    // 剧集上下文切换（同一 Player 实例被 navigate 到另一部剧）时，先作废上一部剧的
    // 加载结果与提示记账：否则 VIP 用户从 A 剧切到 B 剧的瞬间会拿 A 剧的 unlockedIds
    // 派生 paywallLocked，在 B 剧付费集上误闪一次模糊并误弹付费提示。
    setUnlockedIds([]);
    setUnlockedLoaded(false);
    paywallPromptedRef.current = '';
    // cancelled 是本 effect 局部变量：aliveRef 的 cleanup 依赖 []、只在卸载时置 false，
    // 挡不住 [dramaId] 重跑后被作废的旧请求晚到 .then 重新写回旧剧的 ids/loaded。
    let cancelled = false;
    let retryTimer: any = null;
    const load = (attempt: number) => {
      paymentApi
        .unlockedEpisodes(dramaId)
        .then((res: any) => {
          if (cancelled || !aliveRef.current) return;
          setUnlockedIds(res?.episodeIds || []);
          setUnlockedLoaded(true);
        })
        .catch((e: any) => {
          if (cancelled || !aliveRef.current) return;
          const status = e?.response?.status;
          // 401：明确「未登录=未解锁」——保持首帧模糊+提示，handleUnlock 的 401 会跳 Login。
          if (status === 401) {
            setUnlockedIds([]);
            setUnlockedLoaded(true);
            return;
          }
          // 其它/网络错误：有限重试 2 次（800ms / 1600ms 退避）。重试期间不 setState，
          // unlockedLoaded 保持 false、paywallLocked 门控恒 false，不会首帧误闪。
          if (attempt < 2) {
            retryTimer = setTimeout(() => {
              if (cancelled || !aliveRef.current) return;
              load(attempt + 1);
            }, attempt === 0 ? 800 : 1600);
            return;
          }
          // 刻意保守偏严：宁可误拦也不 fail-open（fail-open 会让 trialDuration=0 的剧付费集白看）。
          setUnlockedIds([]);
          setUnlockedLoaded(true);
        });
    };
    load(0);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [dramaId]);

  useEffect(() => {
    // cancelled 为本 effect 局部变量：挡住被作废的旧 detail.then 晚到执行 L764 setCurrentEp /
    // L768 trialModalShownRef=false / L771 cancelPendingModal() / L772 closePlayerModals()，
    // 避免把 effect C 刚弹的付费提示撤掉或改成不补弹。（不能复用 aliveRef：它只挡卸载）
    let cancelled = false;
    paywallPromptedRef.current = '';
    dramaApi.detail(dramaId).then((d) => {
      if (cancelled || !aliveRef.current) return;
      setDrama(d);
      dramaRef.current = d;
      const eps: any[] = d.episodes || [];
      // 播放列表：只含分集，不再把预告片塞进播放页（预告片改在首页 feed 播放；
      // 进入播放页始终从第一集开始）。
      const list: any[] = eps;
      setPlayList(list);
      playListRef.current = list;
      // 选择初始播放项：epId 为 trailer 或有预告片时缺省都落在预告片上
      let ep: any = null;
      if (epId === 'trailer') ep = list.find((x: any) => x.isTrailer) || null;
      else if (epId) ep = eps.find((e: any) => e.id === epId);
      if (!ep) {
        // 从首页 feed 进入（skipTrailer）→ 直接落到第 1 集；否则沿用 list[0]（有预告片则预告片）
        ep = (skipTrailer && eps[0]) ? eps[0] : (list[0] || null);
      }
      setCurrentEp(ep);
      // 与 effect 开头那次幂等：确保「新 currentEp 落地」时提示记账已复位（否则 effect C 会因 ref 提前闩住而不弹）
      paywallPromptedRef.current = '';
      setVideoAspect(0);
      epRef.current = ep;
      trialLimitRef.current = false;
      trialModalShownRef.current = false;
      setPaywallBlur(false);
      // detail 返回意味着剧集上下文变化，旧上下文排队的延时弹窗必须显式作废
      cancelPendingModal();
      closePlayerModals();
      setIsPaused(false);
      // Scroll FlatList to the matching item（定时器纳入统一 cleanup，卸载后不再触发）
      const idx = list.findIndex((x: any) => x.id === ep?.id);
      if (idx >= 0 && flatListRef.current) {
        if (scrollTimerRef.current) {
          clearTimeout(scrollTimerRef.current);
          scrollTimerRef.current = null;
        }
        scrollTimerRef.current = setTimeout(() => {
          scrollTimerRef.current = null;
          if (!aliveRef.current) return;
          flatListRef.current?.scrollToIndex({ index: idx, animated: false });
        }, 50);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [dramaId, epId]);

  // 点赞状态：分集按分集维度，预告片按整剧维度；切换时重新拉取
  useEffect(() => {
    const ep = currentEp;
    if (!ep?.id) return;
    setLiked(false);
    setLikeCount(ep.isTrailer ? Number(drama?.likeCount) || 0 : Number(ep.likeCount) || 0);
    if (ep.isTrailer) {
      likeApi
        .checkDrama(dramaId)
        .then((res: any) => {
          if (!res) return;
          setLiked(!!res.liked);
          if (typeof res.likeCount === 'number') setLikeCount(res.likeCount);
        })
        .catch(() => {});
      return;
    }
    likeApi
      .check(ep.id)
      .then((res: any) => {
        if (!res) return;
        setLiked(!!res.liked);
        if (typeof res.likeCount === 'number') setLikeCount(res.likeCount);
      })
      .catch(() => {});
  }, [currentEp?.id]);

  // 打开评论面板 / 切换分集时加载该分集评论
  useEffect(() => {
    // ④ 全屏评论抽屉（showFsComments）与竖屏评论面板共用同一份评论数据
    if (!showComments && !showFsComments) return;
    if (!currentEp?.id) return;
    loadComments();
  }, [showComments, showFsComments, currentEp?.id]);

  // 每 15 秒上报观看进度（用于「观看满 5 分钟或完播可评分」）；预告片不上报
  useEffect(() => {
    const ep = currentEp;
    if (!ep?.id || ep.isTrailer) return;
    const timer = setInterval(async () => {
      const token = await AsyncStorage.getItem('user_token');
      if (!token) return;
      watchApi
        .saveProgress({
          dramaId,
          episodeId: ep.id,
          position: lastPosRef.current,
          completed: false,
        })
        .catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [currentEp?.id, dramaId]);

  // 判断某集是否已解锁：免费集、已购集或整剧免费
  const isEpUnlocked = (ep: any) =>
    !!ep && (!!ep.isFree || unlockedIds.includes(ep.id) || drama?.paymentType === 'free');

  const onPlaybackStatusUpdate = (status: any) => {
    // 加载 / 缓冲状态：未加载完或缓冲中都显示中央转圈，避免用户看到黑屏以为卡死
    if (status.isLoaded) {
      setIsBuffering(!!status.isBuffering);
      if (typeof status.durationMillis === 'number') setDuration(status.durationMillis);
      if (typeof status.positionMillis === 'number') setPosition(status.positionMillis);
    } else {
      setIsBuffering(true);
    }
    if (status.didJustFinish) {
      handleEnded();
      return;
    }
    // 记录最新播放位置，供定时进度上报使用
    if (typeof status.positionMillis === 'number' && status.positionMillis > 0) {
      lastPosRef.current = Math.floor(status.positionMillis / 1000);
    }
    const d = dramaRef.current;
    const ep = epRef.current;
    // 试看时长控制：未解锁的分集 + 设了 trialDuration + 播放/拖拽到达试看秒数（预告片不受试看限制）
    // 【回调风暴修复】setPositionAsync / pauseAsync 自身都会触发新的 onPlaybackStatusUpdate，
    // 而回钉后 positionMillis 恰好等于试看边界，若「已暂停」的回调也进 enforcement，
    // 就会形成 回钉 → 状态回调 → 再回钉 的死循环，占满 JS 线程（MuMu 实测系统 ANR、
    // Trial 弹窗按钮点不动、首帧弹窗被冻住）。只排除 isPlaying===false 的无效回调；
    // enforcement 组本身仍在每次真实播放回调都执行，用户关弹窗再点播放（isPlaying 变 true）
    // 或二次拖拽越界都会重新回钉 —— QA F1「只闩弹窗、不闩执行」硬约束不变。
    if (
      ep &&
      !ep.isTrailer &&
      !ep.isFree &&
      !unlockedIdsRef.current.includes(ep.id) &&
      d?.trialDuration > 0 &&
      status.positionMillis >= d.trialDuration * 1000 &&
      status.isPlaying !== false
    ) {
      // 下面这组「回钉边界 + 暂停」是试看付费墙的真正 enforcement，必须在每次状态回调都执行（QA F1 硬约束）：
      // setPositionAsync / setIsPaused(true) / pauseAsync() 每次都执行，保证用户关弹窗再播、或二次拖拽越界都会被重新按回；
      // 只有弹窗用独立的 trialModalShownRef 单次门控，绝不整段闩掉 enforcement。
      videoRef.current?.setPositionAsync(d.trialDuration * 1000).catch(() => {});
      setIsPaused(true);
      videoRef.current?.pauseAsync().catch(() => {});
      // 付费剧集模糊遮罩：与上面「回钉 + 暂停」同属每次状态回调都执行的 enforcement 组，
      // 刻意放在 trialModalShownRef 门控之外，关掉弹窗再播仍保持模糊（QA F1 硬约束）。
      setPaywallBlur(true);

      // 弹窗只提示一次，用独立的 trialModalShownRef：返回键关掉后不会被后续回调立即重开。
      if (!trialModalShownRef.current) {
        const active = activeModalRef.current || pendingModalRef.current;
        const userPanelOpen = active === 'comments' || active === 'episodes' || active === 'unlock';
        // 用户主动打开的评论 / 选集 / 解锁流程优先，本轮不抢占；面板关闭后由后续回调再弹
        if (!userPanelOpen) {
          trialModalShownRef.current = true;
          showPlayerModal('trial');
        }
      }
    }
  };

  const handleEnded = () => {
    if (!drama || !currentEp) return;
    const episodes = drama.episodes || [];
    // 预告片播放结束后进入第 1 集
    if (currentEp.isTrailer) {
      const first = episodes[0];
      if (first) switchEpisode(first);
      return;
    }
    const idx = episodes.findIndex((e: any) => e.id === currentEp.id);
    // 记录本集完播，供「完播后可评分」判断
    markCompleted(currentEp);

    const next = episodes[idx + 1];
    // 付费集不再拦截，直接切过去；由 paywallLocked 派生模糊 + 立即弹付费提示处理。
    if (next) {
      switchEpisode(next);
    }
  };

  const handleUnlock = async () => {
    // 解锁目标优先取「想看但被锁住」的那一集（下滑场景），否则取当前集
    const targetEp = pendingEp || currentEp;
    if (!targetEp?.id) return;
    setUnlocking(true);
    try {
      const res: any = await paymentApi.unlockEpisodes(dramaId, [targetEp.id]);
      if (res?.success) {
        // 记录已解锁本集并继续播放
        setUnlockedIds((prev) => {
          const nextIds = prev.includes(targetEp.id) ? prev : [...prev, targetEp.id];
          unlockedIdsRef.current = nextIds;
          return nextIds;
        });
        cancelPendingModal();
        closePlayerModals();
        setIsPaused(false);
        trialLimitRef.current = false;
        trialModalShownRef.current = false;
        setPaywallBlur(false);
        const toPlay = pendingEp;
        setPendingEp(null);
        if (toPlay) {
          // 解锁成功后再切到那一集，否则会停在空白页、看起来像没反应
          switchEpisode(toPlay);
        } else {
          videoRef.current?.playAsync().catch(() => {});
        }
      } else {
        Alert.alert(t('common.error'), String(res?.message || t('player.unlockFailed')));
      }
    } catch (e: any) {
      const status = e?.response?.status;
      const serverMsg = e?.response?.data?.message;
      if (status === 401) {
        Alert.alert(t('common.error'), t('player.pleaseLogin'));
        navigation.navigate('Login');
      } else {
        // 金币不足等服务端原因要如实告诉用户，不能静默失败
        Alert.alert(t('common.error'), String(serverMsg || t('player.unlockFailed')));
      }
    } finally {
      setUnlocking(false);
    }
  };

  const onLike = async () => {
    if (!currentEp?.id) return;
    const token = await AsyncStorage.getItem('user_token');
    if (!token) {
      Alert.alert(t('player.pleaseLogin'));
      navigation.navigate('Login');
      return;
    }
    const nextLiked = !liked;
    // 乐观更新
    setLiked(nextLiked);
    setLikeCount((c) => Math.max(0, c + (nextLiked ? 1 : -1)));
    if (nextLiked) completeTask('daily_like');
    try {
      // 预告片按整剧维度点赞，其余按分集维度
      const res: any = await (currentEp.isTrailer
        ? likeApi.toggleDrama(dramaId)
        : likeApi.toggle(currentEp.id));
      if (res && typeof res.liked === 'boolean') {
        setLiked(res.liked);
        if (typeof res.likeCount === 'number') setLikeCount(res.likeCount);
      }
    } catch {
      // 失败回滚
      setLiked(!nextLiked);
      setLikeCount((c) => Math.max(0, c + (nextLiked ? -1 : 1)));
    }
  };

  // 收藏：以前只是翻转本地 state，不请求后端，刷新后就没了（假实现）
  const onFavorite = async () => {
    if (!drama?.id) return;
    const next = !favorited;
    setFavorited(next); // 乐观更新
    setFavCount((c) => Math.max(0, c + (next ? 1 : -1)));
    try {
      await favoriteApi.toggle(drama.id);
    } catch {
      setFavorited(!next); // 失败回滚
      setFavCount((c) => Math.max(0, c + (next ? -1 : 1)));
      showToast(t('common.error'));
    }
  };

  // 进入 / 切换剧集时同步真实收藏状态
  useEffect(() => {
    if (!drama?.id) return;
    if (typeof drama.favoriteCount === 'number') setFavCount(drama.favoriteCount);
    favoriteApi
      .check(drama.id)
      .then((res: any) => setFavorited(!!(res?.favorited ?? res?.isFavorite)))
      .catch(() => {});
  }, [drama?.id]);

  // 分享：调用系统分享面板（以前点了没有任何反馈）
  const onShare = async () => {
    completeTask('daily_share');
    try {
      await Share.share({ message: `${drama?.title || ''} - EdenDrama` });
    } catch {}
  };

  // 倍速播放：网页端有，App 完全没有
  const [rate, setRate] = useState(1.0);
  const cycleRate = async () => {
    const opts = [1.0, 1.25, 1.5, 2.0];
    const idx = opts.indexOf(rate);
    const next = opts[(idx + 1) % opts.length];
    setRate(next);
    try {
      await videoRef.current?.setRateAsync(next, true);
    } catch {}
  };

  // ===== ④/⑥ 全屏右侧抽屉（评论 / 选集）滑入滑出 =====
  const fsCommentsX = useRef(new Animated.Value(FS_DRAWER_W)).current;
  const fsEpisodesX = useRef(new Animated.Value(FS_DRAWER_W)).current;
  useEffect(() => {
    Animated.timing(fsCommentsX, { toValue: showFsComments ? 0 : FS_DRAWER_W, duration: 220, useNativeDriver: true }).start();
  }, [showFsComments, fsCommentsX]);
  useEffect(() => {
    Animated.timing(fsEpisodesX, { toValue: showFsEpisodes ? 0 : FS_DRAWER_W, duration: 220, useNativeDriver: true }).start();
  }, [showFsEpisodes, fsEpisodesX]);

  // ⑩ 横屏下控件自动隐藏：显示 3s 无操作自动收起（含清晰度弹窗）；暂停时保持控件可见
  useEffect(() => {
    if (!isFullscreen || !controlsVisible || isPaused) return;
    const timer = setTimeout(() => {
      setControlsVisible(false);
      setShowQualityMenu(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [isFullscreen, controlsVisible, isPaused]);

  // ⑪ 进入全屏隐藏系统状态栏（真机顶部栏），退出恢复
  useEffect(() => {
    StatusBar.setHidden(isFullscreen, 'fade');
    return () => {
      StatusBar.setHidden(false, 'fade');
    };
  }, [isFullscreen]);

  // ⑫ 全屏「下一集」按钮：跳到当前集的下一集（付费集直接切，由 paywallLocked 派生模糊 + 付费提示）
  const playNext = () => {
    const list = drama?.episodes?.length ? drama.episodes : playList;
    const idx = list.findIndex((e: any) => e.id === currentEp?.id);
    const next = list[idx + 1];
    if (!next) return;
    switchEpisode(next);
  };

  // 上报完播（解锁评分资格）
  const markCompleted = (ep: any) => {
    if (!ep?.id) return;
    AsyncStorage.getItem('user_token').then((token) => {
      if (!token) return;
      watchApi
        .saveProgress({
          dramaId,
          episodeId: ep.id,
          position: lastPosRef.current,
          completed: true,
        })
        .catch(() => {});
    });
  };

  // 拉取当前评论（含回复）：预告片按整剧维度，分集按分集维度
  const loadComments = async () => {
    const cur = currentEp;
    if (!cur?.id) return;
    setCommentsLoading(true);
    try {
      const res: any = await (cur.isTrailer
        ? commentApi.list({ dramaId, pageSize: 50 })
        : commentApi.list({ episodeId: cur.id, pageSize: 50 }));
      setComments(Array.isArray(res?.list) ? res.list : []);
      setCommentTotal(Number(res?.total) || 0);
    } catch {
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  };

  // 发表评论：写入服务端后全平台用户可见；预告片按整剧维度发表
  const submitComment = async () => {
    const text = commentInput.trim();
    if (!text || !currentEp?.id || commentPosting) return;
    const token = await AsyncStorage.getItem('user_token');
    if (!token) {
      Alert.alert(t('review.needLogin'));
      return;
    }
    setCommentPosting(true);
    let posted = false;
    try {
      await (currentEp.isTrailer
        ? commentApi.create({ dramaId, content: text })
        : commentApi.create({ episodeId: currentEp.id, content: text }));
      // 发表成功：先清输入并提示成功（成败以"服务端是否收到"为准）
      setCommentInput('');
      posted = true;
      showToast(t('review.posted'));
    } catch (e: any) {
      // 暴露真实错误，避免一律显示"发表失败"造成误判
      const status = e?.response?.status;
      const serverMsg = e?.response?.data?.message;
      if (status === 401) {
        Alert.alert(t('common.error'), t('review.needLogin'));
        navigation.navigate('Login');
      } else {
        showToast(serverMsg || t('review.submitFailed'));
      }
    } finally {
      setCommentPosting(false);
    }
    // 成功后刷新评论列表（失败不影响"已发表"结论，单独吞掉异常）
    if (posted) loadComments().catch(() => {});
    // 每日任务：若后台未配置该任务，静默忽略，不覆盖"已发表"提示
    completeTask('daily_comment');
  };

  // 评论点赞 / 取消点赞
  const toggleCommentLike = async (c: any) => {
    const token = await AsyncStorage.getItem('user_token');
    if (!token) {
      Alert.alert(t('review.needLogin'));
      return;
    }
    const liked = !c.likedByMe;
    const prevLiked = !!c.likedByMe;
    const prevCount = Number(c.likeCount) || 0;
    const patch = (next: Record<string, any>) =>
      setComments((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...next } : x)));
    patch({ likedByMe: liked, likeCount: Math.max(0, prevCount + (liked ? 1 : -1)) });
    try {
      const res: any = await commentApi.like(c.id);
      patch({ likedByMe: !!res?.liked, likeCount: Number(res?.likeCount) || 0 });
    } catch {
      patch({ likedByMe: prevLiked, likeCount: prevCount });
    }
  };

  // 回复评论
  const submitReply = async (parent: any) => {
    const text = replyText.trim();
    if (!text || replyPosting) return;
    const token = await AsyncStorage.getItem('user_token');
    if (!token) {
      Alert.alert(t('review.needLogin'));
      return;
    }
    setReplyPosting(true);
    try {
      const created: any = await commentApi.reply(parent.id, text);
      setComments((prev) =>
        prev.map((c) =>
          c.id === parent.id ? { ...c, replies: [...(c.replies || []), created] } : c,
        ),
      );
      setReplyingTo(null);
      setReplyText('');
    } catch {
      /* ignore */
    } finally {
      setReplyPosting(false);
    }
  };

  // ③ 原「全屏」按钮的新行为：进入纯净观看模式。
  //   - 不再锁横屏 / 不再改变容器几何（视频全屏暂时停用）；
  //   - 隐藏视频上的所有信息层（顶栏 / 右侧操作栈 / 底部剧名、进度条、选集栏 / 金币浮条）；
  //   - 该状态下单击画面不做任何事（不暂停、不点赞），双击恢复显示全部信息。
  const enterCleanMode = () => {
    // 清掉可能残留的单击定时器，避免进入纯净模式后被延迟的单击暂停播放
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
    }
    lastTapRef.current = 0;
    setCleanMode(true);
    setControlsVisible(false);
    // 关闭可能处于打开状态的抽屉 / 菜单，避免状态残留
    setShowFsComments(false);
    setShowFsEpisodes(false);
    setShowQualityMenu(false);
  };

  // ② 离开播放页（含意外退出）时确保恢复竖屏，避免横屏状态残留到其它页面。
  useEffect(() => {
    return () => {
      try { OrientationModule?.lockPortrait(); } catch (e) { /* ignore */ }
    };
  }, []);

  // B1: 切到后台时暂停（防止后台继续播放 / 音频泄漏 / 状态异常），回到前台若原本在播放则恢复。
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: string) => {
      if (nextState === 'background') {
        // 仅当当前在播放才记录「原本在播」并暂停；若已被试看付费墙暂停，则不自动恢复。
        if (!isPausedRef.current) {
          wasPlayingRef.current = true;
          videoRef.current?.pauseAsync().catch(() => {});
          setIsPaused(true);
        } else {
          wasPlayingRef.current = false;
        }
      } else if (nextState === 'active') {
        if (wasPlayingRef.current) {
          wasPlayingRef.current = false;
          videoRef.current?.playAsync().catch(() => {});
          setIsPaused(false);
        }
      }
    });
    return () => sub.remove();
  }, []);

  // B2: 缓冲中 / 首帧未出 → 启动 15s 超时计时；超时或 onError → 显示重试。
  // 播放恢复（isBuffering=false 或 isLoaded=true）即清除计时器。
  useEffect(() => {
    if (loadError) return;
    if (isBuffering || !isLoaded) {
      if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
      bufferTimerRef.current = setTimeout(() => {
        setLoadError(true);
      }, 15000);
    } else if (bufferTimerRef.current) {
      clearTimeout(bufferTimerRef.current);
      bufferTimerRef.current = null;
    }
    return () => {
      if (bufferTimerRef.current) {
        clearTimeout(bufferTimerRef.current);
        bufferTimerRef.current = null;
      }
    };
  }, [isBuffering, isLoaded, loadError]);

  // B2: 卸载时清理超时计时器，避免泄漏
  useEffect(() => () => {
    if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
  }, []);

  // 单击视频 = 暂停 / 继续（已去掉 useNativeControls，不再弹出原生的进度条与快进快退）
  const togglePlay = () => {
    const next = !isPaused;
    setIsPaused(next);
    if (next) videoRef.current?.pauseAsync().catch(() => {});
    else videoRef.current?.playAsync().catch(() => {});
  };

  // B2: 重试——重新加载当前视频源，并重置 15s 超时计时（下方 effect 会在 isBuffering/!isLoaded 时重新计时）
  const handleRetry = () => {
    if (!currentEp) return;
    const src = {
      uri: quality === '1080P' ? mediaUrl(currentEp.videoUrl) : qualityUrl ? mediaUrl(qualityUrl) : mediaUrl(currentEp.videoUrl),
    };
    setLoadError(false);
    setIsLoaded(false);
    setIsBuffering(true);
    // expo-av ~13.10 无 reloadAsync，用 loadAsync 重新加载同一源等价实现重试
    (videoRef.current as any)?.loadAsync(src, { shouldPlay: false }, false).catch(() => {});
  };

  // 双击点赞：中央爱心放大后淡出（与首页 feed 同款动效）
  const likeBurst = useRef(new Animated.Value(0)).current;
  const showLikeBurst = () => {
    likeBurst.setValue(0);
    Animated.sequence([
      Animated.timing(likeBurst, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(likeBurst, { toValue: 0, duration: 450, useNativeDriver: true }),
    ]).start();
  };

  // 单击画面：切换播放 / 暂停 + 控件显隐；
  // 双击（300ms 内两次点击）：全屏 → 暂停 / 继续（且不再点赞）；竖屏 → 点赞并放爱心。
  // 做法：单击延后 300ms 执行，期间若来了第二次点击就判定为双击并取消单击。
  const lastTapRef = useRef(0);
  const onTapScreen = () => {
    const now = Date.now();
    // ③ 纯净观看模式：单击不做任何事（不暂停 / 不点赞），双击恢复显示所有信息。
    if (cleanMode) {
      if (now - lastTapRef.current < 300) {
        lastTapRef.current = 0;
        setCleanMode(false);
        setControlsVisible(true);
        return;
      }
      lastTapRef.current = now;
      return;
    }
    if (now - lastTapRef.current < 300) {
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }
      lastTapRef.current = 0;
      // 全屏：双击 = 暂停 / 继续（取消双击点赞）；竖屏：双击 = 点赞
      if (isFullscreen) {
        togglePlay();
      } else {
        onLike();
        showLikeBurst();
      }
      return;
    }
    lastTapRef.current = now;
    // 竖屏：单击 = 返回上一播放界面（先写续播，再复用右滑同款滑出动画后 goBack）；全屏内取消暂停
    if (isFullscreen) {
      setControlsVisible(true);
      return;
    }
    tapTimerRef.current = setTimeout(() => {
      tapTimerRef.current = null;
      // 离开播放页后不再对已卸载组件 setState
      if (!aliveRef.current) return;
      // 单击画面 = 返回上一播放界面（与右滑退出同款：先写续播，再滑出后返回）
      AsyncStorage.setItem('feed_resume', JSON.stringify({ ...resumeRef.current, ts: Date.now() })).catch(() => {});
      Animated.timing(dragX, { toValue: SCREEN.width, duration: 220, useNativeDriver: true }).start(() => {
        if (navigation.canGoBack?.()) navigation.goBack();
        else navigation.navigate('Home');
      });
    }, 300);
  };

  // 按进度条上点击的横向位置跳转
  const seekTo = (x: number) => {
    const w = barWidthRef.current || 1;
    const ratio = Math.max(0, Math.min(1, x / w));
    if (duration > 0) {
      videoRef.current?.setPositionAsync(Math.round(ratio * duration)).catch(() => {});
    }
  };

  // 就地切集：只换 currentEp 并把 FlatList 滚到对应页。
  // 以前用 navigation.replace('Player') 重建整屏，会先卸载再挂载 → 闪一下黑屏。
  const switchEpisode = (target: any) => {
    if (!target) return;
    epRef.current = target;
    setCurrentEp(target);
    setVideoAspect(0);
    setPosition(0);
    setDuration(0);
    lastPosRef.current = 0;
    trialLimitRef.current = false;
    trialModalShownRef.current = false;
    // 每次切集都重新允许「进入锁定集立即弹付费提示」，切回同一锁定集也能再次提示
    paywallPromptedRef.current = '';
    setPaywallBlur(false);
    setIsPaused(false);
    setIsBuffering(true);
    setIsLoaded(false);
    const idx = playListRef.current.findIndex((x: any) => x.id === target.id);
    if (idx >= 0) {
      try {
        flatListRef.current?.scrollToIndex({ index: idx, animated: false });
      } catch {}
    }
  };

  // 回正到指定页：滑动了但没真正换集时，把列表拉回当前集。
  // 否则会「停在两页之间」或「停在付费集的黑色占位页上」，表现为视频偏上 / 卡在中间。
  const snapToIndex = (index: number) => {
    if (index < 0) return;
    try {
      flatListRef.current?.scrollToIndex({ index, animated: true });
    } catch {}
  };

  // 滑动到上/下一项（预告片或分集）
  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = e.nativeEvent.contentOffset.y;
    const idx = Math.round(offsetY / SCREEN.height);
    const list = playListRef.current;
    if (!currentEp) return;
    const curIdx = Math.max(0, list.findIndex((x: any) => x.id === currentEp.id));
    // 目标页不存在 → 回正当前集
    if (idx < 0 || idx >= list.length) {
      snapToIndex(curIdx);
      return;
    }
    const target = list[idx];
    if (!target) {
      snapToIndex(curIdx);
      return;
    }
    // 停在当前集（没拖动 / 拖动力度不够回弹了）→ 也回正，消除半页偏移
    if (target.id === currentEp.id) {
      snapToIndex(curIdx);
      return;
    }
    // 付费集不再拦截、不再回正，直接切过去；由 paywallLocked 派生模糊 + 立即弹付费提示处理。
    switchEpisode(target);
  };

  // 首/尾集边界提示。
  //
  // 实现要点（踩过的坑）：纵向手势会被 ScrollView 独占 —— FlatList 与外层容器的
  // onTouchStart/onTouchEnd 都收不到 move/end，所以「在首集继续下拉 / 在末集继续上划」
  // 根本触发不到。正解是只用 ScrollView 自己的事件：
  //   onScrollBeginDrag  记录起始 offset，并清掉"已滚动"标记
  //   onScroll           期间 offset 真的动过就置位（需要 scrollEventThrottle=16）
  //   onScrollEndDrag    若"没有滚动过"且当前处于首项 / 末项，说明用户仍在往边界外滑 → 弹提示
  // 方向无需额外判断：首项还能被拉动的一定是"下拉"，末项还能被拉动的一定是"上划"。
  const onScrollBeginDragEdge = (e: any) => {
    dragStartYRef.current = Number(e?.nativeEvent?.contentOffset?.y) || 0;
    didScrollRef.current = false;
  };

  const onScrollEdge = (e: any) => {
    const y = Number(e?.nativeEvent?.contentOffset?.y) || 0;
    if (Math.abs(y - dragStartYRef.current) > 2) didScrollRef.current = true;
  };

  const onScrollEndDragEdge = () => {
    // 真的翻页了就不提示
    if (didScrollRef.current) return;
    const list = playListRef.current;
    const idx = list.findIndex((x: any) => x.id === epRef.current?.id);
    if (idx < 0) return;
    if (idx === 0) {
      // 首项：有预告片时提示已到顶，否则沿用「已经是第一集了」
      showToast(list[0]?.isTrailer ? t('watch.alreadyTop') : t('player.firstEpisode'));
    } else if (idx === list.length - 1) {
      showToast(t('player.lastEpisode'));
    }
  };

  if (!drama || !currentEp) return <View style={styles.container}><Text style={{ color: colors.text }}>{t('common.loading')}</Text></View>;

  // 单集金币价格：优先取本集，否则回退整剧价格
  const epCoins = currentEp?.priceCoins > 0 ? currentEp.priceCoins : (drama.priceCoins || 0);
  const priceDisplay = String(epCoins);

  const hasMultipleEpisodes = playList.length > 1;

  // 进度条百分比
  const progressPct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  // ============ 横屏几何（真实横屏，勿改） ============
  // ② 已改为真实横屏：进入全屏时由原生 OrientationModule 把手机锁成横屏，
  // 整个 Activity 旋转到横屏后，RN 的窗口尺寸变为「长边 × 短边」（如 1600×900）。
  // 所以播放器容器直接铺满窗口即可，不再做任何 CSS rotate：
  //   - 横屏：容器 = FS_W × FS_H（长边×短边，即 1600×900），左上角对齐 (0,0)
  //   - 竖屏：容器 = 整页 SCREEN.width × PLAYER_PAGE_H（与原来一致）
  // 控件层（顶栏 / 底栏 / 抽屉 / 解锁弹窗）原本就写在「横屏坐标系」里（top:0=顶、bottom:0=底、
  // right:0=右），手机真正横过来后这些绝对定位自然落在横屏的真实上下左右，无需镜像。
  // 取 Math.max/min 是为了在旋转动画进行中（窗口尺寸尚未稳定）也始终以横屏比例铺满，避免闪一下竖屏尺寸。
  const containerStyle = isFullscreen
    ? {
        position: 'absolute' as const,
        left: 0,
        top: 0,
        width: FS_W,
        height: FS_H,
      }
    : { width: SCREEN.width, height: PLAYER_PAGE_H };

  // 竖屏下视频框尺寸：按真实宽高比（videoAspect，未知时按 16:9）缩放到「宽度不超屏宽、
  // 高度不超屏高」的最大内接矩形，自然就是居中且按比例缩小。
  const ar = videoAspect > 0 ? videoAspect : 16 / 9;

  // 视频框尺寸：横屏 / 竖屏都必须是【确定的数值】，绝不能用 width/height:'100%'。
  //
  // 原因（实测踩过的坑）：expo-av 在 Android 上的原生 TextureView 若用百分比尺寸，
  // 在父容器尺寸随旋转/方向切换变化时解析会出错（横屏下视频只渲染成 0.6 倍并锚定在局部 (0,0)，
  // 右侧/底部留出黑边）。给原生视图一个确定的像素尺寸后，缩放就正常了。
  //
  // 横屏 = 容器尺寸 = 横屏窗口 FS_W × FS_H（长边×短边，如 1600×900），配合 COVER 裁切填满；
  // 竖屏 = 整屏尺寸减顶部安全区（与首页 feed 一致，避免上下黑边）。
  const videoBoxStyle = isFullscreen
    ? { width: FS_W, height: FS_H }
    // 竖屏：顶部留出状态栏高度，避免系统顶部栏压住画面（⑥ 顶部栏遮挡视野）
    : { width: SCREEN.width, height: PLAYER_PAGE_H - insets.top };

  // 缩放模式与首页 feed 对齐：竖版片源 COVER 铺满整屏；横版片源 CONTAIN 居中、两侧留黑边。
  const videoResizeMode = isFullscreen || ar <= 1 ? ResizeMode.COVER : ResizeMode.CONTAIN;

  const renderItem = ({ item: ep }: { item: any }) => {
    const isActive = ep.id === currentEp.id;
    const isTrailer = !!ep.isTrailer;
    if (!isActive) {
      // 不渲染非当前集视频，避免多个 Video 实例同时播放
      return <View style={{ width: SCREEN.width, height: PLAYER_PAGE_H, backgroundColor: '#000' }} />;
    }
    // 选集面板数据源：过滤掉预告片，过滤后为空则退回完整播放列表
    const eps = playList.filter((x: any) => !x.isTrailer);
    const episodeList = eps.length > 0 ? eps : playList;
    // 「选集」文案：i18n 里暂无 watch.episodes（t 缺失时返回 key 本身），缺失时回落中文
    const epRaw = t('watch.episodes');
    const episodesText = epRaw === 'watch.episodes' ? '选集' : epRaw;
    return (
      <View style={styles.pageRoot}>
        {/* playerBox：整个播放器里唯一会被旋转的容器。
            视频层与控件层都挂在它内部，所以横屏时进度条 / 操作栏 / 顶栏跟着一起转，
            布局自动变成横屏排布；竖屏时它等于整页 900x1600 且不旋转，行为与原来一致。
            解锁 / 试看 / 评论弹窗刻意留在 playerBox 外面，避免被一起旋转。 */}
        <View style={[styles.playerBox, containerStyle]}>
          {/* 视频层：铺满 playerBox。Video 的尺寸由 videoBoxStyle 给出确定的数值：
              竖屏 = 按真实比例内接矩形 + CONTAIN（居中不裁切）；
              横屏 = 1600x900 + COVER（裁切填满）。 */}
          <View style={[styles.videoLayer, !isFullscreen && { top: insets.top }]}>
            <Video
              ref={videoRef}
              // ⑤ 清晰度：1080P=原始片源；480P/720P=后端转码后的 qualityUrl（转码中先回落原始片源）
              source={{ uri: quality === '1080P' ? mediaUrl(ep.videoUrl) : (qualityUrl ? mediaUrl(qualityUrl) : mediaUrl(ep.videoUrl)) }}
              style={[styles.video, videoBoxStyle]}
              resizeMode={videoResizeMode}
              // ① 加载圈（缓冲/未出首帧）出现时冻结视频，圈消失（isLoaded 变 true）后再继续播放
              shouldPlay={!isPaused && isLoaded}
              onPlaybackStatusUpdate={onPlaybackStatusUpdate}
              onError={() => {
                if (bufferTimerRef.current) {
                  clearTimeout(bufferTimerRef.current);
                  bufferTimerRef.current = null;
                }
                setLoadError(true);
              }}
              onReadyForDisplay={(e: any) => {
                const ns = e?.naturalSize;
                if (ns && ns.width && ns.height) setVideoAspect(ns.width / ns.height);
                // ⑥ 首帧就绪 → 关闭中央加载动画
                setIsLoaded(true);
              }}
            />
            {(paywallBlur || paywallLocked) && (
              <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
                {/* 模糊层几乎不透明（0.95）+ blurRadius 25（Android 上限），盖住底下真实视频画面 */}
                <Image
                  source={paywallBlurSource}
                  blurRadius={25}
                  resizeMode="cover"
                  style={[StyleSheet.absoluteFillObject, { opacity: 0.95 }]}
                />
                <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.overlay }]} />
                {/* 再叠一层深色，保证「几乎看不清」：模糊图 + 双层压暗后仅剩极低亮度的纹理 */}
                <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.45)' }]} />
              </View>
            )}
          </View>

          {/* 单击画面 = 暂停 / 继续 + 切换控件显隐。刻意渲染在控件层之前，
              这样右侧按钮、进度条、放大按钮仍然优先收到点击。 */}
          <TouchableWithoutFeedback onPress={onTapScreen}>
            <View style={styles.tapLayer} />
          </TouchableWithoutFeedback>

          {/* ④ 暂停符号：暂停时中央显示（横屏三角形 ▶ / 竖屏圆底 PauseCircle）。
              中央符号可点（继续播放）；其余区域点击穿透到 tapLayer 仅显示控件。 */}
          {isPaused && !cleanMode && (
            <View pointerEvents="box-none" style={styles.centerOverlay}>
              <TouchableOpacity activeOpacity={0.85} onPress={togglePlay} hitSlop={24}>
                {isFullscreen ? <PlainPause size={56} /> : <PauseCircle size={64} />}
              </TouchableOpacity>
            </View>
          )}

          {/* ⑤ 双击点赞：中央爱心放大后淡出 */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.centerOverlay,
              {
                opacity: likeBurst,
                transform: [
                  { scale: likeBurst.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.3] }) },
                ],
              },
            ]}
          >
            <Image source={ICONS.like} style={{ width: 100, height: 100, tintColor: LIKE_RED }} />
          </Animated.View>

          {/* ⑥ 加载中 / 缓冲卡顿 / 未成功出帧：屏幕中央显示加载动画；超时或出错则显示重试 */}
          {(isBuffering || !isLoaded) && (
            <View style={[styles.bufferingWrap, { pointerEvents: 'box-none' }]}>
              {loadError ? (
                <TouchableOpacity activeOpacity={0.85} onPress={handleRetry} style={{ alignItems: 'center' }}>
                  <View style={{ backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 }}>
                    <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>{t('player.loadFailed') || '加载失败'}</Text>
                    <Text style={{ color: '#fff', fontSize: 13, marginTop: 6 }}>{t('player.retry') || '点击重试'}</Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <ActivityIndicator size="large" color="#ffffff" />
              )}
            </View>
          )}

          {/* ⑤ 清晰度切换中：后端正在按需转码，屏幕中央显示加载动画 + 文案 */}
          {transcoding && (
            <View style={styles.bufferingWrap} pointerEvents="none">
              <View style={{ alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#ffffff" />
                <Text style={{ color: '#fff', marginTop: 10, fontSize: 14 }}>{t('player.switchingQuality')}</Text>
              </View>
            </View>
          )}

          {/* 控件层：与视频同处 playerBox 内，横屏时随容器一起旋转 90° */}
          <View style={styles.controlLayer} pointerEvents="box-none">
            {isFullscreen ? (
              /* ===== 横屏：在被旋转的 1600x900 坐标系里按常规横屏排布 ===== */
              <>
                {/* ⑩ 上下渐变遮罩已移除：未点击时全屏无遮挡播放，点击才出现控件 */}

                {/* 顶栏：左上退出键（① 与竖屏一致）+ 剧名·集数（②）；右上分享（⑦ 唯一分享入口） */}
                {controlsVisible && (
                  <View style={styles.lsTopBar} pointerEvents="box-none">
                    <TouchableOpacity
                      style={styles.backBtn}
                      onPress={enterCleanMode}
                      accessibilityLabel={t('player.exitFullscreen')}
                      hitSlop={10}
                    >
                      {/* ① 退出键与竖屏一致：同一枚细线返回箭头（不再用 ✕） */}
                      <BackChevron size={20} />
                    </TouchableOpacity>
                    {/* ② 左上角剧名后面跟集数 */}
                    <Text style={styles.lsTitleInline} numberOfLines={1}>{drama.title}</Text>
                    {currentEp?.episodeNo ? (
                      <Text style={styles.lsTitleEp} numberOfLines={1}>
                        {t('watch.epNo', { n: currentEp.episodeNo })}
                      </Text>
                    ) : null}
                    <View style={{ flex: 1 }} />
                    <TouchableOpacity
                      style={styles.lsRoundBtn}
                      onPress={onShare}
                      accessibilityLabel={t('player.share')}
                    >
                      <Image source={ICONS.share} style={{ width: 20, height: 20, tintColor: '#ffffff' }} />
                    </TouchableOpacity>
                  </View>
                )}



                {/* 底部控件：⑫ 下一集+时间 → 进度条 → ⑦/⑤ 点赞/评论/收藏 ｜ 倍速/清晰度/选集 */}
                {controlsVisible && (
                  <View style={styles.lsBottom} pointerEvents="box-none">
                    {/* ⑫ 进度行：下一集符号在「当前时间」左侧；进度条占满整行宽度（不再限制 maxWidth） */}
                    <View style={styles.lsProgressRow}>
                      {/* 进度行最左：播放 / 暂停 切换按钮（点击即可暂停 / 继续） */}
                      <TouchableOpacity onPress={togglePlay} style={styles.lsPlayPauseBtn} activeOpacity={0.85}>
                        <PlayPauseGlyph playing={!isPaused} size={16} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={playNext} style={styles.lsNextBtn} activeOpacity={0.85}>
                        <NextGlyph size={15} />
                      </TouchableOpacity>
                      <Text style={styles.progressTime}>{fmtTime(position)}</Text>
                      <View style={styles.lsBarWrap}>
                        <View
                          style={styles.progressBar}
                          onLayout={(e) => { barWidthRef.current = e.nativeEvent.layout.width; }}
                          onStartShouldSetResponder={() => true}
                          onResponderRelease={(e) => seekTo(e.nativeEvent.locationX)}
                        >
                          <View style={styles.progressTrack}>
                            <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
                          </View>
                          <View style={[styles.progressThumb, { left: `${progressPct}%` }]} />
                        </View>
                      </View>
                      <Text style={styles.progressTime}>{fmtTime(duration)}</Text>
                    </View>

                    {/* ⑦ 分享已上移右上角；⑤ 右下角从左到右：倍速 / 清晰度 / 选集 */}
                    <View style={styles.lsBottomRow}>
                      <View style={styles.lsActionsLeft}>
                        <TouchableOpacity style={styles.lsActionBtn} onPress={onLike} activeOpacity={0.85}>
                          <Image source={ICONS.like} style={{ width: 26, height: 26, tintColor: liked ? LIKE_RED : '#ffffff' }} />
                          <Text style={styles.lsActionLabel}>{fmtCount(likeCount) || '0'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.lsActionBtn}
                          onPress={() => setShowFsComments(true)}
                          activeOpacity={0.85}>
                          <Image source={ICONS.comment} style={{ width: 24, height: 24, tintColor: '#ffffff' }} />
                          <Text style={styles.lsActionLabel}>{fmtCount(commentTotal) || '0'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.lsActionBtn} onPress={onFavorite} activeOpacity={0.85}>
                          <Image source={ICONS.favorite} style={{ width: 26, height: 26, tintColor: favorited ? FAV_GOLD : '#ffffff' }} />
                          <Text style={styles.lsActionLabel}>{fmtCount(favCount) || '0'}</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={styles.lsActionsRight}>
                        <TouchableOpacity onPress={cycleRate} style={styles.lsCtlBtn} activeOpacity={0.85}>
                          <Text style={styles.lsCtlText}>{rate}x</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setShowQualityMenu((v) => !v)}
                          style={styles.lsCtlBtn}
                          activeOpacity={0.85}>
                          <Text style={styles.lsCtlText}>{quality}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setShowFsEpisodes(true)}
                          style={styles.lsCtlBtn}
                          activeOpacity={0.85}>
                          <Text style={styles.lsCtlText}>{episodesText}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                )}

                {/* ⑤ 清晰度菜单 */}
                {showQualityMenu && (
                  <View style={styles.qualityMenu}>
                    {QUALITY_OPTS.map((q) => (
                      <TouchableOpacity
                        key={q}
                        style={styles.qualityItem}
                        onPress={() => { setQuality(q); setShowQualityMenu(false); }}>
                        <Text style={[styles.qualityItemText, quality === q && styles.qualityItemTextActive]}>{q}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* ④ 全屏评论右抽屉（从右滑出，随容器一起横屏） */}
                {showFsComments && (
                  <TouchableOpacity
                    style={styles.fsDrawerBackdrop}
                    activeOpacity={1}
                    onPress={() => setShowFsComments(false)}
                  />
                )}
                <Animated.View
                  pointerEvents={showFsComments ? 'auto' : 'none'}
                  style={[styles.fsDrawer, { transform: [{ translateX: fsCommentsX }] }]}>
                  <View style={styles.fsDrawerHeader}>
                    <Text style={styles.fsDrawerTitle}>
                      {t('player.comments')}{commentTotal > 0 ? ` ${commentTotal}` : ''}
                    </Text>
                    <TouchableOpacity onPress={() => setShowFsComments(false)}>
                      <Text style={styles.fsDrawerClose}>✕</Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={styles.fsDrawerList} keyboardShouldPersistTaps="handled">
                    {commentsLoading && comments.length === 0 ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : comments.length === 0 ? (
                      <Text style={styles.fsCommentText}>{t('player.noComments')}</Text>
                    ) : (
                      comments.map((c: any) => (
                        <View key={c.id} style={styles.fsCommentItem}>
                          <Text style={styles.fsCommentNick}>{c.user?.nickname || '—'}</Text>
                          <Text style={styles.fsCommentText}>{c.content}</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                            <TouchableOpacity onPress={() => toggleCommentLike(c)}>
                              <Text style={[styles.fsCommentLike, c.likedByMe && { color: '#ec4899' }]}>
                                {c.likedByMe ? '♥' : '♡'} {Number(c.likeCount) || 0}
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => { setReplyingTo(replyingTo === c.id ? null : c.id); setReplyText(''); }}>
                              <Text style={[styles.fsCommentLike, { marginLeft: 18 }]}>{t('review.reply')}</Text>
                            </TouchableOpacity>
                          </View>
                          {Array.isArray(c.replies) && c.replies.map((r: any) => (
                            <Text key={r.id} style={styles.fsCommentText}>
                              ↩ {r.user?.nickname || '—'}：{r.content}
                            </Text>
                          ))}
                          {replyingTo === c.id && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                              <TextInput
                                style={[styles.fsDrawerInput, { height: 32 }]}
                                value={replyText}
                                onChangeText={setReplyText}
                                placeholder={t('review.replyPlaceholder')}
                                placeholderTextColor={colors.subtle}
                              />
                              <TouchableOpacity
                                style={[styles.fsDrawerSend, { height: 30, paddingHorizontal: 12 }]}
                                disabled={!replyText.trim() || replyPosting}
                                onPress={() => submitReply(c)}>
                                <Text style={styles.fsDrawerSendText}>{t('review.publish')}</Text>
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      ))
                    )}
                  </ScrollView>
                  <View style={styles.fsDrawerComposer}>
                    <TextInput
                      style={styles.fsDrawerInput}
                      value={commentInput}
                      onChangeText={setCommentInput}
                      placeholder={t('player.commentPlaceholder')}
                      placeholderTextColor={colors.subtle}
                      maxLength={1000}
                    />
                    <TouchableOpacity
                      style={[styles.fsDrawerSend, (!commentInput.trim() || commentPosting) && { opacity: 0.5 }]}
                      disabled={!commentInput.trim() || commentPosting}
                      onPress={submitComment}>
                      <Text style={styles.fsDrawerSendText}>{t('player.send')}</Text>
                    </TouchableOpacity>
                  </View>
                </Animated.View>

                {/* ⑥ 全屏选集右抽屉（与评论区同款：从右滑出） */}
                {showFsEpisodes && (
                  <TouchableOpacity
                    style={styles.fsDrawerBackdrop}
                    activeOpacity={1}
                    onPress={() => setShowFsEpisodes(false)}
                  />
                )}
                <Animated.View
                  pointerEvents={showFsEpisodes ? 'auto' : 'none'}
                  style={[styles.fsDrawer, { transform: [{ translateX: fsEpisodesX }] }]}>
                  <View style={styles.fsDrawerHeader}>
                    <Text style={styles.fsDrawerTitle}>
                      {episodesText} · {t('watch.totalEpisodes', { n: drama.totalEpisodes })}
                    </Text>
                    <TouchableOpacity onPress={() => setShowFsEpisodes(false)}>
                      <Text style={styles.fsDrawerClose}>✕</Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.fsDrawerList}>
                    {episodeList.map((x: any) => {
                      const active = x.id === currentEp.id;
                      const epLocked = !x.isTrailer && !isEpUnlocked(x);
                      return (
                        <TouchableOpacity
                          key={String(x.id)}
                          style={[styles.episodeBtn, active && styles.episodeBtnActive]}
                          activeOpacity={0.85}
                          onPress={() => {
                            // 付费集不再走解锁排队，直接切；由 paywallLocked 派生模糊 + 付费提示处理
                            switchEpisode(x);
                            setShowFsEpisodes(false);
                          }}>
                          <Text style={[styles.episodeBtnText, active && styles.episodeBtnTextActive]}>{x.episodeNo}</Text>
                          {epLocked && <Text style={styles.episodeLock}>🔒</Text>}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </Animated.View>
              </>
            ) : (
              /* ===== 竖屏：900x1600，与旋转前完全一致 ===== */
              <>
                {/* ③ 纯净观看模式：隐藏视频上所有信息层（顶栏 / 操作栈 / 底部信息栏），双击画面恢复 */}
                {!cleanMode && (
                <>
                {/* 返回栏：paddingTop 避开刘海 / 状态栏。
                    顶部不再压一块不透明黑色遮罩（参照首页排布：视频直接顶到状态栏下方），
                    返回键自己带半透明圆底，压在亮画面上也看得清。 */}
                <View style={styles.topBar} pointerEvents="box-none">
                  <TouchableOpacity
                    style={styles.backBtn}
                    // 竖屏左上角是返回上一页；横屏分支里才是"退出全屏"
                    onPress={() => navigation.goBack()}
                    accessibilityLabel={t('nav.back')}
                    hitSlop={10}
                  >
                    <BackChevron size={20} />
                  </TouchableOpacity>
                  {/* ② 返回键右侧显示当前集数（返回键那圈浅黑底已改为透明，见 styles.backBtn） */}
                  {currentEp?.episodeNo ? (
                    <Text style={styles.topEpisodeNo} numberOfLines={1}>
                      {t('watch.epNo', { n: currentEp.episodeNo })}
                    </Text>
                  ) : null}
                </View>

                {/* ⑦ 金币任务浮条：有可领取任务时在视频上方提示（横屏分支不渲染，即全屏不显示）。
                    点击 → 跳「我的钱包」任务页领取；左右滑 / 上滑 → 划走。 */}
                {/* 右侧竖排操作栈：点赞 / 评论 / 收藏 / 分享 */}
                {controlsVisible && (
                  <View style={styles.actionStack}>
                    <TouchableOpacity style={styles.actionBtn} onPress={onLike} hitSlop={8} activeOpacity={0.85}>
                      <Image source={ICONS.like} style={{ width: 34, height: 34, tintColor: liked ? LIKE_RED : '#ffffff' }} />
                      <Text style={styles.actionLabel}>{fmtCount(likeCount) || '0'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionBtn}
                      onPress={() => showPlayerModal('comments')}
                      hitSlop={8}
                      activeOpacity={0.85}>
                      <Image source={ICONS.comment} style={{ width: 32, height: 32, tintColor: '#ffffff' }} />
                      <Text style={styles.actionLabel}>{fmtCount(commentTotal) || '0'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionBtn} onPress={onFavorite} hitSlop={8} activeOpacity={0.85}>
                      <Image source={ICONS.favorite} style={{ width: 34, height: 34, tintColor: favorited ? FAV_GOLD : '#ffffff' }} />
                      <Text style={styles.actionLabel}>{fmtCount(favCount) || '0'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionBtn} onPress={onShare} hitSlop={8} activeOpacity={0.85}>
                      <Image source={ICONS.share} style={{ width: 34, height: 34, tintColor: '#ffffff' }} />
                      {/* ⑤ 分享图标下方补「分享」文字 */}
                      <Text style={styles.actionLabel}>{t('player.share') === 'player.share' ? '分享' : t('player.share')}</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* 底部观看区（竖屏），自上而下：
                    ① 剧名 + 简介（与首页 feed 一致，在进度条上方）
                    ② 常驻进度条
                    ③ 一行：选集栏（方形圆角浅灰框）+ 上拉栏位 + 全屏键（方形圆框内两个 90° 括号） */}
                <View style={styles.watchBarWrap}>
                  {/* ① 剧名 + 简介（位置与首页一致：左侧、进度条之上）。
                      ⑦ 剧名可点击 → 跳该剧详情页 */}
                  <View style={styles.bottomMeta}>
                    <Pressable
                      onPress={() => navigation.navigate('DramaDetail', { id: dramaId })}
                      hitSlop={6}
                      style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={styles.bottomTitle} numberOfLines={1}>{drama.title || ''}</Text>
                      <FullscreenGlyph size={16} color="rgba(255,255,255,0.7)" thickness={2} />
                    </Pressable>
                    {drama.hook ? (
                      <Text style={styles.bottomHook} numberOfLines={1}>{drama.hook}</Text>
                    ) : null}
                  </View>

                  {/* ② 进度条：始终可见、可点击 / 拖动跳转 */}
                  <View style={styles.watchBarProgress}>
                    <View
                      style={styles.progressBar}
                      onLayout={(e) => { barWidthRef.current = e.nativeEvent.layout.width; }}
                      onStartShouldSetResponder={() => true}
                      onResponderRelease={(e) => seekTo(e.nativeEvent.locationX)}
                    >
                      <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
                      </View>
                      <View style={[styles.progressThumb, { left: `${progressPct}%` }]} />
                    </View>
                  </View>

                  {/* ③ 选集栏 + 上拉栏位（同一个框内）+ 全屏键 */}
                  <View style={styles.bottomControlsRow}>
                    <TouchableOpacity
                      style={styles.episodeBar}
                      onPress={() => showPlayerModal('episodes')}
                      activeOpacity={0.85}>
                      <View style={styles.watchPlayCircle}>
                        <View style={styles.watchPlayTriangle} />
                      </View>
                      <Text style={styles.episodeBarText} numberOfLines={1}>
                        {`${episodesText} · ${isTrailer ? t('watch.trailer') : t('watch.epNo', { n: ep.episodeNo })} · ${t('watch.totalEpisodes', { n: drama.totalEpisodes })}`}
                      </Text>
                      <View style={{ flex: 1 }} />
                      {/* ② 上拉栏位：与选集栏合并在同一个框内，点击同样弹出选集面板 */}
                      <View style={{ transform: [{ rotate: '90deg' }] }}>
                        <BackChevron size={16} />
                      </View>
                    </TouchableOpacity>
                    {/* ③ 原全屏键 → 隐藏信息（纯净观看）：点它隐藏所有信息，双击画面恢复 */}
                    <TouchableOpacity
                      style={styles.fsSquareBtn}
                      onPress={enterCleanMode}
                      activeOpacity={0.85}
                      accessibilityLabel={t('player.hideInfo')}>
                      <HideInfoGlyph size={16} />
                    </TouchableOpacity>
                  </View>
                </View>
                </>
                )}
              </>
            )}
          </View>
        </View>

        {/* ⑦ 金币任务浮条：刻意挂在 pageRoot 下、不在 controlLayer 里。
            controlLayer 是 pointerEvents="box-none"，实测浮条挂在其内部时
            onStartShouldSetResponderCapture 不会触发，导致"划不走浮条"。
            挂在这里能正常收到手势；横屏（isFullscreen）直接不渲染。 */}
        {coinTip && !isFullscreen && !cleanMode && (
          <Animated.View
            {...coinTipPan.panHandlers}
            style={[
              styles.coinTipWrap,
              { transform: [{ translateX: coinTipPos.x }, { translateY: coinTipPos.y }] },
            ]}>
            {/* 点击由 Pressable 负责（跳领取页）；滑动由外层 coinTipPan 抢夺后负责划走 */}
            <Pressable
              style={styles.coinTipCard}
              onPress={() => navigation.navigate('Main', { screen: 'WalletTab' })}
              hitSlop={4}>
              <View style={{ flex: 1 }}>
                <Text style={styles.coinTipTitle} numberOfLines={1}>
                  {coinTip.name}
                </Text>
                <Text style={styles.coinTipSub} numberOfLines={1}>
                  {t('wallet.taskDoneClaim', { n: coinTip.reward })}
                </Text>
              </View>
              <View style={styles.coinTipBtn}>
                <Text style={styles.coinTipBtnText}>
                  {t('wallet.claim') === 'wallet.claim' ? '去领取' : t('wallet.claim')}
                </Text>
              </View>
            </Pressable>
          </Animated.View>
        )}

        {/* 解锁弹窗 */}
        <Modal visible={showUnlock} transparent animationType="fade" onRequestClose={() => closePlayerModals()}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modal, isFullscreen && styles.modalLs]}>
              <Text style={[styles.modalTitle, isFullscreen && styles.modalTitleLs]}>{t('player.unlockEpisodeTitle')}</Text>
              {/* 集号取 pendingEp：真正想看的那一集，而不是还没切过去的当前集 */}
              <Text style={[styles.modalSubtitle, isFullscreen && styles.modalSubtitleLs]}>{t('player.unlockEpisodeSubtitle', { no: (pendingEp || currentEp).episodeNo })}</Text>
              <TouchableOpacity style={[styles.unlockBtn, isFullscreen && styles.unlockBtnLs]} onPress={handleUnlock}>
                <Text style={styles.unlockBtnText}>{t('player.unlockForCoins', { price: priceDisplay })}</Text>
              </TouchableOpacity>
              {/* ③ 「以后再说」不再退出播放页：只关弹窗并自动暂停，停在当集画面 */}
              <TouchableOpacity style={[styles.maybeLaterBtn, isFullscreen && styles.maybeLaterBtnLs]} onPress={() => { closePlayerModals(); setIsPaused(true); }}>
                <Text style={styles.maybeLater}>{t('player.maybeLater')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* 试看时长结束弹窗 / 进入付费集的立即付费提示（两个 visible 合一，同属一个 Modal） */}
        <Modal visible={showTrialLimit || showPaywallPrompt} transparent animationType="fade" onRequestClose={() => { closePlayerModals(); setShowPaywallPrompt(false); }}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modal, isFullscreen && styles.modalLs]}>
              <Text style={[styles.modalTitle, isFullscreen && styles.modalTitleLs]}>{t('player.trialTitle')}</Text>
              <Text style={[styles.modalSubtitle, isFullscreen && styles.modalSubtitleLs]}>{t('player.trialSubtitle')}</Text>
              <TouchableOpacity style={[styles.unlockBtn, isFullscreen && styles.unlockBtnLs]} onPress={handleUnlock}>
                <Text style={styles.unlockBtnText}>{t('player.unlockForCoins', { price: priceDisplay })}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.maybeLaterBtn} onPress={() => { closePlayerModals(); setShowPaywallPrompt(false); }}>
                <Text style={styles.maybeLater}>{t('player.maybeLater')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* 分集评论区（可填写、可点赞、可回复；内容全平台可见） */}
        <Modal
          visible={showComments}
          transparent
          animationType="slide"
          onRequestClose={() => closePlayerModals()}>
          <KeyboardAvoidingView
            style={styles.commentsOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <TouchableOpacity
              style={styles.commentsBackdrop}
              activeOpacity={1}
              onPress={() => closePlayerModals()}
            />
            <View style={styles.commentsSheet}>
              <View style={styles.commentsHeader}>
                <Text style={styles.commentsTitle}>
                  {t('player.comments')}
                  {commentTotal > 0 ? ` ${commentTotal}` : ''}
                </Text>
                <TouchableOpacity style={styles.commentsCloseBtn} onPress={() => closePlayerModals()}>
                  <Text style={styles.commentsClose}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* 评论列表 */}
              <ScrollView
                style={styles.commentsList}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 8 }}>
                {commentsLoading && comments.length === 0 ? (
                  <View style={styles.commentsEmpty}>
                    <ActivityIndicator color={colors.primary} />
                  </View>
                ) : comments.length === 0 ? (
                  <View style={styles.commentsEmpty}>
                    <Text style={styles.commentsEmptyText}>{t('player.noComments')}</Text>
                  </View>
                ) : (
                  comments.map((c: any) => {
                    const stars = commentStars(c);
                    return (
                      <View key={c.id} style={styles.commentItem}>
                        <View style={styles.commentAvatar}>
                          <Text style={styles.commentAvatarText}>
                            {(c.user?.nickname || '?').slice(0, 1)}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={styles.commentTopRow}>
                            <Text style={styles.commentNick} numberOfLines={1}>
                              {c.user?.nickname || '—'}
                            </Text>
                            <Text style={styles.commentDate}>{formatDate(c.createdAt)}</Text>
                          </View>
                          {stars > 0 && (
                            <Text style={styles.commentStars}>{starGlyphs(stars)}</Text>
                          )}
                          <Text style={styles.commentContent}>{c.content}</Text>

                          <View style={styles.commentActions}>
                            <TouchableOpacity
                              style={styles.commentActionBtn}
                              onPress={() => {
                                setReplyingTo(replyingTo === c.id ? null : c.id);
                                setReplyText('');
                              }}>
                              <Text style={styles.commentActionText}>{t('review.reply')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => toggleCommentLike(c)}
                              style={[styles.commentActionBtn, { marginLeft: 18 }]}>
                              <Text
                                style={[
                                  styles.commentActionText,
                                  c.likedByMe && { color: '#ec4899' },
                                ]}>
                                {c.likedByMe ? '♥' : '♡'} {Number(c.likeCount) || 0}
                              </Text>
                            </TouchableOpacity>
                          </View>

                          {/* 回复列表 */}
                          {Array.isArray(c.replies) && c.replies.length > 0 && (
                            <View style={styles.replyList}>
                              {c.replies.map((r: any) => (
                                <Text key={r.id} style={styles.replyItem}>
                                  <Text style={styles.replyNick}>
                                    {r.user?.nickname || '—'}{' '}
                                  </Text>
                                  {r.content}
                                </Text>
                              ))}
                            </View>
                          )}

                          {/* 内联回复输入 */}
                          {replyingTo === c.id && (
                            <View style={styles.replyComposer}>
                              <TextInput
                                style={styles.replyInput}
                                value={replyText}
                                onChangeText={setReplyText}
                                placeholder={t('review.replyPlaceholder')}
                                placeholderTextColor={colors.subtle}
                              />
                              <TouchableOpacity
                                style={[
                                  styles.replySendBtn,
                                  (!replyText.trim() || replyPosting) && { opacity: 0.5 },
                                ]}
                                disabled={!replyText.trim() || replyPosting}
                                onPress={() => submitReply(c)}>
                                <Text style={styles.replySendText}>{t('review.publish')}</Text>
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      </View>
                    );
                  })
                )}
              </ScrollView>

              {/* 底部填写框 */}
              <View style={styles.commentsComposer}>
                <TextInput
                  style={styles.commentsInput}
                  value={commentInput}
                  onChangeText={setCommentInput}
                  placeholder={t('player.commentPlaceholder')}
                  placeholderTextColor={colors.subtle}
                  maxLength={1000}
                />
                <TouchableOpacity
                  style={[
                    styles.commentsSendBtn,
                    (!commentInput.trim() || commentPosting) && { opacity: 0.5 },
                  ]}
                  disabled={!commentInput.trim() || commentPosting}
                  onPress={submitComment}>
                  <Text style={styles.commentsSendText}>{t('player.send')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* 选集面板：上拉弹出，横向滑动浏览全部分集，点击直达该集（未解锁则走解锁流程）。
            必须挂在 playerBox 之外，否则横屏时会跟着一起 rotate 90°。 */}
        <Modal
          visible={showEpisodes}
          transparent
          animationType="slide"
          onRequestClose={() => closePlayerModals()}>
          <View style={styles.episodeOverlay}>
            <TouchableOpacity
              style={styles.episodeBackdrop}
              activeOpacity={1}
              onPress={() => closePlayerModals()}
            />
            <View style={styles.episodeSheet}>
              <View style={styles.episodeHeader}>
                <View style={styles.episodeHeaderLeft}>
                  <Text style={styles.episodeTitle}>{episodesText}</Text>
                  <Text style={styles.episodeTotal}>{t('watch.totalEpisodes', { n: drama.totalEpisodes })}</Text>
                </View>
                <TouchableOpacity
                  style={styles.episodeCloseBtn}
                  onPress={() => closePlayerModals()}
                  accessibilityLabel={t('common.cancel')}>
                  <Text style={styles.episodeClose}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.episodeScroll}
                contentContainerStyle={{ paddingVertical: 8 }}>
                {episodeList.map((x: any) => {
                  const active = x.id === currentEp.id;
                  const locked = !x.isTrailer && !isEpUnlocked(x);
                  return (
                    <TouchableOpacity
                      key={String(x.id)}
                      style={[styles.episodeBtn, active && styles.episodeBtnActive]}
                      activeOpacity={0.85}
                      onPress={() => {
                        // 付费集不再走解锁排队，直接切；由 paywallLocked 派生模糊 + 付费提示处理
                        switchEpisode(x);
                        closePlayerModals();
                      }}>
                      <Text style={[styles.episodeBtnText, active && styles.episodeBtnTextActive]}>
                        {x.episodeNo}
                      </Text>
                      {locked && <Text style={styles.episodeLock}>🔒</Text>}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    );
  };

  // 多项时使用 FlatList 上下滑动切换；单项时直接渲染当前项
  if (hasMultipleEpisodes) {
    return (
      <Animated.View style={[styles.container, { transform: [{ translateX: dragX }] }]} {...panResponderRef.current.panHandlers}>
        <FlatList
          ref={flatListRef}
          data={playList}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          pagingEnabled
          // ⑧ 全屏（横屏）禁用上下滑动换集：换集只能通过「选集」按钮
          scrollEnabled={!isFullscreen}
          showsVerticalScrollIndicator={false}
          // 与首页 feed 同一套原生吸附：一次手势只翻一页，松手必然停在整页位置，
          // 避免「停在两页之间」导致视频偏上/卡在中间（配合 onMomentumScrollEnd 回正）
          snapToInterval={PLAYER_PAGE_H}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          getItemLayout={(_, index) => ({
            length: PLAYER_PAGE_H,
            offset: PLAYER_PAGE_H * index,
            index,
          })}
          onMomentumScrollEnd={onMomentumScrollEnd}
          // ⑦ 用户开始上下翻集时，顺手把金币浮条向上划走（满足"上滑可关闭弹窗"）。
          //    竖滑手势优先归翻页（不与视频滑动冲突），浮条只是被连带收起。
          onScrollBeginDrag={(e: any) => {
            // 顺带记录边界提示所需的起始 offset
            onScrollBeginDragEdge(e);
            if (!coinTip) return;
            Animated.timing(coinTipPos, { toValue: { x: 0, y: -420 }, duration: 180, useNativeDriver: true }).start(() => setCoinTip(null));
          }}
          // 首/尾集边界提示：必须靠 ScrollView 自己的滚动事件（onTouchEnd 收不到）
          onScroll={onScrollEdge}
          scrollEventThrottle={16}
          onScrollEndDrag={onScrollEndDragEdge}
          onScrollToIndexFailed={() => {}}
          initialScrollIndex={Math.max(0, playList.findIndex((e: any) => e.id === currentEp.id))}
        />
        {toast ? (
          <View style={styles.toastWrap} pointerEvents="none">
            <View style={styles.toastBubble}>
              <Text style={styles.toastText}>{toast}</Text>
            </View>
          </View>
        ) : null}
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={[styles.container, { transform: [{ translateX: dragX }] }]}
      {...panResponderRef.current.panHandlers}>
      {renderItem({ item: currentEp })}
      {toast ? (
        <View style={styles.toastWrap} pointerEvents="none">
          <View style={styles.toastBubble}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </View>
      ) : null}
    </Animated.View>
  );
}

// 按当前主题色板 + 安全区生成样式；视频画布保持纯黑，不随主题变化。
// createStyles 只接收 colors 与 insets，保证浅色 / 深色模式都能正确取色。
function createStyles(colors: ThemeColors, insets: { top: number; bottom: number }) {
  return StyleSheet.create({
    // 页面根容器：视频画布保持纯黑（例外，不主题化）
    container: { flex: 1, backgroundColor: '#000' },
    // 首尾集提示
    toastWrap: {
      position: 'absolute',
      top: 0, left: 0, right: 0, bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    toastBubble: {
      backgroundColor: colors.overlay,
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 999,
    },
    toastText: { color: colors.text, fontSize: 13 },
    // 视频外层与视频本体：画布保持纯黑（例外，不主题化）
    // 整页根容器：始终等于屏幕尺寸，不参与旋转（弹窗挂在这里，保证不被旋转）
    pageRoot: { width: SCREEN.width, height: PLAYER_PAGE_H, backgroundColor: '#000' },
    // 播放器容器：唯一被旋转的容器。竖屏 = 900x1600 不旋转；
    // 横屏 = 1600x900 + rotate 90°（几何见 renderItem 上方说明）。
    // 刻意不加 overflow:'hidden'：容器本身要越出 pageRoot 边界（left 为负值），
    // 加了裁剪在部分 Android 版本上会和 transform 叠加出裁切异常。
    playerBox: { backgroundColor: '#000' },
    // 控件层：铺满 playerBox（跟着一起旋转），所有按钮都挂在这里
    controlLayer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
    // 视频层：铺满 playerBox；竖屏时 Video 按真实比例居中，横屏时撑满
    videoLayer: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#000',
    },
    // 尺寸完全由 videoBoxStyle 给出（横屏 1600x900 / 竖屏按比例内接矩形），
    // 这里刻意不写 width/height:'100%' —— 百分比在被旋转的祖先下会被原生视图算错。
    video: { backgroundColor: '#000' },
    // 顶部遮罩：高度覆盖安全区，保证刘海区也有压暗
    topGradient: {
      position: 'absolute',
      top: 0, left: 0, right: 0,
      height: insets.top + 80,
      backgroundColor: colors.overlay,
    },
    // 顶部返回栏：paddingTop 让按钮避开刘海 / 状态栏
    topBar: {
      position: 'absolute',
      top: 0, left: 0, right: 0,
      flexDirection: 'row',
      alignItems: 'center',
      paddingTop: insets.top + 8,
      paddingHorizontal: 12,
    },
    // 圆形返回按钮：44x44 保证可点区域不小于 44pt。
    // ② 原来是 colors.overlay（浅黑圆圈），按需求改为透明，只留白色箭头 + 描边阴影保证暗画面上也看得清。
    backBtn: {
      width: 34, height: 44,
      borderRadius: 17,
      backgroundColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    // 左上角返回 / 退出全屏键：视频画面通常偏暗，固定用白色 + 描边阴影。
    // 原来跟着主题取 colors.text，浅色主题下是深色字，压在暗画面上根本看不清。
    backText: {
      color: '#ffffff',
      fontSize: 26,
      lineHeight: 28,
      fontWeight: 'bold',
      textShadowColor: 'rgba(0,0,0,0.75)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    // ② 返回键右侧的当前集数（紧贴箭头）
    topEpisodeNo: {
      color: '#ffffff',
      fontSize: 15,
      fontWeight: '600',
      marginLeft: 0,
      textShadowColor: 'rgba(0,0,0,0.75)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    // ④ 暂停符号 / ⑤ 双击爱心 的居中覆盖层
    centerOverlay: {
      position: 'absolute',
      top: 0, left: 0, right: 0, bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionStack: {
      position: 'absolute',
      right: 8,
      // 抬高底部安全区高度，避让观看栏 + 进度条 + 手势条
      bottom: 130 + insets.bottom,
      alignItems: 'center',
    },
    // 与首页 feed 右侧操作列一致：图标 + 数量，间距 24
    actionBtn: { alignItems: 'center', marginBottom: 24 },
    actionLabel: { color: '#ffffff', fontSize: 11, marginTop: 2, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
    // 全屏切换：44x44 保证可点区域
    fsBtn: {
      position: 'absolute',
      bottom: 14 + insets.bottom, right: 14,
      width: 44, height: 44,
      borderRadius: 22,
      backgroundColor: colors.overlay,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // 全屏入口图标压在视频画面上，固定白色 + 描边，避免浅色主题下看不清
    fsEmoji: {
      color: '#ffffff',
      fontSize: 18,
      textShadowColor: 'rgba(0,0,0,0.75)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    // 底部信息覆盖层：paddingBottom 避开手势条
    // 关键：设 box-none，否则这块全宽覆盖层会盖住右下角的全屏按钮（⛶），吞掉点击。
    bottomInfo: {
      position: 'absolute',
      pointerEvents: 'box-none',
      left: 0, right: 0, bottom: 0,
      paddingHorizontal: 16,
      paddingTop: 50,
      paddingBottom: insets.bottom + 8,
      backgroundColor: 'transparent',
    },
    // 单击暂停层：铺满整页，但渲染在其他控件之前，所以不抢按钮的点击
    tapLayer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
    // 加载 / 缓冲转圈：视频居中
    bufferingWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    progressRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6, marginBottom: 4 },
    progressTime: {
      color: '#ffffff',
      fontSize: 10,
      textShadowColor: 'rgba(0,0,0,0.6)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 2,
    },
    rateBtn: { marginRight: 10, paddingHorizontal: 6, paddingVertical: 2 },
    progressBar: { height: 16, justifyContent: 'center' },
    progressTrack: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
    progressFill: { height: 3, backgroundColor: colors.primary },
    progressThumb: {
      position: 'absolute',
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: '#ffffff',
      marginLeft: -6,
    },
    // ---------- 横屏（被旋转的 1600x900 坐标系）----------
    // 安全区映射：竖屏的 top(刘海) 落在横屏左边 → paddingLeft；
    //            竖屏的 bottom(手势条) 落在横屏右边 → paddingRight。
    lsTopGradient: {
      position: 'absolute',
      top: 0, left: 0, right: 0,
      height: 96,
      backgroundColor: colors.overlay,
    },
    lsBottomGradient: {
      position: 'absolute',
      bottom: 0, left: 0, right: 0,
      height: 160,
      backgroundColor: colors.overlay,
    },
    // 顶栏：左退出键 / 中剧名 / 右分享
    lsTopBar: {
      position: 'absolute',
      top: 0, left: 0, right: 0,
      flexDirection: 'row',
      alignItems: 'center',
      paddingTop: 12,
      paddingLeft: insets.top + 12,
      paddingRight: insets.bottom + 12,
    },
    lsTitle: {
      flex: 1,
      marginHorizontal: 12,
      color: '#ffffff',
      fontSize: 14,
      fontWeight: 'bold',
      textShadowColor: 'rgba(0,0,0,0.75)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    // 圆形按钮：44x44 保证可点区域（分享按钮去掉浅黑底，完全透明）
    lsRoundBtn: {
      width: 44, height: 44,
      borderRadius: 22,
      backgroundColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    lsIcon: {
      color: '#ffffff',
      fontSize: 20,
      fontWeight: 'bold',
      textShadowColor: 'rgba(0,0,0,0.75)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    // 底部控件区：倍速 + 时间 → 进度条 → 点赞 / 评论 / 收藏
    lsBottom: {
      position: 'absolute',
      left: 0, right: 0, bottom: 0,
      paddingLeft: insets.top + 12,
      paddingRight: insets.bottom + 12,
      paddingBottom: 12,
      paddingTop: 60,
      backgroundColor: 'transparent',
    },
    // 横排一行：图标 + 数字 / 文案
    lsActions: { flexDirection: 'row', alignItems: 'center', gap: 24, marginTop: 6 },
    lsActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
    lsActionLabel: {
      color: '#ffffff',
      fontSize: 13,
      fontWeight: 'bold',
      textShadowColor: 'rgba(0,0,0,0.6)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 2,
    },
    // ② 横屏剧名（不再 flex:1，让集数紧跟其后）+ 集数
    lsTitleInline: {
      color: '#ffffff',
      fontSize: 14,
      fontWeight: 'bold',
      marginLeft: 12,
      maxWidth: 860,
      textShadowColor: 'rgba(0,0,0,0.75)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    lsTitleEp: {
      color: 'rgba(255,255,255,0.85)',
      fontSize: 13,
      fontWeight: '600',
      marginLeft: 8,
      textShadowColor: 'rgba(0,0,0,0.75)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    // ⑫ 进度行：下一集符号 + 当前时间 + 进度条（占满整行）+ 总时长
    lsProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    lsNextBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    lsPlayPauseBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    // 进度条占满整行宽度（不再限制 maxWidth），右侧紧接总时长
    lsBarWrap: { flex: 1 },
    // ⑤/⑦ 底行：左点赞/评论/收藏，右倍速/清晰度/选集
    lsBottomRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
    lsActionsLeft: { flexDirection: 'row', alignItems: 'center', gap: 22 },
    lsActionsRight: { flexDirection: 'row', alignItems: 'center', gap: 14, marginLeft: 'auto' },
    lsCtlBtn: { minHeight: 36, paddingHorizontal: 8, justifyContent: 'center' },
    lsCtlText: {
      color: '#ffffff',
      fontSize: 13,
      fontWeight: '600',
      textShadowColor: 'rgba(0,0,0,0.6)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 2,
    },
    // ⑤ 清晰度菜单：紧贴「清晰度」按钮上方弹出（不再悬浮在右下角）
    qualityMenu: {
      position: 'absolute',
      right: 12,
      bottom: 86,
      backgroundColor: 'rgba(0,0,0,0.82)',
      borderRadius: 10,
      paddingVertical: 6,
      minWidth: 120,
    },
    qualityItem: { paddingHorizontal: 16, paddingVertical: 9 },
    qualityItemText: { color: '#ffffff', fontSize: 13 },
    qualityItemTextActive: { color: colors.primary, fontWeight: 'bold' },
    // ④/⑥ 全屏右侧抽屉（评论 / 选集）：从右滑出
    fsDrawerBackdrop: {
      position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.25)',
    },
    fsDrawer: {
      position: 'absolute',
      right: 0, top: 0, bottom: 0,
      width: FS_DRAWER_W,
      backgroundColor: 'rgba(12,12,16,0.92)',
      borderTopLeftRadius: 14,
      borderBottomLeftRadius: 14,
      paddingLeft: insets.bottom + 12,
      paddingTop: 12,
      paddingBottom: 12,
    },
    fsDrawerHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, paddingRight: 12 },
    fsDrawerTitle: { flex: 1, color: '#ffffff', fontSize: 16, fontWeight: 'bold' },
    fsDrawerClose: { color: '#ffffff', fontSize: 18, paddingHorizontal: 8 },
    fsDrawerList: { flex: 1 },
    fsDrawerComposer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8, paddingRight: 12 },
    fsDrawerInput: {
      flex: 1,
      backgroundColor: 'rgba(255,255,255,0.12)',
      borderRadius: 18,
      color: '#ffffff',
      paddingHorizontal: 14,
      height: 38,
    },
    fsDrawerSend: {
      backgroundColor: colors.primary,
      borderRadius: 18,
      paddingHorizontal: 16,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fsDrawerSendText: { color: '#ffffff', fontSize: 13, fontWeight: 'bold' },
    fsCommentItem: { marginBottom: 12, paddingRight: 12 },
    fsCommentNick: { color: '#ffffff', fontSize: 12, fontWeight: 'bold' },
    fsCommentText: { color: 'rgba(255,255,255,0.9)', fontSize: 13, marginTop: 2 },
    fsCommentLike: { color: 'rgba(255,255,255,0.75)', fontSize: 12 },
    // 旧的「底部信息面板」bottomTitle / bottomMeta 定义已删除：与下方观看栏同名键重复（TS1117）。
    // 实际 JSX（1704/1709）用的是观看栏那组白字 + 阴影样式，必须保留那一组，否则视频上的剧名会变成主题色。
    bottomDrama: { color: colors.textSecondary, fontSize: 13, marginBottom: 4 },
    bottomDesc: { color: colors.muted, fontSize: 12, marginBottom: 6 },
    bottomMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    // 免费徽标：绿色底上保留白字，保证小徽标可读
    badgeFree: {
      color: '#fff',
      fontSize: 10,
      fontWeight: 'bold',
      backgroundColor: colors.green,
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 4,
      overflow: 'hidden',
    },
    // ---------- 竖屏底部「观看栏」（排版对齐首页 feed）----------
    // 透明底：视频延伸到栏后面，不留不透明色块；paddingBottom 避开手势条
    watchBarWrap: {
      position: 'absolute',
      pointerEvents: 'box-none',
      left: 0, right: 0, bottom: 0,
      paddingBottom: insets.bottom + 4,
      backgroundColor: 'transparent',
    },
    watchBarRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 11,
    },
    watchBarLeft: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    // 播放小圆：空心圆 + 内部右向三角（文件内没有图标组件，用 border 现画）
    watchPlayCircle: {
      width: 15,
      height: 15,
      borderRadius: 7.5,
      borderWidth: 1.5,
      borderColor: '#ffffff',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 7,
    },
    watchPlayTriangle: {
      width: 0,
      height: 0,
      marginLeft: 2,
      borderLeftWidth: 4.5,
      borderTopWidth: 3,
      borderBottomWidth: 3,
      borderTopColor: 'transparent',
      borderBottomColor: 'transparent',
      borderLeftColor: '#ffffff',
    },
    // 栏内文字压在视频画面上，固定白色 + 描边阴影保证浅色主题下也看得清
    watchBarText: {
      color: '#ffffff',
      fontSize: 13,
      textShadowColor: 'rgba(0,0,0,0.75)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    watchBarTextBold: { fontWeight: '600' },
    watchDot: {
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: '#ffffff',
      marginHorizontal: 7,
    },
    // 全屏按钮：44x44 可点区域，位于观看栏最右端
    fsBarBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    fsBarIcon: {
      color: '#ffffff',
      fontSize: 18,
      textShadowColor: 'rgba(0,0,0,0.75)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    // 进度条左右留白，与上下文字对齐（宽度由内层 progressBar 的 onLayout 读取）
    watchBarProgress: { paddingHorizontal: 14, paddingBottom: 2 },
    // ③ 剧名 + 简介（位置与首页一致）
    bottomMeta: { paddingHorizontal: 14, marginBottom: 6 },
    bottomTitle: {
      color: '#ffffff',
      fontSize: 17,
      fontWeight: 'bold',
      textShadowColor: 'rgba(0,0,0,0.75)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    bottomHook: {
      color: 'rgba(255,255,255,0.88)',
      fontSize: 13,
      marginTop: 4,
      textShadowColor: 'rgba(0,0,0,0.75)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    // ③ 选集栏 / 上拉栏位 / 全屏 同一行
    bottomControlsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingTop: 4,
      paddingBottom: 8,
    },
    // 选集栏：方形圆角、浅灰（半透明白）框 + 浅灰底
    episodeBar: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      height: 36,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.5)',
      backgroundColor: 'rgba(255,255,255,0.18)',
      paddingHorizontal: 10,
      marginRight: 8,
    },
    episodeBarText: {
      color: '#ffffff',
      fontSize: 13,
      fontWeight: '600',
      flexShrink: 1,
      textShadowColor: 'rgba(0,0,0,0.6)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 2,
    },
    // 全屏键：方形圆框 + 两个 90° 角括号。
    // ③ 底色与描边都加深 —— 原来浅灰框压在亮画面上几乎看不见。
    fsSquareBtn: {
      width: 40,
      height: 36,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: 'rgba(0,0,0,0.55)',
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    // ⑦ 剧名右侧的「进详情」小箭头
    bottomTitleChevron: {
      color: 'rgba(255,255,255,0.7)',
      fontSize: 18,
      fontWeight: '300',
      marginLeft: 2,
      marginTop: -1,
    },
    // ⑦ 金币任务浮条
    coinTipWrap: {
      position: 'absolute',
      left: 12,
      right: 12,
      // 落在顶部返回栏（insets.top + 80）下方，避免和返回键/集数重叠
      top: insets.top + 76,
      zIndex: 30,
    },
    coinTipCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.72)',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.14)',
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    coinTipTitle: { color: '#ffffff', fontSize: 14, fontWeight: 'bold' },
    coinTipSub: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 2 },
    coinTipBtn: {
      backgroundColor: colors.primary,
      borderRadius: 999,
      height: 32,
      paddingHorizontal: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 10,
    },
    coinTipBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },

    // ---------- 选集上拉面板 ----------
    episodeOverlay: { flex: 1, justifyContent: 'flex-end' },
    episodeBackdrop: {
      ...StyleSheet.absoluteFillObject,
      // 去掉上拉时视频上的浅黑滤镜：保留点外部关闭，背景透明
      backgroundColor: 'transparent',
    },
    episodeSheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingHorizontal: 16,
      paddingTop: 16,
      // 底部留出手势条安全区
      paddingBottom: insets.bottom + 24,
      maxHeight: '52%',
    },
    episodeHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    episodeHeaderLeft: { flexDirection: 'row', alignItems: 'center' },
    episodeTitle: { color: colors.text, fontSize: 18, fontWeight: 'bold' },
    episodeTotal: { color: colors.muted, fontSize: 12, marginLeft: 8 },
    // 关闭按钮：44x44 可点区域
    episodeCloseBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    episodeClose: { color: colors.muted, fontSize: 16 },
    episodeScroll: { flexGrow: 0, marginTop: 4 },
    episodeBtn: {
      width: 56,
      height: 56,
      borderRadius: 8,
      marginRight: 10,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    episodeBtnActive: { backgroundColor: colors.primary },
    episodeBtnText: { color: colors.textSecondary, fontSize: 15, fontWeight: 'bold' },
    // 当前集在主色底上，用白字保证对比度
    episodeBtnTextActive: { color: '#ffffff' },
    episodeLock: { fontSize: 10, marginTop: 2 },

    modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 24 },
    modal: { backgroundColor: colors.surface, borderRadius: 16, padding: 24, alignItems: 'center' },
    modalTitle: { color: colors.text, fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
    modalSubtitle: { color: colors.muted, textAlign: 'center', marginBottom: 24 },
    // 主色紫按钮保留白字（浅色模式下紫底白字才可读）
    unlockBtn: { backgroundColor: colors.primary, paddingVertical: 14, paddingHorizontal: 32, borderRadius: 30, width: '100%', alignItems: 'center', minHeight: 48, justifyContent: 'center' },
    unlockBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
    // 「稍后再说」：撑到 44pt 可点高度
    maybeLaterBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
    maybeLater: { color: colors.muted },
    // ① 横屏（全屏）时解锁 / 试看弹窗整体缩小，避免在大屏宽幅下显得过大
    modalLs: { padding: 16, width: 320, maxWidth: '82%' },
    modalTitleLs: { fontSize: 17, marginBottom: 6 },
    modalSubtitleLs: { fontSize: 13, marginBottom: 16 },
    unlockBtnLs: { paddingVertical: 10, paddingHorizontal: 22 },
    maybeLaterBtnLs: { minHeight: 36 },
    commentsOverlay: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    commentsBackdrop: {
      ...StyleSheet.absoluteFillObject,
      // 去掉上拉时视频上的浅黑滤镜：保留点外部关闭，背景透明
      backgroundColor: 'transparent',
    },
    commentsSheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingHorizontal: 16,
      paddingTop: 16,
      // 底部留出手势条安全区
      paddingBottom: insets.bottom + 24,
      maxHeight: '72%',
    },
    commentsHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    commentsTitle: { color: colors.text, fontSize: 18, fontWeight: 'bold' },
    // 关闭按钮：44x44 可点区域
    commentsCloseBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    commentsClose: { color: colors.muted, fontSize: 16 },
    commentsList: { flexGrow: 0 },
    commentsEmpty: { alignItems: 'center', paddingVertical: 40 },
    commentsEmptyText: { color: colors.muted, fontSize: 14 },
    // 单条评论
    commentItem: {
      flexDirection: 'row',
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    commentAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 10,
    },
    commentAvatarText: { color: colors.muted, fontSize: 14 },
    commentTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    commentNick: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', flexShrink: 1 },
    commentDate: { color: colors.subtle, fontSize: 11, marginLeft: 8 },
    commentStars: { color: colors.gold, fontSize: 12, marginTop: 2 },
    commentContent: { color: colors.textSecondary, fontSize: 13, marginTop: 6, lineHeight: 19 },
    commentActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      marginTop: 6,
    },
    // 评论操作（回复 / 点赞）：撑到 44pt 可点高度
    commentActionBtn: { minHeight: 44, justifyContent: 'center' },
    commentActionText: { color: colors.muted, fontSize: 12 },
    replyList: {
      marginTop: 8,
      paddingLeft: 10,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: colors.border,
    },
    replyItem: { color: colors.muted, fontSize: 12, lineHeight: 18, marginBottom: 4 },
    replyNick: { color: colors.textSecondary, fontWeight: '600' },
    replyComposer: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
    replyInput: {
      flex: 1,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 8,
      color: colors.text,
      fontSize: 13,
      minHeight: 44,
    },
    replySendBtn: {
      backgroundColor: colors.primary,
      borderRadius: 18,
      paddingHorizontal: 16,
      minHeight: 44,
      justifyContent: 'center',
      marginLeft: 8,
    },
    replySendText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
    // 底部填写框
    commentsComposer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: 12,
    },
    commentsInput: {
      flex: 1,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 10,
      color: colors.text,
      fontSize: 14,
      minHeight: 44,
    },
    commentsSendBtn: {
      backgroundColor: colors.primary,
      borderRadius: 20,
      paddingHorizontal: 20,
      minHeight: 44,
      justifyContent: 'center',
      marginLeft: 8,
    },
    commentsSendText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  });
}
