import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator, ScrollView, Platform, Linking, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { authApi, API_BASE } from '../api';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';
import { resetSessionExpired } from '../session';

// 让 WebBrowser 在从 Google 回调跳回应用后能正确收尾（必须放在模块顶层）
WebBrowser.maybeCompleteAuthSession();

// ── Google 登录配置 ────────────────────────────────────────────────────────────
// GOOGLE_WEB_CLIENT_ID：与网页端共用的「Web 应用」OAuth 客户端 ID（见 web/.env.production），
//   用于换取 id_token；网页端 Google 登录已经在用这个 ID。
// GOOGLE_ANDROID_CLIENT_ID：手机端必须使用 Google Cloud Console 中新建的「Android」类型客户端，
//   包名填 com.edendrama.app，并填入 APK 的发布签名 SHA-1（缺一不可，否则会报 ApiException: 10）。
//   未填写时点击 Google 入口只会给出「未配置」提示，不会静默失效。
// 说明：这两个 ID 属于公开信息（会打进包内），不涉及密钥泄露。
const GOOGLE_WEB_CLIENT_ID = '134910997733-bc17256gv10tp417cdi4rsd97qagqmba.apps.googleusercontent.com';
const GOOGLE_ANDROID_CLIENT_ID = '';

// 当前平台是否已具备可用的 Google 配置
const GOOGLE_CONFIGURED =
  Platform.OS === 'android' ? !!GOOGLE_ANDROID_CLIENT_ID : !!GOOGLE_WEB_CLIENT_ID;

// 第三方登录入口，与网页端保持一致。
// 后端目前只有「Google id_token」这一个真实换取接口（POST /auth/google）；
// Twitter / Apple / Telegram 后端暂无接口，继续给出占位提示。
const SOCIAL_KEYS = ['google', 'twitter', 'apple', 'telegram'] as const;
const SOCIAL_ICONS: Record<(typeof SOCIAL_KEYS)[number], string> = {
  // Google 用大写「G」并配 Google 品牌蓝，避免被误认成通用地球图标
  google: 'G',
  twitter: '🐦',
  apple: '🍎',
  telegram: '✈️',
};

// 安全保存登录态：user 必须是对象，避免把 undefined/null 存成 "undefined" 字符串，
// 否则下次 Profile 读取时 JSON.parse("undefined") 会抛异常导致整页崩溃（闪退）。
const storeSession = async (data: any) => {
  const user = data?.user && typeof data.user === 'object' ? data.user : null;
  await AsyncStorage.setItem('user_token', String(data?.accessToken ?? ''));
  await AsyncStorage.setItem('user_info', JSON.stringify(user || {}));
  await AsyncStorage.removeItem('guest_mode');
  // 登录/注册成功即开启新的有效会话，重置「登录失效」提醒标记，
  // 使下一次真正的 token 失效能再次提示并跳转。
  resetSessionExpired();
};

