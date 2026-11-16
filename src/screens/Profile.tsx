import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  Modal, TextInput, Alert, Image, Platform, FlatList, Animated, Dimensions, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { userApi, coinApi, vipApi, watchApi, favoriteApi, likeApi, reservationApi, API_BASE, mediaUrl } from '../api';
import * as ImagePicker from 'expo-image-picker';
import { useI18n, localizeCategory } from '../i18n/LanguageContext';
import { useTheme, ThemeColors } from '../theme/ThemeContext';
import { useFocusEffect } from '@react-navigation/native';

const SCREEN = Dimensions.get('window');
// 顶部预留状态栏高度（+8 留白），避免标题被手机状态栏挡住，并统一推下
const STATUS_TOP = (StatusBar.currentHeight || 24) + 8;

// 个人信息下方的文字页签（与网页端一致：历史 / 收藏 / 点赞 / 我的预约）
const TABS: { key: 'history' | 'favorites' | 'likes' | 'reservations'; labelKey: string }[] = [
  { key: 'history', labelKey: 'wallet.history' },
  { key: 'favorites', labelKey: 'wallet.favorites' },
  { key: 'likes', labelKey: 'wallet.likes' },
  { key: 'reservations', labelKey: 'profile.myReservations' },
];

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

// 历史观看时间格式化为 MM-DD HH:mm（右侧展示）
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
    // 顶部栏：标题 + 右上角设置入口（把整体界面推下，并承载设置入口）
    topBar: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 12, paddingBottom: 10, backgroundColor: colors.elevated,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderStrong,
    },
    topTitle: { color: colors.text, fontSize: 18, fontWeight: 'bold', flex: 1 },
    settingsBtn: {
      width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
    },
    hamburger: { width: 22, alignItems: 'stretch' },
    hamburgerLine: { height: 2, borderRadius: 1, marginVertical: 2.5 },
    // 个人信息头部（纵向：头像昵称行 + 金币 / VIP 行）
    header: {
      padding: 20, backgroundColor: colors.elevated,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderStrong,
    },
    headerTop: { flexDirection: 'row', alignItems: 'center' },
    avatarContainer: { marginRight: 16 },
    avatar: { width: 64, height: 64, borderRadius: 32 },
    avatarPlaceholder: {
      width: 64, height: 64, borderRadius: 32, backgroundColor: colors.borderStrong,
      justifyContent: 'center', alignItems: 'center',
    },
    userInfo: { flex: 1 },
    nickname: { color: colors.text, fontSize: 18, fontWeight: 'bold' },
    account: { color: colors.muted, fontSize: 13, marginTop: 4 },
    gender: { color: colors.muted, fontSize: 12, marginTop: 2 },
    editBtn: {
      backgroundColor: colors.primary, paddingHorizontal: 16, borderRadius: 18,
      minHeight: 44, justifyContent: 'center', alignItems: 'center',
    },
    editBtnText: { color: '#fff', fontWeight: 'bold' },
    headerSub: { flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 10, flexWrap: 'wrap' },
    coinsBadge: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: colors.surfaceAlt, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6,
    },
    coinsText: { color: colors.text, fontSize: 13, fontWeight: 'bold' },
    vipBadge: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: colors.primary, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6,
    },
    vipText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
    // 文字页签栏
    tabBar: {
      flexDirection: 'row', backgroundColor: colors.elevated,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderStrong,
      position: 'relative',
    },
    tabItem: { flex: 1, alignItems: 'center', paddingVertical: 12 },
    tabText: { color: colors.muted, fontSize: 15 },
    tabTextActive: { color: colors.text, fontWeight: 'bold' },
    tabIndicator: {
      position: 'absolute', bottom: 0, left: 0, height: 3,
      width: SCREEN.width / TABS.length, backgroundColor: colors.primary,
    },
    // 列表项（与网页端 library 一致：横向行 = 左封面 + 右信息 + 最右时间）
    listItem: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceAlt,
      borderRadius: 10, padding: 10, marginBottom: 10,
    },
    listCover: {
      width: 64, height: 96, borderRadius: 6, backgroundColor: colors.surface,
      overflow: 'hidden', marginRight: 12, justifyContent: 'center', alignItems: 'center',
    },
    listCoverImg: { width: '100%', height: '100%' },
    listInfo: { flex: 1 },
    listTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
    listMeta: { color: colors.muted, fontSize: 12, marginTop: 3 },
    listMetaPrimary: { color: colors.primary, fontSize: 12, marginTop: 3 },
    listTimeWrap: { marginLeft: 10, alignItems: 'flex-end', justifyContent: 'center' },
    listTime: { color: colors.muted, fontSize: 12 },
    empty: { alignItems: 'center', padding: 50 },
    emptyText: { color: colors.muted },
    // 编辑资料弹窗
    modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 20 },
    modalContent: { backgroundColor: colors.elevated, borderRadius: 16, padding: 20 },
    modalTitle: { color: colors.text, fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
    modalLabel: { color: colors.muted, fontSize: 13, marginBottom: 6, marginTop: 8 },
    modalInput: {
      backgroundColor: colors.bg, color: colors.text, borderRadius: 8,
      paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8, minHeight: 44,
    },
    modalBtn: {
      backgroundColor: colors.primary, paddingVertical: 12, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center', marginTop: 8, minHeight: 44,
    },
    modalBtnAlt: { backgroundColor: colors.surface },
    modalBtnText: { color: '#fff', fontWeight: 'bold' },
    // 个人信息 Hero（2026-11-07 起取代旧 header）：
    // 第一行 = 头像 + 右侧「左列(昵称/账户) 与 右列(年度VIP徽章/到期时间)」左右分离，VIP 组靠右不与昵称冲突；
    // 右列徽章与到期时间左对齐；到期时间与账户(邮箱)同一水平线；
    // 第二行 = 金币文字 + 双按钮（二者同一水平线，且整体位于头像下方）；
    // 16:12 起：卡片外框与底色、金币框、头像外围圆框均已取消，个人信息直接浮于页面背景。
    // 16:26 起：整体等比放大约 20%（字号/头像/按钮/间距），结构、去框、金币与按钮平齐均保持不变。
    // 16:31：横向边距让回给文字（margin/padding 还原），避免昵称被 VIP 徽章+到期时间挤压截断；纵向放大保留。
    // 17:59：年度 VIP + 到期时间整体右移（与昵称/账户左右分离），到期时间回到账户行同水平线，并与年度 VIP 左对齐。
    heroCard: {
      marginHorizontal: 16, marginTop: 14, marginBottom: 14,
      padding: 12, flexDirection: 'column',
    },
    heroTopRow: { flexDirection: 'row', alignItems: 'center' },
    heroBottomRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12,
    },
    heroLeft: { alignItems: 'center', justifyContent: 'center' },
    // 头像放大：大圆，直径约 160dp（≈右侧昵称+账号文字块宽度），与右侧信息并排
    heroAvatar: {
      width: 160, height: 160, borderRadius: 80, backgroundColor: colors.surfaceAlt,
    },
    heroAvatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
    heroAvatarText: { color: colors.gold, fontSize: 64, fontWeight: 'bold' },
    heroCoinsBox: {
      minHeight: 36, alignItems: 'center', justifyContent: 'center',
    },
    heroCoinsText: { color: colors.gold, fontSize: 16, fontWeight: 'bold' },
    heroRight: { flex: 1, marginLeft: 12, flexDirection: 'row', alignItems: 'stretch', justifyContent: 'space-between' },
    heroInfoCol: { flex: 1, flexDirection: 'column', marginRight: 14 },
    heroVipCol: { alignItems: 'flex-start', flexShrink: 0 },
    heroRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
    // 16:53：第一行（昵称 + VIP 徽章 + 到期）整组向下挪 3dp，账户行保持原位；与头像/下方的视觉重心更贴合。
    heroNameRow: { marginTop: 6 },
    // 16:43：第一行右侧 heroVipWrap 含「徽章 + 到期时间（徽章下方左对齐）」（昵称贴顶后与徽章顶部齐平，视觉上「年度 VIP」与昵称平行）；
    // 17:31：到期时间从账户行移回此处，与年度 VIP 左对齐（撤销 17:11 的账户行同行方案）。
    // 昵称放大：19 → 30，配合 160dp 大圆头像更突出
    heroNickname: {
      color: colors.text, fontSize: 30, fontWeight: 'bold', flexShrink: 1,
      lineHeight: 36, marginRight: 6, alignSelf: 'flex-start',
    },
    // 17:59：右列徽章容器，minHeight 与昵称行高(24)一致并垂直居中，使「年度 VIP」与昵称顶对齐、到期时间与账户同水平线。
    heroVipWrap: { alignItems: 'flex-start', flexShrink: 0, minHeight: 36, justifyContent: 'center' },
    heroVipBadge: {
      backgroundColor: colors.gold, borderRadius: 10, flexShrink: 0,
      paddingHorizontal: 8, paddingVertical: 3, maxWidth: 160,
    },
    heroVipBadgeInactive: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderStrong },
    heroVipText: { color: '#1a1200', fontSize: 12, fontWeight: 'bold' },
    heroVipTextInactive: { color: colors.muted },
    heroAccount: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 6, marginRight: 6 },
    // 17:59：到期时间回到账户行同一水平线，并位于右列与年度 VIP 徽章左对齐（heroVipCol 为 flex-start）。
    heroExpire: { color: colors.gold, fontSize: 11, lineHeight: 16, maxWidth: 200, marginTop: 2 },
    heroActions: { flexDirection: 'row', alignItems: 'center' },
    heroBtnPrimary: {
      backgroundColor: colors.gold, minHeight: 36, paddingHorizontal: 14,
      borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 10,
    },
    heroBtnPrimaryText: { color: '#1a1200', fontWeight: 'bold', fontSize: 13 },
    heroBtnSecondary: {
      backgroundColor: colors.surfaceAlt, minHeight: 36, paddingHorizontal: 14,
      borderRadius: 18, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: colors.borderStrong,
    },
    heroBtnSecondaryText: { color: colors.textSecondary, fontWeight: 'bold', fontSize: 13 },
    genderBtn: {
      paddingHorizontal: 16, borderRadius: 20, minHeight: 44,
      justifyContent: 'center', alignItems: 'center',
    },
  });

