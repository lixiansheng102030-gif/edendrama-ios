// 客户端当前版本号（用于「检查更新」与后台发布版本对比）。
// ⚠️ 必须与 android/app/build.gradle 中的 versionCode / versionName 保持一致；
//    每次发版打新包时同步 +1，后台「版本管理」发布更大的 versionCode 后客户端即可收到更新提示。
export const APP_VERSION_CODE = 1;
export const APP_VERSION_NAME = '1.0.0';
