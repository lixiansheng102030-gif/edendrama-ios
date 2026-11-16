import React, { useEffect } from 'react';
import { View, Pressable, Text, Alert, Linking } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { userApi } from './src/api';
import { setSessionExpiredHandler } from './src/session';
import Home from './src/screens/Home';
import FeedScreen from './src/screens/FeedScreen';
import SearchScreen from './src/screens/SearchScreen';
import DramaDetail from './src/screens/DramaDetail';
import Player from './src/screens/Player';
import Library from './src/screens/Library';
import Login from './src/screens/Login';
import Profile from './src/screens/Profile';
import VIPScreen from './src/screens/VIPScreen';
import Messages from './src/screens/Messages';
import WalletHistory from './src/screens/WalletHistory';
import CategoryList from './src/screens/CategoryList';
import SettingsScreen from './src/screens/SettingsScreen';
import { LanguageProvider, useI18n } from './src/i18n/LanguageContext';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import ErrorBoundary from './src/components/ErrorBoundary';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// 根栈路由表：供全局 navigationRef 类型化，使 navigate('Login') 等能被 TS 识别。
type RootStackParamList = {
  Main: undefined;
  DramaDetail: undefined;
  Player: undefined;
  Search: undefined;
  Login: undefined;
  Profile: undefined;
  Messages: undefined;
  VIP: undefined;
  WalletHistory: undefined;
  CategoryList: undefined;
};

// 全局导航引用：供 session.ts 的「登录失效」handler 在任意位置跳转到登录页。
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

// 自定义底部 Tab 栏：完全掌控高度 + 标签置顶 + 底部安全区。
// 默认 tabBar 的 height 会被安全区 inset 撑高、且 justifyContent:'flex-start' 不生效，
// 导致文字掉到栏底/屏幕底之外——故用自定义渲染（item2）。
function CustomTabBar({ state, descriptors, navigation }: any) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: colors.elevated,
        borderTopColor: colors.border,
        borderTopWidth: 1,
        paddingTop: 6,
        paddingBottom: Math.max(insets.bottom, 6),
      }}
    >
      {state.routes.map((route: any, index: number) => {
        const { options } = descriptors[route.key];
        const label = options.title || route.name;
        const isFocused = state.index === index;
        const color = isFocused ? colors.primary : colors.muted;
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
        };
        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            style={{ flex: 1, alignItems: 'center', paddingTop: 8, paddingBottom: 4, minHeight: 40 }}
          >
            <Text style={{ color, fontSize: 13, fontWeight: isFocused ? '700' : '500' }} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function HomeTabs() {
  const { t } = useI18n();
  return (
    <Tab.Navigator
      tabBar={(props: any) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      {/* 首页：竖屏短视频流（一部剧一屏，上下滑动切换） */}
      <Tab.Screen name="FeedTab" component={FeedScreen} options={{ title: t('tab.home') }} />
      {/* 剧场：原来的推荐页（分类 + 剧集网格） */}
      <Tab.Screen name="TheaterTab" component={Home} options={{ title: t('tab.theater') }} />
      <Tab.Screen name="WalletTab" component={Library} options={{ title: t('wallet.taskCenter') }} />
      <Tab.Screen name="ProfileTab" component={Profile} options={{ title: t('tab.profile') }} />
    </Tab.Navigator>
  );
}

function AppInner() {
  const { t } = useI18n();
  const { colors, theme } = useTheme();

  // 注册全局「登录态失效」处理器：token 过期/被吊销/密钥轮换导致 401 时，
  // 统一弹窗提示并跳登录页，保证全应用登录态一致，不再出现「这里已登录、那里未登录」。
  useEffect(() => {
    setSessionExpiredHandler(() => {
      if (!navigationRef.isReady()) return;
      const route = navigationRef.getCurrentRoute();
      if (route?.name === 'Login') return;
      Alert.alert(
        t('auth.sessionExpiredTitle'),
        t('auth.sessionExpiredMsg'),
        [
          {
            text: t('wallet.logIn'),
            onPress: () => {
              try {
                navigationRef.navigate('Login');
              } catch {
                /* ignore */
              }
            },
          },
        ],
      );
    });
  }, [t]);

  // 第三方登录（后端 OAuth 中转）回调：后端跳回 edendrama://oauth?token=xxx → 保存登录态并回主页
  useEffect(() => {
    const handleUrl = async (url: string | null) => {
      if (!url) return;
      // 推广短链：edendrama://drama/<id> → 打开该剧第 1 集直接观看
      if (url.startsWith('edendrama://drama/')) {
        const id = url.replace('edendrama://drama/', '').split('?')[0].replace(/\/+$/, '');
        if (id && navigationRef.isReady()) {
          try { navigationRef.navigate('Player' as any, { dramaId: id } as any); } catch { /* ignore */ }
        }
        return;
      }
      if (!url.startsWith('edendrama://oauth')) return;
      const qs = url.split('?')[1] || '';
      const params: Record<string, string> = {};
      qs.split('&').forEach((p) => {
        const i = p.indexOf('=');
        if (i > 0) params[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1));
      });
      const token = params.token;
      if (!token) return;
      await AsyncStorage.setItem('user_token', token);
      await AsyncStorage.removeItem('guest_mode').catch(() => {});
      try {
        const u: any = await userApi.profile();
        await AsyncStorage.setItem('user_info', JSON.stringify(u || {}));
      } catch { /* 拉不到资料也先登录，后续页面会再拉 */ }
      if (navigationRef.isReady()) {
        try { navigationRef.navigate('Main' as any); } catch { /* ignore */ }
      }
    };
    Linking.getInitialURL().then(handleUrl).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => handleUrl(e.url));
    return () => sub.remove();
  }, []);

  return (
    <NavigationContainer ref={navigationRef}>
      {/* amber（橙金）是深色底，状态栏文字同样要用亮色 */}
      <StatusBar style={theme === 'light' ? 'dark' : 'light'} />
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { color: colors.text },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="Main" component={HomeTabs} options={{ headerShown: false }} />
        <Stack.Screen name="DramaDetail" component={DramaDetail} options={{ title: t('header.dramaDetail') }} />
        <Stack.Screen name="Player" component={Player} options={{ headerShown: false, fullScreenGestureEnabled: true }} />
        <Stack.Screen name="Search" component={SearchScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Login" component={Login} options={{ title: t('header.login') }} />
        <Stack.Screen name="Profile" component={Profile} options={{ headerShown: false }} />
        <Stack.Screen name="Messages" component={Messages} options={{ title: t('message.title') }} />
        <Stack.Screen name="VIP" component={VIPScreen} options={{ title: 'VIP' }} />
        <Stack.Screen name="WalletHistory" component={WalletHistory} options={{ title: t('wallet.historyTitle') }} />
        <Stack.Screen
          name="CategoryList"
          component={CategoryList}
          options={({ route }: any) => {
            const type = route.params?.type;
            const title =
              type === 'favorites' ? t('wallet.favorites')
              : type === 'likes' ? t('wallet.likes')
              : type === 'reservations' ? t('profile.myReservations')
              : type === 'purchased' ? t('profile.purchased')
              : t('wallet.history');
            return { title };
          }}
        />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ headerShown: false }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <LanguageProvider>
          <ErrorBoundary>
            <AppInner />
          </ErrorBoundary>
        </LanguageProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}