// 头像上传链路的日志前缀。真机排查时用 `adb logcat -s ReactNativeJS` 过滤。
const AVATAR_LOG = '[AVATAR]';

// 系统相册 / 照片选择器无响应的兜底时长（毫秒）。超时后走"提示 + 兜底捞取"，不让 UI 永久等待。
const PICK_TIMEOUT_MS = 30000;
// 上传请求超时兜底（毫秒）。
const UPLOAD_TIMEOUT_MS = 30000;

// Promise.race 的超时哨兵值，用于区分"超时"和"拿到结果"。
const AVATAR_PICK_TIMEOUT = 'AVATAR_PICK_TIMEOUT';

// 归一化后的待上传图片信息。
type AvatarAsset = { uri: string; name: string; type: string };

/**
 * 给任意 Promise 套一层超时兜底。
 * 超时则返回哨兵 AVATAR_PICK_TIMEOUT，调用方据此走降级/提示流程，而不是无限 await。
 */
function withAvatarTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof AVATAR_PICK_TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race<T | typeof AVATAR_PICK_TIMEOUT>([
    promise,
    new Promise<typeof AVATAR_PICK_TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(AVATAR_PICK_TIMEOUT), ms);
    }),
  ]).then((value) => {
    if (timer) clearTimeout(timer);
    return value;
  });
}

