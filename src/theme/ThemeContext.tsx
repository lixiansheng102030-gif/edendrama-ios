import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// 主题模式：浅色 / 深色 / 橙金（渐变）+ 暗紫 / 暗粉 / 暗蓝 / 暗红
export type ThemeMode =
  | 'light' | 'dark' | 'amber'
  | 'darkPurple' | 'darkPink' | 'darkBlue' | 'darkRed';

// 语义化色板：所有页面统一从这里取色，避免再写死 #0a0a0f 之类的十六进制。
export type ThemeColors = {
  bg: string; // 页面背景
  surface: string; // 卡片 / 列表项背景
  surfaceAlt: string; // 输入框、次级块
  elevated: string; // 顶部 / 底部栏、弹窗
  border: string; // 细分割线
  borderStrong: string; // 卡片描边
  text: string; // 主文字
  textSecondary: string; // 次级文字
  muted: string; // 弱化文字
  subtle: string; // 更弱文字 / 占位
  primary: string; // 品牌主色
  gold: string; // 金币黄
  green: string; // 正向数值
  danger: string; // 危险 / 负数
  overlay: string; // 弹窗遮罩
  isDark: boolean;
};

const DARK: ThemeColors = {
  bg: '#0a0a0f',
  surface: '#1f1f2e',
  surfaceAlt: '#2a2a3a',
  elevated: '#1a1a2e',
  border: '#2a2a3a',
  borderStrong: '#333333',
  text: '#ffffff',
  textSecondary: '#cccccc',
  muted: '#888888',
  subtle: '#666666',
  primary: '#722ed1',
  gold: '#fbbf24',
  green: '#4ade80',
  danger: '#f87171',
  overlay: 'rgba(0,0,0,0.7)',
  isDark: true,
};

const LIGHT: ThemeColors = {
  bg: '#f5f5f7',
  surface: '#ffffff',
  surfaceAlt: '#f0f0f4',
  elevated: '#ffffff',
  border: '#e5e5ea',
  borderStrong: '#dcdce2',
  text: '#1a1a1a',
  textSecondary: '#3a3a3a',
  muted: '#6b7280',
  subtle: '#9ca3af',
  primary: '#722ed1',
  gold: '#d97706',
  green: '#16a34a',
  danger: '#dc2626',
  overlay: 'rgba(0,0,0,0.45)',
  isDark: false,
};

// 橙金：与网页端 [data-theme='amber'] 完全对齐（网页是 rgb 三元组，此处转成十六进制）
const AMBER: ThemeColors = {
  bg: '#110d07',
  surface: '#1e170d',
  surfaceAlt: '#2c2213',
  elevated: '#1a1409',
  border: '#46361e',
  borderStrong: '#5a4526',
  text: '#fff8eb',
  textSecondary: '#efe3cc',
  muted: '#d4c4a8',
  subtle: '#a8967a',
  primary: '#f5b301',
  gold: '#f5b301',
  green: '#6fdc8c',
  danger: '#ff7a6b',
  overlay: 'rgba(0,0,0,0.72)',
  isDark: true,
};

/** 以 DARK 为底生成一套暗色变体（只覆盖有差异的色值）。 */
function darkVariant(overrides: Partial<ThemeColors>): ThemeColors {
  return { ...DARK, ...overrides };
}

// 暗紫：品牌紫 #A855F7 为主色，深紫底
const DARK_PURPLE: ThemeColors = darkVariant({
  bg: '#160e22',
  surface: '#241636',
  surfaceAlt: '#2e1d45',
  elevated: '#1d122c',
  border: '#362250',
  borderStrong: '#4a2f6b',
  text: '#f7f0ff',
  textSecondary: '#ddcbf5',
  muted: '#a88fc9',
  subtle: '#8069a3',
  primary: '#a855f7',
  gold: '#f2c14e',
  overlay: 'rgba(10,4,18,0.74)',
});

// 暗粉：Eden Pink #F0246A 为主色，深玫红底
const DARK_PINK: ThemeColors = darkVariant({
  bg: '#1a0c14',
  surface: '#2a1420',
  surfaceAlt: '#3a1b2c',
  elevated: '#240f1a',
  border: '#43253a',
  borderStrong: '#5c3350',
  text: '#fff0f6',
  textSecondary: '#f7d6e5',
  muted: '#ce9fb8',
  subtle: '#a8788f',
  primary: '#f0246a',
  gold: '#f2c14e',
  overlay: 'rgba(18,4,10,0.74)',
});

