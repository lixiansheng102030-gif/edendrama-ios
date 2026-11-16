import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { emitSessionExpired } from './session';

// 后端地址以这里为准（会打进 JS bundle）。
// 注意：不要再改回读 Constants.expoConfig.extra.apiBaseUrl —— APK 里的 assets/app.config
// 是 expo prebuild 生成的产物，改 app.json 后 Gradle 不会重新生成它，读到的会是旧地址。
// 后端地址以这里为准（会打进 JS bundle）。
// 后端地址：当前用宿主以太网口 192.168.31.111 直连（手机与 PC 在同一局域网 192.168.31.0/24 时生效）。
// 手机直接连 http://192.168.31.111:3000，由 PC 的 netsh portproxy 转发到 VM 后端 192.168.204.130:3000，不经 adb reverse。
// ✅ 已实测（2026-10-23）：手机从 192.168.31.164 拉取 /dramas 完整 28KB 响应成功；192.168.31.x 子网无大包 TCP 卡死
//    （此前 192.168.100.x 的 PMTUD 黑洞已随该网段失效而不影响本环境）。
// ⚠️ 宿主 IP 走 DHCP 会漂移（约两天一变）。若 192.168.31.111 失效，需改此处 IP 并重跑 _upload_api.py + _build_apk.py；
//    且手机必须仍在此 PC 的同一网段（否则连不到 192.168.31.111）。
//    改完跑 _upload_api.py 再 _build_apk.py。
// 🌐 后端地址（2026-11-02）：当前走**局域网**版——手机与 PC 在同一 WiFi(192.168.31.0/24)，
//    直连 http://192.168.31.111:3000，由 PC 的 netsh portproxy 转发到 VM 后端 192.168.204.130:3000。
//    外网临时域名 confidentiality-rock-tent-consultants.trycloudflare.com 已就绪、待 cloudflared 隧道
//    重开后用；届时改回该域名并重打包即可（API_BASE 会打进 JS bundle）。
export const API_BASE = 'http://192.168.31.111:3000';

const api = axios.create({ baseURL: API_BASE, timeout: 15000 });

api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('user_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 统一失效处理：token 过期/被吊销/密钥轮换后，清除本地登录态，
// 各页面按 user_token 判定会回到未登录态，避免「有 token 但全部 401」的登录态分裂。
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const url = String(err?.config?.url || '');
    if (err?.response?.status === 401 && !url.includes('/auth/login')) {
      // 只有"本来已登录（本地存在 token）却 401"才算会话失效。
      // 游客（无 token）访问需登录的接口而返回 401 属正常，不应弹"登录失效"。
      let hadToken = false;
      try {
        hadToken = !!(await AsyncStorage.getItem('user_token'));
      } catch { /* ignore */ }
      if (hadToken) {
        try {
          await AsyncStorage.multiRemove(['user_token', 'user_info']);
        } catch { /* ignore */ }
        // 通知全应用：登录态已失效（token 过期 / 被吊销 / 后端密钥轮换等）。
        emitSessionExpired();
      }
    }
    return Promise.reject(err);
  },
);

export const authApi = {
  // 登录账户：可为「账号(username)」或「邮箱(email)」（后端按两者匹配）
  login: (account: string, password: string) => api.post('/auth/login', { account, password }).then((r) => r.data),
  // 注册：改填「账号」(username) 作为唯一标识，邮箱不再必填
  register: (username: string, password: string, nickname?: string, confirmPassword?: string) =>
    api.post('/auth/register', { username, password, nickname, confirmPassword }).then((r) => r.data),
  // Google 登录：前端拿到 Google 返回的 id_token(credential) 后交给后端校验/自动注册
  google: (idToken: string) => api.post('/auth/google', { idToken }).then((r) => r.data),
};

export const dramaApi = {
  home: () => api.get('/dramas/home').then((r) => r.data),
  detail: (id: string) => api.get(`/dramas/${id}`).then((r) => r.data),
  list: (params?: any) => api.get('/dramas', { params }).then((r) => r.data),
  recommend: (params?: any) => api.get('/dramas/recommend', { params }).then((r) => r.data),
};

// 首页 Banner 轮播（后台可配）
export const bannerApi = {
  list: () => api.get('/banners').then((r) => r.data),
};

