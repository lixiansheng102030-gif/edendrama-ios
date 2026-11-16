import { Alert } from 'react-native';

// 全局「登录态失效」事件总线。
//
// 背景：各页面（Profile / Library / Wallet 等）各自从 AsyncStorage 读 user_token/user_info
// 判定登录态，互不同步。api.ts 的 401 拦截器在 token 失效时会静默清除登录态，于是出现
// 「这个页面还显示已登录、那个页面（如任务中心）却显示未登录」的状态分裂。
//
// 解法：401 时除了清 token，再发一个全局事件；由 App.tsx 注册的唯一 handler 统一弹出
// 「登录已失效，请重新登录」并跳转到登录页，使失效在全应用一致且可见，而不是静默、局部地登出。
let handler: (() => void) | null = null;
let emitted = false;

/** App 启动时注册唯一的会话失效处理器（弹窗 + 跳转登录）。 */
export function setSessionExpiredHandler(fn: () => void) {
  handler = fn;
}

/** 由 api.ts 的 401 拦截器调用：触发一次会话失效处理。重复 401 只提示一次。 */
export function emitSessionExpired() {
  if (emitted) return;
  emitted = true;
  if (handler) handler();
}

/** 登录/注册成功后调用：重置标记，使下一次真正的失效能再次提醒。 */
export function resetSessionExpired() {
  emitted = false;
}

/** 兼容旧调用方：直接用 Alert 兜底（无自定义 handler 时）。 */
export function fallbackSessionExpired(title: string, message: string) {
  Alert.alert(title, message);
}