export default function Login({ navigation }: any) {
  const { t, loginMethodsEnabled } = useI18n();
  // 只有第三方登录受后台开关控制；账号密码与游客是基础方式，始终显示
  const socialKeys = SOCIAL_KEYS.filter((k) => (loginMethodsEnabled as any)[k] !== false);
  const { colors } = useTheme();
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  // 注册模式新增：昵称 + 密码二次确认
  const [nickname, setNickname] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // 登录成功后安全返回：优先 goBack，若没有上一页（例如从“重置栈”进入）则跳回主页，
  // 避免 navigation.goBack() 在空栈上抛出异常或卡死。
  const safeGoBack = () => {
    try {
      if (typeof navigation?.canGoBack === 'function' && navigation.canGoBack()) {
        navigation.goBack();
      } else {
        navigation.navigate('Main');
      }
    } catch {
      try { navigation.navigate('Main'); } catch {}
    }
  };

  // 注意：Google.useIdTokenAuthRequest 内部要求 clientId 非空，因此始终传入 web client。
  // Android 端只有在配置了 androidClientId 后才会真正发起授权请求。
  const [, response, promptGoogle] = Google.useIdTokenAuthRequest({
    clientId: GOOGLE_WEB_CLIENT_ID,
    webClientId: GOOGLE_WEB_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID || undefined,
  });

  // 用 Google 返回的 id_token 换本应用 token（与邮箱登录共用同一套存储）
  const completeGoogleLogin = async (idToken: string) => {
    setGoogleLoading(true);
    try {
      const data: any = await authApi.google(idToken);
      if (!data?.accessToken) throw new Error('NO_TOKEN');
      await storeSession(data);
      safeGoBack();
    } catch (e: any) {
      const status = e?.response?.status;
      const msg = status
        ? (e?.response?.data?.message || t('login.googleFailed'))
        : t('login.networkError');
      Alert.alert(t('common.error'), String(msg));
    } finally {
      setGoogleLoading(false);
    }
  };

  // 监听 Google 授权结果
  useEffect(() => {
    if (!response) return;
    if (response.type === 'success') {
      const idToken =
        (response.params as any)?.id_token || (response as any)?.authentication?.idToken;
      if (!idToken) {
        Alert.alert(t('common.error'), t('login.googleFailed'));
        return;
      }
      completeGoogleLogin(idToken);
    } else if (response.type === 'error') {
      Alert.alert(t('common.error'), response.error?.message || t('login.googleFailed'));
    }
    // 'dismiss' / 'cancel' 为用户主动取消，无需提示
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  const submit = async () => {
    if (submitting) return;
    if (!account.trim() || !password) {
      Alert.alert(t('common.error'), t('login.emptyFields'));
      return;
    }
    if (mode === 'register') {
      if (!nickname.trim()) {
        Alert.alert(t('common.error'), t('login.emptyNickname'));
        return;
      }
      if (password !== confirmPassword) {
        Alert.alert(t('common.error'), t('login.passwordMismatch'));
        return;
      }
    }
    setSubmitting(true);
    try {
      const data: any = mode === 'login'
        ? await authApi.login(account.trim(), password)
        : await authApi.register(account.trim(), password, nickname.trim(), confirmPassword);
      if (!data?.accessToken) throw new Error('NO_TOKEN');
      // 兼容较旧后端：登录/注册响应可能不含 username，本地补上账号，
      // 保证 Profile「账户」行对账号注册用户显示账号而不是昵称/空白。
      if (data.user && typeof data.user === 'object' && !data.user.username) {
        const acct = account.trim();
        if (mode === 'register' || !acct.includes('@')) data.user.username = acct;
      }
      await storeSession(data);
      // 登录成功要清掉游客标记，否则首页可能仍按游客处理
      safeGoBack();
    } catch (e: any) {
      // 区分「连不上服务器」「密码错」「其他服务端错误」，给出明确提示
      const status = e?.response?.status;
      let msg: string;
      if (!status) {
        msg = t('login.networkError');
      } else if (status === 401 && mode === 'login') {
        // 账号/密码登录返回 401 → 明确提示凭据错误
        msg = t('login.invalidCredentials');
      } else if (status === 409 && mode === 'register') {
        // 账号已注册 → 本地化提示（后端同时返回中文 message 作兜底）
        msg = t('login.accountExists');
      } else {
        msg = e?.response?.data?.message || (mode === 'login' ? t('login.loginFailed') : t('login.registerFailed'));
      }
      Alert.alert(t('common.error'), String(msg));
    } finally {
      setSubmitting(false);
    }
  };

  // 点击第三方入口：Google 走 expo-auth-session；其余平台统一跳后端 OAuth 中转页（浏览器授权，回来即登录）
  const onPressSocial = async (key: (typeof SOCIAL_KEYS)[number]) => {
    if (key !== 'google') {
      // 后端 /auth/oauth/:provider/start 按后台配置跳转对应平台；未配置时后端返回提示页
      const url = `${API_BASE}/auth/oauth/${key}/start`;
      try {
        await Linking.openURL(url);
      } catch {
        Alert.alert(t('common.error'), t('login.providerNotConfigured'));
      }
      return;
    }
    if (googleLoading) return;
    if (!GOOGLE_CONFIGURED) {
      Alert.alert(t('login.google'), t('login.googleNotConfigured'));
      return;
    }
    try {
      await promptGoogle();
    } catch {
      Alert.alert(t('common.error'), t('login.googleFailed'));
    }
  };

  return (
    // 该页带 navigation header，因此 SafeAreaView 只需处理底部安全区
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* 整页内容较长，用 ScrollView 包裹，小屏 + 键盘弹出时也能滚动到输入框/按钮 */}
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 32 }}>
          <Image
            source={require('../../assets/logo_mark.png')}
            style={{ width: 52, height: 52 }}
          />
          <Text style={{ color: colors.primary, fontSize: 30, fontWeight: 'bold', marginLeft: 6 }}>
            {t('login.appTitle')}
          </Text>
        </View>

        {/* 账号密码登录 / 注册：始终显示（基础登录方式，后台不提供关闭） */}
        <TextInput
          placeholder={t('login.account')}
          placeholderTextColor={colors.subtle}
          autoCapitalize="none"
          value={account}
          onChangeText={setAccount}
          style={{ backgroundColor: colors.surface, color: colors.text, padding: 14, minHeight: 48, borderRadius: 12, marginBottom: 12 }}
        />
        {mode === 'register' && (
          <TextInput
            placeholder={t('login.nickname')}
            placeholderTextColor={colors.subtle}
            value={nickname}
            onChangeText={setNickname}
            style={{ backgroundColor: colors.surface, color: colors.text, padding: 14, minHeight: 48, borderRadius: 12, marginBottom: 12 }}
          />
        )}
        <TextInput
          placeholder={t('login.password')}
          placeholderTextColor={colors.subtle}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          style={{ backgroundColor: colors.surface, color: colors.text, padding: 14, minHeight: 48, borderRadius: 12, marginBottom: mode === 'register' ? 12 : 16 }}
        />
        {mode === 'register' && (
          <TextInput
            placeholder={t('login.confirmPassword')}
            placeholderTextColor={colors.subtle}
            secureTextEntry
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            style={{ backgroundColor: colors.surface, color: colors.text, padding: 14, minHeight: 48, borderRadius: 12, marginBottom: 16 }}
          />
        )}

        <TouchableOpacity
          onPress={submit}
          disabled={submitting}
          style={{ backgroundColor: colors.primary, paddingVertical: 14, minHeight: 48, borderRadius: 12, alignItems: 'center', opacity: submitting ? 0.6 : 1, flexDirection: 'row', justifyContent: 'center', gap: 8 }}
        >
          {submitting && <ActivityIndicator color={colors.text} size="small" />}
          <Text style={{ color: colors.text, fontWeight: 'bold' }}>
            {submitting ? t('login.submitting') : (mode === 'login' ? t('login.logIn') : t('login.signUp'))}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setMode(mode === 'login' ? 'register' : 'login')} style={{ marginTop: 16 }} disabled={submitting}>
          <Text style={{ color: colors.muted, textAlign: 'center' }}>
            {mode === 'login' ? t('login.noAccountSignUp') : t('login.haveAccountLogIn')}
          </Text>
        </TouchableOpacity>

        {/* 第三方登录方式：分隔线 + 各入口（登录/注册模式都展示）；全部关闭时整块不渲染 */}
        {socialKeys.length > 0 && (
          <>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 24, marginBottom: 12 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
          <Text style={{ color: colors.subtle, fontSize: 12, marginHorizontal: 10 }}>
            {mode === 'login' ? t('login.orDivider') : t('login.moreWaysToRegister')}
          </Text>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
        </View>

        {/* 第三方登录方式：纯文字、每排显示一个（登录/注册模式都展示） */}
        <View style={{ marginTop: 4 }}>
          {socialKeys.map((key) => {
            // Google 正在唤起授权时给一个加载反馈，避免看起来像没反应
            const loadingThis = key === 'google' && googleLoading;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => onPressSocial(key)}
                disabled={loadingThis}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingVertical: 12,
                  minHeight: 48,
                  marginBottom: 10,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: colors.borderStrong,
                  backgroundColor: colors.surface,
                  opacity: loadingThis ? 0.6 : 1,
                }}
              >
                {loadingThis
                  ? <ActivityIndicator color={colors.text} size="small" />
                  : <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'center' }}>{t(`login.${key}`)}</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
          </>
        )}

        {/* 游客浏览：保底出口，始终显示（不接后台开关） */}
        <TouchableOpacity
          onPress={async () => {
            await AsyncStorage.setItem('guest_mode', '1');
            // 退出登录会把栈 reset 成只剩 Login，此时 goBack 是 no-op，需回到 Main
            if (navigation.canGoBack?.()) navigation.goBack();
            else (navigation as any).reset({ index: 0, routes: [{ name: 'Main' }] });
          }}
          style={{ marginTop: 20, paddingVertical: 12, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center' }}
        >
          <Text style={{ color: colors.textSecondary, fontWeight: '500' }}>{t('login.guestBrowse')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}