// 筛选分组 + 标签（题材 / 设定 / 推荐 / 时间 / 长度）
export const filterApi = {
  list: () => api.get('/filters').then((r) => r.data),
};

export const watchApi = {
  continue: () => api.get('/watch/continue').then((r) => r.data),
  saveProgress: (data: any) => api.post('/watch/progress', data).then((r) => r.data),
  // 观看记录：completed=true 只看已看完，false 只看未看完；不传则返回全部。
  // page + pageSize 提供时走分页（返回 { list, total, page, pageSize }）。
  history: (completed?: boolean, page?: number, pageSize?: number) => {
    const params: any = {};
    if (completed !== undefined) params.completed = completed;
    if (page != null) params.page = page;
    if (pageSize != null) params.pageSize = pageSize;
    return api.get('/watch/history', { params }).then((r) => r.data);
  },
  // 删除单条观看记录
  deleteProgress: (id: string) => api.delete(`/watch/progress/${id}`).then((r) => r.data),
  // 批量删除观看记录
  deleteBatch: (ids: string[]) => api.post('/watch/progress/delete-batch', { ids }).then((r) => r.data),
};

export const favoriteApi = {
  list: (page?: number, pageSize?: number) =>
    api
      .get('/favorites', { params: page != null && pageSize != null ? { page, pageSize } : {} })
      .then((r) => r.data),
  toggle: (dramaId: string) => api.post(`/favorites/${dramaId}`).then((r) => r.data),
  check: (dramaId: string) => api.get(`/favorites/${dramaId}`).then((r) => r.data),
};

export const likeApi = {
  toggle: (episodeId: string) => api.post(`/likes/episode/${episodeId}`).then((r) => r.data),
  list: (page?: number, pageSize?: number) =>
    api
      .get('/likes', { params: page != null && pageSize != null ? { page, pageSize } : {} })
      .then((r) => r.data),
  check: (episodeId: string) => api.get(`/likes/episode/${episodeId}`).then((r) => r.data),
  // 剧集级点赞（预约剧等无分集场景）
  toggleDrama: (dramaId: string) => api.post(`/likes/drama/${dramaId}`).then((r) => r.data),
  checkDrama: (dramaId: string) => api.get(`/likes/drama/${dramaId}`).then((r) => r.data),
};

// 分集评论 / 剧评 / 评分
export const commentApi = {
  list: (params: { episodeId?: string; dramaId?: string; page?: number; pageSize?: number }) =>
    api.get('/comments', { params }).then((r) => r.data),
  summary: (dramaId: string) => api.get(`/comments/summary/${dramaId}`).then((r) => r.data),
  eligibility: (dramaId: string) => api.get(`/comments/eligibility/${dramaId}`).then((r) => r.data),
  // 评论可挂在分集或整部剧上（如预告片）
  create: (data: { episodeId?: string; dramaId?: string; content: string; rating?: number }) =>
    api.post('/comments', data).then((r) => r.data),
  reply: (commentId: string, content: string) =>
    api.post(`/comments/${commentId}/reply`, { content }).then((r) => r.data),
  like: (commentId: string) => api.post(`/comments/${commentId}/like`).then((r) => r.data),
};

export const paymentApi = {
  myOrders: () => api.get('/payments/my-orders').then((r) => r.data),
  checkOwnership: (dramaId: string) => api.get(`/payments/check/${dramaId}`).then((r) => r.data),
  unlockEpisodes: (dramaId: string, episodeIds: string[]) =>
    api.post('/payments/episodes/unlock', { dramaId, episodeIds }).then((r) => r.data),
  unlockedEpisodes: (dramaId: string) =>
    api.get(`/payments/episodes/unlocked/${dramaId}`).then((r) => r.data),
  unlockWithCoins: (dramaId: string) => api.post('/payments/coins/unlock', { dramaId }).then((r) => r.data),
};

// Coin API
export const coinApi = {
  balance: () => api.get('/coins/balance').then((r) => r.data),
  // 后端 /coins/transactions 已支持 reason(模糊) / from / to(ISO 时间范围) 筛选。
  // 传 opts 时自动拼到 query 上；不传则保持原来的纯分页行为（其它调用方不受影响）。
  transactions: (
    page = 1,
    pageSize = 10,
    opts?: { reason?: string; from?: string; to?: string },
  ) => {
    const params: any = { page, pageSize };
    if (opts?.reason) params.reason = opts.reason;
    if (opts?.from) params.from = opts.from;
    if (opts?.to) params.to = opts.to;
    return api.get('/coins/transactions', { params }).then((r) => r.data);
  },
  unlockDrama: (dramaId: string) => api.post(`/coins/unlock-drama/${dramaId}`).then((r) => r.data),
};