// 暗蓝：冷蓝 #3B82F6 为主色，深海蓝底
const DARK_BLUE: ThemeColors = darkVariant({
  bg: '#08121f',
  surface: '#112338',
  surfaceAlt: '#18304a',
  elevated: '#0d1c2e',
  border: '#1e3a57',
  borderStrong: '#2a4d70',
  text: '#eaf4ff',
  textSecondary: '#c3dcf5',
  muted: '#8fb2d0',
  subtle: '#6c8fae',
  primary: '#3b82f6',
  gold: '#f2c14e',
  overlay: 'rgba(3,10,20,0.74)',
});

// 暗红：暖红 #EF4444 为主色，深酒红底
const DARK_RED: ThemeColors = darkVariant({
  bg: '#1a0a0c',
  surface: '#2c1216',
  surfaceAlt: '#3a1a1f',
  elevated: '#230e11',
  border: '#4a2229',
  borderStrong: '#632f37',
  text: '#fff0f0',
  textSecondary: '#f5d5d5',
  muted: '#cfa3a3',
  subtle: '#a67c7c',
  primary: '#ef4444',
  gold: '#f2c14e',
  overlay: 'rgba(18,3,5,0.74)',
});

const THEME_COLORS: Record<ThemeMode, ThemeColors> = {
  light: LIGHT,
  dark: DARK,
  amber: AMBER,
  darkPurple: DARK_PURPLE,
  darkPink: DARK_PINK,
  darkBlue: DARK_BLUE,
  darkRed: DARK_RED,
};

/**
 * 主题展示元数据（供「设置 → 外观」的下拉展开面板渲染圆形色块）。
 * swatch  = 圆形色块左半 / 主色；swatch2 = 右半 / 底色（用来表现橙金渐变与暗色层次）。
 * 顺序即左右滑动时的展示顺序。
 */
export type ThemeMeta = {
  key: ThemeMode;
  labelKey: string;
  swatch: string;
  swatch2: string;
};

export const THEME_META: ThemeMeta[] = [
  { key: 'light', labelKey: 'profile.themeLight', swatch: '#f5f5f7', swatch2: '#722ed1' },
  { key: 'dark', labelKey: 'profile.themeDark', swatch: '#0a0a0f', swatch2: '#722ed1' },
  { key: 'amber', labelKey: 'profile.themeAmber', swatch: '#f5b301', swatch2: '#b45309' },
  { key: 'darkPurple', labelKey: 'profile.themeDarkPurple', swatch: '#a855f7', swatch2: '#241636' },
  { key: 'darkPink', labelKey: 'profile.themeDarkPink', swatch: '#f0246a', swatch2: '#2a1420' },
  { key: 'darkBlue', labelKey: 'profile.themeDarkBlue', swatch: '#3b82f6', swatch2: '#112338' },
  { key: 'darkRed', labelKey: 'profile.themeDarkRed', swatch: '#ef4444', swatch2: '#2c1216' },
];

type ThemeValue = {
  theme: ThemeMode;
  colors: ThemeColors;
  setTheme: (mode: ThemeMode) => void;
};

const STORAGE_KEY = 'app_theme';

const ThemeContext = createContext<ThemeValue>({
  theme: 'darkPink',
  colors: DARK_PINK,
  setTheme: () => {},
});

const THEMES: ThemeMode[] = THEME_META.map((m) => m.key);
function normalize(value: string | null | undefined): ThemeMode {
  return THEMES.indexOf(value as ThemeMode) >= 0 ? (value as ThemeMode) : 'darkPink';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // 默认暗粉主题（Eden Pink，与品牌色一致）。用户可在设置页切换，选择会持久化到 AsyncStorage。
  const [theme, setThemeState] = useState<ThemeMode>('darkPink');

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (!mounted) return;
        // 非法值回落到 darkPink（默认），与网页端 normalize 的默认保持一致
        setThemeState(normalize(saved));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({ theme, colors: THEME_COLORS[theme], setTheme }),
    [theme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}