/**
 * 把 ImagePickerAsset 归一化成上传所需的 { uri, name, type }。
 * 拿不到 uri 时返回 null（视为无效选择）。
 */
function normalizeAvatarAsset(asset: any): AvatarAsset | null {
  const uri: string = asset?.uri || '';
  if (!uri) return null;
  const cleanUri = uri.split('?')[0] || '';
  const extMatch = /\.(\w+)$/.exec(cleanUri.toLowerCase());
  const ext = extMatch ? extMatch[1] : 'jpg';
  const type =
    ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
        : ext === 'gif' ? 'image/gif'
          : ext === 'bmp' ? 'image/bmp'
            : 'image/jpeg';
  const name: string = asset?.fileName || `avatar.${ext}`;
  console.log(
    `${AVATAR_LOG} asset 归一化`,
    JSON.stringify({ name, type, width: asset?.width ?? 0, height: asset?.height ?? 0 }),
  );
  return { uri, name, type };
}

export default function Profile({ navigation }: any) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [coinBalance, setCoinBalance] = useState(0);
  const [vip, setVip] = useState<any>(null);
  // 头像直径 = 「昵称+账户」两行文字块的**高度**（两排文字叠起来的那块宽度/厚度），让头像与文字块同高对齐
  const [avatarSize, setAvatarSize] = useState(60);
  const [editOpen, setEditOpen] = useState(false);
  const [editNickname, setEditNickname] = useState('');
  const [editAvatar, setEditAvatar] = useState('');
  // 头像本地上传中
  const [uploading, setUploading] = useState(false);
  const [editGender, setEditGender] = useState<'male' | 'female' | 'other' | ''>('');
  const [saving, setSaving] = useState(false);

  // 四个文字页签对应的数据（取消分页，一次性全量加载并展示）
  const [history, setHistory] = useState<any[]>([]);
  const [favorites, setFavorites] = useState<any[]>([]);
  const [likes, setLikes] = useState<any[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);
  const [listsLoading, setListsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<any>(null);

  // 加载用户信息、金币与 VIP 状态
  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    try {
      const u = await AsyncStorage.getItem('user_info');
      if (!u) { setUser(null); return; }
      let userInfo: any = null;
      try {
        const parsed = JSON.parse(u);
        userInfo = parsed && typeof parsed === 'object' ? parsed : null;
      } catch {
        await AsyncStorage.removeItem('user_info').catch(() => {});
        userInfo = null;
      }
      if (!userInfo) { setUser(null); return; }

      // 以服务端为准：本地 user_info 只是登录时的快照，必须与网页端一样拉一次。
      try {
        const remote: any = await userApi.profile();
        if (remote && typeof remote === 'object') {
          userInfo = { ...userInfo, ...remote };
          await AsyncStorage.setItem('user_info', JSON.stringify(userInfo)).catch(() => {});
        }
      } catch {
        // 拉不到就沿用本地快照（离线可用），不阻塞进入页面
      }

      if (userInfo.status === 'banned' || userInfo.status === 'disabled') {
        await AsyncStorage.multiRemove(['user_token', 'user_info']).catch(() => {});
        setUser(null);
        return;
      }

      setUser(userInfo);
      setEditNickname(userInfo.nickname || '');
      setEditAvatar(userInfo.avatar || '');
      setEditGender(userInfo.gender || '');

      // 金币与 VIP 并行拉取（取不到不阻塞页面）
      const [balance, vipRes] = await Promise.all([
        coinApi.balance().catch(() => ({ coins: 0, balance: 0 })),
        vipApi.my().catch(() => null),
      ]);
      setCoinBalance(balance?.coins ?? balance?.balance ?? 0);
      setVip(vipRes || null);
    } catch {}
    finally { if (showLoader) setLoading(false); }
  }, []);

  // 进入页面 / 每次聚焦：一次性拉取四个页签的全量数据（取消分页，直接全部展示）
  const loadLists = useCallback(async () => {
    setListsLoading(true);
    try {
      const [h, f, l, r] = await Promise.all([
        watchApi.history().catch(() => []),
        favoriteApi.list().catch(() => []),
        likeApi.list().catch(() => []),
        reservationApi.myList().catch(() => []),
      ]);
      setHistory(Array.isArray(h) ? h : (h?.list ?? []));
      setFavorites(Array.isArray(f) ? f : (f?.list ?? []));
      setLikes(Array.isArray(l) ? l : (l?.list ?? []));
      setReservations(Array.isArray(r) ? r : (r?.list ?? []));
    } catch {
      // 各接口已在 Promise.all 中各自兜底，这里仅防止意外异常
    } finally {
      setListsLoading(false);
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      load();
      loadLists();
    }, [load, loadLists])
  );

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const token = await AsyncStorage.getItem('user_token');
      const res = await fetch(`${API_BASE}/users/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ nickname: editNickname, avatar: editAvatar, gender: editGender }),
      });
      if (res.ok) {
        const updated = await res.json();
        const userInfo = { ...user, ...updated };
        await AsyncStorage.setItem('user_info', JSON.stringify(userInfo));
        setUser(userInfo);
        Alert.alert(t('wallet.profileUpdated'));
        setEditOpen(false);
      } else {
        Alert.alert(t('wallet.updateFailed'));
      }
    } catch {
      Alert.alert(t('wallet.updateFailed'));
    } finally {
      setSaving(false);
    }
  };

  // 头像：从本地相册选图 → 上传 /upload/image → 回填头像 URL。
  const pickAndUploadAvatar = async () => {
    if (uploading) return;
    setUploading(true);
    try {
      const asset = await pickAvatarAsset();
      if (!asset) return;
      await uploadAvatarAsset(asset);
    } catch (e: any) {
      console.log(`${AVATAR_LOG} 顶层未捕获异常`, String(e?.message ?? e));
      Alert.alert(t('wallet.uploadFailed'));
    } finally {
      setUploading(false);
      setEditOpen(true);
    }
  };

  const pickAvatarAsset = async (): Promise<AvatarAsset | null> => {
    setEditOpen(false);
    if (Platform.OS === 'android') {
      await new Promise((r) => setTimeout(r, 350));
    }
    let res: any = null;
    try {
      const raw = await withAvatarTimeout(
        ImagePicker.launchImageLibraryAsync({
          quality: 1,
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: false,
        }),
        PICK_TIMEOUT_MS,
      );
      if (raw === AVATAR_PICK_TIMEOUT) {
        const recovered = await recoverPendingPickResult();
        if (recovered) return recovered;
        Alert.alert(t('wallet.pickTimeout'));
        return null;
      }
      res = raw;
    } catch (e: any) {
      const recovered = await recoverPendingPickResult();
      if (recovered) return recovered;
      Alert.alert(t('wallet.pickFailed'));
      return null;
    }
    if (!res || res.canceled) return null;
    const asset = normalizeAvatarAsset(Array.isArray(res.assets) ? res.assets[0] : null);
    if (!asset) {
      Alert.alert(t('wallet.noImageSelected'));
      return null;
    }
    return asset;
  };

  const recoverPendingPickResult = async (): Promise<AvatarAsset | null> => {
    try {
      const pending: any = await ImagePicker.getPendingResultAsync();
      const list: any[] = Array.isArray(pending) ? pending : pending ? [pending] : [];
      for (const item of list) {
        const asset = normalizeAvatarAsset(Array.isArray(item?.assets) ? item.assets[0] : null);
        if (asset) return asset;
      }
    } catch (e: any) {
      console.log(`${AVATAR_LOG} 兜底捞取失败`, String(e?.message ?? e));
    }
    return null;
  };

  const uploadAvatarAsset = async (asset: AvatarAsset): Promise<void> => {
    const token = await AsyncStorage.getItem('user_token').catch(() => null);
    if (!token) {
      Alert.alert(t('wallet.loginRequired'));
      return;
    }
    const form = new FormData();
    form.append('file', { uri: asset.uri, name: asset.name, type: asset.type } as any);
    const controller: any = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), UPLOAD_TIMEOUT_MS);
    try {
      const r = await fetch(`${API_BASE}/upload/image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal: controller.signal,
      } as any);
      const d: any = await r.json().catch(() => ({}));
      if (r.ok && d?.url) {
        setEditAvatar(d.url);
        Alert.alert(t('wallet.avatarUploaded'));
      } else {
        Alert.alert(d?.message || t('wallet.uploadFailed'));
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        Alert.alert(t('wallet.uploadTimeout'));
      } else {
        Alert.alert(t('wallet.networkError'));
      }
    } finally {
      clearTimeout(timer);
    }
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
      <SafeAreaView style={[styles.center, { flex: 1 }]} edges={['bottom']}>
        <Text style={{ color: colors.muted, marginBottom: 16 }}>{t('profile.pleaseLogin')}</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('Login')}
          style={{ backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20, minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ color: '#fff' }}>{t('wallet.logIn')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // VIP 信息完全按 /vip/my 的真实订阅数据展示（后端返回 tierKey/tierName/status/endAt，没有 active 字段）
  const vipTierKey = vip?.tierKey || vip?.tier?.key || '';
  const tierLabelKey = vipTierKey ? `tier.${vipTierKey}` : '';
  const tierLabel = tierLabelKey ? t(tierLabelKey) : '';
  const vipName = tierLabel && tierLabel !== tierLabelKey
    ? tierLabel
    : (vip?.tierName || vip?.tier?.name || 'VIP');
  const vipEndAt = vip?.endAt ?? vip?.expiresAt ?? null;
  const vipActive = !!vip && !!vipTierKey
    && (!vip?.status || vip.status === 'active')
    && (!vipEndAt || new Date(vipEndAt).getTime() > Date.now());
  const vipExpireLabel = vipActive && vipEndAt
    ? t('vip.expiresOn', { date: formatDate(vipEndAt) })
    : '';
  // 已开通时按钮改「续费 VIP」；后端购买会从当前到期时间顺延
  const vipActionLabel = vipActive ? t('wallet.renewVip') : t('wallet.getVip');

  // 跳转到指定页签（点击页签或滑动结束后都会用）
  const goToTab = (i: number) => {
    setActiveTab(i);
    scrollRef.current?.scrollTo({ x: i * SCREEN.width, animated: true });
  };

  // 滑动结束：根据偏移量计算当前页签
  const onScrollEnd = (e: any) => {
    const idx = Math.round(e?.nativeEvent?.contentOffset?.x / SCREEN.width);
    if (idx >= 0 && idx < TABS.length) setActiveTab(idx);
  };

  // 渲染单条剧集列表项（左封面 + 右信息 + 最右时间），点击进入剧集详情 / 被点赞的那一集
  const renderListItem = (type: string, item: any) => {
    const drama = item?.drama ?? item ?? {};
    const onPress = () => {
      if (!drama?.id) return;
      if (type === 'likes' && item.episode) {
        navigation.navigate('Player', { dramaId: drama.id, epId: item.episode.id });
      } else {
        navigation.navigate('DramaDetail', { id: drama.id });
      }
    };
    const pos: number = Number(item?.position) || 0;
    const catName = drama?.category ? localizeCategory(t, drama.category) : '';
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.listItem}>
        <View style={styles.listCover}>
          {drama.cover ? (
            <Image source={{ uri: mediaUrl(drama.cover) }} style={styles.listCoverImg} />
          ) : (
            <Image source={require('../../assets/logo_mark.png')} style={{ width: 28, height: 28, opacity: 0.6 }} resizeMode="contain" />
          )}
        </View>
        <View style={styles.listInfo}>
          <Text style={styles.listTitle} numberOfLines={1}>{drama.title}</Text>
          {!!catName && <Text style={styles.listMeta} numberOfLines={1}>{catName}</Text>}
          {item.episodeNo != null && <Text style={styles.listMeta}>EP{item.episodeNo}</Text>}
          {type === 'likes' && item.episode && (
            <Text style={styles.listMetaPrimary}>{t('profile.likedEpisode', { no: item.episode.episodeNo })}</Text>
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
        </View>
        {type === 'history' && (
          <View style={styles.listTimeWrap}>
            <Text style={styles.listTime}>{formatDateTime(item.updatedAt)}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderPage = (type: string, data: any[]) => {
    if (listsLoading && data.length === 0) {
      return (
        <View style={[styles.empty, { justifyContent: 'center', flex: 1 }]}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      );
    }
    if (data.length === 0) {
      const emptyText =
        type === 'history' ? t('wallet.noHistory')
          : type === 'favorites' ? t('wallet.noFavorites')
          : type === 'likes' ? t('wallet.noLikes')
          : t('profile.noReservations');
      return (
        <View style={styles.empty}>
          <Text style={{ fontSize: 40, marginBottom: 8 }}>
            {type === 'history' ? '📺' : type === 'favorites' ? '⭐' : type === 'likes' ? '❤️' : '🔖'}
          </Text>
          <Text style={styles.emptyText}>{emptyText}</Text>
        </View>
      );
    }
    return (
      <FlatList
        data={data}
        keyExtractor={(item: any, index: number) => {
          const base = item?.id != null ? String(item.id) : (item?.drama?.id ?? `idx-${index}`);
          return base != null ? String(base) : `idx-${index}`;
        }}
        renderItem={({ item }) => renderListItem(type, item)}
        contentContainerStyle={{ padding: 12, paddingBottom: 20 }}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* 顶部栏：标题 + 右上角设置（外观 / 语言 / 修改密码 / 购买记录 / 关于 / 退出登录） */}
      <View style={[styles.topBar, { paddingTop: STATUS_TOP }]}>
        <Text style={styles.topTitle}>{t('tab.profile')}</Text>
        <TouchableOpacity
          style={styles.settingsBtn}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('Settings')}
          accessibilityRole="button"
          accessibilityLabel={t('profile.settings')}
        >
          <View style={styles.hamburger}>
            <View style={[styles.hamburgerLine, { backgroundColor: colors.text }]} />
            <View style={[styles.hamburgerLine, { backgroundColor: colors.text }]} />
            <View style={[styles.hamburgerLine, { backgroundColor: colors.text }]} />
          </View>
        </TouchableOpacity>
      </View>

      {/* 个人信息 Hero：第一行 头像 + 左列(昵称/账户) 与 右列(年度VIP徽章/到期时间)；第二行 金币文字 + 双按钮（同一水平线） */}
      <View style={styles.heroCard}>
        {/* 第一行：头像与右侧「昵称行 + 账户行」两行信息左右对齐，头像高度与两行整体一致 */}
        <View style={styles.heroTopRow}>
          {/* 头像：直径动态 = 右侧「昵称+账户」文字块的实际宽度（由下方 onLayout 测得） */}
          <View style={[styles.heroLeft, { width: avatarSize, height: avatarSize }]}>
            {user.avatar ? (
              <Image
                source={{ uri: mediaUrl(user.avatar) }}
                style={{ width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2, backgroundColor: colors.surfaceAlt }}
              />
            ) : (
              <View style={[styles.heroAvatarPlaceholder, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2, backgroundColor: colors.surfaceAlt }]}>
                <Text style={{ color: colors.gold, fontSize: Math.round(avatarSize * 0.42), fontWeight: 'bold' }}>
                  {user.nickname?.[0] || user.username?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '👤'}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.heroRight}>
            {/* 左列：昵称 + 账户（账号优先，兼容老邮箱用户），与右侧 VIP 组左右分离，互不冲突 */}
            <View style={styles.heroInfoCol}>
              <View
                style={{ alignSelf: 'flex-start' }}
                onLayout={(e) => {
                  const h = Math.round(e.nativeEvent.layout.height);
                  if (h > 0 && Math.abs(h - avatarSize) > 1) {
                    setAvatarSize(Math.max(40, Math.min(h, 90)));
                  }
                }}
              >
                <Text
                  style={styles.heroNickname}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.9}
                >
                  {user.nickname || t('wallet.nickname')}
                </Text>
                <Text style={styles.heroAccount} numberOfLines={1} adjustsFontSizeToFit>
                  {user.username || user.email || user.nickname || ''}
                </Text>
              </View>
            </View>
            {/* 右列：年度 VIP 徽章 + 到期时间（二者左对齐，整体靠右，不与昵称/账户冲突） */}
            <View style={styles.heroVipCol}>
              <View style={styles.heroVipWrap}>
                <View style={[styles.heroVipBadge, !vipActive && styles.heroVipBadgeInactive]}>
                  <Text style={[styles.heroVipText, !vipActive && styles.heroVipTextInactive]} numberOfLines={1}>
                    {vipActive ? `⭐ ${vipName}` : t('wallet.vipNone')}
                  </Text>
                </View>
              </View>
              {!!vipExpireLabel && (
                <Text style={styles.heroExpire} numberOfLines={1}>{vipExpireLabel}</Text>
              )}
            </View>
          </View>
        </View>

        {/* 第二行：金币数量（无框）与「开通/续费 VIP」「编辑资料」按钮位于同一水平线，且整体在头像下方 */}
        <View style={styles.heroBottomRow}>
          <View style={styles.heroCoinsBox}>
            <Text style={styles.heroCoinsText} numberOfLines={1}>
              🪙 {coinBalance.toLocaleString()}
            </Text>
          </View>
          <View style={styles.heroActions}>
            <TouchableOpacity
              onPress={() => navigation.navigate('VIP')}
              style={styles.heroBtnPrimary}
              activeOpacity={0.8}
            >
              <Text style={styles.heroBtnPrimaryText}>{vipActionLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setEditOpen(true)} style={styles.heroBtnSecondary}>
              <Text style={styles.heroBtnSecondaryText}>{t('wallet.editProfile')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* 文字页签栏（与网页端一致） + 滑动指示条 */}
      <View style={styles.tabBar}>
        {TABS.map((tab, i) => (
          <TouchableOpacity
            key={tab.key}
            style={styles.tabItem}
            activeOpacity={0.7}
            onPress={() => goToTab(i)}
          >
            <Text style={[styles.tabText, activeTab === i && styles.tabTextActive]}>{t(tab.labelKey)}</Text>
          </TouchableOpacity>
        ))}
        <Animated.View
          style={[
            styles.tabIndicator,
            {
              transform: [
                {
                  translateX: scrollX.interpolate({
                    inputRange: [0, SCREEN.width],
                    outputRange: [0, SCREEN.width / TABS.length],
                    extrapolateRight: 'extend',
                  }),
                },
              ],
            },
          ]}
        />
      </View>

      {/* 左右滑动的剧集列表（每页一个页签，带滑动动画） */}
      <View style={{ flex: 1 }}>
        <Animated.ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            { useNativeDriver: true },
          )}
          onMomentumScrollEnd={onScrollEnd}
        >
          {TABS.map((tab) => (
            <View key={tab.key} style={{ width: SCREEN.width }}>
              {renderPage(tab.key, tab.key === 'history' ? history : tab.key === 'favorites' ? favorites : tab.key === 'likes' ? likes : reservations)}
            </View>
          ))}
        </Animated.ScrollView>
      </View>

      {/* 编辑资料 Modal */}
      <Modal visible={editOpen} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('wallet.editProfile')}</Text>

            <Text style={styles.modalLabel}>{t('wallet.nickname')}</Text>
            <TextInput
              value={editNickname}
              onChangeText={setEditNickname}
              style={styles.modalInput}
              placeholder={t('wallet.nickname')}
              placeholderTextColor={colors.subtle}
            />

            <Text style={styles.modalLabel}>{t('wallet.avatarUrl')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 12 }}>
              {editAvatar ? (
                <Image source={{ uri: mediaUrl(editAvatar) }} style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surface }} />
              ) : (
                <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 24 }}>👤</Text>
                </View>
              )}
              <TouchableOpacity
                onPress={pickAndUploadAvatar}
                disabled={uploading}
                activeOpacity={0.8}
                style={{
                  minHeight: 44, paddingHorizontal: 16, borderRadius: 999,
                  backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
                  opacity: uploading ? 0.5 : 1,
                }}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>
                  {uploading ? t('common.loading') : t('wallet.pickImage')}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalLabel}>{t('wallet.gender')}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
              {(['male', 'female', 'other'] as const).map((g) => (
                <TouchableOpacity
                  key={g}
                  onPress={() => setEditGender(g)}
                  style={[
                    styles.genderBtn,
                    { backgroundColor: editGender === g ? colors.primary : colors.surface },
                  ]}
                >
                  <Text style={{ color: editGender === g ? '#fff' : colors.text }}>
                    {g === 'male' ? t('wallet.male') : g === 'female' ? t('wallet.female') : t('wallet.other')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity onPress={handleSaveProfile} disabled={saving}
              style={[styles.modalBtn, { opacity: saving ? 0.5 : 1 }]}>
              <Text style={styles.modalBtnText}>{saving ? t('common.loading') : t('wallet.save')}</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setEditOpen(false)} style={{ marginTop: 12, padding: 8 }}>
              <Text style={{ color: colors.muted, textAlign: 'center' }}>{t('wallet.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}