// Task API
export const taskApi = {
  center: () => api.get('/tasks/center').then((r) => r.data),
  complete: (taskKey: string) => api.post(`/tasks/${taskKey}/complete`).then((r) => r.data),
  claim: (taskKey: string) => api.post(`/tasks/${taskKey}/claim`).then((r) => r.data),
  checkin: () => api.post('/tasks/checkin').then((r) => r.data),
  checkinCalendar: (month: string) =>
    api.get(`/tasks/checkin/calendar?month=${month}`).then((r) => r.data),
  // 观看时长档位领取：单个档 {minutes} 或一键领取 {all:true}；后端真实加币
  claimWatch: (payload: { minutes?: number; all?: boolean }) =>
    api.post('/tasks/watch/claim', payload).then((r) => r.data),
};

// VIP API
export const vipApi = {
  tiers: () => api.get('/vip/tiers').then((r) => r.data),
  my: () => api.get('/vip/my').then((r) => r.data),
  purchase: (tierId: string) => api.post('/vip/purchase', { tierId }).then((r) => r.data),
  createOrder: (tierId: string, currency: string) =>
    api.post('/vip/purchase/order', { tierId, currency }).then((r) => r.data),
  confirmOrder: (orderId: string) =>
    api.post(`/vip/purchase/confirm/${orderId}`).then((r) => r.data),
};

// 用户资料 API（与网页端同源：GET /users/profile）
export const userApi = {
  profile: () => api.get('/users/profile').then((r) => r.data),
};

// Settings API
export const settingsApi = {
  get: () => api.get('/settings').then((r) => r.data),
  about: () => api.get('/settings/about').then((r) => r.data),
};

// App 版本 / 检查更新：返回后台已发布的最新版本（无需登录）
export const appApi = {
  latest: () => api.get('/settings/app-version').then((r) => r.data),
};

// 视频清晰度：按需获取某分集在指定清晰度下的播放地址（后端按需转码 + 缓存）
export const videoApi = {
  getQuality: (episodeId: string, quality: string) =>
    api.post('/videos/quality', { episodeId, quality }).then((r) => r.data),
};

// 预约 API
export const reservationApi = {
  upcoming: () => api.get('/dramas/upcoming').then((r) => r.data),
  toggle: (dramaId: string) => api.post(`/reservations/${dramaId}`).then((r) => r.data),
  check: (dramaId: string) => api.get(`/reservations/check/${dramaId}`).then((r) => r.data),
  myList: (page?: number, pageSize?: number) =>
    api
      .get('/reservations', { params: page != null && pageSize != null ? { page, pageSize } : {} })
      .then((r) => r.data),
};

// 站内消息 API
export const messageApi = {
  list: (page = 1, pageSize = 20) =>
    api.get(`/messages?page=${page}&pageSize=${pageSize}`).then((r) => r.data),
  unreadCount: () => api.get('/messages/unread-count').then((r) => r.data),
  markRead: (id: string) => api.post(`/messages/${id}/read`).then((r) => r.data),
  markAllRead: () => api.post('/messages/read-all').then((r) => r.data),
  remove: (id: string) => api.delete(`/messages/${id}`).then((r) => r.data),
};

/**
 * 后端返回的封面 / 视频 / 头像可能是绝对地址，形如 http://<任意host>:3000/media/xxx。
 * 这个 host 来自服务端配置，往往是 VM 的内网地址（如 192.168.204.130），手机未必能访问，
 * 表现就是"封面空白、视频加载不出来"。统一改写成走当前 API_BASE，与网页端的 mediaUrl() 保持一致。
 */
export function mediaUrl(url?: string | null): string {
  if (!url) return '';
  const s = String(url);
  const media = s.match(/^https?:\/\/[^/]+(\/media\/.*)$/i);
  if (media) return `${API_BASE}${media[1]}`;
  // 后端返回站内相对路径（/media/...）时同样补上 API 前缀
  if (s.startsWith('/')) return `${API_BASE}${s}`;
  return s;
}
